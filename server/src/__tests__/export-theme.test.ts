import { describe, expect, it } from 'vitest';
import { PALETTE, PAPER, TOKEN_OF, TONES, rgb } from '../export/theme.js';
import { webStyles } from './helpers/webStyles.js';

/**
 * The report palette is a copy of the light-theme tokens in web/src/styles/ (01-tokens.css).
 * A copy can drift, so this reads the stylesheet and compares.
 */
const css = webStyles();
const light = css.slice(css.indexOf(':root {'), css.indexOf(":root[data-theme='dark']"));

const token = (name: string) =>
  new RegExp(`${name.replace(/[-]/g, '\\-')}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(light)?.[1]?.toLowerCase();

const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('report palette', () => {
  it.each(Object.entries(TOKEN_OF))('%s equals %s in the stylesheet', (key, name) => {
    expect(token(name), `${name} not found in the light token block`).toBeDefined();
    expect(PALETTE[key as keyof typeof PALETTE]).toBe(token(name));
  });

  it('prints on white paper of its own, where every ink colour clears 4.5:1', () => {
    expect(PALETTE.surface).toBe('#ffffff');
    expect(PAPER.every((key) => !(key in TOKEN_OF))).toBe(true);
    for (const ink of ['text', 'muted', 'primary', 'goodText', 'warnText', 'dangerText', 'neutralText'] as const) {
      expect(contrast(PALETTE[ink], PALETTE.surface), ink).toBeGreaterThanOrEqual(4.5);
      expect(contrast(PALETTE[ink], PALETTE.tint), `${ink} on a light row`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws every tone legibly: text on its own fill clears 4.5:1', () => {
    for (const [tone, c] of Object.entries(TONES)) {
      expect(contrast(c.text, c.bg), tone).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('parses a hex colour into channels', () => {
    expect(rgb('#2b5584')).toEqual([43, 85, 132]);
  });
});
