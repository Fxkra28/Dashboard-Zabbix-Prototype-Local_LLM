import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../api';
import { setReportTimeZone } from '../shared/lib/time';
import { GapsNote, MonthSelect, gapsSummary } from '../features/sla/Sli';
import RangePicker from '../features/graphs/RangePicker';
import Sla from '../features/sla/Sla';
import type { SlaSource } from '../types';

/**
 * The month lists and the "no collected data" spans follow the
 * server's zone, also when the answer from /api/health arrives after the page
 * has been drawn.
 */

const utc = (iso: string) => Date.parse(iso) / 1000;

afterEach(() => {
  setReportTimeZone(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 16:30 UTC on 31 July: still July in Jakarta (UTC+7), already August in Makassar (UTC+8). */
const nearMonthEnd = () => vi.useFakeTimers({ now: Date.parse('2026-07-31T16:30:00Z'), toFake: ['Date'] });

describe('MonthSelect', () => {
  it('marks the month "so far" in the zone the server names, redrawing when it arrives', () => {
    nearMonthEnd();
    render(<MonthSelect value="2026-07" onChange={() => undefined} />);
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Jul 2026 (so far)');

    act(() => setReportTimeZone('Asia/Makassar'));
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Aug 2026 (so far)');
  });

  it('offers the twelve months only, and the last 7 and 30 days only when it is asked for them, so Services never offers a window', () => {
    nearMonthEnd();
    const { unmount } = render(<MonthSelect value="2026-07" onChange={() => undefined} />);
    expect(document.querySelectorAll('optgroup')).toHaveLength(0);
    expect(screen.getAllByRole('option')).toHaveLength(12);
    expect(screen.queryByRole('option', { name: /^Last \d+ days$/ })).toBeNull();
    unmount();

    render(<MonthSelect rolling value="2026-07" onChange={() => undefined} />);
    // The twelve months, the two windows and the range view (ADR-0018).
    expect(screen.getAllByRole('option')).toHaveLength(15);
    expect(screen.getByRole('option', { name: 'Last 7 days' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Last 30 days' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Range and hours of the day' })).toBeInTheDocument();
  });
});

describe('RangePicker', () => {
  it('lists calendar months in the zone the server names, redrawing when it arrives', () => {
    nearMonthEnd();
    render(<RangePicker value={{ kind: 'hours', hours: 24 }} onChange={() => undefined} />);
    const first = () => screen.getByRole('combobox', { name: 'Calendar month' }).querySelectorAll('option')[1];
    expect(first()).toHaveTextContent('Jul 2026');

    act(() => setReportTimeZone('Asia/Makassar'));
    expect(first()).toHaveTextContent('Aug 2026');
  });
});

describe('gapsSummary', () => {
  const gap = { from: utc('2026-07-31T16:30:00Z'), to: utc('2026-07-31T18:30:00Z') };

  it('writes the spans in the report zone', () => {
    // Jakarta: 23:30 on 31 Jul to 01:30 on 1 Aug. Makassar: both ends on 1 Aug.
    expect(gapsSummary([gap])).toBe('2 hours with no collected data: 31 Jul 23:30 \u2013 1 Aug 01:30');
    setReportTimeZone('Asia/Makassar');
    expect(gapsSummary([gap])).toBe('2 hours with no collected data: 1 Aug 00:30\u201302:30');
  });

  it('says one hour in the singular, and a span under an hour in minutes', () => {
    const hour = { from: utc('2026-07-31T10:00:00Z'), to: utc('2026-07-31T11:00:00Z') };
    expect(gapsSummary([hour])).toBe('1 hour with no collected data: 31 Jul 17:00\u201318:00');
    const twenty = { from: utc('2026-07-31T10:00:00Z'), to: utc('2026-07-31T10:20:00Z') };
    expect(gapsSummary([twenty])).toBe('20 minutes with no collected data: 31 Jul 17:00\u201317:20');
  });
});

describe('GapsNote with spans declared not measured (IN-39)', () => {
  const gap = { from: utc('2026-07-31T16:30:00Z'), to: utc('2026-07-31T18:30:00Z') };
  // 16:10 to 21:03 in Jakarta, when the collector ran outside HCML's network.
  const declared = { from: utc('2026-10-26T09:10:00Z'), to: utc('2026-10-26T14:03:00Z') };
  const note = () => document.querySelector('.sli-gaps');

  it('names them in the words of the method in use', () => {
    const { rerender } = render(<GapsNote gaps={[]} windows={[declared]} profile="availability" />);
    expect(note()).toHaveTextContent('Excluded 5 hours the portal is set to treat as not measured: 26 Oct 16:10\u201321:03.');
    rerender(<GapsNote gaps={[]} windows={[declared]} profile="hcml-report" />);
    expect(note()).toHaveTextContent(
      'Counted as up by the HCML method: 5 hours the portal is set to treat as not measured: 26 Oct 16:10\u201321:03.',
    );
  });

  it('puts the gaps first, and shows nothing when there are neither', () => {
    const { rerender } = render(<GapsNote gaps={[gap]} windows={[declared]} profile="availability" />);
    expect(note()).toHaveTextContent(
      'Excluded 2 hours with no collected data: 31 Jul 23:30 \u2013 1 Aug 01:30. Excluded 5 hours the portal is set to treat as not measured: 26 Oct 16:10\u201321:03.',
    );
    rerender(<GapsNote gaps={[]} windows={[]} profile="availability" />);
    expect(note()).toBeNull();
  });
});

describe('the pages that name the zone', () => {
  // The zone is set by hand below. The health answer that would set it never comes, so it cannot race the test.
  const never = () => new Promise<never>(() => undefined);
  const quietBackend = (source: Partial<SlaSource> = {}) => {
    vi.spyOn(api, 'health').mockImplementation(never);
    vi.spyOn(api, 'slaSource').mockResolvedValue({ real: false, slas: 0, services: 0, ...source } as SlaSource);
    vi.spyOn(api, 'sla').mockImplementation(never);
    vi.spyOn(api, 'sli').mockImplementation(never);
    vi.spyOn(api, 'availability').mockImplementation(never);
  };

  it('tells the derived SLA reader which zone the months are cut in, and follows the server', async () => {
    quietBackend();
    render(
      <MemoryRouter>
        <Sla />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/monthly in Asia\/Jakarta time/)).toBeInTheDocument();

    act(() => setReportTimeZone('Asia/Makassar'));
    expect(screen.getByText(/monthly in Asia\/Makassar time/)).toBeInTheDocument();
    expect(screen.queryByText(/Asia\/Jakarta/)).toBeNull();
  });

  it('names the zone on the calendar months of the SLA period, and follows the server', () => {
    quietBackend();
    const { container } = render(
      <MemoryRouter>
        <Sla />
      </MemoryRouter>,
    );
    const label = () => container.querySelector('optgroup[label^="Calendar month"]')?.getAttribute('label');
    expect(label()).toBe('Calendar month (Asia/Jakarta)');

    act(() => setReportTimeZone('Asia/Makassar'));
    expect(label()).toBe('Calendar month (Asia/Makassar)');
  });
});
