import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two calls that change the saved list of recipients (FR-31): what goes on the wire, and what the page is handed back.
 * The server's own tests hold the other half.
 */
let fetchMock: ReturnType<typeof vi.fn>;
async function load() {
  vi.resetModules();
  return import('../api');
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const call = () => fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('BroadcastChannel', class { postMessage() {} addEventListener() {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('replacing the saved list', () => {
  it('sends the list as JSON with the CSRF header, to the one path', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValueOnce(json({ recipients: ['a@example.org', 'b@example.org'], saved: 2 }));
    await expect(api.sliRecipientsSave(['a@example.org', 'b@example.org'])).resolves.toEqual({ recipients: ['a@example.org', 'b@example.org'], saved: 2 });
    const [url, init] = call();
    expect(url).toBe('/bff/api/sli/recipients');
    expect(init.method).toBe('PUT');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['X-HCML-CSRF']).toBe('1');
    expect(JSON.parse(init.body as string)).toEqual({ recipients: ['a@example.org', 'b@example.org'] });
  });

  it('throws the portal’s own sentence when it refuses the list', async () => {
    const { api, HttpFailure } = await load();
    fetchMock.mockResolvedValueOnce(json({ error: 'bad_request', message: 'Recipients: "x" is not a plain address such as name@example.com.' }, 400));
    const failure = await api.sliRecipientsSave(['x']).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(HttpFailure);
    expect((failure as Error).message).toBe('Recipients: "x" is not a plain address such as name@example.com.');
    expect((failure as InstanceType<typeof HttpFailure>).told).toBe(true);
  });

  it('refuses an answer of the wrong shape, instead of handing the page something it cannot read', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValueOnce(json({ recipients: 'a@example.org' }));
    await expect(api.sliRecipientsSave(['a@example.org'])).rejects.toThrow();
  });
});

describe('deleting the saved list', () => {
  it('sends a DELETE with the CSRF header, and no body and no JSON content type, which the server refuses when empty', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValueOnce(json({ recipients: [], removed: 3 }));
    await expect(api.sliRecipientsDelete()).resolves.toEqual({ recipients: [], removed: 3 });
    const [url, init] = call();
    expect(url).toBe('/bff/api/sli/recipients');
    expect(init.method).toBe('DELETE');
    expect(init.headers['X-HCML-CSRF']).toBe('1');
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('throws the portal’s own sentence for a list the schedule still needs', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValueOnce(json({ error: 'schedule_uses_list', message: 'The monthly schedule sends to this list.' }, 409));
    await expect(api.sliRecipientsDelete()).rejects.toThrow('The monthly schedule sends to this list.');
  });

  it('ends the session on a 401, as every write does', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(api.sliRecipientsDelete()).rejects.toThrow('Unauthorized');
  });

  it('leaves the other writes as they were: a POST still sends its JSON', async () => {
    const { api } = await load();
    fetchMock.mockResolvedValueOnce(json({ ok: true, eventids: ['1'], action: 6 }));
    await api.acknowledge({ eventids: ['1'], acknowledge: true });
    const [, init] = call();
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toMatchObject({ eventids: ['1'] });
  });
});
