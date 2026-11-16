import { cached, invalidate } from '../core/cache.js';
import { config, toSliProfile, type SliProfile } from '../core/config.js';
import { BadRequestError } from '../core/validate.js';
import { computeSli, type SliReport } from '../sli/engine.js';
import { SETTLE_SECONDS } from '../sli/schedule.js';
import { freezeWeb } from './closedWeb.js';
import { sliReads } from './reportPolicy.js';
import { checkPeriodStart, monthBounds } from '../sli/time.js';

/**
 * The derived monthly SLA (sli/engine.ts), read-only.
 *
 *   GET /api/sli?month=YYYY-MM&profile=availability|hcml-report
 *
 * A closed month moves only when a maintenance period is edited or the readings behind the web checks age out, so it is cached for a day,
 * once Zabbix has had ten minutes for its last values; the current month and the ten minutes after it move and are cached for five minutes. A report takes seconds to compute, so
 * for as long again after that the previous one is answered at once while a
 * fresh one is computed in the background.
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
  for (const profile of PROFILES) invalidate(`derived-sli:${profile}:${month}:`);
}

/** The report for one calendar month, shared by every caller under one cache key. `signal` fires when this caller's reader leaves (core/cache.ts). */
export function getMonthlySli(month: string, profile: SliProfile, signal?: AbortSignal): Promise<SliReport> {
  const { from, to } = monthBounds(month, config.sla.timezone);
  const now = Math.floor(Date.now() / 1000);
  // Before the gate: a month nobody can report is refused at once, and does not wait for a place behind cold months (BK-50).
  checkPeriodStart(from, now);
  // Three phases, each with its own key: a report computed while the month was still running, or in the minutes after it
  // ended while Zabbix still gets its last values (the monthly send waits as long), must not be kept for a day as the final figure.
  const phase = to + SETTLE_SECONDS <= now ? 'closed' : to <= now ? 'settling' : 'open';
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
