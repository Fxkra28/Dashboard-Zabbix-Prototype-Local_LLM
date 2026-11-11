import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../api';
import { resetAuthProbe } from '../shared/hooks/useAuth';
import { ErrorState } from '../shared/components/states';
import HostDetail from '../features/graphs/HostDetail';
import LatestData from '../features/hosts/LatestData';

/** When the host list cannot load, Graphs and Latest data say so, not "Loading hosts…" for good or empty menus. */

const open = (ui: React.ReactElement, url: string) => {
  window.history.replaceState(null, '', url);
  return render(<BrowserRouter>{ui}</BrowserRouter>);
};
const DOWN = 'The data source is not answering. Tell an administrator and quote reference 1a2b3c4d5e6f.';

beforeEach(() => {
  resetAuthProbe();
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'viewer' }, expiresIn: 3600 });
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
});
afterEach(() => vi.restoreAllMocks());

describe('Graphs', () => {
  it('shows the failure, and not "Loading hosts…", when the host list cannot load', async () => {
    vi.spyOn(api, 'hosts').mockRejectedValue(new Error(DOWN));
    open(<HostDetail />, '/graphs');
    expect(await screen.findByRole('alert')).toHaveTextContent(DOWN);
    expect(screen.getByText('Couldn’t load data')).toBeInTheDocument();
    expect(screen.queryByText('Loading hosts…')).toBeNull();
    expect(screen.getByRole('option', { name: 'Hosts unavailable' })).toBeInTheDocument();
  });

  it('says there are no hosts when the list loads empty', async () => {
    vi.spyOn(api, 'hosts').mockResolvedValue([]);
    open(<HostDetail />, '/graphs');
    expect(await screen.findByText('No hosts to show.')).toBeInTheDocument();
    expect(screen.queryByText('Loading hosts…')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('option', { name: 'No hosts' })).toBeInTheDocument();
  });

  it('still says "Loading hosts…" while the list is on its way', () => {
    vi.spyOn(api, 'hosts').mockReturnValue(new Promise(() => undefined));
    open(<HostDetail />, '/graphs');
    expect(screen.getByText('Loading hosts…', { selector: '.state div' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leaves a host named in the address alone: its items load although the list did not', async () => {
    vi.spyOn(api, 'hosts').mockRejectedValue(new Error(DOWN));
    vi.spyOn(api, 'items').mockResolvedValue([]);
    open(<HostDetail />, '/graphs?hostid=10');
    await screen.findByRole('option', { name: 'Hosts unavailable' });
    expect(api.items).toHaveBeenCalled();
    expect(screen.queryByText('Couldn’t load data')).toBeNull();
  });
});

describe('Latest data', () => {
  it('shows the failure instead of an empty table when nothing is picked and the host list failed', async () => {
    vi.spyOn(api, 'hosts').mockRejectedValue(new Error(DOWN));
    vi.spyOn(api, 'hostgroups').mockResolvedValue([]);
    vi.spyOn(api, 'latest').mockResolvedValue({ items: [], truncated: false, total: 0, page: 1, pageSize: 100 });
    open(<LatestData />, '/latest');
    expect(await screen.findByRole('alert')).toHaveTextContent(DOWN);
    expect(screen.queryByText('No items for this selection.')).toBeNull();
  });

  it('does the same when the group list failed', async () => {
    vi.spyOn(api, 'hosts').mockResolvedValue([]);
    vi.spyOn(api, 'hostgroups').mockRejectedValue(new Error(DOWN));
    vi.spyOn(api, 'latest').mockResolvedValue({ items: [], truncated: false, total: 0, page: 1, pageSize: 100 });
    open(<LatestData />, '/latest');
    expect(await screen.findByRole('alert')).toHaveTextContent(DOWN);
  });

  it('keeps the table when the address names a host, and adds a note about the menus', async () => {
    vi.spyOn(api, 'hosts').mockRejectedValue(new Error(DOWN));
    vi.spyOn(api, 'hostgroups').mockResolvedValue([]);
    vi.spyOn(api, 'latest').mockResolvedValue({
      items: [{ itemid: '1', name: 'CPU', key_: 'cpu', value_type: '0', lastvalue: '5', lastclock: '1800000000', units: '%', hosts: [{ hostid: '1', name: 'core-1' }] }],
      truncated: false,
      total: 1,
      page: 1,
      pageSize: 100,
    });
    open(<LatestData />, '/latest?hostid=1');
    expect(await screen.findByText('CPU')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(`The host and group menus could not be loaded: ${DOWN}`);
  });

  it('shows no failure when both lists load', async () => {
    vi.spyOn(api, 'hosts').mockResolvedValue([{ hostid: '1', name: 'core-1', status: '0' }]);
    vi.spyOn(api, 'hostgroups').mockResolvedValue([]);
    vi.spyOn(api, 'latest').mockResolvedValue({ items: [], truncated: false, total: 0, page: 1, pageSize: 100 });
    open(<LatestData />, '/latest');
    expect(await screen.findByText('No items for this selection.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the hint under an error', () => {
  const asRole = (role: 'viewer' | 'admin') => {
    resetAuthProbe();
    vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role }, expiresIn: 3600 });
  };

  it('gives the administrator the settings to check, and everyone else nothing the sentence has not said', async () => {
    asRole('admin');
    const { unmount } = render(<ErrorState message={DOWN} />);
    expect(await screen.findByText(/Check that ZBX_URL and ZABBIX_API_TOKEN are set/)).toBeInTheDocument();
    unmount();

    asRole('viewer');
    render(<ErrorState message={DOWN} />);
    await screen.findByRole('alert');
    expect(screen.queryByText(/ZBX_URL/)).toBeNull();
    expect(screen.queryByText(/Tell the portal admin/)).toBeNull();
  });

  it('says calmly that a page above the signed-in role is for that role, not that it failed to load', async () => {
    asRole('viewer');
    const { unmount } = render(<ErrorState message={'This view needs the "operator" role; you are signed in as "viewer".'} />);
    expect(await screen.findByRole('status')).toHaveTextContent('This page is for operators');
    expect(screen.getByText(/signed in as a viewer\. Ask the portal admin/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Couldn.t load data/)).toBeNull();
    unmount();

    render(<ErrorState message={'This view needs the "admin" role; you are signed in as "operator".'} />);
    expect(await screen.findByRole('status')).toHaveTextContent('This page is for admins');
    expect(screen.getByText(/signed in as an operator/)).toBeInTheDocument();
  });

  it('reads the wording for network interface data the same way, and names the wall role as wall screens', async () => {
    asRole('viewer');
    render(<ErrorState message={'Network interface data needs the "wall" role; you are signed in as "viewer".'} />);
    expect(await screen.findByRole('status')).toHaveTextContent('This page is for wall screens');
    expect(screen.getByText(/signed in as a viewer\. Ask the portal admin/)).toBeInTheDocument();
  });
});
