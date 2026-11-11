import { cached } from '../core/cache.js';
import { config } from '../core/config.js';
import { fetchIncidents, type Incident, lastDays } from './incidents.js';
import { heavy, REPORT_TTL, staleReport } from './reportPolicy.js';

/**
 * HCML Goal 4: *"the main issue is not the number of alarms, but the quality
 * of information needed to act."*
 *
 * Top 100 triggers already answers *how often* a trigger fired. That alone
 * can't separate noise from signal: forty firings that self-clear in 90
 * seconds are noise; forty that take an hour each are a real recurring fault.
 * Duration and acknowledgement are what tell them apart, so this report adds
 * both, and flags the triggers worth retuning.
 */
export type NoiseFlag = 'flapping' | 'unactioned' | 'chronic';

export interface NoisyTrigger {
  objectid: string;
  name: string;
  host: string;
  hostid: string;
  severity: string;
  count: number;
  /** Median, not mean: one long outlier must not hide forty short firings. */
  medianDuration: number;
  /** Incidents that cleared before anyone could realistically act. */
  shortLived: number;
  /** 0..1. Zero across many firings = the team has learned to ignore it. */
  ackRate: number;
  totalDuration: number;
  longest: number;
  stillOpen: boolean;
  flags: NoiseFlag[];
}

export interface NoiseReport {
  from: number;
  to: number;
  windowSeconds: number;
  minSeverity: number;
  truncated: boolean;
  totalEvents: number;
  distinctTriggers: number;
  /** The Pareto line: "N triggers produced X% of all alerts." */
  concentration: { topN: number; percentOfEvents: number };
  counts: Record<NoiseFlag, number>;
  thresholds: { shortSeconds: number; minCount: number };
  /** Triggers in the report before `?top=` cut the list; the figures above cover all of them. */
  total: number;
  triggers: NoisyTrigger[];
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** A single stuck condition is a different problem from a chatty one. */
const CHRONIC_SECONDS = 86_400;

export async function getNoise(days: number, minSeverity: number): Promise<NoiseReport> {
  const { incidents, from, to, truncated } = await fetchIncidents(lastDays(days), minSeverity);
  const { shortSeconds, minCount } = config.noise;

  const byTrigger = new Map<string, Incident[]>();
  for (const i of incidents) {
    const list = byTrigger.get(i.objectid);
    if (list) list.push(i);
    else byTrigger.set(i.objectid, [i]);
  }

  const triggers: NoisyTrigger[] = [...byTrigger.entries()].map(([objectid, list]) => {
    const durations = list.map((i) => i.end - i.start);
    const acked = list.filter((i) => i.acknowledged).length;
    const med = median(durations);
    // Not Math.max(...durations): a call with about 125,000 arguments throws, and one flapping trigger gets there.
    const longest = durations.reduce((a, b) => (b > a ? b : a), 0);
    const stillOpen = list.some((i) => !i.resolved);
    // An open problem's real age, not the part inside the window: a 1 day window holds at most a day of it.
    let openAge = 0;
    for (const i of list) if (!i.resolved) openAge = Math.max(openAge, i.end - i.began);
    const ackRate = acked / list.length;

    const flags: NoiseFlag[] = [];
    // Fires often and clears itself before anyone could act.
    if (list.length >= minCount && med < shortSeconds) flags.push('flapping');
    // Fires often and nobody has ever acknowledged it.
    if (list.length >= minCount && acked === 0) flags.push('unactioned');
    // Not noise: one condition nobody has cleared.
    if (stillOpen && Math.max(longest, openAge) > CHRONIC_SECONDS) flags.push('chronic');

    // The newest incident carries the most current name/severity.
    const latest = list.reduce((a, b) => (b.start > a.start ? b : a));

    return {
      objectid,
      name: latest.name,
      host: latest.host,
      hostid: latest.hostid,
      severity: latest.severity,
      count: list.length,
      medianDuration: med,
      shortLived: durations.filter((d) => d < shortSeconds).length,
      ackRate,
      totalDuration: durations.reduce((a, b) => a + b, 0),
      longest,
      stillOpen,
      flags,
    };
  });

  triggers.sort((a, b) => b.count - a.count || b.totalDuration - a.totalDuration);

  // Pareto: how much of the total alert volume comes from the loudest few?
  const topN = Math.min(5, triggers.length);
  const topEvents = triggers.slice(0, topN).reduce((s, t) => s + t.count, 0);

  const counts: Record<NoiseFlag, number> = { flapping: 0, unactioned: 0, chronic: 0 };
  for (const t of triggers) for (const f of t.flags) counts[f]++;

  return {
    from,
    to,
    windowSeconds: to - from,
    minSeverity,
    truncated,
    totalEvents: incidents.length,
    distinctTriggers: triggers.length,
    concentration: {
      topN,
      percentOfEvents: incidents.length ? Math.round((topEvents / incidents.length) * 100) : 0,
    },
    counts,
    thresholds: { shortSeconds, minCount },
    total: triggers.length,
    triggers,
  };
}

/** The loudest `top` triggers of a full report, in its order; every other figure still covers all of them. */
export function topNoise(report: NoiseReport, top: number): NoiseReport {
  return report.triggers.length <= top ? report : { ...report, triggers: report.triggers.slice(0, top) };
}

/** The noisiest triggers. The full report is cached once; `top` only cuts what is sent. */
export async function getNoiseReport(days: number, minSeverity: number, top: number) {
  const report = await cached(
    `noise:${days}:${minSeverity}`,
    REPORT_TTL,
    () => heavy.run(() => getNoise(days, minSeverity)),
    staleReport(REPORT_TTL),
  );
  return topNoise(report, top);
}
