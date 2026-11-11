/**
 * Where each element's name goes on a map.
 *
 * Zabbix places elements by hand, often 100 px apart, while a name can run to 26 characters, so
 * names drawn at one fixed offset below each element overlapped their neighbours. The map is plain
 * SVG, not a chart, so ECharts' own label layout (`labelLayout.hideOverlap`) is not available to it;
 * this does the same job: measure each name's box, keep a name where it is when nothing is in the
 * way, move it above or a row lower when something is, and leave it out only when nowhere is free.
 * A name left out is still in the element's tooltip.
 */

/** An element's box, as MapCanvas draws it. */
export const ICON_W = 48;
export const ICON_H = 32;

/** Baseline of the first name line below the element, the step to the next line, and the type sizes. */
const BASELINE = 46;
const PITCH = 12;
const SIZES = [11, 10];
/** A name is cut here, with an ellipsis. */
export const MAX_CHARS = 26;
const ASCENT = 0.8;
const DESCENT = 0.25;
/** Room kept clear around every box. */
const GAP = 1;

/**
 * How wide each character is, in em: the advance widths of Inter Regular (the portal's font),
 * rounded up to the next 0.05 so the browser's own rounding and the fallback fonts still fit. One
 * flat share of the type size is too narrow for the capitals and digits host names are made of:
 * "HCML-JKT-DC-CORE-SW-0123" is 0.63 em a character wide, and a flat 0.6 falls short. A character
 * not listed is counted a full em.
 */
const ADVANCE: [number, string][] = [
  [0.25, "'ijl"],
  [0.3, ' !,.:;I'],
  [0.35, '|'],
  [0.4, '()/[\\]frt{}'],
  [0.45, '"'],
  [0.5, '*-1^_`'],
  [0.55, '?Jksxz'],
  [0.6, '7EFLacehnouvy'],
  [0.65, '#$&02345689PRSTXZbdgpq'],
  [0.7, '+<=>ABKVY~'],
  [0.75, 'CDGHU'],
  [0.8, 'NOQ'],
  [0.85, '%w…'],
  [0.9, 'Mm'],
  [1, '@W'],
];
const ADVANCE_OF = new Map(ADVANCE.flatMap(([width, chars]) => [...chars].map((c) => [c, width] as const)));

/** The width a line takes at a type size, in map units. */
export const textWidth = (line: string, size: number) => [...line].reduce((sum, c) => sum + (ADVANCE_OF.get(c) ?? 1), 0) * size;

export type Box = { x1: number; y1: number; x2: number; y2: number };

const hits = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

/** The name line as drawn: cut at MAX_CHARS. */
export const clipLine = (line: string) => (line.length > MAX_CHARS ? `${line.slice(0, MAX_CHARS - 1)}…` : line);

/** At most two lines are drawn: the name and the address. */
const drawn = (lines: string[]) => lines.slice(0, 2).map(clipLine);

/** The box a label takes at (x, y) when shifted `dy` down from its usual place, in map units. */
export function labelBox(x: number, y: number, lines: string[], dy: number): Box | null {
  const shown = drawn(lines);
  if (!shown.length) return null;
  const centre = x + ICON_W / 2;
  const boxes = shown.map((line, i) => {
    const size = SIZES[i] ?? SIZES[SIZES.length - 1];
    const base = y + BASELINE + i * PITCH + dy;
    const half = textWidth(line, size) / 2;
    return { x1: centre - half, y1: base - size * ASCENT, x2: centre + half, y2: base + size * DESCENT };
  });
  return {
    x1: Math.min(...boxes.map((b) => b.x1)) - GAP,
    y1: Math.min(...boxes.map((b) => b.y1)) - GAP,
    x2: Math.max(...boxes.map((b) => b.x2)) + GAP,
    y2: Math.max(...boxes.map((b) => b.y2)) + GAP,
  };
}

export type LabelItem = {
  id: string;
  x: number;
  y: number;
  lines: string[];
  /** Placed first, and so kept nearest its element: an element with a problem outranks one without. */
  rank: number;
  /** Draws the count badge on its top right corner, which a name must not cover. */
  badge: boolean;
};

export type LabelPlacement = { dy: number; hidden: boolean };

/** What a name must keep clear of: the element, and its badge. */
function obstacles(item: LabelItem): Box[] {
  const icon = { x1: item.x - GAP - 1, y1: item.y - GAP - 1, x2: item.x + ICON_W + GAP + 1, y2: item.y + ICON_H + GAP + 1 };
  return item.badge ? [icon, { x1: item.x + 37, y1: item.y - 9, x2: item.x + 55, y2: item.y + 9 }] : [icon];
}

/** The shifts to try, in order: where it is drawn by default, above the element, then a row lower, twice. */
function shifts(lineCount: number): number[] {
  const n = Math.min(lineCount, 2);
  const block = n * PITCH + 2;
  return [0, -(6 + BASELINE + (n - 1) * PITCH), block, 2 * block];
}

/**
 * A place for every name, so that no two names overlap and no name covers an element. Names are
 * placed in rank order (then top to bottom, left to right), each at the first shift that is clear.
 */
export function placeLabels(items: LabelItem[]): Map<string, LabelPlacement> {
  const order = [...items].sort((a, b) => b.rank - a.rank || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const solid = items.flatMap(obstacles);
  const placed: Box[] = [];
  const out = new Map<string, LabelPlacement>();

  for (const item of order) {
    if (!drawn(item.lines).length) {
      out.set(item.id, { dy: 0, hidden: false });
      continue;
    }
    let found: { dy: number; box: Box } | undefined;
    for (const dy of shifts(item.lines.length)) {
      const box = labelBox(item.x, item.y, item.lines, dy);
      if (box && !solid.some((o) => hits(box, o)) && !placed.some((p) => hits(box, p))) {
        found = { dy, box };
        break;
      }
    }
    if (found) placed.push(found.box);
    out.set(item.id, { dy: found?.dy ?? 0, hidden: !found });
  }
  return out;
}
