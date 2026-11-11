import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * tools/check/diagrams.check.mjs and diagrams.stamp.mjs: a diagram source carries a stamp of its own
 * hash, the check fails when the source changed after it, and only the stamp script writes one.
 * CI runs the check on the tree it holds; this keeps the rules, and runs the check on this copy, so a
 * source edited without a stamp fails `npm test` here before it fails there.
 */
const repo = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));

interface Diagrams {
  STAMP_PREFIX: string;
  hashOf(text: string): string;
  stamped(text: string): string;
  stampState(text: string): { state: string };
  checkDiagrams(root: string): { sources: number; problems: string[] };
  selfTest(): string[];
}
const diagrams = (await import(pathToFileURL(repo('tools/check/diagrams.check.mjs')).href)) as Diagrams;
const stampScript = repo('tools/check/diagrams.stamp.mjs');

const scratch = mkdtempSync(join(tmpdir(), 'diagrams-check-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SOURCE = '---\ntitle: "Sample"\n---\nflowchart LR\n    A --> B\n';

/** A tree of files under its own folder, so two cases never share one. */
function tree(label: string, files: Record<string, string>): string {
  const root = join(scratch, label);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const at = (path: string, seconds: number) => utimesSync(path, seconds, seconds);
const stamp = (root: string, ...args: string[]) => spawnSync(process.execPath, [stampScript, root, ...args], { encoding: 'utf8' });

describe('diagrams.check.mjs: the stamp', () => {
  it('passes its own self-test', () => {
    expect(diagrams.selfTest()).toEqual([]);
  });

  it('ends a source with the hash of everything before it', () => {
    const text = diagrams.stamped(SOURCE);
    expect(text).toBe(`${SOURCE}${diagrams.STAMP_PREFIX}${diagrams.hashOf(SOURCE)}\n`);
    expect(diagrams.hashOf(SOURCE)).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is fresh for a stamped source and stale for any edit after it, even to a label', () => {
    const text = diagrams.stamped(SOURCE);
    expect(diagrams.stampState(text).state).toBe('fresh');
    expect(diagrams.stampState(text.replace('Sample', 'Other')).state).toBe('stale');
    expect(diagrams.stampState(text.replace('A --> B', 'A --> B\n    B --> C')).state).toBe('stale');
  });
});

describe('diagrams.check.mjs: a tree', () => {
  it('passes when every source is stamped and has its PDF', () => {
    const root = tree('ok', { 'docs/a/X.mmd': diagrams.stamped(SOURCE), 'docs/a/X.pdf': 'pdf', 'docs/a/X.png': 'png' });
    expect(diagrams.checkDiagrams(root)).toEqual({ sources: 1, problems: [] });
  });

  it('names a source edited after its stamp, one with no stamp, and one with no PDF', () => {
    const root = tree('bad', {
      'docs/stale/S.mmd': diagrams.stamped(SOURCE).replace('A --> B', 'A --> Z'),
      'docs/stale/S.pdf': 'pdf',
      'docs/bare/B.mmd': SOURCE,
      'docs/bare/B.pdf': 'pdf',
      'docs/nopdf/N.mmd': diagrams.stamped(SOURCE),
    });
    const { sources, problems } = diagrams.checkDiagrams(root);
    expect(sources).toBe(3);
    expect(problems.sort()).toEqual([
      expect.stringMatching(/^docs\/bare\/B\.mmd: has no source-hash stamp$/),
      expect.stringMatching(/^docs\/nopdf\/N\.mmd: has no PDF render beside it$/),
      expect.stringMatching(/^docs\/stale\/S\.mmd: edited after its stamp was set \(stamp [0-9a-f]{12}, source [0-9a-f]{12}\)$/),
    ]);
  });

  it('reports a render with no source beside it, only in a folder that holds sources', () => {
    const root = tree('orphan', {
      'docs/a/X.mmd': diagrams.stamped(SOURCE),
      'docs/a/X.pdf': 'pdf',
      'docs/a/Old.pdf': 'a render whose source was renamed',
      'docs/b/Logo.png': 'not a diagram: no source in this folder',
    });
    expect(diagrams.checkDiagrams(root).problems).toEqual(['docs/a/Old.pdf: has no .mmd source beside it']);
  });

  it('leaves out node_modules, dist, .git and the root pic folder of screenshots', () => {
    const root = tree('skipped', {
      'docs/a/X.mmd': diagrams.stamped(SOURCE),
      'docs/a/X.pdf': 'pdf',
      'node_modules/p/Y.mmd': 'x',
      'web/dist/Z.mmd': 'x',
      'pic/09/shot.mmd': 'x',
    });
    expect(diagrams.checkDiagrams(root)).toEqual({ sources: 1, problems: [] });
  });

  it('holds for the diagram sources of this copy', () => {
    const { sources, problems } = diagrams.checkDiagrams(repo(''));
    expect(sources).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});

describe('diagrams.stamp.mjs', () => {
  const NOW = Math.floor(Date.now() / 1000);

  it('stamps a source whose PDF is as new as it, changes only the last line, and leaves a current one alone', () => {
    const root = tree('stamp-ok', { 'docs/a/X.mmd': SOURCE, 'docs/a/X.pdf': 'pdf', 'docs/a/Y.mmd': diagrams.stamped(SOURCE), 'docs/a/Y.pdf': 'pdf' });
    at(join(root, 'docs/a/X.mmd'), NOW - 100);
    at(join(root, 'docs/a/X.pdf'), NOW - 50);
    at(join(root, 'docs/a/Y.mmd'), NOW - 100);
    const before = statSync(join(root, 'docs/a/Y.mmd')).mtimeMs;

    const run = stamp(root);
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/stamped docs\/a\/X\.mmd/);
    expect(run.stdout).toMatch(/1 stamped, 1 already current/);
    expect(readFileSync(join(root, 'docs/a/X.mmd'), 'utf8')).toBe(diagrams.stamped(SOURCE));
    expect(statSync(join(root, 'docs/a/Y.mmd')).mtimeMs).toBe(before);
    expect(diagrams.checkDiagrams(root).problems).toEqual([]);
  });

  it('refuses a source whose PDF is older than it, since that is an edit nobody re-rendered', () => {
    const root = tree('stamp-old-pdf', { 'docs/a/X.mmd': SOURCE, 'docs/a/X.pdf': 'pdf' });
    at(join(root, 'docs/a/X.pdf'), NOW - 100);
    at(join(root, 'docs/a/X.mmd'), NOW - 10);

    const run = stamp(root);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/docs\/a\/X\.mmd: its PDF is missing or older than the source/);
    expect(readFileSync(join(root, 'docs/a/X.mmd'), 'utf8')).toBe(SOURCE);
  });

  it('refuses a source with no PDF, and stamps either with --force', () => {
    const root = tree('stamp-no-pdf', { 'docs/a/X.mmd': SOURCE });
    expect(stamp(root).status).toBe(1);
    expect(readFileSync(join(root, 'docs/a/X.mmd'), 'utf8')).toBe(SOURCE);

    const forced = stamp(root, '--force');
    expect(forced.status).toBe(0);
    expect(readFileSync(join(root, 'docs/a/X.mmd'), 'utf8')).toBe(diagrams.stamped(SOURCE));
  });

  it('keeps going past a refused source, so one stale render does not hide the rest', () => {
    const root = tree('stamp-mixed', { 'docs/a/X.mmd': SOURCE, 'docs/a/X.pdf': 'pdf', 'docs/b/N.mmd': SOURCE });
    at(join(root, 'docs/a/X.mmd'), NOW - 100);
    at(join(root, 'docs/a/X.pdf'), NOW - 50);

    const run = stamp(root);
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/1 stamped, 0 already current, 1 refused/);
    expect(readFileSync(join(root, 'docs/a/X.mmd'), 'utf8')).toBe(diagrams.stamped(SOURCE));
    expect(readFileSync(join(root, 'docs/b/N.mmd'), 'utf8')).toBe(SOURCE);
  });
});
