import { describe, expect, it } from 'vitest';
import manifestSource from '../../package.json?raw';

/**
 * Every package a file of the web app imports is declared in web/package.json (IN-105). One import was not: a test used @redocly/openapi-core, which resolved only because another
 * package depended on it and npm had hoisted it, so a change in that package's own dependencies would have broken the test with no change here.
 */

const manifest = JSON.parse(manifestSource) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);
// The modules of Node that a test of this app could name without the `node:` prefix; the prefixed names are told apart by the prefix. The web project has no Node types to list them from.
const builtins = new Set(['assert', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'http', 'https', 'module', 'net', 'os', 'path', 'readline', 'stream', 'timers', 'url', 'util', 'zlib']);

/** Every source file of the app and its scripts, tests included, as text (the generated types are the one folder left out: they import nothing but types). */
const found = {
  ...(import.meta.glob(['../**/*.{ts,tsx}', '!../generated/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  ...(import.meta.glob('../../scripts/*.{mjs,js}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  ...(import.meta.glob(['../../vite.config.ts', '../../vitest.config.ts', '../../eslint.config.js'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
};

/** The package an import names: `@scope/name` or the first segment, and nothing for a relative path, a built-in, a URL or a vite query. */
function packageOf(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || spec.startsWith('virtual:') || builtins.has(spec)) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

describe('the imports of the web app', () => {
  const imports = new Map<string, Set<string>>();
  for (const [file, text] of Object.entries(found)) {
    for (const m of text.matchAll(/(?:^|\s)(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w.])(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)|^import\s+['"]([^'"]+)['"]/gm)) {
      const pkg = packageOf(m[1] ?? m[2] ?? m[3]);
      if (pkg) (imports.get(pkg) ?? imports.set(pkg, new Set()).get(pkg)!).add(file);
    }
  }

  it('reads enough files to mean something', () => {
    expect(Object.keys(found).length).toBeGreaterThan(100);
    expect(imports.has('react')).toBe(true);
  });

  it('names each package it imports in dependencies or devDependencies', () => {
    const missing = [...imports].filter(([pkg]) => !declared.has(pkg)).map(([pkg, from]) => `${pkg} (imported by ${[...from][0]})`);
    expect(missing).toEqual([]);
  });

  it('declares @redocly/openapi-core, which the test of the types reads', () => {
    expect(declared.has('@redocly/openapi-core')).toBe(true);
    expect(imports.get('@redocly/openapi-core')?.size ?? 0).toBeGreaterThan(0);
  });
});
