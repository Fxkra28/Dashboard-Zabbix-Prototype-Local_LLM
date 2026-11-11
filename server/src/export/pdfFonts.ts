/**
 * Text measuring for the PDF writer. The file uses the standard Helvetica and
 * Helvetica-Bold, which no viewer needs embedded, so the writer has to know
 * how wide each character is to right-align, centre, wrap and cut text. The
 * widths are Adobe's core-14 AFM advances, 1000 units to the em, for WinAnsi
 * codes 32 to 255. They were checked against Arial and Arial Bold, which are
 * metric compatible with Helvetica, measured in headless Chrome.
 *
 * Text moves through the writer as WinAnsi text: a string whose every char
 * code is the byte the PDF will draw, so measuring and drawing agree.
 */

/** Text already mapped to WinAnsi bytes; the only kind the measuring functions accept. */
export type WinAnsiText = string & { readonly __winAnsi: true };

export type FontFace = 'regular' | 'bold';

/** The ellipsis glyph, WinAnsi code 0x85. */
export const ELLIPSIS = '\x85' as WinAnsiText;

/** Helvetica advances for WinAnsi codes 32 to 255, 16 to a row. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 350,
  556, 350, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350,
  350, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 350, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

/** Helvetica-Bold advances for WinAnsi codes 32 to 255, 16 to a row. */
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 350,
  556, 350, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350,
  350, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 350, 500, 667,
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
  611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
];

const FIRST_CODE = 32;

/** WinAnsi 0x80 to 0x9F as Unicode; 0 marks the five codes the encoding leaves empty. */
const WIN_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

const CODE_OF = new Map<number, number>();
WIN_HIGH.forEach((u, i) => {
  if (u) CODE_OF.set(u, 0x80 + i);
});

/** Maps text to WinAnsi: accents and curly quotes survive, controls become spaces, the rest becomes "?". */
export function toWinAnsi(s: string): WinAnsiText {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const u = ch.codePointAt(0)!;
    if (u === 9 || u === 10 || u === 13) out += ' ';
    else if ((u >= 32 && u < 127) || (u >= 160 && u <= 255)) out += ch;
    else out += String.fromCharCode(CODE_OF.get(u) ?? 63);
  }
  return out as WinAnsiText;
}

function advance(code: number, face: FontFace): number {
  const table = face === 'bold' ? HELVETICA_BOLD : HELVETICA;
  return table[code - FIRST_CODE] ?? 0;
}

export function textWidth(s: WinAnsiText, face: FontFace, size: number): number {
  let units = 0;
  for (let i = 0; i < s.length; i++) units += advance(s.charCodeAt(i), face);
  return (units * size) / 1000;
}

/** The widths of codes 32 to 255, for the font dictionaries. */
export function fontWidths(face: FontFace): readonly number[] {
  return face === 'bold' ? HELVETICA_BOLD : HELVETICA;
}

/** How many leading characters of `s` fit `maxWidth`; it stops at the first that does not, so a very long string costs what fits. */
function fitCount(s: string, face: FontFace, size: number, maxWidth: number): number {
  let units = 0;
  for (let i = 0; i < s.length; i++) {
    units += advance(s.charCodeAt(i), face);
    if ((units * size) / 1000 > maxWidth) return i;
  }
  return s.length;
}

/** Cuts text to fit, ending in an ellipsis; text that already fits is returned as is. */
export function fitText(s: WinAnsiText, face: FontFace, size: number, maxWidth: number): WinAnsiText {
  if (textWidth(s, face, size) <= maxWidth) return s;
  const room = maxWidth - textWidth(ELLIPSIS, face, size);
  if (room <= 0) return '' as WinAnsiText;
  return (s.slice(0, fitCount(s, face, size, room)).trimEnd() + ELLIPSIS) as WinAnsiText;
}

/** Greedy word wrap on spaces; a word wider than the line is broken by character. */
export function wrapText(s: WinAnsiText, face: FontFace, size: number, maxWidth: number): WinAnsiText[] {
  const lines: string[] = [];
  let line = '';
  const push = (word: string) => {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next as WinAnsiText, face, size) <= maxWidth) {
      line = next;
      return;
    }
    if (line) lines.push(line);
    line = '';
    let rest = word;
    while (rest.length > 1) {
      const fits = fitCount(rest, face, size, maxWidth);
      if (fits === rest.length) break;
      // At least one character goes on a line, even a glyph wider than the line.
      const end = Math.max(fits, 1);
      lines.push(rest.slice(0, end));
      rest = rest.slice(end);
    }
    line = rest;
  };
  for (const word of s.split(' ')) if (word) push(word);
  if (line) lines.push(line);
  return lines as WinAnsiText[];
}

/** Words the line before a one-word last line must keep after lending it one. */
const RUNT_KEEP = 3;

/**
 * Greedy wrap, then a one-word last line borrows the word before it, so a
 * paragraph never ends on a lone word. Once only, from a line that keeps three
 * words, and only if the pair fits; no word is ever split.
 */
export function wrapParagraph(s: WinAnsiText, face: FontFace, size: number, maxWidth: number): WinAnsiText[] {
  const lines = wrapText(s, face, size, maxWidth);
  const last = lines[lines.length - 1];
  if (lines.length < 2 || last!.includes(' ')) return lines;
  const words = lines[lines.length - 2]!.split(' ');
  if (words.length - 1 < RUNT_KEEP) return lines;
  const pair = `${words[words.length - 1]} ${last}` as WinAnsiText;
  if (textWidth(pair, face, size) > maxWidth) return lines;
  return [...lines.slice(0, -2), words.slice(0, -1).join(' ') as WinAnsiText, pair];
}

/** Word wrap that never breaks inside a word: one wider than the line is cut with an ellipsis instead. */
export function wrapWords(s: WinAnsiText, face: FontFace, size: number, maxWidth: number): WinAnsiText[] {
  const lines: WinAnsiText[] = [];
  let line = '' as WinAnsiText;
  for (const raw of s.split(' ')) {
    const word = fitText(raw as WinAnsiText, face, size, maxWidth);
    if (!word) continue;
    const next = (line ? `${line} ${word}` : word) as WinAnsiText;
    if (textWidth(next, face, size) <= maxWidth) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}
