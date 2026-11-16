import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import Sla from './Sla';
import type { SliGroup, SliHost, SliProfile, SliReport } from '../../types';

// The month view lists each device with its availability, and, as the Availability page did for a month, how many incidents it had and the longest one.

const group = (): SliGroup => ({ key: 'all', name: 'Estate', hosts: 3, withData: 2, sli: 99.2, downtime: 600, meeting: true, belowTarget: 0 });

const host = (over: Partial<SliHost>): SliHost => ({
  hostid: '1',
  name: 'sw-1',
  hostStatus: '0',
  site: { code: 1, name: 'Jakarta' },
  category: 'Cisco IOS by SNMP',
  deviceClass: 'switch',
  triggerids: [],
  sli: 99.5,
  downtime: 3600,
  window: 30 * 86_400,
  covered: 30 * 86_400,
  maintenance: 0,
  coverage: 1,
  incidents: 2,
  longest: 1800,
  dataStatus: 'ok',
  meeting: true,
  errorBudget: null,
  ...over,
});

const HOSTS: SliHost[] = [
  // One long outage against many short ones, so that the order by incidents is not the order by the longest.
  host({ hostid: '1', name: 'sw-1', sli: 99.9, downtime: 7200, incidents: 1, longest: 7200 }),
  host({ hostid: '2', name: 'sw-2', sli: 97.0, downtime: 90_000, incidents: 7, longest: 600 }),
  host({ hostid: '3', name: 'sw-3', sli: null, downtime: 0, incidents: 0, longest: 0, coverage: 0, dataStatus: 'nodata' }),
  host({ hostid: '4', name: 'sw-4', sli: 99.0, downtime: 20_000, incidents: 3, longest: 3600 }),
];

const report = (month: string, profile: SliProfile): SliReport =>
  ({
    source: 'derived',
    label: 'Derived',
    profile,
    month,
    from: 0,
    to: 1,
    end: 1,
    closed: true,
    timezone: 'Asia/Jakarta',
    target: 99,
    basis: { triggers: [], gapPolicy: 'excluded', noDataPolicy: 'excluded', maintenancePolicy: 'excluded' },
    overall: group(),
    categories: [],
    sites: [],
    classes: [],
    hosts: HOSTS,
    wanPaths: [],
    web: [],
    gaps: [],
    noDataWindows: [],
    stats: { zabbixCalls: 0, triggers: 0, events: 0, trendRows: 0, ms: 0 },
    generatedAt: 0,
  }) as SliReport;

const open = (search = '') => {
  window.history.replaceState(null, '', `/sla${search}`);
  return render(
    <BrowserRouter>
      <Sla />
    </BrowserRouter>,
  );
};

/** The panel of the device table. */
const panelEl = async () => (await screen.findByRole('heading', { name: 'By device' })).closest('.panel') as HTMLElement;
const names = (el: HTMLElement) => within(el).getAllByRole('row').slice(1).map((r: HTMLElement) => within(r).getAllByRole('cell')[0].textContent);

beforeEach(() => {
  window.history.replaceState(null, '', '/sla');
  vi.spyOn(api, 'health').mockResolvedValue({ ok: true, ts: 0, ai: false, writeBack: false });
  vi.spyOn(api, 'slaSource').mockResolvedValue({ real: false, slas: 0, services: 0 });
  vi.spyOn(api, 'aging').mockResolvedValue({ buckets: [], unacknowledged: 0, total: 0, oldest: [] });
  vi.spyOn(api, 'sli').mockImplementation(async (month, profile) => report(month ?? '', profile ?? 'availability'));
});
afterEach(() => vi.restoreAllMocks());

describe('the device table of a month', () => {
  it('has the Incidents and Longest columns after Downtime, as the old Availability page had for a month', async () => {
    open();
    const el = await panelEl();
    const p = within(el);
    expect(p.getAllByRole('columnheader').map((h) => h.textContent?.replace(/[ ▲▼]/g, ''))).toEqual([
      'Device',
      'Site',
      'Category',
      'Availability',
      'Downtime',
      'Incidents',
      'Longest',
      'Coverage',
    ]);
  });

  it('prints the count and the longest outage of a measured device, and the placeholder for one with no data', async () => {
    open();
    const el = await panelEl();
    const p = within(el);
    const row = (name: string) => p.getByText(name).closest('tr') as HTMLElement;
    const cells = (name: string) => within(row(name)).getAllByRole('cell');
    expect(cells('sw-2')[5]).toHaveTextContent('7');
    expect(cells('sw-2')[6]).toHaveTextContent('10m');
    expect(cells('sw-1')[6]).toHaveTextContent('2h');
    expect(cells('sw-3')[5]).toHaveTextContent('No data');
    expect(cells('sw-3')[6]).toHaveTextContent('No data');
  });

  it('sorts by incidents, then back the other way, writes it to the address, and keeps the device with no data last either way', async () => {
    const user = userEvent.setup();
    open();
    const el = await panelEl();
    const p = within(el);
    await user.click(p.getByRole('button', { name: /^Incidents/ }));
    expect(new URLSearchParams(window.location.search).get('sort')).toBe('incidents');
    expect(names(el)).toEqual(['sw-1', 'sw-4', 'sw-2', 'sw-3']);
    await user.click(p.getByRole('button', { name: /^Incidents/ }));
    expect(new URLSearchParams(window.location.search).get('sort')).toBe('-incidents');
    expect(names(el)).toEqual(['sw-2', 'sw-4', 'sw-1', 'sw-3']);
  });

  it('sorts by the longest outage', async () => {
    const user = userEvent.setup();
    open();
    const el = await panelEl();
    const p = within(el);
    await user.click(p.getByRole('button', { name: /^Longest/ }));
    expect(new URLSearchParams(window.location.search).get('sort')).toBe('longest');
    expect(names(el)).toEqual(['sw-2', 'sw-4', 'sw-1', 'sw-3']);
    await user.click(p.getByRole('button', { name: /^Longest/ }));
    expect(names(el)).toEqual(['sw-1', 'sw-4', 'sw-2', 'sw-3']);
  });
});
