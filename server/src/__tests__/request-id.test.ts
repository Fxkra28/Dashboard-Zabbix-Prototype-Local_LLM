import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * One id per request: nginx's X-Request-Id when it is well formed, else a new one. It is on every
 * reply, in every error body and on the request's log lines, so a person who reads out the id from
 * an error lets an admin find that request.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer';
});

const { genReqId, registerRequestId } = await import('../http/requestId.js');
const { registerErrorHandler } = await import('../http/errors.js');
const { setupAuth, tokenClaims } = await import('../security/auth.js');
const { config } = await import('../core/config.js');
const { BadRequestError } = await import('../core/validate.js');
const { ZabbixApiError, ZabbixTimeoutError } = await import('../clients/zabbix.js');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let app: FastifyInstance;
let lines: string[];

beforeEach(async () => {
  lines = [];
  // The same order index.ts uses: the id first, then the error handler, then the guard.
  app = Fastify({ genReqId, logger: { level: 'info', stream: { write: (line: string) => void lines.push(line) } } });
  registerRequestId(app);
  registerErrorHandler(app);
  await setupAuth(app);
  app.get('/api/fine', async () => ({ ok: true }));
  app.get('/api/says-error', async () => ({ error: 'a field in a good answer', message: 'not a failure' }));
  app.get('/api/bad', async () => {
    throw new BadRequestError('hours must be a whole number');
  });
  app.get('/api/zabbix-down', async () => {
    throw new ZabbixTimeoutError('Zabbix did not respond', 'ZBX_URL=http://zabbix.internal:8080');
  });
  app.get('/api/zabbix-broken', async () => {
    throw new ZabbixApiError('Zabbix answered with an error', 'method not found');
  });
  app.get('/api/crash', async () => {
    throw new Error('internal wording that must stay out of the body');
  });
  app.get('/api/own-id', async (_req, reply) => reply.code(409).send({ error: 'conflict', message: 'x', requestId: 'chosen-by-the-route' }));
  app.get('/api/list-failure', async (_req, reply) => reply.code(400).send([{ error: 'in a list' }]));
  await app.ready();
});
afterEach(() => app.close());

const token = () => app.jwt.sign({ sub: 'ana', role: 'viewer', ...tokenClaims(config.auth.sessionCookie) }, { expiresIn: '1h' });
const signedIn = (headers: Record<string, string> = {}) => ({ authorization: `Bearer ${token()}`, ...headers });
const idOf = (headers: Record<string, unknown>) => headers['x-request-id'] as string;

describe('genReqId', () => {
  const req = (value: unknown) => ({ headers: { 'x-request-id': value } as Record<string, string | string[] | undefined> });

  it('keeps a well-formed id, which is what nginx sends (32 hex characters)', () => {
    expect(genReqId(req('0123456789abcdef0123456789abcdef'))).toBe('0123456789abcdef0123456789abcdef');
    expect(genReqId(req('req_2026-10-07.a1'))).toBe('req_2026-10-07.a1');
  });

  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(65)],
    ['a space', 'has a space in it'],
    ['a slash', '../../etc/passwd'],
    ['a quote', 'abc"def"ghijkl'],
    ['a comma, which is how two copies of the header arrive', 'abcdefgh1234, abcdefgh5678'],
    ['non-ASCII text', 'идентификатор-запроса'],
    ['an empty value', ''],
    ['a list', ['abcdefgh1234', 'abcdefgh5678']],
    ['nothing', undefined],
  ])('makes a new one for %s', (_name, sent) => {
    expect(genReqId(req(sent))).toMatch(UUID);
  });

  it('makes a different one each time', () => {
    expect(genReqId(req(undefined))).not.toBe(genReqId(req(undefined)));
  });
});

describe('X-Request-Id on the reply', () => {
  it('is on a good answer, a 404, a 400, a 401, a Zabbix failure and a crash, each a fresh id', async () => {
    const urls: [string, number, Record<string, string>][] = [
      ['/api/fine', 200, signedIn()],
      ['/api/nope', 404, signedIn()],
      ['/api/bad', 400, signedIn()],
      ['/api/fine', 401, {}],
      ['/api/zabbix-down', 503, signedIn()],
      ['/api/zabbix-broken', 502, signedIn()],
      ['/api/crash', 500, signedIn()],
    ];
    const ids = new Set<string>();
    for (const [url, status, headers] of urls) {
      const res = await app.inject({ url, headers });
      expect(res.statusCode, url).toBe(status);
      expect(idOf(res.headers), url).toMatch(UUID);
      ids.add(idOf(res.headers));
    }
    expect(ids.size).toBe(urls.length);
  });

  it('keeps the id nginx sent, on the reply and in the body of an error', async () => {
    const sent = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const ok = await app.inject({ url: '/api/fine', headers: signedIn({ 'x-request-id': sent }) });
    expect(idOf(ok.headers)).toBe(sent);
    const bad = await app.inject({ url: '/api/bad', headers: signedIn({ 'x-request-id': sent }) });
    expect(idOf(bad.headers)).toBe(sent);
    expect(bad.json().requestId).toBe(sent);
  });

  it('does not echo an id it would not log: a malformed one is replaced, on the reply and in the body', async () => {
    for (const hostile of ['short', 'has a space in it', '../../etc/passwd', 'a'.repeat(65)]) {
      const res = await app.inject({ url: '/api/bad', headers: signedIn({ 'x-request-id': hostile }) });
      expect(idOf(res.headers), hostile).toMatch(UUID);
      expect(res.json().requestId, hostile).toBe(idOf(res.headers));
      expect(res.body, hostile).not.toContain(hostile);
    }
  });
});

describe('requestId in an error body', () => {
  it('is the same id as the header, for every kind of error the portal sends', async () => {
    const cases: [string, number, string, Record<string, string>][] = [
      ['/api/bad', 400, 'bad_request', signedIn()],
      ['/api/nope', 404, 'not_found', signedIn()],
      ['/api/fine', 401, 'unauthorized', {}],
      ['/api/zabbix-down', 503, 'zabbix_timeout', signedIn()],
      ['/api/zabbix-broken', 502, 'zabbix_error', signedIn()],
      ['/api/crash', 500, 'internal', signedIn()],
    ];
    for (const [url, status, code, headers] of cases) {
      const res = await app.inject({ url, headers });
      const body = res.json();
      expect(res.statusCode, url).toBe(status);
      expect(body.error, url).toBe(code);
      expect(typeof body.message, url).toBe('string');
      expect(body.requestId, url).toBe(idOf(res.headers));
    }
  });

  it('adds only the id: the code and the message stay as errors.ts wrote them, and a crash still hides its wording', async () => {
    const crash = await app.inject({ url: '/api/crash', headers: signedIn() });
    expect(Object.keys(crash.json()).sort()).toEqual(['error', 'message', 'requestId']);
    expect(crash.json().message).toBe(`The portal hit an unexpected error. Tell an administrator and quote reference ${idOf(crash.headers)}.`);
    expect(crash.body).not.toContain('internal wording');
    const down = await app.inject({ url: '/api/zabbix-down', headers: signedIn() });
    expect(down.body).not.toMatch(/zabbix\.internal|ZBX_URL/);
  });

  it('leaves alone an answer that is not an error: a 200 with a field named error, a list, a requestId already there', async () => {
    const good = await app.inject({ url: '/api/says-error', headers: signedIn() });
    expect(good.statusCode).toBe(200);
    expect(good.json()).toEqual({ error: 'a field in a good answer', message: 'not a failure' });
    expect((await app.inject({ url: '/api/fine', headers: signedIn() })).json()).toEqual({ ok: true });
    const list = await app.inject({ url: '/api/list-failure', headers: signedIn() });
    expect(list.json()).toEqual([{ error: 'in a list' }]);
    const own = await app.inject({ url: '/api/own-id', headers: signedIn() });
    expect(own.json().requestId).toBe('chosen-by-the-route');
  });
});

describe('the log', () => {
  it('carries the id as reqId on the request`s lines, so an id read from an error finds them', async () => {
    const sent = 'feedfacecafebeef0011223344556677';
    await app.inject({ url: '/api/crash', headers: signedIn({ 'x-request-id': sent }) });
    const mine = lines.map((l) => JSON.parse(l) as { reqId?: string }).filter((l) => l.reqId === sent);
    // Fastify logs the incoming request, the crash and the completed one.
    expect(mine.length).toBeGreaterThanOrEqual(2);
  });
});

describe('wiring in index.ts', () => {
  // index.ts starts a server on import, so it is read as text, as write-gate.test.ts reads it.
  const code = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  it('gives Fastify the id generator, so the id nginx sent is the one that is logged', () => {
    expect(code).toMatch(/Fastify\(\{[^]*?\bgenReqId\b[^]*?\}\);/);
  });

  it('registers the id before the Host check, the rate limit and every route, so their refusals carry it too', () => {
    const at = (needle: string) => code.indexOf(needle);
    expect(at('registerRequestId(app)')).toBeGreaterThan(-1);
    for (const later of ['registerHostCheck(app)', 'registerRateLimit(app)', 'registerErrorHandler(app)', 'setupAuth(app)', 'app.register(hostRoutes)']) {
      expect(at('registerRequestId(app)'), later).toBeLessThan(at(later));
    }
  });
});
