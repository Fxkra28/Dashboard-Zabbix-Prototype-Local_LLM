/** The calls behind Explain and the Assistant: the two explanations, the streamed chat and its warm-up. */

import type { SliProfile, ProblemExplanation, SlaExplanation, ChatContext, ChatDone, ChatMessage } from '../types';
import { problemExplanationGuard, slaExplanationGuard } from '../guards';
import { EXPLAIN_TIMEOUT_MS, qs, request } from './client';
import { CSRF, endSession, goToSignIn } from './session';

export type ExplainSlaQuery =
  | { slaid: string; serviceid?: string }
  | { source: 'derived'; month?: string; profile?: SliProfile; scope: string };

/**
 * The assistant. A POST whose response is a text/event-stream (server
 * routes/chat.ts), so it fits neither `post()` nor `EventSource`. Read the
 * body as it arrives and hand each frame to the caller. Resolves on `done`,
 * rejects on an `error` frame or a stream that ends without `done`, and stops
 * early when `signal` aborts.
 */
export async function chatStream(
  messages: ChatMessage[],
  on: {
    onContext?: (c: ChatContext) => void;
    onToken: (t: string) => void;
    onDone?: (d: ChatDone) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/bff/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...CSRF },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (res.status === 401) {
    endSession();
    goToSignIn();
    throw new Error('Unauthorized');
  }
  if (!res.ok || !res.body) {
    const b = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new Error(b?.message ?? b?.error ?? `/api/chat: HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    // A `done` frame returns below, so a stream that ends here ended without its closing frame.
    if (done) throw new Error('The answer was cut off before it finished. Ask again.');
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (!event || data === undefined) continue;
      const payload = JSON.parse(data) as unknown;
      if (event === 'token') on.onToken((payload as { t: string }).t);
      else if (event === 'context') on.onContext?.(payload as ChatContext);
      else if (event === 'error') throw new Error((payload as { message: string }).message);
      else if (event === 'done') {
        on.onDone?.(payload as ChatDone);
        return;
      }
    }
  }
}

/**
 * Ask the BFF to load the local model now, so the first question does not wait
 * for it. Fire-and-forget: failures only mean a slower first answer.
 */
export async function chatWarm(): Promise<void> {
  await fetch('/bff/api/chat/warm').catch(() => undefined);
}

export const assistantApi = {
  // Plain-language layer, on-demand only, never called on page load.
  explainProblem: (eventid: string) =>
    request<ProblemExplanation>(`/api/explain/problem${qs({ eventid })}`, { timeoutMs: EXPLAIN_TIMEOUT_MS, guard: problemExplanationGuard }),
  /** `(slaid, serviceid?)` or an object: a Zabbix SLA, or a scope of the derived monthly SLA. */
  explainSla: (arg: string | ExplainSlaQuery, serviceid?: string) =>
    request<SlaExplanation>(
      `/api/explain/sla${qs(
        typeof arg === 'string'
          ? { slaid: arg, serviceid }
          : 'source' in arg
            ? { source: 'derived', month: arg.month, profile: arg.profile, scope: arg.scope }
            : { slaid: arg.slaid, serviceid: arg.serviceid },
      )}`,
      { timeoutMs: EXPLAIN_TIMEOUT_MS, guard: slaExplanationGuard },
    ),
};
