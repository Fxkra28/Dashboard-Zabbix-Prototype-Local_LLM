import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * tools/check/parity.check.mjs, and the documents that count what it lists.
 *
 * The script is what says whether the two copies still match, and CI runs only its self-test, so
 * this holds the rules it keeps: the list names files, not folders, a listed file must be in both
 * copies, and README_copy.md has one allowed place. It also keeps the numbers the documents state
 * (18 files, 22 with the .env files) equal to the list, so they cannot drift apart.
 */
const repo = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(repo(rel), 'utf8');

interface Parity {
  PER_COPY_FILES: string[];
  ENV_FILES: string[];
  ONE_COPY_ONLY: Record<string, string[]>;
  OWN_ROOT_DIRS: Set<string>;
  compareTrees(a: string, b: string): string[];
  staleListEntries(root: string): string[];
  selfTest(): string[];
}
const parity = (await import(pathToFileURL(repo('tools/check/parity.check.mjs')).href)) as Parity;

const scratch = mkdtempSync(join(tmpdir(), 'parity-script-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A tree named like a real copy, under its own folder so two cases never share one. */
function tree(label: string, name: string, files: Record<string, string>): string {
  const root = join(scratch, label, name);
  mkdirSync(root, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const pair = (label: string, hosted: Record<string, string>, local: Record<string, string>) =>
  parity.compareTrees(tree(label, 'hcml-portal', hosted), tree(label, 'hcml-portal-ollama', local));

const code = { 'server/src/a.ts': 'one' };

describe('parity.check.mjs: what it reports', () => {
  it('passes its own self-test', () => {
    expect(parity.selfTest()).toEqual([]);
  });

  it('lets a listed file differ, and reports it when one copy no longer has it', () => {
    expect(pair('listed-differs', { ...code, 'docs/index.md': 'a' }, { ...code, 'docs/index.md': 'b' })).toEqual([]);
    expect(pair('listed-missing', { ...code, 'docs/index.md': 'a' }, code)).toEqual(['only in hcml-portal: docs/index.md']);
  });

  // The list names files, not the folders docs/flow/ and docs/schema/: a folder would let a
  // one-sided edit to a diagram meant to match go unseen.
  it('reports a one-sided edit to a diagram that is meant to match, and a new file in a per-copy folder', () => {
    const found = pair(
      'folder',
      { ...code, 'docs/flow/ServerFlow.mmd': 'a', 'docs/flow/DataFlow.mmd': 'a', 'docs/schema/extra.mmd': 'a' },
      { ...code, 'docs/flow/ServerFlow.mmd': 'b', 'docs/flow/DataFlow.mmd': 'b' },
    );
    expect(found).toEqual(['differs: docs/flow/ServerFlow.mmd', 'only in hcml-portal: docs/schema/extra.mmd']);
  });

  it('allows README_copy.md in docs/ of the ollama copy, and nowhere else', () => {
    const note = 'docs/README_copy.md';
    expect(pair('note-home', code, { ...code, [note]: 'x' })).toEqual([]);
    expect(pair('note-hosted', { ...code, [note]: 'x' }, code)).toEqual([`only in hcml-portal, meant for hcml-portal-ollama: ${note}`]);
    expect(pair('note-both', { ...code, [note]: 'x' }, { ...code, [note]: 'x' })).toEqual([`in both copies, meant for hcml-portal-ollama only: ${note}`]);
    // Back at the root, where it made the documented count 22, it is reported again.
    expect(pair('note-root', code, { ...code, 'README_copy.md': 'x' })).toEqual(['only in hcml-portal-ollama: README_copy.md']);
  });

  it('skips the screenshots folder pic/ at the root, and nothing called pic anywhere else', () => {
    expect([...parity.OWN_ROOT_DIRS]).toEqual(['pic']);
    expect(pair('shots', { ...code, 'pic/09/a.png': 'a' }, { ...code, 'pic/09/a.png': 'b', 'pic/10/c.png': 'c' })).toEqual([]);
    expect(pair('shots-nested', { ...code, 'web/src/pic/a.ts': 'a' }, { ...code, 'web/src/pic/a.ts': 'b' })).toEqual(['differs: web/src/pic/a.ts']);
  });

  it('reports a list entry that names nothing in the tree it runs in, which is all CI can check', () => {
    const listed = Object.fromEntries(parity.PER_COPY_FILES.map((f) => [f, 'x']));
    expect(parity.staleListEntries(tree('stale-ok', 'hcml-portal', listed))).toEqual([]);
    const renamed = { ...listed };
    delete renamed['docs/index.md'];
    expect(parity.staleListEntries(tree('stale-renamed', 'hcml-portal', { ...renamed, 'docs/home.md': 'x' }))).toEqual([
      'on the list of files meant to differ, but not in hcml-portal: docs/index.md',
    ]);
  });
});

describe('parity.check.mjs: its list', () => {
  it('names files, never folders or patterns', () => {
    for (const rel of parity.PER_COPY_FILES) {
      expect(rel, rel).toMatch(/^[\w./-]+\.\w+$/);
      expect(rel.endsWith('/'), rel).toBe(false);
    }
    expect(new Set(parity.PER_COPY_FILES).size).toBe(parity.PER_COPY_FILES.length);
  });

  it('names only files that are in this tree, so a rename cannot leave it pointing at nothing', () => {
    expect(parity.staleListEntries(repo(''))).toEqual([]);
  });

  it('leaves README_copy.md out of the root of this copy, where it made the count 22', () => {
    expect(existsSync(repo('README_copy.md'))).toBe(false);
    expect(parity.ONE_COPY_ONLY['hcml-portal-ollama']).toEqual(['docs/README_copy.md']);
  });

  it('counts four .env files, which are skipped by name so that their differences never show', () => {
    expect(parity.ENV_FILES).toEqual(['.env', '.env.example', 'server/.env', 'server/.env.example']);
    const withEnv = (value: string) => ({ ...code, ...Object.fromEntries(parity.ENV_FILES.map((f) => [f, value])) });
    expect(pair('env', withEnv('hosted'), withEnv('local'))).toEqual([]);
  });
});

describe('the documents count what the script lists', () => {
  const perCopy = parity.PER_COPY_FILES.length;
  const withEnv = perCopy + parity.ENV_FILES.length;

  /** Every number a document states with this wording. At least one must be there: a reworded line fails here, not silently. */
  const numbers = (rel: string, re: RegExp): number[] => {
    const found = [...read(rel).matchAll(re)].map((m) => Number(m[1]));
    expect(found.length, `${rel} no longer says ${re}: update this test with the new wording`).toBeGreaterThan(0);
    return found;
  };

  it('says 22 files differ in README.md, the glossary of setup.md, ADR-0005 and contributing.md', () => {
    expect(withEnv).toBe(22);
    expect(numbers('README.md', /Exactly \*{0,2}(\d+) files\*{0,2} differ/g)).toEqual([withEnv]);
    expect(numbers('docs/setup/28-glossary.md', /Byte-identical source; (\d+) files differ/g)).toEqual([withEnv]);
    expect(numbers('docs/architecture/adr/0005-provider-neutral-ai-layer.md', /divergence is now (\d+) files/g)).toEqual([withEnv]);
    expect(numbers('docs/contributing.md', /exactly \*{0,2}(\d+)\*{0,2} differing files/g)).toEqual([withEnv]);
  });

  it('says 18 files are named in the script, in README.md and contributing.md', () => {
    expect(numbers('README.md', /with the (\d+) files that may differ \(/g)).toEqual([perCopy]);
    expect(numbers('docs/contributing.md', /by name: (\d+) files, and the four/g)).toEqual([perCopy]);
    expect(numbers('docs/contributing.md', /names its (\d+) files one by one/g)).toEqual([perCopy]);
    expect(numbers('docs/contributing.md', /the (\d+) files the script lists/g)).toEqual([perCopy]);
  });

  it('points at README_copy.md where it now is', () => {
    const text = read('docs/contributing.md');
    expect(text).toContain('Only in ../hcml-portal-ollama/docs: README_copy.md');
    expect(text).not.toContain('Only in ../hcml-portal-ollama: README_copy.md');
  });
});
