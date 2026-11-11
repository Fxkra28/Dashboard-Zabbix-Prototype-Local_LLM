import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { api } from '../../api';
import { Async } from '../components/states';
import { ageWords, momentWords, noteStaleCopy, REFRESHING_NOTICE_AFTER_S, staleCopyOf } from './freshness';
import Availability from '../../features/sla/Availability';
import Capacity from '../../features/reports/Capacity';
import Overview from '../../features/dashboard/Overview';
import Sla from '../../features/sla/Sla';
import type {
  AvailabilityReport,
  CapacityReport,
  Freshness,
  Problem,
  SliGroup,
  SliProfile,
  SliReport,
  Stats,
} from '../../types';
import { problem } from '../../__tests__/problems';

/**
 * The Dashboard says
 * when Zabbix has stopped collecting, counts what it shows from one list and
 * never paints 0 for "not loaded", and the report pages say when they show an
 * old copy.
 */

const stream = vi.hoisted(() => ({
  current: { data: null, updatedAt: null, connected: false, error: null } as {
    data: unknown[] | null;
    updatedAt: number | null;
    connected: boolean;
    error: string | null;
  },
}));
vi.mock('../hooks/useSSE', () => ({ STREAM_SILENT_MS: 45_000, useSSE: () => stream.current }));

const DAY = 86_400;
const never = () => new Promise<never>(() => undefined);

const stats = (over: Partial<Stats> = {}): Stats => ({
  hosts: 24,
  items: 1000,
  triggers: 300,
  groups: 8,
  problems: 99,
  unacknowledged: 99,
  bySeverity: {},
  ...over,
});
const collecting = (over: Partial<Freshness> = {}): Freshness => ({
  lastCollectedAt: Math.floor(Date.now() / 1000) - 30,
  ageSeconds: 30,
  stale: false,
  staleAfterSeconds: 600,
  pinged: 0,
  answering: 0,
  reachLost: false,
  ...over,
});
const frame = (list: Problem[]) => {
  stream.current = { data: list, updatedAt: Date.now(), connected: true, error: null };
};

beforeEach(() => {
  stream.current = { data: null, updatedAt: null, connected: false, error: null };
  vi.spyOn(api, 'stats').mockResolvedValue(stats());
  vi.spyOn(api, 'problemsByGroup').mockResolvedValue([]);
  vi.spyOn(api, 'freshness').mockResolvedValue(collecting());
  vi.spyOn(api, 'problems').mockImplementation(never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openDashboard(wall = false) {
  return render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={{ wall, exitWall: () => undefined }} />}>
          <Route index element={<Overview />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const kpi = (label: string) => screen.getByText(label, { selector: '.label' }).closest('.kpi') as HTMLElement;
const kpiValue = (label: string) => kpi(label).querySelector('.value')?.textContent;
const tile = (name: string) => screen.getByText(name).closest('.sev-tile')?.querySelector('strong')?.textContent;
const PROBLEM_KPIS = ['Open problems', 'High / Disaster', 'Warnings', 'Unacknowledged'];
const SEVERITY_NAMES = ['Disaster', 'High', 'Average', 'Warning', 'Information', 'Not classified'];

describe('the problem tiles before the list has loaded (UX-02)', () => {
  it('show a placeholder, never a 0 that would read as all clear', async () => {
    openDashboard();
    // The counts from the stats call are in; the list is not.
    await waitFor(() => expect(kpiValue('Hosts')).toBe('24'));
    for (const label of PROBLEM_KPIS) expect(kpiValue(label), label).toBe('…');
    for (const name of SEVERITY_NAMES) expect(tile(name), name).toBe('…');
  });

  it('keep the placeholder when the list never loads, with the failure shown beside them', async () => {
    vi.spyOn(api, 'problems').mockRejectedValue(new Error('Could not reach Zabbix.'));
    openDashboard();
    expect(await screen.findByText('Could not reach Zabbix.')).toBeInTheDocument();
    for (const label of PROBLEM_KPIS) expect(kpiValue(label), label).toBe('…');
    for (const name of SEVERITY_NAMES) expect(tile(name), name).toBe('…');
  });

  it('show a real 0 once the list has arrived and is empty', () => {
    frame([]);
    openDashboard();
    for (const label of PROBLEM_KPIS) expect(kpiValue(label), label).toBe('0');
    for (const name of SEVERITY_NAMES) expect(tile(name), name).toBe('0');
  });
});

describe('Unacknowledged on the Dashboard (IN-14)', () => {
  const list = () => [
    problem(1, 4),
    problem(2, 3, 0, { acknowledged: '1' }),
    // Resolved a moment ago, and inside a maintenance window: neither is counted anywhere.
    problem(3, 4, 0, { r_eventid: '77' }),
    problem(4, 4, 0, { suppressed: '1' }),
    problem(5, 5),
  ];

  it('counts the same open list as the other tiles, not the stats call, which says 99', () => {
    frame(list());
    openDashboard();
    expect(kpiValue('Open problems')).toBe('3');
    expect(kpiValue('Unacknowledged')).toBe('2');
    expect(kpiValue('High / Disaster')).toBe('2');
  });

  it('moves with the live list, with no wait for the 30 second stats poll', () => {
    frame(list());
    const { rerender } = openDashboard();
    expect(kpiValue('Unacknowledged')).toBe('2');

    frame([problem(1, 4, 0, { acknowledged: '1' }), ...list().slice(1)]);
    rerender(
      <MemoryRouter>
        <Routes>
          <Route element={<Outlet context={{ wall: false, exitWall: () => undefined }} />}>
            <Route index element={<Overview />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(kpiValue('Unacknowledged')).toBe('1');
    expect(api.stats).toHaveBeenCalledTimes(1);
  });

  it('shows the placeholder until the list is in, like the tiles beside it', () => {
    openDashboard();
    expect(kpiValue('Unacknowledged')).toBe('…');
  });
});

describe('Zabbix has stopped collecting (IN-12)', () => {
  const frozen = () => collecting({ lastCollectedAt: Math.floor(Date.now() / 1000) - 20 * DAY, ageSeconds: 20 * DAY, stale: true });

  it('says so in a notice and on the Live badge, over a stream that is connected and sending', async () => {
    frame([problem(1, 4)]);
    vi.spyOn(api, 'freshness').mockResolvedValue(frozen());
    openDashboard();

    const notice = await screen.findByText(/What you see on this page is from then/, { selector: '.refresh-failed' });
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveTextContent(/^Zabbix has collected nothing since .+\. What you see on this page is from then, not from now\.$/);
    const badge = await screen.findByText('Zabbix has collected nothing for 20 days');
    expect(badge.closest('.live')).toHaveClass('late');
    expect(document.querySelector('.live')?.textContent).not.toMatch(/^Live/);
  });

  it('keeps the screen-reader text steady: no running count that would be read out each minute', async () => {
    frame([problem(1, 4)]);
    vi.spyOn(api, 'freshness').mockResolvedValue(frozen());
    openDashboard();
    await screen.findByText('Zabbix has collected nothing for 20 days');
    const announced = document.querySelector('.live-status .sr-only') as HTMLElement;
    expect(announced).toHaveAttribute('aria-live', 'polite');
    expect(announced.textContent).toMatch(/^Zabbix has collected nothing since /);
    expect(announced.textContent).not.toMatch(/days|min/);
  });

  it('says nothing while Zabbix is collecting, and the badge stays Live', async () => {
    frame([problem(1, 4)]);
    openDashboard();
    await waitFor(() => expect(api.freshness).toHaveBeenCalled());
    const badge = document.querySelector('.live') as HTMLElement;
    expect(badge).toHaveTextContent('Live');
    expect(badge).not.toHaveClass('late');
    expect(screen.queryByText(/Zabbix has collected nothing/)).toBeNull();
  });

  it('claims nothing when the age cannot be read', async () => {
    frame([problem(1, 4)]);
    vi.spyOn(api, 'freshness').mockRejectedValue(new Error('Could not reach Zabbix.'));
    openDashboard();
    await waitFor(() => expect(api.freshness).toHaveBeenCalled());
    expect(screen.queryByText(/Zabbix has collected nothing/)).toBeNull();
    expect(document.querySelector('.live')).toHaveTextContent('Live');
  });

  it('claims nothing when there is no ICMP item to tell by', async () => {
    frame([problem(1, 4)]);
    vi.spyOn(api, 'freshness').mockResolvedValue(collecting({ lastCollectedAt: null, ageSeconds: null }));
    openDashboard();
    await waitFor(() => expect(api.freshness).toHaveBeenCalled());
    expect(screen.queryByText(/Zabbix has collected nothing/)).toBeNull();
  });

  it('is on the wall screen’s data stamp too', async () => {
    frame([problem(1, 4)]);
    vi.spyOn(api, 'freshness').mockResolvedValue(frozen());
    openDashboard(true);
    const label = await screen.findByText('Zabbix collected nothing for 20 days');
    expect(label.closest('.wall-stamp')).toHaveClass('late');
  });

  it('asks again every minute, so a screen left open learns that Zabbix has stopped since it loaded', async () => {
    vi.useFakeTimers();
    try {
      frame([problem(1, 4)]);
      const ask = vi.spyOn(api, 'freshness').mockResolvedValue(collecting());
      openDashboard();
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(ask).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/Zabbix has collected nothing/)).toBeNull();

      // Zabbix stops. The page does not ask early, and learns it on the next minute.
      ask.mockResolvedValue(frozen());
      await act(() => vi.advanceTimersByTimeAsync(59_000));
      expect(ask).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/Zabbix has collected nothing/)).toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      expect(ask).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/What you see on this page is from then/)).toHaveAttribute('role', 'status');
      expect(document.querySelector('.live')).toHaveClass('late');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Zabbix is cut off from the network (IN-39)', () => {
  const cut = () => collecting({ pinged: 93, answering: 2, reachLost: true });

  it('says the down hosts and new problems are most likely not real, with the count outside the announced words', async () => {
    frame([problem(1, 4)]);
    vi.spyOn(api, 'freshness').mockResolvedValue(cut());
    openDashboard();
    const said = await screen.findByText(/^Zabbix cannot reach the network: almost no device answers its ping/);
    expect(said).toHaveAttribute('role', 'status');
    expect(said.textContent).not.toMatch(/\d/);
    expect(said.closest('.refresh-failed')).toHaveTextContent(/2 of 93 answered\.$/);
    const badge = document.querySelector('.live') as HTMLElement;
    expect(badge).toHaveTextContent('Zabbix cannot reach the network');
    expect(badge).toHaveClass('late');
  });

  it('is on the wall screen’s data stamp too', async () => {
    frame([problem(1, 4)]);
    vi.spyOn(api, 'freshness').mockResolvedValue(cut());
    openDashboard(true);
    const label = await screen.findByText('Zabbix cannot reach the network', { selector: '.wall-label' });
    expect(label.closest('.wall-stamp')).toHaveClass('late');
  });

  it('gives way to the stopped notice when Zabbix collects nothing at all', async () => {
    frame([problem(1, 4)]);
    vi.spyOn(api, 'freshness').mockResolvedValue({ ...cut(), stale: true, lastCollectedAt: Math.floor(Date.now() / 1000) - DAY, ageSeconds: DAY });
    openDashboard();
    await screen.findByText(/What you see on this page is from then/);
    expect(screen.queryByText(/cannot reach the network/)).toBeNull();
  });

  it('says nothing while most devices answer', async () => {
    frame([problem(1, 4)]);
    vi.spyOn(api, 'freshness').mockResolvedValue(collecting({ pinged: 93, answering: 80, reachLost: false }));
    openDashboard();
    await waitFor(() => expect(api.freshness).toHaveBeenCalled());
    expect(screen.queryByText(/cannot reach the network/)).toBeNull();
    expect(document.querySelector('.live')).toHaveTextContent('Live');
  });
});

describe('the live list says how old it is (UX-01) and how much of the list it shows (UX-12)', () => {
  const badge = () => document.querySelector('.live') as HTMLElement;
  const arrivedAgo = (ms: number) => {
    stream.current = { data: [problem(1, 4)], updatedAt: Date.now() - ms, connected: true, error: null };
  };

  it('stamps the list with when it came, and says Live while the stream sends', () => {
    frame([problem(1, 4)]);
    openDashboard();
    expect(document.querySelector('.live-age')?.textContent).toMatch(/^Updated \d\d:\d\d:\d\d WIB$/);
    expect(badge()).toHaveTextContent('Live');
    expect(badge()).not.toHaveClass('late');
  });

  it('warns once nothing new has come for more than 90 seconds, in minutes, and not before', () => {
    arrivedAgo(80_000);
    const { unmount } = openDashboard();
    expect(badge()).not.toHaveClass('late');
    unmount();
    arrivedAgo(100_000);
    openDashboard();
    expect(badge()).toHaveClass('late');
    expect(badge()).toHaveTextContent('No new data for 1 min');
    expect(screen.getByText(/^No new data since \d\d:\d\d:\d\d WIB$/)).toBeInTheDocument();
  });

  it('counts the minutes without a running count for a screen reader', () => {
    arrivedAgo(3 * 60_000 + 5_000);
    openDashboard();
    expect(badge()).toHaveTextContent('No new data for 3 min');
    expect(screen.getByText(/^No new data since/)).not.toHaveTextContent('3 min');
  });

  const fifteen = () => Array.from({ length: 15 }, (_, i) => problem(i + 1, 3));

  it('says how many of the open problems it lists, worst first, and links to all of them', () => {
    frame(fifteen());
    openDashboard();
    expect(screen.getByText(/12 of 15 open problems, worst first\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all problems' })).toHaveAttribute('href', '/problems');
  });

  it('draws no link on a wall, which has no one to click it', () => {
    frame(fifteen());
    openDashboard(true);
    expect(screen.getByText(/12 of 15 open problems, worst first\./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View all problems' })).toBeNull();
  });

  it('says nothing about a list when no problem is open', () => {
    frame([]);
    openDashboard();
    expect(screen.queryByText(/open problems, worst first/)).toBeNull();
  });
});

describe('words for ages and moments', () => {
  it('ageWords gives a few words, in the unit that fits', () => {
    expect(ageWords(20)).toBe('under a minute');
    expect(ageWords(60)).toBe('1 min');
    expect(ageWords(59 * 60 + 40)).toBe('59 min');
    expect(ageWords(3600)).toBe('1 h');
    expect(ageWords(3600 + 5 * 60)).toBe('1 h 5 min');
    expect(ageWords(47 * 3600)).toBe('47 h');
    expect(ageWords(20 * DAY)).toBe('20 days');
    expect(ageWords(-5)).toBe('under a minute');
  });

  it('momentWords gives the clock for today and puts the date before it for another day', () => {
    // Written in UTC: 15:30 on 7 October in Jakarta is 08:30 UTC, whatever zone this machine is in.
    const now = Date.UTC(2026, 9, 7, 8, 30);
    expect(momentWords(Date.UTC(2026, 9, 7, 2, 5), now)).toBe('09:05 WIB');
    const other = momentWords(Date.UTC(2026, 8, 17, 9, 59), now);
    expect(other).toMatch(/^17 /);
    expect(other).toMatch(/16:59 WIB$/);
  });
});

describe('noting an old copy (IN-05)', () => {
  const stale = (age: string | null) => {
    const headers = new Headers({ 'X-Data-Stale': 'true' });
    if (age !== null) headers.set('X-Data-Age-Seconds', age);
    return headers;
  };

  it('remembers the moment the copy was made against the body object', () => {
    const body = { rows: [] };
    noteStaleCopy(body, stale('3600'), 10_000_000);
    expect(staleCopyOf(body)).toEqual({ asOf: 10_000_000 - 3_600_000 });
    // Another object, even an equal one, is a live answer.
    expect(staleCopyOf({ rows: [] })).toBeNull();
  });

  it('knows it is old when the age is missing or unreadable, and does not guess one', () => {
    for (const age of [null, '', 'soon', '-5']) {
      const body = {};
      noteStaleCopy(body, stale(age), 10_000_000);
      expect(staleCopyOf(body), String(age)).toEqual({ asOf: null });
    }
  });

  const refreshing = (age: string) => new Headers({ 'X-Data-Refreshing': 'true', 'X-Data-Age-Seconds': age });

  it('remembers a copy shown while a newer one is read, as that kind, once it is two minutes old', () => {
    const old = {};
    noteStaleCopy(old, refreshing('300'), 10_000_000);
    expect(staleCopyOf(old)).toEqual({ asOf: 10_000_000 - 300_000, refreshing: true });

    const young = {};
    noteStaleCopy(young, refreshing(String(REFRESHING_NOTICE_AFTER_S - 1)), 10_000_000);
    expect(staleCopyOf(young)).toBeNull();
    const unknown = {};
    noteStaleCopy(unknown, new Headers({ 'X-Data-Refreshing': 'true' }), 10_000_000);
    expect(staleCopyOf(unknown)).toBeNull();
  });

  it('takes a failed fetch for what it is when a reply says both', () => {
    const body = {};
    noteStaleCopy(body, new Headers({ 'X-Data-Stale': 'true', 'X-Data-Refreshing': 'true', 'X-Data-Age-Seconds': '600' }), 10_000_000);
    expect(staleCopyOf(body)).toEqual({ asOf: 10_000_000 - 600_000 });
  });

  it('shows a refreshing copy as news, not a warning, above the page it belongs to', () => {
    const body = { rows: [] };
    noteStaleCopy(body, refreshing('300'), Date.now());
    render(
      <Async loading={false} error={null} data={body}>
        {() => <p>the page</p>}
      </Async>,
    );
    const note = screen.getByRole('status');
    expect(note).toHaveClass('data-age');
    expect(note).not.toHaveClass('refresh-failed');
    expect(note.textContent).toMatch(/^Data from \d{2}:\d{2} WIB \(5 min ago\); a newer copy is being read from Zabbix\.$/);
    expect(screen.getByText('the page')).toBeInTheDocument();
  });

  it('ignores a reply that is not flagged, and a body that cannot carry a note', () => {
    const live = {};
    noteStaleCopy(live, new Headers(), 1);
    noteStaleCopy(live, new Headers({ 'X-Data-Stale': 'false' }), 1);
    expect(staleCopyOf(live)).toBeNull();
    for (const body of [null, 'text', 42, undefined]) {
      expect(() => noteStaleCopy(body, stale('5'))).not.toThrow();
      expect(staleCopyOf(body)).toBeNull();
    }
  });

  it('is set by the API layer from the reply headers, with the body unchanged', async () => {
    const report = { days: 7, metrics: [] };
    const json = (headers: Record<string, string>) =>
      new Response(JSON.stringify(report), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ 'X-Data-Stale': 'true', 'X-Data-Age-Seconds': '7200' }))
      .mockResolvedValueOnce(json({}));
    vi.stubGlobal('fetch', fetchMock);

    const old = await api.capacity(7);
    expect(old).toEqual(report);
    const made = staleCopyOf(old)?.asOf;
    expect(made).toBeTypeOf('number');
    expect(Date.now() - (made as number)).toBeGreaterThanOrEqual(7_200_000);
    expect(Date.now() - (made as number)).toBeLessThan(7_200_000 + 5_000);

    expect(staleCopyOf(await api.capacity(7))).toBeNull();
  });
});

describe('a page that shows an old copy says so (IN-05)', () => {
  const OLD = { 'X-Data-Stale': 'true', 'X-Data-Age-Seconds': '4320' };
  const old = <T extends object>(body: T, headers: Record<string, string> = OLD): T => {
    noteStaleCopy(body, new Headers(headers));
    return body;
  };
  const sentence = /Zabbix did not answer, so this is the last copy the portal kept, from .+ \(1 h 12 min ago\)\./;
  const at = (url: string) => window.history.replaceState(null, '', url);

  beforeEach(() => {
    vi.spyOn(api, 'health').mockResolvedValue({ ok: true, ts: 0, ai: false, writeBack: false });
    vi.spyOn(api, 'slaSource').mockResolvedValue({ real: false, slas: 0, services: 0 });
    vi.spyOn(api, 'aging').mockResolvedValue({ buckets: [], unacknowledged: 0, total: 0, oldest: [] });
  });

  const group = (): SliGroup => ({
    key: 'all',
    name: 'HCML estate',
    hosts: 3,
    withData: 3,
    sli: 99.5,
    downtime: 600,
    meeting: true,
    belowTarget: 0,
  });
  const availabilityReport = (): AvailabilityReport => ({
    from: 0,
    to: 1,
    windowSeconds: 86_400,
    minSeverity: 2,
    hosts: [],
    truncated: false,
    basis: 'availability',
    profile: 'availability',
    month: null,
    target: 99,
    overall: group(),
    categories: [],
    sites: [],
    gaps: [],
  });
  const sliReport = (month: string, profile: SliProfile): SliReport => ({
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
  });
  const capacity = (): CapacityReport => ({ days: 7, metrics: [] });

  it('on the availability page', async () => {
    vi.spyOn(api, 'availability').mockResolvedValue(old(availabilityReport()));
    at('/availability');
    render(
      <BrowserRouter>
        <Availability />
      </BrowserRouter>,
    );
    expect(await screen.findByText(sentence)).toHaveClass('refresh-failed');
  });

  it('on the SLA page, beside the figures it describes', async () => {
    vi.spyOn(api, 'sli').mockImplementation(async (month, profile) => old(sliReport(month ?? '', profile ?? 'availability')));
    at('/sla');
    render(
      <BrowserRouter>
        <Sla />
      </BrowserRouter>,
    );
    expect((await screen.findAllByText(sentence)).length).toBeGreaterThan(0);
  });

  describe('on the SLA page, where two reports are cached on their own and either can be the old one', () => {
    const hcmlNote = /Zabbix did not answer, so the HCML report method figure is the last copy the portal kept, from .+ \((.+) ago\)\./;
    const AGES = { strict: { 'X-Data-Stale': 'true', 'X-Data-Age-Seconds': '4320' }, hcml: { 'X-Data-Stale': 'true', 'X-Data-Age-Seconds': '9000' } };

    async function openSla(strictOld: Record<string, string> | null, hcmlOld: Record<string, string> | null, search = '') {
      vi.spyOn(api, 'sli').mockImplementation(async (month, profile) => {
        const report = sliReport(month ?? '', profile ?? 'availability');
        const headers = profile === 'hcml-report' ? hcmlOld : strictOld;
        return headers ? old(report, headers) : report;
      });
      at(`/sla${search}`);
      render(
        <BrowserRouter>
          <Sla />
        </BrowserRouter>,
      );
      // Both figures are in: the HCML card says what it measures once its report has arrived.
      await screen.findByText(/ping loss only/);
    }

    it('says so when only the HCML report is the old copy, and says it is that figure', async () => {
      await openSla(null, AGES.strict);
      const note = await screen.findByText(hcmlNote);
      expect(note).toHaveClass('refresh-failed');
      expect(note).toHaveAttribute('role', 'status');
      expect(note).toHaveTextContent('from');
      expect(note).toHaveTextContent('(1 h 12 min ago)');
      // Beside the cards it is about, not above tables that were read live.
      expect(note.parentElement?.querySelector('.sli-kpis')).not.toBeNull();
      expect(screen.queryAllByText(sentence)).toHaveLength(0);
    });

    it('says so too when the tables use the HCML method, once for the figure and once for the tables', async () => {
      await openSla(null, AGES.strict, '?method=hcml-report');
      expect(await screen.findAllByText(hcmlNote)).toHaveLength(1);
      expect(await screen.findAllByText(sentence)).toHaveLength(1);
    });

    it('does not say it twice when both reports are old copies from the same moment', async () => {
      await openSla(AGES.strict, AGES.strict);
      expect((await screen.findAllByText(sentence)).length).toBeGreaterThan(0);
      expect(screen.queryAllByText(hcmlNote)).toHaveLength(0);
    });

    it('speaks for the HCML figure on its own when its copy is older than the one the notice above names', async () => {
      await openSla(AGES.strict, AGES.hcml);
      expect((await screen.findAllByText(sentence)).length).toBeGreaterThan(0);
      expect(await screen.findByText(hcmlNote)).toHaveTextContent('(2 h 30 min ago)');
    });

    it('says nothing when both reports are live', async () => {
      await openSla(null, null);
      expect(screen.queryByText(/Zabbix did not answer/)).toBeNull();
    });
  });

  it('on the capacity page', async () => {
    vi.spyOn(api, 'capacity').mockResolvedValue(old(capacity()));
    at('/capacity');
    render(
      <BrowserRouter>
        <Capacity />
      </BrowserRouter>,
    );
    expect(await screen.findByText(sentence)).toBeInTheDocument();
  });

  it('and not when the report is live', async () => {
    vi.spyOn(api, 'availability').mockResolvedValue(availabilityReport());
    at('/availability');
    render(
      <BrowserRouter>
        <Availability />
      </BrowserRouter>,
    );
    await screen.findByLabelText('Period');
    await waitFor(() => expect(api.availability).toHaveBeenCalled());
    expect(screen.queryByText(/Zabbix did not answer/)).toBeNull();
  });

  it('leaves the words out of the time when the BFF did not say how old', () => {
    const body = old({ rows: [1] }, { 'X-Data-Stale': 'true' });
    render(<Async loading={false} error={null} data={body}>{() => <p>report</p>}</Async>);
    expect(screen.getByText('Zabbix did not answer, so this is the last copy the portal kept.')).toBeInTheDocument();
    expect(within(document.body).getByText('report')).toBeInTheDocument();
  });
});
