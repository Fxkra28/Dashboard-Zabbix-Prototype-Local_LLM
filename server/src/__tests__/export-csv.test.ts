import { describe, expect, it } from 'vitest';
import { buildCsv, csvEntries } from '../export/csv.js';
import { DEFAULT_STYLE, type ReportStyle } from '../core/reportChoices.js';
import { CSV_TYPE, type ReportDoc, type Table } from '../export/types.js';
import { sampleDoc } from './helpers/docFixture.js';
import { readZip } from './helpers/readZip.js';

/**
 * The report as a zip of CSV files: one file for the first page, one for each table, and a notes file. The files
 * are for a spreadsheet and for a script, so these tests hold the dialect (byte order mark, CR LF, quoting), the
 * numbers (a figure is a number, a missing one is blank, never zero) and the one risk a CSV has that a PDF does
 * not: a name that a spreadsheet would run as a formula.
 */

const NOW = new Date('2026-10-01T07:20:00Z');
const BOM = String.fromCharCode(0xfeff);
const style = (over: Partial<ReportStyle> = {}): ReportStyle => ({ ...DEFAULT_STYLE, ...over });
const FOLDER = 'HCML_SLA_Report_2026-08_csv';

/** The files by name inside the folder, as text. */
function filesOf(doc: ReportDoc, over: Partial<ReportStyle> = {}): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of csvEntries(doc, style(over))) {
    expect(e.name.startsWith(`${FOLDER}/`)).toBe(true);
    out.set(e.name.slice(FOLDER.length + 1), e.data.toString('utf8'));
  }
  return out;
}

/** The inverse of the writer, written the other way round: fields, quotes doubled, rows ended by CR LF. */
function parse(text: string, separator = ','): string[][] {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (body[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === separator) {
      row.push(field);
      field = '';
    } else if (ch === '\r' && body[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += ch;
  }
  if (field !== '' || row.length) rows.push([...row, field]);
  return rows;
}

const fileOf = (doc: ReportDoc, name: string, over: Partial<ReportStyle> = {}): string => {
  const text = filesOf(doc, over).get(name);
  if (text === undefined) throw new Error(`no file ${name}`);
  return text;
};
const rowsOf = (doc: ReportDoc, name: string, over: Partial<ReportStyle> = {}) =>
  parse(fileOf(doc, name, over), over.separator === 'semicolon' ? ';' : ',');
const column = (rows: string[][], header: string): string[] => {
  const i = rows[0]!.indexOf(header);
  if (i < 0) throw new Error(`no column ${header}`);
  return rows.slice(1).map((r) => r[i]!);
};

const miniTable = (over: Partial<Table> = {}): Table => ({
  title: 'Mini',
  sheet: 'Mini',
  columns: [
    { header: 'Name', kind: 'text', weight: 4 },
    { header: 'SLA', kind: 'percent', weight: 2 },
    { header: 'Downtime', kind: 'duration', weight: 2 },
    { header: 'Incidents', kind: 'count', weight: 1 },
    { header: 'Status', kind: 'status', weight: 1 },
  ],
  rows: [],
  ...over,
});
const docWith = (...tables: Table[]): ReportDoc => ({ ...sampleDoc(), kpis: [], chart: undefined, notes: [], tables });

describe('the files in the package', () => {
  const doc = sampleDoc();

  it('is one folder named for the report, holding the first page, a file for each table in reading order, and the notes', () => {
    expect(csvEntries(doc, DEFAULT_STYLE).map((e) => e.name)).toEqual([
      `${FOLDER}/00-summary.csv`,
      `${FOLDER}/01-by-category.csv`,
      `${FOLDER}/02-by-site.csv`,
      `${FOLDER}/03-by-device.csv`,
      `${FOLDER}/04-wan-paths.csv`,
      `${FOLDER}/05-web-checks.csv`,
      `${FOLDER}/06-never-measured.csv`,
      `${FOLDER}/notes.txt`,
    ]);
  });

  it('names files in plain ASCII, none twice, whatever the tabs are called', () => {
    const odd = docWith(
      miniTable({ title: 'A', sheet: 'A B' }),
      miniTable({ title: 'B', sheet: 'A-B' }),
      miniTable({ title: 'C', sheet: 'Zürich' }),
      miniTable({ title: 'D', sheet: '東京' }),
      miniTable({ title: 'E', sheet: '  ' }),
    );
    const names = csvEntries(odd, DEFAULT_STYLE).map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^HCML_SLA_Report_2026-08_csv\/[a-z0-9._-]+$/);
    expect(names.slice(1, 3)).toEqual([`${FOLDER}/01-a-b.csv`, `${FOLDER}/02-a-b.csv`]);
    // An accent drops off its letter; a name with no letter a file name can hold becomes plain "table".
    expect(names.slice(3, 6)).toEqual([`${FOLDER}/03-zurich.csv`, `${FOLDER}/04-table.csv`, `${FOLDER}/05-table.csv`]);
  });

  it('packs them into a zip that a second reader opens, with the same bytes', () => {
    const zipped = readZip(buildCsv(doc, NOW, DEFAULT_STYLE));
    const entries = csvEntries(doc, DEFAULT_STYLE);
    expect([...zipped.keys()]).toEqual(entries.map((e) => e.name));
    for (const e of entries) expect(zipped.get(e.name)!.equals(e.data)).toBe(true);
  });

  it('gives the same bytes for the same document, time and style', () => {
    expect(buildCsv(doc, NOW, style({ decimal: 'comma' })).equals(buildCsv(doc, NOW, style({ decimal: 'comma' })))).toBe(true);
  });

  it('declares a zip, since that is what the file is', () => {
    expect(CSV_TYPE).toBe('application/zip');
  });
});

describe('the dialect of a CSV file', () => {
  const doc = sampleDoc();

  it('starts with a byte order mark so Excel reads the accents, and every line ends with CR LF', () => {
    for (const [name, text] of filesOf(doc)) {
      expect(text.startsWith(BOM), name).toBe(true);
      expect(text.endsWith('\r\n'), name).toBe(true);
      expect(text.slice(1).replace(/\r\n/g, ''), name).not.toMatch(/[\r\n]/);
    }
  });

  it('puts the column headers first, with the unit of a figure in the header', () => {
    const rows = rowsOf(doc, '03-by-device.csv');
    expect(rows[0]).toEqual([
      'Device',
      'Site',
      'Category',
      'SLA (strict) in %',
      'SLA (HCML method) in %',
      'Status',
      'Downtime in seconds',
      'Incidents',
      'Coverage in %',
    ]);
  });

  it('writes one row for each row of the table, every row as wide as the header', () => {
    const rows = rowsOf(doc, '03-by-device.csv');
    expect(rows).toHaveLength(1 + doc.tables[2]!.rows.length);
    for (const r of rows) expect(r).toHaveLength(9);
  });

  it('puts a field in quotes when it holds the separator or a quote, and doubles the quote', () => {
    const t = miniTable({ rows: [[{ text: 'Core, west' }, { text: '99.00%', n: 99 }, { text: '1 h', n: 3600 }, { text: '1', n: 1 }, { text: 'Met' }]] });
    const raw = fileOf(docWith(t), '01-mini.csv');
    expect(raw).toContain('"Core, west",99.00,3600,1,Met\r\n');
    const quoted = miniTable({ rows: [[{ text: 'Say "hi"' }, { text: 'No data', n: null }, { text: 'No data', n: null }, { text: '0', n: 0 }, { text: 'No data' }]] });
    expect(fileOf(docWith(quoted), '01-mini.csv')).toContain('"Say ""hi""",,,0,No data\r\n');
  });

  it('cleans a column header the way it cleans a name', () => {
    const t = miniTable({ columns: [{ header: '  Na\nme  ', kind: 'text', weight: 1 }, { header: 'Count\t', kind: 'count', weight: 1 }], rows: [] });
    expect(rowsOf(docWith(t), '01-mini.csv')[0]).toEqual(['Na me', 'Count']);
  });

  it('turns a tab, a line break and any other control character into one space', () => {
    const t = miniTable({ rows: [[{ text: 'a\tb\nc\r\nd\u0000e' }, { text: '1.00%', n: 1 }, { text: '1 s', n: 1 }, { text: '1', n: 1 }, { text: 'Met' }]] });
    const rows = rowsOf(docWith(t), '01-mini.csv');
    expect(rows[1]![0]).toBe('a b c d e');
  });

  it('leaves out the invisible padding of a name', () => {
    const t = miniTable({ rows: [[{ text: '  padded  ' }, { text: '1.00%', n: 1 }, { text: '1 s', n: 1 }, { text: '1', n: 1 }, { text: 'Met' }]] });
    expect(rowsOf(docWith(t), '01-mini.csv')[1]![0]).toBe('padded');
  });

  it('writes accents and non-Latin letters as UTF-8', () => {
    const rows = rowsOf(doc, '03-by-device.csv');
    expect(column(rows, 'Device')).toContain('Café routeur Zürich');
  });
});

describe('a name that a spreadsheet would run as a formula', () => {
  const doc = sampleDoc();

  it('gets an apostrophe in front when it starts with =, +, - or @, and the rest is untouched', () => {
    const t = miniTable({
      rows: ['=1+1', '+49 hub', '-gateway', '@sum(a)', 'a=b', '1-2', 'x@y'].map((name) => [
        { text: name },
        { text: '1.00%', n: 1 },
        { text: '1 s', n: 1 },
        { text: '1', n: 1 },
        { text: 'Met' },
      ]),
    });
    expect(column(rowsOf(docWith(t), '01-mini.csv'), 'Name')).toEqual(["'=1+1", "'+49 hub", "'-gateway", "'@sum(a)", 'a=b', '1-2', 'x@y']);
  });

  it('holds for the awkward names of the fixture, quoting included', () => {
    const raw = fileOf(doc, '03-by-device.csv');
    expect(raw).toContain(`"'=HYPERLINK(""http://example.invalid"",""click"")"`);
    for (const row of rowsOf(doc, '03-by-device.csv').slice(1)) expect(row[0]).not.toMatch(/^[=+\-@]/);
  });

  it('is judged after a leading control character is gone, so a tab cannot hide the sign', () => {
    const t = miniTable({ rows: [[{ text: '\t=cmd' }, { text: '1.00%', n: 1 }, { text: '1 s', n: 1 }, { text: '1', n: 1 }, { text: 'Met' }]] });
    expect(rowsOf(docWith(t), '01-mini.csv')[1]![0]).toBe("'=cmd");
  });

  it('never marks a figure: a number is written as a number', () => {
    const t = miniTable({ rows: [[{ text: 'x' }, { text: '-5.00%', n: -5 }, { text: '3 s', n: 3 }, { text: '2', n: 2 }, { text: 'Met' }]] });
    const row = rowsOf(docWith(t), '01-mini.csv')[1]!;
    expect(row.slice(1)).toEqual(['-5.00', '3', '2', 'Met']);
  });
});

describe('the figures', () => {
  const doc = sampleDoc();

  it('writes a percent as the report prints it, without the sign', () => {
    const t = doc.tables[2]!;
    const rows = rowsOf(doc, '03-by-device.csv');
    const printed = t.rows.map((r) => r[3]!.text);
    expect(column(rows, 'SLA (strict) in %')).toEqual(printed.map((p) => (p === 'No data' ? '' : p.replace('%', ''))));
  });

  it('writes the coverage of a device as the whole percent the report prints', () => {
    const t = doc.tables[2]!;
    const rows = rowsOf(doc, '03-by-device.csv');
    expect(column(rows, 'Coverage in %')).toEqual(t.rows.map((r) => r[8]!.text.replace('%', '')));
  });

  it('keeps a negative percent with all the digits it is printed with', () => {
    const t = miniTable({ rows: [[{ text: 'x' }, { text: '-5.125%', n: -5.125 }, { text: '3 s', n: 3 }, { text: '2', n: 2 }, { text: 'Met' }]] });
    expect(rowsOf(docWith(t), '01-mini.csv')[1]![1]).toBe('-5.125');
  });

  it('writes the figure itself, with the style’s mark, when the text is not a printed percent', () => {
    const t = miniTable({ rows: [[{ text: 'x' }, { text: 'about 99%', n: 99.5 }, { text: '3 s', n: 3 }, { text: '2', n: 2 }, { text: 'Met' }]] });
    expect(rowsOf(docWith(t), '01-mini.csv', { decimal: 'comma', separator: 'semicolon' })[1]![1]).toBe('99,50');
    expect(rowsOf(docWith(t), '01-mini.csv')[1]![1]).toBe('99.50');
  });

  it('writes a count that is not a whole number with the style’s mark', () => {
    const t = miniTable({ rows: [[{ text: 'x' }, { text: '1.00%', n: 1 }, { text: '3 s', n: 3 }, { text: '2.5', n: 2.5 }, { text: 'Met' }]] });
    expect(rowsOf(docWith(t), '01-mini.csv', { decimal: 'comma', separator: 'semicolon' })[1]![3]).toBe('2,5');
    expect(rowsOf(docWith(t), '01-mini.csv')[1]![3]).toBe('2.5');
  });

  it('writes a missing figure as a blank, never as zero, and keeps the word No data in a status column', () => {
    const rows = rowsOf(doc, '03-by-device.csv');
    const sla = column(rows, 'SLA (strict) in %');
    const status = column(rows, 'Status');
    const blanks = sla.flatMap((v, i) => (v === '' ? [i] : []));
    expect(blanks.length).toBeGreaterThan(0);
    for (const i of blanks) {
      expect(status[i]).toBe('No data');
      expect(column(rows, 'Downtime in seconds')[i]).toBe(doc.tables[2]!.rows[i]![6]!.n === null ? '' : String(Math.round(doc.tables[2]!.rows[i]![6]!.n!)));
    }
    expect(sla).not.toContain('0');
    expect(sla).not.toContain('0.00');
  });

  it('writes a duration in whole seconds and a count as it is', () => {
    const t = doc.tables[2]!;
    const rows = rowsOf(doc, '03-by-device.csv');
    expect(column(rows, 'Downtime in seconds')).toEqual(t.rows.map((r) => String(Math.round(r[6]!.n!))));
    expect(column(rows, 'Incidents')).toEqual(t.rows.map((r) => String(r[7]!.n)));
  });

  it('rounds a duration to the second, as the report does', () => {
    const t = miniTable({
      rows: [1.4, 1.5, 59.6, 0].map((s) => [{ text: 'x' }, { text: '1.00%', n: 1 }, { text: 'd', n: s }, { text: '1', n: 1 }, { text: 'Met' }]),
    });
    expect(column(rowsOf(docWith(t), '01-mini.csv'), 'Downtime in seconds')).toEqual(['1', '2', '60', '0']);
  });

  it('writes a figure that is not a usable number as the cell’s text, as the workbook does', () => {
    const t = miniTable({
      rows: [
        [{ text: 'x' }, { text: 'n/a', n: Number.NaN }, { text: 'odd', n: -3 }, { text: 'odd', n: Number.POSITIVE_INFINITY }, { text: 'Met' }],
        [{ text: 'y' }, { text: 'No data', n: null }, { text: 'No data', n: null }, { text: 'No data', n: null }, { text: 'No data' }],
        [{ text: 'z' }, { text: 'unset' }, { text: 'unset' }, { text: 'unset' }, { text: 'Met' }],
      ],
    });
    const rows = rowsOf(docWith(t), '01-mini.csv');
    expect(rows[1]!.slice(1)).toEqual(['n/a', 'odd', 'odd', 'Met']);
    expect(rows[2]!.slice(1)).toEqual(['', '', '', 'No data']);
    expect(rows[3]!.slice(1)).toEqual(['', '', '', 'Met']);
  });

  it('keeps the extra digits of a figure that fell short, so it cannot read as the target', () => {
    const t = miniTable({ rows: [[{ text: 'x' }, { text: '98.996%', n: 98.996 }, { text: '1 s', n: 1 }, { text: '1', n: 1 }, { text: 'Missed' }]] });
    expect(rowsOf(docWith(t), '01-mini.csv')[1]![1]).toBe('98.996');
  });

  it('adds up: the closing row of a table is its last row, and a table with no rows has none', () => {
    const closing = [{ text: 'All' }, { text: '99.10%', n: 99.1 }, { text: '1 h', n: 3600 }, { text: '9', n: 9 }, { text: 'Met' }];
    const t = miniTable({ rows: [[{ text: 'a' }, { text: '99.00%', n: 99 }, { text: '1 s', n: 1 }, { text: '1', n: 1 }, { text: 'Met' }]], footer: closing });
    const rows = rowsOf(docWith(t), '01-mini.csv');
    expect(rows.map((r) => r[0])).toEqual(['Name', 'a', 'All']);
    const bare = miniTable({ rows: [], footer: closing, empty: 'None.' });
    expect(rowsOf(docWith(bare), '01-mini.csv')).toEqual([['Name', 'SLA in %', 'Downtime in seconds', 'Incidents', 'Status']]);
  });

  it('writes the fixture’s closing row after its two rows, with a blank where its text is empty', () => {
    const rows = rowsOf(doc, '06-never-measured.csv');
    expect(rows.map((r) => r[0])).toEqual(['Device', 'Spare unit 1', 'Spare unit 2', '2 devices']);
    expect(rows[3]).toEqual(['2 devices', '', 'Counted as 100% by HCML’s method.']);
  });
});

describe('a decimal comma and a semicolon', () => {
  const doc = sampleDoc();

  it('writes the percent with a comma, whatever mark the document used', () => {
    const rows = rowsOf(doc, '03-by-device.csv', { decimal: 'comma', separator: 'semicolon' });
    for (const v of column(rows, 'SLA (strict) in %')) expect(v).toMatch(/^(\d+,\d+)?$/);
    expect(column(rows, 'Coverage in %').every((v) => /^\d+$/.test(v) || v === '')).toBe(true);
  });

  it('separates the fields with semicolons and does not quote a comma that is only a decimal', () => {
    const raw = fileOf(doc, '02-by-site.csv', { decimal: 'comma', separator: 'semicolon' });
    const lines = raw.slice(1).split('\r\n');
    expect(lines[0]).toBe('Site;Devices;With data;SLA (strict) in %;SLA (HCML method) in %;Below target;Downtime in seconds;Status');
    expect(lines[1]).toMatch(/^Site 1;\d+;\d+;\d+,\d+;\d+,\d+;\d+;\d+;(Met|Missed)$/);
  });

  it('puts a decimal comma in quotes when the fields are separated by commas, as a CSV reader needs', () => {
    const raw = fileOf(doc, '02-by-site.csv', { decimal: 'comma', separator: 'comma' });
    expect(raw.slice(1).split('\r\n')[1]).toMatch(/^Site 1,\d+,\d+,"\d+,\d+","\d+,\d+",\d+,\d+,(Met|Missed)$/);
    expect(rowsOf(doc, '02-by-site.csv', { decimal: 'comma', separator: 'comma' })[1]![3]).toMatch(/^\d+,\d+$/);
  });

  it('still puts a name that holds a semicolon in quotes when that is the separator', () => {
    const t = miniTable({ rows: [[{ text: 'a;b' }, { text: '1.00%', n: 1 }, { text: '1 s', n: 1 }, { text: '1', n: 1 }, { text: 'Met' }]] });
    expect(fileOf(docWith(t), '01-mini.csv', { separator: 'semicolon' })).toContain('"a;b";1.00;1;1;Met\r\n');
    expect(fileOf(docWith(t), '01-mini.csv', { separator: 'comma' })).toContain('a;b,1.00,1,1,Met\r\n');
  });

  it('changes nothing but the marks: the rows and figures are the same in every style', () => {
    const plain = rowsOf(doc, '03-by-device.csv');
    const other = rowsOf(doc, '03-by-device.csv', { decimal: 'comma', separator: 'semicolon' });
    expect(other).toHaveLength(plain.length);
    expect(other.map((r) => r[0])).toEqual(plain.map((r) => r[0]));
    expect(column(other, 'SLA (strict) in %').map((v) => v.replace(',', '.'))).toEqual(column(plain, 'SLA (strict) in %'));
  });
});

describe('the first page', () => {
  const doc = sampleDoc();

  it('names the report, the period and the time, then each key figure with its detail', () => {
    expect(rowsOf(doc, '00-summary.csv')).toEqual([
      ['Item', 'Value', 'Detail'],
      ['Report', 'SLA availability report', 'August 2026'],
      ['Period', '1 Aug 2026 00:00 to 31 Aug 2026 23:59 (Asia/Jakarta). Month closed.', ''],
      ['Generated', 'Generated 1 Oct 2026 14:20 (Asia/Jakarta)', ''],
      ['Overall SLA, strict', '98.74%', 'Target 99% | Missed'],
      ['Overall SLA, HCML method', '99.38%', 'Target 99% | Met'],
      ['Devices measured', '133 of 138', '5 never measured'],
      ['Sites below target', '8 of 14', 'Strict method'],
    ]);
  });

  it('guards a label or a title that a spreadsheet would run, as it guards a name', () => {
    const odd = { ...doc, title: '=SUM(A1)', kpis: [{ label: '+label', value: '-1', detail: '@x', tone: 'good' as const }] };
    const rows = rowsOf(odd, '00-summary.csv');
    expect(rows[1]).toEqual(['Report', "'=SUM(A1)", 'August 2026']);
    expect(rows[4]).toEqual(["'+label", "'-1", "'@x"]);
  });

  it('is only the header and the report lines when the document has no key figures', () => {
    const bare = { ...doc, kpis: [] };
    expect(rowsOf(bare, '00-summary.csv').map((r) => r[0])).toEqual(['Item', 'Report', 'Period', 'Generated']);
  });
});

describe('the notes file', () => {
  const doc = sampleDoc();
  const notes = (over: Partial<ReportStyle> = {}) => fileOf(doc, 'notes.txt', over);

  it('is UTF-8 text with a byte order mark and CR LF line ends', () => {
    const text = notes();
    expect(text.startsWith(BOM)).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.slice(1).replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('opens with the report’s title, the period and the time', () => {
    expect(notes().slice(1).split('\r\n').slice(0, 3)).toEqual([
      'SLA availability report, August 2026',
      '1 Aug 2026 00:00 to 31 Aug 2026 23:59 (Asia/Jakarta). Month closed.',
      'Generated 1 Oct 2026 14:20 (Asia/Jakarta)',
    ]);
  });

  it('says what each file is, and why an empty one is empty', () => {
    const lines = notes().split('\r\n');
    expect(lines).toContain('00-summary.csv: the first page, with the key figures.');
    expect(lines).toContain('01-by-category.csv: By category. Strict method first, then the same group by HCML’s report method.');
    expect(lines).toContain('05-web-checks.csv: Web checks. No rows: No web checks are configured in Zabbix.');
    expect(lines).toContain('06-never-measured.csv: Devices never measured.');
  });

  it('explains the format in words, and the words follow the style', () => {
    const plain = notes();
    expect(plain).toContain('Fields are separated by commas.');
    expect(plain).toContain('Decimals are written with a dot.');
    const other = notes({ decimal: 'comma', separator: 'semicolon' });
    expect(other).toContain('Fields are separated by semicolons.');
    expect(other).toContain('Decimals are written with a comma.');
    for (const text of [plain, other]) {
      expect(text).toContain('A blank figure means there was no data. It is never zero.');
      expect(text).toContain('Duration columns hold whole seconds.');
      expect(text).toContain('so that a spreadsheet does not run it as a formula');
      expect(text).toContain('If a spreadsheet shows each row in one column');
    }
  });

  it('names no closing row for a table that has no rows, though it has one to give', () => {
    const closing = [{ text: 'All' }, { text: '1.00%', n: 1 }, { text: '1 s', n: 1 }, { text: '1', n: 1 }, { text: 'Met' }];
    const empty = docWith(miniTable({ title: 'Totals', sheet: 'Totals', rows: [], footer: closing }));
    expect(fileOf(empty, 'notes.txt')).not.toContain('closing row');
  });

  it('names the tables that end in a closing row', () => {
    const withClosing = docWith(miniTable({ title: 'Totals', sheet: 'Totals', rows: [[{ text: 'a' }, { text: '1.00%', n: 1 }, { text: '1 s', n: 1 }, { text: '1', n: 1 }, { text: 'Met' }]], footer: [{ text: 'All' }, { text: '1.00%', n: 1 }, { text: '1 s', n: 1 }, { text: '1', n: 1 }, { text: 'Met' }] }));
    expect(fileOf(withClosing, 'notes.txt')).toContain('The last row of Totals is its closing row.');
    expect(notes()).toContain('The last row of Devices never measured is its closing row.');
    expect(fileOf(docWith(miniTable({ rows: [] })), 'notes.txt')).not.toContain('closing row');
  });

  it('carries every note of the report, heading and lines', () => {
    const text = notes();
    for (const n of doc.notes) {
      expect(text).toContain(`\r\n${n.heading}\r\n`);
      for (const line of n.lines) expect(text).toContain(`${line}\r\n`);
    }
  });

  it('holds no dash that stands in for punctuation', () => {
    expect(notes()).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
  });
});

describe('an empty document', () => {
  it('is still a well formed package: the summary and the notes, and a header-only file for an empty table', () => {
    const empty = docWith(miniTable({ rows: [], empty: 'Nothing was measured.' }));
    const names = [...filesOf(empty).keys()];
    expect(names).toEqual(['00-summary.csv', '01-mini.csv', 'notes.txt']);
    expect(fileOf(empty, '01-mini.csv')).toBe(`${BOM}Name,SLA in %,Downtime in seconds,Incidents,Status\r\n`);
    expect(fileOf(empty, 'notes.txt')).toContain('01-mini.csv: Mini. No rows: Nothing was measured.');
  });

  it('uses the writers’ shared words for an empty table that gives none', () => {
    const empty = docWith(miniTable({ rows: [] }));
    expect(fileOf(empty, 'notes.txt')).toContain('01-mini.csv: Mini. No rows: Nothing to list.');
  });

  it('pads a row that is shorter than its table with blanks and does not fail', () => {
    const t = miniTable({ rows: [[{ text: 'only' }]] });
    expect(rowsOf(docWith(t), '01-mini.csv')[1]).toEqual(['only', '', '', '', '']);
  });

  it('refuses a table with no columns, with the words the other writers use', () => {
    expect(() => csvEntries(docWith(miniTable({ columns: [], rows: [] })), DEFAULT_STYLE)).toThrow(new Error('Table "Mini" has no columns.'));
  });

  it('refuses a report time that is not a date, with the words the other writers use', () => {
    expect(() => buildCsv(sampleDoc(), new Date(Number.NaN), DEFAULT_STYLE)).toThrow(new RangeError('The report time is not a valid date.'));
  });
});
