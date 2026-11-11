import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../api';
import { resetAuthProbe } from '../shared/hooks/useAuth';
import ProblemsTable from '../features/problems/ProblemsTable';
import Hosts from '../features/hosts/Hosts';
import LatestData from '../features/hosts/LatestData';
import Network from '../features/network/Network';
import Sites from '../features/network/Sites';
import type { HostOverview, LatestItem, NetDevice, NetInterface, SitesResponse } from '../types';
import { problem } from './problems';

/**
 * The pages that use a shared piece (the pager, the host table, the acknowledged pill) still
 * say what they said when each had its own copy. The pieces are tested on their own in sharedPieces.test.tsx.
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

describe('the pager on Latest data', () => {
  const items: LatestItem[] = [
    { itemid: '1', name: 'CPU', key_: 'cpu', value_type: '0', lastvalue: '5', lastclock: '1800000000', units: '%', hosts: [{ hostid: '1', name: 'core-1' }] },
  ];
  beforeEach(() => {
    vi.spyOn(api, 'hosts').mockResolvedValue([{ hostid: '1', name: 'core-1', status: '0' }]);
    vi.spyOn(api, 'hostgroups').mockResolvedValue([]);
    vi.spyOn(api, 'latest').mockImplementation(async (o) => ({ items, truncated: false, total: 250, page: o.page ?? 1, pageSize: 100 }));
  });

  it('names the page and how many there are, and Next asks for the page after', async () => {
    const user = userEvent.setup();
    open(<LatestData />, '/latest?hostid=1&page=2');
    expect(await screen.findByText('Page 2 of 3')).toHaveClass('muted');
    expect(screen.getByRole('button', { name: '‹ Prev' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Next ›' }));
    expect(query().get('page')).toBe('3');
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
    expect(api.latest).toHaveBeenCalledWith(expect.objectContaining({ hostid: '1', page: 3 }));
    expect(screen.getByRole('button', { name: 'Next ›' })).toBeDisabled();
  });

  it('has no pager when the list fits on one page', async () => {
    vi.spyOn(api, 'latest').mockResolvedValue({ items, truncated: false, total: 1, page: 1, pageSize: 100 });
    open(<LatestData />, '/latest?hostid=1');
    await screen.findByText('CPU');
    expect(document.querySelector('.pager')).toBeNull();
  });
});

describe('the pager on Network', () => {
  const device: NetDevice = { hostid: '1', name: 'sw-1', status: '0', interfaces: [], icmp: { up: true, loss: 0, latency: 0.01, state: 'up' } };
  const port = (n: number): NetInterface => ({
    index: n, name: `Gi1/0/${n}`, alias: '', operStatus: 'up', speed: 1e9, inBps: 1000, outBps: 2000, utilisation: 0.1,
    inErrors: 0, outErrors: 0, inDiscards: 0, outDiscards: 0, lastclock: 1, itemids: { in: '1', out: '2' },
  });
  beforeEach(() => {
    vi.spyOn(api, 'netDevices').mockResolvedValue([device]);
    vi.spyOn(api, 'netInterfaces').mockImplementation(async (o) => ({
      rows: [port(1), port(2)], total: 130, summary: { up: 2, down: 0, other: 0 }, page: o.page ?? 1, pageSize: 50,
    }));
  });

  it('names the rows on screen and how many there are, and Prev goes back a page', async () => {
    const user = userEvent.setup();
    open(<Network />, '/network?hostid=1&page=2');
    expect(await screen.findByText('51\u2013100 of 130')).toHaveClass('muted');

    await user.click(screen.getByRole('button', { name: '‹ Prev' }));
    // Page 1 is the default, so it leaves the address.
    expect(query().has('page')).toBe(false);
    expect(await screen.findByText('1\u201350 of 130')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '‹ Prev' })).toBeDisabled();
    expect(api.netInterfaces).toHaveBeenCalledWith(expect.objectContaining({ hostid: '1', page: 1 }));
  });

  it('stops at the last page', async () => {
    open(<Network />, '/network?hostid=1&page=3');
    expect(await screen.findByText('101\u2013130 of 130')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next ›' })).toBeDisabled();
  });
});

describe('the host table on its two pages', () => {
  const none = { total: 0, bySeverity: {} };
  const hosts: HostOverview[] = [
    { hostid: '1', name: 'core-1', status: '0', interfaces: [{ ip: '10.0.0.1', type: '2' }], problems: { total: 2, bySeverity: { '4': 2 } } },
    { hostid: '2', name: 'edge-2', status: '1', problems: none },
  ];

  it('is six columns on the Hosts page, with no "Site from"', async () => {
    vi.spyOn(api, 'hostsOverview').mockResolvedValue(hosts);
    open(<Hosts />, '/hosts');
    await screen.findByText('core-1');
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['Host', 'Interface', 'Availability', 'Status', 'Problems', 'Actions']);
    const row = screen.getByRole('row', { name: /core-1/ });
    expect(within(row).getByText('10.0.0.1 · SNMP')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Graphs' })).toHaveAttribute('href', '/graphs?hostid=1');
  });

  it('is seven columns for an open site, the same rows with where the site came from', async () => {
    const site = {
      name: 'Jakarta', total: 2, available: 2, unavailable: 0, unknown: 0, maintenance: 0, disabled: 0, problems: 2, unacknowledged: 0,
      bySeverity: { '4': 2 }, worst: 4,
      hosts: hosts.map((h) => ({ ...h, availability: 'available' as const, siteSource: 'name' as const })),
    };
    vi.spyOn(api, 'sites').mockResolvedValue({ sites: [site], coverage: { hosts: 2, tag: 0, name: 2, inventory: 0, group: 0 } } as unknown as SitesResponse);
    open(<Sites />, '/sites?site=Jakarta');
    await screen.findByText('Jakarta: hosts');
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['Host', 'Interface', 'Availability', 'Status', 'Problems', 'Site from', 'Actions']);
    expect(screen.getAllByText('from host name')).toHaveLength(2);
  });
});

describe('the acknowledged pill in the problem table', () => {
  it('says Yes in the up colour for an acknowledged problem, and a plain No for the rest', () => {
    render(
      <BrowserRouter>
        <ProblemsTable problems={[problem(1, 4, 600, { acknowledged: '1' }), problem(2, 3, 300)]} />
      </BrowserRouter>,
    );
    const yes = within(screen.getByRole('row', { name: /Problem 1/ })).getByText('Yes');
    expect(yes).toHaveClass('pill', 'up');
    const no = within(screen.getByRole('row', { name: /Problem 2/ })).getByText('No');
    expect(no).toHaveClass('pill');
    expect(no).not.toHaveClass('up');
  });
});
