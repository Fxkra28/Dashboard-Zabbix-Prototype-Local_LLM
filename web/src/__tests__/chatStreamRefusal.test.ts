import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A refusal that comes before the Assistant's stream starts: the BFF's own words when it gave some, and for nginx's page or an
 * empty reply the sentence the dialogs use, not a route and a status (FR-38).
 */

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('BroadcastChannel', class { postMessage() {} addEventListener() {} });
});
afterEach(() => vi.unstubAllGlobals());

async function refused(response: Response) {
  vi.resetModules();
  const { chatStream, HttpFailure } = await import('../api');
  fetchMock.mockResolvedValueOnce(response);
  const err = await chatStream([{ role: 'user', content: 'hi' }], { onToken: () => undefined }).then(
    () => undefined,
    (e: unknown) => e,
  );
  return { err: err as InstanceType<typeof HttpFailure>, HttpFailure };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('a refusal before the Assistant answers (FR-38)', () => {
  it.each([
    ['an nginx page', new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 }), 502],
    ['an empty gateway timeout', new Response('', { status: 504 }), 504],
    ['a body that is not an object', json(503, [1, 2]), 503],
    ['a null body', json(500, null), 500],
  ])('says that the portal did not answer, with the status, for %s', async (_what, response, status) => {
    const { err, HttpFailure } = await refused(response);
    expect(err).toBeInstanceOf(HttpFailure);
    expect(err.message).toBe(`The portal did not answer (HTTP ${status}). Ask again in a minute.`);
    expect(err.message).not.toContain('/api/chat');
    expect(err.status).toBe(status);
    expect(err.told).toBe(false);
  });

  it('keeps the BFF’s own sentence when it gave one, whatever the status', async () => {
    const { err } = await refused(json(503, { error: 'ai_unavailable', message: 'The assistant is switched off on this portal.' }));
    expect(err.message).toBe('The assistant is switched off on this portal.');
    expect(err.told).toBe(true);
  });

  it('takes the error code when there is no message, as every other read does', async () => {
    const { err } = await refused(json(429, { error: 'rate_limited' }));
    expect(err.message).toBe('rate_limited');
    expect(err.told).toBe(true);
  });

  it.each([
    ['an object', { message: { code: 7 } }],
    ['a number', { message: 5 }],
    ['an empty string', { message: '   ', error: '' }],
    ['a list', { message: ['a', 'b'], error: null }],
  ])('does not print a message that is %s: it is not words', async (_what, body) => {
    const { err } = await refused(json(502, body));
    expect(err.message).toBe('The portal did not answer (HTTP 502). Ask again in a minute.');
    expect(err.message).not.toMatch(/\[object|\[a,b\]|^5$/);
    expect(err.told).toBe(false);
  });

  it('does not say HTTP 200 for an answer that came with no body at all', async () => {
    const { err } = await refused(new Response(null, { status: 200 }));
    expect(err.message).toBe('The portal answered with nothing. Ask again in a minute.');
    expect(err.message).not.toContain('HTTP 200');
  });

  it('skips a message that is not words and takes the error code that is', async () => {
    const { err } = await refused(json(502, { message: { code: 7 }, error: 'upstream_failed' }));
    expect(err.message).toBe('upstream_failed');
  });
});
