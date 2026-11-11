/**
 * Reads the code the handbook describes and builds the facts the generated blocks are made of: what each file
 * exports, what it imports, who imports it, and which tests touch it.
 *
 * TypeScript's own parser does the reading (the `typescript` of server/node_modules, which CI already installs for tsx),
 * so a declaration is found by what it is and not by a pattern that a line break could defeat.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, posix } from 'node:path';
import { areaOf, cardFiles, GENERATED_FILES, isTestFile, testFiles } from './scope.mjs';

/** The `typescript` package of this tree's server. */
export function loadTypescript(root) {
  return createRequire(join(root, 'server', 'package.json'))('typescript');
}

const SIGNATURE_MAX = 120;
const SUMMARY_MAX = 150;

const squash = (text) => text.replace(/\s+/g, ' ').trim();

/** One line, with the spaces and the trailing comma a wrapped parameter list leaves inside its brackets taken out. */
const tidy = (text) => squash(text).replace(/([([]) /g, '$1').replace(/,? ([)\]])/g, '$1');

/** `text` cut at a space before `max` characters, with `...` where it was cut. */
export function clip(text, max) {
  const flat = tidy(text);
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 3);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;(<{[]+$/, '')}...`;
}

/** The first sentence of a comment: up to the first full stop followed by a space, or all of it. */
export function firstSentence(comment) {
  const flat = squash(comment.replace(/^\s*\/\*+|\*+\/\s*$/g, '').replace(/^\s*\* ?/gm, '').replace(/^\s*\/\/ ?/gm, ''));
  const stop = flat.search(/[.!?](?:\s|$)/);
  const sentence = stop >= 0 ? flat.slice(0, stop + 1) : flat;
  return clip(sentence, SUMMARY_MAX);
}

/** The comment that sits directly above `node`: a JSDoc block, or the last run of `//` lines. `text` is empty when there is none. */
function leadingComment(ts, sf, node) {
  const text = sf.text;
  const none = { text: '', pos: node.getStart(sf) };
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  if (!ranges.length) return none;
  const last = ranges[ranges.length - 1];
  // A comment separated from the declaration by a blank line belongs to something else.
  if ((text.slice(last.end, node.getStart(sf)).match(/\n/g) ?? []).length > 1) return none;
  if (last.kind === ts.SyntaxKind.MultiLineCommentTrivia) return { text: text.slice(last.pos, last.end), pos: last.pos };
  // Join the run of line comments that ends at the declaration.
  let first = ranges.length - 1;
  while (first > 0 && ranges[first - 1].kind === ts.SyntaxKind.SingleLineCommentTrivia && (text.slice(ranges[first - 1].end, ranges[first].pos).match(/\n/g) ?? []).length <= 1) first--;
  return { text: ranges.slice(first).map((r) => text.slice(r.pos, r.end)).join('\n'), pos: ranges[first].pos };
}

/**
 * The block comment that describes the file as a whole: one before the first statement that is not an import, and not
 * the one attached to that statement (a comment a line above a declaration describes the declaration).
 */
function headerComment(ts, sf) {
  const text = sf.text;
  const stop = sf.statements.findIndex((s) => !ts.isImportDeclaration(s));
  const upTo = stop < 0 ? sf.statements.length : stop + 1;
  for (let i = 0; i < upTo; i++) {
    const node = sf.statements[i];
    const ranges = (ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []).filter((r) => r.kind === ts.SyntaxKind.MultiLineCommentTrivia && text.slice(r.pos, r.pos + 3) === '/**');
    for (const r of ranges) {
      const gap = text.slice(r.end, node.getStart(sf));
      const attached = (gap.match(/\n/g) ?? []).length <= 1;
      if (!attached) return text.slice(r.pos, r.end);
    }
  }
  return '';
}

const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

function modifiersOf(ts, node) {
  return new Set((ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : []).map((m) => ts.SyntaxKind[m.kind]));
}

/** A kind a reader recognises: component and hook are told apart from a plain function. */
function functionKind(name, isTsx) {
  if (/^use[A-Z0-9]/.test(name)) return 'hook';
  if (isTsx && /^[A-Z]/.test(name)) return 'component';
  return 'function';
}

/** A value that is data, not a signature: a string, a list or an object, or one of them joined or cut. A card names such a constant and leaves its content to the code. */
function holdsData(ts, node) {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n))) n = n.expression;
  return (
    ts.isStringLiteral(n) ||
    ts.isNoSubstitutionTemplateLiteral(n) ||
    ts.isTemplateExpression(n) ||
    ts.isArrayLiteralExpression(n) ||
    ts.isObjectLiteralExpression(n) ||
    (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) ||
    (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && holdsData(ts, n.expression.expression))
  );
}

function signatureOf(ts, sf, node, declaration) {
  const start = node.getStart(sf);
  const text = sf.text;
  if (ts.isFunctionDeclaration(node)) {
    const end = node.body ? node.body.getStart(sf) : node.getEnd();
    return clip(text.slice(start, end).replace(/^export\s+(default\s+)?/, ''), SIGNATURE_MAX);
  }
  if (declaration && ts.isVariableDeclaration(declaration)) {
    const init = declaration.initializer;
    const keyword = (node.declarationList.flags & ts.NodeFlags.Const) ? 'const' : (node.declarationList.flags & ts.NodeFlags.Let) ? 'let' : 'var';
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
      const end = init.body.getStart(sf);
      return clip(`${keyword} ${text.slice(declaration.getStart(sf), end)}`, SIGNATURE_MAX);
    }
    if (declaration.type) return clip(`${keyword} ${declaration.name.getText(sf)}: ${declaration.type.getText(sf)}`, SIGNATURE_MAX);
    if (init && !holdsData(ts, init)) return clip(`${keyword} ${declaration.name.getText(sf)} = ${init.getText(sf)}`, SIGNATURE_MAX);
    return `${keyword} ${declaration.name.getText(sf)}`;
  }
  if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) {
    const brace = text.indexOf('{', start);
    return clip(text.slice(start, brace < 0 ? node.getEnd() : brace).replace(/^export\s+(default\s+)?(declare\s+)?(abstract\s+)?/, ''), SIGNATURE_MAX);
  }
  if (ts.isTypeAliasDeclaration(node)) return clip(text.slice(start, node.getEnd()).replace(/^export\s+(declare\s+)?/, '').replace(/;$/, ''), SIGNATURE_MAX);
  return clip(text.slice(start, node.getEnd()), SIGNATURE_MAX);
}

/**
 * Everything a file declares at its top level, exported or not (a snippet may quote a private helper), and what it exports.
 * `decls` maps a name to where its text sits, for the snippet blocks.
 */
export function parseSource(ts, rel, text) {
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : rel.endsWith('.js') || rel.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  const isTsx = rel.endsWith('.tsx');
  const exports = [];
  const decls = new Map();
  const imports = [];
  const reexportAll = [];
  const header = headerComment(ts, sf);

  const addDecl = (name, node) => {
    if (decls.has(name)) return;
    decls.set(name, { start: node.getStart(sf), end: node.getEnd(), docStart: leadingComment(ts, sf, node).pos, startLine: lineOf(sf, node.getStart(sf)), endLine: lineOf(sf, node.getEnd()) });
  };

  for (const node of sf.statements) {
    const mods = modifiersOf(ts, node);
    const exported = mods.has('ExportKeyword');
    const isDefault = mods.has('DefaultKeyword');
    const comment = leadingComment(ts, sf, node).text;

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({ spec: node.moduleSpecifier.text, typeOnly: !!node.importClause?.isTypeOnly, line: lineOf(sf, node.getStart(sf)) });
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push({ spec: node.moduleSpecifier.text, typeOnly: !!node.isTypeOnly, line: lineOf(sf, node.getStart(sf)), reexport: true });
        if (!node.exportClause) reexportAll.push(node.moduleSpecifier.text);
      }
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          exports.push({
            name: el.name.text,
            kind: 're-export',
            line: lineOf(sf, el.getStart(sf)),
            endLine: lineOf(sf, el.getEnd()),
            signature: node.moduleSpecifier ? `from ${node.moduleSpecifier.getText(sf)}` : '',
            summary: '',
            from: node.moduleSpecifier?.text ?? null,
            local: el.propertyName?.text ?? el.name.text,
          });
        }
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      addDecl(node.name.text, node);
      if (exported) {
        exports.push({ name: isDefault ? 'default' : node.name.text, kind: functionKind(node.name.text, isTsx), line: lineOf(sf, node.getStart(sf)), endLine: lineOf(sf, node.getEnd()), signature: signatureOf(ts, sf, node), summary: firstSentence(comment) });
      }
    } else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        addDecl(d.name.text, node);
        if (!exported) continue;
        const init = d.initializer;
        const fn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
        exports.push({ name: d.name.text, kind: fn ? functionKind(d.name.text, isTsx) : 'constant', line: lineOf(sf, node.getStart(sf)), endLine: lineOf(sf, node.getEnd()), signature: signatureOf(ts, sf, node, d), summary: firstSentence(comment) });
      }
    } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) {
      if (!node.name) continue;
      addDecl(node.name.text, node);
      if (ts.isClassDeclaration(node)) {
        for (const member of node.members) {
          if ((ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) && member.name && ts.isIdentifier(member.name)) addDecl(`${node.name.text}.${member.name.text}`, member);
        }
      }
      if (exported) {
        const k = ts.isInterfaceDeclaration(node) ? 'interface' : ts.isTypeAliasDeclaration(node) ? 'type' : ts.isClassDeclaration(node) ? 'class' : 'enum';
        exports.push({ name: node.name.text, kind: k, line: lineOf(sf, node.getStart(sf)), endLine: lineOf(sf, node.getEnd()), signature: signatureOf(ts, sf, node), summary: firstSentence(comment) });
      }
    } else if (ts.isExportAssignment(node)) {
      exports.push({ name: 'default', kind: 'constant', line: lineOf(sf, node.getStart(sf)), endLine: lineOf(sf, node.getEnd()), signature: clip(node.getText(sf), SIGNATURE_MAX), summary: firstSentence(comment) });
    }
  }

  // Dynamic imports and vi.mock calls name files too, and the router loads every page this way.
  const strings = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) imports.push({ spec: arg.text, typeOnly: false, line: lineOf(sf, node.getStart(sf)), dynamic: true });
        else if (/^vi\.(mock|doMock|importActual|importMock)$/.test(node.expression.getText(sf))) strings.push({ spec: arg.text, line: lineOf(sf, node.getStart(sf)) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const s of strings) imports.push({ ...s, typeOnly: false, mock: true });

  return { exports, decls, imports, reexportAll, header, sf, lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0) };
}

/** The file a relative import names, as a path from the root, or null when it names none of `known`. */
export function resolveImport(fromRel, spec, known) {
  if (!spec.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(fromRel), spec));
  const stripped = base.replace(/\.(m?js|jsx)$/, '');
  const candidates = [base, `${stripped}.ts`, `${stripped}.tsx`, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find((c) => known.has(c)) ?? null;
}

/** The package an import names: `@fastify/cookie`, `react`, `node:fs`. Null for a relative path. */
export function packageOf(spec) {
  if (spec.startsWith('.') || spec.startsWith('/')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** The endpoints a route file registers, as `GET /api/x`: for the card, and for finding the tests that call them. */
export function routeEndpoints(text) {
  const seen = new Set();
  for (const m of text.matchAll(/\b(?:app|fastify)\.(get|post|put|delete|patch)\(\s*['"`](\/[^'"`?]+)/g)) seen.add(`${m[1].toUpperCase()} ${m[2]}`);
  return [...seen];
}

/** How many tests a test file declares: `it(`, `test(` and their `.each`, `.skip` and `.only` forms, at any depth. */
export function countTests(text) {
  return (text.match(/^\s*(?:it|test)(?:\.(?:each|skip|only|concurrent))*\s*[(`]/gm) ?? []).length;
}

/** The title of each top-level `describe` of a test file. */
export function describeTitles(text) {
  return [...text.matchAll(/^describe(?:\.\w+)*\(\s*(['"`])(.*?)\1/gm)].map((m) => m[2]);
}

const hash = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Reads the whole tree: every card file and every test file, parsed, with the links between them. Returns
 * `{ files, tests, byPath }` where each file knows what it exports, imports, is imported by, and which tests touch it.
 */
export function buildModel(root) {
  const ts = loadTypescript(root);
  const cards = cardFiles(root);
  const tests = testFiles(root);
  const known = new Set([...cards, ...tests]);
  // A file a test or a page imports that is neither (a JSON file, a helper): resolvable, so it is not reported as missing.
  for (const rel of ['web/src/generated/openapi.json']) if (existsSync(join(root, rel))) known.add(rel);
  const parsed = new Map();
  const textOf = new Map();
  for (const rel of [...cards, ...tests]) {
    const text = readFileSync(join(root, rel), 'utf8');
    textOf.set(rel, text);
    if (/\.(ts|tsx|mjs|js)$/.test(rel)) parsed.set(rel, parseSource(ts, rel, text));
  }

  const files = new Map();
  for (const rel of cards) {
    const p = parsed.get(rel);
    const text = textOf.get(rel);
    files.set(rel, {
      rel,
      area: areaOf(rel),
      lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0),
      generated: GENERATED_FILES.has(rel),
      language: rel.split('.').pop(),
      exports: p ? p.exports : [],
      decls: p ? p.decls : new Map(),
      header: p ? firstSentence(p.header) : '',
      headerFull: p ? p.header : '',
      imports: [],
      packages: [],
      importedBy: [],
      testedBy: [],
      endpoints: /\.ts$/.test(rel) && rel.startsWith('server/src/routes/') ? routeEndpoints(text) : [],
      calledBy: [],
      text,
      sha: hash(text).slice(0, 12),
    });
  }

  const testInfo = new Map();
  for (const rel of tests) {
    const text = textOf.get(rel);
    testInfo.set(rel, { rel, lines: text.split('\n').length, tests: countTests(text), describes: describeTitles(text), covers: [], text });
  }

  for (const [rel, p] of parsed) {
    const isTest = isTestFile(rel);
    const owner = files.get(rel);
    const info = testInfo.get(rel);
    const packages = new Set();
    const internal = new Set();
    for (const imp of p.imports) {
      const pkg = packageOf(imp.spec);
      if (pkg) {
        packages.add(pkg);
        continue;
      }
      const target = resolveImport(rel, imp.spec, known);
      if (!target || target === rel) continue;
      internal.add(target);
    }
    if (owner) {
      owner.imports = [...internal].filter((t) => files.has(t)).sort();
      owner.packages = [...packages].sort();
      for (const t of owner.imports) files.get(t).importedBy.push(rel);
    }
    if (isTest && info) {
      for (const t of internal) if (files.has(t)) {
        info.covers.push(t);
        files.get(t).testedBy.push(rel);
      }
    }
  }

  // A test named for the file it covers counts even when it reaches the file through a helper.
  for (const [rel, info] of testInfo) {
    const stem = posix.basename(rel).replace(/\.test\.(ts|tsx)$/, '');
    const dir = posix.dirname(rel).replace(/\/__tests__$/, '');
    for (const f of files.values()) {
      if (posix.basename(f.rel).replace(/\.(ts|tsx)$/, '') !== stem) continue;
      if (!f.rel.startsWith(dir.split('/').slice(0, 2).join('/'))) continue;
      if (!f.testedBy.includes(rel)) {
        f.testedBy.push(rel);
        info.covers.push(f.rel);
      }
    }
  }

  // A route's tests are the ones that call its paths.
  for (const f of files.values()) {
    if (!f.endpoints.length) continue;
    const paths = f.endpoints.map((e) => e.split(' ')[1]);
    for (const info of testInfo.values()) {
      if (!info.rel.startsWith('server/')) continue;
      if (paths.some((p) => info.text.includes(`'${p}`) || info.text.includes(`"${p}`) || info.text.includes(`\`${p}`))) f.calledBy.push(info.rel);
    }
  }

  for (const f of files.values()) {
    f.importedBy = [...new Set(f.importedBy)].sort();
    f.testedBy = [...new Set(f.testedBy)].sort();
    f.calledBy = [...new Set(f.calledBy)].sort();
  }
  for (const info of testInfo.values()) info.covers = [...new Set(info.covers)].sort();

  return { files, tests: testInfo, ts, parsed };
}

/** The hash a snippet records: the text of the quoted declaration, lines trimmed at the end, LF endings. */
export const snippetHash = (text) => createHash('sha256').update(text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n')).digest('hex').slice(0, 12);
