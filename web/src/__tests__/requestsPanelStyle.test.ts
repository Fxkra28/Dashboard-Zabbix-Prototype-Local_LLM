import { describe, expect, it } from 'vitest';
import { stylesheet } from './stylesheet';

/** A name that a stranger types can be eighty characters with no space in it (FR-62): in the list of requests it must wrap and shrink with the panel, and not widen it. */
describe('the list of requests for an account', () => {
  const rule = /\.requests li\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? '';

  it('lets what was typed wrap and shrink with the panel', () => {
    expect(rule).not.toBe('');
    expect(rule).toMatch(/min-width:\s*0/);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
