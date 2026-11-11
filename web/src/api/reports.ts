/** The calls behind the reports under /reports. */

import type { TopTriggersReport, ScorecardResponse, AgingReport, CapacityReport, NoiseReport } from '../types';
import { agingGuard, capacityGuard, noiseGuard, scorecardGuard, topTriggersGuard } from '../guards';
import { qs, request } from './client';

export const reportsApi = {
  topTriggers: (days: number) =>
    request<TopTriggersReport>(`/api/reports/top-triggers${qs({ days })}`, { guard: topTriggersGuard }),
  // Governance: how standardised is the estate? (admin)
  inventory: () => request<ScorecardResponse>('/api/reports/inventory', { guard: scorecardGuard }),
  aging: () => request<AgingReport>('/api/reports/aging', { guard: agingGuard }),
  capacity: (days: number) => request<CapacityReport>(`/api/reports/capacity${qs({ days })}`, { guard: capacityGuard }),
  /** `top` = how many triggers come back (the BFF's default is 100); `total` counts them all. */
  noise: (days: number, severity: number, top?: number) =>
    request<NoiseReport>(`/api/reports/noise${qs({ days, severity, top })}`, { guard: noiseGuard }),
};
