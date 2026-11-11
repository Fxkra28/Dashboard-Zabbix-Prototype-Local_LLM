import { describe, expect, it } from 'vitest';
import { domainsList, joinAddresses, splitAddresses, wordsList } from './addresses';

/** The small text helpers the email and schedule dialogs share: the box of addresses, and the lists in a sentence. */

describe('splitAddresses', () => {
  it('splits what a person typed on commas, semicolons, spaces and line breaks, in any mix', () => {
    expect(splitAddresses('a@x.org, b@x.org;c@x.org d@x.org\ne@x.org\r\n  f@x.org\tg@x.org')).toEqual(['a@x.org', 'b@x.org', 'c@x.org', 'd@x.org', 'e@x.org', 'f@x.org', 'g@x.org']);
  });

  it('gives an empty list for nothing, for spaces and for separators alone', () => {
    expect(splitAddresses('')).toEqual([]);
    expect(splitAddresses('  \n ')).toEqual([]);
    expect(splitAddresses(' , ; ')).toEqual([]);
  });

  it('keeps an address whole, with its dots, plus signs and hyphens', () => {
    expect(splitAddresses('first.last+tag@mail-server.example.org')).toEqual(['first.last+tag@mail-server.example.org']);
  });

  it('does not judge an address: that is the BFF’s to say', () => {
    expect(splitAddresses('nope, @@, a@')).toEqual(['nope', '@@', 'a@']);
  });
});

describe('joinAddresses', () => {
  it('puts one address on each line, as the boxes show them', () => {
    expect(joinAddresses(['a@x.org', 'b@x.org'])).toBe('a@x.org\nb@x.org');
    expect(joinAddresses([])).toBe('');
  });

  it('is undone by splitAddresses', () => {
    const list = ['a@x.org', 'b@x.org', 'c@x.org'];
    expect(splitAddresses(joinAddresses(list))).toEqual(list);
  });
});

describe('wordsList', () => {
  it('writes none, one, two and three or more the way a sentence does', () => {
    expect(wordsList([])).toBe('');
    expect(wordsList(['the PDF'])).toBe('the PDF');
    expect(wordsList(['the PDF', 'the Excel file'])).toBe('the PDF and the Excel file');
    expect(wordsList(['a', 'b', 'c'])).toBe('a, b and c');
    expect(wordsList(['a', 'b', 'c', 'd'])).toBe('a, b, c and d');
  });
});

describe('domainsList', () => {
  it('writes none, one, two and three or more with "or"', () => {
    expect(domainsList([])).toBe('');
    expect(domainsList(['example.org'])).toBe('example.org');
    expect(domainsList(['example.org', 'hcml.co.id'])).toBe('example.org or hcml.co.id');
    expect(domainsList(['a.org', 'b.org', 'c.org'])).toBe('a.org, b.org or c.org');
  });
});
