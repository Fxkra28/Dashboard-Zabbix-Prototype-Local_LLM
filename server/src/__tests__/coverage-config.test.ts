import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Test coverage (IN-85). About 5,000 tests said nothing about which branches of `security/`, `http/` and `clients/mail.ts` they miss; the gaps found
 * so far came from hand breakages and from readers. Coverage is measured on request (`npm run test:coverage`) and has no threshold: it shows what
 * the tests miss and fails nothing, since a number to reach would be written to for its own sake.
 */
const root = (rel: string) => new URL(`../../../${rel}`, import.meta.url);
type Json = { scripts: Record<string, string>; devDependencies: Record<string, string>; packages?: Record<string, { version: string }> };
const json = (rel: string) => JSON.parse(readFileSync(root(rel), 'utf8')) as Json;
const text = (rel: string) => readFileSync(root(rel), 'utf8');
/** A config as code, comments left out, so that a comment that says "no threshold" is not read as one. */
const code = (rel: string) => text(rel).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe.each([
  ['server', 'server/vitest.config.ts'],
  ['web', 'web/vitest.config.ts'],
] as const)('coverage in %s', (pkg, config) => {
  const manifest = json(`${pkg}/package.json`);
  const lock = json(`${pkg}/package-lock.json`).packages as Record<string, { version: string }>;

  it('has the V8 provider as a dev dependency, at the version of vitest itself, since the two must match', () => {
    expect(manifest.devDependencies['@vitest/coverage-v8']).toBeTruthy();
    expect(lock['node_modules/@vitest/coverage-v8'].version).toBe(lock['node_modules/vitest'].version);
  });

  it('has a script that runs the tests with coverage, and the normal test script does not measure it', () => {
    expect(manifest.scripts['test:coverage']).toBe('vitest run --coverage');
    expect(manifest.scripts.test).not.toMatch(/coverage/);
  });

  it('names the provider, reports each folder and file as text, and sets no threshold', () => {
    const source = code(config);
    expect(source).toMatch(/provider: 'v8'/);
    expect(source).toMatch(/reporter: \['text'\]/);
    // Shown even when a test fails: what the tests miss is wanted most while something is red.
    expect(source).toMatch(/reportOnFailure: true/);
    expect(source).not.toMatch(/thresholds?:/);
    expect(source).not.toMatch(/enabled: true/);
  });

  it('leaves out its own tests and the file made from the API contract', () => {
    const source = code(config);
    expect(source).toMatch(/exclude:[^\]]*__tests__/);
    if (pkg === 'web') expect(source).toMatch(/exclude:[^\]]*generated/);
  });
});

describe('coverage at the root', () => {
  it('has one script that measures both packages, one after the other', () => {
    expect(json('package.json').scripts['test:coverage']).toBe('npm run test:coverage --prefix server && npm run test:coverage --prefix web');
  });

  it('is kept out of git: the report folder is output', () => {
    expect(text('.gitignore')).toMatch(/^coverage\/$/m);
  });
});
