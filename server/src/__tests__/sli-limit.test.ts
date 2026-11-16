import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { sampleSliReports } from './helpers/sliReportFixture.js';

/**
 * A cold month of the derived SLA waits for one of two places (BK-50), so a script that keeps its connections open could make everybody else wait.
 * As for the heavy reports (BK-75), each person may hold four places in that line (BK-76), and a read still waiting when its reader leaves is dropped (BK-59, BK-77).
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer,olu:operator-pass:operator';
});

const { zbxMock, compute } = vi.hoisted(() => ({ zbxMock: vi.fn(), compute: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/zabbix.js')>()),
  zbx: zbxMock,
}));
vi.mock('../sli/engine.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sli/engine.js')>()),
  computeSli: compute,
}));

const { config } = await import('../core/config.js');
const { setupAuth, tokenClaims } = await import('../security/auth.js');
const { registerErrorHandler } = await import('../http/errors.js');
const { invalidate } = await import('../core/cache.js');
const { sliRoutes } = await import('../routes/sli.js');
const { sliExportRoutes } = await import('../routes/sliExport.js');
const { serviceRoutes } = await import('../routes/services.js');
const { analyticsRoutes } = await import('../routes/analytics.js');
const { SLI_READS_PER_PERSON, sliExportGuard, sliReadGuard } = await import('../security/heavyLimit.js');
const { getMonthlySli } = await import('../services/sli.js');
const { getDerivedServices } = await import('../sli/tree.js');
const { Cancelled } = await import('../core/gate.js');

let app: FastifyInstance;
/** The month reads end only when `open()` is called: a request that reaches one stays in flight. */
let open: () => void;
/** Zabbix answers at once unless a test holds it. */
let holdZabbix: Promise<void> | null;

/** A fresh hold: every read of a month waits until `open()`, then answers with the sample report of its method. */
function hold() {
  const held = new Promise<void>((resolve) => (open = resolve));
  compute.mockReset().mockImplementation(async (req: { profile: string }) => {
    await held;
    const { strict, hcml } = sampleSliReports();
    return req.profile === 'hcml-report' ? hcml : strict;
  });
}

/** The YYYY-MM of `n` months ago: a month that has started and is not past the year the SLA reports reach back (BK-50). */
const monthsBack = (n: number) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
};

beforeEach(async () => {
  invalidate('');
  holdZabbix = null;
  hold();
  zbxMock.mockReset().mockImplementation(async () => {
    await holdZabbix;
    return [];
  });
  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await setupAuth(app);
  await app.register(sliRoutes);
  await app.register(sliExportRoutes);
  await app.register(serviceRoutes);
  await app.register(analyticsRoutes);
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
const status = (r: Awaited<ReturnType<typeof answerOrWait>>) => (r === 'waiting' ? 'waiting' : r.statusCode);

/** A cold month in one method, the month's report file (both methods), and the derived service tree, each for month number `n`. */
const sli = (n: number, profile = 'availability') => `/api/sli?month=${monthsBack(n)}&profile=${profile}`;
const file = (n: number) => `/api/sli/export?month=${monthsBack(n)}&format=csv`;
const tree = (n: number) => `/api/services/derived?month=${monthsBack(n)}&profile=availability`;
const noise = (days: number) => `/api/reports/noise?days=${days}`;

/** What a reader's promise did within a quarter of a second: answered, was dropped (Cancelled), failed, or is still waiting. */
const outcome = (p: Promise<unknown>) =>
  Promise.race([
    p.then(() => 'answered', (e: unknown) => (e instanceof Cancelled ? 'cancelled' : 'failed')),
    new Promise<string>((resolve) => setTimeout(() => resolve('waiting'), 250)),
  ]);
/** The months and methods that the stand-in has been asked to compute so far. */
const computed = () => compute.mock.calls.map((c) => `${(c[0] as { month: string }).month}/${(c[0] as { profile: string }).profile}`);
/** Two reads of other months that hold both places of the gate until `open()`; the next read has to wait. */
const holdTheGate = () => [getMonthlySli(monthsBack(8), 'availability'), getMonthlySli(monthsBack(7), 'availability')];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the places one person may hold in the line of the derived SLA reads (BK-76)', () => {
  it('is four: two pages of both methods, or one page and a report file', () => {
    expect(SLI_READS_PER_PERSON).toBe(4);
  });

  it('answers four waiting reads and refuses the fifth, saying what to do and when to ask again', async () => {
    const headers = ana();
    const held = [1, 2, 3, 4].map((n) => start(sli(n), headers));
    await settle();

    const fifth = await answerOrWait(sli(5), headers);
    expect(fifth).not.toBe('waiting');
    if (fifth === 'waiting') return;
    expect(fifth.statusCode).toBe(429);
    expect(fifth.json()).toMatchObject({ error: 'rate_limited' });
    expect(fifth.json().message).toMatch(/monthly SLA reads/);
    expect(fifth.json().message).toMatch(new RegExp(`${SLI_READS_PER_PERSON} at most`));
    expect(fifth.json().message).toMatch(/finish/);
    expect(Number(fifth.headers['retry-after'])).toBeGreaterThanOrEqual(1);

    open();
    for (const r of await Promise.all(held)) expect(r.statusCode).toBe(200);
  });

  it('does not refuse another person while the first holds the most that is allowed', async () => {
    const held = [1, 2, 3, 4].map((n) => start(sli(n), ana()));
    await settle();
    // olu's request is in the line behind ana's: it is not refused, it waits like the others
    expect(await answerOrWait(sli(5), olu())).toBe('waiting');
    open();
    await Promise.all(held);
  });

  it('gives a place back when a read finishes, so the same person may ask again', async () => {
    const headers = ana();
    const first = start(sli(1), headers);
    const others = [2, 3, 4].map((n) => start(sli(n), headers));
    await settle();
    expect(status(await answerOrWait(sli(9), headers))).toBe(429);

    open();
    expect((await first).statusCode).toBe(200);
    await Promise.all(others);
    // everything has finished: nothing is held, so more than four in turn are accepted
    for (let n = 1; n <= SLI_READS_PER_PERSON + 2; n++) expect((await start(sli(n, 'hcml-report'), headers)).statusCode, `read ${n}`).toBe(200);
  });

  it('counts the month, its report file and the service tree in one line', async () => {
    const headers = ana();
    const held = [start(sli(1), headers), start(sli(2, 'hcml-report'), headers), start(tree(3), headers), start(sli(4), headers)];
    await settle();
    for (const url of [sli(5), tree(6), file(7)]) expect(status(await answerOrWait(url, headers)), url).toBe(429);
    open();
    await Promise.all(held);
  });

  it('takes two places for the report file, which reads both methods', async () => {
    const headers = ana();
    const held = [start(sli(1), headers), start(sli(2, 'hcml-report'), headers), start(tree(3), headers)];
    await settle();
    // three held: a file needs two more and is refused, while one more read of a month fits
    expect(status(await answerOrWait(file(4), headers))).toBe(429);
    const fourth = start(sli(5), headers);
    await settle();
    expect(status(await answerOrWait(sli(6), headers))).toBe(429);
    open();
    await Promise.all([...held, fourth]);
  });

  it('allows two report files at once and refuses a third', async () => {
    const headers = ana();
    const held = [start(file(1), headers), start(file(2), headers)];
    await settle();
    expect(status(await answerOrWait(file(3), headers))).toBe(429);
    open();
    for (const r of await Promise.all(held)) expect(r.statusCode).toBe(200);
  });

  it('answers the service tree for one person and counts it as one place', async () => {
    const headers = ana();
    const held = [1, 2, 3, 4].map((n) => start(tree(n), headers));
    await settle();
    expect(status(await answerOrWait(tree(5), headers))).toBe(429);
    open();
    for (const r of await Promise.all(held)) expect(r.statusCode).toBe(200);
  });

  it('does not count a request refused for its form, nor one the route refuses at once', async () => {
    const headers = ana();
    // two values of one parameter fail the schema before the guard
    for (let i = 0; i < SLI_READS_PER_PERSON + 2; i++) expect((await start('/api/sli?month=2026-01&month=2026-02', headers)).statusCode).toBe(400);
    for (let i = 0; i < SLI_READS_PER_PERSON + 2; i++) expect((await start('/api/sli/export?format=csv&format=pdf', headers)).statusCode).toBe(400);
    // a month that has not started is refused by the route itself, and its place is given back at once
    for (let i = 0; i < SLI_READS_PER_PERSON + 2; i++) expect((await start('/api/sli?month=2099-01', headers)).statusCode).toBe(400);
    const held = [1, 2, 3, 4].map((n) => start(sli(n), headers));
    await settle();
    // the configured service tree is not in the line, so it is not refused whatever is waiting
    expect(status(await answerOrWait('/api/services', headers))).not.toBe(429);
    // a form that is wrong is told so, whatever the person holds: the guard comes after the schema
    expect(status(await answerOrWait('/api/sli?month=2026-01&month=2026-02', headers))).toBe(400);
    expect(status(await answerOrWait('/api/sli/export?format=csv&format=pdf', headers))).toBe(400);
    expect(status(await answerOrWait('/api/services/derived?month=2026-01&month=2026-02', headers))).toBe(400);
    open();
    await Promise.all(held);
  });

  it('gives back one place for a request that finishes, and no more, whatever events follow', async () => {
    const headers = ana();
    // one finished read, so that the same request is answered from the cache at once later
    open();
    expect((await start(sli(1), headers)).statusCode).toBe(200);
    hold();
    const waiting = [2, 3, 4].map((n) => start(sli(n), headers));
    await settle();
    // a cached answer finishes while three are held: it must give back its own place only
    expect((await start(sli(1), headers)).statusCode).toBe(200);
    const fourth = start(sli(5), headers);
    await settle();
    expect(status(await answerOrWait(sli(6), headers))).toBe(429);
    open();
    await Promise.all([...waiting, fourth]);
  });

  it('keeps this line apart from the heavy reports, in both directions', async () => {
    const headers = ana();
    // four heavy reports held at Zabbix do not use up the places for month reads
    let release!: () => void;
    holdZabbix = new Promise<void>((resolve) => (release = resolve));
    const heavy = [1, 2, 3, 4].map((d) => start(noise(d), headers));
    await settle();
    expect(status(await answerOrWait(sli(1), headers))).toBe('waiting');
    release();
    holdZabbix = null;
    await Promise.all(heavy);

    // and four month reads held do not use up the places for heavy reports
    const months = [2, 3, 4, 5].map((n) => start(sli(n), headers));
    await settle();
    expect(status(await answerOrWait(sli(6), headers))).toBe(429);
    expect(status(await answerOrWait(noise(99), headers))).toBe(200);
    open();
    await Promise.all(months);
  });

  it('does not hold a place for a connection that has already closed', async () => {
    const closed = { raw: Object.assign(new EventEmitter(), { destroyed: true, writableEnded: false }), code: () => closed, header: () => closed, send: () => closed };
    const req = { user: { sub: 'ana', role: 'viewer' }, ip: '127.0.0.1' };
    for (let i = 0; i < SLI_READS_PER_PERSON + 3; i++) {
      expect(await sliReadGuard(req as never, closed as never), `read ${i + 1}`).toBeUndefined();
      expect(await sliExportGuard(req as never, closed as never), `file ${i + 1}`).toBeUndefined();
    }
    // nothing was left counted, so four real requests are still accepted
    const held = [1, 2, 3, 4].map((n) => start(sli(n), ana()));
    await settle();
    expect(status(await answerOrWait(sli(9), ana()))).toBe(429);
    open();
    await Promise.all(held);
  });

  it('counts a closed connection once, even when its close event comes after the guard saw it closed', async () => {
    const headers = ana();
    const first = start(sli(1), headers);
    await settle();
    const raw = Object.assign(new EventEmitter(), { destroyed: true, writableEnded: false });
    const closed = { raw, code: () => closed, header: () => closed, send: () => closed };
    const req = { user: { sub: 'ana', role: 'viewer' }, ip: '127.0.0.1' };
    expect(await sliReadGuard(req as never, closed as never)).toBeUndefined();
    raw.emit('close');
    // the first request still holds its place: three more fit, and the fifth is refused
    const more = [2, 3, 4].map((n) => start(sli(n), headers));
    await settle();
    expect(status(await answerOrWait(sli(5), headers))).toBe(429);
    open();
    await Promise.all([first, ...more]);
  });

  it('gives the places back when the reader leaves', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const headers = ana();
    const aborts = [1, 2].map(() => new AbortController());
    const calls = [
      fetch(`${base}${file(1)}`, { headers, signal: aborts[0]!.signal }).catch((e: Error) => e.name),
      fetch(`${base}${file(2)}`, { headers, signal: aborts[1]!.signal }).catch((e: Error) => e.name),
    ];
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await fetch(`${base}${sli(3)}`, { headers })).status).toBe(429);

    for (const c of aborts) c.abort();
    await Promise.all(calls);
    // the server learns of the closed connections a moment later; a probe that is accepted waits for its read, so it is abandoned (status 0)
    let result = 429;
    for (let i = 0; i < 40 && result === 429; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const probe = new AbortController();
      const stop = setTimeout(() => probe.abort(), 100);
      result = await fetch(`${base}${sli(4 + (i % 7))}`, { headers, signal: probe.signal }).then((r) => r.status, () => 0);
      clearTimeout(stop);
    }
    expect(result).not.toBe(429);
    open();
    // fetch keeps its sockets open, and closing the server would wait for them for seconds
    app.server.closeAllConnections();
  });
});

describe('a reader who leaves while the service tree or the report file waits for a place (BK-77)', () => {
  const held = () => [`${monthsBack(8)}/availability`, `${monthsBack(7)}/availability`];

  it('drops the read of a service tree that nobody waits for any more', async () => {
    const holders = holdTheGate();
    const leaving = new AbortController();
    const dropped = getDerivedServices(monthsBack(6), 'availability', leaving.signal);
    await settle();
    expect(computed()).toEqual(held());
    leaving.abort();
    expect(await outcome(dropped)).toBe('cancelled');
    open();
    await Promise.all(holders);
    await settle();
    expect(computed()).toEqual(held());
  });

  it('still reads the month for the reader of a tree who stays when another left', async () => {
    const holders = holdTheGate();
    const leaving = new AbortController();
    const left = getDerivedServices(monthsBack(6), 'availability', leaving.signal);
    const stays = getDerivedServices(monthsBack(6), 'availability');
    left.catch(() => undefined);
    await settle();
    leaving.abort();
    expect(await outcome(left)).toBe('cancelled');
    open();
    await Promise.all(holders);
    expect((await stays).month).toBe(monthsBack(6));
    expect(computed()).toContain(`${monthsBack(6)}/availability`);
  });

  it('answers a tree for a reader who stays', async () => {
    const stays = new AbortController();
    open();
    expect((await getDerivedServices(monthsBack(6), 'availability', stays.signal)).month).toBe(monthsBack(6));
  });

  it('drops the two reads of a report file whose reader left', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const holders = holdTheGate();
    const abort = new AbortController();
    const call = fetch(`${base}${file(6)}`, { headers: ana(), signal: abort.signal }).catch((e: Error) => e.name);
    await pause(200);
    expect(computed()).toEqual(held());
    abort.abort();
    await call;
    await pause(150);
    open();
    await Promise.all(holders);
    await settle();
    expect(computed().filter((c) => c.startsWith(monthsBack(6)))).toEqual([]);
    // fetch keeps its sockets open, and closing the server would wait for them for seconds
    app.server.closeAllConnections();
  });

  it('drops the read of a service tree whose reader left', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const holders = holdTheGate();
    const abort = new AbortController();
    const call = fetch(`${base}${tree(6)}`, { headers: ana(), signal: abort.signal }).catch((e: Error) => e.name);
    await pause(200);
    expect(computed()).toEqual(held());
    abort.abort();
    await call;
    await pause(150);
    open();
    await Promise.all(holders);
    await settle();
    expect(computed().filter((c) => c.startsWith(monthsBack(6)))).toEqual([]);
    app.server.closeAllConnections();
  });

  it('still reads both methods for a report file whose reader stays', async () => {
    const holders = holdTheGate();
    const stays = start(file(6), ana());
    await settle();
    open();
    await Promise.all(holders);
    expect((await stays).statusCode).toBe(200);
    expect(computed()).toEqual(expect.arrayContaining([`${monthsBack(6)}/availability`, `${monthsBack(6)}/hcml-report`]));
  });
});
