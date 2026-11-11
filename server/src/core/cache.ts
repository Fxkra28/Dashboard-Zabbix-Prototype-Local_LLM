import { noteRefreshing, noteStale } from './staleness.js';

/**
 * In-memory TTL cache. Every Zabbix call hits its server + DB, so we cache
 * aggressively with short TTLs. Swap for Redis when scaling (setup.md §9).
 *
 * Coalesces concurrent misses: while one fetch is in flight for a key, other
 * callers await the same promise instead of stampeding Zabbix.
 *
 * Bounded to MAX_ENTRIES keys and to about MAX_BYTES of values, least recently
 * used evicted first. Keys that carry parameters (`graph:<items>:<from>:<to>`,
 * `explain:problem:<id>`) would otherwise accumulate for as long as the process runs.
 * The size of a value is an estimate (approxBytes).
 *
 * Two opt-in ways to answer with an expired value, for slow reports whose
 * figures move slowly (the derived SLA, availability, capacity) and for views
 * HCML's Zabbix takes tens of seconds to build, which then say how old they are
 * (noteAge). Never for the problem list itself: an operator who has just
 * acknowledged must not be shown the list from before, and a write drops every
 * view that shows problems (actions.ts STALE_AFTER_WRITE).
 *
 *   staleMs       for this long after the TTL, answer at once with the old
 *                 value and refresh it in the background, one at a time. A
 *                 refresh that fails leaves the old value in place, and the
 *                 first request after REFRESH_RETRY_MS starts another. After the
 *                 window a request fetches in the foreground, unless a fetch
 *                 for this value failed less than REFRESH_RETRY_MS ago.
 *   staleIfError  when that foreground fetch fails, answer with the last
 *                 value this cache still holds, however old, and log it. A
 *                 report from an hour ago beats an error page while Zabbix is
 *                 struggling. Values dropped by invalidate() are gone for
 *                 good, so a write is never undone this way. The request is
 *                 told (staleness.ts: X-Data-Stale, X-Data-Age-Seconds). Zabbix
 *                 is not asked for that value again until REFRESH_RETRY_MS has passed.
 *
 * One opt-in way to keep a value that costs seconds to rebuild:
 *
 *   pin           ordinary eviction takes every unpinned entry first, so a
 *                 flood of graph keys cannot push out a closed month's SLA
 *                 report. Pins share at most MAX_PINNED_BYTES; past that the
 *                 least recently used pinned entry goes too.
 *
 * And one for keys a caller can make as many of as they like:
 *
 *   typed         the key carries text, ids or a page that a caller chose (a
 *                 search, a graph range). At most MAX_TYPED_ENTRIES of these
 *                 are kept, and they go before any other entry, so a run of
 *                 distinct requests cannot push out the problem list or the
 *                 hosts.
 */
type Entry = {
  t: number;
  v: unknown;
  /** approxBytes(v), measured once when the value is stored. */
  bytes: number;
  pinned?: boolean;
  /** Made from what a caller chose (CacheOptions.typed). */
  typed?: boolean;
  /** Set while this value's background refresh runs. */
  refreshing?: boolean;
  /** After a fetch of this value failed and it was kept: no fetch starts before this time (epoch ms). */
  retryAt?: number;
};

/**
 * One fetch. invalidate() sets `cancelled`: whoever is already waiting still
 * gets the result, but it is not stored: it was read before the write that
 * made it out of date.
 */
type Flight = { promise: Promise<unknown>; cancelled: boolean };

export interface CacheOptions {
  /** Serve the expired value for this long past the TTL while one background refresh runs. */
  staleMs?: number;
  /** On a failed fetch, answer with the last value held, of any age, rather than the error. */
  staleIfError?: boolean;
  /** Evict this entry only after every unpinned one: for reports that take seconds to rebuild. */
  pin?: boolean;
  /** The key is made from what a caller chose: at most MAX_TYPED_ENTRIES such entries, and they are evicted first. */
  typed?: boolean;
  /** With staleMs: mark an answer served from the old value with its age (staleness.ts), so the page can say how old it is. */
  noteAge?: boolean;
  /**
   * This call takes no value this old, fresh or stale, and fetches in the foreground instead: a caller on a
   * fixed beat would otherwise meet the value a whole beat older at its next call. 0 always fetches.
   */
  maxAgeMs?: number;
}

/** A view HCML's Zabbix takes tens of seconds to build: past its TTL, its last copy and age for 10 minutes while one refresh runs. */
export const SLOW_VIEW: CacheOptions = { staleMs: 10 * 60_000, staleIfError: true, noteAge: true };

/** The part of Fastify's logger the cache uses. */
export interface CacheLogger {
  warn(obj: object, msg: string): void;
}

export interface InvalidateOptions {
  /**
   * Keep the matching keys on a short leash for this long afterwards: TTL at
   * most HOLD_TTL_MS and no stale answers. Zabbix applies a close a few
   * seconds after `event.acknowledge` returns, so a single refetch straight
   * after the write can still read the old state.
   */
  holdMs?: number;
}

export const MAX_ENTRIES = 500;
/** The share of those that keys a caller can multiply at will may take. */
export const MAX_TYPED_ENTRIES = 150;
/** About 130 KB per entry at the entry cap: the problem list is ~450 KB (stream.ts), most values far less. */
export const MAX_BYTES = 64 * 1024 * 1024;
export const MAX_PINNED_BYTES = MAX_BYTES / 2;
export const HOLD_TTL_MS = 2_000;
/** After a fetch of a value with an old copy fails, none starts for this long, so a Zabbix that is down is asked about each value once a minute and not on every request. */
export const REFRESH_RETRY_MS = 60_000;

/**
 * A rough size in bytes: strings by length, numbers as 8, objects and arrays
 * by their slots, Maps and typed arrays by what they hold. Within about 40% of
 * the real heap growth on a problem list, graph series and a Map of readings.
 * Walks at most `budget` values, so a huge one costs a bounded few
 * milliseconds and is counted as at least what was seen; shared objects and
 * cycles are counted once.
 */
export function approxBytes(value: unknown, budget = 500_000): number {
  const seen = new Set<object>();
  const todo: unknown[] = [value];
  let bytes = 0;
  for (let n = 0; todo.length && n < budget; n++) {
    const v = todo.pop();
    if (typeof v === 'string') bytes += 16 + v.length;
    else if (typeof v === 'number') bytes += 8;
    else if (typeof v === 'bigint') bytes += 16;
    else if (typeof v === 'object' && v !== null && !seen.has(v)) {
      seen.add(v);
      if (ArrayBuffer.isView(v)) bytes += v.byteLength;
      else if (v instanceof Map) {
        bytes += 40 + 24 * v.size;
        for (const [k, x] of v) todo.push(k, x);
      } else if (v instanceof Set) {
        bytes += 40 + 16 * v.size;
        for (const x of v) todo.push(x);
      } else if (Array.isArray(v)) {
        bytes += 16 + 8 * v.length;
        for (const x of v) todo.push(x);
      } else {
        const keys = Object.keys(v);
        bytes += 24 + 8 * keys.length;
        for (const k of keys) todo.push((v as Record<string, unknown>)[k]);
      }
    }
  }
  return bytes;
}

const store = new Map<string, Entry>();
/** Sum of `bytes` over `store`, and over its pinned entries. */
let heldBytes = 0;
let pinnedBytes = 0;
let typedCount = 0;
const inflight = new Map<string, Flight>();
/** Invalidated prefix → when its hold ends (epoch ms). */
const holds = new Map<string, number>();
let log: CacheLogger | undefined;

/** Where stale answers and failed background refreshes are reported (index.ts passes app.log). */
export function setCacheLogger(logger: CacheLogger | undefined): void {
  log = logger;
}

/** The same logger, for a caller that reports a failed background read of its own. */
export function cacheLogger(): CacheLogger | undefined {
  return log;
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  opts: CacheOptions = {},
): Promise<T> {
  const now = Date.now();
  const held = isHeld(key, now);
  const ttl = held ? Math.min(ttlMs, HOLD_TTL_MS) : ttlMs;
  const staleMs = held ? 0 : Math.max(0, opts.staleMs ?? 0);
  const maxAge = opts.maxAgeMs ?? Infinity;

  const hit = store.get(key);
  if (hit) {
    const age = now - hit.t;
    if (age < ttl && age < maxAge) {
      remember(key, hit);
      return hit.v as T;
    }
    if (age < ttl + staleMs && age < maxAge) {
      remember(key, hit);
      if (opts.noteAge) noteRefreshing(age);
      if (!hit.refreshing && !inflight.has(key) && now >= (hit.retryAt ?? 0)) {
        hit.refreshing = true;
        // Nobody awaits this promise. Left unhandled, a rejection would take
        // the whole process down; caught, the stale value simply stays.
        begin(key, fn, opts).promise.catch((err: unknown) => {
          hit.refreshing = false;
          hit.retryAt = Date.now() + REFRESH_RETRY_MS;
          log?.warn({ key, reason: reason(err) }, 'cache: background refresh failed; keeping the stale value');
        });
      }
      return hit.v as T;
    }
    // Past the window, behind a fetch that failed: the old copy again until the pause is over.
    if (opts.staleIfError && !held && age < maxAge && now < (hit.retryAt ?? 0) && !inflight.has(key)) {
      remember(key, hit);
      noteStale(age);
      return hit.v as T;
    }
  }

  const flight = inflight.get(key) ?? begin(key, fn, opts);
  try {
    return (await flight.promise) as T;
  } catch (err) {
    // Never inside a write hold: that is exactly when an old value is wrong.
    const last = opts.staleIfError && !held ? store.get(key) : undefined;
    if (!last) throw err;
    remember(key, last);
    // Only on the copy this call started from: a newer one stored while the fetch ran (an invalidate, a second fetch) is fresh.
    if (last === hit) last.retryAt = Date.now() + REFRESH_RETRY_MS;
    const ageMs = Date.now() - last.t;
    noteStale(ageMs);
    log?.warn({ key, ageMs, reason: reason(err) }, 'cache: fetch failed; answering with the last cached value');
    return last.v as T;
  }
}

/**
 * Start a fetch and register it as the key's in-flight one. Registered before
 * `fn` runs, so that a synchronous throw inside `fn` still gets cleaned up.
 */
function begin(key: string, fn: () => Promise<unknown>, opts: CacheOptions): Flight {
  const flight: Flight = { promise: Promise.resolve(), cancelled: false };
  inflight.set(key, flight);
  flight.promise = (async () => {
    try {
      const v = await fn();
      if (!flight.cancelled) keep(key, v, opts);
      return v;
    } finally {
      // Only our own record: after an invalidate a newer fetch may own the key.
      if (inflight.get(key) === flight) inflight.delete(key);
    }
  })();
  return flight;
}

/** Store a fetched value. One bigger than the whole budget is not kept: it would only empty the cache. */
function keep(key: string, v: unknown, opts: CacheOptions): void {
  const bytes = approxBytes(v);
  if (bytes > MAX_BYTES) {
    discard(key);
    log?.warn({ key, bytes }, 'cache: value is larger than the whole cache budget; not storing it');
    return;
  }
  remember(key, { t: Date.now(), v, bytes, pinned: opts.pin || undefined, typed: opts.typed || undefined });
}

function discard(key: string): void {
  const entry = store.get(key);
  if (!entry) return;
  store.delete(key);
  heldBytes -= entry.bytes;
  if (entry.pinned) pinnedBytes -= entry.bytes;
  if (entry.typed) typedCount--;
}

/** Store (or re-store) as most recently used, then evict past the entry and byte caps. */
function remember(key: string, entry: Entry): void {
  discard(key);
  store.set(key, entry);
  heldBytes += entry.bytes;
  if (entry.pinned) pinnedBytes += entry.bytes;
  if (entry.typed) typedCount++;
  evict();
}

/** The least recently used key, among the entries `want` accepts when it is given. */
function oldest(want?: (e: Entry) => boolean): string | undefined {
  for (const [key, entry] of store) if (!want || want(entry)) return key;
  return undefined;
}

/**
 * Least recently used first: typed before unpinned before pinned. Pins are kept only up to
 * MAX_PINNED_BYTES; after that the oldest of them is as fair a victim as any.
 */
function evict(): void {
  while (pinnedBytes > MAX_PINNED_BYTES) {
    const key = oldest((e) => e.pinned === true);
    if (key === undefined) break;
    discard(key);
  }
  while (typedCount > MAX_TYPED_ENTRIES) {
    const key = oldest((e) => e.typed === true);
    if (key === undefined) break;
    discard(key);
  }
  while (store.size > MAX_ENTRIES || heldBytes > MAX_BYTES) {
    const key = oldest((e) => e.typed === true) ?? oldest((e) => !e.pinned) ?? oldest();
    if (key === undefined) break;
    discard(key);
  }
}

function isHeld(key: string, now: number): boolean {
  let held = false;
  for (const [prefix, until] of holds) {
    if (until <= now) holds.delete(prefix);
    else if (key.startsWith(prefix)) held = true;
  }
  return held;
}

/**
 * Drop cached entries so the next read refetches. Used after a write-back (§20): without it an
 * acknowledgement would not show for up to the TTL and the UI would look as if it silently failed.
 * Fetches already in flight for a matching key are cancelled too: their callers still get an
 * answer, but it is not stored, so a read that started just ahead of an acknowledge cannot put the
 * pre-acknowledge list back for a full TTL. `prefix` matches by string prefix, so
 * `invalidate('avail:')` clears every parameterised availability report at once, and
 * `invalidate('')` clears everything, holds included (how the tests start clean). Returns how many
 * stored entries were dropped.
 */
export function invalidate(prefix: string, opts: InvalidateOptions = {}): number {
  let dropped = 0;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      discard(key);
      dropped++;
    }
  }
  for (const [key, flight] of inflight) {
    if (key.startsWith(prefix)) {
      flight.cancelled = true;
      inflight.delete(key);
    }
  }
  if (prefix === '') holds.clear();
  if (opts.holdMs && opts.holdMs > 0) {
    holds.set(prefix, Math.max(holds.get(prefix) ?? 0, Date.now() + opts.holdMs));
  }
  return dropped;
}
