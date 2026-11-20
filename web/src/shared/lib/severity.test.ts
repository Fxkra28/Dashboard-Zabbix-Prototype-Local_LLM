import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ago, duration, fmtTime, fmtValue } from './severity';
import { formatValue } from './units';

/** The words for an age, a duration and a value (FR-76). The age is counted by the server's clock (clock.test.ts says how it is learned). */

const NOW = Date.parse('2026-11-19T04:00:00Z') / 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => vi.useRealTimers());

describe('ago', () => {
  it('says seconds under a minute, minutes with their seconds, hours with their minutes, days with their hours', () => {
    expect(ago(NOW - 5)).toBe('5s ago');
    expect(ago(NOW - 59)).toBe('59s ago');
    expect(ago(NOW - 60)).toBe('1m 0s ago');
    expect(ago(NOW - 3_599)).toBe('59m 59s ago');
    expect(ago(NOW - 3_600)).toBe('1h 0m ago');
    expect(ago(NOW - 86_399)).toBe('23h 59m ago');
    expect(ago(NOW - 86_400)).toBe('1d 0h ago');
    expect(ago(NOW - 3 * 86_400 - 5 * 3_600)).toBe('3d 5h ago');
  });

  it('takes the clock of Zabbix as the text it comes as', () => {
    expect(ago(String(NOW - 120))).toBe('2m 0s ago');
  });

  it('says 0s for a moment that has not come, which a clock a little off would otherwise print as a minus', () => {
    expect(ago(NOW + 30)).toBe('0s ago');
  });
});

describe('duration', () => {
  it('counts an open problem up to now', () => {
    expect(duration(NOW - 3_700)).toBe('1h 1m');
    expect(duration(NOW - 3_700, '0')).toBe('1h 1m');
    expect(duration(String(NOW - 90), undefined)).toBe('1m 30s');
  });

  it('counts a resolved problem from its onset to its recovery, whatever the time now is', () => {
    expect(duration(NOW - 10_000, NOW - 9_000)).toBe('16m 40s');
    expect(duration(String(NOW - 10_000), String(NOW - 9_940))).toBe('1m 0s');
  });
});

describe('fmtTime', () => {
  it('is a dash for no clock, or the zero that Zabbix gives for none', () => {
    expect(fmtTime(undefined)).toBe('—');
    expect(fmtTime(0)).toBe('—');
    expect(fmtTime('0')).toBe('—');
  });

  it('is the date and time in the report zone, with the zone named', () => {
    expect(fmtTime(NOW)).toMatch(/WIB/);
  });
});

describe('fmtValue', () => {
  it('is a dash for nothing: not given, empty, null', () => {
    expect(fmtValue(undefined)).toBe('—');
    expect(fmtValue('')).toBe('—');
    expect(fmtValue(null)).toBe('—');
  });

  it('is the text itself for a value that is not a number, such as the state an item reports', () => {
    expect(fmtValue('Up')).toBe('Up');
    expect(fmtValue('link down (2)', 'B')).toBe('link down (2)');
    expect(fmtValue('NaN')).toBe('NaN');
    expect(fmtValue('Infinity')).toBe('Infinity');
  });

  it('formats a number, given as a number or as the text of one, with its unit', () => {
    expect(fmtValue(1_234_567, 'bps')).toBe(formatValue(1_234_567, 'bps'));
    expect(fmtValue('1234567', 'bps')).toBe(formatValue(1_234_567, 'bps'));
    expect(fmtValue('0', '%')).toBe(formatValue(0, '%'));
    expect(fmtValue(0)).toBe(formatValue(0, undefined));
  });
});
