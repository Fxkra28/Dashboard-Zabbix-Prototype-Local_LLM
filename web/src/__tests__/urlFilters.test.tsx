import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { api } from '../api';
import { recentMonths } from '../shared/lib/time';
import Hosts from '../features/hosts/Hosts';
import Inventory from '../features/reports/Inventory';
import AlertNoise from '../features/reports/AlertNoise';
import Services from '../features/sla/Services';
import Sites from '../features/network/Sites';
import TopTriggers from '../features/reports/TopTriggers';
import { lastClosedMonth } from '../features/sla/Sli';
import type {
  DerivedServicesResponse,
  HostOverview,
  NoiseReport,
  NoisyTrigger,
  ScorecardResponse,
  SitesResponse,
  TopTriggersReport,
} from '../types';

/**
 * The filters of these pages live in the address, so Back and a shared link keep them.
 * Each page is opened at an address, and the address is read back after a change.
 */

const query = () => new URLSearchParams(window.location.search);

function open(ui: React.ReactElement, url: string) {
  window.history.replaceState(null, '', url);
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
});
afterEach(() => vi.restoreAllMocks());

const none = { total: 0, bySeverity: {} };
const hosts: HostOverview[] = [
  { hostid: '1', name: 'core-1', status: '0', problems: { total: 2, bySeverity: { '4': 2 } } },
  { hostid: '2', name: 'core-2', status: '0', problems: none },
  { hostid: '3', name: 'edge-3', status: '0', problems: { total: 1, bySeverity: { '2': 1 } } },
];

describe('Hosts', () => {
  beforeEach(() => void vi.spyOn(api, 'hostsOverview').mockResolvedValue(hosts));
  const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);

  it('opens with the search and the problems filter the address names', async () => {
    open(<Hosts />, '/hosts?q=core&problems=1');
    await screen.findByText('core-1');
    expect(screen.getByLabelText('Search host')).toHaveValue('core');
    expect(screen.getByLabelText('With problems only')).toBeChecked();
    expect(names()).toEqual(['core-1']);
    expect(screen.getByText('1 host')).toBeInTheDocument();
  });

  it('opens unfiltered when the address says nothing', async () => {
    open(<Hosts />, '/hosts');
    await screen.findByText('core-1');
    expect(screen.getByLabelText('Search host')).toHaveValue('');
    expect(screen.getByLabelText('With problems only')).not.toBeChecked();
    expect(names()).toEqual(['core-1', 'core-2', 'edge-3']);
  });

  it('writes the checkbox to the address, and takes it out again when cleared', async () => {
    const user = userEvent.setup();
    open(<Hosts />, '/hosts');
    await screen.findByText('core-1');
    await user.click(screen.getByLabelText('With problems only'));
    expect(query().get('problems')).toBe('1');
    expect(names()).toEqual(['core-1', 'edge-3']);
    await user.click(screen.getByLabelText('With problems only'));
    expect(query().has('problems')).toBe(false);
  });

  it('writes the search once typing pauses, and shows it at once', async () => {
    const user = userEvent.setup();
    open(<Hosts />, '/hosts');
    await screen.findByText('core-1');
    await user.type(screen.getByLabelText('Search host'), 'edge');
    expect(screen.getByLabelText('Search host')).toHaveValue('edge');
    await waitFor(() => expect(query().get('q')).toBe('edge'));
    expect(names()).toEqual(['edge-3']);
    await user.clear(screen.getByLabelText('Search host'));
    await waitFor(() => expect(query().has('q')).toBe(false));
  });

  it('replaces the history entry, so a filter changed twice still leaves one Back step', async () => {
    const user = userEvent.setup();
    open(<Hosts />, '/hosts');
    await screen.findByText('core-1');
    const before = window.history.length;
    await user.click(screen.getByLabelText('With problems only'));
    await user.click(screen.getByLabelText('With problems only'));
    await user.click(screen.getByLabelText('With problems only'));
    expect(window.history.length).toBe(before);
  });
});

describe('Back from another page', () => {
  it('returns to the Hosts page with its filters, and Forward leaves them where they were', async () => {
    vi.spyOn(api, 'hostsOverview').mockResolvedValue(hosts);
    const user = userEvent.setup();
    open(
      <Routes>
        <Route path="/hosts" element={<Hosts />} />
        <Route path="/graphs" element={<p>The graph page</p>} />
      </Routes>,
      '/hosts?q=core&problems=1',
    );
    await screen.findByText('core-1');
    await user.click(screen.getByRole('link', { name: 'Graphs' }));
    expect(await screen.findByText('The graph page')).toBeInTheDocument();

    // The page was left, so Back builds it again: the filters have to come from the address.
    window.history.back();
    await screen.findByText('core-1');
    expect(screen.getByLabelText('Search host')).toHaveValue('core');
    expect(screen.getByLabelText('With problems only')).toBeChecked();
    expect(screen.getByText('1 host')).toBeInTheDocument();

    window.history.forward();
    expect(await screen.findByText('The graph page')).toBeInTheDocument();
  });
});

describe('Sites', () => {
  // The filters of this page were already in the address; the shared host table must not have moved them.
  it('still opens the site the address names, with its hosts in the shared table', async () => {
    const site = (name: string) => ({
      name,
      total: 2,
      available: 2,
      unavailable: 0,
      unknown: 0,
      maintenance: 0,
      disabled: 0,
      problems: 0,
      unacknowledged: 0,
      bySeverity: {},
      worst: -1,
      hosts: hosts.slice(0, 2).map((h) => ({ ...h, availability: 'available' as const, siteSource: 'tag' as const })),
    });
    const res = { sites: [site('Jakarta'), site('Surabaya')], coverage: { hosts: 4, tag: 4, inventory: 0, group: 0 } } as SitesResponse;
    vi.spyOn(api, 'sites').mockResolvedValue(res);
    open(<Sites />, '/sites?site=Surabaya');
    expect(await screen.findByText('Surabaya: hosts')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Site from' })).toBeInTheDocument();
    expect(screen.getAllByText('site tag')).toHaveLength(2);
  });
});

describe('Top triggers', () => {
  const report = (days: number): TopTriggersReport => ({ triggers: [], truncated: false, days });
  beforeEach(() => void vi.spyOn(api, 'topTriggers').mockImplementation(async (days) => report(days)));

  it('asks for a week when the address names no range', async () => {
    open(<TopTriggers />, '/reports/top-triggers');
    await waitFor(() => expect(api.topTriggers).toHaveBeenCalledWith(7));
    expect(screen.getByLabelText('Time range')).toHaveValue('7');
  });

  it('asks for the range the address names', async () => {
    open(<TopTriggers />, '/reports/top-triggers?days=30');
    await waitFor(() => expect(api.topTriggers).toHaveBeenCalledWith(30));
    expect(api.topTriggers).not.toHaveBeenCalledWith(7);
    expect(screen.getByLabelText('Time range')).toHaveValue('30');
  });

  it('reads a range it does not offer as a week', async () => {
    open(<TopTriggers />, '/reports/top-triggers?days=5');
    await waitFor(() => expect(api.topTriggers).toHaveBeenCalledWith(7));
    expect(screen.getByLabelText('Time range')).toHaveValue('7');
  });

  it('writes a chosen range to the address and leaves the default out', async () => {
    const user = userEvent.setup();
    open(<TopTriggers />, '/reports/top-triggers');
    await user.selectOptions(screen.getByLabelText('Time range'), '90');
    expect(query().get('days')).toBe('90');
    await waitFor(() => expect(api.topTriggers).toHaveBeenCalledWith(90));
    await user.selectOptions(screen.getByLabelText('Time range'), '7');
    expect(query().has('days')).toBe(false);
  });
});

describe('Alert noise', () => {
  const trigger = (name: string, flags: NoisyTrigger['flags']): NoisyTrigger => ({
    objectid: name,
    name,
    host: 'sw-1',
    hostid: '1',
    severity: '3',
    count: 12,
    medianDuration: 4,
    shortLived: 10,
    ackRate: 0,
    totalDuration: 50,
    longest: 9,
    stillOpen: false,
    flags,
  });
  const report = (): NoiseReport => ({
    from: 0,
    to: 1,
    windowSeconds: 604800,
    minSeverity: 0,
    truncated: false,
    totalEvents: 30,
    distinctTriggers: 3,
    concentration: { topN: 1, percentOfEvents: 50 },
    counts: { flapping: 1, unactioned: 0, chronic: 1 },
    thresholds: { shortSeconds: 60, minCount: 5 },
    total: 3,
    triggers: [trigger('Flappy', ['flapping']), trigger('Stuck', ['chronic']), trigger('Quiet', [])],
  });
  beforeEach(() => void vi.spyOn(api, 'noise').mockImplementation(async () => report()));

  it('asks for the defaults when the address names nothing', async () => {
    open(<AlertNoise />, '/reports/noise');
    await screen.findByText('Quiet');
    expect(api.noise).toHaveBeenCalledWith(7, 0, 100);
    expect(screen.getByLabelText('Show')).toHaveValue('all');
  });

  it('opens with all four filters the address names', async () => {
    open(<AlertNoise />, '/reports/noise?days=30&severity=3&show=flagged&top=250');
    await screen.findByText('Flappy');
    expect(api.noise).toHaveBeenCalledWith(30, 3, 250);
    expect(screen.getByLabelText('Period')).toHaveValue('30');
    expect(screen.getByLabelText('Counts problems of at least')).toHaveValue('3');
    expect(screen.getByLabelText('Show')).toHaveValue('flagged');
    expect(screen.getByLabelText('Rows')).toHaveValue('250');
    expect(screen.queryByText('Quiet')).toBeNull();
    expect(screen.getByText('Stuck')).toBeInTheDocument();
  });

  it('reads a value it does not offer as the default, filter by filter', async () => {
    open(<AlertNoise />, '/reports/noise?days=3&severity=9&show=bogus&top=7');
    await screen.findByText('Quiet');
    expect(api.noise).toHaveBeenCalledWith(7, 0, 100);
    expect(screen.getByLabelText('Show')).toHaveValue('all');
  });

  it('writes each change to the address, and leaves a default out', async () => {
    const user = userEvent.setup();
    open(<AlertNoise />, '/reports/noise');
    await screen.findByText('Quiet');
    await user.selectOptions(screen.getByLabelText('Period'), '90');
    await user.selectOptions(screen.getByLabelText('Counts problems of at least'), '4');
    await user.selectOptions(screen.getByLabelText('Show'), 'chronic');
    await user.selectOptions(screen.getByLabelText('Rows'), '500');
    expect(Object.fromEntries(query())).toEqual({ days: '90', severity: '4', show: 'chronic', top: '500' });
    await waitFor(() => expect(api.noise).toHaveBeenCalledWith(90, 4, 500));

    await user.selectOptions(screen.getByLabelText('Period'), '7');
    await user.selectOptions(screen.getByLabelText('Counts problems of at least'), '0');
    await user.selectOptions(screen.getByLabelText('Show'), 'all');
    await user.selectOptions(screen.getByLabelText('Rows'), '100');
    expect(window.location.search).toBe('');
  });
});

describe('Inventory', () => {
  const scorecard = (): ScorecardResponse => ({
    dimensions: [
      { key: 'naming', label: 'Naming', hint: '', present: 1, total: 3, pct: 33, scored: true },
      { key: 'owner', label: 'Owner', hint: '', present: 1, total: 3, pct: 33, scored: true },
      { key: 'criticality', label: 'Criticality', hint: '', present: 0, total: 0, pct: 0, scored: false },
    ],
    overall: { hosts: 3, complete: 0, pct: 0 },
    groups: [],
    gaps: [
      { hostid: '1', name: 'no-owner', site: 'JKT', groups: [], missing: ['owner'] },
      { hostid: '2', name: 'no-name', site: 'BDG', groups: [], missing: ['naming'] },
      { hostid: '3', name: 'no-both', site: 'SBY', groups: [], missing: ['owner', 'naming'] },
    ],
  });
  beforeEach(() => void vi.spyOn(api, 'inventory').mockResolvedValue(scorecard()));
  const listed = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);

  it('lists every gap when the address names no type', async () => {
    open(<Inventory />, '/reports/inventory');
    await screen.findByText('no-name');
    expect(screen.getByLabelText('Show gaps of type')).toHaveValue('all');
    expect(listed()).toEqual(['no-owner', 'no-name', 'no-both']);
  });

  it('opens on the gap type the address names', async () => {
    open(<Inventory />, '/reports/inventory?gap=owner');
    await screen.findByText('no-owner');
    expect(screen.getByLabelText('Show gaps of type')).toHaveValue('owner');
    expect(listed()).toEqual(['no-owner', 'no-both']);
  });

  it('reads a type it does not know, or one that is not scored, as all gaps', async () => {
    const { unmount } = open(<Inventory />, '/reports/inventory?gap=bogus');
    await screen.findByText('no-name');
    expect(listed()).toHaveLength(3);
    unmount();

    open(<Inventory />, '/reports/inventory?gap=criticality');
    await screen.findByText('no-name');
    expect(screen.getByLabelText('Show gaps of type')).toHaveValue('all');
    expect(listed()).toHaveLength(3);
  });

  it('writes a chosen type to the address, and takes it out for all gaps', async () => {
    const user = userEvent.setup();
    open(<Inventory />, '/reports/inventory');
    await screen.findByText('no-name');
    await user.selectOptions(screen.getByLabelText('Show gaps of type'), 'naming');
    expect(query().get('gap')).toBe('naming');
    expect(listed()).toEqual(['no-name', 'no-both']);
    await user.selectOptions(screen.getByLabelText('Show gaps of type'), 'all');
    expect(query().has('gap')).toBe(false);
  });
});

describe('Services, the tree derived from the estate', () => {
  const derived = (month: string, profile: DerivedServicesResponse['profile']) =>
    ({ tree: [], total: 0, degraded: 0, worst: -1, source: 'derived', label: 'Derived', month, profile, target: 99, closed: true, gaps: [], noDataWindows: [] }) as DerivedServicesResponse;
  const months = recentMonths(12);

  beforeEach(() => {
    vi.spyOn(api, 'services').mockResolvedValue({ tree: [], total: 0, degraded: 0, worst: -1 });
    vi.spyOn(api, 'servicesDerived').mockImplementation(async (month, profile) => derived(month ?? '', profile ?? 'availability'));
  });

  it('asks for the last closed month and the strict method when the address names neither', async () => {
    open(<Services />, '/services');
    await waitFor(() => expect(api.servicesDerived).toHaveBeenCalledWith(lastClosedMonth(), 'availability'));
  });

  it('opens on the month and method the address names', async () => {
    open(<Services />, `/services?month=${months[3]}&method=hcml-report`);
    await waitFor(() => expect(api.servicesDerived).toHaveBeenCalledWith(months[3], 'hcml-report'));
    expect(api.servicesDerived).not.toHaveBeenCalledWith(lastClosedMonth(), 'availability');
    expect(screen.getByLabelText('Month')).toHaveValue(months[3]);
    expect(screen.getByRole('button', { name: 'HCML report method' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reads a month that is not offered, and a method it does not know, as the defaults', async () => {
    open(<Services />, '/services?month=2019-01&method=other');
    await waitFor(() => expect(api.servicesDerived).toHaveBeenCalledWith(lastClosedMonth(), 'availability'));
    expect(api.servicesDerived).toHaveBeenCalledTimes(1);
  });

  it('writes a changed month and method to the address, and leaves the defaults out', async () => {
    const user = userEvent.setup();
    open(<Services />, '/services');
    await waitFor(() => expect(api.servicesDerived).toHaveBeenCalled());
    await user.selectOptions(await screen.findByLabelText('Month'), months[5]);
    await user.click(screen.getByRole('button', { name: 'HCML report method' }));
    expect(Object.fromEntries(query())).toEqual({ month: months[5], method: 'hcml-report' });
    await waitFor(() => expect(api.servicesDerived).toHaveBeenCalledWith(months[5], 'hcml-report'));

    await user.selectOptions(screen.getByLabelText('Month'), lastClosedMonth());
    await user.click(screen.getByRole('button', { name: 'Strict' }));
    expect(window.location.search).toBe('');
  });
});
