import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * deploy/rebuild.sh (tracker IN-01), run as a dry run in small git trees with a stand-in for docker.
 *
 * A dry run changes nothing, so it can say what a real run would do: which commit names the build,
 * which images are kept for a rollback, in which order the copies are built, and what makes the
 * script refuse. The real run (docker, curl, a tag) is what a person watches the first time.
 */
const script = fileURLToPath(new URL('../../../deploy/rebuild.sh', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'rebuild-script-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// A docker that answers the two read-only questions a dry run asks. Does this image tag exist? `:latest` always
// does (unless FAKE_NO_IMAGES is set); any other tag only when FAKE_EXISTING (a regular expression) matches it.
// Can it read a copy's settings? Yes, unless FAKE_BAD_ENV matches the folder: then it fails as docker does, quoting
// the line it could not read. And it answers the calls of a real run, so that its failure paths can be walked.
const bin = join(scratch, 'bin');
mkdirSync(bin);
writeFileSync(
  join(bin, 'docker'),
  `#!/usr/bin/env bash
if [ "$1" = image ] && [ "$2" = inspect ]; then
  [ -n "\${FAKE_NO_IMAGES:-}" ] && exit 1
  case "$3" in *:latest) exit 0 ;; esac
  if [ -n "\${FAKE_EXISTING:-}" ] && printf '%s' "$3" | grep -Eq "$FAKE_EXISTING"; then exit 0; fi
  exit 1
fi
if [ "$1" = compose ] && [ "$2" = --project-directory ] && [ "$4" = config ] && [ "$5" = --quiet ]; then
  if [ -n "\${FAKE_BAD_ENV:-}" ] && printf '%s' "$3" | grep -Eq "$FAKE_BAD_ENV"; then
    echo "failed to read $3/.env: line 9: unexpected character \\"s\\" in variable name \\"sekrt\\"" >&2
    exit 15
  fi
  if [ -n "\${FAKE_REQUIRED_MISSING:-}" ] && printf '%s' "$3" | grep -Eq "$FAKE_REQUIRED_MISSING"; then
    echo "required variable JWT_SECRET is missing a value: set JWT_SECRET (sekrt-hint)" >&2
    exit 1
  fi
  exit 0
fi
# The logs of a copy's containers, saved before they are replaced. FAKE_LOGS_FAIL makes it fail as a missing project does.
if [ "$1" = compose ] && [ "$2" = --project-directory ] && [ "$4" = logs ]; then
  [ -n "\${FAKE_LOGS_FAIL:-}" ] && { echo "no such project" >&2; exit 1; }
  echo "2026-11-03T08:00:00Z portal-bff-1  | {\\"event\\":\\"ai_call\\",\\"user\\":\\"ana\\"} from $3"
  exit 0
fi
# The calls of a real run. Tagging always works; "up" fails when FAKE_UP_FAILS is set; a container is healthy at once.
if [ "$1" = tag ]; then exit 0; fi
if [ "$1" = compose ] && [ "$2" = --project-directory ] && [ "$4" = up ]; then
  [ -n "\${FAKE_UP_FAILS:-}" ] && { echo "build failed" >&2; exit 17; }
  # Only the copy whose folder matches: the second copy failing after the first one came up.
  if [ -n "\${FAKE_UP_FAILS_FOR:-}" ] && printf '%s' "$3" | grep -Eq "$FAKE_UP_FAILS_FOR"; then echo "build failed" >&2; exit 17; fi
  exit 0
fi
if [ "$1" = inspect ] && [ "$2" = -f ]; then
  [ -n "\${FAKE_NO_CONTAINER:-}" ] && exit 1
  # What a container runs is told by its image id, which is not what the tag :latest names once something has moved it.
  case "$3" in *Config.Env*) echo "BUILD_COMMIT=test" ;; *.Image*) echo "sha256:image-of-$4" ;; *) echo healthy ;; esac
  exit 0
fi
if [ "$1" = port ]; then
  # docker port exits 1 for a container that is stopped or restarting, which publishes nothing.
  [ -n "\${FAKE_PORT_FAILS:-}" ] && exit 1
  # Only the container whose name matches: the second copy not running after the first one passed.
  if [ -n "\${FAKE_PORT_FAILS_FOR:-}" ] && printf '%s' "$2" | grep -Eq "$FAKE_PORT_FAILS_FOR"; then exit 1; fi
  [ -n "\${FAKE_PORT_ODD:-}" ] && { echo "[::]:abc"; exit 0; }
  # With FAKE_PORT_BY_COPY the local-model copy publishes 8082, so that a curl can answer for one copy and not the other.
  if [ -n "\${FAKE_PORT_BY_COPY:-}" ]; then case "$2" in hcml-portal-ollama*) echo "0.0.0.0:8082"; exit 0 ;; esac; fi
  echo "0.0.0.0:8081"; exit 0
fi
echo "unexpected docker call: $*" >&2
exit 99
`,
);
// A curl that answers 500 to everything, so that a real run's checks of what an anonymous caller sees all fail.
writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash\ncase "$*" in *http_code*) printf 500 ;; esac\nexit 0\n`);
for (const f of ['docker', 'curl']) chmodSync(join(bin, f), 0o755);
// A curl that answers as a healthy portal does to an anonymous caller: health 200, the meters refused, dot-files not found,
// a Content-Security-Policy on the page, and a bundle name in it.
const goodBin = join(scratch, 'good-bin');
mkdirSync(goodBin);
writeFileSync(
  join(goodBin, 'curl'),
  `#!/usr/bin/env bash
case "$*" in
  *http_code*) case "$*" in *"/bff/api/health"*) printf 200 ;; *"/bff/api/net/meters"*) printf 401 ;; *) printf 404 ;; esac ;;
  *-sI*) printf 'HTTP/1.1 200 OK\\r\\nContent-Security-Policy: default-src self\\r\\n\\r\\n' ;;
  *) printf '<script src="/assets/index-abc123.js"></script>' ;;
esac
exit 0
`,
);
chmodSync(join(goodBin, 'curl'), 0o755);
const healthy = { PATH: `${goodBin}:${bin}:${process.env.PATH ?? ''}` };
// The same, except that whatever is asked at port 8082 gets a 500: the second copy fails its checks after the first passed.
const halfBin = join(scratch, 'half-bin');
mkdirSync(halfBin);
writeFileSync(
  join(halfBin, 'curl'),
  `#!/usr/bin/env bash
case "$*" in
  *http_code*) case "$*" in *":8082"*) printf 500 ;; *"/bff/api/health"*) printf 200 ;; *"/bff/api/net/meters"*) printf 401 ;; *) printf 404 ;; esac ;;
  *-sI*) printf 'HTTP/1.1 200 OK\\r\\nContent-Security-Policy: default-src self\\r\\n\\r\\n' ;;
  *) printf '<script src="/assets/index-abc123.js"></script>' ;;
esac
exit 0
`,
);
chmodSync(join(halfBin, 'curl'), 0o755);

const git = (cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

/** A committed git tree named `name` that holds the script, with `siblings` beside it (copies with no git). */
function tree(label: string, name = 'hcml-portal', siblings: string[] = []): string {
  const parent = join(scratch, label);
  for (const dir of [name, ...siblings]) {
    mkdirSync(join(parent, dir, 'server'), { recursive: true });
    mkdirSync(join(parent, dir, 'web'), { recursive: true });
    writeFileSync(join(parent, dir, 'docker-compose.yml'), 'services: {}\n');
    writeFileSync(join(parent, dir, 'server', 'a.ts'), 'one\n');
    writeFileSync(join(parent, dir, 'web', 'b.ts'), 'two\n');
    mkdirSync(join(parent, dir, 'server', 'src', '__tests__'), { recursive: true });
    writeFileSync(join(parent, dir, 'server', 'src', '__tests__', 'a.test.ts'), 'test\n');
    writeFileSync(join(parent, dir, 'web', 'c.test.tsx'), 'test\n');
  }
  const root = join(parent, name);
  mkdirSync(join(root, 'deploy'));
  copyFileSync(script, join(root, 'deploy', 'rebuild.sh'));
  // The check that two copies match: a real run with a sibling runs it, so there is one that passes.
  mkdirSync(join(root, 'tools', 'check'), { recursive: true });
  writeFileSync(join(root, 'tools', 'check', 'parity.check.mjs'), '// stand-in\n');
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'first');
  return root;
}
const head = (root: string) => git(root, 'rev-parse', '--short', 'HEAD').stdout.trim();
/** What a failed run prints from `marker` on; the marker must be there, or a slice would pass every `not.toContain` for nothing. */
function after(out: string, marker: string): string {
  const at = out.indexOf(marker);
  expect(at, `"${marker}" is missing from the output`).toBeGreaterThan(-1);
  return out.slice(at);
}

/** The script, run to its end. A script that loops is killed after twenty seconds and fails its test, instead of hanging the suite. */
function rebuild(root: string, args: string[] = [], env: Record<string, string> = {}) {
  const r = spawnSync('bash', [join(root, 'deploy', 'rebuild.sh'), ...args], {
    encoding: 'utf8',
    timeout: 20_000,
    // The logs of a real run go to a folder of the test's own: the default is in the home folder, where a test run would
    // fill the archive a person keeps and push out the real logs.
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, LOG_ARCHIVE_DIR: join(scratch, 'default-logs'), ...env },
  });
  if (r.error) throw r.error;
  return r;
}

describe('deploy/rebuild.sh, as a dry run', () => {
  it('is executable, and answers --help with its own header', () => {
    expect(statSync(script).mode & 0o111).not.toBe(0);
    const r = rebuild(tree('help'), ['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('deploy/rebuild.sh [--dry-run] [--skip-verify] [--allow-dirty]');
    expect(r.stdout).not.toContain('set -euo');
  });

  it('plans a build named by the commit: a rollback tag for each image, the build arguments, then the tag that says what is live', () => {
    const root = tree('clean');
    const r = rebuild(root, ['--dry-run', '--skip-verify']);
    expect(r.status).toBe(0);
    const sha = head(root);
    expect(r.stdout).toContain(`Build ${sha},`);
    expect(r.stdout).not.toContain('-dirty');
    expect(r.stdout).toMatch(/\+ docker tag hcml-portal-portal-bff:latest hcml-portal-portal-bff:rollback-\d+[a-z]{3}\n/);
    expect(r.stdout).toMatch(/\+ docker tag hcml-portal-portal-web:latest hcml-portal-portal-web:rollback-\d+[a-z]{3}\n/);
    // last-good is marked by a second command, once a person has made the check that needs a sign-in (IN-52).
    expect(r.stdout).not.toContain(':last-good');
    expect(r.stdout).toContain(`+ env BUILD_COMMIT=${sha} BUILD_TIME=`);
    expect(r.stdout).toContain(`docker compose --project-directory ${root} up -d --build`);
    expect(r.stdout).toMatch(new RegExp(`\\+ git -C ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} tag -a live-\\d{4}-\\d{2}-\\d{2} ${sha} `));
    expect(r.stdout).toContain('The tag is local. To make it public: git push origin live-');
    expect(r.stdout.trimEnd().endsWith('Dry run: nothing was changed.')).toBe(true);
    // A dry run makes no tag and no image: the one repository it touches still has no tag.
    expect(git(root, 'tag').stdout).toBe('');
  });

  it('plans npm run verify first unless it is told to skip it', () => {
    const root = tree('verify');
    expect(rebuild(root, ['--dry-run']).stdout).toContain(`+ npm --prefix ${root} run verify`);
    expect(rebuild(root, ['--dry-run', '--skip-verify']).stdout).not.toContain('run verify');
  });

  it('builds the local-model copy after the hosted one, behind a check that the two copies match', () => {
    const root = tree('both', 'hcml-portal', ['hcml-portal-ollama']);
    const out = rebuild(root, ['--dry-run', '--skip-verify']).stdout;
    expect(out).toContain(`+ node ${root}/tools/check/parity.check.mjs`);
    const hosted = out.indexOf('== hcml-portal\n');
    const local = out.indexOf('== hcml-portal-ollama\n');
    expect(hosted).toBeGreaterThan(out.indexOf('parity.check.mjs'));
    expect(local).toBeGreaterThan(hosted);
    expect(out).toContain('docker tag hcml-portal-ollama-portal-bff:latest hcml-portal-ollama-portal-bff:rollback-');
    expect(out).toContain(`--project-directory ${root}-ollama up -d --build`);
  });

  it('builds the folder it is in and nothing else when there is no sibling', () => {
    const out = rebuild(tree('alone'), ['--dry-run', '--skip-verify']).stdout;
    expect(out).not.toContain('parity.check.mjs');
    expect(out).not.toContain('ollama');
  });

  it('takes the next free rollback tag of an image, so a second build in one day keeps the first', () => {
    const out = rebuild(tree('second'), ['--dry-run', '--skip-verify'], { FAKE_EXISTING: '^hcml-portal-portal-bff:rollback-[0-9]+[a-z]+$' }).stdout;
    expect(out).toMatch(/hcml-portal-portal-bff:rollback-\d+[a-z]{3}-2\n/);
    expect(out).toMatch(/hcml-portal-portal-web:rollback-\d+[a-z]{3}\n/);
  });

  it('stops looking for a free rollback tag after fifty, whatever docker says', () => {
    const r = rebuild(tree('every-tag'), ['--dry-run', '--skip-verify'], { FAKE_EXISTING: 'rollback-' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/hcml-portal-portal-bff:rollback-\d+[a-z]{3}-50\n/);
  });

  it('refuses a tree whose server/, web/ or compose file differ from the commit', () => {
    for (const path of ['server/a.ts', 'web/b.ts', 'docker-compose.yml']) {
      const root = tree(`dirty-${path.replace(/\W/g, '-')}`);
      writeFileSync(join(root, path), 'changed\n');
      const r = rebuild(root, ['--dry-run', '--skip-verify']);
      expect(r.status, path).toBe(1);
      expect(r.stderr, path).toContain('differ from');
      expect(r.stdout, path).not.toContain('docker compose');
    }
  });

  it('does not mind a new or changed test, which no image holds', () => {
    const root = tree('tests');
    writeFileSync(join(root, 'server', 'src', '__tests__', 'a.test.ts'), 'changed\n');
    writeFileSync(join(root, 'server', 'src', '__tests__', 'new.test.ts'), 'new\n');
    writeFileSync(join(root, 'web', 'c.test.tsx'), 'changed\n');
    const r = rebuild(root, ['--dry-run', '--skip-verify']);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('-dirty');
  });

  it('does not mind a change elsewhere, such as a document', () => {
    const root = tree('docs');
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'a.md'), 'new\n');
    const r = rebuild(root, ['--dry-run', '--skip-verify']);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('-dirty');
  });

  it('with --allow-dirty labels the build dirty and plans no tag', () => {
    const root = tree('allow');
    writeFileSync(join(root, 'server', 'a.ts'), 'changed\n');
    const r = rebuild(root, ['--dry-run', '--skip-verify', '--allow-dirty']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`BUILD_COMMIT=${head(root)}-dirty`);
    expect(r.stdout).not.toContain(' tag -a live-');
  });

  it('checks that docker can read the settings of every copy before it tags anything, also on a dry run (IN-38)', () => {
    const root = tree('envs', 'hcml-portal', ['hcml-portal-ollama']);
    const r = rebuild(root, ['--dry-run', '--skip-verify']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Gate: docker can read the settings of hcml-portal\n  ok');
    expect(r.stdout).toContain('Gate: docker can read the settings of hcml-portal-ollama\n  ok');
    expect(r.stdout.indexOf('Gate: docker can read')).toBeLessThan(r.stdout.indexOf('+ docker tag'));
  });

  it('stops before any tag when docker cannot read a .env, naming the line and never the text docker quotes', () => {
    const root = tree('bad-env', 'hcml-portal', ['hcml-portal-ollama']);
    const r = rebuild(root, ['--dry-run', '--skip-verify'], { FAKE_BAD_ENV: 'hcml-portal-ollama$' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('docker cannot read the settings of hcml-portal-ollama (line 9 of its .env)');
    expect(r.stderr + r.stdout).not.toContain('sekrt');
    expect(r.stdout).not.toContain('+ docker tag');
  });

  it('still says that docker cannot read the settings when its message holds no line number, and stops (reviewer, 11 November)', () => {
    // grep finds no "line N" there, and under pipefail the failed assignment used to end the script with no word at all.
    const root = tree('no-line', 'hcml-portal', ['hcml-portal-ollama']);
    const r = rebuild(root, ['--dry-run', '--skip-verify'], { FAKE_REQUIRED_MISSING: 'hcml-portal$' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('docker cannot read the settings of hcml-portal. Fix it in an editor');
    expect(r.stderr).not.toContain(' of its .env');
    expect(r.stderr + r.stdout).not.toContain('sekrt');
    expect(r.stdout).not.toContain('+ docker tag');
  });

  it('names the rollback tags it made, each as it is, when the build or its checks fail (IN-38)', () => {
    // The hosted bff image already has the day\'s first tag, so it gets the second; the web image gets the first.
    const env = { FAKE_EXISTING: '^hcml-portal-portal-bff:rollback-[0-9]+[a-z]+$' };
    const checks = rebuild(tree('failed-checks'), ['--skip-verify'], env);
    expect(checks.status).toBe(1);
    expect(checks.stdout).toContain('FAIL  the health route answers: wanted 200, got 500');
    const help = checks.stdout.slice(checks.stdout.indexOf('Something above failed.'));
    expect(help).toMatch(/\n {2}hcml-portal-portal-bff:rollback-\d+[a-z]{3}-2\n/);
    expect(help).toMatch(/\n {2}hcml-portal-portal-web:rollback-\d+[a-z]{3}\n/);
    expect(help).toContain('docker tag <image>:<tag> <image>:latest');

    const up = rebuild(tree('failed-up'), ['--skip-verify'], { ...env, FAKE_UP_FAILS: '1' });
    expect(up.status).toBe(1);
    expect(up.stdout).toContain('docker compose could not bring hcml-portal up.');
    expect(up.stdout.slice(up.stdout.indexOf('could not bring'))).toMatch(/\n {2}hcml-portal-portal-bff:rollback-\d+[a-z]{3}-2\n/);
  });

  it('does not mark the new images last-good when the checks it can make pass, because the one that needs a person is still to come (IN-52)', () => {
    const ok = rebuild(tree('passed'), ['--skip-verify'], healthy);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('  ok    the health route answers (200)');
    expect(ok.stdout).not.toContain('docker tag hcml-portal-portal-bff:latest hcml-portal-portal-bff:last-good');
    expect(ok.stdout).not.toContain('docker tag hcml-portal-portal-web:latest hcml-portal-portal-web:last-good');
    expect(ok.stdout).toContain('When those pass, keep these images as the ones to go back to with: deploy/rebuild.sh --mark-good');

    const bad = rebuild(tree('not-passed'), ['--skip-verify']);
    expect(bad.status).toBe(1);
    expect(bad.stdout).not.toContain('last-good');
  });

  it('says how to go back, and stops, when the web container publishes no port, instead of ending with no word (IN-67)', () => {
    const r = rebuild(tree('no-port'), ['--skip-verify'], { ...healthy, FAKE_PORT_FAILS: '1' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('hcml-portal-portal-web-1 publishes no port 8080, so it is not running');
    const help = after(r.stdout, 'publishes no port');
    expect(help).toContain('The images this replaced are kept under these tags');
    expect(help).toMatch(/\n {2}hcml-portal-portal-web:rollback-\d+[a-z]{3}\n/);
    expect(help).toContain('docker tag <image>:<tag> <image>:latest');
    // The checks below it need the port: they did not run, and the run did not go on to tag a build that does not run.
    expect(r.stdout).not.toContain('What an anonymous caller sees');
    expect(r.stdout).not.toContain('git -C');
    expect(r.stdout).not.toContain('Still yours');
  });

  it('stops the same way when what docker says is not a port number', () => {
    const r = rebuild(tree('odd-port'), ['--skip-verify'], { ...healthy, FAKE_PORT_ODD: '1' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('publishes no port 8080');
    expect(r.stdout).toContain('The images this replaced are kept under these tags');
  });

  it('stops at the first copy that publishes no port, and leaves the next one as it was (IN-67)', () => {
    const r = rebuild(tree('no-port-first', 'hcml-portal', ['hcml-portal-ollama']), ['--skip-verify'], { ...healthy, FAKE_PORT_FAILS: '1' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('publishes no port 8080');
    expect(r.stdout).not.toContain('== hcml-portal-ollama');
    expect(r.stdout).not.toContain('hcml-portal-ollama-portal-web');
  });

  it('says the build is live when the tag could not be made, and goes on to what is still to do (IN-67)', () => {
    const root = tree('no-identity');
    // git has no name and address for this account, as on a fresh server: `git tag -a` then ends with 128.
    git(root, 'config', '--unset', 'user.email');
    git(root, 'config', '--unset', 'user.name');
    git(root, 'config', 'user.useConfigOnly', 'true');
    const r = rebuild(root, ['--skip-verify'], { ...healthy, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', HOME: scratch });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Could not make the tag live-\d{4}-\d{2}-\d{2}: git needs a name and address[^\n]* The build is live\./);
    expect(r.stdout).not.toContain('The tag is local.');
    expect(r.stdout).toContain('Still yours, because it needs a sign-in');
    expect(r.stdout).toContain('deploy/rebuild.sh --mark-good');
    expect(git(root, 'tag').stdout).toBe('');
  });

  describe('--mark-good (IN-52)', () => {
    it('marks the image each running container uses, by its id, for every copy, and nothing else (IN-76)', () => {
      const root = tree('mark', 'hcml-portal', ['hcml-portal-ollama']);
      const r = rebuild(root, ['--mark-good']);
      expect(r.status).toBe(0);
      for (const image of ['hcml-portal-portal-bff', 'hcml-portal-portal-web', 'hcml-portal-ollama-portal-bff', 'hcml-portal-ollama-portal-web']) {
        expect(r.stdout).toContain(`+ docker tag sha256:image-of-${image}-1 ${image}:last-good\n`);
      }
      // :latest is only where the last build went; after a build by hand, or a rollback tag moved without `up`, it is not what runs.
      expect(r.stdout).not.toContain(':latest');
      expect(r.stdout).not.toContain('up -d --build');
      expect(r.stdout).not.toContain('rollback-');
      expect(r.stdout).not.toContain('npm');
      expect(git(root, 'tag').stdout).toBe('');
    });

    it('plans the tags and runs none of them on a dry run', () => {
      const r = rebuild(tree('mark-dry'), ['--mark-good', '--dry-run']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('+ docker tag sha256:image-of-hcml-portal-portal-bff-1 hcml-portal-portal-bff:last-good');
      expect(r.stdout.trimEnd().endsWith('Dry run: nothing was changed.')).toBe(true);
    });

    it('marks :latest, and says that it does, for a container that is not there, as after docker compose down, since nothing runs to name an image (IN-76)', () => {
      const r = rebuild(tree('mark-none'), ['--mark-good'], { FAKE_NO_CONTAINER: '1' });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('no container hcml-portal-portal-bff-1: marking the image :latest, which is what `docker compose up` would start');
      expect(r.stdout).toContain('+ docker tag hcml-portal-portal-bff:latest hcml-portal-portal-bff:last-good\n');
      expect(r.stdout).not.toContain('sha256:image-of');
    });

    it('marks nothing, and says so with a failure, when there is neither a container nor an image', () => {
      const r = rebuild(tree('mark-nothing'), ['--mark-good'], { FAKE_NO_CONTAINER: '1', FAKE_NO_IMAGES: '1' });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('no hcml-portal-portal-bff:latest to mark');
      expect(r.stdout).toContain('Nothing was marked');
      expect(r.stdout).not.toContain('Marked. A later run that fails');
      expect(r.stdout).not.toContain('+ docker tag');
    });

    it('works in a folder with no git, and does not mind a tree that differs from the commit', () => {
      const root = tree('mark-nogit');
      writeFileSync(join(root, 'server', 'a.ts'), 'changed\n');
      expect(rebuild(root, ['--mark-good']).status).toBe(0);
      rmSync(join(root, '.git'), { recursive: true });
      expect(rebuild(root, ['--mark-good']).status).toBe(0);
    });
  });

  it('after a failure names the last build that passed first, and the tags this run made after it (IN-47)', () => {
    // Today's first run failed and left its build as :latest; this run tagged that build rollback-<day>-2. The one to go back to is last-good.
    const env = { FAKE_EXISTING: '(^hcml-portal-portal-(bff|web):rollback-[0-9]+[a-z]+$|:last-good$)' };
    const r = rebuild(tree('failed-after-failed'), ['--skip-verify'], env);
    expect(r.status).toBe(1);
    const help = after(r.stdout, 'Something above failed.');
    expect(help).toContain('The last build marked good (deploy/rebuild.sh --mark-good) is kept as:');
    expect(help).toMatch(/\n {2}hcml-portal-portal-bff:last-good\n {2}hcml-portal-portal-web:last-good\n/);
    expect(help).toContain('docker tag <image>:last-good <image>:latest');
    expect(help.indexOf('last-good')).toBeLessThan(help.indexOf('rollback-'));
    expect(help).toContain('if the run before this one failed, they are its failed build');
    // A failed `docker compose up` says the same.
    const up = rebuild(tree('failed-up-after-failed'), ['--skip-verify'], { ...env, FAKE_UP_FAILS: '1' });
    expect(after(up.stdout, 'could not bring')).toContain('hcml-portal-portal-bff:last-good');
  });

  it('does not name a last-good image that does not exist (IN-47)', () => {
    const r = rebuild(tree('no-last-good'), ['--skip-verify']);
    expect(r.status).toBe(1);
    expect(after(r.stdout, 'Something above failed.')).not.toContain('last-good');
  });

  it('says so when a failed build had nothing to roll back to', () => {
    const r = rebuild(tree('failed-first'), ['--skip-verify'], { FAKE_UP_FAILS: '1', FAKE_NO_IMAGES: '1' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('No image was tagged for a rollback: none existed before this run.');
  });

  it('refuses an option it does not know', () => {
    const bad = rebuild(tree('badflag'), ['--force']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('unknown option --force');
  });

  it('builds a folder that is not a git checkout, under the label "unknown" and without a live tag (IN-51)', () => {
    const root = tree('nogit');
    rmSync(join(root, '.git'), { recursive: true });
    const r = rebuild(root, ['--dry-run', '--skip-verify']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('is not a git checkout, so this build is labelled "unknown" and no live tag is made');
    expect(r.stdout).toContain('Build unknown,');
    expect(r.stdout).toContain('BUILD_COMMIT=unknown ');
    expect(r.stdout).not.toContain('-dirty');
    expect(r.stdout).not.toContain(' tag -a live-');
    expect(r.stdout).not.toContain('git -C');
  });

  it('does not let a dirty tree stop a folder that has no git to compare with', () => {
    const root = tree('nogit-changed');
    rmSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, 'server', 'a.ts'), 'changed\n');
    expect(rebuild(root, ['--dry-run', '--skip-verify']).status).toBe(0);
  });
});

describe('deploy/rebuild.sh and the names of the project (IN-51)', () => {
  /** A copy whose folder is `folder`, holding a compose file that names the project `project` (or none). */
  function named(label: string, folder: string, project: string | null, siblings: string[] = []) {
    const root = tree(label, folder, siblings);
    const compose = project === null ? 'services: {}\n' : `name: ${project}\nservices: {}\n`;
    writeFileSync(join(root, 'docker-compose.yml'), compose);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'name');
    return root;
  }

  it('takes the names of the images from the name: line of the compose file, not from the folder, which Compose lower-cases', () => {
    const root = named('clone', 'Dashboard-Zabbix-Prototype', 'hcml-portal');
    const out = rebuild(root, ['--dry-run', '--skip-verify']).stdout;
    expect(out).toContain('== hcml-portal\n');
    expect(out).toContain('docker tag hcml-portal-portal-bff:latest hcml-portal-portal-bff:rollback-');
    expect(out).not.toContain('Dashboard-Zabbix-Prototype-portal');
  });

  it('falls back to the folder name in lower case, as Compose does, when the file names no project', () => {
    const root = named('clone-bare', 'Dashboard-Zabbix-Prototype', null);
    const out = rebuild(root, ['--dry-run', '--skip-verify']).stdout;
    expect(out).toContain('docker tag dashboard-zabbix-prototype-portal-bff:latest dashboard-zabbix-prototype-portal-bff:rollback-');
  });

  it('finds the local-model copy beside a clone whose folder has another name, since it is the project that counts', () => {
    const root = named('clone-pair', 'Dashboard-Zabbix-Prototype', 'hcml-portal', ['hcml-portal-ollama']);
    const out = rebuild(root, ['--dry-run', '--skip-verify']).stdout;
    expect(out).toContain('== hcml-portal-ollama\n');
    expect(out).toContain('docker tag hcml-portal-ollama-portal-bff:latest hcml-portal-ollama-portal-bff:rollback-');
  });

  it('waits for the containers by those names, and asks Docker for the port of that one', () => {
    const root = named('clone-real', 'Dashboard-Zabbix-Prototype', 'hcml-portal');
    const r = rebuild(root, ['--skip-verify'], healthy);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Waiting for hcml-portal to be healthy');
    expect(r.stdout).toContain('What an anonymous caller sees at http://127.0.0.1:8081');
  });

  it('is told by the compose file of its own copy which project it runs as: hcml-portal on 8081, hcml-portal-ollama on 8082', () => {
    const text = readFileSync(fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url)), 'utf8');
    const ollama = /\$\{WEB_PORT:-8082\}/.test(text);
    expect(/^name: (\S+)$/m.exec(text)?.[1]).toBe(ollama ? 'hcml-portal-ollama' : 'hcml-portal');
  });
});

describe('deploy/rebuild.sh when the second copy fails after the first came up (IN-76)', () => {
  const second = (label: string, extra: Record<string, string>) => {
    const root = tree(label, 'hcml-portal', ['hcml-portal-ollama']);
    return rebuild(root, ['--skip-verify'], { ...healthy, ...extra });
  };

  it('says that the first copy already runs the new build, so that nobody rolls back a copy that is fine', () => {
    const r = second('second-up-fails', { FAKE_UP_FAILS_FOR: 'hcml-portal-ollama$' });
    expect(r.status).toBe(1);
    const help = after(r.stdout, 'could not bring hcml-portal-ollama up');
    expect(help).toContain('hcml-portal already runs the new build and passed its checks');
    expect(help).toContain('Leave it as it is unless you mean to go back with it');
    expect(help).toContain('hcml-portal-ollama is the one that failed');
  });

  it('says the same when the second copy came up and failed its checks', () => {
    const r = second('second-checks-fail', { FAKE_PORT_FAILS_FOR: 'hcml-portal-ollama' });
    expect(r.status).toBe(1);
    expect(after(r.stdout, 'Something above failed.')).toContain('hcml-portal already runs the new build and passed its checks');
  });

  it('says the same when the last copy came up, published its port and then failed what an anonymous caller is asked', () => {
    const r = second('second-answers-badly', { PATH: `${halfBin}:${bin}:${process.env.PATH ?? ''}`, FAKE_PORT_BY_COPY: '1' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('== hcml-portal-ollama\n');
    const help = after(r.stdout, 'Something above failed.');
    expect(help).toContain('hcml-portal already runs the new build and passed its checks');
    expect(help).toContain('hcml-portal-ollama is the one that failed');
  });

  it('says nothing of another copy when the first copy is the one that failed, or when there is only one', () => {
    const first = rebuild(tree('first-up-fails', 'hcml-portal', ['hcml-portal-ollama']), ['--skip-verify'], { FAKE_UP_FAILS: '1' });
    expect(first.status).toBe(1);
    expect(first.stdout).toContain('docker compose could not bring hcml-portal up');
    expect(first.stdout).not.toContain('already runs the new build');
    const alone = rebuild(tree('alone-up-fails'), ['--skip-verify'], { FAKE_UP_FAILS: '1' });
    expect(alone.status).toBe(1);
    expect(alone.stdout).toContain('docker compose could not bring hcml-portal up');
    expect(alone.stdout).not.toContain('already runs the new build');
  });
});

describe('deploy/rebuild.sh and the upgrade of the web image\u2019s system packages (IN-75)', () => {
  it('gives the build a new APK_ROUND each month, so that a month later `apk upgrade` is not served from the layer cache', () => {
    const r = rebuild(tree('apk-round'), ['--skip-verify', '--dry-run']);
    expect(r.stdout).toMatch(/\+ env BUILD_COMMIT=\S+ BUILD_TIME=\S+ APK_ROUND=\d{4}-\d{2} docker compose /);
  });
});

describe('deploy/rebuild.sh stops at the first copy that fails (IN-52)', () => {
  it('does not build the second copy after the first one failed its checks, and says so', () => {
    const root = tree('stop-after-first', 'hcml-portal', ['hcml-portal-ollama']);
    const r = rebuild(root, ['--skip-verify']);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('== hcml-portal\n');
    expect(r.stdout).not.toContain('== hcml-portal-ollama\n');
    expect(r.stdout).not.toContain(`--project-directory ${root}-ollama up`);
    expect(after(r.stdout, 'Something above failed.')).toContain('hcml-portal-ollama was not rebuilt');
  });

  it('builds the second copy when the first one passes', () => {
    const root = tree('go-on', 'hcml-portal', ['hcml-portal-ollama']);
    const r = rebuild(root, ['--skip-verify'], healthy);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('== hcml-portal-ollama\n');
  });
});

describe('deploy/rebuild.sh and the logs of the containers it replaces (SC-42)', () => {
  const archive = (label: string) => join(scratch, label, 'logs');
  const files = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : []);

  it('saves the logs of each copy, compressed, before it tags or replaces anything', () => {
    const dir = archive('logs-saved');
    const root = tree('logs-run', 'hcml-portal', ['hcml-portal-ollama']);
    const r = rebuild(root, ['--skip-verify'], { ...healthy, LOG_ARCHIVE_DIR: dir });
    expect(r.status).toBe(0);
    const saved = files(dir);
    expect(saved.filter((f) => /^hcml-portal-\d{8}T\d{6}Z\.log\.gz$/.test(f))).toHaveLength(1);
    expect(saved.filter((f) => /^hcml-portal-ollama-\d{8}T\d{6}Z\.log\.gz$/.test(f))).toHaveLength(1);
    const text = gunzipSync(readFileSync(join(dir, saved.find((f) => /^hcml-portal-\d/.test(f))!))).toString('utf8');
    expect(text).toContain('"event":"ai_call"');
    expect(r.stdout.indexOf('Saving the logs of hcml-portal')).toBeLessThan(r.stdout.indexOf('+ docker tag'));
  });

  it('plans the save and makes no file on a dry run', () => {
    const dir = archive('logs-dry');
    const r = rebuild(tree('logs-dry-run'), ['--dry-run', '--skip-verify'], { LOG_ARCHIVE_DIR: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Saving the logs of hcml-portal');
    expect(files(dir)).toEqual([]);
  });

  it('keeps the newest LOG_ARCHIVE_KEEP files of a project and removes the older ones', () => {
    const dir = archive('logs-keep');
    mkdirSync(dir, { recursive: true });
    // The modification times run the other way from the names, as they do after a copy of the folder: the newest name
    // is the oldest file. The name decides, since it holds the time the logs were saved and a copy does not change it.
    const stamps = ['20260101T000000Z', '20260102T000000Z', '20260103T000000Z'];
    for (const [i, stamp] of stamps.entries()) {
      const file = join(dir, `hcml-portal-${stamp}.log.gz`);
      writeFileSync(file, 'old');
      utimesSync(file, new Date(Date.UTC(2026, 5, 3 - i)), new Date(Date.UTC(2026, 5, 3 - i)));
    }
    writeFileSync(join(dir, 'hcml-portal-ollama-20260101T000000Z.log.gz'), 'other project');
    const r = rebuild(tree('logs-keep-run'), ['--skip-verify'], { ...healthy, LOG_ARCHIVE_DIR: dir, LOG_ARCHIVE_KEEP: '2' });
    expect(r.status).toBe(0);
    const mine = files(dir).filter((f) => /^hcml-portal-\d/.test(f));
    expect(mine).toHaveLength(2);
    expect(mine).not.toContain('hcml-portal-20260101T000000Z.log.gz');
    expect(mine).not.toContain('hcml-portal-20260102T000000Z.log.gz');
    expect(files(dir)).toContain('hcml-portal-ollama-20260101T000000Z.log.gz');
  });

  it('goes on with the build when the logs cannot be read, and leaves no empty file', () => {
    const dir = archive('logs-fail');
    const r = rebuild(tree('logs-fail-run'), ['--skip-verify'], { ...healthy, LOG_ARCHIVE_DIR: dir, FAKE_LOGS_FAIL: '1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('could not save the logs of hcml-portal');
    expect(files(dir)).toEqual([]);
  });

  it('goes on with the build when the folder for the logs cannot be made', () => {
    const notAFolder = join(scratch, 'logs-not-a-folder');
    writeFileSync(notAFolder, 'a file where the folder should be');
    const r = rebuild(tree('logs-nofolder-run'), ['--skip-verify'], { ...healthy, LOG_ARCHIVE_DIR: join(notAFolder, 'logs') });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('could not make');
    expect(r.stdout).toContain('+ docker tag');
  });

  it('keeps the logs private: they hold the names typed at sign-in, addresses and the text of searches', () => {
    const dir = archive('logs-private');
    const r = rebuild(tree('logs-private-run'), ['--skip-verify'], { ...healthy, LOG_ARCHIVE_DIR: dir });
    expect(r.status).toBe(0);
    const saved = files(dir);
    expect(saved).toHaveLength(1);
    for (const f of saved) expect(statSync(join(dir, f)).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it.each([
    ['0', 1],
    ['08', 8],
    ['', 30],
    ['1e3', 30],
    ['99999999999999999999', 30],
  ])('reads LOG_ARCHIVE_KEEP=%j as %i: never none (that would remove the file just written), never a bad octal', (keep, kept) => {
    const dir = archive(`logs-keep-${keep || 'empty'}`);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 40; i++) writeFileSync(join(dir, `hcml-portal-202601${String(i + 1).padStart(2, '0')}T000000Z.log.gz`), 'old');
    const r = rebuild(tree(`logs-keep-run-${keep || 'empty'}`), ['--skip-verify'], { ...healthy, LOG_ARCHIVE_DIR: dir, LOG_ARCHIVE_KEEP: keep });
    expect(r.status).toBe(0);
    const mine = files(dir).filter((f) => /^hcml-portal-\d/.test(f));
    expect(mine).toHaveLength(kept);
    // The one written by this run is the newest by name, so it is always among those kept.
    expect(mine.some((f) => !f.startsWith('hcml-portal-202601'))).toBe(true);
  });

  it('prunes in a folder whose name has a space in it', () => {
    const dir = archive('logs with a space');
    mkdirSync(dir, { recursive: true });
    for (const stamp of ['20260101T000000Z', '20260102T000000Z', '20260103T000000Z']) writeFileSync(join(dir, `hcml-portal-${stamp}.log.gz`), 'old');
    const r = rebuild(tree('logs-space-run'), ['--skip-verify'], { ...healthy, LOG_ARCHIVE_DIR: dir, LOG_ARCHIVE_KEEP: '2' });
    expect(r.status).toBe(0);
    expect(files(dir).filter((f) => /^hcml-portal-\d/.test(f))).toHaveLength(2);
  });

  it('writes the logs of a run that names no folder into the folder of the test, not into the home folder', () => {
    const r = rebuild(tree('logs-default-run'), ['--skip-verify'], { ...healthy });
    expect(r.status).toBe(0);
    expect(files(join(scratch, 'default-logs')).some((f) => /^hcml-portal-\d/.test(f))).toBe(true);
  });
});
