/**
 * What the handbook covers: which files get a card, which folders get a description, and what is never listed.
 *
 * Pure functions over a directory tree, shared by the generator (tools/handover/build.mjs) and the checker
 * (tools/check/handover.check.mjs), so the two cannot disagree about the set they count.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

/** Never entered or listed: dependencies, build output, version control, and each copy's own screenshots. */
export const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.vite', '__pycache__']);

/** Files that exist in one working copy and not in the other, or hold an address or a secret: never listed. */
export const NEVER_LISTED = new Set(['.DS_Store', 'docker-compose.override.yml', 'api-timing.json', '.test-counts.json']);
export const isNeverListed = (name) => NEVER_LISTED.has(name) || name.startsWith('.env') && name !== '.env.example' || name.endsWith('.tsbuildinfo') || name.startsWith('HCML_SLA_Report_');

/** The folder at the root that holds each copy's own screenshots. It differs by design and is not committed. */
export const OWN_ROOT_DIRS = new Set(['pic']);

/** Files meant to differ between the two copies (parity.check.mjs): listed by name, never by size. */
export { PER_COPY_FILES } from '../../check/parity.check.mjs';

/** Code, by extension. Everything else that is not Markdown is a configuration or data file. */
export const CODE_EXT = /\.(ts|tsx|mjs|js|py|sh|css)$/;
export const isTestFile = (rel) => /\.test\.(ts|tsx)$/.test(rel) || rel.split('/').includes('__tests__');

/** The roots whose code files each get a card, and the area (a page of cards) each belongs to. */
export const CARD_ROOTS = [
  { root: 'server/src', area: 'server' },
  { root: 'server/scripts', area: 'server' },
  { root: 'web/src', area: 'web' },
  { root: 'web/scripts', area: 'web' },
  { root: 'tools', area: 'tools' },
  { root: 'deploy', area: 'tools' },
];

/** Code files outside those roots that are still part of the build: configuration written in code. */
export const CARD_EXTRA = [
  'server/vitest.config.ts',
  'server/eslint.config.js',
  'web/vite.config.ts',
  'web/vitest.config.ts',
  'web/eslint.config.js',
  'web/public/theme.js',
];

/** Files under a card root that are not authored code: generated output. They get a card that says so. */
export const GENERATED_FILES = new Set(['web/src/generated/openapi.ts']);

/** Every file under `dir`, as sorted posix paths relative to `root`. Skips dependencies, build output and never-listed names. */
export function walk(root, dir = '', { includeOwn = false } = {}) {
  const out = [];
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || isNeverListed(entry.name)) continue;
    if (dir === '' && !includeOwn && OWN_ROOT_DIRS.has(entry.name) && entry.isDirectory()) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(root, rel, { includeOwn }));
    else out.push(rel);
  }
  return out.sort();
}

/** Every directory under `dir`, as sorted posix paths relative to `root`. */
export function walkDirs(root, dir = '') {
  const out = [];
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (dir === '' && OWN_ROOT_DIRS.has(entry.name)) continue;
    out.push(rel, ...walkDirs(root, rel));
  }
  return out.sort();
}

/** The files that get a card: authored or generated code under the card roots, tests left out. */
export function cardFiles(root) {
  const files = new Set(CARD_EXTRA.filter((rel) => existsSync(join(root, rel))));
  for (const { root: base } of CARD_ROOTS) {
    for (const rel of walk(root, base)) {
      if (CODE_EXT.test(rel) && !isTestFile(rel)) files.add(rel);
    }
  }
  return [...files].sort();
}

/** The page of cards a file belongs to: server, web or tools. */
export function areaOf(rel) {
  if (rel.startsWith('server/')) return 'server';
  if (rel.startsWith('web/')) return 'web';
  return 'tools';
}

/** The test files (beside the code or under __tests__), for relating tests to the code they cover. */
export function testFiles(root) {
  const out = [];
  for (const base of ['server/src', 'web/src']) {
    for (const rel of walk(root, base)) {
      if (/\.test\.(ts|tsx)$/.test(rel)) out.push(rel);
    }
  }
  return out.sort();
}

/**
 * The folders that get a description: every directory under the source roots, and the named top-level ones. The docs
 * folder is described one level down; what sits deeper is named in the description of its parent.
 */
export function folderCards(root) {
  const fixed = [
    'server', 'server/scripts', 'web', 'web/scripts', 'web/public', 'web/brand', 'tools', 'tools/check', 'tools/live',
    'tools/handover', 'tools/handover/lib', 'deploy', 'docs', '.github', '.github/workflows',
  ];
  const set = new Set(fixed.filter((rel) => existsSync(join(root, rel))));
  for (const base of ['server/src', 'web/src']) {
    set.add(base);
    for (const rel of walkDirs(root, base)) set.add(rel);
  }
  if (existsSync(join(root, 'docs'))) {
    for (const entry of readdirSync(join(root, 'docs'), { withFileTypes: true })) {
      if (entry.isDirectory()) set.add(`docs/${entry.name}`);
    }
  }
  return [...set].sort();
}

/** `a/b/c.ts` -> `a/b`. */
export const dirOf = (rel) => posix.dirname(rel);

export const isDir = (abs) => {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
};
