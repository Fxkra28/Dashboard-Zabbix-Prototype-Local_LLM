import { describe, expect, it } from 'vitest';
import { dur, formatDuration, formatValue, formatPercent } from './units';

describe('formatPercent', () => {
  it('writes each measure with its own decimals', () => {
    expect(formatPercent(99.384, 'availability')).toBe('99.38%');
    expect(formatPercent(12.345, 'loss')).toBe('12.35%');
    expect(formatPercent(47.26, 'utilisation')).toBe('47.3%');
  });

  it('shows a dash for a figure it does not have', () => {
    expect(formatPercent(null, 'availability')).toBe('\u2014');
    expect(formatPercent(undefined, 'loss')).toBe('\u2014');
    expect(formatPercent(Number.NaN, 'utilisation')).toBe('\u2014');
  });

  it('never rounds an availability below 100 up to 100 (BK-46)', () => {
    expect(formatPercent(99.9951, 'availability')).toBe('99.99%');
    expect(formatPercent(99.99999, 'availability')).toBe('99.99%');
    expect(formatPercent(100, 'availability')).toBe('100.00%');
    expect(formatPercent(99.994, 'availability')).toBe('99.99%');
  });

  it('leaves the other measures as the number of decimals rounds them', () => {
    expect(formatPercent(99.9951, 'loss')).toBe('100.00%');
    expect(formatPercent(99.96, 'utilisation')).toBe('100.0%');
  });
});

describe('the unit is chosen after the rounding (FR-36)', () => {
  it.each([
    [999_999, 'bps', '1 Mbps'],
    [999_000, 'bps', '999 Kbps'],
    [999_949, 'bps', '999.9 Kbps'],
    [1_000_000, 'bps', '1 Mbps'],
    [999.96, 'bps', '1 Kbps'],
    [999_999_999, 'bps', '1 Gbps'],
    [-999_999, 'bps', '-1 Mbps'],
    [1_048_575, 'B', '1 MB'],
    [1_048_576, 'B', '1 MB'],
    [1_048_000, 'B', '1023.4 KB'],
    [1023.999, 'B', '1 KB'],
    [1_073_741_823, 'B', '1 GB'],
    [1_048_575, 'B/s', '1 MB/s'],
  ])('prints %s %s as %s', (value, unit, text) => {
    expect(formatValue(value, unit)).toBe(text);
  });

  it.each([
    [999.96, '1 s'],
    [999.4, '999 ms'],
    [1000, '1 s'],
    [0.5, '0.5 ms'],
    [12.345, '12.35 ms'],
    [100, '100 ms'],
  ])('prints %s ms as %s', (value, text) => {
    expect(formatValue(value, 'ms')).toBe(text);
  });

  it.each([
    [0.9999, '1 s'],
    [0.5, '500 ms'],
    [59.5, '59.5 s'],
    [59.999, '1 min'],
    [60, '1 min'],
    [3599.9, '1 h'],
    [3599, '1 h'],
    [1800, '30 min'],
    [0, '0 s'],
  ])('prints %s s as %s', (value, text) => {
    expect(formatValue(value, 's')).toBe(text);
  });

  it.each([
    [59, '59s'],
    [59.6, '1m'],
    [3510, '59m'],
    [3570, '1.0h'],
    [3599, '1.0h'],
    [3600, '1.0h'],
    [86399, '1.0d'],
    [86400, '1.0d'],
    [5400, '1.5h'],
    [-3599, '\u22121.0h'],
  ])('shows %s seconds as %s', (value, text) => {
    expect(dur(value)).toBe(text);
  });

  it('keeps the long form of a duration as it was', () => {
    expect(formatDuration(3599)).toBe('59m 59s');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(86399)).toBe('23h 59m');
  });
});


describe('formatValue for a unixtime item outside the dates a clock can show (FR-39)', () => {
  it.each([
    [8640000000001, '8,640,000,000,001'],
    // The largest 64-bit counter, as a number: the digits it can keep are fewer than it has.
    [Number('18446744073709551615'), '18,446,744,073,709,552,000'],
  ])('prints %s as the number instead of failing', (value, text) => {
    expect(formatValue(value, 'unixtime')).toBe(text);
  });

  it('still prints a date up to the last moment a clock can show, and a usual one', () => {
    expect(formatValue(8640000000000, 'unixtime')).toMatch(/275760/);
    expect(formatValue(4294967295, 'unixtime')).toMatch(/2106/);
    expect(formatValue(1790000000, 'unixtime')).toMatch(/2026/);
  });

  it('keeps the dash for zero, a negative number and what is not a number', () => {
    for (const v of [0, -5, null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatValue(v, 'unixtime')).toBe('—');
  });
});
