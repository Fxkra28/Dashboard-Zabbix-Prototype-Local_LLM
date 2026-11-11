import { zbx } from '../clients/zabbix.js';
import { cached, SLOW_VIEW } from '../core/cache.js';
import { isFresh } from '../domain/reachability.js';
import { capacityMetricFor } from './capacity.js';

/**
 * The busiest hosts right now by CPU and by memory, as the Zabbix dashboard widget "Top hosts" shows them.
 * The keys are the capacity report's (analytics.ts `capacityMetricFor`), so a Linux agent, a Cisco and a FortiGate count alike.
 */

export interface TopHostRow {
  hostid: string;
  host: string;
  itemid: string;
  /** Percent. */
  value: number;
  /** When it was collected, epoch seconds. */
  clock: number;
}

export interface TopHostsMetric {
  key: 'cpu' | 'memory';
  label: string;
  /** Hosts that have such an item. */
  considered: number;
  /** Of those, with a value from the last few intervals. An old one says nothing about now and is never listed. */
  current: number;
  rows: TopHostRow[];
}

export interface TopHostsResponse {
  generatedAt: number;
  metrics: TopHostsMetric[];
}

interface ZItem {
  itemid: string;
  key_: string;
  lastvalue?: string;
  lastclock?: string;
  delay?: string;
  state?: string;
  hosts?: { hostid: string; name: string }[];
}

/** Rows for each metric when the request does not say: the Zabbix "Top hosts" widget lists ten. */
export const TOP_HOSTS_ROWS = 10;

const METRICS = [
  { key: 'cpu', label: 'CPU utilisation', search: 'system.cpu.util' },
  { key: 'memory', label: 'Memory utilisation', search: 'vm.memory.util' },
] as const;

export async function getTopHosts(limit: number): Promise<TopHostsResponse> {
  const now = Math.floor(Date.now() / 1000);
  const metrics = await Promise.all(
    METRICS.map(async (m): Promise<TopHostsMetric> => {
      const items = await zbx<ZItem[]>('item.get', {
        search: { key_: m.search },
        startSearch: true,
        monitored: true,
        output: ['itemid', 'key_', 'lastvalue', 'lastclock', 'delay', 'state'],
        selectHosts: ['hostid', 'name'],
      });
      // One entry for each host: its hottest current item (a switch can have a CPU item for each module).
      const best = new Map<string, TopHostRow | null>();
      for (const it of items) {
        const host = it.hosts?.[0];
        if (!host || capacityMetricFor(it.key_) !== m.key) continue;
        if (!best.has(host.hostid)) best.set(host.hostid, null);
        const value = Number(it.lastvalue);
        if (it.lastvalue === undefined || it.lastvalue === '' || !Number.isFinite(value) || !isFresh(it, now)) continue;
        const held = best.get(host.hostid);
        if (!held || value > held.value) {
          best.set(host.hostid, { hostid: host.hostid, host: host.name, itemid: it.itemid, value, clock: Number(it.lastclock) });
        }
      }
      const current = [...best.values()].filter((r): r is TopHostRow => r !== null);
      current.sort((a, b) => b.value - a.value || a.host.localeCompare(b.host));
      return { key: m.key, label: m.label, considered: best.size, current: current.length, rows: current.slice(0, limit) };
    }),
  );
  return { generatedAt: now, metrics };
}

/** The busiest hosts as the route and the warm-up read it. */
export const topHostsView = (limit = TOP_HOSTS_ROWS) => cached(`top-hosts:${limit}`, 30_000, () => getTopHosts(limit), SLOW_VIEW);
