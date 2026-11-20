import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAccessWatch } from './useAccessWatch';

// FR-70: when a tab asks the server again what the account may open.
const recheck = vi.hoisted(() => vi.fn(async () => 'same' as const));
vi.mock('../../shared/hooks/useAuth', () => ({ recheckAccess: recheck }));
const session = vi.hoisted(() => ({ signedOut: false }));
vi.mock('../../api', () => ({ isSignedOut: () => session.signedOut }));

let visibility: DocumentVisibilityState = 'visible';
const show = (v: DocumentVisibilityState) => {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
  recheck.mockClear();
  session.signedOut = false;
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useAccessWatch', () => {
  it('asks when the tab is shown again, once it has been more than a minute', async () => {
    renderHook(() => useAccessWatch(true));
    await act(async () => vi.advanceTimersByTime(61_000));
    show('hidden');
    show('visible');
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it('asks when the window gains focus, at most once a minute', async () => {
    renderHook(() => useAccessWatch(true));
    await act(async () => vi.advanceTimersByTime(61_000));
    window.dispatchEvent(new Event('focus'));
    expect(recheck).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(30_000));
    window.dispatchEvent(new Event('focus'));
    show('visible');
    expect(recheck).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(30_000));
    window.dispatchEvent(new Event('focus'));
    expect(recheck).toHaveBeenCalledTimes(2);
  });

  it('does not ask for a focus in the first minute after the page opened, which has just asked', () => {
    renderHook(() => useAccessWatch(true));
    window.dispatchEvent(new Event('focus'));
    expect(recheck).not.toHaveBeenCalled();
  });

  it('does not ask while the tab is hidden', async () => {
    renderHook(() => useAccessWatch(true));
    await act(async () => vi.advanceTimersByTime(61_000));
    show('hidden');
    expect(recheck).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(30 * 60_000));
    expect(recheck).not.toHaveBeenCalled();
  });

  it('asks every ten minutes while the tab stays in view, as a wall screen does', async () => {
    renderHook(() => useAccessWatch(true));
    await act(async () => vi.advanceTimersByTime(10 * 60_000 - 1));
    expect(recheck).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(recheck).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(20 * 60_000));
    expect(recheck).toHaveBeenCalledTimes(3);
  });

  it('asks nothing once the person has signed out', async () => {
    renderHook(() => useAccessWatch(true));
    session.signedOut = true;
    await act(async () => vi.advanceTimersByTime(11 * 60_000));
    expect(recheck).not.toHaveBeenCalled();
  });

  it('does nothing when sign-in is off, and stops when the page is gone', async () => {
    const off = renderHook(() => useAccessWatch(false));
    await act(async () => vi.advanceTimersByTime(11 * 60_000));
    expect(recheck).not.toHaveBeenCalled();
    off.unmount();
    const on = renderHook(() => useAccessWatch(true));
    on.unmount();
    await act(async () => vi.advanceTimersByTime(11 * 60_000));
    window.dispatchEvent(new Event('focus'));
    expect(recheck).not.toHaveBeenCalled();
  });
});
