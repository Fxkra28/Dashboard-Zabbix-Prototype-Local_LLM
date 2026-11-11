import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import http, { type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { config } from '../core/config.js';
import { setupAuth, tokenClaims } from '../security/auth.js';
import { subscribe } from '../services/stream.js';
import { ZabbixApiError, ZabbixAuthError, ZabbixTimeoutError } from '../clients/zabbix.js';
import {
  READY_STALE_MS,
  READY_TIMEOUT_MS,
  READY_TTL_MS,
  createReadiness,
  registerHealth,
  type ModelState,
  type Probes,
} from '../http/health.js';

/**
 * GET /api/health: the old fields stay as they were and stay public; version, start time, build, screens and a
 * cached readiness check are new and go only to a signed-in caller.
 */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
// Sign-in on, as deployed: version, build, readiness and screens go only to a signed-in caller.
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer';
});
vi.mock('../clients/zabbix.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/zabbix.js')>()),
  zbx: zbxMock,
}));

// A screen that subscribes starts a read of the problem list: keep it away from Zabbix.
vi.mock('../domain/queries.js', () => ({
  getProblems: vi.fn().mockResolvedValue([]),
  cachedProblems: vi.fn().mockResolvedValue([]),
  PROBLEMS_TTL_MS: 15_000,
}));

const pkgVersion = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

/** Probes the test steers, with a clock it moves. */
function rig(over: { zabbix?: Mock<() => Promise<unknown>>; model?: Mock<() => Promise<ModelState>> } = {}) {
  const clock = { t: 1_788_000_000_000 };
  const probes = {
    zabbix: over.zabbix ?? vi.fn(async (): Promise<unknown> => [{ hostid: '1' }]),
    model: over.model ?? vi.fn(async (): Promise<ModelState> => 'off'),
  } satisfies Probes;
  const readiness = createReadiness({ probes, now: () => clock.t });
  return { clock, probes, readiness };
}

beforeEach(() => {
  zbxMock.mockReset().mockResolvedValue([{ hostid: '1' }]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('createReadiness', () => {
  it('checks Zabbix once however often it is asked within the TTL', async () => {
    const { clock, probes, readiness } = rig();
    const first = await readiness.get();
    for (let i = 0; i < 50; i++) {
      clock.t += 200;
      await readiness.get();
    }
    expect(probes.zabbix).toHaveBeenCalledTimes(1);
    expect(probes.model).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ ok: true, zabbix: 'ok', zabbixMs: 0, model: 'off', checkedAt: 1_788_000_000_000 });
  });

  it('shares one check between callers that arrive while it runs', async () => {
    let answer: () => void = () => undefined;
    const { probes, readiness } = rig({ zabbix: vi.fn(() => new Promise<unknown>((resolve) => (answer = () => resolve([])))) });
    const callers = [readiness.get(), readiness.get(), readiness.get()];
    await Promise.resolve();
    answer();
    const results = await Promise.all(callers);
    expect(probes.zabbix).toHaveBeenCalledTimes(1);
    expect(results[1]).toBe(results[0]);
  });

  it('past the TTL answers with the last result at once and checks again behind it', async () => {
    const { clock, probes, readiness } = rig();
    await readiness.get();
    probes.zabbix.mockRejectedValue(new ZabbixAuthError('token revoked'));

    clock.t += READY_TTL_MS + 1;
    const stale = await readiness.get();
    expect(stale.zabbix).toBe('ok'); // not made to wait
    // The new answer lands behind it, and the next caller gets that one.
    await vi.waitFor(async () => expect((await readiness.get()).zabbix).toBe('token_rejected'));
    expect(probes.zabbix).toHaveBeenCalledTimes(2);
  });

  it('far past the TTL makes the caller wait for a new check rather than hand out an old one', async () => {
    const { clock, probes, readiness } = rig();
    await readiness.get();
    probes.zabbix.mockRejectedValue(new ZabbixAuthError('token revoked'));
    clock.t += READY_STALE_MS + 1;
    expect((await readiness.get()).zabbix).toBe('token_rejected');
  });

  it('names what is wrong without any detail, and is not ready', async () => {
    const cases: [unknown, string][] = [
      [new ZabbixAuthError('The token abc123 was revoked'), 'token_rejected'],
      [new ZabbixTimeoutError('Zabbix did not respond', 'ZBX_URL=http://zabbix.internal:8080'), 'timeout'],
      [new ZabbixApiError('Could not reach Zabbix (ECONNREFUSED)', 'ZBX_URL=http://zabbix.internal:8080'), 'error'],
      [new TypeError('boom'), 'error'],
    ];
    for (const [err, state] of cases) {
      const { readiness } = rig({ zabbix: vi.fn().mockRejectedValue(err) });
      const result = await readiness.get();
      expect(result, state).toMatchObject({ ok: false, zabbix: state, zabbixMs: null });
      expect(JSON.stringify(result)).not.toMatch(/abc123|zabbix\.internal|boom/);
    }
  });

  it('gives up on a Zabbix that does not answer within 2 s, and says timeout', async () => {
    vi.useFakeTimers();
    const { probes, readiness } = rig({ zabbix: vi.fn(() => new Promise<unknown>(() => undefined)) });
    const pending = readiness.get();
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS - 1);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ ok: false, zabbix: 'timeout', zabbixMs: null });
    expect(probes.zabbix).toHaveBeenCalledTimes(1);
    expect(READY_TIMEOUT_MS).toBe(2_000);
  });

  it('reports how long Zabbix took to answer', async () => {
    const clock = { t: 5_000 };
    const readiness = createReadiness({
      probes: {
        zabbix: async () => {
          clock.t += 37;
        },
        model: async () => 'off',
      },
      now: () => clock.t,
    });
    expect(await readiness.get()).toMatchObject({ zabbix: 'ok', zabbixMs: 37 });
  });

  it('does not let the model gate readiness: the AI layer is optional', async () => {
    const { readiness } = rig({ model: vi.fn(async (): Promise<ModelState> => 'down') });
    expect(await readiness.get()).toMatchObject({ ok: true, zabbix: 'ok', model: 'down' });
  });

  it('a model probe that throws counts as down, not as a failed health call', async () => {
    const { readiness } = rig({ model: vi.fn().mockRejectedValue(new Error('x')) });
    expect(await readiness.get()).toMatchObject({ ok: true, model: 'down' });
  });

  it('warm() starts the first check without waiting, so the first call finds an answer', async () => {
    const { probes, readiness } = rig();
    readiness.warm();
    expect(await readiness.get()).toMatchObject({ ok: true });
    expect(probes.zabbix).toHaveBeenCalledTimes(1); // the call's own check, not a second one
  });
});

describe('the default probes', () => {
  const was = { ...config.ai };
  afterEach(() => Object.assign(config.ai, was));

  it('ask Zabbix for one host id with the read-only token, the cheapest authenticated call', async () => {
    await createReadiness().get();
    expect(zbxMock).toHaveBeenCalledExactlyOnceWith('host.get', { output: ['hostid'], limit: 1 });
  });

  it('look at no model that is off, or hosted (a probe would bill it)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    Object.assign(config.ai, { enabled: false, provider: 'anthropic' });
    expect((await createReadiness().get()).model).toBe('off');
    Object.assign(config.ai, { enabled: true, provider: 'anthropic' });
    expect((await createReadiness().get()).model).toBe('not_checked');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('list the models of a local server, and say down when it is stopped or unwell', async () => {
    Object.assign(config.ai, { enabled: true, provider: 'openai-compatible', baseUrl: 'http://model.local:11434/v1/' });
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await createReadiness().get()).model).toBe('ok');
    expect(fetchMock.mock.calls[0][0]).toBe('http://model.local:11434/v1/models');

    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    expect((await createReadiness().get()).model).toBe('down');
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect((await createReadiness().get()).model).toBe('down');
  });

  /** A loopback stand-in for a model server; `key` is what it demands in Authorization, if anything. */
  async function standIn(key?: string) {
    const seen: (string | undefined)[] = [];
    const server = http.createServer((req, res) => {
      seen.push(req.headers.authorization);
      res.statusCode = key && req.headers.authorization !== `Bearer ${key}` ? 401 : 200;
      res.end('{"data":[]}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { seen, baseUrl: `http://127.0.0.1:${port}/v1`, stop: () => new Promise((done) => server.close(done)) };
  }

  it('send the configured key to the model server, as chat does, so a protected one is not reported down', async () => {
    const model = await standIn('stand-in-key');
    try {
      Object.assign(config.ai, { enabled: true, provider: 'openai-compatible', baseUrl: model.baseUrl, apiKey: 'stand-in-key' });
      expect((await createReadiness().get()).model).toBe('ok');
      expect(model.seen).toEqual(['Bearer stand-in-key']);

      Object.assign(config.ai, { apiKey: 'a-wrong-key' });
      expect((await createReadiness().get()).model).toBe('down');
    } finally {
      await model.stop();
    }
  });

  it('send no Authorization header when no key is set, as for a local Ollama', async () => {
    const model = await standIn();
    try {
      Object.assign(config.ai, { enabled: true, provider: 'openai-compatible', baseUrl: model.baseUrl, apiKey: '' });
      expect((await createReadiness().get()).model).toBe('ok');
      expect(model.seen).toEqual([undefined]);
    } finally {
      await model.stop();
    }
  });
});

describe('GET /api/health', () => {
  /** Mounted the way index.ts mounts it: health first, then setupAuth, whose JWT plugin the route uses at request time. */
  async function app(readiness = rig().readiness) {
    const server = Fastify({ logger: false });
    registerHealth(server, readiness);
    await setupAuth(server);
    await server.ready();
    return server;
  }
  const DETAIL = ['version', 'startedAt', 'build', 'ready', 'streams'] as const;
  /** What an anonymous caller is not given. `ready` is the exception: anyone gets it as a plain true or false (IN-47). */
  const PRIVATE = DETAIL.filter((field) => field !== 'ready');
  /** A token as sign-in issues it: the portal's own iss and aud, for a user the list holds. */
  const tokenFor = (server: FastifyInstance, sub = 'ana') =>
    server.jwt.sign({ sub, role: 'viewer', ...tokenClaims(config.auth.sessionCookie) }, { expiresIn: '1h' });
  /** A request from a signed-in viewer, by Bearer header. */
  const signedIn = (server: FastifyInstance) => ({
    url: '/api/health',
    headers: { authorization: `Bearer ${tokenFor(server)}` },
  });

  it('keeps every field it had: ok, ts, ai, writeBack and defaults', async () => {
    const server = await app();
    const res = await server.inject({ url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      ok: true,
      ai: config.ai.enabled,
      writeBack: Boolean(config.zbxWriteToken),
      defaults: { availabilityMinSeverity: config.reports.availabilityMinSeverity },
    });
    expect(typeof body.ts).toBe('number');
    expect(Math.abs(body.ts - Date.now())).toBeLessThan(5_000);
    await server.close();
  });

  it('tells an anonymous caller nothing about the build, the restart, why Zabbix is down or the screens (IN-09)', async () => {
    zbxMock.mockRejectedValue(new ZabbixAuthError('Zabbix rejected the API token'));
    const server = await app(createReadiness());
    const res = await server.inject({ url: '/api/health' });
    expect(res.statusCode).toBe(200);
    for (const field of PRIVATE) expect(res.json(), field).not.toHaveProperty(field);
    // Whether it can read Zabbix, never why: a revoked token reads as any other failure.
    expect(res.json().ready).toBe(false);
    expect(res.body).not.toMatch(/token_rejected|zabbixMs|checkedAt|model/);
    await server.close();
  });

  it('gives anyone a plain ready: true while Zabbix answers and false while it does not, so a watcher needs no account (IN-47)', async () => {
    const up = await app(createReadiness());
    expect((await up.inject({ url: '/api/health' })).json().ready).toBe(true);
    await up.close();

    for (const failure of [new ZabbixAuthError('x'), new ZabbixTimeoutError('x'), new ZabbixApiError('x')]) {
      zbxMock.mockRejectedValue(failure);
      const down = await app(createReadiness());
      const res = await down.inject({ url: '/api/health' });
      expect(res.statusCode, failure.name).toBe(200);
      expect(res.json().ready, failure.name).toBe(false);
      await down.close();
    }
  });

  it('keeps the signed-in caller’s ready as the whole check, and not as the plain flag', async () => {
    const server = await app();
    const res = await server.inject(signedIn(server));
    expect(res.json().ready).toMatchObject({ ok: true, zabbix: 'ok', model: expect.any(String) });
    await server.close();
  });

  it('answers the public reply, not a 401, to a bad, expired or foreign token', async () => {
    const server = await app();
    const foreign = Fastify();
    await foreign.register((await import('@fastify/jwt')).default, { secret: 'a-different-secret-entirely-32-bytes' });
    await foreign.ready();
    const forged = foreign.jwt.sign({ sub: 'ana', role: 'viewer', ...tokenClaims(config.auth.sessionCookie) });
    await foreign.close();
    const expired = server.jwt.sign({ sub: 'ana', role: 'viewer', ...tokenClaims(config.auth.sessionCookie), exp: Math.floor(Date.now() / 1000) - 60 });
    for (const authorization of ['Bearer not-a-jwt', `Bearer ${forged}`, `Bearer ${expired}`]) {
      const res = await server.inject({ url: '/api/health', headers: { authorization } });
      expect(res.statusCode, authorization).toBe(200);
      for (const field of PRIVATE) expect(res.json(), field).not.toHaveProperty(field);
    }
    await server.close();
  });

  it('answers a user taken out of PORTAL_USERS as it answers a stranger, as every guarded route does (SC-14)', async () => {
    const server = await app();
    const res = await server.inject({ url: '/api/health', headers: { authorization: `Bearer ${tokenFor(server, 'gone')}` } });
    expect(res.statusCode).toBe(200);
    for (const field of PRIVATE) expect(res.json(), field).not.toHaveProperty(field);
    await server.close();
  });

  it('gives the detail to a signed-in caller, by Bearer header or by the session cookie', async () => {
    const server = await app();
    const token = tokenFor(server);
    for (const headers of [{ authorization: `Bearer ${token}` }, { cookie: `${config.auth.sessionCookie}=${token}` }]) {
      const body = (await server.inject({ url: '/api/health', headers })).json();
      for (const field of DETAIL) expect(body, field).toHaveProperty(field);
      expect(body).toMatchObject({ ok: true, ready: { ok: true, zabbix: 'ok' } });
    }
    await server.close();
  });

  it('gives the detail to everyone with sign-in off, where every caller is already admin', async () => {
    const server = await app();
    const was = config.auth.enabled;
    config.auth.enabled = false;
    try {
      const body = (await server.inject({ url: '/api/health' })).json();
      for (const field of DETAIL) expect(body, field).toHaveProperty(field);
    } finally {
      config.auth.enabled = was;
      await server.close();
    }
  });

  it('adds the version, when it started, the build, readiness and the screens connected', async () => {
    const server = await app();
    const body = (await server.inject(signedIn(server))).json();
    expect(body.version).toBe(pkgVersion);
    expect(new Date(body.startedAt).toISOString()).toBe(body.startedAt);
    expect(Date.parse(body.startedAt)).toBeLessThanOrEqual(Date.now());
    expect(body.build).toEqual({ commit: 'unknown', time: 'unknown' });
    expect(body.ready).toEqual({ ok: true, zabbix: 'ok', zabbixMs: 0, model: 'off', checkedAt: 1_788_000_000_000 });
    expect(body.streams).toBe(0);
    await server.close();
  });

  it('shows the commit and time the image was built with, and "unknown" for an empty one', async () => {
    vi.stubEnv('BUILD_COMMIT', 'a1b2c3d');
    vi.stubEnv('BUILD_TIME', '2026-10-07T08:00:00Z');
    const server = await app();
    expect((await server.inject(signedIn(server))).json().build).toEqual({
      commit: 'a1b2c3d',
      time: '2026-10-07T08:00:00Z',
    });

    // A blank value (BUILD_COMMIT= on the command line) is unknown too, and a pasted one can be long.
    vi.stubEnv('BUILD_COMMIT', '');
    vi.stubEnv('BUILD_TIME', 'x'.repeat(500));
    expect((await server.inject(signedIn(server))).json().build).toEqual({ commit: 'unknown', time: 'x'.repeat(64) });
    await server.close();
  });

  it('trims the build values, and treats a blank one as unknown', async () => {
    vi.stubEnv('BUILD_COMMIT', '  a1b2c3d\n');
    vi.stubEnv('BUILD_TIME', ' \t ');
    const server = await app();
    expect((await server.inject(signedIn(server))).json().build).toEqual({ commit: 'a1b2c3d', time: 'unknown' });
    await server.close();
  });

  it('gives the time the process started, the same on every call', async () => {
    const server = await app();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const first = (await server.inject(signedIn(server))).json().startedAt;
    vi.setSystemTime(new Date('2030-01-01T06:00:00Z'));
    const later = (await server.inject(signedIn(server))).json().startedAt;
    expect(later).toBe(first);
    expect(Date.parse(first)).toBeLessThan(Date.parse('2030-01-01T00:00:00Z'));
    await server.close();
  });

  it('counts the live screens connected right now', async () => {
    const server = await app();
    const screen = () => {
      const res = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, write: () => true, end: () => undefined });
      return subscribe(res as unknown as ServerResponse);
    };
    const streams = async () => (await server.inject(signedIn(server))).json().streams;
    const leave = [screen(), screen()];
    try {
      expect(await streams()).toBe(2);
      leave[0]();
      expect(await streams()).toBe(1);
    } finally {
      for (const f of leave) f();
    }
    expect(await streams()).toBe(0);
    await server.close();
  });

  it('stays a 200 when Zabbix is down, and says so in ready, so the page and nginx keep working', async () => {
    zbxMock.mockRejectedValue(new ZabbixAuthError('Zabbix rejected the API token'));
    const server = await app(createReadiness());
    const res = await server.inject(signedIn(server));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, ready: { ok: false, zabbix: 'token_rejected', zabbixMs: null } });
    await server.close();
  });

  it('carries no address, token or Zabbix wording, signed in or not', async () => {
    zbxMock.mockRejectedValue(
      new ZabbixApiError('Could not reach Zabbix', `ZBX_URL=${config.zbxUrl} token=secret-token-value`),
    );
    const server = await app(createReadiness());
    for (const request of [{ url: '/api/health' }, signedIn(server)]) {
      const text = (await server.inject(request)).body;
      expect(text).not.toContain(new URL(config.zbxUrl).host);
      expect(text).not.toContain('secret-token-value');
      expect(text).not.toMatch(/ZBX_URL|Bearer|http:\/\//);
    }
    await server.close();
  });

  it('asks Zabbix at most once for a burst of polls, whoever asks', async () => {
    const server = await app(createReadiness());
    await Promise.all(Array.from({ length: 30 }, () => server.inject({ url: '/api/health' })));
    expect(zbxMock).toHaveBeenCalledTimes(1);
    await Promise.all(Array.from({ length: 30 }, () => server.inject(signedIn(server))));
    expect(zbxMock).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it('reports writeBack off when sign-in is off and the dev opt-in is not set (SC-07), as the route would refuse', async () => {
    const server = await app();
    const saved = { enabled: config.auth.enabled, allowWriteWithoutAuth: config.auth.allowWriteWithoutAuth, token: config.zbxWriteToken };
    config.zbxWriteToken = 'test-only-not-a-real-token';
    try {
      expect((await server.inject({ url: '/api/health' })).json().writeBack).toBe(true);
      config.auth.enabled = false;
      expect((await server.inject({ url: '/api/health' })).json().writeBack).toBe(false);
      config.auth.allowWriteWithoutAuth = true;
      expect((await server.inject({ url: '/api/health' })).json().writeBack).toBe(true);
    } finally {
      config.auth.enabled = saved.enabled;
      config.auth.allowWriteWithoutAuth = saved.allowWriteWithoutAuth;
      config.zbxWriteToken = saved.token;
      await server.close();
    }
  });
});

describe('GET /api/ready', () => {
  /** Mounted the way index.ts mounts it: health and ready first, then setupAuth. The guard must still cover ready. */
  async function app(readiness = rig().readiness) {
    const server = Fastify({ logger: false });
    registerHealth(server, readiness);
    await setupAuth(server);
    await server.ready();
    return server;
  }
  const tokenFor = (server: FastifyInstance, sub = 'ana') =>
    server.jwt.sign({ sub, role: 'viewer', ...tokenClaims(config.auth.sessionCookie) }, { expiresIn: '1h' });
  const signedIn = (server: FastifyInstance) => ({ url: '/api/ready', headers: { authorization: `Bearer ${tokenFor(server)}` } });

  it('is guarded: a stranger, a bad token and a user taken out of PORTAL_USERS get 401, and nothing asks Zabbix (IN-09)', async () => {
    const server = await app(createReadiness());
    expect((await server.inject({ url: '/api/ready' })).statusCode).toBe(401);
    expect((await server.inject({ url: '/api/ready', headers: { authorization: 'Bearer not-a-jwt' } })).statusCode).toBe(401);
    expect((await server.inject({ url: '/api/ready', headers: { authorization: `Bearer ${tokenFor(server, 'gone')}` } })).statusCode).toBe(401);
    expect(zbxMock).not.toHaveBeenCalled();
    await server.close();
  });

  it('answers 200 with what the check found and the build, for a signed-in caller, by Bearer header or cookie', async () => {
    const server = await app();
    const token = tokenFor(server);
    for (const headers of [{ authorization: `Bearer ${token}` }, { cookie: `${config.auth.sessionCookie}=${token}` }]) {
      const res = await server.inject({ url: '/api/ready', headers });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ ok: true, zabbix: 'ok', zabbixMs: 0, model: 'off', checkedAt: 1_788_000_000_000, version: pkgVersion, streams: 0 });
      expect(body.build).toEqual({ commit: 'unknown', time: 'unknown' });
      expect(new Date(body.startedAt).toISOString()).toBe(body.startedAt);
    }
    await server.close();
  });

  it('answers 503 while Zabbix cannot be read, and says why in the same fields', async () => {
    const cases: [unknown, string][] = [
      [new ZabbixAuthError('Zabbix rejected the API token'), 'token_rejected'],
      [new ZabbixTimeoutError('Zabbix did not respond', 'ZBX_URL=http://zabbix.internal:8080'), 'timeout'],
      [new ZabbixApiError('Could not reach Zabbix (ECONNREFUSED)', 'ZBX_URL=http://zabbix.internal:8080'), 'error'],
    ];
    for (const [err, state] of cases) {
      zbxMock.mockRejectedValue(err);
      const server = await app(createReadiness());
      const res = await server.inject(signedIn(server));
      expect(res.statusCode, state).toBe(503);
      expect(res.json(), state).toMatchObject({ ok: false, zabbix: state, zabbixMs: null });
      expect(res.body).not.toMatch(/zabbix\.internal|ZBX_URL|Bearer|http:\/\//);
      await server.close();
    }
  });

  it('is not made unready by the model: the AI layer is optional', async () => {
    const { readiness } = rig({ model: vi.fn(async (): Promise<ModelState> => 'down') });
    const server = await app(readiness);
    const res = await server.inject(signedIn(server));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, model: 'down' });
    await server.close();
  });

  it('shares the cached check with /api/health: a burst of both asks Zabbix once', async () => {
    const server = await app(createReadiness());
    const token = tokenFor(server);
    const headers = { authorization: `Bearer ${token}` };
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => server.inject({ url: i % 2 ? '/api/ready' : '/api/health', headers })),
    );
    expect(zbxMock).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it('answers everyone with sign-in off, where every caller is already admin', async () => {
    // setupAuth installs no guard when sign-in is off, so the setting comes before the app is built.
    const was = config.auth.enabled;
    config.auth.enabled = false;
    const server = await app();
    try {
      expect((await server.inject({ url: '/api/ready' })).statusCode).toBe(200);
    } finally {
      config.auth.enabled = was;
      await server.close();
    }
  });
});
