import { config, type SliProfile } from '../core/config.js';
import { CATEGORY_ORDER, DEVICE_CLASS_LABELS, deviceClass, naturalCompare, wanPairKey, type SiteRef } from '../domain/naming.js';
import { clipIntervals, complementIntervals, intersectIntervals, mergeIntervals, totalSeconds, touchesAny, type Interval } from './intervals.js';
import {
  aggregate,
  intervalsFor,
  type DailyHours,
  type DataStatus,
  type SliHost,
  type SliPath,
  type SliReport,
  type TriggerEvent,
} from './model.js';
import { hourFloor } from './time.js';
import { dailySpans } from './window.js';

/**
 * The second stage of the derived SLA (ADR-0018): every figure of a report, worked out from what the first stage read, for any window the data covers. It does no input
 * or output. A calendar month is one span of data, a range is several in a row, and the rules are the same: replay each trigger's events from the state the window
 * opened in, take away planned maintenance, spans nobody collected in and the hours outside the chosen daily hours, and divide.
 */

/** One host of a span of data. */
export interface SliDataHost {
  hostid: string;
  name: string;
  /** Zabbix's host status: '0' enabled, '1' disabled. */
  status: string;
  triggerids: string[];
  category: string;
  /** Its site by the four signals of the Sites page, read with the data (BK-103). */
  site: SiteRef | null;
  /** Whether its ICMP was ever collected, from its items as they were when read (`wasMeasured`). */
  measured: boolean;
}

/** What the first stage read for one span, in seconds since 1970, and nothing derived from it. */
export interface SliData {
  profile: SliProfile;
  /** The span's start and its end by the calendar: a month's first second and the first second of the next. */
  from: number;
  to: number;
  /** min(to, readAt): how far the data reaches. */
  end: number;
  /** When it was read. */
  readAt: number;
  /** In the order the triggers came, which is the order of the report before it is sorted. */
  hosts: SliDataHost[];
  /** Whether each trigger was in problem when the span opened. */
  initial: Map<string, boolean>;
  /** Each trigger's PROBLEM and OK events from `from` up to `end - 1`, oldest first. */
  events: Map<string, TriggerEvent[]>;
  /** Planned maintenance of each host inside the span. */
  maintenance: Map<string, Interval[]>;
  /** The strict method's hours with data for each host that has an ICMP item, inside the span, before the declared spans are taken out. */
  coverage?: Map<string, Interval[]>;
  /** What reading it cost. */
  stats: { zabbixCalls: number; triggers: number; events: number; trendRows: number };
}

/**
 * What a span of data holds in memory, for the cache: the walk that sizes a value stops at 500,000 values, which is about 170,000 events. Measured on Node 25 at about 45 bytes
 * an event, with 80 bytes for each stretch of time and a few hundred for each host.
 */
export function sliDataBytes(d: SliData): number {
  const spans = (m?: Map<string, Interval[]>) => [...(m?.values() ?? [])].reduce((n, list) => n + list.length, 0);
  const events = [...d.events.values()].reduce((n, list) => n + list.length, 0);
  return 45 * events + 80 * (spans(d.maintenance) + spans(d.coverage)) + 400 * d.hosts.length;
}

export interface SliQuery {
  from: number;
  to: number;
  /** Restricts the window to these hours of the day; null or left out is all of it. */
  hours?: DailyHours | null;
}

/** A report without what only the reading adds: the web checks, the month, the cost and the time it was made. */
export type SliEvaluation = Omit<SliReport, 'source' | 'label' | 'month' | 'web' | 'webTakenAt' | 'stats' | 'generatedAt'> & {
  /** The seconds of the window in which the estate as a whole was collecting, which the web checks are judged against. */
  estateSeconds: number;
  /** The window less the spans declared not measured. */
  outsideDeclared: Interval[];
};

function rank(order: string[], key: string): number {
  const i = order.indexOf(key);
  return i < 0 ? order.length : i;
}

function siteRank(key: string): number {
  const code = Number(key.replace('site:', ''));
  return Number.isFinite(code) ? code : 99;
}

/**
 * The hours of `[from, end)` in which fewer than a tenth of the hosts that collected anything in `domain` collected data, as spans of `domain`: the gaps of the
 * estate. Hosts are counted once for each hour, by one sweep over their spans and not one search for each hour.
 */
function estateGaps(byHost: Interval[][], domain: Interval[], from: number, end: number): Interval[] {
  const active = byHost.filter((iv) => iv.length);
  if (!active.length || end <= from) return [];
  const base = hourFloor(from);
  const hours = Math.ceil((end - base) / 3600);
  const counts = new Int32Array(hours);
  for (const spans of active) {
    let counted = -1;
    for (const [s, e] of spans) {
      const lo = Math.max(Math.floor((s - base) / 3600), counted + 1);
      const hi = Math.floor((e - 1 - base) / 3600);
      for (let k = lo; k <= hi; k++) counts[k]++;
      counted = Math.max(counted, hi);
    }
  }
  const gaps: Interval[] = [];
  let at = 0;
  for (let k = 0; k < hours; k++) {
    const s = Math.max(base + k * 3600, from);
    const e = Math.min(base + (k + 1) * 3600, end);
    while (at < domain.length && domain[at][1] <= s) at++;
    if (counts[k] >= 0.1 * active.length) continue;
    for (let j = at; j < domain.length && domain[j][0] < e; j++) {
      const piece: Interval = [Math.max(s, domain[j][0]), Math.min(e, domain[j][1])];
      if (piece[1] > piece[0]) gaps.push(piece);
    }
  }
  return gaps;
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
    // What the legs measured together: in HCML's method too, the window less the time both were in planned maintenance, as each leg's own figure is (BK-81).
    const coveredSec = totalSeconds(covered);
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

/**
 * The report of the window `[q.from, q.to)` from `datas`, the data of consecutive spans of one method that together cover it. The window ends at `q.to`, or where the
 * newest data ends if that is earlier. An outage that crosses from one span into the next is one outage: the events are joined and replayed once.
 */
export function evaluateSli(datas: SliData[], q: SliQuery): SliEvaluation {
  if (!datas.length) throw new Error('evaluateSli needs the data of at least one span.');
  for (let i = 1; i < datas.length; i++) {
    if (datas[i].profile !== datas[0].profile || datas[i].from !== datas[i - 1].to) throw new Error('The spans of data must be of one method and follow one another.');
  }
  const first = datas[0];
  const last = datas[datas.length - 1];
  const { from, to } = q;
  if (from < first.from) throw new Error('The window starts before the data does.');

  const strict = first.profile === 'availability';
  const tz = config.sla.timezone;
  const target = config.sla.target;
  const now = last.readAt;
  const end = Math.min(to, last.end);
  const closed = to <= now;
  // Spans declared not measured (SLA_NO_DATA_WINDOWS) are a gap in both methods: left out of the strict figure,
  // counted as up in HCML's, as an hour nothing was collected in is.
  const declared = mergeIntervals(clipIntervals(config.sla.noDataWindows, from, end));
  const outsideDeclared = complementIntervals(declared, from, end);
  // HCML's report clips a problem still open at month end to the last second.
  const endClip = !strict && closed ? to - 1 : end;
  // What counts: the whole window, or the daily hours inside it.
  const spans = q.hours ? dailySpans(q.hours, from, end, tz) : null;
  // The same spans, merged once, for the many outages that are asked whether they touch one.
  const mergedSpans = spans ? mergeIntervals(spans) : null;
  const domain: Interval[] = spans ?? mergeIntervals([[from, end]]);
  const window = spans ? totalSeconds(spans) : end - from;
  const triggerNames = strict ? config.sla.availabilityTriggers : config.sla.reportTriggers;

  const roster = new Map<string, SliDataHost>();
  for (const d of datas) {
    for (const h of d.hosts) {
      const before = roster.get(h.hostid);
      roster.set(h.hostid, before ? { ...h, triggerids: [...new Set([...before.triggerids, ...h.triggerids])] } : h);
    }
  }
  const eventsOf = (triggerid: string): TriggerEvent[] => (datas.length === 1 ? (first.events.get(triggerid) ?? []) : datas.flatMap((d) => d.events.get(triggerid) ?? []));
  /** The state when the window opens: the state when the first span did, then the events between. */
  const stateAtFrom = (triggerid: string, events: TriggerEvent[]): boolean => {
    let state = first.initial.get(triggerid) ?? false;
    for (const e of events) {
      if (e.clock >= from) break;
      state = e.value === 1;
    }
    return state;
  };

  // The hours in which each host collected, left to the window, its declared spans and its hours.
  let coverageByHost: Map<string, Interval[]> | undefined;
  if (strict) {
    const raw = new Map<string, Interval[]>();
    for (const d of datas) for (const [hostid, iv] of d.coverage ?? []) raw.set(hostid, [...(raw.get(hostid) ?? []), ...iv]);
    const counted = intersectIntervals(outsideDeclared, domain);
    coverageByHost = new Map([...raw].map(([hostid, iv]) => [hostid, intersectIntervals(iv, counted)]));
  }
  const gaps = strict ? intersectIntervals(mergeIntervals(estateGaps([...coverageByHost!.values()], domain, from, end)), outsideDeclared) : [];
  // "Partial" is judged against the time the estate as a whole was collecting:
  // an hour nobody collected in is the estate's gap, not this host's.
  const gapSeconds = totalSeconds(gaps) + (strict ? totalSeconds(intersectIntervals(declared, domain)) : 0);
  const estateSeconds = Math.max(0, window - gapSeconds);

  const hosts: SliHost[] = [];
  const downByHost = new Map<string, Interval[]>();
  const coveredByHost = new Map<string, Interval[]>();
  for (const [hostid, meta] of roster) {
    const all: Interval[] = [];
    let incidents = 0;
    for (const triggerid of meta.triggerids) {
      const events = eventsOf(triggerid);
      const inWindow = events.filter((e) => e.clock >= from && e.clock < end);
      const r = intervalsFor(inWindow, stateAtFrom(triggerid, events), from, endClip);
      all.push(...r.intervals);
      // HCML's method has one trigger, whose count is HCML's own. An outage counts when any part of it lies inside the chosen hours.
      if (!strict) incidents += mergedSpans ? r.intervals.filter(([s, e]) => touchesAny(mergedSpans, s, e)).length : r.incidents;
    }
    const merged = mergeIntervals(all);
    // The strict method has two triggers, and an outage that passes through partial loss into total loss fires both: its incidents are the outages of the merged stretches, which are what the downtime and the longest outage
    // use, and not one for each trigger (BK-82).
    if (strict) incidents = mergedSpans ? merged.filter(([s, e]) => touchesAny(mergedSpans, s, e)).length : merged.length;

    // Planned maintenance leaves the measurement entirely, as a no-data hour
    // does in the strict method: neither down nor counted in the total.
    const planned = clipIntervals(datas.flatMap((d) => d.maintenance.get(hostid) ?? []), from, end);
    const plannedSec = totalSeconds(intersectIntervals(planned, domain));
    const outsidePlanned = intersectIntervals(domain, complementIntervals(planned, from, end));
    const measurable = window - plannedSec;

    const covered = strict ? intersectIntervals(coverageByHost!.get(hostid) ?? [], outsidePlanned) : outsidePlanned;
    const measured = intersectIntervals(intersectIntervals(merged, covered), outsideDeclared);
    const downtime = totalSeconds(measured);
    const coveredSec = totalSeconds(covered);
    const cov = measurable > 0 ? coveredSec / measurable : 0;
    const nodata = strict && (coveredSec === 0 || cov < config.sla.minCoverage);
    const denominator = strict ? coveredSec : measurable;
    const sli = nodata || denominator <= 0 ? null : Math.max(0, 100 * (1 - downtime / denominator));

    downByHost.set(hostid, measured);
    coveredByHost.set(hostid, covered);
    const dataStatus: DataStatus = nodata ? 'nodata' : strict && coveredSec < 0.95 * Math.max(0, estateSeconds - plannedSec) ? 'partial' : 'ok';
    hosts.push({
      hostid,
      name: meta.name,
      hostStatus: meta.status,
      site: meta.site,
      category: meta.category,
      deviceClass: deviceClass(meta.name, meta.category),
      triggerids: meta.triggerids,
      sli,
      downtime,
      window,
      covered: coveredSec,
      maintenance: plannedSec,
      coverage: cov,
      incidents,
      longest: measured.reduce((m, [s, e]) => Math.max(m, e - s), 0),
      dataStatus,
      measured: meta.measured,
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

  const result: SliEvaluation = {
    profile: first.profile,
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
    wanPaths: buildWanPaths(hosts, downByHost, coveredByHost, window, strict, estateSeconds),
    gaps: gaps.map(([s, e]) => ({ from: s, to: e })),
    noDataWindows: declared.map(([s, e]) => ({ from: s, to: e })),
    estateSeconds,
    outsideDeclared,
  };
  if (q.hours && spans) result.dailyHours = { ...q.hours, seconds: window };
  return result;
}
