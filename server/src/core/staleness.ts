import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';

/**
 * Says so, in two response headers, when an answer is an old copy kept because Zabbix failed.
 * cache.ts notes it while a request is being served; the hook below adds the headers on the way
 * out. The JSON body is untouched, and a request answered live carries neither header.
 *
 *   X-Data-Stale: true
 *   X-Data-Age-Seconds: <how old the copy is>
 *
 * A slow view's last copy, answered while a newer one is read, carries `X-Data-Refreshing: true`
 * and the same age header instead.
 *
 * Request-scoped, not threaded through the callers: the report that went stale is often several
 * calls below the route handler (availability for a month reads the derived SLI, which reads the
 * cache).
 */

export const STALE_HEADER = 'X-Data-Stale';
export const AGE_HEADER = 'X-Data-Age-Seconds';
/**
 * The other kind of old copy: a slow view answered with its last copy while a newer one is read
 * (cache.ts, `noteAge`). Not a failure, so never with X-Data-Stale; X-Data-Age-Seconds says how old.
 */
export const REFRESHING_HEADER = 'X-Data-Refreshing';

interface Served {
  /** The oldest copy this request was answered with, in ms; null while every answer was live. */
  oldestMs: number | null;
  /** The oldest copy answered while its refresh runs, in ms; null when there was none. */
  refreshingMs: number | null;
}

const current = new AsyncLocalStorage<Served>();
const byRequest = new WeakMap<object, Served>();

/** Called by cache.ts when it answers a failed fetch with an old copy. No-op outside a request. */
export function noteStale(ageMs: number): void {
  const served = current.getStore();
  if (served) served.oldestMs = Math.max(served.oldestMs ?? 0, ageMs);
}

/** Called by cache.ts when a slow view answers with its last copy while a newer one is read. No-op outside a request. */
export function noteRefreshing(ageMs: number): void {
  const served = current.getStore();
  if (served) served.refreshingMs = Math.max(served.refreshingMs ?? 0, ageMs);
}

/** Register before the routes: a hook applies only to routes added after it. */
export function registerStaleHeaders(app: FastifyInstance): void {
  app.addHook('onRequest', (req, _reply, done) => {
    const served: Served = { oldestMs: null, refreshingMs: null };
    byRequest.set(req, served);
    current.run(served, done);
  });
  app.addHook('onSend', (req, reply, payload, done) => {
    const served = byRequest.get(req);
    const seconds = (ms: number) => String(Math.max(0, Math.round(ms / 1000)));
    // A failed fetch is the stronger news: it alone is reported when both happened.
    if (served?.oldestMs != null) {
      reply.header(STALE_HEADER, 'true');
      reply.header(AGE_HEADER, seconds(served.oldestMs));
    } else if (served?.refreshingMs != null) {
      reply.header(REFRESHING_HEADER, 'true');
      reply.header(AGE_HEADER, seconds(served.refreshingMs));
    }
    done(null, payload);
  });
}
