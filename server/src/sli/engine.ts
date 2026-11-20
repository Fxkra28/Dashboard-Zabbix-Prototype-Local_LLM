import { zbx } from '../clients/zabbix.js';
import { siteFromHostName } from '../domain/naming.js';
import type { ZHostMeta } from '../domain/queries.js';
import { SITE_SIGNALS, siteRefOf } from '../domain/siteOf.js';
import { config, type SliProfile } from '../core/config.js';
import { pollSeconds } from '../core/delay.js';
import { BadRequestError } from '../core/validate.js';
import { chunk, fetchEventsSliced, fetchTrendsSliced, mapLimit } from './events.js';
import { evaluateSli, type SliData, type SliDataHost } from './evaluate.js';
import { maintenanceByHost } from './maintenance.js';
import { intersectIntervals, mergeIntervals, totalSeconds, type Interval } from './intervals.js';
import {
  categoryFor,
  coveredFromTrends,
  DERIVED_LABEL,
  initialState,
  wasMeasured,
  type SliReport,
  type SliWeb,
  type TriggerEvent,
} from './model.js';
import { checkPeriodStart, hourFloor, monthBounds } from './time.js';

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
 *
 * Two stages (ADR-0018). This file reads Zabbix for one span, a month or one window, and returns what it read (`readSliData`). evaluate.ts works any
 * window out from the data of the spans it touches, and does no input or output. `computeSli` is the two in a row, with the web checks.
 */

export { aggregate, categoryFor, coveredFromTrends, DERIVED_LABEL, initialState, intervalsFor, wasMeasured } from './model.js';
export type { DailyHours, DataStatus, SliGroup, SliHost, SliPath, SliReport, SliWeb, TriggerEvent } from './model.js';
export type { SliData } from './evaluate.js';

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

/** Collected-time intervals per host from its ICMP `icmpping` item over `[from, end)`, before spans declared not measured are taken out (evaluate.ts does that, and finds the estate's gaps). */
async function readIcmpCoverage(
  counter: Counter,
  icmpItems: ZIcmpItem[],
  from: number,
  end: number,
): Promise<Map<string, Interval[]>> {
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
      coveredFromTrends(rowsByItem.get(itemid) ?? [], pollSeconds(item.delay), from, end),
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
      const delay = pollSeconds(item.delay);
      const extra: Interval[] = [];
      for (const [h, n] of counts.get(itemid) ?? []) {
        const span = Math.min(h + 3600, end) - Math.max(h, tailFrom);
        if (span > 0 && n * delay >= 0.5 * span) extra.push([Math.max(h, tailFrom), Math.min(h + 3600, end)]);
      }
      byHost.set(item.hostid, mergeIntervals([...(byHost.get(item.hostid) ?? []), ...extra]));
    }
  }
  return byHost;
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
    const delay = pollSeconds(item.delay);
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

/** The span `[from, to)` as Zabbix has it at `now`: the triggers, their events and the state each began in, the planned maintenance and, in the strict method, the hours with data. */
export async function readSliData(
  req: { profile: SliProfile; from: number; to: number; now: number },
  counter: Counter = { calls: 0, events: 0, trendRows: 0 },
): Promise<SliData> {
  const { profile, from, to, now } = req;
  const tz = config.sla.timezone;
  const strict = profile === 'availability';
  const end = Math.min(to, now);
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
      ? counted<{ hostid: string; parentTemplates?: { name: string }[]; hostgroups?: ZHostMeta['hostgroups']; tags?: ZHostMeta['tags']; inventory?: ZHostMeta['inventory'] }[]>(counter, 'host.get', {
          hostids,
          output: ['hostid'],
          selectParentTemplates: ['name'],
          // The site by the four signals of the Sites page, asked in the call that is made anyway (BK-103).
          ...SITE_SIGNALS,
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
  const siteByHost = new Map(
    parents.map((p) => {
      const meta = hostMeta.get(p.hostid);
      return [p.hostid, siteRefOf({ hostid: p.hostid, name: meta?.name ?? '', status: meta?.status ?? '0', hostgroups: p.hostgroups, tags: p.tags, inventory: p.inventory })];
    }),
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

  const coverage = strict ? await readIcmpCoverage(counter, icmpItems, from, end) : undefined;

  const initial = new Map<string, boolean>();
  for (const t of triggers) {
    initial.set(t.triggerid, initialState(eventsByTrigger.get(t.triggerid) ?? [], t, end, firstLater.get(t.triggerid), lastBefore.get(t.triggerid)));
  }
  const hosts: SliDataHost[] = [...hostMeta].map(([hostid, meta]) => ({
    hostid,
    name: meta.name,
    status: meta.status,
    triggerids: meta.triggers.map((t) => t.triggerid),
    category: categoryByHost.get(hostid) ?? 'Other',
    site: siteByHost.has(hostid) ? siteByHost.get(hostid)! : siteFromHostName(meta.name),
    measured: wasMeasured(icmpByHost.get(hostid) ?? [], meta.status === '1'),
  }));

  return {
    profile,
    from,
    to,
    end,
    readAt: now,
    hosts,
    initial,
    events: eventsByTrigger,
    maintenance,
    ...(coverage ? { coverage } : {}),
    stats: { zabbixCalls: counter.calls, triggers: triggers.length, events: counter.events, trendRows: counter.trendRows },
  };
}

/** The window and the method from a request: a month, or `from` and `to`. */
function windowOf(req: SliRequest, now: number): { from: number; to: number } {
  const { from, to } = req.month ? monthBounds(req.month, config.sla.timezone) : { from: req.from as number, to: req.to as number };
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new BadRequestError('A month (YYYY-MM) or a from/to window is required.');
  }
  checkPeriodStart(from, now);
  return { from, to };
}

export async function computeSli(req: SliRequest): Promise<SliReport> {
  const started = Date.now();
  const now = Math.floor(started / 1000);
  const strict = req.profile === 'availability';
  const { from, to } = windowOf(req, now);
  const counter: Counter = { calls: 0, events: 0, trendRows: 0 };

  const data = await readSliData({ profile: req.profile, from, to, now }, counter);
  const { estateSeconds, outsideDeclared, ...evaluated } = evaluateSli([data], { from, to });
  const web = strict ? await webScenarios(counter, from, evaluated.end, now, estateSeconds, outsideDeclared) : [];

  return {
    source: 'derived',
    label: DERIVED_LABEL,
    ...evaluated,
    month: req.month ?? null,
    web,
    stats: {
      zabbixCalls: counter.calls,
      triggers: data.stats.triggers,
      events: counter.events,
      trendRows: counter.trendRows,
      ms: Date.now() - started,
    },
    generatedAt: now,
  };
}
