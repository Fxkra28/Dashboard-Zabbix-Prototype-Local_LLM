import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../api';
import { resetAuthProbe } from '../shared/hooks/useAuth';
import LatestData from '../features/hosts/LatestData';
import Network from '../features/network/Network';
import type { LatestItem, NetDevice, NetInterface } from '../types';

/**
 * A page past the last one (FR-23): an old address, or a filter that shrinks the list under the page
 * being read at the next poll. It read as "no items" with the pager gone, and only changing a filter
 * helped. Now the page asks for the last page, and the pager stays while the list is not empty.
 * Each page gets rows of its own here, so paging itself is tested too (FR-25).
 */
const query = () => new URLSearchParams(window.location.search);
const open = (ui: React.ReactElement, url: string) => {
  window.history.replaceState(null, '', url);
  return render(<BrowserRouter>{ui}</BrowserRouter>);
};

beforeEach(() => {
  resetAuthProbe();
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'admin' }, expiresIn: 3600 });
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
});
afterEach(() => vi.restoreAllMocks());

describe('Latest data past the end', () => {
  const TOTAL = 250;
  const SIZE = 100;
  const item = (n: number): LatestItem => ({ itemid: String(n), name: `Item ${n}`, key_: `k.${n}`, value_type: '0', lastvalue: '5', lastclock: '1800000000', units: '%', hosts: [{ hostid: '1', name: 'core-1' }] });
  /** Item numbers on a page, 1 to 250 in order: the third page holds 201 to 250. */
  const rowsOf = (page: number) => Array.from({ length: Math.max(0, Math.min(SIZE, TOTAL - (page - 1) * SIZE)) }, (_, i) => item((page - 1) * SIZE + i + 1));
  beforeEach(() => {
    vi.spyOn(api, 'hosts').mockResolvedValue([{ hostid: '1', name: 'core-1', status: '0' }]);
    vi.spyOn(api, 'hostgroups').mockResolvedValue([]);
  });

  it('shows rows of the page it asked for, not the same rows for every page', async () => {
    vi.spyOn(api, 'latest').mockImplementation(async (o) => ({ items: rowsOf(o.page ?? 1), truncated: false, total: TOTAL, page: o.page ?? 1, pageSize: SIZE }));
    open(<LatestData />, '/latest?hostid=1&page=3');
    expect(await screen.findByText('Item 201')).toBeInTheDocument();
    expect(screen.queryByText('Item 1')).toBeNull();
  });

  it('follows a server that answers the last page when a later one was asked, and puts that page in the address', async () => {
    vi.spyOn(api, 'latest').mockImplementation(async (o) => {
      const page = Math.min(o.page ?? 1, 3);
      return { items: rowsOf(page), truncated: false, total: TOTAL, page, pageSize: SIZE };
    });
    open(<LatestData />, '/latest?hostid=1&page=9');
    expect(await screen.findByText('Item 201')).toBeInTheDocument();
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
    expect(query().get('page')).toBe('3');
  });

  it('goes to the last page by itself when the server (an older one) answers a page past the end with no rows', async () => {
    vi.spyOn(api, 'latest').mockImplementation(async (o) => ({ items: rowsOf(o.page ?? 1), truncated: false, total: TOTAL, page: o.page ?? 1, pageSize: SIZE }));
    open(<LatestData />, '/latest?hostid=1&page=9');
    expect(await screen.findByText('Item 201')).toBeInTheDocument();
    expect(query().get('page')).toBe('3');
    expect(screen.queryByText('No items for this selection.')).toBeNull();
  });
});

describe('Network past the end', () => {
  const device: NetDevice = { hostid: '1', name: 'sw-1', status: '0', interfaces: [], icmp: { up: true, loss: 0, latency: 0.01, state: 'up' } };
  const port = (n: number): NetInterface => ({
    index: n, name: `Gi1/0/${n}`, alias: '', operStatus: 'up', speed: 1e9, inBps: 1000, outBps: 2000, utilisation: 0.1,
    inErrors: 0, outErrors: 0, inDiscards: 0, outDiscards: 0, lastclock: 1, itemids: { in: '1', out: '2' },
  });
  const TOTAL = 130;
  const SIZE = 50;
  const rowsOf = (page: number) => Array.from({ length: Math.max(0, Math.min(SIZE, TOTAL - (page - 1) * SIZE)) }, (_, i) => port((page - 1) * SIZE + i + 1));
  beforeEach(() => void vi.spyOn(api, 'netDevices').mockResolvedValue([device]));

  it('shows the ports of the page it asked for', async () => {
    vi.spyOn(api, 'netInterfaces').mockImplementation(async (o) => ({ rows: rowsOf(o.page ?? 1), total: TOTAL, summary: { up: TOTAL, down: 0, other: 0 }, page: o.page ?? 1, pageSize: SIZE }));
    open(<Network />, '/network?hostid=1&page=3');
    expect(await screen.findByText('Gi1/0/101')).toBeInTheDocument();
    expect(screen.queryByText('Gi1/0/1')).toBeNull();
  });

  it('follows a server that answers the last page when a later one was asked', async () => {
    vi.spyOn(api, 'netInterfaces').mockImplementation(async (o) => {
      const page = Math.min(o.page ?? 1, 3);
      return { rows: rowsOf(page), total: TOTAL, summary: { up: TOTAL, down: 0, other: 0 }, page, pageSize: SIZE };
    });
    open(<Network />, '/network?hostid=1&page=8');
    expect(await screen.findByText('Gi1/0/101')).toBeInTheDocument();
    expect(await screen.findByText('101–130 of 130')).toBeInTheDocument();
    expect(query().get('page')).toBe('3');
  });

  it('goes to the last page by itself, and not to "No interface items", when an older server answers no rows past the end', async () => {
    vi.spyOn(api, 'netInterfaces').mockImplementation(async (o) => ({ rows: rowsOf(o.page ?? 1), total: TOTAL, summary: { up: TOTAL, down: 0, other: 0 }, page: o.page ?? 1, pageSize: SIZE }));
    open(<Network />, '/network?hostid=1&page=8');
    expect(await screen.findByText('Gi1/0/101')).toBeInTheDocument();
    expect(query().get('page')).toBe('3');
    expect(screen.queryByText('No interface (net.if.*) items on this device.')).toBeNull();
  });

  it('still says there is nothing when the device has no interfaces at all', async () => {
    vi.spyOn(api, 'netInterfaces').mockResolvedValue({ rows: [], total: 0, summary: { up: 0, down: 0, other: 0 }, page: 1, pageSize: SIZE });
    open(<Network />, '/network?hostid=1');
    expect(await screen.findByText('No interface (net.if.*) items on this device.')).toBeInTheDocument();
  });
});
