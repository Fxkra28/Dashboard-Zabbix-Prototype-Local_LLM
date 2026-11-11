import { inflateRawSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildPdf } from '../export/pdf.js';
import type { ReportDoc, Table } from '../export/types.js';
import { buildXlsx } from '../export/xlsx.js';
import { sampleDoc } from './helpers/docFixture.js';

/**
 * Both writers read one ReportDoc, so on awkward input they have to say the
 * same thing: a report that shows an empty table in the PDF and drops it in the
 * workbook would disagree with itself. Each writer's own tests cover its own
 * rules; this file feeds both the same documents.
 */

const NOW = new Date('2026-10-01T07:20:00Z');

/** Every content stream of the PDF, inflated, as latin1 text. */
function pdfContent(pdf: Buffer): string {
  let out = '';
  for (const m of pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      out += inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
    } catch {
      // The logo's image streams are not text and need not inflate to anything readable.
    }
  }
  return out;
}

/** The workbook's shared strings, read through the zip's central directory. */
function sharedStrings(xlsx: Buffer): string {
  const end = xlsx.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = xlsx.readUInt16LE(end + 10);
  let at = xlsx.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = xlsx.readUInt16LE(at + 10);
    const size = xlsx.readUInt32LE(at + 20);
    const nameLength = xlsx.readUInt16LE(at + 28);
    const skip = xlsx.readUInt16LE(at + 30) + xlsx.readUInt16LE(at + 32);
    const local = xlsx.readUInt32LE(at + 42);
    const name = xlsx.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    if (name === 'xl/sharedStrings.xml') {
      const start = local + 30 + xlsx.readUInt16LE(local + 26) + xlsx.readUInt16LE(local + 28);
      const raw = xlsx.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(raw) : raw).toString('utf8');
    }
    at += 46 + nameLength + skip;
  }
  throw new Error('no shared strings in the workbook');
}

const withTable = (table: Table): ReportDoc => ({ ...sampleDoc(), kpis: [], chart: undefined, notes: [], tables: [table] });

const emptyTable = (over: Partial<Table> = {}): Table => ({
  title: 'Nothing here',
  sheet: 'Nothing here',
  columns: [
    { header: 'Device', kind: 'text', weight: 4 },
    { header: 'SLA', kind: 'percent', weight: 2 },
  ],
  rows: [],
  footer: [{ text: 'FOOTER-MARK-77' }, { text: '99.99%', n: 99.99 }],
  ...over,
});

describe('the two writers treat the same awkward document the same way', () => {
  it('a table with no rows shows the default message, and neither draws its footer', () => {
    const doc = withTable(emptyTable());
    const pdf = pdfContent(buildPdf(doc, NOW));
    const strings = sharedStrings(buildXlsx(doc, NOW));
    expect(pdf).toContain('(Nothing to list.)');
    expect(strings).toContain('Nothing to list.');
    expect(pdf).not.toContain('FOOTER-MARK-77');
    expect(strings).not.toContain('FOOTER-MARK-77');
  });

  it('a table with no rows shows its own message when it has one', () => {
    const doc = withTable(emptyTable({ empty: 'No web checks are configured in Zabbix.' }));
    expect(pdfContent(buildPdf(doc, NOW))).toContain('(No web checks are configured in Zabbix.)');
    expect(sharedStrings(buildXlsx(doc, NOW))).toContain('No web checks are configured in Zabbix.');
    expect(pdfContent(buildPdf(doc, NOW))).not.toContain('Nothing to list.');
  });

  it('a table with rows still draws its footer in both', () => {
    const doc = withTable(emptyTable({ rows: [[{ text: 'Alpha' }, { text: '99.00%', n: 99 }]] }));
    expect(pdfContent(buildPdf(doc, NOW))).toContain('FOOTER-MARK-77');
    expect(sharedStrings(buildXlsx(doc, NOW))).toContain('FOOTER-MARK-77');
  });

  it('a table with no columns is refused, with the same words', () => {
    const doc = withTable(emptyTable({ columns: [], footer: undefined }));
    expect(() => buildPdf(doc, NOW)).toThrow(new Error('Table "Nothing here" has no columns.'));
    expect(() => buildXlsx(doc, NOW)).toThrow(new Error('Table "Nothing here" has no columns.'));
  });

  it.each([
    ['a date that holds NaN', new Date(Number.NaN)],
    ['something that is not a Date', '2026-10-01' as unknown as Date],
  ])('%s is refused as the report time, with the same words', (_label, now) => {
    const doc = sampleDoc();
    expect(() => buildPdf(doc, now)).toThrow(new RangeError('The report time is not a valid date.'));
    expect(() => buildXlsx(doc, now)).toThrow(new RangeError('The report time is not a valid date.'));
  });
});
