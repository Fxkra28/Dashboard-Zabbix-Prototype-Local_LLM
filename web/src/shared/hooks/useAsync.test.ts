import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAsync } from './useAsync';

/** A promise the test settles by hand, remembering the signal its run was given. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useAsync', () => {
  it('loads, then holds the data and when it came', async () => {
    const { result } = renderHook(() => useAsync(() => Promise.resolve(42)));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe(42));
    expect(result.current).toMatchObject({ loading: false, error: null, stale: false });
    expect(result.current.updatedAt).toEqual(expect.any(Number));
  });

  it('never lets a slow answer for an old selection overwrite the new one', async () => {
    const slow = deferred<string>();
    const signals: AbortSignal[] = [];
    const { result, rerender } = renderHook(({ host }) =>
      useAsync((signal) => {
        signals.push(signal);
        return host === 'A' ? slow.promise : Promise.resolve('items of B');
      }, [host]), { initialProps: { host: 'A' } });
    rerender({ host: 'B' });
    await waitFor(() => expect(result.current.data).toBe('items of B'));
    expect(signals[0].aborted).toBe(true);
    await act(async () => slow.resolve('items of A'));
    expect(result.current.data).toBe('items of B');
  });

  it('keeps the old data, marked stale, while new deps load', async () => {
    const next = deferred<string>();
    const { result, rerender } = renderHook(({ host }) =>
      useAsync(() => (host === 'A' ? Promise.resolve('A') : next.promise), [host]), { initialProps: { host: 'A' } });
    await waitFor(() => expect(result.current.data).toBe('A'));
    rerender({ host: 'B' });
    expect(result.current).toMatchObject({ data: 'A', stale: true, loading: true });
    await act(async () => next.resolve('B'));
    expect(result.current).toMatchObject({ data: 'B', stale: false, loading: false });
  });

  it('shows a failure', async () => {
    const { result } = renderHook(() => useAsync(() => Promise.reject(new Error('Zabbix is unreachable'))));
    await waitFor(() => expect(result.current.error).toBe('Zabbix is unreachable'));
    expect(result.current.loading).toBe(false);
  });

  it('does not show the abort of a run it replaced as a failure', async () => {
    const hang = (signal: AbortSignal) =>
      new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const { result, rerender } = renderHook(({ n }) => useAsync(hang, [n]), { initialProps: { n: 1 } });
    rerender({ n: 2 });
    await act(async () => undefined);
    expect(result.current.error).toBeNull();
  });

  it('polls one request at a time, counting from when the last settled', async () => {
    vi.useFakeTimers();
    const runs: ReturnType<typeof deferred<number>>[] = [];
    renderHook(() => useAsync(() => {
      const d = deferred<number>();
      runs.push(d);
      return d.promise;
    }, [], 1_000));
    expect(runs).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(runs).toHaveLength(1);
    await act(async () => runs[0].resolve(1));
    await act(async () => vi.advanceTimersByTime(999));
    expect(runs).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(runs).toHaveLength(2);
  });

  it('hands its abort signal to every api call the fetcher makes', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('../../api');
    const { unmount } = renderHook(() => useAsync(() => api.stats()));
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    unmount();
    await waitFor(() => expect(init.signal?.aborted).toBe(true));
  });
});

describe('useAsync and a hidden tab (FR-25)', () => {
  let visibility: DocumentVisibilityState = 'visible';
  const setVisibility = (v: DocumentVisibilityState) => {
    visibility = v;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const settleRuns = () => {
    const runs: number[] = [];
    const hook = renderHook(() =>
      useAsync(() => {
        runs.push(Date.now());
        return Promise.resolve(runs.length);
      }, [], 1_000),
    );
    return { runs, hook };
  };

  it('does not poll while the tab is hidden, and catches up at once on return when a poll came due', async () => {
    vi.useFakeTimers();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const { runs } = settleRuns();
    await act(async () => vi.advanceTimersByTime(0));
    expect(runs).toHaveLength(1);

    await act(async () => void setVisibility('hidden'));
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(runs).toHaveLength(1);

    await act(async () => void setVisibility('visible'));
    await act(async () => vi.advanceTimersByTime(0));
    expect(runs).toHaveLength(2);
  });

  it('waits out the rest of the interval on return when the poll is not due yet', async () => {
    vi.useFakeTimers();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const { runs } = settleRuns();
    await act(async () => vi.advanceTimersByTime(0));
    await act(async () => vi.advanceTimersByTime(400));
    await act(async () => void setVisibility('hidden'));
    await act(async () => void setVisibility('visible'));
    await act(async () => vi.advanceTimersByTime(0));
    expect(runs).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(599));
    expect(runs).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(runs).toHaveLength(2);
  });

  it('starts no poll for a page that was hidden while its first load was out', async () => {
    vi.useFakeTimers();
    visibility = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const { runs } = settleRuns();
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(runs).toHaveLength(1);
  });
});
