import type { SliProfile } from '../core/config.js';
import { CATEGORY_ORDER, categoryLabel, type SiteRef } from '../domain/naming.js';
import { intersectIntervals, type Interval } from './intervals.js';

/**
 * What the derived SLA is made of: the shapes of a report, and the small pure rules it is built from, each unit-tested on its own. The reading of Zabbix
 * is in engine.ts and the evaluation of a window in evaluate.ts (ADR-0018).
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
  /** Seconds in the window (from → min(to, now)); for a window of daily hours, the seconds of it inside those hours. */
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

/** The hours of the day a window is restricted to, when it is (sli/window.ts). */
export interface DailyHours {
  /** Whole hour 0 to 23 the daily span begins. */
  start: number;
  /** Whole hour 0 to 24 it ends. Not after `start` means it runs through midnight into the next morning. */
  end: number;
  /** Days of the week it applies to, Monday 1 to Sunday 7, by the day the span begins; null is every day. */
  weekdays: number[] | null;
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
  /** Present when the window was restricted to the hours of the day: the choice, and the seconds of the window it keeps. */
  dailyHours?: DailyHours & { seconds: number };
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
  /** When the web check figures were taken, as unix seconds, once they are kept for a month that has closed (services/closedWeb.ts). Absent while they can still change. */
  webTakenAt?: number;
  /** Estate-wide spans in which (almost) nothing was collected. */
  gaps: { from: number; to: number }[];
  /** Spans the setting SLA_NO_DATA_WINDOWS declares not measured, treated as gaps by both profiles. */
  noDataWindows: { from: number; to: number }[];
  stats: { zabbixCalls: number; triggers: number; events: number; trendRows: number; ms: number };
  generatedAt: number;
}

export const DERIVED_LABEL = 'Derived from ICMP availability triggers';

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
