import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import type { ScorecardResponse } from '../../types';

// HCML's Zabbix carries no owner or criticality tags yet, so those two gaps are every host and say nothing.
// The page says so, and opens its gap list on the gaps that can be closed now: naming and site.

const downloadCsv = vi.hoisted(() => vi.fn());
vi.mock('../../shared/lib/csv', () => ({ downloadCsv }));
const { default: Inventory } = await import('./Inventory');

type Dim = ScorecardResponse['dimensions'][number];
const dim = (key: Dim['key'], label: string, present: number, scored = true): Dim => ({ key, label, hint: `hint of ${label}`, present, total: 5, pct: present * 20, scored });

/** Five hosts: A has no name, no site; B has no site; C, D and E have a name and a site. Nobody has an owner or a criticality. */
const empty = (): ScorecardResponse => ({
  dimensions: [dim('naming', 'Naming', 4), dim('site', 'Site', 3), dim('owner', 'Owner', 0), dim('criticality', 'Criticality', 0)],
  overall: { hosts: 5, complete: 0, pct: 0 },
  groups: [],
  gaps: [
    { hostid: '1', name: 'host-a', site: 'JKT', groups: [], missing: ['naming', 'site', 'owner', 'criticality'] },
    { hostid: '2', name: 'host-b', site: 'BDG', groups: [], missing: ['site', 'owner', 'criticality'] },
    { hostid: '3', name: 'host-c', site: 'SBY', groups: [], missing: ['owner', 'criticality'] },
    { hostid: '4', name: 'host-d', site: 'SBY', groups: [], missing: ['owner', 'criticality'] },
    { hostid: '5', name: 'host-e', site: 'SBY', groups: [], missing: ['owner', 'criticality'] },
  ],
});

const open = (search = '') => {
  window.history.replaceState(null, '', `/reports/inventory${search}`);
  return render(
    <BrowserRouter>
      <Inventory />
    </BrowserRouter>,
  );
};
const listed = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);
const query = () => new URLSearchParams(window.location.search);

beforeEach(() => {
  downloadCsv.mockClear();
  vi.spyOn(api, 'inventory').mockResolvedValue(empty());
});
afterEach(() => vi.restoreAllMocks());

describe('the Inventory scorecard while owner and criticality are empty', () => {
  it('says that nothing is recorded yet for them, and why the percentage cannot rise', async () => {
    open();
    expect(await screen.findByText(/Nothing is recorded yet for Owner and criticality/)).toBeInTheDocument();
    expect(screen.getByText(/cannot rise until someone adds them/)).toBeInTheDocument();
  });

  it('opens the gap list on the naming and site gaps, and says why', async () => {
    open();
    await screen.findByText('host-a');
    expect(screen.getByLabelText('Show gaps of type')).toHaveValue('basic');
    expect(listed()).toEqual(['host-a', 'host-b']);
    expect(screen.getByText('Gap list: 2 hosts')).toBeInTheDocument();
    expect(screen.getByText(/Opened on naming and site gaps/)).toBeInTheDocument();
  });

  it('lists every host again when all gaps is chosen, and writes that choice to the address', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('host-a');
    await user.selectOptions(screen.getByLabelText('Show gaps of type'), 'all');
    expect(query().get('gap')).toBe('all');
    expect(listed()).toEqual(['host-a', 'host-b', 'host-c', 'host-d', 'host-e']);
    expect(screen.queryByText(/Opened on naming and site gaps/)).toBeNull();

    // Choosing the default again takes it out of the address.
    await user.selectOptions(screen.getByLabelText('Show gaps of type'), 'basic');
    expect(query().has('gap')).toBe(false);
    expect(listed()).toEqual(['host-a', 'host-b']);
  });

  it('still opens on any gap type the address names', async () => {
    open('?gap=owner');
    await screen.findByText('host-e');
    expect(screen.getByLabelText('Show gaps of type')).toHaveValue('owner');
    expect(listed()).toHaveLength(5);
  });

  it('names the file after what is listed, so the short list is not taken for the whole', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('host-a');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    const [name, rows] = downloadCsv.mock.calls[0] as [string, unknown[][]];
    expect(name).toMatch(/^hcml-inventory-gaps-naming-site-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(rows.slice(1).map((r) => r[0])).toEqual(['host-a', 'host-b']);
  });
});

describe('the Inventory scorecard once owners or criticality are recorded', () => {
  it('says nothing about empty tags, and opens on all gaps as before', async () => {
    const data = empty();
    data.dimensions = [dim('naming', 'Naming', 4), dim('site', 'Site', 3), dim('owner', 'Owner', 2), dim('criticality', 'Criticality', 1)];
    vi.spyOn(api, 'inventory').mockResolvedValue(data);
    open();
    await screen.findByText('host-a');
    expect(screen.queryByText(/Nothing is recorded yet/)).toBeNull();
    expect(screen.getByLabelText('Show gaps of type')).toHaveValue('all');
    expect(listed()).toHaveLength(5);
    expect(screen.queryByText(/Opened on naming and site gaps/)).toBeNull();
  });

  it('names only the attribute that is still empty, and keeps all gaps as the opening list', async () => {
    const data = empty();
    data.dimensions = [dim('naming', 'Naming', 4), dim('site', 'Site', 3), dim('owner', 'Owner', 2), dim('criticality', 'Criticality', 0)];
    vi.spyOn(api, 'inventory').mockResolvedValue(data);
    open();
    expect(await screen.findByText(/Nothing is recorded yet for Criticality:/)).toBeInTheDocument();
    expect(screen.getByLabelText('Show gaps of type')).toHaveValue('all');
    expect(listed()).toHaveLength(5);
  });

  it('writes nothing to the address when all gaps is chosen and is the opening list', async () => {
    const data = empty();
    data.dimensions = [dim('naming', 'Naming', 4), dim('site', 'Site', 3), dim('owner', 'Owner', 2), dim('criticality', 'Criticality', 1)];
    vi.spyOn(api, 'inventory').mockResolvedValue(data);
    const user = userEvent.setup();
    open();
    await screen.findByText('host-a');
    await user.selectOptions(screen.getByLabelText('Show gaps of type'), 'naming');
    expect(query().get('gap')).toBe('naming');
    await user.selectOptions(screen.getByLabelText('Show gaps of type'), 'all');
    expect(query().has('gap')).toBe(false);
  });
});

describe('the Inventory scorecard at the edges of its default', () => {
  it('opens on all gaps when no host lacks a name or a site, so that the list does not say "Nothing missing." over an estate with no owners', async () => {
    const data = empty();
    data.dimensions = [dim('naming', 'Naming', 5), dim('site', 'Site', 5), dim('owner', 'Owner', 0), dim('criticality', 'Criticality', 0)];
    data.gaps = data.gaps.map((g) => ({ ...g, missing: ['owner', 'criticality'] as typeof g.missing }));
    vi.spyOn(api, 'inventory').mockResolvedValue(data);
    open();
    await screen.findByText('host-a');
    expect(screen.getByLabelText('Show gaps of type')).toHaveValue('all');
    expect(listed()).toHaveLength(5);
    expect(screen.queryByText('Nothing missing.')).toBeNull();
    expect(screen.queryByText(/Opened on naming and site gaps/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled();
  });

  it('reads a gap type the address names but that is not scored as the list the page opens on, not as all gaps', async () => {
    const data = empty();
    data.dimensions = [dim('naming', 'Naming', 4), dim('site', 'Site', 3), dim('owner', 'Owner', 0), dim('criticality', 'Criticality', 0, false)];
    vi.spyOn(api, 'inventory').mockResolvedValue(data);
    open('?gap=criticality');
    await screen.findByText('host-a');
    expect(screen.getByLabelText('Show gaps of type')).toHaveValue('basic');
    expect(listed()).toEqual(['host-a', 'host-b']);
  });

  it('counts only the owner and criticality that are scored when it decides that nothing is recorded', async () => {
    const data = empty();
    data.dimensions = [dim('naming', 'Naming', 4), dim('site', 'Site', 3), dim('owner', 'Owner', 0), dim('criticality', 'Criticality', 0, false)];
    vi.spyOn(api, 'inventory').mockResolvedValue(data);
    open();
    expect(await screen.findByText(/Nothing is recorded yet for Owner:/)).toBeInTheDocument();
    expect(screen.getByLabelText('Show gaps of type')).toHaveValue('basic');
  });

  it('lists the naming and site gaps for ?gap=basic once owners and criticality are recorded too', async () => {
    const data = empty();
    data.dimensions = [dim('naming', 'Naming', 4), dim('site', 'Site', 3), dim('owner', 'Owner', 2), dim('criticality', 'Criticality', 1)];
    vi.spyOn(api, 'inventory').mockResolvedValue(data);
    open('?gap=basic');
    await screen.findByText('host-a');
    expect(screen.getByLabelText('Show gaps of type')).toHaveValue('basic');
    expect(listed()).toEqual(['host-a', 'host-b']);
  });

  it('lists the hosts that miss a site for ?gap=site and a criticality for ?gap=criticality', async () => {
    open('?gap=site');
    await screen.findByText('host-a');
    expect(listed()).toEqual(['host-a', 'host-b']);
    document.body.innerHTML = '';
    open('?gap=criticality');
    await screen.findByText('host-e');
    expect(listed()).toHaveLength(5);
  });
});
