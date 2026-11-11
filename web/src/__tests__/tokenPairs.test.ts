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
