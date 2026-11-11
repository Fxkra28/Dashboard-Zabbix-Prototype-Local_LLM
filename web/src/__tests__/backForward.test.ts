import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

/** What the browser fires when Back restores a page from its back/forward cache. */
const restoredFromCache = () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));

let where: { pathname: string; search: string; href: string };

beforeEach(() => {
  where = { pathname: '/problems', search: '', href: '' };
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  vi.stubGlobal('location', where);
});
afterEach(() => vi.unstubAllGlobals());

// One test in its own file: each fresh api/ adds a window listener (api/index.ts), and
// jsdom's window lasts the whole file.
describe('a page Back restores from the browser cache', () => {
  it('asks the BFF whether the session still holds, and goes to sign-in once it has ended', async () => {
    const fetchMock = vi.fn(async () => json(401, { error: 'unauthorized' }));
    vi.stubGlobal('fetch', fetchMock);
    await import('../api');

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    expect(fetchMock).not.toHaveBeenCalled();

    restoredFromCache();
    await vi.waitFor(() => expect(where.href).toBe('/login?next=%2Fproblems'));
    expect(fetchMock.mock.calls[0]).toEqual(['/bff/api/auth/me', expect.anything()]);

    // After a sign-out in another tab it goes straight there, without asking.
    for (const fn of FakeChannel.listeners) fn({ data: { type: 'signed-out' } });
    where.href = '';
    fetchMock.mockClear();
    restoredFromCache();
    expect(where.href).toBe('/login?next=%2Fproblems');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
