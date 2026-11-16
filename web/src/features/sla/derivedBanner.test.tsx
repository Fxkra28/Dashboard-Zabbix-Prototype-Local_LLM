import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import Sla from './Sla';
import type { AvailabilityReport, SlaSource, SliGroup, SliProfile, SliReport } from '../../types';

// The banner over the derived views says what the figures are. It must not say what Zabbix lacks: Zabbix may have SLAs of its own.

const BANNER = 'Derived from ICMP availability triggers, not from Zabbix’s own SLAs.';

const group: SliGroup = { key: 'all', name: 'Estate', hosts: 1, withData: 1, sli: 99.5, downtime: 600, meeting: true, belowTarget: 0 };

const monthReport = (month: string, profile: SliProfile): SliReport =>
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
    overall: group,
    categories: [],
    sites: [],
    classes: [],
    hosts: [],
    wanPaths: [],
    web: [],
    gaps: [],
    noDataWindows: [],
    stats: { zabbixCalls: 0, triggers: 0, events: 0, trendRows: 0, ms: 0 },
    generatedAt: 0,
  }) as SliReport;

const windowReport = (): AvailabilityReport => ({
  from: 0,
  to: Date.parse('2026-11-12T07:32:00Z') / 1000,
  windowSeconds: 7 * 86_400,
  minSeverity: 2,
  truncated: false,
  basis: 'availability',
  profile: 'availability',
  month: null,
  target: 99,
  overall: group,
  categories: [],
  sites: [],
  hosts: [],
  gaps: [],
});

const open = (source: SlaSource, search: string) => {
  vi.spyOn(api, 'slaSource').mockResolvedValue(source);
  window.history.replaceState(null, '', `/sla${search}`);
  render(
    <BrowserRouter>
      <Sla />
    </BrowserRouter>,
  );
};

/** The banner over the derived views. It draws before any figure arrives, so a test waits for what it depends on first. */
const banner = async () => {
  await waitFor(() => expect(document.querySelector('.sli-banner')).not.toBeNull());
  return document.querySelector('.sli-banner') as HTMLElement;
};

beforeEach(() => {
  vi.spyOn(api, 'health').mockResolvedValue({ ok: true, ts: 0, ai: false, writeBack: false });
  vi.spyOn(api, 'aging').mockResolvedValue({ buckets: [], unacknowledged: 0, total: 0, oldest: [] });
  vi.spyOn(api, 'sli').mockImplementation(async (month, profile) => monthReport(month ?? '', profile ?? 'availability'));
  vi.spyOn(api, 'availability').mockImplementation(async () => windowReport());
});
afterEach(() => vi.restoreAllMocks());

describe('the banner over the derived SLA views', () => {
  it('says the figures are derived and not Zabbix’s own, on a month when Zabbix has no services', async () => {
    open({ real: false, slas: 0, services: 0 }, '');
    await screen.findByText(/Zabbix has 0 SLAs with no services attached/);
    const el = await banner();
    expect(el.textContent).toContain(BANNER);
    expect(el.textContent).toContain('Computed in the portal from each device’s ICMP triggers, monthly in Asia/Jakarta time; nothing is written to Zabbix.');
    expect(el.textContent).not.toMatch(/no services/);
  });

  it('says the same when Zabbix has SLAs of its own, where "no services" would be false', async () => {
    open({ real: true, slas: 2, services: 5 }, '?tab=derived');
    await screen.findByRole('tab', { name: 'Zabbix SLAs' });
    const el = await banner();
    expect(el.textContent).toContain(BANNER);
    expect(el.textContent).not.toMatch(/no services/);
  });

  it('does not claim missing services when Zabbix has services that measure nothing', async () => {
    open({ real: false, slas: 1, services: 3 }, '');
    expect(await screen.findByText(/3 services but no measurements/)).toBeInTheDocument();
    const el = await banner();
    expect(el.textContent).toContain(BANNER);
    expect(el.textContent).not.toMatch(/no services/);
  });

  it('says the same over a rolling window when Zabbix has SLAs of its own', async () => {
    open({ real: true, slas: 2, services: 5 }, '?tab=derived&month=d7');
    await screen.findByRole('tab', { name: 'Zabbix SLAs' });
    const el = await banner();
    expect(el.textContent).toContain(BANNER);
    expect(el.textContent).toContain('over the last 7 days');
    expect(el.textContent).not.toMatch(/no services/);
  });
});
