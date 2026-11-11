import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HOLD_TTL_MS,
  MAX_BYTES,
  MAX_ENTRIES,
  MAX_PINNED_BYTES,
  MAX_TYPED_ENTRIES,
  REFRESH_RETRY_MS,
  approxBytes,
  cached,
  invalidate,
  setCacheLogger,
} from '../core/cache.js';

// The cache is module-level state shared by every test in this file.
beforeEach(() => {
  invalidate('');
});

afterEach(() => {
  vi.useRealTimers();
});

/** A fetch the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let settled promises run their continuations (the cache stores in one). */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/**
 * Only `Date` is faked: the cache reads the clock, and the real setImmediate
 * is still needed to give Node its chance to report an unhandled rejection.
 */
function useClock(): (ms: number) => void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-17T08:00:00Z'));
  return (ms) => vi.setSystemTime(Date.now() + ms);
}

describe('cached', () => {
  it('calls the upstream once and serves the rest from memory', async () => {
    const fn = vi.fn().mockResolvedValue('value');
    expect(await cached('k', 10_000, fn)).toBe('value');
    expect(await cached('k', 10_000, fn)).toBe('value');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the TTL has passed', async () => {
    const fn = vi.fn().mockResolvedValue('v');
    await cached('ttl', 1, fn);
    await new Promise((r) => setTimeout(r, 5));
    await cached('ttl', 1, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent callers into one upstream call', async () => {
    // This is what stops ten NOC screens becoming ten times the Zabbix load.
    let release: (v: string) => void = () => {};
    const fn = vi.fn(() => new Promise<string>((res) => (release = res)));

    const all = Promise.all([
      cached('busy', 10_000, fn),
      cached('busy', 10_000, fn),
      cached('busy', 10_000, fn),
    ]);
    release('shared');

    expect(await all).toEqual(['shared', 'shared', 'shared']);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejection', async () => {
    // A failing upstream must be retried, not remembered for the whole TTL.
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('zabbix down'))
      .mockResolvedValueOnce('recovered');

    await expect(cached('flaky', 10_000, fn)).rejects.toThrow('zabbix down');
    expect(await cached('flaky', 10_000, fn)).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('keeps separate keys separate', async () => {
    await cached('a', 10_000, async () => 1);
    await cached('b', 10_000, async () => 2);
    expect(await cached('a', 10_000, async () => 99)).toBe(1);
    expect(await cached('b', 10_000, async () => 99)).toBe(2);
  });

  it('recovers from an upstream that throws before returning a promise', async () => {
    const boom = () => {
      throw new Error('sync failure');
    };
    await expect(cached('sync', 10_000, boom as () => Promise<string>)).rejects.toThrow('sync failure');
    // Not left registered as in flight: the next caller fetches again.
    expect(await cached('sync', 10_000, async () => 'ok')).toBe('ok');
  });
});

describe('invalidate', () => {
  it('drops only keys matching the prefix, and reports how many', async () => {
    await cached('problems:1', 10_000, async () => 'p1');
    await cached('problems:2', 10_000, async () => 'p2');
    await cached('hosts:1', 10_000, async () => 'h1');

    expect(invalidate('problems')).toBe(2);

    // Dropped keys re-fetch; the untouched one still serves the cached value.
    expect(await cached('problems:1', 10_000, async () => 'fresh')).toBe('fresh');
    expect(await cached('hosts:1', 10_000, async () => 'fresh')).toBe('h1');
  });

  it('returns 0 when nothing matches', () => {
    expect(invalidate('nothing-here')).toBe(0);
  });

  it('does not store a fetch that was in flight when the write happened', async () => {
    const before = deferred<string>();
    const reading = cached('problems', 10_000, () => before.promise);

    invalidate('problems');

    // A caller arriving after the write starts its own fetch instead of
    // joining the one that may have read the old state.
    const after = vi.fn().mockResolvedValue('after');
    expect(await cached('problems', 10_000, after)).toBe('after');
    expect(after).toHaveBeenCalledTimes(1);

    // The old read lands late: its caller still gets an answer…
    before.resolve('before');
    expect(await reading).toBe('before');
    // …but it does not overwrite the post-write value.
    expect(await cached('problems', 10_000, async () => 'refetched')).toBe('after');
  });

  it("does not let a cancelled fetch's cleanup unregister the newer one", async () => {
    const old = deferred<string>();
    const newer = deferred<string>();
    const fn = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);

    const a = cached('k', 10_000, fn);
    invalidate('k');
    const b = cached('k', 10_000, fn);

    old.resolve('old');
    expect(await a).toBe('old');

    // Still coalesces onto the newer fetch rather than starting a third.
    const c = cached('k', 10_000, fn);
    newer.resolve('new');
    expect(await b).toBe('new');
    expect(await c).toBe('new');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('stale serving', () => {
  it('answers at once with the stale value and refreshes exactly once per window', async () => {
    const advance = useClock();
    const refresh = deferred<string>();
    const fn = vi.fn().mockResolvedValueOnce('v1').mockReturnValueOnce(refresh.promise);
    const opts = { staleMs: 10_000 };

    expect(await cached('sli', 1_000, fn, opts)).toBe('v1');
    advance(1_500);

    // Every reader inside the window is answered while the refresh is still running.
    const readers = [cached('sli', 1_000, fn, opts), cached('sli', 1_000, fn, opts), cached('sli', 1_000, fn, opts)];
    expect(await Promise.all(readers)).toEqual(['v1', 'v1', 'v1']);
    expect(fn).toHaveBeenCalledTimes(2);

    refresh.resolve('v2');
    await flush();
    expect(await cached('sli', 1_000, fn, opts)).toBe('v2');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('keeps the stale value when the background refresh fails, with no unhandled rejection', async () => {
    const advance = useClock();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const fn = vi
        .fn()
        .mockResolvedValueOnce('v1')
        .mockRejectedValueOnce(new Error('zabbix down'))
        .mockResolvedValueOnce('v2');
      const opts = { staleMs: 10_000 };

      await cached('avail', 1_000, fn, opts);
      advance(1_500);
      expect(await cached('avail', 1_000, fn, opts)).toBe('v1');
      await new Promise((r) => setImmediate(r));

      // Still answered from the old value, and not retried at once.
      advance(1_000);
      expect(await cached('avail', 1_000, fn, opts)).toBe('v1');
      expect(fn).toHaveBeenCalledTimes(2);

      // Once the window has passed, the next reader fetches in the foreground.
      advance(10_000);
      expect(await cached('avail', 1_000, fn, opts)).toBe('v2');
      expect(fn).toHaveBeenCalledTimes(3);

      await new Promise((r) => setImmediate(r));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('starts another background refresh REFRESH_RETRY_MS after a failed one, not before', async () => {
    const advance = useClock();
    const fn = vi.fn().mockResolvedValueOnce('v1').mockRejectedValueOnce(new Error('zabbix down')).mockResolvedValueOnce('v2');
    const opts = { staleMs: 24 * 3_600_000 };

    await cached('catalog', 3_600_000, fn, opts);
    advance(3_600_001);
    expect(await cached('catalog', 3_600_000, fn, opts)).toBe('v1');
    await new Promise((r) => setImmediate(r));
    expect(fn).toHaveBeenCalledTimes(2);

    advance(REFRESH_RETRY_MS - 1_000);
    expect(await cached('catalog', 3_600_000, fn, opts)).toBe('v1');
    expect(fn).toHaveBeenCalledTimes(2);

    advance(1_000);
    expect(await cached('catalog', 3_600_000, fn, opts)).toBe('v1');
    await flush();
    expect(fn).toHaveBeenCalledTimes(3);
    expect(await cached('catalog', 3_600_000, fn, opts)).toBe('v2');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('asks a Zabbix that stays down about once a minute, however often it is asked for the value', async () => {
    const advance = useClock();
    const fn = vi.fn().mockResolvedValueOnce('v1').mockRejectedValue(new Error('zabbix down'));
    const opts = { staleMs: 24 * 3_600_000 };

    await cached('links', 3_600_000, fn, opts);
    advance(3_600_001);
    // Six requests for each pause, ten pauses, all answered from the old value.
    for (let i = 0; i < 60; i++) {
      expect(await cached('links', 3_600_000, fn, opts)).toBe('v1');
      await new Promise((r) => setImmediate(r));
      advance(REFRESH_RETRY_MS / 6);
    }
    expect(fn).toHaveBeenCalledTimes(1 + 10);
  });

  it('never serves a value past ttl + staleMs', async () => {
    const advance = useClock();
    await cached('old', 1_000, async () => 'v1', { staleMs: 5_000 });
    advance(6_001);
    expect(await cached('old', 1_000, async () => 'v2', { staleMs: 5_000 })).toBe('v2');
  });

  it('staleIfError answers a failed foreground fetch with the last value, however old, and logs it', async () => {
    const advance = useClock();
    const warn = vi.fn();
    setCacheLogger({ warn });
    try {
      const opts = { staleMs: 5_000, staleIfError: true };
      const down = () => Promise.reject(new Error('zabbix down'));
      await cached('avail:7', 1_000, async () => 'v1', opts);
      await cached('noise:7', 1_000, async () => 'n1');

      // An hour on, far past ttl + staleMs: fetched in the foreground, which fails.
      advance(3_600_000);
      expect(await cached('avail:7', 1_000, down, opts)).toBe('v1');
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'avail:7', ageMs: 3_600_000, reason: 'zabbix down' }),
        expect.any(String),
      );

      // Still the old value, without another try; once the pause is over a recovered Zabbix replaces it.
      expect(await cached('avail:7', 1_000, down, opts)).toBe('v1');
      advance(REFRESH_RETRY_MS);
      expect(await cached('avail:7', 1_000, async () => 'v2', opts)).toBe('v2');

      // Without the option the failure is the caller's.
      await expect(cached('noise:7', 1_000, down)).rejects.toThrow('zabbix down');
      // Nothing held: nothing to fall back on.
      await expect(cached('capacity:7', 1_000, down, opts)).rejects.toThrow('zabbix down');
    } finally {
      setCacheLogger(undefined);
    }
  });

  it('past the window, a fetch that failed is not tried again for REFRESH_RETRY_MS, however often the value is asked for (BK-31)', async () => {
    const advance = useClock();
    const fn = vi.fn().mockResolvedValueOnce('v1').mockRejectedValue(new Error('zabbix down'));
    const opts = { staleMs: 10 * 60_000, staleIfError: true };

    await cached('capacity:90', 3_600_000, fn, opts);
    advance(3_600_000 + 10 * 60_000 + 1);
    // Sixty requests ten seconds apart, ten minutes of a Zabbix that does not answer: every one gets the old value.
    for (let i = 0; i < 60; i++) {
      expect(await cached('capacity:90', 3_600_000, fn, opts)).toBe('v1');
      advance(10_000);
    }
    expect(fn).toHaveBeenCalledTimes(1 + 10);
  });

  it('keeps the pause to values that can fall back on an old copy, and to calls that would take one (BK-31)', async () => {
    const advance = useClock();
    const plain = vi.fn().mockResolvedValueOnce('v1').mockRejectedValue(new Error('zabbix down'));
    await cached('plain', 1_000, plain);
    advance(5_000);
    await expect(cached('plain', 1_000, plain)).rejects.toThrow('zabbix down');
    await expect(cached('plain', 1_000, plain)).rejects.toThrow('zabbix down');
    expect(plain).toHaveBeenCalledTimes(3);

    const g = vi.fn().mockResolvedValueOnce('v1').mockRejectedValueOnce(new Error('zabbix down')).mockResolvedValue('v2');
    const opts = { staleIfError: true };
    await cached('limited', 1_000, g, opts);
    advance(5_000);
    expect(await cached('limited', 1_000, g, opts)).toBe('v1');
    // Inside the pause, a call that takes no copy as old as this one fetches all the same.
    expect(await cached('limited', 1_000, g, { ...opts, maxAgeMs: 1_000 })).toBe('v2');
    expect(g).toHaveBeenCalledTimes(3);
  });

  it('joins a fetch that is already running instead of answering from the pause (BK-31)', async () => {
    const advance = useClock();
    const opts = { staleIfError: true };
    await cached('k', 1_000, async () => 'v1', opts);
    advance(5_000);
    expect(await cached('k', 1_000, () => Promise.reject(new Error('zabbix down')), opts)).toBe('v1'); // the pause starts
    let finish!: (v: string) => void;
    const running = cached('k', 1_000, () => new Promise<string>((resolve) => (finish = resolve)), { ...opts, maxAgeMs: 0 });
    const joined = cached('k', 1_000, async () => 'never asked', opts); // inside the pause, but a fetch is running
    finish('v2');
    expect(await running).toBe('v2');
    expect(await joined).toBe('v2');
  });

  it('puts the pause on the copy a failed fetch started from, not on a newer one stored while it ran (BK-31)', async () => {
    const advance = useClock();
    const opts = { staleIfError: true };
    await cached('k', 5_000, async () => 'v1', opts);
    advance(6_000);
    let failLate!: (e: Error) => void;
    const first = cached('k', 5_000, () => new Promise<string>((_, reject) => (failLate = reject)), opts);
    invalidate('k'); // cancels that fetch and drops the copy
    expect(await cached('k', 5_000, async () => 'v2', opts)).toBe('v2');
    failLate(new Error('zabbix down')); // the cancelled fetch fails late, and the answer is the newer copy
    expect(await first).toBe('v2');
    advance(6_000);
    const fn = vi.fn().mockResolvedValue('v3');
    expect(await cached('k', 5_000, fn, opts)).toBe('v3'); // the newer copy expired normally: fetched at once, no pause on it
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('staleIfError never brings back a value that invalidate() dropped, nor answers inside a hold', async () => {
    const advance = useClock();
    const opts = { staleIfError: true };
    const down = () => Promise.reject(new Error('zabbix down'));

    await cached('sites', 1_000, async () => 'before the write', opts);
    invalidate('sites');
    advance(5_000);
    await expect(cached('sites', 1_000, down, opts)).rejects.toThrow('zabbix down');

    // Refilled after a write but still inside its hold: a failed refetch is an error.
    invalidate('stats', { holdMs: 15_000 });
    await cached('stats', 15_000, async () => 'after the write', opts);
    advance(HOLD_TTL_MS + 1);
    await expect(cached('stats', 15_000, down, opts)).rejects.toThrow('zabbix down');
  });
});

describe('maxAgeMs', () => {
  it('counts a value as expired once it is that old for the caller that asks, and for that caller only', async () => {
    const advance = useClock();
    const fn = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');

    expect(await cached('beat', 15_000, fn)).toBe('v1');
    advance(10_000);
    expect(await cached('beat', 15_000, fn)).toBe('v1');
    expect(await cached('beat', 15_000, fn, { maxAgeMs: 10_000 })).toBe('v2');
    expect(fn).toHaveBeenCalledTimes(2);
    // The new value serves everyone again.
    expect(await cached('beat', 15_000, fn)).toBe('v2');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('takes no stale copy past maxAgeMs either: it fetches in the foreground', async () => {
    const advance = useClock();
    const fn = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
    const opts = { staleMs: 60_000 };

    await cached('window', 1_000, fn, opts);
    advance(6_000);
    // Inside the stale window an ordinary call is answered at once from the old copy, and refreshes it behind its back.
    expect(await cached('window', 1_000, async () => 'refresh', opts)).toBe('v1');
    await flush();
    expect(await cached('window', 1_000, fn, opts)).toBe('refresh');
    advance(6_000);
    // A call that insists on a copy under five seconds old waits for the new one.
    expect(await cached('window', 1_000, fn, { ...opts, maxAgeMs: 5_000 })).toBe('v2');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('maxAgeMs of 0 always fetches, and callers that wait for one fetch share it', async () => {
    useClock();
    const fn = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
    expect(await cached('every', 15_000, fn, { maxAgeMs: 0 })).toBe('v1');
    expect(await cached('every', 15_000, fn, { maxAgeMs: 0 })).toBe('v2');
    expect(fn).toHaveBeenCalledTimes(2);

    const slow = deferred<string>();
    const gate = vi.fn().mockReturnValueOnce(slow.promise);
    const first = cached('shared', 15_000, gate, { maxAgeMs: 0 });
    const second = cached('shared', 15_000, gate, { maxAgeMs: 0 });
    slow.resolve('one read');
    expect(await Promise.all([first, second])).toEqual(['one read', 'one read']);
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it('never lengthens the TTL, and a write hold still wins', async () => {
    const advance = useClock();
    const fn = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2').mockResolvedValueOnce('v3').mockResolvedValueOnce('v4');
    const opts = { maxAgeMs: 60_000 };

    await cached('short', 1_000, fn, opts);
    advance(1_500);
    expect(await cached('short', 1_000, fn, opts)).toBe('v2');

    invalidate('short', { holdMs: 15_000 });
    expect(await cached('short', 15_000, fn, opts)).toBe('v3');
    advance(HOLD_TTL_MS + 1);
    expect(await cached('short', 15_000, fn, opts)).toBe('v4');
  });
});

describe('LRU bound', () => {
  it(`holds at most ${MAX_ENTRIES} keys and evicts the least recently used`, async () => {
    for (let i = 0; i < MAX_ENTRIES; i++) await cached(`graph:${i}`, 60_000, async () => i);

    // Reading key 0 makes it recent, so key 1 is now the oldest.
    expect(await cached('graph:0', 60_000, async () => -1)).toBe(0);
    await cached('graph:new', 60_000, async () => MAX_ENTRIES);

    expect(await cached('graph:0', 60_000, async () => -1)).toBe(0);
    expect(await cached(`graph:${MAX_ENTRIES - 1}`, 60_000, async () => -1)).toBe(MAX_ENTRIES - 1);
    // Key 1 was evicted, so it refetches (which in turn evicts key 2).
    expect(await cached('graph:1', 60_000, async () => -1)).toBe(-1);
    expect(invalidate('graph:')).toBe(MAX_ENTRIES);
  });
});

describe('approxBytes', () => {
  it('counts strings by length, numbers as 8, and walks objects, arrays, Maps and Sets', () => {
    expect(approxBytes('x'.repeat(1000))).toBe(16 + 1000);
    expect(approxBytes(42)).toBe(8);
    expect(approxBytes(null)).toBe(0);
    expect(approxBytes([1, 2, 3])).toBe(16 + 8 * 3 + 3 * 8);
    expect(approxBytes({ a: 'abcd', b: 1 })).toBe(24 + 8 * 2 + (16 + 4) + 8);
    expect(approxBytes(new Map([['k', 1]]))).toBeGreaterThan(approxBytes('k') + approxBytes(1));
    expect(approxBytes(new Set(['a', 'b']))).toBeGreaterThan(2 * approxBytes('a'));
  });

  it('counts what a Map and a Set hold, not only their slots', () => {
    const extra = (more: unknown, less: unknown) => approxBytes(more) - approxBytes(less);
    expect(extra(new Map([['k', 'x'.repeat(1000)]]), new Map([['k', 'x']]))).toBe(999);
    expect(extra(new Map([['k'.repeat(500), 1]]), new Map([['k', 1]]))).toBe(499);
    expect(extra(new Set(['x'.repeat(1000)]), new Set(['x']))).toBe(999);
  });

  it('counts a typed array by its byte length and a shared object once, and survives a cycle', () => {
    expect(approxBytes(new Uint8Array(4096))).toBe(4096);
    const shared = { text: 'x'.repeat(500) };
    // Two more slots in the array, and nothing for the two repeats.
    expect(approxBytes([shared, shared, shared])).toBe(approxBytes([shared]) + 2 * 8);
    const loop: Record<string, unknown> = { name: 'loop' };
    loop.self = loop;
    expect(approxBytes(loop)).toBeGreaterThan(0);
  });

  it('stops at its budget instead of walking a huge value to the end', () => {
    const big = Array.from({ length: 5_000 }, (_, i) => ({ i }));
    expect(approxBytes(big, 100)).toBeLessThan(approxBytes(big));
  });
});

describe('byte bound', () => {
  // One string shared by every entry: the estimate counts its length each time, the heap holds it once.
  const eightMb = 'x'.repeat(8 * 1024 * 1024);
  const ENTRY = approxBytes(eightMb);
  const FITS = Math.floor(MAX_BYTES / ENTRY);

  it('holds about its budget and evicts the least recently used first', async () => {
    for (let i = 0; i < FITS; i++) await cached(`report:${i}`, 60_000, async () => eightMb);
    // Reading report:0 makes it recent, so report:1 is the oldest.
    expect(await cached('report:0', 60_000, async () => 'refetched')).toBe(eightMb);
    await cached('report:new', 60_000, async () => eightMb);

    expect(await cached('report:0', 60_000, async () => 'refetched')).toBe(eightMb);
    expect(await cached('report:new', 60_000, async () => 'refetched')).toBe(eightMb);
    expect(await cached('report:1', 60_000, async () => 'refetched')).toBe('refetched');
  });

  it('counts size, not only keys: a few large entries push out older small ones', async () => {
    for (let i = 0; i < 20; i++) await cached(`small:${i}`, 60_000, async () => i);
    for (let i = 0; i < FITS + 2; i++) await cached(`big:${i}`, 60_000, async () => eightMb);
    expect(await cached('small:0', 60_000, async () => -1)).toBe(-1);
    expect(await cached(`big:${FITS + 1}`, 60_000, async () => -1)).toBe(eightMb);
  });

  it('answers a value bigger than the whole budget but does not keep it, and warns', async () => {
    const warn = vi.fn();
    setCacheLogger({ warn });
    try {
      await cached('small', 60_000, async () => 1);
      const huge = 'x'.repeat(MAX_BYTES + 1);
      const fn = vi.fn(async () => huge);
      expect(await cached('huge', 60_000, fn)).toBe(huge);
      expect(await cached('huge', 60_000, fn)).toBe(huge);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ key: 'huge' }), expect.any(String));
      // Nothing else was pushed out to make room for it.
      expect(await cached('small', 60_000, async () => 2)).toBe(1);
    } finally {
      setCacheLogger(undefined);
    }
  });

  it('forgets the old value when its replacement is too big to keep, so it is never served later as the last copy', async () => {
    const advance = useClock();
    const huge = 'x'.repeat(MAX_BYTES + 1);
    await cached('report', 1_000, async () => 'small', { staleIfError: true });
    advance(2_000);
    expect(await cached('report', 1_000, async () => huge, { staleIfError: true })).toBe(huge);
    const down = async () => {
      throw new Error('zabbix down');
    };
    await expect(cached('report', 1_000, down, { staleIfError: true })).rejects.toThrow('zabbix down');
  });

  it('gives the bytes back when keys are invalidated', async () => {
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < FITS; i++) await cached(`r${round}:${i}`, 60_000, async () => eightMb);
      invalidate(`r${round}:`);
    }
    // Had the dropped entries stayed on the books, each of these would already be evicting the last.
    for (let i = 0; i < FITS; i++) await cached(`final:${i}`, 60_000, async () => eightMb);
    expect(await cached('final:0', 60_000, async () => 'refetched')).toBe(eightMb);
  });

  it('gives the bytes back when a key is replaced', async () => {
    const advance = useClock();
    for (let i = 0; i < 10; i++) {
      await cached('same', 1_000, async () => eightMb);
      advance(2_000);
    }
    for (let i = 0; i < FITS - 1; i++) await cached(`other:${i}`, 60_000, async () => eightMb);
    expect(await cached('other:0', 60_000, async () => 'refetched')).toBe(eightMb);
  });
});

describe('pin', () => {
  const eightMb = 'x'.repeat(8 * 1024 * 1024);
  const ENTRY = approxBytes(eightMb);

  it('keeps a pinned entry through a flood of unpinned keys, by count and by size', async () => {
    await cached('derived-sli:closed', 60_000, async () => 'month report', { pin: true });
    for (let i = 0; i < MAX_ENTRIES + 20; i++) await cached(`graph:${i}`, 60_000, async () => i);
    expect(await cached('derived-sli:closed', 60_000, async () => 'rebuilt', { pin: true })).toBe('month report');

    for (let i = 0; i < 12; i++) await cached(`big:${i}`, 60_000, async () => eightMb);
    expect(await cached('derived-sli:closed', 60_000, async () => 'rebuilt', { pin: true })).toBe('month report');
    // The flood itself was bounded: the oldest of it is gone.
    expect(await cached('big:0', 60_000, async () => 'refetched')).toBe('refetched');
  });

  it('without the pin the same flood does push the entry out', async () => {
    await cached('derived-sli:plain', 60_000, async () => 'month report');
    for (let i = 0; i < MAX_ENTRIES + 20; i++) await cached(`graph:${i}`, 60_000, async () => i);
    expect(await cached('derived-sli:plain', 60_000, async () => 'rebuilt')).toBe('rebuilt');
  });

  it('lets pins go, least recently used first, once they alone pass their share', async () => {
    const room = Math.floor(MAX_PINNED_BYTES / ENTRY);
    for (let i = 0; i <= room; i++) await cached(`pin:${i}`, 60_000, async () => eightMb, { pin: true });
    expect(await cached('pin:0', 60_000, async () => 'rebuilt', { pin: true })).toBe('rebuilt');
    expect(await cached(`pin:${room}`, 60_000, async () => 'rebuilt', { pin: true })).toBe(eightMb);
  });

  it('does not let pins fill the budget: past their share the oldest goes, with room to spare overall', async () => {
    // Pins worth more than half the budget and less than all of it: only the pins' own limit can push the first out.
    const pins = Math.floor(MAX_BYTES / ENTRY) - 1;
    for (let i = 0; i < pins; i++) await cached(`pin:${i}`, 60_000, async () => eightMb, { pin: true });
    expect(await cached(`pin:${pins - 1}`, 60_000, async () => 'rebuilt', { pin: true })).toBe(eightMb);
    expect(await cached('pin:0', 60_000, async () => 'rebuilt', { pin: true })).toBe('rebuilt');
  });

  it('pins the value a background refresh stores too', async () => {
    const advance = useClock();
    const opts = { staleMs: 10_000, pin: true };
    await cached('derived-sli:open', 1_000, async () => 'v1', opts);
    advance(1_500);
    expect(await cached('derived-sli:open', 1_000, async () => 'v2', opts)).toBe('v1');
    await flush();
    for (let i = 0; i < MAX_ENTRIES + 20; i++) await cached(`graph:${i}`, 60_000, async () => i);
    expect(await cached('derived-sli:open', 1_000, async () => 'v3', opts)).toBe('v2');
  });
});

describe('typed', () => {
  const typed = { typed: true };

  it(`keeps at most ${MAX_TYPED_ENTRIES} of them (BK-36)`, async () => {
    for (let i = 0; i < MAX_TYPED_ENTRIES + 20; i++) await cached(`search:${i}`, 60_000, async () => i, typed);
    expect(invalidate('search:')).toBe(MAX_TYPED_ENTRIES);
  });

  it('lets the oldest go first (BK-36)', async () => {
    for (let i = 0; i < MAX_TYPED_ENTRIES + 20; i++) await cached(`search:${i}`, 60_000, async () => i, typed);
    // The 20 oldest went and the rest stay.
    expect(await cached(`search:${MAX_TYPED_ENTRIES + 19}`, 60_000, async () => 'refetched', typed)).toBe(MAX_TYPED_ENTRIES + 19);
    expect(await cached('search:20', 60_000, async () => 'refetched', typed)).toBe(20);
    expect(await cached('search:19', 60_000, async () => 'refetched', typed)).toBe('refetched');
    expect(await cached('search:0', 60_000, async () => 'refetched', typed)).toBe('refetched');
  });

  it('cannot push a shared entry out, however many distinct keys come (BK-36)', async () => {
    await cached('problems', 60_000, async () => 'the list');
    for (let i = 0; i < MAX_ENTRIES * 3; i++) await cached(`search:${i}`, 60_000, async () => i, typed);
    expect(await cached('problems', 60_000, async () => 'rebuilt')).toBe('the list');
  });

  it('go before every other entry once the whole cache is full', async () => {
    for (let i = 0; i < MAX_ENTRIES - 10; i++) await cached(`shared:${i}`, 60_000, async () => i);
    for (let i = 0; i < 10; i++) await cached(`search:${i}`, 60_000, async () => i, typed);
    await cached('shared:new', 60_000, async () => 'new');
    // The oldest shared entry stays; the oldest typed one made the room.
    expect(await cached('shared:0', 60_000, async () => 'rebuilt')).toBe(0);
    expect(await cached('search:0', 60_000, async () => 'refetched', typed)).toBe('refetched');
    expect(await cached('search:9', 60_000, async () => 'refetched', typed)).toBe(9);
  });

  it('reading one makes it recent, and replacing one does not count it twice', async () => {
    for (let i = 0; i < MAX_TYPED_ENTRIES; i++) await cached(`search:${i}`, 60_000, async () => i, typed);
    for (let n = 0; n < 5; n++) expect(await cached('search:0', 60_000, async () => -1, typed)).toBe(0);
    await cached('search:new', 60_000, async () => 'new', typed);
    expect(await cached('search:0', 60_000, async () => -1, typed)).toBe(0);
    expect(await cached('search:1', 60_000, async () => 'refetched', typed)).toBe('refetched');
  });

  it('are given back when invalidated, so the count does not drift upward', async () => {
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < MAX_TYPED_ENTRIES; i++) await cached(`search:${i}`, 60_000, async () => i, typed);
      expect(invalidate('search:')).toBe(MAX_TYPED_ENTRIES);
    }
    for (let i = 0; i < MAX_TYPED_ENTRIES; i++) await cached(`search:${i}`, 60_000, async () => i, typed);
    expect(await cached('search:0', 60_000, async () => 'refetched', typed)).toBe(0);
  });

  it('stay typed when a background refresh stores the new value', async () => {
    const advance = useClock();
    const opts = { staleMs: 10_000, typed: true };
    await cached('search:first', 1_000, async () => 'v1', opts);
    advance(1_500);
    expect(await cached('search:first', 1_000, async () => 'v2', opts)).toBe('v1');
    await flush();
    await cached('problems', 60_000, async () => 'the list');
    for (let i = 0; i < MAX_ENTRIES * 2; i++) await cached(`search:${i}`, 60_000, async () => i, typed);
    expect(await cached('problems', 60_000, async () => 'rebuilt')).toBe('the list');
    expect(invalidate('search:')).toBe(MAX_TYPED_ENTRIES);
  });
});

describe('write holds', () => {
  it('keeps invalidated keys on a short TTL, without stale answers, until the hold ends', async () => {
    const advance = useClock();
    await cached('problems', 5_000, async () => 'before');
    await cached('hosts:overview', 15_000, async () => 'before');
    await cached('sla', 60_000, async () => 'untouched');

    invalidate('problems', { holdMs: 15_000 });
    invalidate('hosts:overview', { holdMs: 15_000 });

    const fn = vi.fn().mockResolvedValueOnce('t0').mockResolvedValueOnce('t1').mockResolvedValueOnce('t2');
    expect(await cached('problems', 5_000, fn)).toBe('t0');

    // Inside the hold the 5 s TTL is capped at HOLD_TTL_MS…
    advance(HOLD_TTL_MS - 1);
    expect(await cached('problems', 5_000, fn)).toBe('t0');
    advance(2);
    expect(await cached('problems', 5_000, fn)).toBe('t1');

    // …and staleMs is ignored: the caller waits for the refetch.
    const late = vi.fn().mockResolvedValueOnce('o0').mockResolvedValueOnce('o1');
    expect(await cached('hosts:overview', 15_000, late, { staleMs: 60_000 })).toBe('o0');
    advance(HOLD_TTL_MS + 1);
    expect(await cached('hosts:overview', 15_000, late, { staleMs: 60_000 })).toBe('o1');

    // Keys outside the prefix keep their own TTL.
    expect(await cached('sla', 60_000, async () => 'refetched')).toBe('untouched');

    // After the hold, the normal TTL applies again.
    advance(15_000);
    expect(await cached('problems', 5_000, fn)).toBe('t2');
    advance(4_000);
    expect(await cached('problems', 5_000, fn)).toBe('t2');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
