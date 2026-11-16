import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, configure } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import Network from './Network';
import type { NetDevice, NetInterface } from '../../types';

// A page loads in steps and the test files run side by side, so the default second of waiting is too short on a busy machine.
configure({ asyncUtilTimeout: 5000 });

vi.mock('../graphs/TimeSeriesChart', () => ({ GraphView: () => <div data-testid="port-graph" /> }));

/** The pager of the ports table sits outside the content that goes inert while the next page loads (UX-57). */
const device: NetDevice = { hostid: '1', name: 'sw-1', status: '0', interfaces: [], icmp: { up: true, loss: 0, latency: 0.01, state: 'up' } };
const port = (n: number): NetInterface => ({
  index: n, name: `Gi1/0/${n}`, alias: '', operStatus: 'up', speed: 1e9, inBps: 1000, outBps: 2000, utilisation: 0.1,
  inErrors: 0, outErrors: 0, inDiscards: 0, outDiscards: 0, lastclock: 1, itemids: { in: `${n}1`, out: `${n}2` },
});

beforeEach(() => {
  resetAuthProbe();
  window.history.replaceState(null, '', '/network?hostid=1');
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'admin' }, expiresIn: 3600 });
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
  vi.spyOn(api, 'netDevices').mockResolvedValue([device]);
});
afterEach(() => vi.restoreAllMocks());

const settle = () => act(async () => undefined);
const open = () => render(<Network />, { wrapper: BrowserRouter });

describe('the pager of the ports table (UX-57)', () => {
  it('is not inside the inert content while the next page loads, and keeps the focus of the button that was pressed', async () => {
    let release!: () => void;
    vi.spyOn(api, 'netInterfaces').mockImplementation(({ page }) =>
      page === 1
        ? Promise.resolve({ rows: [port(1), port(2)], total: 120, summary: { up: 120, down: 0, other: 0 }, page: 1, pageSize: 50 })
        : new Promise((resolve) => {
            release = () => resolve({ rows: [port(51)], total: 120, summary: { up: 120, down: 0, other: 0 }, page: 2, pageSize: 50 });
          }),
    );
    const { container } = open();
    await settle();
    const next = await screen.findByRole('button', { name: /Next/ });
    next.focus();
    fireEvent.click(next);
    await settle();

    expect(container.querySelector('[inert]')).not.toBeNull();
    expect(screen.getByText('Gi1/0/1').closest('[inert]')).not.toBeNull();
    const again = screen.getByRole('button', { name: /Next/ });
    expect(again.closest('[inert]')).toBeNull();
    expect(again).toBe(next);
    expect(document.activeElement).toBe(next);
    expect(screen.getByText(/51–100 of 120|1–50 of 120/)).toBeInTheDocument();

    await act(async () => release());
    await settle();
    expect(screen.getByText('Gi1/0/51')).toBeInTheDocument();
    expect(document.activeElement).toBe(next);
    expect(screen.getByText('51–100 of 120')).toBeInTheDocument();
  });

  it('keeps its words: the range on a page with rows, and the count on a page past the end', async () => {
    vi.spyOn(api, 'netInterfaces').mockResolvedValue({ rows: [port(1), port(2)], total: 2, summary: { up: 2, down: 0, other: 0 }, page: 1, pageSize: 50 });
    const { unmount } = open();
    await settle();
    expect(await screen.findByText('1–2 of 2')).toBeInTheDocument();
    unmount();

    window.history.replaceState(null, '', '/network?hostid=1&page=9');
    vi.mocked(api.netInterfaces).mockResolvedValue({ rows: [], total: 120, summary: { up: 120, down: 0, other: 0 }, page: 9, pageSize: 50 });
    open();
    await settle();
    expect(await screen.findByText('120 interfaces')).toBeInTheDocument();
    // A page past the end asks for the last one there is, and the answer for it is empty again here.
    expect(screen.getByText(/There are no interfaces on page \d\./)).toBeInTheDocument();
  });

  it('draws no pager for a device with no interfaces, or when the ports could not be read', async () => {
    vi.spyOn(api, 'netInterfaces').mockResolvedValue({ rows: [], total: 0, summary: { up: 0, down: 0, other: 0 }, page: 1, pageSize: 50 });
    const { unmount } = open();
    await settle();
    expect(await screen.findByText(/No interface \(net\.if\.\*\) items on this device/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next/ })).toBeNull();
    unmount();

    vi.mocked(api.netInterfaces).mockRejectedValue(new Error('Zabbix did not answer'));
    open();
    await settle();
    expect(await screen.findByText(/Zabbix did not answer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next/ })).toBeNull();
  });
});
