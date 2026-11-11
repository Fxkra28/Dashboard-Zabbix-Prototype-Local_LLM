import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A sign-out that did not reach the server is not a sign-out (SC-37). The cookie is cleared only by the
 * POST, so the page must go on as the person it was, and say so, rather than show the sign-in page
 * with the session still alive behind it. Other tabs are told only when the server has answered.
 */
const posted: unknown[] = [];
class FakeChannel {
  postMessage(message: unknown) {
    posted.push(message);
  }
  addEventListener() {}
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const URLS = { logout: '/bff/api/auth/logout', refresh: '/bff/api/auth/refresh' };

beforeEach(() => {
  posted.length = 0;
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  vi.stubGlobal('location', { pathname: '/graphs', search: '', href: '' });
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const loadApi = async () => ({ ...(await import('../api')), lastKnownUser: (await import('../api/session')).lastKnownUser });

/** A server that answers the logout with `status` and every renewal with a fresh hour. */
function server(logoutStatus: number) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url === URLS.logout) return logoutStatus === 0 ? Promise.reject(new TypeError('network down')) : json(logoutStatus, {});
      return json(200, { user: { name: 'olu', role: 'operator' }, expiresIn: 3600 });
    }),
  );
  return calls;
}

describe('logout() when the request does not get through', () => {
  it.each([500, 502, 0])('rejects (status %i), leaves the page signed in, and does not tell the other tabs', async (status) => {
    server(status);
    const { logout, isSignedOut, recordSession, sessionTiming, renewSession } = await loadApi();
    recordSession(3600, { name: 'olu', role: 'operator' });
    const before = sessionTiming();

    await expect(logout()).rejects.toThrow();

    expect(isSignedOut()).toBe(false);
    expect(sessionTiming()).toEqual(before);
    expect(posted).toEqual([]);
    // The page still renews, so the session it still has does not run out under the person.
    expect(await renewSession()).toBe('renewed');
  });

  it('can be tried again, and then signs out for real', async () => {
    const calls = server(502);
    const api = await loadApi();
    api.recordSession(3600, { name: 'olu', role: 'operator' });
    await expect(api.logout()).rejects.toThrow();
    server(200);
    await api.logout();
    expect(api.isSignedOut()).toBe(true);
    expect(calls.filter((u) => u === URLS.logout)).toHaveLength(1);
    expect(posted).toEqual([{ type: 'signed-out' }]);
  });
});

describe('logout() while the request is out', () => {
  it('is not yet signed out, but lets no renewal start, and then is signed out with the other tabs told', async () => {
    let answer!: (r: Response) => void;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        calls.push(url);
        if (url === URLS.logout) return new Promise<Response>((resolve) => (answer = resolve));
        return Promise.resolve(json(200, { user: { name: 'olu', role: 'operator' }, expiresIn: 3600 }));
      }),
    );
    const { logout, isSignedOut, recordSession, renewSession, lastKnownUser, sessionTiming } = await loadApi();
    recordSession(3600, { name: 'olu', role: 'operator' });

    const done = logout();
    await vi.waitFor(() => expect(calls).toContain(URLS.logout));
    expect(isSignedOut()).toBe(false);
    expect(posted).toEqual([]);
    expect(await renewSession()).toBe('signed-out');
    expect(calls).not.toContain(URLS.refresh);

    answer(json(200, { ok: true }));
    await done;
    expect(isSignedOut()).toBe(true);
    expect(lastKnownUser()).toBeNull();
    expect(sessionTiming()).toBeNull();
    expect(posted).toEqual([{ type: 'signed-out' }]);
  });

  it('still waits for a renewal that is already out before it asks the server to sign out', async () => {
    const order: string[] = [];
    let finishRenewal!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        order.push(url);
        if (url === URLS.refresh) return new Promise<Response>((resolve) => (finishRenewal = resolve));
        return Promise.resolve(json(200, { ok: true }));
      }),
    );
    const { logout, renewSession, recordSession } = await loadApi();
    recordSession(3600, { name: 'olu', role: 'operator' });
    const renewing = renewSession();
    const done = logout();
    await Promise.resolve();
    expect(order).toEqual([URLS.refresh]);
    finishRenewal(json(200, { user: { name: 'olu', role: 'operator' }, expiresIn: 3600 }));
    await renewing;
    await done;
    expect(order).toEqual([URLS.refresh, URLS.logout]);
  });
});

describe('a sign-out that did not get through leaves the Assistant conversation alone', () => {
  const asked = [{ role: 'user' as const, content: 'which switch at Sampang is down' }];

  it('keeps what was saved, goes on saving, and wipes it for good only when the server has answered', async () => {
    server(502);
    const api = await loadApi();
    const store = await import('../shared/lib/chatStore');
    api.recordSession(3600, { name: 'olu', role: 'operator' });
    store.saveConversation(asked);

    await expect(api.logout()).rejects.toThrow();
    expect(store.loadConversation()).toEqual(asked);
    store.saveConversation([...asked, { role: 'assistant', content: 'The switch lt3.' }]);
    expect(store.loadConversation()).toHaveLength(2);

    server(200);
    await api.logout();
    expect(store.loadConversation()).toEqual([]);
    store.saveConversation([{ role: 'user', content: 'an answer that lands late' }]);
    expect(store.loadConversation()).toEqual([]);
  });
});

describe('logout() asked twice while the server is slow', () => {
  it('still counts as signing out until the last request has answered, so no renewal starts in between', async () => {
    const answers: ((r: Response) => void)[] = [];
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        calls.push(url);
        if (url === URLS.logout) return new Promise<Response>((resolve) => answers.push(resolve));
        return Promise.resolve(json(200, { user: { name: 'olu', role: 'operator' }, expiresIn: 3600 }));
      }),
    );
    const { logout, renewSession, recordSession } = await loadApi();
    recordSession(3600, { name: 'olu', role: 'operator' });

    const first = logout();
    const second = logout();
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    answers[0](json(502, {}));
    await expect(first).rejects.toThrow();

    expect(await renewSession()).toBe('signed-out');
    expect(calls).not.toContain(URLS.refresh);

    answers[1](json(200, { ok: true }));
    await second;
  });
});

describe('logout() when the server never answers', () => {
  it('gives up after thirty seconds, says so, and leaves the page signed in', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))),
      );
      const { logout, isSignedOut, recordSession } = await loadApi();
      recordSession(3600, { name: 'olu', role: 'operator' });
      const done = logout();
      const outcome = expect(done).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(30_000);
      await outcome;
      expect(isSignedOut()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a listener of session changes that throws', () => {
  it('does not stop the sign-out, the other listeners or the other tabs being told', async () => {
    server(200);
    const { logout, isSignedOut, recordSession } = await loadApi();
    const { onSessionChange } = await import('../api/session');
    const heard = vi.fn();
    onSessionChange(() => {
      throw new Error('a page that broke');
    });
    onSessionChange(heard);
    recordSession(3600, { name: 'olu', role: 'operator' });
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await logout();
    } finally {
      warn.mockRestore();
    }
    expect(isSignedOut()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(posted).toEqual([{ type: 'signed-out' }]);
  });
});
