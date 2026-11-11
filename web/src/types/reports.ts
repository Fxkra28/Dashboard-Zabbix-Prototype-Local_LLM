/** The reports under /reports: alert noise, problem ageing, capacity, top triggers and the inventory scorecard. */

export interface TopTrigger {
  objectid: string;
  name: string;
  severity: string;
  host: string;
  count: number;
}

export interface TopTriggersReport {
  triggers: TopTrigger[];
  /** True when the event window filled a page: the counts are a floor. */
  truncated: boolean;
  days: number;
}

// Inventory scorecard (Goal 1)
export type DimensionKey = 'naming' | 'site' | 'owner' | 'criticality';

export interface Dimension {
  key: DimensionKey;
  label: string;
  hint: string;
  present: number;
  total: number;
  pct: number;
  scored: boolean;
}

export interface HostGap {
  hostid: string;
  name: string;
  site: string;
  groups: string[];
  missing: DimensionKey[];
}

export interface ScorecardResponse {
  dimensions: Dimension[];
  overall: { hosts: number; complete: number; pct: number };
  groups: { name: string; hosts: number; complete: number; pct: number }[];
  gaps: HostGap[];
}

export interface AgingReport {
  buckets: { label: string; count: number }[];
  unacknowledged: number;
  total: number;
  oldest: {
    eventid: string;
    name: string;
    host: string;
    severity: string;
    clock: string;
    ageSeconds: number;
  }[];
}

export interface CapacityRow {
  metric: string;
  label: string;
  itemid: string;
  hostid: string;
  host: string;
  name: string;
  units: string;
  avg: number;
  max: number;
  source: 'trend' | 'history' | 'none';
}

/** `ifutil` rows are one interface each: `name` is the port, avg/max in %. */
export type CapacityMetricKey = 'cpu' | 'memory' | 'disk' | 'ifutil';

export interface CapacityReport {
  days: number;
  metrics: { key: CapacityMetricKey | (string & {}); label: string; rows: CapacityRow[] }[];
}

// Alert noise / flapping (Goal 4)
export type NoiseFlag = 'flapping' | 'unactioned' | 'chronic';

export interface NoisyTrigger {
  objectid: string;
  name: string;
  host: string;
  hostid: string;
  severity: string;
  count: number;
  /** Median, not mean: one long outlier must not hide many short firings. */
  medianDuration: number;
  shortLived: number;
  /** 0..1 */
  ackRate: number;
  totalDuration: number;
  longest: number;
  stillOpen: boolean;
  flags: NoiseFlag[];
}

export interface NoiseReport {
  from: number;
  to: number;
  windowSeconds: number;
  minSeverity: number;
  truncated: boolean;
  totalEvents: number;
  distinctTriggers: number;
  concentration: { topN: number; percentOfEvents: number };
  counts: Record<NoiseFlag, number>;
  thresholds: { shortSeconds: number; minCount: number };
  /** Triggers before `?top=` cut the list (default 100); the figures above cover all of them. */
  total?: number;
  triggers: NoisyTrigger[];
}
