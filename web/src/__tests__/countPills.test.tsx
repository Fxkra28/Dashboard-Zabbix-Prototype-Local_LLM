import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../api';
import { resetAuthProbe } from '../shared/hooks/useAuth';
import Hosts from '../features/hosts/Hosts';
import Devices from '../features/hosts/Devices';
import Sites from '../features/network/Sites';
import { CLASSES, ESTATE } from './hosts';
import type { HostOverview, SitesResponse } from '../types';

/**
 * The count beside the filters on Hosts, Devices and Sites (FR-34): it is shown when the data is in, not while the page is still
 * loading or after it failed, where '0 hosts' would read as an all-clear. Hosts also says so when the filter leaves nothing.
 */

const open = (ui: React.ReactElement, url: string) => {
  window.history.replaceState(null, '', url);
  return render(<BrowserRouter>{ui}</BrowserRouter>);
};
const DOWN = 'The data source is not answering. Tell an administrator and quote reference 1a2b3c4d5e6f.';
const never = () => new Promise<never>(() => undefined);

const overview = (): HostOverview[] =>
  ESTATE.map((h) => {
    // The estate carries the site, class and category that the overview does not.
    const host: Record<string, unknown> = { ...h };
    for (const key of ['site', 'class', 'category']) delete host[key];
    return host as unknown as HostOverview;
  });
const sites = (): SitesResponse => ({
  sites: [
    { name: 'Jakarta', total: 3, available: 3, unavailable: 0, unknown: 0, maintenance: 0, disabled: 0, problems: 0, unacknowledged: 0, bySeverity: {}, worst: -1, hosts: [] },
    { name: 'Surabaya', total: 2, available: 1, unavailable: 1, unknown: 0, maintenance: 0, disabled: 0, problems: 2, unacknowledged: 1, bySeverity: { '4': 2 }, worst: 4, hosts: [] },
  ],
  coverage: { hosts: 5, tag: 0, name: 5, inventory: 0, group: 0 },
});

beforeEach(() => {
  resetAuthProbe();
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'viewer' }, expiresIn: 3600, pages: {} } as never);
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
});
afterEach(() => vi.restoreAllMocks());

const pill = (re: RegExp) => screen.queryByText(re, { selector: '.pill' });

describe.each([
  { page: 'Hosts', noun: 'hosts', url: '/hosts', ui: () => <Hosts />, load: (data: 'ok' | 'wait' | 'fail') => vi.spyOn(api, 'hostsOverview').mockImplementation(() => (data === 'wait' ? never() : data === 'fail' ? Promise.reject(new Error(DOWN)) : Promise.resolve(overview()))), shown: /^9 hosts$/ },
  { page: 'Devices', noun: 'devices', url: '/devices', ui: () => <Devices />, load: (data: 'ok' | 'wait' | 'fail') => vi.spyOn(api, 'devices').mockImplementation(() => (data === 'wait' ? never() : data === 'fail' ? Promise.reject(new Error(DOWN)) : Promise.resolve({ classes: CLASSES, devices: ESTATE }))), shown: /^9 devices$/ },
  { page: 'Sites', noun: 'sites', url: '/sites', ui: () => <Sites />, load: (data: 'ok' | 'wait' | 'fail') => vi.spyOn(api, 'sites').mockImplementation(() => (data === 'wait' ? never() : data === 'fail' ? Promise.reject(new Error(DOWN)) : Promise.resolve(sites()))), shown: /^2 sites$/ },
])('the count on $page', ({ noun, url, ui, load, shown }) => {
  it('is not shown while the page is loading, where it would read as an all-clear zero', () => {
    load('wait');
    open(ui(), url);
    expect(pill(new RegExp(`^0 ${noun}$`))).toBeNull();
    expect(screen.queryByText(new RegExp(`\\d+ ${noun.slice(0, -1)}s?$`), { selector: '.pill' })).toBeNull();
  });

  it('is not shown after the page failed to load', async () => {
    load('fail');
    open(ui(), url);
    expect((await screen.findAllByRole('alert')).some((a) => a.textContent?.includes(DOWN))).toBe(true);
    expect(screen.queryByText(new RegExp(`^\\d+ ${noun.slice(0, -1)}s?$`), { selector: '.pill' })).toBeNull();
  });

  it('is shown once the data is in', async () => {
    load('ok');
    open(ui(), url);
    expect(await screen.findByText(shown, { selector: '.pill' })).toBeInTheDocument();
  });
});

describe('Hosts with a filter that leaves nothing', () => {
  it('says no host matches, with no table header and no rows, and still counts 0', async () => {
    vi.spyOn(api, 'hostsOverview').mockResolvedValue(overview().map((h) => ({ ...h, problems: { total: 0, bySeverity: {} } })));
    open(<Hosts />, '/hosts');
    await screen.findByText(/^9 hosts$/, { selector: '.pill' });
    await userEvent.click(screen.getByRole('checkbox', { name: /With problems only/ }));
    expect(await screen.findByText('No host matches.')).toBeInTheDocument();
    expect(screen.getByText(/^0 hosts$/, { selector: '.pill' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says so for a search that finds nothing, and brings the table back when the search is cleared', async () => {
    vi.spyOn(api, 'hostsOverview').mockResolvedValue(overview());
    open(<Hosts />, '/hosts');
    await screen.findByText(/^9 hosts$/, { selector: '.pill' });
    await userEvent.type(screen.getByRole('textbox', { name: /Search host/ }), 'no-such-host');
    expect(await screen.findByText('No host matches.')).toBeInTheDocument();
    await userEvent.clear(screen.getByRole('textbox', { name: /Search host/ }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByText('No host matches.')).toBeNull();
  });

  it('counts 0 and raises no failure for an estate with no hosts at all', async () => {
    vi.spyOn(api, 'hostsOverview').mockResolvedValue([]);
    open(<Hosts />, '/hosts');
    expect(await screen.findByText(/^0 hosts$/, { selector: '.pill' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
