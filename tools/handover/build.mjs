/**
 * Rewrites the generated blocks of the handbook (docs/handover) from the code, and sets each page's reading time.
 *
 *   node tools/handover/build.mjs                    rewrite every page that is out of date
 *   node tools/handover/build.mjs --accept FILE...   also take the new hash of the code under each snippet of these pages,
 *                                                    which says the explanation beside it was read again
 *   node tools/handover/build.mjs --dry              say what would change and write nothing
 *
 * `npm run handover:build` is the same without arguments. tools/check/handover.check.mjs fails while a page is out of date.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPages, processDocument } from './lib/document.mjs';
import { buildModel } from './lib/model.mjs';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const acceptIndex = args.indexOf('--accept');
const accepted = new Set(acceptIndex >= 0 ? args.slice(acceptIndex + 1).filter((a) => !a.startsWith('--')).map((a) => resolve(a)) : []);

const model = buildModel(root);
let changed = 0;
let reviews = 0;
for (const rel of listPages(root)) {
  const file = join(root, rel);
  const before = readFileSync(file, 'utf8');
  const { text, problems } = processDocument(model, root, rel, before, { accept: accepted.has(file) });
  for (const p of problems) {
    console.error(`${rel}:${p.line}  ${p.message}`);
    if (p.kind === 'review') reviews++;
  }
  if (text !== before) {
    changed++;
    if (!dry) writeFileSync(file, text);
    console.log(`${dry ? 'would rewrite' : 'rewrote'} ${rel}`);
  }
}
console.log(`handover:build: ${changed} page${changed === 1 ? '' : 's'} ${dry ? 'out of date' : 'rewritten'}, ${model.files.size} card files and ${model.tests.size} test files read.`);
if (reviews) process.exit(1);
