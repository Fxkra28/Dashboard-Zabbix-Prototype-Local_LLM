import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * deploy/backup-state.sh and deploy/restore-state.sh move the portal's volumes in and out of an encrypted file. Docker is a stand-in here that hands them a folder as if it were the volumes, and
 * openssl, tar and gzip are the real ones, so what is tested is the file that comes out: that it holds no plain text, that a wrong passphrase opens nothing, and that it comes back whole.
 */

const run = promisify(execFile);
const deploy = (name: string) => fileURLToPath(new URL(`../../../deploy/${name}`, import.meta.url));
const which = (name: string) => {
  try {
    return execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const bash = which('bash');
const hasPbkdf2 = (() => {
  try {
    execFileSync('sh', ['-c', 'printf x | openssl enc -aes-256-cbc -pbkdf2 -iter 1000 -pass pass:t >/dev/null']);
    return true;
  } catch {
    return false;
  }
})();
const canRun = Boolean(bash) && ['tar', 'gzip', 'sed'].every((t) => which(t)) && hasPbkdf2;

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Rig {
  /** The copy's folder, with the two scripts in its deploy folder. */
  root: string;
  /** What the stand-in docker hands out as the volumes. */
  volumes: string;
  /** Where the stand-in docker writes a restore. */
  restored: string;
  backups: string;
  pass: string;
  env: Record<string, string>;
}

function rig(): Rig {
  const base = mkdtempSync(join(tmpdir(), 'backup-'));
  made.push(base);
  const root = join(base, 'hcml-portal');
  const bin = join(base, 'bin');
  const volumes = join(base, 'volumes');
  const restored = join(base, 'restored');
  const backups = join(base, 'backups');
  for (const dir of [join(root, 'deploy'), bin, join(volumes, 'state'), join(volumes, 'logs'), restored]) mkdirSync(dir, { recursive: true });
  for (const name of ['backup-state.sh', 'restore-state.sh']) copyFileSync(deploy(name), join(root, 'deploy', name));
  writeFileSync(join(volumes, 'state', 'users.json'), '{"users":[{"username":"citra","hash":"argon2id.SECRETMARKER"}]}\n');
  writeFileSync(join(volumes, 'logs', 'portal.log'), 'started\n');
  const pass = join(base, 'pass.txt');
  writeFileSync(pass, 'correct horse battery staple\n', { mode: 0o600 });
  writeFileSync(
    join(bin, 'docker'),
    `#!${bash}
[ -n "\${FAKE_DOCKER_LOG:-}" ] && printf '%s\\n' "$*" >>"$FAKE_DOCKER_LOG"
case "$1" in
  # Compose refusing, as it does for a COMPOSE_FILE that names a file that is not there: its words on stderr and no id.
  compose) if [ -n "\${FAKE_COMPOSE_ERROR:-}" ]; then printf '%s\\n' "$FAKE_COMPOSE_ERROR" >&2; exit 1; fi; [ -n "\${FAKE_NO_CONTAINER:-}" ] || echo 3f2a9c1d4b7e8a60e5d4c3b2a1908f7e6d5c4b3a29181716151413121110abcd;;
  inspect)
    case "$3" in
      *'"/data"'*) echo vol-state;;
      *'/var/log/portal'*) echo vol-logs;;
      *Config.Image*) echo hcml-test-image;;
      # A paused or restarting container is Running for Docker, and its Status, Paused and Restarting say which.
      *State.Status*) echo "\${FAKE_STATUS:-exited}";;
      *State.Paused*) echo "\${FAKE_PAUSED:-false}";;
      *State.Restarting*) echo "\${FAKE_RESTARTING:-false}";;
      *State.Running*) echo "\${FAKE_RUNNING:-false}";;
    esac;;
  run)
    case " $* " in
      *" -cz "*) [ -n "\${FAKE_RUN_FAILS:-}" ] && exit 1; tar -c -C "$FAKE_VOLUMES" state logs | gzip;;
      *" -xz "*) tar -xz -C "$FAKE_RESTORED";;
      # The copy of what a restore replaces: the volume is the folder of the restored files, so /state is that folder's state.
      *" sh "*) eval "$(printf '%s' "\${@: -1}" | sed "s#/state#$FAKE_RESTORED/state#g")";;
      *) exit 1;;
    esac;;
  *) exit 1;;
esac
`,
  );
  chmodSync(join(bin, 'docker'), 0o755);
  return {
    root,
    volumes,
    restored,
    backups,
    pass,
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: base, FAKE_VOLUMES: volumes, FAKE_RESTORED: restored, BACKUP_DIR: backups, BACKUP_PASSPHRASE_FILE: pass },
  };
}

async function sh(r: Rig, script: string, args: string[], extra: Record<string, string> = {}, input?: string) {
  try {
    const call = run(bash, [join(r.root, 'deploy', script), ...args], { env: { ...r.env, ...extra }, timeout: 60_000 });
    // What a person types at the prompts of a script that is not given a passphrase file.
    call.child.stdin?.end(input ?? '');
    const { stdout, stderr } = await call;
    return { code: 0, out: stdout, err: stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}

const copies = (r: Rig) => (existsSync(r.backups) ? readdirSync(r.backups).filter((f) => /-state-.*\.tar\.gz\.enc$/.test(f)) : []);

describe.skipIf(!canRun)('deploy/backup-state.sh', { timeout: 120_000 }, () => {
  it('writes the volumes into one encrypted file with a checksum, and the file holds no plain text and is not gzip', async () => {
    const r = rig();
    const { code, out, err } = await sh(r, 'backup-state.sh', []);
    expect(code, err).toBe(0);
    const [file] = copies(r);
    expect(file).toMatch(/^hcml-hcml-portal-state-\d{8}T\d{6}Z\.tar\.gz\.enc$/);
    const bytes = readFileSync(join(r.backups, file));
    expect(bytes.toString('latin1')).not.toContain('SECRETMARKER');
    expect(bytes.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))).toBe(false);
    expect(readFileSync(join(r.backups, `${file}.sha256`), 'utf8').trim().split(/\s+/)[1]).toBe(file);
    expect(out).toContain('treat it as a secret');
    expect(statSync(r.backups).mode & 0o077).toBe(0);
    expect(readdirSync(r.backups).some((f) => f.endsWith('.partial'))).toBe(false);
  });

  it('can be opened again with its passphrase and lists users.json and the log, and a wrong passphrase opens nothing', async () => {
    const r = rig();
    await sh(r, 'backup-state.sh', []);
    const file = join(r.backups, copies(r)[0]);
    const good = await sh(r, 'backup-state.sh', ['--check', file]);
    expect(good.code, good.err).toBe(0);
    expect(good.out).toContain('state/users.json');
    expect(good.out).toContain('logs/portal.log');
    const wrong = join(r.root, 'wrong.txt');
    writeFileSync(wrong, 'not the passphrase\n');
    const bad = await sh(r, 'backup-state.sh', ['--check', file], { BACKUP_PASSPHRASE_FILE: wrong });
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('did not open');
  });

  it('says what to do when the stack has no portal container, and writes nothing', async () => {
    const r = rig();
    const { code, err } = await sh(r, 'backup-state.sh', [], { FAKE_NO_CONTAINER: '1' });
    expect(code).toBe(1);
    expect(err).toContain('no portal-bff container');
    expect(copies(r)).toEqual([]);
  });

  // IN-100 left a COMPOSE_FILE line that names docker-compose.override.yml, and where the file is not there Compose refuses: the scripts hid what it said and sent the operator to start a stack that
  // would fail the same way.
  it.each(['backup-state.sh', 'restore-state.sh'])('shows what Compose said when it refuses, and does not say there is no container (%s)', async (script) => {
    const r = rig();
    let file: string | undefined;
    if (script === 'restore-state.sh') {
      expect((await sh(r, 'backup-state.sh', [])).code).toBe(0);
      file = join(r.backups, copies(r)[0]);
    }
    const words = "open /srv/hcml-portal-ollama/docker-compose.override.yml: no such file or directory";
    const { code, err } = await sh(r, script, file ? [file, '--apply'] : [], { FAKE_COMPOSE_ERROR: words });
    expect(code).toBe(1);
    expect(err).toContain(words);
    expect(err).toContain('docker compose');
    expect(err).not.toContain('no portal-bff container');
    if (!file) expect(copies(r)).toEqual([]);
  });

  it('still says there is no container when Compose says nothing and finds none', async () => {
    const r = rig();
    const { err } = await sh(r, 'backup-state.sh', [], { FAKE_NO_CONTAINER: '1' });
    expect(err).toContain('no portal-bff container');
  });

  it('keeps the newest BACKUP_KEEP copies of the volumes and deletes the older ones with their checksums', async () => {
    const r = rig();
    mkdirSync(r.backups, { recursive: true });
    for (const [i, day] of ['20260101', '20260102', '20260103'].entries()) {
      const name = join(r.backups, `hcml-hcml-portal-state-${day}T000000Z.tar.gz.enc`);
      writeFileSync(name, 'old');
      writeFileSync(`${name}.sha256`, 'old');
      const when = new Date(2026, 0, i + 1);
      utimesSync(name, when, when);
    }
    const { code, out, err } = await sh(r, 'backup-state.sh', [], { BACKUP_KEEP: '2' });
    expect(code, err).toBe(0);
    const kept = copies(r);
    expect(kept).toHaveLength(2);
    expect(kept.some((f) => f.includes('20260103T'))).toBe(true);
    expect(kept.some((f) => f.includes('20260101T'))).toBe(false);
    expect(existsSync(join(r.backups, 'hcml-hcml-portal-state-20260101T000000Z.tar.gz.enc.sha256'))).toBe(false);
    expect(out).toContain('Deleted 2 older');
  });

  it('with --env also copies .env and the override file into a second encrypted file, and says so when there is none', async () => {
    const none = rig();
    const missing = await sh(none, 'backup-state.sh', ['--env']);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('no .env or docker-compose.override.yml');

    const r = rig();
    writeFileSync(join(r.root, '.env'), 'SESSION_SECRET=made-up-for-the-test\n');
    const { code, err } = await sh(r, 'backup-state.sh', ['--env']);
    expect(code, err).toBe(0);
    const envFile = readdirSync(r.backups).find((f) => /-env-.*\.tar\.gz\.enc$/.test(f));
    expect(envFile).toBeDefined();
    expect(readFileSync(join(r.backups, envFile!)).toString('latin1')).not.toContain('made-up-for-the-test');
    const listed = await sh(r, 'backup-state.sh', ['--check', join(r.backups, envFile!)]);
    expect(listed.out).toContain('.env');
  });
});

// IN-103 and IN-106: the branches of the backup that no test reached.
describe.skipIf(!canRun)('deploy/backup-state.sh, its limits and its prompts', { timeout: 120_000 }, () => {
  it.each([['0'], ['abc'], ['-1'], ['1.5'], ['99999999']])('refuses BACKUP_KEEP=%s in words, before anything is copied, and keeps the copy it would have deleted', async (keep) => {
    const r = rig();
    const { code, err } = await sh(r, 'backup-state.sh', [], { BACKUP_KEEP: keep });
    expect(code).toBe(1);
    expect(err).toContain('BACKUP_KEEP is the number of copies to keep');
    expect(copies(r)).toEqual([]);
    expect(existsSync(r.backups)).toBe(false);
  });

  it.each([['0'], ['abc'], ['1.5']])('leaves the copies that are there alone when BACKUP_KEEP=%s is refused, and makes none', async (keep) => {
    const r = rig();
    mkdirSync(r.backups, { recursive: true });
    const old = 'hcml-hcml-portal-state-20260101T000000Z.tar.gz.enc';
    writeFileSync(join(r.backups, old), 'old');
    writeFileSync(join(r.backups, `${old}.sha256`), 'old');
    const { code } = await sh(r, 'backup-state.sh', [], { BACKUP_KEEP: keep });
    expect(code).toBe(1);
    expect(copies(r)).toEqual([old]);
    expect(existsSync(join(r.backups, `${old}.sha256`))).toBe(true);
  });

  // The folder of copies may be copied back to a new machine, where the files get new times in the order of the copy: the stamp in the name is the age.
  it('keeps the newest copies by the stamp in their names, not by the times of the files', async () => {
    const r = rig();
    mkdirSync(r.backups, { recursive: true });
    for (const [i, day] of ['20260101', '20260102', '20260103'].entries()) {
      const name = join(r.backups, `hcml-hcml-portal-state-${day}T000000Z.tar.gz.enc`);
      writeFileSync(name, 'old');
      writeFileSync(`${name}.sha256`, 'old');
      // The times run the other way: the oldest copy by its name is the newest file.
      const when = new Date(2026, 5, 10 - i);
      utimesSync(name, when, when);
    }
    const { code, err } = await sh(r, 'backup-state.sh', [], { BACKUP_KEEP: '2' });
    expect(code, err).toBe(0);
    const kept = copies(r).map((f) => f.match(/state-(\d{8})T/)![1]);
    expect(kept).toContain('20260103');
    expect(kept).not.toContain('20260101');
    expect(kept).not.toContain('20260102');
    expect(kept).toHaveLength(2);
    expect(existsSync(join(r.backups, 'hcml-hcml-portal-state-20260102T000000Z.tar.gz.enc.sha256'))).toBe(false);
  });

  // 007 is 7 in octal too: 08 and 010 are the numbers that tell a decimal reading from an octal one.
  it.each([
    ['010', 10],
    ['08', 8],
  ])('reads BACKUP_KEEP=%s as the decimal number it looks like', async (keep, count) => {
    const r = rig();
    mkdirSync(r.backups, { recursive: true });
    for (let i = 1; i <= 12; i++) {
      const name = join(r.backups, `hcml-hcml-portal-state-202601${String(i).padStart(2, '0')}T000000Z.tar.gz.enc`);
      writeFileSync(name, 'old');
    }
    const { code, err } = await sh(r, 'backup-state.sh', [], { BACKUP_KEEP: keep });
    expect(code, err).toBe(0);
    expect(copies(r)).toHaveLength(count);
  });

  it('keeps one copy for BACKUP_KEEP=1, and reads 007 as 7', async () => {
    const r = rig();
    expect((await sh(r, 'backup-state.sh', [], { BACKUP_KEEP: '1' })).code).toBe(0);
    expect(copies(r)).toHaveLength(1);
    expect((await sh(r, 'backup-state.sh', [], { BACKUP_KEEP: '007' })).code).toBe(0);
  });

  it('reads a typed passphrase once, and once more to be sure, and not again for the read-back of the copy', async () => {
    const r = rig();
    const { code, err } = await sh(r, 'backup-state.sh', [], { BACKUP_PASSPHRASE_FILE: '' }, 'typed pass phrase\ntyped pass phrase\n');
    expect(code, err).toBe(0);
    expect(err.match(/Passphrase: /g)).toHaveLength(1);
    expect(err.match(/Passphrase again: /g)).toHaveLength(1);
    // The same words open it, from a file and when typed once.
    const file = join(r.backups, copies(r)[0]);
    const typed = join(r.root, 'typed.txt');
    writeFileSync(typed, 'typed pass phrase\n');
    expect((await sh(r, 'backup-state.sh', ['--check', file], { BACKUP_PASSPHRASE_FILE: typed })).code).toBe(0);
    const again = await sh(r, 'backup-state.sh', ['--check', file], { BACKUP_PASSPHRASE_FILE: '' }, 'typed pass phrase\n');
    expect(again.code, again.err).toBe(0);
    expect(again.err.match(/Passphrase: /g)).toHaveLength(1);
  });

  it('refuses two passphrases that are not the same, an empty one and none at all, and writes nothing', async () => {
    const r = rig();
    const slip = await sh(r, 'backup-state.sh', [], { BACKUP_PASSPHRASE_FILE: '' }, 'one thing\nanother\n');
    expect(slip.code).toBe(1);
    expect(slip.err).toContain('not the same');
    expect((await sh(r, 'backup-state.sh', [], { BACKUP_PASSPHRASE_FILE: '' }, '\n\n')).err).toContain('the passphrase is empty');
    expect((await sh(r, 'backup-state.sh', [], { BACKUP_PASSPHRASE_FILE: '' }, '')).err).toContain('no passphrase was given');
    expect(copies(r)).toEqual([]);
  });

  it('never puts a typed passphrase into a file or into the arguments of a command', async () => {
    const r = rig();
    const log = join(r.root, 'docker.log');
    await sh(r, 'backup-state.sh', [], { BACKUP_PASSPHRASE_FILE: '', FAKE_DOCKER_LOG: log }, 'a secret to find\na secret to find\n');
    expect(readFileSync(log, 'utf8')).not.toContain('a secret to find');
    for (const f of readdirSync(r.backups)) expect(readFileSync(join(r.backups, f)).toString('latin1')).not.toContain('a secret to find');
  });

  it('leaves no .partial file behind when the read of the volumes fails, and says nothing was kept', async () => {
    const r = rig();
    const { code } = await sh(r, 'backup-state.sh', [], { FAKE_RUN_FAILS: '1' });
    expect(code).not.toBe(0);
    expect(existsSync(r.backups) ? readdirSync(r.backups) : []).toEqual([]);
  });

  it('changes the mode of the folder of copies only when it makes the folder', async () => {
    const r = rig();
    mkdirSync(r.backups, { recursive: true });
    chmodSync(r.backups, 0o755);
    expect((await sh(r, 'backup-state.sh', [])).code).toBe(0);
    expect(statSync(r.backups).mode & 0o777).toBe(0o755);
    const fresh = rig();
    expect((await sh(fresh, 'backup-state.sh', [])).code).toBe(0);
    expect(statSync(fresh.backups).mode & 0o777).toBe(0o700);
  });

  it('copies docker-compose.override.yml with the settings, whether or not there is a .env', async () => {
    const r = rig();
    writeFileSync(join(r.root, 'docker-compose.override.yml'), 'services: {}\n');
    const only = await sh(r, 'backup-state.sh', ['--env']);
    expect(only.code, only.err).toBe(0);
    const file = join(r.backups, readdirSync(r.backups).find((f) => /-env-.*\.tar\.gz\.enc$/.test(f))!);
    const listed = await sh(r, 'backup-state.sh', ['--check', file]);
    expect(listed.out).toContain('docker-compose.override.yml');
    expect(listed.out).not.toMatch(/^\s+\.env$/m);
    writeFileSync(join(r.root, '.env'), 'X=1\n');
    const both = await sh(r, 'backup-state.sh', ['--env']);
    expect(both.code, both.err).toBe(0);
    const last = readdirSync(r.backups).filter((f) => /-env-.*\.tar\.gz\.enc$/.test(f)).sort().at(-1)!;
    const all = await sh(r, 'backup-state.sh', ['--check', join(r.backups, last)]);
    expect(all.out).toContain('.env');
    expect(all.out).toContain('docker-compose.override.yml');
  });

  it('asks Docker to read the volumes with the arguments that keep it from changing them or reaching the network', async () => {
    const r = rig();
    const log = join(r.root, 'docker.log');
    await sh(r, 'backup-state.sh', [], { FAKE_DOCKER_LOG: log });
    const run = readFileSync(log, 'utf8').split('\n').find((l) => l.startsWith('run '));
    expect(run).toBe('run --rm --network none --read-only --entrypoint tar -v vol-state:/state:ro -v vol-logs:/logs:ro hcml-test-image -cz -C / state logs');
  });
});

describe.skipIf(!canRun)('deploy/restore-state.sh', { timeout: 120_000 }, () => {
  async function made_copy(r: Rig) {
    const done = await sh(r, 'backup-state.sh', []);
    expect(done.code, done.err).toBe(0);
    return join(r.backups, copies(r)[0]);
  }

  it('lists what a copy holds and changes nothing without --apply', async () => {
    const r = rig();
    const file = await made_copy(r);
    const { code, out } = await sh(r, 'restore-state.sh', [file]);
    expect(code).toBe(0);
    expect(out).toContain('state/users.json');
    expect(out).toContain('Nothing was changed');
    expect(readdirSync(r.restored)).toEqual([]);
  });

  it('refuses while the portal is running, so that nothing writes as the files come back', async () => {
    const r = rig();
    const file = await made_copy(r);
    const { code, err } = await sh(r, 'restore-state.sh', [file, '--apply'], { FAKE_RUNNING: 'true' });
    expect(code).toBe(1);
    expect(err).toContain('is running: stop it first');
    expect(readdirSync(r.restored)).toEqual([]);
  });

  it('writes the volumes back whole when the portal is stopped', async () => {
    const r = rig();
    const file = await made_copy(r);
    const { code, out, err } = await sh(r, 'restore-state.sh', [file, '--apply']);
    expect(code, err).toBe(0);
    expect(out).toContain('Restored');
    expect(readFileSync(join(r.restored, 'state', 'users.json'), 'utf8')).toBe(readFileSync(join(r.volumes, 'state', 'users.json'), 'utf8'));
    expect(readFileSync(join(r.restored, 'logs', 'portal.log'), 'utf8')).toBe('started\n');
  });

  it('writes nothing for a wrong passphrase or a file that is not a copy', async () => {
    const r = rig();
    const file = await made_copy(r);
    const wrong = join(r.root, 'wrong.txt');
    writeFileSync(wrong, 'nope\n');
    const bad = await sh(r, 'restore-state.sh', [file, '--apply'], { BACKUP_PASSPHRASE_FILE: wrong });
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('did not open');
    const junk = join(r.root, 'junk.enc');
    writeFileSync(junk, 'this is not a copy');
    const notCopy = await sh(r, 'restore-state.sh', [junk, '--apply']);
    expect(notCopy.code).toBe(1);
    expect(readdirSync(r.restored)).toEqual([]);
  });

  it('asks for the file when none is named, and for a file that exists', async () => {
    const r = rig();
    expect((await sh(r, 'restore-state.sh', [])).err).toContain('name the copy to restore');
    expect((await sh(r, 'restore-state.sh', [join(r.root, 'nothing.enc')])).err).toContain('is not a file');
  });
});

describe.skipIf(!canRun)('deploy/restore-state.sh, what it replaces and what it asks (IN-103, IN-106)', { timeout: 120_000 }, () => {
  async function copyOf(r: Rig) {
    expect((await sh(r, 'backup-state.sh', [])).code).toBe(0);
    return join(r.backups, copies(r)[0]);
  }

  it('keeps each file it replaces beside itself as <name>.before-restore, and says so', async () => {
    const r = rig();
    const file = await copyOf(r);
    mkdirSync(join(r.restored, 'state'), { recursive: true });
    writeFileSync(join(r.restored, 'state', 'users.json'), 'THE USERS BEFORE\n');
    writeFileSync(join(r.restored, 'state', 'portal-state.json'), 'THE STATE BEFORE\n');
    const { code, out, err } = await sh(r, 'restore-state.sh', [file, '--apply']);
    expect(code, err).toBe(0);
    expect(out).toContain('before-restore');
    expect(readFileSync(join(r.restored, 'state', 'users.json.before-restore'), 'utf8')).toBe('THE USERS BEFORE\n');
    expect(readFileSync(join(r.restored, 'state', 'portal-state.json.before-restore'), 'utf8')).toBe('THE STATE BEFORE\n');
    expect(readFileSync(join(r.restored, 'state', 'users.json'), 'utf8')).toBe(readFileSync(join(r.volumes, 'state', 'users.json'), 'utf8'));
  });

  it('keeps one copy of each and not a copy of a copy, when it restores a second time', async () => {
    const r = rig();
    const file = await copyOf(r);
    mkdirSync(join(r.restored, 'state'), { recursive: true });
    writeFileSync(join(r.restored, 'state', 'users.json'), 'FIRST\n');
    await sh(r, 'restore-state.sh', [file, '--apply']);
    writeFileSync(join(r.restored, 'state', 'users.json'), 'SECOND\n');
    await sh(r, 'restore-state.sh', [file, '--apply']);
    expect(readFileSync(join(r.restored, 'state', 'users.json.before-restore'), 'utf8')).toBe('SECOND\n');
    expect(readdirSync(join(r.restored, 'state')).filter((f) => f.includes('before-restore.before-restore'))).toEqual([]);
  });

  it('copies nothing, and says nothing of it, when the volume is new and holds no file', async () => {
    const r = rig();
    const file = await copyOf(r);
    const { code, err } = await sh(r, 'restore-state.sh', [file, '--apply']);
    expect(code, err).toBe(0);
    expect(readdirSync(join(r.restored, 'state')).filter((f) => f.endsWith('.before-restore'))).toEqual([]);
  });

  it('reads a typed passphrase once, for the test of the copy and for the restore', async () => {
    const r = rig();
    const typed = join(r.root, 'typed.txt');
    writeFileSync(typed, 'typed pass phrase\n');
    expect((await sh(r, 'backup-state.sh', [], { BACKUP_PASSPHRASE_FILE: typed })).code).toBe(0);
    const file = join(r.backups, copies(r)[0]);
    const { code, err } = await sh(r, 'restore-state.sh', [file, '--apply'], { BACKUP_PASSPHRASE_FILE: '' }, 'typed pass phrase\n');
    expect(code, err).toBe(0);
    expect(err.match(/Passphrase: /g)).toHaveLength(1);
    expect(readFileSync(join(r.restored, 'state', 'users.json'), 'utf8')).toContain('SECRETMARKER');
  });

  // Docker says Running for all three, and what tells them apart is another field: a script that asked for the Status would let a paused or restarting portal go on writing while the files come back.
  it.each([
    ['runs', { FAKE_RUNNING: 'true', FAKE_STATUS: 'running' }],
    ['is paused', { FAKE_RUNNING: 'true', FAKE_PAUSED: 'true', FAKE_STATUS: 'paused' }],
    ['is restarting', { FAKE_RUNNING: 'true', FAKE_RESTARTING: 'true', FAKE_STATUS: 'restarting' }],
  ])('refuses for a container that %s', async (_state, fake) => {
    const r = rig();
    const file = await copyOf(r);
    const { code, err } = await sh(r, 'restore-state.sh', [file, '--apply'], fake);
    expect(code).toBe(1);
    expect(err).toContain('is running: stop it first');
    expect(existsSync(join(r.restored, 'state', 'users.json'))).toBe(false);
  });

  it('goes on for a container that is stopped', async () => {
    const r = rig();
    const file = await copyOf(r);
    const { code, err } = await sh(r, 'restore-state.sh', [file, '--apply'], { FAKE_RUNNING: 'false', FAKE_STATUS: 'exited' });
    expect(code, err).toBe(0);
  });

  // A copy of what is replaced that could not be made (a full volume, a file left read-only) must stop the restore: it said the old users were beside it and they were in no file.
  it.skipIf(process.getuid?.() === 0)('stops, and writes nothing back, when the copy of a file it would replace cannot be made', async () => {
    const r = rig();
    const file = await copyOf(r);
    mkdirSync(join(r.restored, 'state'), { recursive: true });
    writeFileSync(join(r.restored, 'state', 'users.json'), 'THE USERS BEFORE\n');
    writeFileSync(join(r.restored, 'state', 'users.json.before-restore'), 'LEFT BY AN EARLIER RESTORE\n', { mode: 0o444 });
    const { code, out } = await sh(r, 'restore-state.sh', [file, '--apply']);
    expect(code).not.toBe(0);
    expect(out).not.toContain('Restored');
    expect(readFileSync(join(r.restored, 'state', 'users.json'), 'utf8')).toBe('THE USERS BEFORE\n');
  });

  it('asks Docker to write the copy back with the arguments that keep it off the network, and reads the compose project from the copy\'s folder', async () => {
    const r = rig();
    const file = await copyOf(r);
    const log = join(r.root, 'docker.log');
    await sh(r, 'restore-state.sh', [file, '--apply'], { FAKE_DOCKER_LOG: log });
    const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
    expect(lines.find((l) => l.includes(' -xz '))).toBe('run --rm -i --network none --entrypoint tar -v vol-state:/state -v vol-logs:/logs hcml-test-image -xz -C /');
    expect(lines.some((l) => l.startsWith('run --rm --network none --entrypoint sh -v vol-state:/state hcml-test-image -c'))).toBe(true);
    expect(lines[0]).toBe(`compose --project-directory ${r.root} ps -a -q portal-bff`);
  });
});

