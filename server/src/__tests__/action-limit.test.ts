import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MinuteLimit } from '../clients/limits.js';
import { MAX_EVENTIDS } from '../services/actions.js';

/**
 * How many events one person may acknowledge or close in a minute (SC-51). A comment said a script could not close a whole estate, and the only
 * limit was 50 ids a request: a script could repeat it for 15,000 events a minute, and HCML has about 700 open problems.
 */
const { zbxWriteMock } = vi.hoisted(() => ({ zbxWriteMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/zabbix.js')>()),
  zbxWrite: zbxWriteMock,
}));

beforeEach(() => zbxWriteMock.mockReset().mockResolvedValue({ eventids: [] }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

describe('the setting', () => {
  async function load(value?: string) {
    vi.resetModules();
    vi.stubEnv('ACTION_EVENTS_PER_MINUTE', value);
    return (await import('../core/config.js')).config.actions.eventsPerMinute;
  }

  it('is 200 events a minute when nothing is set: four full requests, which a person at the console does not reach', async () => {
    expect(await load(undefined)).toBe(200);
    expect(await load('')).toBe(200);
  });

  it('reads the number, rounding down, and never goes below one full request, so that a request of 50 can always be made', async () => {
    expect(await load('120.9')).toBe(120);
    expect(await load('1')).toBe(MAX_EVENTIDS);
    expect(await load('0')).toBe(MAX_EVENTIDS);
    expect(await load('-30')).toBe(MAX_EVENTIDS);
  });

  it('falls back to the default for a value it cannot read, as docker-compose passes an unset one', async () => {
    for (const junk of ['lots', ' ', 'NaN']) expect(await load(junk), junk).toBe(200);
  });
});

describe('MinuteLimit counted by weight', () => {
  it('counts each call as one when it is given no weight, as before', () => {
    let now = 0;
    const limit = new MinuteLimit(2, () => now);
    expect(limit.take('a')).toBeNull();
    expect(limit.take('a')).toBeNull();
    expect(limit.take('a')).toBe(60);
    now += 61_000;
    expect(limit.take('a')).toBeNull();
  });

  it('counts a call by its weight, refuses one that would pass the limit and leaves the count where it was', () => {
    let now = 0;
    const limit = new MinuteLimit(100, () => now);
    expect(limit.take('a', 40)).toBeNull();
    expect(limit.take('a', 40)).toBeNull();
    expect(limit.take('a', 40)).toBe(60); // 120 would pass it
    expect(limit.take('a', 20)).toBeNull(); // 100 is exactly the limit
    expect(limit.take('a', 1)).toBe(60);
    expect(limit.take('b', 100)).toBeNull(); // another key has its own
    now += 61_000;
    expect(limit.take('a', 100)).toBeNull();
  });
});

describe('POST /api/problems/acknowledge', () => {
  type Server = Awaited<ReturnType<typeof app>>;
  const post = (server: Server, eventids: string[], over: Record<string, unknown> = {}, remoteAddress = '203.0.113.10') =>
    server.inject({ method: 'POST', url: '/api/problems/acknowledge', remoteAddress, payload: { eventids, ...over } });

  /** The route as the portal builds it, with write-back on for a dev run (sign-in off and its opt-in) and `perMinute` events allowed. */
  async function app(perMinute: number) {
    vi.resetModules();
    const { config } = await import('../core/config.js');
    config.zbxWriteToken = 'test-only-not-a-real-token';
    config.auth.enabled = false;
    config.auth.allowWriteWithoutAuth = true;
    config.actions.eventsPerMinute = perMinute;
    const { actionRoutes } = await import('../routes/actions.js');
    const { buildTestApp } = await import('./helpers/app.js');
    return buildTestApp(actionRoutes);
  }

  it('stops one person at their events for the minute, says how long to wait, and writes nothing for the refused request', async () => {
    const server = await app(100);
    expect((await post(server, ids(40))).statusCode).toBe(200);
    expect((await post(server, ids(40, 100))).statusCode).toBe(200);
    expect(zbxWriteMock).toHaveBeenCalledTimes(2);

    const refused = await post(server, ids(40, 200));
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({
      error: 'rate_limited',
      message: expect.stringMatching(/^The limit is 100 events a minute for each person, acknowledge and close together\. Try again in \d+ seconds?\.$/),
    });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(zbxWriteMock).toHaveBeenCalledTimes(2);

    // What was left of the minute is still theirs: a smaller request fits.
    expect((await post(server, ids(20, 300))).statusCode).toBe(200);
    await server.close();
  });

  it('counts a close and an acknowledge on the same allowance', async () => {
    const server = await app(100);
    expect((await post(server, ids(50), { acknowledge: false, close: true })).statusCode).toBe(200);
    expect((await post(server, ids(50, 100))).statusCode).toBe(200);
    expect((await post(server, ids(1, 200))).statusCode).toBe(429);
    await server.close();
  });

  it('leaves every other person their own allowance', async () => {
    const server = await app(50);
    expect((await post(server, ids(50), {}, '203.0.113.20')).statusCode).toBe(200);
    expect((await post(server, ids(50, 100), {}, '203.0.113.20')).statusCode).toBe(429);
    expect((await post(server, ids(50), {}, '203.0.113.21')).statusCode).toBe(200);
    await server.close();
  });

  it('does not count a request that was refused for a bad body, since nothing was written', async () => {
    const server = await app(50);
    for (let i = 0; i < 10; i++) expect((await post(server, ['not-an-id'], {}, '203.0.113.30')).statusCode).toBe(400);
    expect((await post(server, ids(50), {}, '203.0.113.30')).statusCode).toBe(200);
    await server.close();
  });

  it('starts a new minute with a new allowance', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    const server = await app(50);
    expect((await post(server, ids(50), {}, '203.0.113.40')).statusCode).toBe(200);
    expect((await post(server, ids(1, 100), {}, '203.0.113.40')).statusCode).toBe(429);
    vi.setSystemTime(Date.now() + 61_000);
    expect((await post(server, ids(50, 200), {}, '203.0.113.40')).statusCode).toBe(200);
    await server.close();
  });
});
