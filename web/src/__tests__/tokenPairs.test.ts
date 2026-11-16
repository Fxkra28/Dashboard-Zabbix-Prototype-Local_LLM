import { describe, expect, it } from 'vitest';
// The checker is plain JavaScript, which is why it can run in the build with no step before it.
// @ts-expect-error no type declarations for the .mjs
import { PAIRS, checkContrast, parseTokens } from '../../scripts/tokens.check.mjs';
import { stylesheet } from './stylesheet';

/**
 * The colour pairs the interface puts together, as web/scripts/tokens.check.mjs computes them from the stylesheet (UX-39):
 * status words on the planes a table row takes when it is hovered or selected, and the target beside a service's figure.
 */

const pairs = PAIRS as [string, string, number][];
const has = (fg: string, bg: string) => pairs.some(([f, b, min]) => f === fg && b === bg && min === 4.5);

describe('the pairs the checker computes', () => {
  it.each(['--good-text', '--warn-text', '--danger-text'])('include %s on the page plane, the hover plane and the selected plane', (fg) => {
    for (const plane of ['--bg', '--surface-2', '--tint']) expect(has(fg, plane), `${fg} on ${plane}`).toBe(true);
  });

  it('include the muted text on the chip of each verdict, where the target of a service is written', () => {
    for (const chip of ['--good-bg', '--warn-bg', '--danger-bg']) expect(has('--muted', chip), `--muted on ${chip}`).toBe(true);
  });
});

describe('the shipped tokens', () => {
  it('clear every pair, in the light theme and in both dark selectors', () => {
    // As the checker reads it: with each comment blanked, so that a selector is not taken to start inside one.
    const blocks = parseTokens(stylesheet.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')));
    expect(blocks.size).toBeGreaterThanOrEqual(3);
    expect(checkContrast(blocks)).toEqual([]);
  });
});

describe('the target beside a service’s figure', () => {
  const rule = /\.svc-sla em\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? '';

  it('has a colour of its own, and is not the figure’s colour faded by opacity, which no pair of tokens can describe', () => {
    expect(rule).not.toBe('');
    expect(rule).not.toMatch(/opacity/);
    expect(rule).toMatch(/color:\s*var\(--muted\)/);
  });
});

// UX-54: the asterisk was drawn at opacity 0.7, which the pairs the checker computes cannot see: about 3.1 to 1 in a Met pill in the light theme.
describe('the asterisk that marks a figure measured on partial data', () => {
  const rule = /\.sli-partial\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? '';

  it('is drawn at full strength, in the pill’s own colour, and not faded by opacity', () => {
    expect(rule).not.toBe('');
    expect(rule).not.toMatch(/opacity/);
    expect(rule).not.toMatch(/\bcolor:/);
  });

  it('therefore sits in the pairs the checker does compute: the pill’s status word on the pill’s chip', () => {
    for (const status of ['good', 'danger']) expect(has(`--${status}-text`, `--${status}-bg`), `--${status}-text on --${status}-bg`).toBe(true);
  });
});


// UX-59: the count in a Status button of the Network page was drawn at opacity 0.75, about 3.6 to 1 in both themes, and no pair of tokens describes it.
describe('the count inside a segmented button', () => {
  const rule = /\.seg-count\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? '';

  it('has a colour of its own and is not faded by opacity', () => {
    expect(rule).not.toBe('');
    expect(rule).not.toMatch(/opacity/);
    expect(rule).toMatch(/color:\s*var\(--muted\)/);
  });

  it('therefore sits in the pairs the checker does compute: the muted text on the plane the buttons are drawn on', () => {
    expect(has('--muted', '--surface')).toBe(true);
  });
});

// UX-51: the room kept under the sticky bar was a fixed 72 px, and the bar wraps taller than that on a narrow window and at high zoom.
describe('the room the page keeps under the sticky top bar', () => {
  const rule = /\bhtml\s*\{([^}]*scroll-padding-top[^}]*)\}/.exec(stylesheet)?.[1] ?? '';

  it('is the bar’s measured height, not a fixed number of pixels', () => {
    expect(rule).not.toBe('');
    expect(rule).toMatch(/scroll-padding-top:\s*calc\(var\(--topbar-h,\s*64px\)\s*\+\s*var\(--s-2\)\)/);
    expect(rule).not.toMatch(/scroll-padding-top:\s*\d+px/);
  });

  it('starts from the 64px floor of the bar, so the room is right before the bar has been measured', () => {
    expect(/\.topbar\s*\{[^}]*min-height:\s*64px/.test(stylesheet)).toBe(true);
  });
});
