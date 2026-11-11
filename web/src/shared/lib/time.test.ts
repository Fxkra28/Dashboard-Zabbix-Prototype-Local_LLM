import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatIsoDateTime, isMonth, monthBounds, monthLabel, monthOf, recentMonths, zonedMonthStart } from './time';

const utc = (iso: string) => Date.parse(iso) / 1000;

afterEach(() => vi.useRealTimers());

describe('lib/time: reporting months in Asia/Jakarta', () => {
  it('bounds a month at local midnight, seven hours before UTC', () => {
    expect(monthBounds('2026-08')).toEqual({ from: utc('2026-07-31T17:00:00Z'), to: utc('2026-08-31T17:00:00Z') });
  });

  it('rolls December over into the next year', () => {
    expect(monthBounds('2026-12').to).toBe(utc('2026-12-31T17:00:00Z'));
  });

  it('follows the zone, not a fixed offset, across a clock change', () => {
    expect(zonedMonthStart(2026, 3, 'Europe/London')).toBe(utc('2026-03-01T00:00:00Z'));
    expect(zonedMonthStart(2026, 4, 'Europe/London')).toBe(utc('2026-03-31T23:00:00Z'));
  });

  it('puts an instant in the month Jakarta sees', () => {
    expect(monthOf(utc('2026-07-31T16:59:59Z'))).toBe('2026-07');
    expect(monthOf(utc('2026-07-31T17:00:00Z'))).toBe('2026-08');
  });

  it('accepts only a YYYY-MM month', () => {
    expect(isMonth('2026-08')).toBe(true);
    for (const bad of ['2026-13', '2026-00', '2026-8', '26-08', '', null, undefined]) expect(isMonth(bad), String(bad)).toBe(false);
    expect(() => monthBounds('2026-13')).toThrow('Bad month');
  });

  it('lists the current month and the ones before it, across a year end', () => {
    vi.useFakeTimers({ now: Date.parse('2026-01-10T00:00:00Z') });
    expect(recentMonths(3)).toEqual(['2026-01', '2025-12', '2025-11']);
  });

  it('labels a month the way the pickers show it', () => {
    expect(monthLabel('2026-08')).toBe('Aug 2026');
  });
});

describe('lib/time: formatIsoDateTime', () => {
  const at = Date.parse('2026-10-19T07:05:09Z');

  it('writes the digits of the report zone, year first, with two digits for each field', () => {
    expect(formatIsoDateTime(at, 'Asia/Jakarta')).toBe('2026-10-19 14:05:09');
    expect(formatIsoDateTime(at, 'UTC')).toBe('2026-10-19 07:05:09');
    expect(formatIsoDateTime(Date.parse('2026-01-02T03:04:05Z'), 'UTC')).toBe('2026-01-02 03:04:05');
  });

  it('writes midnight as 00, not 24, and crosses the date line with the zone', () => {
    expect(formatIsoDateTime(Date.parse('2026-10-18T17:00:00Z'), 'Asia/Jakarta')).toBe('2026-10-19 00:00:00');
    expect(formatIsoDateTime(Date.parse('2026-10-19T00:00:00Z'), 'UTC')).toBe('2026-10-19 00:00:00');
  });

  it('follows a zone with daylight saving, so a clock change does not repeat or skip a label', () => {
    // New York leaves daylight saving on 2026-11-01 at 02:00 local: 05:59:59Z is 01:59:59 EDT, 06:00:00Z is 01:00:00 EST.
    expect(formatIsoDateTime(Date.parse('2026-11-01T05:59:59Z'), 'America/New_York')).toBe('2026-11-01 01:59:59');
    expect(formatIsoDateTime(Date.parse('2026-11-01T06:00:00Z'), 'America/New_York')).toBe('2026-11-01 01:00:00');
  });
});
