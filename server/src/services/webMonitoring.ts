import { zbx } from '../clients/zabbix.js';
import { cached, SLOW_VIEW } from '../core/cache.js';
import { isFresh } from '../domain/reachability.js';

/**
 * Web monitoring, as the Zabbix dashboard widget of that name counts it: every enabled web scenario is OK, failed or unknown.
 * One item holds each scenario's result, `web.test.fail[<scenario>]`: 0 when every step passed, otherwise the step that failed.
 */

export interface WebFailure {
  hostid: string;
  host: string;
  /** The scenario's name. */
  name: string;
  itemid: string;
  /** The step that failed, counting from 1. */
  step: number;
  /** When it was collected, epoch seconds. */
  clock: number;
}

export interface WebMonitoringResponse {
  generatedAt: number;
  /** Enabled scenarios on monitored hosts. */
  total: number;
  ok: number;
  failed: number;
  /** Scenarios with no current result: none yet, an old one, or an item Zabbix cannot collect. An old result is never read as OK. */
  unknown: number;
  /** The failed ones, by host and name, as many as were asked for. */
  failures: WebFailure[];
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

const KEY = 'web.test.fail[';

/** Rows of failures when the request does not say. */
export const WEB_FAILURES_ROWS = 10;

/** The scenario's name out of its item key, which Zabbix quotes when the name has a comma, a bracket or a quote in it. */
export function scenarioName(key: string): string {
  const inner = key.startsWith(KEY) && key.endsWith(']') ? key.slice(KEY.length, -1) : key;
  return inner.length >= 2 && inner.startsWith('"') && inner.endsWith('"') ? inner.slice(1, -1).replace(/\\"/g, '"') : inner;
}

export async function getWebMonitoring(limit: number): Promise<WebMonitoringResponse> {
  const now = Math.floor(Date.now() / 1000);
  // `webitems` is what makes item.get return the items of web scenarios at all.
  const items = await zbx<ZItem[]>('item.get', {
    search: { key_: KEY },
    startSearch: true,
    webitems: true,
    monitored: true,
    output: ['itemid', 'key_', 'lastvalue', 'lastclock', 'delay', 'state'],
    selectHosts: ['hostid', 'name'],
  });
  let ok = 0;
  let unknown = 0;
  const failures: WebFailure[] = [];
  for (const it of items) {
    const host = it.hosts?.[0];
    if (!host || !it.key_.startsWith(KEY)) continue;
    const value = Number(it.lastvalue);
    if (it.lastvalue === undefined || it.lastvalue === '' || !Number.isFinite(value) || !isFresh(it, now)) {
      unknown++;
    } else if (value === 0) {
      ok++;
    } else {
      failures.push({ hostid: host.hostid, host: host.name, name: scenarioName(it.key_), itemid: it.itemid, step: value, clock: Number(it.lastclock) });
    }
  }
  failures.sort((a, b) => a.host.localeCompare(b.host) || a.name.localeCompare(b.name));
  return { generatedAt: now, total: ok + unknown + failures.length, ok, failed: failures.length, unknown, failures: failures.slice(0, limit) };
}

/** Web monitoring as the route and the warm-up read it. */
export const webMonitoringView = (limit = WEB_FAILURES_ROWS) => cached(`web-monitoring:${limit}`, 30_000, () => getWebMonitoring(limit), SLOW_VIEW);
