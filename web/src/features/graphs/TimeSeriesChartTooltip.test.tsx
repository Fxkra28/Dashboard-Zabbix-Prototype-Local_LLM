import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { GraphSeries } from '../../types';

/**
 * The tooltip of a chart is drawn by the chart library, which paints it white unless it is told otherwise: in the dark theme its
 * muted lines then sat on white at 2.42 to 1 (UX-41). It takes the page's own tokens, as the axes and the legend do. The chart is
 * not drawn here; the options it hands the library are read.
 */
const plotted = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));
vi.mock('echarts-for-react/esm/core', () => ({
  default: (props: { option: Record<string, unknown> }) => {
    plotted.options.push(props.option);
    return <div data-testid="canvas" />;
  },
}));
const { default: TimeSeriesChart } = await import('./TimeSeriesChart');

const AT = Date.UTC(2026, 9, 7, 8, 0, 0);
const series: GraphSeries = {
  itemid: '1',
  name: 'Bits received',
  host: 'core-sw-1',
  units: 'bps',
  value_type: '0',
  delaySeconds: 60,
  step: false,
  points: [[AT, 1_000_000, 900_000, 1_100_000]],
  stats: null,
  coverage: { coveredSeconds: 3600, firstClock: AT / 1000, lastClock: AT / 1000 + 3600 },
};

const LIGHT = { '--surface': '#ffffff', '--border': '#d0d7e2', '--text': '#101828', '--muted': '#475467' };
const DARK = { '--surface': '#16202e', '--border': '#2c3a4f', '--text': '#e6ebf2', '--muted': '#a9b4c4' };
const setTokens = (tokens: Record<string, string>) => Object.entries(tokens).forEach(([name, value]) => document.documentElement.style.setProperty(name, value));

type Tooltip = { backgroundColor?: string; borderColor?: string; textStyle?: { color?: string }; formatter: (p: unknown) => string };
const drawn = () => {
  plotted.options.length = 0;
  render(<TimeSeriesChart series={[series]} from={AT / 1000} to={AT / 1000 + 3600} />);
  return plotted.options[plotted.options.length - 1]!.tooltip as Tooltip;
};

beforeEach(() => {
  plotted.options.length = 0;
});
afterEach(() => {
  for (const name of Object.keys(LIGHT)) document.documentElement.style.removeProperty(name);
});

describe('the tooltip of a chart (UX-41)', () => {
  it('takes its background, its edge and its text from the surface, border and text tokens of the light theme', () => {
    setTokens(LIGHT);
    expect(drawn()).toMatchObject({ backgroundColor: LIGHT['--surface'], borderColor: LIGHT['--border'], textStyle: { color: LIGHT['--text'] } });
  });

  it('takes the same tokens in the dark theme, so that nothing is white there', () => {
    setTokens(DARK);
    const tooltip = drawn();
    expect(tooltip).toMatchObject({ backgroundColor: DARK['--surface'], borderColor: DARK['--border'], textStyle: { color: DARK['--text'] } });
    expect(tooltip.backgroundColor?.toLowerCase()).not.toBe('#fff');
    expect(tooltip.backgroundColor?.toLowerCase()).not.toBe('#ffffff');
  });

  it('writes the time and the range in the muted token, which the checker holds to 4.5 to 1 on the surface', () => {
    setTokens(DARK);
    const html = drawn().formatter([{ seriesIndex: 0, dataIndex: 0, value: [AT, 1_000_000] }]);
    expect(html).toContain(`color:${DARK['--muted']}`);
  });
});
