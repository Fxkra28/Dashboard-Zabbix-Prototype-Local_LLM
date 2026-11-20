import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { api, AUTH_CHANGED } from '../../api';
import { hasModule, recheckAccess, resetAuthProbe, roleAllows, useAuth } from './useAuth';
import type { Me } from '../../types';

/** Who is signed in. A BFF that does not answer is asked again, backing off, and the answer is not kept for the tab (FR-02). */

const operator: Me = { authEnabled: true, user: { name: 'ana', role: 'operator' }, expiresIn: 3600, pages: { '/': 'guest' }, modules: ['dashboard', 'problems'] };

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
    expect(result.current).toMatchObject({ role: 'operator', loading: false, pages: { '/': 'guest' } });
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
  it('ranks guest under operator under admin, and allows nothing to nobody', () => {
    expect(roleAllows('operator', 'guest')).toBe(true);
    expect(roleAllows('guest', 'operator')).toBe(false);
    expect(roleAllows('admin', 'admin')).toBe(true);
    expect(roleAllows('operator', 'admin')).toBe(false);
    expect(roleAllows(null, 'guest')).toBe(false);
  });
});

describe('hasModule and can', () => {
  it('holds the modules the BFF says the user holds, and every one for an administrator', () => {
    expect(hasModule({ modules: ['sla'], role: 'guest' }, 'sla')).toBe(true);
    expect(hasModule({ modules: ['sla'], role: 'guest' }, 'network')).toBe(false);
    expect(hasModule({ modules: [], role: 'admin' }, 'users')).toBe(true);
  });

  it('takes a BFF that does not say as allowing every module, since it still refuses what a user may not read', () => {
    expect(hasModule({ modules: undefined, role: 'guest' }, 'network')).toBe(true);
  });

  it('is false until the user is known, and then follows the modules', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(operator);
    const { result } = renderHook(() => useAuth());
    expect(result.current.can('dashboard')).toBe(false);
    await act(async () => undefined);
    expect(result.current.can('dashboard')).toBe(true);
    expect(result.current.can('network')).toBe(false);
    expect(result.current.modules).toEqual(['dashboard', 'problems']);
  });
});

// FR-70: the server judges each request by the pages of now, so a page that kept the list it fetched at load must ask again.
describe('recheckAccess', () => {
  const widened: Me = { ...operator, pages: { '/': 'guest', '/network': 'guest' }, modules: ['dashboard', 'problems', 'network'] };

  it('hands the new pages to a hook that is already on screen, when an administrator changed them', async () => {
    vi.spyOn(api, 'me').mockResolvedValueOnce(operator).mockResolvedValue(widened);
    const { result } = renderHook(() => useAuth());
    await act(async () => undefined);
    expect(result.current.can('network')).toBe(false);
    let outcome: string | undefined;
    await act(async () => {
      outcome = await recheckAccess();
    });
    expect(outcome).toBe('changed');
    expect(result.current.pages).toEqual({ '/': 'guest', '/network': 'guest' });
    expect(result.current.can('network')).toBe(true);
  });

  it('follows a page that was taken away as well', async () => {
    vi.spyOn(api, 'me').mockResolvedValueOnce(widened).mockResolvedValue(operator);
    const { result } = renderHook(() => useAuth());
    await act(async () => undefined);
    expect(result.current.can('network')).toBe(true);
    await act(async () => void (await recheckAccess()));
    expect(result.current.can('network')).toBe(false);
  });

  it('says nothing and changes nothing when the answer is the same', async () => {
    const me = vi.spyOn(api, 'me').mockResolvedValue(operator);
    const { result } = renderHook(() => useAuth());
    await act(async () => undefined);
    const heard = vi.fn();
    window.addEventListener('hcml:access-changed', heard);
    let outcome: string | undefined;
    await act(async () => {
      outcome = await recheckAccess();
    });
    window.removeEventListener('hcml:access-changed', heard);
    expect(outcome).toBe('same');
    expect(heard).not.toHaveBeenCalled();
    expect(me).toHaveBeenCalledTimes(2);
    expect(result.current.role).toBe('operator');
  });

  it('keeps what the page held when the BFF does not answer, and says it failed', async () => {
    vi.spyOn(api, 'me').mockResolvedValueOnce(operator).mockRejectedValue(new Error('502'));
    const { result } = renderHook(() => useAuth());
    await act(async () => undefined);
    let outcome: string | undefined;
    await act(async () => {
      outcome = await recheckAccess();
    });
    expect(outcome).toBe('failed');
    expect(result.current.role).toBe('operator');
  });

  it('lets a page that opens later read the new answer, and not the one fetched at load', async () => {
    const me = vi.spyOn(api, 'me').mockResolvedValueOnce(operator).mockResolvedValue(widened);
    const first = renderHook(() => useAuth());
    await act(async () => undefined);
    await act(async () => void (await recheckAccess()));
    const later = renderHook(() => useAuth());
    await act(async () => undefined);
    expect(later.result.current.can('network')).toBe(true);
    // One for the page, one for the re-read: opening another page asks nothing more.
    expect(me).toHaveBeenCalledTimes(2);
    first.unmount();
  });

  it('counts a change of role, or of a temporary password, as a change too', async () => {
    const asGuest = { ...operator, user: { name: 'ana', role: 'guest' } } as Me;
    vi.spyOn(api, 'me')
      .mockResolvedValueOnce(operator) // the hook, at mount
      .mockResolvedValueOnce(asGuest) // the first re-read: the role changed
      .mockResolvedValueOnce(asGuest) // the hook, which asks again when the role of the person changed
      .mockResolvedValue({ ...asGuest, mustChange: true }); // the second re-read: a temporary password
    renderHook(() => useAuth());
    await act(async () => undefined);
    let outcome: string | undefined;
    await act(async () => {
      outcome = await recheckAccess();
    });
    expect(outcome).toBe('changed');
    await act(async () => {
      outcome = await recheckAccess();
    });
    expect(outcome).toBe('changed');
  });

  it('treats another person behind the cookie as a new session: what the pages keep for one person goes too', async () => {
    const session = await import('../../api/session');
    const heard = vi.fn();
    const off = session.onSessionChange(heard);
    vi.spyOn(api, 'me').mockResolvedValueOnce(operator).mockResolvedValue({ ...operator, user: { name: 'budi', role: 'operator' } });
    renderHook(() => useAuth());
    await act(async () => undefined);
    await act(async () => void (await recheckAccess()));
    off();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  // What a page keeps for one person is cut by the role too (the lists of items an operator may pick from): a role that changed under the same name makes it wrong.
  it('clears what the pages keep for one person when the role of the same person changed', async () => {
    const session = await import('../../api/session');
    const heard = vi.fn();
    const off = session.onSessionChange(heard);
    vi.spyOn(api, 'me').mockResolvedValueOnce(operator).mockResolvedValue({ ...operator, user: { name: operator.user!.name, role: 'admin' } });
    renderHook(() => useAuth());
    await act(async () => undefined);
    await act(async () => void (await recheckAccess()));
    off();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('does not clear what the pages keep when only the pages of the same person changed', async () => {
    const session = await import('../../api/session');
    const heard = vi.fn();
    const off = session.onSessionChange(heard);
    vi.spyOn(api, 'me').mockResolvedValueOnce(operator).mockResolvedValue(widened);
    renderHook(() => useAuth());
    await act(async () => undefined);
    await act(async () => void (await recheckAccess()));
    off();
    expect(heard).not.toHaveBeenCalled();
  });
});
