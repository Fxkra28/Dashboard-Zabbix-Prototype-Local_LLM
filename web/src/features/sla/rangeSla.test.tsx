import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api, HttpFailure } from '../../api';
import { monthBounds } from '../../shared/lib/time';
import Sla from './Sla';
import { ALL_DAY, rangeWords } from './rangeWindow';
import type { SliGroup, SliProfile, SliReport } from '../../types';

// The range view of the SLA page (ADR-0018): any window of whole hours, and the hours of the day and days of the week that count.

const auth = vi.hoisted(() => ({ role: 'admin' as string | null }));
vi.mock('../../shared/hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('../../shared/hooks/useAuth')>('../../shared/hooks/useAuth');
  return { ...actual, useAuth: () => ({ me: null, role: auth.role, pages: null, loading: false }) };
});
const ai = vi.hoisted(() => ({ on: true }));
vi.mock('../assistant/useAi', async () => {
  const actual = await vi.importActual<typeof import('../assistant/useAi')>('../assistant/useAi');
  return { ...actual, useAiEnabled: () => ai.on };
});

const group = (over: Partial<SliGroup> = {}): SliGroup => ({ key: 'all', name: 'Estate', hosts: 3, withData: 3, sli: 99.5, downtime: 600, meeting: true, belowTarget: 0, ...over });

const report = (profile: SliProfile, from: number, to: number, over: Partial<SliReport> = {}): SliReport =>
  ({
    source: 'derived',
    label: 'Derived',
    profile,
    month: null,
    from,
    to,
    end: to,
    closed: true,
    timezone: 'Asia/Jakarta',
    target: 99,
    basis: { triggers: [], gapPolicy: 'excluded', noDataPolicy: 'excluded', maintenancePolicy: 'excluded' },
    overall: group(),
    categories: [group({ key: 'c', name: 'Switches' })],
    sites: [group({ key: 'site:1', name: 'Jakarta' })],
    classes: [],
    hosts: [],
    wanPaths: [],
    web: [],
    gaps: [],
    noDataWindows: [],
    stats: { zabbixCalls: 0, triggers: 0, events: 0, trendRows: 0, ms: 0 },
    generatedAt: 0,
    ...over,
  }) as SliReport;

const open = (search = '') => {
  window.history.replaceState(null, '', `/sla${search}`);
  return render(
    <BrowserRouter>
      <Sla />
    </BrowserRouter>,
  );
};

const lastCall = () => {
  const all = vi.mocked(api.sliWindow).mock.calls;
  return all[all.length - 1][0];
};
const calls = (profile: SliProfile) => vi.mocked(api.sliWindow).mock.calls.map(([q]) => q).filter((q) => q.profile === profile);

// Noon on 17 November 2026 in Jakarta: the last closed month is October, and yesterday was the 16th.
const OCT = monthBounds('2026-10', 'Asia/Jakarta');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T05:00:00Z'));
  auth.role = 'admin';
  ai.on = true;
  window.history.replaceState(null, '', '/sla');
  vi.spyOn(api, 'health').mockResolvedValue({ ok: true, ts: 0, ai: true, writeBack: false });
  vi.spyOn(api, 'slaSource').mockResolvedValue({ real: false, slas: 0, services: 0 });
  vi.spyOn(api, 'aging').mockResolvedValue({ buckets: [], unacknowledged: 0, total: 0, oldest: [] });
  vi.spyOn(api, 'sliEmailInfo').mockResolvedValue({ enabled: true, from: 'portal@example.org', recipients: [], max: 10, allowedDomains: [], kept: true });
  vi.spyOn(api, 'sli').mockRejectedValue(new Error('the monthly report is not what a range asks for'));
  vi.spyOn(api, 'sliWindow').mockImplementation(async (q) => {
    const hours = q.dayHours ? { start: Number(q.dayHours.split('-')[0]), end: Number(q.dayHours.split('-')[1]), weekdays: q.days ? q.days.split(',').map(Number) : null, seconds: 189 * 3600 } : q.days ? { start: 0, end: 24, weekdays: q.days.split(',').map(Number), seconds: 120 * 3600 } : undefined;
    return report(q.profile ?? 'availability', q.from, q.to, hours ? { dailyHours: hours } : {});
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('choosing the range', () => {
  it('is one choice of the Period select, after the months, and opens on the last closed month', async () => {
    open('?month=range');
    const period = await screen.findByLabelText('Period');
    expect(period).toHaveValue('range');
    expect([...period.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Rolling window, not a month', 'Calendar month (Asia/Jakarta)', 'Any range']);
    await screen.findByText('Overall availability (strict)');
    // Both methods, for the month before this one, counting every hour.
    expect(calls('availability')).toEqual([{ from: OCT.from, to: OCT.to, profile: 'availability' }]);
    expect(calls('hcml-report')).toEqual([{ from: OCT.from, to: OCT.to, profile: 'hcml-report' }]);
    expect(api.sli).not.toHaveBeenCalled();
  });

  it('asks for a day from midnight to midnight when Day is chosen, yesterday at first', async () => {
    open('?month=range');
    await screen.findByText('Overall availability (strict)');
    await userEvent.setup({ advanceTimers: () => undefined }).click(screen.getByRole('button', { name: 'Day' }));
    await waitFor(() => expect(lastCall().to - lastCall().from).toBe(86400));
    expect(screen.getByLabelText('Day (Asia/Jakarta)')).toHaveValue('2026-11-16');
    expect(new Date(lastCall().from * 1000).toISOString()).toBe('2026-11-15T17:00:00.000Z');
    fireEvent.change(screen.getByLabelText('Day (Asia/Jakarta)'), { target: { value: '2026-11-03' } });
    await waitFor(() => expect(new Date(lastCall().from * 1000).toISOString()).toBe('2026-11-02T17:00:00.000Z'));
  });

  it('asks for a calendar year when Year is chosen', async () => {
    open('?month=range&rmode=year');
    await screen.findByText('Overall availability (strict)');
    expect(screen.getByLabelText('Year')).toHaveValue('2026');
    expect(new Date(lastCall().from * 1000).toISOString()).toBe('2025-12-31T17:00:00.000Z');
    expect(new Date(lastCall().to * 1000).toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });

  it('asks for two hours of the report zone when Custom is chosen', async () => {
    open('?month=range&rmode=custom&rfrom=2026-11-03&rfh=8&rto=2026-11-05&rth=20');
    await screen.findByText('Overall availability (strict)');
    expect(new Date(lastCall().from * 1000).toISOString()).toBe('2026-11-03T01:00:00.000Z');
    expect(new Date(lastCall().to * 1000).toISOString()).toBe('2026-11-05T13:00:00.000Z');
  });

  it('keeps every choice in the address, so that a link brings back the same range', async () => {
    open('?month=range');
    await screen.findByText('Overall availability (strict)');
    await userEvent.setup({ advanceTimers: () => undefined }).click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText(/^From \(/), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('From hour'), { target: { value: '8' } });
    await waitFor(() => expect(window.location.search).toContain('rmode=custom'));
    expect(window.location.search).toContain('rfrom=2026-11-01');
    expect(window.location.search).toContain('rfh=8');
  });
});

describe('the hours of the day and the days of the week', () => {
  it('sends them only when they keep less than everything', async () => {
    open('?month=range');
    await screen.findByText('Overall availability (strict)');
    expect(lastCall()).not.toHaveProperty('dayHours');
    expect(lastCall()).not.toHaveProperty('days');
    fireEvent.change(screen.getByLabelText('Count from'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Count until'), { target: { value: '17' } });
    await waitFor(() => expect(lastCall().dayHours).toBe('8-17'));
    for (const name of ['Sat', 'Sun']) fireEvent.click(screen.getByRole('checkbox', { name }));
    await waitFor(() => expect(lastCall().days).toBe('1,2,3,4,5'));
    expect(lastCall()).toMatchObject({ from: OCT.from, to: OCT.to, dayHours: '8-17', days: '1,2,3,4,5' });
  });

  it('says what was counted, over how long, on the figures it gives', async () => {
    open('?month=range&hstart=8&hend=17&days=1,2,3,4,5');
    await screen.findByText('Overall availability (strict)');
    expect(screen.getByText(/Counting 08:00 to 17:00, Monday to Friday\./)).toBeInTheDocument();
    expect(screen.getByText(/measured over up to 189 hours/)).toBeInTheDocument();
    expect(screen.getByText(/Web checks are measured by calendar month/)).toBeInTheDocument();
  });

  it('does not show the error budget of a window with under 24 measured hours', async () => {
    vi.mocked(api.sliWindow).mockImplementation(async (q) => report(q.profile ?? 'availability', q.from, q.to, { dailyHours: { start: 8, end: 17, weekdays: null, seconds: 9 * 3600 } }));
    open('?month=range&rmode=day&hstart=8&hend=17');
    await screen.findByText('Overall availability (strict)');
    const card = [...document.querySelectorAll('.kpi')].find((k) => k.querySelector('.label')?.textContent === 'Error budget used')!;
    expect(card.querySelector('.value')).toHaveTextContent('—');
    expect(card).toHaveTextContent('shown from 24 measured hours');
  });

  it('shows the error budget for a month', async () => {
    open('?month=range');
    await screen.findByText('Overall availability (strict)');
    const card = [...document.querySelectorAll('.kpi')].find((k) => k.querySelector('.label')?.textContent === 'Error budget used')!;
    expect(card.querySelector('.value')).not.toHaveTextContent('—');
  });

  it('keeps the last day ticked, so that no choice means no days at all', async () => {
    open('?month=range&days=2');
    await screen.findByText('Overall availability (strict)');
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.filter((b) => (b as HTMLInputElement).checked).map((b) => (b as HTMLInputElement).name)).toEqual(['day-2']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tue' }));
    expect(screen.getByRole('checkbox', { name: 'Tue' })).toBeChecked();
  });
});

describe('a choice that cannot be asked for', () => {
  it('says why and asks for nothing: the end before the start', async () => {
    open('?month=range&rmode=custom&rfrom=2026-11-05&rfh=0&rto=2026-11-03&rth=0');
    expect(await screen.findByRole('alert')).toHaveTextContent('The start must be before the end.');
    expect(api.sliWindow).not.toHaveBeenCalled();
  });

  it('says why and asks for nothing: more than 366 days', async () => {
    open('?month=range&rmode=custom&rfrom=2025-01-01&rfh=0&rto=2026-11-03&rth=0');
    expect(await screen.findByRole('alert')).toHaveTextContent('at most 366 days');
    expect(api.sliWindow).not.toHaveBeenCalled();
  });

  it('says why and asks for nothing: hours that start and end together', async () => {
    open('?month=range&hstart=6&hend=6');
    expect(await screen.findByRole('alert')).toHaveTextContent('start and end at different times');
    expect(api.sliWindow).not.toHaveBeenCalled();
  });

  // FR-67: the page judges the start as the server does, so that a choice the server would refuse is said here and not sent.
  it('says why and asks for nothing: a start more than a year back', async () => {
    open('?month=range&rmode=custom&rfrom=2025-08-20&rfh=0&rto=2025-08-21&rth=0');
    expect(await screen.findByRole('alert')).toHaveTextContent('Zabbix keeps events for about a year');
    expect(api.sliWindow).not.toHaveBeenCalled();
  });

  it('says why and asks for nothing: a start that has not come', async () => {
    open('?month=range&rmode=custom&rfrom=2026-11-20&rfh=0&rto=2026-11-21&rth=0');
    expect(await screen.findByRole('alert')).toHaveTextContent('has not started yet');
    expect(api.sliWindow).not.toHaveBeenCalled();
  });

  // DC-73: Month is a mode of the range's own, and choosing it does not show the web checks: the Period list has a Calendar month group, and that is where they are.
  it('says where the web checks are: in the Calendar month of the Period list, and not in the range\'s own Month', async () => {
    open('?month=range&rmode=month');
    expect(await screen.findByText(/Web checks are measured by calendar month: choose Calendar month in the Period list to see them\./)).toBeInTheDocument();
    expect(screen.queryByText(/choose a month to see them/)).toBeNull();
  });

  it('offers a year only while the server answers for it', async () => {
    open('?month=range&rmode=year');
    await screen.findByText('Overall availability (strict)');
    expect([...screen.getByLabelText('Year').querySelectorAll('option')].map((o) => o.textContent)).toEqual(['2026']);
  });

  it('shows the server’s sentence when it refuses what the page could not foresee, with no Try again, which would be refused again', async () => {
    vi.mocked(api.sliWindow).mockRejectedValue(new HttpFailure('No hour of this range falls inside the daily hours you chose.', 400, true));
    open('?month=range&rmode=custom&rfrom=2026-11-10&rfh=0&rto=2026-11-12&rth=0');
    expect(await screen.findAllByText(/No hour of this range/)).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  // The server answers 503 for a range whose figures have not been read yet (BK-80): the request is right and the next read supplies them, so the page offers Try again.
  it('keeps Try again for figures that have not been read yet', async () => {
    vi.mocked(api.sliWindow).mockRejectedValue(new HttpFailure('There is nothing to measure yet: the range begins at this moment and no reading is newer than it. Try again in a minute.', 503, true));
    open('?month=range&rmode=custom&rfrom=2026-11-10&rfh=0&rto=2026-11-12&rth=0');
    expect(await screen.findAllByText(/nothing to measure yet/)).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('keeps Try again for a failure of the moment, which asking again can change', async () => {
    vi.mocked(api.sliWindow).mockRejectedValue(new HttpFailure('Zabbix did not answer in time.', 504, true));
    open('?month=range&rmode=custom&rfrom=2026-11-10&rfh=0&rto=2026-11-12&rth=0');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('measuring a long range (FR-68)', () => {
  it('says that the first view of a range over a month can take minutes, and why', async () => {
    vi.mocked(api.sliWindow).mockImplementation(() => new Promise(() => undefined));
    open('?month=range&rmode=year');
    expect(await screen.findByText(/can take several minutes/)).toHaveTextContent('Each month is read from Zabbix once');
  });

  it('keeps the short sentence for a day', async () => {
    vi.mocked(api.sliWindow).mockImplementation(() => new Promise(() => undefined));
    open('?month=range&rmode=day&rday=2026-11-03');
    expect(await screen.findByText('Measuring the range…')).toBeInTheDocument();
    expect(screen.queryByText(/several minutes/)).toBeNull();
  });

  it('says that HCML publishes by calendar month, so that the HCML card of a range is read as the portal’s own reading', async () => {
    open('?month=range&rmode=custom&rfrom=2026-11-03&rfh=0&rto=2026-11-05&rth=0');
    await screen.findByText('Overall availability (strict)');
    expect(screen.getByText(/HCML publishes its figures for a calendar month only/)).toHaveTextContent('not a figure HCML has published');
  });
});

describe('what a range has and does not have', () => {
  const ZONE = 'Asia/Jakarta';
  const OFFICE = { start: 8, end: 17, days: [1, 2, 3, 4, 5] };

  beforeEach(() => {
    // jsdom has no object URLs, and a real click on a blob link would try to navigate.
    URL.createObjectURL = vi.fn(() => 'blob:report');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(api, 'sliRangeExport').mockResolvedValue({ blob: new Blob(['report']), fileName: 'HCML_SLA_Report.pdf' });
    vi.spyOn(api, 'sliRangeEmail').mockResolvedValue({ sent: 1, refused: 0, month: null, from: 0, to: 0, files: [], remembered: false });
  });

  it('has report files and an email for the range, named for it in words, and still no Explain and no web checks, which are monthly', async () => {
    open('?month=range');
    await screen.findByText('Overall availability (strict)');
    const words = rangeWords(OCT.from, OCT.to, ALL_DAY, ZONE);
    const downloads = screen.getByRole('group', { name: `Download the SLA report for ${words}, both methods` });
    expect(downloads.closest('.controls')).toContainElement(screen.getByLabelText('Period'));
    expect(await screen.findByRole('group', { name: `Email the SLA report for ${words}, both methods` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Explain overall' })).toBeNull();
    expect(screen.queryByText('Web checks')).toBeNull();
  });

  it('names the hours that count in those groups, and asks for the file with them', async () => {
    open('?month=range&hstart=8&hend=17&days=1,2,3,4,5');
    await screen.findByText('Overall availability (strict)');
    const words = rangeWords(OCT.from, OCT.to, OFFICE, ZONE);
    const downloads = screen.getByRole('group', { name: `Download the SLA report for ${words}, both methods` });
    expect(words).toContain('08:00 to 17:00, Monday to Friday');
    await userEvent.setup({ advanceTimers: () => undefined }).click(within(downloads).getByRole('button', { name: 'PDF report' }));
    expect(api.sliRangeExport).toHaveBeenCalledWith({ from: OCT.from, to: OCT.to, dayHours: '8-17', days: '1,2,3,4,5', words }, 'pdf', expect.any(AbortSignal), expect.anything());
  });

  it('asks for the day on screen when Day is chosen, and not for the month it began on', async () => {
    open('?month=range&rmode=day&rday=2026-11-03');
    await screen.findByText('Overall availability (strict)');
    const day = { from: Date.parse('2026-11-02T17:00:00Z') / 1000, to: Date.parse('2026-11-03T17:00:00Z') / 1000 };
    await userEvent.setup({ advanceTimers: () => undefined }).click(screen.getByRole('button', { name: 'Excel report' }));
    expect(api.sliRangeExport).toHaveBeenCalledWith(expect.objectContaining(day), 'xlsx', expect.any(AbortSignal), expect.anything());
    expect(api.sliRangeExport).toHaveBeenCalledTimes(1);
  });

  it('mails the range, with the window as an object, when an administrator sends it', async () => {
    open('?month=range&hstart=8&hend=17');
    await screen.findByText('Overall availability (strict)');
    const user = userEvent.setup({ advanceTimers: () => undefined });
    await user.click(await screen.findByRole('button', { name: 'Email report' }));
    const dialog = await screen.findByRole('dialog', { name: 'Email the SLA report' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Send to' }), 'ana@example.org');
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(api.sliRangeEmail).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.sliRangeEmail).mock.calls[0]![0]).toMatchObject({ from: OCT.from, to: OCT.to, dayHours: '8-17' });
  });

  it('puts the email nowhere for anyone below an administrator, and the files still there', async () => {
    auth.role = 'operator';
    open('?month=range');
    await screen.findByText('Overall availability (strict)');
    expect(screen.getByRole('group', { name: /Download the SLA report for/ })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Email the SLA report/ })).toBeNull();
  });

  it('turns the files and the email off while the choice is not a range it can ask for', async () => {
    open('?month=range&hstart=8&hend=8');
    expect(await screen.findByRole('alert')).toHaveTextContent('start and end at different times');
    const downloads = screen.getByRole('group', { name: /Download the SLA report for/ });
    for (const b of within(downloads).getAllByRole('button')) expect(b).toBeDisabled();
    expect(await screen.findByRole('button', { name: 'Email report' })).toBeDisabled();
    expect(api.sliRangeExport).not.toHaveBeenCalled();
  });

  it('draws the same tables as a month, in the method chosen', async () => {
    open('?month=range&method=hcml-report');
    await screen.findByText(/By category · HCML report method/);
    expect(screen.getByText(/By site · HCML report method/)).toBeInTheDocument();
    const panel = screen.getByRole('heading', { name: /By category · HCML report method/ }).closest('.panel') as HTMLElement;
    expect(within(panel).getByText('Switches')).toBeInTheDocument();
  });
});
