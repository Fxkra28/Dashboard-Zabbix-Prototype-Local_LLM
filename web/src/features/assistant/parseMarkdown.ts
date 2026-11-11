/**
 * The tiny slice of markdown the assistant is allowed to write: paragraphs,
 * "- " / "1." lists, headings (shown as bold paragraphs), `code` and **bold**.
 *
 * Framework-free and deliberately narrow. There is no HTML and no links: every
 * leaf is plain text that React escapes, so model output can never inject
 * markup. Inline markers only count when they are closed, which keeps a
 * half-streamed answer ("**11.1 FG-60") readable instead of flickering bold.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'code'; text: string };

export type Block =
  | { type: 'paragraph'; lines: Inline[][]; strong?: boolean }
  | { type: 'ul'; items: Inline[][] }
  | { type: 'ol'; items: Inline[][]; start: number };

const UL = /^\s*[-*•]\s+(.*)$/;
const OL = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING_MARK = /^\s*#{1,6}\s/;

/**
 * The text of a heading line ("## Summary ##" is "Summary"), or null. Read part by part: one pattern with a lazy group and
 * optional trailing spaces took six seconds on 3,200 spaces.
 */
function headingOf(line: string): string | null {
  const mark = HEADING_MARK.exec(line);
  if (!mark) return null;
  const text = line.slice(mark[0].length).trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end--;
  return end === text.length ? text : text.slice(0, end).trimEnd();
}

/**
 * Left to right: a backtick with a closing partner opens a code span (literal
 * content); "**" with a closing partner opens bold, whose content may hold
 * code spans. Anything unclosed stays literal text.
 */
export function parseInline(text: string, allowBold = true): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
  };
  let i = 0;
  while (i < text.length) {
    if (text[i] === '`') {
      const close = text.indexOf('`', i + 1);
      if (close > i + 1) {
        flush();
        out.push({ type: 'code', text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    if (allowBold && text.startsWith('**', i)) {
      const close = text.indexOf('**', i + 2);
      if (close > i + 2) {
        flush();
        out.push({ type: 'bold', children: parseInline(text.slice(i + 2, close), false) });
        i = close + 2;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return out;
}

const inline = (text: string) => parseInline(text.trim());

function merge(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (n.type === 'text' && prev?.type === 'text') out[out.length - 1] = { type: 'text', text: prev.text + n.text };
    else out.push(n);
  }
  return out;
}

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let para: Inline[][] | null = null;
  let list: Extract<Block, { type: 'ul' | 'ol' }> | null = null;

  const endPara = () => {
    if (para?.length) blocks.push({ type: 'paragraph', lines: para });
    para = null;
  };
  const endList = () => {
    if (list?.items.length) blocks.push(list);
    list = null;
  };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    // trimEnd, not a pattern: `\s+$` tries every start in a long run of spaces and takes seconds on 50,000 of them.
    const line = raw.trimEnd();
    if (!line.trim()) {
      endPara();
      endList();
      continue;
    }

    const ul = UL.exec(line);
    const ol = ul ? null : OL.exec(line);
    // "**bold**" at the start of a line is not a "*" bullet.
    if (ul && !/^\s*\*\*/.test(line)) {
      endPara();
      if (list?.type !== 'ul') {
        endList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(inline(ul[1]));
      continue;
    }
    if (ol) {
      endPara();
      if (list?.type !== 'ol') {
        endList();
        list = { type: 'ol', items: [], start: Number(ol[1]) };
      }
      list.items.push(inline(ol[2]));
      continue;
    }

    const heading = headingOf(line);
    if (heading !== null) {
      endPara();
      endList();
      if (heading) blocks.push({ type: 'paragraph', lines: [inline(heading)], strong: true });
      continue;
    }

    // An indented line right after a list item continues that item.
    if (list && /^\s{2,}\S/.test(raw)) {
      const items: Inline[][] = list.items;
      items[items.length - 1] = merge([...items[items.length - 1], { type: 'text', text: ' ' }, ...inline(line)]);
      continue;
    }

    endList();
    (para ??= []).push(inline(line));
  }
  endPara();
  endList();
  return blocks;
}
