/** The graph pipeline (/api/graph): chart-ready series for one to four numeric items over a window. */

/** [ms, avg, min, max], null avg marks a collection gap; min/max null for raw history. */
export type GraphPoint = [number, number | null, number | null, number | null];

export interface GraphSeries {
  itemid: string;
  name: string;
  host: string;
  units: string;
  value_type: string;
  delaySeconds: number;
  step: boolean;
  points: GraphPoint[];
  stats: { min: number; avg: number; max: number; last: number; lastClock: number } | null;
  coverage: { coveredSeconds: number; firstClock: number | null; lastClock: number | null };
}

export interface GraphResponse {
  from: number;
  to: number;
  source: 'history' | 'trend' | 'trend+history';
  series: GraphSeries[];
  latestClock: number | null;
  downsampled: boolean;
}

/** A graph window: a preset ending now, a calendar month, or a fixed from/to (epoch s). */
export type GraphRange =
  | { kind: 'hours'; hours: number }
  | { kind: 'month'; month: string }
  | { kind: 'custom'; from: number; to: number };
