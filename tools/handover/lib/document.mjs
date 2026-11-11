/**
 * Reads one handbook page, renders its generated blocks, and keeps the one managed field (the reading time in the box at
 * the top). The build writes what this returns; the checker compares it with what is on disk.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { joinBlocks, proseOf, splitBlocks } from './blocks.mjs';
import { readingMinutes, renderCard, renderFiles, renderSnippet, renderSymbols, renderTestsMap, renderTree, resolveSnippet } from './render.mjs';

export const HANDOVER_DIR = 'docs/handover';

/** Every Markdown file of the handbook, as sorted posix paths from the repository root. */
export function listPages(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.md')) out.push(rel);
    }
  };
  walk(HANDOVER_DIR);
  return out.sort();
}

export const isHandbook = (root) => {
  try {
    return statSync(join(root, HANDOVER_DIR)).isDirectory();
  } catch {
    return false;
  }
};

/** The box under the title: who the page is for, how long it takes, what to read before and after. Null when it is missing. */
export function boxOf(text) {
  const lines = text.split('\n');
  const h1 = lines.findIndex((l) => /^# /.test(l));
  if (h1 < 0) return null;
  for (let i = h1 + 1; i < Math.min(lines.length, h1 + 8); i++) {
    if (!/^\| Who it is for \| Reading time \| Read first \| Read next \|\s*$/.test(lines[i])) continue;
    if (!/^\|[-| ]+\|\s*$/.test(lines[i + 1] ?? '')) return null;
    const row = (lines[i + 2] ?? '').trim();
    if (!/^\|.*\|$/.test(row)) return null;
    const cells = row.slice(1, -1).split('|').map((c) => c.trim());
    if (cells.length !== 4) return null;
    return { line: i + 3, who: cells[0], time: cells[1], first: cells[2], next: cells[3], cells };
  }
  return null;
}

/** The reading time of a page, counting its prose and the code it quotes, with the box's own time left out of the count. */
export function readingTime(text) {
  const box = boxOf(text);
  const lines = text.split('\n');
  if (box) lines[box.line - 1] = lines[box.line - 1].replace(box.cells[1], 'about 0 min');
  const body = lines.join('\n');
  const parts = splitBlocks(body);
  const fenced = parts.filter((p) => p.type === 'text').reduce((n, p) => n + (p.text.match(/^ {0,3}(?:`{3,}|~{3,})[^\n]*\n([\s\S]*?)^ {0,3}(?:`{3,}|~{3,})/gm) ?? []).reduce((m, f) => m + f.split('\n').length - 2, 0), 0);
  const quoted = parts.filter((p) => p.type === 'block' && p.kind === 'snippet').reduce((n, p) => n + Math.max(0, p.body.split('\n').length - 4), 0);
  return readingMinutes(proseOf(body), fenced + quoted);
}

/**
 * Renders every generated block of `text` and sets the reading time. `fill` writes the review hash into a snippet that has
 * none; `accept` replaces a hash that differs, which is the statement that the explanation beside it was read again.
 * Returns the new text and, for each snippet whose explanation was written against other code, a problem.
 */
export function processDocument(model, root, docRel, text, { fill = true, accept = false } = {}) {
  const problems = [];
  const parts = splitBlocks(text);
  const next = joinBlocks(parts, (block) => {
    const { kind, target, options } = block;
    try {
      if (kind === 'card') return { body: renderCard(model, target) };
      if (kind === 'files') return { body: renderFiles(model, target, docRel, block.body) };
      if (kind === 'tree') return { body: renderTree(root, target, { depth: Number(options.depth ?? 1), files: options.files ?? 'no' }) };
      if (kind === 'symbols') return { body: renderSymbols(model) };
      if (kind === 'testsmap') return { body: renderTestsMap(model) };
      if (kind === 'snippet') {
        const { sha } = resolveSnippet(model, target, options);
        const body = renderSnippet(model, target, options);
        if (!options.sha) return { body, options: fill ? { ...options, sha } : options };
        if (options.sha !== sha) {
          if (accept) return { body, options: { ...options, sha } };
          problems.push({ line: block.line, kind: 'review', message: `${target}: the explanation was written against ${options.sha}, the code is now ${sha}. Read the explanation again, then run: node tools/handover/build.mjs --accept ${docRel}` });
        }
        return { body };
      }
      problems.push({ line: block.line, kind: 'block', message: `unknown generated block: gen:${kind}` });
    } catch (err) {
      problems.push({ line: block.line, kind: 'block', message: `gen:${kind} ${target}: ${err.message}` });
    }
    return { body: block.body };
  });
  return { text: setReadingTime(next), problems };
}

function setReadingTime(text) {
  const box = boxOf(text);
  if (!box) return text;
  const wanted = `about ${readingTime(text)} min`;
  if (box.cells[1] === wanted) return text;
  const lines = text.split('\n');
  const cells = [...box.cells];
  cells[1] = wanted;
  lines[box.line - 1] = `| ${cells.join(' | ')} |`;
  return lines.join('\n');
}

export const readPage = (root, rel) => readFileSync(join(root, rel), 'utf8');
