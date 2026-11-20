# Server files, one card each

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 35 min | [Server: routes](server-routes.md) | [Web app files, one card each](files-web.md) |

Every code file of the server has one card on this page, 163 in all, grouped by folder and in alphabetical order. A card is the file in a few lines. The sentence under its heading says what the file is for and where the handbook walks through it, and a person wrote it. The block below that sentence is written by `npm run handover:build` from the code, so it cannot drift: the file's size, its exports with the first sentence of each comment, what it imports, who imports it, and which tests import it.

Use the page when you know a file name and want to know what it is for and what would be hit if you changed it. The A to Z index of every name is [the symbols page](symbols.md). The same cards for the web app and for the tools are [Web app files](files-web.md) and [Tools files](files-tools.md).

## `server`

### `server/eslint.config.js`

The lint rules for the server. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card server/eslint.config.js -->
18 lines, 1 export. Imported by 0 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | constant | 6 | `export default defineConfig([// dist is tsc's output, never a source. globalIgnores(['dist', 'node_modules'])...` |  |

Imports: none

Packages: `@eslint/js`, `eslint`, `globals`, `typescript-eslint`

Imported by: none

Tests that import it: none
<!-- /gen -->

### `server/vitest.config.ts`

The test settings: tests under src/__tests__, isolated per file, never reading a real .env. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card server/vitest.config.ts -->
35 lines, 1 export. Imported by 0 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | constant | 3 | `export default defineConfig({ test: { globals: true, environment: 'node', include: ['src/__tests__/**/*.test.ts']...` |  |

Imports: none

Packages: `vitest`

Imported by: none

Tests that import it: none
<!-- /gen -->

## `server/scripts`

### `server/scripts/hash-password.ts`

Prints a salted hash of a password, to paste into the users setting. Walked through in [Server: security and http](server-security-and-http.md).

<!-- gen:card server/scripts/hash-password.ts -->
69 lines, 0 exports. Imported by 0 files.

Imports: `security/passwords.ts`

Imported by: none

Tests that import it: none
<!-- /gen -->

### `server/scripts/validate-sli.ts`

Compares the derived SLA with HCML's own Availability Reports, which only we have. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card server/scripts/validate-sli.ts -->
233 lines, 0 exports. Imported by 0 files.

Imports: none

Packages: `node:fs`, `node:os`, `node:path`, `node:zlib`

Imported by: none

Tests that import it: none
<!-- /gen -->

## `server/scripts/bakeoff`

### `server/scripts/bakeoff/dump-sample.ts`

Writes `prompt-sample.json`, the real prompts of four questions, for the speed test on a machine that has no Node. No chapter walks through it, so this card and the README of its folder are its account.

<!-- gen:card server/scripts/bakeoff/dump-sample.ts -->
14 lines, 0 exports. Imported by 0 files.

Imports: `server/scripts/bakeoff/env.ts`, `server/scripts/bakeoff/sample.ts`, `server/scripts/bakeoff/score.ts`

Packages: `node:fs`, `node:path`, `node:url`

Imported by: none

Tests that import it: none
<!-- /gen -->

### `server/scripts/bakeoff/env.ts`

Sets what the bake-off tells the portal's code about the model, before that code is first imported, because the portal reads its settings once. No chapter walks through it, so this card and the README of its folder are its account.

<!-- gen:card server/scripts/bakeoff/env.ts -->
24 lines, 2 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `arg` | function | 6 | `const arg = (name: string): string \| undefined =>` |  |
| `model` | constant | 11 | `const model = arg('model')` |  |

Imports: none

Imported by: `server/scripts/bakeoff/dump-sample.ts`, `server/scripts/bakeoff/run.ts`

Tests that import it: none
<!-- /gen -->

### `server/scripts/bakeoff/rescore.ts`

Scores the saved answers of a run again, with the questions and the marks as they are now, without asking the model, so that a pattern that turned away a right answer can be mended. No chapter walks through it, so this card and the README of its folder are its account.

<!-- gen:card server/scripts/bakeoff/rescore.ts -->
34 lines, 0 exports. Imported by 0 files.

Imports: `server/scripts/bakeoff/score.ts`

Packages: `node:fs`, `node:path`, `node:url`

Imported by: none

Tests that import it: none
<!-- /gen -->

### `server/scripts/bakeoff/run.ts`

Asks one local model the fifty questions of the bake-off through the portal's own prompt and request code, scores the answers and saves the run with its times. No chapter walks through it, so this card and the README of its folder are its account.

<!-- gen:card server/scripts/bakeoff/run.ts -->
65 lines, 0 exports. Imported by 0 files.

Imports: `server/scripts/bakeoff/env.ts`, `server/scripts/bakeoff/score.ts`, `services/assistant.ts`

Packages: `node:fs`, `node:path`, `node:url`

Imported by: none

Tests that import it: none
<!-- /gen -->

### `server/scripts/bakeoff/sample.ts`

Builds the prompts of four questions from the portal's own system text, so that the speed test on a machine reads what the portal really sends. A test keeps the saved file equal to it. No chapter walks through it, so this card and the README of its folder are its account.

<!-- gen:card server/scripts/bakeoff/sample.ts -->
29 lines, 3 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SAMPLE_IDS` | constant | 5 | `const SAMPLE_IDS` | The questions whose real requests go to the speed test on a machine (deploy/model-speed.py): a count, a ranking, and two in Bahasa Indonesia. |
| `PromptSample` | interface | 7 | `interface PromptSample` |  |
| `buildSample` | function | 16 | `function buildSample(snapshot: string, questions: Question[]): PromptSample` | Built by the portal's own `chatSystem`, so the speed test reads the prompt that the portal sends. |

Imports: `server/scripts/bakeoff/score.ts`, `services/assistant.ts`

Imported by: `server/scripts/bakeoff/dump-sample.ts`

Tests that import it: `__tests__/bakeoff-sample.test.ts`
<!-- /gen -->

### `server/scripts/bakeoff/score.ts`

How an answer is judged in the bake-off, and the pass marks that were fixed before any model ran: the facts, nothing invented, the language, the format and the length. No chapter walks through it, so this card and the README of its folder are its account.

<!-- gen:card server/scripts/bakeoff/score.ts -->
161 lines, 7 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Question` | interface | 8 | `interface Question` |  |
| `PASS_MARKS` | constant | 30 | `const PASS_MARKS` | What a model must reach to be adopted. |
| `Check` | type | 41 | `type Check = 'facts' \| 'invented' \| 'language' \| 'format' \| 'length' \| 'empty'` |  |
| `answerLanguage` | function | 47 | `function answerLanguage(text: string): 'en' \| 'id' \| null` | The language of an answer by the portal's own word lists; an answer too short or too full of names to place is not held against the model. |
| `scoreAnswer` | function | 94 | `function scoreAnswer(question: Question, answer: string): { pass: boolean; failed: Check[] }` |  |
| `Summary` | interface | 114 | `interface Summary` |  |
| `summarise` | function | 128 | `function summarise(results: { question: Question; pass: boolean; failed: Check[] }[]): Summary` | The marks of a whole run against PASS_MARKS. |

Imports: `services/assistantPrompt.ts`

Imported by: `server/scripts/bakeoff/dump-sample.ts`, `server/scripts/bakeoff/rescore.ts`, `server/scripts/bakeoff/run.ts`, `server/scripts/bakeoff/sample.ts`

Tests that import it: `__tests__/bakeoff-sample.test.ts`, `__tests__/bakeoff-score.test.ts`
<!-- /gen -->

## `server/src`

### `server/src/index.ts`

The composition root: builds the app, registers the plugins and hooks in a fixed order, mounts every route module, then listens and warms the caches. Walked through in [One request, from start to finish](one-request.md), [Server: the core and the clients](server-core-and-clients.md), [Server: live and assistant](server-live-and-assistant.md), [Server: routes](server-routes.md), [Server: security and http](server-security-and-http.md), [Web app: the API client, the types and the guards](web-api-types-guards.md).

<!-- gen:card server/src/index.ts -->
196 lines, 0 exports. Imported by 0 files.

Imports: `clients/ai.ts`, `core/cache.ts`, `core/config.ts`, `core/logFile.ts`, `core/schemas.ts`, `core/staleness.ts`, `http/compress.ts`, `http/errors.ts`, `http/health.ts`, `http/hostCheck.ts`, `http/logging.ts`, `http/noStore.ts`, `http/rateLimit.ts`, `http/requestId.ts`, `http/shutdown.ts`, `routes/accountRequests.ts`, and 35 more

Packages: `@fastify/cors`, `@fastify/helmet`, `fastify`

Imported by: none

Tests that import it: none
<!-- /gen -->

## `server/src/clients`

### `server/src/clients/ai.ts`

Where a model credential is used to ask a question: Explain and the Assistant call hosted Claude or an OpenAI-compatible server from here, and every answer is checked against a schema. The readiness check in `http/health.ts` sends the same key when it lists a local server's models. Walked through in [Server: the core and the clients](server-core-and-clients.md), [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/clients/ai.ts -->
861 lines, 32 exports. Imported by 8 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `AiDisabledError` | class | 21 | `class AiDisabledError extends Error` | Raised when the AI layer is asked to work without a key. |
| `AiUpstreamError` | class | 39 | `class AiUpstreamError extends Error` | The model itself refused or failed (bad key, rate limit, outage, or, for a local backend: nothing listening on AI_BASE_URL). |
| `AI_MESSAGE` | constant | 50 | `const AI_MESSAGE` | What a viewer is told when the model fails; `detail` on the error carries the rest, for the log. |
| `AiBusyError` | class | 65 | `class AiBusyError extends AiUpstreamError` | Not a failure: the one local model is answering someone else and this request waited its turn too long. |
| `getAnthropic` | function | 69 | `function getAnthropic(): Anthropic` | Shared with services/assistant.ts: one client, one timeout policy, for both features. |
| `ProblemExplanation` | interface | 96 | `interface ProblemExplanation` | Plain-language translation of one problem: its wording *and* its tags. |
| `SlaExplanation` | interface | 104 | `interface SlaExplanation` | Plain-language translation of one SLA and its current SLI. |
| `Sampling` | interface | 195 | `interface Sampling` | What a model's own card asks for when it answers without thinking (ADR-0018's sibling work, P3.3). |
| `ModelProfile` | interface | 202 | `interface ModelProfile` |  |
| `modelProfile` | function | 220 | `const modelProfile = (model: string): ModelProfile =>` |  |
| `thinkingControl` | function | 228 | `function thinkingControl(model: string): { reasoning_effort?: 'none' }` | Reasoning models (Qwen3, DeepSeek-R1, gpt-oss) think first, which turns a 3 s answer into 15 s on Ollama. |
| `samplingFor` | function | 233 | `function samplingFor(model: string): Sampling` | The sampling a native request carries: the model's card, unless AI_TEMPERATURE or AI_TOP_P was set, which the owner's word overrules. |
| `languageLine` | function | 243 | `const languageLine = (language: 'en' \| 'id' \| null \| undefined): string =>` | The sentence that has Explain write in the language a user chose; the JSON keys, names and numbers stay as given. |
| `anthropicFailure` | function | 250 | `function anthropicFailure(err: InstanceType<typeof Anthropic.APIError>): AiUpstreamError` | A hosted-model API failure for the viewer: a fixed sentence, with the SDK's own wording kept for the log. |
| `ollamaRoot` | function | 269 | `function ollamaRoot(): string` | The server itself: AI_BASE_URL without the OpenAI-compatible `/v1`. |
| `usesOllamaNative` | function | 283 | `function usesOllamaNative(): Promise<boolean>` | Whether to speak Ollama's own API. |
| `ollamaChatBody` | function | 312 | `function ollamaChatBody(messages: { role: string; content: string }[], { numPredict, stream = false, format }:...` | The one request shape for every native call. |
| `OllamaStats` | interface | 345 | `interface OllamaStats` | What Ollama reports when a reply is done, for the BFF log, never the reader. |
| `readOllamaStream` | function | 375 | `async function* readOllamaStream(body: ReadableStream<Uint8Array>, onDone?: (stats: OllamaStats) => void):...` | Turn Ollama's native stream, one JSON object per line, into text pieces. |
| `BUSY_MESSAGE` | constant | 425 | `const BUSY_MESSAGE` |  |
| `acquireModelSlot` | function | 448 | `function acquireModelSlot(signal?: AbortSignal, waitMs = SLOT_WAIT_MS): Promise<() => void>` | Wait for the model, then hold it until the returned function is called. |
| `tryAcquireModelSlot` | function | 479 | `function tryAcquireModelSlot(): (() => void) \| null` | The model if nobody holds it this instant, else `null`: for work only worth doing while idle. |
| `acquireHostedSlot` | function | 508 | `function acquireHostedSlot(signal?: AbortSignal, waitMs = SLOT_WAIT_MS): Promise<() => void>` | Wait for a hosted call's turn, then hold it until the returned function is called. |
| `billedTokens` | function | 539 | `function billedTokens(usage: { input_tokens?: number \| null; output_tokens?: number \| null...` | Tokens a hosted call is billed for: what it read, cache included, and what it wrote. |
| `OnUsage` | type | 554 | `type OnUsage = (tokens: number) => void` | Called once with a finished call's token count, to charge it to whoever asked (limits.ts). |
| `ModelCounts` | interface | 557 | `interface ModelCounts` | What a model says about the tokens a call used; any of the three may be missing. |
| `countedTokens` | function | 564 | `function countedTokens(counts: ModelCounts \| null \| undefined): number \| null` | The model's own number for a call: its total, else the prompt and the answer added, else null (BK-69). |
| `chargeOutside` | function | 572 | `function chargeOutside(onUsage: OnUsage \| undefined, counted: number \| null, sentChars: number, receivedChars:...` | Charges a call to a model outside the machine's network as hosted Claude's are: its own count, else the size of what went in and out. |
| `postModel` | function | 582 | `async function postModel(url: string, body: unknown, signal: AbortSignal): Promise<Response>` | POST one request to the model server with raw `fetch`, mirroring `zabbix.ts`: there is no HTTP helper to import, and a second SDK would be a... |
| `warmModel` | function | 635 | `async function warmModel(log?: { debug: (obj: unknown, msg?: string) => void }): Promise<void>` | Load the local model before anyone waits on it (a cold qwen3:8b takes ~10 s to its first token). |
| `prefillModel` | function | 664 | `async function prefillModel(system: string, log?: AiLog): Promise<boolean>` | Have the model read a system prompt before the question that needs it, so that question pays only for its own words (Ollama keeps it in its prompt... |
| `humanize` | function | 830 | `async function humanize<K extends Kind>(kind: K, payload: unknown, onUsage?: OnUsage, signal?: AbortSignal...` | Ask the configured model to rewrite one Zabbix artifact. |

Imports: `clients/limits.ts`, `core/config.ts`

Packages: `@anthropic-ai/sdk`

Imported by: `http/errors.ts`, `index.ts`, `routes/chat.ts`, `routes/explain.ts`, `security/audit.ts`, `services/assistantAnswer.ts`, `services/chat.ts`, `services/explain.ts`

Tests that import it: `__tests__/ai-errors.test.ts`, `__tests__/ai-hosted-limits.test.ts`, `__tests__/ai-limits.test.ts`, `__tests__/ai-model-profile.test.ts`, `__tests__/ai-outside-usage.test.ts`, `__tests__/ai-redirect.test.ts`, `__tests__/ai.test.ts`, `__tests__/chat-route.test.ts`, and 8 more
<!-- /gen -->

### `server/src/clients/limits.ts`

Per-person caps on the model: calls a minute, and for the hosted model the tokens a day. Walked through in [Server: the core and the clients](server-core-and-clients.md).

<!-- gen:card server/src/clients/limits.ts -->
243 lines, 11 exports. Imported by 9 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `AiKind` | type | 12 | `type AiKind = 'chat' \| 'explain'` |  |
| `callerOf` | function | 15 | `function callerOf(req: FastifyRequest): string` | Who a call counts against: the signed-in user, or the client address when auth is off (as services/stream.ts). |
| `MinuteLimit` | class | 27 | `class MinuteLimit` | One fixed window per key, started by that key's first call: a minute unless told otherwise. |
| `HourLimit` | class | 61 | `class HourLimit extends MinuteLimit` | The same count over an hour. |
| `estimatedTokens` | function | 70 | `const estimatedTokens = (chars: number): number =>` | Roughly four characters to a token: for a call whose answer carried no count. |
| `BudgetLimits` | interface | 72 | `interface BudgetLimits` |  |
| `BudgetRefusal` | interface | 79 | `interface BudgetRefusal` |  |
| `DailyTokens` | class | 110 | `class DailyTokens` | Tokens used today, by caller and in all, reset when the calendar day (in the portal's time zone) changes. |
| `aiBudget` | constant | 180 | `const aiBudget = new DailyTokens(() => ({ perUser: limits.dailyTokensPerUser, total: limits.dailyTokensTotal }), ()...` | The portal's one budget, read from config.ts. |
| `chargeTo` | function | 186 | `const chargeTo = (req: FastifyRequest) =>` | What to give `humanize` and `streamAnswer` so a finished call is charged to whoever asked. |
| `aiGuard` | function | 205 | `function aiGuard(kind: AiKind)` | The route guard for an AI route: too many calls this minute, no tokens left today, or (for a model that takes one call at a time) a call of the... |

Imports: `core/config.ts`, `sli/time.ts`

Packages: `fastify`

Imported by: `clients/ai.ts`, `routes/chat.ts`, `routes/explain.ts`, `security/actionLimit.ts`, `security/audit.ts`, `security/heavyLimit.ts`, `security/mailLimit.ts`, `security/searchLimit.ts`, `services/assistantAnswer.ts`

Tests that import it: `__tests__/action-limit.test.ts`, `__tests__/ai-limits.test.ts`, `__tests__/ai-outside-usage.test.ts`, `__tests__/mail-limit.test.ts`
<!-- /gen -->

### `server/src/clients/mail.ts`

The only file that talks to a mail server. It logs in, sends one message to the people in the settings and says how many of them the server took. A failure becomes one sentence for its kind, and the server's own words are kept for the log with the login name and the password taken out. It reads nothing from disk and nothing from a URL, and it never logs in over a connection it could not encrypt. Walked through in [Reports and exports](../3-integrations/reports-exports.md).

<!-- gen:card server/src/clients/mail.ts -->
177 lines, 11 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `MailFailure` | type | 10 | `type MailFailure = 'login' \| 'connect' \| 'timeout' \| 'tls' \| 'recipients' \| 'rejected' \| 'other'` |  |
| `failureWords` | function | 26 | `const failureWords = (kind: MailFailure): string =>` | The fixed sentence for a kind of failure, for a message the portal writes to a person. |
| `MailError` | class | 28 | `class MailError extends Error` |  |
| `MailDisabledError` | class | 39 | `class MailDisabledError extends Error` |  |
| `Attachment` | interface | 46 | `interface Attachment` |  |
| `OutgoingMail` | interface | 52 | `interface OutgoingMail` |  |
| `Mailer` | interface | 61 | `interface Mailer` |  |
| `MailerOptions` | interface | 68 | `interface MailerOptions` |  |
| `scrub` | function | 78 | `function scrub(text: string, secrets: readonly string[]): string` | `text` with each secret, every address and every control character taken out, and cut short. |
| `verifyLimit` | function | 122 | `function verifyLimit(timeouts: { socket: number; verify?: number }): number` | How much silence the check before a send waits through: its own setting, else 15 seconds, and never more than the socket timeout. |
| `createMailer` | function | 126 | `function createMailer(settings: MailSettings, options: MailerOptions = {}): Mailer` |  |

Imports: `core/mailConfig.ts`

Packages: `node:tls`, `nodemailer`

Imported by: `http/errors.ts`, `routes/sliMail.ts`, `services/reportSchedule.ts`, `services/sliMail.ts`

Tests that import it: `__tests__/email-without-auth.test.ts`, `__tests__/empty-report-retry.test.ts`, `__tests__/mail-client.test.ts`, `__tests__/mail-options.test.ts`, `__tests__/mail-range-empty.test.ts`, `__tests__/mail-route.test.ts`, `__tests__/mail-service.test.ts`, `__tests__/openapi-contract.test.ts`, and 1 more
<!-- /gen -->

### `server/src/clients/pinnedTls.ts`

Connects to Zabbix with a certificate pinned by fingerprint until a set day, for the time its own certificate had expired. Walked through in [Server: the core and the clients](server-core-and-clients.md).

<!-- gen:card server/src/clients/pinnedTls.ts -->
155 lines, 8 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `PinnedTlsError` | class | 7 | `class PinnedTlsError extends Error` | Why a connection was refused. |
| `Peer` | interface | 17 | `interface Peer` | What a handshake showed. |
| `judgePeer` | function | 28 | `function judgePeer(peer: Peer, pin: TlsPin, nowMs: number): PinnedTlsError \| undefined` | A certificate that passes the normal check goes on. |
| `PinOptions` | interface | 50 | `interface PinOptions` | For tests: a CA trusted in place of the system's, and a clock. |
| `pinnedAgentFor` | function | 92 | `function pinnedAgentFor(pin: TlsPin, nowMs = Date.now()): https.Agent` | The agent for `pin`, made again once its last day has passed, so no connection opened before carries a request after. |
| `createPinnedAgent` | function | 102 | `function createPinnedAgent(pin: TlsPin, opts: PinOptions = {}): https.Agent` | A pinned agent with test options; the client itself uses `pinnedAgentFor`. |
| `Reply` | interface | 107 | `interface Reply` | What `fetch` would have given back, as far as the JSON-RPC client reads it. |
| `postPinned` | function | 115 | `function postPinned(url: string, headers: Record<string, string>, body: string, timeoutMs: number, agent:...` | One POST through `agent`, under one deadline for connecting, sending and reading, as `AbortSignal.timeout` gives `fetch`. |

Imports: `core/config.ts`

Packages: `node:https`, `node:stream`, `node:tls`

Imported by: `clients/zabbix.ts`

Tests that import it: `__tests__/pinned-tls.test.ts`, `__tests__/zabbix-pinned.test.ts`
<!-- /gen -->

### `server/src/clients/zabbix.ts`

The only place Zabbix tokens are used: zbx reads with the read token, zbxWrite writes with the separate write token, and both give up after a timeout. Walked through in [One request, from start to finish](one-request.md), [Server: the core and the clients](server-core-and-clients.md), [Tests and checkers](tests-and-checkers.md).

<!-- gen:card server/src/clients/zabbix.ts -->
215 lines, 9 exports. Imported by 34 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ZabbixAuthError` | class | 15 | `class ZabbixAuthError extends Error` | Raised when Zabbix rejects our credentials (expired/invalid/revoked token). |
| `ZabbixTimeoutError` | class | 40 | `class ZabbixTimeoutError extends Error` | Raised when Zabbix did not answer within `ZABBIX_TIMEOUT_MS`. |
| `ZabbixApiError` | class | 59 | `class ZabbixApiError extends Error` | Zabbix could not be reached, answered with a non-2xx status or something that is not JSON-RPC, or returned a JSON-RPC error: bad parameters, or a... |
| `ZabbixRefusedError` | class | 73 | `class ZabbixRefusedError extends ZabbixApiError` | Zabbix answered, and its answer was an error: bad parameters, or a write it would not take. |
| `ZabbixWriteDisabledError` | class | 76 | `class ZabbixWriteDisabledError extends Error` | Raised when a write is attempted with no ZABBIX_WRITE_TOKEN configured. |
| `requestNeverLeft` | function | 127 | `function requestNeverLeft(code: unknown): boolean` | Whether a failure with this system code came before the request left, so that a write cannot have been applied. |
| `ZbxOptions` | interface | 199 | `interface ZbxOptions` | A read with a limit of its own, such as the background count over every item, says so here. |
| `zbx` | function | 204 | `async function zbx<T = unknown>(method: string, params: unknown = {}, opts: ZbxOptions = {}): Promise<T>` | Every portal read goes through here, using the read-only token. |
| `zbxWrite` | function | 212 | `async function zbxWrite<T = unknown>(method: string, params: unknown = {}): Promise<T>` | The only write path (§20). |

Imports: `clients/pinnedTls.ts`, `core/config.ts`

Imported by: `domain/queries.ts`, `domain/reachability.ts`, `domain/recentValues.ts`, `http/errors.ts`, `http/health.ts`, `routes/actions.ts`, `routes/chat.ts`, `security/viewerPolicy.ts`, `services/actions.ts`, `services/assistantAcks.ts`, `services/assistantHostInfo.ts`, `services/assistantMaintenance.ts`, `services/assistantPast.ts`, `services/assistantValues.ts`, and 20 more

Tests that import it: `__tests__/action-limit.test.ts`, `__tests__/api-hygiene.test.ts`, `__tests__/assistant-acks.test.ts`, `__tests__/assistant-hostinfo.test.ts`, `__tests__/assistant-maintenance.test.ts`, `__tests__/assistant-past.test.ts`, `__tests__/assistant-values.test.ts`, `__tests__/capacity-branches.test.ts`, and 48 more
<!-- /gen -->

## `server/src/core`

### `server/src/core/acceptEncoding.ts`

Reads a client's Accept-Encoding header and says whether gzip is allowed. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card server/src/core/acceptEncoding.ts -->
18 lines, 2 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `codingWeight` | function | 5 | `function codingWeight(header: string \| string[] \| undefined, coding: string): number` | What a client's Accept-Encoding header allows. |
| `acceptsGzip` | function | 18 | `const acceptsGzip = (header: string \| string[] \| undefined): boolean =>` | Whether the client takes gzip, which is all a browser offers over plain HTTP. |

Imports: none

Imported by: `http/compress.ts`, `routes/stream.ts`

Tests that import it: `__tests__/compress.test.ts`
<!-- /gen -->

### `server/src/core/cache.ts`

The in-memory cache: lifetimes, one fetch shared by concurrent callers, a size cap, an old copy kept while a slow refresh runs, and invalidation after a write. Walked through in [One request, from start to finish](one-request.md), [Server: the core and the clients](server-core-and-clients.md).

<!-- gen:card server/src/core/cache.ts -->
438 lines, 16 exports. Imported by 29 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `FetchContext` | interface | 83 | `interface FetchContext` | What a fetch is told about itself. |
| `CacheOptions` | interface | 94 | `interface CacheOptions` |  |
| `SLOW_VIEW` | constant | 120 | `const SLOW_VIEW: CacheOptions` | A view HCML's Zabbix takes tens of seconds to build: past its TTL, its last copy and age for 10 minutes while one refresh runs. |
| `CacheLogger` | interface | 123 | `interface CacheLogger` | The part of Fastify's logger the cache uses. |
| `InvalidateOptions` | interface | 127 | `interface InvalidateOptions` |  |
| `MAX_ENTRIES` | constant | 137 | `const MAX_ENTRIES = 500` |  |
| `MAX_TYPED_ENTRIES` | constant | 139 | `const MAX_TYPED_ENTRIES = 150` | The share of those that keys a caller can multiply at will may take. |
| `MAX_BYTES` | constant | 141 | `const MAX_BYTES = 64 * 1024 * 1024` | About 130 KB per entry at the entry cap: the problem list is ~450 KB (stream.ts), most values far less. |
| `MAX_PINNED_BYTES` | constant | 142 | `const MAX_PINNED_BYTES = MAX_BYTES / 2` |  |
| `HOLD_TTL_MS` | constant | 143 | `const HOLD_TTL_MS = 2_000` |  |
| `REFRESH_RETRY_MS` | constant | 145 | `const REFRESH_RETRY_MS = 60_000` | After a fetch of a value with an old copy fails, none starts for this long, so a Zabbix that is down is asked about each value once a minute and... |
| `approxBytes` | function | 155 | `function approxBytes(value: unknown, budget = 500_000): number` | A rough size in bytes: strings by length, numbers as 8, objects and arrays by their slots, Maps and typed arrays by what they hold. |
| `setCacheLogger` | function | 197 | `function setCacheLogger(logger: CacheLogger \| undefined): void` | Where stale answers and failed background refreshes are reported (index.ts passes app.log). |
| `cacheLogger` | function | 202 | `function cacheLogger(): CacheLogger \| undefined` | The same logger, for a caller that reports a failed background read of its own. |
| `cached` | function | 210 | `async function cached<T>(key: string, ttlMs: number, fn: (ctx: FetchContext) => Promise<T>, opts: CacheOptions =...` |  |
| `invalidate` | function | 419 | `function invalidate(prefix: string, opts: InvalidateOptions = {}): number` | Drop cached entries so the next read refetches. |

Imports: `core/gate.ts`, `core/staleness.ts`

Imported by: `domain/queries.ts`, `domain/reachability.ts`, `index.ts`, `routes/actions.ts`, `routes/inventory.ts`, `routes/sla.ts`, `security/viewerPolicy.ts`, `services/aging.ts`, `services/assistantSnapshot.ts`, `services/availability.ts`, `services/capacity.ts`, `services/devices.ts`, `services/explain.ts`, `services/history.ts`, and 15 more

Tests that import it: `__tests__/ai-limits.test.ts`, `__tests__/api-hygiene.test.ts`, `__tests__/assistant-follow-up.test.ts`, `__tests__/assistant-scope.test.ts`, `__tests__/bakeoff-fixture.test.ts`, `__tests__/cache.test.ts`, `__tests__/capacity-branches.test.ts`, `__tests__/chat.test.ts`, and 37 more
<!-- /gen -->

### `server/src/core/config.ts`

Every setting read from the environment, typed, with the checks that refuse an unsafe start. Walked through in [Server: the core and the clients](server-core-and-clients.md).

<!-- gen:card server/src/core/config.ts -->
765 lines, 22 exports. Imported by 54 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `DEFAULT_JWT_SECRET` | constant | 9 | `const DEFAULT_JWT_SECRET` | The placeholder JWT secret. |
| `SESSION_HOURS_DEFAULT` | constant | 17 | `const SESSION_HOURS_DEFAULT = 12` | A sign-in lasts this many hours unless SESSION_HOURS says otherwise. |
| `SESSION_HOURS_MIN` | constant | 19 | `const SESSION_HOURS_MIN = 2` | Renewal comes an hour before the end, so a shorter session could never be renewed in time. |
| `SESSION_HOURS_MAX` | constant | 20 | `const SESSION_HOURS_MAX = 24` |  |
| `SESSION_EPOCH_DEFAULT` | constant | 21 | `const SESSION_EPOCH_DEFAULT` |  |
| `SESSION_EPOCH_PATTERN` | constant | 23 | `const SESSION_EPOCH_PATTERN = /^[A-Za-z0-9._-]{1,32}$/` | What SESSION_EPOCH may hold: a short label, so it can sit in a token and in a log line. |
| `AiProvider` | type | 59 | `type AiProvider = (typeof AI_PROVIDERS)[number]` |  |
| `isCloudModelName` | function | 91 | `const isCloudModelName = (model: string): boolean =>` | A model name that Ollama sends to ollama.com once it is signed in (`gpt-oss:120b-cloud`, `kimi-k2:cloud`), whatever address it is asked at (SC-70). |
| `OllamaNative` | type | 97 | `type OllamaNative = 'auto' \| 'true' \| 'false'` | `auto` asks the server whether it is Ollama (see ai.ts `usesOllamaNative`); `true` and `false` skip the question. |
| `parseNoDataWindows` | function | 122 | `function parseNoDataWindows(raw: string \| undefined): [number, number][] \| undefined` | SLA_NO_DATA_WINDOWS: spans known not to have been measured truly, such as a collector that ran outside HCML's network, as `start/end` ISO times... |
| `TlsPin` | interface | 138 | `interface TlsPin` | ZBX_TLS_PIN_SHA256 and ZBX_TLS_PIN_UNTIL read together (clients/pinnedTls.ts). |
| `parseTlsPin` | function | 148 | `function parseTlsPin(rawFingerprint: string \| undefined, rawUntil: string \| undefined): TlsPin \| undefined` | Undefined when either is blank or cannot be read: the exception is then off and an expired certificate is refused. |
| `SliProfile` | type | 159 | `type SliProfile = (typeof SLI_PROFILES)[number]` |  |
| `toSliProfile` | function | 160 | `function toSliProfile(raw: string \| undefined): SliProfile \| undefined` |  |
| `trustProxyOption` | function | 179 | `function trustProxyOption(hops: number \| false): false \| ((addr: string, hop: number) => boolean)` | The hop count as the `trustProxy` option Fastify 5 takes. |
| `parseAuthEnabled` | function | 190 | `function parseAuthEnabled(raw: string \| undefined): boolean \| undefined` |  |
| `config` | constant | 197 | `const config` | Central, typed view of the environment. |
| `writeBackEnabled` | function | 525 | `function writeBackEnabled(): boolean` | Whether acknowledge and close may run: a write token is set, and either sign-in is on or the dev opt-in is. |
| `signInRefusal` | function | 533 | `function signInRefusal(): string` | Why the saved list of recipients and the schedule (and what the page shows of them) are refused: sign-in is off and the opt-in is not given. |
| `emailRefusal` | function | 542 | `function emailRefusal(): string` | Why email is refused although it is set up: sign-in is off and the opt-in is not given. |
| `mailNow` | function | 547 | `function mailNow(): MailSettings & { off: string }` | The mail settings as they apply now: `enabled` is false while email is refused, and `off` says why. |
| `assertConfig` | function | 598 | `function assertConfig(warn: (msg: string) => void): void` | Warn on suspicious config so the scaffold still boots, except for a weak signing secret when auth is on, an AUTH_ENABLED it cannot read, or a... |

Imports: `core/localHost.ts`, `core/mailConfig.ts`

Packages: `dotenv`

Imported by: `clients/ai.ts`, `clients/limits.ts`, `clients/pinnedTls.ts`, `clients/zabbix.ts`, `domain/siteOf.ts`, `http/health.ts`, `http/hostCheck.ts`, `http/rateLimit.ts`, `index.ts`, `routes/accountRequests.ts`, `routes/actions.ts`, `routes/analytics.ts`, `routes/chat.ts`, `routes/explain.ts`, and 40 more

Tests that import it: `__tests__/accounts.test.ts`, `__tests__/action-limit.test.ts`, `__tests__/ai-local-only.test.ts`, `__tests__/ai-notice.test.ts`, `__tests__/ai.test.ts`, `__tests__/api-hygiene.test.ts`, `__tests__/chat-route.test.ts`, `__tests__/chat.test.ts`, and 36 more
<!-- /gen -->

### `server/src/core/delay.ts`

The update interval of an item in seconds, read in one place: `60`, `1m`, a flexible interval cut at its first semicolon, a macro taken as 60, and the interval to believe a value for (`pollSeconds`). The graph, the freshness test and the SLA used to read it three ways (BK-95).

<!-- gen:card server/src/core/delay.ts -->
24 lines, 3 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `DEFAULT_DELAY_SECONDS` | constant | 7 | `const DEFAULT_DELAY_SECONDS = 60` | What an interval with no number in it is taken for: a macro (`{$SNMP.INTERVAL}`), or anything else the portal cannot read. |
| `parseDelay` | function | 15 | `function parseDelay(raw: string \| undefined): number` | `60`, `1m`, `5m`, `1h`, `30s`, `2d`, `1w`; a flexible interval (`10m;30s/1-7,00:00-24:00`) is the part before its first `;`; a macro or anything... |
| `pollSeconds` | function | 24 | `const pollSeconds = (raw: string \| undefined): number =>` | The interval to believe a value for: the item's own, or 60 s for an item that has none (a dependent item), and never under a second. |

Imports: none

Imported by: `domain/reachability.ts`, `services/history.ts`, `sli/engine.ts`

Tests that import it: `__tests__/delay.test.ts`, `__tests__/sli-engine.test.ts`
<!-- /gen -->

### `server/src/core/gate.ts`

Lets only so many heavy jobs run at once and queues the rest. Walked through in [Server: the core and the clients](server-core-and-clients.md).

<!-- gen:card server/src/core/gate.ts -->
55 lines, 4 exports. Imported by 5 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Gate` | interface | 5 | `interface Gate` | Lets at most `limit` jobs run at once, the rest waiting first come first served; a job that throws gives its place back. |
| `GateRun` | interface | 11 | `interface GateRun` |  |
| `Cancelled` | class | 17 | `class Cancelled extends Error` | A waiting job was dropped because its reader left, so nothing was read for it. |
| `createGate` | function | 24 | `function createGate(limit: number): Gate` |  |

Imports: none

Imported by: `core/cache.ts`, `http/errors.ts`, `security/audit.ts`, `services/meters.ts`, `services/reportPolicy.ts`

Tests that import it: `__tests__/cache.test.ts`, `__tests__/explain-reader-left.test.ts`, `__tests__/gate.test.ts`, `__tests__/reader-gone.test.ts`, `__tests__/sli-gate.test.ts`, `__tests__/sli-limit.test.ts`
<!-- /gen -->

### `server/src/core/localHost.ts`

Decides whether a model's address is on this machine or inside its own network, so that the local-model copy can keep its promise that nothing leaves it. A loopback address, `host.docker.internal`, a private or link-local address, a name of one word and a name that ends `.local`, `.internal`, `.lan`, `.home.arpa` or `.localdomain` are local, and anything else is outside (SC-53). It reads only the text of the address and asks no network.

<!-- gen:card server/src/core/localHost.ts -->
35 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `isLocalBaseUrl` | function | 17 | `function isLocalBaseUrl(raw: string): boolean` |  |

Imports: none

Imported by: `core/config.ts`

Tests that import it: `__tests__/compose-env.test.ts`, `__tests__/compose-vm.test.ts`, `__tests__/local-host.test.ts`
<!-- /gen -->

### `server/src/core/logFile.ts`

Keeps the server's own copy of its log in a file in a volume, so that what was logged outlives a rebuild. A file is closed at a set size and the oldest of a set number is dropped, so the folder has a ceiling. It writes a line at a time, never throws, and starts again by itself when the folder becomes usable.

<!-- gen:card server/src/core/logFile.ts -->
158 lines, 8 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `RotatingFileOptions` | interface | 10 | `interface RotatingFileOptions` |  |
| `Problem` | type | 19 | `type Problem = (message: string) => void` | Told when the file cannot be written: once for each run of failures. |
| `Track` | interface | 24 | `interface Track` | What a file reports about itself: whether its last write failed, and the bytes that reached it since the start. |
| `LogFileStatus` | interface | 29 | `interface LogFileStatus` |  |
| `logFileStatus` | function | 39 | `const logFileStatus = (): LogFileStatus =>` |  |
| `createRotatingFile` | function | 52 | `function createRotatingFile(opts: RotatingFileOptions, onProblem: Problem = toStderr, track: Track = { failing:...` |  |
| `LogSettings` | interface | 129 | `interface LogSettings` |  |
| `createLogStream` | function | 137 | `function createLogStream(settings: LogSettings, out: NodeJS.WritableStream = process.stdout, onProblem?: Problem):...` | What Fastify's logger writes to: every line to `out` first, then to the file. |

Imports: none

Packages: `node:fs`, `node:path`, `node:stream`

Imported by: `http/health.ts`, `index.ts`

Tests that import it: `__tests__/health.test.ts`, `__tests__/log-file.test.ts`
<!-- /gen -->

### `server/src/core/mailConfig.ts`

Turns the eight MAIL_ settings into one object that says whether email is on, with the server, port and security each provider needs, and the reasons when a setting cannot be used. A line break, a password that would travel in the clear and an address that is not plain are all refused here, and no reason it gives ever holds the password. `config.ts` calls it once at start-up.

<!-- gen:card server/src/core/mailConfig.ts -->
233 lines, 12 exports. Imported by 7 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `MAIL_PROVIDERS` | constant | 6 | `const MAIL_PROVIDERS` |  |
| `MailProvider` | type | 7 | `type MailProvider = (typeof MAIL_PROVIDERS)[number]` |  |
| `MailSecurity` | type | 8 | `type MailSecurity = 'tls' \| 'starttls' \| 'none'` |  |
| `MAX_RECIPIENTS` | constant | 11 | `const MAX_RECIPIENTS = 10` |  |
| `DEFAULT_SENDER_NAME` | constant | 13 | `const DEFAULT_SENDER_NAME` | The sender's name when MAIL_FROM_NAME is not set. |
| `MAX_ALLOWED_DOMAINS` | constant | 15 | `const MAX_ALLOWED_DOMAINS = 20` |  |
| `MailEnv` | interface | 17 | `interface MailEnv` |  |
| `MailSettings` | interface | 35 | `interface MailSettings` |  |
| `validAddress` | function | 77 | `const validAddress = (a: string): boolean =>` |  |
| `addressDomain` | function | 78 | `const addressDomain = (a: string): string =>` |  |
| `plainAddress` | function | 80 | `const plainAddress = (a: unknown): a is string =>` | One plain address, with no control character in it: a line break is how a header gets forged. |
| `resolveMail` | function | 92 | `function resolveMail(env: MailEnv): MailSettings` |  |

Imports: none

Imported by: `clients/mail.ts`, `core/config.ts`, `core/recipients.ts`, `core/state.ts`, `routes/sliMail.ts`, `routes/sliSchedule.ts`, `services/reportSchedule.ts`

Tests that import it: `__tests__/email-without-auth.test.ts`, `__tests__/mail-client.test.ts`, `__tests__/mail-config.test.ts`, `__tests__/mail-options.test.ts`, `__tests__/mail-recipients.test.ts`, `__tests__/mail-route.test.ts`, `__tests__/mail-service.test.ts`, `__tests__/portal-state.test.ts`
<!-- /gen -->

### `server/src/core/readerGone.ts`

Turns the closing of a reader's connection into a signal that a slow report can listen to, so that a read nobody waits for any more leaves the queue. It fires only when the connection closes before the answer is out. Walked through with the gate in [Server: the core and the clients](server-core-and-clients.md).

<!-- gen:card server/src/core/readerGone.ts -->
11 lines, 1 export. Imported by 6 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `readerGone` | function | 4 | `function readerGone(reply: FastifyReply): AbortSignal` | A signal that fires when the reader's connection closes before the answer is out: the page moved on, or the tab closed. |

Imports: none

Packages: `fastify`

Imported by: `routes/analytics.ts`, `routes/explain.ts`, `routes/reports.ts`, `routes/services.ts`, `routes/sli.ts`, `routes/sliExport.ts`

Tests that import it: `__tests__/heavy-reports.test.ts`, `__tests__/reader-gone.test.ts`
<!-- /gen -->

### `server/src/core/recipients.ts`

Checks a list of addresses a person typed: each must be a plain address, none twice, at most the limit and at least the minimum, and in an allowed domain when the settings name some. The same rules hold the list that comes from the screen and the one read back from the state file, and every refusal is a sentence that says which address and why. It also splits typed text into a list, and lists the domains of a list of addresses for the log, which never holds an address.

<!-- gen:card server/src/core/recipients.ts -->
57 lines, 4 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `RecipientRules` | interface | 9 | `interface RecipientRules` |  |
| `splitAddresses` | function | 26 | `const splitAddresses = (text: string): string[] =>` | Text typed in a box, as a list: commas, semicolons, spaces and line breaks all separate. |
| `domainsOf` | function | 29 | `const domainsOf = (addresses: readonly string[]): string[] =>` | The domains of the addresses, once each, in lower case, in the order they appear. |
| `checkRecipients` | function | 31 | `function checkRecipients(input: unknown, rules: RecipientRules): string[]` |  |

Imports: `core/mailConfig.ts`, `core/validate.ts`

Imported by: `routes/sliMail.ts`, `routes/sliSchedule.ts`, `services/reportSchedule.ts`

Tests that import it: `__tests__/mail-recipients.test.ts`
<!-- /gen -->

### `server/src/core/reportChoices.ts`

What a report is asked for, which is all the base layer needs to know of it: the kinds of file it comes in (PDF, Excel, CSV), and how it is written. The style is the mark in a decimal, the shape of a date, and what a CSV file puts between its fields, and it never changes a figure, a verdict or the order of anything. The state file, the export writers and the services all read it from here, so none of them has to import from another.

<!-- gen:card server/src/core/reportChoices.ts -->
24 lines, 8 exports. Imported by 5 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `FORMAT_NAMES` | constant | 8 | `const FORMAT_NAMES` | The file kinds the report comes in, in the order they are listed and attached. |
| `Format` | type | 9 | `type Format = (typeof FORMAT_NAMES)[number]` |  |
| `DECIMALS` | constant | 11 | `const DECIMALS` |  |
| `DATES` | constant | 12 | `const DATES` |  |
| `SEPARATORS` | constant | 13 | `const SEPARATORS` |  |
| `ReportStyle` | interface | 15 | `interface ReportStyle` |  |
| `DEFAULT_STYLE` | constant | 22 | `const DEFAULT_STYLE: ReportStyle` | What every report was written in before styles existed. |
| `styleKey` | function | 24 | `const styleKey = (s: ReportStyle): string =>` |  |

Imports: none

Imported by: `core/state.ts`, `export/csv.ts`, `export/slaReport.ts`, `services/sliExport.ts`, `services/sliMail.ts`

Tests that import it: `__tests__/export-csv.test.ts`, `__tests__/export-sla-report-style.test.ts`, `__tests__/export-sla-report.test.ts`, `__tests__/export-style.test.ts`
<!-- /gen -->

### `server/src/core/schemas.ts`

The JSON Schema of every POST body, and the rule that a query name may be sent only once. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/core/schemas.ts -->
311 lines, 18 exports. Imported by 22 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `AJV_OPTIONS` | constant | 25 | `const AJV_OPTIONS: NonNullable<FastifyServerOptions['ajv']>` | Fastify's validator coerces types unless told not to: the text "false" becomes false, the number 5 becomes "5", a list of one name becomes the name. |
| `QUERY_VALUE_MAX` | constant | 31 | `const QUERY_VALUE_MAX = 2_000` | The longest query value a route reads is a list of 50 item ids. |
| `singleValues` | function | 37 | `function singleValues(...names: string[])` | A query string of single values. |
| `changePasswordBody` | constant | 45 | `const changePasswordBody` | The person's own change of password: the current one, and the new one. |
| `createUserBody` | constant | 59 | `const createUserBody` | A new user. |
| `updateUserBody` | constant | 76 | `const updateUserBody` | A change to a user: any of these, and at least one. |
| `resetPasswordBody` | constant | 91 | `const resetPasswordBody` |  |
| `nameParams` | constant | 101 | `const nameParams` |  |
| `accountRequestBody` | constant | 108 | `const accountRequestBody` | A request for an account, from a person who is not signed in (FR-62). |
| `idParams` | constant | 119 | `const idParams` |  |
| `loginBody` | constant | 126 | `const loginBody` | Sign-in. |
| `emailReportBody` | constant | 140 | `const emailReportBody` | Emailing the SLA report: the month or a window of days and the hours of the day, the formats, who it goes to, whether to keep that list, and the... |
| `scheduleBody` | constant | 170 | `const scheduleBody` | The monthly schedule: every field but the style is required. |
| `recipientsBody` | constant | 192 | `const recipientsBody` | The saved list of recipients, replaced as a whole. |
| `noBody` | constant | 201 | `const noBody` | Sign-out and renewal read no body: none at all, or a JSON object that is ignored. |
| `acknowledgeBody` | constant | 204 | `const acknowledgeBody` | Acknowledge. |
| `chatBody` | constant | 217 | `const chatBody` | The assistant. |
| `validationProblem` | function | 272 | `function validationProblem(err: unknown): string \| null` | One plain sentence for a Fastify validation error, or null when `err` is not one. |

Imports: none

Packages: `fastify`

Imported by: `http/errors.ts`, `index.ts`, `routes/accountRequests.ts`, `routes/actions.ts`, `routes/analytics.ts`, `routes/chat.ts`, `routes/explain.ts`, `routes/history.ts`, `routes/hosts.ts`, `routes/maps.ts`, `routes/net.ts`, `routes/reports.ts`, `routes/services.ts`, `routes/sla.ts`, and 8 more

Tests that import it: `__tests__/account-requests.test.ts`, `__tests__/chat-route.test.ts`, `__tests__/email-without-auth.test.ts`, `__tests__/mail-route.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/request-schemas.test.ts`, `__tests__/schedule-route.test.ts`, `__tests__/users-routes.test.ts`, and 2 more
<!-- /gen -->

### `server/src/core/staleness.ts`

Adds the headers that say an answer is an old copy, how old it is, or that a refresh is running. Walked through in [Server: the core and the clients](server-core-and-clients.md).

<!-- gen:card server/src/core/staleness.ts -->
70 lines, 6 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `STALE_HEADER` | constant | 20 | `const STALE_HEADER` |  |
| `AGE_HEADER` | constant | 21 | `const AGE_HEADER` |  |
| `REFRESHING_HEADER` | constant | 26 | `const REFRESHING_HEADER` | The other kind of old copy: a slow view answered with its last copy while a newer one is read (cache.ts, `noteAge`). |
| `noteStale` | function | 39 | `function noteStale(ageMs: number): void` | Called by cache.ts when it answers a failed fetch with an old copy. |
| `noteRefreshing` | function | 45 | `function noteRefreshing(ageMs: number): void` | Called by cache.ts when a slow view answers with its last copy while a newer one is read. |
| `registerStaleHeaders` | function | 51 | `function registerStaleHeaders(app: FastifyInstance): void` | Register before the routes: a hook applies only to routes added after it. |

Imports: none

Packages: `fastify`, `node:async_hooks`

Imported by: `core/cache.ts`, `index.ts`

Tests that import it: `__tests__/light-reads.test.ts`, `__tests__/stale-headers.test.ts`
<!-- /gen -->

### `server/src/core/state.ts`

The portal's one small file of its own, on a volume that outlives the container: the saved recipients, the monthly schedule and a record of the last 24 sends. It opens the file at start, repairs what it can and puts aside what it cannot read, and saves each change whole to a temporary file that is renamed over the old one, one change at a time. Without a folder it keeps the same in memory and says so. It keeps 24 records of sends and drops a manual send before one of the schedule's own, and it remembers a save that did not go through until one does. It never holds a report, a figure from Zabbix, an address in a record of a send, or a password.

<!-- gen:card server/src/core/state.ts -->
301 lines, 12 exports. Imported by 9 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `MAX_SENDS_KEPT` | constant | 13 | `const MAX_SENDS_KEPT = 24` |  |
| `Schedule` | interface | 17 | `interface Schedule` |  |
| `Outcome` | type | 33 | `type Outcome = 'sending' \| 'sent' \| 'failed' \| 'missed'` |  |
| `SendRecord` | interface | 35 | `interface SendRecord` |  |
| `PortalState` | interface | 58 | `interface PortalState` |  |
| `emptyState` | function | 63 | `const emptyState = (): PortalState =>` |  |
| `StateWriteError` | class | 65 | `class StateWriteError extends Error` |  |
| `StateStore` | interface | 72 | `interface StateStore` |  |
| `readState` | function | 139 | `function readState(raw: unknown): { state: PortalState; repairs: string[]; usable: boolean }` | The state `raw` describes, repaired, with a line for each thing that had to go. |
| `writeJsonAtomic` | function | 194 | `async function writeJsonAtomic(file: string, value: unknown): Promise<void>` | Writes `value` as JSON so that a reader sees the old file or the new one whole: a temp file beside it, synced, then renamed, readable by its owner... |
| `memoryState` | function | 220 | `const memoryState = (): StateStore =>` | A state kept in memory alone: what the portal runs on with no data folder, and what the tests start from. |
| `openState` | function | 256 | `async function openState(dir: string, warn: (message: string) => void): Promise<StateStore>` | Opens the state in `dir`, or in memory when `dir` is empty or cannot be written. |

Imports: `core/mailConfig.ts`, `core/reportChoices.ts`

Packages: `node:fs`, `node:path`

Imported by: `http/errors.ts`, `routes/sliSchedule.ts`, `security/requestStore.ts`, `security/userStore.ts`, `services/closedWebStore.ts`, `services/mailState.ts`, `services/portalState.ts`, `services/reportSchedule.ts`, `sli/schedule.ts`

Tests that import it: `__tests__/closed-web-store.test.ts`, `__tests__/email-without-auth.test.ts`, `__tests__/mail-route.test.ts`, `__tests__/portal-state.test.ts`, `__tests__/report-schedule.test.ts`, `__tests__/schedule-route.test.ts`, `__tests__/sli-schedule.test.ts`
<!-- /gen -->

### `server/src/core/validate.ts`

Parses ids and numbers from a query string and turns a bad one into a 400. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/core/validate.ts -->
72 lines, 9 exports. Imported by 26 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `BadRequestError` | class | 16 | `class BadRequestError extends Error` | A malformed request. |
| `DataNotReadYetError` | class | 21 | `class DataNotReadYetError extends Error` | A request that is right but cannot be answered yet: the newest reading is older than the range it asks for. |
| `ScheduleUnavailableError` | class | 26 | `class ScheduleUnavailableError extends Error` | The monthly schedule cannot run on this portal. |
| `EMPTY_REPORT_WORDS` | constant | 30 | `const EMPTY_REPORT_WORDS` |  |
| `EmptyReportError` | class | 35 | `class EmptyReportError extends Error` | A report with no device in either profile: mailing it would send an empty page as a success. |
| `isZabbixId` | function | 46 | `function isZabbixId(value: string): boolean` | Digits only, and no larger than Zabbix stores: anything else only comes back from Zabbix as a failed read. |
| `requireId` | function | 51 | `function requireId(value: unknown, name: string): string` | A Zabbix object id: required, digits only. |
| `optionalId` | function | 59 | `function optionalId(value: unknown, name: string): string \| undefined` | An optional Zabbix object id: absent is fine, present must be digits. |
| `intParam` | function | 68 | `function intParam(value: unknown, fallback: number, min: number, max: number): number` | An integer query parameter. |

Imports: none

Imported by: `core/recipients.ts`, `http/errors.ts`, `routes/actions.ts`, `routes/analytics.ts`, `routes/explain.ts`, `routes/history.ts`, `routes/hosts.ts`, `routes/maps.ts`, `routes/net.ts`, `routes/reports.ts`, `routes/sla.ts`, `routes/sliExport.ts`, `routes/sliMail.ts`, `routes/sliSchedule.ts`, and 12 more

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/empty-report-retry.test.ts`, `__tests__/export-route.test.ts`, `__tests__/export-style.test.ts`, `__tests__/mail-range-empty.test.ts`, `__tests__/mail-recipients.test.ts`, `__tests__/period-window.test.ts`, `__tests__/report-schedule.test.ts`, and 5 more
<!-- /gen -->

## `server/src/domain`

### `server/src/domain/naming.ts`

Reads a host's site and kind of device from its name, by HCML's naming convention. Walked through in [Server: domain and hosts](server-domain-and-hosts.md).

<!-- gen:card server/src/domain/naming.ts -->
132 lines, 10 exports. Imported by 18 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SiteRef` | interface | 14 | `interface SiteRef` |  |
| `SITES` | constant | 20 | `const SITES: (SiteRef & { aliases: string[] })[]` | Sites 1 to 14, with the words that name them in `INET :` / `SERVER :` hosts. |
| `naturalCompare` | constant | 40 | `const naturalCompare = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare` | Numeric-aware ordering: `1.2.2` before `1.2.10`, `Gi1/0/2` before `Gi1/0/10`. |
| `siteFromHostName` | function | 49 | `function siteFromHostName(name: string): SiteRef \| null` | The site a host belongs to, from its name alone, or null when the name does not say (`WEB :` services, `INTERNET`, `Zabbix server`). |
| `DeviceClass` | type | 68 | `type DeviceClass = \| 'firewall' \| 'switch' \| 'access-point' \| 'repeater' \| 'wan-link' \| 'web' \| 'server' \| 'other'` |  |
| `DEVICE_CLASS_LABELS` | constant | 78 | `const DEVICE_CLASS_LABELS: Record<DeviceClass, string>` |  |
| `deviceClass` | function | 93 | `function deviceClass(name: string, templateName?: string): DeviceClass` | What kind of device a host is. |
| `CATEGORY_ORDER` | constant | 115 | `const CATEGORY_ORDER` | Report category labels, in the order HCML's reports list them. |
| `categoryLabel` | function | 117 | `function categoryLabel(templateName: string \| undefined): string` |  |
| `wanPairKey` | function | 128 | `function wanPairKey(name: string): { path: string; leg: string; provider?: string } \| null` | `INET : SAMPANG WAN 1` and `INET : SAMPANG WAN 2` are two legs of one path. |

Imports: none

Imported by: `domain/siteOf.ts`, `export/slaReport.ts`, `services/assistantDetail.ts`, `services/assistantFacts.ts`, `services/assistantFocus.ts`, `services/assistantInternet.ts`, `services/assistantSnapshot.ts`, `services/assistantValues.ts`, `services/availability.ts`, `services/devices.ts`, `services/hosts.ts`, `services/links.ts`, `services/net.ts`, `services/sites.ts`, and 4 more

Tests that import it: `__tests__/devices-route.test.ts`, `__tests__/export-pdf.test.ts`, `__tests__/export-sla-report.test.ts`, `__tests__/naming.test.ts`, `__tests__/site-naming.test.ts`, `__tests__/copiedHelpers.test.ts`
<!-- /gen -->

### `server/src/domain/queries.ts`

The shared problem reads: the cached problem list with its hosts, and the operational data fetched only for the few problems Explain and the Assistant describe. Walked through in [Server: domain and hosts](server-domain-and-hosts.md), [Server: routes](server-routes.md).

<!-- gen:card server/src/domain/queries.ts -->
224 lines, 11 exports. Imported by 21 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ZbxProblem` | interface | 6 | `interface ZbxProblem` |  |
| `openProblems` | function | 31 | `const openProblems = (problems: ZbxProblem[]): ZbxProblem[] =>` | The problems that count: open, and not inside a planned maintenance window. |
| `PROBLEM_FIELDS` | constant | 38 | `const PROBLEM_FIELDS` | Every problem field the screens use. |
| `PROBLEMS_TTL_MS` | constant | 58 | `const PROBLEMS_TTL_MS = 15_000` | How long the problem list is reused. |
| `cachedProblems` | function | 61 | `const cachedProblems = (opts?: Pick<CacheOptions, 'maxAgeMs'>) =>` | The problem list as every route, the stream and the reports share it: one read per PROBLEMS_TTL_MS, or sooner for a caller that passes `maxAgeMs`... |
| `TRIGGER_HOST_TTL_MS` | constant | 64 | `const TRIGGER_HOST_TTL_MS = 60 * 60_000` | A trigger's host rarely changes, and HCML's Zabbix took 9.7 s to name the hosts of 648 triggers. |
| `getProblems` | function | 130 | `async function getProblems(): Promise<ZbxProblem[]>` | problem.get doesn't carry host names, so we enrich: collect the trigger ids, name their hosts (hostsOf) and attach host id + name to each problem. |
| `withOpdata` | function | 154 | `async function withOpdata(problems: ZbxProblem[]): Promise<ZbxProblem[]>` | The same problems with their operational data, read for these few only. |
| `ZHostMeta` | interface | 180 | `interface ZHostMeta` | A host with everything the governance-facing views need: groups, tags and the inventory fields that carry site and owner. |
| `getHostsWithMeta` | function | 205 | `async function getHostsWithMeta(): Promise<ZHostMeta[]>` | Shared by the Sites board and the inventory scorecard, both need the same enriched host list, so they share one cache entry rather than each... |
| `SEVERITY_NAMES` | constant | 217 | `const SEVERITY_NAMES: Record<string, string>` | Zabbix trigger severities, as the UI and the plain-language layer name them. |

Imports: `clients/zabbix.ts`, `core/cache.ts`

Imported by: `domain/siteOf.ts`, `routes/problems.ts`, `services/aging.ts`, `services/assistantAcks.ts`, `services/assistantDetail.ts`, `services/assistantFacts.ts`, `services/assistantFocus.ts`, `services/assistantLines.ts`, `services/assistantOpen.ts`, `services/assistantSnapshot.ts`, `services/explain.ts`, `services/hosts.ts`, `services/inventory.ts`, `services/maps.ts`, and 7 more

Tests that import it: `__tests__/ai-limits.test.ts`, `__tests__/ai-notice.test.ts`, `__tests__/assistant-follow-up.test.ts`, `__tests__/assistant-scope.test.ts`, `__tests__/bakeoff-fixture.test.ts`, `__tests__/chat.test.ts`, `__tests__/explain-problem.test.ts`, `__tests__/explain-prompt-fence.test.ts`, and 10 more
<!-- /gen -->

### `server/src/domain/reachability.ts`

One reachability state per host, ping first, built from the ping items and the interface availability. Walked through in [Server: domain and hosts](server-domain-and-hosts.md), [Tests and checkers](tests-and-checkers.md).

<!-- gen:card server/src/domain/reachability.ts -->
327 lines, 22 exports. Imported by 11 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `HostState` | type | 18 | `type HostState = 'up' \| 'down' \| 'degraded' \| 'nodata' \| 'disabled'` |  |
| `StateReason` | type | 21 | `type StateReason = \| 'ping' \| 'interface' \| 'snmp-silent' \| 'agent-silent' \| 'stale' \| 'no-interface' \|...` | Where a host's state came from. |
| `Availability` | type | 31 | `type Availability = 'available' \| 'unavailable' \| 'unknown'` |  |
| `rollUpAvailability` | function | 37 | `function rollUpAvailability(interfaces?: { available?: string }[]): Availability` | Zabbix 7.0 tracks availability per interface. |
| `freshWithinS` | function | 48 | `function freshWithinS(delay: string \| undefined): number` | How old a value of an item with this update interval may be and still be believed: three intervals, never under ten minutes. |
| `isFresh` | function | 61 | `function isFresh(it: { lastclock?: string; state?: string; delay?: string }, now: number): boolean` | A value Zabbix actually collected, from a supported item, recently enough to believe: at most three update intervals old, and never less than ten... |
| `IcmpItem` | interface | 70 | `interface IcmpItem` |  |
| `IcmpReading` | interface | 81 | `interface IcmpReading` | One host's ICMP items folded together. |
| `foldIcmp` | function | 103 | `function foldIcmp(items: IcmpItem[], now: number): Map<string, IcmpReading>` | Fold ICMP items into one reading per host. |
| `ICMP_CATALOG_TTL_MS` | constant | 126 | `const ICMP_CATALOG_TTL_MS = 60 * 60_000` | Finding the ping items reads Zabbix's whole item table (19 to 39 s on HCML's), and they change only with the hosts. |
| `ICMP_CATALOG_STALE_MS` | constant | 128 | `const ICMP_CATALOG_STALE_MS = 24 * 60 * 60_000` | Past that hour the held list is used for up to a day while a new one is read. |
| `ICMP_WINDOW_S` | constant | 130 | `const ICMP_WINDOW_S = 900` | How far back values are read: past the freshness rule of an item polled at least every five minutes. |
| `getIcmpValues` | function | 164 | `function getIcmpValues(): Promise<Map<string, RecentValue>>` | The newest value of every supported ping item, in one history read per value type (2.8 s on HCML's server against 54.5 s for Zabbix's `lastvalue`). |
| `getIcmpByHost` | function | 200 | `function getIcmpByHost(): Promise<Map<string, IcmpReading>>` | ICMP readings for every monitored host. |
| `COLLECTING_STALE_SECONDS` | constant | 212 | `const COLLECTING_STALE_SECONDS = MIN_FRESH_SECONDS` | The same ten minutes isFresh() allows before it stops believing a ping. |
| `newestClock` | function | 215 | `function newestClock(items: { lastclock?: string; state?: string }[]): number \| null` | The newest `lastclock` of a supported item, Unix seconds; null when no item has collected. |
| `CollectingStatus` | interface | 225 | `interface CollectingStatus` |  |
| `REACH_LOST_SHARE` | constant | 240 | `const REACH_LOST_SHARE = 0.2` | Below this share of the fresh pings answered, with at least REACH_MIN_PINGED of them, the collector is taken as cut off. |
| `REACH_MIN_PINGED` | constant | 241 | `const REACH_MIN_PINGED = 10` |  |
| `collectingStatus` | function | 244 | `function collectingStatus(lastCollectedAt: number \| null, now: number, readings: Map<string, IcmpReading> = new...` | Work out the age at the moment of asking, and how many fresh pings were answered. |
| `getCollecting` | function | 264 | `function getCollecting(): Promise<{ lastCollectedAt: number \| null; readings: Map<string, IcmpReading> }>` | When Zabbix last collected a value, and every host's ping as read then. |
| `hostState` | function | 304 | `function hostState(host: { status: string; interfaces?: { type?: string; available?: string }[] }, icmp: IcmpReading...` | A host's state, ping first. |

Imports: `clients/zabbix.ts`, `core/cache.ts`, `core/delay.ts`, `domain/recentValues.ts`

Imported by: `services/assistantFacts.ts`, `services/assistantFocus.ts`, `services/assistantValues.ts`, `services/hosts.ts`, `services/links.ts`, `services/meters.ts`, `services/net.ts`, `services/reports.ts`, `services/sites.ts`, `services/topHosts.ts`, `services/webMonitoring.ts`

Tests that import it: `__tests__/delay.test.ts`, `__tests__/freshness.test.ts`, `__tests__/reachability.test.ts`
<!-- /gen -->

### `server/src/domain/recentValues.ts`

Reads the newest value of many items with one history call per value type, instead of one query per item. Walked through in [Server: domain and hosts](server-domain-and-hosts.md).

<!-- gen:card server/src/domain/recentValues.ts -->
42 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `RecentValue` | interface | 4 | `interface RecentValue` | The newest value an item holds, as Zabbix's history keeps it. |
| `recentValues` | function | 13 | `async function recentValues(items: readonly { itemid: string; value_type: string }[], windowS: number, nowS =...` | The newest value of each item within the last `windowS` seconds. |

Imports: `clients/zabbix.ts`

Imported by: `domain/reachability.ts`

Tests that import it: `__tests__/light-reads.test.ts`
<!-- /gen -->

### `server/src/domain/siteOf.ts`

Finds a host's site by four signals, the site tag, the name, the inventory and the host group, so that the Sites page, the SLA reading and the Assistant all give a host the same site (BK-94, BK-103). Walked through in [Server: domain and hosts](server-domain-and-hosts.md).

<!-- gen:card server/src/domain/siteOf.ts -->
79 lines, 6 exports. Imported by 5 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SiteSource` | type | 11 | `type SiteSource = 'tag' \| 'name' \| 'inventory' \| 'group'` | Where a host's site name came from, weakest last. |
| `resolveSite` | function | 23 | `function resolveSite(host: ZHostMeta): { site: string; source: SiteSource }` | Resolve one host to a site, most explicit signal first: 1. |
| `siteRefOf` | function | 51 | `function siteRefOf(host: ZHostMeta): SiteRef \| null` | The site of a host as the code and name of the sites HCML keeps (naming.ts), by the same four signals as `resolveSite`: Hosts, Devices and the... |
| `SITE_SIGNALS` | constant | 58 | `const SITE_SIGNALS` | What a host list asks Zabbix for besides the host, so that its site can be read by the four signals (`siteRefOf`). |
| `siteOfName` | function | 65 | `function siteOfName(text: string): SiteRef \| null` | The site of HCML's list that a name or an alias in words stands for, null when it is none of them: the name of a Sites group, a tag value, a field... |
| `siteByHostName` | function | 72 | `function siteByHostName(sites: { name: string; hosts: { name: string }[] }[]): (hostName: string) => SiteRef \| null` | The site of a host as the Sites view put it (by the four signals), looked up by the host's name, for the places that hold a name and not the host... |

Imports: `core/config.ts`, `domain/naming.ts`, `domain/queries.ts`

Imported by: `services/assistantDetail.ts`, `services/assistantFocus.ts`, `services/assistantSnapshot.ts`, `services/sites.ts`, `sli/engine.ts`

Tests that import it: none
<!-- /gen -->

## `server/src/export`

### `server/src/export/csv.ts`

Writes the SLA report as a zip of CSV files: the first page, one file for each table, and a notes file that explains them. It reads the same document as the PDF and the workbook writers. A figure is written as a number a spreadsheet can total, a missing one as a blank and never a zero, and a name that a spreadsheet would run as a formula gets an apostrophe in front.

<!-- gen:card server/src/export/csv.ts -->
109 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `csvEntries` | function | 93 | `function csvEntries(doc: ReportDoc, style: ReportStyle): ZipEntry[]` |  |
| `buildCsv` | function | 106 | `function buildCsv(doc: ReportDoc, now: Date, style: ReportStyle = DEFAULT_STYLE): Buffer` |  |

Imports: `core/reportChoices.ts`, `export/types.ts`, `export/zip.ts`

Imported by: `services/sliExport.ts`

Tests that import it: `__tests__/export-csv.test.ts`
<!-- /gen -->

### `server/src/export/logo.ts`

The HCML logo as embedded data, and a small PNG reader that turns it into the pixels a PDF image needs. Walked through in [Server: export](server-export.md).

<!-- gen:card server/src/export/logo.ts -->
524 lines, 3 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `LOGO_PNG_BASE64` | constant | 16 | `const LOGO_PNG_BASE64` | Copy of web/public/logo-mark.png, 782 by 224, RGBA, 34229 bytes, SHA-256 a digest. |
| `Pixels` | interface | 413 | `interface Pixels` |  |
| `decodePng` | function | 461 | `function decodePng(png: Buffer): Pixels` | Reads an 8-bit, non-interlaced PNG of colour type 0, 2, 3 or 6. |

Imports: none

Packages: `node:buffer`, `node:zlib`

Imported by: `export/pdf.ts`

Tests that import it: `__tests__/export-pdf.test.ts`
<!-- /gen -->

### `server/src/export/pdf.ts`

A PDF writer built on Node alone: turns a report document into A4 landscape pages. Walked through in [Server: export](server-export.md).

<!-- gen:card server/src/export/pdf.ts -->
833 lines, 3 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `pdfNumber` | function | 63 | `function pdfNumber(v: number): string` | A number as a content stream spells it. |
| `columnBoxes` | function | 678 | `function columnBoxes(t: Table): { x: number; w: number }[]` | The left edge and width of each column of `t`, in points; together they span the printable width exactly. |
| `buildPdf` | function | 766 | `function buildPdf(doc: ReportDoc, now: Date = new Date()): Buffer` |  |

Imports: `export/logo.ts`, `export/pdfFonts.ts`, `export/theme.ts`, `export/types.ts`

Packages: `node:buffer`, `node:crypto`, `node:zlib`

Imported by: `services/sliExport.ts`

Tests that import it: `__tests__/export-pdf.test.ts`, `__tests__/export-writers-agree.test.ts`
<!-- /gen -->

### `server/src/export/pdfFonts.ts`

Text widths and encoding for the PDF's built-in fonts, so lines can be fitted and cut. Walked through in [Server: export](server-export.md).

<!-- gen:card server/src/export/pdfFonts.ts -->
180 lines, 10 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `WinAnsiText` | type | 14 | `type WinAnsiText = string & { readonly __winAnsi: true }` | Text already mapped to WinAnsi bytes; the only kind the measuring functions accept. |
| `FontFace` | type | 16 | `type FontFace = 'regular' \| 'bold'` |  |
| `ELLIPSIS` | constant | 19 | `const ELLIPSIS` | The ellipsis glyph, WinAnsi code 0x85. |
| `toWinAnsi` | function | 71 | `function toWinAnsi(s: string): WinAnsiText` | Maps text to WinAnsi: accents and curly quotes survive, controls become spaces, the rest becomes "?". |
| `textWidth` | function | 87 | `function textWidth(s: WinAnsiText, face: FontFace, size: number): number` |  |
| `fontWidths` | function | 94 | `function fontWidths(face: FontFace): readonly number[]` | The widths of codes 32 to 255, for the font dictionaries. |
| `fitText` | function | 109 | `function fitText(s: WinAnsiText, face: FontFace, size: number, maxWidth: number): WinAnsiText` | Cuts text to fit, ending in an ellipsis; text that already fits is returned as is. |
| `wrapText` | function | 117 | `function wrapText(s: WinAnsiText, face: FontFace, size: number, maxWidth: number): WinAnsiText[]` | Greedy word wrap on spaces; a word wider than the line is broken by character. |
| `wrapParagraph` | function | 152 | `function wrapParagraph(s: WinAnsiText, face: FontFace, size: number, maxWidth: number): WinAnsiText[]` | Greedy wrap, then a one-word last line borrows the word before it, so a paragraph never ends on a lone word. |
| `wrapWords` | function | 164 | `function wrapWords(s: WinAnsiText, face: FontFace, size: number, maxWidth: number): WinAnsiText[]` | Word wrap that never breaks inside a word: one wider than the line is cut with an ellipsis instead. |

Imports: none

Imported by: `export/pdf.ts`

Tests that import it: `__tests__/export-pdf.test.ts`
<!-- /gen -->

### `server/src/export/slaReport.ts`

Builds the monthly SLA report as a document from the two derived reports of one month. Walked through in [Server: export](server-export.md).

<!-- gen:card server/src/export/slaReport.ts -->
591 lines, 11 exports. Imported by 5 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `DERIVED_SLA_BANNER` | constant | 18 | `const DERIVED_SLA_BANNER` | Copied from web/src/features/sla/Sli.tsx: the browser bundle cannot be imported here. |
| `WEB_AGING_NOTE` | constant | 19 | `const WEB_AGING_NOTE` |  |
| `WEB_KEPT_NOTE_BEFORE` | constant | 22 | `const WEB_KEPT_NOTE_BEFORE` | Around the date the figures of a closed month were taken, when they are kept (ADR 0016): copied from web/src/features/sla/Sli.tsx like the others. |
| `WEB_KEPT_NOTE_AFTER` | constant | 23 | `const WEB_KEPT_NOTE_AFTER` |  |
| `METHOD_NOTE` | constant | 24 | `const METHOD_NOTE` |  |
| `percentText` | function | 63 | `function percentText(value: number \| null, target: number, decimal: ReportStyle['decimal'] = 'dot'): string` | 98.996 rounds to 99.00 beside the word Missed, so more digits are printed until the text is on the real side of the target. |
| `durationText` | function | 75 | `function durationText(seconds: number): string` | The page's formatDuration rule (two largest units) with the units spelled apart: "2 d 3 h", "1 h 12 min", "45 min", "30 s". |
| `reportFileBase` | function | 91 | `const reportFileBase = (part: string) =>` | The one place a download name is made. |
| `coverageCell` | function | 112 | `const coverageCell = (c: number, style: ReportStyle): Cell =>` | The share of the period a device was measured, as the page writes it: a whole number, but never 100 below 100, as the figures are not (BK-83). |
| `reportFileBaseOf` | function | 227 | `const reportFileBaseOf = (r: SliReport): string =>` | The name a file of this report is given, before its extension: from the report's own dates and hours, so no request text reaches a header. |
| `buildSlaReportDoc` | function | 554 | `function buildSlaReportDoc(strict: SliReport, hcml: SliReport, now: Date = new Date(), style: ReportStyle =...` |  |

Imports: `core/reportChoices.ts`, `domain/naming.ts`, `export/types.ts`, `sli/engine.ts`

Imported by: `services/assistantSla.ts`, `services/assistantSnapshot.ts`, `services/sliExport.ts`, `services/sliMail.ts`, `sli/summary.ts`

Tests that import it: `__tests__/assistant-sla.test.ts`, `__tests__/export-pdf.test.ts`, `__tests__/export-sla-report-range.test.ts`, `__tests__/export-sla-report-style.test.ts`, `__tests__/export-sla-report.test.ts`, `__tests__/export-xlsx.test.ts`, `__tests__/mail-route.test.ts`, `__tests__/sli-fixes.test.ts`
<!-- /gen -->

### `server/src/export/theme.ts`

The portal's colours as plain numbers, for files that cannot read the stylesheet. Walked through in [Server: export](server-export.md), [Web app: the pages](web-features.md), [Web app: the stylesheet](web-styles.md).

<!-- gen:card server/src/export/theme.ts -->
95 lines, 6 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `PALETTE` | constant | 14 | `const PALETTE` | The portal's colours, for files that cannot read a stylesheet. |
| `PAPER` | constant | 43 | `const PAPER` | The report's own paper: white, light rows and solid lines, kept when the screen became a soft plane. |
| `TOKEN_OF` | constant | 47 | `const TOKEN_OF: Record<Exclude<keyof typeof PALETTE, PaperKey>, string>` | The CSS custom property each other PALETTE entry is copied from. |
| `ToneColours` | interface | 71 | `interface ToneColours` |  |
| `TONES` | constant | 83 | `const TONES: Record<Tone, ToneColours>` | How each tone is drawn, matching the portal's status pills. |
| `rgb` | function | 92 | `function rgb(hex: string): [number, number, number]` | `#rrggbb` to 0 to 255 channels. |

Imports: `export/types.ts`

Imported by: `export/pdf.ts`, `export/xlsx.ts`

Tests that import it: `__tests__/export-pdf.test.ts`, `__tests__/export-theme.test.ts`, `__tests__/export-xlsx.test.ts`
<!-- /gen -->

### `server/src/export/types.ts`

The report document model, shared by the PDF and Excel writers: tables, figures, bars and tones. Walked through in [Server: export](server-export.md).

<!-- gen:card server/src/export/types.ts -->
134 lines, 14 exports. Imported by 7 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Tone` | type | 11 | `type Tone = 'good' \| 'warn' \| 'bad' \| 'muted' \| 'none'` | Which of the portal's status colours a figure takes (theme.ts). |
| `ColumnKind` | type | 13 | `type ColumnKind = /** Words: a name, a site, a reason. Left aligned. */ \| 'text' /** An availability figure, 0 to...` |  |
| `Column` | interface | 25 | `interface Column` |  |
| `Cell` | interface | 35 | `interface Cell` |  |
| `Table` | interface | 50 | `interface Table` |  |
| `Kpi` | interface | 68 | `interface Kpi` |  |
| `Bar` | interface | 77 | `interface Bar` |  |
| `BarChart` | interface | 87 | `interface BarChart` | Horizontal bars against a target line. |
| `Note` | interface | 101 | `interface Note` |  |
| `ReportDoc` | interface | 106 | `interface ReportDoc` |  |
| `PDF_TYPE` | constant | 127 | `const PDF_TYPE` |  |
| `XLSX_TYPE` | constant | 128 | `const XLSX_TYPE` |  |
| `CSV_TYPE` | constant | 130 | `const CSV_TYPE` | The CSV files travel in one zip. |
| `NOTHING_TO_LIST` | constant | 134 | `const NOTHING_TO_LIST` | What a table with no rows says when it names nothing of its own. |

Imports: none

Imported by: `export/csv.ts`, `export/pdf.ts`, `export/slaReport.ts`, `export/theme.ts`, `export/xlsx.ts`, `services/sliExport.ts`, `services/sliMail.ts`

Tests that import it: `__tests__/export-csv.test.ts`, `__tests__/export-pdf.test.ts`, `__tests__/export-sla-report-style.test.ts`, `__tests__/export-sla-report.test.ts`, `__tests__/export-writers-agree.test.ts`, `__tests__/export-xlsx.test.ts`
<!-- /gen -->

### `server/src/export/xlsx.ts`

An Excel workbook writer built by hand, so no spreadsheet library is needed. Walked through in [Server: export](server-export.md).

<!-- gen:card server/src/export/xlsx.ts -->
824 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `buildXlsx` | function | 716 | `function buildXlsx(doc: ReportDoc, now: Date = new Date()): Buffer` |  |

Imports: `export/theme.ts`, `export/types.ts`, `export/zip.ts`

Imported by: `services/sliExport.ts`

Tests that import it: `__tests__/export-writers-agree.test.ts`, `__tests__/export-xlsx.test.ts`
<!-- /gen -->

### `server/src/export/zip.ts`

A minimal ZIP writer, enough to package an Excel workbook. Walked through in [Server: export](server-export.md).

<!-- gen:card server/src/export/zip.ts -->
100 lines, 2 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ZipEntry` | interface | 9 | `interface ZipEntry` |  |
| `zip` | function | 36 | `function zip(entries: ZipEntry[], now: Date = new Date()): Buffer` |  |

Imports: none

Packages: `node:zlib`

Imported by: `export/csv.ts`, `export/xlsx.ts`

Tests that import it: `__tests__/export-zip.test.ts`, `__tests__/validate-sli-script.test.ts`
<!-- /gen -->

## `server/src/http`

### `server/src/http/compress.ts`

Compresses JSON replies with brotli or gzip, chosen from the request, without a library. Walked through in [Server: live and assistant](server-live-and-assistant.md), [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/http/compress.ts -->
84 lines, 4 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `MIN_BYTES` | constant | 21 | `const MIN_BYTES = 1024` | Below this, headers and framing eat most of the saving. |
| `Encoding` | type | 23 | `type Encoding = 'br' \| 'gzip'` |  |
| `pickEncoding` | function | 30 | `function pickEncoding(header: string \| string[] \| undefined): Encoding \| null` | The encoding to answer an Accept-Encoding header with: the one the client weights higher, brotli on a tie, none if neither is acceptable. |
| `registerCompression` | function | 49 | `function registerCompression(app: FastifyInstance): void` | Register before the routes: a hook applies only to routes added after it. |

Imports: `core/acceptEncoding.ts`

Packages: `fastify`, `node:util`, `node:zlib`

Imported by: `index.ts`

Tests that import it: `__tests__/compress.test.ts`, `__tests__/export-route.test.ts`, `__tests__/stale-headers.test.ts`
<!-- /gen -->

### `server/src/http/errors.ts`

Maps every error to a reply and says in plain words when Zabbix cannot be read. Walked through in [Server: security and http](server-security-and-http.md), [Tests and checkers](tests-and-checkers.md).

<!-- gen:card server/src/http/errors.ts -->
145 lines, 2 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SOURCE_DOWN` | constant | 21 | `const SOURCE_DOWN` | What a screen is told when Zabbix cannot be read. |
| `registerErrorHandler` | function | 38 | `function registerErrorHandler(app: FastifyInstance): void` | Map the BFF's typed failures onto HTTP, in one response shape. |

Imports: `clients/ai.ts`, `clients/mail.ts`, `clients/zabbix.ts`, `core/gate.ts`, `core/schemas.ts`, `core/state.ts`, `core/validate.ts`, `security/requestStore.ts`, `security/userStore.ts`

Packages: `fastify`

Imported by: `index.ts`, `services/chat.ts`, `services/stream.ts`

Tests that import it: `__tests__/account-requests.test.ts`, `__tests__/ai-errors.test.ts`, `__tests__/ai-limits.test.ts`, `__tests__/auth-rules.test.ts`, `__tests__/auth.test.ts`, `__tests__/chat-route.test.ts`, `__tests__/download-log.test.ts`, `__tests__/email-without-auth.test.ts`, and 23 more
<!-- /gen -->

### `server/src/http/health.ts`

The public health and ready routes: whether the server runs, which build it is, and whether Zabbix and the model answer. Walked through in [Server: routes](server-routes.md), [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/http/health.ts -->
217 lines, 10 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `READY_TTL_MS` | constant | 17 | `const READY_TTL_MS = 15_000` | A check this old is fresh. |
| `READY_STALE_MS` | constant | 19 | `const READY_STALE_MS = 60_000` | Between TTL and this, the old answer goes out at once while a new check runs; past it, the caller waits. |
| `READY_TIMEOUT_MS` | constant | 21 | `const READY_TIMEOUT_MS = 2_000` | Each check gives up after this, so health never hangs on a stuck Zabbix. |
| `ZabbixState` | type | 23 | `type ZabbixState = 'ok' \| 'token_rejected' \| 'timeout' \| 'error'` |  |
| `ModelState` | type | 25 | `type ModelState = 'ok' \| 'down' \| 'missing' \| 'off' \| 'not_checked'` | `off` is no model configured; `missing` is a server that answers without `AI_MODEL` in its list; `not_checked` is hosted Anthropic, which a probe... |
| `Readiness` | interface | 27 | `interface Readiness` |  |
| `Probes` | interface | 38 | `interface Probes` |  |
| `ReadinessOptions` | interface | 89 | `interface ReadinessOptions` |  |
| `createReadiness` | function | 98 | `function createReadiness(opts: ReadinessOptions = {})` | The cached check. |
| `registerHealth` | function | 171 | `function registerHealth(app: FastifyInstance, readiness = createReadiness())` |  |

Imports: `clients/zabbix.ts`, `core/config.ts`, `core/logFile.ts`, `security/auth.ts`, `services/stream.ts`

Packages: `fastify`, `node:fs`

Imported by: `index.ts`

Tests that import it: `__tests__/ai-notice.test.ts`, `__tests__/health-log.test.ts`, `__tests__/health-timezone.test.ts`, `__tests__/health.test.ts`, `__tests__/openapi-contract.test.ts`
<!-- /gen -->

### `server/src/http/hostCheck.ts`

With sign-in off, answers only to a Host header that names this machine. Walked through in [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/http/hostCheck.ts -->
46 lines, 3 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `hostnameOf` | function | 16 | `function hostnameOf(header: string \| undefined): string \| null` | The name inside a Host header: no port, no brackets, lower case. |
| `hostAllowed` | function | 32 | `function hostAllowed(header: string \| undefined, webOrigin: string = config.webOrigin): boolean` | Whether a Host header is localhost, 127.0.0.1, ::1 or the WEB_ORIGIN host, whatever the port. |
| `registerHostCheck` | function | 38 | `function registerHostCheck(app: FastifyInstance): void` | Register before CORS and the routes, so nothing answers a request that is refused here. |

Imports: `core/config.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/write-gate.test.ts`
<!-- /gen -->

### `server/src/http/logging.ts`

Keeps a token out of the request log line. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card server/src/http/logging.ts -->
29 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `redactUrl` | function | 10 | `function redactUrl(url: string): string` | The URL with every `token` query value replaced by `[redacted]`. |
| `serializeRequest` | function | 20 | `function serializeRequest(req: FastifyRequest)` | Fastify's default `req` log serializer, field for field, except that the URL goes through `redactUrl`. |

Imports: none

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/logging.test.ts`
<!-- /gen -->

### `server/src/http/noStore.ts`

Marks every API reply except the health check as not to be stored by a browser or proxy. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card server/src/http/noStore.ts -->
28 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `askedPath` | function | 11 | `function askedPath(url: string): string` | The path a client asked for: the host of an absolute-form request line and the query cut off, the escapes decoded, so `/%61pi/problems` counts as... |
| `registerNoStore` | function | 20 | `function registerNoStore(app: FastifyInstance): void` |  |

Imports: none

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/no-store.test.ts`
<!-- /gen -->

### `server/src/http/rateLimit.ts`

The per-address request limit, counted before sign-in is checked. Walked through in [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/http/rateLimit.ts -->
35 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `registerRateLimit` | function | 20 | `async function registerRateLimit(app: FastifyInstance, max = config.rateLimitPerMinute): Promise<void>` | Rate limiting, ahead of the auth guard: call it before setupAuth. |

Imports: `core/config.ts`

Packages: `@fastify/rate-limit`, `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/ai-limits.test.ts`, `__tests__/auth.test.ts`, `__tests__/export-route.test.ts`
<!-- /gen -->

### `server/src/http/requestId.ts`

Gives every request one id, from nginx or newly made, and puts it in the reply and in every error body. Walked through in [One request, from start to finish](one-request.md), [Server: live and assistant](server-live-and-assistant.md), [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/http/requestId.ts -->
41 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `genReqId` | function | 21 | `function genReqId(req: Pick<IncomingMessage, 'headers'>): string` | Fastify's `genReqId`. |
| `registerRequestId` | function | 30 | `function registerRequestId(app: FastifyInstance): void` | Put the id on every reply, and in every error body. |

Imports: none

Packages: `fastify`, `node:crypto`, `node:http`

Imported by: `index.ts`

Tests that import it: `__tests__/chat-route.test.ts`, `__tests__/plain-wording.test.ts`, `__tests__/request-id.test.ts`, `__tests__/source-down.test.ts`, `__tests__/stream.test.ts`
<!-- /gen -->

### `server/src/http/shutdown.ts`

Closes the server cleanly on a stop signal, inside the ten seconds Docker allows. Walked through in [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/http/shutdown.ts -->
116 lines, 6 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SHUTDOWN_TIMEOUT_MS` | constant | 8 | `const SHUTDOWN_TIMEOUT_MS = 8_000` | Under the 10 s Docker waits before it kills the container. |
| `ShutdownOptions` | interface | 15 | `interface ShutdownOptions` |  |
| `Closable` | interface | 24 | `interface Closable` | What the monthly schedule gives a close: stop its timers when the close begins, then wait for a send that is running. |
| `closeWith` | function | 33 | `function closeWith(app: FastifyInstance, schedule: Closable): void` | Fastify drains the requests in flight before it runs the `onClose` hooks, and the limit above counts from the signal. |
| `installShutdown` | function | 39 | `function installShutdown(app: FastifyInstance, opts: ShutdownOptions = {}): () => void` | Returns the function that takes the handlers off again. |
| `installCrashLog` | function | 93 | `function installCrashLog(app: Pick<FastifyInstance, 'log'>, opts: { source?: CrashSource; exit?: (code: number) =>...` | Write what crashed to the log, and so to the file of SC-42, before the process dies: Node's own report goes to stderr, which a rebuild deletes... |

Imports: none

Packages: `fastify`, `node:util`

Imported by: `index.ts`

Tests that import it: `__tests__/shutdown.test.ts`
<!-- /gen -->

## `server/src/routes`

### `server/src/routes/accountRequests.ts`

The five routes for requests for an account (FR-62): the two public ones of the sign-in page and the three of an administrator. The limits are in the service.

<!-- gen:card server/src/routes/accountRequests.ts -->
63 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `accountRequestRoutes` | function | 19 | `async function accountRequestRoutes(app: FastifyInstance): Promise<void>` | Requests for an account (FR-62). |

Endpoints: `GET /api/auth/request`, `POST /api/auth/request`, `GET /api/users/requests`, `POST /api/users/requests/:id/approve`, `POST /api/users/requests/:id/refuse`

Imports: `core/config.ts`, `core/schemas.ts`, `security/accounts.ts`, `security/audit.ts`, `services/accountRequests.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/account-requests.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/surface.test.ts`, `__tests__/users-without-auth.test.ts`

Tests that call its endpoints: `__tests__/account-requests.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/surface.test.ts`, `__tests__/users-without-auth.test.ts`
<!-- /gen -->

### `server/src/routes/actions.ts`

Acknowledge and close: the portal's only write, for operators and admins. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/actions.ts -->
148 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `actionRoutes` | function | 30 | `async function actionRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `POST /api/problems/acknowledge`

Imports: `clients/zabbix.ts`, `core/cache.ts`, `core/config.ts`, `core/schemas.ts`, `core/validate.ts`, `security/actionLimit.ts`, `services/actions.ts`, `services/stream.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/action-limit.test.ts`, `__tests__/api-hygiene.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/request-schemas.test.ts`, `__tests__/routes.test.ts`, `__tests__/surface.test.ts`, `__tests__/write-audit.test.ts`, `__tests__/write-gate.test.ts`

Tests that call its endpoints: `__tests__/action-limit.test.ts`, `__tests__/api-hygiene.test.ts`, `__tests__/auth-rules.test.ts`, `__tests__/auth.test.ts`, `__tests__/nginx-conf.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/request-schemas.test.ts`, `__tests__/routes.test.ts`, and 4 more
<!-- /gen -->

### `server/src/routes/analytics.ts`

The four heavy reports: availability, alert noise, ageing and capacity. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/analytics.ts -->
48 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `analyticsRoutes` | function | 16 | `async function analyticsRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/reports/availability`, `GET /api/reports/noise`, `GET /api/reports/aging`, `GET /api/reports/capacity`

Imports: `core/config.ts`, `core/readerGone.ts`, `core/schemas.ts`, `core/validate.ts`, `security/heavyLimit.ts`, `services/aging.ts`, `services/availability.ts`, `services/capacity.ts`, `services/noise.ts`, `services/sli.ts`, `sli/time.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/heavy-limit.test.ts`, `__tests__/heavy-reports.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/sli-limit.test.ts`, `__tests__/sli-routes.test.ts`, `__tests__/stale-headers.test.ts`, `__tests__/surface.test.ts`, and 1 more

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/heavy-limit.test.ts`, `__tests__/heavy-reports.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/page-access.test.ts`, `__tests__/routes.test.ts`, `__tests__/sli-limit.test.ts`, `__tests__/sli-routes.test.ts`, and 2 more
<!-- /gen -->

### `server/src/routes/chat.ts`

The Assistant's streamed answer and its warm-up call. A route module: it checks what the caller sent and calls a service. Walked through in [Server: the core and the clients](server-core-and-clients.md), [Server: live and assistant](server-live-and-assistant.md), [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/chat.ts -->
167 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `chatRoutes` | function | 13 | `async function chatRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/chat/warm`, `POST /api/chat`

Imports: `clients/ai.ts`, `clients/limits.ts`, `clients/zabbix.ts`, `core/config.ts`, `core/schemas.ts`, `security/audit.ts`, `security/auth.ts`, `security/heavyLimit.ts`, `services/assistant.ts`, `services/chat.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/ai-limits.test.ts`, `__tests__/chat-route.test.ts`, `__tests__/chat.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/request-schemas.test.ts`, `__tests__/surface.test.ts`, `__tests__/usage-log.test.ts`

Tests that call its endpoints: `__tests__/ai-limits.test.ts`, `__tests__/ai.test.ts`, `__tests__/auth-rules.test.ts`, `__tests__/chat-route.test.ts`, `__tests__/model-speed.test.ts`, `__tests__/page-routes.test.ts`, `__tests__/request-schemas.test.ts`, `__tests__/usage-log.test.ts`
<!-- /gen -->

### `server/src/routes/devices.ts`

The device list: every host as a device of one kind. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/devices.ts -->
6 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `deviceRoutes` | function | 4 | `async function deviceRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/devices`

Imports: `services/devices.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/devices-route.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/surface.test.ts`

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/devices-route.test.ts`
<!-- /gen -->

### `server/src/routes/explain.ts`

The plain-language explanation of a problem and of an SLA figure. A route module: it checks what the caller sent and calls a service. Walked through in [Server: the core and the clients](server-core-and-clients.md), [Server: live and assistant](server-live-and-assistant.md), [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/explain.ts -->
67 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `explainRoutes` | function | 19 | `async function explainRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/explain/problem`, `GET /api/explain/sla`

Imports: `clients/ai.ts`, `clients/limits.ts`, `core/config.ts`, `core/readerGone.ts`, `core/schemas.ts`, `core/validate.ts`, `security/audit.ts`, `security/auth.ts`, `security/heavyLimit.ts`, `services/explain.ts`, `services/sli.ts`, `sli/time.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/ai-limits.test.ts`, `__tests__/explain-route-signal.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/sli-routes.test.ts`, `__tests__/surface.test.ts`, `__tests__/usage-log-sla.test.ts`, `__tests__/usage-log.test.ts`

Tests that call its endpoints: `__tests__/ai-limits.test.ts`, `__tests__/auth-rules.test.ts`, `__tests__/explain-access.test.ts`, `__tests__/explain-route-signal.test.ts`, `__tests__/nginx-conf.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/sli-routes.test.ts`, `__tests__/usage-log-sla.test.ts`, and 1 more
<!-- /gen -->

### `server/src/routes/history.ts`

The graph route: chart-ready series for one to four items. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/history.ts -->
21 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `historyRoutes` | function | 9 | `async function historyRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/graph`

Imports: `core/schemas.ts`, `core/validate.ts`, `security/viewerPolicy.ts`, `services/history.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/graphs.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/surface.test.ts`, `__tests__/viewer-network-ids.test.ts`

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/graphs.test.ts`, `__tests__/logging.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/viewer-network-ids.test.ts`
<!-- /gen -->

### `server/src/routes/hosts.ts`

Hosts, the hosts overview, host groups, a host's items and the latest data. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/hosts.ts -->
83 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `hostRoutes` | function | 19 | `async function hostRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/hosts`, `GET /api/hosts/overview`, `GET /api/hostgroups`, `GET /api/items`, `GET /api/latest`

Imports: `core/schemas.ts`, `core/validate.ts`, `security/searchLimit.ts`, `security/viewerPolicy.ts`, `services/hosts.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/devices-route.test.ts`, `__tests__/graphs.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/search-limit.test.ts`, `__tests__/surface.test.ts`, `__tests__/viewer-network.test.ts`

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/auth-sessions.test.ts`, `__tests__/auth.test.ts`, `__tests__/devices-route.test.ts`, `__tests__/graphs.test.ts`, `__tests__/nginx-conf.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, and 3 more
<!-- /gen -->

### `server/src/routes/inventory.ts`

The inventory and ownership scorecard. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/inventory.ts -->
7 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `inventoryRoutes` | function | 5 | `async function inventoryRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/reports/inventory`

Imports: `core/cache.ts`, `services/inventory.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/surface.test.ts`

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/auth-sessions.test.ts`, `__tests__/auth.test.ts`, `__tests__/routes.test.ts`, `__tests__/surface.test.ts`
<!-- /gen -->

### `server/src/routes/links.ts`

Link and WAN health. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/links.ts -->
6 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `linkRoutes` | function | 4 | `async function linkRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/links`

Imports: `services/links.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/sli-routes.test.ts`, `__tests__/surface.test.ts`

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/auth-sessions.test.ts`, `__tests__/auth-users.test.ts`, `__tests__/auth.test.ts`, `__tests__/handover-check.test.ts`, `__tests__/routes.test.ts`, `__tests__/sli-routes.test.ts`, `__tests__/surface.test.ts`
<!-- /gen -->

### `server/src/routes/maps.ts`

The list of Zabbix maps and the detail of one. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/maps.ts -->
18 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `mapRoutes` | function | 8 | `async function mapRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/maps`, `GET /api/maps/detail`

Imports: `core/config.ts`, `core/schemas.ts`, `core/validate.ts`, `security/viewerPolicy.ts`, `services/maps.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/surface.test.ts`, `__tests__/viewer-network.test.ts`

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/viewer-network.test.ts`
<!-- /gen -->

### `server/src/routes/meters.ts`

The internet traffic meters. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/meters.ts -->
7 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `meterRoutes` | function | 4 | `async function meterRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/net/meters`

Imports: `services/meters.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/meters-route.test.ts`, `__tests__/meters.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/surface.test.ts`

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/meters-route.test.ts`, `__tests__/surface.test.ts`
<!-- /gen -->

### `server/src/routes/net.ts`

Network devices and their interfaces. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/net.ts -->
30 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `netRoutes` | function | 13 | `async function netRoutes(app: FastifyInstance): Promise<void>` | Network monitoring (setup.md §10). |

Endpoints: `GET /api/net/devices`, `GET /api/net/interfaces`

Imports: `core/schemas.ts`, `core/validate.ts`, `services/net.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/graphs.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/surface.test.ts`

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/graphs.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/surface.test.ts`
<!-- /gen -->

### `server/src/routes/problems.ts`

The current problem list. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md), [Web app: the API client, the types and the guards](web-api-types-guards.md).

<!-- gen:card server/src/routes/problems.ts -->
7 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `problemRoutes` | function | 4 | `async function problemRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/problems`

Imports: `domain/queries.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/surface.test.ts`

Tests that call its endpoints: `__tests__/action-limit.test.ts`, `__tests__/api-hygiene.test.ts`, `__tests__/auth-rules.test.ts`, `__tests__/auth.test.ts`, `__tests__/logging.test.ts`, `__tests__/nginx-conf.test.ts`, `__tests__/no-store.test.ts`, `__tests__/openapi-contract.test.ts`, and 6 more
<!-- /gen -->

### `server/src/routes/reports.ts`

The Dashboard's counts, how fresh the data is, problems by group and the top triggers. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/reports.ts -->
15 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `reportRoutes` | function | 8 | `async function reportRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/reports/top-triggers`, `GET /api/stats`, `GET /api/freshness`, `GET /api/reports/problems-by-group`

Imports: `core/readerGone.ts`, `core/schemas.ts`, `core/validate.ts`, `security/heavyLimit.ts`, `services/reports.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/freshness.test.ts`, `__tests__/heavy-limit.test.ts`, `__tests__/heavy-reports.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/surface.test.ts`, `__tests__/viewer-reports-load.test.ts`

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/auth-sessions.test.ts`, `__tests__/freshness.test.ts`, `__tests__/heavy-limit.test.ts`, `__tests__/heavy-reports.test.ts`, `__tests__/routes.test.ts`, `__tests__/viewer-reports-load.test.ts`
<!-- /gen -->

### `server/src/routes/services.ts`

The service tree, from Zabbix and derived from the estate. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/services.ts -->
21 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `serviceRoutes` | function | 11 | `async function serviceRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/services`, `GET /api/services/derived`

Imports: `core/config.ts`, `core/readerGone.ts`, `core/schemas.ts`, `security/heavyLimit.ts`, `services/services.ts`, `services/sli.ts`, `sli/time.ts`, `sli/tree.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/sli-limit.test.ts`, `__tests__/sli-routes.test.ts`, `__tests__/surface.test.ts`

Tests that call its endpoints: `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/sli-limit.test.ts`, `__tests__/sli-routes.test.ts`
<!-- /gen -->

### `server/src/routes/sites.ts`

The site view. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/sites.ts -->
6 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `siteRoutes` | function | 4 | `async function siteRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/sites`

Imports: `services/sites.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/surface.test.ts`

Tests that call its endpoints: `__tests__/routes.test.ts`
<!-- /gen -->

### `server/src/routes/sla.ts`

Zabbix's own SLA objects and their figures. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/sla.ts -->
23 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `slaRoutes` | function | 7 | `async function slaRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/sla/source`, `GET /api/sla`, `GET /api/sla/sli`

Imports: `core/cache.ts`, `core/schemas.ts`, `core/validate.ts`, `services/sla.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/api-hygiene.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/sli-routes.test.ts`, `__tests__/surface.test.ts`

Tests that call its endpoints: `__tests__/api-hygiene.test.ts`, `__tests__/auth-rules.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/routes.test.ts`, `__tests__/sli-routes.test.ts`, `__tests__/users-routes.test.ts`
<!-- /gen -->

### `server/src/routes/sli.ts`

The derived monthly SLA. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/sli.ts -->
14 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `sliRoutes` | function | 8 | `async function sliRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/sli`

Imports: `core/readerGone.ts`, `core/schemas.ts`, `security/heavyLimit.ts`, `services/sli.ts`, `services/sliAsk.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/heavy-reports.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/sli-limit.test.ts`, `__tests__/sli-range-route.test.ts`, `__tests__/sli-routes.test.ts`, `__tests__/stale-headers.test.ts`, `__tests__/surface.test.ts`

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/download-log.test.ts`, `__tests__/email-without-auth.test.ts`, `__tests__/export-route.test.ts`, `__tests__/heavy-reports.test.ts`, `__tests__/live-tools-months.test.ts`, `__tests__/mail-route.test.ts`, `__tests__/no-store.test.ts`, and 10 more
<!-- /gen -->

### `server/src/routes/sliExport.ts`

The derived monthly SLA as a PDF, an Excel file or a zip of CSV files. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/sliExport.ts -->
42 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `sliExportRoutes` | function | 13 | `async function sliExportRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/sli/export`

Imports: `core/readerGone.ts`, `core/schemas.ts`, `core/validate.ts`, `security/audit.ts`, `security/heavyLimit.ts`, `services/sliAsk.ts`, `services/sliExport.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/auth-rules.test.ts`, `__tests__/download-log.test.ts`, `__tests__/export-route.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/sli-limit.test.ts`, `__tests__/surface.test.ts`

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/download-log.test.ts`, `__tests__/export-route.test.ts`, `__tests__/no-store.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/page-routes.test.ts`, `__tests__/sli-limit.test.ts`
<!-- /gen -->

### `server/src/routes/sliMail.ts`

The two routes for emailing the report. The GET tells the page whether to offer the button and to whom the report would go. The POST checks the body, the settings, the month, the format and the allowance, in that order, and only then sends and writes the log line. Only the month and the format may be in the body: the recipients come from the settings alone.

<!-- gen:card server/src/routes/sliMail.ts -->
160 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `sliMailRoutes` | function | 30 | `async function sliMailRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/sli/email`, `PUT /api/sli/recipients`, `DELETE /api/sli/recipients`, `POST /api/sli/email`

Imports: `clients/mail.ts`, `core/config.ts`, `core/mailConfig.ts`, `core/recipients.ts`, `core/schemas.ts`, `core/validate.ts`, `security/audit.ts`, `security/mailLimit.ts`, `services/mailState.ts`, `services/portalState.ts`, `services/sliAsk.ts`, `services/sliExport.ts`, `services/sliMail.ts`, `sli/schedule.ts`, `sli/time.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/email-without-auth.test.ts`, `__tests__/mail-route.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/surface.test.ts`

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/email-without-auth.test.ts`, `__tests__/mail-route.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/surface.test.ts`
<!-- /gen -->

### `server/src/routes/sliSchedule.ts`

The two routes for the monthly send, for administrators: one reads the schedule, when it goes next and what was sent, and one sets it together with the saved recipients. It checks every field before anything is saved, holds both lists of addresses to the allowed domains, and refuses to save where the schedule cannot run. A month still being tried when the day, the time or the switch changes is given up on in its record.

<!-- gen:card server/src/routes/sliSchedule.ts -->
118 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `sliScheduleRoutes` | function | 30 | `async function sliScheduleRoutes(app: FastifyInstance, options: ScheduleRouteOptions): Promise<void>` |  |

Endpoints: `GET /api/sli/schedule`, `PUT /api/sli/schedule`

Imports: `core/config.ts`, `core/mailConfig.ts`, `core/recipients.ts`, `core/schemas.ts`, `core/state.ts`, `core/validate.ts`, `security/audit.ts`, `services/mailState.ts`, `services/portalState.ts`, `services/reportSchedule.ts`, `services/sliExport.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/email-without-auth.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/schedule-route.test.ts`, `__tests__/surface.test.ts`

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/email-without-auth.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/schedule-route.test.ts`, `__tests__/surface.test.ts`
<!-- /gen -->

### `server/src/routes/stream.ts`

The live problem stream, as server-sent events. A route module: it checks what the caller sent and calls a service. Walked through in [Server: live and assistant](server-live-and-assistant.md), [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/stream.ts -->
53 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `streamRoutes` | function | 7 | `async function streamRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/stream`

Imports: `core/acceptEncoding.ts`, `security/accounts.ts`, `security/auth.ts`, `services/stream.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/openapi-contract.test.ts`, `__tests__/shutdown.test.ts`, `__tests__/stream-account-change.test.ts`, `__tests__/stream-signout.test.ts`, `__tests__/stream.test.ts`, `__tests__/surface.test.ts`

Tests that call its endpoints: `__tests__/auth.test.ts`, `__tests__/logging.test.ts`, `__tests__/nginx-conf.test.ts`, `__tests__/no-store.test.ts`, `__tests__/page-routes.test.ts`, `__tests__/shutdown.test.ts`, `__tests__/stream-account-change.test.ts`, `__tests__/stream-signout.test.ts`, and 1 more
<!-- /gen -->

### `server/src/routes/topHosts.ts`

The busiest hosts by processor and memory. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/topHosts.ts -->
12 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `topHostRoutes` | function | 6 | `async function topHostRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/reports/top-hosts`

Imports: `core/schemas.ts`, `core/validate.ts`, `services/topHosts.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/openapi-contract.test.ts`, `__tests__/surface.test.ts`, `__tests__/top-hosts-route.test.ts`, `__tests__/viewer-reports-load.test.ts`

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/top-hosts-route.test.ts`, `__tests__/viewer-reports-load.test.ts`
<!-- /gen -->

### `server/src/routes/users.ts`

The Users routes for administrators: the list, a new user, a change and a password reset, each change written to the log. Walked through in [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/routes/users.ts -->
52 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `usersRoutes` | function | 18 | `async function usersRoutes(app: FastifyInstance): Promise<void>` | The users, for an administrator (ADR-0017). |

Endpoints: `GET /api/users`, `POST /api/users`, `PATCH /api/users/:name`, `POST /api/users/:name/password`

Imports: `core/config.ts`, `core/schemas.ts`, `security/accounts.ts`, `security/audit.ts`, `services/users.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/account-requests.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/surface.test.ts`, `__tests__/users-routes.test.ts`, `__tests__/users-without-auth.test.ts`

Tests that call its endpoints: `__tests__/account-requests.test.ts`, `__tests__/auth-rules.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/surface.test.ts`, `__tests__/users-routes.test.ts`, `__tests__/users-without-auth.test.ts`
<!-- /gen -->

### `server/src/routes/webMonitoring.ts`

Web scenarios counted as OK, failed or unknown. A route module: it checks what the caller sent and calls a service. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/routes/webMonitoring.ts -->
12 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `webMonitoringRoutes` | function | 6 | `async function webMonitoringRoutes(app: FastifyInstance): Promise<void>` |  |

Endpoints: `GET /api/reports/web-monitoring`

Imports: `core/schemas.ts`, `core/validate.ts`, `services/webMonitoring.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/openapi-contract.test.ts`, `__tests__/surface.test.ts`, `__tests__/viewer-reports-load.test.ts`, `__tests__/web-monitoring-route.test.ts`

Tests that call its endpoints: `__tests__/auth-rules.test.ts`, `__tests__/viewer-reports-load.test.ts`, `__tests__/web-monitoring-route.test.ts`
<!-- /gen -->

## `server/src/security`

### `server/src/security/accounts.ts`

The directory of people who can sign in, from `.env` and from the users file, and every change to a user: add, edit, disable, reset, one's own password and the seed. Walked through in [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/security/accounts.ts -->
527 lines, 17 exports. Imported by 7 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `UserError` | class | 14 | `class UserError extends Error` | A refusal of a change to a user, which the error handler sends as it is: a status, a code and a sentence. |
| `EnvUser` | interface | 28 | `interface EnvUser` | One entry of `PORTAL_USERS`, or the single administrator of `PORTAL_USER` and `PORTAL_PASS`. |
| `sameName` | function | 39 | `const sameName = (a: string, b: string) =>` | Sign-in compares names without regard to case; the name as written is kept. |
| `parseEnvUsers` | function | 58 | `function parseEnvUsers(raw: string, warn: (m: string) => void): EnvUser[]` | The valid `PORTAL_USERS` triples. |
| `readEnvUsers` | function | 89 | `function readEnvUsers(warn: (m: string) => void = () => undefined): EnvUser[]` | The users of `.env`: `PORTAL_USERS` as `name:password:role` triples, comma-separated, or the single administrator of `PORTAL_USER` and `PORTAL_PASS`. |
| `Account` | interface | 102 | `interface Account` | A user as the rest of the portal sees them, from the file or from `.env`. |
| `accessOfAccount` | function | 159 | `const accessOfAccount = (a: Account): Access =>` |  |
| `usable` | function | 162 | `const usable = (a: Account, nowSeconds: number): boolean =>` | Whether the account may sign in, or keep a session, at `nowSeconds`: not disabled, and not past its expiry. |
| `UserView` | interface | 165 | `interface UserView` | What the Users page is told about a user: everything but the hash. |
| `viewOf` | function | 182 | `function viewOf(a: Account): UserView` |  |
| `NewUser` | interface | 200 | `interface NewUser` |  |
| `UserPatch` | interface | 213 | `interface UserPatch` |  |
| `onAccountChange` | function | 227 | `function onAccountChange(listener: (name: string) => void): () => void` | Call `listener` with the name of each person whose live screens should end because their account changed (SC-57). |
| `adminWarning` | function | 245 | `function adminWarning(directory: Directory, now: number = nowSeconds()): string \| null` | A warning for the log when no one can open the Users page: no entry of `.env` is an administrator and the file holds no enabled one. |
| `legacyHashWarning` | function | 255 | `function legacyHashWarning(users: readonly EnvUser[]): string \| null` | The advice for users of `.env` whose password is a hash older than the portal's own: refusing a wrong password takes longer for them than for any... |
| `Directory` | interface | 264 | `interface Directory` |  |
| `createDirectory` | function | 285 | `function createDirectory(env: EnvUser[], store: UserStore = noUsers()): Directory` | The directory of `.env`'s users and a store's. |

Imports: `core/config.ts`, `security/modules.ts`, `security/passwords.ts`, `security/userStore.ts`

Packages: `node:crypto`

Imported by: `routes/accountRequests.ts`, `routes/stream.ts`, `routes/users.ts`, `security/auth.ts`, `services/accountRequests.ts`, `services/userDirectory.ts`, `services/users.ts`

Tests that import it: `__tests__/account-requests.test.ts`, `__tests__/accounts-races.test.ts`, `__tests__/accounts.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/stream-account-change.test.ts`, `__tests__/users-routes.test.ts`, `__tests__/users-without-auth.test.ts`
<!-- /gen -->

### `server/src/security/actionLimit.ts`

Holds one person to a number of acknowledged or closed problems a minute, counted by event id and not by request, so a script that sends fifty at a time is held as much as one that sends one at a time. It is asked last, once a request will be written, so a refusal costs no allowance, and it keeps its counts in memory (SC-51).

<!-- gen:card server/src/security/actionLimit.ts -->
23 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `takeEvents` | function | 13 | `function takeEvents(req: FastifyRequest, events: number): number \| null` | Count `events` for the person who asked: null when they may go ahead, else the seconds until their minute is over. |
| `limitMessage` | function | 22 | `const limitMessage = (wait: number): string =>` |  |

Imports: `clients/limits.ts`, `core/config.ts`

Packages: `fastify`

Imported by: `routes/actions.ts`

Tests that import it: none
<!-- /gen -->

### `server/src/security/audit.ts`

Who used what: one log line for each use of the AI and each report downloaded, and the name of whoever is acting. Walked through in [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/security/audit.ts -->
123 lines, 11 exports. Imported by 10 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `actor` | function | 13 | `function actor(req: FastifyRequest): string` | Who is acting, for the log and the message tag. |
| `AiOutcome` | type | 19 | `type AiOutcome = 'answered' \| 'not_found' \| 'failed' \| 'aborted'` |  |
| `aiUse` | function | 25 | `function aiUse(req: FastifyRequest, kind: AiKind)` | One use of the AI, charged to the daily budget as it finishes and logged once when it ends. |
| `PeriodLog` | interface | 60 | `interface PeriodLog` | What period a report was for: a month, or two times and the hours of the day that counted (services/sliAsk.ts askForLog). |
| `auditDownload` | function | 69 | `function auditDownload(req: FastifyRequest, report: PeriodLog & { report: string; format: string; bytes: number }): void` | One report taken: who, what and how large. |
| `EmailAudit` | interface | 73 | `interface EmailAudit extends PeriodLog` |  |
| `logEmail` | function | 95 | `function logEmail(log: LineLog, user: string, report: EmailAudit, ip?: string): void` | One report mailed, by the schedule or by someone: what, to how many people and how it ended. |
| `logSkipped` | function | 104 | `function logSkipped(log: LineLog, user: string, report: Omit<EmailAudit, 'outcome'>): void` | A month the monthly schedule passed by with no send tried, usually because the portal was not running: it is not a failed send (BK-55). |
| `auditEmail` | function | 108 | `function auditEmail(req: FastifyRequest, report: EmailAudit): void` |  |
| `auditRequest` | function | 116 | `function auditRequest(req: FastifyRequest, action: 'received' \| 'ignored' \| 'approved' \| 'refused', target: string):...` | One step of a request for an account (FR-62): received from an address, kept or dropped as a copy, then approved or refused by an administrator. |
| `auditUser` | function | 121 | `function auditUser(req: FastifyRequest, action: string, target: string, detail: Record<string, unknown> = {}): void` | One change to a user: who did what to whom, from which address. |

Imports: `clients/ai.ts`, `clients/limits.ts`, `core/config.ts`, `core/gate.ts`

Packages: `fastify`

Imported by: `routes/accountRequests.ts`, `routes/chat.ts`, `routes/explain.ts`, `routes/sliExport.ts`, `routes/sliMail.ts`, `routes/sliSchedule.ts`, `routes/users.ts`, `security/auth.ts`, `services/actions.ts`, `services/reportSchedule.ts`

Tests that import it: `__tests__/ai-outside-usage.test.ts`, `__tests__/explain-reader-left.test.ts`, `__tests__/usage-log.test.ts`
<!-- /gen -->

### `server/src/security/auth.ts`

Sign-in and sign-out, the session cookie, the cross-site check, the role guard on every route, and the sign-in limits. Walked through in [One request, from start to finish](one-request.md), [Server: routes](server-routes.md), [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/security/auth.ts -->
574 lines, 24 exports, 5 re-exports. Imported by 6 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ROLES` | re-export | 23 | `from './modules.js'` |  |
| `isRole` | re-export | 23 | `from './modules.js'` |  |
| `roleAllows` | re-export | 23 | `from './modules.js'` |  |
| `Role` | re-export | 23 | `from './modules.js'` |  |
| `parseEnvUsers` | re-export | 24 | `from './accounts.js'` |  |
| `requiredRole` | function | 27 | `function requiredRole(url: string): Role` | The role a route needs: the role of its row in the table of routes, and administrator for a route that has none (modules.ts). |
| `PUBLIC_ROUTES` | constant | 32 | `const PUBLIC_ROUTES = new Set(['/api/health', '/api/auth/login', '/api/auth/me', '/api/auth/logout'...` | Reachable without a token. |
| `CSRF_HEADER` | constant | 39 | `const CSRF_HEADER` | The header every cookie-authenticated POST must carry. |
| `LOGIN_ATTEMPTS_PER_MINUTE` | constant | 47 | `const LOGIN_ATTEMPTS_PER_MINUTE = 10` | Sign-in attempts per minute per account and client address, on top of the global limit. |
| `LOGIN_BODY_LIMIT` | constant | 53 | `const LOGIN_BODY_LIMIT = 4096` | A name and a password fit in 4 KB. |
| `LOGIN_LOCK_AFTER` | constant | 61 | `const LOGIN_LOCK_AFTER = 10` | Backoff after failed sign-ins: from this many failures in a row for one account and address, sign-in is locked for a minute, doubling with each... |
| `LOGIN_LOCK_BASE_MS` | constant | 62 | `const LOGIN_LOCK_BASE_MS = 60_000` |  |
| `LOGIN_LOCK_MAX_MS` | constant | 63 | `const LOGIN_LOCK_MAX_MS = 5 * 60_000` |  |
| `SPRAY_FAILURES` | constant | 73 | `const SPRAY_FAILURES = 30` | A password spray: one common password tried once against each of many names, which the lock of each name never sees (SC-61). |
| `SPRAY_NAMES` | constant | 74 | `const SPRAY_NAMES = 10` |  |
| `tokenLifetime` | function | 81 | `const tokenLifetime = (): string =>` | How long one token lasts: SESSION_HOURS, twelve unless set. |
| `tokenClaims` | function | 88 | `const tokenClaims = (cookieName: string) =>` | The issuer and audience every token carries and every request is checked against. |
| `LOGIN_WARN_AFTER` | constant | 96 | `const LOGIN_WARN_AFTER = 5` |  |
| `csrfRefusal` | function | 124 | `function csrfRefusal(req: FastifyRequest, cookieName: string): string \| null` | Why an unsafe request is refused as a possible cross-site forgery, or null when it may go on. |
| `routeOf` | function | 142 | `function routeOf(req: FastifyRequest): string` | The route to judge a request by. |
| `assertUsers` | function | 158 | `function assertUsers(warn: (message: string) => void = () => undefined): void` | Refuse to start with a password anyone can guess: empty (what copying .env.example gave) or the built-in "admin", and a plain password under... |
| `roleOf` | function | 199 | `function roleOf(req: FastifyRequest): Role` | The role attached to a request. |
| `modulesOf` | function | 205 | `function modulesOf(req: FastifyRequest): ReadonlySet<ModuleId>` | The modules of the user of a request, as the guard found them. |
| `languageOf` | function | 212 | `function languageOf(req: FastifyRequest): 'en' \| 'id' \| null` | The language the user chose for the Assistant and Explain, or null. |
| `hasModule` | function | 218 | `const hasModule = (req: FastifyRequest, ...ids: ModuleId[]): boolean =>` | Whether the user of a request holds one of these modules: an administrator holds all. |
| `sessionIdOf` | function | 224 | `function sessionIdOf(claims: unknown): string \| undefined` | The session a token belongs to: its sid, else its jti (tokens from before sessions had one), else a hash of what it says. |
| `onSignOut` | function | 234 | `function onSignOut(listener: (session: string) => void): () => void` | Call `listener` with the id of each session that signs out. |
| `isSignedIn` | function | 247 | `const isSignedIn = (req: FastifyRequest): boolean =>` | Whether the caller of a public route is signed in, for GET /api/health to show more to them. |
| `setupAuth` | function | 253 | `async function setupAuth(app: FastifyInstance, directory: Directory = createDirectory(readEnvUsers((m) =>...` | `directory` is who can sign in. |

Imports: `core/config.ts`, `core/schemas.ts`, `security/accounts.ts`, `security/audit.ts`, `security/modules.ts`, `security/passwords.ts`

Packages: `@fastify/cookie`, `@fastify/jwt`, `@fastify/rate-limit`, `fastify`, `node:crypto`

Imported by: `http/health.ts`, `index.ts`, `routes/chat.ts`, `routes/explain.ts`, `routes/stream.ts`, `security/viewerPolicy.ts`

Tests that import it: `__tests__/account-requests.test.ts`, `__tests__/ai-limits.test.ts`, `__tests__/auth-rules.test.ts`, `__tests__/auth.test.ts`, `__tests__/compose-auth.test.ts`, `__tests__/download-log.test.ts`, `__tests__/email-without-auth.test.ts`, `__tests__/health-log.test.ts`, and 24 more
<!-- /gen -->

### `server/src/security/heavyLimit.ts`

How many heavy reports, and how many monthly SLA reads, one person may have waiting or running at once. Walked through in [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/security/heavyLimit.ts -->
57 lines, 7 exports. Imported by 8 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `HEAVY_REPORTS_PER_PERSON` | constant | 5 | `const HEAVY_REPORTS_PER_PERSON = 4` | Heavy reports (availability, noise, capacity, top triggers) one person may have waiting or running: a page asks for two at most, so four is two... |
| `SLI_READS_PER_PERSON` | constant | 8 | `const SLI_READS_PER_PERSON = 4` | Places one person may hold in the line of the derived SLA reads: the month page asks for two (both methods) and a report file takes two, so four... |
| `takeHeavyPlace` | function | 45 | `const takeHeavyPlace = (caller: string): (() => void) \| null =>` | A place of a person in the line of the heavy reports, or null when they hold four (BK-88). |
| `takeSliPlace` | function | 48 | `const takeSliPlace = (caller: string): (() => void) \| null =>` | A place of a person in the line of the derived SLA reads, or null when they hold four (BK-88). |
| `heavyReportGuard` | constant | 51 | `const heavyReportGuard = heavyLine()` | A fifth heavy report of one person is refused, so a script cannot fill the line of the gate. |
| `sliReadGuard` | constant | 54 | `const sliReadGuard = sliLine()` | One month in one method (/api/sli, the service tree): one place in the line of the derived SLA reads. |
| `sliExportGuard` | constant | 57 | `const sliExportGuard = sliLine(2)` | The month's report file reads both methods, so it takes two places. |

Imports: `clients/limits.ts`

Packages: `fastify`

Imported by: `routes/analytics.ts`, `routes/chat.ts`, `routes/explain.ts`, `routes/reports.ts`, `routes/services.ts`, `routes/sli.ts`, `routes/sliExport.ts`, `services/assistantDetail.ts`

Tests that import it: `__tests__/chat-route.test.ts`, `__tests__/explain-route-signal.test.ts`, `__tests__/heavy-limit.test.ts`, `__tests__/sli-limit.test.ts`
<!-- /gen -->

### `server/src/security/mailLimit.ts`

Holds the allowance for sending the report by email: five an hour for each person, counted in memory. A request is counted once it has passed its other checks, so a mistyped one costs nothing, and past the allowance the answer is a 429 with the seconds to wait.

<!-- gen:card server/src/security/mailLimit.ts -->
28 lines, 3 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SENDS_PER_HOUR` | constant | 9 | `const SENDS_PER_HOUR = 5` | Report emails an hour for each person. |
| `limitMessage` | function | 14 | `function limitMessage(wait: number): string` | The sentence for a person who has used the allowance; `wait` is in seconds and the minutes are rounded up. |
| `tooManySends` | function | 23 | `function tooManySends(req: FastifyRequest, reply: FastifyReply): boolean` | True, with the 429 already sent, when this person has used the hour's allowance. |

Imports: `clients/limits.ts`

Packages: `fastify`

Imported by: `routes/sliMail.ts`

Tests that import it: `__tests__/mail-limit.test.ts`, `__tests__/mail-route.test.ts`
<!-- /gen -->


### `server/src/security/modules.ts`

The roles, the modules (one for each page of the menu) and the one table of routes that says which role and which modules each route of the API needs. Walked through in [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/security/modules.ts -->
167 lines, 24 exports. Imported by 7 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ROLES` | constant | 12 | `const ROLES` |  |
| `Role` | type | 13 | `type Role = (typeof ROLES)[number]` |  |
| `isRole` | function | 17 | `const isRole = (v: unknown): v is Role =>` |  |
| `roleAllows` | function | 18 | `const roleAllows = (has: Role, needs: Role): boolean =>` |  |
| `LEGACY_ROLES` | constant | 21 | `const LEGACY_ROLES: Readonly<Record<string, Role>>` | The names a role had before 17 November 2026, which `.env` and older sessions may still carry. |
| `roleFromName` | function | 24 | `const roleFromName = (raw: unknown): Role \| undefined =>` | A role as written in `.env` or in an older session, or undefined when it is none the portal knows. |
| `MODULES` | constant | 28 | `const MODULES` | One page of the menu, and the route that fills it, so that the menu can never say what the guard does not. |
| `ModuleId` | type | 49 | `type ModuleId = (typeof MODULES)[number]['id']` |  |
| `MODULE_IDS` | constant | 50 | `const MODULE_IDS: readonly ModuleId[]` |  |
| `isModuleId` | function | 51 | `const isModuleId = (v: unknown): v is ModuleId =>` |  |
| `moduleLabel` | function | 52 | `const moduleLabel = (id: ModuleId): string =>` |  |
| `ROUTES` | constant | 62 | `const ROUTES: readonly RouteRule[]` | First match wins. |
| `ruleFor` | function | 98 | `function ruleFor(route: string): RouteRule \| undefined` |  |
| `Access` | interface | 103 | `interface Access` | What a signed-in user may do and see. |
| `Verdict` | type | 108 | `type Verdict = \| { ok: true } \| { ok: false; why: 'role'; needs: Role } \| { ok: false; why: 'module'; modules:...` |  |
| `judge` | function | 115 | `function judge(access: Access, route: string): Verdict` | Whether `access` may use `route`. |
| `refusalText` | function | 124 | `function refusalText(verdict: Exclude<Verdict, { ok: true }>, role: Role): string` | The sentence for a refusal, as the guard sends it. |
| `moduleRole` | function | 131 | `const moduleRole = (id: ModuleId): Role =>` | The role a module's own page needs, from the rules that guard its route. |
| `grantable` | function | 137 | `const grantable = (role: Role): ModuleId[] =>` | The modules a person of this role could be given: an administrator's own pages are for administrators alone. |
| `GUEST_MODULES` | constant | 140 | `const GUEST_MODULES: readonly ModuleId[]` | What a viewer could open before 17 November 2026: everything but the network pages, the inventory scorecard and the user pages. |
| `presetFor` | function | 146 | `function presetFor(role: Role): ModuleId[]` | The ticks a new user of this role starts with. |
| `modulesForEnvRole` | function | 153 | `function modulesForEnvRole(raw: string \| undefined): ModuleId[]` | The modules a user of `.env` gets from the name of their role there: a `wall` account has the network pages, a `viewer` does not. |
| `accessOf` | function | 160 | `function accessOf(role: Role, modules: readonly ModuleId[]): Access` | What a user has, with an administrator's every module and nothing the role cannot reach. |
| `pagesOf` | function | 165 | `function pagesOf(access: Access): Record<string, Role>` | The pages a user has, each with the role it needs, as `GET /api/auth/me` tells the menu: a page the user lacks is not in it. |

Imports: none

Imported by: `security/accounts.ts`, `security/auth.ts`, `security/requestStore.ts`, `security/userStore.ts`, `services/accountRequests.ts`, `services/assistantSnapshot.ts`, `services/users.ts`

Tests that import it: `__tests__/accounts.test.ts`, `__tests__/assistant-scope.test.ts`, `__tests__/auth-rules.test.ts`, `__tests__/explain-access.test.ts`, `__tests__/page-access.test.ts`, `__tests__/page-routes.test.ts`, `__tests__/surface.test.ts`
<!-- /gen -->

### `server/src/security/passwords.ts`

How a portal password is stored (a salted Argon2id hash, or scrypt for an older one) and checked, with a decoy check so an unknown name costs the same time. Walked through in [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/security/passwords.ts -->
288 lines, 21 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ScryptParams` | interface | 15 | `interface ScryptParams` | How a portal password is stored. |
| `SCRYPT_DEFAULTS` | constant | 25 | `const SCRYPT_DEFAULTS: ScryptParams` | 32 MiB and 0.13 s a check on the development Mac, more on a smaller machine: a sign-in is rare, and the limiter caps how often it can be tried. |
| `Argon2Params` | interface | 28 | `interface Argon2Params` | Argon2id's cost settings; the memory is in KiB. |
| `ARGON2_DEFAULTS` | constant | 35 | `const ARGON2_DEFAULTS: Argon2Params` | OWASP's first setting for Argon2id: 46 MiB, one pass, one lane. |
| `ARGON2_SUPPORTED` | constant | 42 | `const ARGON2_SUPPORTED = typeof nodeArgon2 === 'function' && typeof nodeArgon2Sync === 'function'` |  |
| `StoredPassword` | type | 49 | `type StoredPassword = \| { kind: 'plain'; digest: Buffer } \| { kind: 'scrypt'; params: ScryptParams; salt: Buffer...` |  |
| `isHash` | function | 62 | `const isHash = (stored: StoredPassword): boolean =>` | Whether a read password is a usable hash, whichever kind. |
| `parseStoredPassword` | function | 78 | `function parseStoredPassword(stored: string): StoredPassword` | Read a stored password. |
| `verifyPassword` | function | 121 | `async function verifyPassword(stored: StoredPassword, candidate: string): Promise<boolean>` | Whether `candidate` is the stored password. |
| `decoyVerify` | function | 131 | `async function decoyVerify(candidate: string): Promise<void>` | The cost of one hash check with nothing to compare, so an unknown name is not quicker to refuse than a known one: that of a new hash. |
| `hashPassword` | function | 140 | `async function hashPassword(password: string, params?: ScryptParams \| Argon2Params): Promise<string>` | A hash entry for `password`, with a fresh salt. |
| `needsRehash` | function | 157 | `const needsRehash = (stored: StoredPassword): boolean =>` | Whether a stored password is weaker than what a new one gets: a plain text one, a scrypt hash, or an Argon2id hash with less than its defaults. |
| `MIN_PASSWORD_LENGTH` | constant | 163 | `const MIN_PASSWORD_LENGTH = 8` | The fewest characters a plain password may have. |
| `isTooShort` | function | 166 | `const isTooShort = (stored: string): boolean =>` | Whether a stored plain password is under the minimum, counted in characters. |
| `COMMON_PASSWORDS` | constant | 178 | `const COMMON_PASSWORDS: readonly string[]` | Passwords that people choose, of eight characters or more (a shorter one is refused for its length), in lower case: keyboard walks, runs of... |
| `stemOf` | function | 224 | `const stemOf = (password: string): string =>` | The letters a password is made of once its ending of digits and signs is cut off and its look-alikes are read as letters: `Welcome2026!` is... |
| `isCommon` | function | 242 | `function isCommon(stored: string): boolean` | Whether a stored password is on that list, or is still a placeholder such as `<a long password>` pasted from the documents. |
| `isGuessable` | function | 253 | `function isGuessable(stored: string): boolean` | Whether a stored password is one anyone can guess: empty, or the built-in "admin". |
| `MAX_PASSWORD_LENGTH` | constant | 260 | `const MAX_PASSWORD_LENGTH = 256` |  |
| `PasswordContext` | interface | 270 | `interface PasswordContext` | What a password chosen on the page is judged beside: the sign-in name of the person it is for. |
| `passwordProblem` | function | 279 | `function passwordProblem(candidate: string, context: PasswordContext = {}): string \| null` | Why a password chosen on the page is refused, in words, or null when it is fit to use: long enough, not too long, not on the lists of passwords... |

Imports: none

Packages: `node:crypto`

Imported by: `server/scripts/hash-password.ts`, `security/accounts.ts`, `security/auth.ts`, `security/userStore.ts`

Tests that import it: `__tests__/accounts-races.test.ts`, `__tests__/accounts.test.ts`, `__tests__/auth-timing.test.ts`, `__tests__/auth-users.test.ts`, `__tests__/env-templates.test.ts`, `__tests__/passwords.test.ts`, `__tests__/startup-guards.test.ts`, `__tests__/stream-account-change.test.ts`, and 1 more
<!-- /gen -->

### `server/src/security/requestStore.ts`

The file of requests for an account on the state volume (FR-62): `requests.json`, mode 0600, written whole and safely, with the text of a stranger cleaned before it is kept.

<!-- gen:card server/src/security/requestStore.ts -->
159 lines, 12 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `AccountRequest` | interface | 12 | `interface AccountRequest` |  |
| `REQUEST_NAME_MAX` | constant | 23 | `const REQUEST_NAME_MAX = 80` |  |
| `REQUEST_REASON_MAX` | constant | 24 | `const REQUEST_REASON_MAX = 500` |  |
| `REQUEST_PAGES_MAX` | constant | 25 | `const REQUEST_PAGES_MAX = 20` |  |
| `REQUEST_LIFE_SECONDS` | constant | 27 | `const REQUEST_LIFE_SECONDS = 30 * 86_400` | A request nobody has answered in this long is dropped. |
| `cleanText` | function | 33 | `function cleanText(raw: string, max: number, keepLines = false): string` | Text from a person who is not signed in, made safe to keep and to show: control characters and the marks that reorder text are dropped, runs of... |
| `readRequests` | function | 40 | `function readRequests(raw: unknown): { requests: AccountRequest[]; dropped: number; usable: boolean }` | The requests a file holds that read well, and whether it is of a kind this build reads at all. |
| `RequestsWriteError` | class | 73 | `class RequestsWriteError extends Error` |  |
| `RequestStore` | interface | 80 | `interface RequestStore` |  |
| `noRequests` | function | 119 | `const noRequests = (): RequestStore =>` | What the portal runs on with no data folder: nothing is kept, and requests are off. |
| `memoryRequests` | function | 122 | `const memoryRequests = (initial: AccountRequest[] = []): RequestStore =>` | Requests kept in memory that can be changed, for the tests. |
| `openRequests` | function | 125 | `async function openRequests(dir: string, warn: (message: string) => void): Promise<RequestStore>` | Opens the requests in `dir`, or a store that keeps none when `dir` is empty or cannot be used. |

Imports: `core/state.ts`, `security/modules.ts`

Packages: `node:fs`, `node:path`

Imported by: `http/errors.ts`, `services/accountRequests.ts`

Tests that import it: `__tests__/account-requests.test.ts`, `__tests__/openapi-contract.test.ts`
<!-- /gen -->

### `server/src/security/searchLimit.ts`

How many text searches one person may make a minute in the item picker and in Latest data. Walked through in [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/security/searchLimit.ts -->
25 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SEARCHES_PER_MINUTE` | constant | 8 | `const SEARCHES_PER_MINUTE = 120` | Text searches a minute for each person, in the item picker and in Latest data: a search with new text is a cold read of Zabbix, so it has a... |
| `searchGuard` | function | 13 | `async function searchGuard(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply \| void>` | A preHandler, so it runs after the auth guard has set `req.user`: 429 past the allowance, before any Zabbix read. |

Imports: `clients/limits.ts`

Packages: `fastify`

Imported by: `routes/hosts.ts`

Tests that import it: `__tests__/search-limit.test.ts`
<!-- /gen -->

### `server/src/security/userStore.ts`

The users file `users.json` on the state volume: reading it back whole or repaired, writing it safely with a copy of the last version, and the store that keeps nothing without a data folder. Walked through in [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/security/userStore.ts -->
213 lines, 10 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Language` | type | 12 | `type Language = 'en' \| 'id'` |  |
| `StoredUser` | interface | 14 | `interface StoredUser` |  |
| `MAX_USERS` | constant | 39 | `const MAX_USERS = 200` |  |
| `NAME_SHAPE` | constant | 43 | `const NAME_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._@-]{1,62}[A-Za-z0-9]$/` | A sign-in name made on the page: three to 64 letters, digits and `. |
| `readUsers` | function | 71 | `function readUsers(raw: unknown): { users: StoredUser[]; repairs: string[]; usable: boolean }` | What a file holds: the users that read well, a line for each thing dropped, and whether the file is of a kind this build reads at all. |
| `UsersWriteError` | class | 91 | `class UsersWriteError extends Error` |  |
| `UserStore` | interface | 98 | `interface UserStore` |  |
| `noUsers` | function | 145 | `const noUsers = (): UserStore =>` | What the portal runs on with no data folder, and what the tests start from: no users of its own, and nothing can be changed. |
| `memoryUsers` | function | 148 | `const memoryUsers = (initial: StoredUser[] = []): UserStore =>` | Users kept in memory that can be changed, for the tests. |
| `openUsers` | function | 171 | `async function openUsers(dir: string, warn: (message: string) => void): Promise<UserStore>` | Opens the users in `dir`, or a store that keeps none when `dir` is empty or cannot be used. |

Imports: `core/state.ts`, `security/modules.ts`, `security/passwords.ts`

Packages: `node:fs`, `node:path`

Imported by: `http/errors.ts`, `security/accounts.ts`, `services/userDirectory.ts`

Tests that import it: `__tests__/account-requests.test.ts`, `__tests__/accounts-races.test.ts`, `__tests__/accounts.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/stream-account-change.test.ts`, `__tests__/user-store.test.ts`, `__tests__/users-routes.test.ts`, `__tests__/users-without-auth.test.ts`
<!-- /gen -->

### `server/src/security/viewerPolicy.ts`

What a viewer may not read through the generic routes: network interface data. Walked through in [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/security/viewerPolicy.ts -->
51 lines, 4 exports. Imported by 5 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `isNetworkKey` | function | 18 | `const isNetworkKey = (key: unknown): boolean =>` | Interface item keys: net.if.in[...], net.if.out[...], net.if.speed[...], net.if.status[...]. |
| `hidesNetwork` | function | 21 | `const hidesNetwork = (req: FastifyRequest): boolean =>` | Whether this caller is kept away from network interface data: they do not have the Network module. |
| `withoutNetworkItems` | function | 24 | `const withoutNetworkItems = <T extends { key_?: unknown }>(items: T[]): T[] =>` | The items without the interface ones: a new array, so a cached list is never changed. |
| `networkItemsDenied` | function | 48 | `async function networkItemsDenied(req: FastifyRequest, itemids: readonly string[]): Promise<string \| null>` | For the routes that read items by id (graph, history, trend): the 403 message when a viewer asks for interface items, or null when the read may go on. |

Imports: `clients/zabbix.ts`, `core/cache.ts`, `security/auth.ts`

Packages: `fastify`

Imported by: `routes/history.ts`, `routes/hosts.ts`, `routes/maps.ts`, `services/assistantValues.ts`, `services/hosts.ts`

Tests that import it: `__tests__/typed-keys.test.ts`, `__tests__/viewer-network.test.ts`
<!-- /gen -->

## `server/src/services`

### `server/src/services/accountRequests.ts`

The rules of a request for an account (FR-62): off unless the setting is on and there is somewhere to keep it, a cap on how many wait, a limit for each address in a day, a copy of a waiting request dropped with the same answer, one nobody answered in thirty days expired, and the approval and the refusal an administrator makes.

<!-- gen:card server/src/services/accountRequests.ts -->
164 lines, 13 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `initRequests` | function | 18 | `async function initRequests(warn: (message: string) => void): Promise<RequestStore>` | Opens the file of requests. |
| `useRequestStore` | hook | 29 | `function useRequestStore(store: RequestStore \| null): void` | For the tests: put a store of their own in place. |
| `requestsOn` | function | 34 | `const requestsOn = (): boolean =>` | Whether the form is offered and the endpoint answers: the setting, sign-in, and somewhere to keep the requests and to make the account. |
| `askablePages` | function | 37 | `const askablePages = (): { id: ModuleId; label: string }[] =>` | The pages a person may ask for: those a guest can have, which is not the Users page or the scorecard. |
| `RequestView` | interface | 39 | `interface RequestView` |  |
| `requestInfo` | function | 51 | `function requestInfo(): { enabled: boolean; pages?: { id: ModuleId; label: string }[]; nameMax?: number; reasonMax?:...` | What the sign-in page asks before it offers the form. |
| `forgetAddresses` | function | 76 | `const forgetAddresses = (): void =>` | For the tests. |
| `RequestRefused` | class | 78 | `class RequestRefused extends Error` |  |
| `Received` | type | 90 | `type Received = 'kept' \| 'ignored'` |  |
| `receiveRequest` | function | 96 | `async function receiveRequest(input: { name: string; pages: string[]; reason: string }, address: string):...` | A request from a person who is not signed in. |
| `listRequests` | function | 128 | `function listRequests(): { enabled: boolean; max: number; requests: RequestView[] }` | The requests waiting, the oldest first. |
| `approveRequest` | function | 140 | `async function approveRequest(id: string, user: NewUser, actor: string): Promise<UserView>` | Makes the account the administrator typed, with the pages and the password they chose, and takes the request off the list. |
| `refuseRequest` | function | 151 | `async function refuseRequest(id: string): Promise<string>` | Takes the request off the list. |

Imports: `core/config.ts`, `security/accounts.ts`, `security/modules.ts`, `security/requestStore.ts`, `services/userDirectory.ts`

Packages: `@fastify/rate-limit`, `node:crypto`

Imported by: `index.ts`, `routes/accountRequests.ts`

Tests that import it: `__tests__/account-requests.test.ts`, `__tests__/openapi-contract.test.ts`
<!-- /gen -->

### `server/src/services/actions.ts`

The acknowledge and close write-back: validation, the write itself, and the audit line. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/services/actions.ts -->
118 lines, 15 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ACTION_CLOSE` | constant | 29 | `const ACTION_CLOSE = 1` |  |
| `ACTION_ACKNOWLEDGE` | constant | 30 | `const ACTION_ACKNOWLEDGE = 2` |  |
| `ACTION_MESSAGE` | constant | 31 | `const ACTION_MESSAGE = 4` |  |
| `MAX_MESSAGE` | constant | 34 | `const MAX_MESSAGE = 2048` | Zabbix caps acknowledge messages at 2048 characters. |
| `MAX_EVENTIDS` | constant | 37 | `const MAX_EVENTIDS = 50` | Most event ids one request may act on: a slip cannot close a whole estate. |
| `trailOf` | function | 49 | `function trailOf(req: FastifyRequest)` | Who, from where, which events and what for, read loosely: even a malformed body leaves a line that says what it was after. |
| `logAttempt` | function | 61 | `async function logAttempt(req: FastifyRequest): Promise<void>` | Every attempt is on record with who and from where, before any check can turn it away. |
| `WRITE_REFUSED` | constant | 65 | `const WRITE_REFUSED` |  |
| `WRITE_UNCLEAR` | constant | 66 | `const WRITE_UNCLEAR` |  |
| `WRITE_MAY_HAVE_GONE` | constant | 67 | `const WRITE_MAY_HAVE_GONE` |  |
| `writeFailure` | function | 73 | `function writeFailure(err: unknown, requestId: string): { status: number; error: string; message: string } \| undefined` | The answer for a write that failed in a way the general "not answering" would misstate: Zabbix refused it, or timed out or answered unreadably... |
| `answered` | constant | 83 | `const answered = new WeakSet<FastifyRequest>()` | Requests the handler has already logged as refused or failed, so the response hook does not log them twice. |
| `AckBody` | interface | 85 | `interface AckBody` |  |
| `STALE_AFTER_WRITE` | constant | 100 | `const STALE_AFTER_WRITE` | Caches that show problem/acknowledgement state and go stale after a write. |
| `WRITE_HOLD_MS` | constant | 118 | `const WRITE_HOLD_MS = 15_000` | How long those keys stay on a short TTL after a write. |

Imports: `clients/zabbix.ts`, `security/audit.ts`

Packages: `fastify`

Imported by: `routes/actions.ts`

Tests that import it: `__tests__/action-limit.test.ts`, `__tests__/devices-route.test.ts`, `__tests__/statsItemCount.test.ts`, `__tests__/write-audit.test.ts`
<!-- /gen -->

### `server/src/services/aging.ts`

Open problems by age, and the ones left unacknowledged longest. Walked through in [Server: routes](server-routes.md), [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/services/aging.ts -->
61 lines, 3 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `AgingReport` | interface | 6 | `interface AgingReport` |  |
| `getAging` | function | 28 | `async function getAging(): Promise<AgingReport>` |  |
| `getAgingReport` | function | 59 | `function getAgingReport()` | Problems by age. |

Imports: `core/cache.ts`, `domain/queries.ts`

Imported by: `routes/analytics.ts`

Tests that import it: none
<!-- /gen -->

### `server/src/services/assistant.ts`

The Assistant's entry point, which the route and the tests import and the pieces never do. Walked through in [Server: live and assistant](server-live-and-assistant.md), [Web app: the API client, the types and the guards](web-api-types-guards.md).

<!-- gen:card server/src/services/assistant.ts -->
28 lines, 0 exports, 36 re-exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `answerLanguage` | re-export | 22 | `from './assistantPrompt.js'` |  |
| `CHAT_SYSTEM` | re-export | 22 | `from './assistantPrompt.js'` |  |
| `detectLanguage` | re-export | 22 | `from './assistantPrompt.js'` |  |
| `languageReminder` | re-export | 22 | `from './assistantPrompt.js'` |  |
| `notGivenLine` | re-export | 22 | `from './assistantPrompt.js'` |  |
| `systemText` | re-export | 22 | `from './assistantPrompt.js'` |  |
| `age` | re-export | 23 | `from './assistantLines.js'` |  |
| `promptText` | re-export | 23 | `from './assistantLines.js'` |  |
| `section` | re-export | 23 | `from './assistantLines.js'` |  |
| `ALL_SECTIONS` | re-export | 24 | `from './assistantSnapshot.js'` |  |
| `buildSnapshot` | re-export | 24 | `from './assistantSnapshot.js'` |  |
| `getSnapshot` | re-export | 24 | `from './assistantSnapshot.js'` |  |
| `mayFocus` | re-export | 24 | `from './assistantSnapshot.js'` |  |
| `mayInternet` | re-export | 24 | `from './assistantSnapshot.js'` |  |
| `SECTION_MODULES` | re-export | 24 | `from './assistantSnapshot.js'` |  |
| `sectionsFor` | re-export | 24 | `from './assistantSnapshot.js'` |  |
| `SNAPSHOT_CHAR_CAP` | re-export | 24 | `from './assistantSnapshot.js'` |  |
| `SNAPSHOT_KEY` | re-export | 24 | `from './assistantSnapshot.js'` |  |
| `snapshotClock` | re-export | 24 | `from './assistantSnapshot.js'` |  |
| `snapshotFingerprint` | re-export | 24 | `from './assistantSnapshot.js'` |  |
| `withheldLine` | re-export | 24 | `from './assistantSnapshot.js'` |  |
| `SectionKey` | re-export | 25 | `from './assistantSnapshot.js'` |  |
| `Snapshot` | re-export | 25 | `from './assistantSnapshot.js'` |  |
| `SnapshotMeta` | re-export | 25 | `from './assistantSnapshot.js'` |  |
| `buildFocus` | re-export | 26 | `from './assistantFocus.js'` |  |
| `focusBlock` | re-export | 26 | `from './assistantFocus.js'` |  |
| `hostFocusBlock` | re-export | 26 | `from './assistantFocus.js'` |  |
| `hostsNamed` | re-export | 26 | `from './assistantFocus.js'` |  |
| `sitesNamed` | re-export | 26 | `from './assistantFocus.js'` |  |
| `warmFor` | re-export | 26 | `from './assistantFocus.js'` |  |
| `chatSystem` | re-export | 27 | `from './assistantAnswer.js'` |  |
| `cleanAnswer` | re-export | 27 | `from './assistantAnswer.js'` |  |
| `readOpenAiStream` | re-export | 27 | `from './assistantAnswer.js'` |  |
| `streamAnswer` | re-export | 27 | `from './assistantAnswer.js'` |  |
| `AnswerOptions` | re-export | 28 | `from './assistantAnswer.js'` |  |
| `ChatTurn` | re-export | 28 | `from './assistantAnswer.js'` |  |

Imports: `services/assistantAnswer.ts`, `services/assistantFocus.ts`, `services/assistantLines.ts`, `services/assistantPrompt.ts`, `services/assistantSnapshot.ts`

Imported by: `server/scripts/bakeoff/run.ts`, `server/scripts/bakeoff/sample.ts`, `routes/chat.ts`, `services/chat.ts`

Tests that import it: `__tests__/ai-errors.test.ts`, `__tests__/ai-hosted-limits.test.ts`, `__tests__/ai-limits.test.ts`, `__tests__/ai-outside-usage.test.ts`, `__tests__/ai.test.ts`, `__tests__/assistant-follow-up.test.ts`, `__tests__/assistant-scope.test.ts`, `__tests__/bakeoff-fixture.test.ts`, and 3 more
<!-- /gen -->

### `server/src/services/assistantAcks.ts`

Who acknowledged a problem and what they wrote, given only to a model on this machine, since a name or a reason may name a person. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantAcks.ts -->
184 lines, 9 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `AckUpdate` | interface | 12 | `interface AckUpdate` | One update of a problem: an acknowledgement, a comment, a change of severity, a close. |
| `AckedProblem` | interface | 21 | `interface AckedProblem` |  |
| `actionWords` | function | 45 | `function actionWords(bits: number): string` | The bits of an action in words: 2 is "acknowledged", 6 "acknowledged and commented". |
| `ACK_PROBLEMS_MAX` | constant | 51 | `const ACK_PROBLEMS_MAX = 12` | The most acknowledged problems one question reads. |
| `ackedOpenIds` | function | 54 | `function ackedOpenIds(open: ZbxProblem[], hostids: ReadonlySet<string> \| null, limit = ACK_PROBLEMS_MAX): { ids:...` | The ids of the acknowledged problems among the open ones, in scope, worst and newest first. |
| `AcksSectionOptions` | interface | 71 | `interface AcksSectionOptions` |  |
| `acksSection` | function | 87 | `function acksSection(problems: AckedProblem[], { scope, window, tz, now, people, byRole = false, total, budget }:...` |  |
| `readAcks` | function | 156 | `async function readAcks(eventids: string[]): Promise<AckedProblem[]>` | The updates of problems that are open now, by their event ids. |
| `readAcksIn` | function | 163 | `async function readAcksIn(window: PastWindow, hostids: string[] \| null): Promise<{ problems: AckedProblem[]...` | The acknowledged problems that opened in a window, closed or not; `hostids` narrows it to a site or a host. |

Imports: `clients/zabbix.ts`, `domain/queries.ts`, `services/assistantLines.ts`, `services/assistantWhen.ts`

Imported by: `services/assistantDetail.ts`

Tests that import it: `__tests__/assistant-acks.test.ts`, `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-reads.test.ts`
<!-- /gen -->

### `server/src/services/assistantAnswer.ts`

Asks the model with a conversation and returns the answer as it is written, from the hosted API or a local server. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantAnswer.ts -->
278 lines, 6 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ChatTurn` | interface | 12 | `interface ChatTurn` |  |
| `cleanAnswer` | function | 29 | `function cleanAnswer(raw: string): string` |  |
| `readOpenAiStream` | function | 52 | `async function* readOpenAiStream(body: ReadableStream<Uint8Array>, onCounts?: (counts: ModelCounts) => void...` | Turn an OpenAI-style `text/event-stream` body into text pieces. |
| `AnswerOptions` | interface | 207 | `interface AnswerOptions` |  |
| `chatSystem` | function | 223 | `function chatSystem(snapshot: string, latest: string, { focus, language, withheld }: Pick<AnswerOptions, 'focus' \|...` | The system text of one question: the snapshot first, which is unchanged while the snapshot is, then the focus and language lines that differ per... |
| `streamAnswer` | function | 236 | `async function* streamAnswer(turns: ChatTurn[], snapshot: string, signal?: AbortSignal, { focus, onStats, onUsage...` | Answer the latest turn, streaming text as the model produces it. |

Imports: `clients/ai.ts`, `clients/limits.ts`, `core/config.ts`, `services/assistantPrompt.ts`

Packages: `@anthropic-ai/sdk`

Imported by: `services/assistant.ts`

Tests that import it: none
<!-- /gen -->

### `server/src/services/assistantDetail.ts`

What a question gets beyond the snapshot and the site focus: past problems, latest values, host details and contacts, each read for what the question names and the pages the user holds. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantDetail.ts -->
464 lines, 4 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `DetailContext` | interface | 40 | `interface DetailContext` |  |
| `SLA_MONTHS_MAX` | constant | 69 | `const SLA_MONTHS_MAX = 4` | The most calendar months one question's SLA window may touch. |
| `DETAIL_TOTAL` | constant | 72 | `const DETAIL_TOTAL = 2_800` | What the blocks may add to a prompt in all; a block that would pass it is left out whole. |
| `buildDetails` | function | 420 | `async function buildDetails(c: DetailContext): Promise<{ topics: string[]; blocks: string[]; notGiven: string \| null }>` | The blocks for what the question asks, read for the user's own pages, and the line that says which of what it asked for was not given. |

Imports: `core/validate.ts`, `domain/naming.ts`, `domain/queries.ts`, `domain/siteOf.ts`, `security/heavyLimit.ts`, `services/assistantAcks.ts`, `services/assistantHostInfo.ts`, `services/assistantLines.ts`, `services/assistantLinks.ts`, `services/assistantMaintenance.ts`, `services/assistantMaps.ts`, `services/assistantOpen.ts`, `services/assistantPast.ts`, `services/assistantPorts.ts`, `services/assistantPrompt.ts`, `services/assistantReports.ts`, and 16 more

Imported by: `services/assistantFocus.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-reads.test.ts`
<!-- /gen -->

### `server/src/services/assistantFacts.ts`

The facts the prompt needs some work to know: hosts per state, since when a host is down, and the whole-list lines. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantFacts.ts -->
80 lines, 4 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `stateCounts` | function | 13 | `function stateCounts(hosts: SiteHost[]): Record<HostState, number>` | Hosts per state (reachability.ts): ping first, the interface flags only without a recent ping. |
| `availabilitySince` | function | 26 | `function availabilitySince(problems: ZbxProblem[]): AvailabilitySince` | When each host's open availability problems began: the oldest ICMP one and the oldest other one (SNMP, agent). |
| `stateSince` | function | 44 | `function stateSince(h: SiteHost, since: AvailabilitySince): number \| undefined` | Since when a host has been in its state. |
| `wholeListLines` | function | 57 | `function wholeListLines(problems: ZbxProblem[], hosts: SiteHost[], day: (clock: number) => string): string[]` | What only the whole problem list can say, counted over every open problem. |

Imports: `domain/naming.ts`, `domain/queries.ts`, `domain/reachability.ts`, `services/assistantLines.ts`, `services/sites.ts`

Imported by: `services/assistantFocus.ts`, `services/assistantSnapshot.ts`

Tests that import it: none
<!-- /gen -->

### `server/src/services/assistantFocus.ts`

The focus block: for a site the question names, every host by state and its worst problems. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantFocus.ts -->
303 lines, 7 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `sitesNamed` | function | 70 | `function sitesNamed(text: string): SiteRef[]` | The sites a message names, in the order it names them. |
| `focusBlock` | function | 110 | `function focusBlock(site: SiteRef, sites: Site[], problems: ZbxProblem[], now: number, internet: string[] = []...` | FOCUS: a site the question names, host by host. |
| `siteInternetLines` | function | 175 | `function siteInternetLines(site: SiteRef, read: InternetRead \| null, now: number, siteOf: (hostName: string) =>...` | The internet links of a site as FOCUS lines, from a read of the gauges; nothing when they were not read, so that no link is called missing for... |
| `hostsNamed` | function | 189 | `function hostsNamed(text: string, hosts: SiteHost[]): SiteHost[]` | The hosts a message names, in the order it names them; of two that start at one place, the longer name. |
| `hostFocusBlock` | function | 206 | `function hostFocusBlock(host: SiteHost, problems: ZbxProblem[], now: number, problemLines = true): string` | FOCUS for one host: its state, how many problems it has open by severity, and the worst of them, for a user whose pages show them. |
| `warmFor` | function | 243 | `async function warmFor(question: string, modules: ReadonlySet<string> \| null): Promise<void>` | Waits, before the snapshot is built, for the slow views that a question needs and that the portal keeps for only ten minutes after the last... |
| `buildFocus` | function | 262 | `async function buildFocus(question: string, modules: ReadonlySet<string> \| null, { operator = modules === null...` | What a question gets beyond the snapshot, for the pages the user holds (`modules`, null for an administrator and for a portal with sign-in off): a... |

Imports: `core/config.ts`, `domain/naming.ts`, `domain/queries.ts`, `domain/reachability.ts`, `domain/siteOf.ts`, `services/assistantDetail.ts`, `services/assistantFacts.ts`, `services/assistantInternet.ts`, `services/assistantLines.ts`, `services/assistantPrompt.ts`, `services/assistantSnapshot.ts`, `services/assistantTopics.ts`, `services/links.ts`, `services/meters.ts`, `services/sites.ts`, `services/topHosts.ts`, and 1 more

Imported by: `services/assistant.ts`

Tests that import it: `__tests__/assistant-warm.test.ts`, `__tests__/assistant-words.test.ts`
<!-- /gen -->

### `server/src/services/assistantHostInfo.ts`

What a host is, for a question about it: its state, groups and templates and, on this machine only, its addresses, tags, inventory and contacts. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantHostInfo.ts -->
185 lines, 5 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `HostInfo` | interface | 13 | `interface HostInfo` |  |
| `HostInfoOptions` | interface | 55 | `interface HostInfoOptions` |  |
| `hostInfoSection` | function | 72 | `function hostInfoSection(h: HostInfo, { local, inventoryPage = true, people, peopleAsked, tz, budget }:...` |  |
| `siteContactsSection` | function | 109 | `function siteContactsSection(site: string, hosts: HostInfo[], { people, local = true, inventoryPage = true, budget...` | The contacts on record across the hosts of a site, each with how many hosts name it, for "siapa penanggung jawab di Surabaya?". |
| `readHostInfo` | function | 142 | `async function readHostInfo(hostids: string[], now: number = Math.floor(Date.now() / 1000)): Promise<HostInfo[]>` |  |

Imports: `clients/zabbix.ts`, `core/config.ts`, `services/assistantLines.ts`, `services/assistantMaintenance.ts`, `sli/maintenance.ts`

Imported by: `services/assistantDetail.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-hostinfo.test.ts`, `__tests__/assistant-reads.test.ts`
<!-- /gen -->

### `server/src/services/assistantInternet.ts`

The internet links as prompt lines, worded as the Internet page words them, for the snapshot and for a site's focus block. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantInternet.ts -->
204 lines, 8 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `rateText` | function | 32 | `function rateText(value: number, units: string): string` | A value with its unit; a bit rate scaled the way the Internet page scales it, any other unit as given. |
| `internetLine` | function | 80 | `function internetLine(m: Meter, now: number, site?: string \| null): string` | One link as one prompt line. |
| `siteOfMeter` | function | 109 | `const siteOfMeter = (m: Meter, siteOf: (hostName: string) => SiteRef \| null = siteFromHostName): string \| null =>` | The site the gauge's host belongs to, by `siteOf` (the host's name alone when none is given); none for a gauge whose item is gone. |
| `InternetSectionOptions` | interface | 136 | `interface InternetSectionOptions` |  |
| `internetSection` | function | 148 | `function internetSection(meters: Meter[], { now, readAt, siteOf, budget }: InternetSectionOptions): { text: string...` | The part of the snapshot about the links: how many there are and how many have a reading, then a link that is down, those High or Critical in... |
| `internetFocusLines` | function | 171 | `function internetFocusLines(meters: Meter[], now: number, read: boolean): string[]` | The FOCUS lines for one site's links: every one of them, whatever its state. |
| `InternetRead` | type | 184 | `type InternetRead = \| { status: 'ok'; meters: Meter[]; /** Epoch seconds. */ generatedAt: number } /** Still...` |  |
| `readInternet` | function | 191 | `async function readInternet(waitMs = INTERNET_WAIT_MS): Promise<InternetRead>` |  |

Imports: `domain/naming.ts`, `services/assistantLines.ts`, `services/meters.ts`

Imported by: `services/assistantFocus.ts`, `services/assistantPorts.ts`, `services/assistantSnapshot.ts`, `services/assistantValues.ts`

Tests that import it: `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-internet.test.ts`, `__tests__/assistant-scope.test.ts`, `__tests__/assistant-warm.test.ts`
<!-- /gen -->

### `server/src/services/assistantLines.ts`

Turns Zabbix facts into plain prompt lines that cannot forge the data fence. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantLines.ts -->
111 lines, 12 exports. Imported by 19 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `stamp` | function | 9 | `function stamp(at: number, tz: string): string` | "17 Nov 20:10" in the zone. |
| `HOST_NAME_MAX` | constant | 15 | `const HOST_NAME_MAX = 80` | Longest host or site name, and longest problem or service name, that goes into a prompt. |
| `PROBLEM_NAME_MAX` | constant | 17 | `const PROBLEM_NAME_MAX = 200` |  |
| `promptText` | function | 23 | `function promptText(value: unknown, max = Infinity): string` | Zabbix text as one plain line: control characters and line breaks become spaces, invisible format characters go, "~~~" (the data fence) cannot... |
| `age` | function | 39 | `function age(clock: string \| number, nowSeconds: number): string` | A compact age for the snapshot: "45 min", "3h", "2d", "7d 23h". |
| `downFor` | function | 50 | `function downFor(clock: number, now: number): string` | Whole days past 48 h: "80d" says as much as "80d 20h" in fewer characters. |
| `sevName` | function | 54 | `const sevName = (sev: string \| number) =>` |  |
| `section` | function | 62 | `function section(title: string, lines: string[], budget: number, more: (left: number, shown: number) => string =...` | One titled block of whole lines, never longer than `budget` characters. |
| `severityCounts` | function | 87 | `function severityCounts(problems: ZbxProblem[]): Record<string, number>` |  |
| `severityList` | function | 94 | `function severityList(counts: Record<string, number>, skipZero = false): string` | "Disaster 0, High 10, Average 31, Warning 600", worst first. |
| `problemLine` | function | 101 | `function problemLine(p: ZbxProblem, now: number): string` |  |
| `worstFirst` | function | 110 | `const worstFirst = (a: ZbxProblem, b: ZbxProblem) =>` | Worst first, then newest. |

Imports: `domain/queries.ts`

Imported by: `services/assistant.ts`, `services/assistantAcks.ts`, `services/assistantDetail.ts`, `services/assistantFacts.ts`, `services/assistantFocus.ts`, `services/assistantHostInfo.ts`, `services/assistantInternet.ts`, `services/assistantLinks.ts`, `services/assistantMaintenance.ts`, `services/assistantMaps.ts`, `services/assistantOpen.ts`, `services/assistantPast.ts`, `services/assistantPorts.ts`, `services/assistantReports.ts`, and 5 more

Tests that import it: none
<!-- /gen -->

### `server/src/services/assistantLinks.ts`

The WAN links and the web checks, each in the words of the page that shows it, with the worst first. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantLinks.ts -->
50 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `linksSection` | function | 34 | `function linksSection(res: LinksResponse, { hostids, scope, budget, local = true }: { hostids: ReadonlySet<string> \|...` | The links, worst state first and then the slowest; `hostids` narrows them to a site or a host. |
| `webSection` | function | 46 | `function webSection(res: WebMonitoringResponse, { tz, budget }: { tz: string; budget: number }): { text: string...` |  |

Imports: `services/assistantLines.ts`, `services/links.ts`, `services/webMonitoring.ts`

Imported by: `services/assistantDetail.ts`

Tests that import it: `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-links.test.ts`
<!-- /gen -->

### `server/src/services/assistantMaintenance.ts`

The maintenance windows that are on or coming up, from Zabbix's own definitions, for a question about planned stops. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantMaintenance.ts -->
102 lines, 5 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `MaintenanceWindow` | interface | 10 | `interface MaintenanceWindow` |  |
| `MAINTENANCE_MAX` | constant | 26 | `const MAINTENANCE_MAX = 8` | The most windows one question lists. |
| `maintenanceSection` | function | 42 | `function maintenanceSection(windows: MaintenanceWindow[], { now, tz, budget, local = true, inventoryPage = true }:...` | The window as its definition says: when it is valid, which is a range and not the stop itself, and, where the periods were read, the period in... |
| `periodsAt` | function | 75 | `function periodsAt(m: ZMaintenance, now: number, tz: string): { current: { from: number; to: number } \| null; next:...` | The period of a maintenance that is in effect at `now`, and the next one, from its definition in the SLA's zone: the same expansion the derived... |
| `readMaintenance` | function | 82 | `async function readMaintenance(now: number): Promise<MaintenanceWindow[]>` |  |

Imports: `clients/zabbix.ts`, `core/config.ts`, `services/assistantLines.ts`, `sli/maintenance.ts`

Imported by: `services/assistantDetail.ts`, `services/assistantHostInfo.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-maintenance.test.ts`, `__tests__/assistant-reads.test.ts`
<!-- /gen -->

### `server/src/services/assistantMaps.ts`

What a host is linked to on Zabbix's maps, and which maps there are, cut to what the user's pages allow. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantMaps.ts -->
104 lines, 7 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `HostOnMap` | interface | 32 | `interface HostOnMap` | One map the host is on, with what it is linked to there. |
| `HostMaps` | interface | 38 | `interface HostMaps` |  |
| `MAPS_SCANNED` | constant | 46 | `const MAPS_SCANNED = 8` | The most maps one question looks through. |
| `mapsSection` | function | 59 | `function mapsSection(host: string, found: HostMaps, budget: number, local = true): { text: string; truncated: boolean }` | The label on a link of a map is free text that staff write, and so is the label of an element that is not a host: a model outside this machine is... |
| `mapListSection` | function | 70 | `function mapListSection(names: string[], budget: number): { text: string; truncated: boolean }` |  |
| `readMapNames` | function | 75 | `async function readMapNames(): Promise<string[]>` | The maps there are, by name. |
| `readHostMaps` | function | 80 | `async function readHostMaps(hostid: string, { network }: { network: boolean }): Promise<HostMaps>` | The maps that a host is on, with the elements it is linked to there. |

Imports: `core/config.ts`, `services/assistantLines.ts`, `services/maps.ts`

Imported by: `services/assistantDetail.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-maps.test.ts`, `__tests__/assistant-reads.test.ts`
<!-- /gen -->

### `server/src/services/assistantOpen.ts`

Every open problem of a site, a host or a severity, beyond the few the snapshot names, in the snapshot's own words. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantOpen.ts -->
39 lines, 3 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `floorOf` | function | 17 | `function floorOf(question: string): number \| null` | The lowest severity a question asks for, or null when it names none. |
| `OpenSectionOptions` | interface | 21 | `interface OpenSectionOptions` |  |
| `openProblemsSection` | function | 29 | `function openProblemsSection(problems: ZbxProblem[], { scope, floor, now, budget }: OpenSectionOptions): { text:...` |  |

Imports: `domain/queries.ts`, `services/assistantLines.ts`

Imported by: `services/assistantDetail.ts`

Tests that import it: `__tests__/assistant-open.test.ts`
<!-- /gen -->

### `server/src/services/assistantPast.ts`

The problems that opened in a past window, closed or not, read from Zabbix's event history and grouped by host and trigger so that a flapping link is one line. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantPast.ts -->
152 lines, 5 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `PastEvent` | interface | 11 | `interface PastEvent` | One problem occurrence: when it opened, and when it closed, or null while it is open. |
| `PastSectionOptions` | interface | 45 | `interface PastSectionOptions` |  |
| `pastSection` | function | 60 | `function pastSection(events: PastEvent[], { window, tz, now, scope, minSeverity, truncated, budget }:...` |  |
| `PAST_EVENT_LIMIT` | constant | 95 | `const PAST_EVENT_LIMIT = 500` | The most events one read takes; more is said to be cut, and the newest are kept. |
| `readPast` | function | 115 | `async function readPast(window: PastWindow, hostids: string[] \| null, minSeverity: number): Promise<{ events:...` | The problem events that opened in the window, newest first and bounded, with when each closed. |

Imports: `clients/zabbix.ts`, `services/assistantLines.ts`, `services/assistantWhen.ts`

Imported by: `services/assistantDetail.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-past.test.ts`, `__tests__/assistant-reads.test.ts`, `__tests__/chat.test.ts`
<!-- /gen -->

### `server/src/services/assistantPorts.ts`

The state of one port of a switch or firewall: its status, speed, traffic and errors, from the rows of the Network page. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantPorts.ts -->
61 lines, 5 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `portOf` | function | 14 | `function portOf(question: string): string \| null` | The port a question names, without spaces, or null. |
| `PORTS_MAX` | constant | 20 | `const PORTS_MAX = 3` | The most interfaces one question lists. |
| `PortFound` | interface | 34 | `interface PortFound` |  |
| `portsSection` | function | 49 | `function portsSection(host: string, token: string, found: PortFound, { now, budget, local = true }: { now: number...` |  |
| `readPort` | function | 56 | `async function readPort(hostid: string, token: string): Promise<PortFound>` |  |

Imports: `services/assistantInternet.ts`, `services/assistantLines.ts`, `services/net.ts`

Imported by: `services/assistantDetail.ts`, `services/assistantTopics.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-ports.test.ts`, `__tests__/assistant-reads.test.ts`
<!-- /gen -->

### `server/src/services/assistantPrompt.ts`

What the model is told: its rules, the language to answer in, and the fence around the data. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantPrompt.ts -->
128 lines, 7 exports. Imported by 6 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `CHAT_SYSTEM` | constant | 6 | `const CHAT_SYSTEM` |  |
| `detectLanguage` | function | 78 | `function detectLanguage(text: string): 'English' \| 'Bahasa Indonesia' \| null` | English or Indonesian, from the words of the message. |
| `answerLanguage` | function | 91 | `function answerLanguage(latestUserMessage: string, preferred?: 'en' \| 'id' \| null): 'en' \| 'id' \| null` | The language of an answer as a page marks it for a screen reader: the one the words of the question show, else the one the user chose, else none... |
| `languageReminder` | function | 101 | `function languageReminder(latestUserMessage: string, preferred?: 'en' \| 'id' \| null): string` | Placed after the snapshot, next to the question, where a small model heeds it. |
| `notGivenLine` | function | 113 | `const notGivenLine = (words: string[]): string =>` | The line that tells the model something was held back for this user's pages, so that it does not answer none or no about what it was never given... |
| `systemText` | function | 121 | `function systemText(snapshot: string): string` | The part of the system text that is the same for every question asked of one snapshot, and so the part Ollama can keep in its prompt cache. |
| `dataBlock` | function | 126 | `function dataBlock(label: 'SNAPSHOT' \| 'FOCUS', text: string): string` | Zabbix data fenced off from the rules around it; `promptText` keeps the fence from being forged. |

Imports: none

Imported by: `server/scripts/bakeoff/score.ts`, `services/assistant.ts`, `services/assistantAnswer.ts`, `services/assistantDetail.ts`, `services/assistantFocus.ts`, `services/assistantSnapshot.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`
<!-- /gen -->

### `server/src/services/assistantReports.ts`

The capacity, alert noise, top triggers and inventory scorecard pages in a few lines each, read at the periods the pages offer. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantReports.ts -->
90 lines, 8 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `REPORT_DAYS` | constant | 19 | `const REPORT_DAYS = 7` | The pages' default period, which a question that names none is given. |
| `daysOf` | function | 22 | `function daysOf(window: PastWindow \| null, max = 31): number` | The whole days a window covers, at least one and at most `max`, or the default when the question named none. |
| `PAGE_PERIODS` | constant | 27 | `const PAGE_PERIODS: readonly number[]` | The periods that the Capacity, Alert noise and Top triggers pages offer, so that a question shares their reads and does not make a new cold one... |
| `capacityPeriod` | function | 30 | `function capacityPeriod(days: number, offered: readonly number[]): number` | The smallest period that the Capacity page offers which covers the days, or the largest. |
| `capacitySection` | function | 51 | `function capacitySection(report: CapacityReport, { window, tz, budget, now = nowSeconds() }: { window: PastWindow \|...` | The busiest hosts of each metric by their peak, three of each. |
| `noiseSection` | function | 67 | `function noiseSection(report: NoiseReport, { window, tz, budget, now = nowSeconds() }: { window: PastWindow \| null...` |  |
| `topTriggersSection` | function | 78 | `function topTriggersSection(report: TopTriggers, { window, tz, budget, now = nowSeconds() }: { window: PastWindow \|...` |  |
| `scorecardSection` | function | 84 | `function scorecardSection(card: ScorecardResponse, budget: number): { text: string; truncated: boolean }` |  |

Imports: `services/assistantLines.ts`, `services/assistantValues.ts`, `services/assistantWhen.ts`, `services/capacity.ts`, `services/inventory.ts`, `services/noise.ts`, `services/reports.ts`

Imported by: `services/assistantDetail.ts`

Tests that import it: `__tests__/assistant-reports.test.ts`, `__tests__/assistant-words.test.ts`
<!-- /gen -->

### `server/src/services/assistantSeries.ts`

The lowest, average, highest and last of an item over a window, which are the figures that the Graphs page computes for it. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantSeries.ts -->
32 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `seriesSection` | function | 21 | `function seriesSection(graph: Graph, picks: ValueItem[], { host, window, tz, budget, local = true }: { host: string...` |  |

Imports: `services/assistantLines.ts`, `services/assistantValues.ts`, `services/assistantWhen.ts`, `services/history.ts`

Imported by: `services/assistantDetail.ts`

Tests that import it: `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-series.test.ts`
<!-- /gen -->

### `server/src/services/assistantSla.ts`

The SLA of a window other than the month the snapshot holds: a named month, a year, a week, and the hours of the day that count. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantSla.ts -->
135 lines, 6 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SlaWindow` | interface | 14 | `interface SlaWindow extends PastWindow` |  |
| `hoursOf` | function | 51 | `function hoursOf(question: string): { hours: DailyHours; text: string } \| null` | The hours of the day a question counts: "jam kerja" is 08:00 to 17:00 on weekdays, and "dari jam 8 sampai 17" or "08:00-17:00" is what it says. |
| `slaWindowOf` | function | 83 | `function slaWindowOf(question: string, now: number, tz: string): SlaWindow \| null` | The window a question about the SLA names: a month by name (the latest one that has begun, or the year it says), this year or last, or any window... |
| `snapshotHolds` | function | 112 | `function snapshotHolds(w: SlaWindow, now: number, tz: string): boolean` | Whether the snapshot already holds this window: last month or this month so far, over all the hours. |
| `slaSection` | function | 119 | `function slaSection(report: SliReport, w: SlaWindow, tz: string, budget: number): { text: string; truncated: boolean }` |  |
| `readSlaWindow` | function | 135 | `const readSlaWindow = (w: SlaWindow, signal?: AbortSignal): Promise<SliReport> =>` | The report of a window, from the months it touches; refused plainly when Zabbix cannot answer it. |

Imports: `export/slaReport.ts`, `services/assistantLines.ts`, `services/assistantWhen.ts`, `services/sli.ts`, `sli/model.ts`, `sli/time.ts`, `sli/window.ts`

Imported by: `services/assistantDetail.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-reads.test.ts`, `__tests__/assistant-sla.test.ts`, `__tests__/assistant-words.test.ts`
<!-- /gen -->

### `server/src/services/assistantSnapshot.ts`

Builds the snapshot of the estate the model answers from, as compact text within a character budget, cached by fingerprint. Walked through in [Server: domain and hosts](server-domain-and-hosts.md), [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantSnapshot.ts -->
571 lines, 17 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SectionKey` | type | 25 | `type SectionKey = 'estate' \| 'whole' \| 'sites' \| 'recent' \| 'unreachable' \| 'internet' \| 'sla' \| 'services' \| 'problems'` | The parts of the estate text, in the order the model reads them. |
| `SECTION_MODULES` | constant | 31 | `const SECTION_MODULES: Readonly<Record<SectionKey, readonly ModuleId[]>>` | The modules whose pages show what each part says, so that a user is shown, and so the model can answer from, only what their own pages show them... |
| `ALL_SECTIONS` | constant | 45 | `const ALL_SECTIONS: readonly SectionKey[]` |  |
| `sectionsFor` | function | 48 | `const sectionsFor = (modules: ReadonlySet<string>): SectionKey[] =>` | The parts a user who holds these modules may be shown, in reading order. |
| `withheldLine` | function | 67 | `function withheldLine(shown: readonly SectionKey[]): string \| null` | The line that tells the model which parts of the estate this user's pages do not show, so that a question about one is answered with "this account... |
| `mayFocus` | function | 73 | `const mayFocus = (modules: ReadonlySet<string>): boolean =>` | Whether the focus on a site or a host may be given: the pages that show hosts and sites. |
| `mayInternet` | function | 76 | `const mayInternet = (modules: ReadonlySet<string>): boolean =>` | Whether the internet links of a site may be given in its focus: the same pages as the part of the snapshot that holds them. |
| `SnapshotMeta` | interface | 78 | `interface SnapshotMeta` |  |
| `Snapshot` | interface | 92 | `interface Snapshot` |  |
| `SNAPSHOT_CHAR_CAP` | constant | 113 | `const SNAPSHOT_CHAR_CAP = 6_200` | Budgets. |
| `snapshotZone` | function | 194 | `function snapshotZone(): string` | The SLA zone the snapshot clock shows; a name Intl rejects must not take the Assistant down. |
| `snapshotTime` | function | 209 | `function snapshotTime(clock: number): string` | "15:00" in the SLA zone. |
| `snapshotClock` | function | 214 | `function snapshotClock(at: Date): string` | "Wed, 7 Oct 2026, 15:00 WIB (Asia/Jakarta)": the Indonesian locale names WIB, WITA and WIT, other zones get e.g. |
| `buildSnapshot` | function | 240 | `async function buildSnapshot(visible: readonly SectionKey[] = ALL_SECTIONS): Promise<Snapshot>` | The estate as compact plain text. |
| `SNAPSHOT_KEY` | constant | 492 | `const SNAPSHOT_KEY` |  |
| `snapshotFingerprint` | function | 514 | `function snapshotFingerprint(problems: ZbxProblem[], sites: Site[]): string` | What must not change under a frozen snapshot: each open problem's id, severity and acknowledgement (before the dot), and each host's state (after it). |
| `getSnapshot` | function | 542 | `async function getSnapshot(visible: readonly SectionKey[] = ALL_SECTIONS): Promise<Snapshot & { frozen: boolean }>` | The snapshot to answer from, reused for up to five minutes. |

Imports: `core/cache.ts`, `core/config.ts`, `domain/naming.ts`, `domain/queries.ts`, `domain/siteOf.ts`, `export/slaReport.ts`, `security/modules.ts`, `services/assistantFacts.ts`, `services/assistantInternet.ts`, `services/assistantLines.ts`, `services/assistantPrompt.ts`, `services/services.ts`, `services/sites.ts`, `services/sla.ts`, `sli/summary.ts`

Packages: `node:crypto`

Imported by: `services/assistant.ts`, `services/assistantDetail.ts`, `services/assistantFocus.ts`, `services/explain.ts`

Tests that import it: none
<!-- /gen -->

### `server/src/services/assistantTopics.ts`

What a question wants beyond the snapshot, read from its English or Bahasa Indonesia words: values, a past time, host details or a person. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantTopics.ts -->
160 lines, 5 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Metric` | type | 10 | `type Metric = 'cpu' \| 'memory' \| 'temperature' \| 'disk' \| 'traffic' \| 'uptime' \| 'latency'` |  |
| `internetAsked` | function | 74 | `const internetAsked = (question: string): boolean =>` |  |
| `Topics` | interface | 76 | `interface Topics` |  |
| `topicsOf` | function | 117 | `function topicsOf(question: string): Topics` |  |
| `aboutAThing` | function | 160 | `const aboutAThing = (t: Topics): boolean =>` | Whether a question asks about one thing, a host or a site, so that a follow-up with no name is about the one before it, and not about the whole... |

Imports: `services/assistantPorts.ts`, `services/assistantWhen.ts`

Imported by: `services/assistantDetail.ts`, `services/assistantFocus.ts`, `services/assistantValues.ts`

Tests that import it: `__tests__/assistant-topics.test.ts`, `__tests__/assistant-words.test.ts`
<!-- /gen -->

### `server/src/services/assistantValues.ts`

The latest values of a host, or the highest across the hosts of a site, read only for the metrics the question names and never an old reading as a current one. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantValues.ts -->
291 lines, 11 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ValueItem` | interface | 16 | `interface ValueItem` | One numeric item of a host, with what is needed to say how current it is. |
| `valueText` | function | 57 | `function valueText(value: string, units: string): string` | A value with its unit, written the way the pages write it. |
| `itemName` | function | 84 | `function itemName(name: string, local: boolean): string` | An item's name for the prompt. |
| `HostValuesOptions` | interface | 132 | `interface HostValuesOptions` |  |
| `hostValuesSection` | function | 146 | `function hostValuesSection({ host, items, asked, now, readAt, budget, local = true }: HostValuesOptions): { text:...` | The values of one host, a line for each metric the question named. |
| `SiteValuesOptions` | interface | 152 | `interface SiteValuesOptions` |  |
| `siteValuesSection` | function | 168 | `function siteValuesSection({ site, items, metric, hostCount, readAt, budget, local = true }: SiteValuesOptions):...` | The highest of one metric across the hosts of a site: the highest item of each host with a current reading, highest first. |
| `topHostItems` | function | 184 | `function topHostItems(top: TopHostsResponse, metric: 'cpu' \| 'memory', hostids: ReadonlySet<string>): ValueItem[]` | The Top hosts rows of the hosts of a site, as items, so that a site's CPU and memory are worded like every other site value. |
| `topHostsLines` | function | 192 | `function topHostsLines(top: TopHostsResponse, asked: Metric[], readAt: string, limit: number): string[]` | The busiest hosts by CPU and by memory, from the Dashboard's Top hosts widget, for a question that names no host. |
| `ReadValuesOptions` | interface | 240 | `interface ReadValuesOptions` |  |
| `readHostValues` | function | 246 | `async function readHostValues(hosts: { hostid: string; name: string }[], asked: Metric[], { network, now }:...` |  |

Imports: `clients/zabbix.ts`, `domain/naming.ts`, `domain/reachability.ts`, `security/viewerPolicy.ts`, `services/assistantInternet.ts`, `services/assistantLines.ts`, `services/assistantTopics.ts`, `services/topHosts.ts`

Imported by: `services/assistantDetail.ts`, `services/assistantReports.ts`, `services/assistantSeries.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-reads.test.ts`, `__tests__/assistant-values.test.ts`
<!-- /gen -->

### `server/src/services/assistantWhen.ts`

The time a question is about, read from English and Bahasa Indonesia words and cut as an exact window in the SLA time zone. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/assistantWhen.ts -->
164 lines, 4 exports. Imported by 7 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `PastWindow` | interface | 9 | `interface PastWindow` |  |
| `MAX_WINDOW_DAYS` | constant | 18 | `const MAX_WINDOW_DAYS = 31` | The furthest back a window goes; the events behind it are read from Zabbix on the spot. |
| `windowOf` | function | 146 | `function windowOf(question: string, now: number, tz: string, maxDays = MAX_WINDOW_DAYS): PastWindow \| null` | The time a question is about, as an exact window. |
| `windowWords` | function | 164 | `const windowWords = (w: PastWindow, tz: string): string =>` | The window as the prompt says it, with its exact ends: "last night, from Tue 17 Nov 18:00 to Wed 18 Nov 06:00 (Asia/Jakarta)". |

Imports: `sli/time.ts`

Imported by: `services/assistantAcks.ts`, `services/assistantDetail.ts`, `services/assistantPast.ts`, `services/assistantReports.ts`, `services/assistantSeries.ts`, `services/assistantSla.ts`, `services/assistantTopics.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-past.test.ts`, `__tests__/assistant-when.test.ts`, `__tests__/assistant-words.test.ts`
<!-- /gen -->

### `server/src/services/availability.ts`

The availability report: how much of a window each host spent in a problem state. Walked through in [Server: routes](server-routes.md), [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/services/availability.ts -->
185 lines, 7 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `HostAvailability` | interface | 12 | `interface HostAvailability` |  |
| `AvailabilityBasis` | type | 34 | `type AvailabilityBasis = 'availability' \| 'all-problems'` | `availability` (the default) measures what availability means: a device unreachable or losing pings: through the SLA engine, and leaves out hours... |
| `AvailabilityReport` | interface | 36 | `interface AvailabilityReport` |  |
| `getDerivedAvailability` | function | 61 | `async function getDerivedAvailability(opts: { days: number; month?: string; profile: SliProfile; minSeverity:...` | Availability through the SLA engine: a device counts as down while its ICMP availability triggers are in problem, and hours with no collected data... |
| `getAvailability` | function | 108 | `async function getAvailability(days: number, minSeverity: number, month?: string): Promise<AvailabilityReport>` | The original report: any open problem at or above the floor counts as downtime. |
| `getAllProblemsAvailabilityReport` | function | 149 | `function getAllProblemsAvailabilityReport(days: number, minSeverity: number, month?: string, signal?: AbortSignal)` | The original any-problem availability report, for the last `days` or for one `month`. |
| `getDerivedAvailabilityReport` | function | 168 | `async function getDerivedAvailabilityReport(opts: { days: number; month?: string; profile: SliProfile; minSeverity:...` | The availability report derived from ICMP ping triggers: a month is cached by the engine itself, a rolling window moves with now. |

Imports: `core/cache.ts`, `core/config.ts`, `domain/naming.ts`, `services/incidents.ts`, `services/reportPolicy.ts`, `services/sli.ts`, `sli/engine.ts`, `sli/intervals.ts`

Imported by: `routes/analytics.ts`

Tests that import it: `__tests__/availability-window.test.ts`, `__tests__/availability.test.ts`, `__tests__/incidents-before-window.test.ts`
<!-- /gen -->

### `server/src/services/capacity.ts`

The capacity report: processor, memory, disk and interface use per host over a number of days, from trends. Walked through in [Server: network and capacity](server-network-and-capacity.md), [Server: routes](server-routes.md).

<!-- gen:card server/src/services/capacity.ts -->
353 lines, 8 exports. Imported by 5 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `capacityMetricFor` | function | 72 | `function capacityMetricFor(key: string): string \| undefined` | Exported for tests: which keys each capacity metric picks up. |
| `CapacityRow` | interface | 76 | `interface CapacityRow` |  |
| `CapacityReport` | interface | 90 | `interface CapacityReport` |  |
| `getCapacity` | function | 109 | `async function getCapacity(days: number, top: number): Promise<CapacityReport>` |  |
| `CAPACITY_DAYS` | constant | 335 | `const CAPACITY_DAYS = 7` | What the report covers when the page does not say: the days, and the hosts listed for each metric. |
| `CAPACITY_TOP` | constant | 336 | `const CAPACITY_TOP = 10` |  |
| `CAPACITY_PERIODS` | constant | 338 | `const CAPACITY_PERIODS: readonly number[]` | The periods the Capacity page offers (web/src/features/reports/Capacity.tsx); a test holds the two lists equal. |
| `getCapacityReport` | function | 344 | `function getCapacityReport(days: number, top: number, signal?: AbortSignal)` | The busiest hosts by CPU, memory and so on over `days`. |

Imports: `clients/zabbix.ts`, `core/cache.ts`, `core/config.ts`, `services/reportPolicy.ts`, `sli/events.ts`

Imported by: `routes/analytics.ts`, `services/assistantDetail.ts`, `services/assistantReports.ts`, `services/topHosts.ts`, `services/warmUp.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-reads.test.ts`, `__tests__/capacity-branches.test.ts`, `__tests__/capacity-peak.test.ts`, `__tests__/light-reads.test.ts`, `__tests__/sli-routes.test.ts`, `__tests__/viewer-reports-typed.test.ts`
<!-- /gen -->

### `server/src/services/chat.ts`

The Assistant endpoint's logic: turns, history budget, warm slot and the streamed reply. Walked through in [Server: live and assistant](server-live-and-assistant.md), [Server: routes](server-routes.md).

<!-- gen:card server/src/services/chat.ts -->
124 lines, 6 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `HISTORY_CHAR_BUDGET` | constant | 33 | `const HISTORY_CHAR_BUDGET = 3_000` |  |
| `claimWarmSlot` | function | 40 | `function claimWarmSlot(now = Date.now()): boolean` | True when the model is due a load, and claims the slot so the next call within the window is not. |
| `noteModelRead` | function | 56 | `function noteModelRead(system: string): void` | The model has read this system text in full, by answering from it. |
| `warmAndPrefill` | function | 68 | `async function warmAndPrefill(log: FastifyBaseLogger, load: boolean): Promise<void>` | Load the model (when due) while the snapshot is fetched, then have the model read the system text the next question will start with. |
| `publicMessage` | function | 91 | `function publicMessage(err: unknown): string` | Typed AI errors carry wording for a reader (their `detail` is for the log), a Zabbix failure is errors.ts's one sentence, and anything else is a bug. |
| `parseTurns` | function | 99 | `function parseTurns(body: unknown): ChatTurn[] \| null` |  |

Imports: `clients/ai.ts`, `clients/zabbix.ts`, `http/errors.ts`, `services/assistant.ts`, `services/topHosts.ts`

Packages: `fastify`, `node:crypto`

Imported by: `routes/chat.ts`

Tests that import it: `__tests__/chat.test.ts`, `__tests__/plain-wording.test.ts`
<!-- /gen -->

### `server/src/services/closedWeb.ts`

Keeps the web check figures of a closed month as first read, and reads the month that has just closed once an hour. Walked through in [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/services/closedWeb.ts -->
113 lines, 5 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `setClosedWebLogger` | function | 19 | `function setClosedWebLogger(next: LineLog \| null): void` | Where the failures of this module are written (index.ts); until then they are not. |
| `freezeWeb` | function | 28 | `async function freezeWeb(report: SliReport): Promise<SliReport>` | The report of a closed month with its web check figures as kept: the first read keeps them, a later one gives them back. |
| `CaptureDeps` | interface | 51 | `interface CaptureDeps` |  |
| `ClosedMonthCapture` | interface | 61 | `interface ClosedMonthCapture` |  |
| `createClosedMonthCapture` | function | 71 | `function createClosedMonthCapture(deps: CaptureDeps): ClosedMonthCapture` | Reads the month that has just closed once it has settled, so that the figures kept are those of that day and not of whoever opens the page first. |

Imports: `services/closedWebStore.ts`, `sli/engine.ts`, `sli/schedule.ts`, `sli/time.ts`

Imported by: `index.ts`, `services/sli.ts`

Tests that import it: `__tests__/closed-web-freeze.test.ts`
<!-- /gen -->

### `server/src/services/closedWebStore.ts`

The file `closed-months.json` that holds those figures. Walked through in [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/services/closedWebStore.ts -->
151 lines, 9 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `KeptWeb` | interface | 12 | `interface KeptWeb` |  |
| `ClosedWebStore` | interface | 18 | `interface ClosedWebStore` |  |
| `MAX_MONTHS_KEPT` | constant | 28 | `const MAX_MONTHS_KEPT = 36` | Three years: far more than the year of events Zabbix holds, and a few kilobytes of file. |
| `readClosedWeb` | function | 52 | `function readClosedWeb(raw: unknown): { months: Record<string, KeptWeb>; repairs: string[]; usable: boolean }` | What a file holds: the months that read well, a line for each that did not, and whether the file is of a kind this build reads at all. |
| `memoryClosedWeb` | function | 72 | `const memoryClosedWeb = (): ClosedWebStore =>` | What a portal with no data folder runs on, and what the tests start from: it keeps nothing, and says it is not durable. |
| `openClosedWeb` | function | 100 | `async function openClosedWeb(dir: string, warn: (message: string) => void): Promise<ClosedWebStore>` | Opens the file in `dir`, or a store in memory alone when `dir` is empty or cannot be used. |
| `closedWeb` | function | 141 | `const closedWeb = (): ClosedWebStore =>` | The one store, opened at start-up (index.ts) from PORTAL_STATE_DIR. |
| `initClosedWeb` | function | 143 | `async function initClosedWeb(warn: (message: string) => void): Promise<ClosedWebStore>` |  |
| `useClosedWeb` | hook | 149 | `function useClosedWeb(store: ClosedWebStore): void` | For the tests: put a store of their own in place. |

Imports: `core/config.ts`, `core/state.ts`, `sli/engine.ts`

Packages: `node:fs`, `node:path`

Imported by: `index.ts`, `services/closedWeb.ts`

Tests that import it: `__tests__/closed-web-freeze.test.ts`, `__tests__/closed-web-store.test.ts`
<!-- /gen -->

### `server/src/services/devices.ts`

Every host as a device of one kind, for the Devices page. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/services/devices.ts -->
47 lines, 3 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `CLASS_ORDER` | constant | 13 | `const CLASS_ORDER: readonly DeviceClass[]` | The order the page lists the kinds in. |
| `getDevices` | function | 24 | `async function getDevices()` |  |
| `devicesView` | function | 47 | `const devicesView = () =>` | The Devices page as its route and the warm-up read it. |

Imports: `clients/zabbix.ts`, `core/cache.ts`, `domain/naming.ts`, `services/hosts.ts`, `sli/engine.ts`

Imported by: `routes/devices.ts`, `services/warmUp.ts`

Tests that import it: `__tests__/devices-route.test.ts`, `__tests__/site-resolver.test.ts`
<!-- /gen -->

### `server/src/services/explain.ts`

The plain-language layer: reads one problem or one SLA figure and asks the model to explain it. Walked through in [Server: domain and hosts](server-domain-and-hosts.md), [Server: live and assistant](server-live-and-assistant.md), [Server: routes](server-routes.md).

<!-- gen:card server/src/services/explain.ts -->
232 lines, 10 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SlaAnswer` | type | 21 | `type SlaAnswer = SlaExplanation & { noData?: boolean }` | An explanation that may say "there is nothing to measure" without a model call. |
| `noDataExplanation` | function | 28 | `function noDataExplanation(what: string, why: string, recommendation: string): SlaAnswer` | With nothing measured, the only honest answer is "no data". |
| `pct` | function | 39 | `function pct(n: number, target?: number): string` | A percentage to three decimals: a figure under 100 does not round up to 100, and one under the target does not round up to it (BK-46, BK-56). |
| `pickScope` | function | 62 | `function pickScope(report: SliReport, scope: string): { group: SliGroup; hosts: SliHost[] } \| null` | One scope of a derived report: the whole estate, a site, or a report category. |
| `minutes` | function | 79 | `const minutes = (seconds: number \| null) =>` |  |
| `SLA_PERIODS` | constant | 81 | `const SLA_PERIODS: Record<string, string>` |  |
| `NotFound` | interface | 90 | `interface NotFound` | The thing asked about is not there: the route answers 404 with this wording. |
| `explainProblem` | function | 101 | `async function explainProblem(eventid: string, onUsage: OnUsage, signal?: AbortSignal, language?: Language):...` | Tags and notification wording for one problem. |
| `explainDerivedSla` | function | 137 | `async function explainDerivedSla({ month, profile, scope }: { month: string; profile: SliProfile; scope: string }...` | The derived monthly SLA of one scope (overall \| site:N \| category:NAME), in plain language. |
| `explainZabbixSla` | function | 200 | `async function explainZabbixSla(slaid: string, serviceid: string \| undefined, onUsage: OnUsage, signal?:...` | One Zabbix SLA's standing in the current period, in plain language. |

Imports: `clients/ai.ts`, `core/cache.ts`, `core/config.ts`, `domain/queries.ts`, `services/assistantLines.ts`, `services/assistantSnapshot.ts`, `services/sla.ts`, `services/sli.ts`, `sli/engine.ts`

Imported by: `routes/explain.ts`

Tests that import it: `__tests__/explain-figure.test.ts`, `__tests__/explain-problem.test.ts`, `__tests__/explain-prompt-fence.test.ts`, `__tests__/explain-reader-left.test.ts`, `__tests__/explain-route-signal.test.ts`, `__tests__/sli-routes.test.ts`, `__tests__/usage-log-sla.test.ts`
<!-- /gen -->

### `server/src/services/history.ts`

The graph pipeline: reads history or trends in pages and returns chart-ready series. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/services/history.ts -->
357 lines, 16 exports, 1 re-export. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `DAY` | constant | 11 | `const DAY = 86_400` |  |
| `HISTORY_PAGE` | constant | 13 | `const HISTORY_PAGE = 100_000` | history.get page size. |
| `HISTORY_FILL_WINDOW` | constant | 17 | `const HISTORY_FILL_WINDOW = 7 * DAY` | How far back history may stand in for missing trend rows (the trend stall). |
| `GraphPoint` | type | 21 | `type GraphPoint = [number, number \| null, number \| null, number \| null]` | [ms, avg, min, max], min/max are null for raw (un-aggregated) history. |
| `ZGraphItem` | interface | 23 | `interface ZGraphItem` |  |
| `Sample` | interface | 38 | `interface Sample` | One raw sample in a common shape: a history value is an aggregate of one (num 1, min = max = value); a trend row carries its own hour's aggregate. |
| `parseDelay` | re-export | 48 |  |  |
| `STEP_KEY` | constant | 50 | `const STEP_KEY = /^(icmpping\b\|icmpping\[\|net\.if\.status\|web\.test\.fail)/` |  |
| `median` | function | 52 | `function median(values: number[]): number` |  |
| `fetchHistory` | function | 59 | `async function fetchHistory(itemid: string, valueType: number, from: number, to: number): Promise<{ clock: string...` | history.get for one item over [from, to], halving the window whenever a page comes back full. |
| `historySample` | function | 84 | `const historySample = (r: { clock: string; value: string }): Sample \| null =>` |  |
| `shapeSeries` | function | 102 | `function shapeSeries(samples: Sample[], opts: { from: number; to: number; points: number; delay: number; withBand:...` | Samples → chart points. |
| `seriesStats` | function | 158 | `function seriesStats(samples: Sample[])` |  |
| `seriesCoverage` | function | 174 | `function seriesCoverage(samples: Sample[], from: number, to: number, delay: number)` |  |
| `parseItemIds` | function | 191 | `function parseItemIds(raw: unknown): string[]` |  |
| `parseRange` | function | 203 | `function parseRange(q: Record<string, string \| undefined>, now: number): { from: number; to: number }` |  |
| `getGraph` | function | 235 | `function getGraph({ ids, from, to, points, now }: { ids: string[]; from: number; to: number; points: number; now:...` | Chart-ready series for 1 to 4 numeric items over a pinned window. |

Imports: `clients/zabbix.ts`, `core/cache.ts`, `core/config.ts`, `core/delay.ts`, `core/validate.ts`, `sli/events.ts`, `sli/time.ts`

Imported by: `routes/history.ts`, `services/assistantDetail.ts`, `services/assistantSeries.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-reads.test.ts`, `__tests__/delay.test.ts`, `__tests__/graphs.test.ts`, `__tests__/typed-keys.test.ts`
<!-- /gen -->

### `server/src/services/hosts.ts`

Hosts, host groups, a host's items and the latest data, with the page limits. Walked through in [One request, from start to finish](one-request.md), [Server: domain and hosts](server-domain-and-hosts.md), [Server: routes](server-routes.md).

<!-- gen:card server/src/services/hosts.ts -->
227 lines, 17 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `LATEST_LIMIT` | constant | 10 | `const LATEST_LIMIT = 500` | One page of Latest data (legacy, un-paged). |
| `LATEST_ID_LIMIT` | constant | 12 | `const LATEST_ID_LIMIT = 20_000` | Paged Latest data: most item ids read in the light first pass. |
| `MAX_ITEMIDS` | constant | 14 | `const MAX_ITEMIDS = 50` | Most items one /api/items?itemids= request may resolve. |
| `LATEST_OUTPUT` | constant | 16 | `const LATEST_OUTPUT` |  |
| `ZItem` | interface | 28 | `interface ZItem` |  |
| `isGraphable` | function | 37 | `const isGraphable = (i: ZItem) =>` | Numeric (float/uint), enabled, supported, what a line chart can draw. |
| `ZHost` | interface | 42 | `interface ZHost` |  |
| `getHostOverview` | function | 55 | `async function getHostOverview()` | Each host with its live problem counts and its reachability state (ping first; reachability.ts). |
| `getHosts` | function | 86 | `function getHosts()` | All hosts (+ interfaces w/ availability). |
| `getHostGroups` | function | 100 | `function getHostGroups()` | Host groups (for filters). |
| `ItemQuery` | interface | 106 | `interface ItemQuery` |  |
| `findItems` | function | 119 | `function findItems({ hostid, itemids, search, graphable }: ItemQuery)` | Items for one host, powers the graph item picker (or specific items of any host, which resolves a deep link). |
| `LatestFilter` | interface | 148 | `interface LatestFilter` | The ids a Latest data request narrows to; Zabbix needs one of them to bound the result set. |
| `LatestPageQuery` | interface | 153 | `interface LatestPageQuery` |  |
| `getLatestPage` | function | 168 | `function getLatestPage({ filter, hostid, groupid, needle: typedNeedle, page, pageSize, hide }: LatestPageQuery)` | Latest data, paged server-side: one light read of every matching id+name (search covers name OR key), sorted naturally, then full details for just... |
| `getLatestItems` | function | 205 | `function getLatestItems(filter: LatestFilter, hostid: string \| undefined, groupid: string \| undefined, search:...` | Latest data without `page`: the original first-500 read, kept for older callers. |
| `hostsOverviewView` | function | 227 | `const hostsOverviewView = () =>` | The Hosts overview as its route, the Devices page and the warm-up read it. |

Imports: `clients/zabbix.ts`, `core/cache.ts`, `domain/naming.ts`, `domain/queries.ts`, `domain/reachability.ts`, `security/viewerPolicy.ts`, `services/sites.ts`

Imported by: `routes/hosts.ts`, `services/devices.ts`, `services/warmUp.ts`

Tests that import it: `__tests__/site-resolver.test.ts`, `__tests__/typed-keys.test.ts`
<!-- /gen -->

### `server/src/services/incidents.ts`

Problem occurrences over a window, read once for the availability and noise reports, including outages that began before it. Walked through in [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/services/incidents.ts -->
277 lines, 8 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `severitiesAtLeast` | function | 15 | `function severitiesAtLeast(min: number): number[]` | Zabbix severity levels at or above `min`, for `event.get`'s `severities`. |
| `Incident` | interface | 25 | `interface Incident` | One resolved problem occurrence. |
| `ReportWindow` | interface | 44 | `interface ReportWindow` | A report window in Unix seconds. |
| `lastDays` | function | 50 | `function lastDays(days: number): ReportWindow` | The last `days` days, up to now. |
| `monthWindow` | function | 60 | `function monthWindow(month: string): ReportWindow` | A calendar month, cut in the SLA time zone (Asia/Jakarta) like every monthly figure in the portal, and clipped to now: the current month is... |
| `OPEN_AT_START_LOOKBACK` | constant | 76 | `const OPEN_AT_START_LOOKBACK = 31 * 86400` | How far before a window to read PROBLEM events, to find the ones already open when it began. |
| `LONG_OUTAGE_LOOKUPS` | constant | 84 | `const LONG_OUTAGE_LOOKUPS = 200` | Most triggers whose older problem is looked up one by one in a single report. |
| `fetchIncidents` | function | 202 | `async function fetchIncidents({ from, to }: ReportWindow, minSeverity: number): Promise<{ incidents: Incident[]...` | Replay event history into incidents, clipped to the window. |

Imports: `clients/zabbix.ts`, `core/config.ts`, `sli/events.ts`, `sli/time.ts`

Imported by: `services/availability.ts`, `services/noise.ts`

Tests that import it: `__tests__/availability.test.ts`, `__tests__/heavy-reports.test.ts`, `__tests__/incidents-before-window.test.ts`, `__tests__/noise-large.test.ts`, `__tests__/period-window.test.ts`, `__tests__/routes.test.ts`
<!-- /gen -->

### `server/src/services/inventory.ts`

The inventory and ownership scorecard: which hosts lack an owner, a site or a criticality. Walked through in [Server: routes](server-routes.md), [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/services/inventory.ts -->
182 lines, 6 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `DimensionKey` | type | 21 | `type DimensionKey = 'naming' \| 'site' \| 'owner' \| 'criticality'` |  |
| `Dimension` | interface | 23 | `interface Dimension` |  |
| `HostGap` | interface | 35 | `interface HostGap` |  |
| `GroupScore` | interface | 43 | `interface GroupScore` |  |
| `ScorecardResponse` | interface | 50 | `interface ScorecardResponse` |  |
| `getScorecard` | function | 75 | `async function getScorecard(): Promise<ScorecardResponse>` |  |

Imports: `core/cache.ts`, `core/config.ts`, `domain/queries.ts`, `services/sites.ts`

Imported by: `routes/inventory.ts`, `services/assistantDetail.ts`, `services/assistantReports.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-reads.test.ts`, `__tests__/inventory-site-hint.test.ts`
<!-- /gen -->

### `server/src/services/links.ts`

Link and WAN health: one ICMP path per link, with its loss and response time. Walked through in [Server: network and capacity](server-network-and-capacity.md), [Server: routes](server-routes.md).

<!-- gen:card server/src/services/links.ts -->
256 lines, 7 exports. Imported by 5 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `LinkState` | type | 20 | `type LinkState = 'up' \| 'degraded' \| 'down' \| 'unknown'` |  |
| `Link` | interface | 22 | `interface Link` |  |
| `LinkPath` | interface | 44 | `interface LinkPath` |  |
| `LinksResponse` | interface | 51 | `interface LinksResponse` |  |
| `toMs` | function | 92 | `const toMs = (seconds?: number) =>` | Seconds → milliseconds, rounded to 2 dp so float tails never reach the API. |
| `getLinks` | function | 128 | `async function getLinks(): Promise<LinksResponse>` |  |
| `linksView` | function | 256 | `const linksView = () =>` | Links as the route and the warm-up read them. |

Imports: `clients/zabbix.ts`, `core/cache.ts`, `core/config.ts`, `domain/naming.ts`, `domain/reachability.ts`

Imported by: `routes/links.ts`, `services/assistantDetail.ts`, `services/assistantFocus.ts`, `services/assistantLinks.ts`, `services/warmUp.ts`

Tests that import it: `__tests__/api-hygiene.test.ts`, `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-reads.test.ts`, `__tests__/assistant-warm.test.ts`, `__tests__/surface.test.ts`
<!-- /gen -->

### `server/src/services/mailState.ts`

What the portal remembers about email: the list of people a report goes to, which starts as the list in the settings and is the portal's own once someone saves one, and a short record of each send. A record holds counts and never an address.

<!-- gen:card server/src/services/mailState.ts -->
40 lines, 5 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `savedRecipients` | function | 10 | `function savedRecipients(): string[]` |  |
| `saveRecipients` | function | 15 | `async function saveRecipients(list: string[]): Promise<void>` |  |
| `ListInUseError` | class | 20 | `class ListInUseError extends Error` | The list is the one thing the monthly send has to go to, so it cannot be emptied now. |
| `clearRecipients` | function | 27 | `async function clearRecipients(inUse: (state: PortalState) => boolean = () => false): Promise<number>` | Empties the portal's own list, so the one MAIL_TO started with applies again. |
| `addSend` | function | 38 | `async function addSend(record: SendRecord): Promise<void>` | Adds a record of a send. |

Imports: `core/config.ts`, `core/state.ts`, `services/portalState.ts`

Imported by: `routes/sliMail.ts`, `routes/sliSchedule.ts`

Tests that import it: none
<!-- /gen -->

### `server/src/services/maps.ts`

Zabbix maps with their host labels filled in, and the network elements left out for viewers. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/services/maps.ts -->
160 lines, 7 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ZMapDetail` | interface | 14 | `interface ZMapDetail` |  |
| `ZMapHost` | interface | 19 | `interface ZMapHost` |  |
| `resolveLabel` | function | 33 | `function resolveLabel(label: string, host?: ZMapHost): string` | Expand the host macros Zabbix map labels are written in. |
| `withoutNetworkElements` | function | 58 | `function withoutNetworkElements<M extends { selements?: ZSelement[]; links?: unknown }>(maps: M[], hostIds: readonly...` | A viewer's copy of a map: without the elements that are network hosts or network host groups, and without the links that end at one. |
| `networkHostIds` | function | 83 | `function networkHostIds(): Promise<string[]>` | The ids of the hosts in the network host groups (NET_GROUP_IDS); none when no group is named. |
| `getMapDetail` | function | 95 | `function getMapDetail(mapid: string)` | One map with its elements + links (topology). |
| `getMaps` | function | 156 | `function getMaps()` | Monitoring → Maps: list available network maps. |

Imports: `clients/zabbix.ts`, `core/cache.ts`, `core/config.ts`, `domain/queries.ts`

Imported by: `routes/maps.ts`, `services/assistantMaps.ts`

Tests that import it: `__tests__/assistant-maps.test.ts`, `__tests__/routes.test.ts`, `__tests__/typed-keys.test.ts`, `__tests__/viewer-network.test.ts`
<!-- /gen -->

### `server/src/services/meters.ts`

The internet traffic meters, read from the gauge widgets of a Zabbix dashboard. Walked through in [Server: network and capacity](server-network-and-capacity.md), [Server: routes](server-routes.md).

<!-- gen:card server/src/services/meters.ts -->
568 lines, 28 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ZoneLevel` | type | 16 | `type ZoneLevel = 'none' \| 'low' \| 'ok' \| 'warn' \| 'critical'` | What a zone's colour means. |
| `MeterZone` | interface | 18 | `interface MeterZone` |  |
| `MeterState` | type | 24 | `type MeterState = \| 'ok' /** An old reading: the value and its time are still given. */ \| 'stale' /** The item...` |  |
| `MeterDirection` | type | 37 | `type MeterDirection = 'in' \| 'out' \| null` |  |
| `LinkStatus` | type | 43 | `type LinkStatus = 'up' \| 'down' \| 'unknown'` | From the interface's own status item (IF-MIB ifOperStatus). |
| `OtherDirection` | interface | 49 | `interface OtherDirection` | The same interface the other way, on the gauge's own scale, so a link that is full in the other direction does not read Low. |
| `Meter` | interface | 60 | `interface Meter` |  |
| `MeterDefinition` | interface | 90 | `interface MeterDefinition` | One gauge widget as the dashboard holds it, before the item it points at is known. |
| `ZDashboard` | interface | 110 | `interface ZDashboard` |  |
| `definitionsFrom` | function | 125 | `function definitionsFrom(dashboard: ZDashboard): MeterDefinition[]` | The gauge widgets in the order a person reads the pages (page by page, top row down, left to right), one meter per item: a later page that repeats... |
| `parseScale` | function | 170 | `function parseScale(text: string \| undefined, units: string): number \| null` | A scale number as a widget writes it, plain or with a K, M, G or T suffix (1,000s for rates, 1,024s for bytes). |
| `levelOfColor` | function | 184 | `function levelOfColor(hex: string): ZoneLevel` | What a zone's colour means; only the meaning is kept, as the page draws its own palette. |
| `buildZones` | function | 210 | `function buildZones(thresholds: { value: number; color: string }[], min: number): MeterZone[]` | The zones of a scale from its thresholds, lowest first; below the first threshold, if it is above the minimum, is `none`. |
| `zoneOf` | function | 220 | `function zoneOf(value: number, zones: MeterZone[]): ZoneLevel` | The zone a value falls in: the last one that starts at or below it. |
| `directionOf` | function | 226 | `function directionOf(key: string \| undefined): MeterDirection` |  |
| `MeterItem` | interface | 233 | `interface MeterItem` |  |
| `Reading` | interface | 244 | `interface Reading` |  |
| `linkOf` | function | 250 | `function linkOf(status: number \| null \| undefined): LinkStatus` | 1 is up, 2 (down) and 7 (lowerLayerDown) are dead, as the Network page counts them; anything else claims nothing. |
| `Siblings` | interface | 257 | `interface Siblings` | What the interface's other items say; a reading is given only while it is current. |
| `otherOf` | function | 263 | `function otherOf(direction: MeterDirection, found: Siblings['other'], scale: { min: number; max: number \| null...` | Null for a gauge with no direction or no opposite item. |
| `buildMeter` | function | 286 | `function buildMeter(def: MeterDefinition, item: MeterItem \| undefined, reading: Reading \| null, fresh: boolean...` | One meter from its widget, its item and the item's newest reading; `fresh` (reachability.ts) says whether that is current. |
| `MetersSummary` | interface | 345 | `interface MetersSummary` |  |
| `summarise` | function | 361 | `function summarise(meters: Meter[]): MetersSummary` |  |
| `MetersResponse` | interface | 377 | `interface MetersResponse` |  |
| `SiblingIds` | interface | 413 | `interface SiblingIds` | The items beside one widget's item: the same interface's status, and the item of the opposite direction. |
| `pairSiblings` | function | 427 | `function pairSiblings(mains: Keyed[], found: Keyed[]): Record<string, SiblingIds>` | For each widget item, the status item and the opposite direction of the same interface (same host, same ifIndex) among `found`. |
| `getMeters` | function | 521 | `async function getMeters(): Promise<MetersResponse>` |  |
| `metersView` | function | 568 | `const metersView = () =>` | The Internet traffic meters as their route and the warm-up read them. |

Imports: `clients/zabbix.ts`, `core/cache.ts`, `core/config.ts`, `core/gate.ts`, `domain/reachability.ts`, `services/net.ts`

Imported by: `routes/meters.ts`, `services/assistantFocus.ts`, `services/assistantInternet.ts`, `services/warmUp.ts`

Tests that import it: `__tests__/assistant-internet.test.ts`, `__tests__/bakeoff-fixture.test.ts`, `__tests__/chat.test.ts`, `__tests__/meters-route.test.ts`, `__tests__/meters.test.ts`
<!-- /gen -->

### `server/src/services/net.ts`

Network devices and their interfaces, from the SNMP interface items. Walked through in [Server: network and capacity](server-network-and-capacity.md), [Server: routes](server-routes.md).

<!-- gen:card server/src/services/net.ts -->
239 lines, 10 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `OperStatus` | type | 9 | `type OperStatus = \| 'up' \| 'down' \| 'testing' \| 'unknown' \| 'dormant' \| 'notPresent' \| 'lowerLayerDown'` |  |
| `ZIfItem` | interface | 29 | `interface ZIfItem` |  |
| `InterfaceRow` | interface | 43 | `interface InterfaceRow` |  |
| `parseIfKey` | function | 61 | `function parseIfKey(key: string): { kind: string; index: number } \| null` | `net.if.in[ifHCInOctets.33]` → { kind: 'in', index: 33 }. |
| `parseIfName` | function | 70 | `function parseIfName(itemName: string): { name: string; alias: string } \| null` | `Interface Gi1/0/1(Uplink (core)): Bits received` → name Gi1/0/1, alias `Uplink (core)`. |
| `groupInterfaces` | function | 81 | `function groupInterfaces(items: ZIfItem[], now = Math.floor(Date.now() / 1000)): InterfaceRow[]` | Fold one host's net.if.* items into one row per SNMP ifIndex. |
| `statusBucket` | function | 158 | `const statusBucket = (s: OperStatus): 'up' \| 'down' \| 'other' =>` |  |
| `getNetDevices` | function | 162 | `function getNetDevices()` | Devices in the network host groups, each enriched with ICMP availability. |
| `InterfaceQuery` | interface | 192 | `interface InterfaceQuery` |  |
| `getInterfacePage` | function | 205 | `async function getInterfacePage({ hostid, search, status: wanted, page, pageSize }: InterfaceQuery)` | One row per physical/logical interface: the ~9 net.if.* items Zabbix discovers per SNMP ifIndex folded together (1,119 items → ~122 rows on the... |

Imports: `clients/zabbix.ts`, `core/cache.ts`, `core/config.ts`, `domain/naming.ts`, `domain/queries.ts`, `domain/reachability.ts`, `services/sites.ts`

Imported by: `routes/net.ts`, `services/assistantPorts.ts`, `services/meters.ts`

Tests that import it: `__tests__/assistant-ports.test.ts`, `__tests__/group-interfaces.test.ts`, `__tests__/net-delay.test.ts`, `__tests__/site-resolver.test.ts`, `__tests__/typed-keys.test.ts`
<!-- /gen -->

### `server/src/services/noise.ts`

The alert-noise report: triggers that flap or fire too often to be useful. Walked through in [Server: routes](server-routes.md), [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/services/noise.ts -->
157 lines, 6 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `NoiseFlag` | type | 16 | `type NoiseFlag = 'flapping' \| 'unactioned' \| 'chronic'` | HCML Goal 4: *"the main issue is not the number of alarms, but the quality of information needed to act."* Top 100 triggers already answers *how... |
| `NoisyTrigger` | interface | 18 | `interface NoisyTrigger` |  |
| `NoiseReport` | interface | 37 | `interface NoiseReport` |  |
| `getNoise` | function | 64 | `async function getNoise(days: number, minSeverity: number): Promise<NoiseReport>` |  |
| `topNoise` | function | 144 | `function topNoise(report: NoiseReport, top: number): NoiseReport` | The loudest `top` triggers of a full report, in its order; every other figure still covers all of them. |
| `getNoiseReport` | function | 149 | `async function getNoiseReport(days: number, minSeverity: number, top: number, signal?: AbortSignal)` | The noisiest triggers. |

Imports: `core/cache.ts`, `core/config.ts`, `services/incidents.ts`, `services/reportPolicy.ts`

Imported by: `routes/analytics.ts`, `services/assistantDetail.ts`, `services/assistantReports.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-reads.test.ts`, `__tests__/incidents-before-window.test.ts`, `__tests__/noise-large.test.ts`
<!-- /gen -->

### `server/src/services/portalState.ts`

Holds the one state store the rest of the server uses. It is opened at start-up from the folder in the settings, and until then, and in the tests, it is a store in memory alone.

<!-- gen:card server/src/services/portalState.ts -->
21 lines, 3 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `initPortalState` | function | 11 | `async function initPortalState(warn: (message: string) => void): Promise<StateStore>` |  |
| `portalState` | function | 16 | `const portalState = (): StateStore =>` |  |
| `usePortalState` | hook | 19 | `function usePortalState(store: StateStore): void` | For the tests: put a store of their own in place. |

Imports: `core/config.ts`, `core/state.ts`

Imported by: `index.ts`, `routes/sliMail.ts`, `routes/sliSchedule.ts`, `services/mailState.ts`

Tests that import it: `__tests__/email-without-auth.test.ts`, `__tests__/mail-route.test.ts`, `__tests__/schedule-route.test.ts`
<!-- /gen -->

### `server/src/services/reportPolicy.ts`

What the slow reports share: how long an answer is kept and how many run at once. Walked through in [Server: network and capacity](server-network-and-capacity.md).

<!-- gen:card server/src/services/reportPolicy.ts -->
36 lines, 8 exports. Imported by 5 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `REPORT_TTL` | constant | 10 | `const REPORT_TTL = 120_000` | Cache lifetimes of the slow reports below. |
| `CAPACITY_TTL` | constant | 13 | `const CAPACITY_TTL = 60 * 60_000` | A run of the Capacity report took HCML's Zabbix 256 s, and it covers days, so a run is kept an hour. |
| `CAPACITY_STALE_MS` | constant | 16 | `const CAPACITY_STALE_MS = 23 * 60 * 60_000` | Past that hour the previous run is shown, with its age, for up to a day while the next one is built. |
| `staleReport` | function | 24 | `const staleReport = (ttlMs: number) =>` | Past its TTL a slow report is answered at once from the previous run, with its age, for as long again while one refresh runs, and a failed refresh... |
| `HEAVY_REPORTS_AT_ONCE` | constant | 30 | `const HEAVY_REPORTS_AT_ONCE = 2` | How many reports over days of history are read from Zabbix at once: a cold `noise` report over 365 days takes 7 s and thousands of SQL statements... |
| `heavy` | constant | 32 | `const heavy = createGate(HEAVY_REPORTS_AT_ONCE)` |  |
| `SLI_AT_ONCE` | constant | 35 | `const SLI_AT_ONCE = 2` | A cold month of the derived SLA is about 19 trend reads of 35 items, and a viewer can ask for every month in both profiles at once (BK-50). |
| `sliReads` | constant | 36 | `const sliReads = createGate(SLI_AT_ONCE)` |  |

Imports: `core/gate.ts`

Imported by: `services/availability.ts`, `services/capacity.ts`, `services/noise.ts`, `services/reports.ts`, `services/sli.ts`

Tests that import it: `__tests__/heavy-reports.test.ts`, `__tests__/light-reads.test.ts`, `__tests__/sli-gate.test.ts`, `__tests__/viewer-reports-load.test.ts`
<!-- /gen -->

### `server/src/services/reportSchedule.ts`

The monthly send. Once a minute it asks the planner what is due and does it: sends the month that has closed, tries again later if that fails, and gives up after a week, telling the people who asked. It writes each step to the state before the next, so a restart carries on and a month is not sent twice. It sends one thing at a time, and its timers do not keep the process alive. When the data folder stops taking writes it sends nothing it cannot record, says so once in the log, and tries a write at each minute until the folder is back.

<!-- gen:card server/src/services/reportSchedule.ts -->
449 lines, 3 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ScheduleDeps` | interface | 32 | `interface ScheduleDeps` |  |
| `ReportSchedule` | interface | 46 | `interface ReportSchedule` |  |
| `createReportSchedule` | function | 198 | `function createReportSchedule(deps: ScheduleDeps): ReportSchedule` |  |

Imports: `clients/mail.ts`, `clients/zabbix.ts`, `core/mailConfig.ts`, `core/recipients.ts`, `core/state.ts`, `core/validate.ts`, `security/audit.ts`, `services/sliMail.ts`, `sli/schedule.ts`

Imported by: `index.ts`, `routes/sliSchedule.ts`

Tests that import it: `__tests__/email-without-auth.test.ts`, `__tests__/report-schedule.test.ts`
<!-- /gen -->

### `server/src/services/reports.ts`

The Dashboard's counts, the data clock, problems by group and the top triggers. Walked through in [Server: domain and hosts](server-domain-and-hosts.md), [Server: routes](server-routes.md).

<!-- gen:card server/src/services/reports.ts -->
185 lines, 7 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `getTopTriggers` | function | 15 | `function getTopTriggers(days: number, signal?: AbortSignal)` | Reports → Top 100 triggers: count problem events per trigger over a window. |
| `COUNT_TIMEOUT_MS` | constant | 69 | `const COUNT_TIMEOUT_MS = 120_000` |  |
| `COUNT_WAIT_MS` | constant | 71 | `const COUNT_WAIT_MS = 2_000` | How long /api/stats waits for a count it does not hold yet; past this the count is null and carries on. |
| `COUNT_RETRY_MS` | constant | 73 | `const COUNT_RETRY_MS = 10 * 60_000` | After a count fails with none cached, Zabbix is not asked again for this long. |
| `getStats` | function | 117 | `function getStats()` | Reports → System information: high-level counts for the dashboard. |
| `getFreshness` | function | 146 | `async function getFreshness()` | When Zabbix last collected a value, so the Dashboard can say it has stopped (reachability.ts). |
| `getProblemsByGroup` | function | 152 | `function getProblemsByGroup()` | Dashboard widget: problem severity breakdown per host group. |

Imports: `clients/zabbix.ts`, `core/cache.ts`, `domain/queries.ts`, `domain/reachability.ts`, `services/reportPolicy.ts`

Imported by: `routes/reports.ts`, `services/assistantDetail.ts`, `services/assistantReports.ts`, `services/warmUp.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-reads.test.ts`, `__tests__/statsItemCount.test.ts`
<!-- /gen -->

### `server/src/services/services.ts`

The service tree, from Zabbix's services or derived from the estate. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/services/services.ts -->
210 lines, 6 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ServiceSla` | interface | 29 | `interface ServiceSla` |  |
| `ServiceNode` | interface | 39 | `interface ServiceNode` |  |
| `ServicesResponse` | interface | 56 | `interface ServicesResponse` |  |
| `MAX_NODES` | constant | 74 | `const MAX_NODES = 5_000` | The most nodes the tree holds. |
| `getServiceTree` | function | 116 | `async function getServiceTree(): Promise<ServicesResponse>` |  |
| `serviceTreeView` | function | 210 | `const serviceTreeView = () =>` | The service tree as its route, the Assistant and the warm-up read it. |

Imports: `clients/zabbix.ts`, `core/cache.ts`

Imported by: `routes/services.ts`, `services/assistantSnapshot.ts`, `services/warmUp.ts`, `sli/tree.ts`

Tests that import it: `__tests__/assistant-scope.test.ts`, `__tests__/bakeoff-fixture.test.ts`, `__tests__/chat.test.ts`, `__tests__/services-tree-cap.test.ts`, `__tests__/services-two-parents.test.ts`
<!-- /gen -->

### `server/src/services/sites.ts`

The site view: hosts grouped by site, with each site's worst problem. Walked through in [Server: domain and hosts](server-domain-and-hosts.md), [Server: routes](server-routes.md).

<!-- gen:card server/src/services/sites.ts -->
171 lines, 6 exports, 5 re-exports. Imported by 9 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SiteHost` | interface | 23 | `interface SiteHost` |  |
| `Site` | interface | 38 | `interface Site` |  |
| `SitesResponse` | interface | 60 | `interface SitesResponse` |  |
| `resolveSite` | re-export | 72 |  |  |
| `SITE_SIGNALS` | re-export | 72 |  |  |
| `siteOfName` | re-export | 72 |  |  |
| `siteRefOf` | re-export | 72 |  |  |
| `SiteSource` | re-export | 72 |  |  |
| `withSite` | function | 74 | `function withSite<H extends ZHostMeta>(host: H): Omit<H, 'hostgroups' \| 'tags' \| 'inventory'> & { site: SiteRef \| null }` |  |
| `getSites` | function | 79 | `async function getSites(): Promise<SitesResponse>` |  |
| `sitesView` | function | 171 | `const sitesView = () =>` | The Sites board as its route, the Assistant and the warm-up read it; quick since the ping values are read in bulk. |

Imports: `core/cache.ts`, `domain/naming.ts`, `domain/queries.ts`, `domain/reachability.ts`, `domain/siteOf.ts`

Imported by: `routes/sites.ts`, `services/assistantDetail.ts`, `services/assistantFacts.ts`, `services/assistantFocus.ts`, `services/assistantSnapshot.ts`, `services/hosts.ts`, `services/inventory.ts`, `services/net.ts`, `services/warmUp.ts`

Tests that import it: `__tests__/assistant-follow-up.test.ts`, `__tests__/assistant-scope.test.ts`, `__tests__/assistant-warm.test.ts`, `__tests__/bakeoff-fixture.test.ts`, `__tests__/chat.test.ts`, `__tests__/site-resolver.test.ts`
<!-- /gen -->

### `server/src/services/sla.ts`

Zabbix's own SLA objects and their figures, read-only. Walked through in [Server: routes](server-routes.md), [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/services/sla.ts -->
112 lines, 8 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ZbxSla` | interface | 9 | `interface ZbxSla` |  |
| `SlaSli` | interface | 20 | `interface SlaSli` | One service's achieved availability for one reporting period. |
| `getSlas` | function | 31 | `async function getSlas(): Promise<ZbxSla[]>` |  |
| `getSli` | function | 42 | `async function getSli(slaid: string, serviceid?: string): Promise<SlaSli[]>` | sla.getsli returns a period × service matrix plus bare service ids; flatten it into rows and attach service names so the UI doesn't have to. |
| `SlaSource` | interface | 86 | `interface SlaSource` | Whether Zabbix's own SLAs have anything to show. |
| `getSlaSource` | function | 92 | `async function getSlaSource(): Promise<SlaSource>` |  |
| `slasView` | function | 110 | `const slasView = () =>` | The SLA list and one SLA's figures as their routes, Explain, the Assistant and the warm-up read them. |
| `sliView` | function | 111 | `const sliView = (slaid: string, serviceid?: string) =>` |  |

Imports: `clients/zabbix.ts`, `core/cache.ts`

Imported by: `routes/sla.ts`, `services/assistantSnapshot.ts`, `services/explain.ts`, `services/warmUp.ts`

Tests that import it: `__tests__/assistant-scope.test.ts`, `__tests__/bakeoff-fixture.test.ts`, `__tests__/chat.test.ts`, `__tests__/explain-prompt-fence.test.ts`
<!-- /gen -->

### `server/src/services/sli.ts`

The derived monthly SLA, cached, for the routes. Walked through in [Server: routes](server-routes.md), [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/services/sli.ts -->
152 lines, 6 exports. Imported by 12 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `parseProfile` | function | 28 | `function parseProfile(raw: unknown): SliProfile` |  |
| `forgetMonthlySli` | function | 38 | `function forgetMonthlySli(month: string): void` | Drops what is kept for a month, in both methods and every phase: a report that came back empty must not be the answer to the next try (BK-51). |
| `getMonthlySli` | function | 53 | `function getMonthlySli(month: string, profile: SliProfile, signal?: AbortSignal): Promise<SliReport>` | The report for one calendar month, shared by every caller under one cache key. |
| `getMonthData` | function | 73 | `function getMonthData(month: string, profile: SliProfile, signal?: AbortSignal, maxAgeMs?: number): Promise<SliData>` | What Zabbix said about one calendar month in one method, read once and kept in memory (ADR-0018). |
| `WindowRequest` | interface | 88 | `interface WindowRequest` |  |
| `getWindowSli` | function | 100 | `async function getWindowSli(req: WindowRequest): Promise<SliReport>` | The report for any window of whole hours, from the months it touches. |

Imports: `core/cache.ts`, `core/config.ts`, `core/validate.ts`, `services/closedWeb.ts`, `services/reportPolicy.ts`, `sli/engine.ts`, `sli/evaluate.ts`, `sli/intervals.ts`, `sli/schedule.ts`, `sli/time.ts`, `sli/window.ts`

Imported by: `index.ts`, `routes/analytics.ts`, `routes/explain.ts`, `routes/services.ts`, `routes/sli.ts`, `services/assistantSla.ts`, `services/availability.ts`, `services/explain.ts`, `services/sliAsk.ts`, `services/sliMail.ts`, `sli/summary.ts`, `sli/tree.ts`

Tests that import it: `__tests__/assistant-sla.test.ts`, `__tests__/auth-rules.test.ts`, `__tests__/availability-window.test.ts`, `__tests__/closed-web-freeze.test.ts`, `__tests__/download-log.test.ts`, `__tests__/explain-prompt-fence.test.ts`, `__tests__/export-route.test.ts`, `__tests__/mail-route.test.ts`, and 8 more
<!-- /gen -->

### `server/src/services/sliAsk.ts`

Reads what a caller asks the derived SLA for, a month or a range and the hours of the day, and reads the report for it. Walked through in [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/services/sliAsk.ts -->
80 lines, 8 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SliAsk` | type | 14 | `type SliAsk = \| { kind: 'month'; month: string; hours: DailyHours \| null } \| { kind: 'window'; from: number; to:...` |  |
| `AskWords` | interface | 19 | `interface AskWords` | The words, as they arrive: text from a query, numbers from a body. |
| `parseAsk` | function | 35 | `function parseAsk(words: AskWords): SliAsk` |  |
| `boundsOfAsk` | function | 44 | `function boundsOfAsk(ask: SliAsk): { from: number; to: number }` | The first second of the ask and the first second after it. |
| `checkAsk` | function | 49 | `function checkAsk(ask: SliAsk, now: number): void` | The refusals a read would end in, said before it starts, so a bad request costs no Zabbix call and no allowance. |
| `readReport` | function | 60 | `function readReport(ask: SliAsk, profile: SliProfile, signal?: AbortSignal): Promise<SliReport>` | The report for an ask: a month with nothing else asked of it is the monthly report, with its web checks; anything else is a window of the months... |
| `askForLog` | function | 68 | `function askForLog(ask: SliAsk): { month?: string; from?: number; to?: number; dayHours?: string; days?: string }` | What a log line says of an ask: the month or the two times, and the hours when they are not the whole day. |
| `forgetAsk` | function | 76 | `function forgetAsk(ask: SliAsk, now: number): void` | Drops what is kept of the months an ask reads, for a report that came back empty (BK-51). |

Imports: `core/config.ts`, `core/validate.ts`, `services/sli.ts`, `sli/engine.ts`, `sli/intervals.ts`, `sli/time.ts`, `sli/window.ts`

Imported by: `routes/sli.ts`, `routes/sliExport.ts`, `routes/sliMail.ts`, `services/sliMail.ts`

Tests that import it: `__tests__/mail-range-empty.test.ts`, `__tests__/sli-ask.test.ts`
<!-- /gen -->

### `server/src/services/sliExport.ts`

Chooses the format and file name of the SLA download, for a month or a range. Walked through in [Server: export](server-export.md), [Server: routes](server-routes.md), [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/services/sliExport.ts -->
87 lines, 7 exports, 1 re-export. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `FORMATS` | constant | 23 | `const FORMATS: Record<Format, { type: string; suffix: string; build: Builder }>` | `suffix` ends the file name: the CSV files travel as one zip, and its name says so. |
| `Format` | re-export | 29 |  |  |
| `fileNameFor` | function | 32 | `const fileNameFor = (month: string, format: Format): string =>` | Named from the validated month alone, so no request text reaches a header. |
| `fileNameOf` | function | 35 | `const fileNameOf = (report: SliReport, format: Format): string =>` | Named from the report's own dates and hours, which are numbers, for a range or a month in the hours of the day: no request text reaches a header... |
| `fileFor` | function | 48 | `function fileFor(format: Format, strict: SliReport, hcml: SliReport, now: Date, style: ReportStyle = DEFAULT_STYLE):...` |  |
| `parseFormat` | function | 61 | `function parseFormat(raw: unknown): Format` |  |
| `parseFormats` | function | 67 | `function parseFormats(raw: unknown): Format[]` | The formats asked for: one to three of them, each once, in the order they are listed everywhere else. |
| `parseStyle` | function | 81 | `function parseStyle(q: { decimal?: unknown; date?: unknown; separator?: unknown }): ReportStyle` |  |

Imports: `core/reportChoices.ts`, `core/validate.ts`, `export/csv.ts`, `export/pdf.ts`, `export/slaReport.ts`, `export/types.ts`, `export/xlsx.ts`, `sli/engine.ts`

Imported by: `routes/sliExport.ts`, `routes/sliMail.ts`, `routes/sliSchedule.ts`, `services/sliMail.ts`

Tests that import it: `__tests__/download-log.test.ts`, `__tests__/export-file-reuse.test.ts`, `__tests__/export-sla-report-range.test.ts`, `__tests__/export-style.test.ts`
<!-- /gen -->

### `server/src/services/sliMail.ts`

Does the work of one report email. It tries the mail login first, so a wrong password fails in a second. It then reads the two reports the download reads, builds the file with the same function as the download, writes a plain-text body from the first-page figures of the same document, and hands both to the mail client.

<!-- gen:card server/src/services/sliMail.ts -->
133 lines, 8 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `EmailedFile` | interface | 17 | `interface EmailedFile` |  |
| `EmailedReport` | interface | 23 | `interface EmailedReport` |  |
| `bodyOf` | function | 32 | `function bodyOf(doc: ReportDoc, sentBy: string, files: number): string` | The report's own first-page figures, so a reader sees how the month went before opening a file. |
| `EmailRequest` | interface | 58 | `interface EmailRequest extends Common` |  |
| `RangeEmailRequest` | interface | 63 | `interface RangeEmailRequest extends Common` | A range of days, or a month in the hours of the day (FR-60): sent by hand only, the monthly schedule has no use for it. |
| `emailReport` | function | 110 | `function emailReport(input: EmailRequest): Promise<EmailedReport>` |  |
| `emailRangeReport` | function | 119 | `function emailRangeReport(input: RangeEmailRequest): Promise<EmailedReport>` |  |
| `sendNotice` | function | 129 | `async function sendNotice(to: string[], subject: string, text: string): Promise<void>` | A short message with no file, to the people who asked to be told when something goes wrong. |

Imports: `clients/mail.ts`, `core/config.ts`, `core/reportChoices.ts`, `core/validate.ts`, `export/slaReport.ts`, `export/types.ts`, `services/sli.ts`, `services/sliAsk.ts`, `services/sliExport.ts`, `sli/engine.ts`

Imported by: `index.ts`, `routes/sliMail.ts`, `services/reportSchedule.ts`

Tests that import it: `__tests__/email-without-auth.test.ts`, `__tests__/empty-report-retry.test.ts`, `__tests__/mail-range-empty.test.ts`, `__tests__/mail-service.test.ts`, `__tests__/report-schedule.test.ts`
<!-- /gen -->

### `server/src/services/stream.ts`

The live stream hub: one ticker for every connected screen, frames sent only on change, a keep-alive, and a cap on screens. Walked through in [Server: live and assistant](server-live-and-assistant.md), [Server: routes](server-routes.md).

<!-- gen:card server/src/services/stream.ts -->
370 lines, 17 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `TICK_MS` | constant | 30 | `const TICK_MS = PROBLEMS_TTL_MS` | One read of the problem list per tick, the pace its cache keeps. |
| `MAX_QUIET_MS` | constant | 37 | `const MAX_QUIET_MS = 30_000` | A name-only change waits until the sent list is this old. |
| `pingFrame` | function | 41 | `function pingFrame(ageMs?: number): string` | Data is required: an event with none is never delivered. |
| `fingerprint` | function | 54 | `function fingerprint(problems: readonly ZbxProblem[]): string` | What a screen shows of the list, as one comparable string. |
| `frameJson` | function | 84 | `function frameJson(problems: readonly ZbxProblem[]): string` | The list as the screens get it: the fields above. |
| `Sent` | interface | 89 | `interface Sent` | The last list sent to the screens: its fingerprint, its JSON, and when. |
| `shouldSend` | function | 101 | `function shouldSend(last: Sent \| null, next: { fingerprint: string; json: string }, now: number): boolean` | Whether a fresh read is worth a frame. |
| `useLogger` | hook | 145 | `function useLogger(logger: FastifyBaseLogger): void` | The route module hands the app's logger over once, when it registers. |
| `StreamLimits` | interface | 250 | `interface StreamLimits` | The most screens one connection may add, overall and for one owner. |
| `refusalFor` | function | 260 | `function refusalFor(owner: string, limits: StreamLimits = config.stream): string \| null` | Why a new screen from `owner` is refused, or null when it may join. |
| `subscribe` | function | 286 | `function subscribe(res: ServerResponse, owner = '', options: { gzip?: boolean } = {}): () => void` | Add one screen. |
| `connectedClients` | function | 319 | `function connectedClients(): number` | Screens connected right now. |
| `endStreams` | function | 324 | `function endStreams(): number` | End every live stream: close() would wait on an open one until Docker's kill. |
| `endStreamOf` | function | 340 | `function endStreamOf(res: ServerResponse): void` | End the screen that was given `res`: the route does this when the token behind it expires. |
| `notifyProblemsChanged` | function | 351 | `async function notifyProblemsChanged(): Promise<void>` | Send the list to every screen now. |
| `ownerOf` | function | 356 | `function ownerOf(req: FastifyRequest): string` | The signed-in user, or with auth off the client address. |
| `msUntilExpiry` | function | 365 | `function msUntilExpiry(req: FastifyRequest): number \| null` | Milliseconds until the token this request came in with expires, or until the person's account does, whichever is first; null with auth off. |

Imports: `clients/zabbix.ts`, `core/config.ts`, `domain/queries.ts`, `http/errors.ts`

Packages: `fastify`, `node:http`, `node:stream`, `node:zlib`

Imported by: `http/health.ts`, `routes/actions.ts`, `routes/stream.ts`

Tests that import it: `__tests__/health.test.ts`, `__tests__/light-reads.test.ts`, `__tests__/shutdown.test.ts`, `__tests__/stream-account-change.test.ts`, `__tests__/stream-signout.test.ts`, `__tests__/stream.test.ts`
<!-- /gen -->

### `server/src/services/topHosts.ts`

The busiest hosts right now by processor and memory. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/services/topHosts.ts -->
93 lines, 7 exports. Imported by 6 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `TopHostRow` | interface | 11 | `interface TopHostRow` |  |
| `TopHostsMetric` | interface | 21 | `interface TopHostsMetric` |  |
| `TopHostsResponse` | interface | 31 | `interface TopHostsResponse` |  |
| `TOP_HOSTS_ROWS` | constant | 47 | `const TOP_HOSTS_ROWS = 10` | Rows for each metric when the request does not say: the Zabbix "Top hosts" widget lists ten. |
| `TOP_HOSTS_MAX_ROWS` | constant | 49 | `const TOP_HOSTS_MAX_ROWS = 20` | The most a request of the route may ask for. |
| `getTopHosts` | function | 56 | `async function getTopHosts(limit: number): Promise<TopHostsResponse>` |  |
| `topHostsView` | function | 89 | `async function topHostsView(limit = TOP_HOSTS_ROWS): Promise<TopHostsResponse>` | The busiest hosts as the route and the warm-up read it: read once whatever `limit` is asked, and cut after. |

Imports: `clients/zabbix.ts`, `core/cache.ts`, `domain/reachability.ts`, `services/capacity.ts`

Imported by: `routes/topHosts.ts`, `services/assistantDetail.ts`, `services/assistantFocus.ts`, `services/assistantValues.ts`, `services/chat.ts`, `services/warmUp.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-follow-up.test.ts`, `__tests__/assistant-reads.test.ts`, `__tests__/assistant-warm.test.ts`, `__tests__/chat-route.test.ts`, `__tests__/top-hosts-route.test.ts`
<!-- /gen -->

### `server/src/services/userDirectory.ts`

Opens the portal's one directory of users at start-up from `.env` and the users file, and hands it to the routes and the guard. Walked through in [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/services/userDirectory.ts -->
33 lines, 3 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `initUsers` | function | 12 | `async function initUsers(warn: (message: string) => void): Promise<Directory>` | Opens the file of users, adds the users of `.env` that it does not hold, and makes the result the directory. |
| `userDirectory` | function | 25 | `function userDirectory(): Directory` |  |
| `useUserDirectory` | hook | 31 | `function useUserDirectory(directory: Directory \| null): void` | For the tests: put a directory of their own in place. |

Imports: `core/config.ts`, `security/accounts.ts`, `security/userStore.ts`

Imported by: `index.ts`, `services/accountRequests.ts`, `services/users.ts`

Tests that import it: `__tests__/account-requests.test.ts`, `__tests__/accounts.test.ts`, `__tests__/openapi-contract.test.ts`, `__tests__/users-routes.test.ts`, `__tests__/users-without-auth.test.ts`
<!-- /gen -->

### `server/src/services/users.ts`

What the Users page reads and changes: the people with the modules and presets to choose from, and the four changes an administrator can make. Walked through in [Server: security and http](server-security-and-http.md).

<!-- gen:card server/src/services/users.ts -->
52 lines, 6 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ModuleInfo` | interface | 10 | `interface ModuleInfo` |  |
| `UsersView` | interface | 18 | `interface UsersView` |  |
| `listUsers` | function | 32 | `function listUsers(secure: boolean): UsersView` |  |
| `createUser` | function | 47 | `const createUser = async (input: NewUser, actor: string): Promise<UserView> =>` |  |
| `updateUser` | function | 49 | `const updateUser = async (name: string, patch: UserPatch, actor: string): Promise<UserView> =>` |  |
| `resetPassword` | function | 51 | `const resetPassword = async (name: string, password: string, mustChange: boolean): Promise<UserView> =>` |  |

Imports: `security/accounts.ts`, `security/modules.ts`, `services/userDirectory.ts`

Imported by: `routes/users.ts`

Tests that import it: none
<!-- /gen -->

### `server/src/services/warmUp.ts`

Reads the slow views once after a start, one at a time, so the first visitor does not wait. Walked through in [Server: live and assistant](server-live-and-assistant.md).

<!-- gen:card server/src/services/warmUp.ts -->
49 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `WARM_UP` | constant | 16 | `const WARM_UP: readonly (readonly [string, () => Promise<unknown>])[]` | What a start reads before anyone asks, in this order: the parts other views share first, the Capacity report last. |
| `warmUp` | function | 37 | `async function warmUp(log: Pick<FastifyBaseLogger, 'info' \| 'warn'>, steps = WARM_UP): Promise<void>` | Reads the slow views once after a start, one at a time, into the cache entries their routes use, so the first person to open each finds it ready. |

Imports: `domain/queries.ts`, `services/capacity.ts`, `services/devices.ts`, `services/hosts.ts`, `services/links.ts`, `services/meters.ts`, `services/reports.ts`, `services/services.ts`, `services/sites.ts`, `services/sla.ts`, `services/topHosts.ts`, `services/webMonitoring.ts`

Packages: `fastify`

Imported by: `index.ts`

Tests that import it: `__tests__/light-reads.test.ts`
<!-- /gen -->

### `server/src/services/webMonitoring.ts`

Web scenarios counted as OK, failed or unknown, as the Zabbix widget counts them. Walked through in [Server: routes](server-routes.md).

<!-- gen:card server/src/services/webMonitoring.ts -->
91 lines, 7 exports. Imported by 5 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `WebFailure` | interface | 10 | `interface WebFailure` |  |
| `WebMonitoringResponse` | interface | 22 | `interface WebMonitoringResponse` |  |
| `WEB_FAILURES_ROWS` | constant | 47 | `const WEB_FAILURES_ROWS = 10` | Rows of failures when the request does not say. |
| `WEB_FAILURES_MAX_ROWS` | constant | 49 | `const WEB_FAILURES_MAX_ROWS = 50` | The most a request may ask for. |
| `scenarioName` | function | 52 | `function scenarioName(key: string): string` | The scenario's name out of its item key, which Zabbix quotes when the name has a comma, a bracket or a quote in it. |
| `getWebMonitoring` | function | 57 | `async function getWebMonitoring(limit: number): Promise<WebMonitoringResponse>` |  |
| `webMonitoringView` | function | 88 | `async function webMonitoringView(limit = WEB_FAILURES_ROWS): Promise<WebMonitoringResponse>` | Web monitoring as the route and the warm-up read it: read once whatever `limit` is asked, and cut after. |

Imports: `clients/zabbix.ts`, `core/cache.ts`, `domain/reachability.ts`

Imported by: `routes/webMonitoring.ts`, `services/assistantDetail.ts`, `services/assistantFocus.ts`, `services/assistantLinks.ts`, `services/warmUp.ts`

Tests that import it: `__tests__/assistant-detail.test.ts`, `__tests__/assistant-fence-and-pages.test.ts`, `__tests__/assistant-reads.test.ts`, `__tests__/assistant-warm.test.ts`, `__tests__/web-monitoring-route.test.ts`
<!-- /gen -->

## `server/src/sli`

### `server/src/sli/engine.ts`

The derived SLA: monthly availability per host, computed from the ICMP triggers, with maintenance, gaps and coverage. Walked through in [Server: domain and hosts](server-domain-and-hosts.md), [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/sli/engine.ts -->
496 lines, 3 exports, 16 re-exports. Imported by 12 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `aggregate` | re-export | 53 | `from './model.js'` |  |
| `categoryFor` | re-export | 53 | `from './model.js'` |  |
| `coveredFromTrends` | re-export | 53 | `from './model.js'` |  |
| `DERIVED_LABEL` | re-export | 53 | `from './model.js'` |  |
| `initialState` | re-export | 53 | `from './model.js'` |  |
| `intervalsFor` | re-export | 53 | `from './model.js'` |  |
| `wasMeasured` | re-export | 53 | `from './model.js'` |  |
| `DailyHours` | re-export | 54 | `from './model.js'` |  |
| `DataStatus` | re-export | 54 | `from './model.js'` |  |
| `SliGroup` | re-export | 54 | `from './model.js'` |  |
| `SliHost` | re-export | 54 | `from './model.js'` |  |
| `SliPath` | re-export | 54 | `from './model.js'` |  |
| `SliReport` | re-export | 54 | `from './model.js'` |  |
| `SliWeb` | re-export | 54 | `from './model.js'` |  |
| `TriggerEvent` | re-export | 54 | `from './model.js'` |  |
| `SliData` | re-export | 55 | `from './evaluate.js'` |  |
| `SliRequest` | interface | 315 | `interface SliRequest` |  |
| `readSliData` | function | 323 | `async function readSliData(req: { profile: SliProfile; from: number; to: number; now: number }, counter: Counter =...` | The span `[from, to)` as Zabbix has it at `now`: the triggers, their events and the state each began in, the planned maintenance and, in the... |
| `computeSli` | function | 470 | `async function computeSli(req: SliRequest): Promise<SliReport>` |  |

Imports: `clients/zabbix.ts`, `core/config.ts`, `core/delay.ts`, `core/validate.ts`, `domain/naming.ts`, `domain/queries.ts`, `domain/siteOf.ts`, `sli/evaluate.ts`, `sli/events.ts`, `sli/intervals.ts`, `sli/maintenance.ts`, `sli/model.ts`, `sli/time.ts`

Imported by: `export/slaReport.ts`, `services/availability.ts`, `services/closedWeb.ts`, `services/closedWebStore.ts`, `services/devices.ts`, `services/explain.ts`, `services/sli.ts`, `services/sliAsk.ts`, `services/sliExport.ts`, `services/sliMail.ts`, `sli/summary.ts`, `sli/tree.ts`

Tests that import it: `__tests__/availability-window.test.ts`, `__tests__/closed-web-freeze.test.ts`, `__tests__/empty-report-retry.test.ts`, `__tests__/export-sla-report-range.test.ts`, `__tests__/export-sla-report-style.test.ts`, `__tests__/export-sla-report.test.ts`, `__tests__/sli-cache.test.ts`, `__tests__/sli-engine.test.ts`, and 6 more
<!-- /gen -->

### `server/src/sli/evaluate.ts`

The second stage of the derived SLA: every figure of a report worked out from the data of one month or several in a row, for any window and any hours of the day. Walked through in [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/sli/evaluate.ts -->
361 lines, 6 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SliDataHost` | interface | 24 | `interface SliDataHost` | One host of a span of data. |
| `SliData` | interface | 38 | `interface SliData` | What the first stage read for one span, in seconds since 1970, and nothing derived from it. |
| `sliDataBytes` | function | 65 | `function sliDataBytes(d: SliData): number` | What a span of data holds in memory, for the cache: the walk that sizes a value stops at 500,000 values, which is about 170,000 events. |
| `SliQuery` | interface | 71 | `interface SliQuery` |  |
| `SliEvaluation` | type | 79 | `type SliEvaluation = Omit<SliReport, 'source' \| 'label' \| 'month' \| 'web' \| 'webTakenAt' \| 'stats' \| 'generatedAt'>...` | A report without what only the reading adds: the web checks, the month, the cost and the time it was made. |
| `evaluateSli` | function | 181 | `function evaluateSli(datas: SliData[], q: SliQuery): SliEvaluation` | The report of the window `[q.from, q.to)` from `datas`, the data of consecutive spans of one method that together cover it. |

Imports: `core/config.ts`, `domain/naming.ts`, `sli/intervals.ts`, `sli/model.ts`, `sli/time.ts`, `sli/window.ts`

Imported by: `services/sli.ts`, `sli/engine.ts`

Tests that import it: `__tests__/sli-fixes.test.ts`, `__tests__/sli-window.test.ts`
<!-- /gen -->

### `server/src/sli/events.ts`

Reads event history in slices so nothing is silently cut off. Walked through in [Server: network and capacity](server-network-and-capacity.md), [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/sli/events.ts -->
177 lines, 9 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SliceOptions` | interface | 16 | `interface SliceOptions` |  |
| `fetchEventsSliced` | function | 25 | `async function fetchEventsSliced<T extends { eventid: string }>(base: Record<string, unknown>, from: number, to:...` | `event.get` over `[from, to]` (both inclusive, as Zabbix treats them), in ascending clock order, every event exactly once. |
| `TREND_MAX_ROWS` | constant | 63 | `const TREND_MAX_ROWS = 35 * 745` | Most rows one `trend.get` may return, counted as items × hour marks: 35 items over a 31-day month (745 marks, both ends inclusive). |
| `TrendSliceOptions` | interface | 67 | `interface TrendSliceOptions<T>` |  |
| `hourMarks` | function | 84 | `const hourMarks = (from: number, to: number): number =>` | Hour marks (multiples of 3600) in `[from, to]`: at most one trend row per item for each. |
| `trendSlices` | function | 93 | `function trendSlices(itemids: string[], from: number, to: number, maxRows = TREND_MAX_ROWS): { itemids: string[]...` | The requests `fetchTrendsSliced` makes: item chunks × time windows. |
| `fetchTrendsSliced` | function | 129 | `async function fetchTrendsSliced<T extends { itemid: string }>(itemids: string[], from: number, to: number, output:...` | `trend.get` over `[from, to]` (both inclusive, as Zabbix treats them) for any number of items, split across item chunks and hour-aligned windows... |
| `mapLimit` | function | 153 | `async function mapLimit<I, O>(items: I[], limit: number, fn: (item: I, index: number) => Promise<O>): Promise<O[]>` | `fn` over `items` with at most `limit` running at once, results in input order. |
| `chunk` | function | 173 | `function chunk<T>(items: T[], size: number): T[][]` | `items` in consecutive chunks of `size`. |

Imports: `clients/zabbix.ts`

Imported by: `services/capacity.ts`, `services/history.ts`, `services/incidents.ts`, `sli/engine.ts`

Tests that import it: `__tests__/graphs.test.ts`, `__tests__/map-limit.test.ts`, `__tests__/sli-engine.test.ts`
<!-- /gen -->

### `server/src/sli/intervals.ts`

Interval arithmetic: merge, clip, intersect and complement. Walked through in [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/sli/intervals.ts -->
85 lines, 8 exports. Imported by 8 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Interval` | type | 8 | `type Interval = [number, number]` |  |
| `mergeIntervals` | function | 11 | `function mergeIntervals(intervals: Interval[]): Interval[]` | Overlapping or touching intervals merged, sorted, empty ones dropped. |
| `mergedSeconds` | function | 23 | `function mergedSeconds(intervals: Interval[]): { total: number; longest: number }` | Merge overlapping intervals so two simultaneous problems aren't counted twice. |
| `totalSeconds` | function | 33 | `const totalSeconds = (intervals: Interval[]): number =>` |  |
| `intersectIntervals` | function | 37 | `function intersectIntervals(a: Interval[], b: Interval[]): Interval[]` | The parts of `a` that also lie inside `b`. |
| `touchesAny` | function | 57 | `function touchesAny(spans: readonly Interval[], s: number, e: number): boolean` | Whether `[s, e)` shares time with `spans`, which must be merged and sorted: a binary search for the first span that ends after `s`. |
| `clipIntervals` | function | 69 | `function clipIntervals(intervals: Interval[], from: number, to: number): Interval[]` | Every interval clipped to `[from, to)`. |
| `complementIntervals` | function | 76 | `function complementIntervals(holes: Interval[], from: number, to: number): Interval[]` | `[from, to)` minus `holes`. |

Imports: none

Imported by: `services/availability.ts`, `services/sli.ts`, `services/sliAsk.ts`, `sli/engine.ts`, `sli/evaluate.ts`, `sli/maintenance.ts`, `sli/model.ts`, `sli/window.ts`

Tests that import it: `__tests__/availability.test.ts`, `__tests__/sli-engine.test.ts`, `__tests__/sli-fixes.test.ts`, `__tests__/sli-window.test.ts`
<!-- /gen -->

### `server/src/sli/maintenance.ts`

Turns Zabbix maintenance periods into concrete windows per host, so planned downtime can be left out. Walked through in [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/sli/maintenance.ts -->
172 lines, 4 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ZTimeperiod` | interface | 19 | `interface ZTimeperiod` |  |
| `ZMaintenance` | interface | 38 | `interface ZMaintenance` |  |
| `maintenanceWindows` | function | 84 | `function maintenanceWindows(m: ZMaintenance, from: number, to: number, tz: string): Interval[]` | The windows of one maintenance that overlap `[from, to)`, in `tz`. |
| `maintenanceByHost` | function | 119 | `async function maintenanceByHost(from: number, to: number, tz: string, onCall: () => void): Promise<Map<string...` | Maintenance windows per host in `[from, to)`: hosts named in a maintenance directly and hosts in its host groups, the groups nested under them... |

Imports: `clients/zabbix.ts`, `sli/intervals.ts`, `sli/time.ts`

Imported by: `services/assistantHostInfo.ts`, `services/assistantMaintenance.ts`, `sli/engine.ts`

Tests that import it: `__tests__/sli-maintenance-groups.test.ts`, `__tests__/sli-maintenance.test.ts`
<!-- /gen -->

### `server/src/sli/model.ts`

The shapes of a derived SLA report and the small pure rules it is built from: the state a trigger began in, the down intervals, the hours a host collected and the groups. Walked through in [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/sli/model.ts -->
243 lines, 15 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `DataStatus` | type | 10 | `type DataStatus = 'ok' \| 'partial' \| 'nodata'` |  |
| `SliHost` | interface | 12 | `interface SliHost` |  |
| `SliGroup` | interface | 45 | `interface SliGroup` |  |
| `SliPath` | interface | 57 | `interface SliPath` |  |
| `SliWeb` | interface | 69 | `interface SliWeb` |  |
| `DailyHours` | interface | 79 | `interface DailyHours` | The hours of the day a window is restricted to, when it is (sli/window.ts). |
| `SliReport` | interface | 88 | `interface SliReport` |  |
| `DERIVED_LABEL` | constant | 126 | `const DERIVED_LABEL` |  |
| `TriggerEvent` | interface | 128 | `interface TriggerEvent` |  |
| `intervalsFor` | function | 140 | `function intervalsFor(events: TriggerEvent[], initialProblem: boolean, from: number, endClip: number): { intervals:...` | Replay one trigger's events across `[from, endClip)`. |
| `initialState` | function | 176 | `function initialState(eventsInWindow: TriggerEvent[], trigger: { value: string; lastchange: string }, end: number...` | The state a trigger was in when the window opened. |
| `aggregate` | function | 191 | `function aggregate(key: string, name: string, hosts: SliHost[], target: number): SliGroup` | A group's figures from its hosts: the plain mean of those with data. |
| `wasMeasured` | function | 213 | `function wasMeasured(items: { state?: string; lastclock?: string }[], hostDisabled: boolean): boolean` | Whether a host's ICMP was ever collected, from its ICMP items as they are now: not when every one has no value (`lastclock` 0) and is not being... |
| `coveredFromTrends` | function | 222 | `function coveredFromTrends(rows: { clock: number; num: number }[], delaySeconds: number, from: number, end: number):...` | Hours in which an item actually collected data, from its trend rows: an hour counts when at least half of the expected samples arrived. |
| `categoryFor` | function | 237 | `function categoryFor(parentTemplates: string[]): string` | The report category is the monitoring template: a device template when the host has one, "ICMP Ping" for hosts that are only pinged. |

Imports: `core/config.ts`, `domain/naming.ts`, `sli/intervals.ts`

Imported by: `services/assistantSla.ts`, `sli/engine.ts`, `sli/evaluate.ts`, `sli/window.ts`

Tests that import it: none
<!-- /gen -->

### `server/src/sli/schedule.ts`

When the monthly report is due and what to do about it now. The report of a month is due on a day of the month after it, at a time in the report's zone, with ten minutes for Zabbix to hold the last values and a week to try again. Pure: the clock is an argument, so every case, early, late, retried, expired, already sent or switched off, is a plain call. The next send it names passes over a month that has gone.

<!-- gen:card server/src/sli/schedule.ts -->
108 lines, 12 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SETTLE_SECONDS` | constant | 12 | `const SETTLE_SECONDS = 600` | Zabbix collects every minute or so; this lets the last values of the month land before the figures are read. |
| `CATCH_UP_SECONDS` | constant | 14 | `const CATCH_UP_SECONDS = 7 * 86400` | After this a slot is not sent any more: a report a week late is a different report to the person who reads it. |
| `RETRY_AFTER_SECONDS` | constant | 16 | `const RETRY_AFTER_SECONDS` | The wait after the first failure, the second, and every one after: a login may be fixed, a network may come back. |
| `retryDelay` | function | 18 | `const retryDelay = (attempts: number): number =>` |  |
| `slotFor` | function | 26 | `function slotFor(month: string, day: number, time: string, tz: string): number` | The instant the report of `month` is due: `day` of the month after it, at `time` (HH:MM) in `tz`. |
| `latestSlot` | function | 33 | `function latestSlot(now: number, day: number, time: string, tz: string): { month: string; slot: number }` | The newest slot that has come by `now`, with the month it is for. |
| `nextSlot` | function | 45 | `function nextSlot(now: number, day: number, time: string, tz: string, done: ReadonlySet<string> = new Set()):...` | The first slot still to come after `now`, passing over a month that is `done`: it went, and moving the day does not send it again. |
| `Plan` | type | 54 | `type Plan = \| { kind: 'off' } /** Nothing to do yet: the next send is for 'month', at 'at'. */ \| { kind: 'wait'...` |  |
| `planNext` | function | 67 | `function planNext(now: number, schedule: Schedule \| null, sends: readonly SendRecord[], tz: string): Plan` |  |
| `MAX_SKIPPED_SLOTS` | constant | 84 | `const MAX_SKIPPED_SLOTS = 12` | The state keeps 24 records and Zabbix about a year of events, so no older slot is looked at. |
| `SkippedSlot` | interface | 86 | `interface SkippedSlot` |  |
| `skippedSlots` | function | 97 | `function skippedSlots(now: number, schedule: Schedule \| null, sends: readonly SendRecord[], tz: string): SkippedSlot[]` | Slots older than the newest that no look judged, because the portal was not running through them. |

Imports: `core/state.ts`, `sli/time.ts`

Imported by: `routes/sliMail.ts`, `services/closedWeb.ts`, `services/reportSchedule.ts`, `services/sli.ts`

Tests that import it: `__tests__/report-schedule.test.ts`, `__tests__/sli-schedule.test.ts`
<!-- /gen -->

### `server/src/sli/summary.ts`

Plain-text lines about the derived SLA and services, for the Assistant's snapshot. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card server/src/sli/summary.ts -->
75 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `derivedSlaLines` | function | 25 | `async function derivedSlaLines(): Promise<string[]>` |  |
| `derivedServiceLines` | function | 60 | `async function derivedServiceLines(): Promise<string[]>` |  |

Imports: `core/config.ts`, `export/slaReport.ts`, `services/sli.ts`, `sli/engine.ts`, `sli/time.ts`, `sli/tree.ts`

Imported by: `services/assistantSnapshot.ts`

Tests that import it: `__tests__/assistant-scope.test.ts`, `__tests__/bakeoff-fixture.test.ts`, `__tests__/chat.test.ts`, `__tests__/sla-summary.test.ts`
<!-- /gen -->

### `server/src/sli/time.ts`

Calendar months in a named time zone, as Unix seconds. Walked through in [Server: SLA and reports](server-sla-and-reports.md), [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card server/src/sli/time.ts -->
116 lines, 12 exports. Imported by 18 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `isWholeHour` | function | 34 | `function isWholeHour(utcSeconds: number, tz: string): boolean` | Whether `utcSeconds` is a whole second that falls on the hour by the clock of `tz`: its minutes and seconds there are both zero. |
| `zonedTime` | function | 39 | `function zonedTime(year: number, month: number, day: number, hour: number, minute: number, tz: string): number` | The instant the wall clock in `tz` reads `hour`:`minute` on `day` of `month` (1 to 12) of `year`, as Unix seconds. |
| `zonedDayStart` | function | 48 | `function zonedDayStart(year: number, month: number, day: number, tz: string): number` | Midnight on `day` of `month` (1 to 12) of `year` in `tz`, as Unix seconds. |
| `zonedMonthStart` | function | 53 | `function zonedMonthStart(year: number, month: number, tz: string): number` | Midnight on day 1 of `month` (1 to 12) of `year` in `tz`, as Unix seconds. |
| `zonedDate` | function | 58 | `function zonedDate(atSeconds: number, tz: string): { year: number; month: number; day: number }` | The calendar date `atSeconds` falls on in `tz`. |
| `parseMonth` | function | 70 | `function parseMonth(raw: unknown): string` | `YYYY-MM`, validated. |
| `checkPeriodStart` | function | 81 | `function checkPeriodStart(from: number, now: number): void` | A period must have started and lie within the year Zabbix keeps events. |
| `monthBounds` | function | 86 | `function monthBounds(month: string, tz: string): { from: number; to: number }` |  |
| `monthOf` | function | 95 | `function monthOf(atSeconds: number, tz: string): string` | The month containing `atSeconds` (default now) in `tz`, as `YYYY-MM`. |
| `currentMonth` | function | 104 | `function currentMonth(tz: string): string` |  |
| `previousMonth` | function | 109 | `function previousMonth(month: string): string` | The month before `month`. |
| `hourFloor` | function | 116 | `const hourFloor = (t: number): number =>` |  |

Imports: `core/validate.ts`

Imported by: `clients/limits.ts`, `routes/analytics.ts`, `routes/explain.ts`, `routes/services.ts`, `routes/sliMail.ts`, `services/assistantSla.ts`, `services/assistantWhen.ts`, `services/closedWeb.ts`, `services/history.ts`, `services/incidents.ts`, `services/sli.ts`, `services/sliAsk.ts`, `sli/engine.ts`, `sli/evaluate.ts`, and 4 more

Tests that import it: `__tests__/period-window.test.ts`, `__tests__/sli-schedule.test.ts`, `__tests__/sli-time.test.ts`, `__tests__/sli-window.test.ts`, `__tests__/startup-guards.test.ts`, `__tests__/copiedHelpers.test.ts`
<!-- /gen -->

### `server/src/sli/tree.ts`

A service tree built from the estate itself, for a Zabbix that has no services configured. Walked through in [Server: routes](server-routes.md), [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/sli/tree.ts -->
278 lines, 5 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `DerivedKind` | type | 26 | `type DerivedKind = 'root' \| 'business' \| 'site' \| 'class' \| 'wan-path' \| 'host' \| 'web'` |  |
| `DerivedServiceNode` | interface | 28 | `interface DerivedServiceNode extends ServiceNode` |  |
| `DerivedServicesResponse` | interface | 36 | `interface DerivedServicesResponse extends ServicesResponse` |  |
| `buildDerivedTree` | function | 72 | `function buildDerivedTree(report: SliReport, problems: ZbxProblem[], month: string): DerivedServicesResponse` |  |
| `getDerivedServices` | function | 269 | `async function getDerivedServices(month: string, profile: SliProfile, signal?: AbortSignal):...` | `signal` fires when this reader has left. |

Imports: `core/cache.ts`, `core/config.ts`, `domain/naming.ts`, `domain/queries.ts`, `services/services.ts`, `services/sli.ts`, `sli/engine.ts`

Imported by: `routes/services.ts`, `sli/summary.ts`

Tests that import it: `__tests__/api-hygiene.test.ts`, `__tests__/sla-summary.test.ts`, `__tests__/sli-limit.test.ts`
<!-- /gen -->

### `server/src/sli/window.ts`

The windows the SLA can be asked for beyond a calendar month: whole-hour limits, daily hours and weekdays, and the months a window touches. Walked through in [Server: SLA and reports](server-sla-and-reports.md).

<!-- gen:card server/src/sli/window.ts -->
87 lines, 5 exports. Imported by 5 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `MAX_WINDOW_DAYS` | constant | 12 | `const MAX_WINDOW_DAYS = 366` | The longest window: a leap year, so that a calendar year fits. |
| `checkWindow` | function | 15 | `function checkWindow(from: number, to: number, now: number, tz: string): void` | Refuses a window that is not whole hours, runs backwards, is longer than a year or began, or began in a month that started, too long ago for... |
| `parseDailyHours` | function | 32 | `function parseDailyHours(hours: unknown, days: unknown): DailyHours \| null` | The daily hours of a request: `hours` as `8-17` or `22-6` (the span runs from the first hour to the second, through midnight when the second is... |
| `dailySpans` | function | 56 | `function dailySpans(hours: DailyHours, from: number, end: number, tz: string): Interval[]` | The spans of `[from, end)` that the daily hours keep: each begins on a day the choice names and belongs to that day, even when it runs past midnight. |
| `monthsTouched` | function | 75 | `function monthsTouched(from: number, end: number, tz: string): string[]` | The calendar months, `YYYY-MM` in `tz`, that the window `[from, end)` touches, oldest first. |

Imports: `core/validate.ts`, `sli/intervals.ts`, `sli/model.ts`, `sli/time.ts`

Imported by: `services/assistantDetail.ts`, `services/assistantSla.ts`, `services/sli.ts`, `services/sliAsk.ts`, `sli/evaluate.ts`

Tests that import it: `__tests__/sli-fixes.test.ts`, `__tests__/sli-window.test.ts`
<!-- /gen -->
