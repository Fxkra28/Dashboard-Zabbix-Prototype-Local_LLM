import { describe, expect, it } from 'vitest';
import { fileFor } from '../services/sliExport.js';
import { sampleRangeReports, sampleSliReports } from './helpers/sliReportFixture.js';

/**
 * A file built for a report is reused for ten seconds, so that a burst of downloads of one window costs one build, and is built again after that or for another report, another format or
 * another style (BK-102: the reuse of a window report's file had no test).
 */

const T0 = new Date('2026-09-17T03:00:00Z');
const after = (ms: number) => new Date(T0.getTime() + ms);

describe('the file built for a range report', () => {
  it('is the same file, not a copy, when the same two reports are asked for again within ten seconds', () => {
    const { strict, hcml } = sampleRangeReports();
    const first = fileFor('csv', strict, hcml, T0);
    expect(fileFor('csv', strict, hcml, after(1_000))).toBe(first);
    expect(fileFor('csv', strict, hcml, after(9_999))).toBe(first);
  });

  it('is built again at ten seconds, from the same reports', () => {
    const { strict, hcml } = sampleRangeReports();
    const first = fileFor('xlsx', strict, hcml, T0);
    const again = fileFor('xlsx', strict, hcml, after(10_000));
    expect(again).not.toBe(first);
    // And the new one is kept in its turn.
    expect(fileFor('xlsx', strict, hcml, after(12_000))).toBe(again);
  });

  it('is a file of its own for another window, since the reports of a window are objects of their own', () => {
    const one = sampleRangeReports();
    const other = sampleRangeReports({ to: one.strict.to + 86_400 });
    expect(fileFor('csv', other.strict, other.hcml, T0)).not.toBe(fileFor('csv', one.strict, one.hcml, T0));
  });

  it('is a file of its own for each format, and for a report that was read again (a new object)', () => {
    const { strict, hcml } = sampleRangeReports();
    const csv = fileFor('csv', strict, hcml, T0);
    expect(fileFor('pdf', strict, hcml, T0)).not.toBe(csv);
    const refreshed = sampleRangeReports();
    expect(fileFor('csv', refreshed.strict, refreshed.hcml, after(1_000))).not.toBe(csv);
  });

  it('is told apart by the style that changes it: the decimal and the date for a PDF, the separator too for a CSV', () => {
    const { strict, hcml } = sampleRangeReports();
    const dot = { decimal: 'dot', date: 'long', separator: 'comma' } as const;
    const comma = { ...dot, decimal: 'comma' } as const;
    const semicolon = { ...dot, separator: 'semicolon' } as const;
    const pdf = fileFor('pdf', strict, hcml, T0, dot);
    expect(fileFor('pdf', strict, hcml, T0, comma)).not.toBe(pdf);
    // A PDF has no separator, so asking with the other one is the same file.
    expect(fileFor('pdf', strict, hcml, T0, semicolon)).toBe(pdf);
    const csv = fileFor('csv', strict, hcml, T0, dot);
    expect(fileFor('csv', strict, hcml, T0, semicolon)).not.toBe(csv);
  });

  it('is the same for a month as for a range: nothing keeps the one apart from the other but the reports', () => {
    const month = sampleSliReports();
    const first = fileFor('pdf', month.strict, month.hcml, T0);
    expect(fileFor('pdf', month.strict, month.hcml, after(5_000))).toBe(first);
  });
});
