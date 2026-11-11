import { describe, expect, it } from 'vitest';
import { chartTable, isRanged } from './chartTable';
import type { GraphPoint, GraphSeries } from '../../types';

/** The rows behind the Show data table: the selected items joined on the time of their points. */

const series = (itemid: string, points: GraphPoint[], over: Partial<GraphSeries> = {}): GraphSeries => ({
  itemid,
  name: `Item ${itemid}`,
  host: 'core-sw-1',
  units: 'bps',
  value_type: '0',
  delaySeconds: 60,
  step: false,
  points,
  stats: null,
  coverage: { coveredSeconds: 0, firstClock: null, lastClock: null },
  ...over,
});

const T = 1_800_000_000_000;

describe('chartTable', () => {
  it('makes one row per time, oldest first, whatever order the series list them in', () => {
    const a = series('1', [[T + 120_000, 3, null, null], [T, 1, null, null]]);
    const b = series('2', [[T + 60_000, 2, null, null]]);
    expect(chartTable([a, b]).rows.map((r) => r.at)).toEqual([T, T + 60_000, T + 120_000]);
  });

  it('puts each point in the cell of its own series, and leaves the others undefined', () => {
    const a = series('1', [[T, 1, null, null]]);
    const b = series('2', [[T + 60_000, 2, null, null]]);
    const { rows } = chartTable([a, b]);
    expect(rows[0].cells).toEqual([[T, 1, null, null], undefined]);
    expect(rows[1].cells).toEqual([undefined, [T + 60_000, 2, null, null]]);
  });

  it('shares a row between series that have a point at the same time', () => {
    const a = series('1', [[T, 1, null, null]]);
    const b = series('2', [[T, 2, null, null]]);
    const { rows } = chartTable([a, b]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells.map((c) => c?.[1])).toEqual([1, 2]);
  });

  it('keeps a collection gap as a point with no value, which is not the same as having no point', () => {
    const a = series('1', [[T, null, null, null]]);
    const b = series('2', [[T, 2, null, null]]);
    const [row] = chartTable([a, b]).rows;
    expect(row.cells[0]).toEqual([T, null, null, null]);
    expect(row.cells[0]).not.toBeUndefined();
  });

  it('says which series have an average, a minimum and a maximum: a trend does, a step line and a plain series do not', () => {
    const trend = series('1', [[T, 2, 1, 3]]);
    const plain = series('2', [[T, 2, null, null]]);
    const step = series('3', [[T, 1, 0, 1]], { step: true });
    expect(chartTable([trend, plain, step]).ranged).toEqual([true, false, false]);
    expect([trend, plain, step].map(isRanged)).toEqual([true, false, false]);
  });

  it('has no rows when there are no series, or none has a point', () => {
    expect(chartTable([]).rows).toEqual([]);
    expect(chartTable([series('1', []), series('2', [])]).rows).toEqual([]);
  });

  it('keeps a series with no points as an empty column in every row', () => {
    const a = series('1', [[T, 1, null, null]]);
    const empty = series('2', []);
    expect(chartTable([a, empty]).rows[0].cells).toEqual([[T, 1, null, null], undefined]);
  });

  it('joins four long series without changing a value', () => {
    const many = (id: string, offset: number) =>
      series(id, Array.from({ length: 1500 }, (_, i): GraphPoint => [T + i * 60_000 + offset, i + Number(id), null, null]));
    const all = [many('1', 0), many('2', 0), many('3', 30_000), many('4', 0)];
    const t0 = performance.now();
    const { rows } = chartTable(all);
    expect(performance.now() - t0).toBeLessThan(250);
    // Three series share their times and one is half a minute off: two rows per minute, not one.
    expect(rows).toHaveLength(3000);
    expect(rows[0].cells.map((c) => c?.[1])).toEqual([1, 2, undefined, 4]);
    expect(rows[1].cells.map((c) => c?.[1])).toEqual([undefined, undefined, 3, undefined]);
    // Every input point is in the table exactly once.
    const placed = rows.reduce((n, r) => n + r.cells.filter(Boolean).length, 0);
    expect(placed).toBe(6000);
  });
});
