import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Tabs talk over this channel; here it only records what the page announced. */
class FakeChannel {
  static sent: unknown[] = [];
  postMessage(data: unknown) {
    FakeChannel.sent.push(data);
  }
  addEventListener() {}
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
let where: { pathname: string; search: string; href: string; origin: string };

/** A fresh api/ for each test: its session state lives at module level (api/session.ts). */
async function load() {
  vi.resetModules();
  return import('./api');
}

beforeEach(() => {
  FakeChannel.sent = [];
  fetchMock = vi.fn();
  where = { pathname: '/problems', search: '?severity=5', href: '', origin: 'http://localhost:3000' };
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  vi.stubGlobal('location', where);
});
afterEach(() => vi.unstubAllGlobals());

const headersOf = (call: number) => new Headers((fetchMock.mock.calls[call][1] as RequestInit).headers);

describe('api/ requests', () => {
  it('sends the CSRF header with a POST, which the BFF needs with the session cookie', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(200, { ok: true, eventids: ['1'], action: 2 }));
    await api.acknowledge({ eventids: ['1'], acknowledge: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/bff/api/problems/acknowledge');
    expect(init.method).toBe('POST');
    expect(headersOf(0).get('X-HCML-CSRF')).toBe('1');
    expect(JSON.parse(String(init.body))).toEqual({ eventids: ['1'], acknowledge: true });
  });

  it('keeps no token anywhere a script can read', async () => {
    localStorage.setItem('hcml_token', 'left-by-an-older-build');
    const { login } = await load();
    expect(localStorage.getItem('hcml_token')).toBeNull();
    fetchMock.mockResolvedValue(json(200, { user: { name: 'ana', role: 'viewer' }, expiresIn: 43_200 }));
    await login('ana', 'pw');
    expect(localStorage.length).toBe(0);
    expect(headersOf(0).has('Authorization')).toBe(false);
  });

  it('goes to sign-in on a 401 and remembers the page, filters included', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValue(json(401, { error: 'unauthorized' }));
    await expect(api.stats()).rejects.toThrow('Unauthorized');
    expect(where.href).toBe('/login?next=' + encodeURIComponent('/problems?severity=5'));
  });

  it('opens the live stream with no token in its URL: the cookie goes with it', async () => {
    const { streamUrl } = await load();
    expect(streamUrl()).toBe('/bff/api/stream');
  });

  it('stays put on a 401 while already on the sign-in page', async () => {
    where.pathname = '/login';
    const { goToSignIn } = await load();
    goToSignIn();
    expect(where.href).toBe('');
  });
});

describe('sign-in', () => {
  it('records when the session ends and tells the other tabs', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const { login, sessionTiming } = await load();
    fetchMock.mockResolvedValue(json(200, { user: { name: 'ana', role: 'viewer' }, expiresIn: 43_200 }));
    await expect(login('ana', 'pw')).resolves.toEqual({ name: 'ana', role: 'viewer' });
    expect(headersOf(0).get('X-HCML-CSRF')).toBe('1');
    expect(sessionTiming()).toEqual({ endsAt: 1_000_000 + 43_200_000, lifeMs: 43_200_000 });
    expect(FakeChannel.sent).toContainEqual({ type: 'signed-in' });
    vi.useRealTimers();
  });

  it('says the password was wrong only on a 401', async () => {
    const { login } = await load();
    fetchMock.mockResolvedValueOnce(json(401, { error: 'invalid_credentials' }));
    await expect(login('ana', 'nope')).rejects.toThrow('Invalid username or password.');
    fetchMock.mockResolvedValueOnce(json(429, { message: 'Too many sign-in attempts.' }));
    await expect(login('ana', 'nope')).rejects.toThrow('Too many sign-in attempts.');
  });
});

describe('renewSession', () => {
  it('renews with the CSRF header and records the new end', async () => {
    const { renewSession, sessionTiming } = await load();
    fetchMock.mockResolvedValue(json(200, { user: { name: 'ana', role: 'viewer' }, expiresIn: 60 }));
    await expect(renewSession()).resolves.toBe('renewed');
    expect(fetchMock.mock.calls[0][0]).toBe('/bff/api/auth/refresh');
    expect(headersOf(0).get('X-HCML-CSRF')).toBe('1');
    expect(sessionTiming()?.lifeMs).toBe(60_000);
  });

  it('signs out when the BFF refuses, and stops asking', async () => {
    const { renewSession, isSignedOut } = await load();
    fetchMock.mockResolvedValue(json(401, { error: 'unauthorized' }));
    await expect(renewSession()).resolves.toBe('signed-out');
    expect(isSignedOut()).toBe(true);
    expect(where.href).toMatch(/^\/login\?next=/);
    await expect(renewSession()).resolves.toBe('signed-out');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a failure it can retry when the BFF does not answer properly', async () => {
    const { renewSession } = await load();
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    await expect(renewSession()).resolves.toBe('failed');
    fetchMock.mockResolvedValueOnce(json(503, { error: 'unavailable' }));
    await expect(renewSession()).resolves.toBe('failed');
    fetchMock.mockResolvedValueOnce(json(200, { user: { name: 'ana', role: 'viewer' } }));
    await expect(renewSession()).resolves.toBe('failed');
  });

  it('tells the menus when the role changed', async () => {
    const { login, renewSession, AUTH_CHANGED } = await load();
    const changed = vi.fn();
    window.addEventListener(AUTH_CHANGED, changed);
    fetchMock.mockResolvedValueOnce(json(200, { user: { name: 'ana', role: 'viewer' }, expiresIn: 60 }));
    await login('ana', 'pw');
    fetchMock.mockResolvedValueOnce(json(200, { user: { name: 'ana', role: 'operator' }, expiresIn: 60 }));
    await renewSession();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(FakeChannel.sent).toContainEqual({ type: 'changed' });
    window.removeEventListener(AUTH_CHANGED, changed);
  });
});

describe('logout', () => {
  it('clears the cookie with the CSRF header, tells the other tabs, and renews no more', async () => {
    const { logout, renewSession, sessionTiming } = await load();
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    await logout();
    expect(fetchMock.mock.calls[0][0]).toBe('/bff/api/auth/logout');
    expect(headersOf(0).get('X-HCML-CSRF')).toBe('1');
    expect(FakeChannel.sent).toContainEqual({ type: 'signed-out' });
    expect(sessionTiming()).toBeNull();
    await expect(renewSession()).resolves.toBe('signed-out');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
