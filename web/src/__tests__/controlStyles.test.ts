import { describe, expect, it } from 'vitest';
// The checker is plain JavaScript, which is why it can run in the build with no step before it.
// @ts-expect-error no type declarations for the .mjs
import { parseTokens } from '../../scripts/tokens.check.mjs';
import { partNames, stylesheet } from './stylesheet';

/**
 * Three small gaps in the styles that an audit found (UX-77), the links in running text that carried no cue but colour (UX-79), and the print rules the sheet did not have (UX-76). jsdom draws
 * no stylesheet, so the rules are read from the files.
 */

/** The declarations of the first rule whose selector list holds `selector` exactly as written. */
function rule(selector: string, from = 0): string {
  const at = stylesheet.indexOf(selector, from);
  if (at < 0) return '';
  const open = stylesheet.indexOf('{', at);
  return stylesheet.slice(open + 1, stylesheet.indexOf('}', open));
}

describe('the time field of the schedule form (UX-77)', () => {
  it('is drawn like the date fields: the 3:1 edge token, the surface, and the height of a control', () => {
    const block = rule("input[type='date'],\ninput[type='datetime-local'],\ninput[type='time']");
    expect(block).toContain('min-height: var(--control-md)');
    expect(block).toContain('border: 1px solid var(--border-strong)');
    expect(block).toContain('background: var(--surface)');
  });

  it('is as tall as a finger where the pointer is one', () => {
    const touch = stylesheet.slice(stylesheet.indexOf('@media (pointer: coarse)'));
    const selectors = touch.slice(0, touch.indexOf('{', touch.indexOf('input[type=')) );
    expect(selectors).toContain("input[type='time']");
  });
});

describe('the text areas of the dialogs (UX-77)', () => {
  it('are on the surface like every other field, in both themes, and not the browser’s white or grey', () => {
    expect(rule('.modal textarea {')).toContain('background: var(--surface)');
  });
});

describe('the dialogs are centred by a class (UX-77)', () => {
  it('does not use :has(), which a browser at the floor the build declares (Chrome 87, Firefox 78, Safari 14) does not know', () => {
    // Comments left out: the rule that replaced it names it.
    expect(stylesheet.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain(':has(');
  });

  it('centres an overlay that carries the class', () => {
    const block = rule('.drawer-overlay.centered {');
    expect(block).toContain('align-items: center');
    expect(block).toContain('justify-content: center');
  });
});

describe('links in a line of text carry a cue besides colour (UX-79)', () => {
  it.each(['.web-failure a {', '.top-host a {', '.meter-title a {'])('%s is underlined', (selector) => {
    const block = rule(selector);
    expect(block).toContain('text-decoration: underline');
    expect(block).not.toContain('text-decoration: none');
  });
});

describe('the print rules (UX-76)', () => {
  const print = stylesheet.slice(stylesheet.indexOf('@media print'));

  it('are the last part of the sheet, after every rule they must override', () => {
    expect(partNames[partNames.length - 1]).toBe('../styles/20-print.css');
    expect(stylesheet.indexOf('@media print')).toBeGreaterThan(stylesheet.indexOf('.sli-scroll {'));
  });

  it('leave out the menu, the top bar and the buttons', () => {
    const hidden = print.slice(print.indexOf('.sidebar,'), print.indexOf('}', print.indexOf('.sidebar,')));
    for (const selector of ['.sidebar', '.topbar', '.skip-link', '.btn']) expect(hidden).toContain(selector);
    expect(hidden).toContain('display: none');
  });

  it('open every box that scrolls, so that a table is printed whole and not as far as it shows', () => {
    const open = print.slice(print.indexOf('.table-wrap,'), print.indexOf('}', print.indexOf('.table-wrap,')));
    for (const selector of ['.table-wrap', '.sli-scroll', '.chart-data-scroll', '.item-picker-list', '.chat-log']) expect(open).toContain(selector);
    expect(open).toContain('max-height: none');
    expect(open).toContain('overflow: visible');
  });

  it('open every box of the sheet that scrolls with a height of its own', () => {
    // A new scroll box in the data of a page must be named in the print block, or it prints cut. The ones left out are not data: the login, the dialogs, the box a question is typed in.
    const scrolls = [...stylesheet.matchAll(/([^{}]+)\{[^{}]*(?:max-height: (?!none|calc)[^;]+;[^{}]*overflow(?:-y)?: auto|overflow(?:-y)?: auto;[^{}]*max-height: (?!none|calc)[^;]+)[^{}]*\}/g)].map((m) => m[1].trim().split('\n').pop()!.trim());
    const open = print.slice(print.indexOf('.table-wrap,'), print.indexOf('}', print.indexOf('.table-wrap,')));
    expect(scrolls.length, `found only ${JSON.stringify(scrolls)}`).toBeGreaterThanOrEqual(4);
    const outsideData = ['.chat-compose textarea'];
    for (const selector of scrolls.filter((s) => !outsideData.some((o) => s.includes(o)))) {
      expect(open, `${selector} scrolls and is not opened for print`).toContain(selector.replace(/,$/, ''));
    }
  });

  // BK-86 follow-up: a print rule written `.btn` has the weight of one class and loses to `a.btn`, which is drawn as a button, so the links that look like buttons stayed on the paper.
  it('leave out the links that are drawn as buttons too, which a plain .btn does not reach', () => {
    const hidden = print.slice(print.indexOf('.sidebar,'), print.indexOf('}', print.indexOf('.sidebar,')));
    expect(hidden).toContain('button.btn');
    expect(hidden).toContain('a.btn');
  });

  it('keep the line that says where a list stands, which a page of the table without it passes for the whole', () => {
    const hidden = print.slice(print.indexOf('.sidebar,'), print.indexOf('}', print.indexOf('.sidebar,')));
    expect(hidden).not.toContain('.pager');
  });

  it('set every token that the dark theme changes, so that no dark value reaches the paper, in the light theme’s own value but for the surfaces made for white paper', () => {
    const blocks = parseTokens(stylesheet.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))) as Map<string, Map<string, string>>;
    const light = blocks.get(':root')!;
    const dark = blocks.get(":root[data-theme='dark']")!;
    const paper = blocks.get(':root:root:root')!;
    for (const token of dark.keys()) expect(paper.has(token), `${token} is changed by the dark theme and not set for print`).toBe(true);
    const surfaces = new Set(['--bg', '--surface', '--surface-2', '--tint', '--border']);
    for (const [token, value] of paper) if (!surfaces.has(token)) expect(value, token).toBe(light.get(token));
  });

  it('draw the chat bubble of the person and the pressed tile of Devices without a coloured fill, which a printer leaves out and takes the white ink with it', () => {
    for (const selector of ['.chat-msg.user', ".type-tile[aria-pressed='true']"]) {
      const block = rule(selector, stylesheet.indexOf('@media print'));
      expect(block, selector).toContain('background: none');
      expect(block, selector).toContain('color: var(--text)');
    }
  });

  it('print in the light colours whichever theme is on screen, with the light theme’s own values', () => {
    const tokens = rule(':root:root:root', stylesheet.indexOf('@media print'));
    expect(tokens).toContain('color-scheme: light');
    expect(tokens).toContain('--bg: #ffffff');
    expect(tokens).toContain('--text: #1b2733');
    expect(tokens).toContain('--muted: #566577');
  });
});
