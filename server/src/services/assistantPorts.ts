/**
 * The state of one port of a switch or firewall, for "port Gi1/0/12 di switch X up atau down?": the status, the speed, the traffic in and out and the errors, from the rows that the Network page folds out of
 * the interface items. A row whose items are old or unsupported has no figure, and is said to have none.
 */

import { rateText } from './assistantInternet.js';
import { age, HOST_NAME_MAX, promptText, section } from './assistantLines.js';
import { getInterfacePage, type InterfaceRow } from './net.js';

/** An interface name as people write it: Gi1/0/12, Te1/1/1, port1, wan2, Vlan120, eth1. */
const PORT = /\b((?:gigabitethernet|tengigabitethernet|fastethernet|ethernet|gig|gi|te|fa|eth|et|ge|xe|po|port-?channel|vlan|lan|wan|port|internal)\s?-?\d+(?:\/\d+){0,3}(?:\.\d+)?)\b/i;

/** The port a question names, without spaces, or null. */
export function portOf(question: string): string | null {
  const m = PORT.exec(question);
  return m ? m[1].replace(/\s+/g, '') : null;
}

/** The most interfaces one question lists. */
export const PORTS_MAX = 3;

/** The alias of an interface is free text that staff write, so a model outside this machine is given the name alone (SC-64). */
function portLine(r: InterfaceRow, now: number, local: boolean): string {
  const label = `${promptText(r.name, 40)}${local && r.alias ? ` (${promptText(r.alias, 40)})` : ''}`;
  if (r.lastclock === null && r.operStatus === 'unknown') return `- ${label}: no current reading; Zabbix holds only old values, or none, for its interface items`;
  const status = r.operStatus === 'lowerLayerDown' ? 'down (the layer below it is down)' : r.operStatus;
  const rates = [r.inBps !== null ? `in ${rateText(r.inBps, 'bps')}` : '', r.outBps !== null ? `out ${rateText(r.outBps, 'bps')}` : ''].filter(Boolean).join(', ');
  const used = r.utilisation !== null ? `${r.utilisation} % of its speed in the busier direction` : '';
  const faults = [(r.inErrors ?? 0) > 0 || (r.outErrors ?? 0) > 0 ? `errors in ${r.inErrors ?? 0}/s, out ${r.outErrors ?? 0}/s` : '', (r.inDiscards ?? 0) > 0 || (r.outDiscards ?? 0) > 0 ? `discards in ${r.inDiscards ?? 0}/s, out ${r.outDiscards ?? 0}/s` : ''].filter(Boolean).join('; ');
  const read = r.lastclock !== null ? `read ${age(r.lastclock, now)} ago` : '';
  return `- ${label}: ${[status, r.speed ? `speed ${rateText(r.speed, 'bps')}` : '', rates, used, faults, read].filter(Boolean).join('; ')}`;
}

export interface PortFound {
  rows: InterfaceRow[];
  total: number;
  /** When nothing matches: how many interfaces the host has in all, and the first few names, so that the answer says what is there. */
  hostTotal?: number;
  sample?: string[];
}

const noneText = (found: PortFound): string =>
  found.hostTotal === undefined
    ? '- none: no interface of this host has that name'
    : found.hostTotal === 0
      ? '- none: Zabbix holds no interface items for this host'
      : `- none: no interface of this host is named like that; it has ${found.hostTotal} interface${found.hostTotal === 1 ? '' : 's'}, such as ${(found.sample ?? []).map((n) => promptText(n, 40)).join(', ')}`;

export function portsSection(host: string, token: string, found: PortFound, { now, budget, local = true }: { now: number; budget: number; local?: boolean }): { text: string; truncated: boolean } {
  const exact = found.rows.filter((r) => r.name.toLowerCase() === token.toLowerCase());
  const rows = [...exact, ...found.rows.filter((r) => !exact.includes(r))].slice(0, PORTS_MAX);
  const title = `PORT ${promptText(token, 30)} of ${promptText(host, HOST_NAME_MAX)} (${found.total} interface${found.total === 1 ? '' : 's'} match${found.total === 1 ? 'es' : ''}):`;
  return section(title, rows.length ? rows.map((r) => portLine(r, now, local)) : [noneText(found)], budget, (left) => `- …and ${left} more interfaces, not listed`);
}

export async function readPort(hostid: string, token: string): Promise<PortFound> {
  const { rows, total } = await getInterfacePage({ hostid, search: token, page: 1, pageSize: 20 });
  if (total > 0) return { rows, total };
  const all = await getInterfacePage({ hostid, page: 1, pageSize: 5 });
  return { rows, total, hostTotal: all.total, sample: all.rows.map((r) => r.name) };
}
