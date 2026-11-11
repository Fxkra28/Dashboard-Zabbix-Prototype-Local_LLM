import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

// echarts-for-react draws to a canvas, which jsdom has not got. The stand-in keeps the option it was given.
const options: { series: { lineStyle: { color: string } }[]; xAxis: { axisLabel: { color: string } } }[] = [];
vi.mock('echarts-for-react/esm/core', () => ({
  default: ({ option }: { option: (typeof options)[number] }) => {
    options.push(option);
    return null;
  },
}));
const { default: TimeSeriesChart } = await import('./TimeSeriesChart');
const { useThemeChange } = await import('./useThemeChange');

const root = document.documentElement;
let style: HTMLStyleElement;
let renders: number;
let listeners: (() => void)[];
const latest = () => options[options.length - 1];

/** The stylesheet's tokens, set the way a theme switch would change them. */
const paint = (series1: string, muted: string) => {
  style.textContent = `:root { --series-1: ${series1}; --series-2: #222222; --series-3: #333333; --series-4: #444444; --muted: ${muted}; }`;
};

function Probe() {
  useThemeChange();
  renders += 1;
  return null;
}

beforeEach(() => {
  options.length = 0;
  renders = 0;
  listeners = [];
  style = document.createElement('style');
  document.head.append(style);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.splice(listeners.indexOf(fn), 1),
  }));
});
afterEach(() => {
  style.remove();
  root.removeAttribute('data-theme');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const oneSeries = [
  {
    itemid: '1',
    host: 'h',
    name: 'CPU',
    units: '%',
    step: false,
    delaySeconds: 60,
    points: [[1000, 1, null, null]],
  },
] as never;

describe('useThemeChange', () => {
  it('renders again when the theme picker sets or clears data-theme', async () => {
    render(<Probe />);
    const before = renders;
    await act(async () => root.setAttribute('data-theme', 'dark'));
    expect(renders).toBeGreaterThan(before);
    const afterDark = renders;
    await act(async () => root.removeAttribute('data-theme'));
    expect(renders).toBeGreaterThan(afterDark);
  });

  it('renders again when the system colour scheme flips', () => {
    render(<Probe />);
    const before = renders;
    act(() => listeners.forEach((fn) => fn()));
    expect(renders).toBeGreaterThan(before);
  });

  it('stops listening when the component goes away', () => {
    const { unmount } = render(<Probe />);
    expect(listeners).toHaveLength(1);
    unmount();
    expect(listeners).toHaveLength(0);
  });

  it('stops watching data-theme when the component goes away, so a chart leaks no observer', () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const { unmount } = render(<Probe />);
    expect(disconnect).not.toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('TimeSeriesChart colours', () => {
  it('re-reads the theme colours after a switch, without new data (FR-08)', async () => {
    paint('#111111', '#aaaaaa');
    render(<TimeSeriesChart series={oneSeries} from={0} to={2} />);
    const first = latest();
    expect(first.series[0].lineStyle.color).toBe('#111111');
    expect(first.xAxis.axisLabel.color).toBe('#aaaaaa');

    paint('#abcdef', '#fedcba');
    await act(async () => root.setAttribute('data-theme', 'dark'));
    const last = latest();
    expect(last.series[0].lineStyle.color).toBe('#abcdef');
    expect(last.xAxis.axisLabel.color).toBe('#fedcba');
  });

  it('re-reads them when the operating system changes scheme under the system theme', () => {
    paint('#111111', '#aaaaaa');
    render(<TimeSeriesChart series={oneSeries} from={0} to={2} />);
    paint('#123456', '#654321');
    act(() => listeners.forEach((fn) => fn()));
    expect(latest().series[0].lineStyle.color).toBe('#123456');
  });
});
