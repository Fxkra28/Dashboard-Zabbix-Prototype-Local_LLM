import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import LatestData from './LatestData';

// A page loads in steps and the test files run side by side, so the default second of waiting is too short on a busy machine.
configure({ asyncUtilTimeout: 5000 });

/** The host and group menus of Latest data are read once. When one failed, the notice said so and the person could only reload the page (UX-60). */
beforeEach(() => {
  resetAuthProbe();
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'admin' }, expiresIn: 3600 });
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
  vi.spyOn(api, 'latest').mockResolvedValue({ items: [], truncated: false, total: 0, page: 1, pageSize: 100 });
});
afterEach(() => vi.restoreAllMocks());

const open = (url: string) => {
  window.history.replaceState(null, '', url);
  return render(<LatestData />, { wrapper: BrowserRouter });
};

describe('the notice for the host and group menus (UX-60)', () => {
  it('has a Try again button that reads the menu that failed, and only that one, and the notice goes when it is read', async () => {
    const hosts = vi.spyOn(api, 'hosts').mockResolvedValue([{ hostid: '1', name: '1.1 core-1', status: '0' }]);
    const groups = vi.spyOn(api, 'hostgroups').mockRejectedValueOnce(new Error('Zabbix did not answer')).mockResolvedValue([{ groupid: '7', name: 'Switches' }]);
    open('/latest?hostid=1');
    const notice = await screen.findByText(/The host and group menus could not be loaded/);
    expect(notice).toHaveTextContent('Zabbix did not answer');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(groups).toHaveBeenCalledTimes(2);
    expect(hosts).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('option', { name: 'Switches' })).toBeInTheDocument();
    expect(screen.queryByText(/The host and group menus could not be loaded/)).toBeNull();
  });

  it('reads both menus again when both failed', async () => {
    const hosts = vi.spyOn(api, 'hosts').mockRejectedValueOnce(new Error('no hosts')).mockResolvedValue([{ hostid: '1', name: '1.1 core-1', status: '0' }]);
    const groups = vi.spyOn(api, 'hostgroups').mockRejectedValueOnce(new Error('no groups')).mockResolvedValue([]);
    open('/latest?hostid=1');
    await screen.findByText(/The host and group menus could not be loaded/);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(hosts).toHaveBeenCalledTimes(2);
    expect(groups).toHaveBeenCalledTimes(2);
  });

  it('is the same button on the error that stands in for the page when nothing is chosen and no menu loaded', async () => {
    const hosts = vi.spyOn(api, 'hosts').mockRejectedValueOnce(new Error('no hosts')).mockResolvedValue([{ hostid: '1', name: '1.1 core-1', status: '0' }]);
    vi.spyOn(api, 'hostgroups').mockRejectedValueOnce(new Error('no groups')).mockResolvedValue([]);
    open('/latest');
    expect(await screen.findAllByRole('button', { name: 'Try again' })).not.toHaveLength(0);
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Try again' })[0]);
    expect(hosts).toHaveBeenCalledTimes(2);
  });
});
