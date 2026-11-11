import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { LOGO_PNG_BASE64, decodePng } from '../export/logo.js';
import { buildPdf, columnBoxes, pdfNumber } from '../export/pdf.js';
import { ELLIPSIS, fitText, fontWidths, textWidth, toWinAnsi, wrapParagraph, wrapText, wrapWords, type WinAnsiText } from '../export/pdfFonts.js';
import { buildSlaReportDoc } from '../export/slaReport.js';
import { SITES } from '../domain/naming.js';
import { PALETTE, TONES, rgb } from '../export/theme.js';
import type { BarChart, Cell, Note, ReportDoc, Table, Tone } from '../export/types.js';
import { sampleDoc } from './helpers/docFixture.js';
import { sampleSliReports } from './helpers/sliReportFixture.js';

/**
 * The PDF is checked with a small parser written here, using nothing outside
 * node: the cross-reference table, the page tree, every content stream, and
 * the text and its position on each page. The parser collects what is wrong
 * with the structure instead of throwing, so one fault fails the test that is
 * named for it and not the whole file. Looking at the pages is a separate job
 * done by eye; this file holds what a machine can pin.
 */

const NOW = new Date('2026-10-01T07:20:00Z');

interface TextItem {
  face: 'regular' | 'bold';
  size: number;
  x: number;
  y: number;
  /** The fill colour the text is drawn in, as #rrggbb. */
  colour: string;
  /** The WinAnsi bytes as one char each. */
  raw: string;
  text: string;
  width: number;
}

interface ParsedPage {
  content: string;
  items: TextItem[];
}

interface Fault {
  part: 'file' | 'xref' | 'trailer' | 'pages';
  message: string;
}

interface Parsed {
  text: string;
  objects: Map<number, string>;
  /** Object numbers of the pages, in reading order. */
  pageIds: number[];
  pages: ParsedPage[];
  trailer: string;
  info: string;
  catalog: string;
  /** What is wrong with the file's structure; empty for a sound file. */
  faults: Fault[];
}

const LITERAL = String.raw`\(((?:\\.|[^\\)])*)\)`;
const CHANNEL = String.raw`(\d+(?:\.\d+)?)`;
const TEXT_OP = new RegExp(String.raw`${CHANNEL} ${CHANNEL} ${CHANNEL} rg BT /(F\d) ([\d.]+) Tf ([\d.-]+) ([\d.-]+) Td ${LITERAL} Tj ET`, 'g');

function unescapeLiteral(s: string): string {
  return s.replace(/\\([()\\]|[0-7]{3})/g, (_, g: string) => (g.length === 3 ? String.fromCharCode(Number.parseInt(g, 8)) : g));
}

const decoder = new TextDecoder('windows-1252');
const asUnicode = (raw: string) => decoder.decode(Uint8Array.from(raw, (c) => c.charCodeAt(0)));

/** Three 0 to 1 channels as a content stream writes them, back to #rrggbb. */
const hexOf = (r: string, g: string, b: string) => `#${[r, g, b].map((c) => Math.round(Number(c) * 255).toString(16).padStart(2, '0')).join('')}`;

/** The data of a stream object, or null when its /Length does not end exactly at endstream. */
function streamData(body: string): Buffer | null {
  const at = body.indexOf('stream\n');
  const length = Number(/\/Length (\d+)/.exec(body)?.[1]);
  if (at < 0 || !(length >= 0) || body.slice(at + 7 + length) !== '\nendstream') return null;
  return Buffer.from(body.slice(at + 7, at + 7 + length), 'latin1');
}

function streamOf(body: string): Buffer {
  const data = streamData(body);
  expect(data, 'a stream whose /Length ends exactly at endstream').not.toBeNull();
  return data!;
}

function parse(pdf: Buffer): Parsed {
  const faults: Fault[] = [];
  const out: Parsed = { text: pdf.toString('latin1'), objects: new Map(), pageIds: [], pages: [], trailer: '', info: '', catalog: '', faults };
  try {
    read(out);
  } catch (error) {
    faults.push({ part: 'file', message: `the parser stopped: ${error instanceof Error ? error.message : String(error)}` });
  }
  return out;
}

/** Fills `out`; every problem is recorded and the parts that can still be read are read. */
function read(out: Parsed): void {
  const { text, objects, faults } = out;
  const check = (part: Fault['part'], ok: boolean, message: string): boolean => {
    if (!ok) faults.push({ part, message });
    return ok;
  };
  if (!check('file', text.startsWith('%PDF-1.4\n'), 'does not start with %PDF-1.4')) return;
  if (!check('file', text.endsWith('%%EOF\n'), 'does not end with %%EOF')) return;
  const start = /\nstartxref\n(\d+)\n%%EOF\n$/.exec(text);
  if (!check('file', start !== null, 'has no startxref before the end')) return;
  const xref = Number(start![1]);
  const head = /^xref\n0 (\d+)\n/.exec(text.slice(xref));
  if (!check('xref', head !== null, 'startxref does not point at the xref table')) return;
  const count = Number(head![1]);
  const table = xref + head![0].length;
  for (let i = 0; i < count; i++) {
    const entry = text.slice(table + i * 20, table + i * 20 + 20);
    check('xref', /^\d{10} \d{5} [nf] \n$/.test(entry), `entry ${i} is not 20 bytes in the xref format`);
    if (i === 0) {
      check('xref', entry === '0000000000 65535 f \n', 'entry 0 is not the free list head');
      continue;
    }
    const offset = Number(entry.slice(0, 10));
    if (!check('xref', text.startsWith(`${i} 0 obj\n`, offset), `entry ${i} points at the wrong place`)) continue;
    const bodyStart = offset + `${i} 0 obj\n`.length;
    const end = text.indexOf('\nendobj\n', bodyStart);
    check('xref', end > 0, `object ${i} has no endobj`);
    objects.set(i, text.slice(bodyStart, end));
  }
  out.trailer = text.slice(table + count * 20);
  const { trailer } = out;
  check('trailer', trailer.startsWith('trailer\n<<'), 'does not follow the xref table with a trailer dictionary');
  check('trailer', Number(/\/Size (\d+)/.exec(trailer)?.[1]) === count, '/Size is not the number of xref entries');

  const catalog = objects.get(Number(/\/Root (\d+) 0 R/.exec(trailer)?.[1]));
  if (!check('trailer', catalog !== undefined, '/Root does not name an object')) return;
  out.catalog = catalog!;
  check('trailer', catalog!.includes('/Type /Catalog'), '/Root is not the catalog');
  const info = objects.get(Number(/\/Info (\d+) 0 R/.exec(trailer)?.[1]));
  check('trailer', info !== undefined, '/Info does not name an object');
  out.info = info ?? '';

  const tree = objects.get(Number(/\/Pages (\d+) 0 R/.exec(catalog!)?.[1]));
  if (!check('pages', tree !== undefined, 'the catalog does not name a page tree')) return;
  const kids = [...tree!.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  const real = [...objects.values()].filter((b) => b.startsWith('<< /Type /Page /Parent')).length;
  check('pages', Number(/\/Count (\d+)/.exec(tree!)?.[1]) === real, '/Count is not the number of page objects');
  check('pages', kids.length === real, '/Kids does not list every page object');
  for (const id of kids) {
    const page = objects.get(id);
    const contents = objects.get(Number(/\/Contents (\d+) 0 R/.exec(page ?? '')?.[1]));
    const data = contents === undefined ? null : streamData(contents);
    if (!check('pages', data !== null, `page object ${id} has no stream that ends at its /Length`)) continue;
    const content = inflateSync(data!).toString('latin1');
    const items = [...content.matchAll(TEXT_OP)].map((m): TextItem => {
      const face = m[4] === 'F2' ? 'bold' : 'regular';
      const size = Number(m[5]);
      const raw = unescapeLiteral(m[8]!);
      return { face, size, x: Number(m[6]), y: Number(m[7]), colour: hexOf(m[1]!, m[2]!, m[3]!), raw, text: asUnicode(raw), width: textWidth(raw as WinAnsiText, face, size) };
    });
    out.pageIds.push(id);
    out.pages.push({ content, items });
  }
}

/** Q and q balance, ignoring anything inside a string literal. */
function stateBalance(content: string): number {
  const bare = content.replace(new RegExp(LITERAL, 'g'), '()');
  let depth = 0;
  for (const op of bare.split(/\s+/)) {
    if (op === 'q') depth++;
    if (op === 'Q') depth--;
    expect(depth).toBeGreaterThanOrEqual(0);
  }
  return depth;
}

const pageTexts = (page: ParsedPage) => page.items.map((i) => i.text);
const build = (doc: ReportDoc) => parse(buildPdf(doc, NOW));
const cell = (text: string): Cell => ({ text });

/** What a content stream says once its string literals are emptied: operators and numbers only. */
const bare = (content: string) => content.replace(new RegExp(LITERAL, 'g'), '()');

/** The operators the writer emits, with the number of operands each takes. */
const OPERANDS: Record<string, number> = {
  rg: 3, RG: 3, w: 1, d: 2, re: 4, m: 2, l: 2, c: 6, h: 0, f: 0, B: 0, S: 0, n: 0, W: 0, q: 0, Q: 0,
  BT: 0, ET: 0, Tf: 2, Td: 2, Tj: 1, cm: 6, Do: 1, BMC: 1, EMC: 0,
};

/** Every operator of a content stream that is unknown or has the wrong number of operands, in words; a number that is not a plain decimal reads as an unknown operator. */
function grammarFaults(content: string): string[] {
  const faults: string[] = [];
  let operands = 0;
  for (const token of bare(content).replace(/\[[^\]]*\]/g, '[]').split(/\s+/).filter(Boolean)) {
    if (/^(-?\d+(\.\d+)?|\/\w+|\(\)|\[\])$/.test(token)) {
      operands++;
      continue;
    }
    if (OPERANDS[token] === undefined) faults.push(`unknown operator "${token}"`);
    else if (OPERANDS[token] !== operands) faults.push(`${token} has ${operands} operands, not ${OPERANDS[token]}`);
    operands = 0;
  }
  return faults;
}

/** Items that stray outside the 36 pt margins, described, so a failure names them. */
const strays = (pdf: Parsed) =>
  pdf.pages.flatMap((page, n) =>
    page.items.filter((i) => i.x < 36 - 0.01 || i.x + i.width > 806 + 0.01).map((i) => `page ${n + 1}: "${i.text.slice(0, 24)}" from ${i.x} to ${(i.x + i.width).toFixed(1)}`),
  );

interface Rect {
  fill: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The plain filled rectangles of a stream, `rg x y w h re f`, in drawing order. */
function rects(content: string): Rect[] {
  const re = new RegExp(`^${CHANNEL} ${CHANNEL} ${CHANNEL} rg (-?[\\d.]+) (-?[\\d.]+) ([\\d.]+) ([\\d.]+) re f$`, 'gm');
  return [...content.matchAll(re)].map((m) => ({ fill: hexOf(m[1]!, m[2]!, m[3]!), x: Number(m[4]), y: Number(m[5]), w: Number(m[6]), h: Number(m[7]) }));
}

/** The shapes painted with both a fill and an edge, `rg ... RG ... B`: cards, pills and the empty-table box, in order. */
function outlined(content: string): { fill: string; stroke: string }[] {
  const re = new RegExp(`^${CHANNEL} ${CHANNEL} ${CHANNEL} rg ${CHANNEL} ${CHANNEL} ${CHANNEL} RG [\\d.]+ w .* B$`, 'gm');
  return [...content.matchAll(re)].map((m) => ({ fill: hexOf(m[1]!, m[2]!, m[3]!), stroke: hexOf(m[4]!, m[5]!, m[6]!) }));
}

/** What a call throws, or undefined. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** A text string token of a dictionary, `(plain)` or `<FEFF...>`, back to the text; throws on UTF-16 that is not well formed. */
function textOf(token: string): string {
  if (token.startsWith('(')) return unescapeLiteral(token.slice(1, -1));
  const bytes = Buffer.from(token.slice(1, -1), 'hex');
  expect([bytes[0], bytes[1]], 'the byte order mark').toEqual([0xfe, 0xff]);
  return new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2));
}

const TOKEN = String.raw`(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f]*>)`;
/** The decoded text string a dictionary holds under `/key`. */
const stringOf = (dict: string, key: string): string => textOf(new RegExp(`/${key} ${TOKEN}`).exec(dict)![1]!);

/** Each bookmark: its title, the index of the page it opens and how far above that page's bottom it opens. */
function bookmarks(pdf: Parsed): { title: string; page: number; y: number }[] {
  return [...pdf.objects.values()]
    .filter((b) => b.includes('/Dest ['))
    .map((b) => {
      const dest = /\/Dest \[(\d+) 0 R \/XYZ [\d.-]+ ([\d.-]+) null\]/.exec(b)!;
      return { title: stringOf(b, 'Title'), page: pdf.pageIds.indexOf(Number(dest[1])), y: Number(dest[2]) };
    });
}

/** A one-table document with labelled rows, for the page-break tests. */
function tableDoc(tables: { title: string; rows: number }[]): ReportDoc {
  const base = sampleDoc();
  const make = (title: string, rows: number): Table => ({
    title,
    caption: 'A caption line.',
    sheet: title,
    columns: [
      { header: 'Name', kind: 'text', weight: 4 },
      { header: 'Value', kind: 'count', weight: 1 },
    ],
    rows: Array.from({ length: rows }, (_, i) => [cell(`${title} row ${i + 1}`), { text: String(i), n: i }]),
  });
  return { ...base, kpis: [], chart: undefined, notes: [], tables: tables.map((t) => make(t.title, t.rows)) };
}

describe('structure', () => {
  const doc = sampleDoc();
  const pdf = parse(buildPdf(doc, NOW));
  const faultsIn = (part: Fault['part']) => pdf.faults.filter((f) => f.part === part).map((f) => f.message);

  it('starts with the header and ends with startxref and %%EOF', () => {
    expect(faultsIn('file')).toEqual([]);
  });

  it('has a cross-reference table whose every entry points at its object', () => {
    expect(faultsIn('xref')).toEqual([]);
    expect(pdf.objects.size).toBeGreaterThan(20);
  });

  it('has a trailer that counts the objects and names the catalog and the information dictionary', () => {
    expect(faultsIn('trailer')).toEqual([]);
  });

  it('has a page tree that counts and lists every page, each with a stream that ends at its length', () => {
    expect(faultsIn('pages')).toEqual([]);
    expect(pdf.pages.length).toBeGreaterThan(5);
  });

  it('is sound for every shape of document built below', () => {
    const { strict, hcml } = sampleSliReports();
    const eighty = Array.from({ length: 80 }, (_, i) => ({ label: `Site ${i}`, value: 96 + (i % 4), tone: 'good' as const, text: '97%' }));
    const shapes: [string, ReportDoc][] = [
      ['sample', doc],
      ['real report', buildSlaReportDoc(strict, hcml, NOW)],
      ['nothing but the band', { ...sampleDoc(), kpis: [], chart: undefined, tables: [], notes: [] }],
      ['an empty table', tableDoc([{ title: 'Quiet', rows: 0 }])],
      ['one row', tableDoc([{ title: 'One', rows: 1 }])],
      ['600 rows', tableDoc([{ title: 'Many', rows: 600 }])],
      ['a chart of 80 bars and no key figures', { ...tableDoc([]), chart: { ...doc.chart!, bars: eighty } }],
    ];
    for (const [name, shape] of shapes) {
      const parsed = parse(buildPdf(shape, NOW));
      expect(parsed.faults, name).toEqual([]);
      parsed.pages.forEach((page, n) => expect(grammarFaults(page.content), `${name}, page ${n + 1}`).toEqual([]));
    }
  });

  it('inflates every content stream and keeps q and Q balanced', () => {
    for (const page of pdf.pages) {
      expect(page.content.length).toBeGreaterThan(100);
      expect(stateBalance(page.content)).toBe(0);
    }
  });

  it('escapes every string literal', () => {
    for (const page of pdf.pages) {
      const stripped = page.content.replace(new RegExp(LITERAL, 'g'), '');
      expect(stripped).not.toMatch(/[()]/);
    }
  });

  it('writes the document information and viewer settings', () => {
    expect(pdf.info).toContain('/Title (SLA availability report, August 2026)');
    expect(pdf.info).toContain('/Author (HCML Monitoring Portal)');
    expect(pdf.info).toContain('/Creator (HCML Monitoring Portal)');
    expect(pdf.info).toContain('/Producer (');
    expect(pdf.info).toContain('/CreationDate (D:20261001072000Z)');
    expect(pdf.catalog).toContain('/Lang (en-US)');
    expect(pdf.catalog).toContain('/ViewerPreferences << /DisplayDocTitle true >>');
    expect(pdf.trailer).toMatch(/\/ID \[<[0-9a-f]{32}> <[0-9a-f]{32}>\]/);
  });

  it('writes a title with characters outside ASCII as UTF-16BE behind its byte order mark', () => {
    const d = { ...tableDoc([{ title: 'Zürich ✓ 日本語', rows: 1 }]), title: 'Café, Zürich 😀', subtitle: 'Août', period: 'Période du 1er au 31' };
    const parsed = build(d);
    const token = new RegExp(`/Title ${TOKEN}`).exec(parsed.info)![1]!;
    expect(token.startsWith('<FEFF')).toBe(true);
    expect(textOf(token)).toBe('Café, Zürich 😀, Août');
    expect(stringOf(parsed.info, 'Subject')).toBe('Période du 1er au 31');
    expect(bookmarks(parsed).map((m) => m.title)).toEqual(['Zürich ✓ 日本語']);
  });

  it('is A4 landscape on every page', () => {
    const boxes = [...pdf.text.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map((m) => m[1]);
    expect(boxes).toHaveLength(pdf.pages.length);
    expect(new Set(boxes)).toEqual(new Set(['0 0 842 595']));
  });

  it('uses only the two standard fonts, with WinAnsi', () => {
    const fonts = [...pdf.objects.values()].filter((b) => b.startsWith('<< /Type /Font'));
    expect(fonts.map((f) => /\/BaseFont \/(\S+)/.exec(f)![1]).sort()).toEqual(['Helvetica', 'Helvetica-Bold']);
    for (const f of fonts) expect(f).toContain('/Encoding /WinAnsiEncoding');
  });

  it('gives the same bytes for the same document and time, and different bytes for another time', () => {
    expect(buildPdf(doc, NOW).equals(buildPdf(sampleDoc(), NOW))).toBe(true);
    expect(buildPdf(doc, new Date('2026-10-02T07:20:00Z')).equals(buildPdf(doc, NOW))).toBe(false);
  });

  it('gives the trailer an /ID that is the same for the same document and time, and differs for another document', () => {
    const idOf = (d: ReportDoc, at = NOW) => /\/ID \[<([0-9a-f]{32})> <([0-9a-f]{32})>\]/.exec(parse(buildPdf(d, at)).trailer)!;
    const first = idOf(doc);
    expect(first[1]).toBe(first[2]);
    expect(idOf(sampleDoc())[1]).toBe(first[1]);
    const edited = sampleDoc();
    edited.tables[0]!.rows[0]![0]!.text += '!';
    expect(idOf(edited)[1]).not.toBe(first[1]);
    expect(idOf(doc, new Date('2026-10-02T07:20:00Z'))[1]).not.toBe(first[1]);
  });

  it('writes one bookmark per section, in reading order', () => {
    const outlines = [...pdf.objects.entries()].find(([, b]) => b.startsWith('<< /Type /Outlines'))!;
    expect(Number(/\/Count (\d+)/.exec(outlines[1])![1])).toBe(1 + doc.tables.length + doc.notes.length);
    expect(bookmarks(pdf).map((m) => m.title)).toEqual([doc.chart!.title, ...doc.tables.map((t) => t.title), ...doc.notes.map((n) => n.heading)]);
  });

  it('opens each bookmark on the page that draws its heading, just above it', () => {
    const { strict, hcml } = sampleSliReports();
    const real = buildSlaReportDoc(strict, hcml, NOW);
    for (const [name, parsed] of [['sample', pdf], ['real report', build(real)]] as const) {
      const marks = bookmarks(parsed);
      expect(marks.length, name).toBeGreaterThan(5);
      for (const m of marks) {
        const heading = parsed.pages[m.page]?.items.find((i) => i.text === m.title && i.face === 'bold' && (i.size === 12 || i.size === 10));
        expect(heading, `${name}: "${m.title}" is not drawn on page ${m.page + 1}, where its bookmark opens`).toBeDefined();
        expect(m.y - heading!.y, `${name}: "${m.title}" opens too far from its heading`).toBeGreaterThan(5);
        expect(m.y - heading!.y, `${name}: "${m.title}" opens too far from its heading`).toBeLessThan(30);
      }
      expect(new Set(marks.map((m) => m.page)).size, `${name}: bookmarks that all open on one page`).toBeGreaterThan(2);
    }
  });
});

describe('page frame', () => {
  const doc = sampleDoc();
  const pdf = build(doc);

  it('prints Page x of y and the footer line on every page', () => {
    pdf.pages.forEach((page, i) => {
      const texts = pageTexts(page);
      expect(texts.filter((t) => /^Page \d+ of \d+$/.test(t))).toEqual([`Page ${i + 1} of ${pdf.pages.length}`]);
      expect(texts).toContain(doc.footer);
    });
  });

  it('puts the title band and logo on page 1 only', () => {
    expect(pageTexts(pdf.pages[0]!)).toEqual(expect.arrayContaining([doc.title, doc.subtitle, doc.period, doc.generated]));
    expect(pdf.pages[0]!.content).toContain('/Im1 Do');
    for (const page of pdf.pages.slice(1)) {
      expect(page.content).not.toContain('/Im1 Do');
      expect(pageTexts(page)).toEqual(expect.arrayContaining([doc.title, doc.subtitle]));
    }
  });

  it('embeds the logo with its transparency', () => {
    const image = [...pdf.objects.values()].find((b) => b.includes('/Subtype /Image') && b.includes('/DeviceRGB'))!;
    expect(image).toContain('/Width 782 /Height 224');
    const mask = Number(/\/SMask (\d+) 0 R/.exec(image)![1]);
    expect(inflateSync(streamOf(image))).toHaveLength(782 * 224 * 3);
    expect(inflateSync(streamOf(pdf.objects.get(mask)!))).toHaveLength(782 * 224);
  });

  it('never draws text outside the margins', () => {
    for (const page of pdf.pages) {
      for (const i of page.items) {
        expect(i.x).toBeGreaterThanOrEqual(36 - 0.01);
        expect(i.x + i.width).toBeLessThanOrEqual(806 + 0.01);
      }
    }
  });
});

describe('key figures and chart', () => {
  const doc = sampleDoc();
  const pdf = build(doc);
  const first = pdf.pages[0]!;

  it('prints every card label, value and detail', () => {
    const texts = pageTexts(first);
    for (const k of doc.kpis) {
      expect(texts).toContain(k.label);
      expect(texts).toContain(k.value);
      expect(texts).toContain(k.detail);
    }
  });

  it('draws a bar per figure, none for a missing one, and labels the target', () => {
    const chart = doc.chart!;
    const drawn = [...first.content.matchAll(/\/Bar BMC\n([\d. ]+) rg /g)];
    expect(drawn).toHaveLength(chart.bars.filter((b) => b.value !== null).length);
    expect(first.content.match(/\/Bar BMC/g)).toHaveLength(drawn.length);
    const solids = chart.bars.filter((b) => b.value !== null).map((b) => rgb(TONES[b.tone].solid).map((c) => Number((c / 255).toFixed(3))).join(' '));
    expect(drawn.map((m) => m[1])).toEqual(solids);
    const texts = pageTexts(first);
    expect(texts).toContain('No data');
    expect(texts).toContain('Target 99%');
    expect(first.content).toContain('[3 2] 0 d');
    for (const b of chart.bars) expect(texts).toContain(b.text);
  });

  it('prints the target and axis labels the document gives, and the numbers when it gives none', () => {
    const d = sampleDoc();
    d.chart = { ...d.chart!, target: 99.5, axisMin: 95, targetLabel: 'Target 99,5%', axisLabel: '95,0%' };
    const labelled = pageTexts(build(d).pages.find((p) => p.content.includes('/Bar BMC'))!);
    expect(labelled).toContain('Target 99,5%');
    expect(labelled).toContain('95,0%');
    expect(labelled).not.toContain('Target 99.5%');
    d.chart = { ...d.chart, targetLabel: undefined, axisLabel: undefined };
    const bare = pageTexts(build(d).pages.find((p) => p.content.includes('/Bar BMC'))!);
    expect(bare).toContain('Target 99.5%');
    expect(bare).toContain('95%');
  });

  it('keeps 14 and 40 bars whole on one page', () => {
    for (const count of [14, 40]) {
      const d = sampleDoc();
      d.chart = { ...d.chart!, bars: Array.from({ length: count }, (_, i) => ({ label: `Site ${i + 1}`, value: 97 + (i % 30) / 10, tone: 'good' as const, text: `${i}%` })) };
      const parsed = build(d);
      const withBars = parsed.pages.filter((p) => p.content.includes('/Bar BMC'));
      expect(withBars).toHaveLength(1);
      expect(withBars[0]!.content.match(/\/Bar BMC/g)).toHaveLength(count);
    }
  });

  it('moves a chart that does not fit the rest of the page to the next page whole', () => {
    const d = sampleDoc();
    d.kpis = [...d.kpis, ...d.kpis, ...d.kpis];
    const parsed = build(d);
    const withBars = parsed.pages.filter((p) => p.content.includes('/Bar BMC'));
    expect(withBars).toHaveLength(1);
    expect(withBars[0]!.content.match(/\/Bar BMC/g)).toHaveLength(13);
    expect(parsed.pages[0]!.content).not.toContain('/Bar BMC');
  });
});

describe('tables', () => {
  const doc = sampleDoc();
  const pdf = build(doc);

  it('spans several pages for 138 rows, with the header repeated on each', () => {
    const device = doc.tables[2]!;
    const withHeader = pdf.pages.filter((p) => pageTexts(p).includes('Incidents'));
    const withRows = pdf.pages.filter((p) => pageTexts(p).some((t) => t.includes('Sample device')));
    expect(withRows.length).toBeGreaterThanOrEqual(4);
    expect(withHeader).toHaveLength(withRows.length);
    for (const p of withHeader) {
      for (const c of device.columns.filter((col) => col.header !== 'SLA (HCML method)')) expect(pageTexts(p)).toContain(c.header);
    }
    expect(pdf.pages.filter((p) => pageTexts(p).includes('By device (continued)'))).toHaveLength(withRows.length - 1);
  });

  it('prints every device row once', () => {
    const names = pdf.pages.flatMap((p) => pageTexts(p)).filter((t) => t.includes('Sample device'));
    expect(names).toHaveLength(138 - 4);
  });

  it('shows the empty message in place of a table with no rows', () => {
    expect(pdf.pages.flatMap(pageTexts)).toContain('No web checks are configured in Zabbix.');
  });

  it('draws the footer row and the status as words', () => {
    const texts = pdf.pages.flatMap(pageTexts);
    expect(texts).toContain('2 devices');
    expect(texts).toEqual(expect.arrayContaining(['Met', 'Missed', 'No data']));
  });

  it.each([0, 1, 2, 3, 600])('builds a table of %i rows', (rows) => {
    const parsed = build(tableDoc([{ title: 'Only', rows }]));
    const labels = parsed.pages.flatMap(pageTexts).filter((t) => /^Only row \d+$/.test(t));
    expect(labels).toHaveLength(rows);
    if (rows === 600) {
      expect(parsed.pages.length).toBeGreaterThan(20);
      for (const p of parsed.pages) expect(pageTexts(p)).toContain('Name');
    }
    if (rows === 0) expect(parsed.pages.flatMap(pageTexts)).toContain('Nothing to list.');
  });

  it('builds a document with no key figures, chart, tables or notes', () => {
    const parsed = build({ ...sampleDoc(), kpis: [], chart: undefined, tables: [], notes: [] });
    expect(parsed.pages).toHaveLength(1);
  });

  it('wraps cards beyond six onto a second row', () => {
    const d = sampleDoc();
    d.kpis = Array.from({ length: 8 }, (_, i) => ({ label: `Card ${i}`, value: `${i}`, tone: 'none' as const }));
    const texts = pageTexts(build(d).pages[0]!);
    for (let i = 0; i < 8; i++) expect(texts).toContain(`Card ${i}`);
  });

  it('never leaves a title with fewer than two rows after it, nor one row alone on the next page, whatever the length', () => {
    for (let filler = 0; filler <= 40; filler++) {
      for (const rows of [1, 2, 3, 4, 9, 30]) {
        const parsed = build(tableDoc([{ title: 'First', rows: filler }, { title: 'Second', rows }]));
        const perPage = parsed.pages.map((p) => pageTexts(p).filter((t) => /^Second row \d+$/.test(t)).length);
        const titled = parsed.pages.findIndex((p) => pageTexts(p).includes('Second'));
        expect(perPage[titled], `filler ${filler}, rows ${rows}`).toBeGreaterThanOrEqual(Math.min(2, rows));
        for (const c of perPage.slice(titled + 1).filter((n) => n > 0)) expect(c, `filler ${filler}, rows ${rows}`).toBeGreaterThanOrEqual(2);
        // A table of three rows or fewer is too short to split at all, so it moves whole.
        if (rows <= 3) expect(perPage[titled], `filler ${filler}, rows ${rows}: split`).toBe(rows);
      }
    }
  });

  it('counts the footer as a row for the same rule', () => {
    for (let filler = 0; filler <= 40; filler++) {
      for (const rows of [1, 2, 3, 4, 9, 30]) {
        const d = tableDoc([{ title: 'First', rows: filler }, { title: 'Second', rows }]);
        d.tables[1]!.footer = [cell('Second total'), cell('0')];
        const parsed = build(d);
        const perPage = parsed.pages.map((p) => pageTexts(p).filter((t) => /^Second (row \d+|total)$/.test(t)).length);
        const titled = parsed.pages.findIndex((p) => pageTexts(p).includes('Second'));
        const where = `filler ${filler}, rows ${rows} and a footer`;
        expect(perPage[titled], where).toBeGreaterThanOrEqual(2);
        for (const c of perPage.slice(titled + 1).filter((n) => n > 0)) expect(c, where).toBeGreaterThanOrEqual(2);
        const last = perPage.reduce((at, n, i) => (n > 0 ? i : at), -1);
        expect(pageTexts(parsed.pages[last]!), `${where}: the footer is on the table's last page`).toContain('Second total');
        if (rows + 1 <= 3) expect(perPage[titled], `${where}: split`).toBe(rows + 1);
      }
    }
  });
});

describe('text and columns', () => {
  const doc = sampleDoc();
  const pdf = build(doc);
  const all = pdf.pages.flatMap((p) => p.items);

  it('draws names with parentheses, a backslash, angle brackets and accents as written', () => {
    const texts = all.map((i) => i.text);
    expect(texts).toContain('<Core & edge> (backup) \\ rack 4');
    expect(texts).toContain('Café routeur Zürich');
    // A leading "=" is drawn as the plain text it is, the whole name, not cut and not read as anything else.
    expect(texts).toContain('=HYPERLINK("http://example.invalid","click")');
  });

  it('cuts a name that is too long and marks the cut', () => {
    const cut = all.find((i) => i.text.startsWith('A very long device name'))!;
    expect(cut.text.endsWith('…')).toBe(true);
    const column = columnBoxes(doc.tables[2]!)[0]!.w;
    expect(cut.width).toBeLessThanOrEqual(column - 12 + 0.01);
  });

  it('keeps every table cell inside its own column', () => {
    const edges = columnBoxes(doc.tables[2]!).map((b) => [b.x, b.x + b.w] as const);
    const page = pdf.pages.find((p) => pageTexts(p).includes('By device (continued)'))!;
    const body = page.items.filter((i) => i.y > 60 && i.y < 500);
    expect(body.length).toBeGreaterThan(100);
    for (const i of body) {
      const inside = edges.some(([l, r]) => i.x >= l + 6 - 0.01 && i.x + i.width <= r - 6 + 0.01);
      expect(inside, `${i.text} at ${i.x}`).toBe(true);
    }
  });

  it('turns characters WinAnsi lacks into a question mark and keeps the rest', () => {
    const d = tableDoc([{ title: 'Odd', rows: 1 }]);
    d.tables[0]!.rows[0]![0] = cell('Zürich · O’Brien “quoted” Ñandú 日本 \u{1F600} (x)');
    const texts = build(d).pages.flatMap(pageTexts);
    expect(texts).toContain('Zürich · O’Brien “quoted” Ñandú ?? ? (x)');
  });

  it('wraps a note into paragraphs that fit', () => {
    const d = sampleDoc();
    d.notes = [{ heading: 'Long note', lines: ['word '.repeat(300).trim(), 'Second paragraph.'] }];
    const parsed = build(d);
    const lines = parsed.pages.flatMap((p) => p.items).filter((i) => i.text.startsWith('word'));
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(l.width).toBeLessThanOrEqual(640.01);
    expect(parsed.pages.flatMap(pageTexts)).toContain('Second paragraph.');
  });
});

/** The header row's items on a page: bold 8.5 text level with the first column's header, which must be one word. */
function headerItems(page: ParsedPage, table: Table): TextItem[] {
  const level = (i: TextItem) => i.face === 'bold' && i.size === 8.5;
  const anchor = page.items.find((i) => level(i) && i.x === 42 && i.text === table.columns[0]!.header);
  return anchor ? page.items.filter((i) => level(i) && Math.abs(i.y - anchor.y) <= 12) : [];
}

/**
 * The drawn lines of each paragraph, in page order. Note lines are 8.5pt regular text at the left
 * margin, which the widest chart label shares, so each paragraph is found by its first line and
 * must then continue line by line.
 */
function paragraphLines(parsed: Parsed, paragraphs: string[]): string[][] {
  const drawn = parsed.pages.flatMap((p) => p.items).filter((i) => i.face === 'regular' && i.size === 8.5 && i.x === 36);
  let at = 0;
  return paragraphs.map((paragraph) => {
    const want = asUnicode(toWinAnsi(paragraph)).split(' ').filter(Boolean).join(' ');
    while (at < drawn.length && !want.startsWith(drawn[at]!.text)) at++;
    const lines: string[] = [];
    while (lines.join(' ') !== want) {
      expect(at, `lines ran out inside "${want.slice(0, 40)}"`).toBeLessThan(drawn.length);
      lines.push(drawn[at++]!.text);
      expect(want.startsWith(lines.join(' ')), `"${lines.join(' ').slice(0, 40)}" does not follow "${want.slice(0, 40)}"`).toBe(true);
    }
    return lines;
  });
}

/** What a table draws between the heading and the footer on page 1 of a document that holds nothing else. */
const tableBody = (page: ParsedPage) => page.items.filter((i) => i.y > 60 && i.y < 480);

describe('column widths', () => {
  const { strict, hcml } = sampleSliReports();
  const real = buildSlaReportDoc(strict, hcml, NOW);
  const headerWords = (t: Table) => t.columns.flatMap((c) => c.header.split(' '));

  it('spans the printable width in order, with no gap, for every table', () => {
    for (const t of [...real.tables, ...sampleDoc().tables]) {
      const boxes = columnBoxes(t);
      expect(boxes).toHaveLength(t.columns.length);
      expect(boxes[0]!.x).toBe(36);
      boxes.forEach((b, i) => {
        if (i > 0) expect(b.x).toBeCloseTo(boxes[i - 1]!.x + boxes[i - 1]!.w, 6);
      });
      expect(boxes.at(-1)!.x + boxes.at(-1)!.w).toBeCloseTo(806, 6);
    }
  });

  it('gives each column room for its longest header word, and for figures and status pills its longest value', () => {
    for (const t of real.tables) {
      const boxes = columnBoxes(t);
      t.columns.forEach((c, i) => {
        const needs = (width: number) => expect(boxes[i]!.w, `${t.title}, ${c.header}`).toBeGreaterThanOrEqual(width + 12);
        for (const word of c.header.split(' ')) needs(textWidth(toWinAnsi(word), 'bold', 8.5));
        if (c.kind === 'text') return;
        const cells = [...t.rows.map((r) => ({ cell: r[i]!, footer: false })), ...(t.footer ? [{ cell: t.footer[i]!, footer: true }] : [])];
        for (const { cell, footer } of cells) {
          const label = toWinAnsi(cell.text);
          needs(c.kind === 'status' ? textWidth(label, 'bold', 7.5) + 12 : textWidth(label, footer || cell.tone === 'bad' ? 'bold' : 'regular', 8.5));
        }
      });
    }
  });

  it('never breaks a header inside a word, on every page that draws one', () => {
    const pdf = build(real);
    let checked = 0;
    for (const t of real.tables.filter((x) => x.rows.length)) {
      const drawn = pdf.pages.filter((p) => pageTexts(p).includes(t.title) || pageTexts(p).includes(`${t.title} (continued)`));
      expect(drawn.length, t.title).toBeGreaterThan(0);
      for (const page of drawn) {
        const words = headerItems(page, t).flatMap((i) => i.text.split(' '));
        expect(words.sort(), `${t.title}, page ${pdf.pages.indexOf(page) + 1}`).toEqual(headerWords(t).sort());
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it('holds the real device table to its own columns on every page', () => {
    const pdf = build(real);
    const device = real.tables.find((t) => t.title === 'By device')!;
    const edges = columnBoxes(device).map((b) => [b.x, b.x + b.w] as const);
    const others = real.tables.filter((t) => t !== device).map((t) => t.title);
    const pages = pdf.pages.filter((p) => pageTexts(p).includes('By device (continued)') && !others.some((title) => pageTexts(p).includes(title)));
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const page of pages) {
      for (const i of page.items.filter((x) => x.y > 60 && x.y < 500)) {
        expect(edges.some(([l, r]) => i.x >= l + 6 - 0.01 && i.x + i.width <= r - 6 + 0.01), `${i.text} at ${i.x}`).toBe(true);
      }
    }
  });

  it('keeps a light figure column and a status pill whole however little weight they carry', () => {
    const table: Table = {
      title: 'Narrow',
      sheet: 'Narrow',
      columns: [
        { header: 'Name', kind: 'text', weight: 100 },
        { header: 'N', kind: 'count', weight: 0.1 },
        { header: 'S', kind: 'status', weight: 0.1 },
      ],
      rows: [[cell('Alpha'), { text: '1,234,567.89 h' }, { text: 'Missed', tone: 'bad' }], [cell('Beta'), { text: '2' }, { text: 'No data', tone: 'muted' }]],
      footer: [cell('Total'), { text: '1,234,569.89 h' }, { text: 'Missed', tone: 'bad' }],
    };
    const texts = build({ ...tableDoc([]), tables: [table] }).pages[0]!.items.map((i) => i.text);
    for (const whole of ['1,234,567.89 h', '1,234,569.89 h', 'Missed', 'No data']) expect(texts).toContain(whole);
    expect(texts.filter((x) => x.endsWith('…'))).toEqual([]);
  });

  it('cuts one very long header word with an ellipsis and leaves the other headers whole', () => {
    const table: Table = {
      title: 'Long',
      sheet: 'Long',
      columns: [
        { header: 'Name', kind: 'text', weight: 4 },
        { header: 'Z'.repeat(300), kind: 'count', weight: 1 },
        { header: 'Incidents', kind: 'count', weight: 1 },
        { header: 'Status', kind: 'status', weight: 1 },
      ],
      rows: [[cell('Alpha'), { text: '1' }, { text: '22' }, { text: 'Missed', tone: 'bad' }]],
    };
    const boxes = columnBoxes(table);
    expect(boxes.reduce((s, b) => s + b.w, 0)).toBeCloseTo(770, 6);
    expect(boxes[1]!.w).toBeLessThan(770 / 2);
    const page = build({ ...tableDoc([]), tables: [table] }).pages[0]!;
    const cut = page.items.filter((i) => i.text.startsWith('Z'));
    expect(cut).toHaveLength(1);
    expect(cut[0]!.text.endsWith('…')).toBe(true);
    expect(cut[0]!.width).toBeLessThanOrEqual(boxes[1]!.w - 12 + 0.01);
    const others = headerItems(page, table).flatMap((i) => i.text.split(' ')).filter((w) => !w.startsWith('Z'));
    expect(others.sort()).toEqual(['Incidents', 'Name', 'Status']);
    for (const i of page.items) {
      expect(i.x).toBeGreaterThanOrEqual(36 - 0.01);
      expect(i.x + i.width).toBeLessThanOrEqual(806 + 0.01);
    }
  });

  it('scales down together when the floors cannot all be met, and still keeps every item in its column', () => {
    const columns = Array.from({ length: 14 }, (_, i) => ({ header: `Extraordinarily${i}`, kind: i % 3 === 0 ? ('text' as const) : ('percent' as const), weight: 1 + (i % 4) }));
    const table: Table = {
      title: 'Many',
      sheet: 'Many',
      columns,
      rows: Array.from({ length: 3 }, (_, r) => columns.map((c) => cell(c.kind === 'text' ? `name ${r}` : '99.99%'))),
    };
    const boxes = columnBoxes(table);
    expect(boxes.reduce((s, b) => s + b.w, 0)).toBeCloseTo(770, 6);
    for (const b of boxes) expect(b.w).toBeGreaterThan(0);
    const items = tableBody(build({ ...tableDoc([]), tables: [table] }).pages[0]!);
    expect(items.length).toBeGreaterThan(40);
    for (const i of items) {
      expect(boxes.some((b) => i.x >= b.x + 6 - 0.01 && i.x + i.width <= b.x + b.w - 6 + 0.01), `${i.text} at ${i.x}`).toBe(true);
    }
  });
});

describe('column fit', () => {
  const { strict, hcml } = sampleSliReports();
  const realDoc = () => buildSlaReportDoc(strict, hcml, NOW);
  /** A string at least `pt` points wide in the 8.5 point regular face ('a' is 556 units). */
  const ofWidth = (pt: number) => 'a'.repeat(Math.ceil(pt / ((556 * 8.5) / 1000)));
  const deviceTable = (doc: ReportDoc) => doc.tables.find((t) => t.title === 'By device')!;
  const devicePages = (parsed: Parsed) => parsed.pages.filter((p) => pageTexts(p).some((t) => t === 'By device' || t === 'By device (continued)'));
  /** The pages that hold the device table and nothing else, so every item on them belongs to it. */
  const soleDevicePages = (parsed: Parsed, doc: ReportDoc) => {
    const others = doc.tables.filter((t) => t.title !== 'By device').map((t) => t.title);
    return devicePages(parsed).filter((p) => !others.some((title) => pageTexts(p).some((t) => t === title || t === `${title} (continued)`)));
  };
  /** The cells a page draws in one column, found by the left edge text starts at; the bold header row is left out. */
  const inColumn = (parsed: Parsed, doc: ReportDoc, header: string) => {
    const table = deviceTable(doc);
    const box = columnBoxes(table)[table.columns.findIndex((c) => c.header === header)]!;
    return soleDevicePages(parsed, doc)
      .flatMap((p) => tableBody(p))
      .filter((i) => i.face === 'regular' && Math.abs(i.x - (box.x + 6)) < 0.01);
  };

  it('shows every real site name whole in the device table', () => {
    const doc = realDoc();
    const device = deviceTable(doc);
    const site = device.columns.findIndex((c) => c.header === 'Site');
    device.rows.forEach((r, i) => {
      const s = SITES[i % SITES.length]!;
      r[site] = { text: `${s.code} \u00b7 ${s.name}` };
    });
    const drawn = inColumn(build(doc), doc, 'Site');
    expect(drawn.length).toBeGreaterThanOrEqual(100);
    expect(drawn.filter((i) => i.text.endsWith('\u2026'))).toEqual([]);
    expect(new Set(drawn.map((i) => i.text))).toEqual(new Set(SITES.map((s) => `${s.code} \u00b7 ${s.name}`)));
  });

  it('leaves the widths to the weights when every value already fits', () => {
    const table: Table = {
      title: 'Fits',
      sheet: 'Fits',
      columns: [
        { header: 'Name', kind: 'text', weight: 1 },
        { header: 'Note', kind: 'text', weight: 3 },
      ],
      rows: [[cell('Alpha'), cell('Short')]],
    };
    const [a, b] = columnBoxes(table);
    expect(a!.w).toBeCloseTo(770 / 4, 6);
    expect(b!.w).toBeCloseTo((770 * 3) / 4, 6);
  });

  it('meets the smallest shortfall first, so one column with an outlier cannot starve a name that nearly fits', () => {
    const near = ofWidth(215);
    const outlier = 'a'.repeat(2000);
    const table: Table = {
      title: 'Short',
      sheet: 'Short',
      columns: [
        { header: 'Near', kind: 'text', weight: 1 },
        { header: 'Outlier', kind: 'text', weight: 1 },
        { header: 'Wide', kind: 'text', weight: 2 },
      ],
      rows: [[cell(near), cell(outlier), cell(ofWidth(330))]],
    };
    const boxes = columnBoxes(table);
    expect(boxes.reduce((s, b) => s + b.w, 0)).toBeCloseTo(770, 6);
    const page = build({ ...tableDoc([]), tables: [table] }).pages[0]!;
    const drawn = tableBody(page).map((i) => i.text);
    expect(drawn, 'the name that nearly fits is drawn whole').toContain(near);
    const cut = drawn.filter((t) => t.endsWith('\u2026'));
    expect(cut.some((t) => t.length > 20 && t.startsWith('aaaa'))).toBe(true);
    expect(cut).not.toContain(near);
  });

  it('caps what one outlier can ask for at 38 percent of the printable width', () => {
    const table: Table = {
      title: 'Cap',
      sheet: 'Cap',
      columns: [
        { header: 'Name', kind: 'text', weight: 1 },
        { header: 'Other', kind: 'text', weight: 9 },
      ],
      rows: [[cell('a'.repeat(5000)), cell('short')]],
    };
    const [name, other] = columnBoxes(table);
    expect(name!.w).toBeCloseTo(770 * 0.38, 6);
    expect(other!.w).toBeCloseTo(770 * 0.62, 6);
  });

  it('never changes how a header wraps, even when a text column asks for far more than the table can spare', () => {
    const base = realDoc();
    const stretched = realDoc();
    const device = deviceTable(stretched);
    const site = device.columns.findIndex((c) => c.header === 'Site');
    for (const r of device.rows) r[site] = { text: ofWidth(400) };
    const headers = (doc: ReportDoc) => {
      const parsed = build(doc);
      return devicePages(parsed).map((page) => headerItems(page, deviceTable(doc)).map((i) => i.text).sort());
    };
    const before = headers(base);
    const after = headers(stretched);
    expect(before.length).toBeGreaterThanOrEqual(4);
    expect(after).toEqual(before);
    expect(before[0]).toContain('SLA (strict)');
  });

  it('holds the same column edges on every page of the table, and every column keeps its floor', () => {
    const doc = realDoc();
    const device = deviceTable(doc);
    const site = device.columns.findIndex((c) => c.header === 'Site');
    device.rows.forEach((r, i) => {
      r[site] = { text: `${SITES[i % SITES.length]!.code} \u00b7 ${SITES[i % SITES.length]!.name}` };
    });
    const boxes = columnBoxes(device);
    expect(boxes.reduce((s, b) => s + b.w, 0)).toBeCloseTo(770, 6);
    const parsed = build(doc);
    for (const i of soleDevicePages(parsed, doc).flatMap((p) => tableBody(p))) {
      expect(boxes.some((b) => i.x >= b.x + 6 - 0.01 && i.x + i.width <= b.x + b.w - 6 + 0.01), `${i.text} at ${i.x}`).toBe(true);
    }
    device.columns.forEach((c, i) => {
      for (const word of c.header.split(' ')) expect(boxes[i]!.w).toBeGreaterThanOrEqual(textWidth(toWinAnsi(word), 'bold', 8.5) + 12);
    });
  });
});

describe('notes', () => {
  /** A paragraph whose every word names it, so a line on a page can be traced to its paragraph; 22 words fill about a line. */
  const para = (id: string, lines: number) => Array.from({ length: lines * 22 - 10 }, (_, i) => `${id}w${i}`).join(' ');
  const section = (id: string, sizes: number[]): Note => ({ heading: `Section ${id}`, lines: sizes.map((n, p) => para(`${id}${p}`, n)) });
  const noteDoc = (filler: number, notes: Note[]): ReportDoc => ({ ...tableDoc([{ title: 'Filler', rows: filler }]), notes });

  /** Lines drawn per page, by paragraph. */
  function tally(parsed: Parsed): Map<string, number[]> {
    const out = new Map<string, number[]>();
    parsed.pages.forEach((p, page) => {
      for (const i of p.items) {
        const id = /^([A-Z]\d+)w\d+/.exec(i.text)?.[1];
        if (!id) continue;
        const counts = out.get(id) ?? parsed.pages.map(() => 0);
        counts[page]!++;
        out.set(id, counts);
      }
    });
    return out;
  }
  /** Lines of one section on each page. */
  const sectionCounts = (t: Map<string, number[]>, id: string, pages: number) =>
    Array.from({ length: pages }, (_, page) => [...t].filter(([k]) => k.startsWith(id)).reduce((s, [, c]) => s + c[page]!, 0));
  const usedPages = (counts: number[]) => counts.flatMap((n, page) => (n ? [page] : []));

  it('keeps a section that fits on one page together, moving it whole when the space left is too small', () => {
    const notes = [section('A', [2, 1, 3, 5]), section('B', [4, 2, 6]), section('C', [1])];
    let atTop = 0;
    for (let filler = 0; filler <= 60; filler++) {
      const parsed = build(noteDoc(filler, notes));
      const t = tally(parsed);
      for (const { heading } of notes) {
        const id = heading.slice(-1);
        const at = parsed.pages.findIndex((p) => pageTexts(p).includes(heading));
        expect(usedPages(sectionCounts(t, id, parsed.pages.length)), `filler ${filler}, ${heading}`).toEqual([at]);
        const item = parsed.pages[at]!.items.find((i) => i.text === heading)!;
        if (at > 0 && item.y === 595 - (68 + 11)) atTop++;
      }
    }
    expect(atTop, 'the sweep never pushed a section to the top of a page').toBeGreaterThan(3);
  });

  it('splits only a section longer than a page, with two lines or more each side and no stranded paragraph line', () => {
    const sizes = [1, 7, 1, 12, 2, 9, 3, 1, 14, 5, 2, 20, 1];
    let straddled = 0;
    for (let lead = 0; lead <= 6; lead++) {
      for (let filler = 0; filler <= 30; filler++) {
        const notes = [...(lead ? [section('P', Array(lead).fill(1))] : []), section('L', sizes), section('Q', [3, 2])];
        const parsed = build(noteDoc(filler, notes));
        const t = tally(parsed);
        const where = `lead ${lead}, filler ${filler}`;
        for (const [id, counts] of t) {
          const total = counts.reduce((a, b) => a + b, 0);
          if (total < 2) continue;
          for (const n of counts.filter(Boolean)) expect(n === total || n >= 2, `${where}, paragraph ${id}: ${counts}`).toBe(true);
          if (counts.filter(Boolean).length > 1) straddled++;
        }
        const counts = sectionCounts(t, 'L', parsed.pages.length);
        const used = usedPages(counts);
        expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(60);
        expect(used.length, where).toBeGreaterThanOrEqual(2);
        expect(used, where).toEqual(Array.from({ length: used.length }, (_, k) => used[0]! + k));
        for (const page of used) expect(counts[page], `${where}, page ${page + 1}: ${counts}`).toBeGreaterThanOrEqual(2);
        expect(parsed.pages.findIndex((p) => pageTexts(p).includes('Section L')), where).toBe(used[0]);
        for (const p of parsed.pages) expect(p.items.length, `${where}: a page with only its frame`).toBeGreaterThan(5);
      }
    }
    expect(straddled, 'the sweep never split a paragraph').toBeGreaterThan(20);
  });

  it('ends no paragraph of the real report on a single word', () => {
    const { strict, hcml } = sampleSliReports();
    const real = buildSlaReportDoc(strict, hcml, NOW);
    const drawn = paragraphLines(build(real), real.notes.flatMap((n) => n.lines));
    expect(drawn.filter((lines) => lines.length > 1).length).toBeGreaterThan(0);
    for (const lines of drawn) if (lines.length > 1) expect(lines.at(-1), lines.join(' ')).toContain(' ');
  });

  it('draws a paragraph that would have ended on one word with two on its last line, inside the width', () => {
    const base = 'Hours in which nothing was collected are left out by the strict method and counted as up by HCML method while a device with too little collected data is left out by the strict method and counted as one hundred percent by the other method, and time inside a planned maintenance window is left out by both methods downtime and total alike'.split(' ');
    const texts = Array.from({ length: 120 }, (_, k) => Array.from({ length: 40 + k }, (_, i) => base[i % base.length]).join(' '));
    const endsOnOne = (t: string) => {
      const lines = wrapText(toWinAnsi(t), 'regular', 8.5, 640);
      return lines.length > 1 && !lines.at(-1)!.includes(' ');
    };
    expect(texts.filter(endsOnOne).length, 'the sweep has too few paragraphs that end on one word').toBeGreaterThanOrEqual(3);
    const parsed = build({ ...tableDoc([]), notes: [{ heading: 'Runts', lines: texts }] });
    for (const lines of paragraphLines(parsed, texts)) if (lines.length > 1) expect(lines.at(-1), lines.join(' ')).toContain(' ');
    const lineItems = parsed.pages.flatMap((p) => p.items).filter((i) => i.face === 'regular' && i.size === 8.5 && i.x === 36);
    expect(lineItems.length).toBeGreaterThan(400);
    for (const i of lineItems) expect(i.width, i.text).toBeLessThanOrEqual(640.01);
  });

  it('keeps a section that fills the rest of the page exactly on that page', () => {
    // Page 1 has 444 pt under the band: the heading takes 20, each line 11.5 and each gap between paragraphs 4,
    // so 14 paragraphs of two lines and one of four come to 20 + 32 * 11.5 + 14 * 4 = 444.
    const word = 'x'.repeat(82); // 348.5 pt, so two words never share a line
    const paragraph = (words: number) => Array.from({ length: words }, () => word).join(' ');
    const lines = [...Array.from({ length: 14 }, () => paragraph(2)), paragraph(4)];
    const parsed = build({ ...tableDoc([]), notes: [{ heading: 'Exact', lines }] });
    expect(parsed.pages).toHaveLength(1);
    expect(parsed.pages[0]!.items.filter((i) => i.text === word)).toHaveLength(32);
  });

  it('keeps each note of the real report on one page', () => {
    const { strict, hcml } = sampleSliReports();
    const real = buildSlaReportDoc(strict, hcml, NOW);
    const pdf = build(real);
    for (const note of real.notes) {
      const page = pdf.pages.find((p) => pageTexts(p).includes(note.heading))!;
      const lastWord = note.lines.at(-1)!.split(' ').at(-1)!;
      expect(pageTexts(page).some((x) => x.endsWith(lastWord)), note.heading).toBe(true);
    }
  });
});

describe('colours', () => {
  const TONE_NAMES: Tone[] = ['good', 'warn', 'bad', 'muted', 'none'];
  const PREFIXES = ['name', 'share', 'count', 'span', 'verdict'];
  /** One card and one table row per tone, each cell labelled by its column and tone, then a footer in other tones. */
  const toneDoc = (): ReportDoc => ({
    ...tableDoc([]),
    kpis: TONE_NAMES.map((tone) => ({ label: `Key ${tone}`, value: `Value ${tone}`, detail: `Detail ${tone}`, tone })),
    tables: [
      {
        title: 'Tones',
        sheet: 'Tones',
        columns: [
          { header: 'Name', kind: 'text', weight: 3 },
          { header: 'Share', kind: 'percent', weight: 2 },
          { header: 'Count', kind: 'count', weight: 2 },
          { header: 'Span', kind: 'duration', weight: 2 },
          { header: 'Verdict', kind: 'status', weight: 2 },
        ],
        rows: TONE_NAMES.map((tone) => PREFIXES.map((prefix) => ({ text: `${prefix} ${tone}`, tone }))),
        footer: [
          { text: 'total', tone: 'good' },
          { text: 'foot share', tone: 'warn' },
          { text: 'foot count', tone: 'bad' },
          { text: 'foot span', tone: 'muted' },
          { text: 'foot verdict', tone: 'bad' },
        ],
      },
    ],
  });

  it('draws every table cell in the text colour of its tone, in every kind of column', () => {
    const colours = new Map(build(toneDoc()).pages.flatMap((p) => p.items).map((i) => [i.text, i.colour] as const));
    for (const tone of TONE_NAMES) {
      for (const prefix of PREFIXES) expect(colours.get(`${prefix} ${tone}`), `${prefix} ${tone}`).toBe(TONES[tone].text);
    }
    const footer = ['total', 'foot share', 'foot count', 'foot span', 'foot verdict'].map((t) => colours.get(t));
    expect(footer).toEqual([TONES.good.text, TONES.warn.text, TONES.bad.text, TONES.muted.text, TONES.bad.text]);
  });

  it('paints a status pill with the background and the edge of its tone, not the other way round', () => {
    const card = { fill: PALETTE.surface, stroke: PALETTE.border };
    const pills = [...TONE_NAMES, 'bad' as const].map((tone) => ({ fill: TONES[tone].bg, stroke: TONES[tone].line }));
    expect(outlined(build(toneDoc()).pages[0]!.content)).toEqual([...TONE_NAMES.map(() => card), ...pills]);
  });

  it('draws the accent bar of each key figure card in the solid colour of its tone', () => {
    const accents = rects(build(toneDoc()).pages[0]!.content).filter((r) => r.w === 4);
    expect(accents.map((r) => r.fill)).toEqual(TONE_NAMES.map((tone) => TONES[tone].solid));
  });

  it('draws a key figure label muted, its value in the text colour and its detail in the colour of its tone', () => {
    const colours = new Map(build(toneDoc()).pages[0]!.items.map((i) => [i.text, i.colour] as const));
    for (const tone of TONE_NAMES) {
      expect(colours.get(`Key ${tone}`), `label ${tone}`).toBe(PALETTE.muted);
      expect(colours.get(`Value ${tone}`), `value ${tone}`).toBe(PALETTE.text);
      expect(colours.get(`Detail ${tone}`), `detail ${tone}`).toBe(TONES[tone].text);
    }
  });

  it('shades the second row and every second row after it, counting across pages, and tints the footer instead', () => {
    // A table above it moves where the first page ends, so some page breaks fall after an odd number of rows.
    for (const filler of [0, 1, 2, 3, 4, 5]) {
      const d = tableDoc([{ title: 'First', rows: filler }, { title: 'Only', rows: 60 }]);
      d.tables[1]!.footer = [cell('Only total'), cell('0')];
      const parsed = build(d);
      expect(parsed.pages.length).toBeGreaterThan(1);
      let rows = 0;
      for (const page of parsed.pages) {
        const bands = rects(page.content).filter((r) => r.x === 36 && r.w === 770 && r.h === 16);
        const bandOf = (y: number) => bands.filter((r) => r.y <= y && y <= r.y + 16).map((r) => r.fill);
        for (const item of page.items.filter((i) => /^Only row \d+$/.test(i.text))) {
          const number = Number(item.text.slice('Only row '.length));
          expect(bandOf(item.y), `${item.text} after ${filler} rows above`).toEqual(number % 2 === 0 ? [PALETTE.surface2] : []);
          rows++;
        }
        for (const item of page.items.filter((i) => i.text === 'Only total')) expect(bandOf(item.y), 'the footer').toEqual([PALETTE.tint]);
      }
      expect(rows).toBe(60);
    }
  });
});

describe('chart geometry', () => {
  /** "…" is 1000 units wide, so as the only label it is exactly 8.5 pt and the track runs from 54.5 pt to 736 pt. */
  const LABEL = '…';
  const chartDoc = (target: number, axisMin: number, values: (number | null)[]): ReportDoc => ({
    ...tableDoc([]),
    chart: { title: 'Geometry', target, axisMin, bars: values.map((value, i) => ({ label: LABEL, value, tone: 'good' as const, text: `${i}` })) },
  });
  const BAR = new RegExp(`/Bar BMC\\n${CHANNEL} ${CHANNEL} ${CHANNEL} rg (-?[\\d.]+) (-?[\\d.]+) ([\\d.]+) ([\\d.]+) re f\\nEMC`, 'g');
  function geometry(d: ReportDoc) {
    const content = build(d).pages[0]!.content;
    return {
      tracks: rects(content).filter((r) => r.fill === PALETTE.tint && r.w > 300),
      bars: [...content.matchAll(BAR)].map((m) => ({ x: Number(m[4]), y: Number(m[5]), w: Number(m[6]), h: Number(m[7]) })),
      targetX: Number(/\[3 2\] 0 d (-?[\d.]+) [\d.-]+ m/.exec(content)?.[1]),
    };
  }

  it('keeps a bar inside its track however far its value lies outside the axis', () => {
    const { tracks, bars } = geometry(chartDoc(99, 95, [130, 40, 100, 95, -1e9, 1e9]));
    expect(tracks).toHaveLength(6);
    expect(bars).toHaveLength(6);
    expect([tracks[0]!.x, tracks[0]!.x + tracks[0]!.w]).toEqual([54.5, 736]);
    bars.forEach((bar, i) => {
      const track = tracks[i]!;
      expect(bar.y, `bar ${i} is on its own row`).toBeCloseTo(track.y, 2);
      expect(bar.x, `bar ${i} starts where its track does`).toBeCloseTo(track.x, 2);
      expect(bar.x + bar.w, `bar ${i} ends inside its track`).toBeLessThanOrEqual(track.x + track.w + 0.01);
    });
    // 100 and above fill the track; the start of the axis and below leave a 1.5 pt stub rather than nothing.
    for (const i of [0, 2, 5]) expect(bars[i]!.w, `bar ${i} fills the track`).toBeCloseTo(tracks[i]!.w, 1);
    for (const i of [1, 3, 4]) expect(bars[i]!.w, `bar ${i} is a stub`).toBeCloseTo(1.5, 2);
  });

  it('puts the target line where the axis scale puts it, to a hundredth of a point', () => {
    const cases: [number, number][] = [[99, 95], [97.5, 90], [99.9, 99], [90, 0], [100, 50], [120, 95], [50, 95]];
    for (const [target, axisMin] of cases) {
      const { tracks, targetX } = geometry(chartDoc(target, axisMin, [98]));
      const along = Math.min(Math.max((target - axisMin) / (100 - axisMin), 0), 1);
      const expected = tracks[0]!.x + along * tracks[0]!.w;
      expect(Math.abs(targetX - expected), `target ${target}, axis from ${axisMin}: ${targetX} against ${expected}`).toBeLessThanOrEqual(0.01);
    }
  });
});

describe('key figure values', () => {
  const SIZES = [22, 20, 18, 16, 14, 12];
  const cardsDoc = (values: string[]): ReportDoc => ({
    ...tableDoc([]),
    kpis: values.map((value, i) => ({ label: `Label ${i}`, value, tone: 'none' as const })),
  });
  const cardW = 185;
  const inner = cardW - 22;

  it('shrinks a long value in steps until it fits its card, and cuts one that still does not fit at the smallest step', () => {
    const values = ['98.74%', '131 of 138 devices', 'Four hundred and twelve', 'x'.repeat(60)];
    const page = build(cardsDoc(values)).pages[0]!;
    const sizes = values.map((value, i) => {
      const item = page.items.find((it) => it.face === 'bold' && it.text.startsWith(value.slice(0, 6)))!;
      expect(item, value).toBeDefined();
      const wanted = SIZES.find((s) => textWidth(toWinAnsi(value), 'bold', s) <= inner) ?? 12;
      expect(item.size, `"${value}" is drawn at the largest step that fits`).toBe(wanted);
      expect(item.width, `"${value}" stays inside its card`).toBeLessThanOrEqual(inner + 0.01);
      expect(item.x, `card ${i}`).toBeCloseTo(36 + i * (cardW + 10) + 14, 2);
      return item.size;
    });
    expect(sizes[0]).toBe(22);
    expect(sizes[1]).toBeLessThan(22);
    expect(sizes[2]).toBeLessThan(sizes[1]!);
    expect(sizes[3]).toBe(12);
    expect(page.items.find((it) => it.text.startsWith('xxxx'))!.text.endsWith('…')).toBe(true);
  });
});

describe('captions', () => {
  it('draws the caption of the chart and of each table under its title', () => {
    const d = sampleDoc();
    const texts = build(d).pages.flatMap(pageTexts);
    expect(d.chart!.caption).toBeTruthy();
    expect(texts).toContain(d.chart!.caption);
    const captioned = d.tables.filter((t) => t.caption);
    expect(captioned.length).toBeGreaterThan(2);
    for (const t of captioned) expect(texts, `the caption of ${t.title}`).toContain(t.caption);
  });

  it('draws a caption in the muted colour, at the left edge of its title and a little below it', () => {
    const page = build(sampleDoc()).pages[0]!;
    const title = page.items.find((i) => i.text === 'SLA by site, strict method')!;
    const caption = page.items.find((i) => i.text.startsWith('Bars start at 95%'))!;
    expect(caption.colour).toBe(PALETTE.muted);
    expect(caption.x).toBe(title.x);
    expect(title.y - caption.y).toBeGreaterThan(5);
    expect(title.y - caption.y).toBeLessThan(25);
  });
});

describe('figures that are not numbers', () => {
  const NOT_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const chartDoc = (edit: (chart: BarChart) => void): ReportDoc => {
    const d = tableDoc([]);
    d.chart = {
      title: 'Chart',
      target: 99,
      axisMin: 95,
      bars: [
        { label: 'A', value: 98, tone: 'good', text: '98%' },
        { label: 'B', value: 97, tone: 'bad', text: '97%' },
      ],
    };
    edit(d.chart);
    return d;
  };
  /** What no reader accepts in a content stream: NaN, Infinity or a number in exponent form. */
  const badTokens = (parsed: Parsed) => parsed.pages.flatMap((p) => bare(p.content).match(/NaN|Infinity|\d[eE][+-]?\d/g) ?? []);
  const slots: [string, (chart: BarChart, v: number) => void][] = [
    ['the target', (c, v) => void (c.target = v)],
    ['the start of the axis', (c, v) => void (c.axisMin = v)],
    ['a bar value', (c, v) => void (c.bars[0]!.value = v)],
  ];

  it('writes no NaN or Infinity into any content stream, whichever slot holds one', () => {
    for (const [slot, put] of slots) {
      for (const value of NOT_FINITE) {
        const parsed = build(chartDoc((c) => put(c, value)));
        expect(badTokens(parsed), `${slot} is ${value}`).toEqual([]);
        expect(parsed.faults, `${slot} is ${value}`).toEqual([]);
        expect(parsed.pages.flatMap((p) => grammarFaults(p.content)), `${slot} is ${value}`).toEqual([]);
      }
    }
    const everything = build(
      chartDoc((c) => {
        c.target = Number.NaN;
        c.axisMin = -Infinity;
        for (const b of c.bars) b.value = Infinity;
      }),
    );
    expect(badTokens(everything), 'every slot at once').toEqual([]);
  });

  it('draws a bar whose value is not a number as "No data" and draws no bar for it', () => {
    for (const value of NOT_FINITE) {
      const page = build(chartDoc((c) => void (c.bars[0]!.value = value))).pages[0]!;
      const texts = pageTexts(page);
      expect(page.content.match(/\/Bar BMC/g), `value ${value}`).toHaveLength(1);
      expect(texts.filter((t) => t === 'No data'), `value ${value}`).toHaveLength(1);
      expect(texts).not.toContain('98%');
      expect(texts).toContain('97%');
    }
  });

  it('draws no target line and no target label when the target is not a number', () => {
    for (const value of NOT_FINITE) {
      const page = build(chartDoc((c) => void (c.target = value))).pages[0]!;
      expect(page.content, `target ${value}`).not.toContain('[3 2] 0 d');
      expect(pageTexts(page).filter((t) => t.startsWith('Target')), `target ${value}`).toEqual([]);
      expect(page.content.match(/\/Bar BMC/g)).toHaveLength(2);
    }
  });

  it('starts the axis at 0 when its start is not a number, and keeps the target line', () => {
    for (const value of NOT_FINITE) {
      const page = build(chartDoc((c) => void (c.axisMin = value))).pages[0]!;
      expect(pageTexts(page), `axis start ${value}`).toEqual(expect.arrayContaining(['0%', '100%', 'Target 99%']));
      expect(page.content).toContain('[3 2] 0 d');
    }
  });
});

describe('the number formatter', () => {
  it('rounds to two decimals, drops trailing zeros and never writes a negative zero', () => {
    expect(pdfNumber(5)).toBe('5');
    expect(pdfNumber(12.3456)).toBe('12.35');
    expect(pdfNumber(0.5)).toBe('0.5');
    expect(pdfNumber(-0.001)).toBe('0');
    expect(pdfNumber(-3.14159)).toBe('-3.14');
    expect(pdfNumber(842)).toBe('842');
  });

  it('refuses NaN, Infinity and anything large enough to be written with an exponent', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity, 1e21, -1e21, Number.MAX_VALUE]) {
      const error = thrown(() => pdfNumber(bad));
      expect(error, String(bad)).toBeInstanceOf(RangeError);
      expect((error as Error).message).toBe(`The PDF writer cannot draw at ${bad}.`);
    }
    expect(pdfNumber(1e20)).toBe('100000000000000000000');
  });
});

describe('a chart at the top of the first page', () => {
  const chartOnly = (bars: number, caption?: string): ReportDoc => ({
    ...tableDoc([]),
    chart: {
      title: 'SLA by site',
      ...(caption ? { caption } : {}),
      target: 99,
      axisMin: 95,
      bars: Array.from({ length: bars }, (_, i) => ({ label: `Site ${i + 1}`, value: 97 + (i % 3), tone: 'good' as const, text: '98%' })),
    },
  });
  const barsOn = (page: ParsedPage) => page.content.match(/\/Bar BMC/g)?.length ?? 0;

  it('starts on page 1 whatever its length, in the bar counts that used to leave page 1 holding only the band', () => {
    for (const count of [23, 24, 29, 30, 34, 35, 40, 41, 44, 45]) {
      const parsed = build(chartOnly(count));
      expect(barsOn(parsed.pages[0]!), `${count} bars with no caption`).toBeGreaterThan(0);
      expect(parsed.pages.reduce((sum, p) => sum + barsOn(p), 0), `${count} bars with no caption`).toBe(count);
    }
  });

  it('never leaves a page with nothing on it but its frame, for one to 80 bars and a caption of none, one and two lines', () => {
    for (const caption of [undefined, 'A caption.', 'A long caption. '.repeat(30)]) {
      for (let count = 1; count <= 80; count++) {
        const parsed = build(chartOnly(count, caption));
        parsed.pages.forEach((page, n) => expect(barsOn(page), `${count} bars, caption of ${caption?.length ?? 0} characters: page ${n + 1} holds no bar`).toBeGreaterThan(0));
        expect(parsed.pages.reduce((sum, p) => sum + barsOn(p), 0), `${count} bars`).toBe(count);
      }
    }
  });

  it('still moves a chart that follows key figures whole to the next page when it fits there', () => {
    const d = { ...chartOnly(23), kpis: sampleDoc().kpis };
    const parsed = build(d);
    expect(barsOn(parsed.pages[0]!)).toBe(0);
    expect(barsOn(parsed.pages[1]!)).toBe(23);
  });
});

describe('very long text', () => {
  const LONG = 'x'.repeat(40_000);
  /** Milliseconds one call takes. */
  const took = (fn: () => unknown) => {
    const began = performance.now();
    fn();
    return performance.now() - began;
  };
  /** The best of up to three timings, stopping at the first under `limit`: one slow moment on a busy machine must not fail a test, a real slowdown still does. */
  const bestOf = (limit: number, run: () => number) => {
    let best = Number.POSITIVE_INFINITY;
    for (let n = 0; n < 3 && best >= limit; n++) best = Math.min(best, run());
    return best;
  };
  // Probed at sizes where a loop that grows with the square or the cube shows within a second or two, so such a slip fails
  // here at once; the 40,000 character tests below are skipped then, as they would run for minutes.
  const wrapProbe = bestOf(100, () => took(() => wrapText(toWinAnsi('x'.repeat(8000)), 'regular', 8.5, 640)));
  const fitProbe = bestOf(100, () => took(() => fitText(toWinAnsi('x'.repeat(20_000)), 'regular', 8.5, 640)));
  const slow = wrapProbe >= 100 || fitProbe >= 100;
  const small = (): ReportDoc => ({
    ...tableDoc([{ title: 'Small', rows: 2 }]),
    kpis: [{ label: 'Label', value: 'Value', detail: 'Detail', tone: 'good' }],
    chart: { title: 'Chart', target: 99, axisMin: 95, bars: [{ label: 'A', value: 98, tone: 'good', text: '98%' }] },
    notes: [{ heading: 'Note', lines: ['A short line.'] }],
  });
  const slots: [string, (d: ReportDoc) => void][] = [
    ['table caption', (d) => void (d.tables[0]!.caption = LONG)],
    ['chart caption', (d) => void (d.chart!.caption = LONG)],
    ['key figure label', (d) => void (d.kpis[0]!.label = LONG)],
    ['key figure value', (d) => void (d.kpis[0]!.value = LONG)],
    ['key figure detail', (d) => void (d.kpis[0]!.detail = LONG)],
    ['period', (d) => void (d.period = LONG)],
    ['note line', (d) => void (d.notes[0]!.lines = [LONG])],
    ['table header word', (d) => void (d.tables[0]!.columns[0]!.header = LONG)],
    ['table cell', (d) => void (d.tables[0]!.rows[0]![0]!.text = LONG)],
  ];

  it('breaks an 8,000 character word and cuts a 20,000 character one in a blink, not in time that grows with the square or the cube', () => {
    expect(wrapProbe, 'wrapText on 8,000 characters, ms').toBeLessThan(100);
    expect(fitProbe, 'fitText on 20,000 characters, ms').toBeLessThan(100);
  });

  it.skipIf(slow)('builds in under a second and a half in all, with a 40,000 character string in each slot in turn', () => {
    const buildAll = () => {
      let total = 0;
      for (const [, put] of slots) {
        const d = small();
        put(d);
        total += took(() => buildPdf(d, NOW));
      }
      return total;
    };
    build(small());
    expect(bestOf(1500, buildAll), 'all slots, ms').toBeLessThan(1500);
    for (const [slot, put] of slots) {
      const d = small();
      put(d);
      const parsed = build(d);
      expect(parsed.faults, slot).toEqual([]);
      expect(strays(parsed), slot).toEqual([]);
    }
  });

  it.skipIf(slow)('wraps a 40,000 character word into lines that all fit, losing no character', () => {
    const lines = wrapText(toWinAnsi(LONG), 'regular', 8.5, 640);
    expect(lines.length).toBeGreaterThan(200);
    for (const l of lines) expect(textWidth(l, 'regular', 8.5)).toBeLessThanOrEqual(640);
    expect(lines.join('')).toBe(LONG);
  });

  it('lays out 8,000 note lines in under two seconds, each drawn once and in order', () => {
    const lines = Array.from({ length: 8000 }, (_, i) => `Line ${i}`);
    const d = { ...small(), notes: [{ heading: 'Many', lines }] };
    expect(bestOf(2000, () => took(() => buildPdf(d, NOW))), 'ms').toBeLessThan(2000);
    const parsed = build(d);
    expect(parsed.faults).toEqual([]);
    expect(parsed.pages.flatMap(pageTexts).filter((t) => /^Line \d+$/.test(t))).toEqual(lines);
  });
});

describe('titles wider than the page', () => {
  const long = (word: string) => `${word} ${'abcdefghij '.repeat(30)}`.trim();
  const frameOf = (parsed: Parsed, page: number) => parsed.pages[page]!.items.filter((i) => Math.abs(i.y - (595 - 44)) < 0.01);

  it('cuts every heading, the running header and the bar figure to the printable width', () => {
    const d = tableDoc([{ title: long('Table'), rows: 80 }]);
    d.title = long('Report');
    d.subtitle = long('Subtitle');
    d.chart = {
      title: long('Chart'),
      target: 99,
      axisMin: 95,
      bars: [
        { label: 'A', value: 100, tone: 'good', text: long('Figure') },
        { label: 'B', value: 96, tone: 'bad', text: long('Other') },
      ],
    };
    d.notes = [{ heading: long('Note'), lines: ['One line.'] }];
    const parsed = build(d);
    expect(parsed.pages.length).toBeGreaterThan(2);
    expect(strays(parsed)).toEqual([]);
    const all = parsed.pages.flatMap((p) => p.items);
    for (const word of ['Table', 'Chart', 'Figure', 'Other', 'Note']) {
      const cut = all.filter((i) => i.text.startsWith(`${word} a`));
      expect(cut.length, word).toBeGreaterThan(0);
      for (const i of cut) expect(i.text.endsWith('…'), `${word}: ${i.text.slice(-12)}`).toBe(true);
    }
  });

  it('cuts a long subtitle in the running header to the room the title leaves, and a long title to the line', () => {
    const middling = tableDoc([{ title: 'Many', rows: 80 }]);
    middling.title = `Report ${'abcdefghij '.repeat(8)}`.trim();
    middling.subtitle = long('Subtitle');
    const parsed = build(middling);
    expect(strays(parsed)).toEqual([]);
    const [title, subtitle] = frameOf(parsed, 1);
    expect(title!.face).toBe('bold');
    expect(subtitle!.face).toBe('regular');
    expect(subtitle!.text.endsWith('…')).toBe(true);
    expect(subtitle!.x).toBeGreaterThanOrEqual(title!.x + title!.width + 8 - 0.01);

    const huge = { ...middling, title: long('Report') };
    const running = frameOf(build(huge), 1);
    expect(running).toHaveLength(1);
    expect(running[0]!.text.endsWith('…')).toBe(true);
  });
});

describe('document strings that are not well formed UTF-16', () => {
  it('writes a title, a subject and a bookmark with lone surrogates as UTF-16BE a strict decoder accepts', () => {
    const d = tableDoc([{ title: 'Lone \ud800 table', rows: 1 }, { title: 'Pair 😀 table', rows: 1 }]);
    d.title = 'a\ud800b';
    d.subtitle = 'x\udc00';
    d.period = '\ud83d';
    const parsed = build(d);
    expect(stringOf(parsed.info, 'Title')).toBe('a�b, x�');
    expect(stringOf(parsed.info, 'Subject')).toBe('�');
    expect(bookmarks(parsed).map((m) => m.title)).toEqual(['Lone � table', 'Pair 😀 table']);
  });

  it('draws a lone surrogate in page text as a question mark, like any character the font lacks', () => {
    const d = tableDoc([{ title: 'T', rows: 1 }]);
    d.tables[0]!.rows[0]![0] = cell('a\ud800b');
    expect(build(d).pages.flatMap(pageTexts)).toContain('a?b');
  });
});

describe('edge input', () => {
  const hollow = (rows: number): ReportDoc => {
    const d = tableDoc([{ title: 'Hollow', rows }]);
    d.tables[0]!.columns = [];
    d.tables[0]!.rows = Array.from({ length: rows }, () => []);
    return d;
  };

  it('says "Nothing to list." for a table with no rows and no message of its own, and uses its own message when it has one', () => {
    const d = tableDoc([{ title: 'Quiet', rows: 0 }]);
    expect(d.tables[0]!.empty).toBeUndefined();
    expect(build(d).pages.flatMap(pageTexts)).toContain('Nothing to list.');
    d.tables[0]!.empty = 'Nothing happened.';
    const texts = build(d).pages.flatMap(pageTexts);
    expect(texts).toContain('Nothing happened.');
    expect(texts).not.toContain('Nothing to list.');
  });

  it('shows the message and neither the header nor the footer for a table with no rows but a footer', () => {
    const d = tableDoc([{ title: 'Quiet', rows: 0 }]);
    d.tables[0]!.empty = 'No quiet rows.';
    d.tables[0]!.footer = [cell('Footer name'), cell('Footer figure')];
    const parsed = build(d);
    const texts = parsed.pages.flatMap(pageTexts);
    expect(texts).toEqual(expect.arrayContaining(['Quiet', 'No quiet rows.']));
    for (const absent of ['Footer name', 'Footer figure', 'Name', 'Value']) expect(texts, absent).not.toContain(absent);
    expect(rects(parsed.pages[0]!.content).filter((r) => r.fill === PALETTE.tint || r.fill === PALETTE.primary)).toEqual([]);
    expect(bookmarks(parsed).map((m) => m.title)).toEqual(['Quiet']);
  });

  it('refuses a table with no columns, with or without rows, naming it', () => {
    for (const rows of [0, 2]) {
      const error = thrown(() => buildPdf(hollow(rows), NOW));
      expect(error, `${rows} rows`).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Table "Hollow" has no columns.');
    }
  });

  it('refuses a report time that is not a date, as the workbook writer does, before it lays anything out', () => {
    for (const bad of [new Date(Number.NaN), new Date('not a date'), 1_790_000_000_000 as unknown as Date]) {
      const error = thrown(() => buildPdf(sampleDoc(), bad));
      expect(error, String(bad)).toBeInstanceOf(RangeError);
      expect((error as Error).message).toBe('The report time is not a valid date.');
    }
    const both = thrown(() => buildPdf(hollow(1), new Date(Number.NaN)));
    expect(both).toBeInstanceOf(RangeError);
    expect((both as Error).message).toBe('The report time is not a valid date.');
    expect(() => buildPdf(sampleDoc(), new Date(0))).not.toThrow();
  });
});

describe('Helvetica widths', () => {
  it('holds a table of 224 widths per face', () => {
    expect(fontWidths('regular')).toHaveLength(224);
    expect(fontWidths('bold')).toHaveLength(224);
  });

  it('pins every one of the 224 advances of each face, as Adobe\'s core-14 AFM files give them', () => {
    // Update these two hashes only when a table is changed on purpose, after checking the new numbers against the AFM files.
    const hash = (face: 'regular' | 'bold') => createHash('sha256').update(JSON.stringify(fontWidths(face))).digest('hex');
    expect(hash('regular')).toBe('ee42ce777556691f7aacc7b64d4d58d1933b2467aedd241099db2b84fa734cb7');
    expect(hash('bold')).toBe('965af8bd9a1f4cbc801acc109ddef302fb8bf10924f931bed382d085074c72f7');
  });

  it('has the advances of the accented, currency and sign glyphs the report text uses', () => {
    const w = (s: string, face: 'regular' | 'bold') => textWidth(toWinAnsi(s), face, 1000);
    for (const face of ['regular', 'bold'] as const) {
      expect(w('Ñ', face), `N tilde, ${face}`).toBe(722);
      expect(w('€', face), `Euro, ${face}`).toBe(556);
      expect(w('±', face), `plus or minus, ${face}`).toBe(584);
    }
    expect([w('ñ', 'regular'), w('ñ', 'bold')]).toEqual([556, 611]);
    expect([w('·', 'regular'), w('·', 'bold')]).toEqual([278, 278]);
  });

  it('has the well known advances', () => {
    const w = (s: string, face: 'regular' | 'bold') => textWidth(toWinAnsi(s), face, 1000);
    expect(w(' ', 'regular')).toBe(278);
    expect(w('M', 'regular')).toBe(833);
    expect(w('M', 'bold')).toBe(833);
    expect(w('i', 'regular')).toBe(222);
    expect(w('i', 'bold')).toBe(278);
    expect(w('W', 'regular')).toBe(944);
    expect(w('0', 'regular')).toBe(556);
    expect(w('é', 'regular')).toBe(556);
    expect(w('…', 'regular')).toBe(1000);
    expect(textWidth(toWinAnsi('Hello'), 'regular', 10)).toBeCloseTo(22.78, 5);
  });

  it('is plausible: every printable advance is between 150 and 1100, bold is never narrower overall', () => {
    for (const face of ['regular', 'bold'] as const) {
      for (const v of fontWidths(face)) {
        expect(v).toBeGreaterThan(150);
        expect(v).toBeLessThan(1100);
      }
    }
    const sample = 'The quick brown fox jumps over the lazy dog 0123456789';
    expect(textWidth(toWinAnsi(sample), 'bold', 10)).toBeGreaterThan(textWidth(toWinAnsi(sample), 'regular', 10));
  });
});

describe('WinAnsi mapping, cutting and wrapping', () => {
  it('maps text to the bytes the font draws', () => {
    expect(toWinAnsi('abc')).toBe('abc');
    expect(toWinAnsi('·')).toBe('\xb7');
    expect(toWinAnsi('’')).toBe('\x92');
    expect(toWinAnsi('“x”')).toBe('\x93x\x94');
    expect(toWinAnsi('é')).toBe('\xe9');
    expect(toWinAnsi('é')).toBe('\xe9');
    expect(toWinAnsi('€')).toBe('\x80');
    expect(toWinAnsi('a\tb\nc')).toBe('a b c');
    expect(toWinAnsi('日')).toBe('?');
    expect(toWinAnsi('\u{1F600}')).toBe('?');
    expect(toWinAnsi('\u0081')).toBe('?');
  });

  it('cuts to a width, keeping text that already fits', () => {
    const s = toWinAnsi('A fairly long sentence to cut');
    expect(fitText(s, 'regular', 8.5, 1000)).toBe(s);
    for (const max of [10, 30, 60, 100]) {
      const cut = fitText(s, 'regular', 8.5, max);
      expect(textWidth(cut, 'regular', 8.5)).toBeLessThanOrEqual(max);
      expect(cut.endsWith(ELLIPSIS)).toBe(true);
    }
    expect(fitText(s, 'regular', 8.5, 2)).toBe('');
  });

  it('wraps on spaces and breaks a word wider than the line', () => {
    const lines = wrapText(toWinAnsi('one two three four five six seven eight nine ten'), 'regular', 8.5, 60);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(textWidth(l, 'regular', 8.5)).toBeLessThanOrEqual(60);
    expect(lines.join(' ')).toBe('one two three four five six seven eight nine ten');
    const broken = wrapText(toWinAnsi('x'.repeat(100)), 'regular', 8.5, 50);
    expect(broken.length).toBeGreaterThan(1);
    expect(broken.join('')).toBe('x'.repeat(100));
  });

  it('wraps whole words, and cuts with an ellipsis a word wider than the line instead of breaking it', () => {
    const s = toWinAnsi('Longest outage per device');
    const widest = textWidth(toWinAnsi('Longest'), 'bold', 8.5);
    const lines = wrapWords(s, 'bold', 8.5, widest);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l, 'bold', 8.5)).toBeLessThanOrEqual(widest);
    expect(lines.join(' ')).toBe(s);
    expect(wrapWords(toWinAnsi('Incidents per device'), 'bold', 8.5, 400)).toEqual(['Incidents per device']);
    const narrow = wrapWords(toWinAnsi('Supercalifragilistic day'), 'bold', 8.5, 40);
    expect(narrow).toHaveLength(2);
    expect(narrow[0]!.endsWith(ELLIPSIS)).toBe(true);
    expect(narrow[1]).toBe('day');
    for (const l of narrow) expect(textWidth(l, 'bold', 8.5)).toBeLessThanOrEqual(40);
    expect(wrapWords(toWinAnsi('word'), 'bold', 8.5, 2)).toEqual([]);
  });

  it('cuts and breaks exactly as the plain shrink-and-measure-again way does, on random text, widths and sizes', () => {
    type Face = 'regular' | 'bold';
    const measure = (t: string, face: Face, size: number) => textWidth(t as WinAnsiText, face, size);
    // The slow reference: take one character off and measure again. It is what the fast code must agree with.
    const slowFit = (t: string, face: Face, size: number, max: number): string => {
      if (measure(t, face, size) <= max) return t;
      const room = max - measure(ELLIPSIS, face, size);
      if (room <= 0) return '';
      let end = t.length;
      while (end > 0 && measure(t.slice(0, end), face, size) > room) end--;
      return t.slice(0, end).trimEnd() + ELLIPSIS;
    };
    const slowWrap = (t: string, face: Face, size: number, max: number): string[] => {
      const lines: string[] = [];
      let line = '';
      for (const word of t.split(' ')) {
        if (!word) continue;
        const next = line ? `${line} ${word}` : word;
        if (measure(next, face, size) <= max) {
          line = next;
          continue;
        }
        if (line) lines.push(line);
        let rest = word;
        while (measure(rest, face, size) > max && rest.length > 1) {
          let end = rest.length - 1;
          while (end > 1 && measure(rest.slice(0, end), face, size) > max) end--;
          lines.push(rest.slice(0, end));
          rest = rest.slice(end);
        }
        line = rest;
      }
      if (line) lines.push(line);
      return lines;
    };
    let seed = 20261001;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
    const alphabets = [() => String.fromCharCode(32 + Math.floor(random() * 224)), () => pick(['i', 'l', "'", '.', ' ']), () => pick(['W', 'M', '\x85', ' ']), () => pick(['a', 'b', 'c', ' ', ' '])];
    let cut = 0;
    let broken = 0;
    for (let n = 0; n < 3000; n++) {
      const alphabet = pick(alphabets);
      const t = Array.from({ length: Math.floor(random() * pick([4, 20, 80, 240])) }, alphabet).join('');
      const face = pick(['regular', 'bold'] as const);
      const size = pick([6.5, 7.5, 8.5, 9, 12, 22]);
      // Widths at random, at nothing and below, and exactly at a prefix, with and without the ellipsis, where "fits" turns on equality.
      const prefix = t.slice(0, Math.floor(random() * (t.length + 1)));
      const widths = [random() * 800, 0, -3, measure(prefix, face, size), measure(prefix, face, size) + measure(ELLIPSIS, face, size)];
      for (const max of widths) {
        const where = JSON.stringify({ t, face, size, max });
        const fit = fitText(t as WinAnsiText, face, size, max);
        expect(fit, `fitText ${where}`).toBe(slowFit(t, face, size, max));
        if (fit !== t) cut++;
        const lines = wrapText(t as WinAnsiText, face, size, max);
        expect(lines, `wrapText ${where}`).toEqual(slowWrap(t, face, size, max));
        if (lines.some((l) => measure(l, face, size) > 0 && l.length > 1) && lines.length > t.split(' ').filter(Boolean).length) broken++;
      }
    }
    expect(cut, 'the sweep cut text often').toBeGreaterThan(5000);
    expect(broken, 'the sweep broke a long word often').toBeGreaterThan(500);
  });
});

describe('paragraph wrapping', () => {
  const wide = (s: string) => textWidth(toWinAnsi(s), 'regular', 8.5);
  const wrap = (s: string, width: number) => wrapParagraph(toWinAnsi(s), 'regular', 8.5, width);
  const plain = (s: string, width: number) => wrapText(toWinAnsi(s), 'regular', 8.5, width);

  it('gives a one-word last line the last word of the line before it, and only that word', () => {
    const s = 'one two three four five six';
    const width = wide('one two three four five');
    expect(plain(s, width)).toEqual(['one two three four five', 'six']);
    expect(wrap(s, width)).toEqual(['one two three four', 'five six']);
  });

  it('reshapes only the last two lines of a longer paragraph', () => {
    const s = 'a1 a2 a3 a4 a5 b1 b2 b3 b4 b5 c1 c2 c3 c4 c5 c6';
    const width = wide('a1 a2 a3 a4 a5');
    expect(plain(s, width)).toEqual(['a1 a2 a3 a4 a5', 'b1 b2 b3 b4 b5', 'c1 c2 c3 c4 c5', 'c6']);
    expect(wrap(s, width)).toEqual(['a1 a2 a3 a4 a5', 'b1 b2 b3 b4 b5', 'c1 c2 c3 c4', 'c5 c6']);
  });

  it('lends a word only when the line before keeps three', () => {
    expect(wrap('one two three four five', wide('one two three four'))).toEqual(['one two three', 'four five']);
    const short = wrap('one two three four', wide('one two three'));
    expect(short).toEqual(['one two three', 'four']);
    expect(short).toEqual(plain('one two three four', wide('one two three')));
  });

  it('leaves the paragraph alone when the moved pair would not fit the width', () => {
    const width = wide('i i i i WWWWWWWW');
    expect(wide('WWWWWWWW MMMMMMMM')).toBeGreaterThan(width);
    expect(wrap('i i i i WWWWWWWW MMMMMMMM', width)).toEqual(['i i i i WWWWWWWW', 'MMMMMMMM']);
  });

  it('leaves alone a paragraph on one line, one that ends on two words, an empty one and a word broken for its length', () => {
    expect(wrap('one two three', 1000)).toEqual(['one two three']);
    expect(wrap('', 100)).toEqual([]);
    expect(wrap('one two three four five six seven', wide('one two three four five'))).toEqual(['one two three four five', 'six seven']);
    expect(wrap('x'.repeat(100), 50)).toEqual(plain('x'.repeat(100), 50));
  });

  it('never exceeds the width, splits a word or adds a line, and a lone last word is left only when it could not be helped', () => {
    const base = 'the strict figure counts unreachable devices and leaves out hours with no collected data so a device that is completely down still counts as up'.split(' ');
    let applied = 0;
    for (let count = 12; count <= 60; count++) {
      const s = Array.from({ length: count }, (_, i) => base[(i * 7) % base.length]).join(' ');
      for (let width = 60; width <= 400; width += 13) {
        const lines = wrap(s, width);
        const greedy = plain(s, width);
        const where = `${count} words at ${width}`;
        expect(lines, where).toHaveLength(greedy.length);
        expect(lines.slice(0, -2), where).toEqual(greedy.slice(0, -2));
        expect(lines.join(' '), where).toBe(greedy.join(' '));
        for (const l of lines) expect(textWidth(l, 'regular', 8.5), where).toBeLessThanOrEqual(width);
        if (lines.join('\n') !== greedy.join('\n')) applied++;
        if (lines.length > 1 && !lines.at(-1)!.includes(' ')) {
          const before = lines.at(-2)!.split(' ');
          expect(before.length - 1 < 3 || wide(`${before.at(-1)} ${lines.at(-1)}`) > width, where).toBe(true);
        }
      }
    }
    expect(applied, 'the sweep never needed the rule').toBeGreaterThan(20);
  });

  it('is not part of wrapText or wrapWords, which still end on a lone word', () => {
    const s = toWinAnsi('one two three four five six');
    const width = wide('one two three four five');
    expect(wrapText(s, 'regular', 8.5, width)).toEqual(['one two three four five', 'six']);
    expect(wrapWords(s, 'regular', 8.5, width)).toEqual(['one two three four five', 'six']);
  });
});

describe('logo', () => {
  it('is the file in web/public, byte for byte', () => {
    const file = readFileSync(new URL('../../../web/public/logo-mark.png', import.meta.url));
    expect(Buffer.from(LOGO_PNG_BASE64, 'base64').equals(file)).toBe(true);
  });

  it('decodes to its pixels, with a clear background', () => {
    const px = decodePng(Buffer.from(LOGO_PNG_BASE64, 'base64'));
    expect([px.width, px.height]).toEqual([782, 224]);
    expect(px.rgb).toHaveLength(782 * 224 * 3);
    expect(px.alpha).toHaveLength(782 * 224);
    expect(px.alpha![0]).toBe(0);
    expect(px.alpha!.some((a) => a === 255)).toBe(true);
  });
});

describe('PNG reader', () => {
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };

  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };

  /** Encodes with filter type (row mod 5), so each filter is used. */
  function encode(width: number, height: number, colourType: number, channels: number, pixels: Buffer, extra: Buffer[] = [], depth = 8, interlace = 0) {
    const stride = width * channels;
    const rows: Buffer[] = [];
    for (let y = 0; y < height; y++) {
      const type = y % 5;
      const row = Buffer.alloc(stride + 1);
      row[0] = type;
      for (let i = 0; i < stride; i++) {
        const x = pixels[y * stride + i]!;
        const left = i >= channels ? pixels[y * stride + i - channels]! : 0;
        const up = y > 0 ? pixels[(y - 1) * stride + i]! : 0;
        const upLeft = y > 0 && i >= channels ? pixels[(y - 1) * stride + i - channels]! : 0;
        const pred = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][type]!;
        row[i + 1] = (x - pred) & 255;
      }
      rows.push(row);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = depth;
    ihdr[9] = colourType;
    ihdr[12] = interlace;
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const z = deflateSync(Buffer.concat(rows));
    const half = Math.ceil(z.length / 2);
    return Buffer.concat([signature, chunk('IHDR', ihdr), ...extra, chunk('IDAT', z.subarray(0, half)), chunk('IDAT', z.subarray(half)), chunk('IEND', Buffer.alloc(0))]);
  }

  const noise = (count: number) => Buffer.from(Array.from({ length: count }, (_, i) => (i * 37 + (i >> 3) * 11 + 5) & 255));

  it('reads colour type 6 through all five filters', () => {
    const px = noise(7 * 12 * 4);
    const out = decodePng(encode(7, 12, 6, 4, px));
    for (let i = 0; i < 7 * 12; i++) {
      expect([...out.rgb.subarray(i * 3, i * 3 + 3)]).toEqual([...px.subarray(i * 4, i * 4 + 3)]);
      expect(out.alpha![i]).toBe(px[i * 4 + 3]);
    }
  });

  it('reads colour type 2 and 0 without alpha', () => {
    const rgbPx = noise(9 * 6 * 3);
    const a = decodePng(encode(9, 6, 2, 3, rgbPx));
    expect(a.alpha).toBeNull();
    expect(a.rgb.equals(rgbPx)).toBe(true);
    const grey = noise(9 * 6);
    const b = decodePng(encode(9, 6, 0, 1, grey));
    for (let i = 0; i < grey.length; i++) expect([...b.rgb.subarray(i * 3, i * 3 + 3)]).toEqual([grey[i], grey[i], grey[i]]);
  });

  it('reads colour type 3 with a palette and its transparency', () => {
    const palette = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]);
    const indices = Buffer.from(Array.from({ length: 8 * 6 }, (_, i) => i % 4));
    const out = decodePng(encode(8, 6, 3, 1, indices, [chunk('PLTE', palette), chunk('tRNS', Buffer.from([0, 128]))]));
    expect([...out.rgb.subarray(0, 6)]).toEqual([255, 0, 0, 0, 255, 0]);
    expect([...out.alpha!.subarray(0, 4)]).toEqual([0, 128, 255, 255]);
    expect(decodePng(encode(8, 6, 3, 1, indices, [chunk('PLTE', palette)])).alpha).toBeNull();
  });

  it('refuses what it cannot read', () => {
    expect(() => decodePng(Buffer.from('not a png'))).toThrow(/Not a PNG/);
    expect(() => decodePng(encode(4, 4, 6, 4, noise(64), [], 16))).toThrow(/Unsupported/);
    expect(() => decodePng(encode(4, 4, 6, 4, noise(64), [], 8, 1))).toThrow(/Unsupported/);
    expect(() => decodePng(encode(4, 4, 4, 2, noise(32)))).toThrow(/Unsupported/);
  });
});
