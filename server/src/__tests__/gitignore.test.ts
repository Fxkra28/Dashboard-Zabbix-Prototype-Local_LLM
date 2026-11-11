import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * What must never be committed is named in .gitignore itself, not only in one clone's .git/info/exclude, which
 * a fresh clone or another machine does not have (SC-38).
 */
const lines = readFileSync(fileURLToPath(new URL('../../../.gitignore', import.meta.url)), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

describe('.gitignore', () => {
  it.each([
    ['server/.env', 'the real tokens and keys'],
    ['docker-compose.override.yml', "the address of HCML's Zabbix, which the override file holds"],
    ['/pic/', 'screenshots with real host names'],
    ['HCML_SLA_Report_*', 'a downloaded report names every device'],
  ])('lists %s (%s)', (entry) => {
    expect(lines).toContain(entry);
  });
});
