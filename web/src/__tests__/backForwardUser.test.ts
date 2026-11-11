import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeChannel {
  postMessage() {}
  addEventListener() {}
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const me = (name: string, role: string) => json(200, { authEnabled: true, user: { name, role }, expiresIn: 3600 });
const restoredFromCache = () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));

beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  vi.stubGlobal('location', { pathname: '/hosts', search: '', href: '' });
});
afterEach(() => vi.unstubAllGlobals());

// Its own file, like backForward.test.ts: each fresh api/ adds a window listener (api/index.ts).
describe('a page Back restores after another user signed in', () => {
  it('redraws the menus for a new user or a new role, and leaves them alone for the same one', async () => {
    const fetchMock = vi.fn(async () => me('ana', 'viewer'));
    vi.stubGlobal('fetch', fetchMock);
    const { api, AUTH_CHANGED, sessionTiming } = await import('../api');
    await api.me();
    const changed = vi.fn();
    window.addEventListener(AUTH_CHANGED, changed);
    /** Restore, then wait until the page has read the answer (me() records the session). */
    const restoreAndSettle = async (answer: () => Response) => {
      fetchMock.mockImplementation(async () => answer());
      const before = sessionTiming();
      restoredFromCache();
      await vi.waitFor(() => expect(sessionTiming()).not.toBe(before));
      await new Promise((r) => setTimeout(r, 0));
    };

    await restoreAndSettle(() => me('ana', 'viewer'));
    expect(changed).not.toHaveBeenCalled();

    await restoreAndSettle(() => me('ana', 'operator'));
    expect(changed).toHaveBeenCalledTimes(1);

    await restoreAndSettle(() => me('olu', 'operator'));
    expect(changed).toHaveBeenCalledTimes(2);
    window.removeEventListener(AUTH_CHANGED, changed);
  });

  it('tells what a page keeps for one person (the Graphs item list) as well as the menus, when the user or the role changed', async () => {
    const fetchMock = vi.fn(async () => me('ana', 'operator'));
    vi.stubGlobal('fetch', fetchMock);
    const { api, onSessionChange, sessionTiming } = await import('../api');
    await api.me();
    const heard = vi.fn();
    const stop = onSessionChange(heard);
    const restoreAndSettle = async (answer: () => Response) => {
      fetchMock.mockImplementation(async () => answer());
      const before = sessionTiming();
      restoredFromCache();
      await vi.waitFor(() => expect(sessionTiming()).not.toBe(before));
      await new Promise((r) => setTimeout(r, 0));
    };

    await restoreAndSettle(() => me('ana', 'operator'));
    expect(heard).not.toHaveBeenCalled();
    await restoreAndSettle(() => me('ana', 'viewer'));
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });
});
