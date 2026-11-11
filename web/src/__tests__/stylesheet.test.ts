import { describe, expect, it } from 'vitest';
import index from '../styles/index.css?raw';
import { partNames, stylesheet } from './stylesheet';

describe('the stylesheet in parts', () => {
  const imported = [...index.matchAll(/@import '\.\/([^']+)';/g)].map((m) => m[1]);

  it('imports every part, once, in file-name order, which is the cascade order', () => {
    expect(imported).toEqual(partNames.map((name) => name.replace('../styles/', '')));
  });

  it('numbers the parts without a gap or a repeat', () => {
    const numbers = imported.map((name) => Number(name.slice(0, 2)));
    expect(numbers).toEqual(numbers.map((_, i) => i));
  });

  it('keeps the tokens ahead of everything that uses them, and the fonts first', () => {
    expect(imported[0]).toBe('00-fonts.css');
    expect(imported[1]).toBe('01-tokens.css');
    expect(stylesheet.indexOf(':root')).toBeLessThan(stylesheet.indexOf('var(--surface)'));
  });
});
