/**
 * The handover handbook (docs/handover) is true to the code, complete for the parts declared complete, and clean.
 *
 * A handbook goes wrong in three ways: the code moves and the page does not, a file or a folder is left out, and prose
 * picks up habits nobody chose (a stray address, an em dash, a word a person would not write). Each is a rule here:
 *
 *   blocks       every generated block (file cards, file tables, trees, the A to Z index, quoted code) is what the
 *                generator writes from the code today, the reading time in each page's box is right, and the code under a
 *                quoted snippet is the code its explanation was written against (tools/handover/build.mjs rewrites them)
 *   manifest     the parts and pages listed in manifest.json exist, and every page on disk is listed
 *   box          every page opens with the box: who it is for, reading time, read first, read next
 *   headings     one title, and no level skipped
 *   folders      each folder of the source roots has a description, once the folders part is complete
 *   cards        each code file has exactly one card with some hand-written text above it, once the code part is complete
 *   purposes     each file in a file table says in a few words what it is
 *   everyone     the part for people who do not read code has no code in it: no fenced block, no identifier, no path
 *   summary      each page of that part carries a five-line summary in Indonesian under its box
 *   snippets     quoted code in the part for developers is followed by an explanation of at least 40 words
 *   generated    the A to Z index and the tests map each hold the block the generator fills them with
 *   references   a name or a repository path in backticks exists in the code
 *   style        no em dash, no double hyphen, no curly quote, no emoji, no hidden character, none of a short list of words
 *                a person would not choose
 *   secrets      no address, no mailbox, no token and no home folder: the repository is public
 *
 * Read-only. It says what is wrong and where, and `npm run handover:build` fixes what a program can.
 *
 *   node tools/check/handover.check.mjs [repo root]   (default: two levels up)
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskBlocks, splitBlocks } from '../handover/lib/blocks.mjs';
import { boxOf, HANDOVER_DIR, isHandbook, listPages, processDocument } from '../handover/lib/document.mjs';
import { buildModel } from '../handover/lib/model.mjs';
import { purposesOf } from '../handover/lib/render.mjs';
import { folderCards, PER_COPY_FILES, walk } from '../handover/lib/scope.mjs';
import { ONE_COPY_ONLY } from '../check/parity.check.mjs';

const WHO = /^(?:Everyone|Operators|Developers)(?:(?:,| and) (?:everyone|operators|developers))*$/i;

/** Pages that are not hand-written chapters: the box is still required, the prose rules are not. */
const GENERATED_PAGES = new Set(['2-code/symbols.md', '2-code/tests-map.md']);

/** The block a generated page is made of; a page with prose and no block would be a list nobody keeps true. */
const GENERATED_KIND = { '2-code/symbols.md': 'symbols', '2-code/tests-map.md': 'testsmap' };

/** A generated page holds its block. */
export function generatedProblems(inside, text) {
  const kind = GENERATED_KIND[inside];
  if (!kind) return [];
  const has = splitBlocks(text).some((p) => p.type === 'block' && p.kind === kind);
  return has ? [] : [{ line: 1, message: `${inside} has no generated block (<!-- gen:${kind} -->)` }];
}

/* ---- style and secrets: pure functions over text, each with a sample that must fail in the self-test ---- */

/** Characters named by number, so this file holds none of the characters it forbids. */
const cp = (...codes) => String.fromCodePoint(...codes);

const BANNED_CHARS = [
  [new RegExp(cp(0x2014)), 'an em dash (use a full stop, a comma, a colon or brackets)'],
  [new RegExp(`[${cp(0x2013, 0x2015)}]`), 'an en dash or horizontal bar (write "to", or use a hyphen)'],
  [/(?<=\S) -- (?=\S)/, 'a double hyphen used as a dash'],
  [new RegExp(`[${cp(0x2018, 0x2019, 0x201c, 0x201d)}]`), 'a curly quote (the documents use straight quotes)'],
  [new RegExp(`[${cp(0x200b)}-${cp(0x200f)}${cp(0x2060, 0xfeff, 0x00ad)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}${cp(0x2028, 0x2029)}]`), 'a hidden character'],
  [new RegExp(cp(0x00a0)), 'a no-break space'],
  [new RegExp(`[${cp(0xfe0e, 0xfe0f)}]`), 'a variation selector'],
  [/\p{Extended_Pictographic}/u, 'an emoji'],
];

/** Words and phrases that mark prose nobody chose. A short list, kept to the ones that are never needed here. */
const BANNED_WORDS = [
  /\bdelv(?:e|es|ing)\b/i,
  /\btapestry\b/i,
  /\btestament\b/i,
  /\bseamless(?:ly)?\b/i,
  /\belevate[sd]?\b/i,
  /\bempower(?:s|ed|ing)?\b/i,
  /\bunlock(?:s|ed|ing)?\b/i,
  /\bgame[- ]changer\b/i,
  /\bcutting[- ]edge\b/i,
  /\bholistic(?:ally)?\b/i,
  /\bsynerg(?:y|ies)\b/i,
  /\bleverag(?:e|es|ed|ing)\b/i,
  /\bdive(?:s)? into\b/i,
  /\bit is important to note\b/i,
  /\bit'?s worth noting\b/i,
  /\bin today'?s\b/i,
  /\bplays? a (?:crucial|vital|pivotal) role\b/i,
  /\bnot just\b[^.\n]*\bbut\b/i,
  /\bit'?s not\b[^.\n]{1,60},\s*it'?s\b/i,
  /\bwithout further ado\b/i,
  /\bat its core\b/i,
  /\bI hope this helps\b/i,
];

/** The problems in `text` for the style rule, as { line, message }. Fenced code is read too: a dash is a dash anywhere. */
export function checkStyle(text, { chars = true, words = true } = {}) {
  const found = [];
  text.split('\n').forEach((line, i) => {
    if (chars) for (const [re, what] of BANNED_CHARS) if (re.test(line)) found.push({ line: i + 1, message: what });
    if (words) for (const re of BANNED_WORDS) if (re.test(line)) found.push({ line: i + 1, message: `the phrase "${line.match(re)[0]}" reads as written by a template` });
  });
  return found;
}

const SAFE_IPV4 = /^(?:127\.0\.0\.1|0\.0\.0\.0|255\.255\.255\.\d+|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+)$/;

/** The problems in `text` for the secrets rule: an address, a mailbox, a token, a home folder. */
export function checkSecrets(text) {
  const found = [];
  text.split('\n').forEach((line, i) => {
    const at = i + 1;
    for (const m of line.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) if (!SAFE_IPV4.test(m[0])) found.push({ line: at, message: `an IPv4 address (${m[0]}); the repository is public` });
    for (const m of line.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) if (!/@(?:example\.(?:com|org|net)|users\.noreply\.github\.com)$/.test(m[0]) && !/^noreply@anthropic\.com$/.test(m[0])) found.push({ line: at, message: `a mailbox (${m[0]})` });
    if (/\b[0-9a-f]{32,}\b/i.test(line)) found.push({ line: at, message: 'a long hexadecimal string (a token or a digest)' });
    if (/(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)\b[A-Za-z0-9_-]{32,}\b/.test(line)) found.push({ line: at, message: 'a long mixed-case string that reads as a token' });
    if (/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/.test(line)) found.push({ line: at, message: 'a bearer token' });
    if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(line)) found.push({ line: at, message: 'a JSON web token' });
    if (/\bsk-[A-Za-z0-9_-]{20,}/.test(line) || /\bAKIA[0-9A-Z]{16}\b/.test(line)) found.push({ line: at, message: 'an API key' });
    if (/\/Users\/\w+|\b[A-Z]:\\Users\\/.test(line)) found.push({ line: at, message: 'a home folder path' });
    for (const m of line.matchAll(/\b[\w-]+\.hcml\.co\.id\b/gi)) if (!/^(?:zabbix|www)\./i.test(m[0])) found.push({ line: at, message: `an internal host name (${m[0]})` });
  });
  return found;
}

/* ---- structure: the box, the headings, the part for everyone ---- */

export function checkBox(text) {
  const box = boxOf(text);
  if (!box) return [{ line: 1, message: 'no box under the title (Who it is for | Reading time | Read first | Read next)' }];
  const found = [];
  if (!WHO.test(box.who)) found.push({ line: box.line, message: `"Who it is for" says "${box.who}"; use Everyone, Operators or Developers, alone or joined by "and"` });
  if (!/^about \d+ min$/.test(box.time)) found.push({ line: box.line, message: `"Reading time" says "${box.time}"; it is written by the build as "about N min"` });
  for (const [label, value] of [['Read first', box.first], ['Read next', box.next]]) {
    if (value !== 'none' && !/^\[[^\]]+\]\([^)]+\.md(?:#[^)]*)?\)(?:, \[[^\]]+\]\([^)]+\.md(?:#[^)]*)?\))*$/.test(value)) found.push({ line: box.line, message: `"${label}" must be "none" or Markdown links to pages (${value})` });
  }
  return found;
}

export function checkHeadings(text) {
  const found = [];
  let level = 0;
  let h1 = 0;
  let fence = null;
  text.split('\n').forEach((line, i) => {
    const f = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      return;
    }
    if (f) {
      fence = f[1];
      return;
    }
    const m = /^(#{1,6}) \S/.exec(line);
    if (!m) return;
    const n = m[1].length;
    if (n === 1 && ++h1 > 1) found.push({ line: i + 1, message: 'a second title; a page has one # heading' });
    if (level && n > level + 1) found.push({ line: i + 1, message: `a level ${n} heading under a level ${level} one; no level may be skipped` });
    level = n;
  });
  if (h1 === 0) found.push({ line: 1, message: 'no title' });
  return found;
}

const CODE_LIKE = /^(?:[A-Za-z_$][\w$]*\(\)|[a-z]+[A-Z][\w$]*|[A-Z][a-z]+[A-Z][\w$]*|[A-Za-z]+_[\w]+|[\w./-]+\/[\w./-]*|[\w-]+\.(?:ts|tsx|mjs|js|json|md|yml|yaml|sh|py|css|env)|[A-Z][A-Z0-9]*_[A-Z0-9_]+)$/;

/** The part for people who do not read code: no fenced block and no inline code that is an identifier or a path. */
export function checkEveryone(text) {
  const found = [];
  const blocks = splitBlocks(text);
  for (const b of blocks) {
    if (b.type === 'block') found.push({ line: b.line, message: 'a generated block (cards, tables and quoted code belong in the parts for developers)' });
  }
  let fence = null;
  text.split('\n').forEach((line, i) => {
    const f = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence[0].length) fence = null;
      return;
    }
    if (f) {
      fence = f[1];
      found.push({ line: i + 1, message: 'a code block; this part has no code' });
      return;
    }
    if (/^( {4}|\t)\S/.test(line) && !/^\s*[-*+\d>|]/.test(line.trimStart())) found.push({ line: i + 1, message: 'an indented code block; this part has no code' });
    for (const m of line.matchAll(/`([^`]+)`/g)) if (CODE_LIKE.test(m[1])) found.push({ line: i + 1, message: `\`${m[1]}\` looks like code or a path; say what it is in words` });
  });
  return found;
}

/** Words that are in nearly every Indonesian sentence and in no English one, for telling the summary was not pasted in English. */
const INDONESIAN = new Set(['yang', 'dan', 'untuk', 'tidak', 'dengan', 'adalah', 'dari', 'pada', 'ini', 'itu', 'atau', 'bisa', 'harus', 'akan', 'hanya', 'oleh', 'sudah', 'juga', 'ke', 'di']);

/** The Indonesian summary: a quote that opens with Ringkasan and holds five bullets, before the first section heading. */
export function checkSummary(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^> \*\*Ringkasan\*\*\s*$/.test(l));
  if (at < 0) return [{ line: 1, message: 'no Indonesian summary: a quote that opens with "> **Ringkasan**" and holds five bullets' }];
  const first = lines.findIndex((l) => /^## /.test(l));
  const found = [];
  if (first >= 0 && at > first) found.push({ line: at + 1, message: 'the summary must come before the first section heading' });
  const bullets = [];
  for (let i = at + 1; i < lines.length && lines[i].startsWith('>'); i++) {
    const m = /^> - (.+)$/.exec(lines[i]);
    if (m) bullets.push({ text: m[1], line: i + 1 });
    else if (lines[i].trim() !== '>') found.push({ line: i + 1, message: 'the summary holds bullets only' });
  }
  if (bullets.length !== 5) found.push({ line: at + 1, message: `the summary holds ${bullets.length} bullets; it holds five` });
  for (const b of bullets) {
    const n = wordCount(b.text);
    if (n < 6 || n > 40) found.push({ line: b.line, message: `a summary bullet of ${n} words; keep it between 6 and 40` });
  }
  const all = bullets.map((b) => b.text.toLowerCase()).join(' ');
  const hits = (all.match(/[a-z]+/g) ?? []).filter((w) => INDONESIAN.has(w)).length;
  if (bullets.length && hits < 8) found.push({ line: at + 1, message: 'the summary does not read as Indonesian' });
  return found;
}

/* ---- references: names and paths in backticks exist in the code ---- */

const IDENT = /^[A-Za-z_$][\w$]*(?:\(\))?$/;
const REPO_PATH = /^(?:\.github|server|web|tools|deploy|docs)\/[\w./@-]*$/;
const SHORT_PATH = /^(?:[\w@.-]+\/)+[\w@.-]+\.(?:ts|tsx|mjs|js|css|json|md|sh|py|yml|yaml)$/;

/** Does this token look like a name worth looking up? Plain lowercase words are prose in code font, not names. */
export function looksLikeName(token) {
  if (!IDENT.test(token)) return false;
  const bare = token.replace(/\(\)$/, '');
  return token.endsWith('()') || /[a-z][A-Z]/.test(bare) || /^[A-Z][a-z]+[A-Z]/.test(bare) || /_/.test(bare) && /[A-Za-z]/.test(bare) && bare.length > 3;
}

/** Every word of the code and the settings, for looking a name up. */
export function buildCorpus(root) {
  const words = new Set();
  const take = (text) => {
    for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) words.add(m[0]);
  };
  const files = [];
  for (const base of ['server/src', 'web/src', 'server/scripts', 'web/scripts', 'tools', 'deploy', 'server', 'web', '.github']) {
    for (const rel of walk(root, base)) if (/\.(ts|tsx|mjs|js|py|sh|css|json|yml|yaml|example|inc|conf|html)$/.test(rel) || /Dockerfile$/.test(rel)) files.push(rel);
  }
  for (const rel of ['docker-compose.yml', '.env.example', 'package.json', 'docs/api/openapi.yaml']) if (existsSync(join(root, rel))) files.push(rel);
  for (const rel of new Set(files)) {
    if (/\/(?:openapi\.json|package-lock\.json)$/.test(rel)) continue;
    try {
      take(readFileSync(join(root, rel), 'utf8'));
    } catch {
      // unreadable: ignored
    }
  }
  return words;
}

/** Paths that are real on a working machine and absent from a fresh checkout: settings, installed packages, build output. */
const UNTRACKED = /(?:^|\/)(?:node_modules|dist)(?:\/|$)|^(?:(?:server|web)\/)?\.env$|^docker-compose\.override\.yml$/;

const ONE_COPY = new Set(Object.values(ONE_COPY_ONLY).flat());

const exists = (root, rel) => UNTRACKED.test(rel.replace(/\/$/, '')) || ONE_COPY.has(rel) || existsSync(join(root, rel.replace(/\/$/, '')));

/** Backticked names and paths in the hand-written text of a page that name nothing in the code. */
export function checkReferences(text, corpus, root) {
  const found = [];
  let fence = null;
  maskBlocks(text).split('\n').forEach((line, i) => {
    const f = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      return;
    }
    if (f) {
      fence = f[1];
      return;
    }
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const token = m[1].trim();
      if (REPO_PATH.test(token)) {
        if (!exists(root, token)) found.push({ line: i + 1, message: `\`${token}\` is not a path in this repository` });
      } else if (SHORT_PATH.test(token)) {
        if (!['', 'server/', 'web/', 'server/src/', 'web/src/', 'tools/', 'docs/', 'docs/handover/'].some((base) => exists(root, base + token))) found.push({ line: i + 1, message: `\`${token}\` is not a file in this repository` });
      } else if (looksLikeName(token) && !corpus.has(token.replace(/\(\)$/, ''))) {
        found.push({ line: i + 1, message: `\`${token}\` is not a name that appears in the code` });
      }
    }
  });
  return found;
}

/* ---- the manifest, the folders, the cards, the purposes ---- */

export function readManifest(root) {
  const file = join(root, HANDOVER_DIR, 'manifest.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

const STATES = new Set(['planned', 'writing', 'complete']);

/** The parts that exist, in the manifest's order, with their pages as paths below docs/handover. */
export function manifestProblems(manifest, pagesOnDisk) {
  const found = [];
  if (!manifest || !Array.isArray(manifest.parts)) return [{ line: 1, message: 'manifest.json has no "parts" list' }];
  const listed = new Set();
  for (const part of manifest.parts) {
    if (!STATES.has(part.state)) found.push({ line: 1, message: `part "${part.id}" has state "${part.state}"; use planned, writing or complete` });
    for (const page of part.pages ?? []) {
      const rel = part.dir ? `${part.dir}/${page}` : page;
      listed.add(rel);
      if (!pagesOnDisk.has(rel) && part.state !== 'planned') found.push({ line: 1, message: `part "${part.id}" lists ${rel}, which does not exist` });
    }
  }
  for (const rel of pagesOnDisk) if (!listed.has(rel)) found.push({ line: 1, message: `${rel} is not listed in manifest.json` });
  return found;
}

const wordCount = (text) => (text.match(/[\p{L}\p{N}'-]+/gu) ?? []).length;

/** Cards: one per code file, each with a few words of hand-written text above its block. */
export function cardProblems(pages, model) {
  const found = [];
  const seen = new Map();
  for (const [rel, text] of pages) {
    const parts = splitBlocks(text);
    parts.forEach((p, idx) => {
      if (p.type !== 'block' || p.kind !== 'card') return;
      if (seen.has(p.target)) found.push({ page: rel, line: p.line, message: `a second card for ${p.target} (the first is in ${seen.get(p.target)})` });
      seen.set(p.target, rel);
      const before = idx > 0 && parts[idx - 1].type === 'text' ? parts[idx - 1].text : '';
      const afterHeading = before.split(/^#{1,6} .*$/m).pop() ?? '';
      if (wordCount(afterHeading.replace(/<!--[\s\S]*?-->/g, '')) < 12) found.push({ page: rel, line: p.line, message: `the card for ${p.target} has under 12 words of hand-written text above it` });
    });
  }
  for (const f of model.files.keys()) if (!seen.has(f)) found.push({ page: null, line: 1, message: `no card for ${f}` });
  for (const t of seen.keys()) if (!model.files.has(t)) found.push({ page: seen.get(t), line: 1, message: `a card for ${t}, which is not a code file` });
  return found;
}

/** Folder descriptions: `<!-- folder PATH -->` marks the paragraph that describes a folder. */
export function folderProblems(pages, root) {
  const found = [];
  const seen = new Map();
  for (const [rel, text] of pages) {
    text.split('\n').forEach((line, i) => {
      const m = /^<!-- folder (\S+) -->\s*$/.exec(line);
      if (!m) return;
      if (seen.has(m[1])) found.push({ page: rel, line: i + 1, message: `a second description of ${m[1]} (the first is in ${seen.get(m[1])})` });
      seen.set(m[1], rel);
    });
  }
  const wanted = folderCards(root);
  for (const dir of wanted) if (!seen.has(dir)) found.push({ page: null, line: 1, message: `no description of the folder ${dir}` });
  for (const dir of seen.keys()) if (!wanted.includes(dir)) found.push({ page: seen.get(dir), line: 1, message: `a description of ${dir}, which is not a folder the handbook covers` });
  return found;
}

/** Quoted code is followed by words: a run of quotes may end in one explanation, and the last quote of a run needs 40 of them. */
export function snippetProblems(text) {
  const parts = splitBlocks(text);
  const found = [];
  parts.forEach((p, i) => {
    if (p.type !== 'block' || p.kind !== 'snippet') return;
    let j = i + 1;
    while (parts[j]?.type === 'text' && parts[j].text.trim() === '') j++;
    if (parts[j]?.type === 'block') return;
    const after = parts[j]?.type === 'text' ? parts[j].text : '';
    const explained = after.split(/^#{1,6} .*$/m)[0].replace(/<!--[\s\S]*?-->/g, '');
    if (wordCount(explained) < 40) found.push({ line: p.line, message: `the quote of ${p.target} is followed by fewer than 40 words of explanation` });
  });
  return found;
}

/** The last column of every file table says something: at least three words. */
export function purposeProblems(text) {
  const found = [];
  for (const b of splitBlocks(text)) {
    if (b.type !== 'block' || b.kind !== 'files') continue;
    const purposes = purposesOf(b.body);
    const names = [...b.body.matchAll(/^\| \[`([^`]+)`\]/gm)].map((m) => m[1]);
    for (const name of names) {
      if (wordCount(purposes.get(name) ?? '') < 3) found.push({ line: b.line, message: `${b.target}/${name} has no description in the file table` });
    }
  }
  return found;
}

/** The page about the two copies names every file that is meant to differ between them. */
export function perCopyProblems(text, files = PER_COPY_FILES) {
  return files.filter((f) => !text.includes(`\`${f}\``)).map((f) => ({ line: 1, message: `the list of files that differ does not name ${f} (it is on the list in tools/check/parity.check.mjs)` }));
}

/* ---- the whole check ---- */

/** Every problem under `root`, one { page, line, rule, message } each, and what was looked at. */
export function checkHandbook(root) {
  const problems = [];
  const add = (page, rule, list) => {
    for (const p of list) problems.push({ page: p.page ?? page, line: p.line, rule, message: p.message });
  };
  if (!isHandbook(root)) return { problems, pages: 0, skipped: true };
  const model = buildModel(root);
  const corpus = buildCorpus(root);
  const rels = listPages(root);
  const pages = new Map(rels.map((rel) => [rel, readFileSync(join(root, rel), 'utf8')]));
  const below = (rel) => rel.slice(HANDOVER_DIR.length + 1);
  const manifest = readManifest(root);
  add('manifest.json', 'manifest', manifestProblems(manifest, new Set(rels.map(below))));
  const state = Object.fromEntries((manifest?.parts ?? []).map((p) => [p.id, p.state]));

  for (const [rel, text] of pages) {
    const inside = below(rel);
    const generatedPage = GENERATED_PAGES.has(inside);
    const { text: fresh, problems: block } = processDocument(model, root, rel, text, { fill: false });
    add(rel, 'blocks', block);
    if (fresh !== text) {
      const a = text.split('\n');
      const b = fresh.split('\n');
      const at = a.findIndex((line, i) => line !== b[i]);
      problems.push({ page: rel, line: Math.max(1, at + 1), rule: 'blocks', message: 'out of date with the code. Run: npm run handover:build' });
    }
    add(rel, 'box', checkBox(text));
    add(rel, 'headings', checkHeadings(text));
    add(rel, 'style', checkStyle(text, { words: false }));
    if (!generatedPage) add(rel, 'style', checkStyle(maskBlocks(text), { chars: false }));
    add(rel, 'secrets', checkSecrets(text));
    if (!generatedPage) add(rel, 'references', checkReferences(text, corpus, root));
    if (inside.startsWith('2-code/')) add(rel, 'snippets', snippetProblems(text));
    add(rel, 'generated', generatedProblems(inside, text));
    if (inside.startsWith('0-everyone/')) {
      add(rel, 'everyone', checkEveryone(text));
      add(rel, 'summary', checkSummary(text));
    }
    add(rel, 'purposes', purposeProblems(text));
  }

  if (state.folders === 'complete') {
    add(null, 'folders', folderProblems([...pages].filter(([rel]) => below(rel).startsWith('1-folders/')), root));
    const tables = new Set();
    for (const [, text] of pages) for (const b of splitBlocks(text)) if (b.type === 'block' && b.kind === 'files') tables.add(b.target);
    for (const f of model.files.keys()) {
      const dir = posix.dirname(f);
      if (!tables.has(dir)) {
        tables.add(dir);
        problems.push({ page: null, line: 1, rule: 'folders', message: `${dir} has code files but no file table (<!-- gen:files ${dir} -->)` });
      }
    }
  }
  if (state.folders === 'complete' && pages.has(`${HANDOVER_DIR}/1-folders/the-two-copies.md`)) add(`${HANDOVER_DIR}/1-folders/the-two-copies.md`, 'copies', perCopyProblems(pages.get(`${HANDOVER_DIR}/1-folders/the-two-copies.md`)));
  if (state.code === 'complete') add(null, 'cards', cardProblems([...pages].filter(([rel]) => below(rel).startsWith('2-code/')), model));
  return { problems, pages: pages.size, skipped: false, model };
}

/* ---- the self-test: a rule that can never fail checks nothing ---- */

export function selfTest() {
  const failures = [];
  const expect = (name, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  const hits = (list) => list.length;

  expect('a generated page without its block is caught', hits(generatedProblems('2-code/symbols.md', '# The index\n\nNo block.')), 1);
  expect('a generated page with its block passes', hits(generatedProblems('2-code/symbols.md', '# The index\n\n<!-- gen:symbols -->\n<!-- /gen -->\n')), 0);
  expect('em dash is caught', hits(checkStyle(`A pause ${cp(0x2014)} here.`)), 1);
  expect('en dash is caught', hits(checkStyle(`Pages 4${cp(0x2013)}6.`)), 1);
  expect('double hyphen is caught', hits(checkStyle('A pause -- here.')), 1);
  expect('a hyphen is fine', hits(checkStyle('A well-known thing, and a flag --force in code.')), 0);
  expect('curly quote is caught', hits(checkStyle(`It${cp(0x2019)}s here.`)), 1);
  expect('zero-width space is caught', hits(checkStyle(`hid${cp(0x200b)}den`)), 1);
  expect('no-break space is caught', hits(checkStyle(`a${cp(0x00a0)}b`)), 1);
  expect('emoji is caught', hits(checkStyle(`Done ${cp(0x2705)}`)), 1);
  expect('stock word is caught', hits(checkStyle('We delve into it.')), 1);
  expect('stock phrase is caught', hits(checkStyle('It is not just a list, but a map.')), 1);
  expect('plain prose passes', hits(checkStyle('The portal reads Zabbix and keeps a copy for fifteen seconds.')), 0);

  expect('a LAN address is caught', hits(checkSecrets('Zabbix is at 192.168.77.10 inside.')), 1);
  expect('loopback is fine', hits(checkSecrets('Listens on 127.0.0.1:8081.')), 0);
  expect('a documentation address is fine', hits(checkSecrets('Use 203.0.113.7 as the example.')), 0);
  expect('a mailbox is caught', hits(checkSecrets('Ask someone@gmail.com.')), 1);
  expect('example.com is fine', hits(checkSecrets('Write to ops@example.com.')), 0);
  expect('a long hex string is caught', hits(checkSecrets('token 0123456789abcdef0123456789abcdef0123')), 1);
  expect('a mixed-case token is caught', hits(checkSecrets('key Abc123Def456Ghi789Jkl012Mno345Pqr678Stu')), 1);
  expect('a bearer token is caught', hits(checkSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345')), 1);
  expect('a home folder is caught', hits(checkSecrets('see /Users/someone/work')), 1);
  expect('an internal host is caught', hits(checkSecrets('the box db01.hcml.co.id')), 1);
  expect('the public Zabbix host is fine', hits(checkSecrets('https://zabbix.hcml.co.id/zabbix')), 0);
  expect('a long kebab-case file name is not a token', hits(checkSecrets('40-what-changed-from-26-to-30-october-2026-the-new-look-option-b')), 0);

  const box = (who, time, first, next) => `# T\n\n| Who it is for | Reading time | Read first | Read next |\n|---|---|---|---|\n| ${who} | ${time} | ${first} | ${next} |\n`;
  expect('a good box passes', hits(checkBox(box('Operators and developers', 'about 12 min', 'none', '[Next](next.md)'))), 0);
  expect('a missing box is caught', hits(checkBox('# T\n\nText.\n')), 1);
  expect('a wrong audience is caught', hits(checkBox(box('Managers', 'about 12 min', 'none', 'none'))), 1);
  expect('a free-text time is caught', hits(checkBox(box('Everyone', '12 minutes', 'none', 'none'))), 1);
  expect('a read-next that is not a link is caught', hits(checkBox(box('Everyone', 'about 5 min', 'none', 'the next page'))), 1);

  expect('one title passes', hits(checkHeadings('# T\n\n## A\n\n### B\n')), 0);
  expect('a second title is caught', hits(checkHeadings('# T\n\n# U\n')), 1);
  expect('a skipped level is caught', hits(checkHeadings('# T\n\n### B\n')), 1);
  expect('a hash line inside code is not a heading', hits(checkHeadings('# T\n\n```bash\n# comment\n```\n')), 0);
  expect('no title is caught', hits(checkHeadings('Text only.\n')), 1);

  expect('a code block is caught in the part for everyone', hits(checkEveryone('# T\n\n```bash\nls\n```\n')), 1);
  expect('an identifier is caught in the part for everyone', hits(checkEveryone('# T\n\nThe `getProblems` function.\n')), 1);
  expect('a path is caught in the part for everyone', hits(checkEveryone('# T\n\nThe file `server/src/core/cache.ts`.\n')), 1);
  expect('an environment variable is caught in the part for everyone', hits(checkEveryone('# T\n\nSet `PORTAL_USERS`.\n')), 1);
  expect('a generated block is caught in the part for everyone', hits(checkEveryone('# T\n\n<!-- gen:tree server -->\n<!-- /gen -->\n')), 1);
  expect('a button label in code font passes', hits(checkEveryone('# T\n\nPress `Explain`.\n')), 0);
  expect('plain prose passes in the part for everyone', hits(checkEveryone('# T\n\nThe portal shows problems.\n')), 0);

  const summary = (bullets, before = '') => `# T\n\n${before}> **Ringkasan**\n>\n${bullets.map((b) => `> - ${b}`).join('\n')}\n\n## A\n\nText.\n`;
  const good = ['Portal ini membaca data dari Zabbix.', 'Isinya adalah masalah yang sedang terbuka.', 'Portal hanya membaca dan tidak mengubah.', 'Satu tindakan saja yang bisa ditulis.', 'Ada dua salinan dengan model yang berbeda.'];
  expect('a summary of five Indonesian bullets passes', hits(checkSummary(summary(good))), 0);
  expect('a page with no summary is caught', hits(checkSummary('# T\n\n## A\n\nText.\n')), 1);
  expect('four bullets are caught', hits(checkSummary(summary(good.slice(0, 4)))), 1);
  expect('a summary in English is caught', hits(checkSummary(summary(['The portal reads data from Zabbix.', 'It shows the problems that are open.', 'It only reads and never changes anything.', 'One action can be written back.', 'There are two copies with two models.']))), 1);
  expect('a summary after the first section is caught', hits(checkSummary(`# T\n\n## A\n\n${summary(good)}`)), 1);
  expect('a bullet that is one word is caught', hits(checkSummary(summary(['Ya.', ...good.slice(1)]))), 1);

  const quote = (after) => `# T\n\n<!-- gen:snippet a.ts#x -->\n<!-- /gen -->\n\n${after}\n`;
  const forty = Array.from({ length: 45 }, () => 'word').join(' ');
  expect('a quote followed by an explanation passes', hits(snippetProblems(quote(forty))), 0);
  expect('a quote followed by two words is caught', hits(snippetProblems(quote('Too short.'))), 1);
  expect('a quote followed by a heading is caught', hits(snippetProblems(quote(`## Next\n\n${forty}`))), 1);
  expect('a quote followed by another quote passes', hits(snippetProblems(`# T\n\n<!-- gen:snippet a.ts#x -->\n<!-- /gen -->\n\n<!-- gen:snippet a.ts#y -->\n<!-- /gen -->\n\n${forty}\n`)), 0);
  expect('the last quote of a run is held to it', hits(snippetProblems(`# T\n\n<!-- gen:snippet a.ts#x -->\n<!-- /gen -->\n\n<!-- gen:snippet a.ts#y -->\n<!-- /gen -->\n\nShort.\n`)), 1);

  const corpus = new Set(['cached', 'createGate', 'PORTAL_USERS']);
  const scratch = '/nonexistent-root-for-the-self-test';
  expect('a known name passes', hits(checkReferences('The `createGate()` call.\n', corpus, scratch)), 0);
  expect('an unknown name is caught', hits(checkReferences('The `createGatez()` call.\n', corpus, scratch)), 1);
  expect('an unknown variable is caught', hits(checkReferences('Set `PORTAL_USERZ`.\n', corpus, scratch)), 1);
  expect('a plain word in code font is not looked up', hits(checkReferences('Press `Explain`, then `save`.\n', corpus, scratch)), 0);
  expect('a missing repository path is caught', hits(checkReferences('See `server/src/nope.ts`.\n', corpus, scratch)), 1);
  expect('a settings file that git leaves out is not looked for', hits(checkReferences('Edit `server/.env`, then look in `web/dist/`.\n', corpus, scratch)), 0);
  expect('a name inside a fenced block is not looked up', hits(checkReferences('```ts\nconst `bogusName` = 1;\n```\n', corpus, scratch)), 0);

  expect('an unlisted page is caught', hits(manifestProblems({ parts: [{ id: 'a', dir: '', state: 'complete', pages: ['x.md'] }] }, new Set(['x.md', 'y.md']))), 1);
  expect('a listed page that is missing is caught', hits(manifestProblems({ parts: [{ id: 'a', dir: '', state: 'complete', pages: ['x.md'] }] }, new Set())), 1);
  expect('a planned part may lack its pages', hits(manifestProblems({ parts: [{ id: 'a', dir: 'p', state: 'planned', pages: ['x.md'] }] }, new Set())), 0);
  expect('a wrong state is caught', hits(manifestProblems({ parts: [{ id: 'a', dir: '', state: 'done', pages: [] }] }, new Set())), 1);

  const table = (purpose) => `<!-- gen:files server/src/core -->\n| File | Lines | Exports | What it is |\n|---|---|---|---|\n| [\`gate.ts\`](x) | 36 | 2 | ${purpose} |\n<!-- /gen -->\n`;
  expect('an empty purpose is caught', hits(purposeProblems(table(''))), 1);
  expect('a described file passes', hits(purposeProblems(table('Lets only so many jobs run at once.'))), 0);

  expect('a listed file the page names passes', hits(perCopyProblems('See `a.md` and `b/c.md`.', ['a.md', 'b/c.md'])), 0);
  expect('a listed file the page leaves out is caught', hits(perCopyProblems('See `a.md`.', ['a.md', 'b/c.md'])), 1);

  const model = { files: new Map([['server/src/a.ts', {}]]) };
  const card = (target, words) => new Map([['2-code/files/x.md', `# T\n\n### a\n\n${words}\n<!-- gen:card ${target} -->\n<!-- /gen -->\n`]]);
  const prose = 'This file does one small thing and does it for the whole server, which is why it exists at all.';
  expect('a card with text passes', hits(cardProblems(card('server/src/a.ts', prose), model)), 0);
  expect('a card with no text is caught', hits(cardProblems(card('server/src/a.ts', 'Short.'), model)), 1);
  expect('a missing card is caught', hits(cardProblems(new Map(), model)), 1);
  expect('a card for a file that is not code is caught', hits(cardProblems(card('server/src/gone.ts', prose), model)), 2);
  return failures;
}

// Run as a script only: the tests import the functions above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const broken = selfTest();
  if (broken.length) {
    for (const b of broken) console.error(`handover.check self-test failed: ${b}`);
    process.exit(1);
  }
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  if (!statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`);
  const { problems, pages, skipped } = checkHandbook(root);
  if (skipped) {
    console.log('handover.check: there is no docs/handover here, so nothing was checked (the self-test passed).');
  } else {
    for (const p of problems) console.error(`${p.page ? `${p.page.startsWith(HANDOVER_DIR) ? p.page : `${HANDOVER_DIR}/${p.page}`}:${p.line}` : HANDOVER_DIR}  ${p.message}  (${p.rule})`);
    if (problems.length) {
      console.error(`\nhandover.check: ${problems.length} problem(s) in ${pages} pages. The generated parts are rewritten by: npm run handover:build`);
      process.exit(1);
    }
    console.log(`handover.check: ${pages} pages, the generated blocks match the code, and the rules hold.`);
  }
}

