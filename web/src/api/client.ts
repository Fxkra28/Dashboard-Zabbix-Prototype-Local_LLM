/**
 * The one place a read or a write leaves the page: the deadline of every request, the abort signal a page's fetcher attaches, the check of an
 * answer's shape, and what a 401 or a failed reply turns into.
 */

import { noteStaleCopy } from '../shared/lib/freshness';
import { assertFits, UnreadableAnswer, type Guard } from '../guards';
import { CSRF, endSession, goToSignIn } from './session';

/**
 * The abort signal for requests started right now; see `withSignal`.
 *
 * useAsync cancels a request nobody will read: the page moved to another
 * device, reloaded, or closed. Rather than thread a signal through every
 * `api.*` method, it sets this around its synchronous call to the fetcher.
 * `request()` reads it before its first `await`, so every request that call
 * starts picks it up; one started later (after an `await`) does not.
 */
export let currentSignal: AbortSignal | undefined;

/** Run `fn`, attaching `signal` to each `request()` it starts synchronously. */
export function withSignal<T>(signal: AbortSignal | undefined, fn: () => T): T {
  const previous = currentSignal;
  currentSignal = signal;
  try {
    return fn();
  } finally {
    currentSignal = previous;
  }
}

/**
 * A reply that was not a success. `told` is whether the BFF said why in its own words; when it did
 * not (an nginx 502 page, an empty 504), the message is only the route and the status, which is
 * for a log and not for a person.
 */
export class HttpFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly told: boolean,
  ) {
    super(message);
    this.name = 'HttpFailure';
  }
}

/** The GET behind every read, JSON or file, so a 401 and a failure's message are handled in one place. */
export async function fetchOk(path: string, signal: AbortSignal | undefined): Promise<Response> {
  // Same-origin, so the browser sends the session cookie by itself.
  const res = await fetch(`/bff${path}`, { signal });

  if (res.status === 401) {
    endSession();
    goToSignIn();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    // The BFF returns a typed body for the failures an operator can act on:
    // a rejected Zabbix token, the AI layer off or unreachable. Show that
    // message instead of a bare status code.
    const body = (await res.json().catch(() => null)) as
      | { error?: unknown; message?: unknown }
      | null;
    // Only words count: an empty message or an object would read as a blank or "[object Object]".
    const said = [body?.message, body?.error].find((v): v is string => typeof v === 'string' && v.trim() !== '');
    throw new HttpFailure(said ?? `${path}: HTTP ${res.status}`, res.status, said !== undefined);
  }
  return res;
}

/** How long a read may go unanswered before the page is told it failed: one page took HCML's Zabbix 256 s. */
const REQUEST_TIMEOUT_MS = 330_000;

/** An explanation reads Zabbix, then waits on a language model (30 s with one retry hosted, 120 s local). Below nginx's 480 s. */
export const EXPLAIN_TIMEOUT_MS = 450_000;

/** The first monthly SLA after a restart is computed from months of events. Below nginx's 480 s. */
export const SLI_TIMEOUT_MS = 450_000;

/**
 * All portal data goes through /bff (proxied to the BFF); the browser never sees Zabbix.
 *
 * Every request has a deadline: without one a stalled request freezes a page's polling until nginx
 * gives up, with no "refresh failed" note. A plain controller, as in `doRenew`, joined to the
 * caller's signal: AbortSignal.timeout and .any are missing in older browsers. Only a deadline that
 * passed reads as a failure; a cancel from the caller stays a cancel.
 */
export async function request<T>(
  path: string,
  init: { signal?: AbortSignal; timeoutMs?: number; guard?: Guard<T> } = {},
): Promise<T> {
  const caller = init.signal ?? currentSignal;
  const abort = new AbortController();
  const cancel = () => abort.abort();
  if (caller?.aborted) cancel();
  else caller?.addEventListener('abort', cancel, { once: true });
  const limit = init.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, limit);
  try {
    const res = await fetchOk(path, abort.signal);
    const json = (await res.json()) as T;
    // An answer of the wrong shape becomes the page's ordinary error, not a crash in whatever reads it.
    const body = init.guard ? assertFits(init.guard, json, path) : json;
    // An old copy kept because Zabbix failed is flagged in a header, not the body.
    noteStaleCopy(body, res.headers);
    return body;
  } catch (err) {
    if (timedOut && !caller?.aborted) {
      throw new Error(`No answer from the server within ${Math.round(limit / 1000)} seconds.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener('abort', cancel);
  }
}

/**
 * A write, with the deadline of a read. The timeout says the change may have been made, because the server can finish after the
 * page gave up, and a person who sends it again would otherwise do it twice.
 */
async function write<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body: unknown, guard?: Guard<T>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(`/bff${path}`, {
      method,
      // A DELETE has no body, and the server refuses a JSON content type with an empty one.
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...CSRF },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
    });

    if (res.status === 401) {
      endSession();
      goToSignIn();
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const b = (await res.json().catch(() => null)) as
        | { error?: unknown; message?: unknown }
        | null;
      // Only words count, as for a read: an nginx page or an empty body carries none, and the page then says so in its own.
      const said = [b?.message, b?.error].find((v): v is string => typeof v === 'string' && v.trim() !== '');
      throw new HttpFailure(said ?? `${path}: HTTP ${res.status}`, res.status, said !== undefined);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      // The server said it was done, so the change was made: only its answer is not JSON.
      if (abort.signal.aborted) throw err;
      throw new UnreadableAnswer(path, 'an answer', 'the body is not JSON');
    }
    return guard ? assertFits(guard, json, path) : (json as T);
  } catch (err) {
    if (abort.signal.aborted) {
      throw new Error(
        `No answer from the server within ${Math.round(timeoutMs / 1000)} seconds. Check whether the change was made before you send it again.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const post = <T>(path: string, body: unknown, guard?: Guard<T>, timeoutMs?: number): Promise<T> => write<T>('POST', path, body, guard, timeoutMs);
export const put = <T>(path: string, body: unknown, guard?: Guard<T>): Promise<T> => write<T>('PUT', path, body, guard);
export const del = <T>(path: string, guard?: Guard<T>): Promise<T> => write<T>('DELETE', path, undefined, guard);

export const qs = (params: Record<string, string | number | undefined>) => {
  const p = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return p ? `?${p}` : '';
};
