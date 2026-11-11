import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The handbook tools: tools/handover (the generator) and tools/check/handover.check.mjs (its checker).
 *
 * The checker is only worth running if it can fail, so most of this builds a small repository of its own, with the
 * server's TypeScript linked in, writes a handbook page, and shows that each thing the checker guards is caught. The last
 * group runs the checker on this tree, so a page that falls behind the code fails `npm test` here before it fails in CI.
 */
const repo = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const load = async <T>(rel: string) => (await import(pathToFileURL(repo(rel)).href)) as T;

interface Export {
  name: string;
  kind: string;
  line: number;
  signature: string;
  summary: string;
}
interface Parsed {
  exports: Export[];
  decls: Map<string, { startLine: number; endLine: number }>;
  imports: { spec: string; typeOnly: boolean; dynamic?: boolean; mock?: boolean }[];
  header: string;
}
interface Model {
  files: Map<string, { rel: string; exports: Export[]; imports: string[]; importedBy: string[]; testedBy: string[]; calledBy: string[]; endpoints: string[]; packages: string[] }>;
  tests: Map<string, { covers: string[]; tests: number }>;
}
interface ModelLib {
  loadTypescript(root: string): unknown;
  parseSource(ts: unknown, rel: string, text: string): Parsed;
  resolveImport(from: string, spec: string, known: Set<string>): string | null;
  packageOf(spec: string): string | null;
  firstSentence(comment: string): string;
  clip(text: string, max: number): string;
  countTests(text: string): number;
  routeEndpoints(text: string): string[];
  buildModel(root: string): Model;
  snippetHash(text: string): string;
}
interface BlocksLib {
  splitBlocks(text: string): { type: string; kind?: string; target?: string; options?: Record<string, string>; body?: string; line?: number }[];
  joinBlocks(parts: unknown[], render: (b: unknown) => { body: string; options?: Record<string, string> }): string;
  maskBlocks(text: string): string;
  parseArgs(text: string): { target: string; options: Record<string, string> };
}
interface DocLib {
  boxOf(text: string): { who: string; time: string; first: string; next: string } | null;
  readingTime(text: string): number;
  processDocument(model: Model, root: string, rel: string, text: string, opts?: { fill?: boolean; accept?: boolean }): { text: string; problems: { kind: string; message: string }[] };
  listPages(root: string): string[];
}
interface Problem {
  page: string | null;
  line: number;
  rule: string;
  message: string;
}
interface Checker {
  selfTest(): string[];
  checkHandbook(root: string): { problems: Problem[]; pages: number; skipped: boolean };
}

const modelLib = await load<ModelLib>('tools/handover/lib/model.mjs');
const blocks = await load<BlocksLib>('tools/handover/lib/blocks.mjs');
const docLib = await load<DocLib>('tools/handover/lib/document.mjs');
const checker = await load<Checker>('tools/check/handover.check.mjs');
const buildScript = repo('tools/handover/build.mjs');

const scratch = mkdtempSync(join(tmpdir(), 'handover-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A small repository: the files given, the build script's folder structure, and this tree's TypeScript linked in. */
function tree(label: string, files: Record<string, string>): string {
  const root = join(scratch, label);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  mkdirSync(join(root, 'server'), { recursive: true });
  writeFileSync(join(root, 'server/package.json'), '{"name":"scratch","type":"module"}');
  symlinkSync(repo('server/node_modules'), join(root, 'server/node_modules'), 'junction');
  return root;
}

const GATE = `/** Lets at most \`limit\` jobs run at once. The rest wait. */
export function createGate(limit: number): number {
  return limit + 1;
}

export const MAX = 5;
export interface Options { staleMs?: number }
export type Mode = 'a' | 'b';
function secret(): string {
  return 'private';
}
`;
/** An em dash, built here so this file holds none. */
const EM = String.fromCodePoint(0x2014);
const BOX = '| Who it is for | Reading time | Read first | Read next |\n|---|---|---|---|\n| Developers | about 1 min | none | none |\n';
const MANIFEST = (state: string, pages: string[]) => JSON.stringify({ parts: [{ id: 'code', dir: '', state, pages }] });

describe('handover tools: reading the code', () => {
  const ts = modelLib.loadTypescript(repo('.'));
  const parse = (rel: string, text: string) => modelLib.parseSource(ts, rel, text);

  it('finds each kind of export, with its line, its signature and the first sentence of its comment', () => {
    const p = parse('server/src/core/gate.ts', GATE);
    const byName = Object.fromEntries(p.exports.map((e) => [e.name, e]));
    expect(byName.createGate).toMatchObject({ kind: 'function', line: 2, signature: 'function createGate(limit: number): number', summary: 'Lets at most `limit` jobs run at once.' });
    expect(byName.MAX).toMatchObject({ kind: 'constant', signature: 'const MAX = 5' });
    expect(byName.Options.kind).toBe('interface');
    expect(byName.Mode.kind).toBe('type');
  });

  it('keeps a private helper out of the exports but lets a snippet quote it', () => {
    const p = parse('server/src/core/gate.ts', GATE);
    expect(p.exports.map((e) => e.name)).not.toContain('secret');
    expect(p.decls.has('secret')).toBe(true);
  });

  it('calls a use-prefixed function a hook and a capitalised one in a .tsx file a component', () => {
    const p = parse('web/src/x.tsx', 'export function useThing() { return 1; }\nexport function Thing() { return null; }\nexport function helper() { return 2; }\n');
    expect(Object.fromEntries(p.exports.map((e) => [e.name, e.kind]))).toEqual({ useThing: 'hook', Thing: 'component', helper: 'function' });
  });

  it('sees a dynamic import and a vi.mock as a use of the file they name', () => {
    const p = parse('web/src/App.tsx', "const A = lazy(() => import('./features/a/A'));\nvi.mock('../clients/zabbix.js', () => ({}));\nimport type { T } from './t';\n");
    const specs = p.imports.map((i) => `${i.spec}${i.dynamic ? ' dynamic' : ''}${i.mock ? ' mock' : ''}${i.typeOnly ? ' type' : ''}`);
    expect(specs).toEqual(expect.arrayContaining(['./t type', './features/a/A dynamic', '../clients/zabbix.js mock']));
  });

  it('resolves .js to .ts, a folder to its index, and leaves a package alone', () => {
    const known = new Set(['server/src/core/cache.ts', 'web/src/api/index.ts', 'web/src/x/Page.tsx']);
    expect(modelLib.resolveImport('server/src/services/a.ts', '../core/cache.js', known)).toBe('server/src/core/cache.ts');
    expect(modelLib.resolveImport('web/src/App.tsx', './api', known)).toBe('web/src/api/index.ts');
    expect(modelLib.resolveImport('web/src/App.tsx', './x/Page', known)).toBe('web/src/x/Page.tsx');
    expect(modelLib.resolveImport('web/src/App.tsx', 'react', known)).toBeNull();
    expect(modelLib.packageOf('@fastify/cookie/dist/x')).toBe('@fastify/cookie');
    expect(modelLib.packageOf('node:fs')).toBe('node:fs');
  });

  it('cuts a long signature at a space and counts tests of every spelling', () => {
    expect(modelLib.clip('one two three four five six', 20)).toBe('one two three...');
    expect(modelLib.countTests("it('a', () => {});\n  test.each([1])('b', () => {});\nit.skip('c', () => {});\n")).toBe(3);
    expect(modelLib.routeEndpoints("app.get('/api/a', h);\napp.post('/api/b?x=1', h);\n")).toEqual(['GET /api/a', 'POST /api/b']);
  });

  it('relates files to the files that import them and the tests that touch them', () => {
    const root = tree('model', {
      'server/src/core/cache.ts': "import './cache.js';\nexport const cache = 1;\n",
      'server/src/services/links.ts': "import { cache } from '../core/cache.js';\nexport const links = cache;\n",
      'server/src/routes/links.ts': "import { links } from '../services/links.js';\nexport async function linkRoutes(app: any) {\n  app.get('/api/links', () => links);\n}\n",
      'server/src/__tests__/cache.test.ts': "import { cache } from '../core/cache.js';\nit('a', () => cache);\n",
      'server/src/__tests__/routes.test.ts': "it('b', async () => { await get('/api/links'); });\n",
    });
    const model = modelLib.buildModel(root);
    // A file that imports itself is not one of its own importers.
    expect(model.files.get('server/src/core/cache.ts')?.importedBy).toEqual(['server/src/services/links.ts']);
    expect(model.files.get('server/src/core/cache.ts')?.testedBy).toEqual(['server/src/__tests__/cache.test.ts']);
    expect(model.files.get('server/src/routes/links.ts')?.endpoints).toEqual(['GET /api/links']);
    expect(model.files.get('server/src/routes/links.ts')?.calledBy).toEqual(['server/src/__tests__/routes.test.ts']);
    expect(model.tests.get('server/src/__tests__/cache.test.ts')?.covers).toEqual(['server/src/core/cache.ts']);
  });
});

describe('handover tools: blocks and pages', () => {
  it('splits a page into text and blocks, and leaves a marker inside a fenced example alone', () => {
    const md = '# T\n\n```md\n<!-- gen:card x.ts -->\n<!-- /gen -->\n```\n\n<!-- gen:card a.ts sha=1 -->\nold\n```ts\ncode\n```\n<!-- /gen -->\nafter\n';
    const parts = blocks.splitBlocks(md);
    expect(parts.map((p) => `${p.type}:${p.kind ?? ''}:${p.target ?? ''}`)).toEqual(['text::', 'block:card:a.ts', 'text::']);
    expect(blocks.joinBlocks(parts, () => ({ body: 'NEW' }))).toContain('<!-- gen:card a.ts sha=1 -->\nNEW\n<!-- /gen -->\nafter');
  });

  it('reads the arguments of a marker', () => {
    expect(blocks.parseArgs('server/src/a.ts#x sha=ab12 depth=2 doc')).toEqual({ target: 'server/src/a.ts#x', options: { sha: 'ab12', depth: '2', doc: 'yes' } });
    expect(blocks.parseArgs('depth=2')).toEqual({ target: '', options: { depth: '2' } });
  });

  it('empties the lines of a generated block and keeps the others where they were', () => {
    const md = 'one\n<!-- gen:card a.ts -->\nx\ny\n<!-- /gen -->\nsix\n';
    expect(blocks.maskBlocks(md).split('\n')).toEqual(['one', '', '', '', '', 'six', '']);
  });

  it('reads the box under the title', () => {
    expect(docLib.boxOf(`# T\n\n${BOX}`)).toMatchObject({ who: 'Developers', time: 'about 1 min', first: 'none', next: 'none' });
    expect(docLib.boxOf('# T\n\nNo box.\n')).toBeNull();
  });

  it('sets the reading time in the box from the page, and from nothing else', () => {
    const words = Array.from({ length: 1000 }, () => 'word').join(' ');
    const page = `# T\n\n${BOX}\n${words}\n`;
    expect(docLib.readingTime(page)).toBe(5);
    const root = tree('readtime', { 'server/src/a.ts': GATE });
    const model = modelLib.buildModel(root);
    const out = docLib.processDocument(model, root, 'docs/handover/x.md', page);
    expect(out.text).toContain('| Developers | about 5 min | none | none |');
    expect(docLib.processDocument(model, root, 'docs/handover/x.md', out.text).text).toBe(out.text);
  });
});

describe('handover tools: what the generated blocks hold', () => {
  const run = (root: string, text: string) => docLib.processDocument(modelLib.buildModel(root), root, 'docs/handover/x.md', text);
  const page = (block: string) => `# T\n\n${BOX}\n${block}\n`;

  it('lists every declared name once, A to Z, and leaves a re-export to the file that declares it', () => {
    const root = tree('symbols', {
      'server/src/core/gate.ts': GATE,
      'server/src/index.ts': "export { createGate } from './core/gate.js';\n",
    });
    const out = run(root, page('<!-- gen:symbols -->\n<!-- /gen -->')).text;
    const rows = out.split('\n').filter((l) => l.startsWith('| `'));
    expect(rows.map((r) => r.split('|')[1].trim())).toEqual(['`createGate`', '`MAX`', '`Mode`', '`Options`']);
    expect(out.match(/^### /gm)).toHaveLength(3);
    expect(out).toContain('`server/src/core/gate.ts:2`');
  });

  it('draws a tree whose counts leave out test files, build output and settings', () => {
    const root = tree('tree', {
      'server/src/core/gate.ts': GATE,
      'server/src/core/cache.ts': 'export const cache = 1;\n',
      'server/src/core/cache.test.ts': "it('a', () => 1);\n",
      'server/src/__tests__/gate.test.ts': "it('b', () => 1);\n",
      'server/.env': 'SECRET=1\n',
      'server/dist/index.js': 'built\n',
      'pic/10/shot.png': 'a copy of the portal that shows real names\n',
      'docker-compose.override.yml': 'an address\n',
    });
    const out = run(root, page('<!-- gen:tree server/src depth=1 -->\n<!-- /gen -->')).text;
    expect(out).toContain('```text\nserver/src/\n\u251c\u2500\u2500 __tests__/\n\u2514\u2500\u2500 core/       2 files\n```');
    const top = run(root, page('<!-- gen:tree server depth=1 files=yes -->\n<!-- /gen -->')).text;
    expect(top).not.toMatch(/\.env|dist|node_modules/);
    // Each copy's own screenshots and its machine's override file differ between the copies, so a tree from the root never shows them.
    const rootTree = run(root, page('<!-- gen:tree . depth=1 files=yes -->\n<!-- /gen -->')).text;
    expect(rootTree).toContain('server/');
    expect(rootTree).not.toMatch(/pic|override/);
  });

  it('keeps what a person wrote in a file table when the table is written again, and adds a row for a new file', () => {
    const root = tree('files', { 'server/src/core/gate.ts': GATE });
    const block = '<!-- gen:files server/src/core -->\n<!-- /gen -->';
    const first = run(root, page(block)).text;
    expect(first).toContain('| [`gate.ts`](../../server/src/core/gate.ts) | 11 | 4 |  |');
    const written = first.replace('| 11 | 4 |  |', '| 11 | 4 | Lets only so many jobs run at once. |');
    writeFileSync(join(root, 'server/src/core/cache.ts'), 'export const cache = 1;\n');
    const again = run(root, written).text;
    expect(again).toContain('| 11 | 4 | Lets only so many jobs run at once. |');
    expect(again).toContain('| [`cache.ts`](../../server/src/core/cache.ts) | 1 | 1 |  |');
  });
});

describe('handover tools: a quoted snippet', () => {
  const page = `# T\n\n${BOX}\n<!-- gen:snippet server/src/core/gate.ts#createGate -->\n<!-- /gen -->\n`;

  it('is written from the code, with the hash of what it quotes', () => {
    const root = tree('snippet-a', { 'server/src/core/gate.ts': GATE });
    const model = modelLib.buildModel(root);
    const out = docLib.processDocument(model, root, 'docs/handover/x.md', page);
    expect(out.problems).toEqual([]);
    expect(out.text).toMatch(/<!-- gen:snippet server\/src\/core\/gate\.ts#createGate sha=[0-9a-f]{12} -->/);
    expect(out.text).toContain('`server/src/core/gate.ts:2-4`');
    expect(out.text).toContain('export function createGate(limit: number): number {\n  return limit + 1;\n}');
  });

  it('refuses a name the file does not declare', () => {
    const root = tree('snippet-b', { 'server/src/core/gate.ts': GATE });
    const model = modelLib.buildModel(root);
    const out = docLib.processDocument(model, root, 'docs/handover/x.md', page.replace('#createGate', '#nothing'));
    expect(out.problems.map((p) => p.message).join('\n')).toContain('declares no top-level nothing');
  });

  it('fails when the code changed under an explanation, refreshes the quote, and is settled by accepting', () => {
    const root = tree('snippet-c', { 'server/src/core/gate.ts': GATE });
    const first = docLib.processDocument(modelLib.buildModel(root), root, 'docs/handover/x.md', page).text;

    writeFileSync(join(root, 'server/src/core/gate.ts'), GATE.replace('limit + 1', 'limit + 2'));
    const after = modelLib.buildModel(root);
    const stale = docLib.processDocument(after, root, 'docs/handover/x.md', first, { fill: false });
    expect(stale.problems).toHaveLength(1);
    expect(stale.problems[0]).toMatchObject({ kind: 'review' });
    expect(stale.text).toContain('return limit + 2;');
    expect(stale.text).toContain(first.match(/sha=[0-9a-f]{12}/)![0]);

    const accepted = docLib.processDocument(after, root, 'docs/handover/x.md', first, { accept: true });
    expect(accepted.problems).toEqual([]);
    expect(accepted.text).not.toContain(first.match(/sha=[0-9a-f]{12}/)![0]);
    expect(docLib.processDocument(after, root, 'docs/handover/x.md', accepted.text, { fill: false }).problems).toEqual([]);
  });

  it('ignores an edit outside the quoted declaration', () => {
    const root = tree('snippet-d', { 'server/src/core/gate.ts': GATE });
    const first = docLib.processDocument(modelLib.buildModel(root), root, 'docs/handover/x.md', page).text;
    writeFileSync(join(root, 'server/src/core/gate.ts'), `// a new first line\n${GATE.replace('return \'private\'', 'return \'changed\'')}`);
    const out = docLib.processDocument(modelLib.buildModel(root), root, 'docs/handover/x.md', first, { fill: false });
    expect(out.problems).toEqual([]);
    expect(out.text).toContain('`server/src/core/gate.ts:3-5`');
  });
});

describe('handover.check.mjs: the whole check', () => {
  const folderCardFor = (dir: string) => `<!-- folder ${dir} -->\nA sentence about this folder.\n`;
  /** A one-page handbook over a one-file code tree; `files` adds to it or replaces it, and `manifest` and `keepA` reshape it. */
  const handbook = (files: Record<string, string> = {}, opts: { manifest?: string; keepA?: boolean } = {}) =>
    tree(`check-${Math.random().toString(36).slice(2)}`, {
      'server/src/core/gate.ts': GATE,
      'docs/handover/manifest.json': opts.manifest ?? MANIFEST('writing', ['a.md']),
      ...(opts.keepA === false ? {} : { 'docs/handover/a.md': `# A\n\n${BOX}\nPlain words about the gate.\n` }),
      ...files,
    });
  const rules = (root: string) => checker.checkHandbook(root).problems.map((p) => p.rule);

  it('passes its own self-test', () => {
    expect(checker.selfTest()).toEqual([]);
  });

  it('says nothing was checked when there is no handbook', () => {
    expect(checker.checkHandbook(tree('none', { 'server/src/core/gate.ts': GATE })).skipped).toBe(true);
  });

  it('passes a clean page', () => {
    expect(checker.checkHandbook(handbook()).problems).toEqual([]);
  });

  it('catches a generated block that has fallen behind the code', () => {
    const root = handbook({ 'docs/handover/a.md': `# A\n\n${BOX}\n<!-- gen:card server/src/core/gate.ts -->\nstale\n<!-- /gen -->\n` });
    expect(rules(root)).toContain('blocks');
  });

  it('catches a page that is not in the manifest, and a page the manifest lists that is missing', () => {
    expect(rules(handbook({ 'docs/handover/b.md': `# B\n\n${BOX}\nText.\n` }))).toContain('manifest');
    expect(rules(handbook({ 'docs/handover/manifest.json': MANIFEST('complete', ['a.md', 'gone.md']) }))).toContain('manifest');
  });

  it('catches a page with no box, a second title, an address and a dash', () => {
    const bad = handbook({ 'docs/handover/a.md': `# A\n\n# B\n\nThe host is 10.1.2.3 ${EM} really.\n` });
    expect(new Set(rules(bad))).toEqual(new Set(['box', 'headings', 'secrets', 'style']));
  });

  it('catches code in the part for everyone', () => {
    const root = handbook(
      { 'docs/handover/0-everyone/a.md': `# A\n\n${BOX}\nCall \`getProblems\` now.\n` },
      { manifest: JSON.stringify({ parts: [{ id: 'everyone', dir: '0-everyone', state: 'writing', pages: ['a.md'] }] }), keepA: false },
    );
    expect(rules(root)).toContain('everyone');
    // The same page has no Indonesian summary either; one with the summary, and no code, is clean.
    expect(rules(root)).toContain('summary');
    const summary = '> **Ringkasan**\n>\n> - Portal ini membaca data dari Zabbix untuk HCML.\n> - Isinya adalah masalah yang sedang terbuka.\n> - Portal hanya membaca dan tidak mengubah apa pun.\n> - Satu tindakan saja yang bisa ditulis kembali.\n> - Ada dua salinan dengan model yang berbeda.\n';
    const clean = handbook(
      { 'docs/handover/0-everyone/a.md': `# A\n\n${BOX}\n${summary}\n## Part\n\nPlain words about the portal.\n` },
      { manifest: JSON.stringify({ parts: [{ id: 'everyone', dir: '0-everyone', state: 'writing', pages: ['a.md'] }] }), keepA: false },
    );
    expect(checker.checkHandbook(clean).problems).toEqual([]);
  });

  it('catches a name in code font that is not in the code', () => {
    const root = handbook({ 'docs/handover/a.md': `# A\n\n${BOX}\nThe \`createGateX()\` call and the \`createGate()\` call.\n` });
    const found = checker.checkHandbook(root).problems.filter((p) => p.rule === 'references');
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('createGateX');
  });

  it('wants a description of every folder and a card for every code file once the part is complete', () => {
    const part = (id: string, dir: string) => JSON.stringify({ parts: [{ id, dir, state: 'complete', pages: ['a.md'] }] });
    const folders = handbook({ 'docs/handover/1-folders/a.md': `# A\n\n${BOX}\n${folderCardFor('server/src/core')}` }, { manifest: part('folders', '1-folders'), keepA: false });
    const missing = checker.checkHandbook(folders).problems.filter((p) => p.rule === 'folders').map((p) => p.message);
    expect(missing.some((m) => m.includes('no description of the folder server/src'))).toBe(true);
    expect(missing.some((m) => m.includes('no file table'))).toBe(true);
    expect(missing.some((m) => m.includes('server/src/core') && m.includes('no description'))).toBe(false);

    const code = handbook({ 'docs/handover/2-code/a.md': `# A\n\n${BOX}\nNothing.\n` }, { manifest: part('code', '2-code'), keepA: false });
    expect(checker.checkHandbook(code).problems.some((p) => p.rule === 'cards' && p.message.includes('no card for server/src/core/gate.ts'))).toBe(true);
  });
});

describe('the build command', () => {
  it('rewrites a page of the handbook and then has nothing left to do', () => {
    const root = tree('build', {
      'server/src/core/gate.ts': GATE,
      'docs/handover/a.md': `# A\n\n${BOX}\n<!-- gen:card server/src/core/gate.ts -->\n<!-- /gen -->\n`,
    });
    // The script finds its root from its own location, so copy it and its lib into the scratch tree.
    for (const rel of ['tools/handover/build.mjs', 'tools/handover/lib/blocks.mjs', 'tools/handover/lib/document.mjs', 'tools/handover/lib/model.mjs', 'tools/handover/lib/render.mjs', 'tools/handover/lib/scope.mjs', 'tools/check/parity.check.mjs']) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), readFileSync(repo(rel)));
    }
    const run = () => spawnSync(process.execPath, [join(root, 'tools/handover/build.mjs')], { encoding: 'utf8' });
    const first = run();
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('rewrote docs/handover/a.md');
    expect(readFileSync(join(root, 'docs/handover/a.md'), 'utf8')).toContain('| `createGate` | function | 2 |');
    expect(run().stdout).toContain('0 pages rewritten');
    expect(buildScript).toContain('build.mjs');
  });
});

describe('this tree', () => {
  it('has a handbook that matches the code and follows its own rules', () => {
    const { problems, pages } = checker.checkHandbook(repo('.'));
    expect(problems.map((p) => `${p.page}:${p.line} ${p.message} (${p.rule})`)).toEqual([]);
    expect(pages).toBeGreaterThan(0);
  });
});
