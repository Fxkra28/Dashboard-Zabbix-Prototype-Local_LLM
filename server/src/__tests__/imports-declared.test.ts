import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every package a file of the server imports is declared in server/package.json (IN-105). A package that resolves only because another one depends on it, and npm hoisted it, breaks
 * with a change in that other package and none here.
 */

const server = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(server, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'dist' ? [] : files(path);
    return /\.(ts|mts|mjs|js)$/.test(e.name) ? [path] : [];
  });
}

/** The package an import names, or nothing for a relative path or a built-in. */
function packageOf(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || builtins.has(spec)) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

describe('the imports of the server', () => {
  const sources = [...files(join(server, 'src')), ...files(join(server, 'scripts'))];
  const imports = new Map<string, Set<string>>();
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:^|\s)(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w.])(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)|^import\s+['"]([^'"]+)['"]/gm)) {
      const pkg = packageOf(m[1] ?? m[2] ?? m[3]);
      if (pkg) (imports.get(pkg) ?? imports.set(pkg, new Set()).get(pkg)!).add(file.replace(server, ''));
    }
  }

  it('reads enough files to mean something', () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(imports.has('fastify')).toBe(true);
  });

  it('names each package it imports in dependencies or devDependencies', () => {
    const missing = [...imports].filter(([pkg]) => !declared.has(pkg)).map(([pkg, from]) => `${pkg} (imported by ${[...from][0]})`);
    expect(missing).toEqual([]);
  });
});
