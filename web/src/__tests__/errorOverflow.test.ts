import { describe, expect, it } from 'vitest';
import { stylesheet } from './stylesheet';

/**
 * An error a dialog shows can hold an address of up to 254 characters with no place to break, and the outside-domain sentence
 * repeats it whole. In a dialog about 318 px wide (a 390 px screen) it must wrap and not run past the edge (FR-29).
 */

/** The declarations of the first rule whose selector list ends in exactly `selector`. */
function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n|\\})[ \\t]*${escaped}\\s*\\{([^}]*)\\}`).exec(stylesheet);
  expect(match, `a rule for ${selector}`).not.toBeNull();
  return match![1]!;
}

describe('the error line of a dialog', () => {
  it('breaks a long word instead of running past the edge', () => {
    expect(declarations('.login-error')).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
