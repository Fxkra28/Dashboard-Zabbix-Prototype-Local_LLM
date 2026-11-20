import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetMonthlySli } from '../services/sli.js';
import { sliRoutes } from '../routes/sli.js';
import { buildTestApp } from './helpers/app.js';
import { buildEstate, NOW_ISO, serveFixture, wib } from './helpers/sliEstate.js';

/** GET /api/sli for a range, and for a month in chosen hours (ADR-0018): what it answers, what it refuses, and what it costs Zabbix. */

const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

const estate = buildEstate();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
  serveFixture(zbxMock, estate);
});
afterEach(() => {
  vi.useRealTimers();
  zbxMock.mockReset();
});

/** One portal for a test, so that what one request reads is there for the next (a new test app starts with an empty cache). */
let app: Awaited<ReturnType<typeof buildTestApp>>;
beforeEach(async () => {
  app = await buildTestApp(sliRoutes);
});
afterEach(async () => {
  await app.close();
});

const get = (query: string) => app.inject({ method: 'GET', url: `/api/sli?${query}` });

describe('GET /api/sli for a range', () => {
  const RANGE = `from=${wib('2026-06-10 00:00')}&to=${wib('2026-08-20 00:00')}&profile=availability`;

  it('answers a window across months with no web checks and no month', async () => {
    const res = await get(RANGE);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ source: 'derived', month: null, web: [], from: wib('2026-06-10 00:00'), to: wib('2026-08-20 00:00'), closed: true });
    expect(body.hosts).toHaveLength(11);
    expect(body.dailyHours).toBeUndefined();
    expect(body.stats.zabbixCalls).toBeGreaterThan(20);
  });

  it('reads each month once: other hours, the other method on the same months and a second ask cost nothing more for the first method', async () => {
    await get(RANGE);
    const calls = zbxMock.mock.calls.length;
    const again = await get(`${RANGE}&dayHours=8-17&days=1,2,3,4,5`);
    expect(again.statusCode).toBe(200);
    expect(zbxMock.mock.calls.length).toBe(calls);
    const plain = (await get(RANGE)).json();
    const hours = again.json();
    expect(hours.dailyHours).toEqual({ start: 8, end: 17, weekdays: [1, 2, 3, 4, 5], seconds: expect.any(Number) });
    expect(hours.hosts[0].window).toBeLessThan(plain.hosts[0].window);
    expect(zbxMock.mock.calls.length).toBe(calls);
  });

  it('reads a month again once it is forgotten', async () => {
    await get(RANGE);
    const calls = zbxMock.mock.calls.length;
    forgetMonthlySli('2026-07');
    await get(RANGE);
    expect(zbxMock.mock.calls.length).toBeGreaterThan(calls);
    // One month's read, not three.
    expect(zbxMock.mock.calls.length - calls).toBeLessThan(calls / 2);
  });

  it('answers a month in chosen hours as that month, in the hours', async () => {
    const res = await get('month=2026-08&profile=hcml-report&dayHours=22-6');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ month: '2026-08', web: [], dailyHours: { start: 22, end: 6, weekdays: null } });
  });

  it('leaves the monthly report as it was when nothing is asked of the hours', async () => {
    const res = await get('month=2026-08&profile=availability');
    expect(res.statusCode).toBe(200);
    expect(res.json().month).toBe('2026-08');
    expect(res.json().web).toHaveLength(2);
    expect(res.json().dailyHours).toBeUndefined();
  });

  it('refuses what cannot be answered, in plain words', async () => {
    const ok = `from=${wib('2026-08-03 00:00')}&to=${wib('2026-08-04 00:00')}`;
    const cases: [string, number, RegExp][] = [
      [`from=${wib('2026-08-03 00:00')}`, 400, /from and to|must be a time/],
      [`to=${wib('2026-08-03 00:00')}`, 400, /must be a time/],
      ['from=abc&to=def', 400, /must be a time/],
      [`month=2026-08&${ok}`, 400, /not both/],
      [`${ok}&dayHours=9-9`, 400, /different hours/],
      [`${ok}&dayHours=8:00-17:00`, 400, /dayHours/],
      [`${ok}&dayHours=8-17&days=8`, 400, /days/],
      [`from=${wib('2026-08-03 00:30')}&to=${wib('2026-08-04 00:00')}`, 400, /whole hours/],
      [`from=${wib('2026-08-04 00:00')}&to=${wib('2026-08-03 00:00')}`, 400, /before/],
      [`from=${wib('2026-01-01 00:00')}&to=${wib('2027-01-03 00:00')}`, 400, /at most 366 days/],
      [`from=${wib('2026-09-18 00:00')}&to=${wib('2026-09-19 00:00')}`, 400, /not started/],
      [`from=${wib('2025-03-01 00:00')}&to=${wib('2025-03-02 00:00')}`, 400, /about a year/],
      // The window starts within the 400 days, but the month it starts in began before them, so Zabbix may no longer hold all of it.
      [`from=${wib('2025-08-20 00:00')}&to=${wib('2025-08-21 00:00')}`, 400, /about a year/],
      // A Saturday has no weekday hours.
      [`from=${wib('2026-08-08 00:00')}&to=${wib('2026-08-09 00:00')}&dayHours=8-17&days=1,2,3,4,5`, 400, /No hour of this range/],
    ];
    for (const [query, status, message] of cases) {
      const res = await get(`${query}&profile=availability`);
      expect(res.statusCode, query).toBe(status);
      expect(res.json().message, query).toMatch(message);
    }
    expect(zbxMock).not.toHaveBeenCalled();
  });

  it('answers a window in a month that began within the 400 days', async () => {
    // 20 October 2025 is 332 days back, and October began 351 days back: both are within the 400 days.
    const res = await get(`from=${wib('2025-10-20 00:00')}&to=${wib('2025-10-21 00:00')}&profile=hcml-report`);
    expect(res.statusCode).toBe(200);
  });
});
