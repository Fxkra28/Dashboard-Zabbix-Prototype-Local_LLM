import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The web app's stylesheet as one text: the numbered parts of web/src/styles/ in order, as a build serves them. */
export function webStyles(): string {
  const dir = fileURLToPath(new URL('../../../../web/src/styles/', import.meta.url));
  return readdirSync(dir)
    .filter((name) => /^\d.*\.css$/.test(name))
    .sort()
    .map((name) => readFileSync(dir + name, 'utf8'))
    .join('');
}
