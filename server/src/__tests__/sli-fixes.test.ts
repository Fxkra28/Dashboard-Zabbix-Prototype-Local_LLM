import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { BadRequestError, DataNotReadYetError } from '../core/validate.js';
import { registerErrorHandler } from '../http/errors.js';
import { invalidate } from '../core/cache.js';
import { coverageCell } from '../export/slaReport.js';
import { evaluateSli, type SliData } from '../sli/evaluate.js';
import { intersectIntervals, mergeIntervals, touchesAny, type Interval } from '../sli/intervals.js';
import { parseDailyHours } from '../sli/window.js';
import { buildEstate, NOW_ISO, serveFixture, wib } from './helpers/sliEstate.js';

/**
 * Faults of the derived SLA (BK-79 to BK-83): the stall of a year inside the daily hours and the reuse of what was evaluated, a window that begins after the data that was read, the path of two legs in
 * maintenance, the incidents of two triggers in one outage, and a coverage that read 100% below 100. The data is made up.
 */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
  invalidate('');
});
afterEach(() => {
  vi.useRealTimers();
  zbxMock.mockReset();
});

describe('touchesAny (BK-79)', () => {
  it('says what intersectIntervals([iv], spans) says, for outages of every kind against merged spans', () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * n;
    for (let round = 0; round < 40; round++) {
      const raw: Interval[] = Array.from({ length: 1 + Math.floor(rnd(30)) }, () => {
        const s = Math.floor(rnd(1000));
        return [s, s + 1 + Math.floor(rnd(60))];
      });
      const spans = mergeIntervals(raw);
      for (let k = 0; k < 60; k++) {
        const s = Math.floor(rnd(1100));
        const e = s + 1 + Math.floor(rnd(80));
        expect(touchesAny(spans, s, e), JSON.stringify({ spans, s, e })).toBe(intersectIntervals([[s, e]], spans).length > 0);
      }
    }
  });

  it('counts an outage that only touches a span at its edge as outside it, and none against no spans', () => {
    expect(touchesAny([[10, 20]], 20, 30)).toBe(false);
    expect(touchesAny([[10, 20]], 0, 10)).toBe(false);
    expect(touchesAny([[10, 20]], 19, 21)).toBe(true);
    expect(touchesAny([], 0, 100)).toBe(false);
  });
});

/** Two legs of one WAN path, or a host with two triggers: data for `evaluateSli`, made up, over ten days from a Monday. */
const FROM = wib('2026-08-03 00:00');
const TO = wib('2026-08-13 00:00');
const DAY = 86_400;
const stats = { zabbixCalls: 0, triggers: 0, events: 0, trendRows: 0 };
const host = (hostid: string, name: string, triggerids: string[]) => ({ hostid, name, status: '0', triggerids, category: 'WAN', site: null, measured: true });
const outage = (at: number, seconds: number) => [{ clock: at, value: 1 }, { clock: at + seconds, value: 0 }];

function data(profile: 'availability' | 'hcml-report', over: Partial<SliData> & { hosts: SliData['hosts']; events: SliData['events'] }): SliData {
  const hostids = over.hosts.map((h) => h.hostid);
  return {
    profile,
    from: FROM,
    to: TO,
    end: TO,
    readAt: TO + 10,
    initial: new Map(over.hosts.flatMap((h) => h.triggerids.map((t): [string, boolean] => [t, false]))),
    maintenance: new Map(),
    coverage: profile === 'availability' ? new Map(hostids.map((id): [string, Interval[]] => [id, [[FROM, TO]]])) : undefined,
    stats,
    ...over,
  };
}

describe('the incidents of a host with two triggers (BK-82)', () => {
  const t0 = FROM + 3 * DAY;
  // Partial loss from t0, total loss from t0 + 600 for an hour: one outage of 3,700 s that fires both triggers; a second one, later, of the second trigger alone.
  const events = new Map([
    ['t1', outage(t0 + 600, 3_100)],
    ['t2', [...outage(t0, 3_700), ...outage(t0 + 4 * DAY, 1_800)]],
  ]);
  const hosts = [host('1', '1.1 SW01', ['t1', 't2'])];

  it('are the outages of the merged stretches in the strict method, and not one for each trigger', () => {
    const [h] = evaluateSli([data('availability', { hosts, events })], { from: FROM, to: TO, hours: null }).hosts;
    expect(h.incidents).toBe(2);
    expect(h.downtime).toBe(3_700 + 1_800);
    expect(h.longest).toBe(3_700);
  });

  it('are still HCML\'s own count in HCML\'s method, which has one trigger', () => {
    const [h] = evaluateSli([data('hcml-report', { hosts, events: new Map([['t1', events.get('t2')!], ['t2', []]]) })], { from: FROM, to: TO, hours: null }).hosts;
    expect(h.incidents).toBe(2);
  });
});

describe('the outages that count inside the daily hours (BK-79)', () => {
  it('are those that touch a span of the hours, whichever way they are counted', () => {
    const hosts = [host('1', '1.1 SW01', ['t1'])];
    const monday = FROM;
    const events = new Map([
      [
        't1',
        [
          ...outage(monday + DAY + 10 * 3600, 3_600), // Tuesday 10:00 to 11:00: inside 8 to 17
          ...outage(monday + DAY + 20 * 3600, 3_600), // Tuesday 20:00: outside the hours
          ...outage(monday + 2 * DAY + 16.5 * 3600, 3_600), // Wednesday 16:30 to 17:30: touches the hours
          ...outage(monday + 5 * DAY + 10 * 3600, 3_600), // Saturday: outside the days
        ],
      ],
    ]);
    const hours = parseDailyHours('8-17', '1,2,3,4,5');
    for (const profile of ['availability', 'hcml-report'] as const) {
      const [h] = evaluateSli([data(profile, { hosts, events })], { from: FROM, to: TO, hours }).hosts;
      expect(h.incidents, profile).toBe(2);
    }
  });
});

// BK-79: a year inside the daily hours stalled the single thread of the BFF for tens of seconds, because every outage was intersected with every span of the hours. The size is that of HCML's estate:
// 140 hosts, twelve months, and an outage a fortnight for each. The bound is generous (the work takes a fraction of a second here); it stands for "does not stall", not for a speed.
describe('a year inside the daily hours (BK-79)', () => {
  const months = Array.from({ length: 12 }, (_, i) => {
    const year = 2025 + Math.floor((8 + i) / 12);
    const month = ((8 + i) % 12) + 1;
    const next = month === 12 ? [year + 1, 1] : [year, month + 1];
    const stamp = (y: number, m: number) => wib(`${y}-${String(m).padStart(2, '0')}-01 00:00`);
    return { from: stamp(year, month), to: stamp(next[0], next[1]) };
  });
  const hostCount = 140;
  const hosts = Array.from({ length: hostCount }, (_, i) => host(String(i + 1), `1.${i + 1} SW${i + 1}`, [`t${i + 1}`]));
  const monthly = (profile: 'availability' | 'hcml-report') =>
    months.map(({ from, to }, m) =>
      data(profile, {
        from,
        to,
        end: to,
        hosts,
        events: new Map(
          hosts.map((h, i): [string, { clock: number; value: number }[]] => [
            h.triggerids[0],
            // Two outages a month for each host, at hours that differ from host to host, some inside the daily hours and some outside.
            [...outage(from + ((i * 7 + m) % 20) * DAY + (i % 24) * 3_600, 1_800 + (i % 5) * 600), ...outage(from + (10 + ((i * 3 + m) % 15)) * DAY + ((i * 5) % 24) * 3_600, 3_600)],
          ]),
        ),
      }),
    );

  it.each(['availability', 'hcml-report'] as const)('is evaluated in the time of a request, not of a stall, in %s', (profile) => {
    const datas = monthly(profile);
    const hours = parseDailyHours('8-17', '1,2,3,4,5');
    const started = performance.now();
    const report = evaluateSli(datas, { from: months[0].from, to: months[11].to, hours });
    const seconds = (performance.now() - started) / 1000;
    expect(report.hosts).toHaveLength(hostCount);
    expect(report.hosts.some((h) => h.incidents > 0)).toBe(true);
    expect(seconds, `took ${seconds.toFixed(1)} s`).toBeLessThan(5);
  });

  it('counts only what touches the hours: a year of outages inside the hours is more downtime than the same year outside them', () => {
    const datas = monthly('availability');
    const inside = evaluateSli(datas, { from: months[0].from, to: months[11].to, hours: parseDailyHours('0-24', '1,2,3,4,5,6,7') });
    const office = evaluateSli(datas, { from: months[0].from, to: months[11].to, hours: parseDailyHours('8-17', '1,2,3,4,5') });
    const sum = (r: typeof inside) => r.hosts.reduce((n, h) => n + h.downtime, 0);
    expect(sum(office)).toBeGreaterThan(0);
    expect(sum(office)).toBeLessThan(sum(inside));
  });
});

describe('a WAN path whose legs are both in planned maintenance (BK-81)', () => {
  it('reads the same in HCML\'s method as each leg does, since the maintenance leaves its time out', () => {
    const hosts = [host('1', 'INET : SURABAYA WAN 1', ['t1']), host('2', 'INET : SURABAYA WAN 2', ['t2'])];
    const stop = FROM + 5 * DAY;
    const events = new Map([['t1', outage(stop, 3_600)], ['t2', outage(stop, 3_600)]]);
    const maintenance = new Map<string, Interval[]>([['1', [[FROM, FROM + DAY]]], ['2', [[FROM, FROM + DAY]]]]);
    for (const profile of ['hcml-report', 'availability'] as const) {
      const report = evaluateSli([data(profile, { hosts, events, maintenance })], { from: FROM, to: TO, hours: null });
      const leg = report.hosts[0].sli!;
      expect(report.wanPaths[0].sli!, profile).toBeCloseTo(leg, 6);
      expect(leg).toBeCloseTo(100 * (1 - 3_600 / (9 * DAY)), 6);
    }
  });
});

describe('coverage as it is written in the report (BK-83)', () => {
  const dot = { decimal: 'dot' } as never;
  const comma = { decimal: 'comma' } as never;

  it.each([
    [1, '100%', 100],
    [0.5, '50%', 50],
    [0.974, '97%', 97.4],
    [0.996, '99.6%', 99.6],
    [0.9996, '99.9%', 99.96],
    [0.995, '99.5%', 99.5],
  ])('writes %s as %s, and keeps the figure for the workbook', (value, text, n) => {
    const cell = coverageCell(value, dot);
    expect(cell.text).toBe(text);
    expect(cell.n).toBeCloseTo(n, 6);
  });

  it('writes the decimal comma when that is the style', () => {
    expect(coverageCell(0.996, comma).text).toBe('99,6%');
  });
});

describe('a window that begins after the data that was read (BK-80)', () => {
  const MONTH = '2026-09';

  it('reads the open month again and answers with the time since the window began, and not with No data', async () => {
    const estate = buildEstate();
    serveFixture(zbxMock, estate);
    const { getWindowSli } = await import('../services/sli.js');
    // The month's data is read at 09:58 and kept for five minutes; at 10:02 someone asks for the window that began at 10:00.
    vi.setSystemTime(new Date(wib('2026-09-17 09:58') * 1000));
    const { getMonthData } = await import('../services/sli.js');
    const early = await getMonthData(MONTH, 'availability');
    expect(early.end).toBe(wib('2026-09-17 09:58'));
    vi.setSystemTime(new Date(wib('2026-09-17 10:02') * 1000));
    const report = await getWindowSli({ from: wib('2026-09-17 10:00'), to: wib('2026-09-17 11:00'), profile: 'availability', hours: null });
    expect(report.end).toBe(wib('2026-09-17 10:02'));
    expect(report.end - report.from).toBe(120);
    expect(report.hosts.length).toBeGreaterThan(0);
  });

  // A read that takes half a minute is stored when it ends, after the window began, though what it read is from before it: its age since it was stored is short, so an age limit alone keeps it.
  it('reads again when the month was read before the window began but was stored after it', async () => {
    serveFixture(zbxMock, buildEstate());
    const serve = zbxMock.getMockImplementation()!;
    const { getWindowSli, getMonthData } = await import('../services/sli.js');
    vi.setSystemTime(new Date((wib('2026-09-17 09:59') + 50) * 1000));
    let slow = true;
    zbxMock.mockImplementation(async (...args: unknown[]) => {
      if (slow) {
        slow = false;
        vi.setSystemTime(new Date((wib('2026-09-17 10:00') + 20) * 1000));
      }
      return serve(...args);
    });
    const early = await getMonthData(MONTH, 'availability');
    expect(early.end).toBe(wib('2026-09-17 09:59') + 50);
    vi.setSystemTime(new Date((wib('2026-09-17 10:00') + 25) * 1000));
    zbxMock.mockImplementation(serve);
    const report = await getWindowSli({ from: wib('2026-09-17 10:00'), to: wib('2026-09-17 11:00'), profile: 'availability', hours: null });
    expect(report.end - report.from).toBe(25);
    expect(report.hosts.length).toBeGreaterThan(0);
  });

  it('reads again when the hours chosen leave nothing measured in what was read: asked at 08:03 for the hours from 8, with the data read at 07:58', async () => {
    serveFixture(zbxMock, buildEstate());
    const { getWindowSli, getMonthData } = await import('../services/sli.js');
    vi.setSystemTime(new Date(wib('2026-09-17 07:58') * 1000));
    await getMonthData(MONTH, 'availability');
    vi.setSystemTime(new Date(wib('2026-09-17 08:03') * 1000));
    const report = await getWindowSli({ from: wib('2026-09-17 00:00'), to: wib('2026-09-18 00:00'), profile: 'availability', hours: parseDailyHours('8-17', '1,2,3,4,5') });
    expect(report.dailyHours?.seconds).toBe(180);
    expect(report.hosts[0].window).toBeGreaterThan(0);
  });

  it('says the figures have not been read yet when the month cannot be read again, and does not make a report of nothing', async () => {
    serveFixture(zbxMock, buildEstate());
    const { getWindowSli, getMonthData } = await import('../services/sli.js');
    vi.setSystemTime(new Date(wib('2026-09-17 09:58') * 1000));
    await getMonthData(MONTH, 'availability');
    zbxMock.mockRejectedValue(new Error('Zabbix is down'));
    vi.setSystemTime(new Date(wib('2026-09-17 10:02') * 1000));
    const err = await getWindowSli({ from: wib('2026-09-17 10:00'), to: wib('2026-09-17 11:00'), profile: 'availability', hours: null }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(DataNotReadYetError);
    expect((err as Error).message).toMatch(/nothing to measure yet.*Try again in a minute/);
  });

  it('is a 503 with a time to wait, which a client tries again, and not a 400 about a request that is right', async () => {
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    app.get('/x', async () => {
      throw new DataNotReadYetError('There is nothing to measure yet. Try again in a minute.');
    });
    const res = await app.inject({ url: '/x' });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('60');
    expect(res.json()).toEqual({ error: 'data_not_read_yet', message: 'There is nothing to measure yet. Try again in a minute.' });
    await app.close();
  });

  it('is refused in words when the range begins at this very moment: there is nothing to measure yet', async () => {
    serveFixture(zbxMock, buildEstate());
    const { getWindowSli } = await import('../services/sli.js');
    vi.setSystemTime(new Date(wib('2026-09-17 10:00') * 1000));
    await expect(getWindowSli({ from: wib('2026-09-17 10:00'), to: wib('2026-09-17 11:00'), profile: 'availability', hours: null })).rejects.toSatisfy(
      (err: unknown) => err instanceof BadRequestError && /not started yet/.test(err.message),
    );
  });
});

describe('an evaluated window is kept for a short time (BK-79)', () => {
  const ask = (over: Record<string, unknown> = {}) => ({ from: wib('2026-08-03 00:00'), to: wib('2026-08-10 00:00'), profile: 'availability' as const, hours: null, ...over });

  it('is one report for the page, its refresh, a file and an email, and not for another choice of hours or method', async () => {
    serveFixture(zbxMock, buildEstate());
    const { getWindowSli } = await import('../services/sli.js');
    const first = await getWindowSli(ask());
    expect(await getWindowSli(ask())).toBe(first);
    expect(await getWindowSli(ask())).toBe(first);
    expect(await getWindowSli(ask({ hours: parseDailyHours('8-17', '1,2,3,4,5') }))).not.toBe(first);
    expect(await getWindowSli(ask({ profile: 'hcml-report' }))).not.toBe(first);
    expect(await getWindowSli(ask({ to: wib('2026-08-11 00:00') }))).not.toBe(first);
  });

  it('is evaluated again once the months it is made of are forgotten, so that an empty report is not the answer of the next try', async () => {
    serveFixture(zbxMock, buildEstate());
    const { getWindowSli, forgetMonthlySli } = await import('../services/sli.js');
    const first = await getWindowSli(ask());
    forgetMonthlySli('2026-08');
    expect(await getWindowSli(ask())).not.toBe(first);
  });
});

describe('the site of a host in the SLA (BK-103)', () => {
  it('is read by the four signals of the Sites page, and asked for in the call that already reads the templates', async () => {
    const estate = buildEstate();
    // Host 101's name says Jakarta and a site tag says Surabaya; host 108's name says no site and its host group names one.
    estate.triggers.filter((tr) => tr.hosts[0].hostid === '108').forEach((tr) => (tr.hosts[0].name = 'CORE SWITCH NORTH'));
    estate.signals = {
      '101': { tags: [{ tag: 'site', value: 'Surabaya' }], hostgroups: [], inventory: [] },
      '108': { tags: [], hostgroups: [{ groupid: '7', name: 'Pasuruan / GMS' }], inventory: [] },
    };
    serveFixture(zbxMock, estate);
    const { computeSli } = await import('../sli/engine.js');
    const report = await computeSli({ profile: 'availability', month: '2026-08' });
    const site = (hostid: string) => report.hosts.find((h) => h.hostid === hostid)?.site;
    expect(site('101')).toEqual({ code: 2, name: 'Surabaya' });
    expect(site('108')).toEqual({ code: 5, name: 'Pasuruan / GMS' });
    expect(site('107')).toEqual({ code: 5, name: 'Pasuruan / GMS' });
    const asked = zbxMock.mock.calls.filter(([method, p]) => method === 'host.get' && p.hostids && p.selectParentTemplates);
    expect(asked).toHaveLength(1);
    expect(asked[0][1]).toMatchObject({ selectTags: ['tag', 'value'], selectHostGroups: ['groupid', 'name'], selectInventory: ['site_city', 'location'] });
  });
});
