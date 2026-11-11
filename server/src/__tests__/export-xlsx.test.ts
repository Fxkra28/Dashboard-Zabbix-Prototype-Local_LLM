import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildSlaReportDoc } from '../export/slaReport.js';
import { PALETTE, TONES } from '../export/theme.js';
import type { Cell, Column, ColumnKind, ReportDoc, Table, Tone } from '../export/types.js';
import { buildXlsx } from '../export/xlsx.js';
import { sampleDoc } from './helpers/docFixture.js';
import { sampleSliReports } from './helpers/sliReportFixture.js';

const NOW = new Date('2026-10-01T07:20:00Z');
const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;
const ch = (code: number) => String.fromCharCode(code);

/** The package as parts by name, read with the test's own zip reader. */
function readParts(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const parts = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const csize = buf.readUInt32LE(at + 20);
    const nlen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nlen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    parts.set(name, method === 8 ? inflateRawSync(raw) : raw);
    at += 46 + nlen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return parts;
}

interface XNode {
  name: string;
  attrs: Record<string, string>;
  kids: XNode[];
  text: string;
}

const ENTITY = /&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g;
const BAD_ENTITY = /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

/** The Char production of XML 1.0: tab, LF, CR, then everything but the C0 controls, surrogates, U+FFFE and U+FFFF. */
const isXmlChar = (cp: number) =>
  cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);

function decode(s: string): string {
  if (BAD_ENTITY.test(s)) throw new Error(`Bad entity near: ${s.slice(0, 40)}`);
  return s.replace(ENTITY, (_, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const cp = e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
    if (!isXmlChar(cp)) throw new Error(`Reference to a character XML 1.0 forbids: &${e};`);
    return String.fromCodePoint(cp);
  });
}

/** A small tag-balance checker that also builds the tree, so tests can ask questions of it. */
function parseXml(xml: string): XNode {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  // eslint-disable-next-line no-control-regex -- the point of the check is to find these characters
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(body)) throw new Error('Control character in XML');
  if (body.includes(ch(0xfffe)) || body.includes(ch(0xffff))) throw new Error('Non-character in XML');
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(body)) throw new Error('Lone surrogate in XML');
  const token = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*="[^"<]*")*)\s*(\/?)>|([^<]+)/y;
  const stack: XNode[] = [];
  let root: XNode | undefined;
  let pos = 0;
  while (pos < body.length) {
    token.lastIndex = pos;
    const m = token.exec(body);
    if (!m) throw new Error(`Malformed XML at ${pos}: ${body.slice(pos, pos + 40)}`);
    pos = token.lastIndex;
    if (m[5] !== undefined) {
      const top = stack[stack.length - 1];
      if (!top) {
        if (m[5].trim()) throw new Error('Text outside the root');
      } else top.text += decode(m[5]);
      continue;
    }
    if (m[1]) {
      const open = stack.pop();
      if (!open || open.name !== m[2]) throw new Error(`Unbalanced </${m[2]}>`);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? '').matchAll(/([A-Za-z_][\w.:-]*)="([^"<]*)"/g)) {
      if (a[1]! in attrs) throw new Error(`Duplicate attribute ${a[1]}`);
      attrs[a[1]!] = decode(a[2]!);
    }
    const node: XNode = { name: m[2]!, attrs, kids: [], text: '' };
    const parent = stack[stack.length - 1];
    if (parent) parent.kids.push(node);
    else if (root) throw new Error('Second root element');
    else root = node;
    if (!m[4]) stack.push(node);
  }
  if (stack.length || !root) throw new Error('Unclosed element');
  return root;
}

const kid = (n: XNode, name: string) => n.kids.find((k) => k.name === name);
const kids = (n: XNode, name: string) => n.kids.filter((k) => k.name === name);

class Book {
  parts: Map<string, Buffer>;
  constructor(buf: Buffer) {
    this.parts = readParts(buf);
  }
  raw(name: string): string {
    const p = this.parts.get(name);
    if (!p) throw new Error(`Missing part ${name}`);
    return p.toString('utf8');
  }
  xml(name: string): XNode {
    return parseXml(this.raw(name));
  }
  /** Sheet names in tab order, with the part each one lives in. */
  sheets(): { name: string; part: string }[] {
    const rels = new Map(kids(this.xml('xl/_rels/workbook.xml.rels'), 'Relationship').map((r) => [r.attrs.Id!, r.attrs.Target!]));
    return kids(kid(this.xml('xl/workbook.xml'), 'sheets')!, 'sheet').map((s) => ({
      name: s.attrs.name!,
      part: `xl/${rels.get(s.attrs['r:id']!)!}`,
    }));
  }
  sheet(name: string): XNode {
    const s = this.sheets().find((x) => x.name === name);
    if (!s) throw new Error(`No sheet ${name}`);
    return this.xml(s.part);
  }
  strings(): string[] {
    return kids(this.xml('xl/sharedStrings.xml'), 'si').map((si) => kid(si, 't')!.text);
  }
}

function rows(sheet: XNode): XNode[] {
  return kids(kid(sheet, 'sheetData')!, 'row');
}
function cell(sheet: XNode, ref: string): XNode | undefined {
  for (const r of rows(sheet)) for (const c of kids(r, 'c')) if (c.attrs.r === ref) return c;
  return undefined;
}
function value(book: Book, sheet: XNode, ref: string): string | number | undefined {
  const c = cell(sheet, ref);
  const v = c && kid(c, 'v')?.text;
  if (v === undefined) return undefined;
  return c!.attrs.t === 's' ? book.strings()[Number(v)] : Number(v);
}

/** What a style id resolves to. */
function style(book: Book, id: string) {
  const styles = book.xml('xl/styles.xml');
  const xf = kids(kid(styles, 'cellXfs')!, 'xf')[Number(id)]!;
  const font = kids(kid(styles, 'fonts')!, 'font')[Number(xf.attrs.fontId)]!;
  const fill = kids(kid(styles, 'fills')!, 'fill')[Number(xf.attrs.fillId)]!;
  const fg = kid(kid(fill, 'patternFill')!, 'fgColor')?.attrs.rgb;
  const fmt = kids(kid(styles, 'numFmts') ?? { name: '', attrs: {}, kids: [], text: '' }, 'numFmt').find((n) => n.attrs.numFmtId === xf.attrs.numFmtId);
  const align = kid(xf, 'alignment')?.attrs ?? {};
  return {
    numFmtId: Number(xf.attrs.numFmtId),
    formatCode: fmt?.attrs.formatCode,
    bold: !!kid(font, 'b'),
    italic: !!kid(font, 'i'),
    size: Number(kid(font, 'sz')!.attrs.val),
    color: kid(font, 'color')!.attrs.rgb,
    fill: fg,
    align,
  };
}
const styleOf = (book: Book, sheet: XNode, ref: string) => style(book, cell(sheet, ref)!.attrs.s!);

const WORKSHEET_ORDER = ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'autoFilter', 'mergeCells', 'conditionalFormatting', 'pageMargins', 'pageSetup', 'headerFooter'];
const STYLES_ORDER = ['numFmts', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'cellStyles', 'dxfs'];
const WORKBOOK_ORDER = ['fileVersion', 'workbookPr', 'bookViews', 'sheets', 'definedNames', 'calcPr'];

function expectOrder(node: XNode, order: string[]) {
  const at = node.kids.map((k) => {
    const i = order.indexOf(k.name);
    expect(i, `${node.name} holds unexpected <${k.name}>`).toBeGreaterThanOrEqual(0);
    return i;
  });
  expect(at, `${node.name} children out of schema order: ${node.kids.map((k) => k.name).join(', ')}`).toEqual([...at].sort((a, b) => a - b));
}

const doc = sampleDoc();
const file = buildXlsx(doc, NOW);
const book = new Book(file);

const miniTable = (over: Partial<Table> = {}): Table => ({
  title: 'T',
  sheet: 'T',
  columns: [{ header: 'Name', kind: 'text', weight: 1 }],
  rows: [[{ text: 'a' }]],
  ...over,
});
const miniDoc = (over: Partial<ReportDoc> = {}): ReportDoc => ({ ...doc, kpis: [], chart: undefined, notes: [], tables: [miniTable()], ...over });

// The real report: 7 sheets, and a By device table of 10 columns and 138 rows.
const real = (() => {
  const { strict, hcml } = sampleSliReports();
  return buildSlaReportDoc(strict, hcml, NOW);
})();
const realBook = new Book(buildXlsx(real, NOW));
const realTable = (sheet: string) => real.tables.find((t) => t.sheet === sheet)!;

/** The least width each kind may get, in Excel's unit (a digit of Calibri 11). */
const FLOOR: Record<ColumnKind, number> = { text: 14, percent: 12, duration: 12, count: 10, status: 11 };
const KINDS: ColumnKind[] = ['text', 'percent', 'duration', 'count', 'status'];
const col = (header: string, kind: ColumnKind = 'text', weight = 1): Column => ({ header, kind, weight });
const digits = (n: number) => '1234567890'.repeat(Math.ceil(n / 10)).slice(0, n);
const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const widthsOf = (b: Book, sheet: string) => kids(kid(b.sheet(sheet), 'cols')!, 'col').map((c) => Number(c.attrs.width));
const heightsOf = (sheet: XNode, from = 5) => rows(sheet).filter((r) => Number(r.attrs.r) >= from).map((r) => Number(r.attrs.ht));
const rowOf = (columns: Column[], text: (i: number) => string): Cell[] => columns.map((_, i) => ({ text: text(i) }));

/** What every column must get: a finite width, at least its kind's floor, at most Excel's 255. Lists the first few that do not. */
function badWidths(columns: Column[], widths: number[]): string[] {
  const bad: string[] = widths.length === columns.length ? [] : [`${widths.length} widths for ${columns.length} columns`];
  columns.forEach((c, i) => {
    const w = widths[i]!;
    if (!Number.isFinite(w) || w < FLOOR[c.kind] || w > 255) bad.push(`${c.header} (${c.kind}): ${w}`);
  });
  return bad.slice(0, 5);
}

describe('workbook package', () => {
  it('lists every part in [Content_Types].xml and every override points at a part', () => {
    const ct = book.xml('[Content_Types].xml');
    const defaults = new Set(kids(ct, 'Default').map((d) => d.attrs.Extension));
    const overrides = new Set(kids(ct, 'Override').map((o) => o.attrs.PartName!.slice(1)));
    for (const name of book.parts.keys()) {
      if (name === '[Content_Types].xml') continue;
      expect(overrides.has(name) || defaults.has(name.split('.').pop()!), `${name} has no content type`).toBe(true);
    }
    for (const o of overrides) expect(book.parts.has(o), `${o} is listed but absent`).toBe(true);
    expect([...book.parts.keys()][0]).toBe('[Content_Types].xml');
  });

  it('has the parts the brief names', () => {
    for (const p of ['_rels/.rels', 'docProps/core.xml', 'docProps/app.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']) {
      expect(book.parts.has(p), p).toBe(true);
    }
  });

  it('points every relationship at a part that exists', () => {
    const check = (relsPart: string, baseDir: string) => {
      for (const r of kids(book.xml(relsPart), 'Relationship')) {
        const target = r.attrs.Target!;
        const full = target.startsWith('/') ? target.slice(1) : `${baseDir}${target}`;
        expect(book.parts.has(full), `${relsPart} -> ${target}`).toBe(true);
      }
    };
    check('_rels/.rels', '');
    check('xl/_rels/workbook.xml.rels', 'xl/');
  });

  it('is well formed in every XML part', () => {
    for (const name of book.parts.keys()) expect(() => parseXml(book.raw(name)), name).not.toThrow();
  });

  it('the tag checker itself catches the faults it exists for', () => {
    expect(() => parseXml('<a><b></a></b>')).toThrow();
    expect(() => parseXml('<a>x & y</a>')).toThrow();
    expect(() => parseXml('<a>x</a><b/>')).toThrow();
    expect(() => parseXml('<a x="1" x="2"/>')).toThrow();
    expect(() => parseXml(`<a>${ch(1)}</a>`)).toThrow();
    expect(() => parseXml('<a>ok &amp; fine</a>')).not.toThrow();
  });

  it('the tag checker rejects a reference to a character XML 1.0 forbids, and accepts the legal ones', () => {
    const forbidden = ['&#0;', '&#1;', '&#8;', '&#11;', '&#12;', '&#14;', '&#31;', '&#x0;', '&#xB;', '&#x1F;'];
    for (const bad of [...forbidden, '&#xD800;', '&#xDFFF;', '&#xFFFE;', '&#xFFFF;', '&#x110000;']) {
      expect(() => parseXml(`<a>${bad}</a>`), bad).toThrow(/forbids/);
      expect(() => parseXml(`<a x="${bad}"/>`), `attribute ${bad}`).toThrow(/forbids/);
    }
    for (const ok of ['&#9;', '&#10;', '&#13;', '&#32;', '&#65;', '&#x41;', '&#xD7FF;', '&#xE000;', '&#xFFFD;', '&#x10000;', '&#x10FFFF;']) {
      expect(() => parseXml(`<a>${ok}</a>`), ok).not.toThrow();
    }
  });

  it('counts attributes equal the real counts', () => {
    const styles = book.xml('xl/styles.xml');
    for (const [parent, child] of [
      ['numFmts', 'numFmt'],
      ['fonts', 'font'],
      ['fills', 'fill'],
      ['borders', 'border'],
      ['cellStyleXfs', 'xf'],
      ['cellXfs', 'xf'],
      ['cellStyles', 'cellStyle'],
      ['dxfs', 'dxf'],
    ] as const) {
      const node = kid(styles, parent);
      if (!node) continue;
      expect(Number(node.attrs.count), parent).toBe(kids(node, child).length);
    }
    const sst = book.xml('xl/sharedStrings.xml');
    expect(Number(sst.attrs.uniqueCount)).toBe(kids(sst, 'si').length);
    let refs = 0;
    for (const s of book.sheets()) {
      const sheet = book.xml(s.part);
      for (const r of rows(sheet)) refs += kids(r, 'c').filter((c) => c.attrs.t === 's').length;
      const merges = kid(sheet, 'mergeCells');
      if (merges) expect(Number(merges.attrs.count)).toBe(kids(merges, 'mergeCell').length);
    }
    expect(Number(sst.attrs.count)).toBe(refs);
  });

  it('keeps child elements in schema order', () => {
    expectOrder(book.xml('xl/styles.xml'), STYLES_ORDER);
    expectOrder(book.xml('xl/workbook.xml'), WORKBOOK_ORDER);
    for (const s of book.sheets()) expectOrder(book.xml(s.part), WORKSHEET_ORDER);
    expect(kid(book.xml('xl/styles.xml'), 'numFmts')).toBeDefined();
  });

  it('uses only style ids that exist, and every style references real fonts, fills and borders', () => {
    const styles = book.xml('xl/styles.xml');
    const xfs = kids(kid(styles, 'cellXfs')!, 'xf');
    const n = (parent: string, child: string) => kids(kid(styles, parent)!, child).length;
    for (const xf of xfs) {
      expect(Number(xf.attrs.fontId)).toBeLessThan(n('fonts', 'font'));
      expect(Number(xf.attrs.fillId)).toBeLessThan(n('fills', 'fill'));
      expect(Number(xf.attrs.borderId)).toBeLessThan(n('borders', 'border'));
    }
    for (const s of book.sheets()) {
      for (const r of rows(book.xml(s.part))) for (const c of kids(r, 'c')) expect(Number(c.attrs.s)).toBeLessThan(xfs.length);
    }
  });

  it('keeps fills 0 and 1 as none then gray125, which Excel reserves and silently replaces', () => {
    const fills = kids(kid(book.xml('xl/styles.xml'), 'fills')!, 'fill');
    expect(fills.length).toBeGreaterThanOrEqual(2);
    expect(kid(fills[0]!, 'patternFill')!.attrs.patternType).toBe('none');
    expect(kid(fills[1]!, 'patternFill')!.attrs.patternType).toBe('gray125');
    for (const f of fills.slice(2)) expect(kid(f, 'patternFill')!.attrs.patternType).toBe('solid');
  });

  it('writes the document properties from the doc and from now', () => {
    const core = book.xml('docProps/core.xml');
    expect(kid(core, 'dc:title')!.text).toBe(`${doc.title}, ${doc.subtitle}`);
    expect(kid(core, 'dc:creator')!.text).toBe('HCML Monitoring Portal');
    expect(kid(core, 'dcterms:created')!.text).toBe('2026-10-01T07:20:00Z');
    expect(kid(core, 'dcterms:modified')!.text).toBe('2026-10-01T07:20:00Z');
  });
});

describe('workbook sheets', () => {
  it('opens on Summary, then one sheet per table in order', () => {
    expect(book.sheets().map((s) => s.name)).toEqual(['Summary', ...doc.tables.map((t) => t.sheet)]);
    expect(kid(kid(book.sheet('Summary'), 'sheetViews')!, 'sheetView')!.attrs.tabSelected).toBe('1');
  });

  it('lays out the Summary: title block, key figures with tone colour, then the notes', () => {
    const s = book.sheet('Summary');
    expect(value(book, s, 'A1')).toBe(doc.title);
    expect(value(book, s, 'A2')).toBe(doc.subtitle);
    expect(value(book, s, 'A3')).toBe(doc.period);
    expect(value(book, s, 'A4')).toBe(doc.generated);
    expect(styleOf(book, s, 'A1')).toMatchObject({ size: 16, bold: true, color: argb(PALETTE.primary) });
    doc.kpis.forEach((k, i) => {
      const r = 7 + i;
      expect(value(book, s, `A${r}`)).toBe(k.label);
      expect(value(book, s, `B${r}`)).toBe(k.value);
      expect(value(book, s, `C${r}`)).toBe(k.detail);
      expect(styleOf(book, s, `B${r}`)).toMatchObject({ bold: true, color: argb(TONES[k.tone].text) });
    });
    const all = rows(s).flatMap((r) => kids(r, 'c')).map((c) => value(book, s, c.attrs.r!));
    for (const n of doc.notes) {
      expect(all).toContain(n.heading);
      for (const l of n.lines) expect(all).toContain(l);
    }
    expect(doc.kpis.length).toBeGreaterThan(0);
    expect(styleOf(book, s, `A${7 + doc.kpis.length + 1}`)).toMatchObject({ bold: true, color: argb(PALETTE.primary) });
  });

  it('puts the title in row 1, caption in row 2, header in row 4 and data from row 5', () => {
    const s = book.sheet('By site');
    expect(value(book, s, 'A1')).toBe('By site');
    expect(value(book, s, 'A2')).toBe(doc.tables[1]!.caption);
    expect(cell(s, 'A3')).toBeUndefined();
    const t = doc.tables[1]!;
    t.columns.forEach((c, i) => expect(value(book, s, `${String.fromCharCode(65 + i)}4`)).toBe(c.header));
    expect(value(book, s, 'A5')).toBe(t.rows[0]![0]!.text);
  });

  it('styles the header: primary fill, white bold text, centred vertically, wrapped', () => {
    const h = styleOf(book, book.sheet('By site'), 'A4');
    expect(h.fill).toBe(argb(PALETTE.primary));
    expect(h.color).toBe(argb(PALETTE.surface));
    expect(h.bold).toBe(true);
    expect(h.align).toMatchObject({ vertical: 'center', wrapText: '1' });
  });

  it('stores percents, durations and counts as numbers with the right formats', () => {
    const s = book.sheet('By site');
    const t = doc.tables[1]!;
    const pct = cell(s, 'D5')!;
    expect(pct.attrs.t).toBeUndefined();
    expect(Number(kid(pct, 'v')!.text)).toBe(t.rows[0]![3]!.n);
    expect(styleOf(book, s, 'D5').formatCode).toBe('0.0000\\%');
    expect(styleOf(book, s, 'D5').align.horizontal).toBe('right');

    const dur = cell(s, 'G7')!;
    expect(dur.attrs.t).toBeUndefined();
    expect(Number(kid(dur, 'v')!.text)).toBeCloseTo(t.rows[2]![6]!.n! / 86400, 12);
    expect(styleOf(book, s, 'G7').formatCode).toBe('[h]\\:mm\\:ss');

    const count = cell(s, 'B5')!;
    expect(count.attrs.t).toBeUndefined();
    expect(Number(kid(count, 'v')!.text)).toBe(t.rows[0]![1]!.n);
    expect(styleOf(book, s, 'B5').numFmtId).toBe(3);
  });

  it('writes the colons of a duration as literals, so a reader whose time separator is a dot still sees 4:19:35', () => {
    const code = styleOf(book, book.sheet('By site'), 'G7').formatCode ?? '';
    expect(code).toContain('[h]');
    expect(code.replace(/\\:/g, '')).not.toContain(':');
  });

  it('takes the tone colour on a figure as text only, and fills a status cell', () => {
    const s = book.sheet('By site');
    // Site 4 (row 8) is Missed at 97.41%; Site 5 (row 9) is Met.
    expect(styleOf(book, s, 'D8')).toMatchObject({ color: argb(TONES.bad.text), fill: argb(PALETTE.surface2) });
    expect(styleOf(book, s, 'D9')).toMatchObject({ color: argb(TONES.good.text) });
    expect(value(book, s, 'H8')).toBe('Missed');
    expect(styleOf(book, s, 'H8')).toMatchObject({ bold: true, color: argb(TONES.bad.text), fill: argb(TONES.bad.bg) });
    expect(styleOf(book, s, 'H8').align.horizontal).toBe('center');
    expect(styleOf(book, s, 'H9')).toMatchObject({ fill: argb(TONES.good.bg) });
  });

  it('writes a missing figure as its text, muted, italic and right aligned, never an empty cell', () => {
    const s = book.sheet('By site');
    // Site 10 (row 14) has no figure.
    const c = cell(s, 'D14')!;
    expect(c.attrs.t).toBe('s');
    expect(value(book, s, 'D14')).toBe('No data');
    expect(styleOf(book, s, 'D14')).toMatchObject({ italic: true, color: argb(PALETTE.muted) });
    expect(styleOf(book, s, 'D14').align.horizontal).toBe('right');
    expect(value(book, s, 'H14')).toBe('No data');
  });

  it('bands alternate rows with surface2 and leaves the others plain', () => {
    const s = book.sheet('By site');
    expect(styleOf(book, s, 'A5').fill).toBeUndefined();
    expect(styleOf(book, s, 'A6').fill).toBe(argb(PALETTE.surface2));
    expect(styleOf(book, s, 'A7').fill).toBeUndefined();
  });

  it('draws the footer row bold on the tint fill', () => {
    const s = book.sheet('Never measured');
    expect(value(book, s, 'A7')).toBe('2 devices');
    expect(styleOf(book, s, 'A7')).toMatchObject({ bold: true, fill: argb(PALETTE.tint) });
    expect(styleOf(book, s, 'C7')).toMatchObject({ bold: true, fill: argb(PALETTE.tint) });
  });

  it('shows the empty text in place of the rows, without a filter', () => {
    const s = book.sheet('Web checks');
    expect(value(book, s, 'A5')).toBe('No web checks are configured in Zabbix.');
    expect(rows(s).filter((r) => Number(r.attrs.r) > 5)).toHaveLength(0);
    expect(kid(s, 'autoFilter')).toBeUndefined();
    expect(kid(book.xml('xl/workbook.xml'), 'definedNames')!.kids.some((d) => d.text.startsWith("'Web checks'!$A"))).toBe(false);
    expect(styleOf(book, s, 'A5')).toMatchObject({ italic: true, color: argb(PALETTE.muted) });
  });

  it('writes the 138-device table as 138 data rows with a filter over them', () => {
    const s = book.sheet('By device');
    const data = rows(s).filter((r) => Number(r.attrs.r) >= 5);
    expect(data).toHaveLength(138);
    expect(kid(s, 'autoFilter')!.attrs.ref).toBe('A4:I142');
    expect(kid(s, 'dimension')!.attrs.ref).toBe('A1:I142');
  });

  it('freezes directly under the header, hides gridlines, colours the tabs', () => {
    const view = kid(kid(book.sheet('By device'), 'sheetViews')!, 'sheetView')!;
    expect(view.attrs.showGridLines).toBe('0');
    expect(kid(view, 'pane')!.attrs).toMatchObject({ ySplit: '4', topLeftCell: 'A5', state: 'frozen' });
    expect(kid(kid(book.sheet('Summary'), 'sheetPr')!, 'tabColor')!.attrs.rgb).toBe(argb(PALETTE.primary));
    expect(kid(kid(book.sheet('By device'), 'sheetPr')!, 'tabColor')!.attrs.rgb).toBe(argb(PALETTE.mid));
  });

  it('sets A4 landscape, one page wide, margins of half an inch, and the footer text', () => {
    const s = book.sheet('By device');
    expect(kid(s, 'pageSetup')!.attrs).toMatchObject({ paperSize: '9', orientation: 'landscape', fitToWidth: '1', fitToHeight: '0' });
    expect(kid(kid(s, 'sheetPr')!, 'pageSetUpPr')!.attrs.fitToPage).toBe('1');
    expect(kid(s, 'pageMargins')!.attrs).toMatchObject({ left: '0.5', right: '0.5', top: '0.5', bottom: '0.5' });
    expect(kid(kid(s, 'headerFooter')!, 'oddFooter')!.text).toBe(`&L${doc.footer}&RPage &P of &N`);
  });

  it('fits the summary on one printed page, and leaves each table one page wide and as long as it runs', () => {
    expect(kid(book.sheet('Summary'), 'pageSetup')!.attrs).toMatchObject({ fitToWidth: '1', fitToHeight: '1' });
    for (const name of ['By site', 'By device']) expect(kid(book.sheet(name), 'pageSetup')!.attrs.fitToHeight).toBe('0');
  });

  it('escapes an ampersand in the footer text', () => {
    const b = new Book(buildXlsx(miniDoc({ footer: 'R&D | SLA & more' }), NOW));
    expect(kid(kid(b.sheet('T'), 'headerFooter')!, 'oddFooter')!.text).toBe('&LR&&D | SLA && more&RPage &P of &N');
  });

  it('defines print titles and a filter range for each table sheet', () => {
    const names = kids(kid(book.xml('xl/workbook.xml'), 'definedNames')!, 'definedName');
    const sheets = book.sheets();
    const of = (name: string, sheet: string) =>
      names.find((n) => n.attrs.name === name && Number(n.attrs.localSheetId) === sheets.findIndex((s) => s.name === sheet));
    expect(of('_xlnm.Print_Titles', 'By device')!.text).toBe("'By device'!$4:$4");
    expect(of('_xlnm._FilterDatabase', 'By device')!.text).toBe("'By device'!$A$4:$I$142");
    expect(of('_xlnm._FilterDatabase', 'By device')!.attrs.hidden).toBe('1');
    expect(of('_xlnm.Print_Titles', 'Summary')).toBeUndefined();
    for (const t of doc.tables) expect(of('_xlnm.Print_Titles', t.sheet), t.sheet).toBeDefined();
  });

  it('never merges a single cell', () => {
    for (const t of [miniDoc(), doc]) {
      const b = new Book(buildXlsx(t, NOW));
      for (const s of b.sheets()) {
        const merges = kid(b.xml(s.part), 'mergeCells');
        for (const m of merges ? kids(merges, 'mergeCell') : []) {
          const [a, z] = m.attrs.ref!.split(':');
          expect(a).not.toBe(z);
        }
      }
    }
  });

  it('gives a wrapped long name a taller row than a short one', () => {
    const s = book.sheet('By device');
    const heights = rows(s).filter((r) => Number(r.attrs.r) >= 5).map((r) => Number(r.attrs.ht));
    expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights));
  });
});

describe('workbook column widths', () => {
  it('never puts a column under its floor, below zero or past 255, on the fixture and on the real report', () => {
    for (const { label, d, b } of [
      { label: 'fixture', d: doc, b: book },
      { label: 'real report', d: real, b: realBook },
    ]) {
      for (const t of d.tables) expect(badWidths(t.columns, widthsOf(b, t.sheet)), `${label}: ${t.sheet}`).toEqual([]);
    }
  });

  it('keeps the heaviest column off the bottom, and gives every text column room for its longest value up to the cap', () => {
    for (const { label, d, b } of [
      { label: 'fixture', d: doc, b: book },
      { label: 'real report', d: real, b: realBook },
    ]) {
      for (const t of d.tables) {
        const w = widthsOf(b, t.sheet);
        const heavy = t.columns.reduce((best, c, i) => (c.weight > t.columns[best]!.weight ? i : best), 0);
        expect(w[heavy]!, `${label}: ${t.sheet}, ${t.columns[heavy]!.header}`).toBeGreaterThan(Math.min(...w));
        t.columns.forEach((c, i) => {
          if (c.kind !== 'text') return;
          const longest = Math.max(0, ...t.rows.map((r) => r[i]!.text.length));
          // A digit is a unit and ordinary text runs a little narrower, so 0.9 per character plus the indent is a safe lower bound.
          expect(w[i]!, `${label}: ${t.sheet}, ${c.header}`).toBeGreaterThanOrEqual(0.9 * Math.min(longest, 45) + 2);
        });
      }
    }
  });

  it('gives the real By device table a Device column that is not the narrowest and holds its longest name on one line', () => {
    const t = realTable('By device');
    expect(t.columns.length, 'the real table, 10 columns today, not a stub').toBeGreaterThanOrEqual(8);
    const w = widthsOf(realBook, 'By device');
    const device = t.columns.findIndex((c) => c.header === 'Device');
    const longest = Math.max(...t.rows.map((r) => r[device]!.text.length));
    expect(w[device]).toBeGreaterThan(Math.min(...w));
    expect(w[device]).toBe(Math.max(...w));
    expect(w[device]!).toBeGreaterThanOrEqual(0.9 * Math.min(longest, 45) + 2);

    // Rows follow the widths: nearly all one line (18 pt), none of three lines (48 pt or more).
    const h = heightsOf(realBook.sheet('By device'));
    expect(h).toHaveLength(t.rows.length);
    expect(h.filter((x) => x === 18).length / h.length).toBeGreaterThanOrEqual(0.9);
    expect(Math.max(...h)).toBeLessThan(48);
    // "SLA (HCML method)" does not fit on one line, and the header row says so.
    expect(heightsOf(realBook.sheet('By device'), 4)[0]!).toBeGreaterThanOrEqual(40);
  });

  it('fits each text column to its longest value, taking room from a column that has more than it needs', () => {
    // By weight alone the heavy percent column would take nearly everything and the three names would sit at their floor.
    const columns = [col('A'), col('B'), col('C'), col('Share', 'percent', 12)];
    const lens = [20, 30, 40];
    const d = miniDoc({ tables: [miniTable({ columns, rows: [[...lens.map((n) => ({ text: digits(n) })), { text: '50%', n: 50 }]] })] });
    const b = new Book(buildXlsx(d, NOW));
    const w = widthsOf(b, 'T');
    lens.forEach((n, i) => expect(w[i]!, `column ${i}`).toBeGreaterThanOrEqual(n + 3));
    expect(badWidths(columns, w)).toEqual([]);
    expect(heightsOf(b.sheet('T'))).toEqual([18]);
  });

  it('asks for no more than 45 characters for one very long value, and the others keep what they need', () => {
    const columns = [col('Long'), col('Name'), col('Share', 'percent')];
    const d = miniDoc({ tables: [miniTable({ columns, rows: [[{ text: digits(300) }, { text: digits(20) }, { text: '50%', n: 50 }]] })] });
    const w = widthsOf(new Book(buildXlsx(d, NOW)), 'T');
    expect(w[0]!).toBeGreaterThanOrEqual(45);
    expect(w[0]!).toBeLessThan(60);
    expect(w[1]!).toBeGreaterThanOrEqual(23);
  });

  it('sizes rows from the final widths, not from the weight shares', () => {
    // Column A weighs 1 against 10, so its share is under its floor of 14, where 40 digits take several lines.
    const columns = [col('A', 'text', 1), col('B', 'text', 10)];
    const d = miniDoc({ tables: [miniTable({ columns, rows: [[{ text: digits(40) }, { text: 'b' }]] })] });
    const b = new Book(buildXlsx(d, NOW));
    expect(widthsOf(b, 'T')[0]!).toBeGreaterThanOrEqual(43);
    expect(heightsOf(b.sheet('T'))).toEqual([18]);
  });

  it('spreads a table that needs little to about 120 and keeps the real tables within 170', () => {
    const columns = [col('A'), col('B', 'count'), col('C', 'percent')];
    const small = new Book(buildXlsx(miniDoc({ tables: [miniTable({ columns, rows: [[{ text: 'a' }, { text: '1', n: 1 }, { text: '5%', n: 5 }]] })] }), NOW));
    expect(total(widthsOf(small, 'T'))).toBeCloseTo(120, 0);
    for (const t of real.tables) expect(total(widthsOf(realBook, t.sheet)), t.sheet).toBeLessThanOrEqual(170);
  });

  it('gives the footer row its room too, but only when the footer is drawn', () => {
    // The footer is the longest text in column A, and the weight alone would leave A at its floor.
    const columns = [col('A', 'text', 1), col('B', 'text', 10)];
    const footer = [{ text: digits(40) }, { text: 'z' }];
    const withRows = new Book(buildXlsx(miniDoc({ tables: [miniTable({ columns, rows: [[{ text: 'x' }, { text: 'y' }]], footer })] }), NOW));
    expect(widthsOf(withRows, 'T')[0]!).toBeGreaterThanOrEqual(43);
    expect(heightsOf(withRows.sheet('T'))).toEqual([18, 18]);
    // With no rows the footer is not drawn, so it asks for nothing.
    const noRows = new Book(buildXlsx(miniDoc({ tables: [miniTable({ columns, rows: [], footer })] }), NOW));
    expect(widthsOf(noRows, 'T')[0]!).toBeLessThan(20);
  });

  it('stays on its budget when the weights crush some columns onto their floors', () => {
    // The text column weighs ten times the rest, whose shares fall under their floors: they sit on the floors and the text takes what is left.
    const columns = [col('Name', 'text', 10), col('A', 'percent'), col('B', 'percent'), col('C', 'count'), col('D', 'status')];
    const row = [{ text: 'x' }, { text: '5%', n: 5 }, { text: '5%', n: 5 }, { text: '5', n: 5 }, { text: 'Met' }];
    const w = widthsOf(new Book(buildXlsx(miniDoc({ tables: [miniTable({ columns, rows: [row] })] }), NOW)), 'T');
    expect(badWidths(columns, w)).toEqual([]);
    expect(total(w)).toBeCloseTo(120, 0);
    expect(w[0]!).toBeGreaterThan(70);
  });

  it('lets a table run wider than its budget when the floors alone need it', () => {
    const columns = Array.from({ length: 14 }, (_, i) => col(`Column ${i + 1}`));
    const d = miniDoc({ tables: [miniTable({ columns, rows: [rowOf(columns, (i) => `value ${i}`)] })] });
    const w = widthsOf(new Book(buildXlsx(d, NOW)), 'T');
    expect(badWidths(columns, w)).toEqual([]);
    expect(total(w)).toBeGreaterThanOrEqual(14 * FLOOR.text);
  });

  it('sizes 3,000 columns, and the 16,384 Excel allows, without a bad width and in good time', { timeout: 30000 }, () => {
    for (const n of [3000, 16384]) {
      const columns = Array.from({ length: n }, (_, i) => col(`H${i}`, KINDS[i % KINDS.length], 1 + (i % 7)));
      const d = miniDoc({ tables: [miniTable({ columns, rows: [rowOf(columns, () => 'x')] })] });
      const t0 = performance.now();
      const b = new Book(buildXlsx(d, NOW));
      const w = [...b.raw(b.sheets()[1]!.part).matchAll(/<col min="\d+" max="\d+" width="([^"]+)"/g)].map((m) => Number(m[1]));
      expect(performance.now() - t0, `${n} columns`).toBeLessThan(5000);
      expect(badWidths(columns, w), `${n} columns`).toEqual([]);
    }
  });

  it('squeezes a table whose content needs more than 170 instead of growing it', () => {
    const columns = Array.from({ length: 4 }, (_, i) => col(`T${i}`));
    const d = miniDoc({ tables: [miniTable({ columns, rows: [rowOf(columns, () => digits(300))] })] });
    const w = widthsOf(new Book(buildXlsx(d, NOW)), 'T');
    expect(badWidths(columns, w)).toEqual([]);
    expect(total(w)).toBeGreaterThanOrEqual(169);
    expect(total(w)).toBeLessThanOrEqual(171);
  });

  it('never takes a donor under its floor, however much the text columns ask for', () => {
    // Four columns want 48 each and two percent columns hold only what is above their floor.
    const columns = [...Array.from({ length: 4 }, (_, i) => col(`T${i}`)), col('P1', 'percent'), col('P2', 'percent')];
    const row = [...columns.slice(0, 4).map(() => ({ text: digits(300) })), { text: '50%', n: 50 }, { text: '50%', n: 50 }];
    const d = miniDoc({ tables: [miniTable({ columns, rows: [row] })] });
    const w = widthsOf(new Book(buildXlsx(d, NOW)), 'T');
    expect(badWidths(columns, w)).toEqual([]);
  });

  it('never takes a donor under what its own longest value needs', () => {
    // The two long columns ask for almost all the room the others hold above their floors, so the name has to keep its own.
    const columns = [col('Long 1'), col('Long 2'), col('Name'), col('Share', 'percent')];
    const row = [{ text: digits(300) }, { text: digits(300) }, { text: digits(20) }, { text: '50%', n: 50 }];
    const d = miniDoc({ tables: [miniTable({ columns, rows: [row] })] });
    const w = widthsOf(new Book(buildXlsx(d, NOW)), 'T');
    expect(w[2]!).toBeGreaterThanOrEqual(23);
    expect(badWidths(columns, w)).toEqual([]);
  });

  it('keeps the longest header word whole and the widest figure shown, even in a column its weight would crush', () => {
    const columns = [col('Name', 'text', 30), col('Unavailability', 'percent'), col('Count', 'count'), col('Exact', 'percent'), col('Time', 'duration')];
    const row = [
      { text: 'x' },
      { text: '50%', n: 50 },
      { text: '1,234,567,890', n: 1234567890 },
      { text: '99.99999999%', n: 99.99999999 },
      { text: 'long', n: 4e8 },
    ];
    const d = miniDoc({ tables: [miniTable({ columns, rows: [row] })] });
    const w = widthsOf(new Book(buildXlsx(d, NOW)), 'T');
    expect(w[1]!, 'a 14 letter header word').toBeGreaterThanOrEqual(15);
    expect(w[2]!, '1,234,567,890').toBeGreaterThanOrEqual(16);
    expect(w[3]!, '99.99999999%').toBeGreaterThanOrEqual(15);
    expect(w[4]!, '111111:06:40').toBeGreaterThanOrEqual(15);
  });

  it('meets the smallest shortfall first, so a name that nearly fits is not left wrapped for one that never will', () => {
    // Three columns ask for 48 and one for 42, and the room one percent column can give covers the 42 and part of one 48.
    const columns = [col('Near'), col('Far 1'), col('Far 2'), col('Far 3'), col('Share', 'percent')];
    const row = [{ text: digits(36) }, { text: digits(300) }, { text: digits(300) }, { text: digits(300) }, { text: '50%', n: 50 }];
    const w = widthsOf(new Book(buildXlsx(miniDoc({ tables: [miniTable({ columns, rows: [row] })] }), NOW)), 'T');
    expect(w[0]!).toBeGreaterThanOrEqual(36 + 3);
    expect(badWidths(columns, w)).toEqual([]);
  });

  it('sets a row as tall as its lines: 18, 33 and 48 points for one, two and three', () => {
    const d = miniDoc({ tables: [miniTable({ rows: [[{ text: 'a' }], [{ text: 'a\nb' }], [{ text: 'a\nb\nc' }]] })] });
    expect(heightsOf(new Book(buildXlsx(d, NOW)).sheet('T'))).toEqual([18, 33, 48]);
  });

  it('treats a weight that is not a positive number as none: a finite width, the floor met', () => {
    const weights = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -3, 0, 1e308, Number.MIN_VALUE, 2];
    const columns = weights.map((weight, i) => col(`C${i}`, KINDS[i % KINDS.length], weight));
    const w = widthsOf(new Book(buildXlsx(miniDoc({ tables: [miniTable({ columns, rows: [rowOf(columns, () => 'x')] })] }), NOW)), 'T');
    expect(badWidths(columns, w)).toEqual([]);
    w.forEach((x) => expect(x).toBeGreaterThan(0));

    // A column that weighs nothing asks for nothing: it keeps its floor and the rest goes to the other.
    const lone = [col('Heavy', 'text', 5), col('Light', 'text', Number.NaN)];
    const two = widthsOf(new Book(buildXlsx(miniDoc({ tables: [miniTable({ columns: lone, rows: [rowOf(lone, () => 'x')] })] }), NOW)), 'T');
    expect(two[1]).toBe(FLOOR.text);
    expect(two[0]!).toBeGreaterThan(100);

    // With no usable weight at all the columns share equally, and still no NaN.
    const flat = [Number.NaN, -1, 0, Number.POSITIVE_INFINITY].map((weight, i) => col(`F${i}`, 'text', weight));
    const even = widthsOf(new Book(buildXlsx(miniDoc({ tables: [miniTable({ columns: flat, rows: [rowOf(flat, () => 'x')] })] }), NOW)), 'T');
    expect(badWidths(flat, even)).toEqual([]);
    expect(new Set(even).size).toBe(1);
  });

  it('keeps every row height within the 409.5 points Excel allows', () => {
    const long = 'word '.repeat(6000);
    const d = miniDoc({
      title: long,
      subtitle: long,
      tables: [miniTable({ title: long, caption: long, columns: [col('H'.repeat(30000))], rows: [[{ text: long }]] })],
    });
    const b = new Book(buildXlsx(d, NOW));
    for (const sheet of b.sheets()) for (const r of rows(b.xml(sheet.part))) expect(Number(r.attrs.ht)).toBeLessThanOrEqual(409.5);
    expect(heightsOf(b.sheet('T'))).toEqual([409.5]);
  });
});

describe('workbook numbers', () => {
  const numTable = (kind: ColumnKind, cells: Cell[], footer?: Cell) =>
    miniTable({
      columns: [col('Name'), col('Figure', kind)],
      rows: cells.map((c) => [{ text: 'a' }, c]),
      ...(footer ? { footer: [{ text: 'Total' }, footer] } : {}),
    });
  const built = (t: Table) => {
    const b = new Book(buildXlsx(miniDoc({ tables: [t] }), NOW));
    return { b, s: b.sheet('T') };
  };

  it('gives a percent as many decimals as its text prints, and at least four', () => {
    const cells: Cell[] = [
      { text: '99.38%', n: 99.38 },
      { text: '98.99998%', n: 98.99998 },
      { text: '98.99999998%', n: 98.99999998 },
      { text: '100%', n: 100 },
      { text: `99.${'9'.repeat(30)}%`, n: 99.99 },
    ];
    const { b, s } = built(numTable('percent', cells, { text: '98.99998%', n: 98.99998 }));
    const codes = [...cells.keys(), cells.length].map((i) => styleOf(b, s, `B${5 + i}`).formatCode);
    expect(codes).toEqual(['0.0000\\%', '0.00000\\%', '0.00000000\\%', '0.0000\\%', `0.${'0'.repeat(15)}\\%`, '0.00000\\%']);
    // The number itself is untouched, and the literal percent sign is escaped, never quoted, so Quick Look does not scale it by 100.
    expect(Number(kid(cell(s, 'B6')!, 'v')!.text)).toBe(98.99998);
    for (const c of codes) expect(c).not.toContain('"');
  });

  it('gives a percent below 100 the decimals it takes not to read as 100, and no more (BK-46)', () => {
    const cells: Cell[] = [
      { text: '99.99%', n: 99.9999996 },
      { text: '99.99%', n: 99.99996 },
      { text: '99.99%', n: 99.9951 },
      { text: '100.00%', n: 100 },
    ];
    const { b, s } = built(numTable('percent', cells));
    const codes = cells.map((_, i) => styleOf(b, s, `B${5 + i}`).formatCode);
    expect(codes).toEqual(['0.0000000\\%', '0.00000\\%', '0.0000\\%', '0.0000\\%']);
    expect(Number(kid(cell(s, 'B5')!, 'v')!.text)).toBe(99.9999996);
  });

  it('reads the decimals of a text that writes them with a comma, so a style never cuts a figure back to the target', () => {
    const cells: Cell[] = [
      { text: '99,38%', n: 99.38 },
      { text: '98,99998%', n: 98.99998 },
      { text: '98,99999998%', n: 98.99999998 },
      { text: '100%', n: 100 },
      { text: `99,${'9'.repeat(30)}%`, n: 99.99 },
    ];
    const { b, s } = built(numTable('percent', cells, { text: '98,99998%', n: 98.99998 }));
    const codes = [...cells.keys(), cells.length].map((i) => styleOf(b, s, `B${5 + i}`).formatCode);
    expect(codes).toEqual(['0.0000\\%', '0.00000\\%', '0.00000000\\%', '0.0000\\%', `0.${'0'.repeat(15)}\\%`, '0.00000\\%']);
    expect(Number(kid(cell(s, 'B6')!, 'v')!.text)).toBe(98.99998);
  });

  it('shares one number format between the cells that need the same decimals', () => {
    const cells: Cell[] = [4, 5, 4, 6, 5, 4].map((d) => ({ text: `98.${'9'.repeat(d)}%`, n: 98.9 }));
    const { b } = built(numTable('percent', cells));
    const fmts = kids(kid(b.xml('xl/styles.xml'), 'numFmts')!, 'numFmt');
    expect(fmts.map((f) => f.attrs.formatCode!).sort((a, z) => a.length - z.length)).toEqual(['0.0000\\%', '0.00000\\%', '0.000000\\%']);
    expect(new Set(fmts.map((f) => f.attrs.numFmtId)).size).toBe(3);
  });

  it('shows 98.99998% as such beside the word Missed, never as 99.0000%', () => {
    const { b, s } = built(
      miniTable({
        columns: [col('Name'), col('SLA', 'percent'), col('Status', 'status')],
        rows: [[{ text: 'a' }, { text: '98.99998%', n: 98.99998, tone: 'bad' }, { text: 'Missed', tone: 'bad' }]],
      }),
    );
    expect(value(b, s, 'B5')).toBe(98.99998);
    expect(styleOf(b, s, 'B5').formatCode).toBe('0.00000\\%');
    expect(value(b, s, 'C5')).toBe('Missed');
  });

  it('falls back to the cell text, muted and italic, for a figure that is NaN or infinite, and never writes NaN or Infinity', () => {
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const kind of ['percent', 'duration', 'count'] as const) {
      const { b, s } = built(numTable(kind, bad.map((n, i) => ({ text: `bad ${i}`, n }))));
      bad.forEach((_, i) => {
        const ref = `B${5 + i}`;
        expect(cell(s, ref)!.attrs.t, `${kind} ${ref}`).toBe('s');
        expect(value(b, s, ref), `${kind} ${ref}`).toBe(`bad ${i}`);
        expect(styleOf(b, s, ref), `${kind} ${ref}`).toMatchObject({ italic: true, color: argb(PALETTE.muted) });
        expect(styleOf(b, s, ref).align.horizontal).toBe('right');
      });
      expect(b.raw(b.sheets()[1]!.part)).not.toMatch(/NaN|Infinity/);
    }
  });

  it('falls back to the cell text for a negative duration or count, and still stores zero as a number', () => {
    for (const kind of ['duration', 'count'] as const) {
      const { b, s } = built(numTable(kind, [{ text: 'minus one', n: -1 }, { text: 'minus a bit', n: -0.5 }, { text: 'none', n: 0 }]));
      for (const ref of ['B5', 'B6']) {
        expect(cell(s, ref)!.attrs.t, `${kind} ${ref}`).toBe('s');
        expect(styleOf(b, s, ref), `${kind} ${ref}`).toMatchObject({ italic: true, color: argb(PALETTE.muted) });
      }
      expect(value(b, s, 'B5')).toBe('minus one');
      expect(cell(s, 'B7')!.attrs.t, kind).toBeUndefined();
      expect(value(b, s, 'B7')).toBe(0);
    }
  });

  it('writes a missing figure, null or absent, as its text', () => {
    const { b, s } = built(numTable('percent', [{ text: 'No data', n: null }, { text: 'No data' }]));
    for (const ref of ['B5', 'B6']) {
      expect(value(b, s, ref)).toBe('No data');
      expect(styleOf(b, s, ref)).toMatchObject({ italic: true, color: argb(PALETTE.muted) });
    }
  });
});

describe('workbook colours', () => {
  const TONE_LIST: Tone[] = ['good', 'warn', 'bad', 'muted', 'none'];
  const columns = [col('Name', 'text', 3), col('SLA', 'percent'), col('Status', 'status')];
  const t = miniTable({
    columns,
    rows: TONE_LIST.map((tone) => [{ text: `name ${tone}`, tone }, { text: '99.5%', n: 99.5, tone }, { text: tone, tone }]),
    footer: [
      { text: 'Total', tone: 'bad' },
      { text: '98.5%', n: 98.5, tone: 'bad' },
      { text: 'Missed', tone: 'bad' },
    ],
  });
  const b = new Book(buildXlsx(miniDoc({ tables: [t] }), NOW));
  const s = b.sheet('T');

  it('colours the text of a text cell and of a figure by its tone', () => {
    TONE_LIST.forEach((tone, i) => {
      expect(styleOf(b, s, `A${5 + i}`), `text ${tone}`).toMatchObject({ color: argb(TONES[tone].text), bold: false });
      expect(styleOf(b, s, `B${5 + i}`), `figure ${tone}`).toMatchObject({ color: argb(TONES[tone].text), bold: false });
    });
  });

  it('writes a status cell bold, in its tone colour, on its tone fill, and a toneless one on no tone fill', () => {
    TONE_LIST.forEach((tone, i) => {
      const st = styleOf(b, s, `C${5 + i}`);
      expect(st, `status ${tone}`).toMatchObject({ bold: true, color: argb(TONES[tone].text) });
      if (tone === 'none') expect([undefined, argb(PALETTE.surface2)]).toContain(st.fill);
      else expect(st.fill, `status ${tone}`).toBe(argb(TONES[tone].bg));
      expect(st.align.horizontal).toBe('center');
    });
  });

  it('draws the footer row in bold on the tint, a status cell included, with the tone as colour only', () => {
    const row = 5 + TONE_LIST.length;
    expect(value(b, s, `C${row}`)).toBe('Missed');
    for (const letter of ['A', 'B', 'C']) {
      expect(styleOf(b, s, `${letter}${row}`), letter).toMatchObject({ bold: true, color: argb(TONES.bad.text), fill: argb(PALETTE.tint) });
    }
  });
});

describe('workbook edge input', () => {
  it('shows "Nothing to list." for a table with no rows and no message of its own, and draws no footer', () => {
    const t = miniTable({ rows: [], footer: [{ text: 'closing row' }] });
    const b = new Book(buildXlsx(miniDoc({ tables: [t] }), NOW));
    const s = b.sheet('T');
    expect(value(b, s, 'A5')).toBe('Nothing to list.');
    // An indent only means something beside a left, right or distributed alignment.
    expect(styleOf(b, s, 'A5').align).toMatchObject({ horizontal: 'left', indent: '1' });
    expect(rows(s).filter((r) => Number(r.attrs.r) > 5)).toHaveLength(0);
    expect(kid(s, 'autoFilter')).toBeUndefined();
    expect(b.strings()).not.toContain('closing row');
    expect(kid(s, 'dimension')!.attrs.ref).toBe('A1:A5');
  });

  it('shows a message of its own in place of the table', () => {
    const b = new Book(buildXlsx(miniDoc({ tables: [miniTable({ rows: [], empty: 'None here.' })] }), NOW));
    expect(value(b, b.sheet('T'), 'A5')).toBe('None here.');
  });

  it('refuses a table with no columns, with the message the PDF writer repeats', () => {
    let caught: unknown;
    try {
      buildXlsx(miniDoc({ tables: [miniTable({ title: 'Devices', columns: [], rows: [] })] }), NOW);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('Table "Devices" has no columns.');
  });

  it('refuses a report time that is not a date, rather than stamping the epoch', () => {
    for (const bad of [new Date(Number.NaN), new Date('not a date'), 1_790_000_000_000 as unknown as Date]) {
      let caught: unknown;
      try {
        buildXlsx(miniDoc(), bad);
      } catch (e) {
        caught = e;
      }
      expect(caught, String(bad)).toBeInstanceOf(RangeError);
      expect((caught as Error).message).toBe('The report time is not a valid date.');
    }
    expect(() => buildXlsx(miniDoc(), new Date(0))).not.toThrow();
  });

  it('refuses a table of more than 16,384 columns at once, before sizing any of them', { timeout: 20000 }, () => {
    const columns = Array.from({ length: 40000 }, (_, i) => col(`H${i}`));
    const t0 = performance.now();
    let caught: unknown;
    try {
      buildXlsx(miniDoc({ tables: [miniTable({ columns, rows: [] })] }), NOW);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RangeError);
    expect((caught as Error).message).toBe('Table "T" is too large for a worksheet.');
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('reads no column before it refuses a table of too many', () => {
    // Sizing a column reads its header, kind and weight; the guard must come first, so none of these getters ever runs.
    const trap = {
      get header(): string {
        throw new Error('header read before the size guard');
      },
      get kind(): ColumnKind {
        throw new Error('kind read before the size guard');
      },
      get weight(): number {
        throw new Error('weight read before the size guard');
      },
    };
    const columns: Column[] = Array.from({ length: 16385 }, () => trap);
    expect(() => buildXlsx(miniDoc({ tables: [miniTable({ columns, rows: [] })] }), NOW)).toThrow('Table "T" is too large for a worksheet.');
  });

  it('refuses a table of more rows than a worksheet holds', () => {
    const rowsTooMany = new Array<Cell[]>(1048571).fill([]);
    expect(() => buildXlsx(miniDoc({ tables: [miniTable({ rows: rowsTooMany })] }), NOW)).toThrow(/too large for a worksheet/);
  });

  it('numbers duplicate sheet names without ever repeating one', () => {
    const names = ['a', 'a', 'a (2)', 'a', 'A', 'a (2) (2)', 'History', 'history'];
    const b = new Book(buildXlsx(miniDoc({ tables: names.map((n) => miniTable({ sheet: n })) }), NOW));
    const got = b.sheets().map((x) => x.name);
    expect(got).toEqual(['Summary', 'a', 'a (2)', 'a (2) (2)', 'a (3)', 'A (4)', 'a (2) (2) (2)', 'History (2)', 'history (3)']);
    expect(new Set(got.map((n) => n.toLowerCase())).size).toBe(got.length);
  });

  it('names 20,000 sheets of one name in good time', { timeout: 15000 }, () => {
    const tables = Array.from({ length: 20000 }, (_, i) => miniTable({ title: `T${i}`, sheet: 'Same' }));
    const t0 = performance.now();
    const b = new Book(buildXlsx(miniDoc({ tables }), NOW));
    const got = b.sheets().map((x) => x.name);
    expect(got).toHaveLength(20001);
    expect([got[1], got[2], got[20000]]).toEqual(['Same', 'Same (2)', 'Same (20000)']);
    expect(new Set(got).size).toBe(got.length);
    expect(performance.now() - t0).toBeLessThan(10000);
  });
});

describe('workbook safety', () => {
  const hostile = doc.tables[2]!.rows.map((r) => r[0]!.text).filter((t) => /^[=<A]|^Caf/.test(t));

  it('stores the fixture\'s hostile names as strings, escaped, and writes no formula', () => {
    expect(hostile).toHaveLength(4);
    const s = book.sheet('By device');
    const col = rows(s).filter((r) => Number(r.attrs.r) >= 5).map((r) => cell(s, `A${r.attrs.r}`)!);
    for (const text of hostile) {
      const at = col.find((c) => book.strings()[Number(kid(c, 'v')!.text)] === text);
      expect(at, text).toBeDefined();
      expect(at!.attrs.t).toBe('s');
    }
    for (const s2 of book.sheets()) expect(book.raw(s2.part)).not.toContain('<f>');
    const raw = book.raw('xl/sharedStrings.xml');
    expect(raw).toContain('&lt;Core &amp; edge&gt; (backup)');
    expect(raw).not.toContain('<Core');
    expect(raw).toContain('Café routeur Zürich');
  });

  it('keeps a leading =, +, - or @ as text', () => {
    const odd = ['=1+1', '+1', '-2+3', '@SUM(A1)', '=HYPERLINK("http://x","y")'];
    const b = new Book(buildXlsx(miniDoc({ tables: [miniTable({ rows: odd.map((t) => [{ text: t }]) })] }), NOW));
    const s = b.sheet('T');
    odd.forEach((t, i) => {
      expect(cell(s, `A${5 + i}`)!.attrs.t).toBe('s');
      expect(value(b, s, `A${5 + i}`)).toBe(t);
    });
    expect(b.raw(b.sheets()[1]!.part)).not.toContain('<f');
  });

  it('keeps a literal _x0041_ from being read as an escape', () => {
    const b = new Book(buildXlsx(miniDoc({ tables: [miniTable({ rows: [[{ text: 'a_x0041_b' }]] })] }), NOW));
    expect(b.raw('xl/sharedStrings.xml')).toContain('a_x005F_x0041_b');
  });

  it('drops characters XML 1.0 forbids, and a lone surrogate, but keeps a real pair and tabs', () => {
    const dirty = `a${ch(1)}b${ch(0xb)}c${ch(0xfffe)}d${ch(0xffff)}e${ch(0xd800)}f${ch(0xdc00)}g\th\u{1F600}i`;
    const b = new Book(buildXlsx(miniDoc({ title: dirty, tables: [miniTable({ rows: [[{ text: dirty }]] })] }), NOW));
    const want = 'abcdefg\th\u{1F600}i';
    expect(value(b, b.sheet('T'), 'A5')).toBe(want);
    expect(value(b, b.sheet('Summary'), 'A1')).toBe(want);
    for (const name of b.parts.keys()) expect(() => parseXml(b.raw(name)), name).not.toThrow();
  });

  it('marks leading and trailing spaces to be preserved', () => {
    const b = new Book(buildXlsx(miniDoc({ tables: [miniTable({ rows: [[{ text: '  padded  ' }], [{ text: 'plain' }]] })] }), NOW));
    const raw = b.raw('xl/sharedStrings.xml');
    expect(raw).toContain('<t xml:space="preserve">  padded  </t>');
    expect(raw).toContain('<t>plain</t>');
  });

  it('cuts a cell at 32,767 characters', () => {
    const b = new Book(buildXlsx(miniDoc({ tables: [miniTable({ rows: [[{ text: 'x'.repeat(40000) }]] })] }), NOW));
    expect((value(b, b.sheet('T'), 'A5') as string).length).toBe(32767);
  });

  it('does not cut a surrogate pair at the cap', () => {
    const b = new Book(buildXlsx(miniDoc({ tables: [miniTable({ rows: [[{ text: 'x'.repeat(32766) + '\u{1F600}' }]] })] }), NOW));
    const v = value(b, b.sheet('T'), 'A5') as string;
    expect(v).toBe('x'.repeat(32766));
    expect(() => parseXml(b.raw('xl/sharedStrings.xml'))).not.toThrow();
  });

  it('makes sheet names valid and unique', () => {
    const names = ['a[b]:c*d?e/f\\g', "'quoted'", 'x'.repeat(50), 'Same', 'same', 'Summary', '', 'History', "O'Brien", 'A&B <c>', 'y'.repeat(31), 'y'.repeat(31)];
    const tables = names.map((n) => miniTable({ sheet: n }));
    const b = new Book(buildXlsx(miniDoc({ tables }), NOW));
    const got = b.sheets().map((s) => s.name);
    expect(got).toHaveLength(names.length + 1);
    expect(new Set(got.map((n) => n.toLowerCase())).size).toBe(got.length);
    for (const n of got) {
      expect(n.length).toBeGreaterThan(0);
      expect(n.length).toBeLessThanOrEqual(31);
      expect(n).not.toMatch(/[[\]:*?/\\]/);
      expect(n.startsWith("'") || n.endsWith("'")).toBe(false);
    }
    expect(got[0]).toBe('Summary');
    expect(got).toContain("O'Brien");
    expect(got).toContain('A&B <c>');
    expect(got.map((n) => n.toLowerCase())).not.toContain('history');
  });

  it('quotes sheet names inside defined names', () => {
    const b = new Book(buildXlsx(miniDoc({ tables: [miniTable({ sheet: "O'Brien & Co" })] }), NOW));
    const names = kids(kid(b.xml('xl/workbook.xml'), 'definedNames')!, 'definedName').map((n) => n.text);
    expect(names).toContain("'O''Brien & Co'!$4:$4");
    expect(names).toContain("'O''Brien & Co'!$A$4:$A$5");
  });

  it('refuses a table with no columns', () => {
    expect(() => buildXlsx(miniDoc({ tables: [miniTable({ columns: [], rows: [] })] }), NOW)).toThrow(/no columns/);
  });
});

describe('workbook size and repeatability', () => {
  it('builds a document with no rows, no key figures, no notes and no tables', () => {
    const b = new Book(buildXlsx(miniDoc({ tables: [miniTable({ rows: [] })] }), NOW));
    expect(b.sheets().map((s) => s.name)).toEqual(['Summary', 'T']);
    const none = new Book(buildXlsx(miniDoc({ tables: [] }), NOW));
    expect(none.sheets().map((s) => s.name)).toEqual(['Summary']);
    for (const name of none.parts.keys()) expect(() => parseXml(none.raw(name)), name).not.toThrow();
    expect(kid(none.xml('xl/workbook.xml'), 'definedNames')).toBeUndefined();
  });

  it('builds 20,000 rows and keeps every one', { timeout: 30000 }, () => {
    const big = sampleDoc({ devices: 20000 });
    const b = new Book(buildXlsx(big, NOW));
    const s = b.sheet('By device');
    expect(rows(s).filter((r) => Number(r.attrs.r) >= 5)).toHaveLength(20000);
    expect(kid(s, 'autoFilter')!.attrs.ref).toBe('A4:I20004');
  });

  it('gives identical bytes for the same document and time', () => {
    expect(buildXlsx(doc, NOW).equals(buildXlsx(sampleDoc(), NOW))).toBe(true);
    expect(buildXlsx(doc, NOW).equals(buildXlsx(doc, new Date('2026-10-01T07:20:02Z')))).toBe(false);
  });
});
