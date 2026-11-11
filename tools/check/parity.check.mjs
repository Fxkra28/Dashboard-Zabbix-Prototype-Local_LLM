/**
 * The two copies of the portal hold the same code (docs/contributing.md). This lists every
 * file that differs between them, or exists in one only, that is not on the short list of
 * files meant to differ.
 *
 *   node tools/check/parity.check.mjs [this tree] [the other tree]
 *
 * With no arguments it compares this tree with its sibling: hcml-portal with
 * hcml-portal-ollama, and the reverse. Where there is no sibling, as in CI, which holds one
 * tree, it runs its own checks, confirms that every file on the list is really in this tree,
 * and says it compared nothing.
 *
 * The list names each file. A folder is not on it: a one-sided edit to a diagram or a PDF
 * that is meant to match, next to one that is meant to differ, would otherwise go unseen.
 * A file on the list must exist in both copies, so deleting one from a copy is reported too.
 * docs/contributing.md and both READMEs count the list (18 files, 22 with the four `.env*`
 * files); a test keeps those numbers equal to the ones below.
 *
 * One folder is skipped whole: `pic/` at the root, the screenshots each copy's running portal
 * gives for the documents (`pic/09` for September). They differ by design and hold no code. Only
 * the root one: a folder called pic anywhere else is code, and is compared.
 *
 * Read-only. `.env*` files are skipped without being opened: they hold secrets, and they
 * differ by design. node_modules, dist, .git, .DS_Store, *.tsbuildinfo and .test-counts.json (what the last
 * test run of each copy wrote, so it differs by time) are skipped as contributing.md's `diff` command skips them.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
/** Folders skipped only when they sit at the root: each copy's own screenshots, which show real host names and are not committed. */
export const OWN_ROOT_DIRS = new Set(['pic']);
const skipFile = (name) => name === '.DS_Store' || name === '.test-counts.json' || name.endsWith('.tsbuildinfo') || name.startsWith('.env');

/** Files meant to differ between the copies, each in both: the copy's own configuration and perspective. */
export const PER_COPY_FILES = [
  'AUDIT_REPORT.md',
  'README.md',
  'docker-compose.yml',
  'docs/api/openapi.yaml',
  'docs/architecture/adr/0005-provider-neutral-ai-layer.md',
  'docs/flow/DataFlow.mmd',
  'docs/flow/DataFlow.pdf',
  'docs/flow/README.md',
  'docs/index.md',
  'docs/schema/CDM.mmd',
  'docs/schema/CDM.pdf',
  'docs/schema/ERD.mmd',
  'docs/schema/ERD.pdf',
  'docs/schema/PDM.mmd',
  'docs/schema/PDM.pdf',
  'docs/schema/README.md',
  'docs/setup/11-running-deploying.md',
  'docs/setup/19-authentication-rbac.md',
];
/** The `.env*` files that differ by design. Skipped by name and never opened; listed so the count can be stated. */
export const ENV_FILES = ['.env', '.env.example', 'server/.env', 'server/.env.example'];
/** Files that belong to one copy only, by the name of its folder. A stale snapshot of its README. */
export const ONE_COPY_ONLY = { 'hcml-portal-ollama': ['docs/README_copy.md'] };

const PER_COPY = new Set(PER_COPY_FILES);
const ownerOf = (rel) => Object.keys(ONE_COPY_ONLY).find((name) => ONE_COPY_ONLY[name].includes(rel));

/** Every file under `root`, as sorted paths relative to it with forward slashes. */
export function filesUnder(root) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // By name first: a node_modules linked in from elsewhere is a symlink, not a directory.
      if (SKIP_DIRS.has(entry.name)) continue;
      if (prefix === '' && entry.isDirectory() && OWN_ROOT_DIRS.has(entry.name)) continue;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (!skipFile(entry.name)) {
        out.push(`${prefix}${entry.name}`);
      }
    }
  };
  walk(root, '');
  return out.sort();
}

/** Differences between two trees that are not on the allowed list, one line each. */
export function compareTrees(a, b) {
  const nameA = basename(a);
  const nameB = basename(b);
  const inA = new Set(filesUnder(a));
  const inB = new Set(filesUnder(b));
  const problems = [];
  for (const rel of [...new Set([...inA, ...inB])].sort()) {
    const owner = ownerOf(rel);
    if (owner) {
      // Allowed in its own copy, and only there.
      const where = [inA.has(rel) && nameA, inB.has(rel) && nameB].filter(Boolean);
      if (where.length === 1 && where[0] === owner) continue;
      problems.push(where.length === 2 ? `in both copies, meant for ${owner} only: ${rel}` : `only in ${where[0]}, meant for ${owner}: ${rel}`);
    } else if (!inB.has(rel)) {
      problems.push(`only in ${nameA}: ${rel}`);
    } else if (!inA.has(rel)) {
      problems.push(`only in ${nameB}: ${rel}`);
    } else if (!PER_COPY.has(rel) && !readFileSync(join(a, rel)).equals(readFileSync(join(b, rel)))) {
      problems.push(`differs: ${rel}`);
    }
  }
  return problems;
}

/** Entries of the list of files meant to differ that are not in `root`: the list has gone stale, for example after a rename. */
export function staleListEntries(root) {
  const here = new Set(filesUnder(root));
  const own = ONE_COPY_ONLY[basename(root)] ?? [];
  return [...PER_COPY_FILES, ...own].filter((rel) => !here.has(rel)).map((rel) => `on the list of files meant to differ, but not in ${basename(root)}: ${rel}`);
}

/**
 * Self-test on small trees made for the purpose, named like the real copies because the
 * one-copy-only rule goes by the folder's name. Returns what failed, one line each.
 */
export function selfTest() {
  const failures = [];
  const scratch = mkdtempSync(join(tmpdir(), 'parity-check-'));
  const tree = (label, name, files) => {
    const root = join(scratch, label, name);
    mkdirSync(root, { recursive: true });
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    return root;
  };
  const expectEqual = (label, found, expected) => {
    if (JSON.stringify(found) !== JSON.stringify(expected)) {
      failures.push(`parity.check self-test failed (${label}): expected ${JSON.stringify(expected)}, found ${JSON.stringify(found)}`);
    }
  };
  const check = (label, left, right, expected, prepare) => {
    const a = tree(label, 'hcml-portal', left);
    const b = tree(label, 'hcml-portal-ollama', right);
    prepare?.(a, b);
    expectEqual(label, compareTrees(a, b), expected);
  };
  try {
    const code = { 'server/src/a.ts': 'one', 'web/src/b.ts': 'two' };
    check('same', code, code, []);
    check('code-differs', code, { ...code, 'server/src/a.ts': 'changed' }, ['differs: server/src/a.ts']);
    check('missing', code, { 'server/src/a.ts': 'one' }, ['only in hcml-portal: web/src/b.ts']);
    // The same file missing from the first tree instead.
    check('missing-first', { 'server/src/a.ts': 'one' }, code, ['only in hcml-portal-ollama: web/src/b.ts']);

    // The files on the list may differ, each by its name.
    const perCopy = ['README.md', 'docker-compose.yml', 'docs/flow/DataFlow.mmd', 'docs/flow/README.md', 'docs/schema/PDM.pdf', 'docs/setup/11-running-deploying.md'];
    check('allowed', { ...code, ...Object.fromEntries(perCopy.map((f) => [f, 'x'])) }, { ...code, ...Object.fromEntries(perCopy.map((f) => [f, 'y'])) }, []);
    // A file on the list that one copy no longer has is a one-sided change, not a difference by design.
    check('listed-missing', { ...code, 'README.md': 'x' }, code, ['only in hcml-portal: README.md']);
    // A folder is not on the list: its other files, and new ones, must match.
    check(
      'folder-not-listed',
      { ...code, 'docs/flow/ServerFlow.mmd': 'x', 'docs/flow/DataFlow.mmd': 'x', 'docs/schema/new.mmd': 'x' },
      { ...code, 'docs/flow/ServerFlow.mmd': 'y', 'docs/flow/DataFlow.mmd': 'y' },
      ['differs: docs/flow/ServerFlow.mmd', 'only in hcml-portal: docs/schema/new.mmd'],
    );
    // A name that only starts like a listed one is not it.
    check('lookalike', { ...code, 'docs/flowchart.md': 'x', 'README.md.bak': 'x' }, { ...code, 'docs/flowchart.md': 'y', 'README.md.bak': 'y' }, ['differs: README.md.bak', 'differs: docs/flowchart.md']);

    // README_copy.md: allowed in the ollama copy under docs/, and nowhere else.
    const note = 'docs/README_copy.md';
    check('copy-note-home', code, { ...code, [note]: 'x' }, []);
    check('copy-note-wrong-copy', { ...code, [note]: 'x' }, code, [`only in hcml-portal, meant for hcml-portal-ollama: ${note}`]);
    check('copy-note-both', { ...code, [note]: 'x' }, { ...code, [note]: 'x' }, [`in both copies, meant for hcml-portal-ollama only: ${note}`]);
    check('copy-note-at-root', code, { ...code, 'README_copy.md': 'x' }, ['only in hcml-portal-ollama: README_copy.md']);

    check(
      'skipped',
      { ...code, '.env': 'a', 'server/.env.example': 'a', 'node_modules/p/i.js': 'a', 'web/dist/i.js': 'a', '.DS_Store': 'a', 'x.tsbuildinfo': 'a', 'server/.test-counts.json': 'a' },
      { ...code, '.env': 'b', 'server/.env.example': 'b', 'node_modules/p/i.js': 'b', 'web/dist/i.js': 'b', '.DS_Store': 'b', 'x.tsbuildinfo': 'b', 'web/.test-counts.json': 'b' },
      [],
    );
    // pic/ at the root holds each copy's own screenshots: they may differ, or exist in one copy only.
    check('screenshots', { ...code, 'pic/09/01-login.png': 'a' }, { ...code, 'pic/09/01-login.png': 'b', 'pic/09/02-dashboard.png': 'c' }, []);
    // Only at the root. A folder called pic inside the code is code, and a file called pic is not the folder.
    check('pic-in-code', { ...code, 'web/src/pic/a.ts': 'x' }, { ...code, 'web/src/pic/a.ts': 'y' }, ['differs: web/src/pic/a.ts']);
    check('pic-is-a-file', { ...code, pic: 'x' }, { ...code, pic: 'y' }, ['differs: pic']);

    // A node_modules linked in from elsewhere is a symlink, which readdir does not call a directory.
    const store = tree('store', 'pkg', { 'i.js': 'a' });
    const link = (root) => symlinkSync(store, join(root, 'web/node_modules'), 'junction');
    check('linked-one', code, code, [], (a) => link(a));
    check('linked-both', code, code, [], (a, b) => {
      link(a);
      link(b);
    });

    // The list itself: no repeats, and every `.env*` entry is one the walk really skips.
    expectEqual('list has no repeats', PER_COPY_FILES.length, new Set(PER_COPY_FILES).size);
    expectEqual('env files are skipped by name', ENV_FILES.filter((f) => !skipFile(basename(f))), []);
    // Entries that name nothing in the tree are reported, in either copy.
    const listed = Object.fromEntries(PER_COPY_FILES.map((f) => [f, 'x']));
    expectEqual('list is current', staleListEntries(tree('stale-ok', 'hcml-portal', listed)), []);
    expectEqual('list is current (ollama)', staleListEntries(tree('stale-ok', 'hcml-portal-ollama', { ...listed, [note]: 'x' })), []);
    const withoutPart = Object.fromEntries(Object.entries(listed).filter(([f]) => f !== 'docs/setup/11-running-deploying.md'));
    expectEqual('list names a missing file', staleListEntries(tree('stale-bad', 'hcml-portal', withoutPart)), [
      'on the list of files meant to differ, but not in hcml-portal: docs/setup/11-running-deploying.md',
    ]);
    expectEqual('ollama note missing', staleListEntries(tree('stale-note', 'hcml-portal-ollama', listed)), [
      `on the list of files meant to differ, but not in hcml-portal-ollama: ${note}`,
    ]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return failures;
}

// Run only when started from the command line, not when imported.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = selfTest();
  for (const f of failures) console.error(f);
  if (failures.length) process.exit(1);
  const here = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const stale = staleListEntries(here);
  for (const s of stale) console.error(s);
  if (stale.length) {
    console.error(`\nparity.check: ${stale.length} entr${stale.length === 1 ? 'y' : 'ies'} on the list of files meant to differ name nothing in ${basename(here)}. Update PER_COPY_FILES in this script.`);
    process.exit(1);
  }
  const sibling = join(dirname(here), basename(here) === 'hcml-portal-ollama' ? 'hcml-portal' : 'hcml-portal-ollama');
  const other = resolve(process.argv[3] ?? sibling);
  if (!existsSync(other) || !statSync(other).isDirectory()) {
    console.log(`parity.check: no other copy at ${other}, so nothing was compared (the self-test passed, and every file on the list is in ${basename(here)}).`);
  } else {
    const problems = compareTrees(here, other);
    for (const p of problems) console.error(p);
    if (problems.length) {
      console.error(`\nparity.check: ${problems.length} difference(s) between ${basename(here)} and ${basename(other)} that are not on the list of files meant to differ.`);
      process.exit(1);
    }
    console.log(
      `parity.check: ${basename(here)} and ${basename(other)} match, apart from the ${PER_COPY_FILES.length} files meant to differ ` +
        `(${PER_COPY_FILES.length + ENV_FILES.length} with the ${ENV_FILES.length} .env files, which are not opened).`,
    );
  }
}
