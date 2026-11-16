import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isCommon, isGuessable, isTooShort } from '../security/passwords.js';

/**
 * The example passwords in the templates and in setup 19 (SC-54, SC-55). The parity check never opens `.env*` files, so the local-model
 * copy's templates once kept `:secret:` after the hosted copy's were fixed. This runs in whichever copy it sits in and reads that copy's files.
 */
const root = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const TEMPLATES = ['.env.example', 'server/.env.example'];
const FILES = [...TEMPLATES, 'docs/setup/19-authentication-rbac.md'];
const PLACEHOLDER = /^<[^<>]+>$/;

/** The password of every `name:password:role` entry on a PORTAL_USERS line, and the value of every PORTAL_PASS line that has one. */
function passwordsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/PORTAL_USERS=(\S+)/g)) for (const entry of m[1].split(',')) out.push(entry.split(':')[1] ?? '');
  for (const m of text.matchAll(/^[# ]*PORTAL_PASS=([^\s#]+)/gm)) out.push(m[1]);
  return out;
}

describe('the example passwords', () => {
  it.each(FILES)('in %s are placeholders, or a password the server would accept without a word', (file) => {
    const found = passwordsIn(readFileSync(root(file), 'utf8'));
    expect(found.length, `${file} has an example to check`).toBeGreaterThan(0);
    for (const password of found) {
      if (PLACEHOLDER.test(password)) continue;
      expect(isCommon(password) || isGuessable(password) || isTooShort(password), `an example password in ${file} the server refuses or warns about`).toBe(false);
    }
  });

  it.each(FILES)('in %s never include the word the documents once used, secret', (file) => {
    expect(readFileSync(root(file), 'utf8')).not.toMatch(/:secret:/);
  });

  it.each(TEMPLATES)('ship no live user in %s: the line is a comment', (file) => {
    expect(readFileSync(root(file), 'utf8')).not.toMatch(/^PORTAL_USERS=\S/m);
  });
});

describe('what the templates tell the person who fills them in', () => {
  it.each(TEMPLATES)('says in %s which passwords the server refuses or warns about, and that a "$" needs single quotes (BK-48, SC-55)', (file) => {
    const text = readFileSync(root(file), 'utf8');
    expect(text).toMatch(/placeholder/);
    expect(text).toMatch(/single quotes/);
    expect(text).toMatch(/"\$"|\$ /);
    expect(text).toMatch(/shorter than 8|at least 8/);
  });
});

// DC-57: the header of the root template says that copying it changes nothing, except for a few settings that this test lists with their reasons.
const compose = () => readFileSync(root('docker-compose.yml'), 'utf8').split('\n');

/** What compose gives a setting when `.env` leaves it out: the `${NAME:-fallback}` of the portal-bff environment. A setting compose fixes has none. */
function composeFallbacks(): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of compose()) {
    const m = /^ {6}([A-Z][A-Z0-9_]*):\s*\$\{([A-Z0-9_]+):-([^}]*)\}\s*$/.exec(line);
    if (m && m[1] === m[2]) out.set(m[1], m[3]);
  }
  return out;
}

/** The active `NAME=value` lines of the root template, a trailing ` # comment` taken off. */
function templateValues(): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readFileSync(root('.env.example'), 'utf8').split('\n')) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) out.set(m[1], m[2].replace(/\s+#.*$/, ''));
  }
  return out;
}

/** The settings whose value in the root template is not what compose uses when the key is left out, and why. One copy has some of them, the other the rest. */
const DIFFERS_FROM_COMPOSE: Record<string, string> = {
  HOST_NAME_PATTERN: "HCML's naming rule is set in the template and empty in compose, so a copy of the template turns the naming scores on",
  ANTHROPIC_API_KEY: 'a placeholder in the hosted copy, which the server refuses as a key until a real one is written',
  AI_MODEL: "the model of the copy, which compose leaves for the code's own choice",
  AI_TIMEOUT_MS: "the local-model copy's limit, which compose leaves for the code's own choice",
};

describe('the root template against what compose uses when a key is left out (DC-57)', () => {
  const fallbacks = composeFallbacks();
  const values = templateValues();

  it('reads the two files as it should, or the checks below say nothing', () => {
    expect(fallbacks.size).toBeGreaterThan(40);
    expect(values.size).toBeGreaterThan(40);
    expect(fallbacks.get('SLO_TARGET')).toBeDefined();
    expect(values.get('SLO_TARGET')).toBeDefined();
  });

  it('differs only in the settings listed here, each with its reason', () => {
    const differing = [...values].filter(([name, value]) => fallbacks.has(name) && fallbacks.get(name) !== value).map(([name]) => name);
    for (const name of differing) expect(Object.keys(DIFFERS_FROM_COMPOSE), `${name} differs from compose's fallback and is not listed with a reason`).toContain(name);
  });

  it('names those settings, and this test, in its own header, where a person copying it reads that nothing changes', () => {
    const text = readFileSync(root('.env.example'), 'utf8');
    const header = text.split('\n\n')[0];
    expect(header).toContain('env-templates.test.ts');
    expect(header).not.toContain('compose-env.test.ts');
    const differing = [...values].filter(([name, value]) => fallbacks.has(name) && fallbacks.get(name) !== value).map(([name]) => name);
    for (const name of differing) expect(header, `the header names ${name}`).toContain(name);
  });
});
