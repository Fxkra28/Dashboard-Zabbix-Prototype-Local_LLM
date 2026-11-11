import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import Network from './Network';
import type { NetDevice, NetInterface } from '../../types';
import { stylesheet as styles } from '../../__tests__/stylesheet';

// The chart is loaded when a port is opened; what it draws is not under test here.
vi.mock('../graphs/TimeSeriesChart', () => ({ GraphView: () => <div data-testid="port-graph" /> }));

/**
 * A Network port row is opened with a real button (UX-18): the interface name. The row itself holds
 * no tab stop and no tooltip-only name, and a click anywhere on it still opens the graph.
 */

const device: NetDevice = { hostid: '1', name: 'sw-1', status: '0', interfaces: [], icmp: { up: true, loss: 0, latency: 0.01, state: 'up' } };
const port = (n: number, itemids: NetInterface['itemids'] = { in: `${n}1`, out: `${n}2` }): NetInterface => ({
  index: n, name: `Gi1/0/${n}`, alias: n === 1 ? 'Uplink' : '', operStatus: 'up', speed: 1e9, inBps: 1000, outBps: 2000, utilisation: 0.1,
  inErrors: 0, outErrors: 0, inDiscards: 0, outDiscards: 0, lastclock: 1, itemids,
});

const open = (url: string) => {
  window.history.replaceState(null, '', url);
  return render(
    <BrowserRouter>
      <Network />
    </BrowserRouter>,
  );
};

beforeEach(() => {
  resetAuthProbe();
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'admin' }, expiresIn: 3600 });
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
  vi.spyOn(api, 'netDevices').mockResolvedValue([device]);
  vi.spyOn(api, 'netInterfaces').mockResolvedValue({
    rows: [port(1), port(2), port(3, {})], total: 3, summary: { up: 3, down: 0, other: 0 }, page: 1, pageSize: 50,
  });
});
afterEach(() => vi.restoreAllMocks());

const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement;

describe('the port rows on Network', () => {
  it('open a port from a button named by the interface, and keep the row out of the tab order', async () => {
    open('/network?hostid=1');
    const row = await rowOf('Gi1/0/2');

    const button = within(row).getByRole('button', { name: 'Gi1/0/2' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAccessibleDescription('Graph this port’s traffic');
    expect(row).not.toHaveAttribute('tabindex');
    expect(row).not.toHaveAttribute('title');
    expect(row).not.toHaveAttribute('role');
  });

  it('give a port with nothing to graph plain text, not a button', async () => {
    open('/network?hostid=1');
    const row = await rowOf('Gi1/0/3');
    expect(within(row).queryByRole('button')).toBeNull();
    expect(row).not.toHaveClass('clickable');
  });

  it('keep the alias beside the button, as text', async () => {
    open('/network?hostid=1');
    const row = await rowOf('Gi1/0/1');
    expect(within(row).getByText('Uplink')).toBeInTheDocument();
  });

  it('open the graph from the keyboard, once, and mark the port pressed', async () => {
    const user = userEvent.setup();
    open('/network?hostid=1');
    const row = await rowOf('Gi1/0/2');
    const button = within(row).getByRole('button', { name: 'Gi1/0/2' });

    await user.tab();
    button.focus();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(await screen.findByTestId('port-graph')).toBeInTheDocument();
    expect(screen.getAllByTestId('port-graph')).toHaveLength(1);
    expect(within(row).getByRole('button', { name: 'Gi1/0/2' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(await rowOf('Gi1/0/1')).getByRole('button', { name: 'Gi1/0/1' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('open the graph from Space too', async () => {
    const user = userEvent.setup();
    open('/network?hostid=1');
    const button = within(await rowOf('Gi1/0/1')).getByRole('button', { name: 'Gi1/0/1' });
    button.focus();
    await user.keyboard(' ');
    expect(await screen.findByTestId('port-graph')).toBeInTheDocument();
  });

  it('still open from a click anywhere else on the row, for a mouse', async () => {
    const user = userEvent.setup();
    open('/network?hostid=1');
    const row = await rowOf('Gi1/0/2');
    await user.click(within(row).getAllByRole('cell')[2]);
    expect(await screen.findByTestId('port-graph')).toBeInTheDocument();
  });

  it('do nothing for a click on a row with no item to graph', async () => {
    const user = userEvent.setup();
    open('/network?hostid=1');
    const row = await rowOf('Gi1/0/3');
    await user.click(within(row).getAllByRole('cell')[1]);
    expect(screen.queryByTestId('port-graph')).toBeNull();
  });
});

describe('a selected device card (UX-18)', () => {
  it('is a pressed button, so its selection is stated and not only drawn', async () => {
    open('/network?hostid=1');
    const card = (await screen.findByText('sw-1')).closest('[role="button"]') as HTMLElement;
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(card).toHaveClass('sel');
    expect(card).toHaveAttribute('tabindex', '0');
  });

  it('is drawn with a shadow ring, not an outline, so the keyboard focus ring stays distinct from the selection', () => {
    const rule = (selector: string) => new RegExp(`${selector.replace(/[.:]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? '';
    expect(rule('.device.sel')).toMatch(/box-shadow:/);
    expect(rule('.device.sel')).not.toMatch(/outline/);
    // On a selected card the focus ring moves outside the selection ring.
    expect(rule('.device.sel:focus-visible')).toMatch(/outline-offset:\s*4px/);
  });
});
