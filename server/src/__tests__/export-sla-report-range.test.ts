import { describe, expect, it } from 'vitest';
import { buildSlaReportDoc, durationText } from '../export/slaReport.js';
import { fileFor } from '../services/sliExport.js';
import type { SliReport } from '../sli/engine.js';
import { readZip } from './helpers/readZip.js';
import { sampleRangeReports, sampleSliReports } from './helpers/sliReportFixture.js';

/**
 * The SLA file for a range of days (FR-60): the same tables as the month's file, with the range, and the hours of the day that were counted, said where
 * a reader looks first. The reports are the fixture's, bent into the shape `getWindowSli` gives: no month, no web checks.
 */

const at = (iso: string) => Date.parse(iso) / 1000;
const HOURS = { start: 8, end: 17, weekdays: [1, 2, 3, 4, 5], seconds: 5 * 9 * 3600 };
const NOW = new Date('2026-09-17T03:00:00Z');

const docOf = (change: Partial<SliReport> = {}) => {
  const { strict, hcml } = sampleRangeReports(change);
  return buildSlaReportDoc(strict, hcml, NOW);
};
const noteLines = (doc: ReturnType<typeof docOf>) => doc.notes.flatMap((n) => n.lines);

describe('a range in the report', () => {
  it('is named by its dates, and is a period, not a month', () => {
    const doc = docOf();
    expect(doc.fileBase).toBe('HCML_SLA_Report_2026-08-03_to_2026-08-09');
    expect(doc.subtitle).toBe('3 Aug 2026 to 9 Aug 2026');
    expect(doc.period).toContain('Period closed.');
  });

  it('says which hours were counted in the subtitle, the period line and the name, so two files of the same days differ', () => {
    const plain = docOf();
    const doc = docOf({ dailyHours: HOURS });
    expect(doc.subtitle).toBe('3 Aug 2026 to 9 Aug 2026, 08:00 to 17:00, Monday to Friday');
    expect(doc.period).toContain(`Counted 08:00 to 17:00, Monday to Friday (${durationText(HOURS.seconds)}).`);
    expect(doc.fileBase).toBe('HCML_SLA_Report_2026-08-03_to_2026-08-09_0800-1700_d12345');
    expect(doc.footer).toContain('08:00 to 17:00');
    expect(doc.fileBase).not.toBe(plain.fileBase);
  });

  it('words an overnight span and a single weekday the way the page does', () => {
    expect(docOf({ dailyHours: { start: 22, end: 6, weekdays: null, seconds: 7 * 8 * 3600 } }).subtitle).toContain('22:00 to 06:00 the next morning, every day');
    expect(docOf({ dailyHours: { start: 0, end: 24, weekdays: [6, 7], seconds: 2 * 24 * 3600 } }).subtitle).toContain('all day, Saturday and Sunday');
  });

  it('does not take a month in daily hours for the plain month, which has the web checks', () => {
    const plain = buildSlaReportDoc(sampleSliReports().strict, sampleSliReports().hcml, NOW);
    const hours = docOf({ month: '2026-08', from: sampleSliReports().strict.from, to: sampleSliReports().strict.to, end: sampleSliReports().strict.to, dailyHours: HOURS });
    expect(plain.fileBase).toBe('HCML_SLA_Report_2026-08');
    expect(hours.fileBase).toBe('HCML_SLA_Report_2026-08_0800-1700_d12345');
    expect(hours.subtitle).toBe('August 2026, 08:00 to 17:00, Monday to Friday');
    expect(hours.period).toContain('Month closed.');
  });

  it('does not call itself monthly, and measures coverage against what it counted', () => {
    const lines = noteLines(docOf());
    expect(lines.some((l) => l.includes('monthly in'))).toBe(false);
    expect(lines.some((l) => l.includes('for the period chosen, in Asia/Jakarta time'))).toBe(true);
    expect(lines).toContain('Coverage is the share of the period in which the ping check collected data, not counting planned maintenance.');
    expect(noteLines(docOf({ dailyHours: HOURS }))).toContain('Coverage is the share of the counted hours in which the ping check collected data, not counting planned maintenance.');

    const month = noteLines(buildSlaReportDoc(sampleSliReports().strict, sampleSliReports().hcml, NOW));
    expect(month.some((l) => l.includes('monthly in Asia/Jakarta time'))).toBe(true);
    expect(month).toContain('Coverage is the share of the month in which the ping check collected data, not counting planned maintenance.');
  });

  it('keeps the Web checks table and says why it is empty, since web checks are measured by calendar month', () => {
    const web = docOf().tables.find((t) => t.title === 'Web checks')!;
    expect(web.rows).toHaveLength(0);
    expect(web.caption).toContain('Web checks are measured by calendar month, so a file for a range has none: choose a month for them.');
    expect(web.empty).toBe('A range has no web checks: they are measured by calendar month.');
    const month = buildSlaReportDoc(sampleSliReports().strict, sampleSliReports().hcml, NOW).tables.find((t) => t.title === 'Web checks')!;
    expect(month.empty).toBe('No web scenarios measured in this period.');
  });

  it('says so when the range has not ended: figures so far', () => {
    const doc = docOf({ closed: false, end: at('2026-08-06T12:00:00+07:00') });
    expect(doc.period).toContain('Period so far');
    expect(noteLines(doc)).toContain('This period is still running: figures so far.');
  });

  it('builds a PDF, a workbook and the CSV package from it, with the tables of a month', () => {
    const { strict, hcml } = sampleRangeReports({ dailyHours: HOURS });
    const monthTables = sampleSliReports();
    const pdf = fileFor('pdf', strict, hcml, NOW);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const xlsx = fileFor('xlsx', strict, hcml, NOW);
    expect([...readZip(xlsx).keys()]).toContain('xl/workbook.xml');
    const range = [...readZip(fileFor('csv', strict, hcml, NOW)).keys()];
    const month = [...readZip(fileFor('csv', monthTables.strict, monthTables.hcml, NOW)).keys()];
    expect(range).toHaveLength(month.length);
    expect(range.every((name) => name.startsWith('HCML_SLA_Report_2026-08-03_to_2026-08-09_0800-1700_d12345'))).toBe(true);
  });
});
