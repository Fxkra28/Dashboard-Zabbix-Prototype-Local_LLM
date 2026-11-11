import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The live tools audit "every page" from a list written into each of them. A page added to the app and
 * left out of the list is a page nobody audits, as the Devices page was (CK-04). This reads the routes of
 * the app and the default lists as plain text.
 */
const root = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
// Only a build context without the web folder skips these. A web folder that lacks the files means they moved, and that fails.
const present = existsSync(root('web'));

const appRoutes = () =>
  [...readFileSync(root('web/src/App.tsx'), 'utf8').matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]!).filter((path) => path !== '*');

const defaultList = (tool: string) => {
  const found = /arg\('routes'\) \|\| '([^']+)'/.exec(readFileSync(root(`tools/live/${tool}`), 'utf8'));
  if (!found) throw new Error(`${tool}: no default list of routes found`);
  return found[1]!.split(',');
};

describe.skipIf(!present)('the pages the live tools audit by default', () => {
  it('reads the routes of the app', () => {
    const routes = appRoutes();
    expect(routes.length).toBeGreaterThan(15);
    expect(routes).toContain('/devices');
  });

  it.each(['page-audit.mjs', 'layout-sweep.mjs'])('%s lists every page of the app but the sign-in screen', (tool) => {
    const listed = defaultList(tool);
    expect(appRoutes().filter((route) => route !== '/login' && !listed.includes(route))).toEqual([]);
  });
});
