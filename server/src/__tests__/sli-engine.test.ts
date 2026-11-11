import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aggregate,
  categoryFor,
  coveredFromTrends,
  initialState,
  intervalsFor,
  parseDelay,
  wasMeasured,
  type SliHost,
  type TriggerEvent,
} from '../sli/engine.js';
import { intersectIntervals, mergeIntervals, totalSeconds } from '../sli/intervals.js';

/**
 * The derived SLA. HCML's published Availability Reports were reproduced to
 * four decimal places with this engine (scripts/validate-sli.ts); these tests
 * pin the rules that made that possible, and the strict profile's rules for
 * missing data, so neither can drift silently. A wrong availability figure does
 * not throw: it just looks plausible.
 */

const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

const AUG = { from: 1785517200, to: 1788195600 }; // 2026-08 in Asia/Jakarta
const MONTH = AUG.to - AUG.from;

describe('intervalsFor', () => {
  it('counts a problem already open when the window starts, from the start', () => {
    const r = intervalsFor([{ clock: 1_000, value: 0 }], true, 400, 5_000);
    expect(r.intervals).toEqual([[400, 1_000]]);
    expect(r.incidents).toBe(1);
  });

  it('clips a problem still open at the end to the clip point', () => {
    expect(intervalsFor([{ clock: 4_000, value: 1 }], false, 0, 4_999).intervals).toEqual([[4_000, 4_999]]);
  });

  it('treats a repeated PROBLEM while in problem as one outage', () => {
    const r = intervalsFor(
      [
        { clock: 100, value: 1 },
        { clock: 200, value: 1 },
        { clock: 300, value: 0 },
      ],
      false,
      0,
      1_000,
    );
    expect(r.intervals).toEqual([[100, 300]]);
    expect(r.incidents).toBe(1);
  });

  it('is a whole-window outage when stuck in problem with no events at all', () => {
    expect(intervalsFor([], true, 0, 1_000).intervals).toEqual([[0, 1_000]]);
  });
});

describe('initialState', () => {
  const trigger = (value: string, lastchange: number) => ({ value, lastchange: String(lastchange) });

  it('reads it from the first event in the window', () => {
    expect(initialState([{ clock: 5, value: 0 }], trigger('0', 1), 10)).toBe(true);
    expect(initialState([{ clock: 5, value: 1 }], trigger('1', 1), 10)).toBe(false);
  });

  it('uses the current value when nothing changed since before the window', () => {
    expect(initialState([], trigger('1', 1), 10)).toBe(true);
    expect(initialState([], trigger('0', 1), 10)).toBe(false);
  });

  it('uses the first later event when the trigger changed only after the window', () => {
    // Its current value is today's; what it was during the window is what the
    // first later event changed it from.
    expect(initialState([], trigger('0', 50), 10, 0)).toBe(true);
    expect(initialState([], trigger('1', 50), 10, 1)).toBe(false);
  });
});

describe('initialState with the event before the window (BK-46)', () => {
  const trigger = { value: '0', lastchange: '0' };
  const first = (value: number): TriggerEvent[] => [{ clock: 100, value }];

  it('says a first PROBLEM in the window is a repeat when the last event before the window was a PROBLEM', () => {
    expect(initialState(first(1), trigger, 5_000, undefined, 1)).toBe(true);
  });

  it('keeps a first PROBLEM as the start of the problem when the last event before was an OK or there was none', () => {
    expect(initialState(first(1), trigger, 5_000, undefined, 0)).toBe(false);
    expect(initialState(first(1), trigger, 5_000, undefined, undefined)).toBe(false);
  });

  it('does not let the event before the window overrule a first OK, which always ends a problem', () => {
    expect(initialState(first(0), trigger, 5_000, undefined, 0)).toBe(true);
    expect(initialState(first(0), trigger, 5_000, undefined, 1)).toBe(true);
  });
});

describe('aggregate and helpers', () => {
  const host = (sli: number | null): SliHost =>
    ({ sli, downtime: sli === null ? 0 : 60, meeting: sli === null ? null : sli >= 99 }) as SliHost;

  it('is the plain mean of the hosts that have a figure, HCML’s rule', () => {
    const g = aggregate('x', 'X', [host(100), host(98), host(null)], 99);
    expect(g.sli).toBe(99);
    expect(g).toMatchObject({ hosts: 3, withData: 2, meeting: true, belowTarget: 1, downtime: 120 });
  });

  it('has no figure at all when no host has data', () => {
    expect(aggregate('x', 'X', [host(null)], 99)).toMatchObject({ sli: null, meeting: null });
  });

  it('parses Zabbix update intervals', () => {
    expect(parseDelay('60')).toBe(60);
    expect(parseDelay('1m')).toBe(60);
    expect(parseDelay('5m')).toBe(300);
    expect(parseDelay('1h')).toBe(3600);
    expect(parseDelay('{$ICMP_DELAY}')).toBe(60);
  });

  it('counts an hour as collected only when half the expected samples arrived', () => {
    const rows = [
      { clock: 0, num: 60 },
      { clock: 3600, num: 29 },
      { clock: 7200, num: 30 },
    ];
    expect(coveredFromTrends(rows, 60, 0, 10_800)).toEqual([
      [0, 3600],
      [7200, 10_800],
    ]);
  });

  it('calls a host unmeasured only when none of its ICMP items has collected or is collecting', () => {
    const never = { state: '1', lastclock: '0' };
    expect(wasMeasured([never, never, never], false)).toBe(false);
    // Disabled: its items are not polled, so they never turn unsupported.
    expect(wasMeasured([{ state: '0', lastclock: '0' }], true)).toBe(false);
    expect(wasMeasured([{ state: '0', lastclock: '0' }], false)).toBe(true);
    expect(wasMeasured([never, { state: '1', lastclock: '1788000000' }], false)).toBe(true);
    expect(wasMeasured([never, { state: '0', lastclock: '1788000000' }], true)).toBe(true);
    expect(wasMeasured([], false)).toBe(true);
  });

  it('takes the report category from the device template before ICMP Ping', () => {
    expect(categoryFor(['ICMP Ping', 'Cisco IOS by SNMP'])).toBe('Cisco IOS by SNMP');
    expect(categoryFor(['ICMP Ping'])).toBe('ICMP Ping');
    expect(categoryFor([])).toBe('Other');
  });

  it('does not double-count overlapping loss and unavailability', () => {
    const union = mergeIntervals([
      [0, 100],
      [50, 150],
    ]);
    expect(totalSeconds(union)).toBe(150);
    expect(intersectIntervals(union, [[120, 400]])).toEqual([[120, 150]]);
  });
});

// Against a mocked Zabbix

// The parameters of a Zabbix call, which the fixture reads by whatever names the call used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = Record<string, any>;

interface Fixture {
  triggers: Params[];
  parents: Record<string, string[]>;
  events: { eventid: string; objectid: string; clock: number; value: number }[];
  items?: Params[];
  trends?: { itemid: string; clock: number; num: number }[];
  history?: { itemid: string; clock: number }[];
  maintenance?: Params[];
  groups?: Params[];
}

function serve(f: Fixture) {
  zbxMock.mockImplementation(async (method: string, p: Params) => {
    switch (method) {
      case 'trigger.get':
        return f.triggers.filter((t) => p.filter.description.includes(t.description));
      case 'host.get':
        if (p.filter) return []; // no "Web Monitoring" host
        return p.hostids.map((hostid: string) => ({
          hostid,
          parentTemplates: (f.parents[hostid] ?? []).map((name) => ({ name })),
        }));
      case 'event.get': {
        const rows = f.events
          .filter(
            (e) =>
              p.objectids.includes(e.objectid) &&
              e.clock >= (p.time_from ?? 0) &&
              e.clock <= p.time_till,
          )
          .sort((a, b) => (p.sortorder === 'DESC' ? b.clock - a.clock : a.clock - b.clock))
          .slice(0, p.limit)
          .map((e) => ({ ...e, clock: String(e.clock), value: String(e.value) }));
        return rows;
      }
      case 'item.get':
        return f.items ?? [];
      case 'maintenance.get':
        return f.maintenance ?? [];
      case 'hostgroup.get':
        return f.groups ?? [];
      case 'history.get':
        return (f.history ?? [])
          .filter((r) => p.itemids.includes(r.itemid) && r.clock >= p.time_from && r.clock <= p.time_till)
          .map((r) => ({ itemid: r.itemid, clock: String(r.clock) }));
      case 'trend.get':
        return (f.trends ?? [])
          .filter((r) => p.itemids.includes(r.itemid) && r.clock >= p.time_from && r.clock <= p.time_till)
          .map((r) => ({ itemid: r.itemid, clock: String(r.clock), num: String(r.num) }));
      default:
        return [];
    }
  });
}

const trig = (triggerid: string, hostid: string, name: string, description: string, over: Params = {}) => ({
  triggerid,
  description,
  value: '0',
  lastchange: String(AUG.from - 86400),
  status: '0',
  hosts: [{ hostid, name, status: '0' }],
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-17T03:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  zbxMock.mockReset();
});

describe('computeSli: hcml-report profile', () => {
  it('reproduces HCML’s method: clip to the month, open problems end at month end − 1 s, silent hosts are 100%', async () => {
    serve({
      triggers: [
        trig('1', '101', '1.2.1 IDX02CORESWITCH', 'High ICMP ping loss'),
        trig('2', '102', '4.3.3 FPSO ARUBA 3', 'High ICMP ping loss', { value: '1' }),
        trig('3', '103', 'INET : SAMPANG WAN 1', 'High ICMP ping loss'),
        // Not the report trigger: must not count in this profile.
        trig('4', '101', '1.2.1 IDX02CORESWITCH', 'Unavailable by ICMP ping'),
      ],
      parents: { '101': ['Cisco IOS by SNMP'], '102': ['Generic by SNMP'], '103': ['ICMP Ping'] },
      events: [
        { eventid: 'a', objectid: '1', clock: AUG.from + 3600, value: 1 },
        { eventid: 'b', objectid: '1', clock: AUG.from + 7200, value: 0 },
        // Open since July: recovers 30 minutes into August…
        { eventid: 'c', objectid: '2', clock: AUG.from + 1800, value: 0 },
        // …and fires again 100 s before the month ends, still open.
        { eventid: 'd', objectid: '2', clock: AUG.to - 100, value: 1 },
        { eventid: 'e', objectid: '4', clock: AUG.from + 10, value: 1 },
      ],
    });
    const { computeSli } = await import('../sli/engine.js');
    const r = await computeSli({ month: '2026-08', profile: 'hcml-report' });

    const byName = Object.fromEntries(r.hosts.map((h) => [h.name, h]));
    expect(byName['1.2.1 IDX02CORESWITCH'].downtime).toBe(3600);
    expect(byName['4.3.3 FPSO ARUBA 3'].downtime).toBe(1800 + 99);
    expect(byName['4.3.3 FPSO ARUBA 3'].incidents).toBe(2);
    expect(byName['INET : SAMPANG WAN 1'].sli).toBe(100);
    expect(byName['INET : SAMPANG WAN 1'].category).toBe('ICMP Ping');

    const expected = [100 * (1 - 3600 / MONTH), 100 * (1 - 1899 / MONTH), 100];
    expect(r.overall.sli).toBeCloseTo(expected.reduce((a, b) => a + b) / 3, 10);
    expect(r.categories.map((c) => c.name)).toEqual(['Cisco IOS by SNMP', 'ICMP Ping', 'Generic by SNMP']);
    expect(r.basis).toMatchObject({ gapPolicy: 'counted-as-up', noDataPolicy: 'counted-as-100' });
    expect(r.closed).toBe(true);
    // No coverage reads in this profile.
    expect(zbxMock.mock.calls.some(([m]) => m === 'trend.get')).toBe(false);
  });

  it('looks up the first later event for a trigger that only changed after the month', async () => {
    serve({
      // In problem today, but it only went into problem in September, so it
      // was OK throughout August.
      triggers: [trig('1', '101', '1.1 ALPHA-FW01', 'High ICMP ping loss', { value: '1', lastchange: String(AUG.to + 5 * 86400) })],
      parents: { '101': ['FortiGate by SNMP'] },
      events: [{ eventid: 'z', objectid: '1', clock: AUG.to + 5 * 86400, value: 1 }],
    });
    const { computeSli } = await import('../sli/engine.js');
    const r = await computeSli({ month: '2026-08', profile: 'hcml-report' });
    expect(r.hosts[0].downtime).toBe(0);
    const forward = zbxMock.mock.calls.find(([m, p]) => m === 'event.get' && p.time_from >= AUG.to);
    expect(forward).toBeDefined();
  });

  it('flags never-measured hosts without changing a figure', async () => {
    const fixture: Fixture = {
      triggers: [
        trig('1', '101', '1.2.1 IDX02CORESWITCH', 'High ICMP ping loss'),
        trig('2', '102', 'INET : SAMPANG WAN 1', 'High ICMP ping loss'),
        trig('3', '103', '9.9 DMR REPEATER', 'High ICMP ping loss', {
          hosts: [{ hostid: '103', name: '9.9 DMR REPEATER', status: '1' }],
        }),
        trig('4', '104', 'WEB : PORTAL', 'High ICMP ping loss'),
      ],
      parents: { '101': ['Cisco IOS by SNMP'], '102': ['ICMP Ping'], '103': ['ICMP Ping'], '104': ['ICMP Ping'] },
      events: [
        { eventid: 'a', objectid: '1', clock: AUG.from + 3600, value: 1 },
        { eventid: 'b', objectid: '1', clock: AUG.from + 7200, value: 0 },
      ],
    };
    serve(fixture);
    const { computeSli } = await import('../sli/engine.js');
    const before = await computeSli({ month: '2026-08', profile: 'hcml-report' });
    expect(before.hosts.every((h) => h.measured)).toBe(true);

    const icmp = (hostid: string, state: string, lastclock: string) =>
      ['icmpping', 'icmppingloss', 'icmppingsec'].map((key_) => ({ itemid: `${hostid}${key_}`, hostid, key_, delay: '1m', value_type: '3', state, lastclock }));
    serve({
      ...fixture,
      items: [
        ...icmp('101', '0', '1789000000'),
        // No interface to ping: unsupported, nothing ever collected.
        ...icmp('102', '1', '0'),
        // Disabled host: never polled, so still "supported", but nothing collected.
        ...icmp('103', '0', '0'),
        // 104 has no ICMP item at all.
      ],
    });
    const after = await computeSli({ month: '2026-08', profile: 'hcml-report' });
    const measured = Object.fromEntries(after.hosts.map((h) => [h.hostid, h.measured]));
    expect(measured).toEqual({ '101': true, '102': false, '103': false, '104': true });
    // HCML's method still counts them as 100 %, and nothing else moves.
    expect(after.hosts.find((h) => h.hostid === '102')!.sli).toBe(100);
    const figures = (r: typeof after) => JSON.stringify({ ...r, hosts: r.hosts.map(({ measured: _, ...h }) => h), stats: 0, generatedAt: 0 });
    expect(figures(after)).toBe(figures(before));
    expect(zbxMock.mock.calls.some(([m]) => m === 'trend.get')).toBe(false);
  });
});

describe('computeSli: strict availability profile', () => {
  it('leaves out hours with no collected data and has no figure for a silent host', async () => {
    const gap: [number, number] = [AUG.from + 10 * 86400, AUG.from + 12 * 86400];
    const trends = [];
    for (let h = AUG.from; h < AUG.to; h += 3600) {
      if (h >= gap[0] && h < gap[1]) continue;
      trends.push({ itemid: 'i101', clock: h, num: 60 });
    }
    serve({
      triggers: [
        trig('1', '101', '1.2.1 IDX02CORESWITCH', 'Unavailable by ICMP ping'),
        trig('2', '101', '1.2.1 IDX02CORESWITCH', 'High ICMP ping loss'),
        trig('3', '103', 'INET : SAMPANG WAN 1', 'Unavailable by ICMP ping', { value: '1' }),
      ],
      parents: { '101': ['Cisco IOS by SNMP'], '103': ['ICMP Ping'] },
      events: [
        // One hour down, overlapping loss, counted once.
        { eventid: 'a', objectid: '1', clock: AUG.from + 3600, value: 1 },
        { eventid: 'b', objectid: '2', clock: AUG.from + 5400, value: 1 },
        { eventid: 'c', objectid: '1', clock: AUG.from + 7200, value: 0 },
        { eventid: 'd', objectid: '2', clock: AUG.from + 9000, value: 0 },
        // A day "down" entirely inside the collection gap, not measured.
        { eventid: 'e', objectid: '1', clock: gap[0] + 3600, value: 1 },
        { eventid: 'f', objectid: '1', clock: gap[0] + 25 * 3600, value: 0 },
      ],
      items: [{ itemid: 'i101', hostid: '101', key_: 'icmpping', delay: '1m', value_type: '3' }],
      trends,
    });
    const { computeSli } = await import('../sli/engine.js');
    const r = await computeSli({ month: '2026-08', profile: 'availability' });

    const sw = r.hosts.find((h) => h.hostid === '101')!;
    expect(sw.downtime).toBe(5400);
    expect(sw.covered).toBe(MONTH - 2 * 86400);
    expect(sw.sli).toBeCloseTo(100 * (1 - 5400 / (MONTH - 2 * 86400)), 10);
    expect(sw.dataStatus).toBe('ok');

    const wan = r.hosts.find((h) => h.hostid === '103')!;
    expect(wan).toMatchObject({ sli: null, dataStatus: 'nodata', meeting: null });
    // Its items carry no state here, so nothing says it was never measured.
    expect(r.hosts.every((h) => h.measured)).toBe(true);
    // The coverage read and `measured` share one item.get.
    expect(zbxMock.mock.calls.filter(([m]) => m === 'item.get')).toHaveLength(1);
    // The silent host is excluded from the mean, not counted as 100% or 0%.
    expect(r.overall).toMatchObject({ hosts: 2, withData: 1 });
    expect(r.overall.sli).toBeCloseTo(sw.sli!, 10);
    expect(r.wanPaths[0]).toMatchObject({ name: 'SAMPANG', dataStatus: 'nodata' });
    // Everyone was silent during the gap → it is reported as an estate gap.
    expect(r.gaps).toEqual([{ from: gap[0], to: gap[1] }]);
  });

  it('refuses a month that has not started', async () => {
    serve({ triggers: [], parents: {}, events: [] });
    const { computeSli } = await import('../sli/engine.js');
    await expect(computeSli({ month: '2027-01', profile: 'availability' })).rejects.toThrow('not started');
  });
});

describe('computeSli: a span declared not measured (SLA_NO_DATA_WINDOWS)', () => {
  const declared: [number, number] = [AUG.from + 3000, AUG.from + 6000];
  // Down from 3600 to 9000 s into the month, half of it inside the declared span.
  const events = [
    { eventid: 'a', objectid: '1', clock: AUG.from + 3600, value: 1 },
    { eventid: 'b', objectid: '1', clock: AUG.from + 9000, value: 0 },
  ];
  const declare = async (spans: [number, number][]) => {
    const { config } = await import('../core/config.js');
    config.sla.noDataWindows = spans;
  };
  afterEach(() => declare([]));

  it('is left out of the strict figure, downtime and measured time alike, and is listed apart from the collection gaps', async () => {
    const trends = [];
    for (let h = AUG.from; h < AUG.to; h += 3600) trends.push({ itemid: 'i101', clock: h, num: 60 });
    serve({
      triggers: [trig('1', '101', '1.2.1 IDX02CORESWITCH', 'Unavailable by ICMP ping')],
      parents: { '101': ['Cisco IOS by SNMP'] },
      events,
      items: [{ itemid: 'i101', hostid: '101', key_: 'icmpping', delay: '1m', value_type: '3' }],
      trends,
    });
    await declare([declared]);
    const { computeSli } = await import('../sli/engine.js');
    const r = await computeSli({ month: '2026-08', profile: 'availability' });

    const sw = r.hosts[0]!;
    expect(sw.downtime).toBe(9000 - 6000);
    expect(sw.covered).toBe(MONTH - 3000);
    expect(sw.sli).toBeCloseTo(100 * (1 - 3000 / (MONTH - 3000)), 10);
    expect(sw.dataStatus).toBe('ok');
    expect(r.noDataWindows).toEqual([{ from: declared[0], to: declared[1] }]);
    expect(r.gaps).toEqual([]);
  });

  it('counts as up in HCML’s method: no downtime inside it, and the month keeps its length', async () => {
    serve({ triggers: [trig('1', '101', '1.2.1 IDX02CORESWITCH', 'High ICMP ping loss')], parents: { '101': ['Cisco IOS by SNMP'] }, events });
    await declare([declared]);
    const { computeSli } = await import('../sli/engine.js');
    const r = await computeSli({ month: '2026-08', profile: 'hcml-report' });

    expect(r.hosts[0]!.downtime).toBe(9000 - 6000);
    expect(r.hosts[0]!.sli).toBeCloseTo(100 * (1 - 3000 / MONTH), 10);
    expect(r.noDataWindows).toEqual([{ from: declared[0], to: declared[1] }]);
  });
});

describe('fetchEventsSliced', () => {
  it('splits a full page instead of accepting it, and returns every event exactly once', async () => {
    const events = Array.from({ length: 12 }, (_, i) => ({ eventid: String(i), objectid: '1', clock: 1_000 + i * 100, value: 1 }));
    serve({ triggers: [], parents: {}, events });
    const { fetchEventsSliced } = await import('../sli/events.js');
    const rows = await fetchEventsSliced<{ eventid: string }>({ objectids: ['1'] }, 1_000, 2_200, { pageLimit: 5 });
    expect(rows.map((r) => r.eventid)).toEqual(events.map((e) => e.eventid));
    expect(zbxMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('throws rather than return a partial answer when a slice cannot be split further', async () => {
    const events = Array.from({ length: 6 }, (_, i) => ({ eventid: String(i), objectid: '1', clock: 1_000, value: 1 }));
    serve({ triggers: [], parents: {}, events });
    const { fetchEventsSliced } = await import('../sli/events.js');
    await expect(
      fetchEventsSliced({ objectids: ['1'] }, 1_000, 1_010, { pageLimit: 5, minSliceSeconds: 60 }),
    ).rejects.toThrow('too dense');
  });
});

describe('fetchTrendsSliced', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `i${i + 1}`);

  it('sends a request that fits exactly as it was, and a month of 35 items still fits one', async () => {
    const { trendSlices } = await import('../sli/events.js');
    expect(trendSlices(['1', '2'], 1_000, 90_000)).toEqual([{ itemids: ['1', '2'], from: 1_000, to: 90_000 }]);
    // The SLA coverage read: 135 items over August, as four chunks of 35 and no time split.
    const month = trendSlices(ids(135), AUG.from, AUG.to);
    expect(month.map((s) => s.itemids.length)).toEqual([35, 35, 35, 30]);
    expect(month.every((s) => s.from === AUG.from && s.to === AUG.to)).toBe(true);
    expect(trendSlices([], 0, 100)).toEqual([]);
    expect(trendSlices(['1'], 100, 99)).toEqual([]);
  });

  it('cuts a year into hour-aligned windows that meet without overlapping, none over the row limit', async () => {
    const { trendSlices, hourMarks, TREND_MAX_ROWS } = await import('../sli/events.js');
    const to = AUG.to + 1234;
    const from = to - 365 * 86_400;
    const slices = trendSlices(ids(135), from, to);
    const windows = [...new Map(slices.map((s) => [s.from, s])).values()];
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].from).toBe(from);
    expect(windows[windows.length - 1].to).toBe(to);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].from).toBe(windows[i - 1].to + 1);
      expect(windows[i].from % 3600).toBe(0);
    }
    for (const s of slices) expect(s.itemids.length * hourMarks(s.from, s.to)).toBeLessThanOrEqual(TREND_MAX_ROWS);
    // Every item in every window, once.
    expect(slices).toHaveLength(windows.length * 4);
  });

  it('returns every row exactly once across item chunks and windows, or hands them to onRows', async () => {
    const itemids = ids(40);
    const from = 3 * 3600 + 1_000; // mid-hour
    const to = 33 * 3600; // on the hour: inclusive, as Zabbix treats it
    const trends = itemids.flatMap((itemid) =>
      Array.from({ length: 40 }, (_, h) => ({ itemid, clock: h * 3600, num: 60 })),
    );
    serve({ triggers: [], parents: {}, events: [], trends });
    const { fetchTrendsSliced } = await import('../sli/events.js');

    let requests = 0;
    const rows = await fetchTrendsSliced<{ itemid: string; clock: string }>(itemids, from, to, ['itemid', 'clock', 'num'], {
      maxRows: 35 * 10,
      parallel: 3,
      onRequest: () => requests++,
    });
    const keys = rows.map((r) => `${r.itemid}@${r.clock}`);
    const expected = trends.filter((r) => r.clock >= from && r.clock <= to).map((r) => `${r.itemid}@${r.clock}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...expected].sort());
    expect(requests).toBe(zbxMock.mock.calls.length);
    expect(requests).toBe(6); // 30 hour marks in windows of 10 × chunks of 35 and 5
    // Window by window in time order.
    const clocks = rows.filter((r) => r.itemid === 'i1').map((r) => Number(r.clock));
    expect(clocks).toEqual([...clocks].sort((a, b) => a - b));

    const folded: string[] = [];
    const none = await fetchTrendsSliced<{ itemid: string; clock: string }>(itemids, from, to, ['itemid', 'clock'], {
      maxRows: 35 * 10,
      onRows: (part) => folded.push(...part.map((r) => `${r.itemid}@${r.clock}`)),
    });
    expect(none).toEqual([]);
    expect(folded.sort()).toEqual([...expected].sort());
  });
});

describe('computeSli: planned maintenance (tracker BK-05)', () => {
  it('leaves maintenance windows out of downtime and total, for hosts named directly or through a group', async () => {
    const A = AUG.from;
    const D = 86400;
    serve({
      triggers: [
        trig('1', '101', '1.2.1 IDX02CORESWITCH', 'High ICMP ping loss'),
        trig('2', '102', '4.3.3 FPSO ARUBA 3', 'High ICMP ping loss'),
        trig('3', '103', 'INET : SAMPANG WAN 1', 'High ICMP ping loss'),
      ],
      parents: {},
      events: [
        // An hour down, wholly inside host 101's day of maintenance.
        { eventid: 'a', objectid: '1', clock: A + 10 * D + 3600, value: 1 },
        { eventid: 'b', objectid: '1', clock: A + 10 * D + 7200, value: 0 },
        // An hour down, half inside host 102's hour of maintenance.
        { eventid: 'c', objectid: '2', clock: A + 5 * D + 1800, value: 1 },
        { eventid: 'd', objectid: '2', clock: A + 5 * D + 5400, value: 0 },
        // Host 103 has no maintenance: its hour counts in full.
        { eventid: 'e', objectid: '3', clock: A + 2 * D, value: 1 },
        { eventid: 'f', objectid: '3', clock: A + 2 * D + 3600, value: 0 },
      ],
      maintenance: [
        {
          maintenanceid: '1', active_since: String(A - D), active_till: String(A + 40 * D),
          timeperiods: [{ timeperiod_type: '0', start_date: String(A + 10 * D), period: String(D) }],
          hosts: [{ hostid: '101' }], hostgroups: [],
        },
        {
          maintenanceid: '2', active_since: String(A - D), active_till: String(A + 40 * D),
          timeperiods: [{ timeperiod_type: '0', start_date: String(A + 5 * D), period: '3600' }],
          hosts: [], hostgroups: [{ groupid: '7' }],
        },
      ],
      groups: [{ groupid: '7', hosts: [{ hostid: '102' }] }],
    });
    const { computeSli } = await import('../sli/engine.js');
    const r = await computeSli({ month: '2026-08', profile: 'hcml-report' });
    const byName = Object.fromEntries(r.hosts.map((h) => [h.name, h]));

    expect(byName['1.2.1 IDX02CORESWITCH']).toMatchObject({ downtime: 0, sli: 100, maintenance: D });
    expect(byName['4.3.3 FPSO ARUBA 3']).toMatchObject({ downtime: 1800, maintenance: 3600 });
    expect(byName['4.3.3 FPSO ARUBA 3'].sli).toBeCloseTo(100 * (1 - 1800 / (MONTH - 3600)), 10);
    expect(byName['INET : SAMPANG WAN 1']).toMatchObject({ downtime: 3600, maintenance: 0 });
    expect(byName['INET : SAMPANG WAN 1'].sli).toBeCloseTo(100 * (1 - 3600 / MONTH), 10);
    expect(r.basis.maintenancePolicy).toBe('excluded');
  });
});

describe('computeSli: a trigger set to multiple PROBLEM events (BK-46)', () => {
  const eventCalls = () => zbxMock.mock.calls.filter(([m]) => m === 'event.get').map(([, p]) => p as Params);
  const asked = () => eventCalls().filter((p) => p.sortorder === 'DESC');

  it('counts the time before a repeated PROBLEM as down when the last event before the window was a PROBLEM', async () => {
    serve({
      triggers: [trig('1', '101', '1.2.1 IDX02CORESWITCH', 'High ICMP ping loss', { type: '1', value: '0' })],
      parents: { '101': ['Cisco IOS by SNMP'] },
      events: [
        { eventid: 'a', objectid: '1', clock: AUG.from - 5000, value: 1 },
        { eventid: 'b', objectid: '1', clock: AUG.from + 1000, value: 1 },
        { eventid: 'c', objectid: '1', clock: AUG.from + 3000, value: 0 },
      ],
    });
    const { computeSli } = await import('../sli/engine.js');
    const r = await computeSli({ month: '2026-08', profile: 'hcml-report' });
    expect(r.hosts[0]).toMatchObject({ downtime: 3000, incidents: 1 });
  });

  it('starts the outage at the first PROBLEM in the window when the last event before it was an OK', async () => {
    serve({
      triggers: [trig('1', '101', '1.2.1 IDX02CORESWITCH', 'High ICMP ping loss', { type: '1' })],
      parents: { '101': ['Cisco IOS by SNMP'] },
      events: [
        { eventid: 'a', objectid: '1', clock: AUG.from - 5000, value: 0 },
        { eventid: 'b', objectid: '1', clock: AUG.from + 1000, value: 1 },
        { eventid: 'c', objectid: '1', clock: AUG.from + 3000, value: 0 },
      ],
    });
    const { computeSli } = await import('../sli/engine.js');
    const r = await computeSli({ month: '2026-08', profile: 'hcml-report' });
    expect(r.hosts[0]).toMatchObject({ downtime: 2000, incidents: 1 });
  });

  it('starts it there too when there was no event before the window at all', async () => {
    serve({
      triggers: [trig('1', '101', '1.2.1 IDX02CORESWITCH', 'High ICMP ping loss', { type: '1' })],
      parents: { '101': ['Cisco IOS by SNMP'] },
      events: [
        { eventid: 'b', objectid: '1', clock: AUG.from + 1000, value: 1 },
        { eventid: 'c', objectid: '1', clock: AUG.from + 3000, value: 0 },
      ],
    });
    const { computeSli } = await import('../sli/engine.js');
    const r = await computeSli({ month: '2026-08', profile: 'hcml-report' });
    expect(r.hosts[0]).toMatchObject({ downtime: 2000, incidents: 1 });
  });

  it('asks for the event before the window once for each such trigger, newest first, one row, and for no other trigger', async () => {
    serve({
      triggers: [
        trig('1', '101', '1.2.1 IDX02CORESWITCH', 'High ICMP ping loss', { type: '1' }),
        // Single PROBLEM events: a first PROBLEM is always the start, nothing to ask.
        trig('2', '102', '4.3.3 FPSO ARUBA 3', 'High ICMP ping loss', { type: '0' }),
        // Its first event is an OK, which always ends a problem: nothing to ask either.
        trig('3', '103', 'INET : SAMPANG WAN 1', 'High ICMP ping loss', { type: '1' }),
        // No events in the window.
        trig('4', '104', '2.1.1 SOMEWHERE', 'High ICMP ping loss', { type: '1' }),
      ],
      parents: {},
      events: [
        { eventid: 'a', objectid: '1', clock: AUG.from + 1000, value: 1 },
        { eventid: 'b', objectid: '2', clock: AUG.from + 1000, value: 1 },
        { eventid: 'c', objectid: '3', clock: AUG.from + 1000, value: 0 },
      ],
    });
    const { computeSli } = await import('../sli/engine.js');
    await computeSli({ month: '2026-08', profile: 'hcml-report' });
    expect(asked()).toHaveLength(1);
    expect(asked()[0]).toMatchObject({ objectids: ['1'], time_till: AUG.from - 1, sortorder: 'DESC', limit: 1 });
    expect(asked()[0]!.time_from).toBeUndefined();
  });

  it('asks nothing extra when no trigger is set to multiple PROBLEM events', async () => {
    serve({
      triggers: [trig('1', '101', '1.2.1 IDX02CORESWITCH', 'High ICMP ping loss')],
      parents: {},
      events: [{ eventid: 'a', objectid: '1', clock: AUG.from + 1000, value: 1 }],
    });
    const { computeSli } = await import('../sli/engine.js');
    await computeSli({ month: '2026-08', profile: 'hcml-report' });
    expect(asked()).toEqual([]);
  });

  it('reads the type of each trigger from Zabbix', async () => {
    serve({ triggers: [], parents: {}, events: [] });
    const { computeSli } = await import('../sli/engine.js');
    await computeSli({ month: '2026-08', profile: 'hcml-report' });
    const call = zbxMock.mock.calls.find(([m]) => m === 'trigger.get')!;
    expect((call[1] as Params).output).toContain('type');
  });
});

describe('computeSli: the hours after the last trend row, in an open month (BK-46)', () => {
  const SEP_FROM = AUG.to;
  const NOW = Date.parse('2026-09-17T03:20:00Z') / 1000;
  const HOUR = Math.floor(NOW / 3600) * 3600;
  const world = (lastTrend: number, historyFrom: number) => {
    const trends = [];
    for (let h = SEP_FROM; h <= lastTrend; h += 3600) trends.push({ itemid: 'i101', clock: h, num: 60 });
    const history = [];
    for (let c = historyFrom; c < NOW; c += 60) history.push({ itemid: 'i101', clock: c });
    serve({
      triggers: [trig('1', '101', '1.2.1 IDX02CORESWITCH', 'Unavailable by ICMP ping')],
      parents: { '101': ['Cisco IOS by SNMP'] },
      events: [],
      items: [{ itemid: 'i101', hostid: '101', key_: 'icmpping', delay: '1m', value_type: '3' }],
      trends,
      history,
    });
    return trends.length * 3600;
  };
  const historyCalls = () => zbxMock.mock.calls.filter(([m]) => m === 'history.get').map(([, p]) => p as Params);

  beforeEach(() => vi.setSystemTime(new Date(NOW * 1000)));

  it('reads the hours after the last trend row from history when it is within six hours of the end', async () => {
    const fromTrends = world(HOUR - 3 * 3600, HOUR - 2 * 3600);
    const { computeSli } = await import('../sli/engine.js');
    const r = await computeSli({ month: '2026-09', profile: 'availability' });
    expect(r.hosts[0]!.covered).toBe(fromTrends + 2 * 3600 + 1200);
    expect(historyCalls().every((p) => p.time_from === HOUR - 2 * 3600)).toBe(true);
  });

  it('reads the hour in progress, and no more, when the last trend row is older than that', async () => {
    const fromTrends = world(HOUR - 10 * 3600, HOUR - 9 * 3600);
    const { computeSli } = await import('../sli/engine.js');
    const r = await computeSli({ month: '2026-09', profile: 'availability' });
    expect(r.hosts[0]!.covered).toBe(fromTrends + 1200);
    expect(historyCalls().length).toBeGreaterThan(0);
    expect(historyCalls().every((p) => p.time_from === HOUR && p.time_till === NOW)).toBe(true);
  });

  it('reads the hour in progress when there is no trend row at all', async () => {
    world(SEP_FROM - 3600, HOUR);
    const { computeSli } = await import('../sli/engine.js');
    const r = await computeSli({ month: '2026-09', profile: 'availability' });
    expect(r.hosts[0]!.covered).toBe(1200);
  });
});
