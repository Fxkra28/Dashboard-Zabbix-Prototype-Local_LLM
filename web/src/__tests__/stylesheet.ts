/**
 * The whole stylesheet as text, in cascade order: the numbered parts of src/styles/ joined, which is
 * what a build serves. For tests that read a rule or a token out of the CSS.
 */
const parts = import.meta.glob('../styles/[0-9]*.css', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

export const partNames = Object.keys(parts).sort();
export const stylesheet = partNames.map((name) => parts[name]).join('');
