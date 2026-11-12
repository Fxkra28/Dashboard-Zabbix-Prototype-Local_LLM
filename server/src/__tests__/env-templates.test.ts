import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The two .env.example files against docker-compose.yml.
 *
 * `cp .env.example .env` is how a portal is set up, so what the template says is what runs. Two
 * failures hide there: a key compose reads is missing from the template, so nobody knows it can be
 * set, and a key is assigned twice, so the last line wins without a word (a leftover
 * AI_TIMEOUT_MS=30000 cut a local model off at 30 seconds). A template value that differs from
 * compose's default has the same effect as the second case: copying the file changes behaviour.
 * This reads the files as text, as the sibling tests do, and runs in whichever copy it sits in.
 */
const root = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(root(rel), 'utf8');

interface Template {
  /** Every value an active `KEY=value` line gives, in file order. */
  active: Map<string, string[]>;
  /** Every key named, as an active line or as a `# KEY=value` example. */
  named: Set<string>;
}

function template(rel: string): Template {
  const active = new Map<string, string[]>();
  const named = new Set<string>();
  for (const line of read(rel).split('\n')) {
    // A trailing ` # comment` is not part of the value.
    const m = /^(#\s*)?([A-Z][A-Z0-9_]*)=(.*?)(\s+#.*)?$/.exec(line);
    if (!m) continue;
    named.add(m[2]);
    if (!m[1]) active.set(m[2], [...(active.get(m[2]) ?? []), m[3]]);
  }
  return { active, named };
}

/** Every `${NAME}` compose reads from the environment, and the default of those that have one. */
function compose(): { names: Set<string>; defaults: Map<string, string> } {
  const names = new Set<string>();
  const defaults = new Map<string, string>();
  for (const m of read('docker-compose.yml').matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::-([^}]*)|:\?[^}]*)?\}/g)) {
    names.add(m[1]);
    if (m[2] !== undefined) defaults.set(m[1], m[2]);
  }
  return { names, defaults };
}

/** Variables compose reads that the template does not need to name, with the reason. */
const NOT_IN_TEMPLATE: Record<string, string> = {
  BUILD_COMMIT: 'set on the command line when building (see the comment in docker-compose.yml), never in a file',
  BUILD_TIME: 'set on the command line when building, never in a file',
  APK_ROUND: 'the month, set by deploy/rebuild.sh when it builds so that the web image runs apk upgrade again (IN-75), never in a file',
};

/** Template values that differ from compose's default on purpose, with the reason. */
const DIFFERS_FROM_COMPOSE: Record<string, string> = {
  ANTHROPIC_API_KEY: 'a placeholder, never a value',
  HOST_NAME_PATTERN: "the template spells out HCML's naming rule; compose leaves it empty and config.ts supplies it",
  AI_MODEL: 'the template names an example; compose leaves it empty so config.ts picks one for the backend in use',
  AI_TIMEOUT_MS: 'the local-model copy states the local default; compose leaves it empty so config.ts picks one per backend',
};

const TEMPLATES = ['.env.example', 'server/.env.example'];

describe('the root .env.example and docker-compose.yml (IN-04)', () => {
  const { names, defaults } = compose();
  const root_ = template('.env.example');

  it('reads the files it compares, rather than passing on nothing', () => {
    expect(names.size).toBeGreaterThan(40);
    expect(root_.named.size).toBeGreaterThan(40);
    expect(names.has('SLO_TARGET') && names.has('SESSION_HOURS')).toBe(true);
  });

  it('names every variable compose reads, as a line or as an example, so nobody has to find it in the compose file', () => {
    const missing = [...names].filter((n) => !root_.named.has(n) && !(n in NOT_IN_TEMPLATE)).sort();
    expect(missing, 'read by docker-compose.yml, absent from .env.example').toEqual([]);
  });

  it('holds back only variables compose still reads', () => {
    expect(Object.keys(NOT_IN_TEMPLATE).filter((n) => !names.has(n))).toEqual([]);
  });

  it('shows, for each active line, the value compose uses when the key is left out, except where it is listed', () => {
    const differing: string[] = [];
    for (const [key, values] of root_.active) {
      const fallback = defaults.get(key);
      if (fallback === undefined || key in DIFFERS_FROM_COMPOSE) continue;
      if (values[values.length - 1] !== fallback) differing.push(`${key}: template ${values[values.length - 1]}, compose ${fallback}`);
    }
    expect(differing, 'copying the template would change these from what Docker does by default').toEqual([]);
  });

  it('lists only differences that still exist', () => {
    const stale = Object.keys(DIFFERS_FROM_COMPOSE).filter((key) => {
      const values = root_.active.get(key);
      const fallback = defaults.get(key);
      return values !== undefined && fallback !== undefined && values[values.length - 1] === fallback;
    });
    expect(stale, 'listed as different, but the template now matches compose: drop it from DIFFERS_FROM_COMPOSE').toEqual([]);
  });
});

describe.each(TEMPLATES)('%s (IN-19)', (rel) => {
  const t = template(rel);

  it('reads as a template, with its keys', () => {
    expect(t.named.size).toBeGreaterThan(30);
  });

  it('assigns no key twice, so the last line cannot quietly win', () => {
    const twice = [...t.active].filter(([, values]) => values.length > 1).map(([key]) => key);
    expect(twice).toEqual([]);
  });
});

describe('AI_TIMEOUT_MS in the templates (IN-19)', () => {
  it('is never both an example for a local model and an active 30000, the pair that cut a local model off', () => {
    for (const rel of TEMPLATES) {
      const text = read(rel);
      const examples = [...text.matchAll(/^#\s*AI_TIMEOUT_MS=(\d+)/gm)].map((m) => m[1]);
      const activeLines = [...text.matchAll(/^AI_TIMEOUT_MS=(\d+)/gm)].map((m) => m[1]);
      expect(examples.length + activeLines.length, `${rel}: at most one number for AI_TIMEOUT_MS`).toBeLessThanOrEqual(1);
      expect(activeLines.includes('30000') && /^AI_PROVIDER=openai-compatible/m.test(text)).toBe(false);
    }
  });
});

describe('ZABBIX_WRITE_TOKEN in the templates (IN-06)', () => {
  it.each(TEMPLATES)('%s ships it empty, with the reason to keep it empty where Zabbix has no server process', (rel) => {
    expect(template(rel).active.get('ZABBIX_WRITE_TOKEN')).toEqual(['']);
    // The comment block directly above the line says why.
    const lines = read(rel).split('\n');
    const at = lines.findIndex((l) => l.startsWith('ZABBIX_WRITE_TOKEN='));
    let top = at;
    while (top > 0 && lines[top - 1].startsWith('#')) top--;
    const note = lines.slice(top, at).join(' ');
    expect(note).toMatch(/no server process/);
    expect(note).toMatch(/queues it/);
  });
});
