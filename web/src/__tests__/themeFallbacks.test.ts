import { describe, expect, it } from 'vitest';
// @ts-expect-error no type declarations for the .mjs
import { parseTokens } from '../../scripts/tokens.check.mjs';
import { theme } from '../theme';
import { stylesheet } from './stylesheet';

/**
 * theme.ts holds the light theme's values as fallbacks for a chart drawn without a document. A value that drifts from the tokens shows
 * only there, so nobody sees it: these hold each one to the `:root` block (DC-64).
 */

const TOKEN_OF = {
  primary: '--primary',
  primaryDark: '--primary-strong',
  primaryLight: '--mid',
  bg: '--bg',
  surface: '--surface',
  text: '--text',
  muted: '--muted',
  border: '--border',
  good: '--good',
} as const;

const same = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '');

describe('the canvas fallbacks of theme.ts', () => {
  const light = parseTokens(stylesheet.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))).get(':root') as Map<string, string>;

  it('reads the light block of the stylesheet', () => {
    expect(light?.get('--bg')).toBeTruthy();
  });

  it.each(Object.entries(TOKEN_OF))('keeps %s equal to the light theme’s %s', (key, token) => {
    expect(same(theme[key as keyof typeof TOKEN_OF]), `${key} against ${token}`).toBe(same(light.get(token)!));
  });

  it('names a token for every fallback but the one that repeats the primary colour', () => {
    const unnamed = Object.keys(theme).filter((k) => !(k in TOKEN_OF));
    expect(unnamed).toEqual(['ok']);
    expect(same(theme.ok)).toBe(same(theme.primary));
  });
});
