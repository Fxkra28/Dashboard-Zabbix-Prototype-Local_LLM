import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SliProfile } from '../core/config.js';
import { computeSli, readSliData, type SliReport } from '../sli/engine.js';
import { evaluateSli, sliDataBytes, type SliData } from '../sli/evaluate.js';
import { totalSeconds } from '../sli/intervals.js';
import { monthBounds } from '../sli/time.js';
import { checkWindow, dailySpans, monthsTouched, parseDailyHours } from '../sli/window.js';
import { buildEstate, MONTHS, NOW, NOW_ISO, serveFixture, TZ, wib, type Fixture } from './helpers/sliEstate.js';

/**
 * Any window from the months read once (ADR-0018): a window made of months that were read apart must come out as the engine's own answer for the window read at
 * once; daily hours keep exactly the hours they name; and the pieces of a window add up to the window.
 */

const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

const estate = buildEstate();
const PROFILES: SliProfile[] = ['availability', 'hcml-report'];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
});
afterEach(async () => {
  vi.useRealTimers();
  zbxMock.mockReset();
  (await import('../core/config.js')).config.sla.noDataWindows = [];
});

const monthData = (profile: SliProfile, month: string): Promise<SliData> => {
  const { from, to } = monthBounds(month, TZ);
  return readSliData({ profile, from, to, now: NOW });
};

/** The months a window touches, read apart, and evaluated together. */
async function stitched(profile: SliProfile, from: number, to: number, hours: Parameters<typeof evaluateSli>[1]['hours'] = null) {
  const months = monthsTouched(from, Math.min(to, NOW), TZ);
  const datas = await Promise.all(months.map((m) => monthData(profile, m)));
  return evaluateSli(datas, { from, to, hours });
}

/** What a window says, without what only reading it adds. */
const figures = (r: Pick<SliReport, 'hosts' | 'overall' | 'categories' | 'sites' | 'classes' | 'wanPaths' | 'gaps' | 'noDataWindows' | 'end' | 'closed' | 'from' | 'to' | 'basis'>) =>
  JSON.parse(JSON.stringify({ hosts: r.hosts, overall: r.overall, categories: r.categories, sites: r.sites, classes: r.classes, wanPaths: r.wanPaths, gaps: r.gaps, noDataWindows: r.noDataWindows, end: r.end, closed: r.closed, from: r.from, to: r.to, basis: r.basis }));

describe('months read apart come out as the window read at once', () => {
  const WINDOWS: [string, number, number][] = [
    ['across three months', wib('2026-06-10 00:00'), wib('2026-08-20 00:00')],
    ['inside one month', wib('2026-08-10 00:00'), wib('2026-08-20 00:00')],
    ['across a month end, with the outages that cross it', wib('2026-07-31 12:00'), wib('2026-08-01 12:00')],
    ['across the end of August into the month still running', wib('2026-08-25 00:00'), wib('2026-09-20 00:00')],
    ['from the first of June to the end of the data', MONTHS.jun.from, wib('2026-12-31 00:00')],
    ['a day', wib('2026-07-14 00:00'), wib('2026-07-15 00:00')],
  ];
  for (const profile of PROFILES) {
    for (const [name, from, to] of WINDOWS) {
      it(`${name}, ${profile}`, async () => {
        serveFixture(zbxMock, estate);
        const direct = await computeSli({ profile, from, to });
        const joined = await stitched(profile, from, to);
        expect(figures(joined)).toEqual(figures(direct));
      });
    }
  }
});

describe('a range is one pass, not the sum of its months', () => {
  const [from, to] = [MONTHS.jun.from, MONTHS.aug.to];

  it('strict: the seconds add up to the months, and an outage across a month end is one incident', async () => {
    serveFixture(zbxMock, estate);
    const whole = await stitched('availability', from, to);
    const parts = await Promise.all([MONTHS.jun, MONTHS.jul, MONTHS.aug].map(async (m) => stitched('availability', m.from, m.to)));
    for (const host of whole.hosts) {
      const months = parts.map((p) => p.hosts.find((h) => h.hostid === host.hostid)!);
      expect(host.downtime).toBe(months.reduce((n, h) => n + h.downtime, 0));
      expect(host.covered).toBe(months.reduce((n, h) => n + h.covered, 0));
      expect(host.incidents).toBeLessThanOrEqual(months.reduce((n, h) => n + h.incidents, 0));
    }
    // Host 101 is down from 22:00 on 31 July to 03:00 on 1 August: counted in both months, once in the range.
    const sw = (r: typeof whole) => r.hosts.find((h) => h.hostid === '101')!;
    expect(sw(whole).incidents).toBe(parts.reduce((n, p) => n + sw(p).incidents, 0) - 1);
  });

  it('HCML: a range is at most one second more for each month end that an outage crosses, because a month report clips its last one', async () => {
    serveFixture(zbxMock, estate);
    const whole = await stitched('hcml-report', from, to);
    const parts = await Promise.all([MONTHS.jun, MONTHS.jul, MONTHS.aug].map(async (m) => stitched('hcml-report', m.from, m.to)));
    for (const host of whole.hosts) {
      const sum = parts.reduce((n, p) => n + p.hosts.find((h) => h.hostid === host.hostid)!.downtime, 0);
      expect(host.downtime - sum).toBeGreaterThanOrEqual(0);
      expect(host.downtime - sum).toBeLessThanOrEqual(2);
    }
    // The repeating trigger of host 109 is down across the end of July and of nothing else.
    expect(whole.hosts.find((h) => h.hostid === '109')!.downtime - parts.reduce((n, p) => n + p.hosts.find((h) => h.hostid === '109')!.downtime, 0)).toBe(1);
  });
});

describe('daily hours', () => {
  const tiny = (events: [string, string, number][], extra: Partial<Fixture> = {}): Fixture => ({
    triggers: [{ triggerid: '1', description: 'High ICMP ping loss', value: '0', lastchange: String(wib('2026-07-01 00:00')), status: '0', hosts: [{ hostid: '101', name: '1.2.1 TANGO02CORESWITCH', status: '0' }] }],
    parents: { '101': ['Cisco IOS by SNMP'] },
    events: events.map(([clock, , value], i) => ({ eventid: `e${i}`, objectid: '1', clock: wib(clock), value })),
    ...extra,
  });
  // Monday 3 August 2026 to Monday 10 August.
  const WEEK: [number, number] = [wib('2026-08-03 00:00'), wib('2026-08-10 00:00')];
  const down = (from: string, to: string): [string, string, number][] => [[from, '', 1], [to, '', 0]];

  async function week(profile: SliProfile, f: Fixture, hours: Parameters<typeof evaluateSli>[1]['hours']) {
    serveFixture(zbxMock, f);
    const data = await readSliData({ profile, from: MONTHS.aug.from, to: MONTHS.aug.to, now: NOW });
    return evaluateSli([data], { from: WEEK[0], to: WEEK[1], hours });
  }

  it('measures only 08:00 to 17:00 on weekdays: five spans of nine hours, and an outage counts only for the part inside them', async () => {
    const events = [
      ...down('2026-08-04 12:00', '2026-08-04 12:30'), // Tuesday, inside
      ...down('2026-08-05 20:00', '2026-08-05 21:00'), // Wednesday evening, outside
      ...down('2026-08-06 16:30', '2026-08-06 18:00'), // Thursday, half an hour inside
      ...down('2026-08-08 10:00', '2026-08-08 11:00'), // Saturday, a day that is left out
    ];
    const r = await week('hcml-report', tiny(events), { start: 8, end: 17, weekdays: [1, 2, 3, 4, 5] });
    const host = r.hosts[0];
    expect(host.window).toBe(5 * 9 * 3600);
    expect(host.downtime).toBe(1800 + 1800);
    expect(host.sli).toBeCloseTo(100 * (1 - 3600 / (5 * 9 * 3600)), 10);
    expect(host.incidents).toBe(2);
    expect(host.longest).toBe(1800);
    expect(r.dailyHours).toEqual({ start: 8, end: 17, weekdays: [1, 2, 3, 4, 5], seconds: 5 * 9 * 3600 });
  });

  it('runs a span through midnight and belongs it to the day it starts', async () => {
    const events = [
      ...down('2026-08-03 05:00', '2026-08-03 05:30'), // Monday morning: the end of Sunday night's span, which began before the window
      ...down('2026-08-04 03:00', '2026-08-04 04:00'), // Tuesday: the end of Monday night's span
      ...down('2026-08-04 12:00', '2026-08-04 13:00'), // outside every night span
    ];
    const r = await week('hcml-report', tiny(events), { start: 22, end: 6, weekdays: null });
    const host = r.hosts[0];
    // Sunday night's last six hours, six whole nights from Monday's to Saturday's, and the first two hours of the night that the window ends in.
    expect(host.window).toBe(6 * 3600 + 6 * 8 * 3600 + 2 * 3600);
    expect(host.downtime).toBe(1800 + 3600);
    expect(host.incidents).toBe(2);
  });

  it('keeps the weekdays alone when no hours are named', async () => {
    const r = await week('hcml-report', tiny(down('2026-08-04 12:00', '2026-08-04 13:00')), { start: 0, end: 24, weekdays: [2] });
    expect(r.hosts[0].window).toBe(24 * 3600);
    expect(r.hosts[0].downtime).toBe(3600);
  });

  it('takes maintenance out of the hours it falls in, and only those', async () => {
    const maintenance = [
      {
        maintenanceid: '1',
        active_since: String(wib('2026-08-01 00:00')),
        active_till: String(wib('2026-08-31 00:00')),
        timeperiods: [
          { timeperiod_type: '0', start_date: String(wib('2026-08-04 07:00')), period: String(3 * 3600) }, // 07:00 to 10:00: two hours inside
          { timeperiod_type: '0', start_date: String(wib('2026-08-05 18:00')), period: String(3600) }, // outside the hours
        ],
        hosts: [{ hostid: '101' }],
        hostgroups: [],
      },
    ];
    const r = await week('hcml-report', tiny([], { maintenance }), { start: 8, end: 17, weekdays: [1, 2, 3, 4, 5] });
    expect(r.hosts[0].maintenance).toBe(2 * 3600);
    expect(r.hosts[0].window).toBe(5 * 9 * 3600);
    expect(r.hosts[0].covered).toBe(5 * 9 * 3600 - 2 * 3600);
  });

  it('strict: counts the hours with data inside the hours, and has no figure for a host that collected nothing in them', async () => {
    const trends = [];
    for (let h = MONTHS.aug.from; h < MONTHS.aug.to; h += 3600) {
      // Collected everywhere except Wednesday 5 August from 10:00 to 14:00.
      if (h >= wib('2026-08-05 10:00') && h < wib('2026-08-05 14:00')) continue;
      trends.push({ itemid: 'i101', clock: h, num: 60 });
    }
    const f = tiny(down('2026-08-05 11:00', '2026-08-05 12:00'), { items: [{ itemid: 'i101', hostid: '101', key_: 'icmpping', delay: '1m', value_type: '3' }], trends });
    f.triggers[0].description = 'Unavailable by ICMP ping';
    const r = await week('availability', f, { start: 8, end: 17, weekdays: [1, 2, 3, 4, 5] });
    expect(r.hosts[0].covered).toBe(5 * 9 * 3600 - 4 * 3600);
    // The outage lay wholly inside the hours nobody collected in, so it is not measured.
    expect(r.hosts[0].downtime).toBe(0);

    // The same host with the daily hours on a day it collected nothing at all.
    const none = await week('availability', { ...f, trends: [] }, { start: 8, end: 17, weekdays: [1] });
    expect(none.hosts[0]).toMatchObject({ sli: null, dataStatus: 'nodata', covered: 0 });
  });

  for (const profile of PROFILES) {
    it(`${profile}: hours that follow one another add up to the hours they make together`, async () => {
      serveFixture(zbxMock, estate);
      const [from, to] = [wib('2026-06-10 00:00'), wib('2026-08-20 00:00')];
      const [a, b, both] = await Promise.all(
        [
          { start: 8, end: 12, weekdays: null },
          { start: 12, end: 17, weekdays: null },
          { start: 8, end: 17, weekdays: null },
        ].map((hours) => stitched(profile, from, to, hours)),
      );
      expect(a.hosts.length).toBe(both.hosts.length);
      for (const h of both.hosts) {
        const x = a.hosts.find((y) => y.hostid === h.hostid)!;
        const y = b.hosts.find((z) => z.hostid === h.hostid)!;
        expect(x.window + y.window).toBe(h.window);
        expect(x.downtime + y.downtime).toBe(h.downtime);
        expect(x.covered + y.covered).toBe(h.covered);
        expect(x.maintenance + y.maintenance).toBe(h.maintenance);
      }
    });
  }

  it('is the same as no hours when the hours are all of the day', async () => {
    serveFixture(zbxMock, estate);
    const [from, to] = [wib('2026-07-01 00:00'), wib('2026-08-10 00:00')];
    for (const profile of PROFILES) {
      const plain = await stitched(profile, from, to);
      expect(parseDailyHours('0-24', '1,2,3,4,5,6,7')).toBeNull();
      // Handed to the evaluation by hand, hours that keep everything go through the whole of the masked path and must say what the plain one does.
      const all = await stitched(profile, from, to, { start: 0, end: 24, weekdays: null });
      expect(figures(all)).toEqual(figures(plain));
      expect(all.dailyHours).toEqual({ start: 0, end: 24, weekdays: null, seconds: to - from });
    }
  });
});

describe('the choices of a window', () => {
  it('reads daily hours', () => {
    expect(parseDailyHours(undefined, undefined)).toBeNull();
    expect(parseDailyHours('8-17', undefined)).toEqual({ start: 8, end: 17, weekdays: null });
    expect(parseDailyHours('22-6', '5,1,3,1')).toEqual({ start: 22, end: 6, weekdays: [1, 3, 5] });
    expect(parseDailyHours('22-0', undefined)).toEqual({ start: 22, end: 0, weekdays: null });
    expect(parseDailyHours(undefined, '1,2,3,4,5')).toEqual({ start: 0, end: 24, weekdays: [1, 2, 3, 4, 5] });
    expect(parseDailyHours('0-24', '1,2,3,4,5,6,7')).toBeNull();
    expect(parseDailyHours('', '')).toBeNull();
  });

  it('refuses what is not whole hours, not a weekday, or no hours at all', () => {
    for (const bad of ['8', '8:00-17:00', '24-3', '8-25', '9-9', 'a-b', '8-17-20']) expect(() => parseDailyHours(bad, undefined), bad).toThrow(/dayHours/);
    for (const bad of ['0', '8', '1,,2', '1-5', 'mon']) expect(() => parseDailyHours(undefined, bad), bad).toThrow(/days/);
    expect(() => parseDailyHours(['8-17'], undefined)).toThrow(/dayHours/);
  });

  it('refuses a window that is not whole hours, runs backwards, is over a year, has not started or began too long ago', () => {
    const now = NOW;
    const ok = [wib('2026-08-01 00:00'), wib('2026-08-02 00:00')] as const;
    expect(() => checkWindow(ok[0], ok[1], now, TZ)).not.toThrow();
    expect(() => checkWindow(ok[0] + 60, ok[1], now, TZ)).toThrow(/whole hours/);
    expect(() => checkWindow(ok[0], ok[1] + 1800, now, TZ)).toThrow(/whole hours/);
    expect(() => checkWindow(ok[1], ok[0], now, TZ)).toThrow(/before/);
    expect(() => checkWindow(ok[0], ok[0], now, TZ)).toThrow(/before/);
    expect(() => checkWindow(wib('2026-01-01 00:00'), wib('2027-01-03 00:00'), now, TZ)).toThrow(/at most 366 days/);
    expect(() => checkWindow(wib('2026-01-01 00:00'), wib('2027-01-01 00:00'), now, TZ)).not.toThrow();
    expect(() => checkWindow(wib('2026-09-18 00:00'), wib('2026-09-19 00:00'), now, TZ)).toThrow(/not started/);
    expect(() => checkWindow(wib('2025-01-01 00:00'), wib('2025-01-02 00:00'), now, TZ)).toThrow(/about a year/);
    // A range is read in whole months, and a month that began before the 400 days is refused: so is a range that begins in one, though its own start is later (the line is 2025-08-13 here).
    expect(() => checkWindow(wib('2025-08-20 00:00'), wib('2025-08-21 00:00'), now, TZ)).toThrow('Zabbix keeps events for about a year; pick a later period.');
    expect(() => checkWindow(wib('2025-08-31 23:00'), wib('2025-09-01 01:00'), now, TZ)).toThrow(/about a year/);
    expect(() => checkWindow(wib('2025-09-01 00:00'), wib('2025-09-02 00:00'), now, TZ)).not.toThrow();
    expect(() => checkWindow(Number.NaN, ok[1], now, TZ)).toThrow(/times/);
  });

  it('builds the spans of the hours', () => {
    const week = [wib('2026-08-03 00:00'), wib('2026-08-10 00:00')] as const;
    const nine = dailySpans({ start: 8, end: 17, weekdays: [1, 2, 3, 4, 5] }, week[0], week[1], TZ);
    expect(nine).toHaveLength(5);
    expect(nine[0]).toEqual([wib('2026-08-03 08:00'), wib('2026-08-03 17:00')]);
    expect(totalSeconds(nine)).toBe(5 * 9 * 3600);
    // November 2026 begins on a Sunday and has 21 weekdays.
    const november = dailySpans({ start: 8, end: 17, weekdays: [1, 2, 3, 4, 5] }, wib('2026-11-01 00:00'), wib('2026-12-01 00:00'), TZ);
    expect(november).toHaveLength(21);
    expect(totalSeconds(november)).toBe(189 * 3600);
    // The whole of November, every day, 08:00 to 17:00.
    expect(totalSeconds(dailySpans({ start: 8, end: 17, weekdays: null }, wib('2026-11-01 00:00'), wib('2026-12-01 00:00'), TZ))).toBe(270 * 3600);
    // A span through midnight is cut by the window at both ends.
    const night = dailySpans({ start: 22, end: 6, weekdays: null }, week[0], week[0] + 2 * 86400, TZ);
    expect(night).toEqual([
      [wib('2026-08-03 00:00'), wib('2026-08-03 06:00')],
      [wib('2026-08-03 22:00'), wib('2026-08-04 06:00')],
      [wib('2026-08-04 22:00'), wib('2026-08-05 00:00')],
    ]);
    // 22 to midnight, and the weekday of the day a span begins.
    expect(dailySpans({ start: 22, end: 0, weekdays: [7] }, week[0], week[1], TZ)).toEqual([[wib('2026-08-09 22:00'), wib('2026-08-10 00:00')]]);
    expect(dailySpans({ start: 8, end: 17, weekdays: null }, week[1], week[0], TZ)).toEqual([]);
  });

  it('lists the months a window touches', () => {
    expect(monthsTouched(wib('2026-08-31 23:00'), wib('2026-09-01 01:00'), TZ)).toEqual(['2026-08', '2026-09']);
    expect(monthsTouched(wib('2026-08-01 00:00'), wib('2026-09-01 00:00'), TZ)).toEqual(['2026-08']);
    expect(monthsTouched(wib('2025-11-15 00:00'), wib('2026-02-01 00:00'), TZ)).toEqual(['2025-11', '2025-12', '2026-01']);
    expect(monthsTouched(wib('2026-08-02 00:00'), wib('2026-08-01 00:00'), TZ)).toEqual([]);
  });
});

describe('sliDataBytes', () => {
  const data = (events: number): SliData => ({
    profile: 'availability',
    from: 0,
    to: 100,
    end: 100,
    readAt: 100,
    hosts: [{ hostid: '1', name: 'a', status: '0', triggerids: ['t'], category: 'Other', site: null, measured: true }],
    initial: new Map([['t', false]]),
    events: new Map([['t', Array.from({ length: events }, (_, i) => ({ clock: i, value: i % 2 }))]]),
    maintenance: new Map([['1', [[1, 2]]]]),
    coverage: new Map([['1', [[0, 50], [60, 100]]]]),
    stats: { zabbixCalls: 0, triggers: 1, events, trendRows: 0 },
  });

  it('grows with the events, about 45 bytes each, which is what a month held when measured', () => {
    expect(sliDataBytes(data(100_000)) - sliDataBytes(data(0))).toBe(45 * 100_000);
  });

  it('counts a month past the 170,000 events the cache\'s own walk can see, instead of stopping at what it saw', () => {
    expect(sliDataBytes(data(1_400_000))).toBeGreaterThan(60_000_000);
  });

  it('counts the hosts and the stretches of time too, so that an empty month is not nothing', () => {
    expect(sliDataBytes(data(0))).toBe(400 + 80 * 3);
  });
});
