import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GraphPoint, GraphSeries } from '../../types';

// jsdom has no canvas, and the drawing is not what is under test.
vi.mock('echarts-for-react/esm/core', () => ({ default: () => <div data-testid="canvas" /> }));
const { default: TimeSeriesChart } = await import('./TimeSeriesChart');

const series = (id: string, name: string, stats: GraphSeries['stats']): GraphSeries => ({
  itemid: id,
  name,
  host: 'core-sw-1',
  units: 'bps',
  value_type: '0',
  delaySeconds: 60,
  step: false,
  points: [[1_800_000_000_000, 1_000_000, null, null]],
  stats,
  coverage: { coveredSeconds: 3600, firstClock: 1_800_000_000, lastClock: 1_800_003_600 },
});

const stats = { min: 1_000_000, avg: 2_000_000, max: 3_000_000, last: 1_500_000, lastClock: 1_800_003_600 };

describe('TimeSeriesChart accessibility (UX-17)', () => {
  it('gives the chart a name that says what it plots and over which window', () => {
    render(<TimeSeriesChart series={[series('1', 'Bits received', stats)]} from={1_800_000_000} to={1_800_003_600} />);
    const chart = screen.getByRole('img');
    expect(chart).toHaveAccessibleName(/^Line chart of Bits received, .+ to .+/);
    expect(chart).toContainElement(screen.getByTestId('canvas'));
  });

  it('names every series when there are several', () => {
    render(
      <TimeSeriesChart
        series={[series('1', 'Bits received', stats), series('2', 'Bits sent', stats)]}
        from={1_800_000_000}
        to={1_800_003_600}
      />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(/Bits received; Bits sent/);
  });

  it('describes the chart with the min, average, max and last figures underneath it', () => {
    render(<TimeSeriesChart series={[series('1', 'Bits received', stats)]} from={1_800_000_000} to={1_800_003_600} />);
    const chart = screen.getByRole('img');
    expect(chart).toHaveAccessibleDescription(/Bits received.*min 1 Mbps.*avg 2 Mbps.*max 3 Mbps.*last 1\.5 Mbps/);
  });

  it('keeps the figures outside the img, so a screen reader can still read them as text', () => {
    render(<TimeSeriesChart series={[series('1', 'Bits received', stats)]} from={1_800_000_000} to={1_800_003_600} />);
    const chart = screen.getByRole('img');
    const summary = document.getElementById(chart.getAttribute('aria-describedby') ?? '');
    expect(summary).not.toBeNull();
    expect(chart).not.toContainElement(summary);
    expect(within(summary as HTMLElement).getByText('avg')).toBeInTheDocument();
  });

  it('says so in the description when a series has no data in the range', () => {
    render(<TimeSeriesChart series={[series('1', 'Bits received', null)]} from={1_800_000_000} to={1_800_003_600} />);
    expect(screen.getByRole('img')).toHaveAccessibleDescription(/no data in this range/);
  });
});

describe('the data table behind the chart (UX-17)', () => {
  const window_ = { from: 1_800_000_000, to: 1_800_003_600 };
  const T = 1_800_000_000_000;
  const show = async (ui: React.ReactElement) => {
    const user = userEvent.setup();
    render(ui);
    return user;
  };

  it('keeps the table out of the page until asked, with a button that says what it will do', () => {
    render(<TimeSeriesChart series={[series('1', 'Bits received', stats)]} {...window_} />);
    const button = screen.getByRole('button', { name: 'Show data' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(button.getAttribute('aria-controls') ?? '')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('opens one table for all the selected items, named by them, and closes it again', async () => {
    const user = await show(
      <TimeSeriesChart series={[series('1', 'Bits received', stats), series('2', 'Bits sent', stats)]} {...window_} />,
    );
    await user.click(screen.getByRole('button', { name: 'Show data' }));

    const open = screen.getByRole('button', { name: 'Hide data' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(1);
    expect(tables[0].querySelector('caption')?.textContent).toBe('Bits received; Bits sent');
    expect(screen.getByRole('region', { name: 'Data of Bits received, Bits sent' })).toHaveAttribute('tabindex', '0');

    await user.click(open);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show data' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('gives each selected item its own columns under its name, and the time once, on the left', async () => {
    const a = series('1', 'Bits received', stats);
    const b = series('2', 'Bits sent', stats);
    a.points = [[T, 1_000_000, null, null]];
    b.points = [[T, 4_000_000, null, null]];
    const user = await show(<TimeSeriesChart series={[a, b]} {...window_} />);
    await user.click(screen.getByRole('button', { name: 'Show data' }));

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Time',
      'Bits received',
      'Bits sent',
      'Value',
      'Value',
    ]);
    const [, , row] = within(table).getAllByRole('row');
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      expect.stringMatching(/\d/),
      '1 Mbps',
      '4 Mbps',
    ]);
  });

  it('joins the items on the time of their points, and says so where one has none', async () => {
    const a = series('1', 'Bits received', stats);
    const b = series('2', 'Bits sent', stats);
    a.points = [
      [T, 1_000_000, null, null],
      [T + 60_000, 2_000_000, null, null],
    ];
    b.points = [
      [T + 60_000, 5_000_000, null, null],
      [T + 120_000, 6_000_000, null, null],
    ];
    const user = await show(<TimeSeriesChart series={[a, b]} {...window_} />);
    await user.click(screen.getByRole('button', { name: 'Show data' }));

    const rows = screen.getAllByRole('row').slice(2);
    expect(rows).toHaveLength(3);
    const cells = rows.map((r) => within(r).getAllByRole('cell').slice(1));
    expect(cells[0][0]).toHaveTextContent('1 Mbps');
    expect(cells[0][1]).toHaveTextContent('No value at this time');
    expect(cells[1].map((c) => c.textContent)).toEqual(['2 Mbps', '5 Mbps']);
    expect(cells[2][0]).toHaveTextContent('No value at this time');
    expect(cells[2][1]).toHaveTextContent('6 Mbps');
  });

  it('keeps a collection gap apart from a time with no point: the gap says "No data"', async () => {
    const a = series('1', 'Bits received', stats);
    const b = series('2', 'Bits sent', stats);
    a.points = [[T, null, null, null]];
    b.points = [[T, 4_000_000, null, null]];
    const user = await show(<TimeSeriesChart series={[a, b]} {...window_} />);
    await user.click(screen.getByRole('button', { name: 'Show data' }));
    const [gap, value] = within(screen.getAllByRole('row')[2]).getAllByRole('cell').slice(1);
    expect(gap).toHaveTextContent('No data');
    expect(gap).not.toHaveTextContent('No value at this time');
    expect(value).toHaveTextContent('4 Mbps');
  });

  it('gives a trend item three columns and a plain item one, side by side', async () => {
    const trend = series('1', 'Bits received', stats);
    trend.points = [[T, 2_000_000, 1_000_000, 3_000_000]];
    const plain = series('2', 'Link state', stats);
    plain.units = '';
    plain.step = true;
    plain.points = [[T, 1, null, null]];
    const user = await show(<TimeSeriesChart series={[trend, plain]} {...window_} />);
    await user.click(screen.getByRole('button', { name: 'Show data' }));

    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Time',
      'Bits received',
      'Link state',
      'Average',
      'Min',
      'Max',
      'Value',
    ]);
    expect(screen.getByRole('columnheader', { name: 'Bits received' })).toHaveAttribute('colspan', '3');
    const cells = within(screen.getAllByRole('row')[2]).getAllByRole('cell').slice(1);
    expect(cells.map((c) => c.textContent)).toEqual(['2 Mbps', '1 Mbps', '3 Mbps', '1']);
  });

  it('lists every plotted point with its time and value in the series own units', async () => {
    const s = series('1', 'Bits received', stats);
    s.points = [
      [T, 1_000_000, null, null],
      [T + 60_000, 2_500_000, null, null],
    ];
    const user = await show(<TimeSeriesChart series={[s]} {...window_} />);
    await user.click(screen.getByRole('button', { name: 'Show data' }));

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Time', 'Value']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getAllByRole('cell')[1]).toHaveTextContent('1 Mbps');
    expect(within(rows[1]).getAllByRole('cell')[1]).toHaveTextContent('2.5 Mbps');
  });

  it('says "No data" for a collection gap, as words a screen reader can read', async () => {
    const s = series('1', 'Bits received', stats);
    s.points = [
      [T, 1_000_000, null, null],
      [T + 60_000, null, null, null],
    ];
    const user = await show(<TimeSeriesChart series={[s]} {...window_} />);
    await user.click(screen.getByRole('button', { name: 'Show data' }));

    const gap = within(screen.getAllByRole('row')[2]).getAllByRole('cell')[1];
    expect(gap).toHaveTextContent('No data');
  });

  it('adds Min and Max for a trend series, which carries them, and not for a step line', async () => {
    const trend = series('1', 'Bits received', stats);
    trend.points = [[T, 2_000_000, 1_000_000, 3_000_000]];
    const user = await show(<TimeSeriesChart series={[trend]} {...window_} />);
    await user.click(screen.getByRole('button', { name: 'Show data' }));
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Time', 'Average', 'Min', 'Max']);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect([cells[1], cells[2], cells[3]].map((c) => c.textContent)).toEqual(['2 Mbps', '1 Mbps', '3 Mbps']);
  });

  it('leaves Min and Max off a step line even when its points carry them', async () => {
    const step = { ...series('1', 'Link state', stats), step: true, units: '' };
    step.points = [[T, 1, 0, 1]];
    const user = await show(<TimeSeriesChart series={[step]} {...window_} />);
    await user.click(screen.getByRole('button', { name: 'Show data' }));
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Time', 'Value']);
  });

  it('opens and closes by what its parent says when the parent holds the state, and reports each click', async () => {
    const onChange = vi.fn();
    const ui = (open: boolean) => (
      <TimeSeriesChart series={[series('1', 'Bits received', stats)]} {...window_} dataOpen={open} onDataOpenChange={onChange} />
    );
    const user = userEvent.setup();
    const { rerender } = render(ui(true));
    expect(screen.getByRole('button', { name: 'Hide data' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('table')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide data' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    // The parent has not said so yet: the table is still the parent's to close.
    expect(screen.getByRole('table')).toBeInTheDocument();

    rerender(ui(false));
    expect(screen.queryByRole('table')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show data' }));
    expect(onChange).toHaveBeenLastCalledWith(true);
  });
});

describe('the CSV of the data table (MT-02)', () => {
  const window_ = { from: 1_800_000_000, to: 1_800_003_600 };
  const T = 1_800_000_000_000;
  const withPoints = (id: string, name: string, points: GraphPoint[]): GraphSeries => ({ ...series(id, name, null), points });

  /** What the throwaway link was asked to save: its name and the text of the file. */
  let saved: { name: string; text: Promise<string> }[];
  beforeEach(() => {
    saved = [];
    let last: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => ((last = b), 'blob:csv'));
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ name: this.download, text: last!.text() });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('offers the file beside Show data, with the table closed', () => {
    render(<TimeSeriesChart series={[series('1', 'Bits received', stats)]} {...window_} />);
    expect(screen.getByRole('button', { name: 'Show data' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('saves the plotted values as numbers, with the unit and the zone in the headings, and names the day', async () => {
    const user = userEvent.setup();
    render(
      <TimeSeriesChart
        series={[withPoints('1', 'Bits received', [[T, 1_500_000, null, null], [T + 60_000, 2_000_000, null, null]])]}
        {...window_}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('hcml-graph-2027-01-15.csv');
    expect(await saved[0].text).toBe(
      ['"Time (Asia/Jakarta)","Bits received (bps)"', '"2027-01-15 15:00:00","1500000"', '"2027-01-15 15:01:00","2000000"'].join('\n'),
    );
  });

  it('holds the rows of the table, joined on time, whether or not the table is open', async () => {
    const user = userEvent.setup();
    const two = [
      withPoints('1', 'Bits received', [[T, 100, null, null], [T + 60_000, 200, null, null]]),
      withPoints('2', 'Bits sent', [[T + 60_000, 7, null, null], [T + 120_000, 8, null, null]]),
    ];
    render(<TimeSeriesChart series={two} {...window_} />);
    await user.click(screen.getByRole('button', { name: 'Show data' }));
    const tableRows = screen.getAllByRole('row').length - 2; // two heading rows: a column group per series
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    const lines = (await saved[0].text).split('\n');
    expect(lines).toHaveLength(tableRows + 1);
    expect(lines[0]).toBe('"Time (Asia/Jakarta)","Bits received (bps)","Bits sent (bps)"');
    // A time at which a series has no point is an empty cell, as in the table.
    expect(lines[1]).toBe('"2027-01-15 15:00:00","100",""');
    expect(lines[3]).toBe('"2027-01-15 15:02:00","","8"');
  });

  it('is off when no series has a point, so the file would be a heading and nothing else', () => {
    render(<TimeSeriesChart series={[withPoints('1', 'Bits received', [])]} {...window_} />);
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
  });
});
