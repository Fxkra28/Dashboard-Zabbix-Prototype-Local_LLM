/** Open problems by age, and the ones that have gone unacknowledged longest: the aging report. */

import { cached } from '../core/cache.js';
import { cachedProblems, openProblems } from '../domain/queries.js';

export interface AgingReport {
  buckets: { label: string; count: number }[];
  unacknowledged: number;
  total: number;
  /** The problems that have gone unacknowledged longest. */
  oldest: {
    eventid: string;
    name: string;
    host: string;
    severity: string;
    clock: string;
    ageSeconds: number;
  }[];
}

const BUCKETS: { label: string; maxSeconds: number }[] = [
  { label: 'Under 1h', maxSeconds: 3600 },
  { label: '1–4h', maxSeconds: 4 * 3600 },
  { label: '4–24h', maxSeconds: 86400 },
  { label: 'Over 24h', maxSeconds: Infinity },
];

export async function getAging(): Promise<AgingReport> {
  const problems = await cachedProblems().then(openProblems);
  const now = Math.floor(Date.now() / 1000);
  const unacked = problems.filter((p) => p.acknowledged !== '1');

  const buckets = BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const p of unacked) {
    const age = now - Number(p.clock);
    const i = BUCKETS.findIndex((b) => age < b.maxSeconds);
    buckets[i < 0 ? BUCKETS.length - 1 : i].count++;
  }

  return {
    buckets,
    unacknowledged: unacked.length,
    total: problems.length,
    oldest: unacked
      .map((p) => ({
        eventid: p.eventid,
        name: p.name,
        host: p.host ?? '',
        severity: p.severity,
        clock: p.clock,
        ageSeconds: now - Number(p.clock),
      }))
      .sort((a, b) => b.ageSeconds - a.ageSeconds)
      .slice(0, 20),
  };
}

/** Problems by age. */
export function getAgingReport() {
  return cached('aging', 15_000, getAging);
}
