import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import Network from './Network';
import Sites from './Sites';
import type { NetDevice, NetInterface, Site } from '../../types';

// A page loads in steps and the test files run side by side, so the default second of waiting is too short on a busy machine.
configure({ asyncUtilTimeout: 5000 });

vi.mock('../graphs/TimeSeriesChart', () => ({ GraphView: () => <div data-testid="port-graph" /> }));

/**
 * Choosing a site card, or a port, opens a panel further down the page. With nothing to say so, a keyboard or screen reader user heard 'pressed' and saw nothing happen (UX-62):
 * the panel is brought into view, with the jump and not the glide for somebody who asked for less motion, and its heading takes the focus.
 */
function mediaQuery(reduce: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduce, addEventListener: () => undefined, removeEventListener: () => undefined })));
}

const site = (name: string, problems = 0): Site => ({
  name, total: 2, available: 2, unavailable: 0, unknown: 0, up: 2, down: 0, degraded: 0, nodata: 0, maintenance: 0, disabled: 0,
  problems, unacknowledged: 0, bySeverity: {}, worst: problems ? 3 : -1, hosts: [],
});
const device: NetDevice = { hostid: '1', name: 'sw-1', status: '0', interfaces: [], icmp: { up: true, loss: 0, latency: 0.01, state: 'up' } };
const port = (n: number): NetInterface => ({
  index: n, name: `Gi1/0/${n}`, alias: '', operStatus: 'up', speed: 1e9, inBps: 1000, outBps: 2000, utilisation: 0.1,
  inErrors: 0, outErrors: 0, inDiscards: 0, outDiscards: 0, lastclock: 1, itemids: { in: `${n}1`, out: `${n}2` },
});

let scrolled: ReturnType<typeof vi.fn>;
let scrolledAt: Element[];
beforeEach(() => {
  resetAuthProbe();
  scrolledAt = [];
  scrolled = vi.fn(function (this: Element) {
    scrolledAt.push(this);
  });
  Element.prototype.scrollIntoView = scrolled as never;
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'admin' }, expiresIn: 3600 });
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
  vi.spyOn(api, 'sites').mockResolvedValue({ sites: [site('Jakarta DC', 2), site('Balikpapan'), site('FPSO Aruba')], coverage: { hosts: 6, tag: 6, inventory: 0, group: 0 } });
  vi.spyOn(api, 'netDevices').mockResolvedValue([device]);
  vi.spyOn(api, 'netInterfaces').mockResolvedValue({ rows: [port(1), port(2)], total: 2, summary: { up: 2, down: 0, other: 0 }, page: 1, pageSize: 50 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const openSites = (url = '/sites') => {
  window.history.replaceState(null, '', url);
  return render(<Sites />, { wrapper: BrowserRouter });
};
const openNetwork = () => {
  window.history.replaceState(null, '', '/network?hostid=1');
  return render(<Network />, { wrapper: BrowserRouter });
};

describe('choosing a site card (UX-62)', () => {
  it('brings the hosts of the site into view and puts the focus on their heading', async () => {
    mediaQuery(false);
    openSites();
    await userEvent.setup().click(await screen.findByRole('button', { name: /Balikpapan/ }));

    const heading = await screen.findByRole('heading', { name: 'Balikpapan: hosts' });
    await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1));
    expect(scrolled).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(scrolledAt[0]).toBe(heading.closest('.panel'));
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('jumps, and does not glide, for somebody who asked for less motion', async () => {
    mediaQuery(true);
    openSites();
    await userEvent.setup().click(await screen.findByRole('button', { name: /Balikpapan/ }));
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
    expect(scrolled).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('does it again for another card, and does nothing when the open one is pressed to close it', async () => {
    mediaQuery(false);
    const user = userEvent.setup();
    openSites();
    await user.click(await screen.findByRole('button', { name: /Balikpapan/ }));
    await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: /FPSO Aruba/ }));
    await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'FPSO Aruba: hosts' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /FPSO Aruba/ }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'FPSO Aruba: hosts' })).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrolled).toHaveBeenCalledTimes(2);
  });

  it('does not scroll or take the focus when the page opens on a site named in the address', async () => {
    mediaQuery(false);
    openSites('/sites?site=Balikpapan');
    const heading = await screen.findByRole('heading', { name: 'Balikpapan: hosts' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrolled).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(heading);
  });
});

describe('choosing a port on Network (UX-62)', () => {
  it('brings its traffic into view and puts the focus on the heading, once it is shown', async () => {
    mediaQuery(false);
    openNetwork();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Gi1/0/2' }));

    const heading = await screen.findByRole('heading', { name: /Traffic: Gi1\/0\/2/ });
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
    expect(scrolled).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' });
    expect(scrolledAt[scrolledAt.length - 1]).toBe(heading.closest('.panel'));
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('jumps for somebody who asked for less motion', async () => {
    mediaQuery(true);
    openNetwork();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Gi1/0/1' }));
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
    expect(scrolled).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('moves to the traffic of the next port too, and leaves the page alone when the open port is pressed again', async () => {
    mediaQuery(false);
    const user = userEvent.setup();
    openNetwork();
    await user.click(await screen.findByRole('button', { name: 'Gi1/0/1' }));
    await screen.findByRole('heading', { name: /Traffic: Gi1\/0\/1/ });
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
    scrolled.mockClear();

    await user.click(screen.getByRole('button', { name: 'Gi1/0/2' }));
    expect(await screen.findByRole('heading', { name: /Traffic: Gi1\/0\/2/ })).toBeInTheDocument();
    await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1));
    scrolled.mockClear();

    await user.click(screen.getByRole('button', { name: 'Gi1/0/2' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrolled).not.toHaveBeenCalled();
  });
});
