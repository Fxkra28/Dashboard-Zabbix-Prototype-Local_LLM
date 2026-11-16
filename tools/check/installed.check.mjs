/**
 * The packages in server/node_modules and web/node_modules are the ones their lock files name (IN-80).
 *
 * The local-model copy once ran its tests on fastify 5.12.7 and three other packages older than its lock file, the ones that a security
 * advisory had moved, so "run in both copies" was true of the files and not of the code. `npm ci` makes them equal; nothing said when it had not been run.
 * Read: each package of the lock file (nested ones included) against the package.json that is installed for it. An optional package that is not installed is
 * left alone, since a platform leaves those out, and so is a link. Run first in `npm run verify`, before the tests that rest on what is installed.
 *
 *   node tools/check/installed.check.mjs [repo root]   (default: two levels up)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOWN = 20;
const PROJECTS = ['server', 'web'];

/** The problems of one project, one sentence each, and how many packages its lock file names. */
function checkProject(root, name) {
  const dir = join(root, name);
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  const problems = [];
  let count = 0;
  if (!existsSync(join(dir, 'node_modules'))) return { count: 0, problems: [`${name}: nothing is installed`] };
  for (const [key, meta] of Object.entries(lock.packages ?? {})) {
    if (!key || meta.link) continue;
    count++;
    const label = key.replace(/^node_modules\//, '');
    const file = join(dir, key, 'package.json');
    if (!existsSync(file)) {
      if (!meta.optional) problems.push(`${name}: ${label} is not installed`);
      continue;
    }
    const installed = JSON.parse(readFileSync(file, 'utf8')).version;
    if (installed !== meta.version) problems.push(`${name}: ${label} is ${installed}, and the lock file says ${meta.version}`);
  }
  return { count, problems };
}

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const results = PROJECTS.map((name) => ({ name, ...checkProject(root, name) }));
const problems = results.flatMap((r) => r.problems);
if (problems.length) {
  for (const p of problems.slice(0, SHOWN)) console.error(p);
  if (problems.length > SHOWN) console.error(`and ${problems.length - SHOWN} more`);
  console.error(`\ninstalled.check: ${problems.length} installed package(s) are not the ones the lock files name. Run \`npm run install:all\` in this folder, then verify again.`);
  process.exit(1);
}
const plural = (n) => `${n} package${n === 1 ? '' : 's'}`;
console.log(`installed.check: ${results.map((r) => `${r.name} ${plural(r.count)}`).join(' and ')} are the ones their lock files name.`);
