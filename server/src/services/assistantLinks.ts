/**
 * The WAN links and the web checks, for "latency link WAN ke Surabaya?" and "web check mana yang gagal?": each in the words of the page that shows it (Links & WAN health, and the web checks of the Dashboard),
 * worst first, from the views those pages keep.
 */

import { HOST_NAME_MAX, promptText, section, stamp } from './assistantLines.js';
import type { Link, LinksResponse } from './links.js';
import type { WebMonitoringResponse } from './webMonitoring.js';

/** The most lines one of these lists gives. */
const LINES_MAX = 10;

const STATE_ORDER: Record<Link['state'], number> = { down: 0, degraded: 1, unknown: 2, up: 3 };

const ms = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(n < 10 ? 1 : 0)} ms`;

/**
 * A link is named by its host and its far end; the item's own name is added only when it says more than "ICMP loss", which every one of them is called. The far end is an address or a DNS name
 * and the item's name is free text, so a model outside this machine is given neither (SC-64).
 */
function linkLine(l: Link, local: boolean): string {
  const ends = `${promptText(l.host, HOST_NAME_MAX)}${local && l.target ? ` to ${promptText(l.target, HOST_NAME_MAX)}` : ''}`;
  const label = local && l.label && !/^icmp\b/i.test(l.label) ? ` (${promptText(l.label, 60)})` : '';
  const figures = [l.loss !== undefined ? `loss ${l.loss} %` : '', l.latency !== undefined ? `latency ${ms(l.latency)}` : '', l.jitter !== undefined ? `jitter ${ms(l.jitter)}` : '', l.role ? promptText(l.role, 20) : '']
    .filter(Boolean)
    .join(', ');
  return `- ${ends}${label}: ${l.state === 'unknown' ? 'no current reading' : l.state}${figures ? `, ${figures}` : ''}`;
}

/** Links that Zabbix tags with a role or a group are the WAN links proper, which a question about the WAN is about. */
const tagged = (l: Link): number => (l.role || l.group ? 0 : 1);

/** The links, worst state first and then the slowest; `hostids` narrows them to a site or a host. */
export function linksSection(
  res: LinksResponse,
  { hostids, scope, budget, local = true }: { hostids: ReadonlySet<string> | null; scope: string | null; budget: number; local?: boolean },
): { text: string; truncated: boolean } {
  const mine = hostids ? res.links.filter((l) => hostids.has(l.hostid)) : res.links;
  const where = scope ? `at ${promptText(scope, HOST_NAME_MAX)}` : 'across the estate';
  const count = (state: Link['state']) => mine.filter((l) => l.state === state).length;
  const title = `WAN LINKS ${where} (${mine.length}: ${count('up')} up, ${count('degraded')} degraded, ${count('down')} down, ${count('unknown')} unknown; loss warns at ${res.thresholds.lossWarn} %, is critical at ${res.thresholds.lossCrit} %${local ? '' : '; the far end and the item name of each link are not given to a model outside this machine'}):`;
  const ordered = [...mine].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || tagged(a) - tagged(b) || (b.latency ?? 0) - (a.latency ?? 0)).slice(0, LINES_MAX);
  return section(title, ordered.length ? ordered.map((l) => linkLine(l, local)) : ['- none: no WAN link is monitored here'], budget, (left) => `- …and ${left} more links, not listed`);
}

export function webSection(res: WebMonitoringResponse, { tz, budget }: { tz: string; budget: number }): { text: string; truncated: boolean } {
  const title = `WEB CHECKS (${res.total} scenarios: ${res.ok} ok, ${res.failed} failed, ${res.unknown} without a current result, which is never read as ok):`;
  const lines = res.failures.slice(0, LINES_MAX).map((f) => `- ${promptText(f.host, HOST_NAME_MAX)}: ${promptText(f.name, 60)} failed at step ${f.step}, checked ${stamp(f.clock, tz)}`);
  return section(title, lines.length ? lines : ['- none: no web check is failing'], budget, (left) => `- …and ${left} more failures, not listed`);
}
