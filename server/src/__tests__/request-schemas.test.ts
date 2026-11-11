import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Body schemas on the POST routes, and the query schema of the GET routes. The real sign-in, sign-out, renewal, acknowledge and assistant
 * routes are mounted behind the real guard and the real error handler, with Zabbix mocked, so the
 * status codes and bodies are the ones a client gets. A malformed body is a plain 400
 * `bad_request`; a good one behaves as it did before the schemas.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer,olu:operator-pass:operator';
});

const { zbxWriteMock } = vi.hoisted(() => ({ zbxWriteMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbxWrite: zbxWriteMock };
});

const { setupAuth, LOGIN_LOCK_AFTER } = await import('../security/auth.js');
const { registerErrorHandler } = await import('../http/errors.js');
const { actionRoutes } = await import('../routes/actions.js');
const { chatRoutes } = await import('../routes/chat.js');
const { config } = await import('../core/config.js');
const { AJV_OPTIONS, QUERY_VALUE_MAX, singleValues, validationProblem } = await import('../core/schemas.js');

let app: FastifyInstance;
let savedToken: string;

beforeAll(async () => {
  savedToken = config.zbxWriteToken;
  config.zbxWriteToken = 'test-only-not-a-real-token';
  // The way index.ts builds it, so the schemas see the same validator production does.
  app = Fastify({ logger: false, ajv: AJV_OPTIONS });
  registerErrorHandler(app);
  await setupAuth(app);
  await app.register(actionRoutes);
  await app.register(chatRoutes);
  await app.ready();
});

afterAll(async () => {
  config.zbxWriteToken = savedToken;
  await app.close();
});

beforeEach(() => zbxWriteMock.mockReset());

/** What the portal's own page sends: the CSRF header and its own origin. */
const HOST = '127.0.0.1:8081';
const page = () => ({ host: HOST, origin: `http://${HOST}`, 'x-hcml-csrf': '1' });
const json = { 'content-type': 'application/json' };
/** A body sent as raw JSON text, for the values `payload` would turn into something else. */
const raw = (value: unknown) => ({ payload: JSON.stringify(value), headers: json });

const login = (payload: unknown, headers: Record<string, string> = page()) =>
  app.inject({ method: 'POST', url: '/api/auth/login', headers: { ...headers, ...json }, payload: JSON.stringify(payload) });

/** A signed-in user's token, taken from the sign-in's own cookie as a script would. */
async function tokenOf(username: string, password: string): Promise<string> {
  const res = await login({ username, password });
  expect(res.statusCode).toBe(200);
  return res.cookies.find((c) => c.name === 'hcml_session')!.value;
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const BAD_REQUEST = 'bad_request';
const OBJECT = 'The request body must be a JSON object.';

describe('POST /api/auth/login body', () => {
  it.each([
    ['an empty object', {}, 'username is required.'],
    ['no password', { username: 'ana' }, 'password is required.'],
    ['no username', { password: 'viewer-pass' }, 'username is required.'],
    ['a number for the name', { username: 5, password: 'viewer-pass' }, 'username must be text.'],
    ['null for the password', { username: 'ana', password: null }, 'password must be text.'],
    ['a list for the name', { username: ['ana'], password: 'viewer-pass' }, 'username must be text.'],
    ['a list for the password', { username: 'ana', password: ['viewer-pass'] }, 'password must be text.'],
    ['a list instead of an object', [{ username: 'ana', password: 'viewer-pass' }], OBJECT],
    ['text instead of an object', 'ana:viewer-pass', OBJECT],
    ['null instead of an object', null, OBJECT],
  ])('answers a plain 400 for %s, and signs nobody in', async (_what, body, message) => {
    const res = await login(body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: BAD_REQUEST, message });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('answers 400 when there is no body at all', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: page() });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: BAD_REQUEST, message: OBJECT });
  });

  it('does not echo what was sent', async () => {
    const res = await login({ username: 'ana', password: { guess: 'hunter2-not-a-real-password' } });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('hunter2');
  });

  it('still signs in with a right password, and ignores an extra field', async () => {
    const res = await login({ username: 'olu', password: 'operator-pass', remember: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { name: 'olu', role: 'operator' }, expiresIn: 43200 });
    expect(res.cookies.find((c) => c.name === 'hcml_session')).toBeDefined();
  });

  it('still answers 401 for a wrong password, an unknown user, and for empty text', async () => {
    for (const body of [
      { username: 'ana', password: 'wrong' },
      { username: 'nobody', password: 'viewer-pass' },
      { username: '', password: '' },
    ]) {
      const res = await login(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(401);
      expect(res.json().error).toBe('invalid_credentials');
    }
  });

  it('is not a guess, so it does not count toward the lock after failed sign-ins', async () => {
    for (let i = 0; i < LOGIN_LOCK_AFTER + 2; i++) expect((await login({ username: 'ana', password: 5 })).statusCode).toBe(400);
    expect((await login({ username: 'ana', password: 'viewer-pass' })).statusCode).toBe(200);
  });

  it('is still refused for a missing CSRF header before the body is looked at', async () => {
    const res = await login({}, { host: HOST });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('csrf');
  });
});

describe('POST /api/auth/logout and /api/auth/refresh body', () => {
  it('sign-out takes no body, an empty object, and nothing else', async () => {
    const out = (extra: { payload?: string | object; headers?: Record<string, string> }) =>
      app.inject({ method: 'POST', url: '/api/auth/logout', ...extra, headers: { ...page(), ...extra.headers } });
    expect((await out({})).statusCode).toBe(200);
    expect((await out({ payload: {} })).statusCode).toBe(200);
    expect((await out(raw(null))).statusCode).toBe(200);
    for (const body of [[1], 'out', 5]) {
      const res = await out(raw(body));
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ error: BAD_REQUEST, message: OBJECT });
    }
  });

  it('renewal takes no body, an empty object, and nothing else, with a valid session', async () => {
    const headers = bearer(await tokenOf('ana', 'viewer-pass'));
    const renew = (extra: { payload?: string | object; headers?: Record<string, string> }) =>
      app.inject({ method: 'POST', url: '/api/auth/refresh', ...extra, headers: { ...headers, ...extra.headers } });
    const plain = await renew({});
    expect(plain.statusCode).toBe(200);
    expect(plain.json()).toMatchObject({ user: { name: 'ana', role: 'viewer' } });
    expect((await renew({ payload: {} })).statusCode).toBe(200);
    const bad = await renew(raw([1]));
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: BAD_REQUEST, message: OBJECT });
    expect(bad.headers['set-cookie']).toBeUndefined();
  });

  it('renewal asks who you are before it asks about the body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', ...raw([1]) });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/problems/acknowledge body', () => {
  let operator: Record<string, string>;
  beforeAll(async () => {
    operator = bearer(await tokenOf('olu', 'operator-pass'));
  });
  const ack = (payload: unknown) =>
    app.inject({ method: 'POST', url: '/api/problems/acknowledge', headers: { ...operator, ...json }, payload: JSON.stringify(payload) });

  it.each([
    ['an empty object', {}, 'eventids is required.'],
    ['a number for eventids', { eventids: 5 }, 'eventids must be text or a list.'],
    ['an object for eventids', { eventids: { id: '1' } }, 'eventids must be text or a list.'],
    ['a number for message', { eventids: ['1'], message: 5 }, 'message must be text.'],
    ['text for acknowledge', { eventids: ['1'], acknowledge: 'false' }, 'acknowledge must be true or false.'],
    ['a number for close', { eventids: ['1'], close: 1 }, 'close must be true or false.'],
    ['a list instead of an object', [{ eventids: ['1'] }], OBJECT],
    ['text instead of an object', 'ack all', OBJECT],
    ['null instead of an object', null, OBJECT],
  ])('answers a plain 400 for %s, and writes nothing', async (_what, body, message) => {
    const res = await ack(body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: BAD_REQUEST, message });
    expect(zbxWriteMock).not.toHaveBeenCalled();
  });

  it('answers 400 when there is no body at all', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/problems/acknowledge', headers: operator });
    expect(res.statusCode).toBe(400);
    expect(zbxWriteMock).not.toHaveBeenCalled();
  });

  it('still writes for one id as text, a list of ids, and null read as not given', async () => {
    zbxWriteMock.mockResolvedValue({ eventids: ['109'] });
    const one = await ack({ eventids: '109' });
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ ok: true, action: 2 });
    expect(zbxWriteMock.mock.calls.at(-1)?.[1]).toMatchObject({ eventids: ['109'] });

    const many = await ack({ eventids: ['109', '110'], message: ' on it ', close: true, acknowledge: null });
    expect(many.statusCode).toBe(200);
    expect(many.json()).toMatchObject({ action: 7 });
    expect(zbxWriteMock.mock.calls.at(-1)?.[1]).toMatchObject({ eventids: ['109', '110'] });
  });

  it('leaves the finer rules to the handler: digits only, members that are not text dropped', async () => {
    zbxWriteMock.mockResolvedValue({ eventids: ['109'] });
    const letters = await ack({ eventids: ['abc'] });
    expect(letters.statusCode).toBe(400);
    expect(letters.json().message).toBe('eventids must be numeric Zabbix event ids.');

    const tooLong = await ack({ eventids: ['109', '99999999999999999999999'] });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().message).toBe('eventids must be numeric Zabbix event ids.');
    expect(zbxWriteMock.mock.calls.every(([, params]) => !JSON.stringify(params).includes('99999999999999999999999'))).toBe(true);

    const mixed = await ack({ eventids: ['109', 5] });
    expect(mixed.statusCode).toBe(200);
    expect(zbxWriteMock.mock.calls.at(-1)?.[1]).toMatchObject({ eventids: ['109'] });

    const none = await ack({ eventids: [5] });
    expect(none.statusCode).toBe(400);
    expect(none.json().message).toMatch(/eventids is required/);
  });

  it('is refused by the guard before the body is looked at', async () => {
    const viewer = bearer(await tokenOf('ana', 'viewer-pass'));
    const res = await app.inject({ method: 'POST', url: '/api/problems/acknowledge', headers: { ...viewer, ...json }, payload: '[1]' });
    expect(res.statusCode).toBe(403);
    const anon = await app.inject({ method: 'POST', url: '/api/problems/acknowledge', headers: json, payload: '[1]' });
    expect(anon.statusCode).toBe(401);
  });
});

describe('POST /api/chat body', () => {
  let viewer: Record<string, string>;
  beforeAll(async () => {
    viewer = bearer(await tokenOf('ana', 'viewer-pass'));
  });
  const chat = (payload: unknown) =>
    app.inject({ method: 'POST', url: '/api/chat', headers: { ...viewer, ...json }, payload: JSON.stringify(payload) });

  it.each([
    ['an empty object', {}, 'messages is required.'],
    ['text for messages', { messages: 'hello' }, 'messages must be a list.'],
    ['no messages', { messages: [] }, 'messages must not be empty.'],
    ['a turn that is not an object', { messages: ['hello'] }, 'messages[0] must be a JSON object.'],
    ['a turn with no content', { messages: [{ role: 'user' }] }, 'messages[0].content is required.'],
    ['a role that is not allowed', { messages: [{ role: 'system', content: 'be rude' }] }, 'messages[0].role must be one of: user, assistant.'],
    ['content that is not text', { messages: [{ role: 'user', content: 5 }] }, 'messages[0].content must be text.'],
    ['a list instead of an object', [{ role: 'user', content: 'hi' }], OBJECT],
  ])('answers a plain 400 for %s', async (_what, body, message) => {
    const res = await chat(body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: BAD_REQUEST, message });
  });

  it('lets a well-formed body through to the handler, which answers for itself', async () => {
    // No model is configured in this test, so the handler's own answer shows the schema let the body by.
    const res = await chat({ messages: [{ role: 'assistant', content: 'Hi' }, { role: 'user', content: 'What is down?', id: 7 }] });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('ai_disabled');
  });
});

describe('validationProblem', () => {
  const failure = (keyword: string, instancePath: string, params: Record<string, unknown>, context = 'body') => ({
    validation: [{ keyword, instancePath, params }],
    validationContext: context,
  });

  it('reads nothing into an error that is not a validation failure', () => {
    for (const err of [null, undefined, 'x', new Error('boom'), { validation: [] }, { validation: 'no' }]) {
      expect(validationProblem(err)).toBeNull();
    }
  });

  it.each([
    ['a missing field', failure('required', '', { missingProperty: 'a' }), 'a is required.'],
    ['a missing nested field', failure('required', '/m/0', { missingProperty: 'role' }), 'm[0].role is required.'],
    ['text expected', failure('type', '/a', { type: 'string' }), 'a must be text.'],
    ['text or null expected', failure('type', '/a', { type: 'string,null' }), 'a must be text.'],
    ['true or false expected', failure('type', '/a', { type: 'boolean' }), 'a must be true or false.'],
    ['text or a list expected', failure('type', '/a', { type: 'string,array' }), 'a must be text or a list.'],
    ['an object expected at the top', failure('type', '', { type: 'object' }), OBJECT],
    ['an object expected in the query string', failure('type', '', { type: 'object' }, 'querystring'), 'The query string must be a JSON object.'],
    ['a query name sent twice', failure('type', '/month', { type: 'string' }, 'querystring'), 'month must be given once.'],
    ['a query value too long', failure('maxLength', '/search', { limit: 2000 }, 'querystring'), 'search must have at most 2000 characters.'],
    ['a value outside a list', failure('enum', '/r', { allowedValues: ['x', 'y'] }), 'r must be one of: x, y.'],
    ['an empty list', failure('minItems', '/m', { limit: 1 }), 'm must not be empty.'],
    ['a short list', failure('minItems', '/m', { limit: 3 }), 'm must have at least 3 items.'],
    ['empty text', failure('minLength', '/t', { limit: 1 }), 't must not be empty.'],
    ['long text', failure('maxLength', '/t', { limit: 9 }), 't must have at most 9 characters.'],
    ['a rule it has no wording for', failure('pattern', '/p', { pattern: '^x$' }), 'p is not valid.'],
  ])('words %s', (_what, err, message) => {
    expect(validationProblem(err)).toBe(message);
  });
});

describe('the schemas stay on every POST route', () => {
  const SRC = fileURLToPath(new URL('..', import.meta.url));
  const sources = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      if (name === '__tests__') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) sources(full, out);
      else if (name.endsWith('.ts')) out.push(full);
    }
    return out;
  };

  it('has a body schema in the options of every app.post(...)', () => {
    const missing: string[] = [];
    let found = 0;
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\b\w+\.post\(\s*(['"`])(\/[^'"`]*)\1\s*,([\s\S]*?)=>/g)) {
        found++;
        if (!/\bschema:\s*\{\s*body:/.test(m[3])) missing.push(`${file.slice(SRC.length)} POST ${m[2]}`);
      }
    }
    expect(found).toBeGreaterThanOrEqual(5);
    expect(missing).toEqual([]);
  });

  it('holds a query to one value per name, of at most QUERY_VALUE_MAX characters, and lets other names through', async () => {
    const probe = Fastify({ logger: false, ajv: AJV_OPTIONS });
    registerErrorHandler(probe);
    probe.get('/q', { schema: { querystring: singleValues('search', 'page') } }, async (req) => req.query);
    await probe.ready();
    const get = (query: string) => probe.inject({ url: `/q?${query}` });
    expect((await get('search=a&page=2&other=1&other=2')).json()).toEqual({ search: 'a', page: '2', other: ['1', '2'] });
    expect((await get('page=1&page=2')).json()).toEqual({ error: 'bad_request', message: 'page must be given once.' });
    expect((await get(`search=${'x'.repeat(QUERY_VALUE_MAX)}`)).statusCode).toBe(200);
    expect((await get(`search=${'x'.repeat(QUERY_VALUE_MAX + 1)}`)).json()).toEqual({
      error: 'bad_request',
      message: `search must have at most ${QUERY_VALUE_MAX} characters.`,
    });
    await probe.close();
  });

  it('builds the server without coercion, so the schemas see types as sent', () => {
    expect(AJV_OPTIONS.customOptions?.coerceTypes).toBe(false);
    expect(readFileSync(join(SRC, 'index.ts'), 'utf8')).toMatch(/ajv:\s*AJV_OPTIONS/);
  });
});
