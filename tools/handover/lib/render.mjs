/**
 * Turns the model into the Markdown that goes between the markers of a generated block.
 *
 * Each renderer is a pure function of the model (and, for a snippet, of the text it quotes), so running the build twice
 * gives the same text and the checker can tell a stale block by rendering it again.
 */
import { readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { snippetHash } from './model.mjs';
import { isNeverListed, isTestFile, OWN_ROOT_DIRS, SKIP_DIRS } from './scope.mjs';

/** Files that exist in one copy only: never listed, so the same page is true in both. */
const ONE_COPY_FILES = new Set(['README_copy.md']);

const CURLY_SINGLE = new RegExp(`[${String.fromCodePoint(0x2018, 0x2019)}]`, 'g');
const CURLY_DOUBLE = new RegExp(`[${String.fromCodePoint(0x201c, 0x201d)}]`, 'g');
const LONG_HEX = /\b[0-9a-f]{32,}\b/gi;
const LONG_DASH = new RegExp(`\\s*[${String.fromCodePoint(0x2013, 0x2014, 0x2015)}]\\s*`, 'g');

/** Someone else's text as a card prints it: straight quotes, a hyphen for a dash, and no digest or token copied from a comment. */
const plain = (text) => String(text).replace(CURLY_SINGLE, "'").replace(CURLY_DOUBLE, '"').replace(LONG_DASH, ' - ').replace(LONG_HEX, 'a digest');

const cell = (text) => plain(text).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const code = (text) => `\`${String(text).replace(/`/g, "'")}\``;

/** `server/src/core/cache.ts` -> `core/cache.ts`: the folder a page of cards is about is already known to its reader. */
export function short(rel) {
  return rel.replace(/^(?:server|web)\/src\//, '');
}

/** The relative link from the Markdown file `fromDoc` to the file `target`, both given from the repository root. */
export function relLink(fromDoc, target) {
  return posix.relative(posix.dirname(fromDoc), target) || '.';
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function list(items, max, format = code) {
  if (!items.length) return 'none';
  const shown = items.slice(0, max).map(format).join(', ');
  return items.length > max ? `${shown}, and ${items.length - max} more` : shown;
}

/** The count line, the table of exports, and the lines that say what the file imports and who imports it. */
export function renderCard(model, rel) {
  const f = model.files.get(rel);
  if (!f) throw new Error(`no such card file: ${rel}`);
  const declared = f.exports.filter((e) => e.kind !== 're-export');
  const out = [];
  const facts = [plural(f.lines, 'line')];
  if (f.language === 'css') facts.push('stylesheet part');
  else if (f.generated) facts.push('generated, never edited by hand');
  else facts.push(plural(declared.length, 'export'));
  if (f.exports.length > declared.length) facts.push(plural(f.exports.length - declared.length, 're-export'));
  out.push(`${facts.join(', ')}. Imported by ${plural(f.importedBy.length, 'file')}.`);
  out.push('');
  if (f.exports.length) {
    out.push('| Name | Kind | Line | Signature | What its comment says |', '|---|---|---|---|---|');
    for (const e of f.exports) out.push(`| ${code(e.name)} | ${e.kind} | ${e.line} | ${e.signature ? code(cell(e.signature)) : ''} | ${cell(e.summary)} |`);
    out.push('');
  }
  const lines = [];
  if (f.endpoints.length) lines.push(`Endpoints: ${f.endpoints.map(code).join(', ')}`);
  lines.push(`Imports: ${list(f.imports.map(short), 16)}`);
  if (f.packages.length) lines.push(`Packages: ${list(f.packages, 12)}`);
  lines.push(`Imported by: ${list(f.importedBy.map(short), 14)}`);
  if (f.rel.startsWith('server/') || f.rel.startsWith('web/')) {
    lines.push(`Tests that import it: ${list(f.testedBy.map(short), 8)}`);
    if (f.endpoints.length) lines.push(`Tests that call its endpoints: ${list(f.calledBy.map(short), 8)}`);
  }
  out.push(lines.join('\n\n'));
  return out.join('\n');
}

/** Rows of an existing `files` table, as file name -> the last cell, so a rewrite keeps what a person wrote there. */
export function purposesOf(body) {
  const map = new Map();
  for (const line of body.split('\n')) {
    const m = /^\| \[`([^`]+)`\]\([^)]*\) \|[^|]*\|[^|]*\| (.*) \|$/.exec(line);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

/** A table of the card files directly inside `dir`, with the last column kept from `previous`. */
export function renderFiles(model, dir, docRel, previous = '') {
  const kept = purposesOf(previous);
  const rows = [...model.files.values()].filter((f) => posix.dirname(f.rel) === dir).sort((a, b) => (a.rel < b.rel ? -1 : 1));
  if (!rows.length) throw new Error(`no card files directly in ${dir}`);
  const out = ['| File | Lines | Exports | What it is |', '|---|---|---|---|'];
  for (const f of rows) {
    const name = posix.basename(f.rel);
    const exports = f.language === 'css' ? '' : f.exports.length;
    out.push(`| [${code(name)}](${relLink(docRel, f.rel)}) | ${f.lines} | ${exports} | ${kept.get(name) ?? ''} |`);
  }
  return out.join('\n');
}

/** What a directory holds, one level at a time, as a fenced tree. `depth` levels of folders; `files=yes` lists files too. */
export function renderTree(root, target, { depth = 1, files = 'no' } = {}) {
  const dir = target === '.' ? '' : target;
  const lines = [`${dir || '.'}/`];
  const visit = (current, prefix, level) => {
    const abs = join(root, current);
    const entries = readdirSync(abs, { withFileTypes: true })
      .filter((e) => !SKIP_DIRS.has(e.name) && !isNeverListed(e.name) && !ONE_COPY_FILES.has(e.name) && !(current === '' && OWN_ROOT_DIRS.has(e.name) && e.isDirectory()))
      .sort((a, b) => (a.isDirectory() === b.isDirectory() ? (a.name < b.name ? -1 : 1) : a.isDirectory() ? -1 : 1));
    const shown = entries.filter((e) => e.isDirectory() || files === 'yes');
    const width = Math.max(0, ...shown.map((e) => e.name.length + (e.isDirectory() ? 1 : 0)));
    shown.forEach((e, i) => {
      const last = i === shown.length - 1;
      const branch = last ? '└── ' : '├── ';
      const label = e.isDirectory() ? `${e.name}/` : e.name;
      if (e.isDirectory()) {
        const inner = join(abs, e.name);
        // Test files are left out of the count: one is added in most weeks and would put every tree out of date.
        const count = e.name === '__tests__' ? 0 : readdirSync(inner, { withFileTypes: true }).filter((x) => !x.isDirectory() && !SKIP_DIRS.has(x.name) && !isNeverListed(x.name) && !ONE_COPY_FILES.has(x.name) && !isTestFile(posix.join(current, e.name, x.name))).length;
        lines.push(`${prefix}${branch}${label.padEnd(width)}  ${count ? plural(count, 'file') : ''}`.trimEnd());
        if (level < depth) visit(posix.join(current, e.name), prefix + (last ? '    ' : '│   '), level + 1);
      } else {
        lines.push(`${prefix}${branch}${label}`);
      }
    });
  };
  visit(dir, '', 1);
  return ['```text', ...lines, '```'].join('\n');
}

/** The title of a test file's first `describe`, as the tests map says what the file checks; empty when it has none. */
const firstTitle = (t) => (t.describes[0] ? plain(t.describes[0]).slice(0, 110) : '');

/** Every test file, by package: how many tests it holds, what its first describe says, and the code it imports. */
export function renderTestsMap(model) {
  const groups = new Map();
  for (const t of model.tests.values()) {
    const pkg = t.rel.split('/')[0];
    if (!groups.has(pkg)) groups.set(pkg, []);
    groups.get(pkg).push(t);
  }
  const out = [];
  for (const pkg of [...groups.keys()].sort()) {
    const rows = groups.get(pkg).sort((a, b) => (a.rel < b.rel ? -1 : 1));
    if (out.length) out.push('');
    out.push(`### ${pkg}`, '', '| Test file | Tests | What it checks | Code it imports |', '|---|---|---|---|');
    for (const t of rows) out.push(`| ${code(t.rel)} | ${t.tests} | ${cell(firstTitle(t))} | ${cell(list(t.covers.map(short), 5))} |`);
  }
  return out.join('\n');
}

/** Every declared export of every card file, A to Z, each with the place it is declared. */
export function renderSymbols(model) {
  const rows = [];
  for (const f of model.files.values()) {
    for (const e of f.exports) if (e.kind !== 're-export') rows.push({ name: e.name, kind: e.kind, where: `${f.rel}:${e.line}` });
  }
  rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.where < b.where ? -1 : 1));
  const out = [];
  let letter = '';
  for (const r of rows) {
    const initial = /^[A-Za-z]/.test(r.name) ? r.name[0].toUpperCase() : 'Other';
    if (initial !== letter) {
      if (out.length) out.push('');
      out.push(`### ${initial}`, '', '| Name | Kind | Declared at |', '|---|---|---|');
      letter = initial;
    }
    out.push(`| ${code(r.name)} | ${r.kind} | ${code(r.where)} |`);
  }
  return out.join('\n');
}

/** The language a fenced block is tagged with. */
const LANG = { ts: 'ts', tsx: 'tsx', mjs: 'js', js: 'js', py: 'python', sh: 'bash', css: 'css', yml: 'yaml', json: 'json' };

/** Removes the indentation shared by every non-blank line. */
function dedent(text) {
  const lines = text.split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut)).join('\n');
}

/** The text a snippet block quotes, where it sits, and the hash of the whole declaration. */
export function resolveSnippet(model, target, options = {}) {
  const [rel, anchor = ''] = target.split('#');
  const f = model.files.get(rel);
  if (!f) throw new Error(`snippet names ${rel}, which is not a card file`);
  const lineRange = /^L(\d+)-(\d+)$/.exec(anchor);
  let start;
  let end;
  let label = anchor;
  if (lineRange) {
    const all = f.text.split('\n');
    const from = Number(lineRange[1]);
    const to = Number(lineRange[2]);
    if (from < 1 || to < from || to > all.length) throw new Error(`snippet ${target}: lines ${from}-${to} are outside ${rel} (${all.length} lines)`);
    start = f.text.split('\n').slice(0, from - 1).join('\n').length + (from > 1 ? 1 : 0);
    end = start + all.slice(from - 1, to).join('\n').length;
  } else {
    const d = f.decls.get(anchor);
    if (!d) throw new Error(`snippet ${target}: ${rel} declares no top-level ${anchor}`);
    start = options.doc ? d.docStart : d.start;
    end = d.end;
  }
  const whole = f.text.slice(start, end);
  const startLine = f.text.slice(0, start).split('\n').length;
  const endLine = startLine + whole.split('\n').length - 1;
  let quoted = whole;
  let from = startLine;
  let note = '';
  if (options.lines) {
    const m = /^(\d+)-(\d+)$/.exec(options.lines);
    const all = whole.split('\n');
    if (!m || Number(m[1]) < 1 || Number(m[2]) < Number(m[1]) || Number(m[2]) > all.length) throw new Error(`snippet ${target}: lines=${options.lines} do not fit its ${all.length} lines`);
    quoted = all.slice(Number(m[1]) - 1, Number(m[2])).join('\n');
    from = startLine + Number(m[1]) - 1;
    note = ` (lines ${m[1]} to ${m[2]} of ${label || 'it'})`;
  }
  return { rel, label, startLine: from, endLine: from + quoted.split('\n').length - 1, text: dedent(quoted), whole, sha: snippetHash(whole), note, language: LANG[f.language] ?? '' };
}

/** The caption and the fenced quote of a snippet block. */
export function renderSnippet(model, target, options = {}) {
  const s = resolveSnippet(model, target, options);
  return [`${code(`${s.rel}:${s.startLine}-${s.endLine}`)}${s.note}`, '', `\`\`\`${s.language}`, s.text, '```'].join('\n');
}

/** A chapter's reading time in minutes, rounded: about 200 words a minute for prose, and a code line takes as long as ten words. */
export function readingMinutes(prose, codeLines = 0) {
  const words = (prose.match(/[\p{L}\p{N}'-]+/gu) ?? []).length;
  const minutes = (words + codeLines * 10) / 200;
  if (minutes < 10) return Math.max(1, Math.round(minutes));
  return Math.round(minutes / 5) * 5;
}
