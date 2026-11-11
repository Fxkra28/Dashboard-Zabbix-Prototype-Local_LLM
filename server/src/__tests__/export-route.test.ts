import { inflateRawSync } from 'node:zlib';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../core/cache.js';
import { registerCompression } from '../http/compress.js';
import { registerErrorHandler } from '../http/errors.js';
import { registerRateLimit } from '../http/rateLimit.js';
import { BadRequestError } from '../core/validate.js';
import { ZabbixApiError } from '../clients/zabbix.js';
import { sliExportRoutes } from '../routes/sliExport.js';
import { buildTestApp } from './helpers/app.js';
import { sampleSliReports } from './helpers/sliReportFixture.js';

/**
 * GET /api/sli/export through Fastify, with the real writers. Only the Zabbix
 * read behind getMonthlySli is replaced: it hands back the fixture's two
 * reports, so every byte of the file is the portal's own.
 */

const { sliMock } = vi.hoisted(() => ({ sliMock: vi.fn() }));
vi.mock('../services/sli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/sli.js')>();
  return { ...actual, getMonthlySli: sliMock };
});

const PDF_TYPE = 'application/pdf';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_TYPE = 'application/zip';
const TYPES = { pdf: PDF_TYPE, xlsx: XLSX_TYPE, csv: CSV_TYPE } as const;
const FORMATS = ['pdf', 'xlsx', 'csv'] as const;
const FILE = { pdf: 'HCML_SLA_Report_2026-08.pdf', xlsx: 'HCML_SLA_Report_2026-08.xlsx', csv: 'HCML_SLA_Report_2026-08_csv.zip' } as const;
const NOW = new Date('2026-09-17T03:00:00Z');

let reports = sampleSliReports();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  reports = sampleSliReports();
  sliMock.mockImplementation(async (_month: string, profile: string) => (profile === 'availability' ? reports.strict : reports.hcml));
});
afterEach(() => {
  vi.useRealTimers();
  sliMock.mockReset();
});

/** The package's central directory, read with plain Buffer calls so the test trusts nothing of the writer. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThanOrEqual(0);
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const skip = buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    at += 46 + nameLength + skip;
  }
  return out;
}

const disposition = (file: string) => `attachment; filename="${file}"; filename*=UTF-8''${file}`;

describe('GET /api/sli/export', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildTestApp(sliExportRoutes);
  });
  afterEach(() => app.close());

  const get = (query: string) => app.inject({ url: `/api/sli/export${query}` });

  it('sends the PDF as a download of the month asked for', async () => {
    const res = await get('?month=2026-08&format=pdf');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(PDF_TYPE);
    expect(res.headers['content-disposition']).toBe(disposition('HCML_SLA_Report_2026-08.pdf'));
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Number(res.headers['content-length'])).toBe(res.rawPayload.length);
    const text = res.rawPayload.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    // A newline may follow the end marker; nothing else may.
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(res.rawPayload.length).toBeGreaterThan(10_000);
  });

  it('sends the workbook as a download of the month asked for', async () => {
    const res = await get('?month=2026-08&format=xlsx');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(XLSX_TYPE);
    expect(res.headers['content-disposition']).toBe(disposition('HCML_SLA_Report_2026-08.xlsx'));
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Number(res.headers['content-length'])).toBe(res.rawPayload.length);
    expect([...res.rawPayload.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('packs a workbook whose [Content_Types].xml lists every sheet, each present in the package', async () => {
    const parts = unzip((await get('?month=2026-08&format=xlsx')).rawPayload);
    const types = parts.get('[Content_Types].xml')!.toString('utf8');
    const book = parts.get('xl/workbook.xml')!.toString('utf8');
    const sheets = [...book.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
    expect(sheets).toEqual(['Summary', 'By category', 'By site', 'By device', 'WAN paths', 'Web checks', 'Never measured']);
    sheets.forEach((_name, i) => {
      expect(types, `sheet ${i + 1}`).toContain(`PartName="/xl/worksheets/sheet${i + 1}.xml"`);
      expect(parts.has(`xl/worksheets/sheet${i + 1}.xml`), `sheet ${i + 1} part`).toBe(true);
    });
    // Listed and present, and nothing else posing as a sheet.
    expect([...types.matchAll(/PartName="\/xl\/worksheets\/sheet\d+\.xml"/g)]).toHaveLength(sheets.length);
  });

  it('puts the reports’ own figures in the workbook', async () => {
    const parts = unzip((await get('?month=2026-08&format=xlsx')).rawPayload);
    const strings = parts.get('xl/sharedStrings.xml')!.toString('utf8');
    for (const text of ['SLA availability report', 'August 2026', '2.2.3 SAMPLE SWITCH 03', 'Cisco IOS by SNMP', 'Sample public site']) {
      expect(strings, text).toContain(text);
    }
  });

  it('reads both methods for the month asked for, once each', async () => {
    await get('?month=2026-08&format=pdf');
    expect(sliMock.mock.calls.map((c) => c.slice(0, 2)).sort()).toEqual([
      ['2026-08', 'availability'],
      ['2026-08', 'hcml-report'],
    ]);
  });

  it.each(['?month=2026-13&format=pdf', '?month=2026-00&format=pdf', '?month=2026-8&format=pdf', '?month=August&format=pdf', '?month=2026-08-01&format=pdf', '?month=%202026-08&format=pdf'])(
    'answers 400 for a bad month: %s',
    async (query) => {
      const res = await get(query);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'bad_request', message: expect.stringContaining('YYYY-MM') });
      expect(res.headers['content-disposition']).toBeUndefined();
      expect(sliMock).not.toHaveBeenCalled();
    },
  );

  it('answers 400 for a month sent twice, saying so (BK-14)', async () => {
    const res = await get('?month=2026-08&month=2026-07&format=pdf');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad_request', message: 'month must be given once.' });
    expect(sliMock).not.toHaveBeenCalled();
  });

  it.each(['?month=2026-08', '?month=2026-08&format=', '?format=', ''])('answers 400 when no format is given: "%s"', async (query) => {
    const res = await get(query);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad_request', message: 'format must be "pdf", "xlsx" or "csv".' });
    expect(sliMock).not.toHaveBeenCalled();
  });

  it.each(['docx', 'zip', 'CSV', 'PDF', 'Xlsx', 'pdf,xlsx', 'pdf%20', '.pdf', '../pdf', 'csv.zip'])('answers 400 for the format "%s", before touching Zabbix', async (format) => {
    const res = await get(`?month=2026-08&format=${format}`);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad_request' });
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(sliMock).not.toHaveBeenCalled();
  });

  it('answers 400 for a format given twice', async () => {
    expect((await get('?month=2026-08&format=pdf&format=xlsx')).statusCode).toBe(400);
    expect(sliMock).not.toHaveBeenCalled();
  });

  it('names the file from the validated month alone, never from anything the reports claim', async () => {
    // The reports come back claiming another month, in the worst text a header could be handed.
    for (const r of [reports.strict, reports.hcml]) r.month = 'x"\r\nSet-Cookie: a=b';
    const res = await get('?month=2026-08&format=pdf');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe(disposition('HCML_SLA_Report_2026-08.pdf'));
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it.each([
    ['a file name', '?month=2026-08&format=pdf&filename=evil.exe'],
    ['a path', '?month=2026-08&format=pdf&name=../../etc/passwd'],
    ['a header split', '?month=2026-08&format=pdf&fileBase=%22%0d%0aX-Evil:1'],
    ['a misspelt month, which would otherwise be ignored and the current month served', '?mont=2026-08&format=pdf'],
    ['a bracketed month', '?month[]=2026-08&format=pdf'],
    ['a prototype key', '?__proto__[month]=2026-08&format=pdf'],
    ['a month beside an unknown parameter', '?month=2026-08&format=xlsx&profile=hcml-report'],
  ])('refuses %s before anything is read or sent', async (_label, query) => {
    const res = await get(query);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad_request', message: 'Only month, format, decimal, date and separator are accepted.' });
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.headers['x-evil']).toBeUndefined();
    expect(JSON.stringify(res.json())).not.toMatch(/evil|passwd|proto|mont\b/);
    expect(sliMock).not.toHaveBeenCalled();
  });

  it('never reflects a hostile month, because it is refused before anything is sent', async () => {
    const res = await get('?month=2026-08%22%3B%20filename%3D%22a.exe&format=xlsx');
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.headers)).not.toContain('a.exe');
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('serves the current month when none is given, cut at midnight in the report’s zone, not UTC', async () => {
    // 01:00 on 1 September in Jakarta, still 31 August in UTC.
    vi.setSystemTime(new Date('2026-08-31T18:00:00Z'));
    const res = await get('?format=pdf');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe(disposition('HCML_SLA_Report_2026-09.pdf'));
    expect(sliMock.mock.calls.map((c) => c.slice(0, 2)).sort()).toEqual([
      ['2026-09', 'availability'],
      ['2026-09', 'hcml-report'],
    ]);
  });

  it('treats an empty month as the current one, as /api/sli does', async () => {
    const res = await get('?month=&format=xlsx');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe(disposition('HCML_SLA_Report_2026-09.xlsx'));
  });

  it('passes an error from the engine on as it is, with no file headers', async () => {
    sliMock.mockRejectedValue(new BadRequestError('That period has not started yet.'));
    const res = await get('?month=2099-01&format=pdf');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad_request', message: 'That period has not started yet.' });
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('answers 502 as every route does when Zabbix fails, and keeps its detail out of the body', async () => {
    sliMock.mockRejectedValue(new ZabbixApiError('Zabbix could not answer.', 'http://zabbix.internal/api_jsonrpc.php'));
    const res = await get('?month=2026-08&format=xlsx');
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('zabbix.internal');
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('answers 500 without internal wording if the two reports do not belong together', async () => {
    sliMock.mockImplementation(async () => reports.hcml);
    const res = await get('?month=2026-08&format=pdf');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'internal' });
    expect(res.body).not.toContain('strict report');
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('answers HEAD with the same headers and no body', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/api/sli/export?month=2026-08&format=pdf' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(PDF_TYPE);
    expect(res.rawPayload).toHaveLength(0);
  });
});

describe('the CSV download', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildTestApp(sliExportRoutes);
  });
  afterEach(() => app.close());

  const get = (query: string) => app.inject({ url: `/api/sli/export?month=2026-08&format=csv${query}` });
  const files = async (query = '') => {
    const parts = unzip((await get(query)).rawPayload);
    return new Map([...parts].map(([name, data]) => [name.replace('HCML_SLA_Report_2026-08_csv/', ''), data.toString('utf8')]));
  };

  it('sends a zip named for the month, with the CSV in the name so it is not taken for anything else', async () => {
    const res = await get('');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(CSV_TYPE);
    expect(res.headers['content-disposition']).toBe(disposition('HCML_SLA_Report_2026-08_csv.zip'));
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Number(res.headers['content-length'])).toBe(res.rawPayload.length);
    expect([...res.rawPayload.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('holds the first page, a file for each table in the report, and the notes, all in one folder', async () => {
    const parts = unzip((await get('')).rawPayload);
    expect([...parts.keys()]).toEqual(
      [
        '00-summary.csv',
        '01-by-category.csv',
        '02-by-site.csv',
        '03-by-device.csv',
        '04-wan-paths.csv',
        '05-web-checks.csv',
        '06-never-measured.csv',
        'notes.txt',
      ].map((n) => `HCML_SLA_Report_2026-08_csv/${n}`),
    );
  });

  it('puts the reports’ own figures in the files', async () => {
    const f = await files('');
    expect(f.get('03-by-device.csv')).toContain('2.2.3 SAMPLE SWITCH 03');
    expect(f.get('02-by-site.csv')).toContain('3 · Cedar / Quay');
    expect(f.get('00-summary.csv')).toContain('SLA availability report');
    expect(f.get('notes.txt')).toContain('August 2026');
  });

  it('reads both methods for the month asked for, once each', async () => {
    await get('');
    expect(sliMock.mock.calls.map((c) => c.slice(0, 2)).sort()).toEqual([
      ['2026-08', 'availability'],
      ['2026-08', 'hcml-report'],
    ]);
  });
});

describe('the style of a download', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildTestApp(sliExportRoutes);
  });
  afterEach(() => app.close());

  const get = (query: string) => app.inject({ url: `/api/sli/export?month=2026-08${query}` });
  const csv = async (query: string) => {
    const parts = unzip((await get(`&format=csv${query}`)).rawPayload);
    return new Map([...parts].map(([name, data]) => [name.replace('HCML_SLA_Report_2026-08_csv/', ''), data.toString('utf8')]));
  };
  const workbookStrings = async (query: string) => unzip((await get(`&format=xlsx${query}`)).rawPayload).get('xl/sharedStrings.xml')!.toString('utf8');

  it('writes the default style when none is asked for: dots, long dates, commas', async () => {
    const f = await csv('');
    expect(f.get('00-summary.csv')).toMatch(/Generated 17 Sep 2026 10:00 \(Asia\/Jakarta\)/);
    expect(f.get('02-by-site.csv')!.split('\r\n')[1]).toMatch(/^[^,]+,\d+,\d+,\d+\.\d+,/);
    expect(f.get('notes.txt')).toContain('Fields are separated by commas.');
  });

  it('writes a decimal comma and a semicolon into the CSV when asked', async () => {
    const f = await csv('&decimal=comma&separator=semicolon');
    expect(f.get('02-by-site.csv')!.split('\r\n')[0]).toContain(';');
    for (const row of f.get('02-by-site.csv')!.slice(1).split('\r\n').slice(1, -1)) expect(row).toMatch(/;\d+,\d+;/);
    expect(f.get('notes.txt')).toContain('Fields are separated by semicolons.');
    expect(f.get('notes.txt')).toContain('Decimals are written with a comma.');
  });

  it.each([
    ['numeric', 'Generated 17/09/2026 10:00 (Asia/Jakarta)'],
    ['iso', 'Generated 2026-09-17 10:00 (Asia/Jakarta)'],
    ['long', 'Generated 17 Sep 2026 10:00 (Asia/Jakarta)'],
  ])('writes the %s date style into the CSV, the workbook and the notes', async (date, generated) => {
    expect((await csv(`&date=${date}`)).get('00-summary.csv')).toContain(generated);
    expect(await workbookStrings(`&date=${date}`)).toContain(generated);
  });

  it('writes a decimal comma into the figures of the workbook’s summary, not only the CSV', async () => {
    const dot = await workbookStrings('');
    const comma = await workbookStrings('&decimal=comma');
    const overall = reports.strict.overall.sli!;
    const printed = `${overall.toFixed(2)}%`;
    expect(dot).toContain(printed);
    expect(comma).toContain(printed.replace('.', ','));
    expect(comma).not.toContain(`>${printed}<`);
  });

  it('writes the PDF in the style too', async () => {
    const dot = (await get('&format=pdf')).rawPayload;
    const comma = (await get('&format=pdf&decimal=comma')).rawPayload;
    expect(Buffer.compare(dot, comma)).not.toBe(0);
  });

  it('gives a PDF or a workbook the same bytes whatever the separator, since only a CSV has one', async () => {
    for (const format of ['pdf', 'xlsx']) {
      const plain = (await get(`&format=${format}`)).rawPayload;
      const semi = (await get(`&format=${format}&separator=semicolon`)).rawPayload;
      expect(Buffer.compare(plain, semi), format).toBe(0);
    }
  });

  it('keeps a style apart from another in the short-lived file cache: the first one asked for is not served for the second', async () => {
    const first = (await get('&format=pdf&decimal=comma')).rawPayload;
    const second = (await get('&format=pdf&decimal=dot')).rawPayload;
    const third = (await get('&format=pdf&decimal=comma')).rawPayload;
    expect(Buffer.compare(first, second)).not.toBe(0);
    expect(Buffer.compare(first, third)).toBe(0);
    const a = (await get('&format=csv&separator=semicolon')).rawPayload;
    const b = (await get('&format=csv&separator=comma')).rawPayload;
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it.each(['pdf', 'xlsx', 'csv'])('keeps a date style apart from another in the file cache, for the %s too', async (format) => {
    const iso = (await get(`&format=${format}&date=iso`)).rawPayload;
    const numeric = (await get(`&format=${format}&date=numeric`)).rawPayload;
    const again = (await get(`&format=${format}&date=iso`)).rawPayload;
    expect(Buffer.compare(iso, numeric)).not.toBe(0);
    expect(Buffer.compare(iso, again)).toBe(0);
  });

  it('keeps the decimal mark of a CSV apart from the other in the file cache', async () => {
    const comma = (await get('&format=csv&decimal=comma')).rawPayload;
    const dot = (await get('&format=csv&decimal=dot')).rawPayload;
    expect(Buffer.compare(comma, dot)).not.toBe(0);
  });

  it.each([
    ['decimal=point', 'decimal must be "dot" or "comma".'],
    ['decimal=', 'decimal must be "dot" or "comma".'],
    ['date=short', 'date must be "long", "numeric" or "iso".'],
    ['separator=tab', 'separator must be "comma" or "semicolon".'],
  ])('answers 400 for %s, before touching Zabbix', async (query, message) => {
    const res = await get(`&format=csv&${query}`);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad_request', message });
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(sliMock).not.toHaveBeenCalled();
  });

  it.each(['decimal=dot&decimal=comma', 'date=iso&date=long', 'separator=comma&separator=semicolon'])('answers 400 for a choice given twice: %s', async (query) => {
    const res = await get(`&format=csv&${query}`);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad_request', message: expect.stringContaining('given once') });
    expect(sliMock).not.toHaveBeenCalled();
  });

  it('still refuses a name that is not one of the choices', async () => {
    const res = await get('&format=csv&locale=id');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad_request', message: 'Only month, format, decimal, date and separator are accepted.' });
  });
});

describe('the file is the same every time', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildTestApp(sliExportRoutes);
  });
  afterEach(() => app.close());

  const bytes = async (format: string) => (await app.inject({ url: `/api/sli/export?month=2026-08&format=${format}` })).rawPayload;

  it.each(FORMATS)('a second %s at the same moment is byte for byte the first', async (format) => {
    const first = await bytes(format);
    const second = await bytes(format);
    expect(second.length).toBe(first.length);
    expect(Buffer.compare(first, second)).toBe(0);
  });

  it.each(FORMATS)('a %s asked for again within ten seconds is the same file, made once', async (format) => {
    const first = await bytes(format);
    vi.setSystemTime(new Date(NOW.getTime() + 9_000));
    expect(Buffer.compare(first, await bytes(format))).toBe(0);
    // Past the window it is made afresh, with the new moment in it.
    vi.setSystemTime(new Date(NOW.getTime() + 11_000));
    expect(Buffer.compare(first, await bytes(format))).not.toBe(0);
  });

  it.each(FORMATS)('a refreshed report starts a new %s at once, inside the window', async (format) => {
    const first = await bytes(format);
    vi.setSystemTime(new Date(NOW.getTime() + 5_000));
    const sameReports = await bytes(format);
    expect(Buffer.compare(first, sameReports)).toBe(0);
    // The cache hands back new report objects once it has refreshed: the old file is not theirs.
    reports = sampleSliReports();
    expect(Buffer.compare(first, await bytes(format))).not.toBe(0);
  });

  it.each(FORMATS)('a refreshed HCML report alone also starts a new %s', async (format) => {
    const first = await bytes(format);
    vi.setSystemTime(new Date(NOW.getTime() + 5_000));
    reports = { strict: reports.strict, hcml: sampleSliReports().hcml };
    expect(Buffer.compare(first, await bytes(format))).not.toBe(0);
  });

  it.each(FORMATS)('keeps the %s of one month apart from another month and from the other format', async (format) => {
    const august = await bytes(format);
    const other = FORMATS.find((f) => f !== format)!;
    const otherFormat = await bytes(other);
    expect(Buffer.compare(august, otherFormat)).not.toBe(0);
    expect(august.subarray(0, 4).toString('latin1')).toBe(format === 'pdf' ? '%PDF' : 'PK\u0003\u0004');
    expect(otherFormat.subarray(0, 4).toString('latin1')).toBe(other === 'pdf' ? '%PDF' : 'PK\u0003\u0004');
    for (const f of FORMATS) {
      if (f !== format) expect(Buffer.compare(august, await bytes(f)), `${format} against ${f}`).not.toBe(0);
    }
  });

  it.each(FORMATS)('a %s made an hour later differs, so the check above has something to catch', async (format) => {
    const first = await bytes(format);
    vi.setSystemTime(new Date(NOW.getTime() + 3600_000));
    expect(Buffer.compare(first, await bytes(format))).not.toBe(0);
  });
});

describe('the rate limit', () => {
  it('counts the export, which costs the most CPU of the cached routes, and turns the third request away', async () => {
    const limited = Fastify({ logger: false });
    registerErrorHandler(limited);
    await registerRateLimit(limited, 2);
    await limited.register(sliExportRoutes);
    await limited.ready();
    const get = () => limited.inject({ url: '/api/sli/export?month=2026-08&format=pdf' });

    expect((await get()).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(200);
    const read = sliMock.mock.calls.length;
    const over = await get();
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ error: 'rate_limited' });
    expect(over.headers['content-disposition']).toBeUndefined();
    // Turned away before anything was read.
    expect(sliMock.mock.calls.length).toBe(read);
    await limited.close();
  });
});

describe('behind the production stack (helmet, cors, compression and the error handler, in index.ts’s order)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    invalidate('');
    app = Fastify({ logger: false });
    await app.register(helmet, { contentSecurityPolicy: false });
    await app.register(cors, { origin: 'http://localhost:5173', credentials: true });
    registerCompression(app);
    registerErrorHandler(app);
    await app.register(sliExportRoutes);
    // Proof that compression is live in this very app, so "unchanged" below means it chose to leave the file alone.
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: String(i), name: `High ICMP ping loss on ${i}`, severity: String(i % 6) }));
    app.get('/probe', async () => rows);
    await app.ready();
  });
  afterEach(() => app.close());

  const ENCODINGS = 'br, gzip';

  it('is compressing JSON here, so the next tests are not vacuous', async () => {
    const res = await app.inject({ url: '/probe', headers: { 'accept-encoding': ENCODINGS } });
    expect(res.headers['content-encoding']).toBe('br');
  });

  it.each(FORMATS)('leaves the %s untouched whatever the client accepts', async (format) => {
    const url = `/api/sli/export?month=2026-08&format=${format}`;
    const plain = await app.inject({ url });
    for (const accept of [ENCODINGS, 'gzip', 'br', 'gzip, deflate, br, zstd', '*', 'identity']) {
      const res = await app.inject({ url, headers: { 'accept-encoding': accept } });
      expect(res.statusCode, accept).toBe(200);
      expect(Buffer.compare(res.rawPayload, plain.rawPayload), accept).toBe(0);
      expect(res.headers['content-encoding'], accept).toBeUndefined();
      expect(Number(res.headers['content-length']), accept).toBe(plain.rawPayload.length);
      expect(res.headers['content-type'], accept).toBe(TYPES[format]);
      // The body never varies with the encoding, so a cache in between has no reason to key on it.
      expect(res.headers['vary'] ?? '', accept).not.toMatch(/accept-encoding/i);
    }
  });

  it.each(FORMATS)('keeps the download headers next to helmet’s and cors’s for the %s', async (format) => {
    const res = await app.inject({ url: `/api/sli/export?month=2026-08&format=${format}`, headers: { origin: 'http://localhost:5173' } });
    expect(res.headers['content-disposition']).toBe(disposition(FILE[format]));
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('answers a bad request as plain JSON even to a client that accepts br and gzip', async () => {
    const res = await app.inject({ url: '/api/sli/export?month=nope&format=pdf', headers: { 'accept-encoding': ENCODINGS } });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.json()).toMatchObject({ error: 'bad_request' });
  });
});
