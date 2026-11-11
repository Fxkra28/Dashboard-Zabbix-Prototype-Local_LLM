import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Assistant conversation lives in this tab's sessionStorage under `hcml_chat`. On a shared
 * workstation the next person to use the tab must not read it, so it is removed when the session
 * ends: by signing out, by a 401 on any request, by a sign-out in another tab, and by the next
 * sign-in.
 */

/** Tabs talk over this channel; the test delivers another tab's message by hand. */
class FakeChannel {
  static listeners: ((e: { data: unknown }) => void)[] = [];
  postMessage() {}
  addEventListener(_type: string, fn: (e: { data: unknown }) => void) {
    FakeChannel.listeners.push(fn);
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const KEY = 'hcml_chat';
const conversation = JSON.stringify([
  { role: 'user', content: 'Which hosts are unreachable?' },
  { role: 'assistant', content: 'Two at MOPU.' },
]);

let where: { pathname: string; search: string; href: string };

beforeEach(() => {
  where = { pathname: '/assistant', search: '', href: '' };
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  vi.stubGlobal('location', where);
  sessionStorage.setItem(KEY, conversation);
});
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

// One import for the file: each fresh api/ adds a window listener (api/index.ts), and jsdom's window lasts the whole file.
const loadApi = () => import('../api');

describe('the Assistant conversation and the end of a session', () => {
  it('stays through ordinary requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, [])));
    const { api } = await loadApi();
    await api.hosts();
    expect(sessionStorage.getItem(KEY)).toBe(conversation);
  });

  it('is removed by signing out once the BFF has answered, and not before: until then the person is still signed in', async () => {
    let seenWhenAsked: string | null = 'not asked';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        seenWhenAsked = sessionStorage.getItem(KEY);
        return json(200, { ok: true });
      }),
    );
    const { logout } = await loadApi();
    await logout();
    expect(seenWhenAsked).toBe(conversation);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('is kept when the sign-out request fails, since the person is still signed in (signOutFailure.test.ts goes on from there)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(500, { error: 'boom' })));
    const { logout } = await loadApi();
    await expect(logout()).rejects.toThrow('Sign-out failed');
    expect(sessionStorage.getItem(KEY)).toBe(conversation);
  });

  it('is removed when the BFF answers 401 to any request, on the way to sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'unauthorized' })));
    const { api } = await loadApi();
    await expect(api.hosts()).rejects.toThrow('Unauthorized');
    expect(where.href).toBe('/login?next=%2Fassistant');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('is removed when the answer to a question is 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'unauthorized' })));
    const { chatStream } = await loadApi();
    await expect(chatStream([{ role: 'user', content: 'hi' }], { onToken: () => undefined })).rejects.toThrow('Unauthorized');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('is removed on the sign-in page itself, where a 401 sends nobody anywhere', async () => {
    where.pathname = '/login';
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'unauthorized' })));
    const { api } = await loadApi();
    await expect(api.hosts()).rejects.toThrow('Unauthorized');
    expect(where.href).toBe('');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('is removed in this tab when the user signs out in another one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, {})));
    await loadApi();
    for (const fn of FakeChannel.listeners) fn({ data: { type: 'signed-in' } });
    expect(sessionStorage.getItem(KEY)).toBe(conversation);

    for (const fn of FakeChannel.listeners) fn({ data: { type: 'signed-out' } });
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('is removed by the next sign-in, so a new user starts a conversation of their own', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { user: { name: 'ana', role: 'viewer' }, expiresIn: 3600 })));
    const { login } = await loadApi();
    await login('ana', 'secret');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('is not removed by a sign-in that was refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'no' })));
    const { login } = await loadApi();
    await expect(login('ana', 'wrong')).rejects.toThrow('Invalid username or password.');
    expect(sessionStorage.getItem(KEY)).toBe(conversation);
  });

  it('stays removed when an answer lands after sign-out began, until the next sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { ok: true, user: { name: 'ana', role: 'viewer' }, expiresIn: 3600 })));
    const { logout, login } = await loadApi();
    const { saveConversation } = await import('../shared/lib/chatStore');
    const turns = [{ role: 'user' as const, content: 'Which hosts are unreachable?' }];

    await logout();
    saveConversation(turns); // the Assistant is still mounted, and its answer has just finished
    expect(sessionStorage.getItem(KEY)).toBeNull();

    await login('ana', 'secret');
    saveConversation(turns);
    expect(sessionStorage.getItem(KEY)).toBe(JSON.stringify(turns));
  });

  it('stays removed after a refused session too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'unauthorized' })));
    const { api } = await loadApi();
    const { saveConversation, startConversation } = await import('../shared/lib/chatStore');
    await expect(api.hosts()).rejects.toThrow('Unauthorized');

    saveConversation([{ role: 'user', content: 'late' }]);
    expect(sessionStorage.getItem(KEY)).toBeNull();
    startConversation(); // leave the module as the next test expects it
  });

  it('does not fail a sign-out in a browser that blocks storage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { ok: true })));
    const { logout } = await loadApi();
    const blocked = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await expect(logout()).resolves.toBeUndefined();
    blocked.mockRestore();
  });
});
