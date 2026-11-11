/**
 * Check that docs/api/openapi.yaml lists exactly the routes the server registers.
 *
 *   ./server/node_modules/.bin/tsx tools/check/openapi.check.ts            (from the repository root)
 *
 * Why this exists. The endpoint table in setup.md §5 drifted twice: it claimed "16 modules, 35
 * endpoints" while the table below it listed all of them (DOC-14), and 23 of its 35 "Defined at"
 * line citations pointed at unrelated lines after the route files grew (DOC-15). Both were written
 * by hand and nothing compared them with the code, so both survived several readings. A third
 * hand-written list would drift the same way. This one is checked.
 *
 * It compares what the server registers (every `app.get('…')` / `app.post('…')` in server/src,
 * excluding __tests__) with what docs/api/openapi.yaml says, and fails on a difference in either
 * direction:
 *   - paths, and the HTTP method under each path (BK-14: a route documented under the wrong method
 *     passed when only paths were compared);
 *   - path parameters: a route's `:id` must be the spec's `{id}`, and the spec must declare each one
 *     as an `in: path` parameter, on the operation or on its path item;
 *   - the guard: a route the guard covers must document 401 and must not be marked `security: []`,
 *     and a route that can answer 403 (an unsafe method, which needs the CSRF header, or a role above
 *     viewer) must document 403. The public paths and the role rules are read from `PUBLIC_ROUTES`
 *     and `ROUTE_RULES` in the source, so there is no third list to drift;
 *   - the body: an unsafe method takes a body schema (schemas.ts), so it must document 400;
 *   - the query: a route that declares its query names (`singleValues` in schemas.ts) must document 400, and
 *     the spec must declare exactly those names `in: query`.
 *   - the text: no one-line flow mapping has an entry without a key, which is what a description with a comma in it
 *     turns into when it is not quoted (YAML cuts it there, silently).
 * Not compared here: response bodies. server/src/__tests__/openapi-contract.test.ts holds every answer to the spec,
 * and web/src/__tests__/openapiTypes.test.ts holds the web app's types to it.
 *
 * Read-only. No npm dependency: the YAML is scanned rather than parsed, the same trade
 * validate-sli.ts made when it hand-wrote a zip reader instead of adding a parser. That is safe here
 * because this script also owns the spec's formatting contract: inside `paths:`, path keys sit at two
 * spaces, method keys at four, an operation's fields at six, and its status codes and parameter items
 * at eight. The self-test below runs on fixtures first, and fails the run if the checker is broken.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = join(HERE, '..', '..', 'server', 'src');
const SPEC = join(HERE, '..', '..', 'docs', 'api', 'openapi.yaml');

export interface Route {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  where: string;
  /** The query names the route declares with `singleValues`, sorted; absent when it declares none. */
  query?: string[];
}


/**
 * Every route registration in a TypeScript source file.
 *
 * Matches `app.get('/api/x'`, `fastify.post("/api/y"`, and the backtick form. Deliberately does not
 * match a template literal with a substitution: a path the checker cannot resolve statically is
 * reported rather than silently skipped.
 */
export function routesIn(source: string, where = '<memory>'): Route[] {
  const out: Route[] = [];
  const names = (args: string) => [...args.matchAll(/(['"])([^'"]+)\1/g)].map((m) => m[2]).sort();
  // `const X_QUERY = singleValues('a', 'b');` named once and used on a registration line.
  const constants = new Map([...source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*_QUERY)\s*=\s*singleValues\(([^)]*)\)/g)].map((m) => [m[1], names(m[2])]));
  const re = /\b[A-Za-z_$][\w$]*\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]*)\2/g;
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    // Skip comment-only lines so a commented-out route is not counted.
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[i])) !== null) {
      const path = m[3];
      if (!path.startsWith('/')) continue; // cache.get('key'), map.get(…), and friends
      const rest = lines[i].slice(m.index);
      const inline = /\bsingleValues\(([^)]*)\)/.exec(rest);
      const named = /\b([A-Z][A-Z0-9_]*_QUERY)\b/.exec(rest);
      const query = inline ? names(inline[1]) : named ? constants.get(named[1]) : undefined;
      out.push({ method: m[1] as Route['method'], path, where: `${where}:${i + 1}`, ...(query ? { query } : {}) });
    }
  }
  return out;
}

/** Path keys under `paths:` in an OpenAPI document, in file order. */
export function specPaths(yaml: string): string[] {
  const out: string[] = [];
  const lines = yaml.split('\n');
  let inPaths = false;

  for (const line of lines) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (!inPaths) continue;
    // A non-indented, non-blank, non-comment line ends the block.
    if (/^\S/.test(line)) break;
    const m = /^ {2}(\/[^:\s]*):\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** A route's `:id` as the spec writes it, `{id}`. */
export const toTemplate = (path: string): string => path.replace(/:([A-Za-z_]\w*)/g, '{$1}');

/** The parameter names in a path, in order, from the route form or the spec form. */
export const paramsOf = (path: string): string[] => [...toTemplate(path).matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);

/** A path with its parameters blanked, so `/h/:id` and `/h/{hostid}` pair up and the rename is reported once. */
const shapeOf = (path: string): string => toTemplate(path).replace(/\{[^}]+\}/g, '{}');

export interface SpecOp {
  method: string;
  path: string;
  /** `none` is `security: []`, an open operation; `inherit` has no security line of its own. */
  security: 'inherit' | 'none' | 'set';
  /** Status keys as written: `200`, `401`, `default`. */
  responses: string[];
  /** Names declared `in: path`, on the operation or on its path item. */
  pathParams: string[];
  /** Names declared `in: query`, sorted. */
  queryParams: string[];
}

const SPEC_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string): boolean => line.trim() === '' || line.trimStart().startsWith('#');
const unquote = (s: string): string => s.trim().replace(/^(['"])(.*)\1$/, '$2');

/** The lines under `key:` written at column `indent`, and whatever follows its colon. Null when there is no such key. */
function under(lines: string[], indent: number, key: string): { inline: string; body: string[] } | null {
  const head = new RegExp(`^ {${indent}}${key}:(.*)$`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (!isBlank(lines[i]) && indentOf(lines[i]) <= indent) break;
    body.push(lines[i]);
  }
  return { inline: (head.exec(lines[start]) as RegExpExecArray)[1].trim(), body };
}

/** `body` cut into the blocks under each key written at column `indent`. */
function blocks(body: string[], indent: number): { key: string; lines: string[] }[] {
  const head = new RegExp(`^ {${indent}}([^\\s#:][^:]*):`);
  const out: { key: string; lines: string[] }[] = [];
  for (const line of body) {
    const m = head.exec(line);
    if (m) out.push({ key: unquote(m[1]), lines: [] });
    else if (out.length && (line.trim() === '' || indentOf(line) > indent)) out[out.length - 1].lines.push(line);
  }
  return out;
}

interface ParamDecl {
  name: string;
  in: string;
}

/** The `name` and `in` an item lists, whether it is written as a block or as `{ name: id, in: path }`. */
function declOf(item: string[], keyColumn: number): ParamDecl | null {
  const flow = /^\s*\{(.*)\}\s*$/.exec(item[0]);
  const pairs = flow ? flow[1].split(',').map((s) => s.trim()) : item.filter((l) => indentOf(l) === keyColumn).map((l) => l.trim());
  const read = (key: string) => {
    const hit = pairs.find((p) => p.startsWith(`${key}:`));
    return hit ? unquote(hit.slice(key.length + 1)) : '';
  };
  return read('name') && read('in') ? { name: read('name'), in: read('in') } : null;
}

/** The parameters listed under `parameters:` at column `indent`. A `$ref` is looked up in `shared`. */
function parametersAt(lines: string[], indent: number, shared: Map<string, ParamDecl>): ParamDecl[] {
  const list = under(lines, indent, 'parameters');
  if (!list) return [];
  const items: string[][] = [];
  for (const line of list.body) {
    if (new RegExp(`^ {${indent + 2}}- `).test(line)) items.push([line.replace(/^( *)- /, '$1  ')]);
    else if (items.length) items[items.length - 1].push(line);
  }
  const out: ParamDecl[] = [];
  for (const item of items) {
    const ref = /^\s*\$ref:\s*['"]?#\/components\/parameters\/([\w.-]+)['"]?\s*$/.exec(item[0]);
    const found = ref ? shared.get(ref[1]) : declOf(item, indent + 4);
    if (found) out.push(found);
  }
  return out;
}

/** What `components: parameters:` defines, by key. */
function sharedParameters(lines: string[]): Map<string, ParamDecl> {
  const out = new Map<string, ParamDecl>();
  const defs = under(lines, 0, 'components');
  const params = defs ? under(defs.body, 2, 'parameters') : null;
  for (const def of blocks(params?.body ?? [], 4)) {
    const decl = declOf(def.lines, 6);
    if (decl) out.set(def.key, decl);
  }
  return out;
}

/**
 * Every operation under `paths:`: its method, path, whether it opts out of security, the status
 * codes it documents and the path parameters it declares.
 */
export function specOperations(yaml: string): SpecOp[] {
  const lines = yaml.split('\n');
  const shared = sharedParameters(lines);
  const out: SpecOp[] = [];

  for (const item of blocks(under(lines, 0, 'paths')?.body ?? [], 2)) {
    const onPath = parametersAt(item.lines, 4, shared);
    for (const operation of blocks(item.lines, 4)) {
      if (!SPEC_METHODS.has(operation.key)) continue;
      const security = under(operation.lines, 6, 'security');
      const params = [...onPath, ...parametersAt(operation.lines, 6, shared)];
      out.push({
        method: operation.key,
        path: item.key,
        security: !security ? 'inherit' : /^\[\s*\]$/.test(security.inline) ? 'none' : 'set',
        responses: blocks(under(operation.lines, 6, 'responses')?.body ?? [], 8).map((b) => b.key),
        pathParams: [...new Set(params.filter((p) => p.in === 'path').map((p) => p.name))],
        queryParams: [...new Set(params.filter((p) => p.in === 'query').map((p) => p.name))].sort(),
      });
    }
  }
  return out;
}

/**
 * The lines where YAML cuts a description short. In a one-line flow mapping such as
 * `{ type: integer, description: Seconds, summed over the hosts }` the plain scalar ends at the comma, and
 * `summed over the hosts` becomes a key of its own with no value: nothing fails, the sentence just loses its tail,
 * here and in the types made from the file. Every entry of such a mapping has to be `key: value`.
 */
export function cutDescriptions(yaml: string): { line: number; entry: string }[] {
  const out: { line: number; entry: string }[] = [];
  let blockIndent: number | null = null;

  yaml.split('\n').forEach((text, i) => {
    if (blockIndent !== null) {
      if (text.trim() === '' || indentOf(text) > blockIndent) return;
      blockIndent = null;
    }
    if (text.trimStart().startsWith('#')) return;
    if (/(?::|-)\s+[|>][+-]?\d?\s*$/.test(text)) blockIndent = indentOf(text);

    // One frame per open bracket: the entries it has finished and the one it is reading.
    const frames: { brace: boolean; entries: string[]; current: string }[] = [];
    let quote = '';
    for (let c = 0; c < text.length; c++) {
      const ch = text[c];
      if (quote) {
        frames.forEach((f) => (f.current += ch));
        if (ch === quote) {
          if (quote === "'" && text[c + 1] === "'") {
            frames.forEach((f) => (f.current += "'"));
            c++;
          } else quote = '';
        } else if (quote === '"' && ch === '\\') {
          frames.forEach((f) => (f.current += text[c + 1] ?? ''));
          c++;
        }
        continue;
      }
      if ((ch === "'" || ch === '"') && /[\s{[,:]/.test(text[c - 1] ?? ' ')) quote = ch;
      if (ch === '{' || ch === '[') {
        frames.forEach((f) => (f.current += ch));
        frames.push({ brace: ch === '{', entries: [], current: '' });
        continue;
      }
      const top = frames[frames.length - 1];
      if (top && ch === ',') {
        top.entries.push(top.current);
        top.current = '';
        frames.slice(0, -1).forEach((f) => (f.current += ch));
        continue;
      }
      if (top && (ch === '}' || ch === ']')) {
        frames.pop();
        if (top.current.trim() !== '') top.entries.push(top.current);
        if (top.brace) {
          for (const entry of top.entries) {
            if (!/^[^:]+:(\s|$)/.test(entry.trim())) out.push({ line: i + 1, entry: entry.trim() });
          }
        }
        frames.forEach((f) => (f.current += ch));
        continue;
      }
      frames.forEach((f) => (f.current += ch));
    }
  });
  return out;
}

export interface Guard {
  /** Paths the guard lets through without a token. */
  open: Set<string>;
  /** The minimum role per route, first match wins. A route no rule matches needs `viewer`. */
  rules: { pattern: RegExp; role: string }[];
}

/**
 * The guard's two tables, read out of the source that holds them (`PUBLIC_ROUTES` and `ROUTE_RULES`
 * in auth.ts), or null when either is missing: a checker that cannot see the guard must fail, not
 * pass with nothing to compare.
 */
export function guardIn(source: string): Guard | null {
  const open = /\bPUBLIC_ROUTES\s*=\s*new Set\(\s*\[([^\]]*)\]/.exec(source);
  const table = /\bROUTE_RULES\b[^=]*=\s*\[([\s\S]*?)\n\s*\];/.exec(source);
  if (!open || !table) return null;

  const paths = [...open[1].matchAll(/(['"`])([^'"`]+)\1/g)].map((m) => m[2]);
  const rules = [...table[1].matchAll(/pattern:\s*\/((?:\\.|[^/\\\n])+)\/([a-z]*)\s*,\s*role:\s*['"](\w+)['"]/g)].map((m) => ({
    pattern: new RegExp(m[1], m[2]),
    role: m[3],
  }));
  return paths.length && rules.length ? { open: new Set(paths), rules } : null;
}

/** One entry of the Roles table: a path, with the method it names if it names one, and whether a star made it stand for everything below. */
export interface RoleEntry {
  path: string;
  method?: string;
  prefix: boolean;
}

/**
 * The `### Roles` table in the spec's description: for each role, the paths its row names in backticks (`/api/net/*` stands for
 * everything below `/api/net/`, and `POST /api/problems/acknowledge` for that method only). A row of words, such as "everything
 * else", names none. Null when the heading or the table is missing, which the checker reports.
 */
export function rolesTable(yaml: string): Map<string, RoleEntry[]> | null {
  const at = yaml.indexOf('### Roles');
  if (at < 0) return null;
  const rows = new Map<string, RoleEntry[]>();
  for (const line of yaml.slice(at).split('\n').slice(1)) {
    const row = /^\s*\|\s*`(\w+)`\s*\|(.*)\|\s*$/.exec(line);
    if (!row) {
      if (rows.size > 0 && !/^\s*\|/.test(line)) break;
      continue;
    }
    rows.set(
      row[1],
      [...row[2].matchAll(/`(?:(GET|POST|PUT|PATCH|DELETE) )?(\/[^`*]*?)(\*)?`/g)].map((m) => ({ path: m[2], ...(m[1] ? { method: m[1].toLowerCase() } : {}), prefix: m[3] === '*' })),
    );
  }
  return rows.size ? rows : null;
}

/**
 * The Roles table against the guard's rules, both ways: every path the table names has the role of its row, and every
 * operation the rules put above viewer is named under its role. The rules are read from auth.ts, so there is one list and a copy.
 */
export function compareRoles(table: Map<string, RoleEntry[]>, ops: SpecOp[], guard: Guard): string[] {
  const problems: string[] = [];
  const roleOf = (path: string) => guard.rules.find((r) => r.pattern.test(path))?.role ?? 'viewer';
  for (const [role, entries] of table) {
    for (const e of entries) {
      const given = roleOf(e.prefix ? `${e.path}x` : e.path);
      if (given !== role) problems.push(`docs/api/openapi.yaml  the Roles table puts ${e.path}${e.prefix ? '*' : ''} under ${role}, and ROUTE_RULES in auth.ts gives it ${given}`);
    }
  }
  for (const o of ops) {
    const role = roleOf(o.path.replace(/\{[^}]+\}/g, 'x'));
    if (role === 'viewer') continue;
    const named = (table.get(role) ?? []).some((e) => (e.method === undefined || e.method === o.method) && (e.prefix ? o.path.startsWith(e.path) : o.path === e.path));
    if (!named) problems.push(`docs/api/openapi.yaml  ${o.method.toUpperCase()} ${o.path} needs ${role} (ROUTE_RULES in auth.ts) but the Roles table does not name it under ${role}`);
  }
  return problems;
}

const UNSAFE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

/**
 * Everything the registered routes and the spec must agree on, as a list of problems (empty when
 * they agree), plus how many operations the guard rules were applied to.
 */
export function compare(routes: Route[], ops: SpecOp[], guard: Guard) {
  const problems: string[] = [];
  const at = (method: string, path: string) => `${method.toUpperCase()} ${path}`;
  const key = (method: string, path: string) => `${method} ${shapeOf(path)}`;
  const opFor = new Map(ops.map((o) => [key(o.method, o.path), o]));
  const routeFor = new Map(routes.map((r) => [key(r.method, r.path), r]));
  const methodsAt = (list: { method: string; path: string }[], path: string) =>
    list.filter((x) => shapeOf(x.path) === shapeOf(path)).map((x) => x.method.toUpperCase());
  let guarded = 0;
  let forbidding = 0;
  let refusing = 0;
  let querying = 0;

  for (const r of routes) {
    const o = opFor.get(key(r.method, r.path));
    if (!o) {
      const others = methodsAt(ops, r.path);
      problems.push(
        others.length
          ? `${r.where}  ${at(r.method, r.path)} is registered but openapi.yaml documents only ${others.join(', ')} for that path`
          : `${r.where}  ${at(r.method, r.path)} is registered but absent from openapi.yaml`,
      );
      continue;
    }

    const named = paramsOf(r.path);
    const specNamed = paramsOf(o.path);
    if (named.join() !== specNamed.join()) {
      problems.push(
        `${r.where}  ${at(r.method, r.path)}: the route names its path parameters (${named.join(', ')}), openapi.yaml names them (${specNamed.join(', ')})`,
      );
    }

    // The guard covers /api/* only. Open paths need no 401; every route that can say 403 must.
    if (!r.path.startsWith('/api/')) continue;
    const label = `docs/api/openapi.yaml  ${at(o.method, o.path)}`;
    if (!guard.open.has(r.path)) {
      guarded++;
      if (o.security === 'none') problems.push(`${label} is marked security: [] but the guard covers it`);
      if (!o.responses.includes('401')) problems.push(`${label} is guarded but documents no 401`);
    }
    const needs = guard.rules.find((g) => g.pattern.test(r.path))?.role ?? 'viewer';
    const why = UNSAFE_METHODS.has(r.method)
      ? 'an unsafe method needs the X-HCML-CSRF header'
      : needs !== 'viewer'
        ? `it needs the ${needs} role`
        : '';
    if (why) {
      forbidding++;
      if (!o.responses.includes('403')) problems.push(`${label} can answer 403 (${why}) but documents none`);
    }
    // Every POST has a body schema (schemas.ts), so a malformed body is a 400 and the spec must say so.
    if (UNSAFE_METHODS.has(r.method)) {
      refusing++;
      if (!o.responses.includes('400')) problems.push(`${label} takes a body, so it can answer 400, but documents none`);
    }
    // A declared query name sent twice, or too long, is a 400 before the handler runs.
    if (r.query) {
      querying++;
      if (!o.responses.includes('400')) problems.push(`${label} declares its query, so it can answer 400, but documents none`);
      for (const n of r.query.filter((q) => !o.queryParams.includes(q))) problems.push(`${label} does not declare the query parameter ${n}, which ${r.where} reads`);
      for (const n of o.queryParams.filter((q) => !r.query?.includes(q))) problems.push(`${label} declares the query parameter ${n}, which ${r.where} does not`);
    } else if (o.queryParams.length) {
      problems.push(`${label} declares query parameters, but ${r.where} declares no query schema (singleValues)`);
    }
  }

  for (const o of ops) {
    const label = `docs/api/openapi.yaml  ${at(o.method, o.path)}`;
    if (!routeFor.has(key(o.method, o.path))) {
      const others = methodsAt(routes, o.path);
      problems.push(
        others.length
          ? `${label} is documented but the server registers only ${others.join(', ')} for that path`
          : `${label} is documented but no route registers it`,
      );
    }
    const inPath = paramsOf(o.path);
    for (const n of inPath.filter((p) => !o.pathParams.includes(p))) {
      problems.push(`${label} does not declare the path parameter ${n} (in: path)`);
    }
    for (const n of o.pathParams.filter((p) => !inPath.includes(p))) {
      problems.push(`${label} declares the path parameter ${n}, which its path does not contain`);
    }
  }

  return { problems, guarded, forbidding, refusing, querying };
}

function tsFilesUnder(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsFilesUnder(full, acc);
    else if (entry.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

// Self-test, runs before any real file is read

function selfTest(): string[] {
  const bad: string[] = [];
  const eq = (label: string, got: unknown, want: unknown) => {
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g !== w) bad.push(`self-test ${label}: got ${g}, want ${w}`);
  };

  eq(
    'finds get and post',
    routesIn(`app.get('/api/a', h);\napp.post("/api/b", h);`).map((r) => `${r.method} ${r.path}`),
    ['get /api/a', 'post /api/b'],
  );
  eq('ignores non-path arguments', routesIn(`cache.get('problems');\nmap.get(key);`), []);
  eq(
    'ignores a commented-out route',
    routesIn(`// app.get('/api/ghost', h);\n * app.get('/api/also-ghost', h);`),
    [],
  );
  eq(
    'accepts any receiver name',
    routesIn(`fastify.get('/api/c', h);`).map((r) => r.path),
    ['/api/c'],
  );
  eq(
    'reads spec path keys',
    specPaths(['paths:', '  /api/a:', '    get:', '      x: 1', '  /api/b:', 'components:', '  /api/nope:'].join('\n')),
    ['/api/a', '/api/b'],
  );
  eq('spec with no paths block', specPaths('info:\n  title: x\n'), []);

  // Path parameters, from the route form and the spec form

  eq('route params become spec params', toTemplate('/api/h/:hostid/x/:n'), '/api/h/{hostid}/x/{n}');
  eq('reads params from either form', [paramsOf('/api/h/:a/{b}'), paramsOf('/api/plain')], [['a', 'b'], []]);

  // Operations, with every way a parameter or a status can be written

  const spec = [
    'paths:',
    '  /api/open:',
    '    get:',
    '      security: []',
    '      responses:',
    "        '200':",
    '          description: ok',
    '  /api/hosts/{hostid}:',
    '    parameters:',
    '      - name: hostid',
    '        in: path',
    '        description: |',
    '          name: nope',
    '          in: query',
    '    get:',
    '      description: |',
    '        in: path',
    '      responses:',
    "        '200': { description: ok }",
    "        '401': { $ref: '#/components/responses/Unauthorized' }",
    '  /api/ops/{a}/{b}:',
    '    post:',
    '      parameters:',
    "        - $ref: '#/components/parameters/CsrfHeader'",
    "        - $ref: '#/components/parameters/A'",
    '        - { name: b, in: path, required: true }',
    '        - name: q',
    '          in: query',
    '      security:',
    '        - bearerAuth: []',
    '      responses:',
    "        '401': { $ref: '#/components/responses/Unauthorized' }",
    '        "403": { $ref: x }',
    '    delete:',
    '      responses:',
    '        default: { $ref: x }',
    'components:',
    '  parameters:',
    '    CsrfHeader:',
    '      name: X-HCML-CSRF',
    '      in: header',
    '    A:',
    '      name: a',
    '      in: path',
  ].join('\n');
  eq(
    'reads operations',
    specOperations(spec).map((o) => `${o.method} ${o.path} ${o.security} [${o.responses}] {${o.pathParams}}`),
    [
      'get /api/open none [200] {}',
      'get /api/hosts/{hostid} inherit [200,401] {hostid}',
      'post /api/ops/{a}/{b} set [401,403] {a,b}',
      'delete /api/ops/{a}/{b} inherit [default] {}',
    ],
  );
  eq('spec with no operations', specOperations('info:\n  title: x\n'), []);

  // Descriptions YAML would cut at a comma

  const cut = (text: string) => cutDescriptions(text).map((c) => `${c.line}:${c.entry}`);
  eq('a description cut at a comma', cut('a: { type: integer, description: Seconds, summed over the hosts }'), ['1:summed over the hosts']);
  eq('the same description quoted', cut("a: { type: integer, description: 'Seconds, summed over the hosts' }"), []);
  eq('double quotes with an escaped quote', cut('a: { description: "Say \\"a, b\\"", type: string }'), []);
  eq('a doubled apostrophe in single quotes', cut("a: { description: 'The item''s value, or none', type: string }"), []);
  eq('lists and nested mappings', cut("a: { oneOf: [{ type: number }, { type: 'null' }], description: ok }"), []);
  eq('a key with no value', cut('a: { type: string, b }'), ['1:b']);
  eq('the cut one inside another mapping', cut('a: { x: { description: One, two }, type: string }'), ['1:two']);
  eq('a comment', cut('# a: { b, c }'), []);
  eq('a block scalar is prose', cut(['a:', '  description: |', '    Write { b, c } like this.', '  type: string', 'x: { y, z }'].join('\n')), ['5:y', '5:z']);

  // The guard's two tables

  const authSource = String.raw`
    const ROUTE_RULES: { pattern: RegExp; role: Role }[] = [
      { pattern: /^\/api\/reports\/inventory/, role: 'admin' },
      // a comment between rules
      { pattern: /^\/api\/(links|net)\b/, role: 'operator' },
    ];
    const PUBLIC_ROUTES = new Set(['/api/health', "/api/auth/login"]);
  `;
  const read = guardIn(authSource);
  eq('reads the public routes', read && [...read.open], ['/api/health', '/api/auth/login']);
  eq(
    'reads the role rules',
    read?.rules.map((r) => `${r.pattern.test('/api/net/interfaces') ? 'net ' : ''}${r.role}`),
    ['admin', 'net operator'],
  );
  eq('no guard tables in the source', guardIn('const x = 1;'), null);
  eq('one table is not enough', guardIn(authSource.replace('PUBLIC_ROUTES', 'ELSEWHERE')), null);

  // The Roles table of the spec's description, against the guard's rules (DC-15)

  const rolesYaml = [
    'info:',
    '  description: |',
    '    ### Roles',
    '',
    '    | Role | Paths |',
    '    |---|---|',
    '    | `admin` | `/api/reports/inventory`, `/api/sli/email` |',
    '    | `operator` | `POST /api/problems/acknowledge` |',
    '    | `wall` | `/api/links`, `/api/net/*`: the network pages |',
    '    | `viewer` | everything else |',
    '',
    '    The ranks run viewer, wall, operator, admin.',
    'paths:',
  ].join('\n');
  const table = rolesTable(rolesYaml);
  eq('reads the rows with paths', table && [...table.keys()], ['admin', 'operator', 'wall', 'viewer']);
  eq('reads a path, a method with a path and a star', table && [table.get('admin')?.map((e) => e.path), table.get('operator')?.map((e) => `${e.method} ${e.path}`), table.get('wall')?.map((e) => `${e.path}${e.prefix ? '*' : ''}`)], [['/api/reports/inventory', '/api/sli/email'], ['post /api/problems/acknowledge'], ['/api/links', '/api/net/*']]);
  eq('no Roles heading', rolesTable('info:\n  title: x\n'), null);

  const roleGuard: Guard = {
    open: new Set(),
    rules: [
      { pattern: /^\/api\/reports\/inventory/, role: 'admin' },
      { pattern: /^\/api\/sli\/(email|recipients)/, role: 'admin' },
      { pattern: /^\/api\/(links|net)\b/, role: 'wall' },
      { pattern: /^\/api\/problems\/(acknowledge|close)/, role: 'operator' },
    ],
  };
  const roleOp = (method: string, path: string): SpecOp => ({ method, path, security: 'inherit', responses: ['200'], pathParams: [], queryParams: [] });
  const okOps = [roleOp('get', '/api/reports/inventory'), roleOp('get', '/api/sli/email'), roleOp('post', '/api/sli/email'), roleOp('post', '/api/problems/acknowledge'), roleOp('get', '/api/links'), roleOp('get', '/api/net/devices'), roleOp('get', '/api/hosts')];
  eq('a table that agrees with the rules', table && compareRoles(table, okOps, roleGuard), []);
  const newOps = [...okOps, roleOp('put', '/api/sli/recipients'), roleOp('delete', '/api/sli/recipients')];
  const missing = table ? compareRoles(table, newOps, roleGuard) : [];
  eq('a path the rules put above viewer and the table does not name', [missing.length, missing.filter((p) => p.includes('PUT /api/sli/recipients needs admin')).length, missing.filter((p) => p.includes('DELETE /api/sli/recipients needs admin')).length], [2, 1, 1]);
  const wrongRow = rolesTable(rolesYaml.replace('`/api/links`, `/api/net/*`', '`/api/links`, `/api/net/*`, `/api/hosts`')?.replace('| `wall` |', '| `wall` |') ?? '');
  eq('a path under the wrong role', (wrongRow ? compareRoles(wrongRow, okOps, roleGuard) : []).filter((p) => p.includes('puts /api/hosts under wall')).length, 1);
  eq('a method that is not the one in the table', (table ? compareRoles(table, [roleOp('delete', '/api/problems/acknowledge')], roleGuard) : []).length, 1);
  eq('a star covers what is below it, and only that', table && compareRoles(table, [roleOp('get', '/api/net/a/b'), roleOp('get', '/api/net')], roleGuard), ['docs/api/openapi.yaml  GET /api/net needs wall (ROUTE_RULES in auth.ts) but the Roles table does not name it under wall']);
  eq('a path no rule matches is left to viewer', table && compareRoles(table, [roleOp('get', '/api/networks')], roleGuard), []);

  // compare(): the clean case, then one break at a time

  const guard: Guard = { open: new Set(['/api/open']), rules: [{ pattern: /^\/api\/ops/, role: 'operator' }] };
  const route = (method: Route['method'], path: string): Route => ({ method, path, where: 'f.ts:1' });
  const op = (method: string, path: string, over: Partial<SpecOp> = {}): SpecOp => ({
    method,
    path,
    security: 'inherit',
    responses: ['200', '401'],
    pathParams: [],
    queryParams: [],
    ...over,
  });
  const found = (routes: Route[], ops: SpecOp[]) => compare(routes, ops, guard).problems;
  const has = (problems: string[], text: string) => problems.filter((p) => p.includes(text)).length;

  eq(
    'agreeing routes and spec',
    found(
      [route('get', '/api/a'), route('post', '/api/b'), route('get', '/api/ops/x'), route('get', '/api/h/:id'), route('get', '/api/open')],
      [
        op('get', '/api/a'),
        op('post', '/api/b', { responses: ['200', '400', '401', '403'] }),
        op('get', '/api/ops/x', { responses: ['200', '401', '403'] }),
        op('get', '/api/h/{id}', { pathParams: ['id'] }),
        op('get', '/api/open', { security: 'none', responses: ['200'] }),
      ],
    ),
    [],
  );
  const counted = compare([route('post', '/api/b')], [op('post', '/api/b', { responses: ['400', '401', '403'] })], guard);
  eq('counts what it applied the guard to', [counted.guarded, counted.forbidding, counted.refusing], [1, 1, 1]);

  const wrongMethod = found([route('post', '/api/a')], [op('get', '/api/a')]);
  eq('a route under the wrong method, in both directions', [has(wrongMethod, 'POST /api/a is registered but openapi.yaml documents only GET'), has(wrongMethod, 'GET /api/a is documented but the server registers only POST')], [1, 1]);
  eq('a route the spec lacks', has(found([route('get', '/api/new')], []), 'GET /api/new is registered but absent'), 1);
  eq('an operation no route has', has(found([], [op('get', '/api/old')]), 'GET /api/old is documented but no route registers it'), 1);
  eq(
    'a renamed path parameter',
    has(found([route('get', '/api/h/:id')], [op('get', '/api/h/{hostid}', { pathParams: ['hostid'] })]), 'route names its path parameters (id), openapi.yaml names them (hostid)'),
    1,
  );
  eq('an undeclared path parameter', has(found([route('get', '/api/h/:id')], [op('get', '/api/h/{id}')]), 'does not declare the path parameter id'), 1);
  eq('a declared parameter the path lacks', has(found([route('get', '/api/a')], [op('get', '/api/a', { pathParams: ['id'] })]), 'declares the path parameter id, which its path does not contain'), 1);
  eq('a guarded route with no 401', has(found([route('get', '/api/a')], [op('get', '/api/a', { responses: ['200'] })]), 'is guarded but documents no 401'), 1);
  eq('a guarded route marked open', has(found([route('get', '/api/a')], [op('get', '/api/a', { security: 'none' })]), 'is marked security: [] but the guard covers it'), 1);
  eq('a POST with no 403', has(found([route('post', '/api/a')], [op('post', '/api/a')]), 'POST /api/a can answer 403 (an unsafe method'), 1);
  eq('a POST with no 400', has(found([route('post', '/api/a')], [op('post', '/api/a', { responses: ['200', '401', '403'] })]), 'POST /api/a takes a body, so it can answer 400'), 1);
  eq('a GET needs no 400', has(found([route('get', '/api/a')], [op('get', '/api/a')]), 'can answer 400'), 0);

  // Query names: read off the registration line, inline or through a *_QUERY constant
  const queried = (q: string[]): Route => ({ ...route('get', '/api/q'), query: q });
  eq(
    'reads the declared query names',
    routesIn("const LIST_QUERY = singleValues('page', 'hostid');\napp.get('/api/a', { schema: { querystring: singleValues('b', 'a') } }, h);\napp.get('/api/b', explain(LIST_QUERY), h);\napp.get('/api/c', h);").map((r) => r.query ?? null),
    [['a', 'b'], ['hostid', 'page'], null],
  );
  eq('a query with its 400 and its names', found([queried(['a', 'b'])], [op('get', '/api/q', { responses: ['200', '400', '401'], queryParams: ['a', 'b'] })]), []);
  eq('a query with no 400', has(found([queried(['a'])], [op('get', '/api/q', { queryParams: ['a'] })]), 'declares its query, so it can answer 400'), 1);
  eq('a name the spec lacks', has(found([queried(['a', 'b'])], [op('get', '/api/q', { responses: ['200', '400', '401'], queryParams: ['a'] })]), 'does not declare the query parameter b'), 1);
  eq('a name the route lacks', has(found([queried(['a'])], [op('get', '/api/q', { responses: ['200', '400', '401'], queryParams: ['a', 'z'] })]), 'declares the query parameter z'), 1);
  eq('documented names, no schema', has(found([route('get', '/api/q')], [op('get', '/api/q', { queryParams: ['a'] })]), 'declares no query schema'), 1);
  eq(
    'reads in: query from the spec',
    specOperations(['paths:', '  /api/q:', '    get:', '      parameters:', '        - { name: b, in: query }', '        - name: a', '          in: query', '      responses:', "        '200': { description: ok }"].join('\n')).map((o) => o.queryParams),
    [['a', 'b']],
  );
  eq('a role-gated GET with no 403', has(found([route('get', '/api/ops/x')], [op('get', '/api/ops/x')]), 'can answer 403 (it needs the operator role)'), 1);
  eq('an open route needs no 401', found([route('get', '/api/open')], [op('get', '/api/open', { responses: ['200'] })]), []);
  eq('a route outside /api is not the guard\'s', found([route('get', '/metrics')], [op('get', '/metrics', { responses: ['200'] })]), []);

  return bad;
}


const selfFailures = selfTest();
if (selfFailures.length) {
  for (const f of selfFailures) console.error(f);
  console.error(`openapi.check: the checker itself is broken, ${selfFailures.length} self-test failure(s).`);
  process.exit(1);
}

const sources = tsFilesUnder(SERVER_SRC).map((f) => ({ where: relative(join(HERE, '..', '..', 'server'), f), text: readFileSync(f, 'utf8') }));
const registered = sources.flatMap((s) => routesIn(s.text, s.where));
const yaml = readFileSync(SPEC, 'utf8');
const documented = specPaths(yaml);
const operations = specOperations(yaml);

const registeredPaths = new Set(registered.map((r) => r.path));
const documentedPaths = new Set(documented);

const problems: string[] = [];

const guard = guardIn(sources.map((s) => s.text).join('\n'));
if (!guard) {
  problems.push(
    'server/src  could not read PUBLIC_ROUTES and ROUTE_RULES (auth.ts), so the 401 and 403 checks cannot run. ' +
      'If they moved or changed shape, teach guardIn() in this script the new form.',
  );
}
if (!operations.length) {
  problems.push('docs/api/openapi.yaml  no operations found under paths:. Method keys must sit at four spaces.');
}
const compared = guard ? compare(registered, operations, guard) : { problems: [], guarded: 0, forbidding: 0, refusing: 0, querying: 0 };
problems.push(...compared.problems);

const roles = rolesTable(yaml);
if (!roles) problems.push('docs/api/openapi.yaml  no Roles table found under "### Roles" in the description, so the role rules cannot be compared with it.');
else if (guard) problems.push(...compareRoles(roles, operations, guard));

for (const c of cutDescriptions(yaml)) {
  problems.push(
    `docs/api/openapi.yaml:${c.line}  a flow mapping has the entry "${c.entry}" with no key. A description with a comma in it is cut there: quote the whole description.`,
  );
}

const dupes = documented.filter((p, i) => documented.indexOf(p) !== i);
for (const d of new Set(dupes)) {
  problems.push(`docs/api/openapi.yaml  ${d} appears more than once under paths:`);
}

if (problems.length) {
  for (const p of problems) console.error(p);
  console.error(
    `\nopenapi.check: ${problems.length} problem(s). ` +
      `${registered.length} route(s) registered on ${registeredPaths.size} path(s), ${operations.length} operation(s) documented on ${documentedPaths.size}.`,
  );
  process.exit(1);
}

const byMethod = registered.reduce<Record<string, number>>((acc, r) => {
  acc[r.method] = (acc[r.method] ?? 0) + 1;
  return acc;
}, {});
const shape = Object.entries(byMethod)
  .sort()
  .map(([m, n]) => `${n} ${m.toUpperCase()}`)
  .join(' + ');

console.log(
  `openapi.check: ${registered.length} endpoints (${shape}), all documented, none extra. ` +
    `Methods and path parameters agree; 401 documented on ${compared.guarded} guarded operations, ` +
    `403 on ${compared.forbidding} that can answer it, 400 on ${compared.refusing} that take a body and on ${compared.querying} ` +
    `that declare their query, whose names agree. No description is cut at a comma.`,
);
