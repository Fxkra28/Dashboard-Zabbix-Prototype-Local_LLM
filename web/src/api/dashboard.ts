/** The calls behind what the Dashboard shows besides the problem list. */

import type { Stats, Freshness, GroupProblems, TopHostsResponse, WebMonitoringResponse } from '../types';
import { freshnessGuard, groupProblemsGuard, topHostsGuard, webMonitoringGuard, statsGuard } from '../guards';
import { request } from './client';

export const dashboardApi = {
  /** The hosts with the highest CPU and memory use now, a few of each. */
  topHosts: () => request<TopHostsResponse>('/api/reports/top-hosts', { guard: topHostsGuard }),
  /** Web scenarios that pass, fail or have no current result, with the failed ones listed. */
  webMonitoring: () => request<WebMonitoringResponse>('/api/reports/web-monitoring', { guard: webMonitoringGuard }),
  stats: () => request<Stats>('/api/stats', { guard: statsGuard }),
  /** When Zabbix last collected a value, and whether that is long enough ago to call it stopped. */
  freshness: () => request<Freshness>('/api/freshness', { guard: freshnessGuard }),
  problemsByGroup: () => request<GroupProblems[]>('/api/reports/problems-by-group', { guard: groupProblemsGuard }),
};
