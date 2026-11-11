/**
 * Every diagram source still matches the render that sits beside it.
 *
 * The PDFs and PNGs under docs/ are committed renders of the `.mmd` files next to them, and nothing
 * else ties a picture to its source. When this was added, nine renders in one copy and eight in the
 * other were older than their sources by file date, and the picture a reader opens said nothing about
 * it. A file date cannot settle this: a git checkout gives every file the time of the checkout. So each
 * source ends with a stamp, `%% source-hash: <12 hex>`, the SHA-256 of the source without that line,
 * and this fails when the two differ: the source was edited after the stamp was set.
 *
 * What it proves: the source has not changed since `diagrams.stamp.mjs` last ran, every source has a
 * PDF beside it, and no render is left without its source. What it cannot prove: that the render was
 * made after the edit. The stamp is the person's word that it was, which is why stamping is a separate
 * step, run last, after the re-render (the invocations are in docs/contributing.md).
 *
 *   node tools/check/diagrams.check.mjs [repo root]   (default: two levels up)
 *
 * Read-only. The stamping script is the one that writes.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
/** The folder at the root that holds each copy's own screenshots, which are not diagrams. */
const OWN_ROOT_DIRS = new Set(['pic']);

export const STAMP_PREFIX = '%% source-hash: ';
const isStamp = (line) => line.startsWith(STAMP_PREFIX);

/** The source as it is hashed: LF line ends, no stamp line, exactly one final newline. */
export function bodyOf(text) {
  const kept = text.replace(/\r\n?/g, '\n').split('\n').filter((line) => !isStamp(line));
  return `${kept.join('\n').replace(/\n+$/, '')}\n`;
}

export const hashOf = (text) => createHash('sha256').update(bodyOf(text)).digest('hex').slice(0, 12);

/** `text` with its stamp set to the hash of the rest, as the last line. Keeps the file's own line ends. */
export function stamped(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const body = bodyOf(text).replace(/\n/g, eol);
  return `${body}${STAMP_PREFIX}${hashOf(text)}${eol}`;
}

/** What the stamp in `text` says: 'fresh', 'stale' (edited since), 'unstamped' or 'duplicated'. */
export function stampState(text) {
  const stamps = text.replace(/\r\n?/g, '\n').split('\n').filter(isStamp);
  if (stamps.length === 0) return { state: 'unstamped' };
  if (stamps.length > 1) return { state: 'duplicated' };
  const recorded = stamps[0].slice(STAMP_PREFIX.length).trim();
  const actual = hashOf(text);
  return { state: recorded === actual ? 'fresh' : 'stale', recorded, actual };
}

/** Every file under `root` whose name ends in one of `endings`, as absolute paths. */
export function filesEndingIn(root, endings) {
  const out = [];
  const walk = (dir, atRoot) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || (atRoot && OWN_ROOT_DIRS.has(entry.name))) continue;
        walk(join(dir, entry.name), false);
      } else if (endings.some((e) => entry.name.endsWith(e))) {
        out.push(join(dir, entry.name));
      }
    }
  };
  walk(root, true);
  return out.sort();
}

/** The problems under `root`, one line each, and how many sources were looked at. */
export function checkDiagrams(root) {
  const problems = [];
  const sources = filesEndingIn(root, ['.mmd']);
  const dirsWithSources = new Set(sources.map((s) => dirname(s)));
  for (const source of sources) {
    const rel = relative(root, source);
    const { state, recorded, actual } = stampState(readFileSync(source, 'utf8'));
    if (state === 'unstamped') problems.push(`${rel}: has no source-hash stamp`);
    if (state === 'duplicated') problems.push(`${rel}: has more than one source-hash stamp`);
    if (state === 'stale') problems.push(`${rel}: edited after its stamp was set (stamp ${recorded}, source ${actual})`);
    if (!existsSync(`${source.slice(0, -'.mmd'.length)}.pdf`)) problems.push(`${rel}: has no PDF render beside it`);
  }
  // A render in a folder that holds diagram sources, with no source of its own, can never be checked.
  for (const render of filesEndingIn(root, ['.pdf', '.png'])) {
    if (!dirsWithSources.has(dirname(render))) continue;
    if (!existsSync(`${render.slice(0, render.lastIndexOf('.'))}.mmd`)) problems.push(`${relative(root, render)}: has no .mmd source beside it`);
  }
  return { sources: sources.length, problems };
}

/** The self-test: a stamp that can never fail checks nothing. Returns what went wrong, one line each. */
export function selfTest() {
  const sample = '---\ntitle: "Sample"\n---\nflowchart LR\n    A --> B\n';
  const cases = [
    ['an unstamped source says so', () => stampState(sample).state, 'unstamped'],
    ['a stamped source is fresh', () => stampState(stamped(sample)).state, 'fresh'],
    ['stamping twice changes nothing', () => stamped(stamped(sample)), stamped(sample)],
    ['the stamp is the last line', () => stamped(sample).split('\n').slice(-2, -1)[0].startsWith(STAMP_PREFIX), true],
    ['one changed character makes it stale', () => stampState(stamped(sample).replace('A --> B', 'A --> C')).state, 'stale'],
    ['a changed label makes it stale', () => stampState(stamped(sample).replace('Sample', 'Other')).state, 'stale'],
    ['a second stamp is reported', () => stampState(`${stamped(sample)}${STAMP_PREFIX}000000000000\n`).state, 'duplicated'],
    ['a wrong stamp is stale, not fresh', () => stampState(`${sample}${STAMP_PREFIX}000000000000\n`).state, 'stale'],
    ['CRLF line ends hash like LF', () => hashOf(sample.replace(/\n/g, '\r\n')), hashOf(sample)],
    ['a CRLF file stays CRLF when stamped', () => stamped(sample.replace(/\n/g, '\r\n')).includes('\r\n'), true],
    ['trailing blank lines do not count', () => hashOf(`${sample}\n\n`), hashOf(sample)],
    ['text after the stamp still counts', () => stampState(`${stamped(sample)}A --> D\n`).state, 'stale'],
  ];
  return cases.flatMap(([name, run, expected]) => {
    const got = run();
    return got === expected ? [] : [`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`];
  });
}

// Run as a script only: the stamping script and the tests import the functions above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const broken = selfTest();
  if (broken.length) {
    for (const b of broken) console.error(`diagrams.check self-test failed: ${b}`);
    process.exit(1);
  }
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  if (!statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`);
  const { sources, problems } = checkDiagrams(root);
  for (const p of problems) console.error(p);
  if (problems.length) {
    console.error(
      `\ndiagrams.check: ${problems.length} problem(s) in ${sources} diagram sources. After a re-render, run: node tools/check/diagrams.stamp.mjs`,
    );
    process.exit(1);
  }
  console.log(`diagrams.check: ${sources} diagram sources, every stamp matches and every one has a PDF.`);
}
