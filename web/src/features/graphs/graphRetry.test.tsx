import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import type { GraphResponse, Host, Item } from '../../types';

// A page loads in steps and the test files run side by side, so the default second of waiting is too short on a busy machine.
configure({ asyncUtilTimeout: 5000 });

/**
 * Three reads of the Graphs page do not poll, so a failed one ended in an error with no way to read again but a reload, and the error did not say so (UX-60): the
 * host list, a host's items, and the chart of a past month or a fixed range. A live range polls and tries again by itself, so it has no button.
 */
vi.mock('echarts-for-react/esm/core', () => ({ default: () => <div data-testid="canvas" /> }));
const { default: HostDetail } = await import('./HostDetail');
const { default: ItemPicker } = await import('./ItemPicker');
const { GraphView } = await import('./TimeSeriesChart');

const HOSTS: Host[] = [{ hostid: '1', name: '1.1 core-1', status: '0' }];
const item = (itemid: string, name: string): Item => ({ itemid, name, key_: `k.${itemid}`, value_type: '3', units: 'bps', hosts: [{ hostid: '1', name: '1.1 core-1' }] });
const graph = (): GraphResponse => ({
  from: 1_800_000_000,
  to: 1_800_003_600,
  source: 'trend',
  series: [
    {
      itemid: '1', name: 'Bits received', host: 'core-1', units: 'bps', value_type: '0', delaySeconds: 60, step: false,
      points: [[1_800_000_000_000, 5, null, null]], stats: { min: 1, avg: 2, max: 3, last: 2, lastClock: 1_800_000_000 },
      coverage: { coveredSeconds: 3600, firstClock: 1_800_000_000, lastClock: 1_800_003_600 },
    },
  ],
  latestClock: 1_800_003_600,
  downsampled: false,
});

beforeEach(() => {
  resetAuthProbe();
  window.history.replaceState(null, '', '/graphs');
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'admin' }, expiresIn: 3600 });
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
});
afterEach(() => vi.restoreAllMocks());

const tryAgain = () => screen.findByRole('button', { name: 'Try again' });

describe('the host list of the Graphs page (UX-60)', () => {
  it('offers Try again when it could not be read, and reads it again', async () => {
    const hosts = vi.spyOn(api, 'hosts').mockRejectedValueOnce(new Error('Zabbix did not answer')).mockResolvedValue(HOSTS);
    vi.spyOn(api, 'items').mockResolvedValue([item('10', 'Bits received')]);
    vi.spyOn(api, 'itemsById').mockResolvedValue([]);
    vi.spyOn(api, 'graph').mockReturnValue(new Promise(() => undefined));
    render(<HostDetail />, { wrapper: BrowserRouter });
    expect(await screen.findByText('Zabbix did not answer')).toBeInTheDocument();

    await userEvent.setup().click(await tryAgain());
    expect(hosts).toHaveBeenCalledTimes(2);
    // Anchored: once the page has picked the item, its chip has a button named "Remove Bits received" too.
    expect(await screen.findByRole('button', { name: /^Bits received/ })).toBeInTheDocument();
    expect(screen.queryByText('Zabbix did not answer')).toBeNull();
  });
});

describe("a host's items in the picker (UX-60)", () => {
  it('offers Try again when they could not be read, and reads them again', async () => {
    const items = vi.spyOn(api, 'items').mockRejectedValueOnce(new Error('Zabbix did not answer')).mockResolvedValue([item('10', 'Bits received')]);
    render(<ItemPicker hostid="621" selected={[]} onChange={vi.fn()} />);
    expect(await screen.findByText('Zabbix did not answer')).toBeInTheDocument();

    await userEvent.setup().click(await tryAgain());
    expect(items).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: /Bits received/ })).toBeInTheDocument();
  });
});

describe('the chart of a range that does not end now (UX-60)', () => {
  it('offers Try again for a past month, and reads it again', async () => {
    const read = vi.spyOn(api, 'graph').mockRejectedValueOnce(new Error('Zabbix did not answer')).mockImplementation(async () => graph());
    render(<GraphView itemids={['1']} range={{ kind: 'month', month: '2026-08' }} />);
    expect(await screen.findByText('Zabbix did not answer')).toBeInTheDocument();

    await userEvent.setup().click(await tryAgain());
    expect(read).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: 'Show data' })).toBeInTheDocument();
  });

  it('offers Try again for a fixed range in the past too', async () => {
    const read = vi.spyOn(api, 'graph').mockRejectedValueOnce(new Error('Zabbix did not answer')).mockImplementation(async () => graph());
    render(<GraphView itemids={['1']} range={{ kind: 'custom', from: 1_700_000_000, to: 1_700_086_400 }} />);
    await userEvent.setup().click(await tryAgain());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('has no button for a live range, which polls and tries again by itself', async () => {
    vi.spyOn(api, 'graph').mockRejectedValue(new Error('Zabbix did not answer'));
    render(<GraphView itemids={['1']} range={{ kind: 'hours', hours: 24 }} />);
    expect(await screen.findByText('Zabbix did not answer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
