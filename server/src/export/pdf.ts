import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { LOGO_PNG_BASE64, decodePng } from './logo.js';
import { fitText, fontWidths, textWidth, toWinAnsi, wrapParagraph, wrapText, wrapWords, type FontFace, type WinAnsiText } from './pdfFonts.js';
import { PALETTE, TONES, rgb } from './theme.js';
import { NOTHING_TO_LIST, type Bar, type BarChart, type Cell, type Column, type Kpi, type Note, type ReportDoc, type Table } from './types.js';

/**
 * The PDF writer: turns a ReportDoc into an A4 landscape file in the portal's
 * theme, with nothing but Node built-ins. Hand-written PDF 1.4 with the
 * standard Helvetica fonts, so there is no font to embed and the file stays
 * small and opens the same everywhere.
 *
 * The page is laid out in full first, so "Page x of y" is known when the
 * footers are drawn, then written out. Coordinates here run down from the top
 * of the page; they are flipped to the PDF's bottom-up axis when drawn.
 */

const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 36;
const RIGHT = PAGE_W - MARGIN;
const PRINT_W = PAGE_W - 2 * MARGIN;

const BAND_H = 72;
const RUNNING_RULE = 52;
const FOOTER_RULE = 546;
const FOOTER_BASE = 558;
const FIRST_TOP = BAND_H + 18;
const NEXT_TOP = RUNNING_RULE + 16;
const CONTENT_BOTTOM = FOOTER_RULE - 12;
const SECTION_GAP = 18;

const PAD = 6;
const ROW_H = 16;
const BODY_SIZE = 8.5;
const PILL_SIZE = 7.5;
const PILL_PAD = 12;
const KPI_MAX_PER_ROW = 6;
/** No column's floor goes past a quarter of the page, so one absurd word is cut rather than starving the rest. */
const MAX_FLOOR = PRINT_W / 4;
/** A text column asks for room for its longest value, but never more than this, so one long name cannot starve the rest. */
const MAX_WANT = PRINT_W * 0.38;

const NOTE_W = 640;
const NOTE_HEAD = 20;
const NOTE_LINE = 11.5;
const PARA_GAP = 4;
const NOTE_GAP = 8;

type Op = string;
interface Page {
  ops: Op[];
}
interface Mark {
  title: string;
  page: number;
  top: number;
}

/** A number as a content stream spells it. A NaN, an Infinity or an exponent form is no PDF number, so it stops the build rather than corrupt a page. */
export function pdfNumber(v: number): string {
  if (!(Math.abs(v) < 1e21)) throw new RangeError(`The PDF writer cannot draw at ${v}.`);
  return String(Number(v.toFixed(2)));
}
const n = pdfNumber;
const fontName = (face: FontFace) => (face === 'bold' ? 'F2' : 'F1');
const channels = (hex: string) => rgb(hex).map((c) => String(Number((c / 255).toFixed(3)))).join(' ');
const fillOp = (hex: string) => `${channels(hex)} rg`;
const strokeOp = (hex: string) => `${channels(hex)} RG`;

/** Mixes `hex` toward white by `t` (0 to 1), for the softened white on the navy band. */
function toWhite(hex: string, t: number): string {
  const [r, g, b] = rgb(hex).map((c) => Math.round(c + (255 - c) * t));
  return `#${[r, g, b].map((c) => c!.toString(16).padStart(2, '0')).join('')}`;
}

/** A string literal for a content stream: bytes outside printable ASCII go in as octal escapes. */
function literal(s: WinAnsiText): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 40 || c === 41 || c === 92) out += `\\${s[i]}`;
    else if (c < 32 || c > 126) out += `\\${c.toString(8).padStart(3, '0')}`;
    else out += s[i];
  }
  return `(${out})`;
}

/** A text string for the document dictionaries: plain ASCII, else UTF-16BE with a byte order mark. */
function textString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return literal(s as WinAnsiText);
  // A lone surrogate is not valid UTF-16, so it becomes U+FFFD. The ES2022 typings predate toWellFormed; Node 20 and later have it.
  const wellFormed = (s as string & { toWellFormed(): string }).toWellFormed();
  return `<FEFF${Buffer.from(wellFormed, 'utf16le').swap16().toString('hex')}>`;
}

function rectPath(x: number, top: number, w: number, h: number): Op {
  return `${n(x)} ${n(PAGE_H - top - h)} ${n(w)} ${n(h)} re`;
}

function roundPath(x: number, top: number, w: number, h: number, radius: number): Op {
  const y = PAGE_H - top - h;
  const r = Math.min(radius, w / 2, h / 2);
  const k = r * 0.5523;
  const p = (a: number, b: number) => `${n(a)} ${n(b)}`;
  return [
    `${p(x + r, y)} m`,
    `${p(x + w - r, y)} l`,
    `${p(x + w - r + k, y)} ${p(x + w, y + r - k)} ${p(x + w, y + r)} c`,
    `${p(x + w, y + h - r)} l`,
    `${p(x + w, y + h - r + k)} ${p(x + w - r + k, y + h)} ${p(x + w - r, y + h)} c`,
    `${p(x + r, y + h)} l`,
    `${p(x + r - k, y + h)} ${p(x, y + h - r + k)} ${p(x, y + h - r)} c`,
    `${p(x, y + r)} l`,
    `${p(x, y + r - k)} ${p(x + r - k, y)} ${p(x + r, y)} c h`,
  ].join(' ');
}

interface Paint {
  fill?: string;
  stroke?: string;
  width?: number;
}

function paint(ops: Op[], path: Op, { fill, stroke, width = 0.75 }: Paint): void {
  const head = [fill ? fillOp(fill) : '', stroke ? `${strokeOp(stroke)} ${n(width)} w` : ''].filter(Boolean).join(' ');
  ops.push(`${head} ${path} ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
}

const fillRect = (ops: Op[], x: number, top: number, w: number, h: number, fill: string) =>
  paint(ops, rectPath(x, top, w, h), { fill });

function line(ops: Op[], x1: number, y1: number, x2: number, y2: number, colour: string, width: number, dash?: string): void {
  const path = `${n(x1)} ${n(PAGE_H - y1)} m ${n(x2)} ${n(PAGE_H - y2)} l S`;
  ops.push(`${strokeOp(colour)} ${n(width)} w ${dash ? `${dash} 0 d ` : ''}${path}${dash ? ' [] 0 d' : ''}`);
}

type Align = 'left' | 'right' | 'center';

function text(
  ops: Op[],
  s: WinAnsiText,
  x: number,
  baseline: number,
  face: FontFace,
  size: number,
  colour: string,
  align: Align = 'left',
): void {
  if (!s) return;
  const w = textWidth(s, face, size);
  const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  ops.push(`${fillOp(colour)} BT /${fontName(face)} ${n(size)} Tf ${n(left)} ${n(PAGE_H - baseline)} Td ${literal(s)} Tj ET`);
}

/** Baseline that centres a line of capital-height text in a box starting at `top`. */
const centred = (top: number, height: number, size: number) => top + height / 2 + size * 0.36;

/** At most `max` wrapped lines; whatever does not fit is folded into the last line and cut with an ellipsis. */
function wrapMax(s: WinAnsiText, face: FontFace, size: number, width: number, max: number, wrap = wrapText): WinAnsiText[] {
  const lines = wrap(s, face, size, width);
  if (lines.length <= max) return lines;
  const tail = fitText(lines.slice(max - 1).join(' ') as WinAnsiText, face, size, width);
  return [...lines.slice(0, max - 1), tail];
}

const fmtNum = (v: number) => String(Number(v.toFixed(2)));

class Layout {
  readonly pages: Page[] = [];
  readonly marks: Mark[] = [];
  y = FIRST_TOP;

  constructor(private readonly doc: ReportDoc) {
    this.pages.push({ ops: [] });
  }

  get ops(): Op[] {
    return this.pages[this.pages.length - 1]!.ops;
  }

  private get pageTop(): number {
    return this.pages.length === 1 ? FIRST_TOP : NEXT_TOP;
  }

  private get room(): number {
    return CONTENT_BOTTOM - this.y;
  }

  newPage(): void {
    this.pages.push({ ops: [] });
    this.y = NEXT_TOP;
  }

  /** Starts a fresh page unless `height` fits; a page that is already empty is never skipped. */
  private ensure(height: number): void {
    if (height > this.room && this.y > this.pageTop) this.newPage();
  }

  private mark(title: string): void {
    this.marks.push({ title, page: this.pages.length - 1, top: this.y });
  }

  /** A section title with an accent bar and an optional caption; a continuation gets a plain small title. */
  private heading(title: WinAnsiText, caption: WinAnsiText[], continued = false): void {
    const ops = this.ops;
    if (continued) {
      text(ops, fitText(title, 'bold', 10, PRINT_W), MARGIN, this.y + 11, 'bold', 10, PALETTE.primaryStrong);
      this.y += 20;
      return;
    }
    fillRect(ops, MARGIN, this.y + 2, 3, 13, PALETTE.mid);
    text(ops, fitText(title, 'bold', 12, PRINT_W - 9), MARGIN + 9, this.y + 13, 'bold', 12, PALETTE.primaryStrong);
    this.y += 18;
    caption.forEach((l, i) => text(ops, l, MARGIN + 9, this.y + 9 + i * 11.5, 'regular', BODY_SIZE, PALETTE.muted));
    this.y += caption.length * 11.5 + 6;
  }

  private captionOf(caption: string | undefined): WinAnsiText[] {
    return caption ? wrapMax(toWinAnsi(caption), 'regular', BODY_SIZE, PRINT_W - 9, 2) : [];
  }

  private headingHeight(captionLines: number, continued = false): number {
    return continued ? 20 : 18 + captionLines * 11.5 + 6;
  }

  kpis(list: Kpi[]): void {
    for (let i = 0; i < list.length; i += KPI_MAX_PER_ROW) this.kpiRow(list.slice(i, i + KPI_MAX_PER_ROW));
  }

  private kpiRow(row: Kpi[]): void {
    const gap = 10;
    const width = (PRINT_W - gap * (row.length - 1)) / row.length;
    const inner = width - 4 - 10 - 8;
    const cards = row.map((k) => {
      const value = toWinAnsi(k.value);
      const size = [22, 20, 18, 16, 14, 12].find((s) => textWidth(value, 'bold', s) <= inner) ?? 12;
      return {
        tone: TONES[k.tone],
        label: wrapMax(toWinAnsi(k.label), 'regular', BODY_SIZE, inner, 2),
        value: fitText(value, 'bold', size, inner),
        size,
        detail: k.detail ? wrapMax(toWinAnsi(k.detail), 'regular', BODY_SIZE, inner, 2) : [],
      };
    });
    const labelLines = Math.max(...cards.map((c) => c.label.length));
    const detailLines = Math.max(...cards.map((c) => c.detail.length));
    const height = 10 + labelLines * 10.5 + 4 + 24 + (detailLines ? 3 + detailLines * 10.5 : 0) + 10;
    this.ensure(height);
    const ops = this.ops;
    cards.forEach((c, i) => {
      const x = MARGIN + i * (width + gap);
      paint(ops, roundPath(x, this.y, width, height, 4), { fill: PALETTE.surface, stroke: PALETTE.border });
      ops.push('q', `${roundPath(x, this.y, width, height, 4)} W n`);
      fillRect(ops, x, this.y, 4, height, c.tone.solid);
      ops.push('Q');
      const tx = x + 14;
      c.label.forEach((l, j) => text(ops, l, tx, this.y + 10 + 8 + j * 10.5, 'regular', BODY_SIZE, PALETTE.muted));
      const valueBase = this.y + 10 + labelLines * 10.5 + 4 + 18;
      text(ops, c.value, tx, valueBase, 'bold', c.size, PALETTE.text);
      c.detail.forEach((l, j) => text(ops, l, tx, valueBase + 3 + 10 + j * 10.5, 'regular', BODY_SIZE, c.tone.text));
    });
    this.y += height + SECTION_GAP;
  }

  chart(chart: BarChart | undefined): void {
    if (!chart || chart.bars.length === 0) return;
    const steps = [
      { pitch: 17, bar: 10.5, size: 8.5 },
      { pitch: 13.5, bar: 8.5, size: 8 },
      { pitch: 11.5, bar: 7.5, size: 7.5 },
      { pitch: 10, bar: 6.5, size: 7 },
      { pitch: 9, bar: 5.5, size: 6.5 },
    ];
    const caption = this.captionOf(chart.caption);
    const title = toWinAnsi(chart.title);
    const fixed = (first: boolean) => this.headingHeight(first ? caption.length : 0, !first) + 14 + 16;
    const fresh = CONTENT_BOTTOM - NEXT_TOP;
    const step = steps.find((s) => fixed(true) + chart.bars.length * s.pitch <= fresh) ?? steps[steps.length - 1]!;
    const capacity = (room: number, first: boolean) => Math.max(0, Math.floor((room - fixed(first)) / step.pitch));

    let rest = chart.bars;
    for (let first = true; rest.length; first = false) {
      if (fixed(first) + rest.length * step.pitch > this.room) {
        const wholeOnFresh = fixed(first) + rest.length * step.pitch <= fresh;
        // As in ensure(): a page that is already empty is never skipped, or page 1 would hold only the band.
        if ((wholeOnFresh || capacity(this.room, first) < 6) && this.y > this.pageTop) this.newPage();
      }
      const take = Math.min(rest.length, capacity(this.room, first));
      if (first) this.mark(chart.title);
      this.heading(first ? title : toWinAnsi(`${chart.title} (continued)`), first ? caption : [], !first);
      this.chartSlice(chart, rest.slice(0, take), step);
      rest = rest.slice(take);
      if (rest.length) this.newPage();
    }
    this.y += 10;
  }

  private chartSlice(chart: BarChart, bars: Bar[], step: { pitch: number; bar: number; size: number }): void {
    const ops = this.ops;
    const { size, pitch } = step;
    const labels = bars.map((b) => toWinAnsi(b.label));
    const labelW = Math.min(170, Math.max(...labels.map((l) => textWidth(l, 'regular', size))));
    const x0 = MARGIN + labelW + 10;
    const x1 = RIGHT - 70;
    // A figure that is not a finite number cannot be placed: a bar without one reads "No data", no target draws no
    // line, and no axis start takes the full 0 to 100 scale.
    const axisMin = Number.isFinite(chart.axisMin) ? chart.axisMin : 0;
    const span = Math.max(100 - axisMin, 1);
    const xOf = (v: number) => x0 + (Math.min(Math.max((v - axisMin) / span, 0), 1)) * (x1 - x0);
    let targetX: number | undefined;
    if (Number.isFinite(chart.target)) {
      targetX = xOf(chart.target);
      const targetLabel = toWinAnsi(chart.targetLabel ?? `Target ${fmtNum(chart.target)}%`);
      const targetW = textWidth(targetLabel, 'bold', 8);
      text(ops, targetLabel, Math.min(Math.max(targetX, x0 + targetW / 2), RIGHT - targetW / 2), this.y + 8, 'bold', 8, PALETTE.primaryStrong, 'center');
    }

    const top = this.y + 14;
    const bottom = top + bars.length * pitch;
    bars.forEach((_, i) => fillRect(ops, x0, top + i * pitch + (pitch - step.bar) / 2, x1 - x0, step.bar, PALETTE.tint));
    for (const x of [x0, x1]) line(ops, x, top - 2, x, bottom + 2, PALETTE.tintLine, 0.75);
    const figures: { label: WinAnsiText; x: number; base: number; top: number }[] = [];
    bars.forEach((b, i) => {
      const rowTop = top + i * pitch;
      const barTop = rowTop + (pitch - step.bar) / 2;
      const base = centred(rowTop, pitch, size);
      text(ops, fitText(labels[i]!, 'regular', size, labelW), x0 - 10, base, 'regular', size, PALETTE.text, 'right');
      if (b.value === null || !Number.isFinite(b.value)) {
        text(ops, toWinAnsi('No data'), x0 + 6, base, 'regular', size, PALETTE.muted);
        return;
      }
      const end = Math.max(xOf(b.value), x0 + 1.5);
      ops.push('/Bar BMC');
      fillRect(ops, x0, barTop, end - x0, step.bar, TONES[b.tone].solid);
      ops.push('EMC');
      figures.push({ label: fitText(toWinAnsi(b.text), 'bold', size, RIGHT - (end + 5)), x: end + 5, base, top: barTop });
    });
    if (targetX !== undefined) line(ops, targetX, top - 3, targetX, bottom + 3, PALETTE.primaryStrong, 1, '[3 2]');
    for (const f of figures) {
      const w = textWidth(f.label, 'bold', size);
      // Where a figure sits across the target line, the track is painted over the line so the digits stay clear.
      if (targetX !== undefined && f.x - 2 < targetX && targetX < f.x + w + 2) fillRect(ops, f.x - 2, f.top, w + 4, step.bar, PALETTE.tint);
      text(ops, f.label, f.x, f.base, 'bold', size, PALETTE.text);
    }
    text(ops, toWinAnsi(chart.axisLabel ?? `${fmtNum(axisMin)}%`), x0, bottom + 12, 'regular', 7.5, PALETTE.muted, 'center');
    text(ops, toWinAnsi('100%'), x1, bottom + 12, 'regular', 7.5, PALETTE.muted, 'center');
    this.y = bottom + 16;
  }

  table(t: Table): void {
    if (t.columns.length === 0) throw new Error(`Table "${t.title}" has no columns.`);
    const caption = this.captionOf(t.caption);
    const title = toWinAnsi(t.title);

    // With no rows the message stands in for the table, and a footer has nothing to sum up, so it is not drawn.
    if (t.rows.length === 0) {
      const height = this.headingHeight(caption.length) + 28;
      this.ensure(height);
      this.mark(t.title);
      this.heading(title, caption);
      paint(this.ops, roundPath(MARGIN, this.y, PRINT_W, 24, 4), { fill: PALETTE.neutralBg, stroke: PALETTE.border });
      const empty = fitText(toWinAnsi(t.empty ?? NOTHING_TO_LIST), 'regular', BODY_SIZE, PRINT_W - 2 * PAD - 8);
      text(this.ops, empty, MARGIN + PAD + 4, centred(this.y, 24, BODY_SIZE), 'regular', BODY_SIZE, PALETTE.neutralText);
      this.y += 24 + SECTION_GAP;
      return;
    }

    const cols = columnBoxes(t).map((box, i) => ({ c: t.columns[i]!, ...box, align: alignOf(t.columns[i]!) }));
    const headers = cols.map((c) => wrapMax(toWinAnsi(c.c.header), 'bold', BODY_SIZE, c.w - 2 * PAD, 2, wrapWords));
    const headerH = Math.max(...headers.map((h) => h.length), 1) > 1 ? 28 : 20;
    const again = toWinAnsi(`${t.title} (continued)`);
    const units = [...t.rows.map((cells) => ({ cells, footer: false })), ...(t.footer ? [{ cells: t.footer, footer: true }] : [])];

    let firstRows = Math.min(units.length, 2);
    if (units.length - firstRows === 1) firstRows = units.length;
    this.ensure(this.headingHeight(caption.length) + headerH + firstRows * ROW_H);
    this.mark(t.title);
    this.heading(title, caption);

    for (let i = 0; i < units.length; ) {
      if (i > 0) {
        this.newPage();
        this.heading(again, [], true);
      }
      this.headerRow(cols, headers, headerH);
      const left = units.length - i;
      let fit = Math.min(left, Math.floor(this.room / ROW_H));
      if (fit < left && left - fit === 1 && fit > 2) fit--;
      for (let k = 0; k < fit; k++, i++) {
        const u = units[i]!;
        this.bodyRow(cols, u.cells, u.footer, i);
      }
    }
    this.y += SECTION_GAP;
  }

  private headerRow(cols: ColLayout[], headers: WinAnsiText[][], height: number): void {
    const ops = this.ops;
    fillRect(ops, MARGIN, this.y, PRINT_W, height, PALETTE.primary);
    cols.forEach((col, i) => {
      const lines = headers[i]!;
      const first = this.y + height / 2 - ((lines.length - 1) * 10.5) / 2 + BODY_SIZE * 0.36;
      lines.forEach((l, j) => {
        const tx = col.align === 'right' ? col.x + col.w - PAD : col.align === 'center' ? col.x + col.w / 2 : col.x + PAD;
        text(ops, l, tx, first + j * 10.5, 'bold', BODY_SIZE, PALETTE.surface, col.align);
      });
    });
    this.y += height;
  }

  private bodyRow(cols: ColLayout[], cells: Cell[], footer: boolean, index: number): void {
    const ops = this.ops;
    const top = this.y;
    if (footer) fillRect(ops, MARGIN, top, PRINT_W, ROW_H, PALETTE.tint);
    else if (index % 2 === 1) fillRect(ops, MARGIN, top, PRINT_W, ROW_H, PALETTE.surface2);
    line(ops, MARGIN, top + ROW_H, RIGHT, top + ROW_H, footer ? PALETTE.tintLine : PALETTE.border, 0.5);
    cols.forEach((col, i) => {
      const cell = cells[i];
      if (cell?.text) this.cell(col, cell, top, footer);
    });
    this.y += ROW_H;
  }

  private cell(col: ColLayout, cell: Cell, top: number, footer: boolean): void {
    const ops = this.ops;
    const tone = TONES[cell.tone ?? 'none'];
    if (col.align === 'center') {
      const label = fitText(toWinAnsi(cell.text), 'bold', PILL_SIZE, col.w - 2 * PAD - PILL_PAD);
      const w = textWidth(label, 'bold', PILL_SIZE) + PILL_PAD;
      const px = col.x + (col.w - w) / 2;
      paint(ops, roundPath(px, top + 2.25, w, 11.5, 5.75), { fill: tone.bg, stroke: tone.line });
      text(ops, label, col.x + col.w / 2, centred(top, ROW_H, PILL_SIZE), 'bold', PILL_SIZE, tone.text, 'center');
      return;
    }
    const face = bodyFace(cell, footer);
    const label = fitText(toWinAnsi(cell.text), face, BODY_SIZE, col.w - 2 * PAD);
    const tx = col.align === 'right' ? col.x + col.w - PAD : col.x + PAD;
    text(ops, label, tx, centred(top, ROW_H, BODY_SIZE), face, BODY_SIZE, tone.text, col.align);
  }

  /**
   * A section stays on one page when it fits on one: it moves whole to the
   * next page rather than start in the space left. Only a section longer than
   * a page splits, and then never with fewer than two lines on either side,
   * nor with one line of a paragraph stranded at the foot or the head.
   */
  notes(list: Note[]): void {
    for (const note of list) {
      const paragraphs = note.lines.map((l) => wrapParagraph(toWinAnsi(l), 'regular', BODY_SIZE, NOTE_W)).filter((p) => p.length);
      const lines = paragraphs.flat();
      const total = lines.length;
      const starts: number[] = [];
      const ends: number[] = [];
      for (const p of paragraphs) {
        const at = starts.length;
        for (let i = 0; i < p.length; i++) {
          starts.push(at);
          ends.push(at + p.length);
        }
      }
      /** Paragraph ends among the first k lines, so the height of any run of lines is a subtraction, not a scan. */
      const endsBefore = [0];
      for (let j = 0; j < total; j++) endsBefore.push(endsBefore[j]! + (ends[j] === j + 1 ? 1 : 0));
      /** Height of lines [from, to): a gap after each paragraph that ends inside, none after the last line. */
      const span = (from: number, to: number) => (to <= from ? 0 : (to - from) * NOTE_LINE + (endsBefore[to - 1]! - endsBefore[from]!) * PARA_GAP);
      /** Whether lines [from, to) may end a page with the rest on the next. */
      const canBreak = (from: number, to: number) =>
        to === total ||
        (to - from >= 2 && total - to >= 2 && (ends[to - 1] === to || (to - starts[to - 1]! >= 2 && ends[to - 1]! - to >= 2)));

      const whole = NOTE_HEAD + span(0, total);
      if (whole > this.room && whole <= CONTENT_BOTTOM - NEXT_TOP && this.y > this.pageTop) this.newPage();

      let from = 0;
      let first = true;
      while (first || from < total) {
        const lead = first ? NOTE_HEAD : 0;
        // A run only gets taller as it takes lines, so bisect for the longest that fits, then back up to where a page may end.
        let fitting = from;
        for (let hi = total; fitting < hi; ) {
          const mid = Math.ceil((fitting + hi) / 2);
          if (lead + span(from, mid) <= this.room) fitting = mid;
          else hi = mid - 1;
        }
        let to = fitting;
        while (to > from && !canBreak(from, to)) to--;
        if (to === from && from < total) {
          if (this.y > this.pageTop) {
            this.newPage();
            continue;
          }
          to = from + 1;
        }
        if (first) {
          this.mark(note.heading);
          text(this.ops, fitText(toWinAnsi(note.heading), 'bold', 10, PRINT_W), MARGIN, this.y + 11, 'bold', 10, PALETTE.primary);
          this.y += NOTE_HEAD;
        }
        for (let j = from; j < to; j++) {
          text(this.ops, lines[j]!, MARGIN, this.y + 8, 'regular', BODY_SIZE, PALETTE.text);
          this.y += NOTE_LINE + (ends[j] === j + 1 ? PARA_GAP : 0);
        }
        from = to;
        first = false;
        if (from < total) this.newPage();
      }
      this.y += NOTE_GAP;
    }
  }

  /** Header band or running header first and the footer last, so text reads in page order. */
  frame(logo: { width: number; height: number }): void {
    const { doc } = this;
    const title = toWinAnsi(doc.title);
    const subtitle = toWinAnsi(doc.subtitle);
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      const head: Op[] = [];
      const foot: Op[] = [];
      if (i === 0) this.band(head, title, subtitle, logo);
      else {
        const running = fitText(title, 'bold', 9, PRINT_W);
        const subtitleX = MARGIN + textWidth(running, 'bold', 9) + 8;
        text(head, running, MARGIN, 44, 'bold', 9, PALETTE.primaryStrong);
        text(head, fitText(subtitle, 'regular', 9, RIGHT - subtitleX), subtitleX, 44, 'regular', 9, PALETTE.muted);
        line(head, MARGIN, RUNNING_RULE, RIGHT, RUNNING_RULE, PALETTE.border, 0.75);
      }
      line(foot, MARGIN, FOOTER_RULE, RIGHT, FOOTER_RULE, PALETTE.border, 0.75);
      const pageLabel = toWinAnsi(`Page ${i + 1} of ${total}`);
      const room = PRINT_W - textWidth(pageLabel, 'regular', 8) - 24;
      text(foot, fitText(toWinAnsi(doc.footer), 'regular', 8, room), MARGIN, FOOTER_BASE, 'regular', 8, PALETTE.muted);
      text(foot, pageLabel, RIGHT, FOOTER_BASE, 'regular', 8, PALETTE.muted, 'right');
      page.ops = [...head, ...page.ops, ...foot];
    });
  }

  private band(ops: Op[], title: WinAnsiText, subtitle: WinAnsiText, logo: { width: number; height: number }): void {
    const { doc } = this;
    const stripe = 3;
    fillRect(ops, 0, 0, PAGE_W, BAND_H, PALETTE.chrome);
    fillRect(ops, 0, BAND_H - stripe, PAGE_W, stripe, PALETTE.mid);
    const inner = BAND_H - stripe;

    const logoH = 24;
    const logoW = (logoH * logo.width) / logo.height;
    const plateW = logoW + 16;
    paint(ops, roundPath(MARGIN, (inner - 40) / 2, plateW, 40, 6), { fill: PALETTE.surface });
    ops.push(`q ${n(logoW)} 0 0 ${n(logoH)} ${n(MARGIN + 8)} ${n(PAGE_H - (inner - logoH) / 2 - logoH)} cm /Im1 Do Q`);

    const soft = toWhite(PALETTE.chrome, 0.8);
    const side = [
      ...wrapMax(toWinAnsi(doc.period), 'regular', BODY_SIZE, 330, 2),
      ...wrapMax(toWinAnsi(doc.generated), 'regular', BODY_SIZE, 330, 1),
    ];
    const sideW = Math.max(...side.map((l) => textWidth(l, 'regular', BODY_SIZE)), 0);
    const first = (inner - side.length * 11.5) / 2 + 8.5;
    side.forEach((l, i) => text(ops, l, RIGHT, first + i * 11.5, 'regular', BODY_SIZE, soft, 'right'));

    const tx = MARGIN + plateW + 18;
    const room = RIGHT - sideW - 24 - tx;
    text(ops, fitText(title, 'bold', 20, room), tx, 34, 'bold', 20, PALETTE.surface);
    text(ops, fitText(subtitle, 'regular', 11, room), tx, 52, 'regular', 11, soft);
  }
}

interface ColLayout {
  c: Column;
  x: number;
  w: number;
  align: Align;
}

function alignOf(c: Column): Align {
  return c.kind === 'text' ? 'left' : c.kind === 'status' ? 'center' : 'right';
}

/** Bold for a footer or a missed figure, which is how a cell is drawn and so how it is measured. */
const bodyFace = (cell: Cell, footer: boolean): FontFace => (footer || cell.tone === 'bad' ? 'bold' : 'regular');

/**
 * The narrowest a column may be: its longest header word, and for figures and
 * status pills its longest value, so neither wraps mid-word nor gets cut. The
 * extra point keeps rounding from tipping a word over the edge.
 */
function columnFloor(col: Column, cells: { cell: Cell | undefined; footer: boolean }[]): number {
  const headerWords = toWinAnsi(col.header).split(' ').map((w) => textWidth(w as WinAnsiText, 'bold', BODY_SIZE));
  let widest = Math.max(0, ...headerWords);
  if (col.kind !== 'text') {
    for (const { cell, footer } of cells) {
      if (!cell?.text) continue;
      const label = toWinAnsi(cell.text);
      const w = col.kind === 'status' ? textWidth(label, 'bold', PILL_SIZE) + PILL_PAD : textWidth(label, bodyFace(cell, footer), BODY_SIZE);
      widest = Math.max(widest, w);
    }
  }
  return Math.min(Math.ceil(widest) + 2 * PAD + 1, MAX_FLOOR);
}

/**
 * Splits `total` by weight once every floor is met: a column whose share falls
 * under its floor is pinned at the floor and the others share what is left.
 * Floors that cannot all be met scale down together, the last resort.
 */
function shareWidths(weights: number[], floors: number[], total: number): number[] {
  const floorSum = floors.reduce((s, f) => s + f, 0);
  if (floorSum >= total) return floors.map((f) => (f * total) / floorSum);
  const pinned = floors.map(() => false);
  for (;;) {
    const live = floors.flatMap((_, i) => (pinned[i] ? [] : [i]));
    const left = total - floors.reduce((s, f, i) => s + (pinned[i] ? f : 0), 0);
    const weightSum = live.reduce((s, i) => s + weights[i]!, 0);
    const share = (i: number) => (weightSum > 0 ? (weights[i]! / weightSum) * left : left / live.length);
    const low = live.filter((i) => share(i) < floors[i]!);
    if (!low.length) return floors.map((f, i) => (pinned[i] ? f : share(i)));
    for (const i of low) pinned[i] = true;
  }
}

/**
 * What a text column would like: room for its longest value. Weights are a
 * guess made before any real name was seen, and a name cut to an ellipsis loses
 * what the reader came for, so the widths are corrected against the content.
 */
function columnWant(col: Column, cells: { cell: Cell | undefined; footer: boolean }[]): number | null {
  if (col.kind !== 'text') return null;
  let widest = 0;
  for (const { cell, footer } of cells) {
    if (cell?.text) widest = Math.max(widest, textWidth(toWinAnsi(cell.text), bodyFace(cell, footer), BODY_SIZE));
  }
  return Math.min(Math.ceil(widest) + 2 * PAD + 1, MAX_WANT);
}

/** The narrowest a header may get without wrapping to more lines than it does at width `w`. */
function headerKeep(header: string, w: number, floor: number): number {
  if (w <= floor) return floor;
  const text = toWinAnsi(header);
  const lines = (width: number) => wrapWords(text, 'bold', BODY_SIZE, width - 2 * PAD).length;
  const target = lines(w);
  if (lines(floor) <= target) return floor;
  let lo = floor;
  let hi = w;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (lines(mid) <= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Moves width from columns that have more than their content needs to columns
 * that have less. The smallest shortfalls are met first, so a name that nearly
 * fits is not left cut because one column with an outlier asked for a lot. A
 * donor keeps at least `keeps`, so it never loses a header line or a figure it
 * has now, and gives in proportion to what it can spare. The total never changes.
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

/** The left edge and width of each column of `t`, in points; together they span the printable width exactly. */
export function columnBoxes(t: Table): { x: number; w: number }[] {
  const rows = [...t.rows.map((cells) => ({ cells, footer: false })), ...(t.footer ? [{ cells: t.footer, footer: true }] : [])];
  const column = (i: number) => rows.map((r) => ({ cell: r.cells[i], footer: r.footer }));
  const floors = t.columns.map((c, i) => columnFloor(c, column(i)));
  const wants = t.columns.map((c, i) => columnWant(c, column(i)));
  const weights = t.columns.map((c) => (Number.isFinite(c.weight) && c.weight > 0 ? c.weight : 0));
  const shared = shareWidths(weights, floors, PRINT_W);
  const keeps = t.columns.map((c, i) =>
    Math.max(floors[i]!, wants[i] ?? 0, headerKeep(c.header, shared[i]!, floors[i]!)),
  );
  const widths = fitToContent(shared, keeps, wants);
  let x = MARGIN;
  return widths.map((w, i) => {
    const box = { x, w: i === widths.length - 1 ? RIGHT - x : w };
    x += w;
    return box;
  });
}

/** Object bodies by number, written out in order with an exact cross-reference table. */
class Objects {
  private readonly bodies: Buffer[] = [];

  reserve(count = 1): number {
    const first = this.bodies.length + 1;
    for (let i = 0; i < count; i++) this.bodies.push(Buffer.alloc(0));
    return first;
  }

  set(id: number, body: string | Buffer): void {
    this.bodies[id - 1] = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
  }

  stream(id: number, dict: string, data: Buffer): void {
    const head = Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1');
    this.set(id, Buffer.concat([head, data, Buffer.from('\nendstream', 'latin1')]));
  }

  write(root: number, info: number): Buffer {
    const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let size = parts[0]!.length;
    const offsets: number[] = [];
    this.bodies.forEach((body, i) => {
      offsets.push(size);
      const wrapped = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
      parts.push(wrapped);
      size += wrapped.length;
    });
    const refs = offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    const xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${refs}`;
    parts.push(Buffer.from(xref, 'latin1'));
    const id = createHash('md5').update(Buffer.concat(parts)).digest('hex');
    const trailer = `trailer\n<< /Size ${offsets.length + 1} /Root ${root} 0 R /Info ${info} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${size}\n%%EOF\n`;
    parts.push(Buffer.from(trailer, 'latin1'));
    return Buffer.concat(parts);
  }
}

const pdfDate = (d: Date) => `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;

function fontDict(base: string, face: FontFace): string {
  const widths = fontWidths(face).join(' ');
  return `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 255 /Widths [${widths}] >>`;
}

interface Logo {
  width: number;
  height: number;
  rgb: Buffer;
  alpha: Buffer | null;
}

let logoCache: Logo | undefined;

/** Decoded and compressed once: the same logo goes into every report. */
function logoImage(): Logo {
  if (!logoCache) {
    const px = decodePng(Buffer.from(LOGO_PNG_BASE64, 'base64'));
    logoCache = {
      width: px.width,
      height: px.height,
      rgb: deflateSync(px.rgb, { level: 9 }),
      alpha: px.alpha && deflateSync(px.alpha, { level: 9 }),
    };
  }
  return logoCache;
}

export function buildPdf(doc: ReportDoc, now: Date = new Date()): Buffer {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new RangeError('The report time is not a valid date.');
  const layout = new Layout(doc);
  layout.kpis(doc.kpis);
  layout.chart(doc.chart);
  for (const t of doc.tables) layout.table(t);
  layout.notes(doc.notes);

  const logo = logoImage();
  layout.frame(logo);

  const o = new Objects();
  const catalog = o.reserve();
  const tree = o.reserve();
  const regular = o.reserve();
  const bold = o.reserve();
  const info = o.reserve();
  const image = o.reserve();
  const mask = logo.alpha ? o.reserve() : 0;
  const outlines = layout.marks.length ? o.reserve() : 0;
  const items = o.reserve(layout.marks.length);
  const firstPage = o.reserve(layout.pages.length * 2);
  const pageId = (i: number) => firstPage + i * 2;

  o.set(regular, fontDict('Helvetica', 'regular'));
  o.set(bold, fontDict('Helvetica-Bold', 'bold'));
  const imageDict = `/Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /BitsPerComponent 8 /Interpolate true`;
  o.stream(image, `${imageDict} /ColorSpace /DeviceRGB /Filter /FlateDecode${mask ? ` /SMask ${mask} 0 R` : ''}`, logo.rgb);
  if (logo.alpha) {
    const dict = `/Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /BitsPerComponent 8`;
    o.stream(mask, `${dict} /ColorSpace /DeviceGray /Filter /FlateDecode`, logo.alpha);
  }

  layout.pages.forEach((page, i) => {
    const content = pageId(i) + 1;
    o.stream(content, '/Filter /FlateDecode', deflateSync(Buffer.from(page.ops.join('\n'), 'latin1'), { level: 9 }));
    const xobjects = i === 0 ? ` /XObject << /Im1 ${image} 0 R >>` : '';
    o.set(
      pageId(i),
      `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${content} 0 R ` +
        `/Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >>${xobjects} >> >>`,
    );
  });
  const kids = layout.pages.map((_, i) => `${pageId(i)} 0 R`).join(' ');
  o.set(tree, `<< /Type /Pages /Kids [${kids}] /Count ${layout.pages.length} >>`);

  if (outlines) {
    o.set(outlines, `<< /Type /Outlines /First ${items} 0 R /Last ${items + layout.marks.length - 1} 0 R /Count ${layout.marks.length} >>`);
    layout.marks.forEach((m, i) => {
      const links = [i > 0 ? `/Prev ${items + i - 1} 0 R` : '', i < layout.marks.length - 1 ? `/Next ${items + i + 1} 0 R` : ''];
      const dest = `[${pageId(m.page)} 0 R /XYZ ${MARGIN} ${n(PAGE_H - m.top + 4)} null]`;
      o.set(items + i, `<< /Title ${textString(m.title)} /Parent ${outlines} 0 R ${links.join(' ')} /Dest ${dest} >>`);
    });
  }

  const title = `${doc.title}, ${doc.subtitle}`;
  o.set(
    info,
    `<< /Title ${textString(title)} /Subject ${textString(doc.period)} /Author (HCML Monitoring Portal) ` +
      `/Creator (HCML Monitoring Portal) /Producer (HCML Monitoring Portal PDF writer) ` +
      `/CreationDate (${pdfDate(now)}) /ModDate (${pdfDate(now)}) >>`,
  );
  o.set(
    catalog,
    `<< /Type /Catalog /Pages ${tree} 0 R /Lang (en-US) /ViewerPreferences << /DisplayDocTitle true >>${outlines ? ` /Outlines ${outlines} 0 R` : ''} >>`,
  );
  return o.write(catalog, info);
}
