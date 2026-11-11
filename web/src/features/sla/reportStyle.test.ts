import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DATE_CHOICES,
  DECIMAL_CHOICES,
  DEFAULT_REPORT_STYLE,
  REPORT_STYLE_KEY,
  SEPARATOR_CHOICES,
  readReportStyle,
  writeReportStyle,
} from './reportStyle';

/**
 * The style a person picked for the report files: kept in the browser, read back with every value checked, and never
 * a reason for the page to fail when the browser will not keep it.
 */

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('the default style', () => {
  it('is what the BFF writes when it is asked for nothing: dots, long dates, commas', () => {
    expect(DEFAULT_REPORT_STYLE).toEqual({ decimal: 'dot', date: 'long', separator: 'comma' });
  });

  it('is what is read when nothing was ever kept', () => {
    expect(readReportStyle()).toEqual(DEFAULT_REPORT_STYLE);
  });

  it('is a new object each time, so changing a read style cannot change the default', () => {
    const style = readReportStyle();
    style.decimal = 'comma';
    expect(readReportStyle().decimal).toBe('dot');
    expect(DEFAULT_REPORT_STYLE.decimal).toBe('dot');
  });
});

describe('keeping a style', () => {
  it('reads back what was written, under the key the portal’s other preferences share a prefix with', () => {
    const style = { decimal: 'comma', date: 'iso', separator: 'semicolon' } as const;
    writeReportStyle(style);
    expect(REPORT_STYLE_KEY).toBe('hcml.report-style');
    expect(localStorage.getItem(REPORT_STYLE_KEY)).toBe(JSON.stringify(style));
    expect(readReportStyle()).toEqual(style);
  });

  it('keeps nothing else: a style with extra fields is stored as the three it has', () => {
    writeReportStyle({ decimal: 'comma', date: 'numeric', separator: 'comma', extra: 'x' } as never);
    expect(JSON.parse(localStorage.getItem(REPORT_STYLE_KEY)!)).toEqual({ decimal: 'comma', date: 'numeric', separator: 'comma' });
  });
});

describe('reading what the browser kept', () => {
  const keep = (value: string) => localStorage.setItem(REPORT_STYLE_KEY, value);

  it.each([
    ['text that is not JSON', 'nope'],
    ['an empty string', ''],
    ['null', 'null'],
    ['a number', '7'],
    ['a list', '["comma","iso","semicolon"]'],
    ['a string', '"comma"'],
    ['an empty object', '{}'],
  ])('falls back to the default for %s', (_what, value) => {
    keep(value);
    expect(readReportStyle()).toEqual(DEFAULT_REPORT_STYLE);
  });

  it('falls back field by field: a value that is not a choice is dropped and the others stay', () => {
    keep('{"decimal":"comma","date":"Tuesday","separator":"semicolon"}');
    expect(readReportStyle()).toEqual({ decimal: 'comma', date: 'long', separator: 'semicolon' });
    keep('{"decimal":1,"date":"iso","separator":null}');
    expect(readReportStyle()).toEqual({ decimal: 'dot', date: 'iso', separator: 'comma' });
  });

  it('does not take a name the object inherits as a choice', () => {
    keep('{"decimal":"constructor","date":"__proto__","separator":"toString"}');
    expect(readReportStyle()).toEqual(DEFAULT_REPORT_STYLE);
  });
});

describe('a browser that will not keep it', () => {
  it('reads the default when the store throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readReportStyle()).toEqual(DEFAULT_REPORT_STYLE);
  });

  it('writes without failing when the store throws, as in a private window', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => writeReportStyle({ decimal: 'comma', date: 'iso', separator: 'semicolon' })).not.toThrow();
  });
});

describe('the choices a person is offered', () => {
  it('are the three the BFF accepts for each setting, in the order the person should meet them', () => {
    expect(DECIMAL_CHOICES.map((c) => c.value)).toEqual(['dot', 'comma']);
    expect(DATE_CHOICES.map((c) => c.value)).toEqual(['long', 'numeric', 'iso']);
    expect(SEPARATOR_CHOICES.map((c) => c.value)).toEqual(['comma', 'semicolon']);
  });

  it('show an example of each, so nobody has to guess what a name means', () => {
    expect(DECIMAL_CHOICES.map((c) => c.label)).toEqual(['Dot, as in 99.38%', 'Comma, as in 99,38%']);
    expect(DATE_CHOICES.map((c) => c.label)).toEqual(['4 Nov 2026', '04/11/2026 (day, month, year)', '2026-11-04 (year, month, day)']);
    expect(SEPARATOR_CHOICES.map((c) => c.label)).toEqual(['Comma', 'Semicolon']);
  });
});
