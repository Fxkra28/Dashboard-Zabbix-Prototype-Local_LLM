import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The any-problem availability basis and the alert noise report read Zabbix events from before the
 * window's first second, so a device that went down before the window shows its downtime and a
 * problem open for weeks is flagged as chronic. A small fake Zabbix answers `event.get` and
 * `problem.get` the way the real one does: by clock bounds, value, severity floor, event ids and
 * page limit.
 */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

const { getAvailability } = await import('../services/availability.js');
const { getNoise } = await import('../services/noise.js');
const { OPEN_AT_START_LOOKBACK, LONG_OUTAGE_LOOKUPS } = await import('../services/incidents.js');

const DAY = 86_400;
const NOW = Math.floor(Date.parse('2026-09-17T03:00:00Z') / 1000);
/** The 7-day window both reports use below. */
const FROM = NOW - 7 * DAY;

type Params = Record<string, unknown>;

interface FakeEvent {
  eventid: string;
  objectid: string;
  clock: number;
  value: '0' | '1';
  severity: string;
  r_eventid: string;
  acknowledged: string;
  name: string;
  hosts: { hostid: string; name: string }[];
}

let store: FakeEvent[] = [];
let seq = 100_000;
const nextId = () => String(++seq);

/**
 * A problem that began at `start`. `end` adds its recovery event; with
 * `lostRecovery` the problem points at a recovery event Zabbix no longer has.
 */
function problem(o: {
  host: string;
  trigger?: string;
  start: number;
  end?: number;
  severity?: string;
  lostRecovery?: boolean;
}): FakeEvent {
  const eventid = nextId();
  let r_eventid = '0';
  if (o.end !== undefined) {
    r_eventid = nextId();
    // Zabbix gives a recovery event severity 0 whatever the trigger's priority (seen in HCML's data).
    store.push({ ...base(r_eventid, o), clock: o.end, value: '0', r_eventid: '0', severity: '0' });
  } else if (o.lostRecovery) {
    r_eventid = nextId();
  }
  const p = { ...base(eventid, o), clock: o.start, value: '1' as const, r_eventid };
  store.push(p);
  return p;
}

function base(eventid: string, o: { host: string; trigger?: string; severity?: string }) {
  return {
    eventid,
    objectid: o.trigger ?? `trig-${o.host}`,
    clock: 0,
    value: '1' as const,
    severity: o.severity ?? '2',
    r_eventid: '0',
    acknowledged: '0',
    name: `Problem on ${o.host}`,
    hosts: [{ hostid: `h-${o.host}`, name: o.host }],
  };
}

/** Only what `output` and `selectHosts` ask for, as strings: a field the code forgot to request is missing here too. */
function project(e: FakeEvent, p: Params): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of p.output as string[]) out[f] = f === 'clock' ? String(e.clock) : (e as unknown as Record<string, unknown>)[f];
  if (p.selectHosts) out.hosts = e.hosts;
  return out;
}

function answer(method: string, p: Params): unknown {
  if (method === 'event.get') {
    const ids = p.eventids ? new Set(p.eventids as string[]) : undefined;
    let rows = store.filter((e) => !ids || ids.has(e.eventid));
    if (p.value !== undefined) rows = rows.filter((e) => e.value === String(p.value));
    if (p.objectids) rows = rows.filter((e) => (p.objectids as string[]).includes(e.objectid));
    if (p.severities) rows = rows.filter((e) => (p.severities as number[]).includes(Number(e.severity)));
    if (p.time_from !== undefined) rows = rows.filter((e) => e.clock >= (p.time_from as number));
    if (p.time_till !== undefined) rows = rows.filter((e) => e.clock <= (p.time_till as number));
    rows.sort((a, b) => a.clock - b.clock || Number(a.eventid) - Number(b.eventid));
    if (p.sortorder === 'DESC') rows.reverse();
    if (p.limit) rows = rows.slice(0, p.limit as number);
    return rows.map((e) => project(e, p));
  }
  if (method === 'trigger.get') {
    // The priority of a trigger is that of its problems here: the fake has no trigger table.
    const wanted = new Set(p.triggerids as string[]);
    const seen = new Map<string, string>();
    for (const e of store) if (e.value === '1' && wanted.has(e.objectid)) seen.set(e.objectid, e.severity);
    return [...seen].map(([triggerid, priority]) => ({ triggerid, priority }));
  }
  if (method === 'problem.get') {
    // Unresolved problems only: Zabbix's default without `recent`.
    let rows = store.filter((e) => e.value === '1' && e.r_eventid === '0');
    if (p.severities) rows = rows.filter((e) => (p.severities as number[]).includes(Number(e.severity)));
    if (p.time_till !== undefined) rows = rows.filter((e) => e.clock <= (p.time_till as number));
    return rows.map((e) => project(e, p));
  }
  return [];
}

/** The fake Zabbix, with an answer replaced for the methods named in `over`. */
function fakeZabbix(over: Record<string, (p: Params) => unknown> = {}): void {
  zbxMock.mockImplementation(async (method: string, p: Params) => (over[method] ?? ((q) => answer(method, q)))(p));
}

const callsOf = (method: string) => zbxMock.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Params);

beforeEach(() => {
  store = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW * 1000));
  fakeZabbix();
});

afterEach(() => {
  zbxMock.mockReset();
  vi.useRealTimers();
});

describe('any-problem availability and a span declared not measured (SLA_NO_DATA_WINDOWS)', () => {
  const declare = async (spans: [number, number][]) => {
    const { config } = await import('../core/config.js');
    config.sla.noDataWindows = spans;
  };
  afterEach(() => declare([]));

  it('counts no downtime inside the span: a problem across it keeps its outside part, one inside it is not counted', async () => {
    problem({ host: 'ECHO', start: FROM + 3600, end: FROM + 3 * 3600 });
    problem({ host: 'FOXTROT', start: FROM + 2.5 * 3600, end: FROM + 3.5 * 3600 });
    await declare([[FROM + 2 * 3600, FROM + 4 * 3600]]);
    const report = await getAvailability(7, 2);
    expect(report.hosts).toEqual([expect.objectContaining({ host: 'ECHO', downtime: 3600, incidents: 1 })]);
    expect(report.noDataWindows).toEqual([{ from: FROM + 2 * 3600, to: FROM + 4 * 3600 }]);
  });
});

describe('any-problem availability and problems that began before the window', () => {
  it('counts a problem already open when the window began, from the window start', async () => {
    problem({ host: 'ALPHA', start: FROM - 3 * DAY });
    const report = await getAvailability(7, 2);
    expect(report.hosts).toEqual([
      expect.objectContaining({ host: 'ALPHA', downtime: 7 * DAY, incidents: 1, longest: 7 * DAY, availability: 0 }),
    ]);
  });

  it('counts only the part of a problem that ended inside the window', async () => {
    problem({ host: 'BRAVO', start: FROM - 5 * DAY, end: FROM + 2 * DAY });
    const [h] = (await getAvailability(7, 2)).hosts;
    expect(h).toMatchObject({ host: 'BRAVO', downtime: 2 * DAY, incidents: 1 });
    expect(h.availability).toBeCloseTo(100 * (1 - 2 / 7), 6);
  });

  it('leaves out a problem that ended before the window, or exactly as it began', async () => {
    problem({ host: 'CHARLIE', start: FROM - 5 * DAY, end: FROM - DAY });
    problem({ host: 'DELTA', start: FROM - 5 * DAY, end: FROM });
    expect((await getAvailability(7, 2)).hosts).toEqual([]);
  });

  it('does not assume a problem from before the window is still open when its recovery cannot be found', async () => {
    problem({ host: 'ECHO', start: FROM - 5 * DAY, lostRecovery: true });
    expect((await getAvailability(7, 2)).hosts).toEqual([]);
  });

  it('finds a problem still open from before the look-back, however old, without reading months of events', async () => {
    problem({ host: 'FOXTROT', start: FROM - 90 * DAY });
    // Over before the look-back began: not open at the window start, and never fetched.
    problem({ host: 'GOLF', start: FROM - 120 * DAY, end: FROM - 100 * DAY });
    const report = await getAvailability(7, 2);
    expect(report.hosts.map((h) => [h.host, h.downtime])).toEqual([['FOXTROT', 7 * DAY]]);

    const [open] = callsOf('problem.get');
    expect(open).toMatchObject({ time_till: FROM - OPEN_AT_START_LOOKBACK - 1, severities: [2, 3, 4, 5] });
    // Its events come back by id, hosts included, and no event read goes further back than the look-back.
    expect(callsOf('event.get').some((p) => Array.isArray(p.eventids) && p.selectHosts)).toBe(true);
    for (const p of callsOf('event.get')) {
      if (p.time_from !== undefined) expect(p.time_from as number).toBeGreaterThanOrEqual(FROM - OPEN_AT_START_LOOKBACK);
    }
  });

  it('counts a problem once even when two of the reads return it', async () => {
    // A problem raised exactly at the look-back boundary is inside the event read; ask for the older
    // read to include it too by making problem.get ignore its time bound.
    const p = problem({ host: 'HOTEL', start: FROM - OPEN_AT_START_LOOKBACK });
    fakeZabbix({ 'problem.get': () => [{ eventid: p.eventid }] });
    const report = await getAvailability(7, 2);
    expect(report.hosts).toEqual([expect.objectContaining({ host: 'HOTEL', incidents: 1, downtime: 7 * DAY })]);
  });

  it('still counts what happens inside the window as before', async () => {
    problem({ host: 'INDIA', start: FROM + DAY, end: FROM + DAY + 3600 });
    problem({ host: 'INDIA', trigger: 'other', start: FROM + 2 * DAY });
    const [h] = (await getAvailability(7, 2)).hosts;
    expect(h).toMatchObject({ host: 'INDIA', incidents: 2, downtime: 3600 + 5 * DAY });
  });

  it('pushes the severity floor and the look-back bounds down to Zabbix', async () => {
    await getAvailability(7, 3);
    const reads = callsOf('event.get').filter((p) => p.time_from !== undefined);
    // The problems of the window, the look-back before it, and the window's recoveries.
    expect(reads.map((p) => [p.time_from, p.time_till, p.value])).toEqual([
      [FROM, NOW, 1],
      [FROM - OPEN_AT_START_LOOKBACK, FROM - 1, 1],
      [FROM, NOW, 0],
    ]);
    for (const p of [...reads.filter((r) => r.value === 1), ...callsOf('problem.get')]) expect(p.severities).toEqual([3, 4, 5]);
    // Not on the recoveries: Zabbix stores severity 0 on them, so a floor there returns none.
    expect(reads.find((r) => r.value === 0)).not.toHaveProperty('severities');
  });

  it('measures a calendar month the same way: open at the month start counts for the whole month', async () => {
    problem({ host: 'JULIET', start: Date.parse('2026-07-20T00:00:00Z') / 1000 });
    const report = await getAvailability(7, 2, '2026-08');
    expect(report.hosts).toEqual([
      expect.objectContaining({ host: 'JULIET', downtime: report.windowSeconds, availability: 0 }),
    ]);
  });
});

describe('alert noise and problems that began before the window', () => {
  it('flags a problem open for weeks as chronic, though it began before the window', async () => {
    problem({ host: 'KILO', trigger: 'stuck', start: FROM - 20 * DAY });
    const report = await getNoise(7, 0);
    expect(report).toMatchObject({ totalEvents: 1, distinctTriggers: 1, counts: { chronic: 1 } });
    expect(report.triggers[0]).toMatchObject({
      objectid: 'stuck',
      count: 1,
      stillOpen: true,
      longest: 7 * DAY,
      flags: ['chronic'],
    });
  });

  it('judges an open problem by its real age, so a 1 day report can still flag it as chronic', async () => {
    // The window holds a day of it at most, which is not "more than a day".
    problem({ host: 'KILO', trigger: 'stuck', start: NOW - 20 * DAY });
    problem({ host: 'LIMA', trigger: 'old-enough', start: NOW - 30 * 3600 });
    problem({ host: 'MIKE', trigger: 'recent', start: NOW - 10 * 3600 });
    const report = await getNoise(1, 0);
    const flags = Object.fromEntries(report.triggers.map((t) => [t.objectid, t.flags]));
    expect(flags).toEqual({ stuck: ['chronic'], 'old-enough': ['chronic'], recent: [] });
    expect(report.counts.chronic).toBe(2);
    // The figures still describe the window, not the problem's whole life.
    expect(report.triggers.find((t) => t.objectid === 'stuck')).toMatchObject({ longest: DAY, totalDuration: DAY });
  });

  it('does not let the age of a resolved problem make a young open one chronic', async () => {
    problem({ host: 'NOVEMBER', trigger: 'mixed', start: NOW - 20 * DAY, end: NOW - 23 * 3600 });
    problem({ host: 'NOVEMBER', trigger: 'mixed', start: NOW - 2 * 3600 });
    const [t] = (await getNoise(1, 0)).triggers;
    expect(t).toMatchObject({ objectid: 'mixed', count: 2, stillOpen: true, flags: [] });
  });

  it('does not report one that was over before the window', async () => {
    problem({ host: 'LIMA', trigger: 'gone', start: FROM - 20 * DAY, end: FROM - 10 * DAY });
    expect((await getNoise(7, 0)).totalEvents).toBe(0);
  });

  it('adds a problem open from before to the firings inside the window for the same trigger', async () => {
    problem({ host: 'MIKE', trigger: 'flappy', start: FROM - 2 * DAY, end: FROM + 600 });
    problem({ host: 'MIKE', trigger: 'flappy', start: FROM + DAY, end: FROM + DAY + 60 });
    const [t] = (await getNoise(7, 0)).triggers;
    expect(t).toMatchObject({ objectid: 'flappy', count: 2, stillOpen: false, longest: 600 });
  });
});

describe('grouping stays linear', () => {
  /** Open problems on `triggers` triggers, `n` in all, and how long the noise report over them took. */
  async function timedNoise(n: number, triggers: number) {
    store = [];
    for (let i = 0; i < n; i++) {
      store.push({ ...base(nextId(), { host: 'NOVEMBER', trigger: `busy-${i % triggers}` }), clock: FROM + 10 + i * 9, value: '1', r_eventid: '0' });
    }
    const started = performance.now();
    const report = await getNoise(7, 0);
    return { report, ms: performance.now() - started };
  }

  it('groups 60,000 incidents of one trigger as fast as 60,000 of different triggers', async () => {
    // Copying the list on every add would make the one-trigger run about 30 times slower and block
    // every other request meanwhile. Comparing two runs of the same size keeps a busy machine from
    // failing the test: both slow down together.
    const many = await timedNoise(60_000, 60_000);
    const one = await timedNoise(60_000, 1);
    expect(many.report.distinctTriggers).toBe(60_000);
    expect(one.report.triggers[0]).toMatchObject({ objectid: 'busy-0', count: 60_000 });
    expect(one.ms).toBeLessThan(5 * many.ms + 1_000);
  }, 60_000); // two runs over 60,000 rows each: more than vitest's 5 s default on a busy machine
});

describe('any-problem availability at the end of a closed month', () => {
  const MONTH_TO = Date.parse('2026-08-31T17:00:00Z') / 1000; // 2026-09-01 00:00 Jakarta
  const resolvedLater = Date.parse('2026-09-10T00:00:00Z') / 1000;

  it('stops counting at the month end for a problem resolved after it', async () => {
    const began = Date.parse('2026-08-20T00:00:00Z') / 1000;
    problem({ host: 'OSCAR', start: began, end: resolvedLater });
    const [h] = (await getAvailability(7, 2, '2026-08')).hosts;
    expect(h.downtime).toBe(MONTH_TO - began);
  });

  it('counts a month in full, no more, for one open before it that was resolved after it', async () => {
    problem({ host: 'PAPA', start: Date.parse('2026-07-20T00:00:00Z') / 1000, end: resolvedLater });
    const report = await getAvailability(7, 2, '2026-08');
    expect(report.hosts).toEqual([expect.objectContaining({ host: 'PAPA', downtime: report.windowSeconds, availability: 0 })]);
  });
});

describe('reads by event id stay small', () => {
  const idsOf = (p: Params) => p.eventids as string[];

  it('asks for the recoveries that fall outside the window 2,000 ids at a time', async () => {
    // A closed month, with every problem resolved after it ended: those recoveries are not in the
    // window's own read, so they are asked for by id.
    const augFrom = Date.parse('2026-07-31T17:00:00Z') / 1000;
    const after = Date.parse('2026-09-10T00:00:00Z') / 1000;
    for (let i = 0; i < 2_500; i++) problem({ host: `R${i}`, start: augFrom + 100 + i, end: after + i });
    const report = await getAvailability(7, 2, '2026-08');
    expect(report.hosts).toHaveLength(2_500);

    const reads = callsOf('event.get').filter((p) => Array.isArray(p.eventids) && !p.selectHosts);
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const p of reads) expect(idsOf(p).length).toBeLessThanOrEqual(2_000);
  });

  it('does not ask again for recoveries the window read already returned', async () => {
    for (let i = 0; i < 50; i++) problem({ host: `X${i}`, start: FROM + 100 + i, end: FROM + 5_000 + i });
    expect((await getAvailability(7, 2)).hosts).toHaveLength(50);
    expect(callsOf('event.get').filter((p) => Array.isArray(p.eventids) && !p.selectHosts)).toEqual([]);
  });

  it('fetches the problems still open from before the look-back 2,000 ids at a time', async () => {
    for (let i = 0; i < 2_100; i++) problem({ host: `S${i}`, start: FROM - 90 * DAY - i });
    const report = await getAvailability(7, 2);
    expect(report.hosts).toHaveLength(2_100);
    expect(report.hosts.every((h) => h.downtime === 7 * DAY)).toBe(true);

    const reads = callsOf('event.get').filter((p) => Array.isArray(p.eventids) && p.selectHosts);
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const p of reads) expect(idsOf(p).length).toBeLessThanOrEqual(2_000);
  });
});

describe('an outage that began before the look-back and ended inside the window (BK-04)', () => {
  /** The one-by-one reads: an event.get that names a trigger. */
  const lookups = () => callsOf('event.get').filter((p) => p.objectids !== undefined);

  it('is counted from the window start to its end, by the any-problem availability and the alert noise report', async () => {
    problem({ host: 'QUEBEC', trigger: 'long', start: FROM - 60 * DAY, end: FROM + 2 * DAY });
    const [h] = (await getAvailability(7, 2)).hosts;
    expect(h).toMatchObject({ host: 'QUEBEC', downtime: 2 * DAY, incidents: 1 });
    const noise = await getNoise(7, 0);
    expect(noise.triggers[0]).toMatchObject({ objectid: 'long', count: 1, stillOpen: false, longest: 2 * DAY });
    expect(noise.truncated).toBe(false);
  });

  it('takes the problem this recovery closed, not an earlier one of the same trigger', async () => {
    problem({ host: 'ROMEO', trigger: 'again', start: FROM - 100 * DAY, end: FROM - 90 * DAY }); // long over
    problem({ host: 'ROMEO', trigger: 'again', start: FROM - 70 * DAY, end: FROM + DAY }); // ends in the window
    const [h] = (await getAvailability(7, 2)).hosts;
    expect(h).toMatchObject({ host: 'ROMEO', downtime: DAY, incidents: 1 });
  });

  it('asks about nothing when no recovery in the window is left unexplained', async () => {
    problem({ host: 'SIERRA', start: FROM + DAY, end: FROM + 2 * DAY }); // inside the window
    problem({ host: 'TANGO', start: FROM - 5 * DAY, end: FROM + DAY }); // inside the look-back
    problem({ host: 'UNIFORM', start: FROM - 90 * DAY, end: FROM - 40 * DAY }); // over before the window
    await getAvailability(7, 2);
    expect(lookups()).toEqual([]);
    expect(callsOf('trigger.get')).toEqual([]);
  });

  it('asks once for a trigger however many times it recovered in the window, newest problem before the look-back first', async () => {
    problem({ host: 'VICTOR', trigger: 'flap', severity: '4', start: FROM - 60 * DAY, end: FROM + 3_600 });
    for (let i = 0; i < 5; i++) problem({ host: 'VICTOR', trigger: 'flap', severity: '4', start: FROM + DAY + i * 7_200, end: FROM + DAY + i * 7_200 + 60 });
    await getAvailability(7, 3);
    expect(lookups()).toHaveLength(1);
    expect(lookups()[0]).toMatchObject({
      objectids: ['flap'],
      time_till: FROM - OPEN_AT_START_LOOKBACK - 1,
      sortorder: 'DESC',
      limit: 1,
      severities: [3, 4, 5],
    });
  });

  it('leaves out an outage whose older problem does not name this recovery', async () => {
    // The trigger's latest problem before the look-back is over, and the recovery in the window belongs to something else.
    problem({ host: 'WHISKEY', trigger: 'odd', start: FROM - 70 * DAY, end: FROM - 60 * DAY });
    store.push({ ...base(nextId(), { host: 'WHISKEY', trigger: 'odd' }), clock: FROM + 3_600, value: '0', r_eventid: '0' }); // an OK with no problem on record
    expect((await getAvailability(7, 2)).hosts).toEqual([]);
    expect(lookups()).toHaveLength(1);
    // The older problem was not kept, so nothing asks Zabbix for its recovery either.
    expect(callsOf('event.get').filter((p) => Array.isArray(p.eventids) && !p.selectHosts)).toEqual([]);
  });

  it(`looks up at most ${'LONG_OUTAGE_LOOKUPS'} triggers, counts those, and says the figures are a floor`, async () => {
    const n = LONG_OUTAGE_LOOKUPS + 50;
    for (let i = 0; i < n; i++) problem({ host: `Z${i}`, trigger: `t${i}`, start: FROM - 60 * DAY - i, end: FROM + 3_600 + i });
    const report = await getAvailability(7, 2);
    expect(lookups()).toHaveLength(LONG_OUTAGE_LOOKUPS);
    expect(report.hosts).toHaveLength(LONG_OUTAGE_LOOKUPS);
    expect(report.truncated).toBe(true);
  });

  it('does not say truncated when every lookup fitted', async () => {
    for (let i = 0; i < LONG_OUTAGE_LOOKUPS; i++) problem({ host: `Y${i}`, trigger: `t${i}`, start: FROM - 60 * DAY - i, end: FROM + 3_600 + i });
    const report = await getAvailability(7, 2);
    expect(lookups()).toHaveLength(LONG_OUTAGE_LOOKUPS);
    expect(report.hosts).toHaveLength(LONG_OUTAGE_LOOKUPS);
    expect(report.truncated).toBe(false);
  });

  it('reads the recoveries with no severity floor, because Zabbix gives them severity 0, and applies the floor to the triggers', async () => {
    // A High problem from before the look-back, ended in the window, at a floor of 3: a floor on the
    // recovery read would drop its recovery and lose it.
    problem({ host: 'ZULU', trigger: 'high', severity: '4', start: FROM - 60 * DAY, end: FROM + DAY });
    const [h] = (await getAvailability(7, 3)).hosts;
    expect(h).toMatchObject({ host: 'ZULU', downtime: DAY, incidents: 1 });
    expect(callsOf('trigger.get')).toEqual([{ triggerids: ['high'], output: ['triggerid', 'priority'] }]);
  });

  it('drops the triggers under the floor with one batched read of their priority, not a lookup each', async () => {
    // 300 triggers at severity 2 recovered in the window, with floor 3: nothing of theirs was read as a problem,
    // so every recovery is unexplained, and none is worth a lookup.
    for (let i = 0; i < 300; i++) problem({ host: `LOW${i}`, trigger: `low${i}`, severity: '2', start: FROM - 60 * DAY - i, end: FROM + 3_600 + i });
    const report = await getAvailability(7, 3);
    expect(report.hosts).toEqual([]);
    expect(lookups()).toEqual([]);
    expect(callsOf('trigger.get')).toHaveLength(1);
    expect(report.truncated).toBe(false);
  });

  it('asks for trigger priorities 2,000 ids at a time', async () => {
    for (let i = 0; i < 2_100; i++) problem({ host: `P${i}`, trigger: `p${i}`, severity: '2', start: FROM - 60 * DAY - i, end: FROM + 3_600 + i });
    await getAvailability(7, 3);
    const reads = callsOf('trigger.get');
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const p of reads) expect((p.triggerids as string[]).length).toBeLessThanOrEqual(2_000);
  });

  it('works for a calendar month too: an outage from before the look-back that ended during it', async () => {
    problem({ host: 'XRAY', trigger: 'mo', start: Date.parse('2026-06-15T00:00:00Z') / 1000, end: Date.parse('2026-08-03T00:00:00Z') / 1000 });
    const report = await getAvailability(7, 2, '2026-08');
    const [h] = report.hosts;
    expect(h).toMatchObject({ host: 'XRAY', incidents: 1 });
    expect(h.downtime).toBe(Date.parse('2026-08-03T00:00:00Z') / 1000 - (Date.parse('2026-07-31T17:00:00Z') / 1000));
  });

  // The limit the comment on OPEN_AT_START_LOOKBACK states, kept here so a change to it is a decision.
  it('still does not see one that began before the look-back and ended after the window, which takes an outage longer than a month spanning all of it', async () => {
    problem({ host: 'YANKEE', trigger: 'huge', start: Date.parse('2026-06-15T00:00:00Z') / 1000, end: Date.parse('2026-09-10T00:00:00Z') / 1000 });
    expect((await getAvailability(7, 2, '2026-08')).hosts).toEqual([]);
  });
});
