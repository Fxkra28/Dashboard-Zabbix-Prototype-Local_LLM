/**
 * Asking the model: the turns of a conversation in, the answer out as it is written, from the hosted API, from Ollama's own API or from any
 * OpenAI-compatible server, with the sign-offs the model adds out of habit cut off the end.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../core/config.js';
import { acquireHostedSlot, acquireModelSlot, AI_MESSAGE, AiDisabledError, AiUpstreamError, anthropicFailure, billedTokens, getAnthropic, ollamaChatBody, ollamaRoot, postModel, readOllamaStream, thinkingControl, usesOllamaNative, type OllamaStats, type OnUsage } from '../clients/ai.js';
import { estimatedTokens } from '../clients/limits.js';
import { languageReminder, systemText } from './assistantPrompt.js';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const ANSWER_MAX_TOKENS = 700;

/**
 * Sign-offs the model adds out of habit ("For more details, check the Problems
 * page." / "Silakan cek halaman Problems."). Matched against the last sentence
 * only, so a page named because the snapshot lacked the data survives.
 */
const BOILERPLATE = [
  /^(for (more|further|full|additional) (details|detail|information|info)[^.!?]*[,:]?\s*)?(you (can|may|could) |please |feel free to )?(also )?(check|see|open|visit|refer to|look at|review|go to)\b[^.!?]*\b(page|pages|dashboard|section|portal|tab)\b[^.!?]*[.!]?$/i,
  /^(untuk (detail|informasi|info)[^.!?]*[,:]?\s*)?(anda |kamu )?(juga )?(silakan|silahkan|dapat|bisa|cek|periksa|lihat|buka|kunjungi)\b[^.!?]*\b(halaman|page|dashboard|menu|bagian|portal)\b[^.!?]*[.!]?$/i,
];

export function cleanAnswer(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/\r\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  // Start of the last sentence: after the last ". " / "! " / "? " or line break.
  const body = text.slice(0, -1);
  const boundary = /[\s\S]*(?:[.!?]\s+|\n)/.exec(body);
  if (boundary) {
    const start = boundary[0].length;
    const last = text.slice(start).replace(/^[-*•]\s+/, '').trim();
    if (last.length <= 160 && BOILERPLATE.some((re) => re.test(last))) {
      text = text.slice(0, start).trim();
    }
  }
  return text;
}

/**
 * Turn an OpenAI-style `text/event-stream` body into text pieces. Each frame is
 * `data: {json}`; the stream ends with `data: [DONE]`. Reasoning models may
 * send `delta.reasoning` frames with empty `content`: those are dropped, so
 * only what the reader should see is yielded.
 */
export async function* readOpenAiStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trimEnd();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        let frame: { choices?: { delta?: { content?: string | null } }[] };
        try {
          frame = JSON.parse(data);
        } catch {
          continue; // a partial or malformed frame; the next one carries on
        }
        const piece = frame.choices?.[0]?.delta?.content;
        if (piece) yield piece;
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

type Message = { role: string; content: string };

async function* streamOpenAiCompatible(messages: Message[], signal: AbortSignal): AsyncGenerator<string> {
  const res = await postModel(
    `${config.ai.baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      model: config.ai.model,
      max_tokens: ANSWER_MAX_TOKENS,
      stream: true,
      ...thinkingControl(config.ai.model),
      messages,
    },
    signal,
  );
  if (!res.body) throw new AiUpstreamError(AI_MESSAGE.unusable, `${config.ai.model}: HTTP ${res.status} empty response`);
  yield* readOpenAiStream(res.body);
}

/** Ollama's own /api/chat, with the options every native request shares (ai.ts `ollamaChatBody`). */
async function* streamOllama(
  messages: Message[],
  signal: AbortSignal,
  onStats?: (stats: OllamaStats) => void,
): AsyncGenerator<string> {
  const res = await postModel(
    `${ollamaRoot()}/api/chat`,
    ollamaChatBody(messages, { numPredict: ANSWER_MAX_TOKENS, stream: true }),
    signal,
  );
  if (!res.body) throw new AiUpstreamError(AI_MESSAGE.unusable, `${config.ai.model}: HTTP ${res.status} empty response`);
  yield* readOllamaStream(res.body, onStats);
}

async function* streamAnthropic(
  system: string,
  turns: ChatTurn[],
  signal: AbortSignal,
  onUsage?: OnUsage,
): AsyncGenerator<string> {
  // What the hosted API says it billed: input from the first event, output from the last.
  // A reader who stops early, or a stream with no counts, is charged by size instead.
  let input: number | null = null;
  let output: number | null = null;
  let answered = 0;
  try {
    const stream = getAnthropic().messages.stream(
      { model: config.ai.model, max_tokens: ANSWER_MAX_TOKENS, system, messages: turns },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === 'message_start') input = billedTokens({ ...event.message.usage, output_tokens: 0 });
      else if (event.type === 'message_delta') output = event.usage.output_tokens;
      else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        answered += event.delta.text.length;
        yield event.delta.text;
      }
    }
  } catch (err) {
    if (err instanceof Anthropic.APIError) throw anthropicFailure(err);
    throw err;
  } finally {
    // A call that never started (refused key, no connection) was not billed.
    if (onUsage && (input !== null || answered > 0)) {
      const sent = system.length + turns.reduce((n, t) => n + t.content.length, 0);
      onUsage((input ?? estimatedTokens(sent)) + (output ?? estimatedTokens(answered)));
    }
  }
}

export interface AnswerOptions {
  /** FOCUS blocks for the sites the question names (`buildFocus`). */
  focus?: string | null;
  /** Ollama's token counts once the answer is done, native API only. */
  onStats?: (stats: OllamaStats) => void;
  /** Tokens a hosted answer was billed, once, when it ends however it ends (limits.ts `chargeTo`). */
  onUsage?: OnUsage;
}

/**
 * Answer the latest turn, streaming text as the model produces it. The whole
 * exchange, snapshot, history and answer, is one request; nothing is kept
 * server-side between calls, which is why the client sends its history back.
 *
 * The system text starts with `systemText(snapshot)`, unchanged while the
 * snapshot is, so the model's prompt cache covers it; the focus and language
 * lines that differ per question follow it.
 */
export async function* streamAnswer(
  turns: ChatTurn[],
  snapshot: string,
  signal?: AbortSignal,
  { focus, onStats, onUsage }: AnswerOptions = {},
): AsyncGenerator<string> {
  if (!config.ai.enabled) throw new AiDisabledError();

  const latest = [...turns].reverse().find((t) => t.role === 'user')?.content ?? '';
  const system = [systemText(snapshot), focus, languageReminder(latest)].filter(Boolean).join('\n\n');
  const local = config.ai.provider === 'openai-compatible';

  // One local model request at a time, and AI_MAX_CONCURRENT hosted ones (ai.ts).
  // Waiting for another answer is not this one being slow, so the timeout
  // starts once the model is ours.
  const release = local ? await acquireModelSlot(signal) : await acquireHostedSlot(signal);
  const timeout = AbortSignal.timeout(config.ai.timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    if (!local) {
      yield* streamAnthropic(system, turns, combined, onUsage);
      return;
    }
    const messages = [{ role: 'system', content: system }, ...turns];
    if (await usesOllamaNative()) yield* streamOllama(messages, combined, onStats);
    else yield* streamOpenAiCompatible(messages, combined);
  } catch (err) {
    // The timeout covers the whole answer, not just the first byte, so one that fires mid-stream
    // becomes a readable error instead of the bare DOMException ("The operation was aborted due to
    // timeout"). A reader who pressed Stop is not a failure and is passed through untouched.
    if (timeout.aborted && !signal?.aborted) {
      throw new AiUpstreamError(
        AI_MESSAGE.timeout,
        `${config.ai.model} did not finish its answer within ${config.ai.timeoutMs} ms. ` +
          'Raise AI_TIMEOUT_MS, or ask a narrower question.',
      );
    }
    throw err;
  } finally {
    release();
  }
}
