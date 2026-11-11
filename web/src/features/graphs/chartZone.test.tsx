import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { GraphSeries } from '../../types';
import { setReportTimeZone } from '../../shared/lib/time';
import { formatValue } from '../../shared/lib/units';

/**
 * A time Zabbix reports reads in the report zone with its label wherever it shows: a chart's
 * tooltip and an item whose value is a Unix time, not just the lists. The browser's own clock is
 * New York here, so a time left in it shows as 4:00 AM, not 3:00 PM WIB.
 */

vi.stubEnv('TZ', 'America/New_York');

const chart = vi.hoisted(() => ({ option: null as null | { tooltip: { formatter: (p: unknown) => string } } }));
// jsdom has no canvas; what the chart was told to draw is what is under test.
vi.mock('echarts-for-react/esm/core', () => ({
  default: (props: { option: typeof chart.option }) => {
    chart.option = props.option;
    return <div />;
  },
}));
const { default: TimeSeriesChart } = await import('./TimeSeriesChart');

/** 08:00 UTC: 15:00 in Jakarta, 16:00 in Makassar, 04:00 in New York. */
const AT = Date.UTC(2026, 9, 7, 8, 0, 0);

const series: GraphSeries = {
  itemid: '1',
  name: 'Bits received',
  host: 'core-sw-1',
  units: 'bps',
  value_type: '0',
  delaySeconds: 60,
  step: false,
  points: [[AT, 1_000_000, null, null]],
  stats: null,
  coverage: { coveredSeconds: 3600, firstClock: AT / 1000, lastClock: AT / 1000 + 3600 },
};

afterEach(() => setReportTimeZone(undefined));
afterAll(() => vi.unstubAllEnvs());

it('puts the time in a chart tooltip in the report zone, labelled, and follows the server', () => {
  render(<TimeSeriesChart series={[series]} from={AT / 1000} to={AT / 1000 + 3600} />);
  const tooltip = () => chart.option!.tooltip.formatter([{ seriesIndex: 0, dataIndex: 0, value: [AT, 1_000_000] }]);

  expect(tooltip()).toMatch(/(3:00:00 PM|15:00:00) WIB</);
  expect(tooltip()).not.toMatch(/4:00:00 AM|04:00:00/);

  setReportTimeZone('Asia/Makassar');
  expect(tooltip()).toMatch(/(4:00:00 PM|16:00:00) WITA</);
});

it('writes an item value that is a Unix time in the report zone, labelled', () => {
  expect(formatValue(AT / 1000, 'unixtime')).toMatch(/(3:00:00 PM|15:00:00) WIB$/);
  setReportTimeZone('Asia/Makassar');
  expect(formatValue(AT / 1000, 'unixtime')).toMatch(/(4:00:00 PM|16:00:00) WITA$/);
  // Zabbix sends 0 for "never".
  expect(formatValue(0, 'unixtime')).toBe('\u2014');
});
