import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { GraphRange, GraphSeries } from '../../types';
import { fromZonedInput, setReportTimeZone, toZonedInput } from '../../shared/lib/time';

/**
 * The Graphs page reads every clock in the report zone (FR-20): the axis of the chart and the
 * slider under it, the tooltip, and the From and To fields of a custom range. The browser here is in
 * New York, so a time left in the browser's own zone shows as 11:00 or 04:00, not 15:00 WIB.
 */
vi.stubEnv('TZ', 'America/New_York');

type Option = {
  xAxis: { axisLabel: { formatter: (value: number) => string } };
  dataZoom: { type: string; labelFormatter?: (value: number) => string }[];
};
const chart = vi.hoisted(() => ({ option: null as null | Option }));
vi.mock('echarts-for-react/esm/core', () => ({
  default: (props: { option: Option }) => {
    chart.option = props.option;
    return <div />;
  },
}));
const { default: TimeSeriesChart } = await import('./TimeSeriesChart');
const { default: RangePicker } = await import('./RangePicker');

/** 08:00 UTC: 15:00 in Jakarta, 16:00 in Makassar, 04:00 in New York. */
const AT = Date.UTC(2026, 9, 7, 8, 0, 0);
const MIDNIGHT_WIB = Date.UTC(2026, 9, 6, 17, 0, 0);

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

const draw = (from: number, to: number) => {
  render(<TimeSeriesChart series={[series]} from={from} to={to} />);
  return chart.option!;
};
const DAY = 86_400;

describe('the time axis of a chart', () => {
  it('labels its ticks in the report zone, the hour and minute inside a day and the day at midnight', () => {
    const option = draw(AT / 1000 - 6 * 3600, AT / 1000);
    const label = option.xAxis.axisLabel.formatter;
    expect(label(AT)).toBe('15:00');
    expect(label(AT + 30 * 60_000)).toBe('15:30');
    expect(label(MIDNIGHT_WIB)).toBe('7 Oct');
    expect(label(AT)).not.toMatch(/04|11/);
  });

  it('puts the date on a tick of a range of days, so a tick that is not at midnight is not read as today', () => {
    const label = draw(AT / 1000 - 7 * DAY, AT / 1000).xAxis.axisLabel.formatter;
    expect(label(AT)).toBe('7 Oct 15:00');
    expect(label(MIDNIGHT_WIB)).toBe('7 Oct');
  });

  it('follows the zone the server names, and is drawn again when it changes, so no label stays in the old zone', () => {
    const first = draw(AT / 1000 - 6 * 3600, AT / 1000);
    act(() => setReportTimeZone('Asia/Makassar'));
    // A new option is what makes the chart redraw its labels: the old formatter alone would only be asked again at the next poll.
    expect(chart.option).not.toBe(first);
    expect(chart.option!.xAxis.axisLabel.formatter(AT)).toBe('16:00');
  });

  it('puts the day on every tick of a 24-hour range that runs over midnight, in a browser outside the report zone, where nothing else says which 15:00 is which', () => {
    const label = draw(AT / 1000 - 24 * 3600, AT / 1000).xAxis.axisLabel.formatter;
    expect(label(AT)).toBe('7 Oct 15:00');
    expect(label(AT - 4 * 3600_000)).toBe('7 Oct 11:00');
    expect(label(AT - 24 * 3600_000)).toBe('6 Oct 15:00');
    expect(label(MIDNIGHT_WIB)).toBe('7 Oct');
  });

  it('leaves the ticks bare in a browser that is in the report zone, where the tick at midnight names the day', () => {
    vi.stubEnv('TZ', 'Asia/Jakarta');
    try {
      const label = draw(AT / 1000 - 24 * 3600, AT / 1000).xAxis.axisLabel.formatter;
      expect(label(AT)).toBe('15:00');
      expect(label(AT - 4 * 3600_000)).toBe('11:00');
      expect(label(MIDNIGHT_WIB)).toBe('7 Oct');
    } finally {
      vi.stubEnv('TZ', 'America/New_York');
    }
  });

  it('labels the handles of the slider under it the same way, with the day', () => {
    const slider = draw(AT / 1000 - 6 * 3600, AT / 1000).dataZoom.find((z) => z.type === 'slider')!;
    expect(slider.labelFormatter!(AT)).toBe('7 Oct 15:00');
  });
});

describe('the From and To fields of a custom range', () => {
  const custom: GraphRange = { kind: 'custom', from: AT / 1000 - 3600, to: AT / 1000 };
  // A custom range opens with its fields showing.
  const open = (onChange = vi.fn()) => {
    render(<RangePicker value={custom} onChange={onChange} />);
    return onChange;
  };
  const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

  it('show the range in the report zone, and say which zone it is', () => {
    open();
    expect(field('From').value).toBe('2026-10-07T14:00');
    expect(field('To').value).toBe('2026-10-07T15:00');
    expect(screen.getByText('Times in WIB')).toBeInTheDocument();
  });

  it('are read in the report zone: 08:00 to 10:00 typed is 08:00 to 10:00 as Problems shows it', () => {
    const onChange = open();
    fireEvent.change(field('From'), { target: { value: '2026-10-07T08:00' } });
    fireEvent.change(field('To'), { target: { value: '2026-10-07T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'custom', from: Date.UTC(2026, 9, 7, 1, 0) / 1000, to: Date.UTC(2026, 9, 7, 3, 0) / 1000 });
  });

  it('follow the zone the server names', () => {
    setReportTimeZone('Asia/Makassar');
    open();
    expect(field('To').value).toBe('2026-10-07T16:00');
    expect(screen.getByText('Times in WITA')).toBeInTheDocument();
  });

  it('are rewritten in the new zone when the server names another one after the page is drawn', () => {
    open();
    expect(field('To').value).toBe('2026-10-07T15:00');
    act(() => setReportTimeZone('Asia/Makassar'));
    expect(field('From').value).toBe('2026-10-07T15:00');
    expect(field('To').value).toBe('2026-10-07T16:00');
    expect(screen.getByText('Times in WITA')).toBeInTheDocument();
  });
});

describe('toZonedInput and fromZonedInput', () => {
  const ZONES = ['Asia/Jakarta', 'UTC', 'America/New_York', 'Europe/London', 'Pacific/Auckland', 'Australia/Lord_Howe', 'Asia/Kolkata'];

  it.each(ZONES)('turn a moment into the field text of %s and back, to the minute, all through a year', (tz) => {
    const start = Date.UTC(2026, 0, 1) / 1000;
    for (let at = start; at < start + 365 * DAY; at += 6 * 3600 + 17 * 60) {
      const minute = Math.floor(at / 60) * 60;
      const text = toZonedInput(minute, tz);
      expect(text, `${minute} in ${tz}`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      const back = fromZonedInput(text, tz);
      // One of the two moments that read the same on the wall clock, when the clocks go back.
      expect([minute, minute - 3600, minute + 3600, minute - 1800, minute + 1800].includes(back), `${text} in ${tz}`).toBe(true);
      expect(toZonedInput(back, tz)).toBe(text);
    }
  });

  it('read a wall clock time as the zone says, whatever zone the browser is in', () => {
    expect(fromZonedInput('2026-10-07T15:00', 'Asia/Jakarta')).toBe(AT / 1000);
    expect(fromZonedInput('2026-10-07T16:00', 'Asia/Makassar')).toBe(AT / 1000);
    expect(fromZonedInput('2026-10-07T04:00', 'America/New_York')).toBe(AT / 1000);
  });

  it('say NaN for text that is not a date and time', () => {
    for (const text of ['', 'tomorrow', '2026-10-07', '2026-10-07 15:00', '2026-13-07T15:00', '2026-10-32T15:00', '2026-10-07T25:00']) {
      expect(fromZonedInput(text, 'Asia/Jakarta'), text).toBeNaN();
    }
  });
});
