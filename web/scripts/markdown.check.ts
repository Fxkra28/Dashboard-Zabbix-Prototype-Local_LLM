/**
 * Checks for the assistant's markdown parser (src/features/assistant/parseMarkdown.ts).
 * Run from the repo root: ./server/node_modules/.bin/tsx web/scripts/markdown.check.ts
 */
import assert from 'node:assert/strict';
import { parseInline, parseMarkdown, type Block, type Inline } from '../src/features/assistant/parseMarkdown.ts';

const flat = (nodes: Inline[]): string =>
  nodes.map((n) => (n.type === 'bold' ? `<b>${flat(n.children)}</b>` : n.type === 'code' ? `<c>${n.text}</c>` : n.text)).join('');

const show = (blocks: Block[]): string[] =>
  blocks.map((b) =>
    b.type === 'paragraph'
      ? `${b.strong ? 'H' : 'P'}:${b.lines.map(flat).join('|')}`
      : `${b.type.toUpperCase()}:${b.items.map(flat).join('|')}`,
  );

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

check('closed bold', () => {
  assert.equal(flat(parseInline('Ya, **3 perangkat** down')), 'Ya, <b>3 perangkat</b> down');
});

check('unclosed ** stays literal', () => {
  assert.deepEqual(parseInline('host **11.1 FG-60'), [{ type: 'text', text: 'host **11.1 FG-60' }]);
  assert.equal(flat(parseInline('**a** and **b')), '<b>a</b> and **b');
});

check('backticks inside bold', () => {
  assert.equal(flat(parseInline('**run `ping` now**')), '<b>run <c>ping</c> now</b>');
  assert.equal(flat(parseInline('`a**b**c`')), '<c>a**b**c</c>');
  assert.equal(flat(parseInline('unclosed `code')), 'unclosed `code');
});

check('<script> stays literal text, never markup', () => {
  const blocks = parseMarkdown('<script>alert(1)</script> **<img src=x onerror=y>**');
  assert.equal(blocks.length, 1);
  const b = blocks[0];
  assert.equal(b.type, 'paragraph');
  const nodes = (b as Extract<Block, { type: 'paragraph' }>).lines[0];
  assert.deepEqual(nodes[0], { type: 'text', text: '<script>alert(1)</script> ' });
  assert.deepEqual(nodes[1], { type: 'bold', children: [{ type: 'text', text: '<img src=x onerror=y>' }] });
  assert.ok(!JSON.stringify(blocks).includes('href'));
});

check('- * • bullets and 1. / 1) lists', () => {
  assert.deepEqual(show(parseMarkdown('Three sites:\n- **A**\n* B\n• C')), ['P:Three sites:', 'UL:<b>A</b>|B|C']);
  const ol = parseMarkdown('1. one\n2) two');
  assert.deepEqual(show(ol), ['OL:one|two']);
  assert.equal((ol[0] as Extract<Block, { type: 'ol' }>).start, 1);
  assert.deepEqual(show(parseMarkdown('3. three\n4. four')), ['OL:three|four']);
});

check('host names that start with digits are not lists', () => {
  assert.deepEqual(show(parseMarkdown('11.1 FG-60F-MAC-MOPU-1 is down\n2.1. SUB11FW01 too')), [
    'P:11.1 FG-60F-MAC-MOPU-1 is down|2.1. SUB11FW01 too',
  ]);
});

check('headings become bold paragraphs; blank lines split paragraphs', () => {
  assert.deepEqual(show(parseMarkdown('## Summary\nLine one\nline two\n\n\nNext')), [
    'H:Summary',
    'P:Line one|line two',
    'P:Next',
  ]);
});

check('streaming prefixes never throw and settle to the final shape', () => {
  const full = 'Ya, **2 perangkat** di MOPU:\n- **11.1 FG-60F** sejak `2h`\n- 11.2.1 MAC MOPU ACS 01\n\nSelesai.';
  for (let i = 0; i <= full.length; i++) {
    const blocks = parseMarkdown(full.slice(0, i));
    assert.ok(Array.isArray(blocks));
  }
  assert.deepEqual(show(parseMarkdown(full)), [
    'P:Ya, <b>2 perangkat</b> di MOPU:',
    'UL:<b>11.1 FG-60F</b> sejak <c>2h</c>|11.2.1 MAC MOPU ACS 01',
    'P:Selesai.',
  ]);
  // Half-way through a bold marker the text is shown literally, not dropped.
  assert.deepEqual(show(parseMarkdown('Ya, **2 perang')), ['P:Ya, **2 perang']);
  assert.deepEqual(show(parseMarkdown('- ')), ['P:-']);
});

check('trailing hard-break spaces are dropped', () => {
  assert.deepEqual(show(parseMarkdown('- a  \n- b  ')), ['UL:a|b']);
});

console.log(`\n${passed} checks passed`);
