import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSessionRenewal } from './useSessionRenewal';

/**
 * The hook that keeps a wall screen signed in (DESIGN.md section 9): when a renewal is due, the backoff after a failure, waking on focus and when the network returns, and what is done
 * once it has renewed (FR-76; FR-70 for the call after a renewal).
 */

const api = vi.hoisted(() => ({
  renewSession: vi.fn(),
  sessionTiming: vi.fn(),
  isSignedOut: vi.fn(() => false),
}));
vi.mock('../../api', () => api);

const MIN = 60_000;
const HOUR = 60 * MIN;
let visibility: DocumentVisibilityState = 'visible';

/** The session as the page knows it: `left` ms until its end, of a life of `life` ms. */
const session = (left: number, life = 12 * HOUR) => {
  // Fixed when it is set: the end of a session does not move with the clock.
  const endsAt = Date.now() + left;
  api.sessionTiming.mockImplementation(() => ({ endsAt, lifeMs: life }));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(Date.parse('2026-11-19T04:00:00Z'));
  api.renewSession.mockReset().mockResolvedValue('renewed');
  api.sessionTiming.mockReset();
  api.isSignedOut.mockReset().mockReturnValue(false);
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const run = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('when a renewal is due', () => {
  it('renews an hour before the end of a long session, and not before', async () => {
    session(10 * HOUR);
    // A renewal gives a new session, as the real one does.
    api.renewSession.mockImplementation(async () => (session(12 * HOUR), 'renewed'));
    renderHook(() => useSessionRenewal(true));
    await run(9 * HOUR - MIN);
    expect(api.renewSession).not.toHaveBeenCalled();
    await run(2 * MIN);
    expect(api.renewSession).toHaveBeenCalledTimes(1);
  });

  it('renews at three quarters of a short session, a quarter before its end', async () => {
    session(2 * HOUR, 2 * HOUR);
    api.renewSession.mockImplementation(async () => (session(2 * HOUR, 2 * HOUR), 'renewed'));
    renderHook(() => useSessionRenewal(true));
    await run(90 * MIN - MIN);
    expect(api.renewSession).not.toHaveBeenCalled();
    await run(2 * MIN);
    expect(api.renewSession).toHaveBeenCalledTimes(1);
  });

  it('renews at once when it does not know when the session ends, which /api/auth/me prevents', async () => {
    api.sessionTiming.mockReturnValue(null);
    renderHook(() => useSessionRenewal(true));
    await run(0);
    expect(api.renewSession).toHaveBeenCalledTimes(1);
  });

  it('renews nothing while sign-in is off, and asks nothing after the page is gone', async () => {
    session(0);
    const off = renderHook(() => useSessionRenewal(false));
    await run(5 * MIN);
    expect(api.renewSession).not.toHaveBeenCalled();
    off.unmount();
    const on = renderHook(() => useSessionRenewal(true));
    on.unmount();
    api.renewSession.mockClear();
    await run(5 * MIN);
    expect(api.renewSession).not.toHaveBeenCalled();
  });
});

describe('after a renewal and after a failure', () => {
  it('never renews twice within half a minute, whatever the clock of the session says', async () => {
    session(0);
    renderHook(() => useSessionRenewal(true));
    await run(0);
    expect(api.renewSession).toHaveBeenCalledTimes(1);
    await run(29_000);
    expect(api.renewSession).toHaveBeenCalledTimes(1);
    await run(1_001);
    expect(api.renewSession).toHaveBeenCalledTimes(2);
  });

  it('tells the page it was renewed, so that a screen that never reloads can find out what changed (FR-70)', async () => {
    session(0);
    const onRenewed = vi.fn();
    renderHook(() => useSessionRenewal(true, onRenewed));
    await run(0);
    expect(onRenewed).toHaveBeenCalledTimes(1);
  });

  it('tells nothing for a renewal that failed', async () => {
    session(0);
    api.renewSession.mockResolvedValue('failed');
    const onRenewed = vi.fn();
    renderHook(() => useSessionRenewal(true, onRenewed));
    await run(0);
    expect(api.renewSession).toHaveBeenCalledTimes(1);
    expect(onRenewed).not.toHaveBeenCalled();
  });

  it('asks again after a minute, then two, four, eight and ten, and keeps to ten', async () => {
    session(0);
    api.renewSession.mockResolvedValue('failed');
    renderHook(() => useSessionRenewal(true));
    await run(0);
    expect(api.renewSession).toHaveBeenCalledTimes(1);
    // The attempts fall at these seconds: each wait starts when the attempt before it failed.
    let elapsed = 0;
    let calls = 1;
    for (const at of [60, 180, 420, 900, 1_500, 2_100]) {
      await run(at * 1_000 - elapsed - 1);
      expect(api.renewSession, `just before ${at} s`).toHaveBeenCalledTimes(calls);
      await run(1);
      calls += 1;
      expect(api.renewSession, `at ${at} s`).toHaveBeenCalledTimes(calls);
      elapsed = at * 1_000;
    }
  });

  it('goes back to a minute after a renewal that worked', async () => {
    session(0);
    api.renewSession.mockResolvedValueOnce('failed').mockResolvedValueOnce('failed').mockResolvedValue('renewed');
    renderHook(() => useSessionRenewal(true));
    await run(0);
    await run(MIN + 1_000);
    await run(2 * MIN + 1_000);
    expect(api.renewSession).toHaveBeenCalledTimes(3);
    api.renewSession.mockResolvedValue('failed');
    await run(31_000);
    expect(api.renewSession).toHaveBeenCalledTimes(4);
    await run(MIN + 1_000);
    expect(api.renewSession).toHaveBeenCalledTimes(5);
  });

  it('does not start a second renewal while one is in flight', async () => {
    session(0);
    let finish!: (v: string) => void;
    api.renewSession.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    renderHook(() => useSessionRenewal(true));
    await run(0);
    await run(5 * MIN);
    expect(api.renewSession).toHaveBeenCalledTimes(1);
    finish('renewed');
    await run(0);
  });
});

describe('when the page wakes', () => {
  // The machine slept past the due time: the page is woken by one of these before the minute is out.
  it.each([
    ['gains focus', () => window.dispatchEvent(new Event('focus'))],
    ['comes back online', () => window.dispatchEvent(new Event('online'))],
    ['is shown again', () => document.dispatchEvent(new Event('visibilitychange'))],
  ])('renews when the window %s, without waiting for the minute', async (_what, wake) => {
    session(10 * HOUR);
    renderHook(() => useSessionRenewal(true));
    await run(0);
    expect(api.renewSession).not.toHaveBeenCalled();
    session(0);
    wake();
    await run(0);
    expect(api.renewSession).toHaveBeenCalledTimes(1);
  });

  it('does not renew for a tab that is hidden', async () => {
    session(10 * HOUR);
    renderHook(() => useSessionRenewal(true));
    await run(0);
    session(0);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await run(0);
    expect(api.renewSession).not.toHaveBeenCalled();
  });
});

describe('after a sign-out', () => {
  it('renews nothing while the person is signed out, and goes on when someone signs in again, in any tab', async () => {
    session(0);
    api.isSignedOut.mockReturnValue(true);
    renderHook(() => useSessionRenewal(true));
    await run(5 * MIN);
    expect(api.renewSession).not.toHaveBeenCalled();
    api.isSignedOut.mockReturnValue(false);
    await run(MIN + 1_000);
    expect(api.renewSession).toHaveBeenCalledTimes(1);
  });

  it('keeps watching when the renewal found the person signed out meanwhile', async () => {
    session(0);
    api.renewSession.mockResolvedValueOnce('signed-out').mockResolvedValue('renewed');
    renderHook(() => useSessionRenewal(true));
    await run(0);
    expect(api.renewSession).toHaveBeenCalledTimes(1);
    await run(MIN + 1_000);
    expect(api.renewSession).toHaveBeenCalledTimes(2);
  });
});
