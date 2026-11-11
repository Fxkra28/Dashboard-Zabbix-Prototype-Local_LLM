/** What the prompt says that takes a little work to know: hosts per state, since when a host has been down, and counts over every open problem. */

import type { ZbxProblem } from '../domain/queries.js';
import type { SiteHost } from './sites.js';
import type { HostState } from '../domain/reachability.js';
import { naturalCompare } from '../domain/naming.js';
import { HOST_NAME_MAX, promptText, sevName } from './assistantLines.js';

/** Problem names that mean "this host cannot be reached". */
const UNAVAILABLE_PROBLEM = /unavailable by icmp|not available|unreachable|no snmp data/i;

/** Hosts per state (reachability.ts): ping first, the interface flags only without a recent ping. */
export function stateCounts(hosts: SiteHost[]): Record<HostState, number> {
  const counts: Record<HostState, number> = { up: 0, down: 0, degraded: 0, nodata: 0, disabled: 0 };
  for (const h of hosts) counts[h.state]++;
  return counts;
}

type AvailabilitySince = Map<string, { icmp?: number; other?: number }>;

/**
 * When each host's open availability problems began: the oldest ICMP one and
 * the oldest other one (SNMP, agent). How long a host has been down comes from
 * here, otherwise the model invents a duration.
 */
export function availabilitySince(problems: ZbxProblem[]): AvailabilitySince {
  const since: AvailabilitySince = new Map();
  for (const p of problems) {
    if (!p.hostid || !UNAVAILABLE_PROBLEM.test(p.name)) continue;
    const kind = /icmp/i.test(p.name) ? 'icmp' : 'other';
    const clock = Number(p.clock);
    const entry = since.get(p.hostid) ?? {};
    entry[kind] = Math.min(entry[kind] ?? clock, clock);
    since.set(p.hostid, entry);
  }
  return since;
}

/**
 * Since when a host has been in its state. Down: from its ICMP problem, else
 * any availability problem. Degraded: from its SNMP or agent problem only: the
 * host answers ping, so an ICMP problem still open says nothing about it.
 */
export function stateSince(h: SiteHost, since: AvailabilitySince): number | undefined {
  const s = since.get(h.hostid);
  if (h.state === 'down') return s?.icmp ?? s?.other;
  if (h.state === 'degraded') return s?.other;
  return undefined;
}

const OLDEST = ['Oldest open', '2nd oldest open', '3rd oldest open'];

/**
 * What only the whole problem list can say, counted over every open problem. Given just the worst few,
 * a model answers "the oldest" and "how many on this host" from those few.
 */
export function wholeListLines(problems: ZbxProblem[], hosts: SiteHost[], day: (clock: number) => string): string[] {
  const monitored = hosts.filter((h) => h.state !== 'disabled');
  const withProblems = new Set(problems.map((p) => p.hostid).filter(Boolean));
  const lines = [`- Hosts with no open problem: ${monitored.filter((h) => !withProblems.has(h.hostid)).length} of ${monitored.length} monitored`];
  if (!problems.length) return lines;

  const perHost = new Map<string, { name: string; count: number }>();
  for (const p of problems) {
    const key = p.hostid || p.host;
    if (!key) continue;
    const row = perHost.get(key) ?? { name: promptText(p.host, HOST_NAME_MAX) || 'unknown host', count: 0 };
    row.count++;
    perHost.set(key, row);
  }
  const busiest = [...perHost.values()].sort((a, b) => b.count - a.count || naturalCompare(a.name, b.name)).slice(0, 5);
  lines.push(`- Hosts with the most open problems: ${busiest.map((h) => `${h.name} ${h.count}`).join(', ')}`);

  const oldest = [...problems].sort((a, b) => Number(a.clock) - Number(b.clock)).slice(0, OLDEST.length);
  oldest.forEach((p, i) => {
    const host = promptText(p.host, HOST_NAME_MAX) || 'unknown host';
    lines.push(`- ${OLDEST[i]}: [${sevName(p.severity)}] ${host}: ${promptText(p.name, 100)}; open since ${day(Number(p.clock))}`);
  });
  return lines;
}
