import { describe, expect, it } from 'vitest';
import { checkPeriodStart, currentMonth, monthBounds, monthOf, parseMonth, previousMonth } from '../sli/time.js';
import { BadRequestError } from '../core/validate.js';

/**
 * HCML's reports cut months at midnight Asia/Jakarta (UTC+7). An event at
 * 23:30 WIB on the 31st belongs to that month although its UTC clock already
 * reads the next day, so a UTC month boundary would move seven hours of
 * events into the wrong report.
 */
describe('monthBounds', () => {
  it('cuts calendar months at midnight Asia/Jakarta', () => {
    expect(monthBounds('2026-06', 'Asia/Jakarta')).toEqual({ from: 1780246800, to: 1782838800 });
    expect(monthBounds('2026-07', 'Asia/Jakarta')).toEqual({ from: 1782838800, to: 1785517200 });
    expect(monthBounds('2026-08', 'Asia/Jakarta')).toEqual({ from: 1785517200, to: 1788195600 });
  });

  it('rolls December over into January of the next year', () => {
    const dec = monthBounds('2026-12', 'Asia/Jakarta');
    expect(dec.to).toBe(monthBounds('2027-01', 'Asia/Jakarta').from);
    expect(dec.to - dec.from).toBe(31 * 86400);
  });

  it('stays correct across a daylight-saving change', () => {
    // Europe/Berlin moves to summer time on the last Sunday of March.
    const march = monthBounds('2026-03', 'Europe/Berlin');
    expect(march.to - march.from).toBe(31 * 86400 - 3600);
    expect(new Date(march.to * 1000).toISOString()).toBe('2026-03-31T22:00:00.000Z');
  });
});

describe('parseMonth', () => {
  it.each(['2026-13', '26-08', '2026-8', '', 'August', undefined])('rejects %s', (bad) => {
    expect(() => parseMonth(bad)).toThrow(BadRequestError);
  });

  it('accepts YYYY-MM', () => {
    expect(parseMonth('2026-08')).toBe('2026-08');
  });
});

describe('month helpers', () => {
  it('names the month an instant falls in, in the zone', () => {
    // 2026-08-31 23:30 WIB is still August in Jakarta, already September in UTC.
    const t = Date.UTC(2026, 7, 31, 16, 30) / 1000;
    expect(monthOf(t, 'Asia/Jakarta')).toBe('2026-08');
    expect(monthOf(t + 3600, 'Asia/Jakarta')).toBe('2026-09');
    expect(currentMonth('Asia/Jakarta')).toMatch(/^\d{4}-\d{2}$/);
  });

  it('steps back a month, across a year', () => {
    expect(previousMonth('2026-08')).toBe('2026-07');
    expect(previousMonth('2026-01')).toBe('2025-12');
  });
});

describe('checkPeriodStart', () => {
  const now = 1_790_000_000;
  const DAY = 86400;

  it('accepts a period that has started, from one second ago back to 400 days ago', () => {
    expect(() => checkPeriodStart(now - 1, now)).not.toThrow();
    expect(() => checkPeriodStart(now - 400 * DAY, now)).not.toThrow();
  });

  it('refuses a period that has not started yet, or starts this very second, in a sentence', () => {
    expect(() => checkPeriodStart(now, now)).toThrow(new BadRequestError('That period has not started yet.'));
    expect(() => checkPeriodStart(now + 1, now)).toThrow(new BadRequestError('That period has not started yet.'));
  });

  it('refuses a period that began more than 400 days ago, in a sentence', () => {
    expect(() => checkPeriodStart(now - 400 * DAY - 1, now)).toThrow(new BadRequestError('Zabbix keeps events for about a year; pick a later period.'));
  });
});
