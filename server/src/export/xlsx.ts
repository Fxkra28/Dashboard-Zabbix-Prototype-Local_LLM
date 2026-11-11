import { PALETTE, TONES } from './theme.js';
import { NOTHING_TO_LIST, type Cell, type ColumnKind, type ReportDoc, type Table, type Tone } from './types.js';
import { zip } from './zip.js';

/**
 * Writes a ReportDoc as an Excel workbook (SpreadsheetML, ECMA-376) by hand,
 * so the server needs no spreadsheet library. Two rules shape the file. Every
 * string goes through the shared string table, so a device named
 * `=HYPERLINK(...)` stays text and is never evaluated. And element order in
 * each part follows the schema, because Excel repairs a file that breaks it.
 */

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT_BASE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const CREATOR = 'HCML Monitoring Portal';
const MAX_CELL_CHARS = 32767;
const MAX_ROWS = 1048576;
const MAX_COLS = 16384;
const MAX_WIDTH = 255; // Excel's column width limit, a backstop: the budget and the floors keep every width far under it
const MAX_ROW_HEIGHT = 409.5; // points, Excel's row height limit
const HEADER_ROW = 4;
const SUMMARY_COLS = [34, 26, 58];

// Widths are in Excel's unit, the width of one digit of Calibri 11 (7 px). A table is as wide as its content
// needs, between these two; one whose floors alone need more is wider, and the print setup fits it to the page.
const MIN_TABLE = 120;
const MAX_TABLE = 170;
const MIN_CHARS: Record<ColumnKind, number> = { text: 14, percent: 12, duration: 12, count: 10, status: 11 };
const MAX_WANT = 45; // the longest value a text column asks room for
const MAX_FLOOR = 24; // a header word or figure wider than this is broken rather than widening its column
const PAD = 1.5; // a cell's padding and a margin
const GUTTER = PAD + 2; // the same with an indent of one, about three spaces

// A backslash literal rather than "%" in quotes: Quick Look and Numbers scale a quoted percent sign by 100, Excel treats the two alike.
const percentFormat = (decimals: number) => `0.${'0'.repeat(decimals)}\\%`;
// Literal colons: Excel shows a bare one as the reader's time separator, a dot in Indonesian ("4.19.35").
const DURATION_FORMAT = '[h]\\:mm\\:ss';
const COUNT_FORMAT_ID = 3; // built in as #,##0
const MIN_DECIMALS = 4;
const MAX_DECIMALS = 15; // what a double holds, and it keeps the number of formats small

// Control characters XML 1.0 forbids, the two non-characters, and surrogates without a partner.
const ILLEGAL_XML =
  // eslint-disable-next-line no-control-regex -- matching the control characters XML forbids is the point
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// Any control character: a sheet name may hold none.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001F]/g;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Cuts to `max` UTF-16 units without splitting a surrogate pair. */
function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const end = /[\uD800-\uDBFF]/.test(s[max - 1] ?? '') ? max - 1 : max;
  return s.slice(0, end);
}

/** Text as a cell stores it: legal XML, one newline style, within Excel's cell cap. */
function cellText(raw: string): string {
  const s = cut(raw.replace(ILLEGAL_XML, '').replace(/\r\n?/g, '\n'), MAX_CELL_CHARS);
  // Excel reads _xHHHH_ in a stored string as an escaped character, so a literal one is escaped.
  return s.replace(/_(x[0-9A-Fa-f]{4}_)/g, '_x005F_$1');
}

const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;

function colLetters(n: number): string {
  let s = '';
  for (let c = n; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
}

/** Sheet names Excel accepts, unique whatever the case. A counter per base name keeps a run of duplicates linear. */
class SheetNames {
  private readonly taken = new Set<string>();
  private readonly next = new Map<string, number>();

  add(raw: string): string {
    const fit = (s: string, max: number) => cut(s, max).replace(/^['\s]+|['\s]+$/g, '');
    const base =
      fit(raw.replace(ILLEGAL_XML, '').replace(CONTROL, ' ').replace(/[[\]:*?/\\]/g, '-'), 31) || 'Sheet';
    const key = base.toLowerCase();
    let name = base;
    let n = this.next.get(key) ?? 2;
    while (this.taken.has(name.toLowerCase()) || name.toLowerCase() === 'history') {
      const suffix = ` (${n++})`;
      name = fit(base, 31 - suffix.length) + suffix;
    }
    if (name !== base) this.next.set(key, n);
    this.taken.add(name.toLowerCase());
    return name;
  }
}

/** A sheet name as a defined name refers to it: always quoted, apostrophes doubled. */
const quoted = (name: string) => `'${name.replace(/'/g, "''")}'`;

// Calibri 11 advance widths for U+0020 to U+007E, in the font's units (2048 to the em; a digit is 1038).
const ADVANCE = [
  463, 667, 821, 1020, 1038, 1464, 1397, 452, 621, 621, 1020, 1020, 511, 627, 517, 791, 1038, 1038, 1038,
  1038, 1038, 1038, 1038, 1038, 1038, 1038, 548, 548, 1020, 1020, 1020, 949, 1831, 1185, 1114, 1092, 1260, 1000,
  941, 1292, 1276, 516, 653, 1064, 861, 1751, 1322, 1356, 1058, 1378, 1112, 941, 998, 1314, 1162, 1822, 1063,
  998, 959, 628, 791, 628, 1020, 1020, 596, 981, 1076, 866, 1076, 1019, 625, 964, 1076, 470, 490, 931,
  470, 1636, 1076, 1080, 1076, 1076, 714, 801, 686, 1076, 925, 1464, 887, 927, 809, 644, 943, 644, 1020,
];
const UNIT = 977.45; // font units in one column width unit: 7 px of a 14.67 px em
const SPACE = ADVANCE[0]! / UNIT;
const BOLD = 1.04; // Calibri Bold runs about 2% wider; the rest is margin
const scaleOf = (pt: number, bold = false) => (pt / 11) * (bold ? BOLD : 1);

/** Everything outside ASCII: the few marks the report uses, nothing for marks that combine, an em for scripts drawn square, a digit for the rest. */
function otherAdvance(c: number): number {
  if (c === 9) return ADVANCE[0]!;
  if (c < 32 || (c >= 0x7f && c <= 0x9f) || (c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || c === 0xfeff) return 0;
  if (c === 0xb7) return 517;
  if (c === 0x2018 || c === 0x2019) return 511;
  if (c === 0x201c || c === 0x201d) return 857;
  return c >= 0x2e80 || (c >= 0xd800 && c <= 0xdfff) ? 1024 : 1038;
}

/** How wide `s` draws in width units, one line of it. */
function textUnits(s: string): number {
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    sum += c >= 32 && c <= 126 ? ADVANCE[c - 32]! : otherAdvance(c);
  }
  return sum / UNIT;
}

/** The widest line of `text`, split where it breaks on purpose. */
const widestLine = (text: string) => (text.includes('\n') ? Math.max(...text.split('\n').map(textUnits)) : textUnits(text));

/** How many lines `text` takes in `room` width units; a guess, since Excel measures in pixels. `scale` is the font size over 11, times BOLD for bold. */
function wrapLines(text: string, room: number, scale = 1): number {
  const limit = Math.max(room, 2) / scale + 1e-6;
  let lines = 0;
  for (const para of text.split('\n')) {
    let n = 1;
    let used = 0;
    for (const word of para.split(' ')) {
      const w = textUnits(word);
      if (w > limit) {
        // A word wider than the line breaks wherever it meets the edge.
        if (used > 0) n++;
        const more = Math.ceil(w / limit) - 1;
        n += more;
        used = w - more * limit;
      } else if (used === 0) used = w;
      else if (used + SPACE + w <= limit) used += SPACE + w;
      else {
        n++;
        used = w;
      }
    }
    lines += n;
  }
  return lines;
}

const rowHeight = (lines: number, line = 15, pad = 3, least = 18) => Math.min(MAX_ROW_HEIGHT, Math.max(least, lines * line + pad));

class SharedStrings {
  private index = new Map<string, number>();
  private refs = 0;

  add(raw: string): number {
    const s = cellText(raw);
    this.refs++;
    let i = this.index.get(s);
    if (i === undefined) {
      i = this.index.size;
      this.index.set(s, i);
    }
    return i;
  }

  xml(): string {
    const items = [...this.index.keys()].map((s) => {
      const keep = /^\s|\s$|[\t\n]| {2}/.test(s) ? ' xml:space="preserve"' : '';
      return `<si><t${keep}>${esc(s)}</t></si>`;
    });
    return `${XML_DECL}<sst xmlns="${NS_MAIN}" count="${this.refs}" uniqueCount="${items.length}">${items.join('')}</sst>`;
  }
}

interface FontSpec {
  sz: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
}
interface Side {
  style: 'thin' | 'medium';
  color: string;
}
interface BorderSpec {
  left?: Side;
  right?: Side;
  top?: Side;
  bottom?: Side;
}
interface XfSpec {
  font: FontSpec;
  fill?: string;
  border?: BorderSpec;
  /** A built-in format id, or a format code that becomes a custom one. */
  numFmt?: number | string;
  h?: 'left' | 'center' | 'right';
  v?: 'center' | 'top';
  wrap?: boolean;
  indent?: number;
}

/** The style tables. Entries are shared, and ids follow first use, so the output is stable. */
class Styles {
  private fonts: string[] = [];
  private fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private borders: string[] = [];
  private numFmts = new Map<string, number>();
  private xfs: string[] = [];

  constructor() {
    this.border({});
    this.xf({ font: { sz: 11, color: PALETTE.text } });
  }

  private intern(list: string[], xml: string): number {
    const at = list.indexOf(xml);
    if (at >= 0) return at;
    list.push(xml);
    return list.length - 1;
  }

  private font(f: FontSpec): number {
    const xml =
      `<font>${f.bold ? '<b/>' : ''}${f.italic ? '<i/>' : ''}<sz val="${f.sz}"/>` +
      `<color rgb="${argb(f.color)}"/><name val="Calibri"/><family val="2"/></font>`;
    return this.intern(this.fonts, xml);
  }

  private fill(hex?: string): number {
    if (!hex) return 0;
    const xml = `<fill><patternFill patternType="solid"><fgColor rgb="${argb(hex)}"/><bgColor indexed="64"/></patternFill></fill>`;
    return this.intern(this.fills, xml);
  }

  private border(b: BorderSpec): number {
    const side = (tag: string, s?: Side) => (s ? `<${tag} style="${s.style}"><color rgb="${argb(s.color)}"/></${tag}>` : `<${tag}/>`);
    const xml = `<border>${side('left', b.left)}${side('right', b.right)}${side('top', b.top)}${side('bottom', b.bottom)}<diagonal/></border>`;
    return this.intern(this.borders, xml);
  }

  private numFmtId(f?: number | string): number {
    if (f === undefined) return 0;
    if (typeof f === 'number') return f;
    let id = this.numFmts.get(f);
    if (id === undefined) {
      id = 164 + this.numFmts.size;
      this.numFmts.set(f, id);
    }
    return id;
  }

  xf(s: XfSpec): number {
    const align =
      s.h || s.v || s.wrap || s.indent
        ? `<alignment${s.h ? ` horizontal="${s.h}"` : ''}${s.v ? ` vertical="${s.v}"` : ''}` +
          `${s.wrap ? ' wrapText="1"' : ''}${s.indent ? ` indent="${s.indent}"` : ''}/>`
        : '';
    const xml =
      `<xf numFmtId="${this.numFmtId(s.numFmt)}" fontId="${this.font(s.font)}" fillId="${this.fill(s.fill)}" ` +
      `borderId="${this.border(s.border ?? {})}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" ` +
      `applyBorder="1"${align ? ' applyAlignment="1">' + align + '</xf>' : '/>'}`;
    return this.intern(this.xfs, xml);
  }

  xml(): string {
    const list = (tag: string, items: string[]) => `<${tag} count="${items.length}">${items.join('')}</${tag}>`;
    return (
      `${XML_DECL}<styleSheet xmlns="${NS_MAIN}">` +
      (this.numFmts.size
        ? list('numFmts', [...this.numFmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`))
        : '') +
      list('fonts', this.fonts) +
      list('fills', this.fills) +
      list('borders', this.borders) +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      list('cellXfs', this.xfs) +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '<dxfs count="0"/>' +
      '</styleSheet>'
    );
  }
}

const box = (color: string): BorderSpec => ({
  left: { style: 'thin', color },
  right: { style: 'thin', color },
  top: { style: 'thin', color },
  bottom: { style: 'thin', color },
});
const BODY_BORDER = box(PALETTE.border);
const HEAD_BORDER = box(PALETTE.primaryStrong);
const FOOT_BORDER: BorderSpec = { ...BODY_BORDER, top: { style: 'medium', color: PALETTE.primary } };

const ALIGN: Record<ColumnKind, 'left' | 'center' | 'right'> = {
  text: 'left',
  percent: 'right',
  duration: 'right',
  count: 'right',
  status: 'center',
};

const isNumeric = (k: ColumnKind) => k === 'percent' || k === 'duration' || k === 'count';

/**
 * A figure the workbook can store as a number; anything else falls back to the cell's text.
 * A negative time shows as hashes in Excel, and a negative count means nothing.
 */
function usable(kind: ColumnKind, n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && (kind === 'percent' || n >= 0);
}

/** The decimals a percent cell shows: the text's own, at least four, and more while a figure below 100 would still round up to 100. */
function percentDecimals(text: string, n: number): number {
  let d = Math.min(MAX_DECIMALS, Math.max(MIN_DECIMALS, /[.,](\d+)/.exec(text)?.[1]?.length ?? 0));
  while (n < 100 && Number(n.toFixed(d)) >= 100 && d < MAX_DECIMALS) d++;
  return d;
}

/** What a numeric cell stores, or null when it falls back to its text. */
function stored(kind: ColumnKind, cell: Cell): { n: number; decimals: number } | null {
  if (!isNumeric(kind) || !usable(kind, cell.n)) return null;
  return { n: cell.n, decimals: kind === 'percent' ? percentDecimals(cell.text, cell.n) : 0 };
}

class Sheet {
  private rows: string[] = [];
  private merges: string[] = [];
  private lastRow = 0;

  constructor(
    private readonly strings: SharedStrings,
    readonly cols: number[],
  ) {}

  text(r: number, c: number, s: number, text: string): string {
    const ref = `${colLetters(c)}${r}`;
    return text === '' ? `<c r="${ref}" s="${s}"/>` : `<c r="${ref}" s="${s}" t="s"><v>${this.strings.add(text)}</v></c>`;
  }

  number(r: number, c: number, s: number, n: number): string {
    return `<c r="${colLetters(c)}${r}" s="${s}"><v>${n}</v></c>`;
  }

  blank(r: number, c: number, s: number): string {
    return `<c r="${colLetters(c)}${r}" s="${s}"/>`;
  }

  row(r: number, ht: number, cells: string[] = []): void {
    this.rows.push(`<row r="${r}" ht="${ht}" customHeight="1">${cells.join('')}</row>`);
    this.lastRow = r;
  }

  /** One row of text over columns 1 to `last`, merged when there is more than one column. */
  span(r: number, last: number, s: number, text: string, ht: number): void {
    const cells = [this.text(r, 1, s, text)];
    for (let c = 2; c <= last; c++) cells.push(this.blank(r, c, s));
    if (last > 1) this.merges.push(`A${r}:${colLetters(last)}${r}`);
    this.row(r, ht, cells);
  }

  get width(): number {
    return this.cols.reduce((a, b) => a + b, 0);
  }

  xml(o: {
    tab: string;
    selected?: boolean;
    freezeRow?: number;
    filter?: string;
    footer: string;
    onePage?: boolean;
  }): string {
    const lastCol = colLetters(this.cols.length);
    const pane = o.freezeRow
      ? `<pane ySplit="${o.freezeRow}" topLeftCell="A${o.freezeRow + 1}" activePane="bottomLeft" state="frozen"/>` +
        `<selection pane="bottomLeft" activeCell="A${o.freezeRow + 1}" sqref="A${o.freezeRow + 1}"/>`
      : '<selection activeCell="A1" sqref="A1"/>';
    return (
      `${XML_DECL}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      `<sheetPr><tabColor rgb="${argb(o.tab)}"/><pageSetUpPr fitToPage="1"/></sheetPr>` +
      `<dimension ref="A1:${lastCol}${Math.max(1, this.lastRow)}"/>` +
      `<sheetViews><sheetView showGridLines="0"${o.selected ? ' tabSelected="1"' : ''} workbookViewId="0">${pane}</sheetView></sheetViews>` +
      '<sheetFormatPr defaultRowHeight="18" customHeight="1"/>' +
      `<cols>${this.cols
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>` +
      `<sheetData>${this.rows.join('')}</sheetData>` +
      (o.filter ? `<autoFilter ref="${o.filter}"/>` : '') +
      (this.merges.length
        ? `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
        : '') +
      '<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
      `<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="${o.onePage ? 1 : 0}"/>` +
      `<headerFooter><oddFooter>${esc(o.footer)}</oddFooter></headerFooter>` +
      '</worksheet>'
    );
  }
}

/** How many digit widths a stored figure draws; commas and points are narrower, so this is an upper bound. */
function figureUnits(kind: ColumnKind, n: number, decimals: number): number {
  if (kind === 'percent') return n.toFixed(decimals).length + 1;
  if (kind === 'duration') return String(Math.floor(n / 3600)).length + 6;
  const digits = String(Math.round(n)).length;
  return digits + Math.floor((digits - 1) / 3);
}

interface Fit {
  /** The least width that keeps every header word whole and shows the widest figure. */
  floor: number;
  /** What a text column would like, for its longest value; null for the other kinds. */
  want: number | null;
}

/** Floors and wants per column, from the header and from every body and footer value. */
function columnFits(t: Table): Fit[] {
  const widest = t.columns.map(() => 0);
  const see = (cells: Cell[], footer: boolean) => {
    for (let i = 0; i < widest.length; i++) {
      const cell = cells[i];
      if (!cell) continue;
      const kind = t.columns[i]!.kind;
      const fig = stored(kind, cell);
      const w = fig ? figureUnits(kind, fig.n, fig.decimals) : widestLine(cellText(cell.text)) * (footer || kind === 'status' ? BOLD : 1);
      if (w > widest[i]!) widest[i] = w;
    }
  };
  for (const cells of t.rows) see(cells, false);
  if (t.footer && t.rows.length) see(t.footer, true);

  return t.columns.map((col, i) => {
    const word = Math.max(0, ...cellText(col.header).split(/[ \n]/).map(textUnits)) * BOLD;
    const text = col.kind === 'text';
    return {
      floor: Math.min(MAX_FLOOR, Math.max(MIN_CHARS[col.kind], Math.max(word, text ? 0 : widest[i]!) + GUTTER)),
      want: text ? Math.min(MAX_WANT, widest[i]!) + GUTTER : null,
    };
  });
}

/**
 * Splits `total` by weight once every floor is met: a column whose share falls under its floor is pinned at the
 * floor and the others share what is left. Floors that need more than `total` win, so the table runs wider.
 */
function shareWidths(weights: number[], floors: number[], total: number): number[] {
  const out = floors.slice();
  let live = floors.map((_, i) => i);
  let left = total;
  while (live.length) {
    const sum = live.reduce((a, i) => a + weights[i]!, 0);
    const share = (i: number) => (sum > 0 ? (weights[i]! / sum) * left : left / live.length);
    const low = live.filter((i) => share(i) < floors[i]!);
    if (!low.length) {
      for (const i of live) out[i] = share(i);
      break;
    }
    for (const i of low) left -= floors[i]!;
    const pinned = new Set(low);
    live = live.filter((i) => !pinned.has(i));
  }
  return out;
}

/**
 * Moves width from columns with more than their content needs to text columns with less, smallest shortfall first,
 * so a name that nearly fits is not left wrapped for one that never will. A donor keeps `keeps`; the total is unchanged.
 */
function fitToContent(widths: number[], keeps: number[], wants: (number | null)[]): number[] {
  const need = widths.map((w, i) => Math.max(0, (wants[i] ?? 0) - w));
  const spare = widths.map((w, i) => Math.max(0, w - keeps[i]!));
  const room = spare.reduce((a, b) => a + b, 0);
  if (room <= 0) return widths;
  const gain = widths.map(() => 0);
  let left = room;
  const asking = need.flatMap((v, i) => (v > 0 ? [i] : [])).sort((a, b) => need[a]! - need[b]! || a - b);
  for (const i of asking) {
    gain[i] = Math.min(need[i]!, left);
    left -= gain[i]!;
  }
  const moved = room - left;
  if (moved <= 0) return widths;
  return widths.map((w, i) => w + gain[i]! - (spare[i]! / room) * moved);
}

/** Widths in Excel's unit: shared by weight, never under a floor, text columns fitted to their longest value. */
function columnWidths(t: Table): number[] {
  const fits = columnFits(t);
  const floors = fits.map((f) => f.floor);
  const wants = fits.map((f) => f.want);
  const keeps = fits.map((f) => Math.max(f.floor, f.want ?? 0));
  // Only the ratios count, and a weight that is not a positive number counts as none: that column keeps its floor and its need.
  const given = t.columns.map((c) => (Number.isFinite(c.weight) && c.weight > 0 ? c.weight : 0));
  const top = given.reduce((a, b) => Math.max(a, b), 0);
  const weights = top > 0 ? given.map((w) => w / top) : given;
  const total = Math.min(MAX_TABLE, Math.max(MIN_TABLE, keeps.reduce((a, b) => a + b, 0)));
  return fitToContent(shareWidths(weights, floors, total), keeps, wants).map((w, i) =>
    Math.min(MAX_WIDTH, Math.max(floors[i]!, Math.ceil(w * 10 - 1e-9) / 10)),
  );
}

interface Book {
  styles: Styles;
  strings: SharedStrings;
}

function headerStyle(styles: Styles, kind: ColumnKind): number {
  return styles.xf({
    font: { sz: 11, color: PALETTE.surface, bold: true },
    fill: PALETTE.primary,
    border: HEAD_BORDER,
    h: ALIGN[kind],
    v: 'center',
    wrap: true,
    indent: kind === 'status' ? 0 : 1,
  });
}

/** The style of one body or footer cell: the verdict in colour and words, figures in their tone's text colour. */
function bodyStyle(styles: Styles, kind: ColumnKind, cell: Cell, fig: { decimals: number } | null, zebra: boolean, footer: boolean): number {
  const tone: Tone = cell.tone ?? 'none';
  const t = TONES[tone];
  const fill = footer ? PALETTE.tint : zebra ? PALETTE.surface2 : undefined;
  const base = {
    border: footer ? FOOT_BORDER : BODY_BORDER,
    h: ALIGN[kind],
    v: 'center' as const,
    indent: kind === 'status' ? 0 : 1,
  };
  if (kind === 'status') {
    const paint = tone !== 'none' && !footer;
    return styles.xf({ ...base, font: { sz: 11, color: t.text, bold: true }, fill: paint ? t.bg : fill, wrap: true });
  }
  if (isNumeric(kind) && !fig) {
    return styles.xf({ ...base, font: { sz: 11, color: PALETTE.muted, italic: true }, fill });
  }
  if (fig) {
    const numFmt = kind === 'percent' ? percentFormat(fig.decimals) : kind === 'duration' ? DURATION_FORMAT : COUNT_FORMAT_ID;
    return styles.xf({ ...base, font: { sz: 11, color: t.text, bold: footer }, fill, numFmt });
  }
  return styles.xf({ ...base, font: { sz: 11, color: t.text, bold: footer }, fill, wrap: true });
}

function tableSheet(book: Book, t: Table): { sheet: Sheet; filter?: string } {
  const { styles } = book;
  const n = t.columns.length;
  if (n === 0) throw new Error(`Table "${t.title}" has no columns.`);
  // Before the widths: an oversize table must fail at once, not after sizing every column.
  if (n > MAX_COLS || t.rows.length + HEADER_ROW + 2 > MAX_ROWS) throw new RangeError(`Table "${t.title}" is too large for a worksheet.`);

  const widths = columnWidths(t);
  const sheet = new Sheet(book.strings, widths);
  const room = sheet.width - PAD;
  const titleStyle = styles.xf({ font: { sz: 16, color: PALETTE.primary, bold: true }, v: 'center', wrap: true });
  sheet.span(1, n, titleStyle, t.title, rowHeight(wrapLines(cellText(t.title), room, scaleOf(16, true)), 22, 6));
  if (t.caption) {
    const capStyle = styles.xf({ font: { sz: 10, color: PALETTE.muted }, v: 'top', wrap: true });
    sheet.span(2, n, capStyle, t.caption, rowHeight(wrapLines(cellText(t.caption), room, scaleOf(10)), 14, 4));
  }
  sheet.row(3, 10);

  const headLines = t.columns.reduce((m, c, i) => Math.max(m, wrapLines(cellText(c.header), widths[i]! - GUTTER, BOLD)), 1);
  sheet.row(
    HEADER_ROW,
    rowHeight(headLines, 15, 10, 28),
    t.columns.map((c, i) => sheet.text(HEADER_ROW, i + 1, headerStyle(styles, c.kind), c.header)),
  );

  const line = (r: number, cells: Cell[], zebra: boolean, footer: boolean) => {
    let lines = 1;
    const out = t.columns.map((col, i) => {
      const cell = cells[i] ?? { text: '' };
      const c = i + 1;
      const fig = stored(col.kind, cell);
      const s = bodyStyle(styles, col.kind, cell, fig, zebra, footer);
      if (!isNumeric(col.kind)) {
        lines = Math.max(lines, wrapLines(cellText(cell.text), widths[i]! - GUTTER, footer || col.kind === 'status' ? BOLD : 1));
      }
      if (fig) return sheet.number(r, c, s, col.kind === 'duration' ? fig.n / 86400 : fig.n);
      return sheet.text(r, c, s, cell.text);
    });
    sheet.row(r, rowHeight(lines), out);
  };

  const lastCol = colLetters(n);
  if (t.rows.length === 0) {
    const empty = styles.xf({
      font: { sz: 11, color: PALETTE.muted, italic: true },
      border: BODY_BORDER,
      h: 'left',
      v: 'center',
      wrap: true,
      indent: 1,
    });
    const msg = t.empty ?? NOTHING_TO_LIST;
    sheet.span(HEADER_ROW + 1, n, empty, msg, rowHeight(wrapLines(cellText(msg), sheet.width - GUTTER)));
    return { sheet };
  }

  t.rows.forEach((cells, i) => line(HEADER_ROW + 1 + i, cells, i % 2 === 1, false));
  const lastData = HEADER_ROW + t.rows.length;
  if (t.footer) line(lastData + 1, t.footer, false, true);
  return { sheet, filter: `A${HEADER_ROW}:${lastCol}${lastData}` };
}

function summarySheet(book: Book, doc: ReportDoc): Sheet {
  const { styles } = book;
  const sheet = new Sheet(book.strings, SUMMARY_COLS);
  const last = SUMMARY_COLS.length;
  const room = sheet.width - PAD;
  let r = 1;

  const title = styles.xf({ font: { sz: 16, color: PALETTE.primary, bold: true }, v: 'center', wrap: true });
  sheet.span(r, last, title, doc.title, rowHeight(wrapLines(cellText(doc.title), room, scaleOf(16, true)), 22, 6));
  r++;
  const sub = styles.xf({ font: { sz: 13, color: PALETTE.text, bold: true }, v: 'center', wrap: true });
  sheet.span(r, last, sub, doc.subtitle, rowHeight(wrapLines(cellText(doc.subtitle), room, scaleOf(13, true)), 17, 5));
  r++;
  const muted = styles.xf({ font: { sz: 10, color: PALETTE.muted }, v: 'top', wrap: true });
  for (const line of [doc.period, doc.generated]) {
    sheet.span(r, last, muted, line, rowHeight(wrapLines(cellText(line), room, scaleOf(10)), 14, 4));
    r++;
  }
  sheet.row(r++, 12);

  if (doc.kpis.length) {
    const heads = ['Key figure', 'Value', 'Note'];
    sheet.row(
      r,
      24,
      heads.map((h, i) =>
        sheet.text(
          r,
          i + 1,
          styles.xf({
            font: { sz: 11, color: PALETTE.surface, bold: true },
            fill: PALETTE.primary,
            border: HEAD_BORDER,
            h: i === 1 ? 'center' : 'left',
            v: 'center',
            indent: i === 1 ? 0 : 1,
          }),
          h,
        ),
      ),
    );
    r++;
    doc.kpis.forEach((k, i) => {
      const fill = i % 2 === 1 ? PALETTE.surface2 : undefined;
      const common = { border: BODY_BORDER, fill, v: 'center' as const, wrap: true };
      const label = styles.xf({ ...common, font: { sz: 11, color: PALETTE.text }, h: 'left', indent: 1 });
      const value = styles.xf({ ...common, font: { sz: 14, color: TONES[k.tone].text, bold: true }, h: 'center' });
      const note = styles.xf({ ...common, font: { sz: 10, color: PALETTE.muted }, h: 'left', indent: 1 });
      const lines = Math.max(
        wrapLines(cellText(k.label), SUMMARY_COLS[0]! - GUTTER),
        wrapLines(cellText(k.value), SUMMARY_COLS[1]! - PAD, scaleOf(14, true)),
        wrapLines(cellText(k.detail ?? ''), SUMMARY_COLS[2]! - GUTTER, scaleOf(10)),
      );
      sheet.row(r, rowHeight(lines, 15, 8, 26), [
        sheet.text(r, 1, label, k.label),
        sheet.text(r, 2, value, k.value),
        sheet.text(r, 3, note, k.detail ?? ''),
      ]);
      r++;
    });
    sheet.row(r++, 12);
  }

  for (const note of doc.notes) {
    const heading = styles.xf({
      font: { sz: 12, color: PALETTE.primary, bold: true },
      border: { bottom: { style: 'thin', color: PALETTE.tintLine } },
      v: 'center',
    });
    sheet.span(r, last, heading, note.heading, 22);
    r++;
    const body = styles.xf({ font: { sz: 11, color: PALETTE.text }, v: 'top', wrap: true });
    for (const line of note.lines) {
      sheet.span(r, last, body, line, rowHeight(wrapLines(cellText(line), room)));
      r++;
    }
    sheet.row(r++, 12);
  }
  return sheet;
}

/** The page footer: the report's line on the left, the page count on the right. */
function pageFooter(text: string): string {
  const flat = cut(text.replace(ILLEGAL_XML, '').replace(/\s+/g, ' ').trim(), 180);
  return `&L${flat.replace(/&/g, '&&')}&RPage &P of &N`;
}

const w3cdtf = (d: Date) => d.toISOString().slice(0, 19) + 'Z';

export function buildXlsx(doc: ReportDoc, now: Date = new Date()): Buffer {
  // A bad clock is refused, not stamped as the epoch.
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new RangeError('The report time is not a valid date.');
  const book: Book = { styles: new Styles(), strings: new SharedStrings() };
  const footer = pageFooter(doc.footer);
  const names = new SheetNames();

  const sheets: { name: string; xml: string; filter?: string; titled: boolean }[] = [];
  const summaryName = names.add('Summary');
  sheets.push({
    name: summaryName,
    // Fitted to one printed page: fitted to the width alone, it left its last sentence by itself on a second.
    xml: summarySheet(book, doc).xml({ tab: PALETTE.primary, selected: true, footer, onePage: true }),
    titled: false,
  });
  for (const t of doc.tables) {
    const name = names.add(t.sheet);
    const { sheet, filter } = tableSheet(book, t);
    sheets.push({
      name,
      xml: sheet.xml({ tab: PALETTE.mid, freezeRow: HEADER_ROW, filter, footer }),
      filter,
      titled: true,
    });
  }

  const defined = sheets.flatMap((s, i) => {
    if (!s.titled) return [];
    const out: string[] = [];
    if (s.filter) {
      const [a, b] = s.filter.split(':') as [string, string];
      const abs = (ref: string) => ref.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2');
      out.push(
        `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(quoted(s.name))}!${abs(a)}:${abs(b)}</definedName>`,
      );
    }
    out.push(
      `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${esc(quoted(s.name))}!$${HEADER_ROW}:$${HEADER_ROW}</definedName>`,
    );
    return out;
  });

  const workbook =
    `${XML_DECL}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><workbookPr/>` +
    '<bookViews><workbookView activeTab="0"/></bookViews>' +
    `<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
    (defined.length ? `<definedNames>${defined.join('')}</definedNames>` : '') +
    '</workbook>';

  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
  const n = sheets.length;
  const workbookRels =
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
    sheets.map((_, i) => rel(`rId${i + 1}`, `${REL_BASE}/worksheet`, `worksheets/sheet${i + 1}.xml`)).join('') +
    rel(`rId${n + 1}`, `${REL_BASE}/styles`, 'styles.xml') +
    rel(`rId${n + 2}`, `${REL_BASE}/sharedStrings`, 'sharedStrings.xml') +
    '</Relationships>';

  const rootRels =
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
    rel('rId1', `${REL_BASE}/officeDocument`, 'xl/workbook.xml') +
    rel('rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml') +
    rel('rId3', `${REL_BASE}/extended-properties`, 'docProps/app.xml') +
    '</Relationships>';

  const over = (part: string, type: string) => `<Override PartName="${part}" ContentType="${type}"/>`;
  const contentTypes =
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    over('/xl/workbook.xml', `${CT_BASE}.sheet.main+xml`) +
    sheets.map((_, i) => over(`/xl/worksheets/sheet${i + 1}.xml`, `${CT_BASE}.worksheet+xml`)).join('') +
    over('/xl/styles.xml', `${CT_BASE}.styles+xml`) +
    over('/xl/sharedStrings.xml', `${CT_BASE}.sharedStrings+xml`) +
    over('/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml') +
    over('/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml') +
    '</Types>';

  const stamp = w3cdtf(now);
  const core =
    `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${esc(cellText(`${doc.title}, ${doc.subtitle}`))}</dc:title>` +
    `<dc:creator>${CREATOR}</dc:creator><cp:lastModifiedBy>${CREATOR}</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified></cp:coreProperties>`;

  const app =
    `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ` +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    `<Application>${CREATOR}</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop></Properties>`;

  const part = (name: string, xml: string) => ({ name, data: Buffer.from(xml, 'utf8') });
  return zip(
    [
      part('[Content_Types].xml', contentTypes),
      part('_rels/.rels', rootRels),
      part('docProps/core.xml', core),
      part('docProps/app.xml', app),
      part('xl/workbook.xml', workbook),
      part('xl/_rels/workbook.xml.rels', workbookRels),
      part('xl/styles.xml', book.styles.xml()),
      part('xl/sharedStrings.xml', book.strings.xml()),
      ...sheets.map((s, i) => part(`xl/worksheets/sheet${i + 1}.xml`, s.xml)),
    ],
    now,
  );
}
