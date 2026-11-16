import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { recentMonths } from '../../shared/lib/time';
import Sla from './Sla';
import type { AvailabilityQuery } from '../../api';
import type { AvailabilityReport, SliGroup, SliProfile, SliReport } from '../../types';

// The SLA page takes the last 7 and 30 days from the old Availability page. A window is for watching, so it has no report files.

// Who is signed in: an administrator would see Email report on a month, so a window must be shown to lack it.
const auth = vi.hoisted(() => ({ role: null as string | null }));
vi.mock('../../shared/hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('../../shared/hooks/useAuth')>('../../shared/hooks/useAuth');
  return { ...actual, useAuth: () => ({ me: null, role: auth.role, pages: null, loading: false }) };
});

// Whether Explain is on: the real hook keeps the first health answer for the whole file, so a test that needs AI on would never see it.
const ai = vi.hoisted(() => ({ on: false }));
vi.mock('../assistant/useAi', async () => {
  const actual = await vi.importActual<typeof import('../assistant/useAi')>('../assistant/useAi');
  return { ...actual, useAiEnabled: () => ai.on };
});

const group = (over: Partial<SliGroup> = {}): SliGroup => ({
  key: 'all',
  name: 'Estate',
  hosts: 3,
  withData: 3,
  sli: 99.5,
  downtime: 600,
  meeting: true,
  belowTarget: 0,
  ...over,
});

const sliReport = (month: string, profile: SliProfile): SliReport =>
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
    hosts: [],
    wanPaths: [],
    web: [],
    gaps: [],
    noDataWindows: [],
    stats: { zabbixCalls: 0, triggers: 0, events: 0, trendRows: 0, ms: 0 },
    generatedAt: 0,
  }) as SliReport;

const MADE_AT = Date.parse('2026-11-12T07:32:00Z') / 1000; // 14:32 in Jakarta

const windowReport = (over: Partial<AvailabilityReport> = {}): AvailabilityReport => ({
  from: 0,
  to: MADE_AT,
  windowSeconds: 7 * 86_400,
  minSeverity: 2,
  truncated: false,
  basis: 'availability',
  profile: 'availability',
  month: null,
  target: 99,
  overall: group({ sli: 98.996, meeting: false, belowTarget: 3 }),
  categories: [group({ key: 'net', name: 'Network', sli: 98.5, meeting: false, belowTarget: 2 })],
  sites: [group({ key: 'site:1', name: 'Jakarta', sli: 98, meeting: false })],
  hosts: [
    { hostid: '10', host: '1.1 SW-01', availability: 97.5, downtime: 3600, incidents: 2, longest: 1800, coverage: 0.99, category: 'Cisco IOS by SNMP', site: { code: 1, name: 'Jakarta' } },
    { hostid: '11', host: '1.2 SW-02', availability: null, downtime: 0, incidents: 0, longest: 0, coverage: 0, category: 'Cisco IOS by SNMP', site: null },
  ],
  gaps: [],
  ...over,
});

const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const inWords = (month: string) => `${NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
const [, lastMonth, monthBefore] = recentMonths(3);
const downloadGroup = (month: string) => `Download the SLA report for ${inWords(month)}, both methods`;

const open = (search = '') => {
  window.history.replaceState(null, '', `/sla${search}`);
  return render(
    <BrowserRouter>
      <Sla />
    </BrowserRouter>,
  );
};

/** The card with this label. */
const card = (label: string) => {
  const found = [...document.querySelectorAll('.kpi')].find((k) => k.querySelector('.label')?.textContent === label);
  if (!found) throw new Error(`no card labelled ${label}`);
  return found;
};

beforeEach(() => {
  auth.role = null;
  ai.on = false;
  window.history.replaceState(null, '', '/sla');
  vi.spyOn(api, 'health').mockResolvedValue({ ok: true, ts: 0, ai: false, writeBack: false });
  vi.spyOn(api, 'slaSource').mockResolvedValue({ real: false, slas: 0, services: 0 });
  vi.spyOn(api, 'aging').mockResolvedValue({ buckets: [], unacknowledged: 0, total: 0, oldest: [] });
  vi.spyOn(api, 'sli').mockImplementation(async (month, profile) => sliReport(month ?? '', profile ?? 'availability'));
  // The answer carries the window and the method it was asked for, as the server's does.
  vi.spyOn(api, 'availability').mockImplementation(async (query) => {
    const q = query as AvailabilityQuery;
    return windowReport({ profile: q.profile ?? 'availability', windowSeconds: (q.days ?? 7) * 86_400 });
  });
});
afterEach(() => vi.restoreAllMocks());

describe('the SLA period', () => {
  it('is one select called Period, with the last 7 and 30 days before the calendar months', async () => {
    open();
    const period = await screen.findByLabelText('Period');
    const groups = [...period.querySelectorAll('optgroup')];
    expect(groups.map((g) => g.label)).toEqual(['Rolling window, not a month', 'Calendar month (Asia/Jakarta)']);
    expect([...groups[0].querySelectorAll('option')].map((o) => [o.value, o.textContent])).toEqual([
      ['d7', 'Last 7 days'],
      ['d30', 'Last 30 days'],
    ]);
    expect(groups[1].querySelectorAll('option')).toHaveLength(12);
    expect(period).toHaveValue(lastMonth);
    // The label is no longer "Month": the list holds more than months.
    expect(screen.queryByLabelText('Month')).toBeNull();
  });

  it('keeps the last closed month as the default, so the page opens as it did before', async () => {
    open();
    await screen.findByText('Overall availability (strict)');
    expect(api.sli).toHaveBeenCalledWith(lastMonth, 'availability');
    expect(api.availability).not.toHaveBeenCalled();
  });

  it('falls back to the last closed month for a window it does not know', async () => {
    open('?month=d99');
    expect(await screen.findByLabelText('Period')).toHaveValue(lastMonth);
    await screen.findByText('Overall availability (strict)');
    expect(api.availability).not.toHaveBeenCalled();
  });
});

describe('a rolling window on the SLA page', () => {
  it('asks the availability report for the days, in the method shown, and never the monthly report', async () => {
    open('?month=d7');
    await screen.findByText('Overall · Strict');
    expect(api.availability).toHaveBeenCalledTimes(1);
    expect(api.availability).toHaveBeenCalledWith(expect.objectContaining({ days: 7, profile: 'availability', basis: 'availability' }));
    expect(api.sli).not.toHaveBeenCalled();
  });

  it('reads 30 days the same way', async () => {
    open('?month=d30');
    await screen.findByText('Overall · Strict');
    expect(api.availability).toHaveBeenCalledWith(expect.objectContaining({ days: 30 }));
  });

  it('prints the cards and the table of hosts of the window, a missed figure as it is and not as the target', async () => {
    open('?month=d7');
    await screen.findByText('Overall · Strict');
    expect(card('Overall · Strict').querySelector('.value')).toHaveTextContent('98.996%');
    expect(card('Network').querySelector('.value')).toHaveTextContent('98.50%');
    expect(card('Sites below target · Strict').querySelector('.value')).toHaveTextContent('1');

    const table = screen.getByRole('table');
    const link = within(table).getByRole('link', { name: '1.1 SW-01' });
    expect(link).toHaveAttribute('href', '/graphs?hostid=10');
    // A device with too little data says so and is not counted as perfect.
    expect(within(table).getByText('1.2 SW-02').closest('tr')).toHaveTextContent('No data');
  });

  it('says what a window cannot do', async () => {
    open('?month=d7');
    await screen.findByText('Overall · Strict');
    expect(screen.getByText(/The report files, email, schedule and Explain need a calendar month/)).toBeInTheDocument();
  });

  it('offers no report files, no email, no number style and no Explain, though a month offers all four to this administrator with AI on', async () => {
    auth.role = 'admin';
    ai.on = true;
    const info = vi.spyOn(api, 'sliEmailInfo').mockResolvedValue({ enabled: true, from: 'portal@example.org', recipients: [], max: 10, allowedDomains: [], kept: true });
    // The month first: what the window lacks must be its own doing, so the same page has to show each of them for a month.
    const month = open();
    expect(await screen.findByRole('button', { name: 'Explain overall' })).toBeInTheDocument();
    expect(await screen.findByRole('group', { name: /Email the SLA report/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Download the SLA report/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Number and date style' })).toBeInTheDocument();
    month.unmount();
    info.mockClear();

    open('?month=d30');
    await screen.findByText('Overall · Strict');
    expect(screen.queryByRole('group', { name: /Download the SLA report/ })).toBeNull();
    expect(screen.queryByRole('group', { name: /Email the SLA report/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Number and date style' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Explain/ })).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });

  it('asks again in the other method when it is switched, and still never for a month', async () => {
    const user = userEvent.setup();
    open('?month=d7');
    await screen.findByText('Overall · Strict');
    await user.click(screen.getByRole('button', { name: 'HCML report method' }));
    await waitFor(() => expect(api.availability).toHaveBeenCalledTimes(2));
    expect(api.availability).toHaveBeenLastCalledWith(expect.objectContaining({ days: 7, profile: 'hcml-report' }));
    expect(api.sli).not.toHaveBeenCalled();
  });

  it('keeps the window in the address, and the default month too, so that a shared link names it (FR-53)', async () => {
    const user = userEvent.setup();
    open();
    const period = await screen.findByLabelText('Period');
    await user.selectOptions(period, 'd30');
    expect(window.location.search).toBe('?month=d30');
    await screen.findByText('Overall · Strict');

    await user.selectOptions(screen.getByLabelText('Period'), lastMonth);
    expect(window.location.search).toBe(`?month=${lastMonth}`);
  });

  it('brings the monthly report and its files back when a month is picked again', async () => {
    const user = userEvent.setup();
    open('?month=d7');
    await screen.findByText('Overall · Strict');
    await user.selectOptions(screen.getByLabelText('Period'), monthBefore);
    expect(await screen.findByRole('group', { name: downloadGroup(monthBefore) })).toBeInTheDocument();
    expect(api.sli).toHaveBeenCalledWith(monthBefore, 'availability');
  });

  it('says why the window could not be read', async () => {
    vi.spyOn(api, 'availability').mockRejectedValue(new Error('Zabbix rejected the API token.'));
    open('?month=d7');
    expect(await screen.findByText(/Zabbix rejected the API token/)).toBeInTheDocument();
    expect(screen.queryByText('Overall · Strict')).toBeNull();
  });

  it('names the window in the banner and the time the figures are to, and does not claim a month or "now"', async () => {
    open('?month=d7');
    await screen.findByText('Overall · Strict');
    expect(screen.getByText(/over the last 7 days, up to 14:32 WIB/)).toBeInTheDocument();
    expect(screen.queryByText(/ending now/)).toBeNull();
    expect(screen.queryByText(/monthly in Asia\/Jakarta time/)).toBeNull();
  });

  it('says only the window while the answer is on its way, since there is no time to name yet', async () => {
    vi.spyOn(api, 'availability').mockImplementation(() => new Promise<never>(() => undefined));
    open('?month=d30');
    expect(await screen.findByText('Replaying event history…')).toBeInTheDocument();
    expect(screen.getByText(/over the last 30 days; nothing is written to Zabbix/)).toBeInTheDocument();
  });

  it('does not leave the figures of the window before under the heading of the new one', async () => {
    const user = userEvent.setup();
    let release: (r: AvailabilityReport) => void = () => undefined;
    vi.spyOn(api, 'availability').mockImplementation((query) => {
      const q = query as AvailabilityQuery;
      if (q.days === 30) return new Promise<AvailabilityReport>((r) => (release = r));
      return Promise.resolve(windowReport({ profile: q.profile ?? 'availability', windowSeconds: 7 * 86_400 }));
    });
    open('?month=d7');
    await screen.findByText('Overall · Strict');

    await user.selectOptions(screen.getByLabelText('Period'), 'd30');
    expect(await screen.findByText('Replaying event history…')).toBeInTheDocument();
    expect(screen.queryByText('Overall · Strict')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/over the last 30 days/)).toBeInTheDocument();

    act(() => release(windowReport({ windowSeconds: 30 * 86_400 })));
    expect(await screen.findByText('Overall · Strict')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('does not leave the strict figures under the HCML method while the other method is read, either', async () => {
    const user = userEvent.setup();
    let release: (r: AvailabilityReport) => void = () => undefined;
    vi.spyOn(api, 'availability').mockImplementation((query) => {
      const q = query as AvailabilityQuery;
      if (q.profile === 'hcml-report') return new Promise<AvailabilityReport>((r) => (release = r));
      return Promise.resolve(windowReport({ profile: 'availability' }));
    });
    open('?month=d7');
    await screen.findByText('Overall · Strict');

    await user.click(screen.getByRole('button', { name: 'HCML report method' }));
    expect(await screen.findByText('Replaying event history…')).toBeInTheDocument();
    expect(screen.queryByText('Overall · Strict')).toBeNull();

    act(() => release(windowReport({ profile: 'hcml-report' })));
    expect(await screen.findByText(/^Overall · HCML report/)).toBeInTheDocument();
  });

  it('says why the other method could not be read, and shows no figures of the first one with it', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'availability').mockImplementation(async (query) => {
      const q = query as AvailabilityQuery;
      if (q.profile === 'hcml-report') throw new Error('Zabbix did not answer.');
      return windowReport();
    });
    open('?month=d7');
    await screen.findByText('Overall · Strict');
    await user.click(screen.getByRole('button', { name: 'HCML report method' }));
    expect(await screen.findByText(/Zabbix did not answer/)).toBeInTheDocument();
    expect(screen.queryByText('Overall · Strict')).toBeNull();
  });

  it('describes the hosts table in the words of the method: no data is left out by the strict one and counted as up by the HCML one', async () => {
    const user = userEvent.setup();
    open('?month=d7');
    expect(await screen.findByText(/left out of every average/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'HCML report method' }));
    expect(await screen.findByText(/a device with no collected data counts as up/)).toBeInTheDocument();
    expect(screen.queryByText(/left out of every average/)).toBeNull();
  });
});

describe('keeping the place of someone who uses the keyboard', () => {
  it('puts focus back on the Period select when it crosses from a month to a window, which draws the select again', async () => {
    open();
    const month = await screen.findByLabelText('Period');
    month.focus();
    expect(month).toHaveFocus();
    fireEvent.change(month, { target: { value: 'd7' } });
    await screen.findByText('Overall · Strict');
    expect(screen.getByLabelText('Period')).toHaveFocus();
  });

  it('puts it back again from a window to a month', async () => {
    open('?month=d7');
    const windowSelect = await screen.findByLabelText('Period');
    windowSelect.focus();
    fireEvent.change(windowSelect, { target: { value: lastMonth } });
    await screen.findByText('Overall availability (strict)');
    expect(screen.getByLabelText('Period')).toHaveFocus();
  });

  it('does not take focus when someone was on another control and the period changes without them, as a script or the Back button would', async () => {
    open();
    const period = await screen.findByLabelText('Period');
    screen.getByRole('button', { name: 'Strict' }).focus();
    fireEvent.change(period, { target: { value: 'd30' } });
    await screen.findByText('Overall · Strict');
    expect(screen.getByLabelText('Period')).not.toHaveFocus();
  });

  it('does not take focus when the address changes under the page, as Back does', async () => {
    open();
    await screen.findByText('Overall availability (strict)');
    const strictBtn = screen.getByRole('button', { name: 'Strict' });
    strictBtn.focus();
    act(() => {
      window.history.pushState(null, '', '/sla?month=d7');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await screen.findByText('Overall · Strict');
    expect(screen.getByLabelText('Period')).not.toHaveFocus();
  });
});
