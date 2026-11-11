import type { Device, TopHostsMetric, WebFailure } from '../../types';

export interface HostAvailability {
  /** Hosts that are monitored: a disabled one is not counted. */
  total: number;
  up: number;
  degraded: number;
  down: number;
  nodata: number;
  /** Of the monitored hosts, how many are inside a maintenance window. Not a share of the others: a host can be in both. */
  maintenance: number;
}

/** Host availability as Zabbix's "Host availability" widget counts it, from the portal's own reachability states (ping first, the interface flags as a fallback). */
export function availability(devices: Device[]): HostAvailability {
  const a: HostAvailability = { total: 0, up: 0, degraded: 0, down: 0, nodata: 0, maintenance: 0 };
  for (const d of devices) {
    if (d.state === 'disabled' || d.status === '1') continue;
    a.total++;
    if (d.state === 'up') a.up++;
    else if (d.state === 'degraded') a.degraded++;
    else if (d.state === 'down') a.down++;
    else a.nodata++;
    if (d.maintenance_status === '1') a.maintenance++;
  }
  return a;
}

/** The share of the monitored hosts that are up, to one decimal; null with none. */
export const percentUp = (a: HostAvailability): number | null => (a.total > 0 ? Math.round((a.up / a.total) * 1000) / 10 : null);

/** From this share of use a host is written in the warning colour, and from the higher one in the critical colour. */
export const BUSY = 75;
export const HOT = 90;

/** How a use figure reads: "87%". */
export const usageWords = (value: number): string => `${Math.round(value)}%`;

/** The line under a list of busy hosts when it has no rows, and why. */
export function emptyTopWords(m: TopHostsMetric): string {
  if (m.considered === 0) return 'No host has an item for this.';
  return `No current value: ${m.considered} ${m.considered === 1 ? 'host has' : 'hosts have'} the item, none collected it lately.`;
}

/** What a tile of web monitoring says under its count. */
export const WEB_SUB = { ok: 'every step passed', failed: 'a step failed', unknown: 'no current result' } as const;

/** The panel's line when Zabbix has no web scenario to count. */
export const NO_WEB_WORDS = 'No web scenario is monitored.';

/** The most a wall lists of the failed scenarios and of each list of busy hosts: it cannot scroll, and the slide has to fit with the rest. */
export const WALL_FAILURES = 3;
export const WALL_TOP_ROWS = 8;

/** Which step of a scenario failed. */
export const failureWords = (f: WebFailure): string => `failed at step ${f.step}`;
