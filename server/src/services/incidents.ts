/**
 * Problem occurrences over a window, read from Zabbix once for the availability and alert-noise reports, with the windows they ask about
 * and the lookups that find an outage which began before the window.
 */

import { zbx } from '../clients/zabbix.js';
import { config } from '../core/config.js';
import { chunk, fetchEventsSliced, mapLimit } from '../sli/events.js';
import { checkPeriodStart, monthBounds } from '../sli/time.js';

/**
 * Zabbix severity levels at or above `min`, for `event.get`'s `severities`.
 * Zabbix has no ">= severity" filter, only an explicit list.
 */
export function severitiesAtLeast(min: number): number[] {
  const floor = Math.min(Math.max(Math.trunc(min), 0), 5);
  return [0, 1, 2, 3, 4, 5].filter((s) => s >= floor);
}

/**
 * One resolved problem occurrence. Shared by the availability and alert-noise
 * reports: they ask different questions of the same history, so the fetch and
 * the problem→recovery pairing live here once rather than in each report.
 */
export interface Incident {
  eventid: string;
  /** The trigger that fired. Zabbix calls it objectid on an event. */
  objectid: string;
  host: string;
  hostid: string;
  name: string;
  severity: string;
  /** When it began, or the window's first second when it began earlier. */
  start: number;
  /** When it really began, whatever the window. Only the age of an open problem reads it. */
  began: number;
  /** Recovery time, or *now* when the problem is still open. */
  end: number;
  resolved: boolean;
  acknowledged: boolean;
}

/** A report window in Unix seconds. */
export interface ReportWindow {
  from: number;
  to: number;
}

/** The last `days` days, up to now. */
export function lastDays(days: number): ReportWindow {
  const to = Math.floor(Date.now() / 1000);
  return { from: to - days * 86400, to };
}

/**
 * A calendar month, cut in the SLA time zone (Asia/Jakarta) like every monthly
 * figure in the portal, and clipped to now: the current month is measured as
 * far as it has happened. It asks the same period check as the engine (`checkPeriodStart`).
 */
export function monthWindow(month: string): ReportWindow {
  const now = Math.floor(Date.now() / 1000);
  const { from, to } = monthBounds(month, config.sla.timezone);
  checkPeriodStart(from, now);
  return { from, to: Math.min(to, now) };
}

/**
 * How far before a window to read PROBLEM events, to find the ones already open when it began. A
 * month, so an outage as long as a whole month is still found. Problems that are still open are
 * found at any age (`stillOpenBefore`), and one that began earlier than this and was resolved
 * inside the window is found from its recovery (`endedInWindow`). Only one that began earlier than
 * this and was resolved after the window ended is missed, which takes an outage longer than a month
 * that spans the whole window. The cost is 31 more days of PROBLEM events and a recovery read for
 * each, plus the window's recovery events, on every report.
 */
export const OPEN_AT_START_LOOKBACK = 31 * 86400;

/**
 * Most triggers whose older problem is looked up one by one in a single report. Past it the
 * remaining ones are left out and the report says `truncated`: its figures are then a floor. Each
 * lookup is one Zabbix request, so this is also the most extra requests the long-outage read can
 * add.
 */
export const LONG_OUTAGE_LOOKUPS = 200;

interface ProblemEvent {
  eventid: string;
  objectid: string;
  clock: string;
  severity: string;
  acknowledged?: string;
  r_eventid?: string;
  name?: string;
  hosts?: { hostid: string; name: string }[];
}

interface RecoveryEvent {
  eventid: string;
  objectid: string;
  clock: string;
}

/**
 * The recovery (OK) events of the triggers, which carry no link back to their problem. No severity
 * floor: Zabbix stores severity 0 on a recovery event whatever the trigger's priority, so a floor
 * here returns nothing at all (checked against HCML's restored data). The floor is applied to the
 * triggers afterwards, in `endedInWindow`.
 */
const recoveryEventQuery = {
  source: 0,
  object: 0,
  value: 0,
  output: ['eventid', 'objectid', 'clock'],
};

const problemEventQuery = (minSeverity: number) => ({
  source: 0,
  object: 0,
  value: 1, // PROBLEM events only
  // Filter in Zabbix, not here: a flood of low-severity events must not
  // decide how much of the window is fetched.
  severities: severitiesAtLeast(minSeverity),
  output: ['eventid', 'objectid', 'clock', 'severity', 'r_eventid', 'acknowledged', 'name'],
  selectHosts: ['hostid', 'name'],
});

/**
 * Problems unresolved right now that began at or before `until`. `problem.get`
 * lists unresolved ones only, so this finds a problem open for months without
 * reading months of events; the events themselves are then fetched by id.
 */
async function stillOpenBefore(until: number, minSeverity: number): Promise<ProblemEvent[]> {
  const open = await zbx<{ eventid: string }[]>('problem.get', {
    source: 0,
    object: 0,
    severities: severitiesAtLeast(minSeverity),
    time_till: until,
    output: ['eventid'],
  });
  const ids = open.map((p) => p.eventid);
  const parts = await mapLimit(chunk(ids, 2_000), config.sla.maxParallel, (batch) =>
    zbx<ProblemEvent[]>('event.get', { ...problemEventQuery(minSeverity), eventids: batch }),
  );
  return parts.flat();
}

/**
 * Problems that began before the look-back and were resolved inside the window. Neither read for
 * them can see these: `problem.get` lists only unresolved problems, and the look-back stops a month
 * short. They are found from the other end. A recovery event carries no link to its problem, so the
 * recoveries in the window that no problem already read points at (`explained`) are the ends of
 * older outages, or of problems below the severity floor. A recovery has no severity of its own, so
 * the triggers are asked for their priority, in batches, and those under the floor are dropped. For
 * each trigger left, its last problem before the look-back is asked for, one request per trigger,
 * and kept when it names that very recovery.
 *
 * Only a trigger's first recovery in the window can end an outage that began before it: that outage
 * is still open when the window starts, so the first OK event of the trigger closes it. `partial`
 * is true when more than LONG_OUTAGE_LOOKUPS triggers were left, and the rest were skipped.
 */
async function endedInWindow(
  recoveries: RecoveryEvent[],
  explained: Set<string>,
  lookFrom: number,
  minSeverity: number,
): Promise<{ problems: ProblemEvent[]; partial: boolean }> {
  const firstOfTrigger = new Map<string, RecoveryEvent>();
  for (const r of recoveries) if (!firstOfTrigger.has(r.objectid)) firstOfTrigger.set(r.objectid, r); // ascending by clock
  const unexplained = [...firstOfTrigger.values()].filter((r) => !explained.has(r.eventid));
  // Keep the triggers at or above the floor. One that Zabbix no longer lists is left out: with no
  // trigger there is no problem to find either.
  const priority = new Map<string, number>();
  const parts = await mapLimit(chunk(unexplained.map((r) => r.objectid), 2_000), config.sla.maxParallel, (ids) =>
    zbx<{ triggerid: string; priority: string }[]>('trigger.get', { triggerids: ids, output: ['triggerid', 'priority'] }),
  );
  for (const t of parts.flat()) priority.set(t.triggerid, Number(t.priority));
  const wanted = unexplained.filter((r) => (priority.get(r.objectid) ?? -1) >= minSeverity);
  const asked = wanted.slice(0, LONG_OUTAGE_LOOKUPS);
  const found = await mapLimit(asked, config.sla.maxParallel, async (r) => {
    const [latest] = await zbx<ProblemEvent[]>('event.get', {
      ...problemEventQuery(minSeverity),
      objectids: [r.objectid],
      time_till: lookFrom - 1,
      sortfield: ['clock', 'eventid'],
      sortorder: 'DESC',
      limit: 1,
    });
    return latest && latest.r_eventid === r.eventid ? latest : null;
  });
  return { problems: found.filter((p): p is ProblemEvent => p !== null), partial: wanted.length > asked.length };
}

/**
 * Replay event history into incidents, clipped to the window.
 *
 * Zabbix stores PROBLEM and recovery as separate events linked by `r_eventid`,
 * so the recoveries are fetched in one batch rather than per problem.
 *
 * A problem that began before the window and was still open when it started
 * counts from the window's first second, as the SLA engine counts it.
 */
export async function fetchIncidents(
  { from, to }: ReportWindow,
  minSeverity: number,
): Promise<{ incidents: Incident[]; from: number; to: number; truncated: boolean }> {
  const query = problemEventQuery(minSeverity);
  const lookFrom = from - OPEN_AT_START_LOOKBACK;
  // Every PROBLEM event in the window, in slices, never a silently cut page: a single "newest
  // 10,000" request would drop the oldest events at HCML's volume, and the report would then
  // compute impossible figures. Then the same for the month before it, and the problems still open
  // from before that. And the window's recovery events, which also say when most problems ended.
  const [inWindow, before, older, recoveries] = await Promise.all([
    fetchEventsSliced<ProblemEvent>(query, from, to),
    fetchEventsSliced<ProblemEvent>(query, lookFrom, from - 1),
    stillOpenBefore(lookFrom - 1, minSeverity),
    fetchEventsSliced<RecoveryEvent>(recoveryEventQuery, from, to),
  ]);

  // Keyed by id: a problem raised between the reads could come back from two.
  const events = new Map<string, ProblemEvent>();
  for (const p of [...older, ...before, ...inWindow]) events.set(p.eventid, p);

  // Outages that began before the look-back and ended inside the window.
  const explained = new Set<string>();
  for (const p of events.values()) if (p.r_eventid && p.r_eventid !== '0') explained.add(p.r_eventid);
  const ended = await endedInWindow(recoveries, explained, lookFrom, minSeverity);
  for (const p of ended.problems) events.set(p.eventid, p);

  // Belt and braces: Zabbix has already applied the floor above.
  const qualifying = [...events.values()].filter((p) => Number(p.severity) >= minSeverity);

  // The window's recoveries are already in hand; only those outside it are asked for by id.
  const recoveryClock: Record<string, number> = {};
  for (const r of recoveries) recoveryClock[r.eventid] = Number(r.clock);
  const recoveryIds = qualifying
    .map((p) => p.r_eventid)
    .filter((id): id is string => id !== undefined && id !== '' && id !== '0' && !(id in recoveryClock));
  // Batched, but in chunks: one request naming ten thousand event ids is its
  // own failure mode.
  await mapLimit(chunk(recoveryIds, 2_000), config.sla.maxParallel, async (ids) => {
    const recoveries = await zbx<{ eventid: string; clock: string }[]>('event.get', {
      eventids: ids,
      output: ['eventid', 'clock'],
    });
    for (const r of recoveries) recoveryClock[r.eventid] = Number(r.clock);
  });

  const incidents: Incident[] = [];
  for (const p of qualifying) {
    const h = p.hosts?.[0];
    if (!h) continue;
    const start = Math.max(Number(p.clock), from);
    const resolved = Boolean(p.r_eventid && p.r_eventid !== '0');
    const rec = resolved ? recoveryClock[p.r_eventid as string] : undefined;
    // From before the window with no recovery on record: not assumed open.
    if (Number(p.clock) < from && resolved && rec === undefined) continue;
    const end = Math.min(rec ?? to, to); // still open ⇒ counts up to now
    if (end <= start) continue;

    incidents.push({
      eventid: p.eventid,
      objectid: p.objectid,
      host: h.name,
      hostid: h.hostid,
      name: p.name ?? '',
      severity: p.severity,
      start,
      began: Number(p.clock),
      end,
      resolved,
      acknowledged: p.acknowledged === '1',
    });
  }

  // A floor, not an exact figure, only when more outages needed a lookup than LONG_OUTAGE_LOOKUPS allows.
  return { incidents, from, to, truncated: ended.partial };
}
