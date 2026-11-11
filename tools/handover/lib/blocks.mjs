/**
 * The marker syntax of the handbook's generated blocks, and the one function that reads a Markdown file into text and blocks.
 *
 *   <!-- gen:card server/src/core/cache.ts -->
 *   ...whatever the generator wrote...
 *   <!-- /gen -->
 *
 * Everything between the two lines belongs to the generator and is rewritten by `npm run handover:build`. A marker inside
 * a fenced code block outside any block is an example and is left alone, which is how the maintenance page can show one.
 */

const OPEN = /^<!-- gen:(\w+)(?:\s+([^>]*?))?\s*-->\s*$/;
const CLOSE = /^<!-- \/gen -->\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** `a/b.ts#name sha=abc depth=2` -> { target: 'a/b.ts#name', options: { sha: 'abc', depth: '2' } }. */
export function parseArgs(text = '') {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const target = tokens.length && !tokens[0].includes('=') ? tokens.shift() : '';
  const options = {};
  for (const token of tokens) {
    const eq = token.indexOf('=');
    if (eq > 0) options[token.slice(0, eq)] = token.slice(eq + 1);
    else options[token] = 'yes';
  }
  return { target, options };
}

/** The opening line of a block, rebuilt from its parts so a rewrite keeps one spelling. */
export function openLine(kind, target, options) {
  const extra = Object.entries(options).map(([k, v]) => (v === 'yes' ? k : `${k}=${v}`));
  const args = [target, ...extra].filter(Boolean).join(' ');
  return `<!-- gen:${kind}${args ? ` ${args}` : ''} -->`;
}

/**
 * The parts of `text`, in order: `{ type: 'text', text }` for hand-written lines and `{ type: 'block', kind, target,
 * options, body, line }` for each generated block. `body` is the text between the markers, without the final newline.
 */
export function splitBlocks(text) {
  const lines = text.split('\n');
  const parts = [];
  let buffer = [];
  let fence = null;
  const flush = () => {
    if (buffer.length) parts.push({ type: 'text', text: buffer.join('\n') });
    buffer = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (fence) {
      const close = raw.match(FENCE);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length && !raw.slice(close[0].length).trim()) fence = null;
      buffer.push(raw);
      continue;
    }
    const open = raw.match(OPEN);
    if (open) {
      const body = [];
      let j = i + 1;
      while (j < lines.length && !CLOSE.test(lines[j])) body.push(lines[j++]);
      if (j >= lines.length) {
        // No closing marker: keep the rest as text so the checker can say where the block began.
        buffer.push(raw);
        parts.push({ type: 'unclosed', line: i + 1 });
        continue;
      }
      flush();
      const { target, options } = parseArgs(open[2] ?? '');
      parts.push({ type: 'block', kind: open[1], target, options, body: body.join('\n'), line: i + 1 });
      i = j;
      continue;
    }
    const f = raw.match(FENCE);
    if (f) fence = f[1];
    buffer.push(raw);
  }
  flush();
  return parts;
}

/** Joins the parts back into a document. `render(block)` gives the new body of each block. */
export function joinBlocks(parts, render) {
  const out = [];
  for (const part of parts) {
    if (part.type === 'text') out.push(part.text);
    else if (part.type === 'block') {
      const { body, options } = render(part);
      out.push(openLine(part.kind, part.target, options ?? part.options), ...(body === '' ? [] : [body]), '<!-- /gen -->');
    }
  }
  return out.join('\n');
}

/** The text of `markdown` that a reader reads: no generated blocks, no fenced code, no comments. */
export function proseOf(markdown) {
  return splitBlocks(markdown)
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1[`~]*\s*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/** `text` with every line of every generated block (markers included) emptied, so line numbers stay where they were. */
export function maskBlocks(text) {
  const lines = text.split('\n');
  for (const part of splitBlocks(text)) {
    if (part.type !== 'block') continue;
    const length = part.body === '' ? 0 : part.body.split('\n').length;
    for (let i = part.line - 1; i < part.line + 1 + length; i++) lines[i] = '';
  }
  return lines.join('\n');
}
