import { describe, expect, it } from 'vitest';

/**
 * How web/src is layered. A feature folder holds one part of the portal (its pages, components, hooks and the logic
 * beside them, and their tests); shared/ holds what two or more features use; the root holds the app shell and the
 * contract with the BFF (api, types, guards, theme). Code depends downwards only: root files (but App and main) and
 * shared/ import no feature, and a feature imports another only where this table says so, so a feature can be read,
 * changed or deleted knowing who else is touched.
 */

/** Feature to the features it may import. Adding a line here is the decision to couple two features. */
const MAY_IMPORT: Record<string, string[]> = {
  assistant: [],
  auth: [],
  dashboard: ['hosts', 'meters', 'problems', 'shell'],
  graphs: [],
  hosts: [],
  meters: [],
  network: ['graphs', 'hosts'],
  problems: ['assistant'],
  reports: [],
  shell: ['assistant'],
  sla: ['assistant'],
};

// Every shipped source as text, keyed by its path from here ('../features/hosts/Hosts.tsx'). Tests, fixtures and CSS are left out.
const raw = import.meta.glob(['../**/*.{ts,tsx}', '!../__tests__/**', '!../**/*.test.{ts,tsx}', '!../styles/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** 'features/hosts/Hosts.tsx' from '../features/hosts/Hosts.tsx'. */
const files = Object.keys(raw).map((key) => key.slice('../'.length));

function resolve(from: string, spec: string): string {
  const out = from.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.') out.push(part);
  }
  return out.join('/');
}

/** What a file imports, as paths from src without an extension: 'features/hosts/Hosts', 'shared/lib/time'. */
function importsOf(file: string): string[] {
  return [...raw[`../${file}`].matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => resolve(file, m[1]));
}

/** What a file loads when it runs: `import type` and `export type` are erased by the compiler, so they are not an edge. */
function runtimeImportsOf(file: string): string[] {
  const text = raw[`../${file}`];
  const specs = [
    ...[...text.matchAll(/^(?:import|export)\s+(type\s+)?[^;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/gm)].filter((m) => !m[1]).map((m) => m[2]),
    ...[...text.matchAll(/\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ];
  return specs.map((spec) => resolve(file, spec));
}

/** The feature's name, 'shared', or 'root'. */
function unitOf(path: string): string {
  const [first, second] = path.split('/');
  if (first === 'features') return second;
  return first === 'shared' ? 'shared' : 'root';
}

const isFeaturePath = (path: string) => path.startsWith('features/');
const isFeature = (unit: string) => unit in MAY_IMPORT;

describe('the layers of web/src', () => {
  it('finds the files it checks', () => {
    expect(files.length).toBeGreaterThan(80);
    expect(new Set(files.map(unitOf))).toEqual(new Set(['root', 'shared', ...Object.keys(MAY_IMPORT)]));
  });

  it('has the folders of the table and no other feature folder', () => {
    expect([...new Set(files.filter(isFeaturePath).map(unitOf))].sort()).toEqual(Object.keys(MAY_IMPORT).sort());
  });

  it('has no root file but App and main that imports a feature, and no shared file that imports one', () => {
    const offenders = files
      .filter((f) => (unitOf(f) === 'root' && !/^(App|main)\.tsx$/.test(f)) || unitOf(f) === 'shared')
      .flatMap((f) => importsOf(f).filter(isFeaturePath).map((t) => `${f} imports ${t}`));
    expect(offenders).toEqual([]);
  });

  it('lets a feature import another only where the table allows it', () => {
    const offenders = files
      .filter((f) => isFeature(unitOf(f)))
      .flatMap((f) =>
        importsOf(f)
          .filter((t) => isFeaturePath(t) && unitOf(t) !== unitOf(f) && !MAY_IMPORT[unitOf(f)].includes(unitOf(t)))
          .map((t) => `${f} imports ${t}`),
      );
    expect(offenders).toEqual([]);
  });

  it('has no cycle between the features the table allows', () => {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (unit: string, trail: string[]) => {
      if (done.has(unit)) return;
      if (visiting.has(unit)) throw new Error(`cycle: ${[...trail, unit].join(' -> ')}`);
      visiting.add(unit);
      for (const next of MAY_IMPORT[unit]) visit(next, [...trail, unit]);
      visiting.delete(unit);
      done.add(unit);
    };
    expect(() => Object.keys(MAY_IMPORT).forEach((unit) => visit(unit, []))).not.toThrow();
  });

  it('has no import cycle among the shipped files, a type-only import not counting', () => {
    // api/ is a folder of files that import one another (the calls, the transport, the session); a cycle there would make what a test
    // that replaces `api` sees depend on which file loaded first.
    const stem = (f: string) => f.replace(/\.(ts|tsx)$/, '').replace(/\/index$/, '');
    const byStem = new Map(files.map((f) => [stem(f), f]));
    const edges = new Map(files.map((f) => [f, runtimeImportsOf(f).map((t) => byStem.get(stem(t))).filter((t): t is string => t !== undefined)]));
    const cycles: string[] = [];
    const state = new Map<string, 'open' | 'done'>();
    const walk = (node: string, trail: string[]) => {
      state.set(node, 'open');
      for (const next of edges.get(node) ?? []) {
        if (state.get(next) === 'open') cycles.push([...trail.slice(trail.indexOf(next)), node, next].join(' -> '));
        else if (!state.has(next)) walk(next, [...trail, node]);
      }
      state.set(node, 'done');
    };
    for (const node of edges.keys()) if (!state.has(node)) walk(node, []);
    expect(cycles).toEqual([]);
  });

  it('has no shipped file that imports a test or a fixture', () => {
    const offenders = files.flatMap((f) => importsOf(f).filter((t) => t.includes('__tests__') || t.endsWith('.test')).map((t) => `${f} imports ${t}`));
    expect(offenders).toEqual([]);
  });
});
