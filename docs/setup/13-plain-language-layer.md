# 13. Plain-language layer (AI)

[setup.md](../../setup.md) · previous: [§12](12-extending-the-portal.md) · next: [§14](14-site-view.md)

Implements `plan_1.1.md` (in `myown/documents/plan/`, outside this repo). HCML's own overview names the gap: *"the main issue is
not the number of alarms, but the quality of information needed to act."* Tags like `class: os`,
`scope: availability` and wording like *"Zabbix agent is not available (for 3m)"* are precise for an
engineer and opaque to everyone else. This layer translates them.

Scope is deliberately narrow: tags, SLA figures, and notification wording. The assistant
([§24](24-assistant.md#24-assistant-chat)) is a separate feature built on the same client; neither ever touches
Zabbix config.

## How it flows

```
Browser ──/bff/api/explain/* ──► BFF ──► getProblems() / sla.get   (Zabbix, read-only)
                                  ├────► the model (server-side only: hosted Claude,
                                  │       or a local Ollama on this host)
                                  └────► cached()  (repeat clicks are free)
```

[`ai.ts`](../../server/src/clients/ai.ts) is the exact mirror of [`zabbix.ts`](../../server/src/clients/zabbix.ts): the
credential is read from `config` and never reaches the browser, and the transport matches for the local
backend: one hand-rolled `fetch` rather than a dependency for a single POST. The hosted backend uses
Anthropic's SDK, as the table below says.

`humanize()` is the one function the explain routes call. It picks a backend from `AI_PROVIDER`, hands both the *same* system
prompt, instructions and JSON Schemas, and returns the parsed result (the rest of `ai.ts` serves the assistant: the stream readers, the model slots and the warm-up):

| Backend | Transport | "obey this schema" is spelled |
|---|---|---|
| `anthropic` | `@anthropic-ai/sdk` | `output_config.format.json_schema` |
| `openai-compatible` | raw `fetch` | `response_format.json_schema` |

Both are *enforced*, not requested: Anthropic by structured outputs, Ollama by constraining the
sampler to the schema's grammar, so the response is guaranteed to match the shape the UI renders,
with no parsing guesswork and no validation dependency.

What a schema cannot enforce is that the model actually filled it in: a small local model will
occasionally satisfy the shape with empty strings. `assertComplete()` catches that and raises
`AiUpstreamError` rather than rendering a blank panel that looks like a portal bug.

## The two translations

| Endpoint | Input from Zabbix | Output |
|---|---|---|
| `/api/explain/problem?eventid=` | trigger name + `opdata` (this is the notification text), severity, host, age, ack state, and every tag | `summary`, `tagsExplained[]` (a glossary, one row per tag), `businessImpact`, `recommendation` |
| `/api/explain/sla?slaid=&serviceid=` | SLO target, period, and per-service SLI / uptime / downtime / error budget | `status`, `plain`, `meetingTarget`, `recommendation` |

One problem endpoint covers both tags and notification wording, because the trigger name plus
`opdata` *is* the notification as the team receives it.

## Design rules

- On-demand only. Nothing calls the model on page load. The user clicks "Explain"; that is the
  only trigger. No bulk or background runs.
- Cached hard. A problem explanation lives 1 h, an SLA explanation 5 min. Five clicks on the same
  problem = one model call (measured), and every NOC screen shares the same cache.
- Never invents. The system prompt forbids adding facts not present in the input: the model
  rephrases what Zabbix returned. The panel footer says so to the reader.
- Optional. Unconfigured, no `ANTHROPIC_API_KEY` on the hosted backend, no `AI_BASE_URL` on
  the local one: the portal is fully functional; `/api/health` reports `ai: false` and the UI hides
  the buttons rather than offering one that can only fail. Note that "configured" means something
  different per backend, which is why `config.ai.enabled` branches on the provider.
- Fails alone. A model outage (including nothing listening on `AI_BASE_URL`) returns
  `502 {error:'ai_error'}` on the explain routes only; every monitoring endpoint keeps serving 200.
  The message is one fixed sentence for the cause (could not be reached, took too long, returned an
  error, stopped early, gave an unusable answer, or refused the portal's key, which is the one that says
  trying again will not help). A model that is not switched on says to tell an administrator; the setting to change goes to the log (UX-20). The model's address and what it sent back go to
  the BFF log only, never to the viewer; the Assistant's `error` frame follows the same rule.

## Configuration

```bash
# server/.env: hosted
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-sonnet-4-6

# server/.env: local, nothing leaves this host
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://localhost:11434/v1   # host.docker.internal from the container
AI_MODEL=qwen3:8b
AI_TIMEOUT_MS=120000
```

Swapping provider as well as model is now a config change, not a code change. Set up the local
side with `brew install ollama && brew services start ollama && ollama pull qwen3:8b`, natively, not
in a container: Docker Desktop on macOS cannot reach the Metal GPU.

One model-specific wrinkle lives in `ai.ts`: reasoning models such as Qwen3 think before they
answer by default, which fights grammar-constrained decoding, eats the output budget, and, measured
on Ollama 0.33, turns a 3-second explanation into a 15-second one, with about a thousand characters
of hidden reasoning per call. Two plausible levers do not work on Ollama's OpenAI-compatible
endpoint: Qwen's `/no_think` prompt token (the chat template opens a think block regardless) and
`think: false` (not accepted on `/v1`). `reasoning_effort: "none"` does, so `thinkingControl()`
sends it for known reasoning families only. See [§24](24-assistant.md#24-assistant-chat) for the measurements.

## Trying it

```bash
curl "localhost:4000/api/explain/problem?eventid=23"   # 503 until a backend is configured
curl "localhost:4000/api/sla"                          # [] until Services → SLA exist in Zabbix
```
