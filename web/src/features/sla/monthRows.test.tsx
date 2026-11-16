import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import { recentMonths } from '../../shared/lib/time';
import Sla from './Sla';
import { lastClosedMonth } from './Sli';
import type { AvailabilityReport, SliGroup, SliProfile, SliReport } from '../../types';

/**
 * The month and the window of the SLA page: the sites card counts one method and says who has no data (FR-50), a month says when it was made and an open
 * one is read again (FR-51), a failed HCML figure says so (FR-52), the month is in the address (FR-53), and a failed load has a Try again (UX-49).
 */

const MADE_AT = Date.parse('2026-11-12T07:32:00Z') / 1000; // 14:32 in Jakarta

const site = (key: string, name: string, sli: number | null, meeting: boolean | null): SliGroup => ({
  key,
  name,
  hosts: 2,
  withData: sli === null ? 0 : 2,
  sli,
  downtime: 0,
  meeting,
  belowTarget: meeting === false ? 2 : 0,
});

const everyone = site('all', 'Estate', 99.5, true);

const monthReport = (month: string, profile: SliProfile, over: Partial<SliReport> = {}): SliReport =>
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
    overall: everyone,
    categories: [],
    sites: [],
    classes: [],
    hosts: [],
    wanPaths: [],
    web: [],
    gaps: [],
    noDataWindows: [],
    stats: { zabbixCalls: 0, triggers: 0, events: 0, trendRows: 0, ms: 0 },
    generatedAt: MADE_AT,
    ...over,
  }) as SliReport;

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
  overall: everyone,
  categories: [],
  sites: [],
  hosts: [],
  gaps: [],
  ...over,
});

const open = (search: string) => {
  window.history.replaceState(null, '', `/sla${search}`);
  render(
    <BrowserRouter>
      <Sla />
    </BrowserRouter>,
  );
};

const card = (label: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('.kpi')].find((k) => k.querySelector('.label')?.textContent === label);
const findCard = async (label: string) => {
  await waitFor(() => expect(card(label)).toBeDefined());
  return card(label) as HTMLElement;
};

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.spyOn(api, 'health').mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof api.health>>);
  vi.spyOn(api, 'slaSource').mockResolvedValue({ real: false, slas: 0, services: 0 } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the Sites below target card of a month (FR-50)', () => {
  const strictSites = [site('a', 'Alpha', 99.5, true), site('b', 'Bravo', 97, false), site('c', 'Charlie', null, null)];
  const hcmlSites = [site('a', 'Alpha', 98, false), site('b', 'Bravo', 99.9, true), site('c', 'Charlie', null, null)];

  it('counts the strict method however "Tables use" is set, says so, and adds the sites without data', async () => {
    vi.spyOn(api, 'sli').mockImplementation(async (m, p) =>
      monthReport(m ?? '', p ?? 'availability', { sites: p === 'hcml-report' ? hcmlSites : strictSites }),
    );
    open('?month=2026-10&method=hcml-report');
    const c = await findCard('Sites below target (strict)');
    expect(c.querySelector('.value')).toHaveTextContent('1');
    expect(c.querySelector('.sub')).toHaveTextContent('Bravo · 1 without data');
    expect(c.querySelector('.sub')).not.toHaveTextContent('Alpha');
  });

  it('does not say that all sites pass while one has no data', async () => {
    vi.spyOn(api, 'sli').mockImplementation(async (m, p) =>
      monthReport(m ?? '', p ?? 'availability', { sites: [site('a', 'Alpha', 99.9, true), site('c', 'Charlie', null, null)] }),
    );
    open('?month=2026-10');
    const c = await findCard('Sites below target (strict)');
    expect(c.querySelector('.sub')).toHaveTextContent('none below 99%, 1 without data');
    expect(c.querySelector('.sub')).not.toHaveTextContent('all sites');
  });
});

describe('the Sites below target card of a window (FR-50)', () => {
  it('names its method like the cards beside it, and adds the sites without data', async () => {
    vi.spyOn(api, 'availability').mockResolvedValue(
      windowReport({ sites: [site('a', 'Alpha', 99.9, true), site('c', 'Charlie', null, null)] }),
    );
    open('?month=d7');
    const c = await findCard('Sites below target · Strict');
    expect(c.querySelector('.sub')).toHaveTextContent('none below 99%, 1 without data');
  });
});

describe('the time of a month (FR-51)', () => {
  it('prints when the figures were made, with the date when it was not today', async () => {
    vi.spyOn(api, 'sli').mockImplementation(async (m, p) => monthReport(m ?? '', p ?? 'availability'));
    open('?month=2026-10');
    await screen.findByText('Overall availability (strict)');
    expect(document.querySelector('.sli-banner')).toHaveTextContent(/as of .*14:32 WIB; nothing is written to Zabbix/);
  });

  it('prints the clock alone when the figures were made today', async () => {
    vi.spyOn(api, 'sli').mockImplementation(async (m, p) => monthReport(m ?? '', p ?? 'availability', { generatedAt: Math.floor(Date.now() / 1000) }));
    open('?month=2026-10');
    await screen.findByText('Overall availability (strict)');
    expect(document.querySelector('.sli-banner')).toHaveTextContent(/monthly in .* time, as of \d\d:\d\d WIB; nothing/);
  });

  it('prints no time for a report that carries none', async () => {
    vi.spyOn(api, 'sli').mockImplementation(async (m, p) => monthReport(m ?? '', p ?? 'availability', { generatedAt: 0 }));
    open('?month=2026-10');
    await screen.findByText('Overall availability (strict)');
    expect(document.querySelector('.sli-banner')).not.toHaveTextContent('as of');
  });
});

describe('a month that is still running (FR-51)', () => {
  const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
  const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

  it('is read again about every five minutes, both methods', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const sli = vi.spyOn(api, 'sli').mockImplementation(async (m, p) => monthReport(m ?? '', p ?? 'availability', { closed: false }));
    open(`?month=${recentMonths(1)[0]}`);
    await settle();
    expect(sli).toHaveBeenCalledTimes(2);
    await wait(5 * 60_000 - 1000);
    expect(sli).toHaveBeenCalledTimes(2);
    await wait(1000);
    expect(sli).toHaveBeenCalledTimes(4);
  });

  it('is not read again once it has closed: a closed month does not change', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const sli = vi.spyOn(api, 'sli').mockImplementation(async (m, p) => monthReport(m ?? '', p ?? 'availability'));
    open(`?month=${lastClosedMonth()}`);
    await settle();
    await wait(20 * 60_000);
    expect(sli).toHaveBeenCalledTimes(2);
  });
});

describe('the HCML method card when its read fails (FR-52)', () => {
  it('says it is not available, with the reason, instead of calculating for ever', async () => {
    vi.spyOn(api, 'sli').mockImplementation(async (m, p) => {
      if (p === 'hcml-report') throw new Error('Zabbix is unreachable');
      return monthReport(m ?? '', p ?? 'availability');
    });
    open('?month=2026-10');
    await screen.findByText('Overall availability (strict)');
    await waitFor(() => expect(card('HCML report method')?.querySelector('.sub')).toHaveTextContent('Not available: Zabbix is unreachable'));
    expect(card('HCML report method')?.querySelector('.value')).not.toHaveTextContent('…');
    expect(card('HCML report method')?.querySelector('.sub')).not.toHaveTextContent('calculating');
  });

  it('still says calculating while the read is out', async () => {
    vi.spyOn(api, 'sli').mockImplementation(async (m, p) => {
      if (p === 'hcml-report') return new Promise<SliReport>(() => undefined);
      return monthReport(m ?? '', p ?? 'availability');
    });
    open('?month=2026-10');
    await screen.findByText('Overall availability (strict)');
    expect(card('HCML report method')?.querySelector('.sub')).toHaveTextContent('calculating');
  });
});

describe('the month in the address (FR-53)', () => {
  it('is written when the page opens without one, so that a copied link names the month', async () => {
    vi.spyOn(api, 'sli').mockImplementation(async (m, p) => monthReport(m ?? '', p ?? 'availability'));
    open('');
    await screen.findByText('Overall availability (strict)');
    expect(new URLSearchParams(window.location.search).get('month')).toBe(lastClosedMonth());
  });

  it('stays in the address when the default month is chosen again', async () => {
    vi.spyOn(api, 'sli').mockImplementation(async (m, p) => monthReport(m ?? '', p ?? 'availability'));
    open(`?month=${recentMonths(3)[2]}`);
    await screen.findByText('Overall availability (strict)');
    await userEvent.setup().selectOptions(screen.getByLabelText('Period'), lastClosedMonth());
    expect(new URLSearchParams(window.location.search).get('month')).toBe(lastClosedMonth());
  });
});

describe('a failed load of the month or the window (UX-49)', () => {
  it('has a Try again that reads the month again, then shows it', async () => {
    let failing = true;
    const sli = vi.spyOn(api, 'sli').mockImplementation(async (m, p) => {
      if (failing && p === 'availability') throw new Error('Failed to fetch');
      return monthReport(m ?? '', p ?? 'availability');
    });
    open('?month=2026-10');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to fetch');
    const before = sli.mock.calls.filter(([, p]) => p === 'availability').length;
    failing = false;
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }));
    await screen.findByText('Overall availability (strict)');
    expect(sli.mock.calls.filter(([, p]) => p === 'availability').length).toBe(before + 1);
  });

  it('has a Try again under the tables too, when the method they use failed', async () => {
    let failing = true;
    vi.spyOn(api, 'sli').mockImplementation(async (m, p) => {
      if (failing && p === 'hcml-report') throw new Error('Zabbix is unreachable');
      return monthReport(m ?? '', p ?? 'availability');
    });
    open('?month=2026-10&method=hcml-report');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Zabbix is unreachable');
    failing = false;
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText(/By category · HCML report method/)).toBeInTheDocument();
  });

  it('has a Try again for the window', async () => {
    let failing = true;
    const availability = vi.spyOn(api, 'availability').mockImplementation(async () => {
      if (failing) throw new Error('Failed to fetch');
      return windowReport();
    });
    open('?month=d7');
    const alert = await screen.findByRole('alert');
    failing = false;
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }));
    await screen.findByText('Overall · Strict');
    expect(availability).toHaveBeenCalledTimes(2);
  });
});
