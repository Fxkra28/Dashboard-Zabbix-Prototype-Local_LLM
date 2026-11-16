import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import Sla from './Sla';
import type { SliGroup, SliProfile, SliReport, SliWeb } from '../../types';

// The readings behind a closed month's web check figures age out, so the figures can change later (BK-60). The page says so.

const NOTE = 'The web check figures of a month that has closed can change later, as the readings behind them age out, and some can turn to No data.';
const kept = (date: string) => `The web check figures of this month are those taken on ${date}, and kept as they were. Readings that had aged out by then are not counted.`;

const group: SliGroup = { key: 'all', name: 'Estate', hosts: 1, withData: 1, sli: 99.5, downtime: 600, meeting: true, belowTarget: 0 };
const SITE: SliWeb = { itemid: '1', name: 'Public site', sli: 99.9, downtime: 60, coverage: 0.9, dataStatus: 'ok' };

const report = (month: string, profile: SliProfile, over: Partial<SliReport>): SliReport =>
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
    web: [SITE],
    gaps: [],
    noDataWindows: [],
    stats: { zabbixCalls: 0, triggers: 0, events: 0, trendRows: 0, ms: 0 },
    generatedAt: 0,
    ...over,
  }) as SliReport;

const open = async (over: Partial<SliReport>, search = '') => {
  vi.spyOn(api, 'sli').mockImplementation(async (month, profile) => report(month ?? '', profile ?? 'availability', over));
  window.history.replaceState(null, '', `/sla${search}`);
  render(
    <BrowserRouter>
      <Sla />
    </BrowserRouter>,
  );
  return (await screen.findByRole('heading', { name: 'Web checks' })).closest('.panel') as HTMLElement;
};

beforeEach(() => {
  vi.spyOn(api, 'health').mockResolvedValue({ ok: true, ts: 0, ai: false, writeBack: false });
  vi.spyOn(api, 'slaSource').mockResolvedValue({ real: false, slas: 0, services: 0 });
  vi.spyOn(api, 'aging').mockResolvedValue({ buckets: [], unacknowledged: 0, total: 0, oldest: [] });
});
afterEach(() => vi.restoreAllMocks());

describe('the Web checks panel of a month', () => {
  it('says old figures can change when the month has closed', async () => {
    const panel = await open({});
    expect(within(panel).getByText('Public site')).toBeInTheDocument();
    expect(within(panel).getByText(NOTE)).toBeInTheDocument();
  });

  it('says it when the month has no scenarios, since that can be what ageing out left', async () => {
    const panel = await open({ web: [] });
    expect(within(panel).getByText('No web scenarios measured in this period.')).toBeInTheDocument();
    expect(within(panel).getByText(NOTE)).toBeInTheDocument();
  });

  it('says nothing while the month is still running, when nothing has aged out', async () => {
    const panel = await open({ closed: false });
    expect(within(panel).queryByText(NOTE)).toBeNull();
  });

  it('says when the figures were taken, and that they are kept, once they are, instead of that they can change', async () => {
    // 2 November 2026, 08:15 in Jakarta
    const panel = await open({ webTakenAt: Date.parse('2026-11-02T01:15:00Z') / 1000 });
    expect(within(panel).getByText(kept('2 November 2026'))).toBeInTheDocument();
    expect(within(panel).queryByText(NOTE)).toBeNull();
  });

  it('writes that day in the portal\'s zone, not the browser\'s: 23:30 UTC on 31 October is 1 November in Jakarta', async () => {
    const panel = await open({ webTakenAt: Date.parse('2026-10-31T23:30:00Z') / 1000 });
    expect(within(panel).getByText(kept('1 November 2026'))).toBeInTheDocument();
  });

  it('writes it in the zone the report itself was made in', async () => {
    // 01:15 UTC on 2 November is still 1 November in Los Angeles
    const panel = await open({ timezone: 'America/Los_Angeles', webTakenAt: Date.parse('2026-11-02T01:15:00Z') / 1000 });
    expect(within(panel).getByText(kept('1 November 2026'))).toBeInTheDocument();
  });

  it('says it for a month with no scenarios as well, since what was kept is that there were none', async () => {
    const panel = await open({ web: [], webTakenAt: Date.parse('2026-11-02T01:15:00Z') / 1000 });
    expect(within(panel).getByText('No web scenarios measured in this period.')).toBeInTheDocument();
    expect(within(panel).getByText(kept('2 November 2026'))).toBeInTheDocument();
  });

  it('says nothing under the HCML method, which has no web checks to age', async () => {
    const panel = await open({ web: [] }, '?method=hcml-report');
    expect(within(panel).getByText('Web checks are not part of the HCML report method. Switch to Strict.')).toBeInTheDocument();
    expect(within(panel).queryByText(NOTE)).toBeNull();
  });
});
