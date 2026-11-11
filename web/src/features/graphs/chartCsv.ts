import type { GraphSeries } from '../../types';
import { formatIsoDateTime, reportTimeZone } from '../../shared/lib/time';
import { chartTable, seriesLabel } from './chartTable';

/**
 * The Show data table as rows for a CSV file: the same rows, joined on time exactly as the table joins them, and the same columns
 * (Average, Min and Max for a series from trends, one column for any other). Where the table writes "12.3 Mbps", the file holds the
 * number as the BFF sent it, so a spreadsheet can add and plot it, and the unit is in the heading of the column. A collection gap, and a
 * time at which a series has no point, are empty cells. The time is in the report zone, named once in the first heading.
 */
export function chartCsvRows(series: GraphSeries[], tz = reportTimeZone()): unknown[][] {
  const { ranged, rows } = chartTable(series);
  const head: string[] = [`Time (${tz})`];
  series.forEach((s, i) => {
    const label = seriesLabel(s, series);
    const base = s.units ? `${label} (${s.units})` : label;
    head.push(...(ranged[i] ? [`${base} average`, `${base} min`, `${base} max`] : [base]));
  });
  const body = rows.map((r) => [
    formatIsoDateTime(r.at, tz),
    ...series.flatMap((_s, i) => {
      const point = r.cells[i];
      return Array.from({ length: ranged[i] ? 3 : 1 }, (_, k) => point?.[k + 1] ?? null);
    }),
  ]);
  return [head, ...body];
}

/**
 * `hcml-graph-2026-10-19.csv`, or `hcml-graph-2026-10-18-to-2026-10-19.csv` when the window spans two days of the report zone.
 * A window ends at the first instant it no longer holds (a month ends at the next month's midnight), so its last day is the one before.
 */
export function chartCsvFileName(from: number, to: number, tz = reportTimeZone()): string {
  const day = (seconds: number) => formatIsoDateTime(seconds * 1000, tz).slice(0, 10);
  const [a, b] = [day(from), day(Math.max(from, to - 1))];
  return a === b ? `hcml-graph-${a}.csv` : `hcml-graph-${a}-to-${b}.csv`;
}
