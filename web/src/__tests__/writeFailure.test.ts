import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A write that fails: whether the BFF said why decides what a person is told, as it does for a read (FR-29). An nginx page
 * that answers while the BFF restarts carries no words of its own, and a send that ended in one may still have gone.
 */

/** The tabs' channel is not under test here; api/ only needs one to exist. */
class FakeChannel {
  postMessage() {}
  addEventListener() {}
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

/** A fresh api/ for each test: its session state lives at module level (api/session.ts). */
async function load() {
  vi.resetModules();
  return import('../api');
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  vi.stubGlobal('location', { pathname: '/sla', search: '', href: '', origin: 'http://localhost:3000' });
});
afterEach(() => vi.unstubAllGlobals());

const asked = { formats: ['pdf'] as const };

describe('a failed write', () => {
  it('is an HttpFailure that was not told when the answer is not the BFF\'s JSON, as an nginx 502 page is', async () => {
    fetchMock.mockResolvedValue(new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 }));
    const { api, HttpFailure } = await load();
    const err = await api.sliEmail('2026-08', asked as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpFailure);
    expect(err).toMatchObject({ status: 502, told: false, message: '/api/sli/email: HTTP 502' });
  });

  it('is an HttpFailure that was told when the BFF gave its own words', async () => {
    fetchMock.mockResolvedValue(json(502, { error: 'mail_error', message: 'The mail server refused the login.' }));
    const { api, HttpFailure } = await load();
    const err = await api.sliEmail('2026-08', asked as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpFailure);
    expect(err).toMatchObject({ status: 502, told: true, message: 'The mail server refused the login.' });
  });

  it('does not count an empty message as words', async () => {
    fetchMock.mockResolvedValue(json(504, { message: '  ' }));
    const { api } = await load();
    const err = await api.sliEmail('2026-08', asked as never).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 504, told: false });
  });

  it('is the same for a PUT, the monthly send', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 504 }));
    const { api, HttpFailure } = await load();
    const err = await api.sliScheduleSave({} as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpFailure);
    expect(err).toMatchObject({ status: 504, told: false });
  });
});

describe('a success whose body is not JSON', () => {
  it('is an answer the page cannot read, and not a SyntaxError, since the change was made', async () => {
    fetchMock.mockResolvedValue(new Response('<html><body>ok</body></html>', { status: 200 }));
    const { api } = await load();
    const err = await api.sliEmail('2026-08', asked as never).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'UnreadableAnswer' });
    expect((err as Error).message).not.toMatch(/JSON/);
  });

  it('is the same for a PUT', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));
    const { api } = await load();
    const err = await api.sliScheduleSave({} as never).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'UnreadableAnswer' });
  });
});

describe('the answer to the send request', () => {
  const sent = { sent: 2, refused: 0, month: '2026-08', files: [{ format: 'pdf', fileName: 'HCML_SLA_Report_2026-08.pdf', bytes: 1000 }], remembered: false };

  it('is returned when it has what the page reads', async () => {
    fetchMock.mockResolvedValue(json(200, sent));
    const { api } = await load();
    await expect(api.sliEmail('2026-08', asked as never)).resolves.toEqual(sent);
  });

  it('is refused as unreadable when it has no list of files, so that the page cannot crash after the mail has gone', async () => {
    const without = Object.fromEntries(Object.entries(sent).filter(([key]) => key !== 'files'));
    fetchMock.mockResolvedValue(json(200, without));
    const { api } = await load();
    const err = await api.sliEmail('2026-08', asked as never).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'UnreadableAnswer' });
  });

  it('is refused as unreadable when a count is not a number', async () => {
    fetchMock.mockResolvedValue(json(200, { ...sent, sent: 'two' }));
    const { api } = await load();
    const err = await api.sliEmail('2026-08', asked as never).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'UnreadableAnswer' });
  });
});
