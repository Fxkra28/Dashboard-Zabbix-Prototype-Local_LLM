import { describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every route a page calls is owned by that page's module (FR-71). The table of routes (security/modules.ts) says which modules own each route, and a person who holds a page and not the
 * owner of one of its calls gets a card of refusals where the data should be. This reads the web source: the component of each page, everything it imports, and the calls of `api` in them,
 * and checks each call against the table. A call that a page draws only behind `can('<module>')` is listed below with that module, and the test looks for the gate.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
});

const { MODULES, ruleFor } = await import('../security/modules.js');
const { PUBLIC_ROUTES } = await import('../security/auth.js');

const WEB = fileURLToPath(new URL('../../../web/src/', import.meta.url));
const read = (path: string) => readFileSync(path, 'utf8');

const app = read(join(WEB, 'App.tsx'));
const lazyFile = new Map([...app.matchAll(/const (\w+) = lazy\(\(\) => import\('(.+?)'\)\)/g)].map((m) => [m[1], m[2]]));
const pageComponent = new Map([...app.matchAll(/<Route path="([^"]+)" element=\{<(\w+)/g)].map((m) => [m[1], m[2]]));

function resolveImport(from: string, spec: string): string | null {
  const base = normalize(join(dirname(from), spec));
  for (const tail of ['.tsx', '.ts', '/index.tsx', '/index.ts']) if (existsSync(base + tail)) return base + tail;
  return null;
}

/** The report files go through one helper, whose route is not written beside each method. */
const REPORT_FILE_ROUTE = '/api/sli/export';
/** The calls that are exported beside `api` and not in it. */
const OUTSIDE_API: Record<string, string> = { chatStream: '/api/chat', chatWarm: '/api/chat/warm', streamUrl: '/api/stream' };

/** The route each method of `api` asks for: the first path written in its definition, in the files under web/src/api. */
const methodRoute = new Map<string, string>();
for (const name of readdirSync(join(WEB, 'api'))) {
  if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
  for (const chunk of read(join(WEB, 'api', name)).split(/\n {2}(?=[A-Za-z_]\w*[:(])/).slice(1)) {
    const key = /^(\w+)/.exec(chunk)?.[1];
    const route = chunk.includes('fetchReport(') ? REPORT_FILE_ROUTE : /[`'"](\/api\/[\w/{}-]*)/.exec(chunk)?.[1];
    if (key && route) methodRoute.set(key, route);
  }
}

/** Every call that the files of a page can make, with the files that make it: the page's component and what it imports from the web source, except the API's own files and the tests. */
function callsOf(entry: string): Map<string, Set<string>> {
  const seen = new Set<string>();
  const calls = new Map<string, Set<string>>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = read(file);
    const note = (name: string) => calls.set(name, (calls.get(name) ?? new Set<string>()).add(relative(WEB, file)));
    for (const m of src.matchAll(/\bapi\.(\w+)/g)) note(m[1]);
    for (const name of Object.keys(OUTSIDE_API)) if (new RegExp(`\\b${name}\\b`).test(src)) note(name);
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']*)'/g)) {
      const target = resolveImport(file, m[1]);
      if (target && !target.startsWith(join(WEB, 'api')) && !/\.test\.tsx?$/.test(target)) visit(target);
    }
  };
  visit(entry);
  return calls;
}

const routeOf = (method: string): string | undefined => methodRoute.get(method) ?? OUTSIDE_API[method];

/** A call a page draws only when the person holds the module that owns its route: the file holds `can('<needs>')`. */
const GATED: { page: string; method: string; needs: string; file: string }[] = [
  { page: 'dashboard', method: 'netMeters', needs: 'network', file: 'features/dashboard/Overview.tsx' },
  { page: 'network', method: 'graph', needs: 'graphs', file: 'features/network/Network.tsx' },
];

/** The Explain panel holds the call for a problem and the call for an SLA figure, and each page that shows it draws only its own kind. */
const SHARED_PANEL = 'features/assistant/ExplainPanel.tsx';

interface Finding {
  page: string;
  method: string;
  route: string;
  files: string[];
}

const findings: Finding[] = [];
const unknown: string[] = [];
const missingPages: string[] = [];
for (const m of MODULES) {
  const component = pageComponent.get(m.page);
  const spec = component ? lazyFile.get(component) : undefined;
  const entry = spec ? resolveImport(join(WEB, 'App.tsx'), spec) : null;
  if (!entry) {
    missingPages.push(m.page);
    continue;
  }
  for (const [method, files] of callsOf(entry)) {
    const route = routeOf(method);
    if (!route) {
      unknown.push(`${m.id}: ${method}`);
      continue;
    }
    const rule = ruleFor(route);
    const owned = rule ? rule.modules === 'any' || (rule.modules as readonly string[]).includes(m.id) : PUBLIC_ROUTES.has(route);
    if (!owned) findings.push({ page: m.id, method, route, files: [...files].sort() });
  }
}

describe('the pages of the menu and what they call (FR-71)', () => {
  it('finds the component of every page of the menu', () => {
    expect(missingPages).toEqual([]);
  });

  it('knows the route of every call a page can make, so that none passes unchecked', () => {
    expect(unknown).toEqual([]);
  });

  it('has every route a page calls owned by that page, except what the page draws behind a gate or a panel it shares', () => {
    const unexplained = findings.filter(
      (f) => !GATED.some((g) => g.page === f.page && g.method === f.method) && !f.files.every((file) => file === SHARED_PANEL),
    );
    expect(unexplained.map((f) => `${f.page} calls ${f.method} (${f.route}), which its module does not own: ${f.files.join(', ')}`)).toEqual([]);
  });

  it('keeps each gate real: the call is there, the route is not the page’s, and the page asks for the module before drawing it', () => {
    for (const g of GATED) {
      expect(findings.some((f) => f.page === g.page && f.method === g.method), `${g.page} ${g.method} is no longer a call the page cannot make alone: remove it from GATED`).toBe(true);
      expect(read(join(WEB, g.file)), `${g.file} does not ask can('${g.needs}')`).toContain(`can('${g.needs}')`);
      const owners = ruleFor(routeOf(g.method)!)?.modules;
      expect(owners, `${g.method} is not owned by ${g.needs}`).toEqual(expect.arrayContaining([g.needs]));
    }
  });

  it('keeps the shared panel real: it is where those calls are, and it holds both kinds', () => {
    const shared = findings.filter((f) => f.files.every((file) => file === SHARED_PANEL));
    expect(shared.length).toBeGreaterThan(0);
    expect(new Set(shared.map((f) => f.method))).toEqual(new Set(['explainProblem', 'explainSla']));
  });
});
