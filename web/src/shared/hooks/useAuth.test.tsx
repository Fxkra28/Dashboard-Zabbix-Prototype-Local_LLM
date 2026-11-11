import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { api, AUTH_CHANGED } from '../../api';
import { resetAuthProbe, roleAllows, useAuth } from './useAuth';
import type { Me } from '../../types';

/** Who is signed in. A BFF that does not answer is asked again, backing off, and the answer is not kept for the tab (FR-02). */

const operator: Me = { authEnabled: true, user: { name: 'ana', role: 'operator' }, expiresIn: 3600, pages: { '/': 'viewer' } };

beforeEach(() => resetAuthProbe());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useAuth', () => {
  it('gives the role and the pages once the BFF answers', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(operator);
    const { result } = renderHook(() => useAuth());
    expect(result.current).toMatchObject({ role: null, loading: true });
    await act(async () => undefined);
    expect(result.current).toMatchObject({ role: 'operator', loading: false, pages: { '/': 'viewer' } });
  });

  it('asks again after 5, then 10, then 20 seconds while the BFF does not answer, and stops once it does', async () => {
    vi.useFakeTimers();
    const me = vi.spyOn(api, 'me').mockRejectedValueOnce(new Error('502')).mockRejectedValueOnce(new Error('502')).mockRejectedValueOnce(new Error('502')).mockResolvedValue(operator);
    const { result } = renderHook(() => useAuth());
    await act(async () => undefined);
    expect(me).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ role: null, loading: false });

    await act(async () => vi.advanceTimersByTime(4_999));
    expect(me).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(me).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTime(9_999));
    expect(me).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(1));
    expect(me).toHaveBeenCalledTimes(3);

    await act(async () => vi.advanceTimersByTime(19_999));
    expect(me).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTime(1));
    expect(me).toHaveBeenCalledTimes(4);
    expect(result.current.role).toBe('operator');

    await act(async () => vi.advanceTimersByTime(120_000));
    expect(me).toHaveBeenCalledTimes(4);
  });

  it('never waits more than a minute between asks', async () => {
    vi.useFakeTimers();
    const me = vi.spyOn(api, 'me').mockRejectedValue(new Error('502'));
    renderHook(() => useAuth());
    await act(async () => undefined);
    // 5 + 10 + 20 + 40 seconds, then 60 for as long as it goes on.
    for (const wait of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) await act(async () => vi.advanceTimersByTime(wait));
    expect(me).toHaveBeenCalledTimes(7);
  });

  it('asks again at once, and from 5 seconds again, when the sign-in changes', async () => {
    vi.useFakeTimers();
    const me = vi.spyOn(api, 'me').mockRejectedValueOnce(new Error('502')).mockRejectedValueOnce(new Error('502')).mockRejectedValueOnce(new Error('502')).mockResolvedValue(operator);
    const { result } = renderHook(() => useAuth());
    await act(async () => undefined);
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(me).toHaveBeenCalledTimes(2);
    // The wait had grown to 10 seconds, then 20. A new sign-in is a new start, so the next ask is 5 seconds after this one fails.
    await act(async () => {
      window.dispatchEvent(new Event(AUTH_CHANGED));
    });
    expect(me).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(me).toHaveBeenCalledTimes(4);
    expect(result.current.role).toBe('operator');
  });

  it('stops asking when the page that used it is gone', async () => {
    vi.useFakeTimers();
    const me = vi.spyOn(api, 'me').mockRejectedValue(new Error('502'));
    const { unmount } = renderHook(() => useAuth());
    await act(async () => undefined);
    unmount();
    await act(async () => vi.advanceTimersByTime(300_000));
    expect(me).toHaveBeenCalledTimes(1);
  });
});

describe('useAuth when the page is gone before the answer', () => {
  it('does not ask again for it when a failure arrives late', async () => {
    vi.useFakeTimers();
    let fail!: (e: unknown) => void;
    const me = vi.spyOn(api, 'me').mockImplementation(() => new Promise<Me>((_, reject) => (fail = reject)));
    const { unmount } = renderHook(() => useAuth());
    unmount();
    await act(async () => fail(new Error('502')));
    await act(async () => vi.advanceTimersByTime(300_000));
    expect(me).toHaveBeenCalledTimes(1);
  });
});

describe('roleAllows', () => {
  it('ranks viewer under operator under admin, and allows nothing to nobody', () => {
    expect(roleAllows('operator', 'viewer')).toBe(true);
    expect(roleAllows('viewer', 'operator')).toBe(false);
    expect(roleAllows('admin', 'admin')).toBe(true);
    expect(roleAllows(null, 'viewer')).toBe(false);
  });
});
