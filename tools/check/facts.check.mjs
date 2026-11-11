/**
 * The numbers the documents state about the code are the numbers the code has.
 *
 * The recurring failure of this project is a count written down once and never compared again: an endpoint table that
 * said 35 while listing all of them, "13 read methods" in five documents when the code called 14, a glossary that
 * said 11 ADRs beside 13 files, "18 route modules" beside 22, a table of Zabbix calls whose line numbers had moved.
 * Each of those was found by reading, weeks late. This reads the code for the counts and the documents for the
 * sentences that state them, and says where they differ.
 *
 * From the code: the endpoints (and how many are GET), the route modules, the Zabbix methods (read and write), the
 * parts of the setup guide, the ADRs, the pages, the direct dependencies, the test files, the numbered parts of the
 * stylesheet, the jobs of the CI workflow, the checkers, and the entities and relationships of the logical and
 * conceptual ERDs and the tables of the database ERD, and the cards on each of the three card pages of the handbook.
 *
 * Checked in the documents: sentences of the forms below ("45 endpoints", "14 read methods", "38 parts",
 * "13 ADRs", "19 pages", "40 direct dependencies", "78 files"). A line that tells of the past (it says "was", "claimed",
 * "since", "until" and the like) is not a claim about today and is left alone. The records of past days (tracker.md,
 * CHANGELOG.md, AUDIT_REPORT.md and the "What changed on <date>" parts of the setup guide) are left out.
 * Also checked: every endpoint of docs/api/openapi.yaml has a row in the endpoint table of setup/05, and every
 * row names an endpoint; the table of Zabbix calls in ERD-Database.md lists exactly the lines of server/src
 * that name each method; and the Configuration section of README.md names every environment variable the BFF reads.
 * The tracker is checked as a table: ten cells in every row (a pipe inside a code span splits a cell and moves every cell
 * after it along), a mark that fits its status, one row for each id, and the totals that its text and the open-items page state.
 *
 * It does not read what a sentence means. A number the forms above do not reach, and a line citation that still
 * exists but no longer says what the sentence does, are for a person.
 *
 *   node tools/check/facts.check.mjs [repo root]   (default: two levels up)
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'pic']);
/** Records of past days: their numbers were true on their day. */
const HISTORY_FILES = new Set(['tracker.md', 'CHANGELOG.md', 'AUDIT_REPORT.md', 'README_copy.md']);
const HISTORY_PATTERN = /^\d{2}-what-changed-/;
/** A sentence with one of these tells of the past or of a change, so its numbers are not claims about today. */
const PAST = /\b(?:claimed|said|used to|drifted|grew|went from|it once|until \d|since \d|when this was written)/i;

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
/** A count written as digits (with a thousands comma) or as a word, or null. */
export function toNumber(text) {
  const t = String(text).toLowerCase().replace(/,/g, '');
  if (/^\d+$/.test(t)) return Number(t);
  return WORDS[t] ?? null;
}

const sourceFiles = (dir, keep, skipTests = true) => {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !(skipTests && e.name === '__tests__')) walk(join(d, e.name));
      } else if (keep.test(e.name) && !(skipTests && /\.test\.tsx?$/.test(e.name))) out.push(join(d, e.name));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
};

const isCommentLine = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);
const lines = (file) => readFileSync(file, 'utf8').split('\n');

/** The routes the BFF registers: `app.get(`, `app.post(` and the like at the start of a line, in the files that register any. */
export function countEndpoints(root) {
  const inModules = sourceFiles(join(root, 'server/src/routes'), /\.ts$/);
  const outside = [join(root, 'server/src/http/health.ts'), join(root, 'server/src/security/auth.ts')].filter(existsSync);
  const by = { GET: 0, POST: 0, other: 0, inModules: 0 };
  for (const f of [...inModules, ...outside]) {
    for (const line of lines(f)) {
      const m = /^\s*(?:app|fastify)\.(get|post|put|delete|patch)\(/.exec(line);
      if (!m) continue;
      by[m[1] === 'get' ? 'GET' : m[1] === 'post' ? 'POST' : 'other']++;
      if (inModules.includes(f)) by.inModules++;
    }
  }
  return { total: by.GET + by.POST + by.other, get: by.GET, post: by.POST, inModules: by.inModules };
}

/** Route modules: `await app.register(somethingRoutes)` in index.ts, with or without options after the name. */
export function countRouteModules(root) {
  const f = join(root, 'server/src/index.ts');
  return existsSync(f) ? lines(f).filter((l) => /^\s*await app\.register\(\w+Routes[,)]/.test(l)).length : 0;
}

const METHOD = /'((?:host|hostgroup|item|history|trend|trigger|problem|event|service|sla|map|maintenance|dashboard|httptest|apiinfo|user|template)\.[A-Za-z]+)'/g;
/** Every Zabbix method named as a string in server/src outside tests and comments: method -> file -> [lines], and which are written. */
export function zabbixCalls(root) {
  const src = join(root, 'server/src');
  const calls = new Map();
  const written = new Set();
  for (const f of sourceFiles(src, /\.ts$/)) {
    const rel = relative(src, f).split(sep).join('/');
    lines(f).forEach((line, i) => {
      if (isCommentLine(line)) return;
      for (const m of line.matchAll(METHOD)) {
        if (!calls.has(m[1])) calls.set(m[1], new Map());
        const byFile = calls.get(m[1]);
        if (!byFile.has(rel)) byFile.set(rel, []);
        byFile.get(rel).push(i + 1);
        if (/\bzbxWrite\b/.test(line)) written.add(m[1]);
      }
    });
  }
  return { calls, written };
}

const countFiles = (dir, re) => sourceFiles(dir, re, false).length;
/** The cards of a handbook card page: each starts with a generated-block marker. */
const countCards = (file) => (existsSync(file) ? (readFileSync(file, 'utf8').match(/<!-- gen:card /g) || []).length : 0);

/** The environment variables server/src reads: `process.env.NAME`, `process.env['NAME']` and `envNum('NAME', ...)`, outside tests. */
export function environmentVariables(root) {
  const names = new Set();
  for (const f of sourceFiles(join(root, 'server/src'), /\.ts$/)) {
    for (const line of lines(f)) {
      if (isCommentLine(line)) continue;
      for (const m of line.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|process\.env\[['"]([A-Z][A-Z0-9_]+)['"]\]|\benvNum\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g)) names.add(m[1] ?? m[2] ?? m[3]);
    }
  }
  return names;
}

/** The names in backticks in the Configuration section of a README. */
export function documentedVariables(readme) {
  const start = readme.indexOf('## Configuration');
  const end = readme.indexOf('\n## ', start + 1);
  if (start < 0) return new Set();
  return new Set([...readme.slice(start, end < 0 ? undefined : end).matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)].map((m) => m[1]));
}

/** Entities and relationships of an erDiagram, and of the ERD-Database tables. */
export function countErd(text) {
  const entities = new Set();
  let relationships = 0;
  for (const line of text.split('\n')) {
    const ent = /^\s+([A-Za-z][A-Za-z0-9_]*)(?:\["[^"]*"\])?\s*\{\s*$/.exec(line);
    if (ent) entities.add(ent[1]);
    if (/^\s+[A-Za-z]\w*\s+(?:\|\||\|o|\}o|\}\|)(?:--|\.\.)(?:o\||\|\||o\{|\|\{)\s+[A-Za-z]\w*\s*:/.test(line)) relationships++;
  }
  return { entities: entities.size, relationships };
}

/** The rows of the entity and association tables of ERD-Conceptual.md. */
export function countConceptual(text) {
  const rows = (heading) => {
    const start = text.indexOf(heading);
    if (start < 0) return 0;
    const rest = text.slice(start + heading.length);
    const end = rest.search(/\n##? /);
    const body = end < 0 ? rest : rest.slice(0, end);
    return body.split('\n').filter((l) => /^\| (?!-|Entity|\s*\|)/.test(l) && !/^\| ?\|/.test(l)).length;
  };
  return { entities: rows('## Entities at a glance'), associations: (text.match(/^\| R\d+ \|/gm) ?? []).length };
}

const dependencies = (root) => {
  const read = (d) => {
    const p = JSON.parse(readFileSync(join(root, d, 'package.json'), 'utf8'));
    return { run: Object.keys(p.dependencies ?? {}).length, dev: Object.keys(p.devDependencies ?? {}).length };
  };
  const server = read('server');
  const web = read('web');
  return { server, web, total: server.run + server.dev + web.run + web.dev, shipped: server.run + web.run };
};

/** Jobs of the CI workflow: the keys directly under `jobs:`. */
const countJobs = (root) => {
  const f = join(root, '.github/workflows/ci.yml');
  if (!existsSync(f)) return 0;
  const all = lines(f);
  const start = all.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) return 0;
  let n = 0;
  for (const l of all.slice(start + 1)) {
    if (/^\S/.test(l) && !l.startsWith('#')) break;
    if (/^ {2}[A-Za-z][\w-]*:\s*$/.test(l)) n++;
  }
  return n;
};

/** The scripts `npm run check` stands for: one `*.check.*` file in tools/check and in web/scripts each. */
const countCheckers = (root) => sourceFiles(join(root, 'tools/check'), /\.check\.(mjs|ts)$/, false).length + sourceFiles(join(root, 'web/scripts'), /\.check\.(mjs|ts)$/, false).length;

/**
 * How many tests the last `npm test` ran, from the file each package's vitest config has it write (`.test-counts.json`, which git
 * ignores). Null when there is no such file, when a test file is newer than it, or when it names fewer files than the package has (a
 * run of one file): its count is then not the whole, and a statement is not judged against a count that does not hold.
 */
export function testCounts(root) {
  const read = (dir) => {
    const file = join(root, dir, '.test-counts.json');
    if (!existsSync(file)) return null;
    const tests = sourceFiles(join(root, dir, 'src'), /\.test\.tsx?$/, false);
    if (statSync(file).mtimeMs < Math.max(0, ...tests.map((p) => statSync(p).mtimeMs))) return null;
    try {
      const run = JSON.parse(readFileSync(file, 'utf8'));
      return Number.isInteger(run.numTotalTests) && run.testResults?.length === tests.length ? run.numTotalTests : null;
    } catch {
      return null;
    }
  };
  return { serverTests: read('server'), webTests: read('web') };
}

/** Everything the code says, by name. */
export function gatherFacts(root) {
  const endpoints = countEndpoints(root);
  const { calls, written } = zabbixCalls(root);
  const logical = existsSync(join(root, 'docs/erd/vanilla/ERD-Mermaid.mmd')) ? countErd(readFileSync(join(root, 'docs/erd/vanilla/ERD-Mermaid.mmd'), 'utf8')) : { entities: 0, relationships: 0 };
  const database = existsSync(join(root, 'docs/erd/database/ERD-Database.mmd')) ? countErd(readFileSync(join(root, 'docs/erd/database/ERD-Database.mmd'), 'utf8')) : { entities: 0 };
  const conceptualFile = join(root, 'docs/erd/conceptual/ERD-Conceptual.md');
  const conceptual = existsSync(conceptualFile) ? countConceptual(readFileSync(conceptualFile, 'utf8')) : { entities: 0, associations: 0 };
  const app = existsSync(join(root, 'web/src/App.tsx')) ? readFileSync(join(root, 'web/src/App.tsx'), 'utf8') : '';
  const paths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '*');
  const behindShell = app.includes('<Route element={<Layout />}') ? paths.filter((p) => p !== '/login').length : 0;
  return {
    endpoints: endpoints.total,
    inModules: endpoints.inModules,
    get: endpoints.get,
    post: endpoints.post,
    routeModules: countRouteModules(root),
    methods: calls.size,
    writeMethods: written.size,
    readMethods: calls.size - written.size,
    parts: countFiles(join(root, 'docs/setup'), /^\d{2}-.+\.md$/),
    adrs: countFiles(join(root, 'docs/architecture/adr'), /^\d{4}-.+\.md$/),
    pages: paths.length,
    behindShell,
    deps: dependencies(root),
    serverTestFiles: countFiles(join(root, 'server/src'), /\.test\.ts$/),
    webTestFiles: countFiles(join(root, 'web/src'), /\.test\.tsx?$/),
    ...testCounts(root),
    cssParts: countFiles(join(root, 'web/src/styles'), /^\d{2}-.+\.css$/),
    cardPages: ['files-server.md', 'files-web.md', 'files-tools.md'].map((f) => countCards(join(root, 'docs/handover/2-code', f))),
    jobs: countJobs(root),
    checkers: countCheckers(root),
    logical,
    conceptual,
    tables: database.entities,
    calls,
  };
}

/**
 * The statements to look for. `pick` turns a match into the numbers it states and `want` is what the code has for each;
 * a statement holds when they are equal. A pattern may carry more than one number (a pair, a list).
 */
export const RULES = [
  { id: 'endpoints', re: /\b(\d+) endpoints\b/g, want: (f) => [[f.endpoints], [f.inModules]] },
  { id: 'endpoints in route modules', re: /\b(\d+) of the (\d+) endpoints\b/g, want: (f) => [[f.inModules, f.endpoints]] },
  { id: 'GET and POST', re: /\b(\d+) GET (?:and|\+) (\d+) POST\b/g, want: (f) => [[f.get, f.post]] },
  { id: 'route modules', re: /\b(\d+) route (?:modules|plugins)\b/g, want: (f) => [[f.routeModules]] },
  { id: 'Zabbix methods', re: /\b(\d+) (?:Zabbix )?API methods\b/g, want: (f) => [[f.methods]] },
  { id: 'read methods', re: /\b(\d+) read methods\b/g, want: (f) => [[f.readMethods]] },
  { id: 'methods that read', re: /\b(\d+) that read\b/g, want: (f) => [[f.readMethods]] },
  { id: 'parts of the guide', re: /\b(\d+) parts\b/g, want: (f) => [[f.parts]], only: /setup|guide|subsystem|each part/i },
  { id: 'ADRs', re: /\b(\w+) (?:ADRs|Architecture Decision Records|decision records)\b/gi, want: (f) => [[f.adrs]] },
  { id: 'ADRs listed', re: /\bThere are (\d+), in `docs\/architecture\/adr\/`/g, want: (f) => [[f.adrs]] },
  { id: 'pages', re: /\b(\d+) pages\b/g, want: (f) => [[f.pages]], not: /PDF|workbook|\bKB\b|about \d+ pages/i },
  { id: 'pages behind the shell', re: /\b(\d+) of them behind the shell\b/g, want: (f) => [[f.behindShell]] },
  { id: 'direct dependencies', re: /\b(\d+) direct (?:dependencies|ones)\b/g, want: (f) => [[f.deps.total]] },
  { id: 'dependencies shipped', re: /\b(\d+) (?:of them shipped|ship:)/g, want: (f) => [[f.deps.shipped]] },
  { id: 'dependencies split', re: /\b(\d+) in the BFF and (\d+) in the web app\b/g, want: (f) => [[f.deps.server.run + f.deps.server.dev, f.deps.web.run + f.deps.web.dev]] },
  { id: 'dependencies in full', re: /\b(\d+) runtime \+ (\d+) dev on the server, (\d+) \+ (\d+) on the web: (\d+) in all, (\d+) of them shipped/g, want: (f) => [[f.deps.server.run, f.deps.server.dev, f.deps.web.run, f.deps.web.dev, f.deps.total, f.deps.shipped]] },
  { id: 'test files', re: /\b[\d,]+ tests in (\d+) files\b/g, want: (f) => [[f.serverTestFiles], [f.webTestFiles]] },
  // The counts come from the files `npm test` writes (see testCounts): a test cannot be counted without running one.
  { id: 'test counts', re: /\b(\d[\d,]*) tests in \d+ files\b/g, want: (f) => [[f.serverTests], [f.webTests]], when: (f) => f.serverTests !== null && f.webTests !== null },
  { id: 'stylesheet parts', re: /\b(\d+) numbered parts\b/g, want: (f) => [[f.cssParts]] },
  { id: 'cards on a page', re: /has one card on this page, (\d+) in all/g, want: (f) => f.cardPages.map((n) => [n]) },
  { id: 'CI jobs', re: /\b(\w+) jobs\b/gi, want: (f) => [[f.jobs]], only: /workflow|ci\.yml|\bCI\b/ },
  { id: 'checkers', re: /\b(\w+) checkers\b/gi, want: (f) => [[f.checkers]], not: /tools\/check/ },
  { id: 'checkers that exist', re: /\bFollow the (\w+) that exist\b/g, want: (f) => [[f.checkers]] },
  { id: 'logical ERD', re: /\b(\d+) entities and (\d+) relationships\b/g, want: (f) => [[f.logical.entities, f.logical.relationships]] },
  { id: 'logical ERD entities', re: /\b(\d+) entities across (?:nine|9) domains\b/g, want: (f) => [[f.logical.entities]] },
  { id: 'conceptual ERD', re: /\b(\d+) entities and (\d+)\s+associations\b/g, want: (f) => [[f.conceptual.entities, f.conceptual.associations]] },
  { id: 'database tables', re: /\b(\d+) (?:MySQL tables|of the 203 tables)\b/g, want: (f) => [[f.tables]] },
];

const sameNumbers = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);

/** The [start, end) spans of the sentences of `text`: a stop, semicolon, colon, question or exclamation mark before a space, or a table bar, ends one. */
function sentenceSpans(text) {
  const spans = [];
  let start = 0;
  for (const m of text.matchAll(/[.;:!?](?=\s)|\|/g)) {
    spans.push([start, m.index + 1]);
    start = m.index + 1;
  }
  spans.push([start, text.length]);
  return spans;
}

/**
 * The statements of one rule that start inside text[from, to), as the numbers they state; `tells` is whether the
 * sentence a statement sits in tells of the past. The window is the line with the line before and the one after, so a
 * sentence that wraps is whole.
 */
const claimsIn = (text, from, to, rule, facts) => {
  const problems = [];
  const left = [];
  let seen = 0;
  const spans = sentenceSpans(text);
  for (const m of rule.when && !rule.when(facts) ? [] : text.matchAll(rule.re)) {
    if (m.index < from || m.index >= to) continue;
    const stated = m.slice(1).filter((x) => x !== undefined).map(toNumber);
    if (stated.some((n) => n === null)) continue;
    const [a, b] = spans.find(([x, y]) => m.index >= x && m.index < y) ?? [0, text.length];
    if (PAST.test(text.slice(a, b))) {
      left.push(m[0]);
      continue;
    }
    seen++;
    if (!rule.want(facts).some((tuple) => sameNumbers(tuple, stated))) problems.push({ rule: rule.id, text: m[0].replace(/\s+/g, ' '), stated, want: rule.want(facts) });
  }
  return { problems, seen, left };
};

/**
 * The statements in `text` that the code contradicts, with their line numbers, how many were checked, and how many were
 * left alone because their sentence tells of the past.
 */
export function checkText(text, facts) {
  const all = text.split('\n');
  const problems = [];
  const leftAlone = [];
  let checked = 0;
  all.forEach((line, i) => {
    const before = all[i - 1] ?? '';
    const window = `${before} ${line} ${all[i + 1] ?? ''}`;
    const from = before.length + 1;
    for (const rule of RULES) {
      if (rule.only && !rule.only.test(line)) continue;
      if (rule.not && rule.not.test(line)) continue;
      const { problems: found, seen, left } = claimsIn(window, from, from + line.length + 1, rule, facts);
      checked += seen;
      for (const p of found) problems.push({ line: i + 1, ...p });
      for (const t of left) leftAlone.push({ line: i + 1, text: t });
    }
  });
  return { problems, checked, past: leftAlone.length, leftAlone };
}

/** Living Markdown: README.md, setup.md and everything under docs/, less the records of past days. */
function livingDocs(root) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(d, e.name));
      } else if (e.name.endsWith('.md') && !HISTORY_FILES.has(e.name) && !HISTORY_PATTERN.test(e.name)) out.push(join(d, e.name));
    }
  };
  for (const name of ['README.md', 'setup.md']) if (existsSync(join(root, name))) out.push(join(root, name));
  if (existsSync(join(root, 'docs'))) walk(join(root, 'docs'));
  return out.sort();
}

/** Endpoints of docs/api/openapi.yaml as "METHOD /path", read the way openapi.check does: a path at two spaces, a method at four. */
export function openapiEndpoints(text) {
  const out = new Set();
  let path = null;
  let inPaths = false;
  for (const line of text.split('\n')) {
    if (/^paths:\s*$/.test(line)) { inPaths = true; continue; }
    if (inPaths && /^\S/.test(line)) break;
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) { path = p[1]; continue; }
    const m = /^ {4}(get|post|put|delete|patch):\s*$/.exec(line);
    if (m && path) out.add(`${m[1].toUpperCase()} ${path}`);
  }
  return out;
}

/** Rows of the endpoint table of setup/05, as "METHOD /path" with the query string cut off. */
export function endpointTableRows(text) {
  const out = new Set();
  for (const m of text.matchAll(/^\| `(GET|POST|PUT|DELETE|PATCH) (\/api\/[^`?\s]+)/gm)) out.add(`${m[1]} ${m[2]}`);
  return out;
}

/** "file:line" and ":line" tokens of one cell of the call table, as file -> [lines]. */
export function citedLines(cell) {
  const byFile = new Map();
  let last = null;
  for (const m of cell.matchAll(/`([^`]+)`/g)) {
    const full = /^(.+\.ts):(\d+)$/.exec(m[1]);
    const more = /^:(\d+)$/.exec(m[1]);
    if (full) {
      last = full[1];
      if (!byFile.has(last)) byFile.set(last, []);
      byFile.get(last).push(Number(full[2]));
    } else if (more && last) byFile.get(last).push(Number(more[1]));
  }
  return byFile;
}

const keyOf = (byFile) => [...byFile].sort(([a], [b]) => (a < b ? -1 : 1)).map(([f, ls]) => `${f}:${[...ls].sort((a, b) => a - b).join('+')}`).join(' ');

/** The table of calls in ERD-Database.md against the lines of server/src: one problem for each method that differs. */
export function checkCallTable(text, calls) {
  const problems = [];
  const rows = new Map();
  for (const line of text.split('\n')) {
    const m = /^\| `([a-z]+\.[A-Za-z]+)` \|(.*)$/.exec(line);
    if (!m) continue;
    const cells = m[2].split('|').map((c) => c.trim());
    rows.set(m[1], citedLines(cells[0] ?? ''));
  }
  for (const method of new Set([...calls.keys(), ...rows.keys()])) {
    const inCode = calls.get(method) ?? new Map();
    const inDoc = rows.get(method) ?? new Map();
    if (keyOf(inCode) !== keyOf(inDoc)) problems.push(`${method}\n    code: ${keyOf(inCode) || '(not called)'}\n    doc:  ${keyOf(inDoc) || '(no row)'}`);
  }
  return { problems, rows: rows.size };
}

/** Every problem under `root`, and how many statements and tables were checked. */
/** The mark of a tracker row and the statuses that go with it. */
const TRACKER_STATUS = { '☑': ['✔ applied', '✔ superseded'], '◐': ['◐ partly'], '☐': ['✘ not yet'] };
/** The cells of a table row. A pipe splits a cell in Markdown even inside a code span, unless a backslash comes before it. */
const splitCells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

/**
 * The rows of the tracker (a row is a table row whose first cell is a mark) and what is wrong with them. A row with a pipe inside a
 * code span has an extra cell and every cell after it is in the wrong column, which went unseen for five days in the row of IN-59.
 */
export function checkTracker(text) {
  const problems = [];
  const seen = new Map();
  const count = { '☑': 0, '◐': 0, '☐': 0 };
  text.split('\n').forEach((line, index) => {
    const m = /^\| ([☑◐☐]) \|/.exec(line);
    if (!m) return;
    const at = index + 1;
    count[m[1]]++;
    const cells = splitCells(line);
    const id = cells[2] ?? '';
    if (cells.length !== 10) {
      problems.push(`tracker.md:${at}  the row of ${id || 'an item with no id'} has ${cells.length} cells, not 10 (a "|" inside a code span splits a cell: write the words, or "\\|")`);
      return;
    }
    if (!/^[A-Z]{2}-\d\d$/.test(id)) problems.push(`tracker.md:${at}  "${id}" is not an id such as BK-38`);
    else if (seen.has(id)) problems.push(`tracker.md:${at}  ${id} is also the row at line ${seen.get(id)}`);
    else seen.set(id, at);
    if (!TRACKER_STATUS[m[1]].includes(cells[1])) problems.push(`tracker.md:${at}  ${id}: the mark ${m[1]} does not go with the status "${cells[1]}"`);
  });
  const totals = { rows: count['☑'] + count['◐'] + count['☐'], done: count['☑'], partly: count['◐'], todo: count['☐'] };
  const want = [totals.rows, totals.done, totals.partly, totals.todo].join(', ');
  // The records of past days state older totals; the last sentence of each form is the one about today.
  for (const form of [/The tracker has (\d+) rows: (\d+) done, (\d+) partly done and (\d+) not done/g, /The tracker now has (\d+) rows: (\d+) done, (\d+) partly done and (\d+) not done/g]) {
    const last = [...text.matchAll(form)].at(-1);
    if (last && last.slice(1, 5).map(Number).join(', ') !== want) problems.push(`tracker.md  "${last[0]}" says ${last.slice(1, 5).join(', ')}; the rows are ${want}`);
  }
  return { ...totals, problems };
}

/** The sentence at the head of the open-items page that gives the tracker's totals. */
export function checkOpenItemsTotals(text, totals) {
  const m = /it has (\d+) rows\. (\d+) are done, (\d+) are done in part and (\d+) are not done/.exec(text);
  if (!m) return [];
  const want = [totals.rows, totals.done, totals.partly, totals.todo].join(', ');
  return m.slice(1, 5).map(Number).join(', ') === want ? [] : [`docs/handover/5-reference/open-items.md  "${m[0]}" says ${m.slice(1, 5).join(', ')}; the tracker has ${want}`];
}

export function checkFacts(root) {
  const facts = gatherFacts(root);
  const problems = [];
  let checked = 0;
  let past = 0;
  const docs = livingDocs(root);
  for (const file of docs) {
    const { problems: found, checked: n, past: left } = checkText(readFileSync(file, 'utf8'), facts);
    checked += n;
    past += left;
    for (const p of found) problems.push(`${relative(root, file)}:${p.line}  "${p.text}" says ${p.stated.join(', ')}, the code has ${p.want.map((t) => t.join(', ')).join(' or ')}  (${p.rule})`);
  }
  let tables = 0;
  const yaml = join(root, 'docs/api/openapi.yaml');
  const guide = join(root, 'docs/setup/05-backend-file-by-file.md');
  if (existsSync(yaml) && existsSync(guide)) {
    tables++;
    const api = openapiEndpoints(readFileSync(yaml, 'utf8'));
    const rows = endpointTableRows(readFileSync(guide, 'utf8'));
    for (const e of [...api].sort()) if (!rows.has(e)) problems.push(`docs/setup/05-backend-file-by-file.md  the endpoint table has no row for ${e}`);
    for (const e of [...rows].sort()) if (!api.has(e)) problems.push(`docs/setup/05-backend-file-by-file.md  the endpoint table names ${e}, which openapi.yaml does not`);
  }
  const readme = join(root, 'README.md');
  if (existsSync(readme)) {
    tables++;
    const documented = documentedVariables(readFileSync(readme, 'utf8'));
    for (const name of [...environmentVariables(root)].sort()) if (!documented.has(name)) problems.push(`README.md  the Configuration section does not name ${name}, which server/src reads`);
  }
  const erdDb = join(root, 'docs/erd/database/ERD-Database.md');
  if (existsSync(erdDb)) {
    tables++;
    const { problems: found } = checkCallTable(readFileSync(erdDb, 'utf8'), facts.calls);
    for (const p of found) problems.push(`docs/erd/database/ERD-Database.md  the table of Zabbix calls differs from the code for ${p}`);
  }
  const tracker = join(root, 'tracker.md');
  if (existsSync(tracker)) {
    tables++;
    const found = checkTracker(readFileSync(tracker, 'utf8'));
    problems.push(...found.problems);
    const items = join(root, 'docs/handover/5-reference/open-items.md');
    if (existsSync(items)) problems.push(...checkOpenItemsTotals(readFileSync(items, 'utf8'), found));
  }
  return { docs: docs.length, checked, past, tables, problems, facts };
}

// Self-test of the statements: each sample, and the rules it must trip. The facts are made up.
const FACTS = {
  endpoints: 45, inModules: 39, get: 40, post: 5, routeModules: 22, methods: 15, readMethods: 14, writeMethods: 1, parts: 38, adrs: 13, pages: 19, behindShell: 18,
  deps: { server: { run: 8, dev: 9 }, web: { run: 5, dev: 18 }, total: 40, shipped: 13 }, serverTestFiles: 78, webTestFiles: 81, serverTests: 2750, webTests: 1602, cssParts: 18, cardPages: [120, 177, 25], jobs: 5, checkers: 10,
  logical: { entities: 46, relationships: 54 }, conceptual: { entities: 27, associations: 34 }, tables: 45,
};
const samples = [
  ['The contract: 45 endpoints', []],
  ['The contract: 44 endpoints', ['endpoints']],
  ['22 route modules register onto it → 39 endpoints', []],
  ['39 of the 45 endpoints live in route modules', []],
  ['39 of the 44 endpoints live in route modules', ['endpoints', 'endpoints in route modules']],
  ['The endpoint table drifted: it claimed 35 endpoints while listing all of them', []],
  ['45 endpoints (40 GET + 5 POST)', []],
  ['45 endpoints (39 GET + 6 POST)', ['GET and POST']],
  ['18 route modules', ['route modules']],
  ['15 Zabbix API methods (14 that read and one that writes)', []],
  ['13 read methods', ['read methods']],
  ['38 parts, one per subsystem', []],
  ['37 parts of the guide', ['parts of the guide']],
  ['One stylesheet in 18 numbered parts', []],
  ['One stylesheet in 17 numbered parts', ['stylesheet parts']],
  ['the three parts of each day', []],
  ['There are 11, in `docs/architecture/adr/`', ['ADRs listed']],
  ['13 Architecture Decision Records (MADR)', []],
  ['Twelve ADRs', ['ADRs']],
  ['thirteen ADRs', []],
  ['All 19 pages are lazy', []],
  ['All 18 pages are lazy', ['pages']],
  ['Its PDF is about 10 pages', []],
  ['19 pages, 18 of them behind the shell', []],
  ['19 pages, 17 of them behind the shell', ['pages behind the shell']],
  ['40 direct dependencies in total, 17 in the BFF and 23 in the web app, of which 13 ship: the', []],
  ['41 direct dependencies in total', ['direct dependencies']],
  ['There are 40 direct ones, 13 of them shipped', []],
  ['8 runtime + 9 dev on the server, 5 + 18 on the web: 40 in all, 13 of them shipped.', []],
  ['8 runtime + 9 dev on the server, 5 + 18 on the web: 39 in all, 13 of them shipped.', ['dependencies in full']],
  ['Every code file of the server has one card on this page, 120 in all, grouped by folder', []],
  ['Every code file of the server has one card on this page, 104 in all, grouped by folder', ['cards on a page']],
  ['2,750 tests in 78 files, in node', []],
  ['2,750 tests in 77 files, in node', ['test files']],
  ['1,602 tests in 81 files, in jsdom', []],
  ['2,751 tests in 78 files, in node', ['test counts']],
  ['1,603 tests in 77 files, in jsdom', ['test files', 'test counts']],
  ['The server had 2,061 tests in 78 files when this was written', []],
  ['The CI workflow runs five jobs: server, web, the checks', []],
  ['The CI workflow runs four jobs: server, web', ['CI jobs']],
  ['each mixed two jobs: the HTTP side and what it knew', []],
  ['tools/check/ holds the six checkers that read the repository', []],
  ['the ten checkers', []],
  ['the nine checkers', ['checkers']],
  ['46 entities and 54 relationships are a lot', []],
  ['43 entities and 49 relationships are a lot', ['logical ERD']],
  ['27 entities and 34\nassociations', []],
  ['all 45 MySQL tables', []],
  ['all 44 MySQL tables', ['database tables']],
];
for (const [sample, expected] of samples) {
  const found = [...new Set(checkText(sample, FACTS).problems.map((p) => p.rule))];
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    console.error(`facts.check self-test failed: ${JSON.stringify(sample)} tripped ${JSON.stringify(found)}, expected ${JSON.stringify(expected)}`);
    process.exit(1);
  }
}

// Self-test of the tracker rule: a sample table, and what the rule must say about it.
{
  const row = (mark, status, id, extra = 'x') => `| ${mark} | ${status} | ${id} | Low | S | ${extra} | y | - | no | z |`;
  const head = '| Done | Checked | ID | Severity | Effort | What | Do | Earlier | Decision | Stands |\n|---|---|---|---|---|---|---|---|---|---|\n';
  const cases = [
    ['a table that holds', `${head}${row('☑', '✔ applied', 'BK-01')}\n${row('☐', '✘ not yet', 'BK-02')}\nThe tracker has 2 rows: 1 done, 0 partly done and 1 not done.\n`, 0],
    ['rows of other tables are not read', `| ID | Question |\n|---|---|\n| IN-65 | a | b | c |\n${head}${row('◐', '◐ partly', 'BK-01')}\n`, 0],
    ['a pipe inside a code span splits a cell', `${head}${row('☑', '✔ applied', 'BK-01', 'use `on|off|any` here')}\n`, 1],
    ['an escaped pipe does not', `${head}${row('☑', '✔ applied', 'BK-01', 'use `on\\|off` here')}\n`, 0],
    ['a mark that does not fit its status', `${head}${row('☑', '✘ not yet', 'BK-01')}\n`, 1],
    ['a status of an item that was superseded', `${head}${row('☑', '✔ superseded', 'BK-01')}\n`, 0],
    ['an id in two rows', `${head}${row('☑', '✔ applied', 'BK-01')}\n${row('☑', '✔ applied', 'BK-01')}\n`, 1],
    ['a row with no id', `${head}${row('☑', '✔ applied', 'later')}\n`, 1],
    ['totals that the rows contradict', `${head}${row('☑', '✔ applied', 'BK-01')}\nThe tracker now has 3 rows: 2 done, 0 partly done and 1 not done.\n`, 1],
    ['an older total, followed by the right one', `${head}${row('☑', '✔ applied', 'BK-01')}\nThe tracker has 9 rows: 2 done, 0 partly done and 7 not done.\nThe tracker has 1 rows: 1 done, 0 partly done and 0 not done.\n`, 0],
  ];
  for (const [label, sample, expected] of cases) {
    const found = checkTracker(sample).problems.length;
    if (found !== expected) {
      console.error(`facts.check tracker self-test failed (${label}): ${found} problems, expected ${expected}`);
      process.exit(1);
    }
  }
  const items = 'On 9 November it has 5 rows. 3 are done, 1 are done in part and 1 are not done. This page lists';
  if (checkOpenItemsTotals(items, { rows: 5, done: 3, partly: 1, todo: 1 }).length !== 0 || checkOpenItemsTotals(items, { rows: 5, done: 2, partly: 2, todo: 1 }).length !== 1) {
    console.error('facts.check open-items self-test failed');
    process.exit(1);
  }
}

// Self-test of the readers, on a small tree made for the purpose.
{
  const scratch = mkdtempSync(join(tmpdir(), 'facts-check-'));
  const put = (path, text) => {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), text);
  };
  try {
    put('server/src/routes/a.ts', "export async function aRoutes(app) {\n  app.get('/api/a', () => 1);\n  // app.get('/api/commented', () => 1);\n  app.post('/api/b', () => 1);\n}\n");
    put('server/src/routes/b.ts', "  app.get(\n    '/api/c',\n  () => 1);\n");
    put('server/src/__tests__/t.test.ts', "app.get('/api/in-a-test', () => 1);\n");
    put('server/src/index.ts', 'await app.register(aRoutes);\nawait app.register(bRoutes);\nawait app.register(helmet, {});\nawait app.register(cRoutes, { x: 1 });\n');
    put('server/src/services/z.ts', "zbx('host.get', {});\n// zbx('item.get', {});\nawait zbxWrite('event.acknowledge', {});\nzbx<X>('history.get', {});\n");
    const e = countEndpoints(scratch);
    if (e.total !== 3 || e.get !== 2 || e.post !== 1) throw new Error(`endpoints: ${JSON.stringify(e)}`);
    if (countRouteModules(scratch) !== 3) throw new Error('route modules');
    const z = zabbixCalls(scratch);
    if (z.calls.size !== 3 || z.written.size !== 1 || !z.written.has('event.acknowledge') || z.calls.has('item.get')) throw new Error('zabbix calls');
    const table = '| Method | Called from | Tables |\n|---|---|---|\n| `host.get` | `services/z.ts:1` | `hosts` |\n| `history.get` | `services/z.ts:3`, `:9` | x |\n| `event.acknowledge` | `services/z.ts:3` | x |\n';
    const t = checkCallTable(table, z.calls);
    // history.get is on line 4 and the table says 3 and 9; event.acknowledge is on line 3.
    if (t.problems.length !== 1 || !t.problems[0].startsWith('history.get')) throw new Error(`call table: ${JSON.stringify(t.problems)}`);
    const api = openapiEndpoints('paths:\n  /api/a:\n    get:\n      x: 1\n  /api/b:\n    post:\n    get:\ncomponents:\n  /api/not: {}\n');
    if (JSON.stringify([...api].sort()) !== JSON.stringify(['GET /api/a', 'GET /api/b', 'POST /api/b'])) throw new Error(`openapi: ${JSON.stringify([...api])}`);
    const rows = endpointTableRows('| `GET /api/a?x=1` | y | 5 s |\n| `POST /api/b` | y |\n| not a row |\n');
    if (JSON.stringify([...rows].sort()) !== JSON.stringify(['GET /api/a', 'POST /api/b'])) throw new Error(`table rows: ${JSON.stringify([...rows])}`);
    put('server/src/core/config.ts', "const a = process.env.ALPHA_ONE;\nconst b = envNum('BETA_TWO', 5);\nconst c = process.env['GAMMA_THREE'];\n// process.env.IN_A_COMMENT is a comment, not a read\n");
    const vars = [...environmentVariables(scratch)].sort();
    if (JSON.stringify(vars) !== JSON.stringify(['ALPHA_ONE', 'BETA_TWO', 'GAMMA_THREE'])) throw new Error(`environment variables: ${JSON.stringify(vars)}`);
    const docs = [...documentedVariables('# T\n\n## Configuration\n\n| `ALPHA_ONE` | x |\n| `BETA_TWO` / `OTHER_X` | y |\n\n## Testing\n`NOT_HERE`\n')].sort();
    if (JSON.stringify(docs) !== JSON.stringify(['ALPHA_ONE', 'BETA_TWO', 'OTHER_X'])) throw new Error(`documented variables: ${JSON.stringify(docs)}`);
    const erd = countErd('erDiagram\n    A["A · a"] {\n        string x\n    }\n    B {\n        string y\n    }\n    A ||--o{ B : "x"\n    B }o..o| A : "y"\n');
    if (erd.entities !== 2 || erd.relationships !== 2) throw new Error(`erd: ${JSON.stringify(erd)}`);
  } catch (err) {
    console.error(`facts.check reader self-test failed: ${err.message}`);
    process.exit(1);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
if (!statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`);
const { docs, checked, past, tables, problems } = checkFacts(root);
if (problems.length) {
  for (const p of problems) console.error(p);
  console.error(`\nfacts.check: ${problems.length} differences between the documents and the code, in ${docs} documents.`);
  process.exit(1);
}
console.log(`facts.check: ${checked} statements in ${docs} documents and ${tables} tables agree with the code; ${past} more tell of the past and were left alone.`);
