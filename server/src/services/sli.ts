import { cached, invalidate } from '../core/cache.js';
import { config, toSliProfile, type SliProfile } from '../core/config.js';
import { BadRequestError, DataNotReadYetError } from '../core/validate.js';
import { computeSli, DERIVED_LABEL, readSliData, type DailyHours, type SliReport } from '../sli/engine.js';
import { evaluateSli, sliDataBytes, type SliData } from '../sli/evaluate.js';
import { totalSeconds } from '../sli/intervals.js';
import { SETTLE_SECONDS } from '../sli/schedule.js';
import { freezeWeb } from './closedWeb.js';
import { sliReads } from './reportPolicy.js';
import { checkPeriodStart, monthBounds } from '../sli/time.js';
import { checkWindow, dailySpans, monthsTouched } from '../sli/window.js';

/**
 * The derived SLA (sli/engine.ts), read-only.
 *
 *   GET /api/sli?month=YYYY-MM&profile=availability|hcml-report
 *   GET /api/sli?from=&to=&profile=[&dayHours=8-17][&days=1,2,3,4,5]
 *
 * A closed month moves only when a maintenance period is edited or the readings behind the web checks age out, so it is cached for a day,
 * once Zabbix has had ten minutes for its last values; the current month and the ten minutes after it move and are cached for five minutes. A report takes seconds to compute, so
 * for as long again after that the previous one is answered at once while a
 * fresh one is computed in the background.
 *
 * A window that is not a calendar month is worked out from the data of the months it touches (ADR-0018), each read once and kept under the same rules, so a range costs
 * its months and the choice of hours costs nothing at Zabbix.
 */

export function parseProfile(raw: unknown): SliProfile {
  if (raw === undefined || raw === '') return config.sla.defaultProfile;
  const profile = toSliProfile(String(raw));
  if (!profile) throw new BadRequestError('profile must be "availability" or "hcml-report".');
  return profile;
}

const PROFILES: readonly SliProfile[] = ['availability', 'hcml-report'];

/** Drops what is kept for a month, in both methods and every phase: a report that came back empty must not be the answer to the next try (BK-51). */
export function forgetMonthlySli(month: string): void {
  for (const profile of PROFILES) {
    invalidate(`derived-sli:${profile}:${month}:`);
    invalidate(`sli-data:${profile}:${month}:`);
    // The evaluated windows are made of months: a window that touched this one must not be answered again (BK-79).
    invalidate(`sli-window:${profile}:`);
  }
}

/** Three phases, each with its own key: what is read while the month still runs, or in the minutes after it ended while Zabbix still gets its last values (the monthly send waits as long), must not be kept for a day as the final figure. */
function phaseOf(to: number, now: number): 'closed' | 'settling' | 'open' {
  return to + SETTLE_SECONDS <= now ? 'closed' : to <= now ? 'settling' : 'open';
}

/** The report for one calendar month, shared by every caller under one cache key. `signal` fires when this caller's reader leaves (core/cache.ts). */
export function getMonthlySli(month: string, profile: SliProfile, signal?: AbortSignal): Promise<SliReport> {
  const { from, to } = monthBounds(month, config.sla.timezone);
  const now = Math.floor(Date.now() / 1000);
  // Before the gate: a month nobody can report is refused at once, and does not wait for a place behind cold months (BK-50).
  checkPeriodStart(from, now);
  const phase = phaseOf(to, now);
  const closed = phase === 'closed';
  const ttl = closed ? 86_400_000 : 300_000;
  const key = `derived-sli:${profile}:${month}:${phase}`;
  // The web check figures of a closed month are kept as first read (closedWeb.ts, BK-60); a month still running, or settling, is not.
  const compute = async () => {
    const report = await computeSli({ month, profile });
    return closed ? freezeWeb(report) : report;
  };
  // A closed month costs a full recompute and changes rarely: pinned, so a run
  // of graph keys cannot push it out of the cache.
  return cached(key, ttl, (f) => sliReads.run(compute, f), { staleMs: ttl, staleIfError: true, pin: closed, signal });
}

/** What Zabbix said about one calendar month in one method, read once and kept in memory (ADR-0018). The phases and lifetimes are the monthly report's. */
export function getMonthData(month: string, profile: SliProfile, signal?: AbortSignal, maxAgeMs?: number): Promise<SliData> {
  const { from, to } = monthBounds(month, config.sla.timezone);
  const now = Math.floor(Date.now() / 1000);
  checkPeriodStart(from, now);
  const phase = phaseOf(to, now);
  const closed = phase === 'closed';
  const ttl = closed ? 86_400_000 : 300_000;
  const key = `sli-data:${profile}:${month}:${phase}`;
  const read = () => readSliData({ profile, from, to, now: Math.floor(Date.now() / 1000) });
  return cached(key, ttl, (f) => sliReads.run(read, f), { staleMs: ttl, staleIfError: true, pin: closed, signal, weigh: (d) => sliDataBytes(d as SliData), ...(maxAgeMs === undefined ? {} : { maxAgeMs }) });
}

/** How long an evaluated window is kept: the page's refresh, a download and an email that follow it share one evaluation, which costs seconds of the BFF's one thread (BK-79). */
const WINDOW_REPORT_MS = 120_000;

export interface WindowRequest {
  from: number;
  to: number;
  profile: SliProfile;
  /** The hours of the day that count, or null for all of them. */
  hours: DailyHours | null;
  /** Set when the window is a calendar month, so that the report says which. */
  month?: string;
  signal?: AbortSignal;
}

/** The report for any window of whole hours, from the months it touches. It has no web checks, which are monthly. */
export async function getWindowSli(req: WindowRequest): Promise<SliReport> {
  const started = Date.now();
  const now = Math.floor(started / 1000);
  const tz = config.sla.timezone;
  checkWindow(req.from, req.to, now, tz);
  const end = Math.min(req.to, now);
  if (req.hours && totalSeconds(dailySpans(req.hours, req.from, end, tz)) === 0) {
    throw new BadRequestError('No hour of this range falls inside the daily hours you chose.');
  }

  const months = monthsTouched(req.from, end, tz);
  const datas = await Promise.all(months.map((m) => getMonthData(m, req.profile, req.signal)));
  // What the newest data measures of the window: with daily hours, the seconds of those hours that it reaches. Nothing means a window of minus some seconds, or of none, and No data for every device, with a 200.
  const newest = datas.length - 1;
  const measured = (readEnd: number) => {
    const to = Math.min(req.to, readEnd);
    return to <= req.from ? 0 : req.hours ? totalSeconds(dailySpans(req.hours, req.from, to, tz)) : to - req.from;
  };
  // The newest data was read before the window began, or before its first hour of the day (a Day that is today asked just after midnight, a range from the top of the hour, while the month's data is kept
  // for minutes). The month is read again, now, whatever the age of the copy: it may have been stored after the window began by a read that started before it (BK-80).
  if (measured(datas[newest].end) === 0) datas[newest] = await getMonthData(months[newest], req.profile, req.signal, 0);
  if (measured(datas[newest].end) === 0) {
    throw new DataNotReadYetError('There is nothing to measure yet: the range begins at this moment and no reading is newer than it. Try again in a minute.');
  }
  const readAt = Math.max(...datas.map((d) => d.readAt));
  // What one window, read from the same data, evaluates to: kept for a short time under the choices and the newest read, so the page's two methods, its refresh, a file and an email share one.
  const hoursKey = req.hours ? `${req.hours.start}-${req.hours.end}:${req.hours.weekdays?.join(',') ?? 'all'}` : 'all';
  const key = `sli-window:${req.profile}:${req.from}:${req.to}:${req.month ?? ''}:${hoursKey}:${readAt}`;
  return cached(
    key,
    WINDOW_REPORT_MS,
    async () => {
      const { estateSeconds: _, outsideDeclared: __, ...evaluated } = evaluateSli(datas, { from: req.from, to: req.to, hours: req.hours });
      const sum = (pick: (d: SliData) => number) => datas.reduce((n, d) => n + pick(d), 0);
      return {
        source: 'derived' as const,
        label: DERIVED_LABEL,
        ...evaluated,
        month: req.month ?? null,
        web: [],
        stats: {
          zabbixCalls: sum((d) => d.stats.zabbixCalls),
          triggers: Math.max(...datas.map((d) => d.stats.triggers)),
          events: sum((d) => d.stats.events),
          trendRows: sum((d) => d.stats.trendRows),
          ms: Date.now() - started,
        },
        generatedAt: readAt,
      };
    },
    { typed: true, signal: req.signal },
  );
}
