import { describe, expect, it } from 'vitest';
import { stylesheet } from './stylesheet';

/**
 * In forced-colours mode (Windows High Contrast) the browser drops shadows, and the edge of a card, a tile, a dialog and the sign-in
 * box is a shadow: they melted into the page (UX-42). One block gives each of them a line in the system text colour.
 */

/** The body of every block that starts with `prefix`, with the place it starts at. */
function blocks(prefix: string): { at: number; body: string }[] {
  const found: { at: number; body: string }[] = [];
  let from = 0;
  for (;;) {
    const at = stylesheet.indexOf(prefix, from);
    if (at < 0) return found;
    const open = stylesheet.indexOf('{', at);
    let depth = 0;
    let i = open;
    for (; i < stylesheet.length; i++) {
      if (stylesheet[i] === '{') depth++;
      else if (stylesheet[i] === '}' && --depth === 0) break;
    }
    found.push({ at, body: stylesheet.slice(open + 1, i) });
    from = i;
  }
}

const forced = () => blocks('@media (forced-colors: active)');
/** The declarations of the rules in the forced-colours blocks whose selector list names `selector`. */
function declared(selector: string): string[] {
  const out: string[] = [];
  for (const { body } of forced()) {
    for (const [, list, declarations] of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (list!.split(',').some((s) => s.trim() === selector)) out.push(declarations!);
    }
  }
  return out;
}

const SURFACES = ['.panel', '.kpi', '.meter', '.modal', '.drawer', '.login-card'];

describe('the surfaces in forced-colours mode (UX-42)', () => {
  it.each(SURFACES)('gives %s a one-pixel line in the system text colour', (selector) => {
    const rules = declared(selector);
    expect(rules.length, `a forced-colours rule for ${selector}`).toBeGreaterThan(0);
    expect(rules.some((d) => /border:\s*1px solid CanvasText/.test(d))).toBe(true);
  });

  it('comes after the rules that take the edges away, so that it is the one that applies', () => {
    const noEdge = stylesheet.indexOf('/* Surfaces that stand above the page */');
    expect(noEdge).toBeGreaterThan(-1);
    const mine = forced().find(({ body }) => /\.panel\b/.test(body));
    expect(mine, 'a forced-colours block for the surfaces').toBeDefined();
    expect(mine!.at).toBeGreaterThan(noEdge);
  });

  it('asks for nothing outside forced colours: the soft edges stay as they are', () => {
    expect(forced().map((b) => b.body).join('')).not.toMatch(/box-shadow/);
    const ranges = forced().map(({ at, body }) => [at, at + body.length + 40]);
    for (const m of stylesheet.matchAll(/CanvasText/g)) {
      expect(ranges.some(([from, to]) => m.index! > from! && m.index! < to!), `CanvasText at ${m.index}`).toBe(true);
    }
  });
});
