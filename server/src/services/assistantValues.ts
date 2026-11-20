/**
 * The latest values of a host, or the highest across the hosts of a site, for a question about them ("berapa CPU switch X?", "suhu di Pasuruan"). Only the metrics the question names are read,
 * because HCML's Zabbix takes seconds over a host with many items, and an old reading is never given as a current one: a host that is down still holds the last CPU it had.
 */

import { zbx } from '../clients/zabbix.js';
import { isFresh } from '../domain/reachability.js';
import { isNetworkKey } from '../security/viewerPolicy.js';
import { naturalCompare } from '../domain/naming.js';
import type { TopHostsResponse } from './topHosts.js';
import { rateText } from './assistantInternet.js';
import { age, HOST_NAME_MAX, promptText, section } from './assistantLines.js';
import type { Metric } from './assistantTopics.js';

/** One numeric item of a host, with what is needed to say how current it is. */
export interface ValueItem {
  /** Zabbix's id of the item, for a series. */
  itemid?: string;
  hostid: string;
  host: string;
  metric: Metric;
  name: string;
  key: string;
  /** Zabbix's text of the value. */
  value: string;
  units: string;
  /** Epoch seconds. */
  clock: number;
  /** Collected within what the item's own interval allows (reachability.ts `isFresh`). */
  fresh: boolean;
  /** Zabbix reports the item as not supported: it is not being collected, and its last value is only history. */
  unsupported?: boolean;
}

const LABEL: Record<Metric, string> = { cpu: 'CPU', memory: 'Memory', temperature: 'Temperature', disk: 'Disk', traffic: 'Traffic', uptime: 'Uptime', latency: 'Latency' };

const trim = (n: number, decimals: number): string => {
  const fixed = n.toFixed(decimals);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
};

function duration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) {
    const m = Math.floor((s % 3600) / 60);
    return `${Math.floor(s / 3600)}h${m ? ` ${m} min` : ''}`;
  }
  const h = Math.floor((s % 86_400) / 3600);
  return `${Math.floor(s / 86_400)}d${h ? ` ${h}h` : ''}`;
}

const BYTE_PREFIXES = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** A value with its unit, written the way the pages write it. */
export function valueText(value: string, units: string): string {
  const n = Number(value);
  const unit = promptText(units, 20);
  if (value.trim() === '' || !Number.isFinite(n)) return `${promptText(value, 40)}${unit ? ` ${unit}` : ''}`.trim();
  if (unit === '%') return `${trim(n, 1)} %`;
  if (unit === '°C' || unit === 'C' || unit === '℃') return `${trim(n, 1)} °C`;
  if (unit === 'B') {
    let v = n;
    let level = 0;
    while (Math.abs(v) >= 1024 && level < BYTE_PREFIXES.length - 1) {
      v /= 1024;
      level++;
    }
    return `${trim(v, Math.abs(v) >= 100 || level === 0 ? 0 : 1)} ${BYTE_PREFIXES[level]}`;
  }
  if (unit === 'bps' || unit === 'b/s') return rateText(n, 'bps');
  if (unit === 's') return Math.abs(n) < 1 ? `${trim(n * 1000, n * 1000 >= 100 ? 0 : 1)} ms` : `${trim(n, 1)} s`;
  if (unit === 'uptime') return duration(n);
  return `${trim(n, 2)}${unit ? ` ${unit}` : ''}`;
}

const number = (i: ValueItem): number => Number(i.value);

/**
 * An item's name for the prompt. The name of an interface item is `Interface Gi1/0/12(alias): Bits received`, and the alias is free text that staff write, where a name and a number are what they put:
 * a model outside this machine is given the port and the figure and not the alias, as the port block gives it (SC-64).
 */
export function itemName(name: string, local: boolean): string {
  const m = local ? null : /^(Interface\s+[^(]+?)\s*\(.*\):\s(.*)$/s.exec(name);
  return promptText(m ? `${m[1]}: ${m[2]}` : name, 60);
}

const isPingState = (key: string): boolean => /^icmpping(\[|$)/.test(key);
const isPingTime = (key: string): boolean => /^icmppingsec(\[|$)/.test(key);

/** The ICMP ping item holds 1 when the host answered and 0 when it did not, which "ICMP ping 1" does not say. */
const itemText = (i: ValueItem): string => (isPingState(i.key) ? (number(i) === 1 ? 'up' : 'down') : valueText(i.value, i.units));

/**
 * Highest first for the metrics where the high one is the one to look at, name order for the rest. For the CPU and the memory a percentage comes before a number of bytes, since "utilisation" is what is asked
 * for and a switch holds a free and a used figure of its memory beside it.
 */
function ordered(items: ValueItem[], metric: Metric): ValueItem[] {
  const byValue = metric === 'cpu' || metric === 'memory' || metric === 'temperature' || metric === 'traffic';
  const percentFirst = metric === 'cpu' || metric === 'memory';
  const rank = (i: ValueItem) => (percentFirst && i.units.trim() !== '%' ? 1 : 0);
  return [...items].sort((a, b) => rank(a) - rank(b) || (byValue ? number(b) - number(a) : 0) || naturalCompare(a.name, b.name));
}

/** The most items one metric of a host gives; a firewall has a CPU item for each core, and the highest is the one to read. */
const ITEMS_PER_METRIC = 3;

/** What one metric of a host says, cut at `chars` and at `ITEMS_PER_METRIC`, with how many more items there are. */
function metricLine(metric: Metric, items: ValueItem[], now: number, chars: number, local: boolean): { line: string; cut: boolean } {
  const mine = items.filter((i) => i.metric === metric);
  if (!mine.length) return { line: `- ${LABEL[metric]}: not found on this host`, cut: false };
  const current = ordered(mine.filter((i) => i.fresh), metric);
  if (!current.length) {
    const last = ordered(mine, metric)[0];
    const why = last.unsupported ? ', and Zabbix reports the item as not supported' : '';
    return { line: `- ${LABEL[metric]}: no current reading (${itemName(last.name, local)} was ${itemText(last)}, ${age(last.clock, now)} ago${why})`, cut: false };
  }
  let line = `- ${LABEL[metric]}: `;
  let shown = 0;
  for (const i of current) {
    const part = `${itemName(i.name, local)} ${itemText(i)} (${age(i.clock, now)} ago)`;
    const next = shown ? `${line}; ${part}` : `${line}${part}`;
    if (shown && (shown >= ITEMS_PER_METRIC || next.length > chars)) break;
    line = next;
    shown++;
  }
  const left = current.length - shown;
  return { line: left > 0 ? `${line} +${left} more` : line, cut: left > 0 };
}

export interface HostValuesOptions {
  host: string;
  items: ValueItem[];
  /** The metrics the question named, in the fixed order. */
  asked: Metric[];
  now: number;
  /** The time they were read, as the snapshot writes a time. */
  readAt: string;
  budget: number;
  /** The model is on this machine: the alias inside the name of an interface item may be given. */
  local?: boolean;
}

/** The values of one host, a line for each metric the question named. */
export function hostValuesSection({ host, items, asked, now, readAt, budget, local = true }: HostValuesOptions): { text: string; truncated: boolean } {
  const parts = asked.map((m) => metricLine(m, items, now, Math.max(120, Math.floor(budget * 0.6)), local));
  const made = section(`VALUES NOW of ${promptText(host, HOST_NAME_MAX)} (read ${readAt}):`, parts.map((p) => p.line), budget);
  return { text: made.text, truncated: made.truncated || parts.some((p) => p.cut) };
}

export interface SiteValuesOptions {
  site: string;
  items: ValueItem[];
  metric: Metric;
  /** How many hosts the site has, so that "3 of 5 have a reading" is said. */
  hostCount: number;
  now: number;
  readAt: string;
  budget: number;
  /** The model is on this machine: the alias inside the name of an interface item may be given. */
  local?: boolean;
}

const SITE_ROWS = 6;

/** The highest of one metric across the hosts of a site: the highest item of each host with a current reading, highest first. */
export function siteValuesSection({ site, items, metric, hostCount, readAt, budget, local = true }: SiteValuesOptions): { text: string; truncated: boolean } {
  const best = new Map<string, ValueItem>();
  for (const i of items) {
    // The ping state and the loss sit beside the response time, and the highest of the three mixed is meaningless.
    if (!i.fresh || i.metric !== metric || (metric === 'latency' && !isPingTime(i.key))) continue;
    const held = best.get(i.hostid);
    if (!held || number(i) > number(held)) best.set(i.hostid, i);
  }
  const rows = [...best.values()].sort((a, b) => number(b) - number(a) || naturalCompare(a.host, b.host));
  const lines = rows.slice(0, SITE_ROWS).map((i) => `- ${promptText(i.host, HOST_NAME_MAX)}: ${itemName(i.name, local)} ${valueText(i.value, i.units)}`);
  const title = `HIGHEST ${LABEL[metric].toUpperCase()} NOW at ${promptText(site, HOST_NAME_MAX)} (read ${readAt}; ${rows.length} of ${hostCount} hosts have a current reading):`;
  const made = section(title, lines.length ? lines : ['- none'], budget);
  return { text: made.text, truncated: made.truncated || rows.length > SITE_ROWS };
}

/** The Top hosts rows of the hosts of a site, as items, so that a site's CPU and memory are worded like every other site value. */
export function topHostItems(top: TopHostsResponse, metric: 'cpu' | 'memory', hostids: ReadonlySet<string>): ValueItem[] {
  const found = top.metrics.find((m) => m.key === metric);
  if (!found) return [];
  const key = metric === 'cpu' ? 'system.cpu.util' : 'vm.memory.util';
  return found.rows.filter((r) => hostids.has(r.hostid)).map((r) => ({ hostid: r.hostid, host: r.host, metric, name: found.label, key, value: String(r.value), units: '%', clock: r.clock, fresh: true }));
}

/** The busiest hosts by CPU and by memory, from the Dashboard's Top hosts widget, for a question that names no host. */
export function topHostsLines(top: TopHostsResponse, asked: Metric[], readAt: string, limit: number): string[] {
  const lines = top.metrics
    .filter((m) => asked.includes(m.key))
    .map((m) => `- ${m.label} (${m.current} of ${m.considered} hosts have a current reading): ${m.rows.slice(0, limit).map((r) => `${promptText(r.host, HOST_NAME_MAX)} ${valueText(String(r.value), '%')}`).join(', ') || 'none'}`);
  return lines.length ? [`BUSIEST HOSTS NOW (the Dashboard's Top hosts, read ${readAt}; no host or site was named in this question or the one before it):`, ...lines] : [];
}

/** What to ask Zabbix for each metric: the words of the item names, which are the same on every template, and how many items to take. */
const SEARCH: Record<Metric, { names: string[]; limit: number }> = {
  cpu: { names: ['CPU'], limit: 12 },
  memory: { names: ['Memory'], limit: 12 },
  temperature: { names: ['emperature'], limit: 30 },
  disk: { names: ['disk', 'filesystem'], limit: 20 },
  traffic: { names: ['Bits received', 'Bits sent'], limit: 60 },
  uptime: { names: ['uptime'], limit: 6 },
  latency: { names: ['ICMP'], limit: 8 },
};

/** Which item names count for a metric after the search: the walk, status and threshold items carry no value that means it. */
const KEEP: Record<Metric, { name: RegExp; skip: RegExp }> = {
  // The parts of the CPU time and the inverse figures of the memory are not its utilisation: idle time, at 95 %, would be read as a CPU at 95 % (BK-90).
  cpu: { name: /cpu/i, skip: /walk|status|threshold|temperature|idle|iowait|interrupt|steal|softirq|nice|guest|user time|system time|context switch|switches|queue/i },
  memory: { name: /memory/i, skip: /walk|status|threshold|available|total|free|cache|buffer|swap/i },
  temperature: { name: /temperature/i, skip: /status|walk|threshold|alarm/i },
  disk: { name: /disk|filesystem/i, skip: /walk|status|threshold|inode/i },
  traffic: { name: /bits (received|sent)/i, skip: /walk/i },
  uptime: { name: /uptime/i, skip: /walk/i },
  latency: { name: /icmp/i, skip: /walk/i },
};

const READ_MS = 8_000;

/** The most items one read asks for, whatever the number of hosts: Zabbix takes seconds over a thousand. */
const MAX_ITEMS = 800;

interface ItemRow {
  itemid: string;
  name: string;
  key_: string;
  lastvalue?: string;
  lastclock?: string;
  units?: string;
  value_type?: string;
  state?: string;
  delay?: string;
  hosts?: { hostid: string; name: string }[];
}

export interface ReadValuesOptions {
  /** Whether the user's pages include the network pages: without them the interface items are left out, as the Latest data page leaves them out. */
  network: boolean;
  now: number;
}

export async function readHostValues(hosts: { hostid: string; name: string }[], asked: Metric[], { network, now }: ReadValuesOptions): Promise<ValueItem[]> {
  const names = new Map(hosts.map((h) => [h.hostid, h.name]));
  const metrics = asked.filter((m) => network || m !== 'traffic');
  const reads = await Promise.all(
    metrics.map(async (metric) => {
      const rows = await zbx<ItemRow[]>(
        'item.get',
        {
          hostids: hosts.map((h) => h.hostid),
          monitored: true,
          search: { name: SEARCH[metric].names },
          searchByAny: true,
          output: ['itemid', 'name', 'key_', 'lastvalue', 'lastclock', 'units', 'value_type', 'state', 'delay'],
          selectHosts: ['hostid', 'name'],
          // Zabbix applies the limit to the whole answer, so a site of many hosts needs it for each of them.
          limit: Math.min(SEARCH[metric].limit * hosts.length, MAX_ITEMS),
        },
        { timeoutMs: READ_MS },
      );
      const rule = KEEP[metric];
      const kept: ValueItem[] = [];
      for (const r of rows) {
        const hostid = r.hosts?.[0]?.hostid ?? hosts[0]?.hostid ?? '';
        if (!rule.name.test(r.name) || rule.skip.test(r.name)) continue;
        if (r.value_type !== '0' && r.value_type !== '3') continue;
        if (r.lastvalue === undefined || r.lastvalue === '' || !Number.isFinite(Number(r.lastvalue))) continue;
        if (!network && isNetworkKey(r.key_)) continue;
        kept.push({
          itemid: r.itemid,
          hostid,
          host: r.hosts?.[0]?.name ?? names.get(hostid) ?? '',
          metric,
          name: r.name,
          key: r.key_,
          value: r.lastvalue,
          units: r.units ?? '',
          clock: Number(r.lastclock ?? 0),
          fresh: isFresh({ lastclock: r.lastclock, state: r.state, delay: r.delay }, now),
          unsupported: r.state === '1',
        });
      }
      return ordered(kept, metric);
    }),
  );
  return reads.flat();
}
