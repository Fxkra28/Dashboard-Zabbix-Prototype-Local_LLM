/** The checks for what the Dashboard shows besides the problem list. */

import type { Freshness, GroupProblems, TopHostRow, TopHostsMetric, TopHostsResponse, WebFailure, WebMonitoringResponse, Stats } from '../types';
import { counts, flag, guard, listOf, num, orNull, shape, text } from './shape';

const stats = shape<Stats>({
  hosts: num,
  items: orNull(num),
  triggers: orNull(num),
  groups: num,
  problems: num,
  unacknowledged: num,
  bySeverity: counts,
});

const freshness = shape<Freshness>({
  lastCollectedAt: orNull(num),
  ageSeconds: orNull(num),
  stale: flag,
  staleAfterSeconds: num,
  pinged: num,
  answering: num,
  reachLost: flag,
});

const groupProblems = shape<GroupProblems>({ groupid: text, name: text, total: num, bySeverity: counts });

const topHostRow = shape<TopHostRow>({ hostid: text, host: text, itemid: text, value: num, clock: num });

const topHosts = shape<TopHostsResponse>({
  generatedAt: num,
  metrics: listOf(shape<TopHostsMetric>({ key: text, label: text, considered: num, current: num, rows: listOf(topHostRow) })),
});

const webFailure = shape<WebFailure>({ hostid: text, host: text, name: text, itemid: text, step: num, clock: num });

const webMonitoring = shape<WebMonitoringResponse>({
  generatedAt: num,
  total: num,
  ok: num,
  failed: num,
  unknown: num,
  failures: listOf(webFailure),
});

/** GET /api/stats. */
export const statsGuard = guard<Stats>('the dashboard counts', stats);

/** GET /api/reports/problems-by-group. */
export const groupProblemsGuard = guard<GroupProblems[]>('the problems by host group', listOf(groupProblems));

/** GET /api/freshness. */
export const freshnessGuard = guard<Freshness>('the data freshness', freshness);

/** GET /api/reports/top-hosts. */
export const topHostsGuard = guard<TopHostsResponse>('the busiest hosts', topHosts);

/** GET /api/reports/web-monitoring. */
export const webMonitoringGuard = guard<WebMonitoringResponse>('web monitoring', webMonitoring);
