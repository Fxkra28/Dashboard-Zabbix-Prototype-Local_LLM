import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_REPORT_TZ,
  formatDateTime,
  monthBounds,
  monthOf,
  recentMonths,
  reportTimeZone,
  setReportTimeZone,
  subscribeReportTimeZone,
  zoneLabel,
} from './time';
import { fmtTime } from './severity';

/**
 * The reporting zone is the server's SLA_TIMEZONE, which the
 * web app learns from /api/health; Asia/Jakarta is only the default. Times from
 * Zabbix are shown in it, with its label, instead of in the browser's own zone.
 */

const utc = (iso: string) => Date.parse(iso) / 1000;

afterEach(() => {
  setReportTimeZone(undefined);
  vi.useRealTimers();
});

describe('the report zone', () => {
  it('is Asia/Jakarta until the server says otherwise', () => {
    expect(reportTimeZone()).toBe('Asia/Jakarta');
    expect(DEFAULT_REPORT_TZ).toBe('Asia/Jakarta');
  });

  it('moves every month calculation to the zone the server named', () => {
    expect(monthBounds('2026-08')).toEqual({ from: utc('2026-07-31T17:00:00Z'), to: utc('2026-08-31T17:00:00Z') });

    setReportTimeZone('Asia/Makassar');

    expect(reportTimeZone()).toBe('Asia/Makassar');
    expect(monthBounds('2026-08')).toEqual({ from: utc('2026-07-31T16:00:00Z'), to: utc('2026-08-31T16:00:00Z') });
    // 16:30 UTC on 31 July is already August in Makassar (UTC+8) and still July in Jakarta (UTC+7).
    expect(monthOf(utc('2026-07-31T16:30:00Z'))).toBe('2026-08');
    vi.useFakeTimers({ now: Date.parse('2026-07-31T16:30:00Z') });
    expect(recentMonths(2)).toEqual(['2026-08', '2026-07']);
    setReportTimeZone(undefined);
    expect(recentMonths(2)).toEqual(['2026-07', '2026-06']);
  });

  it('ignores a value that is missing or is not a time zone this browser knows', () => {
    setReportTimeZone('Asia/Makassar');
    for (const bad of [undefined, null, '', 42, 'Mars/Olympus_Mons']) {
      setReportTimeZone(bad);
      expect(reportTimeZone(), String(bad)).toBe('Asia/Jakarta');
      setReportTimeZone('Asia/Makassar');
    }
  });

  it('tells a subscriber when the zone changes, and only then', () => {
    const seen = vi.fn();
    const stop = subscribeReportTimeZone(seen);

    setReportTimeZone('Asia/Jakarta'); // no change
    expect(seen).not.toHaveBeenCalled();
    setReportTimeZone('Asia/Makassar');
    expect(seen).toHaveBeenCalledTimes(1);
    setReportTimeZone('Asia/Makassar');
    expect(seen).toHaveBeenCalledTimes(1);

    stop();
    setReportTimeZone('Asia/Jakarta');
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('labelling a time', () => {
  const at = Date.parse('2026-09-17T08:00:00Z');

  it('names the three Indonesian zones the way Indonesians do, and others by their offset', () => {
    expect(zoneLabel(at, 'Asia/Jakarta')).toBe('WIB');
    expect(zoneLabel(at, 'Asia/Makassar')).toBe('WITA');
    expect(zoneLabel(at, 'Asia/Jayapura')).toBe('WIT');
    expect(zoneLabel(at, 'Europe/London')).toBe('GMT+1');
    expect(zoneLabel(at, 'UTC')).toBe('UTC');
  });

  it('writes the time in the report zone and ends it with the label', () => {
    // 08:00 UTC is 15:00 in Jakarta; the digits follow the browser's locale, the zone does not.
    expect(formatDateTime(at)).toMatch(/(3:00:00 PM|15:00:00) WIB$/);
    setReportTimeZone('Asia/Makassar');
    expect(formatDateTime(at)).toMatch(/(4:00:00 PM|16:00:00) WITA$/);
  });

  it('is what the portal shows for an event time: the zone of the server, not of the browser', () => {
    const clock = at / 1000;
    expect(fmtTime(clock)).toMatch(/(3:00:00 PM|15:00:00) WIB$/);
    expect(fmtTime(String(clock))).toBe(fmtTime(clock));
    // No time at all gets no zone label either.
    expect(fmtTime(0)).not.toMatch(/WIB/);
    expect(fmtTime(undefined)).not.toMatch(/WIB/);
    setReportTimeZone('Europe/London');
    expect(fmtTime(clock)).toMatch(/(9:00:00 AM|09:00:00) GMT\+1$/);
  });
});
