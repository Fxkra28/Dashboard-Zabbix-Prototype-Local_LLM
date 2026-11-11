/**
 * Sets the freshness stamp on every diagram source whose stamp is missing or out of date.
 *
 * Run it last: after a `.mmd` is edited and its PDF (and PNG) re-rendered. diagrams.check.mjs fails
 * when a source no longer matches its stamp, and this is the one place the stamp is written, so the
 * check itself stays read-only.
 *
 *   node tools/check/diagrams.stamp.mjs [repo root] [--force]
 *
 * It writes only the stamp line, the last line of the file, and only to a source that needs it. It
 * refuses a source whose PDF is older than the source or missing, because that is the one mistake it
 * can see: an edit stamped without a re-render. A file date means something on the machine where the
 * render was made, which is where this runs; in a fresh checkout nothing needs stamping. `--force`
 * stamps anyway, for an edit that cannot change the picture, such as a comment.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filesEndingIn, stampState, stamped } from './diagrams.check.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const root = resolve(args.find((a) => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
if (!statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`);

let written = 0;
let current = 0;
let refused = 0;
for (const source of filesEndingIn(root, ['.mmd'])) {
  const text = readFileSync(source, 'utf8');
  if (stampState(text).state === 'fresh') {
    current++;
    continue;
  }
  const pdf = `${source.slice(0, -'.mmd'.length)}.pdf`;
  if (!force && (!existsSync(pdf) || statSync(pdf).mtimeMs < statSync(source).mtimeMs)) {
    console.error(`${relative(root, source)}: its PDF is missing or older than the source. Re-render first, or pass --force.`);
    refused++;
    continue;
  }
  writeFileSync(source, stamped(text));
  console.log(`stamped ${relative(root, source)}`);
  written++;
}
console.log(`diagrams.stamp: ${written} stamped, ${current} already current${refused ? `, ${refused} refused` : ''}.`);
if (refused) process.exit(1);
