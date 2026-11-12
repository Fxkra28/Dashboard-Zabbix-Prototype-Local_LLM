import { describe, expect, it } from 'vitest';

/**
 * The sentence that states a figure in Explain must not round a miss up to 100, or up to the target (BK-56), as the page,
 * the files and the Assistant's snapshot do not (BK-46). Up to three decimals, never more.
 */
describe('the figure in Explain', () => {
  it.each([
    [99.9996, undefined, '99.999'],
    [99.9994, undefined, '99.999'],
    [100, undefined, '100'],
    [98.9996, 99, '98.999'],
    [98.5, 99, '98.5'],
    [99, 99, '99'],
    [99.0004, 99, '99'],
    [99.9996, 99.9, '99.999'],
    [97.3, undefined, '97.3'],
  ])('prints %s against a target of %s as %s', async (value, target, text) => {
    const { pct } = await import('../services/explain.js');
    expect(pct(value, target)).toBe(text);
  });
});
