/** The availability report: how much of a window each host spent in a problem state, and the cached form of it that the route serves. */

import { cached } from '../core/cache.js';
import { config, type SliProfile } from '../core/config.js';
import { computeSli, type DataStatus, type SliGroup, type SliReport } from '../sli/engine.js';
import type { SiteRef } from '../domain/naming.js';
import { getMonthlySli } from './sli.js';
import { clipIntervals, complementIntervals, intersectIntervals, mergeIntervals, mergedSeconds, type Interval } from '../sli/intervals.js';
import { fetchIncidents, lastDays, monthWindow } from './incidents.js';
import { heavy, REPORT_TTL, staleReport } from './reportPolicy.js';

export interface HostAvailability {
  hostid: string;
  host: string;
  /** Percent of the measured time with no qualifying problem open; null = no data. */
  availability: number | null;
  /** Seconds spent in a problem state (overlaps merged, not double-counted). */
  downtime: number;
  incidents: number;
  longest: number;
  /** Share of the window in which data was actually collected (availability basis). */
  coverage?: number;
  dataStatus?: DataStatus;
  category?: string;
  site?: SiteRef | null;
}

/**
 * `availability` (the default) measures what availability means: a device
 * unreachable or losing pings: through the SLA engine, and leaves out hours in
 * which nothing was collected. `all-problems` is the original report: any open
 * problem at or above the severity floor counts as downtime.
 */
export type AvailabilityBasis = 'availability' | 'all-problems';

export interface AvailabilityReport {
  from: number;
  to: number;
  windowSeconds: number;
  minSeverity: number;
  hosts: HostAvailability[];
  /** Always false now: events are fetched in slices and never silently cut. */
  truncated: boolean;
  basis: AvailabilityBasis;
  profile?: SliProfile;
  month?: string | null;
  target?: number;
  overall?: SliGroup;
  categories?: SliGroup[];
  sites?: SliGroup[];
  gaps?: SliReport['gaps'];
  /** Spans declared not measured (SLA_NO_DATA_WINDOWS): no downtime is counted in them. */
  noDataWindows?: SliReport['noDataWindows'];
}

/**
 * Availability through the SLA engine: a device counts as down while its ICMP
 * availability triggers are in problem, and hours with no collected data are
 * left out of the measurement. Either a calendar month or a rolling window.
 */
export async function getDerivedAvailability(opts: {
  days: number;
  month?: string;
  profile: SliProfile;
  minSeverity: number;
}): Promise<AvailabilityReport> {
  const now = Math.floor(Date.now() / 1000);
  const report = opts.month
    ? await getMonthlySli(opts.month, opts.profile)
    : await computeSli({ profile: opts.profile, from: now - opts.days * 86400, to: now });

  return {
    from: report.from,
    to: report.end,
    windowSeconds: report.to - report.from,
    minSeverity: opts.minSeverity,
    hosts: report.hosts.map((h) => ({
      hostid: h.hostid,
      host: h.name,
      availability: h.sli,
      downtime: h.downtime,
      incidents: h.incidents,
      longest: h.longest,
      coverage: h.coverage,
      dataStatus: h.dataStatus,
      category: h.category,
      site: h.site,
    })),
    truncated: false,
    basis: 'availability',
    profile: report.profile,
    month: report.month,
    target: report.target,
    overall: report.overall,
    categories: report.categories,
    sites: report.sites,
    gaps: report.gaps,
    noDataWindows: report.noDataWindows,
  };
}

/**
 * The original report: any open problem at or above the floor counts as
 * downtime. Over the last `days` days, or over `month` when one is given.
 */
export async function getAvailability(
  days: number,
  minSeverity: number,
  month?: string,
): Promise<AvailabilityReport> {
  const window = month ? monthWindow(month) : lastDays(days);
  const { incidents, from, to, truncated } = await fetchIncidents(window, minSeverity);

  // A span declared not measured (SLA_NO_DATA_WINDOWS) holds no downtime: an incident inside one does not count.
  const declared = mergeIntervals(clipIntervals(config.sla.noDataWindows, from, to));
  const outside = complementIntervals(declared, from, to);
  const byHost = new Map<string, { host: string; intervals: Interval[]; incidents: number }>();
  for (const i of incidents) {
    const kept = intersectIntervals([[i.start, i.end]], outside);
    if (!kept.length) continue;
    const row = byHost.get(i.hostid) ?? { host: i.host, intervals: [], incidents: 0 };
    row.intervals.push(...kept);
    row.incidents++;
    byHost.set(i.hostid, row);
  }

  const windowSeconds = to - from;
  const hosts: HostAvailability[] = [...byHost.entries()]
    .map(([hostid, row]) => {
      const { total, longest } = mergedSeconds(row.intervals);
      return {
        hostid,
        host: row.host,
        availability: Math.max(0, 100 * (1 - total / windowSeconds)),
        downtime: total,
        incidents: row.incidents,
        longest,
      };
    })
    .sort((a, b) => a.availability - b.availability || b.downtime - a.downtime);

  const noDataWindows = declared.map(([s, e]) => ({ from: s, to: e }));
  return { from, to, windowSeconds, minSeverity, hosts, truncated, basis: 'all-problems', month: month ?? null, noDataWindows };
}

/** The original any-problem availability report, for the last `days` or for one `month`. */
export function getAllProblemsAvailabilityReport(days: number, minSeverity: number, month?: string) {
  if (!month) {
    return cached(
      `avail:all:${days}:${minSeverity}`,
      REPORT_TTL,
      () => heavy.run(() => getAvailability(days, minSeverity)),
      staleReport(REPORT_TTL),
    );
  }
  monthWindow(month); // a month not started yet, or past event retention: 400 here, not inside the cache
  return cached(
    `avail:all:${month}:${minSeverity}`,
    REPORT_TTL,
    () => heavy.run(() => getAvailability(days, minSeverity, month)),
    staleReport(REPORT_TTL),
  );
}

/** The availability report derived from ICMP ping triggers: a month is cached by the engine itself, a rolling window moves with now. */
export function getDerivedAvailabilityReport(opts: { days: number; month?: string; profile: SliProfile; minSeverity: number }) {
  const { days, month, profile, minSeverity } = opts;
  if (month) return getDerivedAvailability({ days, month, profile, minSeverity });
  return cached(
    `avail:${profile}:${days}`,
    REPORT_TTL,
    () => heavy.run(() => getDerivedAvailability({ days, profile, minSeverity })),
    staleReport(REPORT_TTL),
  );
}
