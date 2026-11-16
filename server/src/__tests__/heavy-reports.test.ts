import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp } from './helpers/app.js';
import { severitiesAtLeast } from '../services/incidents.js';

/** A new `days` or `severity` is a cold read of thousands of SQL statements, so only HEAVY_REPORTS_AT_ONCE run at once and the rest wait; a cached answer never waits. */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

// The signal each slow route made for its reader, in the order the requests arrived: a test can then wait until the server has seen a reader leave.
const { signals } = vi.hoisted(() => ({ signals: [] as AbortSignal[] }));
vi.mock('../core/readerGone.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/readerGone.js')>();
  return {
    ...actual,
    readerGone: (reply: Parameters<typeof actual.readerGone>[0]) => {
      const signal = actual.readerGone(reply);
      signals.push(signal);
      return signal;
    },
  };
});

const { analyticsRoutes } = await import('../routes/analytics.js');
const { sliRoutes } = await import('../routes/sli.js');
const { reportRoutes } = await import('../routes/reports.js');

const { heavy, sliReads, HEAVY_REPORTS_AT_ONCE } = await import('../services/reportPolicy.js');

const tick = () => new Promise<void>((r) => setTimeout(r, 20));

/** The `open` of every closedZabbix of the test, so that a test that fails before calling it does not leave the gates held for the next. */
const held: Array<() => void> = [];

/** Zabbix answers nothing until `open()` is called. */
function closedZabbix() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  held.push(() => open());
  zbxMock.mockImplementation(async () => {
    await opened;
    return [];
  });
  return open;
}

afterEach(async () => {
  for (const open of held.splice(0)) open();
  await vi.waitFor(() => expect(heavy.running + heavy.waiting + sliReads.running + sliReads.waiting).toBe(0), { timeout: 5000, interval: 10 }).catch(() => undefined);
  zbxMock.mockReset();
  vi.restoreAllMocks();
  signals.length = 0;
});

describe('heavy reports', () => {
  it('lets two cold reports read Zabbix at once and holds the rest, whichever report they are', async () => {
    expect(HEAVY_REPORTS_AT_ONCE).toBe(2);
    const open = closedZabbix();
    const app = await buildTestApp(analyticsRoutes);
    const urls = [
      '/api/reports/noise?days=40',
      '/api/reports/noise?days=41',
      '/api/reports/capacity?days=42',
      '/api/reports/availability?days=43&basis=all-problems',
      '/api/reports/availability?days=44',
    ];
    // five people: the gate is what is tested here, not what one person may hold (BK-75)
    const answers = urls.map((url, i) => app.inject({ url, remoteAddress: `10.0.0.${i + 1}` }));
    await tick();
    expect(heavy.running).toBe(2);
    expect(heavy.waiting).toBe(3);

    open();
    const done = await Promise.all(answers);
    expect(done.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(heavy.running).toBe(0);
    expect(heavy.waiting).toBe(0);
    await app.close();
  });

  it('does not make the same report wait twice: concurrent asks for one query share one read', async () => {
    const open = closedZabbix();
    const app = await buildTestApp(analyticsRoutes);
    const answers = [1, 2, 3, 4].map(() => app.inject({ url: '/api/reports/noise?days=33' }));
    await tick();
    expect(heavy.running).toBe(1);
    expect(heavy.waiting).toBe(0);
    open();
    expect((await Promise.all(answers)).map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
    await app.close();
  });

  it('answers an already cached report at once while the gate is full', async () => {
    zbxMock.mockImplementation(async () => []);
    const app = await buildTestApp(analyticsRoutes);
    expect((await app.inject({ url: '/api/reports/noise?days=50' })).statusCode).toBe(200);
    const callsAfterFirst = zbxMock.mock.calls.length;

    const open = closedZabbix();
    const slow = [51, 52, 53, 54].map((d) => app.inject({ url: `/api/reports/noise?days=${d}`, remoteAddress: `10.0.1.${d}` }));
    await tick();
    expect(heavy.waiting).toBe(2);
    const callsBefore = zbxMock.mock.calls.length;
    expect(callsBefore).toBeGreaterThan(callsAfterFirst); // the two running reports have started reading
    const cached = await app.inject({ url: '/api/reports/noise?days=50' });
    expect(cached.statusCode).toBe(200);
    expect(zbxMock.mock.calls.length).toBe(callsBefore); // and the cached answer read nothing
    open();
    await Promise.all(slow);
    await app.close();
  });
});

describe('a window asked for with another severity floor (BK-58)', () => {
  it('says the floor each ask named and reads Zabbix once, since the figures do not depend on it', async () => {
    zbxMock.mockImplementation(async () => []);
    const app = await buildTestApp(analyticsRoutes);
    const first = (await app.inject({ url: '/api/reports/availability?days=17&severity=2' })).json();
    const callsAfterFirst = zbxMock.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = (await app.inject({ url: '/api/reports/availability?days=17&severity=5' })).json();
    expect(first.minSeverity).toBe(2);
    expect(second.minSeverity).toBe(5);
    expect(zbxMock.mock.calls.length).toBe(callsAfterFirst);
    expect({ ...second, minSeverity: 2 }).toEqual(first);

    // The first floor again: still its own, not the last one asked.
    expect((await app.inject({ url: '/api/reports/availability?days=17&severity=2' })).json().minSeverity).toBe(2);
    await app.close();
  });
});

/** The Zabbix calls of a noise read that carry this floor: its event query names `severities`. */
const callsWithFloor = (floor: number) =>
  zbxMock.mock.calls.filter(([, params]) => JSON.stringify((params as { severities?: number[] } | undefined)?.severities) === JSON.stringify(severitiesAtLeast(floor))).length;

/** A real listening socket: an injected request cannot close its connection the way a browser that moved on does. */
async function serve(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

/** Close the keep-alive connections of the test's own client first, or `close` waits for them to time out. */
async function shut(app: FastifyInstance): Promise<void> {
  app.server.closeAllConnections();
  await app.close();
}

/** Wait for a condition, not for a time: how long a request takes to arrive depends on the load of the machine. */
const until = (check: () => void) => vi.waitFor(check, { timeout: 8000, interval: 10 });
/** Until the server has seen the reader of the n-th request leave. */
const left = (n: number) => until(() => expect(signals[n]?.aborted).toBe(true));

describe('a reader who leaves (BK-59)', () => {
  const read = (base: string, severity: number, signal?: AbortSignal) => fetch(`${base}/api/reports/noise?days=61&severity=${severity}`, { signal });

  it('does not start the read it was waiting for, and the reads behind it still run', async () => {
    const open = closedZabbix();
    const app = await buildTestApp(analyticsRoutes);
    const base = await serve(app);
    const a = read(base, 0);
    const b = read(base, 1);
    await until(() => expect(heavy.running).toBe(2));
    const leaving = new AbortController();
    const c = read(base, 5, leaving.signal).catch((e: unknown) => e);
    await until(() => expect(heavy.waiting).toBe(1));
    const d = read(base, 4);
    await until(() => expect(heavy.waiting).toBe(2));

    leaving.abort();
    expect(await c).toBeInstanceOf(Error);
    await left(2);
    open();
    expect([(await a).status, (await b).status, (await d).status]).toEqual([200, 200, 200]);
    expect(callsWithFloor(5)).toBe(0);
    expect(callsWithFloor(4)).toBeGreaterThan(0);
    expect(heavy.running).toBe(0);
    expect(heavy.waiting).toBe(0);
    await shut(app);
  });

  it('still reads for a second reader of the same report when the first one leaves', async () => {
    const open = closedZabbix();
    const app = await buildTestApp(analyticsRoutes);
    const base = await serve(app);
    const a = read(base, 0);
    const b = read(base, 1);
    await until(() => expect(heavy.running).toBe(2));
    const leaving = new AbortController();
    const first = read(base, 5, leaving.signal).catch((e: unknown) => e);
    await until(() => expect(heavy.waiting).toBe(1));
    const second = read(base, 5);
    await until(() => expect(signals).toHaveLength(4));

    leaving.abort();
    await first;
    await left(2);
    open();
    expect((await second).status).toBe(200);
    expect(callsWithFloor(5)).toBeGreaterThan(0);
    await Promise.all([a, b]);
    await shut(app);
  });

  it('lets a read that has started finish, so the next reader finds it already cached', async () => {
    const open = closedZabbix();
    const app = await buildTestApp(analyticsRoutes);
    const base = await serve(app);
    const leaving = new AbortController();
    const first = read(base, 3, leaving.signal).catch((e: unknown) => e);
    await until(() => expect(heavy.running).toBe(1));

    leaving.abort();
    await first;
    await left(0);
    open();
    await until(() => expect(heavy.running).toBe(0));
    const calls = zbxMock.mock.calls.length;
    expect((await read(base, 3)).status).toBe(200);
    expect(zbxMock.mock.calls.length).toBe(calls);
    await shut(app);
  });

  it('answers a reader who stays as before, with nothing dropped', async () => {
    zbxMock.mockImplementation(async () => []);
    const app = await buildTestApp(analyticsRoutes);
    const base = await serve(app);
    const answers = await Promise.all([0, 1, 2, 3].map((severity) => read(base, severity)));
    expect(answers.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    await shut(app);
  });
});

/** The YYYY-MM of `n` months ago: a month that has started, so the SLA page can be asked for it. */
const monthsBack = (n: number) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
};

/** Every route that waits for a place at a gate, each with four different asks, so that none is answered from another's cache. */
const FAMILIES: Array<[string, 'heavy' | 'sliReads', (n: number) => string]> = [
  ['the noise report', 'heavy', (n) => `/api/reports/noise?days=70&severity=${n}`],
  ['the capacity report', 'heavy', (n) => `/api/reports/capacity?days=${70 + n}&top=5`],
  ['the top triggers report (BK-61)', 'heavy', (n) => `/api/reports/top-triggers?days=${70 + n}`],
  ['a derived window', 'heavy', (n) => `/api/reports/availability?days=${70 + n}`],
  ['an any-problem window', 'heavy', (n) => `/api/reports/availability?basis=all-problems&days=${70 + n}&severity=2`],
  ['an any-problem month', 'heavy', (n) => `/api/reports/availability?basis=all-problems&month=${monthsBack(n)}&severity=2`],
  ['a derived month through the availability route', 'sliReads', (n) => `/api/reports/availability?month=${monthsBack(n)}`],
  ['the SLA page’s month', 'sliReads', (n) => `/api/sli?month=${monthsBack(n)}&profile=availability`],
];

describe('every slow route drops the read of a reader who left (BK-59)', () => {
  it.each(FAMILIES)('%s: the read behind two running ones is never started when its reader leaves, and the one after it is', async (_name, which, url) => {
    const gate = which === 'heavy' ? heavy : sliReads;
    const real = gate.run.bind(gate);
    const started: number[] = [];
    vi.spyOn(gate, 'run').mockImplementation((job, opts) =>
      real(() => {
        started.push(started.length);
        return job();
      }, opts),
    );
    const open = closedZabbix();
    const app = await buildTestApp(analyticsRoutes, sliRoutes, reportRoutes);
    const base = await serve(app);
    const get = (n: number, signal?: AbortSignal) => fetch(`${base}${url(n)}`, { signal });

    const a = get(1);
    const b = get(2);
    await until(() => expect(started).toHaveLength(2));
    const leaving = new AbortController();
    const c = get(3, leaving.signal).catch((e: unknown) => e);
    await until(() => expect(gate.waiting).toBe(1));
    const d = get(4);
    await until(() => expect(gate.waiting).toBe(2));

    leaving.abort();
    await c;
    await left(2);
    open();
    expect([(await a).status, (await b).status, (await d).status]).toEqual([200, 200, 200]);
    expect(started).toHaveLength(3);
    expect(gate.running).toBe(0);
    expect(gate.waiting).toBe(0);
    await shut(app);
  });
});
