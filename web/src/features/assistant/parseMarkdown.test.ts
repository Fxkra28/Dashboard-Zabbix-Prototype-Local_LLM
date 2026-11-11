import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './parseMarkdown';

/** The headings of an answer. A model can print a very long line, and the page parses what has arrived at every token. */
const headingTexts = (md: string) =>
  parseMarkdown(md).flatMap((b) => (b.type === 'paragraph' && b.strong ? b.lines.map((l) => l.map((i) => ('text' in i ? i.text : '')).join('')) : []));

describe('headings', () => {
  it.each([
    ['## Summary', 'Summary'],
    ['# Summary', 'Summary'],
    ['###### Six', 'Six'],
    ['   ## Indented', 'Indented'],
    ['\t## Tabbed', 'Tabbed'],
    ['### Closed ###', 'Closed'],
    ['### Closed   ##   ', 'Closed'],
    ['## Why C#', 'Why C'],
    ['## A # in the middle', 'A # in the middle'],
    ['##    Wide   gap  inside', 'Wide   gap  inside'],
  ])('read %j as a bold paragraph that says %j', (line, text) => {
    expect(headingTexts(line)).toEqual([text]);
  });

  it.each(['#hashtag', '####### seven marks', 'text # not a heading', '#', ''])('do not read %j as one', (line) => {
    expect(headingTexts(line)).toEqual([]);
  });

  it('end the paragraph before them and the list, as before', () => {
    const blocks = parseMarkdown('Some text\n## Next\n- one\n## Again\nmore');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'ul', 'paragraph', 'paragraph']);
  });

  it('take no more than a few milliseconds on a long run of spaces inside a heading (FR-24)', () => {
    for (const width of [1_600, 6_400, 50_000]) {
      const started = performance.now();
      parseMarkdown(`# a${' '.repeat(width)}b`);
      parseMarkdown(`## ${' '.repeat(width)}`);
      parseMarkdown(`# a${' '.repeat(width)}#${' '.repeat(width)}`);
      expect(performance.now() - started, `${width} spaces`).toBeLessThan(150);
    }
  });
});
