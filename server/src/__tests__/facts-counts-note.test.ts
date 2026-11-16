import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * In CI the test counts the documents state cannot be judged (IN-87): the checker skips that rule when no test has written `.test-counts.json`, and
 * the `checks` job runs none. The step was named "the counts the docs state are the ones the code has" and said nothing of the skip, so a green step read as more than
 * it was. The checker now says when it did not judge them, and the step says who does.
 */
const repo = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const { countsNote } = (await import(pathToFileURL(repo('tools/check/facts.check.mjs')).href)) as { countsNote: (judged: boolean) => string };

describe('what facts.check says about the test counts', () => {
  it('says nothing when it judged them', () => {
    expect(countsNote(true)).toBe('');
  });

  it('says that it did not, why, and who does, when it could not', () => {
    const note = countsNote(false);
    expect(note).toMatch(/test counts were not judged/);
    expect(note).toMatch(/\.test-counts\.json/);
    expect(note).toMatch(/npm run verify/);
  });

  it('puts that note on the line it prints, and returns whether it judged them', () => {
    const source = readFileSync(repo('tools/check/facts.check.mjs'), 'utf8');
    expect(source).toMatch(/countsJudged/);
    expect(source).toMatch(/\$\{countsNote\(countsJudged\)\}/);
  });
});

describe('the CI step that runs facts.check', () => {
  const ci = readFileSync(repo('.github/workflows/ci.yml'), 'utf8');
  const step = /- name: ([^\n]*)\n\s+run: node tools\/check\/facts\.check\.mjs/.exec(ci)?.[1] ?? '';

  it('says that the test counts are judged by npm run verify, which runs the tests first, and not by CI', () => {
    expect(step, 'the step that runs facts.check').not.toBe('');
    expect(step).toMatch(/test counts/);
    expect(step).toMatch(/npm run verify/);
  });

  it('no longer claims that the counts the docs state are the ones the code has, in so many words', () => {
    expect(step).not.toMatch(/^The counts the docs state are the ones the code has$/);
  });
});
