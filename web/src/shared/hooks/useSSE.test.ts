import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { unreadableMessage, type Guard } from '../../guards';

const me = vi.fn(() => Promise.resolve({ authEnabled: true }));
vi.mock('../../api', () => ({ api: { me: () => me() } }));
const { useSSE } = await import('./useSSE');

/** An EventSource the test drives: frames, errors and closes happen when it says so. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static all: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private listeners = new Map<string, ((e: { data: string }) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, fn: (e: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  frame(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) });
  }
}
const latest = () => FakeEventSource.all[FakeEventSource.all.length - 1];

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  FakeEventSource.all = [];
  me.mockClear();
  visibility = 'visible';
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const setVisibility = (v: DocumentVisibilityState) => {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('useSSE', () => {
  it('opens the stream at the URL it is given, and is live once a frame arrives', () => {
    const { result } = renderHook(() => useSSE<number[]>('/bff/api/stream', 'problems'));
    expect(latest().url).toBe('/bff/api/stream');
    expect(result.current.connected).toBe(false);
    act(() => latest().frame('problems', [1, 2]));
    expect(result.current).toMatchObject({ data: [1, 2], connected: true, error: null });
  });

  it('shows an error frame from the BFF and keeps the line open', () => {
    const { result } = renderHook(() => useSSE('/bff/api/stream', 'problems'));
    act(() => latest().onerror?.({ data: JSON.stringify({ message: 'Zabbix read failed' }) }));
    expect(result.current).toMatchObject({ connected: false, error: 'Zabbix read failed' });
    expect(FakeEventSource.all).toHaveLength(1);
    expect(me).not.toHaveBeenCalled();
  });

  it('asks whether the session is still good when the line drops, and reopens a closed stream', () => {
    renderHook(() => useSSE('/bff/api/stream', 'problems'));
    const first = latest();
    act(() => {
      first.readyState = FakeEventSource.CLOSED;
      first.onerror?.({});
    });
    expect(me).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2_000));
    expect(FakeEventSource.all).toHaveLength(2);
  });

  it('treats a stream gone quiet as dropped', () => {
    const { result } = renderHook(() => useSSE('/bff/api/stream', 'problems', 45_000));
    const first = latest();
    act(() => first.frame('problems', []));
    expect(result.current.connected).toBe(true);
    act(() => vi.advanceTimersByTime(45_000));
    expect(first.readyState).toBe(FakeEventSource.CLOSED);
    expect(result.current.connected).toBe(false);
    act(() => vi.advanceTimersByTime(2_000));
    expect(FakeEventSource.all).toHaveLength(2);
  });

  it('closes while the tab is hidden and reopens on return, still counted as connected', () => {
    const { result } = renderHook(() => useSSE('/bff/api/stream', 'problems'));
    act(() => latest().frame('problems', []));
    act(() => setVisibility('hidden'));
    expect(latest().readyState).toBe(FakeEventSource.CLOSED);
    expect(result.current.connected).toBe(true);
    act(() => setVisibility('visible'));
    expect(FakeEventSource.all).toHaveLength(2);
  });

  // The BFF no longer resends a list that has not changed; the keep-alive
  // carries how old the list is, so a quiet estate does not read as "no new data".
  describe('a keep-alive that carries the age of the list', () => {
    const START = new Date('2026-10-07T08:00:00Z').getTime();
    beforeEach(() => vi.setSystemTime(START));

    it('moves updatedAt on an unchanged list, as if the list had just been confirmed', () => {
      const { result } = renderHook(() => useSSE<number[]>('/bff/api/stream', 'problems', 45_000));
      act(() => latest().frame('problems', [1]));
      expect(result.current.updatedAt).toBe(START);

      act(() => vi.advanceTimersByTime(30_000));
      act(() => latest().frame('ping', { ageMs: 4_000 }));
      expect(result.current.updatedAt).toBe(START + 26_000);
      expect(result.current).toMatchObject({ data: [1], connected: true, error: null });
    });

    it('never moves updatedAt back past a frame that arrived after the read it names', () => {
      const { result } = renderHook(() => useSSE<number[]>('/bff/api/stream', 'problems'));
      act(() => vi.advanceTimersByTime(10_000));
      act(() => latest().frame('problems', [1]));
      act(() => latest().frame('ping', { ageMs: 8_000 }));
      expect(result.current.updatedAt).toBe(START + 10_000);
    });

    it('leaves updatedAt alone with no age, before any list, or after an error', () => {
      const { result } = renderHook(() => useSSE<number[]>('/bff/api/stream', 'problems'));
      act(() => latest().frame('ping', { ageMs: 1_000 }));
      expect(result.current.updatedAt).toBeNull();

      act(() => latest().frame('problems', [1]));
      act(() => vi.advanceTimersByTime(20_000));
      act(() => latest().frame('ping', {}));
      act(() => latest().frame('ping', { ageMs: 'old' }));
      act(() => latest().frame('ping', { ageMs: -5 }));
      expect(result.current.updatedAt).toBe(START);

      act(() => latest().onerror?.({ data: JSON.stringify({ message: 'Zabbix read failed' }) }));
      act(() => latest().frame('ping', { ageMs: 1_000 }));
      expect(result.current.updatedAt).toBe(START);
    });

    it('keeps a line that carries only keep-alives open, past the silence limit', () => {
      const { result } = renderHook(() => useSSE<number[]>('/bff/api/stream', 'problems', 45_000));
      const first = latest();
      act(() => first.frame('problems', [1]));
      for (let i = 0; i < 8; i++) {
        act(() => vi.advanceTimersByTime(15_000));
        act(() => first.frame('ping', { ageMs: 2_000 }));
      }
      expect(first.readyState).not.toBe(FakeEventSource.CLOSED);
      expect(FakeEventSource.all).toHaveLength(1);
      expect(result.current.connected).toBe(true);
      expect(result.current.updatedAt).toBe(START + 120_000 - 2_000);
    });
  });
});

describe('useSSE reconnecting and its watchdog (FR-25)', () => {
  /** Closes the newest stream as the browser does when it gives up, and returns how many streams exist. */
  const drop = () => {
    const source = latest();
    act(() => {
      source.readyState = FakeEventSource.CLOSED;
      source.onerror?.({});
    });
    return FakeEventSource.all.length;
  };
  /** The wait before the next stream opens, found by advancing a millisecond at a time in steps. */
  const waitUntilReopened = (limitMs: number) => {
    const before = FakeEventSource.all.length;
    for (let waited = 0; waited <= limitMs; waited += 250) {
      if (FakeEventSource.all.length > before) return waited;
      act(() => vi.advanceTimersByTime(250));
    }
    return Infinity;
  };

  it('waits longer after every failure: about 1 to 2 s, then 2 to 4, 4 to 8, up to half a minute at the most', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    renderHook(() => useSSE('/bff/api/stream', 'problems'));
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
      drop();
      waits.push(waitUntilReopened(61_000));
    }
    // With the jitter at its lowest the wait is half the ceiling: 1, 2, 4, 8, 16, 30, 30 s (the ceiling stops at 60 s).
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });

  it('never waits more than the ceiling, however the jitter falls', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    renderHook(() => useSSE('/bff/api/stream', 'problems'));
    drop();
    expect(waitUntilReopened(5_000)).toBeLessThanOrEqual(2_000);
    drop();
    expect(waitUntilReopened(10_000)).toBeLessThanOrEqual(4_000);
  });

  it('starts again at about a second once a frame has arrived after the failures', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    renderHook(() => useSSE('/bff/api/stream', 'problems'));
    for (let i = 0; i < 4; i++) {
      drop();
      waitUntilReopened(61_000);
    }
    act(() => latest().frame('problems', [1]));
    drop();
    expect(waitUntilReopened(61_000)).toBe(1_000);
  });

  it('does not open a second stream while one retry is already waiting', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    renderHook(() => useSSE('/bff/api/stream', 'problems'));
    const source = latest();
    act(() => {
      source.readyState = FakeEventSource.CLOSED;
      source.onerror?.({});
      source.onerror?.({});
      source.onerror?.({});
    });
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeEventSource.all).toHaveLength(2);
  });

  it('starts the silence watchdog when the connection opens, before any frame arrives', () => {
    const { result } = renderHook(() => useSSE('/bff/api/stream', 'problems', 45_000));
    const first = latest();
    act(() => first.onopen?.());
    act(() => vi.advanceTimersByTime(44_999));
    expect(first.readyState).not.toBe(FakeEventSource.CLOSED);
    act(() => vi.advanceTimersByTime(1));
    expect(first.readyState).toBe(FakeEventSource.CLOSED);
    expect(result.current.connected).toBe(false);
    act(() => vi.advanceTimersByTime(2_000));
    expect(FakeEventSource.all.length).toBeGreaterThanOrEqual(2);
  });

  it('is pushed back by every frame, a keep-alive and an error frame included', () => {
    renderHook(() => useSSE('/bff/api/stream', 'problems', 45_000));
    const first = latest();
    act(() => first.onopen?.());
    for (const [type, data] of [['problems', []], ['ping', {}], ['problems', [1]]] as const) {
      act(() => vi.advanceTimersByTime(40_000));
      act(() => first.frame(type, data));
    }
    act(() => vi.advanceTimersByTime(40_000));
    act(() => first.onerror?.({ data: JSON.stringify({ message: 'Zabbix read failed' }) }));
    act(() => vi.advanceTimersByTime(40_000));
    expect(first.readyState).not.toBe(FakeEventSource.CLOSED);
    act(() => vi.advanceTimersByTime(5_000));
    expect(first.readyState).toBe(FakeEventSource.CLOSED);
  });

  it('has no watchdog when no silence limit is given', () => {
    renderHook(() => useSSE('/bff/api/stream', 'problems'));
    const first = latest();
    act(() => first.onopen?.());
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(first.readyState).not.toBe(FakeEventSource.CLOSED);
  });
});

describe('useSSE with a guard (FR-16)', () => {
  const numbers: Guard<number[]> = {
    what: 'the numbers',
    misfit: (v) => (Array.isArray(v) && v.every((n) => typeof n === 'number') ? null : 'the answer is not a list of numbers'),
  };
  beforeEach(() => void vi.spyOn(console, 'warn').mockImplementation(() => undefined));

  it('takes a frame that fits, as before', () => {
    const { result } = renderHook(() => useSSE<number[]>('/bff/api/stream', 'problems', undefined, numbers));
    act(() => latest().frame('problems', [1, 2]));
    expect(result.current).toMatchObject({ data: [1, 2], connected: true, error: null });
  });

  it('does not show a frame that does not fit: the stream reports an error and the page polls', () => {
    const { result } = renderHook(() => useSSE<number[]>('/bff/api/stream', 'problems', undefined, numbers));
    act(() => latest().frame('problems', { problems: [1] }));
    expect(result.current.data).toBeNull();
    expect(result.current.updatedAt).toBeNull();
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe(unreadableMessage('the numbers'));
    // The line itself is fine: it stays open and is not reopened.
    expect(FakeEventSource.all).toHaveLength(1);
    expect(latest().readyState).not.toBe(FakeEventSource.CLOSED);
  });

  it('keeps the last good list on screen but off the live badge, then recovers at the next good frame', () => {
    const { result } = renderHook(() => useSSE<number[]>('/bff/api/stream', 'problems', undefined, numbers));
    act(() => latest().frame('problems', [1]));
    act(() => latest().frame('problems', ['x']));
    expect(result.current).toMatchObject({ data: [1], connected: false, error: unreadableMessage('the numbers') });
    act(() => latest().frame('problems', [2]));
    expect(result.current).toMatchObject({ data: [2], connected: true, error: null });
  });

  it('counts a frame that does not fit as a sign of life, so a silent-line watchdog does not fire on it', () => {
    renderHook(() => useSSE<number[]>('/bff/api/stream', 'problems', 45_000, numbers));
    const first = latest();
    act(() => first.frame('problems', [1]));
    for (let i = 0; i < 4; i++) {
      act(() => vi.advanceTimersByTime(30_000));
      act(() => first.frame('problems', 'broken'));
    }
    expect(first.readyState).not.toBe(FakeEventSource.CLOSED);
    expect(FakeEventSource.all).toHaveLength(1);
  });

  it('leaves a stream with no guard exactly as it was: any frame is data', () => {
    const { result } = renderHook(() => useSSE<unknown>('/bff/api/stream', 'problems'));
    act(() => latest().frame('problems', { anything: true }));
    expect(result.current).toMatchObject({ data: { anything: true }, connected: true, error: null });
  });
});
