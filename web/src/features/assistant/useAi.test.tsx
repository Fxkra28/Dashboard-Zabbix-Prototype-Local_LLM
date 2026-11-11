import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

/**
 * The capability check can say "unknown": while
 * /api/health has not answered, and after it failed, `ai: false` is not an
 * answer, and a page must not read it as "no model configured". The same
 * answer carries the server's time zone.
 */

const { health } = vi.hoisted(() => ({ health: vi.fn() }));
vi.mock('../../api', () => ({ api: { health } }));

const answer = (over: Record<string, unknown> = {}) => ({
  ok: true,
  ts: 1,
  ai: true,
  writeBack: false,
  defaults: { availabilityMinSeverity: 3, timezone: 'Asia/Makassar' },
  ...over,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The module fresh: the probe and its answer are module-level, shared by every page. */
async function load() {
  vi.resetModules();
  const [ai, time] = await Promise.all([import('./useAi'), import('../../shared/lib/time')]);
  return { ...ai, ...time };
}

beforeEach(() => {
  health.mockReset(); // a block body: returning the mock would have vitest call it as a teardown
});
afterEach(() => vi.useRealTimers());

describe('useCapabilities', () => {
  it('is unknown, not "no model", until the server has answered', async () => {
    const pending = deferred<ReturnType<typeof answer>>();
    health.mockReturnValue(pending.promise);
    const { useCapabilities } = await load();

    const { result } = renderHook(() => useCapabilities());
    expect(result.current).toMatchObject({ known: false, failed: false, ai: false });

    await act(async () => pending.resolve(answer()));
    expect(result.current).toMatchObject({ known: true, failed: false, ai: true, writeBack: false, availabilityMinSeverity: 3 });
  });

  it('says a configured-but-off model is off only once it knows', async () => {
    health.mockResolvedValue(answer({ ai: false }));
    const { useCapabilities } = await load();
    const { result } = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.known).toBe(true));
    expect(result.current).toMatchObject({ ai: false, failed: false });
  });

  it('reports a health call that failed as failed, still not known, and asks again on retry', async () => {
    health.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(answer());
    const { useCapabilities } = await load();

    const { result } = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current).toMatchObject({ known: false, ai: false });

    act(() => result.current.retry());
    // Checking again: neither "failed" nor an answer yet.
    expect(result.current).toMatchObject({ known: false, failed: false });
    await waitFor(() => expect(result.current.known).toBe(true));
    expect(result.current).toMatchObject({ ai: true, failed: false });
    expect(health).toHaveBeenCalledTimes(2);
  });

  it('does not remember a failure: the next page to ask tries again', async () => {
    health.mockRejectedValueOnce(new Error('503')).mockResolvedValue(answer());
    const { useCapabilities } = await load();

    const first = renderHook(() => useCapabilities());
    await waitFor(() => expect(first.result.current.failed).toBe(true));
    first.unmount();

    const second = renderHook(() => useCapabilities());
    await waitFor(() => expect(second.result.current.known).toBe(true));
    expect(health).toHaveBeenCalledTimes(2);
  });

  it('shares one answer: a page opened later starts from it, with no "checking" in between', async () => {
    health.mockResolvedValue(answer());
    const { useCapabilities } = await load();

    const first = renderHook(() => useCapabilities());
    await waitFor(() => expect(first.result.current.known).toBe(true));

    const second = renderHook(() => useCapabilities());
    expect(second.result.current).toMatchObject({ known: true, ai: true });
    expect(health).toHaveBeenCalledTimes(1);
  });

  it('does not let an answer reach a page that has gone', async () => {
    const pending = deferred<ReturnType<typeof answer>>();
    health.mockReturnValue(pending.promise);
    const { useCapabilities } = await load();
    const { unmount } = renderHook(() => useCapabilities());
    unmount();
    await act(async () => pending.resolve(answer()));
    // Nothing to assert on a gone hook; the point is that React does not warn or throw.
    expect(health).toHaveBeenCalledTimes(1);
  });
});

describe('the time zone from /api/health', () => {
  it('becomes the report zone', async () => {
    health.mockResolvedValue(answer());
    const { loadCapabilities, reportTimeZone } = await load();
    expect(reportTimeZone()).toBe('Asia/Jakarta');
    await loadCapabilities();
    expect(reportTimeZone()).toBe('Asia/Makassar');
  });

  it('stays Asia/Jakarta when the server names none, or one this browser does not know', async () => {
    for (const defaults of [{ availabilityMinSeverity: 2 }, { timezone: 'Mars/Olympus_Mons' }, undefined]) {
      health.mockResolvedValue(answer({ defaults }));
      const { loadCapabilities, reportTimeZone } = await load();
      await loadCapabilities();
      expect(reportTimeZone(), JSON.stringify(defaults)).toBe('Asia/Jakarta');
    }
  });

  it('is left alone by a failed call', async () => {
    health.mockRejectedValue(new Error('down'));
    const { loadCapabilities, reportTimeZone } = await load();
    await expect(loadCapabilities()).resolves.toMatchObject({ failed: true, known: false });
    expect(reportTimeZone()).toBe('Asia/Jakarta');
  });
});
