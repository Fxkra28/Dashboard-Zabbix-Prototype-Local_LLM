import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';

/**
 * A cold report over days of history is thousands of SQL statements behind a gate of two places, and every new `days` is a cold one.
 * BK-70 keeps those keys from filling the cache, but nothing limited the places one person could hold in the line, so a script that kept its
 * connections open could make everybody else wait behind it. Each person may now have four waiting or running (BK-75).
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
const { analyticsRoutes } = await import('../routes/analytics.js');
const { reportRoutes } = await import('../routes/reports.js');
const { HEAVY_REPORTS_PER_PERSON, SLI_READS_PER_PERSON, heavyReportGuard, takeHeavyPlace, takeSliPlace } = await import('../security/heavyLimit.js');

let app: FastifyInstance;
/** Zabbix answers nothing until `open()`: a request that reaches it stays in flight. */
let open: () => void;

beforeEach(async () => {
  invalidate('');
  const held = new Promise<void>((resolve) => (open = resolve));
  zbxMock.mockReset().mockImplementation(async () => {
    await held;
    return [];
  });
  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await setupAuth(app);
  await app.register(analyticsRoutes);
  await app.register(reportRoutes);
  await app.ready();
});
afterEach(async () => {
  open();
  await app.close();
});

const as = (sub: string, role: string) => ({
  authorization: `Bearer ${app.jwt.sign({ sub, role, ...tokenClaims(config.auth.sessionCookie) }, { expiresIn: '1h' })}`,
});
const ana = () => as('ana', 'viewer');
const olu = () => as('olu', 'operator');
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};
/** A request started and left waiting; `settle` lets it reach its guard before anything else is asked. */
const start = (url: string, headers: Record<string, string>) => app.inject({ url, headers });
/** The answer if the request was refused or finished at once, else 'waiting'. */
const answerOrWait = (url: string, headers: Record<string, string>) =>
  Promise.race([start(url, headers), new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 250))]);
const noise = (days: number) => `/api/reports/noise?days=${days}`;

describe('the places one person may hold in the line of the heavy reports (BK-75)', () => {
  it('answers four waiting reads and refuses the fifth, saying how many there are and when to ask again', async () => {
    const headers = ana();
    const held = Array.from({ length: HEAVY_REPORTS_PER_PERSON }, (_, i) => start(noise(i + 1), headers));
    await settle();

    const fifth = await answerOrWait(noise(99), headers);
    expect(fifth).not.toBe('waiting');
    if (fifth === 'waiting') return;
    expect(fifth.statusCode).toBe(429);
    expect(fifth.json()).toMatchObject({ error: 'rate_limited' });
    expect(fifth.json().message).toMatch(new RegExp(`${HEAVY_REPORTS_PER_PERSON} reports`));
    expect(fifth.json().message).toMatch(/finish/);
    expect(Number(fifth.headers['retry-after'])).toBeGreaterThanOrEqual(1);

    open();
    for (const r of await Promise.all(held)) expect(r.statusCode).toBe(200);
  });

  it('does not refuse another person while the first holds the most that is allowed', async () => {
    const held = Array.from({ length: HEAVY_REPORTS_PER_PERSON }, (_, i) => start(noise(i + 1), ana()));
    await settle();
    // olu's request is in the line, behind ana's: it is not refused, it waits for Zabbix like the others
    expect(await answerOrWait(noise(50), olu())).toBe('waiting');
    open();
    await Promise.all(held);
  });

  it('gives a place back when a read finishes, so the same person may ask again', async () => {
    const headers = ana();
    const first = start(noise(1), headers);
    const others = Array.from({ length: HEAVY_REPORTS_PER_PERSON - 1 }, (_, i) => start(noise(i + 2), headers));
    await settle();
    expect((await answerOrWait(noise(90), headers)) !== 'waiting').toBe(true);

    open();
    expect((await first).statusCode).toBe(200);
    await Promise.all(others);
    // everything has finished: nothing is held, so four more are accepted
    zbxMock.mockReset().mockResolvedValue([]);
    for (let i = 0; i < HEAVY_REPORTS_PER_PERSON + 2; i++) expect((await start(noise(100 + i), headers)).statusCode, `read ${i + 1}`).toBe(200);
  });

  it('counts the four heavy reports together', async () => {
    const headers = ana();
    const urls = [noise(1), '/api/reports/capacity?days=3', '/api/reports/top-triggers?days=2', '/api/reports/availability?days=5&basis=all-problems'];
    const held = urls.map((u) => start(u, headers));
    await settle();
    for (const url of ['/api/reports/capacity?days=11', '/api/reports/top-triggers?days=12', '/api/reports/availability?days=13', '/api/reports/availability?days=14&basis=all-problems', noise(15)]) {
      const r = await answerOrWait(url, headers);
      expect(r === 'waiting' ? 'waiting' : r.statusCode, url).toBe(429);
    }
    open();
    await Promise.all(held);
  });

  it('does not count a request that is refused for its form, nor a read that is not heavy', async () => {
    const headers = ana();
    // two values of one parameter fail the schema before the guard
    for (let i = 0; i < HEAVY_REPORTS_PER_PERSON + 2; i++) expect((await start('/api/reports/noise?days=1&days=2', headers)).statusCode).toBe(400);
    const held = Array.from({ length: HEAVY_REPORTS_PER_PERSON }, (_, i) => start(noise(i + 1), headers));
    await settle();
    // the aging report is cheap and is not in the line, so it is not refused whatever is waiting
    expect(await answerOrWait('/api/reports/aging', headers)).not.toMatchObject({ statusCode: 429 });
    open();
    await Promise.all(held);
  });

  it('gives back one place for a request that finishes, and no more, whatever events follow', async () => {
    const headers = ana();
    // one finished read, so that the same request is answered from the cache at once later
    zbxMock.mockReset().mockResolvedValue([]);
    expect((await start(noise(1), headers)).statusCode).toBe(200);
    const held = new Promise<void>((resolve) => (open = resolve));
    zbxMock.mockReset().mockImplementation(async () => {
      await held;
      return [];
    });
    const waiting = [2, 3, 4].map((d) => start(noise(d), headers));
    await settle();
    // a cached answer finishes while three are held: it must give back its own place only
    expect((await start(noise(1), headers)).statusCode).toBe(200);
    const fourth = start(noise(5), headers);
    await settle();
    const fifth = await answerOrWait(noise(6), headers);
    expect(fifth === 'waiting' ? 'waiting' : fifth.statusCode).toBe(429);
    open();
    await Promise.all([...waiting, fourth]);
  });

  it('does not hold a place for a connection that has already closed', async () => {
    const closed = { raw: Object.assign(new EventEmitter(), { destroyed: true, writableEnded: false }), code: () => closed, header: () => closed, send: () => closed };
    const req = { user: { sub: 'ana', role: 'viewer' }, ip: '127.0.0.1' };
    for (let i = 0; i < HEAVY_REPORTS_PER_PERSON + 3; i++) {
      expect(await heavyReportGuard(req as never, closed as never), `call ${i + 1}`).toBeUndefined();
    }
    // nothing was left counted, so four real requests are still accepted
    const held = Array.from({ length: HEAVY_REPORTS_PER_PERSON }, (_, i) => start(noise(i + 1), ana()));
    await settle();
    expect(await answerOrWait(noise(99), ana())).toMatchObject({ statusCode: 429 });
    open();
    await Promise.all(held);
  });

  it('gives the place back when the reader leaves', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const headers = ana();
    const aborts = Array.from({ length: HEAVY_REPORTS_PER_PERSON }, () => new AbortController());
    const calls = aborts.map((c, i) => fetch(`${base}${noise(i + 1)}`, { headers, signal: c.signal }).catch((e: Error) => e.name));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await fetch(`${base}${noise(99)}`, { headers })).status).toBe(429);

    for (const c of aborts) c.abort();
    await Promise.all(calls);
    // the server learns of the closed connections a moment later; a probe that is accepted waits for Zabbix, so it is abandoned (status 0)
    let status = 429;
    for (let i = 0; i < 40 && status === 429; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const probe = new AbortController();
      const stop = setTimeout(() => probe.abort(), 100);
      status = await fetch(`${base}${noise(200 + i)}`, { headers, signal: probe.signal }).then((r) => r.status, () => 0);
      clearTimeout(stop);
    }
    expect(status).not.toBe(429);
    open();
  });
});

describe('the places the Assistant takes by name (BK-88)', () => {
  it('gives a person four, refuses a fifth, frees one when it is released once or twice, and counts each person and each line apart', () => {
    const mine = Array.from({ length: HEAVY_REPORTS_PER_PERSON }, () => takeHeavyPlace('assistant:test-a'));
    expect(mine.every((release) => release !== null)).toBe(true);
    expect(takeHeavyPlace('assistant:test-a')).toBeNull();
    expect(takeHeavyPlace('assistant:test-b')).not.toBeNull();
    mine[0]!();
    mine[0]!();
    const again = takeHeavyPlace('assistant:test-a');
    expect(again).not.toBeNull();
    expect(takeHeavyPlace('assistant:test-a')).toBeNull();
    // The line of the SLA reads is another one.
    const sla = Array.from({ length: SLI_READS_PER_PERSON }, () => takeSliPlace('assistant:test-a'));
    expect(sla.every((release) => release !== null)).toBe(true);
    expect(takeSliPlace('assistant:test-a')).toBeNull();
    for (const release of [...mine.slice(1), again, ...sla]) release?.();
    expect(takeHeavyPlace('assistant:test-a')).not.toBeNull();
  });
});
