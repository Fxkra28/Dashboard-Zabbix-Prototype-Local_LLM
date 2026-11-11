import type { GraphPoint, GraphSeries } from '../../types';

/**
 * The same condition as the tooltip's range: a trend point carries its min and max, a step line does not.
 * Such a series gets Average, Min and Max columns in the table; any other gets one Value column.
 */
export const isRanged = (s: GraphSeries): boolean => !s.step && s.points.some((p) => p[2] !== null && p[3] !== null);

export interface ChartTable {
  /** One entry per series, in the order they are plotted: whether its columns are Average, Min and Max. */
  ranged: boolean[];
  /**
   * One row per time at which any series has a point, oldest first. `cells[i]` is series i's point there, or undefined when it has none:
   * a collection gap is a point whose value is null, which is not the same as having no point.
   */
  rows: { at: number; cells: (GraphPoint | undefined)[] }[];
}

/**
 * The plotted points of every series as one table, a column group per series, joined on the exact time a point carries. Trend points sit on
 * the hour and downsampled ones on shared bucket centres, so they line up; a raw series polled separately may leave an empty cell. Nothing is moved or averaged.
 */
export function chartTable(series: GraphSeries[]): ChartTable {
  const byTime = new Map<number, (GraphPoint | undefined)[]>();
  series.forEach((s, i) => {
    for (const p of s.points) {
      let row = byTime.get(p[0]);
      if (!row) {
        row = new Array<GraphPoint | undefined>(series.length).fill(undefined);
        byTime.set(p[0], row);
      }
      row[i] = p;
    }
  });
  const rows = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([at, cells]) => ({ at, cells }));
  return { ranged: series.map(isRanged), rows };
}

/** A series' name without the shared "Interface X(alias): " prefix when every series has it, and with its host when the hosts differ. */
export function seriesLabel(s: GraphSeries, all: GraphSeries[]): string {
  const prefix = /^(Interface [^:]+:\s*)/.exec(s.name)?.[1];
  if (prefix && all.length > 1 && all.every((o) => o.name.startsWith(prefix))) {
    return s.name.slice(prefix.length);
  }
  const hosts = new Set(all.map((o) => o.host));
  return hosts.size > 1 ? `${s.host}: ${s.name}` : s.name;
}
