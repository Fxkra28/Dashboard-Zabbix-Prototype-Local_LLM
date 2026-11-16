import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * tools/check/installed.check.mjs (IN-80): the packages in server/node_modules and web/node_modules are the ones their lock files name. The local-model
 * copy once ran its tests on fastify 5.12.7 and three other packages older than its lock, so "run in both copies" was true of the files and not of the code.
 * Run against a made-up tree, never the real one.
 */
const SCRIPT = fileURLToPath(new URL('../../../tools/check/installed.check.mjs', import.meta.url));

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'portal-installed-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

type Entry = { version: string; optional?: boolean; link?: boolean };
/** One project: its lock file, and what is installed (`undefined` is not installed at all). */
function project(name: 'server' | 'web', locked: Record<string, Entry>, installed: Record<string, string | undefined>, withModules = true) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const packages: Record<string, Entry | object> = { '': { name } };
  for (const [key, entry] of Object.entries(locked)) packages[`node_modules/${key}`] = entry;
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  if (!withModules) return;
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  for (const [key, version] of Object.entries(installed)) {
    if (version === undefined) continue;
    mkdirSync(join(dir, 'node_modules', key), { recursive: true });
    writeFileSync(join(dir, 'node_modules', key, 'package.json'), JSON.stringify({ name: key, version }));
  }
}
const run = () => {
  const r = spawnSync('node', [SCRIPT, root], { encoding: 'utf8', timeout: 20_000 });
  return { code: r.status, text: `${r.stdout}${r.stderr}` };
};

const LOCKED = { alpha: { version: '1.0.0' }, beta: { version: '2.0.0' } };

describe('installed.check.mjs', () => {
  it('passes when every locked package is installed at its locked version, and says how many it looked at', () => {
    project('server', LOCKED, { alpha: '1.0.0', beta: '2.0.0' });
    project('web', { gamma: { version: '3.0.0' } }, { gamma: '3.0.0' });
    const r = run();
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/server 2 packages and web 1 package/);
  });

  it('fails on a package installed older or newer than its lock, naming it, both versions and the way out', () => {
    project('server', LOCKED, { alpha: '1.0.0', beta: '1.9.0' });
    project('web', { gamma: { version: '3.0.0' } }, { gamma: '3.0.1' });
    const r = run();
    expect(r.code).toBe(1);
    expect(r.text).toContain('server: beta is 1.9.0, and the lock file says 2.0.0');
    expect(r.text).toContain('web: gamma is 3.0.1, and the lock file says 3.0.0');
    expect(r.text).toContain('npm run install:all');
    expect(r.text).not.toContain('alpha');
  });

  it('fails on a package that is not installed, but not on an optional one: a platform leaves those out', () => {
    project('server', { ...LOCKED, native: { version: '1.0.0', optional: true } }, { alpha: '1.0.0' });
    project('web', {}, {});
    const r = run();
    expect(r.code).toBe(1);
    expect(r.text).toContain('server: beta is not installed');
    expect(r.text).not.toContain('native');
  });

  it('follows a package nested under another, and skips a link', () => {
    project('server', { alpha: { version: '1.0.0' }, 'alpha/node_modules/delta': { version: '0.1.0' }, local: { version: '9.9.9', link: true } }, { alpha: '1.0.0', 'alpha/node_modules/delta': '0.2.0' });
    project('web', {}, {});
    const r = run();
    expect(r.code).toBe(1);
    expect(r.text).toContain('server: alpha/node_modules/delta is 0.2.0, and the lock file says 0.1.0');
    expect(r.text).not.toContain('local');
  });

  it('fails in words, not with a trace, when a project has no node_modules at all', () => {
    project('server', LOCKED, {}, false);
    project('web', {}, {});
    const r = run();
    expect(r.code).toBe(1);
    expect(r.text).toContain('server: nothing is installed');
    expect(r.text).toContain('npm run install:all');
    expect(r.text).not.toMatch(/Traceback|TypeError|ENOENT|at .*\.mjs/);
  });

  it('names at most twenty packages and counts the rest', () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, { version: '1.0.0' }]));
    project('server', many, Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, '0.9.0'])));
    project('web', {}, {});
    const r = run();
    expect(r.code).toBe(1);
    expect(r.text.match(/is 0\.9\.0/g)).toHaveLength(20);
    expect(r.text).toContain('and 10 more');
  });
});
