/** The checks for the reports under /reports. */

import type { AgingReport, CapacityReport, CapacityRow, Dimension, HostGap, NoiseReport, NoisyTrigger, ScorecardResponse, TopTrigger, TopTriggersReport } from '../types';
import { counts, flag, guard, listOf, num, opt, shape, text } from './shape';

const topTrigger = shape<TopTrigger>({ objectid: text, name: text, severity: text, host: text, count: num });

const topTriggers = shape<TopTriggersReport>({ triggers: listOf(topTrigger), truncated: flag, days: num });

const dimension = shape<Dimension>({ key: text, label: text, hint: text, present: num, total: num, pct: num, scored: flag });

const hostGap = shape<HostGap>({ hostid: text, name: text, site: text, groups: listOf(text), missing: listOf(text) });

const scorecard = shape<ScorecardResponse>({
  dimensions: listOf(dimension),
  overall: shape<ScorecardResponse['overall']>({ hosts: num, complete: num, pct: num }),
  groups: listOf(shape<ScorecardResponse['groups'][number]>({ name: text, hosts: num, complete: num, pct: num })),
  gaps: listOf(hostGap),
});

const aging = shape<AgingReport>({
  buckets: listOf(shape<AgingReport['buckets'][number]>({ label: text, count: num })),
  unacknowledged: num,
  total: num,
  oldest: listOf(shape<AgingReport['oldest'][number]>({ eventid: text, name: text, host: text, severity: text, clock: text, ageSeconds: num })),
});

const capacityRow = shape<CapacityRow>({
  metric: text,
  label: text,
  itemid: text,
  hostid: text,
  host: text,
  name: text,
  units: text,
  avg: num,
  max: num,
  source: text,
});

const capacity = shape<CapacityReport>({
  days: num,
  metrics: listOf(shape<CapacityReport['metrics'][number]>({ key: text, label: text, rows: listOf(capacityRow) })),
});

const noisyTrigger = shape<NoisyTrigger>({
  objectid: text,
  name: text,
  host: text,
  hostid: text,
  severity: text,
  count: num,
  medianDuration: num,
  shortLived: num,
  ackRate: num,
  totalDuration: num,
  longest: num,
  stillOpen: flag,
  flags: listOf(text),
});

const noise = shape<NoiseReport>({
  from: num,
  to: num,
  windowSeconds: num,
  minSeverity: num,
  truncated: flag,
  totalEvents: num,
  distinctTriggers: num,
  concentration: shape<NoiseReport['concentration']>({ topN: num, percentOfEvents: num }),
  counts: counts,
  thresholds: shape<NoiseReport['thresholds']>({ shortSeconds: num, minCount: num }),
  total: opt(num),
  triggers: listOf(noisyTrigger),
});

/** GET /api/reports/top-triggers. */
export const topTriggersGuard = guard<TopTriggersReport>('the top triggers', topTriggers);

/** GET /api/reports/inventory. */
export const scorecardGuard = guard<ScorecardResponse>('the inventory scorecard', scorecard);

/** GET /api/reports/aging. */
export const agingGuard = guard<AgingReport>('the problem ageing', aging);

/** GET /api/reports/capacity. */
export const capacityGuard = guard<CapacityReport>('the capacity report', capacity);

/** GET /api/reports/noise. */
export const noiseGuard = guard<NoiseReport>('the alert noise report', noise);
