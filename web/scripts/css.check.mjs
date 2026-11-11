/**
 * Structural check for the stylesheet: every block closed, no stray "}", no
 * rule opened inside another rule, no declaration outside a rule.
 *
 * Vite's build does not fail on any of these. A lost "}" once left about 50
 * rules in one portal silently unapplied while the other portal looked fine.
 *
 *   node scripts/css.check.mjs [file.css ...]   (default: every part in src/styles/)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Problems found in `text`, each prefixed with its line number. */
export function checkCss(text) {
  const errors = [];
  // Open blocks, innermost last: the line each opened on, and whether it is an
  // at-rule (@media, @keyframes, …), which may contain rules.
  const stack = [];
  let prelude = ''; // text since the last ";", "{" or "}"
  let line = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') line++;

    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) {
        errors.push(`line ${line}: comment never closed`);
        break;
      }
      line += (text.slice(i, end).match(/\n/g) ?? []).length;
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      if (text[j] !== ch) errors.push(`line ${line}: string never closed`);
      prelude += text.slice(i, j + 1);
      i = j;
      continue;
    }

    if (ch === '{') {
      const head = prelude.trim();
      const parent = stack[stack.length - 1];
      if (parent && !parent.atRule) {
        errors.push(
          `line ${line}: "${head.slice(0, 60)}" opens inside the rule from line ${parent.line}. Missing "}"?`,
        );
      }
      stack.push({ line, atRule: head.startsWith('@') });
      prelude = '';
    } else if (ch === '}') {
      if (!stack.length) errors.push(`line ${line}: "}" without a matching "{"`);
      else stack.pop();
      prelude = '';
    } else if (ch === ';') {
      const statement = prelude.trim();
      if (!stack.length && !statement.startsWith('@')) {
        errors.push(`line ${line}: "${statement.slice(0, 60)}" is outside any rule`);
      }
      prelude = '';
    } else {
      prelude += ch;
    }
  }

  for (const open of stack) errors.push(`line ${open.line}: block never closed`);
  return errors;
}

// self-test: the check must catch what it exists for

const cases = [
  ['.a {\n  color: red;\n}\n', 0],
  ['@media (max-width: 600px) {\n  .a { color: red; }\n}\n', 0],
  ['@keyframes spin {\n  to { transform: rotate(1turn); }\n}\n', 0],
  ['@import url("x.css");\n.a { content: "}"; }\n', 0],
  // The two halves of the real regression: a stray tail, and a rule left open.
  ['.a {\n  color: red;\n}\n  color: var(--muted);\n}\n', 2],
  ['.a {\n  font-size: 12px;\n.b {\n  color: red;\n}\n', 2],
];
for (const [css, expected] of cases) {
  const found = checkCss(css).length;
  if (found !== expected) {
    console.error(`css.check self-test failed: expected ${expected} problem(s), found ${found} in:\n${css}`);
    process.exit(1);
  }
}

const files = process.argv.slice(2);
if (!files.length) {
  const dir = fileURLToPath(new URL('../src/styles/', import.meta.url));
  files.push(...readdirSync(dir).filter((name) => name.endsWith('.css')).sort().map((name) => dir + name));
}

let problems = 0;
for (const file of files) {
  for (const error of checkCss(readFileSync(file, 'utf8'))) {
    console.error(`${file}: ${error}`);
    problems++;
  }
}
if (problems) {
  console.error(`css.check: ${problems} problem(s)`);
  process.exit(1);
}
console.log(`css.check: ${files.length} file(s) OK`);
