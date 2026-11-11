import { describe, expect, it } from 'vitest';
import { percentText } from './percent';
import { fmtPct } from './Sli';

// The first block is server/src/__tests__/export-sla-report.test.ts, case for case:
// the report and the page it came from must print the same digits.
describe('percentText', () => {
  it('prints two decimals, and keeps the ordinary figures as they were', () => {
    expect(percentText(99.384, 99)).toBe('99.38%');
    expect(percentText(99.386, 99)).toBe('99.39%');
    expect(percentText(100, 99)).toBe('100.00%');
    expect(percentText(0, 99)).toBe('0.00%');
    expect(percentText(99, 99)).toBe('99.00%');
    expect(percentText(99.004, 99)).toBe('99.00%');
  });

  it('never prints a missed figure as the target', () => {
    expect(percentText(98.996, 99)).not.toBe('99.00%');
    expect(percentText(98.996, 99)).toBe('98.996%');
  });

  it('adds digits only as far as it takes to stay below the target', () => {
    expect(percentText(98.99996, 99)).toBe('98.99996%');
    expect(percentText(98.9999996, 99)).toBe('98.9999996%');
  });

  it('cuts instead of rounding when even eight decimals reach the target', () => {
    expect(percentText(98.999999999, 99)).toBe('98.99999999%');
    // A float mean that falls one ulp short of the target, as the engine's group figures can.
    expect(percentText(98.99999999999999, 99)).toBe('98.99999999%');
  });

  it('keeps the digits a place asks for, and does not trim them', () => {
    expect(percentText(99.5, 99, 3)).toBe('99.500%');
    expect(percentText(99.5, 99, 4)).toBe('99.5000%');
  });

  it('starts from the digits a place asks for when it has to add more', () => {
    expect(percentText(98.9996, 99, 3)).toBe('98.9996%');
    expect(percentText(98.99996, 99, 4)).toBe('98.99996%');
  });

  it('reads the same side of the target as the real figure in both directions', () => {
    for (const value of [98.99, 98.995, 98.996, 98.9999, 99, 99.0001, 99.004, 99.005, 99.4999]) {
      const printed = Number(percentText(value, 99).replace('%', ''));
      expect(printed >= 99).toBe(value >= 99);
    }
  });
});

describe('a figure below 100 never reads as 100 (BK-46)', () => {
  it('is cut to the digits the text shows, in the guarded text', () => {
    expect(percentText(99.9951, 99)).toBe('99.99%');
    expect(percentText(99.995, 99)).toBe('99.99%');
    expect(percentText(99.99999, 99)).toBe('99.99%');
    expect(percentText(99.994, 99)).toBe('99.99%');
    expect(percentText(99.996, 100)).toBe('99.99%');
    expect(percentText(99.99996, 99, 4)).toBe('99.9999%');
  });

  it('leaves 100 and the figures that round to something else as they were', () => {
    expect(percentText(100, 99)).toBe('100.00%');
    expect(percentText(100, 100)).toBe('100.00%');
    expect(percentText(99.989, 99)).toBe('99.99%');
    expect(percentText(99.985, 99)).toBe('99.98%');
  });

  it('holds for every figure from 99.99 up to 100, as the report does', () => {
    for (let v = 99.99; v < 100; v += 0.0000037) expect(percentText(v, 99), String(v)).toBe('99.99%');
  });
});

describe('fmtPct', () => {
  it('is the plain figure without a target, and the guarded one with it', () => {
    expect(fmtPct(98.996)).toBe('99.00%');
    expect(fmtPct(98.996, 2, 99)).toBe('98.996%');
    expect(fmtPct(99.5, 2, 99)).toBe('99.50%');
    expect(fmtPct(99.5, 3, 99)).toBe('99.500%');
  });

  it('does not round a figure below 100 up to 100 without a target either (BK-46)', () => {
    expect(fmtPct(99.9951)).toBe('99.99%');
    expect(fmtPct(100)).toBe('100.00%');
    expect(fmtPct(99.9951, 3)).toBe('99.995%');
  });

  it('shows a dash for a missing figure', () => {
    expect(fmtPct(null, 2, 99)).toBe('\u2014');
    expect(fmtPct(undefined)).toBe('\u2014');
  });
});
