import { describe, expect, it } from 'vitest';
import type { GraphPoint, GraphSeries } from '../../types';
import { toCsv } from '../../shared/lib/csv';
import { chartCsvFileName, chartCsvRows } from './chartCsv';

const T = Date.parse('2026-10-19T07:00:00Z');
const HOUR = 3_600_000;

const make = (id: string, name: string, points: GraphPoint[], over: Partial<GraphSeries> = {}): GraphSeries => ({
  itemid: id,
  name,
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

describe('chartCsvRows (MT-02)', () => {
  it('writes one value column for a raw series, with the unit in the heading and the zone in the first', () => {
    const rows = chartCsvRows([make('1', 'Bits received', [[T, 1_500_000, null, null], [T + 60_000, 2_000_000, null, null]])], 'Asia/Jakarta');
    expect(rows).toEqual([
      ['Time (Asia/Jakarta)', 'Bits received (bps)'],
      ['2026-10-19 14:00:00', 1_500_000],
      ['2026-10-19 14:01:00', 2_000_000],
    ]);
  });

  it('writes the number the BFF sent, not the text the table shows', () => {
    const [, row] = chartCsvRows([make('1', 'Bits received', [[T, 1_234_567.891, null, null]])], 'UTC');
    expect(row[1]).toBe(1_234_567.891);
    expect(typeof row[1]).toBe('number');
  });

  it('writes Average, Min and Max for a series from trends, as the table does', () => {
    const rows = chartCsvRows([make('1', 'CPU', [[T, 10, 5, 20], [T + HOUR, 12, 6, 30]], { units: '%' })], 'UTC');
    expect(rows[0]).toEqual(['Time (UTC)', 'CPU (%) average', 'CPU (%) min', 'CPU (%) max']);
    expect(rows[1]).toEqual(['2026-10-19 07:00:00', 10, 5, 20]);
    expect(rows[2]).toEqual(['2026-10-19 08:00:00', 12, 6, 30]);
  });

  it('keeps a step series to one column, though it may carry no min and max', () => {
    const rows = chartCsvRows([make('1', 'ICMP ping', [[T, 1, null, null], [T + 60_000, 0, null, null]], { step: true, units: '' })], 'UTC');
    expect(rows[0]).toEqual(['Time (UTC)', 'ICMP ping']);
    expect(rows.slice(1).map((r) => r[1])).toEqual([1, 0]);
  });

  it('joins several series on time, and leaves a cell empty where a series has no point or a gap', () => {
    const a = make('1', 'Bits received', [[T, 100, null, null], [T + 60_000, null, null, null], [T + 120_000, 300, null, null]]);
    const b = make('2', 'Bits sent', [[T + 60_000, 7, null, null]], { units: '' });
    const rows = chartCsvRows([a, b], 'UTC');
    expect(rows[0]).toEqual(['Time (UTC)', 'Bits received (bps)', 'Bits sent']);
    expect(rows.slice(1)).toEqual([
      ['2026-10-19 07:00:00', 100, null],
      ['2026-10-19 07:01:00', null, 7],
      ['2026-10-19 07:02:00', 300, null],
    ]);
  });

  it('names the host in a heading when the series are on different hosts, and drops the shared interface prefix when they have one', () => {
    const rows = chartCsvRows(
      [
        make('1', 'Interface Gi1/0/1(Uplink): Bits received', [[T, 1, null, null]]),
        make('2', 'Interface Gi1/0/1(Uplink): Bits sent', [[T, 2, null, null]]),
      ],
      'UTC',
    );
    expect(rows[0]).toEqual(['Time (UTC)', 'Bits received (bps)', 'Bits sent (bps)']);
    const hosts = chartCsvRows([make('1', 'Bits received', [[T, 1, null, null]]), make('2', 'Bits received', [[T, 2, null, null]], { host: 'edge-fw-1' })], 'UTC');
    expect(hosts[0]).toEqual(['Time (UTC)', 'core-sw-1: Bits received (bps)', 'edge-fw-1: Bits received (bps)']);
  });

  it('writes only the heading for series that have no points', () => {
    expect(chartCsvRows([make('1', 'Bits received', [])], 'UTC')).toEqual([['Time (UTC)', 'Bits received (bps)']]);
  });

  it('goes through the one CSV writer, so a name that starts like a formula cannot run in a spreadsheet', () => {
    const text = toCsv(chartCsvRows([make('1', '=HYPERLINK("http://x")', [[T, 1, null, null]])], 'UTC'));
    const heading = text.split('\n')[0];
    expect(heading).toBe(`"Time (UTC)","'=HYPERLINK(""http://x"") (bps)"`);
  });
});

describe('chartCsvFileName (MT-02)', () => {
  const at = (iso: string) => Date.parse(iso) / 1000;

  it('names one day once', () => {
    expect(chartCsvFileName(at('2026-10-19T01:00:00Z'), at('2026-10-19T07:00:00Z'), 'UTC')).toBe('hcml-graph-2026-10-19.csv');
  });

  it('names both days when the window crosses midnight of the report zone', () => {
    expect(chartCsvFileName(at('2026-10-18T10:00:00Z'), at('2026-10-19T07:00:00Z'), 'Asia/Jakarta')).toBe('hcml-graph-2026-10-18-to-2026-10-19.csv');
  });

  it('names the last day the window holds: a month ends at the midnight that starts the next one', () => {
    expect(chartCsvFileName(at('2026-08-31T17:00:00Z'), at('2026-09-30T17:00:00Z'), 'Asia/Jakarta')).toBe('hcml-graph-2026-09-01-to-2026-09-30.csv');
    expect(chartCsvFileName(at('2026-10-17T17:00:00Z'), at('2026-10-18T17:00:00Z'), 'Asia/Jakarta')).toBe('hcml-graph-2026-10-18.csv');
  });

  it('cuts the days in the report zone, not in UTC', () => {
    // 17:00Z on the 18th is already the 19th in Jakarta.
    expect(chartCsvFileName(at('2026-10-18T17:00:00Z'), at('2026-10-19T07:00:00Z'), 'Asia/Jakarta')).toBe('hcml-graph-2026-10-19.csv');
    expect(chartCsvFileName(at('2026-10-18T17:00:00Z'), at('2026-10-19T07:00:00Z'), 'UTC')).toBe('hcml-graph-2026-10-18-to-2026-10-19.csv');
  });
});
