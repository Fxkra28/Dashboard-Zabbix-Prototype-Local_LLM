import { describe, expect, it } from 'vitest';
import { ICON_H, ICON_W, labelBox, placeLabels, textWidth, type Box, type LabelItem } from './mapLabels';

const NAME = '1.1 ALPHA-FW01-LONG-NAME-X'; // 25 characters
const item = (id: string, x: number, y: number, extra: Partial<LabelItem> = {}): LabelItem => ({
  id,
  x,
  y,
  lines: [NAME, '(198.18.0.42)'],
  rank: 0,
  badge: false,
  ...extra,
});

const hits = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
const iconOf = (i: LabelItem): Box => ({ x1: i.x, y1: i.y, x2: i.x + ICON_W, y2: i.y + ICON_H });

/** Every visible name's box after placement. */
function boxes(items: LabelItem[]) {
  const placed = placeLabels(items);
  return items.flatMap((i) => {
    const p = placed.get(i.id)!;
    return p.hidden ? [] : [{ id: i.id, box: labelBox(i.x, i.y, i.lines, p.dy)! }];
  });
}

/** Never two names on each other, and never a name on an element's icon. */
function expectClear(items: LabelItem[]) {
  const shown = boxes(items);
  for (let a = 0; a < shown.length; a++) {
    for (let b = a + 1; b < shown.length; b++) {
      expect(hits(shown[a].box, shown[b].box), `${shown[a].id} over ${shown[b].id}`).toBe(false);
    }
    for (const other of items) expect(hits(shown[a].box, iconOf(other)), `${shown[a].id} over the icon of ${other.id}`).toBe(false);
  }
}

describe('placeLabels (FR-18)', () => {
  it('leaves names where they were drawn when nothing is in the way', () => {
    const placed = placeLabels([item('a', 0, 0), item('b', 400, 0), item('c', 0, 200)]);
    expect([...placed.values()]).toEqual([
      { dy: 0, hidden: false },
      { dy: 0, hidden: false },
      { dy: 0, hidden: false },
    ]);
  });

  it('moves one of two names about 100 px apart, which overlapped before, and keeps both', () => {
    const items = [item('a', 0, 100), item('b', 100, 100)];
    // The fixed-offset layout this replaces: both at dy 0, boxes on each other.
    expect(hits(labelBox(0, 100, items[0].lines, 0)!, labelBox(100, 100, items[1].lines, 0)!)).toBe(true);
    const placed = placeLabels(items);
    expect(placed.get('a')).toEqual({ dy: 0, hidden: false });
    expect(placed.get('b')?.hidden).toBe(false);
    expect(placed.get('b')?.dy).not.toBe(0);
    expectClear(items);
  });

  it('keeps the name nearest the element that has a problem, even when a quiet one comes first', () => {
    const items = [item('quiet', 0, 100), item('disaster', 100, 100, { rank: 6, badge: true })];
    const placed = placeLabels(items);
    expect(placed.get('disaster')).toEqual({ dy: 0, hidden: false });
    expect(placed.get('quiet')?.dy).not.toBe(0);
    expectClear(items);
  });

  it('puts the worse problem first when two compete', () => {
    const items = [item('minor', 0, 100, { rank: 3, badge: true }), item('disaster', 100, 100, { rank: 6, badge: true })];
    const placed = placeLabels(items);
    expect(placed.get('disaster')?.dy).toBe(0);
    expect(placed.get('minor')?.dy).not.toBe(0);
  });

  it('does not put a name on the element below it', () => {
    // b sits where a's name would go.
    const items = [item('a', 100, 100), item('b', 100, 140)];
    const placed = placeLabels(items);
    expect(placed.get('a')?.dy).not.toBe(0);
    expectClear(items);
    expect(placed.get('b')?.hidden).toBe(false);
  });

  it('keeps a name off the count badge on its own element', () => {
    // b sits where a's name would go by default, so a's name wants to go above a, where its badge is.
    const below = item('b', 100, 140);
    const quiet = placeLabels([item('a', 100, 100, { rank: 4 }), below]).get('a')!;
    // Without a badge above the element is free, so that is where the name goes.
    expect(quiet.dy).toBeLessThan(0);
    expect(quiet.hidden).toBe(false);

    const withBadge = item('a', 100, 100, { rank: 4, badge: true });
    const placed = placeLabels([withBadge, below]).get('a')!;
    // With one it must not go above: the box above would cover the badge.
    expect(placed.dy).not.toBe(quiet.dy);
    if (!placed.hidden) expect(hits(labelBox(100, 100, withBadge.lines, placed.dy)!, { x1: 137, y1: 91, x2: 155, y2: 109 })).toBe(false);
  });

  it('keeps a clear margin between two names, not just no overlap', () => {
    // The second element is placed so that the names' estimated edges are 1 px apart: closer than the margin.
    const width = textWidth('SW-A-LONG-NAME', 11);
    const placed = placeLabels([
      { id: 'a', x: 0, y: 100, lines: ['SW-A-LONG-NAME'], rank: 0, badge: false },
      { id: 'b', x: width + 1, y: 100, lines: ['SW-A-LONG-NAME'], rank: 0, badge: false },
    ]);
    expect(placed.get('b')).not.toEqual({ dy: 0, hidden: false });
  });

  it('hides a name only when nowhere is free, and the names that stay never overlap', () => {
    // Ten elements within a few pixels of each other: not all of them can be named.
    const items = Array.from({ length: 10 }, (_, i) => item(`e${i}`, 100 + i * 4, 100 + (i % 2) * 3));
    const placed = placeLabels(items);
    const hidden = [...placed.values()].filter((p) => p.hidden).length;
    expect(hidden).toBeGreaterThan(0);
    expect(hidden).toBeLessThan(items.length);
    expectClear(items.filter((i) => !placed.get(i.id)!.hidden));
  });

  it('gives an element with nothing to say no label to place or hide', () => {
    expect(placeLabels([item('hub', 0, 0, { lines: [] })]).get('hub')).toEqual({ dy: 0, hidden: false });
  });

  it('places the same way whatever order the elements arrive in', () => {
    const items = [item('a', 0, 100), item('b', 100, 100), item('c', 200, 100), item('d', 50, 130)];
    const forward = placeLabels(items);
    const backward = placeLabels([...items].reverse());
    for (const i of items) expect(backward.get(i.id)).toEqual(forward.get(i.id));
  });

  it('never overlaps a name with another or with an icon, on a spread of layouts', () => {
    let seed = 7;
    const next = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let round = 0; round < 40; round++) {
      const n = 3 + Math.floor(next() * 14);
      const items = Array.from({ length: n }, (_, i) =>
        item(`e${i}`, Math.round(next() * 500), Math.round(next() * 300), {
          rank: next() < 0.3 ? 1 + Math.floor(next() * 5) : 0,
          badge: next() < 0.3,
          lines: next() < 0.2 ? ['SW01'] : [NAME, '(10.0.0.1)'],
        }),
      );
      expectClear(items);
    }
  });
});

// What the name lines measure when drawn: the widest of Chrome 154 with
// system-ui, Chrome with Arial, and Inter Regular's own advance widths read from the font file. The three names and two
// addresses were measured again, the same way, when the real ones were replaced (SC-47).
const MEASURED: [line: string, size: number, px: number][] = [
  ['1.1 ALPHA-FW01', 11, 87],
  ['ALPHA-FW01-CORE-SWITCH-01', 11, 172.6],
  ['1.1 ALPHA-FW01-LONG-NAME-X', 11, 172.6],
  ['HCML-JKT-DC-CORE-SW-0123', 11, 166.6],
  ['0123456789012345678901234', 11, 167.4],
  ['WWWWWWWWWWWWWWWWWWWWWWWWWW', 11, 278.5],
  ['MMMMMMMMMMMMMMMMMMMMMMMMMM', 11, 254.3],
  ['abcdefghijklmnopqrstuvwxyz', 11, 153.1],
  ['(198.18.0.42)', 10, 63.2],
  ['(198.18.0.142)', 10, 68],
];

describe('how wide a name is estimated to be (FR-18)', () => {
  it.each(MEASURED)('is at least as wide as %s really draws', (line, size, px) => {
    expect(textWidth(line, size)).toBeGreaterThanOrEqual(px);
  });

  it.each(MEASURED)('is not so wide that %s hides names needlessly', (line, size, px) => {
    expect(textWidth(line, size)).toBeLessThanOrEqual(px * 1.1);
  });

  it('counts a character it has no width for as a full em, so it never underestimates', () => {
    expect(textWidth('\u6F22', 10)).toBe(10);
  });

  it('leaves no two names touching on screen at the widths the browser really draws', () => {
    // Two elements with the same name, every few pixels from "on top of each other" to "far apart".
    for (const [line, size, px] of MEASURED.filter(([, s]) => s === 11)) {
      for (let gap = 40; gap <= 320; gap += 3.7) {
        const items = [
          { id: 'a', x: 0, y: 100, lines: [line], rank: 0, badge: false },
          { id: 'b', x: gap, y: 100, lines: [line], rank: 0, badge: false },
        ];
        const placed = placeLabels(items);
        // The name as the browser draws it: the measured width about the element's centre, at the placed height.
        const drawnAt = (i: (typeof items)[number]): Box => {
          const base = i.y + 46 + placed.get(i.id)!.dy;
          return { x1: i.x + ICON_W / 2 - px / 2, x2: i.x + ICON_W / 2 + px / 2, y1: base - size * 0.8, y2: base + size * 0.25 };
        };
        const shown = items.filter((i) => !placed.get(i.id)!.hidden);
        if (shown.length === 2) expect(hits(drawnAt(shown[0]), drawnAt(shown[1])), `${line} ${gap} px apart`).toBe(false);
      }
    }
  });
});
