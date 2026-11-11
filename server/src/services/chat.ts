import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { getSnapshot, systemText, type ChatTurn } from './assistant.js';
import { AiDisabledError, AiUpstreamError, prefillModel, warmModel } from '../clients/ai.js';
import { ZabbixApiError, ZabbixAuthError, ZabbixTimeoutError } from '../clients/zabbix.js';
import { SOURCE_DOWN } from '../http/errors.js';

/**
 * The assistant endpoint. A POST because the conversation travels in the body,
 * but it performs no write: the model is read-only by construction (see
 * assistant.ts), and nothing here touches Zabbix beyond the cached reads every page
 * already makes.
 *
 * The response is a `text/event-stream`, same framing as /api/stream, so the
 * answer appears as it is generated rather than after a long silence:
 *
 *   event: context: what the model was shown (counts, snapshot time)
 *   event: token:   one piece of the answer; concatenate in order
 *   event: done:    finished; `ms` is the model's wall time, `firstTokenMs`
 *                     the wait for its first token, and `text` the cleaned-up
 *                     answer the client should keep in place of the raw tokens
 *   event: error:   the model failed part-way (or was busy with another
 *                     question); the text so far is all there is
 */

/**
 * Keep the prompt inside a small model's context window. See assistant.ts. The
 * newest turns are kept until their combined length reaches the budget; the
 * latest (user) turn is always kept.
 */
const MAX_TURN_CHARS = 2_000;
export const HISTORY_CHAR_BUDGET = 3_000;

/** A cold model takes ~10 s to load; warm it at most this often. */
const WARM_EVERY_MS = 5 * 60_000;
let lastWarm = 0;

/** True when the model is due a load, and claims the slot so the next call within the window is not. */
export function claimWarmSlot(now = Date.now()): boolean {
  const due = now - lastWarm >= WARM_EVERY_MS;
  if (due) lastWarm = now;
  return due;
}

/**
 * Hash of the system text the model last read in full, by a prefill or by
 * answering from it. The page opening again on the same snapshot then has
 * nothing to prefill, and prefilling anyway would push the conversation it
 * just had out of the model's slot.
 */
let lastRead = '';
const digest = (text: string) => createHash('sha1').update(text).digest('hex');

/** The model has read this system text in full, by answering from it. */
export function noteModelRead(system: string): void {
  lastRead = digest(system);
}

/** How often, and how long apart, the prefill asks again for a snapshot still missing its SLA. */
const PREFILL_RETRIES = 3;
const PREFILL_RETRY_MS = 5_000;

/**
 * Load the model (when due) while the snapshot is fetched, then have the model
 * read the system text the next question will start with. Never throws.
 */
export async function warmAndPrefill(log: FastifyBaseLogger, load: boolean): Promise<void> {
  try {
    let [, snapshot] = await Promise.all([load ? warmModel(log) : undefined, getSnapshot()]);
    // One built while the derived SLA was still computing is never reused, so
    // the model reading it would be wasted; the computation carries on, so ask
    // again shortly.
    for (let retry = 1; !snapshot.complete && retry <= PREFILL_RETRIES; retry++) {
      await new Promise((resolve) => setTimeout(resolve, PREFILL_RETRY_MS));
      snapshot = await getSnapshot();
    }
    if (!snapshot.complete) return;
    const system = systemText(snapshot.text);
    const hash = digest(system);
    if (hash === lastRead) return;
    if (await prefillModel(system, log)) lastRead = hash;
  } catch (err) {
    log.debug({ err: err instanceof Error ? err.message : String(err) }, 'chat prefill failed');
  }
}

/** Typed AI errors carry wording for a reader (their `detail` is for the log), a Zabbix failure is errors.ts's one sentence, and anything else is a bug. */
export function publicMessage(err: unknown): string {
  if (err instanceof ZabbixApiError || err instanceof ZabbixTimeoutError || err instanceof ZabbixAuthError) {
    return SOURCE_DOWN;
  }
  const typed = err instanceof AiUpstreamError || err instanceof AiDisabledError;
  return typed ? err.message : 'The assistant hit an unexpected error. Tell an administrator.';
}

export function parseTurns(body: unknown): ChatTurn[] | null {
  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw) || !raw.length) return null;

  const turns: ChatTurn[] = [];
  for (const m of raw) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
    const text = content.trim();
    if (text) turns.push({ role, content: text.slice(0, MAX_TURN_CHARS) });
  }
  // The model answers the last turn, so it must be the user's.
  if (!turns.length || turns[turns.length - 1].role !== 'user') return null;

  const kept: ChatTurn[] = [];
  let chars = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    chars += turns[i].content.length;
    if (kept.length && chars > HISTORY_CHAR_BUDGET) break;
    kept.unshift(turns[i]);
  }
  // A conversation must open with the user (Anthropic requires it).
  while (kept.length > 1 && kept[0].role !== 'user') kept.shift();
  return kept;
}
