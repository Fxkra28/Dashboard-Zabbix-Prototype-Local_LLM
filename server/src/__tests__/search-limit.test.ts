import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * A text search in the item picker or in Latest data is a cold read of Zabbix whenever the text is
 * new. The global limit is one bucket per address, so one person could spend all of it on searches:
 * each person gets a smaller allowance of their own for them (BK-36).
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer,olu:operator-pass:operator';
});

const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/zabbix.js')>()),
  zbx: zbxMock,
}));

const { config } = await import('../core/config.js');
const { setupAuth, tokenClaims } = await import('../security/auth.js');
const { registerErrorHandler } = await import('../http/errors.js');
const { invalidate } = await import('../core/cache.js');
const { hostRoutes } = await import('../routes/hosts.js');
const { SEARCHES_PER_MINUTE } = await import('../security/searchLimit.js');

let app: FastifyInstance;
/** The allowance is module state, so each test starts in a minute of its own. */
let test = 0;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T08:00:00Z').getTime() + test++ * 120_000);
  invalidate('');
  zbxMock.mockReset().mockResolvedValue([]);
  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await setupAuth(app);
  await app.register(hostRoutes);
  await app.ready();
});
afterEach(async () => {
  vi.useRealTimers();
  await app.close();
});

const as = (sub: string, role: string) => ({
  authorization: `Bearer ${app.jwt.sign({ sub, role, ...tokenClaims(config.auth.sessionCookie) }, { expiresIn: '1h' })}`,
});
const ana = () => as('ana', 'viewer');
const olu = () => as('olu', 'operator');
const items = (search: string, headers: Record<string, string>) => app.inject({ url: `/api/items?hostid=1&search=${encodeURIComponent(search)}`, headers });
const latest = (search: string, headers: Record<string, string>) => app.inject({ url: `/api/latest?hostid=1&page=1&search=${encodeURIComponent(search)}`, headers });

describe(`${SEARCHES_PER_MINUTE} text searches a minute for each person (BK-36)`, () => {
  it('answers the last search inside the allowance and refuses the next, saying how long to wait', async () => {
    const headers = ana();
    for (let i = 0; i < SEARCHES_PER_MINUTE; i++) expect((await items(`s${i}`, headers)).statusCode, `search ${i + 1}`).toBe(200);

    const refused = await items('one more', headers);
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ error: 'rate_limited' });
    expect(refused.json().message).toMatch(new RegExp(`${SEARCHES_PER_MINUTE} searches a minute for each person`));
    expect(refused.json().message).toMatch(/Try again in \d+ seconds?\./);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(60);
  });

  it('counts the picker and Latest data together, and the paged and the first-500 read of Latest data alike', async () => {
    const headers = ana();
    for (let i = 0; i < 40; i++) await items(`a${i}`, headers);
    for (let i = 0; i < 40; i++) await latest(`b${i}`, headers);
    for (let i = 0; i < 40; i++) expect((await app.inject({ url: `/api/latest?hostid=1&search=c${i}`, headers })).statusCode).toBe(200);
    expect((await items('over', headers)).statusCode).toBe(429);
    expect((await latest('over', headers)).statusCode).toBe(429);
    expect((await app.inject({ url: '/api/latest?hostid=1&search=over', headers })).statusCode).toBe(429);
  });

  it('counts a search that is already cached too, since a cached one costs Zabbix nothing but still takes a turn', async () => {
    const headers = ana();
    for (let i = 0; i < SEARCHES_PER_MINUTE; i++) await items('same', headers);
    expect((await items('same', headers)).statusCode).toBe(429);
  });

  it('never counts a request with no text, or with only spaces', async () => {
    const headers = ana();
    for (let i = 0; i < SEARCHES_PER_MINUTE + 30; i++) {
      expect((await app.inject({ url: '/api/items?hostid=1', headers })).statusCode).toBe(200);
      expect((await app.inject({ url: '/api/latest?hostid=1&page=1', headers })).statusCode).toBe(200);
    }
    for (let i = 0; i < SEARCHES_PER_MINUTE + 30; i++) {
      expect((await items('   ', headers)).statusCode).toBe(200);
      expect((await items('', headers)).statusCode).toBe(200);
    }
    expect((await items('a search', headers)).statusCode).toBe(200);
  });

  it('keeps one person from using up the allowance of another', async () => {
    const a = ana();
    for (let i = 0; i < SEARCHES_PER_MINUTE + 5; i++) await items(`s${i}`, a);
    expect((await items('x', a)).statusCode).toBe(429);
    expect((await items('x', olu())).statusCode).toBe(200);
  });

  it('gives the allowance back when the minute is over', async () => {
    const headers = ana();
    for (let i = 0; i < SEARCHES_PER_MINUTE + 5; i++) await items(`s${i}`, headers);
    expect((await items('x', headers)).statusCode).toBe(429);
    vi.setSystemTime(Date.now() + 61_000);
    expect((await items('x', headers)).statusCode).toBe(200);
  });

  it('answers a refused search without asking Zabbix', async () => {
    const headers = ana();
    for (let i = 0; i < SEARCHES_PER_MINUTE; i++) await items(`s${i}`, headers);
    zbxMock.mockClear();
    expect((await items('fresh text', headers)).statusCode).toBe(429);
    expect(zbxMock).not.toHaveBeenCalled();
  });
});
