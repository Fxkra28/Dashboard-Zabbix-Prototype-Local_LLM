import { zbx } from '../clients/zabbix.js';
import { config, type SliProfile } from '../core/config.js';
import { BadRequestError } from '../core/validate.js';
import {
  CATEGORY_ORDER,
  DEVICE_CLASS_LABELS,
  categoryLabel,
  deviceClass,
  naturalCompare,
  siteFromHostName,
  wanPairKey,
  type SiteRef,
} from '../domain/naming.js';
import { chunk, fetchEventsSliced, fetchTrendsSliced, mapLimit } from './events.js';
import { maintenanceByHost } from './maintenance.js';
import { checkPeriodStart, hourFloor, monthBounds } from './time.js';
import {
  clipIntervals,
  complementIntervals,
  intersectIntervals,
  mergeIntervals,
  totalSeconds,
  type Interval,
} from './intervals.js';

/**
 * The derived SLA: monthly availability per host, computed from the ICMP
 * triggers every HCML device already carries. HCML's Zabbix has no services
 * configured, so Zabbix's own SLA engine has nothing to measure; this does the
 * measuring in the portal instead, read-only.
 *
 * Two profiles, because HCML's published figures and the truth differ:
 *
 *   hcml-report   Reproduces HCML's Availability Reports exactly. Only "High
 *                 ICMP ping loss" counts; that trigger is defined as loss < 100%
 *                 and so never fires for a device that is completely down.
 *                 Periods with no collected data count as up.
 *
 *   availability  The strict figure. "Unavailable by ICMP ping" or high loss
 *                 counts as down, and hours in which nothing was collected are
 *                 excluded from the measurement instead of being counted as up.
 *                 A host with too little collected data has no figure at all.
 *
 * The per-host arithmetic mirrors Zabbix's own `calculateAvailability`: replay
 * each trigger's PROBLEM/OK events across the window, starting from the state
 * the trigger was already in when the window opened.
 *
 * In both profiles, time inside a planned Zabbix maintenance window is left
 * out of the measurement, downtime and total alike (maintenance.ts).
 */

export type DataStatus = 'ok' | 'partial' | 'nodata';

export interface SliHost {
  hostid: string;
  name: string;
  hostStatus: string;
  site: SiteRef | null;
  category: string;
  deviceClass: string;
  triggerids: string[];
  /** Percent; null when there is too little collected data to say. */
  sli: number | null;
  /** Seconds down inside the measured time. */
  downtime: number;
  /** Seconds in the window (from → min(to, now)). */
  window: number;
  /** Seconds actually measured: the window minus hours with no data and planned maintenance. */
  covered: number;
  /** Seconds of the window inside a planned maintenance window, left out of the figure. */
  maintenance: number;
  coverage: number;
  incidents: number;
  longest: number;
  dataStatus: DataStatus;
  /**
   * False when the host's ICMP has never been collected (`wasMeasured`), judged
   * from its items as they are now. HCML's method still counts such a host as
   * 100 %; the figures do not change, this only says so.
   */
  measured: boolean;
  meeting: boolean | null;
  /** Seconds of downtime the target still allows; negative = missed. */
  errorBudget: number | null;
}

export interface SliGroup {
  key: string;
  name: string;
  hosts: number;
  withData: number;
  /** Plain mean of the hosts' figures, HCML's own rule for every total. */
  sli: number | null;
  downtime: number;
  meeting: boolean | null;
  belowTarget: number;
}

export interface SliPath {
  key: string;
  name: string;
  site: SiteRef | null;
  legs: { hostid: string; name: string; leg: string; sli: number | null; dataStatus: DataStatus }[];
  /** Down only while every leg is down: the point of a redundant pair. */
  sli: number | null;
  downtime: number;
  coverage: number;
  dataStatus: DataStatus;
}

export interface SliWeb {
  itemid: string;
  name: string;
  sli: number | null;
  downtime: number;
  coverage: number;
  dataStatus: DataStatus;
}

export interface SliReport {
  source: 'derived';
  label: string;
  profile: SliProfile;
  month: string | null;
  from: number;
  to: number;
  /** min(to, now): the part of the window that has happened. */
  end: number;
  closed: boolean;
  timezone: string;
  target: number;
  basis: {
    triggers: string[];
    gapPolicy: 'counted-as-up' | 'excluded';
    noDataPolicy: 'counted-as-100' | 'excluded';
    /** Planned maintenance, read from the periods as Zabbix defines them now. */
    maintenancePolicy: 'excluded';
  };
  overall: SliGroup;
  categories: SliGroup[];
  sites: SliGroup[];
  classes: SliGroup[];
  hosts: SliHost[];
  wanPaths: SliPath[];
  web: SliWeb[];
  /** Estate-wide spans in which (almost) nothing was collected. */
  gaps: { from: number; to: number }[];
  /** Spans the setting SLA_NO_DATA_WINDOWS declares not measured, treated as gaps by both profiles. */
  noDataWindows: { from: number; to: number }[];
  stats: { zabbixCalls: number; triggers: number; events: number; trendRows: number; ms: number };
  generatedAt: number;
}

export const DERIVED_LABEL = 'Derived from ICMP availability triggers';

// Pure parts (unit-tested)

export interface TriggerEvent {
  clock: number;
  /** 1 = PROBLEM, 0 = OK. */
  value: number;
}

/**
 * Replay one trigger's events across `[from, endClip)`.
 *
 * `initialProblem` is the state the trigger was in when the window opened. A
 * repeated PROBLEM while already in problem is one outage, not two.
 */
export function intervalsFor(
  events: TriggerEvent[],
  initialProblem: boolean,
  from: number,
  endClip: number,
): { intervals: Interval[]; incidents: number } {
  const intervals: Interval[] = [];
  let open: number | null = initialProblem ? from : null;
  let incidents = initialProblem ? 1 : 0;
  for (const ev of events) {
    if (ev.clock < from || ev.clock > endClip) continue;
    if (ev.value === 1) {
      if (open === null) {
        open = ev.clock;
        incidents++;
      }
    } else if (open !== null) {
      if (ev.clock > open) intervals.push([open, ev.clock]);
      open = null;
    }
  }
  if (open !== null && endClip > open) intervals.push([open, endClip]);
  return { intervals, incidents };
}

/**
 * The state a trigger was in when the window opened.
 *   - its first event inside the window says it (an OK first = it was in problem);
 *   - a first PROBLEM says it was OK, except for a trigger set to multiple PROBLEM
 *     events, which repeats PROBLEM while in problem: there the last event before
 *     the window decides (`lastBefore`, 1 = PROBLEM, 0 = OK, none = not given);
 *   - with no events inside, a trigger unchanged since before the window is in
 *     its current state;
 *   - one that changed only after the window: the first later event says what
 *     it changed from (`firstLater`, 1 = PROBLEM, 0 = OK).
 */
export function initialState(
  eventsInWindow: TriggerEvent[],
  trigger: { value: string; lastchange: string },
  end: number,
  firstLater?: number,
  lastBefore?: number,
): boolean {
  if (eventsInWindow.length) return eventsInWindow[0].value === 1 && lastBefore !== undefined ? lastBefore === 1 : eventsInWindow[0].value === 0;
  if (Number(trigger.lastchange) < end || firstLater === undefined) return trigger.value === '1';
  return firstLater === 0;
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** A group's figures from its hosts: the plain mean of those with data. */
export function aggregate(key: string, name: string, hosts: SliHost[], target: number): SliGroup {
  const withData = hosts.filter((h) => h.sli !== null);
  const sli = mean(withData.map((h) => h.sli as number));
  return {
    key,
    name,
    hosts: hosts.length,
    withData: withData.length,
    sli,
    downtime: hosts.reduce((n, h) => n + h.downtime, 0),
    meeting: sli === null ? null : sli >= target,
    belowTarget: hosts.filter((h) => h.meeting === false).length,
  };
}

/** Parse a Zabbix update interval ('60', '1m', '5m', '1h', '30s'); macros → 60. */
export function parseDelay(delay: string | undefined): number {
  const m = /^\s*(\d+)\s*([smhdw]?)\s*$/.exec(delay ?? '');
  if (!m) return 60;
  const unit = { '': 1, s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[m[2] as '' | 's' | 'm' | 'h' | 'd' | 'w'];
  return Math.max(1, Number(m[1]) * unit);
}

/**
 * Whether a host's ICMP was ever collected, from its ICMP items as they are
 * now: not when every one has no value (`lastclock` 0) and is not being
 * collected either: unsupported (at HCML: no interface to ping), or on a
 * disabled host. A host with no ICMP item at all is not flagged; nothing says
 * how it is measured.
 */
export function wasMeasured(items: { state?: string; lastclock?: string }[], hostDisabled: boolean): boolean {
  if (!items.length) return true;
  return !items.every((i) => i.lastclock === '0' && (i.state === '1' || hostDisabled));
}

/**
 * Hours in which an item actually collected data, from its trend rows: an hour
 * counts when at least half of the expected samples arrived.
 */
export function coveredFromTrends(
  rows: { clock: number; num: number }[],
  delaySeconds: number,
  from: number,
  end: number,
): Interval[] {
  const expected = 3600 / delaySeconds;
  const hours = rows.filter((r) => r.num >= 0.5 * expected).map((r): Interval => [r.clock, r.clock + 3600]);
  return intersectIntervals(hours, [[from, end]]);
}

// Zabbix reads

interface ZTrigger {
  triggerid: string;
  description: string;
  value: string;
  lastchange: string;
  status: string;
  /** 1 = the trigger makes a PROBLEM event at every evaluation that is still true, 0 = only when it turns on. */
  type?: string;
  hosts?: { hostid: string; name: string; status: string }[];
}

interface ZEvent {
  eventid: string;
  objectid: string;
  clock: string;
  value: string;
}

/** An ICMP item of a reported host: icmpping, icmppingloss, icmppingsec, … */
interface ZIcmpItem {
  itemid: string;
  hostid: string;
  key_: string;
  delay: string;
  value_type: string;
  state?: string;
  lastclock?: string;
}

interface Counter {
  calls: number;
  events: number;
  trendRows: number;
}

async function counted<T>(counter: Counter, method: string, params: unknown): Promise<T> {
  counter.calls++;
  return zbx<T>(method, params);
}

/** First event at/after `end` per trigger, widening the search until found or now. */
async function firstEventsAfter(
  counter: Counter,
  triggerids: string[],
  end: number,
  now: number,
): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  let pending = [...triggerids];
  let start = end;
  for (const span of [7 * 86400, 30 * 86400, 120 * 86400, 400 * 86400]) {
    if (!pending.length || start > now) break;
    const till = Math.min(now, start + span);
    const events = await fetchEventsSliced<ZEvent>(
      { source: 0, object: 0, objectids: pending, value: [0, 1], output: ['eventid', 'objectid', 'clock', 'value'] },
      start,
      till,
    );
    counter.calls++;
    for (const e of events) if (!found.has(e.objectid)) found.set(e.objectid, Number(e.value));
    pending = pending.filter((id) => !found.has(id));
    start = till + 1;
  }
  return found;
}

/** The value of each trigger's last event before `from`; one with none is left out. One call each, since the limit counts rows and not triggers. */
async function lastEventsBefore(counter: Counter, triggerids: string[], from: number): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  await mapLimit(triggerids, config.sla.maxParallel, async (id) => {
    const [last] = await counted<ZEvent[]>(counter, 'event.get', {
      source: 0,
      object: 0,
      objectids: [id],
      value: [0, 1],
      time_till: from - 1,
      sortfield: ['clock', 'eventid'],
      sortorder: 'DESC',
      limit: 1,
      output: ['eventid', 'objectid', 'clock', 'value'],
    });
    if (last) found.set(id, Number(last.value));
  });
  return found;
}

/** Collected-time intervals per host from its ICMP `icmpping` item, inside `outside` (the window less its declared spans). */
async function icmpCoverage(
  counter: Counter,
  icmpItems: ZIcmpItem[],
  from: number,
  end: number,
  outside: Interval[],
): Promise<{ byHost: Map<string, Interval[]>; gaps: Interval[] }> {
  const items = icmpItems.filter((i) => i.key_ === 'icmpping' || i.key_.startsWith('icmpping['));

  // One item per host: the plain `icmpping` if present.
  const itemByHost = new Map<string, (typeof items)[number]>();
  for (const i of items) {
    const prev = itemByHost.get(i.hostid);
    if (!prev || (prev.key_ !== 'icmpping' && i.key_ === 'icmpping')) itemByHost.set(i.hostid, i);
  }
  const hostByItem = new Map([...itemByHost.values()].map((i) => [i.itemid, i]));
  const itemids = [...hostByItem.keys()];

  // Sliced: a long window in one request runs Zabbix's PHP out of memory.
  // Rows are folded as they arrive rather than held: a year is ~1.2M of them.
  const rowsByItem = new Map<string, { clock: number; num: number }[]>();
  let lastTrendHour = -Infinity;
  await fetchTrendsSliced<{ itemid: string; clock: string; num: string }>(
    itemids,
    hourFloor(from),
    end,
    ['itemid', 'clock', 'num'],
    {
      parallel: config.sla.maxParallel,
      onRequest: () => counter.calls++,
      onRows: (rows) => {
        counter.trendRows += rows.length;
        for (const r of rows) {
          const list = rowsByItem.get(r.itemid) ?? [];
          list.push({ clock: Number(r.clock), num: Number(r.num) });
          rowsByItem.set(r.itemid, list);
          lastTrendHour = Math.max(lastTrendHour, Number(r.clock));
        }
      },
    },
  );

  const byHost = new Map<string, Interval[]>();
  for (const [itemid, item] of hostByItem) {
    byHost.set(
      item.hostid,
      coveredFromTrends(rowsByItem.get(itemid) ?? [], parseDelay(item.delay), from, end),
    );
  }

  // Trends for an hour are written when the hour ends, so the latest hour or
  // two only exist as raw history. Fill that tail from history, bounded, so a
  // long outage of trend writing can never turn into a huge history read.
  const afterTrends = Number.isFinite(lastTrendHour) ? lastTrendHour + 3600 : hourFloor(end);
  // Past six hours the tail would be a large read, so only the hour in progress is read, which would otherwise count as no data.
  const tailFrom = end - afterTrends <= 6 * 3600 ? afterTrends : hourFloor(end);
  if (tailFrom < end && tailFrom >= from) {
    const counts = new Map<string, Map<number, number>>();
    await mapLimit(chunk(itemids, 35), config.sla.maxParallel, async (ids) => {
      const rows = await counted<{ itemid: string; clock: string }[]>(counter, 'history.get', {
        itemids: ids,
        history: 3,
        time_from: tailFrom,
        time_till: end,
        output: ['itemid', 'clock'],
      });
      for (const r of rows) {
        const perHour = counts.get(r.itemid) ?? new Map<number, number>();
        const h = hourFloor(Number(r.clock));
        perHour.set(h, (perHour.get(h) ?? 0) + 1);
        counts.set(r.itemid, perHour);
      }
    });
    for (const [itemid, item] of hostByItem) {
      const delay = parseDelay(item.delay);
      const extra: Interval[] = [];
      for (const [h, n] of counts.get(itemid) ?? []) {
        const span = Math.min(h + 3600, end) - Math.max(h, tailFrom);
        if (span > 0 && n * delay >= 0.5 * span) extra.push([Math.max(h, tailFrom), Math.min(h + 3600, end)]);
      }
      byHost.set(item.hostid, mergeIntervals([...(byHost.get(item.hostid) ?? []), ...extra]));
    }
  }

  for (const [hostid, iv] of byHost) byHost.set(hostid, intersectIntervals(iv, outside));

  // Estate-wide gaps: hours in which fewer than 10% of the items that collected
  // anything in the window collected data.
  const active = [...byHost.values()].filter((iv) => iv.length);
  const gaps: Interval[] = [];
  if (active.length) {
    for (let h = hourFloor(from); h < end; h += 3600) {
      const s = Math.max(h, from);
      const e = Math.min(h + 3600, end);
      const n = active.filter((iv) => totalSeconds(intersectIntervals(iv, [[s, e]])) > 0).length;
      if (n < 0.1 * active.length) gaps.push([s, e]);
    }
  }
  // A declared span is reported as such, not again as an hour nothing was collected in.
  return { byHost, gaps: intersectIntervals(mergeIntervals(gaps), outside) };
}

/** Web scenarios on the "Web Monitoring" host, strict profile only. */
async function webScenarios(
  counter: Counter,
  from: number,
  end: number,
  now: number,
  estateSeconds: number,
  outside: Interval[],
): Promise<SliWeb[]> {
  const [host] = await counted<{ hostid: string }[]>(counter, 'host.get', {
    filter: { name: ['Web Monitoring'] },
    output: ['hostid'],
  });
  if (!host) return [];
  const items = await counted<{ itemid: string; name: string; key_: string; delay: string }[]>(counter, 'item.get', {
    hostids: [host.hostid],
    webitems: true,
    search: { key_: 'web.test.fail[' },
    startSearch: true,
    output: ['itemid', 'name', 'key_', 'delay'],
  });
  if (!items.length) return [];

  const trends = await fetchTrendsSliced<{ itemid: string; clock: string; num: string; value_min: string; value_max: string }>(
    items.map((i) => i.itemid),
    hourFloor(from),
    end,
    ['itemid', 'clock', 'num', 'value_min', 'value_max'],
    { parallel: config.sla.maxParallel, onRequest: () => counter.calls++ },
  );
  counter.trendRows += trends.length;
  const historyFloor = now - 31 * 86400;

  return mapLimit(items, config.sla.maxParallel, async (item) => {
    const delay = parseDelay(item.delay);
    const covered: Interval[] = [];
    const down: Interval[] = [];
    const mixed: number[] = [];
    for (const r of trends.filter((t) => t.itemid === item.itemid)) {
      const h = Number(r.clock);
      if (Number(r.num) < 0.5 * (3600 / delay)) continue;
      if (Number(r.value_max) === 0) covered.push([h, h + 3600]);
      else if (Number(r.value_min) > 0) {
        covered.push([h, h + 3600]);
        down.push([h, h + 3600]);
      } else if (h >= historyFloor) mixed.push(h);
    }
    let mixedDown = 0;
    if (mixed.length) {
      const hist = await counted<{ clock: string; value: string }[]>(counter, 'history.get', {
        itemids: [item.itemid],
        history: 3,
        time_from: Math.min(...mixed),
        time_till: Math.max(...mixed) + 3599,
        output: ['clock', 'value'],
      });
      const mixedSet = new Set(mixed);
      for (const row of hist) {
        const clock = Number(row.clock);
        const counts = outside.some(([s, e]) => clock >= s && clock < e);
        if (counts && mixedSet.has(hourFloor(clock)) && Number(row.value) > 0) mixedDown += delay;
      }
      for (const h of mixed) covered.push([h, h + 3600]);
    }
    const coveredIv = intersectIntervals(covered, outside);
    const coveredSec = totalSeconds(coveredIv);
    const downtime = Math.min(coveredSec, totalSeconds(intersectIntervals(down, coveredIv)) + mixedDown);
    const window = end - from;
    const coverage = window > 0 ? coveredSec / window : 0;
    const nodata = coveredSec === 0 || coverage < config.sla.minCoverage;
    const name = /\[(.*)\]$/.exec(item.key_)?.[1]?.replace(/^"|"$/g, '') || item.name;
    return {
      itemid: item.itemid,
      name,
      sli: nodata ? null : 100 * (1 - downtime / coveredSec),
      downtime,
      coverage,
      dataStatus: nodata ? 'nodata' : coveredSec < 0.95 * estateSeconds ? 'partial' : 'ok',
    } satisfies SliWeb;
  });
}

// The report

export interface SliRequest {
  profile: SliProfile;
  month?: string;
  from?: number;
  to?: number;
}

export async function computeSli(req: SliRequest): Promise<SliReport> {
  const started = Date.now();
  const now = Math.floor(started / 1000);
  const tz = config.sla.timezone;
  const target = config.sla.target;
  const profile = req.profile;
  const strict = profile === 'availability';

  const { from, to } = req.month
    ? monthBounds(req.month, tz)
    : { from: req.from as number, to: req.to as number };
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new BadRequestError('A month (YYYY-MM) or a from/to window is required.');
  }
  checkPeriodStart(from, now);

  const end = Math.min(to, now);
  const closed = to <= now;
  const window = end - from;
  // Spans declared not measured (SLA_NO_DATA_WINDOWS) are a gap in both profiles: left out of the strict figure,
  // counted as up in HCML's, as an hour nothing was collected in is.
  const declared = mergeIntervals(clipIntervals(config.sla.noDataWindows, from, end));
  const outsideDeclared = complementIntervals(declared, from, end);
  // HCML's report clips a problem still open at month end to the last second.
  const endClip = !strict && closed ? to - 1 : end;
  const counter: Counter = { calls: 0, events: 0, trendRows: 0 };
  const triggerNames = strict ? config.sla.availabilityTriggers : config.sla.reportTriggers;

  // Every host carrying one of the triggers, including disabled hosts, which
  // HCML's report lists too.
  const triggers = await counted<ZTrigger[]>(counter, 'trigger.get', {
    output: ['triggerid', 'description', 'value', 'lastchange', 'status', 'type'],
    filter: { description: triggerNames },
    templated: false,
    selectHosts: ['hostid', 'name', 'status'],
  });

  const hostMeta = new Map<string, { name: string; status: string; triggers: ZTrigger[] }>();
  for (const t of triggers) {
    const h = t.hosts?.[0];
    if (!h) continue;
    const row = hostMeta.get(h.hostid) ?? { name: h.name, status: h.status, triggers: [] };
    row.triggers.push(t);
    hostMeta.set(h.hostid, row);
  }
  const hostids = [...hostMeta.keys()];

  const [parents, icmpItems, events, maintenance] = await Promise.all([
    hostids.length
      ? counted<{ hostid: string; parentTemplates?: { name: string }[] }[]>(counter, 'host.get', {
          hostids,
          output: ['hostid'],
          selectParentTemplates: ['name'],
        })
      : Promise.resolve([]),
    // Every ICMP item of the reported hosts, in both profiles: `measured` needs
    // their state, and the strict profile's coverage their delays.
    hostids.length
      ? counted<ZIcmpItem[]>(counter, 'item.get', {
          hostids,
          search: { key_: 'icmpping' },
          startSearch: true,
          output: ['itemid', 'hostid', 'key_', 'delay', 'value_type', 'state', 'lastclock'],
        })
      : Promise.resolve([]),
    triggers.length
      ? fetchEventsSliced<ZEvent>(
          {
            source: 0,
            object: 0,
            objectids: triggers.map((t) => t.triggerid),
            value: [0, 1],
            output: ['eventid', 'objectid', 'clock', 'value'],
          },
          from,
          end - 1,
        )
      : Promise.resolve([]),
    maintenanceByHost(from, end, tz, () => counter.calls++),
  ]);
  counter.calls++;
  counter.events = events.length;

  const categoryByHost = new Map(
    parents.map((p) => [p.hostid, categoryFor((p.parentTemplates ?? []).map((t) => t.name))]),
  );

  const eventsByTrigger = new Map<string, TriggerEvent[]>();
  for (const e of events) {
    const list = eventsByTrigger.get(e.objectid) ?? [];
    list.push({ clock: Number(e.clock), value: Number(e.value) });
    eventsByTrigger.set(e.objectid, list);
  }

  // Triggers with no events in the window that changed only afterwards need
  // their first later event to know what state they were in during it.
  const quietChangedLater = triggers
    .filter((t) => !eventsByTrigger.has(t.triggerid) && Number(t.lastchange) >= end)
    .map((t) => t.triggerid);
  const firstLater = quietChangedLater.length
    ? await firstEventsAfter(counter, quietChangedLater, end, now)
    : new Map<string, number>();

  // A first PROBLEM in the window can be a repeat for a trigger set to multiple PROBLEM events; the event before the window tells.
  const repeating = triggers
    .filter((t) => t.type === '1' && eventsByTrigger.get(t.triggerid)?.[0]?.value === 1)
    .map((t) => t.triggerid);
  const lastBefore = repeating.length ? await lastEventsBefore(counter, repeating, from) : new Map<string, number>();

  const icmpByHost = new Map<string, ZIcmpItem[]>();
  for (const i of icmpItems) {
    const list = icmpByHost.get(i.hostid) ?? [];
    list.push(i);
    icmpByHost.set(i.hostid, list);
  }

  const coverage = strict ? await icmpCoverage(counter, icmpItems, from, end, outsideDeclared) : undefined;
  // "Partial" is judged against the time the estate as a whole was collecting:
  // an hour nobody collected in is the estate's gap, not this host's.
  const gapSeconds = totalSeconds(coverage?.gaps ?? []) + (strict ? totalSeconds(declared) : 0);
  const estateSeconds = Math.max(0, window - gapSeconds);

  const hosts: SliHost[] = [];
  const downByHost = new Map<string, Interval[]>();
  const coveredByHost = new Map<string, Interval[]>();
  for (const [hostid, meta] of hostMeta) {
    const all: Interval[] = [];
    let incidents = 0;
    for (const t of meta.triggers) {
      const evs = eventsByTrigger.get(t.triggerid) ?? [];
      const initial = initialState(evs, t, end, firstLater.get(t.triggerid), lastBefore.get(t.triggerid));
      const r = intervalsFor(evs, initial, from, endClip);
      all.push(...r.intervals);
      incidents += r.incidents;
    }
    const merged = mergeIntervals(all);
    const category = categoryByHost.get(hostid) ?? 'Other';

    // Planned maintenance leaves the measurement entirely, as a no-data hour
    // does in the strict profile: neither down nor counted in the total.
    const planned = clipIntervals(maintenance.get(hostid) ?? [], from, end);
    const plannedSec = totalSeconds(planned);
    const outsidePlanned = complementIntervals(planned, from, end);
    const measurable = window - plannedSec;

    let covered: Interval[];
    if (strict) covered = intersectIntervals(coverage!.byHost.get(hostid) ?? [], outsidePlanned);
    else covered = outsidePlanned;
    const measured = intersectIntervals(intersectIntervals(merged, covered), outsideDeclared);
    const downtime = totalSeconds(measured);
    const coveredSec = totalSeconds(covered);
    const cov = measurable > 0 ? coveredSec / measurable : 0;
    const nodata = strict && (coveredSec === 0 || cov < config.sla.minCoverage);
    const denominator = strict ? coveredSec : measurable;
    const sli = nodata || denominator <= 0 ? null : Math.max(0, 100 * (1 - downtime / denominator));

    downByHost.set(hostid, measured);
    coveredByHost.set(hostid, covered);
    hosts.push({
      hostid,
      name: meta.name,
      hostStatus: meta.status,
      site: siteFromHostName(meta.name),
      category,
      deviceClass: deviceClass(meta.name, category),
      triggerids: meta.triggers.map((t) => t.triggerid),
      sli,
      downtime,
      window,
      covered: coveredSec,
      maintenance: plannedSec,
      coverage: cov,
      incidents,
      longest: measured.reduce((m, [s, e]) => Math.max(m, e - s), 0),
      dataStatus: nodata
        ? 'nodata'
        : strict && coveredSec < 0.95 * Math.max(0, estateSeconds - plannedSec)
          ? 'partial'
          : 'ok',
      measured: wasMeasured(icmpByHost.get(hostid) ?? [], meta.status === '1'),
      meeting: sli === null ? null : sli >= target,
      errorBudget: sli === null ? null : (1 - target / 100) * denominator - downtime,
    });
  }

  hosts.sort(
    (a, b) =>
      (a.sli === null ? 1 : 0) - (b.sli === null ? 1 : 0) ||
      (a.sli ?? 0) - (b.sli ?? 0) ||
      naturalCompare(a.name, b.name),
  );

  const group = <K extends string>(keyOf: (h: SliHost) => K, nameOf: (k: K, h: SliHost) => string) => {
    const buckets = new Map<K, { name: string; hosts: SliHost[] }>();
    for (const h of hosts) {
      const k = keyOf(h);
      const b = buckets.get(k) ?? { name: nameOf(k, h), hosts: [] };
      b.hosts.push(h);
      buckets.set(k, b);
    }
    return [...buckets.entries()].map(([k, b]) => aggregate(k, b.name, b.hosts, target));
  };

  const categories = group((h) => h.category, (k) => k).sort(
    (a, b) => rank(CATEGORY_ORDER, a.key) - rank(CATEGORY_ORDER, b.key) || naturalCompare(a.name, b.name),
  );
  const sites = group(
    (h) => (h.site ? `site:${h.site.code}` : 'site:unassigned'),
    (_k, h) => (h.site ? `${h.site.code} · ${h.site.name}` : 'Unassigned'),
  ).sort((a, b) => siteRank(a.key) - siteRank(b.key));
  const classes = group(
    (h) => h.deviceClass,
    (k) => DEVICE_CLASS_LABELS[k as keyof typeof DEVICE_CLASS_LABELS] ?? k,
  ).sort((a, b) => naturalCompare(a.name, b.name));

  const wanPaths = buildWanPaths(hosts, downByHost, coveredByHost, window, strict, estateSeconds);
  const web = strict ? await webScenarios(counter, from, end, now, estateSeconds, outsideDeclared) : [];

  return {
    source: 'derived',
    label: DERIVED_LABEL,
    profile,
    month: req.month ?? null,
    from,
    to,
    end,
    closed,
    timezone: tz,
    target,
    basis: {
      triggers: triggerNames,
      gapPolicy: strict ? 'excluded' : 'counted-as-up',
      noDataPolicy: strict ? 'excluded' : 'counted-as-100',
      maintenancePolicy: 'excluded',
    },
    overall: aggregate('overall', 'HCML estate', hosts, target),
    categories,
    sites,
    classes,
    hosts,
    wanPaths,
    web,
    gaps: (coverage?.gaps ?? []).map(([s, e]) => ({ from: s, to: e })),
    noDataWindows: declared.map(([s, e]) => ({ from: s, to: e })),
    stats: {
      zabbixCalls: counter.calls,
      triggers: triggers.length,
      events: counter.events,
      trendRows: counter.trendRows,
      ms: Date.now() - started,
    },
    generatedAt: now,
  };
}

function rank(order: string[], key: string): number {
  const i = order.indexOf(key);
  return i < 0 ? order.length : i;
}

function siteRank(key: string): number {
  const code = Number(key.replace('site:', ''));
  return Number.isFinite(code) ? code : 99;
}

/**
 * The report category is the monitoring template: a device template when the
 * host has one, "ICMP Ping" for hosts that are only pinged.
 */
export function categoryFor(parentTemplates: string[]): string {
  const lower = parentTemplates.map((p) => p.toLowerCase());
  const device = CATEGORY_ORDER.find((c) => c !== 'ICMP Ping' && lower.includes(c.toLowerCase()));
  if (device) return device;
  if (lower.includes('icmp ping')) return 'ICMP Ping';
  return parentTemplates[0] ? categoryLabel(parentTemplates[0]) : 'Other';
}

function buildWanPaths(
  hosts: SliHost[],
  downByHost: Map<string, Interval[]>,
  coveredByHost: Map<string, Interval[]>,
  window: number,
  strict: boolean,
  estateSeconds: number,
): SliPath[] {
  const byPath = new Map<string, { legs: SliHost[]; legIds: string[] }>();
  for (const h of hosts) {
    const key = wanPairKey(h.name);
    if (!key) continue;
    const row = byPath.get(key.path) ?? { legs: [], legIds: [] };
    row.legs.push(h);
    row.legIds.push(key.leg);
    byPath.set(key.path, row);
  }
  const paths: SliPath[] = [];
  for (const [path, { legs, legIds }] of byPath) {
    const nodata = legs.some((l) => l.dataStatus === 'nodata');
    let covered: Interval[] = coveredByHost.get(legs[0].hostid) ?? [];
    let down: Interval[] = downByHost.get(legs[0].hostid) ?? [];
    for (const leg of legs.slice(1)) {
      covered = intersectIntervals(covered, coveredByHost.get(leg.hostid) ?? []);
      down = intersectIntervals(down, downByHost.get(leg.hostid) ?? []);
    }
    const coveredSec = strict ? totalSeconds(covered) : window;
    const downtime = totalSeconds(down);
    const coverage = window > 0 ? Math.min(1, coveredSec / window) : 0;
    const sli = nodata || coveredSec <= 0 ? null : Math.max(0, 100 * (1 - downtime / coveredSec));
    paths.push({
      key: `wan:${path}`,
      name: path,
      site: legs[0].site,
      legs: legs
        .map((l, i) => ({ hostid: l.hostid, name: l.name, leg: legIds[i], sli: l.sli, dataStatus: l.dataStatus }))
        .sort((a, b) => naturalCompare(a.leg, b.leg)),
      sli,
      downtime,
      coverage,
      dataStatus: nodata ? 'nodata' : strict && coveredSec < 0.95 * estateSeconds ? 'partial' : 'ok',
    });
  }
  return paths.sort((a, b) => naturalCompare(a.name, b.name));
}
