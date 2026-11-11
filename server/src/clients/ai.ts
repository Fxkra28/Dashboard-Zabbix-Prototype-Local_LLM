import Anthropic from '@anthropic-ai/sdk';
import { config } from '../core/config.js';
import { estimatedTokens } from './limits.js';

/**
 * The plain-language layer, the LLM analog of `zabbix.ts`: the credential lives here and never
 * leaves the server. Callers hand it a Zabbix artifact and get a schema-shaped translation for a
 * non-technical reader; the model rephrases what Zabbix returned and is not an agent.
 *
 * Two backends sit behind `humanize()`, chosen by AI_PROVIDER:
 *
 *   anthropic:         hosted Claude via @anthropic-ai/sdk.
 *   openai-compatible: any OpenAI-shaped /chat/completions server, built for a local Ollama so that estate data
 *                      stays on the host. For Ollama, its native /api/chat is used (AI_OLLAMA_NATIVE).
 *
 * Both get the same system prompt and JSON Schemas and differ only in how each is told to emit
 * schema-shaped JSON: `callAnthropic`, `callOpenAiCompatible`, `callOllamaNative`.
 */

/** Raised when the AI layer is asked to work without a key. Mapped to 503. The reader is told to ask; `detail` names the setting, for the log. */
export class AiDisabledError extends Error {
  readonly code = 'ai_disabled';
  readonly detail: string;
  constructor() {
    super('AI explanations are not switched on for this portal. Tell an administrator.');
    this.detail =
      config.ai.provider === 'anthropic'
        ? 'Set ANTHROPIC_API_KEY in server/.env.'
        : 'Set AI_BASE_URL in server/.env, e.g. http://localhost:11434/v1 for a local Ollama.';
  }
}

/**
 * The model itself refused or failed (bad key, rate limit, outage, or, for a
 * local backend: nothing listening on AI_BASE_URL). Kept distinct from a
 * portal bug so the UI can say "explanations are unavailable" while the
 * monitoring data on the page stays perfectly good.
 */
export class AiUpstreamError extends Error {
  readonly code = 'ai_error';
  /** For the BFF log only (model address, upstream body, the setting to change); never part of a response. */
  readonly detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.detail = detail;
  }
}

/** What a viewer is told when the model fails; `detail` on the error carries the rest, for the log. */
export const AI_MESSAGE = {
  unreachable: 'The AI model could not be reached. Try again in a moment.',
  timeout: 'The AI model took too long to answer. Try again, or ask a narrower question.',
  failed: 'The AI model returned an error. Try again in a moment.',
  // A refused key stays refused until someone replaces it, so this one does not say "try again".
  refused: "The AI service did not accept the portal's key. Trying again will not help; tell an administrator.",
  stopped: 'The AI model stopped before finishing its answer. Try again.',
  unusable: 'The AI model gave an answer the portal could not use. Try again.',
} as const;

/**
 * Not a failure: the one local model is answering someone else and this
 * request waited its turn too long. Still an AiUpstreamError for callers that
 * only care that no answer came, but answered as 503 so a client can retry.
 */
export class AiBusyError extends AiUpstreamError {}

let client: Anthropic | null = null;
/** Shared with services/assistant.ts: one client, one timeout policy, for both features. */
export function getAnthropic(): Anthropic {
  // The SDK defaults to a 10-minute timeout and 2 retries. A human is waiting
  // behind an "Explain" button, so cap both: a slow answer is worse than a
  // clear 502 they can retry.
  client ??= new Anthropic({
    apiKey: config.ai.apiKey,
    timeout: config.ai.timeoutMs,
    maxRetries: config.ai.maxRetries,
  });
  return client;
}

const SYSTEM = [
  'You translate technical Zabbix monitoring data into clear, plain language for a',
  'non-technical reader at an oil & gas operator (offshore platforms, onshore plants,',
  'and corporate offices).',
  '',
  'Rules:',
  '- Be concise and accurate. Short sentences. No jargon unless you immediately explain it.',
  '- Never invent facts that are not present in the input. If something is not stated,',
  '  say what is unknown rather than guessing a cause.',
  '- Keep a calm, non-alarming tone. Describe impact factually, without drama.',
  '- Write for someone who has to decide whether to act, not for the engineer who',
  '  already understands the alert.',
].join('\n');

/** Plain-language translation of one problem: its wording *and* its tags. */
export interface ProblemExplanation {
  summary: string;
  tagsExplained: { tag: string; value: string; meaning: string }[];
  businessImpact: string;
  recommendation: string;
}

/** Plain-language translation of one SLA and its current SLI. */
export interface SlaExplanation {
  status: string;
  plain: string;
  meetingTarget: boolean;
  recommendation: string;
}

const PROBLEM_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'What the alert actually means, in one or two plain sentences.',
    },
    tagsExplained: {
      type: 'array',
      description: 'One entry per tag supplied in the input. Do not add tags that were not given.',
      items: {
        type: 'object',
        properties: {
          tag: { type: 'string' },
          value: { type: 'string' },
          meaning: {
            type: 'string',
            description: 'What this tag tells a non-engineer, in one short sentence.',
          },
        },
        required: ['tag', 'value', 'meaning'],
        additionalProperties: false,
      },
    },
    businessImpact: {
      type: 'string',
      description:
        'Who or what is affected in practice, and how badly. Say if the impact is unclear from the data.',
    },
    recommendation: {
      type: 'string',
      description: 'The single most sensible next step, phrased as an action.',
    },
  },
  required: ['summary', 'tagsExplained', 'businessImpact', 'recommendation'],
  additionalProperties: false,
} as const;

const SLA_SCHEMA = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      description: 'A short verdict, e.g. "Comfortably on target" or "Below target this period".',
    },
    plain: {
      type: 'string',
      description:
        'What the SLO, SLI, uptime/downtime and error budget mean here, without the acronyms.',
    },
    meetingTarget: { type: 'boolean', description: 'True when the current SLI is at or above the SLO.' },
    recommendation: { type: 'string', description: 'The most sensible next step.' },
  },
  required: ['status', 'plain', 'meetingTarget', 'recommendation'],
  additionalProperties: false,
} as const;

const SCHEMAS = { problem: PROBLEM_SCHEMA, sla: SLA_SCHEMA };

type Kind = keyof typeof SCHEMAS;
type Result<K extends Kind> = K extends 'problem' ? ProblemExplanation : SlaExplanation;

const INSTRUCTION: Record<Kind, string> = {
  problem:
    'Explain this Zabbix problem for a non-technical reader. The "name" field is the ' +
    'notification wording as the team receives it, and "opdata" is the live value that ' +
    'accompanies it. Explain every tag in the list: those are the labels engineers use ' +
    'to route and group alerts.',
  sla:
    'Explain this Zabbix SLA and its current measurement for a non-technical reader. ' +
    'SLO is the promised availability target and SLI is what was actually achieved; the ' +
    'error budget is how much more downtime the period can absorb.',
};

const MAX_TOKENS = 2048;

const REASONING_MODEL = /^(qwen3|deepseek-r1|gpt-oss|magistral)/i;

/**
 * Reasoning models (Qwen3, DeepSeek-R1, gpt-oss) think first, which turns a 3 s answer into 15 s on
 * Ollama. On /v1 only `reasoning_effort: "none"` stops it: `/no_think` is overridden by the chat
 * template and `think: false` is rejected. Sent only to known reasoning families, so other servers
 * never see a parameter they might reject.
 */
export function thinkingControl(model: string): { reasoning_effort?: 'none' } {
  return REASONING_MODEL.test(model) ? { reasoning_effort: 'none' } : {};
}

/** For the log of a refused key: the one thing that fixes it. */
const REFUSED_HINT = 'Replace the key (AI_API_KEY or ANTHROPIC_API_KEY) in .env and recreate the BFF.';

/** A hosted-model API failure for the viewer: a fixed sentence, with the SDK's own wording kept for the log. */
export function anthropicFailure(err: InstanceType<typeof Anthropic.APIError>): AiUpstreamError {
  if (err.status === 401 || err.status === 403) {
    return new AiUpstreamError(AI_MESSAGE.refused, `${config.ai.model}: ${err.message} ${REFUSED_HINT}`);
  }
  const message =
    err instanceof Anthropic.APIConnectionTimeoutError
      ? AI_MESSAGE.timeout
      : err instanceof Anthropic.APIConnectionError
        ? AI_MESSAGE.unreachable
        : AI_MESSAGE.failed;
  return new AiUpstreamError(message, `${config.ai.model}: ${err.message}`);
}

/** The slice of Fastify's logger the helpers below write to. */
type AiLog = { debug: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void };

// Ollama's native API

/** The server itself: AI_BASE_URL without the OpenAI-compatible `/v1`. */
export function ollamaRoot(): string {
  return config.ai.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

const PROBE_TIMEOUT_MS = 3_000;
/** The `auto` answer once a server has given one; `null` means ask (again). */
let nativeProbe: Promise<boolean> | null = null;

/**
 * Whether to speak Ollama's own API. `auto` asks `{root}/api/version` once and keeps the answer: a
 * string `version` means Ollama, anything else keeps `/v1`. No reply at all (refused, timeout, 5xx)
 * is not an answer: that call uses `/v1` and the next asks again, so an Ollama started after the
 * BFF is still found.
 */
export function usesOllamaNative(): Promise<boolean> {
  if (config.ai.provider !== 'openai-compatible') return Promise.resolve(false);
  if (config.ai.ollamaNative !== 'auto') return Promise.resolve(config.ai.ollamaNative === 'true');
  if (!nativeProbe) {
    const probe: Promise<boolean> = fetch(`${ollamaRoot()}/api/version`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
      .then(async (res) => {
        if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json().catch(() => null)) as { version?: unknown } | null;
        return res.ok && typeof body?.version === 'string';
      })
      .catch(() => {
        if (nativeProbe === probe) nativeProbe = null;
        return false;
      });
    nativeProbe = probe;
  }
  return nativeProbe;
}

/**
 * The one request shape for every native call. Chat, explain, warm-up and prefill differ only in
 * their messages, `stream` and `num_predict`. Everything that picks the runner, `num_ctx` above
 * all, comes from here: a request that differs there restarts the model and drops the prompt cache
 * the others rely on. `think: false` goes only to reasoning families, as `reasoning_effort` does on
 * `/v1`.
 */
export function ollamaChatBody(
  messages: { role: string; content: string }[],
  { numPredict, stream = false, format }: { numPredict: number; stream?: boolean; format?: object },
) {
  return {
    model: config.ai.model,
    messages,
    stream,
    ...(REASONING_MODEL.test(config.ai.model) ? { think: false } : {}),
    ...(format ? { format } : {}),
    keep_alive: config.ai.keepAlive,
    options: {
      num_ctx: config.ai.numCtx,
      num_predict: numPredict,
      temperature: config.ai.temperature,
      top_p: config.ai.topP,
    },
  };
}

/** One line of a native reply; with `stream: false`, the whole reply. */
interface OllamaLine {
  message?: { content?: string };
  done?: boolean;
  done_reason?: string;
  error?: string;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_cached_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
}

/** What Ollama reports when a reply is done, for the BFF log, never the reader. */
export interface OllamaStats {
  /** `stop`, or `length` when `num_predict` cut the answer off. */
  doneReason?: string;
  promptEvalCount?: number;
  /** Prompt tokens Ollama took from its cache instead of reading them again. */
  promptCachedCount?: number;
  promptEvalMs?: number;
  evalCount?: number;
  /** Seconds here, not milliseconds, mean the runner was (re)started. */
  loadMs?: number;
}

function ollamaStats(line: OllamaLine): OllamaStats {
  const ms = (ns: number | undefined) => (ns === undefined ? undefined : Math.round(ns / 1e6));
  return {
    doneReason: line.done_reason,
    promptEvalCount: line.prompt_eval_count,
    promptCachedCount: line.prompt_eval_cached_count,
    promptEvalMs: ms(line.prompt_eval_duration),
    evalCount: line.eval_count,
    loadMs: ms(line.load_duration),
  };
}

/**
 * Turn Ollama's native stream, one JSON object per line, into text pieces. A line may arrive split
 * across chunks. `{"error": …}` and a stream that ends before its `done` line both become
 * AiUpstreamError, so a cut-off answer is never taken for a whole one. The `done` counts go to
 * `onDone`, for the log.
 */
export async function* readOllamaStream(
  body: ReadableStream<Uint8Array>,
  onDone?: (stats: OllamaStats) => void,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      // The last piece is a line still arriving, unless nothing more will.
      buf = done ? '' : (lines.pop() ?? '');
      for (const raw of lines) {
        if (!raw.trim()) continue;
        let line: OllamaLine;
        try {
          line = JSON.parse(raw) as OllamaLine;
        } catch {
          continue; // not JSON; the next line carries on
        }
        if (typeof line.error === 'string') {
          throw new AiUpstreamError(AI_MESSAGE.failed, `${config.ai.model}: ${line.error}`);
        }
        const piece = line.message?.content;
        if (piece) yield piece;
        if (line.done) {
          onDone?.(ollamaStats(line));
          return;
        }
      }
      if (done) {
        throw new AiUpstreamError(AI_MESSAGE.stopped, `${config.ai.model} ended its stream before the done line`);
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

// one model request at a time

/**
 * Ollama runs this model with one slot (`-np 1`): a second request waits inside Ollama with no word
 * to the reader, then reads its own prompt over the cache the first left. So chat, explain and
 * prefill take turns here, in arrival order, and one that would wait more than ~20 s is told why
 * instead of timing out.
 */
const SLOT_WAIT_MS = 20_000;
export const BUSY_MESSAGE = 'The assistant is busy answering another question. Try again in a moment.';

// Per BFF process: a second BFF on the same Ollama does not see this slot.
let slotHeld = false;
const slotQueue: (() => void)[] = [];

/** Releases once, however often it is called; hands the slot straight to the next in line. */
function releaser(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = slotQueue.shift();
    if (next) next();
    else slotHeld = false;
  };
}

/**
 * Wait for the model, then hold it until the returned function is called.
 * Rejects with AiUpstreamError after `waitMs`, or with the abort reason when
 * `signal` fires first: a reader who left gives up their place.
 */
export function acquireModelSlot(signal?: AbortSignal, waitMs = SLOT_WAIT_MS): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (!slotHeld) {
    slotHeld = true;
    return Promise.resolve(releaser());
  }
  return new Promise((resolve, reject) => {
    const leave = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const i = slotQueue.indexOf(grant);
      if (i >= 0) slotQueue.splice(i, 1);
    };
    const grant = () => {
      leave();
      resolve(releaser());
    };
    const onAbort = () => {
      leave();
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      leave();
      reject(new AiBusyError(BUSY_MESSAGE));
    }, waitMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    slotQueue.push(grant);
  });
}

/** The model if nobody holds it this instant, else `null`: for work only worth doing while idle. */
export function tryAcquireModelSlot(): (() => void) | null {
  if (slotHeld) return null;
  slotHeld = true;
  return releaser();
}

// hosted calls at once

/**
 * The hosted API has no slot, so only the per-minute limit stopped a few users from opening many
 * paid calls together. AI_MAX_CONCURRENT calls run at once; the next waits its turn like a local
 * question and is told the assistant is busy after the same ~20 s. The local model never comes
 * here.
 */
let hostedActive = 0;
const hostedQueue: (() => void)[] = [];

function hostedReleaser(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = hostedQueue.shift();
    if (next) next();
    else hostedActive--;
  };
}

/** Wait for a hosted call's turn, then hold it until the returned function is called. Rejects as `acquireModelSlot` does. */
export function acquireHostedSlot(signal?: AbortSignal, waitMs = SLOT_WAIT_MS): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (hostedActive < config.ai.limits.maxConcurrent) {
    hostedActive++;
    return Promise.resolve(hostedReleaser());
  }
  return new Promise((resolve, reject) => {
    const leave = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const i = hostedQueue.indexOf(grant);
      if (i >= 0) hostedQueue.splice(i, 1);
    };
    const grant = () => {
      leave();
      resolve(hostedReleaser());
    };
    const onAbort = () => {
      leave();
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      leave();
      reject(new AiBusyError(BUSY_MESSAGE));
    }, waitMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    hostedQueue.push(grant);
  });
}

/** Tokens a hosted call is billed for: what it read, cache included, and what it wrote. */
export function billedTokens(usage: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

/** Called once with a finished hosted call's token count, to charge it to whoever asked (limits.ts). */
export type OnUsage = (tokens: number) => void;


/**
 * POST one request to the model server with raw `fetch`, mirroring `zabbix.ts`: there is no HTTP
 * helper to import, and a second SDK would be a dependency for one POST. A connection failure, a
 * timeout and an HTTP error all become AiUpstreamError, worded for whoever reads the screen.
 */
export async function postModel(url: string, body: unknown, signal: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // A local Ollama wants no key; a hosted OpenAI-compatible gateway does.
        ...(config.ai.apiKey ? { Authorization: `Bearer ${config.ai.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // The viewer gets a fixed sentence; the log gets what the owner needs to fix it.
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new AiUpstreamError(
        AI_MESSAGE.timeout,
        `${config.ai.model} did not answer within ${config.ai.timeoutMs} ms. ` +
          'A cold model loads before it generates. Raise AI_TIMEOUT_MS, or check ' +
          `the server at ${config.ai.baseUrl}.`,
      );
    }
    // `fetch` rejects with a TypeError when the host is unreachable. For a local
    // model that is by far the likeliest failure.
    throw new AiUpstreamError(
      AI_MESSAGE.unreachable,
      `Could not reach the model at ${config.ai.baseUrl}. Is it running? ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (!res.ok) {
    // The upstream body stays in the log, truncated, and never reaches a viewer.
    const body = (await res.text().catch(() => '')).slice(0, 200);
    // A key was sent and the service said no. Without a key a 401 is a proxy in front, which no key of ours fixes.
    if ((res.status === 401 || res.status === 403) && config.ai.apiKey) {
      throw new AiUpstreamError(AI_MESSAGE.refused, `${config.ai.model}: HTTP ${res.status} ${body} ${REFUSED_HINT}`);
    }
    throw new AiUpstreamError(AI_MESSAGE.failed, `${config.ai.model}: HTTP ${res.status} ${body}`);
  }
  return res;
}

/**
 * Load the local model before anyone waits on it (a cold qwen3:8b takes ~10 s to its first token).
 * On native Ollama an empty `messages` loads it with the options every later request sends;
 * otherwise an empty prompt to /api/generate does. It stays resident for AI_KEEP_ALIVE. A no-op for
 * other backends; never throws, since a failed warm-up only means a slow first answer.
 */
export async function warmModel(log?: { debug: (obj: unknown, msg?: string) => void }): Promise<void> {
  if (!config.ai.enabled || config.ai.provider !== 'openai-compatible') return;
  try {
    const native = await usesOllamaNative();
    const res = await fetch(`${ollamaRoot()}/api/${native ? 'chat' : 'generate'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        native
          ? ollamaChatBody([], { numPredict: 1 })
          : { model: config.ai.model, prompt: '', keep_alive: config.ai.keepAlive },
      ),
      signal: AbortSignal.timeout(60_000),
    });
    await res.text(); // tiny; reading it waits for the load to finish
    log?.debug({ status: res.status, model: config.ai.model, native }, 'model warm-up');
  } catch (err) {
    log?.debug({ err: err instanceof Error ? err.message : String(err) }, 'model warm-up failed');
  }
}

/**
 * Have the model read a system prompt before the question that needs it, so that question pays only
 * for its own words (Ollama keeps it in its prompt cache). Same options as every other request,
 * with `num_predict: 1`; native Ollama only. Never waits for the slot, because a prefill queued
 * behind the answer a reader is waiting for would only delay the next question. True when the model
 * read the prompt; never throws.
 */
export async function prefillModel(system: string, log?: AiLog): Promise<boolean> {
  if (!config.ai.enabled || !(await usesOllamaNative())) return false;
  const release = tryAcquireModelSlot();
  if (!release) {
    log?.debug({}, 'chat prefill skipped: the model is busy');
    return false;
  }
  const started = Date.now();
  try {
    const res = await postModel(
      `${ollamaRoot()}/api/chat`,
      ollamaChatBody([{ role: 'system', content: system }], { numPredict: 1 }),
      AbortSignal.timeout(config.ai.timeoutMs),
    );
    const reply = (await res.json()) as OllamaLine;
    if (reply.error) throw new AiUpstreamError(reply.error);
    log?.info({ ms: Date.now() - started, ...ollamaStats(reply) }, 'chat prefill');
    return true;
  } catch (err) {
    log?.debug({ err: err instanceof Error ? err.message : String(err) }, 'chat prefill failed');
    return false;
  } finally {
    release();
  }
}

/** Hosted Claude. `output_config.format` is its spelling of "obey this schema". */
async function callAnthropic(kind: Kind, prompt: string, onUsage?: OnUsage): Promise<string> {
  let res;
  try {
    res = await getAnthropic().messages.create({
      model: config.ai.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema: SCHEMAS[kind] } },
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) throw anthropicFailure(err);
    throw err;
  }

  // Billed whether or not the answer is usable; an answer with no count is charged by its size.
  onUsage?.(res.usage ? billedTokens(res.usage) : estimatedTokens(SYSTEM.length + prompt.length));

  // output_config.format guarantees a text block holding valid JSON.
  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
  if (!text) throw new AiUpstreamError(AI_MESSAGE.unusable, `${config.ai.model} returned no text block`);
  return text;
}

/**
 * Any OpenAI-shaped /chat/completions server, written for a local Ollama; vLLM, llama.cpp and LM
 * Studio speak the same dialect. `response_format` is this dialect's spelling of
 * `output_config.format`, and Ollama enforces it by constraining the sampler to the schema's
 * grammar, as on the hosted path.
 */
async function callOpenAiCompatible(kind: Kind, prompt: string): Promise<string> {
  const res = await postModel(
    `${config.ai.baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      model: config.ai.model,
      max_tokens: MAX_TOKENS,
      ...thinkingControl(config.ai.model),
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: kind, strict: true, schema: SCHEMAS[kind] },
      },
    },
    // `fetch` has no default timeout: the same trap zabbix.ts guards against.
    AbortSignal.timeout(config.ai.timeoutMs),
  );

  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new AiUpstreamError(AI_MESSAGE.unusable, `${config.ai.model} returned no content`);
  return text;
}

/**
 * The same request through Ollama's own /api/chat, where `format` is the
 * spelling of `response_format` and the grammar is enforced the same way. Its
 * options are the chat's, so an Explain click never restarts the runner the
 * assistant is answering from.
 */
async function callOllamaNative(kind: Kind, prompt: string): Promise<string> {
  const res = await postModel(
    `${ollamaRoot()}/api/chat`,
    ollamaChatBody(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      { numPredict: MAX_TOKENS, format: SCHEMAS[kind] },
    ),
    AbortSignal.timeout(config.ai.timeoutMs),
  );

  const body = (await res.json().catch(() => ({}))) as OllamaLine;
  if (body.error) throw new AiUpstreamError(AI_MESSAGE.failed, `${config.ai.model}: ${body.error}`);
  const text = body.message?.content;
  if (!text) throw new AiUpstreamError(AI_MESSAGE.unusable, `${config.ai.model} returned no content`);
  return text;
}

/**
 * A schema guarantees the shape, not that the model filled it in: a small local model sometimes
 * satisfies it with empty strings, which reaches the NOC as a blank Explain panel that looks like a
 * portal bug. Fail loudly instead; the UI degrades gracefully on 502 and the page's monitoring data
 * is untouched.
 */
function assertComplete(kind: Kind, parsed: Record<string, unknown>): void {
  const empty = (SCHEMAS[kind].required as readonly string[]).filter((key) => {
    const value = parsed[key];
    if (typeof value === 'string') return value.trim() === '';
    return value === undefined || value === null;
  });
  if (empty.length) {
    throw new AiUpstreamError(AI_MESSAGE.unusable, `${config.ai.model} returned an empty ${empty.join(' and ')}.`);
  }
}

/**
 * Ask the configured model to rewrite one Zabbix artifact. Both backends are
 * handed the same prompt and the same schema, and both enforce it, so the
 * caller can parse without a validation dependency, and so the two are
 * directly comparable on the same problem.
 */
export async function humanize<K extends Kind>(kind: K, payload: unknown, onUsage?: OnUsage): Promise<Result<K>> {
  if (!config.ai.enabled) throw new AiDisabledError();

  const prompt = `${INSTRUCTION[kind]}\n\n${JSON.stringify(payload, null, 2)}`;
  let text: string;
  if (config.ai.provider === 'anthropic') {
    const release = await acquireHostedSlot();
    try {
      text = await callAnthropic(kind, prompt, onUsage);
    } finally {
      release();
    }
  } else {
    const native = await usesOllamaNative();
    const release = await acquireModelSlot();
    try {
      text = native ? await callOllamaNative(kind, prompt) : await callOpenAiCompatible(kind, prompt);
    } finally {
      release();
    }
  }

  let parsed: Result<K>;
  try {
    parsed = JSON.parse(text) as Result<K>;
  } catch {
    throw new AiUpstreamError(AI_MESSAGE.unusable, `${config.ai.model} did not return valid JSON.`);
  }
  assertComplete(kind, parsed as unknown as Record<string, unknown>);
  return parsed;
}
