# AI providers

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators and developers | about 9 min | [Zabbix](zabbix.md) | [nginx, Docker and TLS](nginx-docker-tls.md) |

## What it is for

Two features need a language model: Explain, which writes one problem or one SLA figure in plain words, and the Assistant, which answers questions about the estate. The model is optional. Without one the buttons are not shown and nothing else changes. Which model answers is a matter of settings, never of code, and the two copies of the portal differ in this alone ([the two copies](../1-folders/the-two-copies.md)).

The two kinds of model are set side by side in [Choices compared](../5-reference/choices-compared.md), with the cost for 15 users and what each needs from the machine.

| | Hosted copy | Local-model copy |
|---|---|---|
| Provider setting | `AI_PROVIDER=anthropic` | `AI_PROVIDER=openai-compatible` |
| Where the model runs | Anthropic's API, reached through Anthropic's SDK | A server on the host machine, by default Ollama, reached with plain `fetch` |
| What leaves the machine | The text of each request | Nothing goes to a model provider |
| Model | A Claude model, the default of `core/config.ts` | `qwen3:8b` unless `AI_MODEL` says another |

The server holds the credential, and the browser never sees it. The code that calls a model is `server/src/clients/ai.ts`, the mirror of `zabbix.ts`.

![A click on Explain or a question to the Assistant passes a guard for calls and tokens, builds its input from Zabbix data, goes to the hosted or the local model, is checked or streamed, kept or not, and answered. A failure becomes a fixed sentence with the details in the log.](../diagrams/ai-flow.png)

## What the portal sends, and what comes back

**Explain** is one call that returns structured JSON, which the portal checks against a schema before it shows anything.

- For a problem it sends the trigger name and operational data, the severity, the device, the age, whether it was acknowledged, and every tag. It gets back a summary, one row for each tag that explains it, the business impact and a recommendation.
- For an SLA figure it sends the target, the period and the figures of each service; for the derived availability figure also the group's name, the method, the counts and the names and figures of up to twelve of the worst devices. It gets back a status, a plain explanation, whether the target is met, and a recommendation.
- The schema is enforced, not requested: the hosted API accepts a JSON Schema as the shape of its answer, and Ollama constrains its sampler to the schema's grammar. A small model can still fill the shape with empty strings, so `humanize()` checks that the answer is complete and raises an error rather than show a blank panel.

**The Assistant** is a conversation. Each question gets a summary of the estate, built from the same cached reads the pages use and reused for up to five minutes while nothing it describes has changed, puts it between fence lines that the system prompt calls data and never instructions, and adds the earlier turns of the conversation within a character budget. The model answers in plain text, which streams to the browser as it is written, in the language of the question. The server keeps nothing the Assistant says. The browser keeps the conversation of that tab until it closes or the person signs out.

Neither feature touches Zabbix's configuration. The model has no tools.

## The two backends

**Hosted.** The portal uses Anthropic's SDK. Its defaults are wrong for a person waiting behind a button (a ten-minute timeout and two retries), so the portal sets a thirty-second limit and one retry. A failed call becomes one of the fixed sentences below, with the SDK's own words kept for the log.

**Local.** The portal posts with raw `fetch`, as `zabbix.ts` does, because a second SDK for one POST was not worth a dependency. A local model that failed once is usually down and not flaky, so there is no retry, and the limit is two minutes, because a cold model pays a load cost on its first call after an idle period.

- It can speak two dialects. With `AI_OLLAMA_NATIVE=auto` the portal asks `/api/version` once, and when the server says it is Ollama it uses Ollama's own `/api/chat`, which takes the context size and honours how long to keep the model loaded. Any other server keeps the OpenAI-compatible `/v1`, which does neither: every `/v1` call puts the model's expiry back to Ollama's own five-minute default.
- The context window, `AI_NUM_CTX`, is one value sent with every native request, because in Ollama it belongs to the model's runner. A request with another value restarts the runner and throws away its prompt cache.
- Reasoning models such as Qwen3, DeepSeek-R1 and gpt-oss think first, which turns a three-second answer into fifteen on Ollama. The portal sends the switch that stops it, only to those families.
- `warmModel()` loads the model when the server starts, and `prefillModel()` has it read the system prompt before the question that needs it. A cold `qwen3:8b` takes about ten seconds to its first word.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `AI_PROVIDER` | `anthropic` | `anthropic`, or `openai-compatible` for a local server |
| `ANTHROPIC_API_KEY`, `AI_API_KEY` | none | The hosted key. Without it the model features are off. A local server usually needs none |
| `AI_BASE_URL` | none, and in the local copy `http://host.docker.internal:11434/v1` | Where a local server answers. Without it a local copy has no model |
| `AI_MODEL` | See above | The model name |
| `AI_TIMEOUT_MS` | 30000 hosted, 120000 local | How long one call may take |
| `AI_MAX_RETRIES` | 1 | Retries by the SDK, hosted only |
| `AI_KEEP_ALIVE` | `30m` | How long Ollama keeps the model loaded after its last use. Keeping it loaded costs about 5 GB of memory |
| `AI_OLLAMA_NATIVE` | `auto` | `true`, `false` or `auto`, as above |
| `AI_NUM_CTX` | 8192 | The context window. About 0.6 GB of cache at 8192, half that at Ollama's own 4096 |
| `AI_TEMPERATURE`, `AI_TOP_P` | 0.7, 0.8 | Sampling for the native API, stated and not left to the server. They are Qwen3's recommendation for answers without thinking |
| `AI_CHAT_PER_MINUTE`, `AI_EXPLAIN_PER_MINUTE` | 10, 10 | Questions and explanations a minute for each signed-in user |
| `AI_MAX_CONCURRENT` | 4 | Hosted calls in flight at once |
| `AI_DAILY_TOKENS_PER_USER`, `AI_DAILY_TOKENS_TOTAL` | 500000, 2000000 | The daily token budgets, hosted only. `0` switches a budget off |

## Limits, in the order a request meets them

1. **The guard.** `aiGuard` runs first. Too many calls this minute answers 429 `rate_limited` with a retry time. A used-up daily budget answers 429 `ai_budget` with the time to midnight in `SLA_TIMEZONE`. The count lives in memory, so a restart gives everyone a fresh allowance.
2. **The slot.** A local model takes one request at a time, in arrival order, because a second one would wait inside Ollama with no word to the reader. A request that would wait about twenty seconds is told the assistant is busy, as a 503 `ai_busy` with `Retry-After`. Hosted calls wait for one of `AI_MAX_CONCURRENT` places. The slot belongs to one server process, so run one server for each Ollama.
3. **The budget.** A hosted call is charged what the API says it billed, input including the part read from its cache, and output. The count resets at midnight in the reporting zone.
4. **The cache.** An explanation of a problem is kept for an hour and one of an SLA figure for five minutes, shared by every screen, so five clicks on one problem are one call.

## What the person sees when it fails

The viewer gets a fixed sentence, and the log keeps the cause.

| Sentence | Cause |
|---|---|
| The AI model could not be reached. Try again in a moment. | No connection to the model, or to Anthropic |
| The AI model took too long to answer. Try again, or ask a narrower question. | The time limit |
| The AI model returned an error. Try again in a moment. | Any other failure of the provider |
| The AI service did not accept the portal's key. Trying again will not help; tell an administrator. | The hosted key was refused (401 or 403). It stays refused until someone replaces it |
| The AI model stopped before finishing its answer. Try again. | The model cut itself off |
| The AI model gave an answer the portal could not use. Try again. | An empty or unusable answer |
| The assistant is busy answering another question. Try again in a moment. | The local slot, above |

The server's health check reports whether a local model is up, and the pages show "The AI model is not answering right now" before a click that would only fail. For the hosted provider the state is `not_checked`, because a probe would be billed.

## The notice that text left the machine

`GET /api/health` carries `aiProvider` and `aiExternal`. When the provider is Anthropic, every Explain and Assistant answer says what was sent and to whom ([data in and out](../0-everyone/data-in-and-out.md) quotes the sentences). A local model on any address shows nothing, because nothing left the machine.

## How to check it

- `GET /api/health` shows `ai` (on or off), `aiProvider` and `aiExternal`. Signed in, `ready.model` shows `off`, `not_checked`, `ok` or `down`.
- On the host with Ollama: `ollama list` shows the installed models and `ollama ps` the loaded one with how long it stays.
- Do not test the hosted copy by clicking Explain on a real problem, since each click sends that problem's text out. Use a made-up one.
- A refused key shows in the server's log as a 401 from Anthropic, with the hint to replace the key and recreate the server.

## Where the code is

| What | File |
|---|---|
| Both backends, the errors, the fixed sentences, the model slot, the warm-up | `server/src/clients/ai.ts` |
| Calls a minute, the daily budget, the guard | `server/src/clients/limits.ts` |
| Explain: what is read and asked | `server/src/services/explain.ts`, `server/src/routes/explain.ts` |
| The Assistant: the prompt, the summary, the answer | `server/src/services/assistantPrompt.ts`, `assistantSnapshot.ts`, `assistantFacts.ts`, `assistantFocus.ts`, `assistantLines.ts`, `assistantAnswer.ts` and `chat.ts` in the same folder |
| What the page shows | `web/src/features/assistant/` |
