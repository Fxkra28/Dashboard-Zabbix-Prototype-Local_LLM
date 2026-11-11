import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../api';
import type { GraphRange, GraphResponse, GraphSeries } from '../../types';

// jsdom has no canvas, and the drawing is not what is under test.
vi.mock('echarts-for-react/esm/core', () => ({ default: () => <div data-testid="canvas" /> }));
const { GraphView } = await import('./TimeSeriesChart');

/** The Show data table follows the selection and stays open through changes of it: the chart is remounted on every change, which used to close the table. */

const T = 1_800_000_000_000;
const NAMES: Record<string, string> = { '1': 'Bits received', '2': 'Bits sent', '3': 'CPU load' };

const seriesOf = (id: string): GraphSeries => ({
  itemid: id,
  name: NAMES[id] ?? `Item ${id}`,
  host: 'core-sw-1',
  units: id === '3' ? '%' : 'bps',
  value_type: '0',
  delaySeconds: 60,
  step: false,
  points: [[T, Number(id) * 1_000_000, null, null]],
  stats: { min: 1, avg: 2, max: 3, last: 2, lastClock: 1_800_000_000 },
  coverage: { coveredSeconds: 3600, firstClock: 1_800_000_000, lastClock: 1_800_003_600 },
});

const respond = async (ids: string[]): Promise<GraphResponse> => ({
  from: 1_800_000_000,
  to: 1_800_003_600,
  source: 'trend',
  series: ids.map(seriesOf),
  latestClock: 1_800_003_600,
  downsampled: false,
});

const RANGE_A: GraphRange = { kind: 'month', month: '2026-08' };
const RANGE_B: GraphRange = { kind: 'month', month: '2026-07' };

afterEach(() => vi.restoreAllMocks());

describe('GraphView and the Show data table', () => {
  it('keeps the table open when an item is removed or added, and shows exactly the items selected then', async () => {
    vi.spyOn(api, 'graph').mockImplementation((ids) => respond(ids));
    const user = userEvent.setup();
    const { rerender } = render(<GraphView itemids={['1', '2']} range={RANGE_A} />);

    await user.click(await screen.findByRole('button', { name: 'Show data' }));
    expect(screen.getByRole('table').querySelector('caption')?.textContent).toBe('Bits received; Bits sent');

    // Remove the first item: the table is still open, and holds the one left.
    rerender(<GraphView itemids={['2']} range={RANGE_A} />);
    expect(await screen.findByRole('button', { name: 'Hide data' })).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('region', { name: 'Data of Bits sent' })).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.queryByText(/Bits received/)).toBeNull();

    // Add another: still open, and it holds both.
    rerender(<GraphView itemids={['2', '3']} range={RANGE_A} />);
    expect(await screen.findByRole('region', { name: 'Data of Bits sent, CPU load' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide data' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps the table open when the range changes', async () => {
    vi.spyOn(api, 'graph').mockImplementation((ids) => respond(ids));
    const user = userEvent.setup();
    const { rerender } = render(<GraphView itemids={['1']} range={RANGE_A} />);
    await user.click(await screen.findByRole('button', { name: 'Show data' }));

    rerender(<GraphView itemids={['1']} range={RANGE_B} />);
    expect(await screen.findByRole('button', { name: 'Hide data' })).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(api.graph).toHaveBeenCalledTimes(2);
  });

  it('keeps it closed once the reader has closed it, through the same changes', async () => {
    vi.spyOn(api, 'graph').mockImplementation((ids) => respond(ids));
    const user = userEvent.setup();
    const { rerender } = render(<GraphView itemids={['1', '2']} range={RANGE_A} />);
    await user.click(await screen.findByRole('button', { name: 'Show data' }));
    await user.click(screen.getByRole('button', { name: 'Hide data' }));

    rerender(<GraphView itemids={['2']} range={RANGE_A} />);
    expect(await screen.findByRole('button', { name: 'Show data' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('opens at the first item chosen and follows each change after it', async () => {
    vi.spyOn(api, 'graph').mockImplementation((ids) => respond(ids));
    const user = userEvent.setup();
    const { rerender } = render(<GraphView itemids={['3']} range={RANGE_A} />);
    await user.click(await screen.findByRole('button', { name: 'Show data' }));
    const table = () => within(screen.getByRole('table'));
    expect(table().getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Time', 'Value']);

    rerender(<GraphView itemids={['3', '1']} range={RANGE_A} />);
    await screen.findByRole('region', { name: 'Data of CPU load, Bits received' });
    expect(table().getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Time', 'CPU load', 'Bits received', 'Value', 'Value']);
  });
});
