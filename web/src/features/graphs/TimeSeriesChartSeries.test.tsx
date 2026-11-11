import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { GraphSeries } from '../../types';

/**
 * The lines of a chart with several series (UX-39): the four colours differ by hue alone for a reader who cannot tell two of them
 * apart, so the third and the fourth are dashed. The chart itself is not drawn here; the options it hands the library are read.
 */
const plotted = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));
vi.mock('echarts-for-react/esm/core', () => ({
  default: (props: { option: Record<string, unknown> }) => {
    plotted.options.push(props.option);
    return <div data-testid="canvas" />;
  },
}));
const { default: TimeSeriesChart } = await import('./TimeSeriesChart');

const series = (id: number, over: Partial<GraphSeries> = {}): GraphSeries => ({
  itemid: String(id),
  name: `Item ${id}`,
  host: 'core-sw-1',
  units: 'bps',
  value_type: '0',
  delaySeconds: 60,
  step: false,
  points: [
    [1_800_000_000_000, 1_000_000, null, null],
    [1_800_000_060_000, 2_000_000, null, null],
  ],
  stats: { min: 1, avg: 2, max: 3, last: 2, lastClock: 1_800_003_600 },
  coverage: { coveredSeconds: 3600, firstClock: 1_800_000_000, lastClock: 1_800_003_600 },
  ...over,
});

type Line = { name: string; lineStyle: { type?: string; width: number; color: string; opacity?: number } };
const lines = (count: number, over: Partial<GraphSeries> = {}) => {
  plotted.options.length = 0;
  render(<TimeSeriesChart series={Array.from({ length: count }, (_, i) => series(i + 1, over))} from={1_800_000_000} to={1_800_003_600} />);
  const last = plotted.options[plotted.options.length - 1]!;
  return ((last.series as Line[]) ?? []).filter((s) => !s.name.startsWith('__'));
};

const COLOURS = ['#101010', '#202020', '#303030', '#404040'];
beforeEach(() => {
  plotted.options.length = 0;
  // The chart reads its colours out of the stylesheet, which jsdom does not load.
  COLOURS.forEach((c, i) => document.documentElement.style.setProperty(`--series-${i + 1}`, c));
});

describe('the line of each series', () => {
  it('is solid for the first two series and dashed for the third and the fourth', () => {
    expect(lines(4).map((s) => s.lineStyle.type)).toEqual(['solid', 'solid', 'dashed', 'dashed']);
  });

  it('is solid when there is one series, or two', () => {
    expect(lines(1).map((s) => s.lineStyle.type)).toEqual(['solid']);
    expect(lines(2).map((s) => s.lineStyle.type)).toEqual(['solid', 'solid']);
  });

  it('is dashed for the third series alone when there are three', () => {
    expect(lines(3).map((s) => s.lineStyle.type)).toEqual(['solid', 'solid', 'dashed']);
  });

  it('follows the colours round when there are more series than colours', () => {
    expect(lines(6).map((s) => s.lineStyle.type)).toEqual(['solid', 'solid', 'dashed', 'dashed', 'solid', 'solid']);
  });

  it('keeps the width and the colour it had', () => {
    for (const s of lines(4)) {
      expect(s.lineStyle.width).toBe(1.6);
      expect(typeof s.lineStyle.color).toBe('string');
    }
    expect(lines(4).map((s) => s.lineStyle.color)).toEqual(COLOURS);
  });

  it('is dashed for a step line too, which has the same colours', () => {
    expect(lines(4, { step: true }).map((s) => s.lineStyle.type)).toEqual(['solid', 'solid', 'dashed', 'dashed']);
  });
});
