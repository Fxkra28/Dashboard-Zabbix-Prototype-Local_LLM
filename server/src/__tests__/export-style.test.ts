import { describe, expect, it } from 'vitest';
import { BadRequestError } from '../core/validate.js';
import { DATES, DECIMALS, DEFAULT_STYLE, SEPARATORS, styleKey } from '../core/reportChoices.js';
import { parseStyle } from '../services/sliExport.js';

/**
 * The style of a report: which mark a decimal takes, how a date is written, and what a CSV file puts
 * between its fields. A style changes how a person reads the report, never a figure in it.
 */

describe('the default style', () => {
  it('is the one every report was written in before styles existed', () => {
    expect(DEFAULT_STYLE).toEqual({ decimal: 'dot', date: 'long', separator: 'comma' });
  });

  it('names every choice a person can make, and the default is one of them', () => {
    expect(DECIMALS).toEqual(['dot', 'comma']);
    expect(DATES).toEqual(['long', 'numeric', 'iso']);
    expect(SEPARATORS).toEqual(['comma', 'semicolon']);
    expect(DECIMALS).toContain(DEFAULT_STYLE.decimal);
    expect(DATES).toContain(DEFAULT_STYLE.date);
    expect(SEPARATORS).toContain(DEFAULT_STYLE.separator);
  });
});

describe('styleKey', () => {
  it('is different for every one of the twelve combinations, and the same for the same style', () => {
    const keys = new Set<string>();
    for (const decimal of DECIMALS) {
      for (const date of DATES) {
        for (const separator of SEPARATORS) {
          const style = { decimal, date, separator };
          expect(styleKey(style)).toBe(styleKey({ ...style }));
          keys.add(styleKey(style));
        }
      }
    }
    expect(keys.size).toBe(12);
  });
});

describe('parseStyle', () => {
  it('gives the default style for a request that names none', () => {
    expect(parseStyle({})).toEqual(DEFAULT_STYLE);
    expect(parseStyle({ decimal: undefined, date: undefined, separator: undefined })).toEqual(DEFAULT_STYLE);
  });

  it('is a new object each time, so a caller cannot change the default for the next one', () => {
    const first = parseStyle({});
    first.decimal = 'comma';
    expect(parseStyle({})).toEqual(DEFAULT_STYLE);
    expect(DEFAULT_STYLE.decimal).toBe('dot');
  });

  it.each([
    [{ decimal: 'comma' }, { decimal: 'comma', date: 'long', separator: 'comma' }],
    [{ date: 'numeric' }, { decimal: 'dot', date: 'numeric', separator: 'comma' }],
    [{ date: 'iso' }, { decimal: 'dot', date: 'iso', separator: 'comma' }],
    [{ separator: 'semicolon' }, { decimal: 'dot', date: 'long', separator: 'semicolon' }],
    [
      { decimal: 'comma', date: 'iso', separator: 'semicolon' },
      { decimal: 'comma', date: 'iso', separator: 'semicolon' },
    ],
  ])('reads %j', (query, want) => {
    expect(parseStyle(query)).toEqual(want);
  });

  it.each([
    ['decimal', 'Decimal', 'decimal must be "dot" or "comma".'],
    ['decimal', 'point', 'decimal must be "dot" or "comma".'],
    ['decimal', '', 'decimal must be "dot" or "comma".'],
    ['date', 'short', 'date must be "long", "numeric" or "iso".'],
    ['date', 'ISO', 'date must be "long", "numeric" or "iso".'],
    ['separator', 'tab', 'separator must be "comma" or "semicolon".'],
    ['separator', ';', 'separator must be "comma" or "semicolon".'],
  ])('refuses %s = %j, in words', (key, value, message) => {
    expect(() => parseStyle({ [key]: value })).toThrow(new BadRequestError(message));
  });

  it.each([[['dot', 'comma']], [1], [true], [{}], [null]])('refuses a value that is not a single word: %j', (value) => {
    expect(() => parseStyle({ decimal: value })).toThrow(BadRequestError);
    expect(() => parseStyle({ date: value })).toThrow(BadRequestError);
    expect(() => parseStyle({ separator: value })).toThrow(BadRequestError);
  });

  it('does not take a name the object inherits as a choice', () => {
    expect(() => parseStyle({ decimal: 'constructor' })).toThrow(BadRequestError);
    expect(() => parseStyle({ date: '__proto__' })).toThrow(BadRequestError);
    expect(() => parseStyle({ separator: 'toString' })).toThrow(BadRequestError);
  });
});
