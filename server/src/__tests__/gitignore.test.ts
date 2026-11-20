import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * What must never be committed is named in .gitignore itself, not only in one clone's .git/info/exclude, which
 * a fresh clone or another machine does not have (SC-38). rebuild.sh tells the owner to commit with `git add -A`, so a lost line
 * would be committed by the very step it recommends (IN-93): the file is read as text and asked of git itself.
 */
const gitignore = fileURLToPath(new URL('../../../.gitignore', import.meta.url));
const lines = readFileSync(gitignore, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

describe('.gitignore', () => {
  it.each([
    ['.env', 'every secret: the users, the tokens, the signing secret and the model key'],
    ['server/.env', 'the real tokens and keys of a development run'],
    ['web/.env', 'the settings of a development run of the web app'],
    ['.env.*', 'a copy or variant of a secret file: .env.local, .env.production, .env.bak'],
    ['!.env.example', 'the template, which holds no real value and is committed'],
    ['portal-state.json', 'the saved recipient addresses'],
    ['*.bak', 'a hand-made copy of a settings file that .env.* does not name, such as env.bak'],
    ['docker-compose.override.yml', "the address of HCML's Zabbix, which the override file holds"],
    ['/pic/', 'screenshots with real host names'],
    ['HCML_SLA_Report_*', 'a downloaded report names every device'],
    ['*.log.[0-9]*', 'the rotated copies of the server log (bff.log.1 and up), which hold the names typed at sign-in and addresses'],
    ['users.json*', 'the portal\'s users with their password hashes, and the copies of the file (.prev, .repaired-<time>, .broken-<time>) (SC-66)'],
    ['closed-months.json*', 'the web check figures of closed months, and the copies of that file (SC-66)'],
    ['requests.json*', 'the requests for an account, which hold the names and reasons that strangers typed, and the copies of that file (FR-62)'],
    ['*.broken-*', 'a state file the portal put aside because it could not read it (SC-66)'],
  ])('lists %s (%s)', (entry) => {
    expect(lines).toContain(entry);
  });
});

describe('.gitignore, as git reads it', () => {
  const repo = mkdtempSync(join(tmpdir(), 'gitignore-test-'));
  beforeAll(() => {
    expect(spawnSync('git', ['init', '-q'], { cwd: repo }).status).toBe(0);
    copyFileSync(gitignore, join(repo, '.gitignore'));
    for (const dir of ['server', 'web', 'pic/10']) mkdirSync(join(repo, dir), { recursive: true });
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));
  /** 0 when git would leave the path out of `git add -A`, 1 when it would take it. */
  const status = (path: string) => spawnSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: repo }).status;

  it.each([
    '.env',
    'server/.env',
    'web/.env',
    '.env.local',
    '.env.production',
    '.env.enc',
    '.env.gpg',
    'server/.env.bak',
    'server/env.bak',
    'portal-state.json',
    'docker-compose.override.yml',
    'pic/10/01-dashboard.png',
    'HCML_SLA_Report_2026-10.pdf',
    'server/bff.log',
    'server/bff.log.1',
    'users.json',
    'server/users.json',
    'server/users.json.prev',
    'server/users.json.broken-1790000000000',
    'server/users.json.repaired-1790000000000',
    'closed-months.json',
    'server/closed-months.json.prev',
    'server/portal-state.json.broken-1790000000000',
    'requests.json',
    'server/requests.json',
    'server/requests.json.prev',
    'server/requests.json.broken-1790000000000',
  ])('leaves %s out of git add -A', (path) => {
    expect(status(path), path).toBe(0);
  });

  it.each(['.env.example', 'server/.env.example', 'web/.env.example', 'docker-compose.yml', 'deploy/settings.example'])('still lets git take %s', (path) => {
    expect(status(path), path).toBe(1);
  });
});
