import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp } from './helpers/app.js';

/** A new `days` or `severity` is a cold read of thousands of SQL statements, so only HEAVY_REPORTS_AT_ONCE run at once and the rest wait; a cached answer never waits. */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

const { analyticsRoutes } = await import('../routes/analytics.js');

const { heavy, HEAVY_REPORTS_AT_ONCE } = await import('../services/reportPolicy.js');

const tick = () => new Promise<void>((r) => setTimeout(r, 20));

/** Zabbix answers nothing until `open()` is called. */
function closedZabbix() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  zbxMock.mockImplementation(async () => {
    await opened;
    return [];
  });
  return open;
}

afterEach(() => zbxMock.mockReset());

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
    const answers = urls.map((url) => app.inject({ url }));
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
    const slow = [51, 52, 53, 54].map((d) => app.inject({ url: `/api/reports/noise?days=${d}` }));
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
