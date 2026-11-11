import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { dayInZone, formatClock, formatClockLabeled, formatDate, formatWeekdayDate, setReportTimeZone } from '../shared/lib/time';
import { momentWords, staleWhen } from '../shared/lib/freshness';
import { RefreshFailed } from '../shared/components/states';
import TodayDate from '../features/shell/TodayDate';

/**
 * Every clock the portal prints is the report zone's, with its name once it stands apart from a
 * time that has a zone beside it (FR-24, 1): the Dashboard, the Hosts view, the meters, the line that says a refresh
 * failed and the date at the top of every page. The browser here is in New York, so a clock left in the browser's own
 * zone shows 11:00, not 15:00 WIB.
 */
vi.stubEnv('TZ', 'America/New_York');

/** 08:00 UTC: 15:00 in Jakarta, 16:00 in Makassar, 04:00 in New York. */
const AT = Date.UTC(2026, 9, 7, 8, 0, 0);

afterEach(() => {
  setReportTimeZone(undefined);
  vi.useRealTimers();
});
afterAll(() => vi.unstubAllEnvs());

describe('the clock helpers', () => {
  it('write the clock of the report zone, with the seconds when asked, and follow the server', () => {
    expect(formatClock(AT)).toBe('15:00');
    expect(formatClock(AT + 5_000, true)).toBe('15:00:05');
    expect(formatClockLabeled(AT)).toBe('15:00 WIB');
    expect(formatClockLabeled(AT, true)).toBe('15:00:00 WIB');
    setReportTimeZone('Asia/Makassar');
    expect(formatClockLabeled(AT)).toBe('16:00 WITA');
  });

  it('write midnight as 00:00 and never as 24:00', () => {
    expect(formatClock(Date.UTC(2026, 9, 6, 17, 0, 0))).toBe('00:00');
  });

  it('name the day in the report zone, so a file made at 03:00 in Jakarta carries that day and not the UTC one', () => {
    const lateEvening = Date.UTC(2026, 9, 7, 20, 0, 0); // 03:00 on 8 October in Jakarta
    expect(dayInZone(lateEvening)).toBe('2026-10-08');
    expect(new Date(lateEvening).toISOString().slice(0, 10)).toBe('2026-10-07');
    setReportTimeZone('America/New_York');
    expect(dayInZone(lateEvening)).toBe('2026-10-07');
  });

  it('write the weekday date and the plain date in the report zone', () => {
    const lateEvening = Date.UTC(2026, 9, 7, 20, 0, 0);
    expect(formatWeekdayDate(lateEvening)).toBe('Thu, 8 Oct 2026');
    expect(formatDate(lateEvening)).toMatch(/^(10\/8\/2026|8\/10\/2026|08\/10\/2026|2026-10-08)$/);
  });
});

describe('momentWords and staleWhen', () => {
  it('give the clock with its zone for today, and the day before it for another day', () => {
    expect(momentWords(AT, AT + 3_600_000)).toBe('15:00 WIB');
    expect(momentWords(Date.UTC(2026, 9, 5, 8, 30, 0), AT)).toBe('5 Oct 15:30 WIB');
  });

  it('decide "today" by the report zone: 17:30 UTC and 18:30 UTC the evening before are on two days in Jakarta', () => {
    const now = Date.UTC(2026, 9, 7, 17, 30, 0); // 00:30 on the 8th in Jakarta
    expect(momentWords(Date.UTC(2026, 9, 7, 16, 30, 0), now)).toBe('7 Oct 23:30 WIB');
  });

  it('are what the stale-copy notices print', () => {
    expect(staleWhen(AT, AT + 72 * 60_000)).toBe('from 15:00 WIB (1 h 12 min ago)');
  });
});

describe('the line that says a refresh failed', () => {
  it('names the time of the data it still shows in the report zone', () => {
    render(<RefreshFailed error="boom" updatedAt={AT} />);
    expect(screen.getByRole('status')).toHaveTextContent('Refresh failed: showing data from 15:00 WIB');
  });

  it('says "earlier" when it does not know', () => {
    render(<RefreshFailed error="boom" />);
    expect(screen.getByRole('status')).toHaveTextContent('Refresh failed: showing data from earlier');
  });
});

describe('the date at the top of every page', () => {
  it('is the date in the report zone, and turns over at midnight there', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 7, 16, 59, 30)); // 23:59:30 on the 7th in Jakarta, 12:59 in New York
    render(<TodayDate />);
    expect(screen.getByText(formatDate(Date.UTC(2026, 9, 7, 16, 59, 30)))).toBeInTheDocument();
    const before = document.body.textContent;

    act(() => vi.advanceTimersByTime(60_000));
    expect(document.body.textContent).not.toBe(before);
    expect(screen.getByText(formatDate(Date.UTC(2026, 9, 7, 17, 0, 30)))).toBeInTheDocument();
  });
});
