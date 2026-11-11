import type { FastifyBaseLogger } from 'fastify';
import { cachedProblems } from '../domain/queries.js';
import { CAPACITY_DAYS, CAPACITY_TOP, getCapacityReport } from './capacity.js';
import { devicesView } from './devices.js';
import { hostsOverviewView } from './hosts.js';
import { linksView } from './links.js';
import { metersView } from './meters.js';
import { getFreshness, getStats } from './reports.js';
import { serviceTreeView } from './services.js';
import { sitesView } from './sites.js';
import { slasView } from './sla.js';
import { topHostsView } from './topHosts.js';
import { webMonitoringView } from './webMonitoring.js';

/** What a start reads before anyone asks, in this order: the parts other views share first, the Capacity report last. */
export const WARM_UP: readonly (readonly [string, () => Promise<unknown>])[] = [
  ['problems', cachedProblems],
  ['dashboard counts', getStats],
  ['freshness', getFreshness],
  ['sites', sitesView],
  ['links', linksView],
  ['hosts overview', hostsOverviewView],
  ['devices', devicesView],
  ['meters', metersView],
  ['top hosts', () => topHostsView()],
  ['web monitoring', () => webMonitoringView()],
  ['services', serviceTreeView],
  ['SLA list', slasView],
  ['capacity', () => getCapacityReport(CAPACITY_DAYS, CAPACITY_TOP)],
];

/**
 * Reads the slow views once after a start, one at a time, into the cache entries their routes use, so the
 * first person to open each finds it ready. A view that fails is logged and the next one goes on. The other reports,
 * the SLA figures, the Graphs item list and the network interfaces are not in the list: their first visit waits.
 */
export async function warmUp(log: Pick<FastifyBaseLogger, 'info' | 'warn'>, steps = WARM_UP): Promise<void> {
  const started = Date.now();
  for (const [view, read] of steps) {
    const t0 = Date.now();
    try {
      await read();
      log.info({ view, ms: Date.now() - t0 }, 'warm-up: read');
    } catch (err) {
      log.warn({ view, reason: err instanceof Error ? err.message : String(err) }, 'warm-up: could not read it; its first visit will');
    }
  }
  log.info({ ms: Date.now() - started }, 'warm-up: done');
}
