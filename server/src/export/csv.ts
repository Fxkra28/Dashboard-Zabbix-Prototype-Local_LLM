import { DEFAULT_STYLE, type ReportStyle } from '../core/reportChoices.js';
import { NOTHING_TO_LIST, type Cell, type ColumnKind, type ReportDoc, type Table } from './types.js';
import { zip, type ZipEntry } from './zip.js';

/**
 * The report as a zip of CSV files, for a spreadsheet or a script: the first page, one file for each table, and a
 * notes file. Built from the same ReportDoc as the PDF and the workbook, so a figure is the one they print.
 */

/** Excel reads a file as UTF-8 only when it starts with this. */
const BOM = String.fromCharCode(0xfeff);
const EOL = '\r\n';

/** A field never breaks a line: control characters become one space, and padding goes. */
const tidy = (s: string) => s.replace(/\p{Cc}+/gu, ' ').trim();
/** A spreadsheet runs a cell that starts with one of these as a formula, so such a name gets an apostrophe. */
const guard = (s: string) => (/^[=+\-@]/.test(s) ? `'${s}` : s);
const text = (s: string) => guard(tidy(s));

const field = (value: string, sep: string) => (value.includes(sep) || value.includes('"') ? `"${value.replace(/"/g, '""')}"` : value);
const line = (values: string[], sep: string) => values.map((v) => field(v, sep)).join(sep) + EOL;

const UNIT: Partial<Record<ColumnKind, string>> = { percent: ' in %', duration: ' in seconds' };

/** A figure a spreadsheet can total: a number, and for a span or a count not below zero. */
const usable = (kind: ColumnKind, n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && (kind === 'percent' || n >= 0);

/** The percent as the report prints it, minus the sign, with the style's mark. */
function percentOf(cell: Cell & { n: number }, mark: string): string {
  const printed = /^(-?\d+)(?:[.,](\d+))?%$/.exec(cell.text.trim());
  if (printed) return printed[2] === undefined ? printed[1]! : `${printed[1]}${mark}${printed[2]}`;
  return cell.n.toFixed(2).replace('.', mark);
}

function valueOf(kind: ColumnKind, cell: Cell, mark: string): string {
  if (kind === 'text' || kind === 'status') return text(cell.text);
  if (!usable(kind, cell.n)) return cell.n === null || cell.n === undefined ? '' : text(cell.text);
  if (kind === 'percent') return percentOf({ ...cell, n: cell.n }, mark);
  return kind === 'duration' || Number.isInteger(cell.n) ? String(Math.round(cell.n)) : String(cell.n).replace('.', mark);
}

function tableFile(t: Table, sep: string, mark: string): string {
  if (t.columns.length === 0) throw new Error(`Table "${t.title}" has no columns.`);
  const body = t.rows.length ? [...t.rows, ...(t.footer ? [t.footer] : [])] : [];
  const head = t.columns.map((c) => tidy(c.header) + (UNIT[c.kind] ?? ''));
  const rows = body.map((r) => t.columns.map((c, i) => valueOf(c.kind, r[i] ?? { text: '' }, mark)));
  return BOM + line(head, sep) + rows.map((r) => line(r, sep)).join('');
}

function summaryFile(doc: ReportDoc, sep: string): string {
  const rows = [
    ['Item', 'Value', 'Detail'],
    ['Report', doc.title, doc.subtitle],
    ['Period', doc.period, ''],
    ['Generated', doc.generated, ''],
    ...doc.kpis.map((k) => [k.label, k.value, k.detail ?? '']),
  ];
  return BOM + rows.map((r) => line(r.map(text), sep)).join('');
}

function notesFile(doc: ReportDoc, names: string[], style: ReportStyle): string {
  const files = doc.tables.map((t, i) =>
    [`${names[i]}: ${t.title}.`, t.caption, t.rows.length ? '' : `No rows: ${t.empty ?? NOTHING_TO_LIST}`].filter(Boolean).join(' '),
  );
  const closing = doc.tables.filter((t) => t.rows.length > 0 && t.footer).map((t) => `The last row of ${t.title} is its closing row.`);
  const lines = [
    `${doc.title}, ${doc.subtitle}`,
    doc.period,
    doc.generated,
    '',
    'About these files',
    '00-summary.csv: the first page, with the key figures.',
    ...files,
    'The files are UTF-8 with a byte order mark, so Excel shows accents correctly. Lines end with CR and LF.',
    `Fields are separated by ${style.separator === 'semicolon' ? 'semicolons' : 'commas'}.`,
    `Decimals are written with a ${style.decimal === 'comma' ? 'comma' : 'dot'}.`,
    'Percent columns hold the figure as the report prints it, without the percent sign.',
    'Duration columns hold whole seconds.',
    'A blank figure means there was no data. It is never zero.',
    ...closing,
    'A name that starts with = + - or @ has an apostrophe put in front, so that a spreadsheet does not run it as a formula.',
    'If a spreadsheet shows each row in one column, download the report again with the other separator.',
    ...doc.notes.flatMap((n) => ['', n.heading, ...n.lines]),
  ];
  return BOM + lines.join(EOL) + EOL;
}

/** Lower case ASCII for a file name: accents drop, anything else between letters and digits becomes a hyphen. */
const slug = (sheet: string) =>
  sheet.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'table';

export function csvEntries(doc: ReportDoc, style: ReportStyle): ZipEntry[] {
  const sep = style.separator === 'semicolon' ? ';' : ',';
  const mark = style.decimal === 'comma' ? ',' : '.';
  // The number in front keeps the files in reading order and makes every name different.
  const names = doc.tables.map((t, i) => `${String(i + 1).padStart(2, '0')}-${slug(t.sheet)}.csv`);
  const files: [string, string][] = [
    ['00-summary.csv', summaryFile(doc, sep)],
    ...doc.tables.map((t, i): [string, string] => [names[i]!, tableFile(t, sep, mark)]),
    ['notes.txt', notesFile(doc, names, style)],
  ];
  return files.map(([name, body]) => ({ name: `${doc.fileBase}_csv/${name}`, data: Buffer.from(body, 'utf8') }));
}

export function buildCsv(doc: ReportDoc, now: Date, style: ReportStyle = DEFAULT_STYLE): Buffer {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new RangeError('The report time is not a valid date.');
  return zip(csvEntries(doc, style), now);
}
