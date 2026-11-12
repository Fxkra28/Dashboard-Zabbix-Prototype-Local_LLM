import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * deploy/watch.sh (tracker IN-31), run with stand-ins for curl and docker, its state in a scratch folder,
 * and its notifications written to a file instead of the desktop.
 */
// WATCH_SCRIPT names a copy to try: the LaunchAgent runs deploy/watch.sh itself, so a change is live as soon as it is saved.
const script = process.env.WATCH_SCRIPT ?? fileURLToPath(new URL('../../../deploy/watch.sh', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'watch-script-test-'));
const bin = join(scratch, 'bin');
mkdirSync(bin);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// A curl whose answer comes from FAKE_DOWN: a portal whose address matches it does not answer.
writeFileSync(
  join(bin, 'curl'),
  `#!/usr/bin/env bash
url="\${@: -1}"
if [ -n "\${FAKE_DOWN:-}" ] && printf '%s' "$url" | grep -Eq "$FAKE_DOWN"; then exit 7; fi
# A portal that is alive but cannot read Zabbix says ready:false to anyone; FAKE_READY says ready:true, as the portal now does.
if [ -n "\${FAKE_NOT_READY:-}" ] && printf '%s' "$url" | grep -Eq "$FAKE_NOT_READY"; then printf '{"ok":true,"ts":1,"ready":false}'; exit 0; fi
if [ -n "\${FAKE_READY:-}" ]; then printf '{"ok":true,"ts":1,"ready":true}'; exit 0; fi
printf '{"ok":true,"ts":1}'
`,
);
// A docker whose containers are the lines "name health restarts [state]" of FAKE_INSPECT (state is running when left out),
// answered as `docker inspect` is asked to: "state health restarts". FAKE_DOCKER_DOWN=1 stops it; FAKE_DOCKER_HANG=1 makes
// every call hang, and FAKE_INSPECT_HANG=1 only the reads of a container.
writeFileSync(
  join(bin, 'docker'),
  `#!/usr/bin/env bash
[ "\${FAKE_DOCKER_DOWN:-0}" = 1 ] && exit 1
[ "\${FAKE_DOCKER_HANG:-0}" = 1 ] && exec sleep "\${FAKE_HANG_SECONDS:-30}"
if [ "$1" = info ]; then exit 0; fi
if [ "$1" = inspect ]; then
  [ "\${FAKE_INSPECT_HANG:-0}" = 1 ] && exec sleep "\${FAKE_HANG_SECONDS:-30}"
  name="\${@: -1}"
  line=$(grep "^$name " "$FAKE_INSPECT" 2>/dev/null) || exit 1
  read -r _ health restarts state <<< "$line"
  printf '%s %s %s\\n' "\${state:-running}" "$health" "$restarts"
  exit 0
fi
exit 99
`,
);
writeFileSync(join(bin, 'note'), `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >> "$NOTES"\n`);
// A notify command that is down: it records the attempt and exits 1, as a mail relay that is down does.
writeFileSync(join(bin, 'note-down'), `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >> "$ATTEMPTS"\nexit 1\n`);
// A notify command that stalls, as a mail relay that holds the connection does, and one that records every argument it gets.
writeFileSync(join(bin, 'note-slow'), `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >> "$ATTEMPTS"\nsleep "\${FAKE_NOTIFY_SECONDS:-30}"\n`);
writeFileSync(join(bin, 'note-args'), `#!/usr/bin/env bash\nprintf '%s\\n' "$#" >> "$ARGC"\nfor a in "$@"; do printf '[%s]\\n' "$a" >> "$ARGV"; done\n`);
// The desktop's notifier, which waits on a screen nobody is at: osascript on a Mac, notify-send on Linux.
for (const name of ['osascript', 'notify-send']) writeFileSync(join(bin, name), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$ATTEMPTS"\nsleep "\${FAKE_NOTIFY_SECONDS:-30}"\n`);
for (const f of ['curl', 'docker', 'note', 'note-down', 'note-slow', 'note-args', 'osascript', 'notify-send']) chmodSync(join(bin, f), 0o755);
// A mktemp that is slow to hand back the name of the new-state file, so that a signal can arrive in between.
const slowBin = join(scratch, 'slow-bin');
mkdirSync(slowBin);
writeFileSync(
  join(slowBin, 'mktemp'),
  `#!/usr/bin/env bash
case "$1" in
  *state.XXXXXX) name=$(/usr/bin/mktemp "$@") || exit 1; sleep 3; printf '%s\\n' "$name" ;;
  *) exec /usr/bin/mktemp "$@" ;;
esac
`,
);
// A docker that ignores TERM, and writes its pid where the test can see it.
const stubbornBin = join(scratch, 'stubborn-bin');
mkdirSync(stubbornBin);
writeFileSync(join(stubbornBin, 'docker'), `#!/usr/bin/env bash\ntrap '' TERM\necho $$ > "$FAKE_PID"\nwhile :; do sleep 1; done\n`);
for (const f of ['mktemp']) chmodSync(join(slowBin, f), 0o755);
chmodSync(join(stubbornBin, 'docker'), 0o755);

let dir = '';
let n = 0;
beforeEach(() => {
  dir = join(scratch, `run-${++n}`);
  mkdirSync(dir);
  writeFileSync(join(dir, 'inspect'), 'bff healthy 0\nweb healthy 0\n');
});

const runEnv = (env: Record<string, string>) => ({
  ...process.env,
  PATH: `${bin}:${process.env.PATH ?? ''}`,
  WATCH_STATE_DIR: join(dir, 'state'),
  WATCH_URLS: 'http://127.0.0.1:8081 http://127.0.0.1:8082',
  WATCH_CONTAINERS: 'bff web',
  WATCH_NOTIFY_CMD: join(bin, 'note'),
  NOTES: join(dir, 'notes'),
  FAKE_INSPECT: join(dir, 'inspect'),
  ...env,
});
function watch(env: Record<string, string> = {}, arg = '--once') {
  return spawnSync('bash', [script, arg], {
    encoding: 'utf8',
    timeout: 25_000, // a watcher that hangs fails its test instead of the suite
    env: runEnv(env),
  });
}
/** The script started and left running, so that a test can send it a signal or run two at once. */
function startWatch(env: Record<string, string> = {}) {
  const child = spawn('bash', [script, '--once'], { env: runEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const done = new Promise<{ code: number | null; stderr: string }>((resolve) => child.on('exit', (code) => resolve({ code, stderr })));
  return { child, done };
}
// The script copied into <name>/deploy of a scratch tree, next to the folders in `beside`, and run with none of the WATCH_ settings that name what to watch.
function watchDefaults(name: string, beside: string[], inspect: string, extra: Record<string, string> = {}, compose: Record<string, string> = {}) {
  const root = join(dir, 'tree');
  for (const folder of [name, ...beside]) {
    mkdirSync(join(root, folder, 'deploy'), { recursive: true });
    writeFileSync(join(root, folder, 'docker-compose.yml'), compose[folder] ?? '');
  }
  const from = join(root, name, 'deploy', 'watch.sh');
  copyFileSync(script, from);
  writeFileSync(join(dir, 'inspect'), inspect);
  const env: Record<string, string | undefined> = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, WATCH_STATE_DIR: join(dir, 'state'), WATCH_NOTIFY_CMD: join(bin, 'note'), NOTES: join(dir, 'notes'), FAKE_INSPECT: join(dir, 'inspect'), ...extra };
  delete env.WATCH_URLS;
  delete env.WATCH_CONTAINERS;
  return spawnSync('bash', [from, '--once'], { encoding: 'utf8', env });
}
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const state = () => readFileSync(join(dir, 'state', 'state'), 'utf8');
const notes = () => (existsSync(join(dir, 'notes')) ? readFileSync(join(dir, 'notes'), 'utf8').trim().split('\n') : []);

describe('deploy/watch.sh', () => {
  it('says nothing while both portals answer and every container is healthy', () => {
    expect(watch().status).toBe(0);
    expect(watch().status).toBe(0);
    expect(notes()).toEqual([]);
    expect(readFileSync(join(dir, 'state', 'state'), 'utf8')).toContain('http___127_0_0_1_8082 up');
  });

  it('says a portal is down after two failed checks, once, and again when it answers', () => {
    const down = { FAKE_DOWN: ':8082' };
    watch(down);
    expect(notes()).toEqual([]); // one failed check can be a restart
    watch(down);
    watch(down);
    expect(notes()).toEqual(['The portal at http://127.0.0.1:8082 is not answering (checked twice, a minute apart).']);
    watch();
    expect(notes()).toHaveLength(2);
    expect(notes()[1]).toBe('The portal at http://127.0.0.1:8082 answers again.');
  });

  it('forgets a single failed check once the portal answers again', () => {
    watch({ FAKE_DOWN: ':8081' });
    watch();
    watch({ FAKE_DOWN: ':8081' });
    expect(notes()).toEqual([]);
  });

  it('says when Docker stops answering, and when it is back', () => {
    const down = { FAKE_DOCKER_DOWN: '1', FAKE_DOWN: '.' };
    watch();
    watch(down);
    expect(notes()).toEqual([]); // once can be Docker that is only slow, or a restart (IN-47)
    watch(down);
    expect(notes().filter((n) => n.startsWith('Docker'))).toEqual(['Docker is not answering on this machine, so the portals cannot run. Start Docker.']);
    watch(down);
    expect(notes().filter((n) => n.startsWith('Docker'))).toHaveLength(1); // once, not on every check
    watch();
    expect(notes()).toContain('Docker answers again.');
  });

  it('does not tell a Docker that was slow once, and forgets it when Docker answers again (IN-47)', () => {
    watch();
    watch({ FAKE_DOCKER_DOWN: '1' });
    expect(notes()).toEqual([]);
    expect(state()).toContain('docker.bad 1');
    expect(state()).toContain('docker up'); // still the last thing told
    watch();
    expect(state()).toContain('docker.bad 0');
    watch({ FAKE_DOCKER_DOWN: '1' }); // not "the second in a row": the check between them was fine
    expect(notes()).toEqual([]);
  });

  it('says when a container turns unhealthy or restarts in a loop, and when it is healthy again', () => {
    watch();
    writeFileSync(join(dir, 'inspect'), 'bff unhealthy 4\nweb healthy 0\n');
    watch();
    expect(notes()).toEqual(['bff restarted 4 times since the last check: it is failing in a loop.', 'bff is unhealthy.']);
    writeFileSync(join(dir, 'inspect'), 'bff healthy 4\nweb healthy 0\n');
    watch();
    expect(notes().at(-1)).toBe('bff is healthy again.');
  });

  it('reads a stopped container as stopped, not as the health it had when it stopped, and tells it on the second check (IN-45)', () => {
    watch();
    writeFileSync(join(dir, 'inspect'), 'bff healthy 0 exited\nweb healthy 0\n');
    watch();
    expect(notes()).toEqual([]); // a first sight can be a rebuild passing by
    watch();
    expect(notes()).toEqual(['bff is exited.']);
    watch();
    expect(notes()).toEqual(['bff is exited.']); // once, not on every check
    writeFileSync(join(dir, 'inspect'), 'bff healthy 0 paused\nweb healthy 0 running\n');
    watch();
    expect(notes()).toEqual(['bff is exited.', 'bff is paused.']);
    writeFileSync(join(dir, 'inspect'), 'bff healthy 0\nweb healthy 0\n');
    watch();
    expect(notes().at(-1)).toBe('bff is healthy again.');
  });

  it('tells a container that is restarting or being removed on the second check, like a stopped one (IN-47)', () => {
    watch();
    for (const [state_, told] of [['restarting', 'bff is restarting.'], ['removing', 'web is removing.']] as const) {
      const lines = state_ === 'restarting' ? `bff healthy 0 ${state_}\nweb healthy 0\n` : `bff healthy 0\nweb healthy 0 ${state_}\n`;
      writeFileSync(join(dir, 'inspect'), lines);
      watch();
      expect(notes().at(-1)).not.toBe(told); // a first sight can be a rebuild passing by
      watch();
      expect(notes().at(-1)).toBe(told);
      writeFileSync(join(dir, 'inspect'), 'bff healthy 0\nweb healthy 0\n');
      watch();
    }
  });

  it('says nothing of containers that pass through created and exited while a rebuild replaces them', () => {
    watch();
    writeFileSync(join(dir, 'inspect'), 'bff healthy 0 created\nweb healthy 0 exited\n');
    watch();
    writeFileSync(join(dir, 'inspect'), 'bff starting 0\nweb healthy 0\n');
    watch();
    writeFileSync(join(dir, 'inspect'), 'bff healthy 0\nweb healthy 0\n');
    watch();
    expect(notes()).toEqual([]);
    expect(state()).toContain('bff.bad 0');
  });

  it('gives up on a Docker that hangs, and says Docker is not answering, instead of holding the run (IN-45)', () => {
    watch();
    const started = Date.now();
    const r = watch({ FAKE_DOCKER_HANG: '1', WATCH_DOCKER_TIMEOUT: '1' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe(''); // no "Terminated" line from the call that was given up on, which would land in launchd.err
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(notes()).toEqual([]); // the first time can be Docker that is only slow (IN-47)
    expect(watch({ FAKE_DOCKER_HANG: '1', WATCH_DOCKER_TIMEOUT: '1' }).status).toBe(0);
    expect(notes()).toEqual(['Docker is not answering on this machine, so the portals cannot run. Start Docker.']);
    expect(state()).toContain('docker down');
    // The next run, with Docker back, says so, and no scratch file of the timed-out call is left behind.
    watch();
    expect(notes().at(-1)).toBe('Docker answers again.');
    expect(readdirSync(join(dir, 'state')).sort()).toEqual(['heartbeat', 'state', 'watch.log']);
  });

  it('does the same when Docker answers but reading a container hangs', () => {
    watch();
    const r = watch({ FAKE_INSPECT_HANG: '1', WATCH_DOCKER_TIMEOUT: '1' });
    expect(r.status).toBe(0);
    expect(watch({ FAKE_INSPECT_HANG: '1', WATCH_DOCKER_TIMEOUT: '1' }).status).toBe(0);
    expect(notes()).toEqual(['Docker is not answering on this machine, so the portals cannot run. Start Docker.']);
  });

  it('is not stopped by a number someone edited in the state file', () => {
    mkdirSync(join(dir, 'state'));
    writeFileSync(join(dir, 'state', 'state'), 'bff.restarts three\nhttp___127_0_0_1_8081.fails many\nweb.restarts \n');
    const r = watch({ FAKE_DOWN: ':8081' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(state()).toContain('http___127_0_0_1_8081.fails 1');
    expect(state()).toContain('bff.restarts 0');
    expect(notes()).toEqual([]);
  });

  it('says Docker is not answering once, and answers again once, when the read of a container keeps hanging (IN-45)', () => {
    watch();
    const hang = { FAKE_INSPECT_HANG: '1', WATCH_DOCKER_TIMEOUT: '1' };
    for (let i = 0; i < 3; i++) watch(hang);
    // `docker info` answers each time, and that alone must not be told as "answers again".
    expect(notes()).toEqual(['Docker is not answering on this machine, so the portals cannot run. Start Docker.']);
    expect(state()).toContain('docker down');
    // What was known about the containers is kept while Docker is away.
    expect(state()).toContain('bff healthy');
    expect(state()).toContain('web.restarts 0');
    watch();
    expect(notes()).toHaveLength(2);
    expect(notes()[1]).toBe('Docker answers again.');
  }, 30_000);

  it('reads a number with leading zeros as decimal, not octal', () => {
    mkdirSync(join(dir, 'state'));
    writeFileSync(join(dir, 'state', 'state'), 'bff.restarts 08\nhttp___127_0_0_1_8081.fails 09\n');
    const r = watch({ FAKE_DOWN: ':8081', WATCH_DOCKER_TIMEOUT: '08' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(state()).toContain('http___127_0_0_1_8081.fails 10');
    expect(notes()).toEqual(['The portal at http://127.0.0.1:8081 is not answering (checked twice, a minute apart).']);
    // 00 is no limit at all, so it is the default and not "kill every call at once".
    const zero = watch({ WATCH_DOCKER_TIMEOUT: '00' });
    expect(zero.status).toBe(0);
    expect(notes().filter((n) => n.startsWith('Docker is not answering'))).toEqual([]);
  });

  // chmod does not stop root, which is who runs these tests in a container, so there is no folder it cannot write.
  it.skipIf(isRoot)('does not call a state folder it cannot write a Docker that is not answering, and says so on stderr', () => {
    watch();
    const noRoom = join(dir, 'noroom');
    mkdirSync(noRoom);
    chmodSync(noRoom, 0o555);
    chmodSync(join(dir, 'state'), 0o555); // nothing new can be made there
    try {
      // First with a temp folder that works, then with none at all: the call is then made without a time limit.
      const cases: Record<string, string>[] = [{}, { TMPDIR: noRoom }];
      for (const env of cases) {
        rmSync(join(dir, 'notes'), { force: true });
        const r = watch(env);
        expect(notes()).toEqual([]);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('cannot write its state');
      }
    } finally {
      chmodSync(join(dir, 'state'), 0o755);
      chmodSync(noRoom, 0o755);
    }
  });

  it('keeps two runs that overlap from treading on each other: each state is whole, and nothing is left behind', async () => {
    for (let round = 0; round < 6; round++) {
      const a = startWatch();
      const b = startWatch();
      const [ra, rb] = await Promise.all([a.done, b.done]);
      expect([ra.code, rb.code, ra.stderr, rb.stderr]).toEqual([0, 0, '', '']);
    }
    for (const wanted of ['http___127_0_0_1_8081 up', 'docker up', 'bff healthy', 'web.restarts 0']) expect(state()).toContain(wanted);
    // The state and the time of the last run: no scratch file, no half-written state, no lock. The run that stopped says so in the log (IN-68).
    expect(readdirSync(join(dir, 'state')).filter((f) => f !== 'watch.log').sort()).toEqual(['heartbeat', 'state']);
  }, 30_000);

  it('stops the call in hand and leaves no scratch file when it is told to stop', async () => {
    const { child, done } = startWatch({ FAKE_DOCKER_HANG: '1', WATCH_DOCKER_TIMEOUT: '20', FAKE_HANG_SECONDS: '31.7' });
    await new Promise((resolve) => setTimeout(resolve, 1_500)); // inside the hung `docker info`
    child.kill('SIGTERM');
    const { code, stderr } = await done;
    expect(code).toBe(143);
    expect(stderr).toBe('');
    expect(readdirSync(join(dir, 'state')).filter((f) => f.startsWith('call.'))).toEqual([]);
    // No `docker` left running; the system may take a moment to let a killed process go.
    let left = true;
    for (let i = 0; i < 40 && left; i++) {
      left = spawnSync('pgrep', ['-f', 'sleep 31.7']).status === 0;
      if (left) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(left).toBe(false);
  }, 30_000);

  it('removes the new-state file it has just made when it is told to stop (IN-47)', async () => {
    const { child, done } = startWatch({ PATH: `${slowBin}:${bin}:${process.env.PATH ?? ''}` });
    const made = () => (existsSync(join(dir, 'state')) ? readdirSync(join(dir, 'state')).filter((f) => f.startsWith('state.')) : []);
    for (let i = 0; i < 100 && made().length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 50)); // the slow mktemp is waiting
    expect(made()).toHaveLength(1);
    child.kill('SIGTERM');
    const { code, stderr } = await done;
    expect(code).toBe(143);
    expect(stderr).toBe('');
    expect(made()).toEqual([]);
  }, 30_000);

  it('ends a call that ignores the TERM it is given (IN-47)', async () => {
    const pidFile = join(dir, 'docker.pid');
    const { child, done } = startWatch({ PATH: `${stubbornBin}:${bin}:${process.env.PATH ?? ''}`, FAKE_PID: pidFile, WATCH_DOCKER_TIMEOUT: '20' });
    for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    expect(pid).toBeGreaterThan(1);
    child.kill('SIGTERM');
    const { code, stderr } = await done;
    expect(code).toBe(143);
    expect(stderr).toBe('');
    let alive = true;
    for (let i = 0; i < 40 && alive; i++) {
      try {
        process.kill(pid, 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);
  }, 30_000);

  it('says when a container is gone', () => {
    watch();
    writeFileSync(join(dir, 'inspect'), 'bff healthy 0\n');
    watch();
    expect(notes()).toEqual(['web is missing.']);
  });

  it('keeps a log of what it said, and answers --status and an unknown option without changing anything', () => {
    watch({ FAKE_DOWN: ':8081' });
    watch({ FAKE_DOWN: ':8081' });
    const status = watch({}, '--status');
    expect(status.stdout).toContain('http___127_0_0_1_8081 down');
    expect(status.stdout).toContain('notify: The portal at http://127.0.0.1:8081 is not answering');
    const usage = watch({}, '--what');
    expect(usage.status).toBe(2);
    expect(usage.stdout).toContain('deploy/watch.sh --once');
  });

  it('watches only the copy it sits in when it is alone, so a VM with one copy is not told the other is missing', () => {
    const own = 'hcml-portal-ollama-portal-bff-1 healthy 0\nhcml-portal-ollama-portal-web-1 healthy 0\n';
    for (let i = 0; i < 3; i++) expect(watchDefaults('hcml-portal-ollama', [], own, { FAKE_DOWN: ':8081' }).status).toBe(0);
    expect(notes()).toEqual([]);
    expect(state()).toContain('http___127_0_0_1_8082 up');
    expect(state()).toContain('hcml-portal-ollama-portal-web-1 healthy');
    expect(state()).not.toMatch(/8081|hcml-portal-portal-/);
  });

  it('watches both copies when they sit side by side, and a folder with another name gets the Mac layout', () => {
    const four = 'hcml-portal-portal-bff-1 healthy 0\nhcml-portal-portal-web-1 healthy 0\nhcml-portal-ollama-portal-bff-1 healthy 0\nhcml-portal-ollama-portal-web-1 healthy 0\n';
    watchDefaults('hcml-portal', ['hcml-portal-ollama'], four);
    for (const wanted of ['8081 up', '8082 up', 'hcml-portal-portal-bff-1 healthy', 'hcml-portal-ollama-portal-web-1 healthy']) expect(state()).toContain(wanted);
    rmSync(join(dir, 'state'), { recursive: true, force: true });
    rmSync(join(dir, 'tree'), { recursive: true, force: true });
    watchDefaults('portal-copy', [], four);
    for (const wanted of ['8081 up', '8082 up', 'hcml-portal-portal-bff-1 healthy', 'hcml-portal-ollama-portal-web-1 healthy']) expect(state()).toContain(wanted);
    expect(notes()).toEqual([]);
  });
});

describe('deploy/watch.sh when a notification is not delivered (IN-53)', () => {
  const attempts = () => (existsSync(join(dir, 'attempts')) ? readFileSync(join(dir, 'attempts'), 'utf8').trim().split('\n') : []);
  const broken = { WATCH_NOTIFY_CMD: join(bin, 'note-down'), ATTEMPTS: join(dir, 'attempts') };
  const down = { FAKE_DOWN: ':8082' };
  // beforeEach gives each test a new dir, so the settings that name it are made per test.
  const withDir = (env: Record<string, string> = {}) => ({ ...broken, ATTEMPTS: join(dir, 'attempts'), ...env });

  it('tries again at the next check when the command that tells people fails, until it gets through, and then once', () => {
    watch(withDir(down)); // one failed check can be a restart
    for (let i = 0; i < 3; i++) watch(withDir(down));
    // The second failed check and the two after it each tried, and each failed.
    expect(attempts()).toEqual(Array(3).fill('The portal at http://127.0.0.1:8082 is not answering (checked twice, a minute apart).'));
    expect(state()).toContain('http___127_0_0_1_8082 up');

    watch(down); // the command works again
    expect(notes()).toEqual(['The portal at http://127.0.0.1:8082 is not answering (checked twice, a minute apart).']);
    expect(state()).toContain('http___127_0_0_1_8082 down');
    watch(down);
    watch(down);
    expect(notes()).toHaveLength(1);
  });

  it('says in the log that a notification did not get through and that it will try again', () => {
    watch(withDir(down));
    watch(withDir(down));
    const log = readFileSync(join(dir, 'state', 'watch.log'), 'utf8');
    expect(log).toContain('notify: The portal at http://127.0.0.1:8082 is not answering');
    expect(log).toMatch(/notify failed \(exit 1\), will try again at the next check/);
  });

  it('keeps "down" until the news that the portal answers again has been delivered', () => {
    watch(down);
    watch(down); // delivered: the portal is down
    expect(notes()).toHaveLength(1);
    watch(withDir()); // answers again, but the command is down
    watch(withDir());
    expect(attempts()).toEqual(Array(2).fill('The portal at http://127.0.0.1:8082 answers again.'));
    expect(state()).toContain('http___127_0_0_1_8082 down');
    watch(); // delivered
    expect(notes()[1]).toBe('The portal at http://127.0.0.1:8082 answers again.');
    expect(state()).toContain('http___127_0_0_1_8082 up');
    watch();
    expect(notes()).toHaveLength(2);
  });

  it('does the same for Docker', () => {
    const gone = { FAKE_DOCKER_DOWN: '1' };
    watch(withDir(gone));
    watch(withDir(gone));
    watch(withDir(gone));
    expect(attempts()).toEqual(Array(2).fill('Docker is not answering on this machine, so the portals cannot run. Start Docker.'));
    expect(state()).toMatch(/^docker up$/m);
    watch(gone);
    expect(state()).toMatch(/^docker down$/m);
    expect(notes()).toHaveLength(1);
  });

  it('does the same for a container that turns unhealthy', () => {
    writeFileSync(join(dir, 'inspect'), 'bff unhealthy 0\nweb healthy 0\n');
    watch(withDir());
    watch(withDir());
    expect(attempts()).toEqual(Array(2).fill('bff is unhealthy.'));
    expect(state()).toMatch(/^bff healthy$/m);
    watch();
    expect(notes()).toEqual(['bff is unhealthy.']);
    expect(state()).toMatch(/^bff unhealthy$/m);
  });

  it('does the same for a container that restarts in a loop: the count it had stays until the news is out', () => {
    watch(withDir());
    writeFileSync(join(dir, 'inspect'), 'bff healthy 5\nweb healthy 0\n');
    watch(withDir());
    watch(withDir());
    expect(attempts()).toEqual(Array(2).fill('bff restarted 5 times since the last check: it is failing in a loop.'));
    watch();
    expect(notes()).toEqual(['bff restarted 5 times since the last check: it is failing in a loop.']);
    watch();
    expect(notes()).toHaveLength(1);
  });

  it('leaves the state as it was for a command that is down, so a run that tells nothing new changes nothing', () => {
    watch(withDir());
    const before = state();
    watch(withDir());
    expect(state()).toBe(before);
  });
});

describe('deploy/watch.sh and its own heartbeat (IN-53)', () => {
  const beat = () => join(dir, 'state', 'heartbeat');

  it('writes the time of every run, so something outside can see that the watcher is still running', () => {
    const before = Math.floor(Date.now() / 1000);
    watch();
    const written = Number(readFileSync(beat(), 'utf8').trim());
    expect(written).toBeGreaterThanOrEqual(before);
    expect(written).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });

  it('writes it when a notification fails too, since a watcher that cannot tell anyone is still running', () => {
    watch({ WATCH_NOTIFY_CMD: join(bin, 'note-down'), ATTEMPTS: join(dir, 'attempts'), FAKE_DOWN: ':8082' });
    watch({ WATCH_NOTIFY_CMD: join(bin, 'note-down'), ATTEMPTS: join(dir, 'attempts'), FAKE_DOWN: ':8082' });
    expect(existsSync(beat())).toBe(true);
  });

  it('says in --status when it last ran, and exits 0', () => {
    watch();
    const status = watch({}, '--status');
    expect(status.status).toBe(0);
    expect(status.stdout).toMatch(/Last run: \d+ s ago/);
    expect(status.stdout).not.toContain('STALE');
  });

  it('says STALE in --status and exits 1 when the last run is more than five minutes old, which a check from outside can use', () => {
    watch();
    writeFileSync(beat(), `${Math.floor(Date.now() / 1000) - 600}\n`);
    const status = watch({}, '--status');
    expect(status.status).toBe(1);
    expect(status.stdout).toMatch(/STALE: the watcher last ran 6\d\d s ago/);
  });

  it('says it has never run before the first run, and exits 1', () => {
    const status = watch({}, '--status');
    expect(status.status).toBe(1);
    expect(status.stdout).toContain('Last run: never');
  });
});

describe('deploy/watch.sh and the names of the project (IN-51)', () => {
  const four = 'hcml-portal-portal-bff-1 healthy 0\nhcml-portal-portal-web-1 healthy 0\nhcml-portal-ollama-portal-bff-1 healthy 0\nhcml-portal-ollama-portal-web-1 healthy 0\n';

  it('watches the project a clone runs as, whatever its folder is called, and not the other copy that is not there', () => {
    const own = 'hcml-portal-portal-bff-1 healthy 0\nhcml-portal-portal-web-1 healthy 0\n';
    for (let i = 0; i < 3; i++) {
      const r = watchDefaults('Dashboard-Zabbix-Prototype', [], own, { FAKE_DOWN: ':8082' }, { 'Dashboard-Zabbix-Prototype': 'name: hcml-portal\nservices: {}\n' });
      expect(r.status).toBe(0);
    }
    expect(notes()).toEqual([]);
    expect(state()).toContain('http___127_0_0_1_8081 up');
    expect(state()).toContain('hcml-portal-portal-web-1 healthy');
    expect(state()).not.toMatch(/8082|ollama/);
  });

  it('watches both when the clone has the local-model copy beside it', () => {
    watchDefaults('Dashboard-Zabbix-Prototype', ['hcml-portal-ollama'], four, {}, { 'Dashboard-Zabbix-Prototype': 'name: hcml-portal\nservices: {}\n' });
    for (const wanted of ['8081 up', '8082 up', 'hcml-portal-portal-bff-1 healthy', 'hcml-portal-ollama-portal-web-1 healthy']) expect(state()).toContain(wanted);
  });
});

describe('deploy/watch.sh and a notify command that stalls (IN-68)', () => {
  const unhealthy = () => writeFileSync(join(dir, 'inspect'), 'bff unhealthy 0\nweb healthy 0\n');
  const attempts = () => (existsSync(join(dir, 'attempts')) ? readFileSync(join(dir, 'attempts'), 'utf8').trim().split('\n') : []);

  it('gives up on it after the time limit, writes the heartbeat, and does not record the news as told', () => {
    unhealthy();
    const started = Date.now();
    const r = watch({ WATCH_NOTIFY_CMD: join(bin, 'note-slow'), ATTEMPTS: join(dir, 'attempts'), WATCH_DOCKER_TIMEOUT: '1', FAKE_NOTIFY_SECONDS: '20' });
    expect(r.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(8_000);
    expect(attempts()).toEqual(['bff is unhealthy.']);
    expect(readFileSync(join(dir, 'state', 'watch.log'), 'utf8')).toMatch(/notify failed \(exit 124\), will try again at the next check/);
    expect(state()).toContain('bff healthy');
    expect(existsSync(join(dir, 'state', 'heartbeat'))).toBe(true);
  });

  it('leaves no stalled command running when the run ends', async () => {
    unhealthy();
    const marker = `watch-stall-${process.pid}-${n}`;
    watch({ WATCH_NOTIFY_CMD: `${join(bin, 'note-slow')} ${marker}`, ATTEMPTS: join(dir, 'attempts'), WATCH_DOCKER_TIMEOUT: '1', FAKE_NOTIFY_SECONDS: '25' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const left = spawnSync('pgrep', ['-f', `note-slow ${marker}`], { encoding: 'utf8' });
    expect(left.stdout.trim()).toBe('');
  });

  it('limits the desktop notification the same way, when no command is set', () => {
    unhealthy();
    const started = Date.now();
    const r = watch({ WATCH_NOTIFY_CMD: '', ATTEMPTS: join(dir, 'attempts'), WATCH_DOCKER_TIMEOUT: '1', FAKE_NOTIFY_SECONDS: '20' });
    expect(r.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(8_000);
    expect(attempts()).toHaveLength(1);
    expect(readFileSync(join(dir, 'state', 'watch.log'), 'utf8')).toMatch(/notify failed \(exit 124\)/);
  });

  it('passes the message as one argument, whatever it holds', () => {
    unhealthy();
    watch({ WATCH_NOTIFY_CMD: join(bin, 'note-args'), ARGC: join(dir, 'argc'), ARGV: join(dir, 'argv') });
    expect(readFileSync(join(dir, 'argc'), 'utf8').trim()).toBe('1');
    expect(readFileSync(join(dir, 'argv'), 'utf8').trim()).toBe('[bff is unhealthy.]');
  });

  it('reads a command with arguments and quotes as a command line, and still gives the message last and whole', () => {
    unhealthy();
    watch({ WATCH_NOTIFY_CMD: `${join(bin, 'note-args')} first 'second word'`, ARGC: join(dir, 'argc'), ARGV: join(dir, 'argv') });
    expect(readFileSync(join(dir, 'argc'), 'utf8').trim()).toBe('3');
    expect(readFileSync(join(dir, 'argv'), 'utf8').trim().split('\n')).toEqual(['[first]', '[second word]', '[bff is unhealthy.]']);
  });

  it('does not let a star in the command expand to the files of the folder it runs in', () => {
    unhealthy();
    writeFileSync(join(dir, 'a-file'), '');
    const r = spawnSync('bash', [script, '--once'], { encoding: 'utf8', cwd: dir, timeout: 25_000, env: runEnv({ WATCH_NOTIFY_CMD: `${join(bin, 'note-args')} '*'`, ARGC: join(dir, 'argc'), ARGV: join(dir, 'argv') }) });
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'argv'), 'utf8').trim().split('\n')).toEqual(['[*]', '[bff is unhealthy.]']);
  });
});

describe('deploy/watch.sh and a notify command that starts children of its own (IN-73)', () => {
  const unhealthy = () => writeFileSync(join(dir, 'inspect'), 'bff unhealthy 0\nweb healthy 0\n');
  // A wrapper around a mailer: it runs the mailer as a child, and has more to do after it, so bash cannot hand its own place to it.
  writeFileSync(join(bin, 'note-wrapped'), `#!/usr/bin/env bash\necho started > "$FAKE_WRAP_MARK"\nsleep "$FAKE_WRAP_SECONDS"\nexit 1\n`);
  chmodSync(join(bin, 'note-wrapped'), 0o755);
  /** A sleep length no other process has: found by its command line, and ended in `finally` so that a failing test leaves nothing behind. */
  const unique = () => `${7000 + (process.pid % 1000)}.${n}`;
  const running = (length: string) => spawnSync('pgrep', ['-f', `sleep ${length}`]).status === 0;
  const gone = async (length: string) => {
    for (let i = 0; i < 40 && running(length); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    return !running(length);
  };

  it('ends what a command line started, not only the shell it ran in, when the time is up', async () => {
    unhealthy();
    const length = unique();
    try {
      const r = watch({ WATCH_NOTIFY_CMD: `sleep ${length}; true`, WATCH_DOCKER_TIMEOUT: '1' });
      expect(r.status).toBe(0);
      expect(readFileSync(join(dir, 'state', 'watch.log'), 'utf8')).toMatch(/notify failed \(exit 124\)/);
      expect(await gone(length)).toBe(true);
    } finally {
      spawnSync('pkill', ['-f', `sleep ${length}`]);
    }
  }, 30_000);

  it('ends what a wrapper script started, the pattern of a cron line that mails the message', async () => {
    unhealthy();
    const length = unique();
    try {
      const mark = join(dir, 'wrapper-started');
      const r = watch({ WATCH_NOTIFY_CMD: join(bin, 'note-wrapped'), FAKE_WRAP_SECONDS: length, FAKE_WRAP_MARK: mark, WATCH_DOCKER_TIMEOUT: '1' });
      expect(r.status).toBe(0);
      // The wrapper ran, so a sleep that is gone was ended and not never started.
      expect(existsSync(mark)).toBe(true);
      expect(await gone(length)).toBe(true);
    } finally {
      spawnSync('pkill', ['-f', `sleep ${length}`]);
    }
  }, 30_000);

  it('ends them too when the script is told to stop in the middle of the command', async () => {
    unhealthy();
    const length = unique();
    try {
      const { child, done } = startWatch({ WATCH_NOTIFY_CMD: `sleep ${length}; true`, WATCH_DOCKER_TIMEOUT: '20' });
      for (let i = 0; i < 100 && !running(length); i++) await new Promise((resolve) => setTimeout(resolve, 50));
      expect(running(length)).toBe(true);
      child.kill('SIGTERM');
      const { code, stderr } = await done;
      expect(code).toBe(143);
      expect(stderr).toBe('');
      expect(await gone(length)).toBe(true);
    } finally {
      spawnSync('pkill', ['-f', `sleep ${length}`]);
    }
  }, 30_000);

  it('still gives the message as the last argument, whole, to a command that starts a child and finishes in time', () => {
    unhealthy();
    const r = watch({ WATCH_NOTIFY_CMD: `sleep 0.1; ${join(bin, 'note')}`, WATCH_DOCKER_TIMEOUT: '5' });
    expect(r.status).toBe(0);
    expect(notes()).toEqual(['bff is unhealthy.']);
  });
});

describe('deploy/watch.sh and a run that is still under way (IN-68)', () => {
  const lock = () => join(dir, 'state', 'lock');
  const attempts = () => (existsSync(join(dir, 'attempts')) ? readFileSync(join(dir, 'attempts'), 'utf8').trim().split('\n') : []);

  it('stops at once when another run holds the lock, and says so in the log, so a timer cannot pile runs up', async () => {
    writeFileSync(join(dir, 'inspect'), 'bff unhealthy 0\nweb healthy 0\n');
    const first = startWatch({ WATCH_NOTIFY_CMD: join(bin, 'note-slow'), ATTEMPTS: join(dir, 'attempts'), WATCH_DOCKER_TIMEOUT: '4', FAKE_NOTIFY_SECONDS: '20' });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(existsSync(lock())).toBe(true);
    const started = Date.now();
    const second = watch({ WATCH_NOTIFY_CMD: join(bin, 'note-slow'), ATTEMPTS: join(dir, 'attempts'), WATCH_DOCKER_TIMEOUT: '4', FAKE_NOTIFY_SECONDS: '20' });
    expect(second.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(readFileSync(join(dir, 'state', 'watch.log'), 'utf8')).toContain('another run is under way, so this one stops');
    await first.done;
    // One outage, one alert: the second run did not call the stalled command again.
    expect(attempts()).toEqual(['bff is unhealthy.']);
  }, 30_000);

  it('does not alert three times for one outage when three runs start a moment apart', async () => {
    writeFileSync(join(dir, 'state-seed'), '');
    mkdirSync(join(dir, 'state'), { recursive: true });
    // The portal at 8081 has failed once already: the next failed check is the second, and tells it.
    writeFileSync(join(dir, 'state', 'state'), 'http___127_0_0_1_8081 up\nhttp___127_0_0_1_8081.fails 1\n');
    const env = { FAKE_DOWN: ':8081', WATCH_URLS: 'http://127.0.0.1:8081', WATCH_CONTAINERS: '', WATCH_NOTIFY_CMD: join(bin, 'note-slow'), ATTEMPTS: join(dir, 'attempts'), WATCH_DOCKER_TIMEOUT: '4', FAKE_NOTIFY_SECONDS: '15' };
    const runs = [startWatch(env)];
    for (let i = 0; i < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      runs.push(startWatch(env));
    }
    await Promise.all(runs.map((r) => r.done));
    expect(attempts()).toEqual(['The portal at http://127.0.0.1:8081 is not answering (checked twice, a minute apart).']);
  }, 30_000);

  it('removes the lock when the run ends, and when it is told to stop', async () => {
    expect(watch().status).toBe(0);
    expect(existsSync(lock())).toBe(false);
    writeFileSync(join(dir, 'inspect'), 'bff healthy 0\nweb healthy 0\n');
    const run = startWatch({ FAKE_DOCKER_HANG: '1', FAKE_HANG_SECONDS: '20', WATCH_DOCKER_TIMEOUT: '10' });
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(existsSync(lock())).toBe(true);
    run.child.kill('SIGTERM');
    await run.done;
    expect(existsSync(lock())).toBe(false);
  }, 30_000);

  it('takes over a lock whose run is dead, instead of waiting for it for ever', () => {
    mkdirSync(lock(), { recursive: true });
    const dead = spawnSync('bash', ['-c', 'echo $$'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(join(lock(), 'pid'), `${dead}\n`);
    writeFileSync(join(dir, 'inspect'), 'bff unhealthy 0\nweb healthy 0\n');
    const r = watch();
    expect(r.status).toBe(0);
    expect(notes()).toEqual(['bff is unhealthy.']);
    expect(existsSync(lock())).toBe(false);
  });

  it('takes over a lock older than fifteen minutes although its number belongs to a live process, which reuse of a number can cause (reviewer, 11 November)', () => {
    mkdirSync(lock(), { recursive: true });
    writeFileSync(join(lock(), 'pid'), `${process.pid}\n`);
    const old = new Date(Date.now() - 20 * 60 * 1000);
    utimesSync(lock(), old, old);
    writeFileSync(join(dir, 'inspect'), 'bff unhealthy 0\nweb healthy 0\n');
    const r = watch();
    expect(r.status).toBe(0);
    expect(notes()).toEqual(['bff is unhealthy.']);
    expect(existsSync(lock())).toBe(false);
  });

  it('leaves a lock alone while its number belongs to a live process and it is younger than fifteen minutes', () => {
    mkdirSync(lock(), { recursive: true });
    writeFileSync(join(lock(), 'pid'), `${process.pid}\n`);
    writeFileSync(join(dir, 'inspect'), 'bff unhealthy 0\nweb healthy 0\n');
    watch();
    expect(notes()).toEqual([]);
    expect(existsSync(lock())).toBe(true);
  });

  it('takes over a lock that names no run at all, which an interrupted start leaves', () => {
    mkdirSync(lock(), { recursive: true });
    expect(watch().status).toBe(0);
    expect(existsSync(join(dir, 'state', 'heartbeat'))).toBe(true);
    expect(existsSync(lock())).toBe(false);
  });

  it('does not lock --status, which only reads', () => {
    mkdirSync(lock(), { recursive: true });
    writeFileSync(join(lock(), 'pid'), `${process.pid}\n`);
    const r = watch({}, '--status');
    expect(r.stdout).toContain('Last run: never');
    expect(readFileSync(join(lock(), 'pid'), 'utf8').trim()).toBe(String(process.pid));
  });
});

describe('deploy/watch.sh and where Docker lives on a Mac (IN-68)', () => {
  it('finds docker in ~/.docker/bin when the path it is started with does not hold it', () => {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.docker', 'bin'), { recursive: true });
    copyFileSync(join(bin, 'docker'), join(home, '.docker', 'bin', 'docker'));
    chmodSync(join(home, '.docker', 'bin', 'docker'), 0o755);
    const lean = join(dir, 'lean');
    mkdirSync(lean);
    for (const f of ['curl', 'note']) copyFileSync(join(bin, f), join(lean, f));
    for (const f of ['curl', 'note']) chmodSync(join(lean, f), 0o755);
    const run = () => spawnSync('/bin/bash', [script, '--once'], { encoding: 'utf8', timeout: 25_000, env: { ...runEnv({ HOME: home }), PATH: `${lean}:/usr/bin:/bin` } });
    expect(run().status).toBe(0);
    expect(run().status).toBe(0);
    // Docker answered both times: it was found, and nothing says it is not answering.
    expect(notes()).toEqual([]);
    expect(state()).toContain('bff healthy');
  });

  it('puts ~/.docker/bin in the path of the LaunchAgent it installs', () => {
    expect(readFileSync(script, 'utf8')).toMatch(/<key>PATH<\/key><string>[^<]*\$HOME\/\.docker\/bin[^<]*<\/string>/);
  });
});

describe('deploy/watch.sh and a portal that cannot read Zabbix (IN-47)', () => {
  const portal = 'The portal at http://127.0.0.1:8081';

  it('tells it on the second check in a row, once, and says when Zabbix can be read again', () => {
    const env = { FAKE_NOT_READY: ':8081' };
    expect(watch(env).status).toBe(0);
    expect(notes()).toEqual([]);
    expect(watch(env).status).toBe(0);
    expect(notes()).toEqual([`${portal} is up but cannot read Zabbix (checked twice, a minute apart).`]);
    expect(watch(env).status).toBe(0);
    expect(notes()).toHaveLength(1);
    expect(watch({ FAKE_READY: '1' }).status).toBe(0);
    expect(notes()).toEqual([`${portal} is up but cannot read Zabbix (checked twice, a minute apart).`, `${portal} can read Zabbix again.`]);
    expect(watch({ FAKE_READY: '1' }).status).toBe(0);
    expect(notes()).toHaveLength(2);
  });

  it('forgets a single check that said it could not, once it can', () => {
    expect(watch({ FAKE_NOT_READY: ':8081' }).status).toBe(0);
    expect(watch({ FAKE_READY: '1' }).status).toBe(0);
    expect(watch({ FAKE_NOT_READY: ':8081' }).status).toBe(0);
    expect(notes()).toEqual([]);
  });

  it('says nothing of Zabbix for a portal that does not say, such as one built before the field', () => {
    for (let i = 0; i < 4; i++) expect(watch().status).toBe(0);
    expect(notes()).toEqual([]);
  });

  it('leaves the news that the portal is down to the check of the portal, and says nothing of Zabbix then', () => {
    for (let i = 0; i < 2; i++) expect(watch({ FAKE_DOWN: ':8081' }).status).toBe(0);
    expect(notes()).toEqual([`${portal} is not answering (checked twice, a minute apart).`]);
  });

  it('keeps the two portals apart', () => {
    for (let i = 0; i < 2; i++) expect(watch({ FAKE_NOT_READY: ':8082' }).status).toBe(0);
    expect(notes()).toEqual(['The portal at http://127.0.0.1:8082 is up but cannot read Zabbix (checked twice, a minute apart).']);
  });

  it('does not say it again after a notification that did not get through, but at the next check, until it does', () => {
    const env = { FAKE_NOT_READY: ':8081', WATCH_NOTIFY_CMD: join(bin, 'note-down'), ATTEMPTS: join(dir, 'attempts') };
    for (let i = 0; i < 3; i++) expect(watch(env).status).toBe(0);
    expect(readFileSync(join(dir, 'attempts'), 'utf8').trim().split('\n')).toHaveLength(2);
    expect(watch({ FAKE_NOT_READY: ':8081' }).status).toBe(0);
    expect(notes()).toEqual([`${portal} is up but cannot read Zabbix (checked twice, a minute apart).`]);
  });
});

