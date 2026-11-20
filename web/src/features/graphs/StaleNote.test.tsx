import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StaleNote from './StaleNote';
import type { GraphSeries } from '../../types';

/** The three sentences under a graph that say the data is not all there (FR-76): too little of the window, a series with nothing, and nothing new. */

const NOW = Date.parse('2026-11-19T04:00:00Z') / 1000;
const HOUR = 3_600;

const series = (over: Partial<GraphSeries> = {}): GraphSeries => ({
  itemid: '1',
  name: 'CPU utilization',
  host: 'sw-1',
  units: '%',
  value_type: '0',
  delaySeconds: 60,
  step: false,
  points: [],
  stats: { min: 1, avg: 2, max: 3, last: 2, lastClock: NOW - 30 },
  coverage: { coveredSeconds: 24 * HOUR, firstClock: NOW - 24 * HOUR, lastClock: NOW - 30 },
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => vi.useRealTimers());

const show = (props: Partial<React.ComponentProps<typeof StaleNote>> = {}) =>
  render(<StaleNote from={NOW - 24 * HOUR} to={NOW} series={[series()]} latestClock={NOW - 30} {...props} />);

describe('the note under a graph', () => {
  it('says nothing when the data covers the window and is current', () => {
    const { container } = show();
    expect(container).toBeEmptyDOMElement();
  });

  it('says how much of the window the data covers, and when the last value was, when it covers under nine tenths', () => {
    show({ series: [series({ coverage: { coveredSeconds: 12 * HOUR, firstClock: NOW - 12 * HOUR, lastClock: NOW - 30 } })] });
    expect(screen.getByText(/Data covers 12 h of 24 h/)).toBeInTheDocument();
    expect(screen.getByText(/last value/)).toBeInTheDocument();
  });

  it('names the series that has the least, when there are several', () => {
    show({
      series: [series(), series({ itemid: '2', name: 'Memory utilization', coverage: { coveredSeconds: 6 * HOUR, firstClock: NOW - 6 * HOUR, lastClock: NOW - 30 } })],
    });
    expect(screen.getByText(/Data covers 6 h of 24 h \(Memory utilization\)/)).toBeInTheDocument();
  });

  it('says which series has no data in the range, when only some have none', () => {
    show({ series: [series(), series({ itemid: '2', name: 'Fan speed', stats: null, coverage: { coveredSeconds: 0, firstClock: null, lastClock: null } })] });
    expect(screen.getByText(/No data in this range for Fan speed\./)).toBeInTheDocument();
  });

  it('says nothing of a series that has none when none of them has: the graph says so itself', () => {
    show({ series: [series({ stats: null, coverage: { coveredSeconds: 0, firstClock: null, lastClock: null } })], latestClock: null });
    expect(screen.queryByText(/No data in this range/)).toBeNull();
  });

  it('says there is nothing new, with how old the last value is, for a window that ends now', () => {
    show({ latestClock: NOW - 3 * HOUR });
    expect(screen.getByText(/No new data since .+ \(3h 0m ago\)\./)).toBeInTheDocument();
  });

  it('says it only when the last value is older than ten minutes and three of the item’s own intervals', () => {
    const quiet = show({ latestClock: NOW - 9 * 60, series: [series({ delaySeconds: 60 })] });
    expect(screen.queryByText(/No new data since/)).toBeNull();
    quiet.unmount();
    // An item read every ten minutes is late only after three of them: half an hour.
    const slow = show({ latestClock: NOW - 25 * 60, series: [series({ delaySeconds: 600 })] });
    expect(screen.queryByText(/No new data since/)).toBeNull();
    slow.unmount();
    show({ latestClock: NOW - 35 * 60, series: [series({ delaySeconds: 600 })] });
    expect(screen.queryByText(/No new data since/)).not.toBeNull();
  });

  it('says nothing of new data for a window that ended some time ago', () => {
    show({ to: NOW - 2 * HOUR, from: NOW - 26 * HOUR, latestClock: NOW - 3 * HOUR });
    expect(screen.queryByText(/No new data since/)).toBeNull();
  });

  it('counts the age by the server’s clock, not the machine’s', async () => {
    const { noteServerTime, resetServerClock } = await import('../../shared/lib/clock');
    // A PC two hours behind the server: its own Date.now() says the data is fresh, the server's says it is hours old.
    vi.setSystemTime((NOW - 2 * HOUR) * 1000);
    noteServerTime(new Date(NOW * 1000).toUTCString(), Date.now());
    show({ latestClock: NOW - 3 * HOUR });
    expect(screen.getByText(/No new data since .+ \(3h 0m ago\)\./)).toBeInTheDocument();
    resetServerClock();
  });
});
