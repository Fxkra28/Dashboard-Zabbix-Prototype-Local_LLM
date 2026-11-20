import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * deploy/gpu-gate.sh reads the machine it runs on. Here it runs on made-up machines: a folder of stand-ins for uname, lscpu, free, df, docker, nvidia-smi and curl is all it can reach,
 * so each case is a machine, and the verdict it gives for it is the thing under test.
 */

const run = promisify(execFile);
const script = fileURLToPath(new URL('../../../deploy/gpu-gate.sh', import.meta.url));
const which = (name: string) => {
  try {
    return execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const bash = which('bash');
const tools = ['awk', 'sed', 'grep', 'head', 'tr', 'cut'].map((t) => [t, which(t)] as const);
const canRun = Boolean(bash) && tools.every(([, path]) => path);

interface Machine {
  kernel?: string;
  arch?: string;
  /** The `Flags:` line of lscpu; `null` leaves lscpu out. */
  flags?: string | null;
  memMib?: number | null;
  diskGib?: number | null;
  docker?: boolean;
  compose?: boolean;
  nvidiaRuntime?: boolean;
  /** `name, MiB, driver` as nvidia-smi prints it; `null` leaves nvidia-smi out. */
  card?: string | null;
  registry?: string | null;
  /** The folder of the copy holds docker-compose.override.yml, which is not in git and is made by hand where HCML's Zabbix needs it. */
  override?: boolean;
}

const GOOD: Required<Machine> = {
  kernel: 'Linux',
  arch: 'x86_64',
  flags: 'fpu sse4_2 avx avx2 avx512f',
  memMib: 32000,
  diskGib: 120,
  docker: true,
  compose: true,
  nvidiaRuntime: true,
  card: 'NVIDIA L4, 23034, 550.54.15',
  registry: '200',
  override: true,
};

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function gate(over: Machine = {}) {
  const m = { ...GOOD, ...over };
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  made.push(dir);
  const stub = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!${bash}\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  for (const [name, path] of tools) symlinkSync(path, join(dir, name));
  stub('uname', `case "$1" in -s) echo ${m.kernel};; -m) echo ${m.arch};; esac`);
  if (m.flags !== null) stub('lscpu', `printf 'Architecture: ${m.arch}\\nCPU(s): 16\\nModel name: Intel(R) Xeon(R) Gold 6338\\nFlags: ${m.flags}\\n'`);
  if (m.memMib !== null) stub('free', `printf '              total        used        free\\nMem:          ${m.memMib}        1000       30000\\nSwap:             0           0           0\\n'`);
  if (m.diskGib !== null) stub('df', `printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\n/dev/vda1 999999999 1 ${m.diskGib * 1048576} 1%% /\\n'`);
  if (m.docker) {
    stub(
      'docker',
      `case "$*" in
  --version) echo 'Docker version 27.3.1, build ce12230';;
  "compose version --short") ${m.compose ? "echo 2.29.1" : 'exit 1'};;
  "info --format {{.DockerRootDir}}") echo ${dir};;
  "info --format {{json .Runtimes}}") echo '${m.nvidiaRuntime ? '{"nvidia":{},"runc":{}}' : '{"runc":{}}'}';;
  *) exit 1;;
esac`,
    );
  }
  if (m.card !== null) stub('nvidia-smi', `echo '${m.card}'`);
  if (m.registry !== null) stub('curl', `printf '%s' '${m.registry}'`);
  // The folder of the copy, where the gate looks for the files of the line it prints.
  const copy = join(dir, 'copy');
  mkdirSync(copy);
  if (m.override) writeFileSync(join(copy, 'docker-compose.override.yml'), 'services: {}\n');
  try {
    const { stdout } = await run(bash, [script], { env: { PATH: dir, GATE_ROOT: copy }, timeout: 30_000 });
    return { code: 0, out: stdout };
  } catch (err) {
    const e = err as { code?: number; stdout?: string };
    return { code: e.code ?? -1, out: e.stdout ?? '' };
  }
}

// Each run starts a dozen processes, and some of the cases run several machines.
describe.skipIf(!canRun)('deploy/gpu-gate.sh', { timeout: 60_000 }, () => {
  it('says GO with the card for a server that has everything, and names the files to start it with', async () => {
    const { code, out } = await gate();
    expect(code, out).toBe(0);
    expect(out).toContain('OK    system     Linux x86_64');
    expect(out).toContain('OK    processor  Intel(R) Xeon(R) Gold 6338, 16 CPUs, AVX2');
    expect(out).toContain('OK    memory     31 GiB');
    expect(out).toContain('OK    docker     27.3.1, compose 2.29.1');
    expect(out).toContain('OK    disk       120 GiB free under');
    expect(out).toContain('OK    card       NVIDIA L4, 23034 MiB, driver 550.54.15: room for the 8B, 9B and 12B models');
    expect(out).toContain('OK    runtime    Docker has the NVIDIA runtime');
    expect(out).toContain('OK    registry');
    expect(out).toContain('verdict: GO with the card.');
    // One line in the .env gives every command the same files (IN-100), the Zabbix override of docker-compose.override.yml among them.
    expect(out).toContain('COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:docker-compose.vm.yml:docker-compose.vm-gpu.yml');
    expect(out).toContain('then start the stack from its folder with: docker compose up -d');
    expect(out).not.toMatch(/FAIL|WARN/);
  });

  // IN-100: the line names the Zabbix override only where the file is there. It is not in git and no step makes it: a line that names a file that does not exist stops every Compose command.
  it('names docker-compose.override.yml in the line only when the copy has it, and says what to do when it has not', async () => {
    const [without, withCard] = await Promise.all([gate({ override: false, card: null }), gate({ override: false })]);
    expect(without.out).toContain('COMPOSE_FILE=docker-compose.yml:docker-compose.vm.yml\n');
    expect(without.out).not.toMatch(/COMPOSE_FILE=[^\n]*override/);
    expect(without.out).toContain('There is no docker-compose.override.yml here');
    expect(withCard.out).toContain('COMPOSE_FILE=docker-compose.yml:docker-compose.vm.yml:docker-compose.vm-gpu.yml');
    const [kept] = await Promise.all([gate({ override: true, card: null })]);
    expect(kept.out).toContain('COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:docker-compose.vm.yml\n');
    expect(kept.out).not.toContain('There is no docker-compose.override.yml here');
  });

  it('sizes the card: a warning at 12 GB, where the 8B and 9B models fit and the 12B does not, and too little under 10 GB', async () => {
    const [t4, small] = await Promise.all([gate({ card: 'NVIDIA T4, 12288, 535.1' }), gate({ card: 'NVIDIA GTX, 6144, 535.1' })]);
    expect(t4.code).toBe(0);
    expect(t4.out).toContain('WARN  card');
    expect(t4.out).toContain('room for the 8B and 9B models, not the 12B');
    expect(small.code).toBe(1);
    expect(small.out).toContain('FAIL  card');
    expect(small.out).toContain('verdict: NO-GO');
  });

  it('turns a card away when Docker cannot hand it to a container, and says how to mend that', async () => {
    const { code, out } = await gate({ nvidiaRuntime: false });
    expect(code).toBe(1);
    expect(out).toContain('FAIL  runtime');
    expect(out).toContain('nvidia-ctk runtime configure --runtime=docker');
  });

  it('on a machine without a card, goes on to the processor and leaves the decision to the speed test', async () => {
    const { code, out } = await gate({ card: null });
    expect(code, out).toBe(0);
    expect(out).toContain('NOTE  card');
    expect(out).toContain('verdict: PROCESSOR ONLY.');
    expect(out).toContain('COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:docker-compose.vm.yml\n');
    expect(out).not.toContain('vm-gpu.yml');
    expect(out).toContain('The Assistant stays off unless that says PASS');
  });

  it('warns about a processor without AVX2, and says so at the end only when there is no card to make up for it', async () => {
    const [without, withCard] = await Promise.all([gate({ flags: 'fpu sse4_2 avx', card: null }), gate({ flags: 'fpu sse4_2 avx' })]);
    expect(without.code).toBe(0);
    expect(without.out).toContain('WARN  processor');
    expect(without.out).toContain('This processor has no AVX2, so expect FAIL: the model needs a card.');
    expect(withCard.out).toContain('WARN  processor');
    expect(withCard.out).not.toContain('expect FAIL');
  });

  it('warns on memory below 32 GB and fails below 16 GB; warns on a disk below 100 GB and fails below 60 GB', async () => {
    const [some, low, tight, full] = await Promise.all([gate({ memMib: 20000 }), gate({ memMib: 12000 }), gate({ diskGib: 70 }), gate({ diskGib: 30 })]);
    expect(some.out).toContain('WARN  memory     19 GiB');
    expect(some.code).toBe(0);
    expect(low.code).toBe(1);
    expect(low.out).toContain('FAIL  memory');
    expect(tight.out).toContain('WARN  disk       70 GiB free');
    expect(full.code).toBe(1);
    expect(full.out).toContain('FAIL  disk');
  });

  it('fails a machine that is not Linux, one with no Docker, and one with Docker but no compose', async () => {
    const [mac, none, plain] = await Promise.all([gate({ kernel: 'Darwin', arch: 'arm64' }), gate({ docker: false }), gate({ compose: false })]);
    expect(mac.out).toContain('FAIL  system     Darwin arm64');
    expect(none.code).toBe(1);
    expect(none.out).toContain('FAIL  docker     docker is not installed');
    expect(plain.code).toBe(1);
    expect(plain.out).toContain('but not the compose plugin');
  });

  it('only warns when the registry cannot be reached, and says what was answered', async () => {
    const [blocked, silent, none] = await Promise.all([gate({ registry: '403' }), gate({ registry: '000' }), gate({ registry: null })]);
    expect(blocked.code).toBe(0);
    expect(blocked.out).toContain('WARN  registry   registry.ollama.ai gave HTTP 403');
    expect(silent.out).toContain('gave no answer');
    expect(none.out).toContain('curl is not here');
  });

  it('reads what it cannot read as a warning, not as a pass: no lscpu, no free', async () => {
    const { code, out } = await gate({ flags: null, memMib: null });
    expect(code).toBe(0);
    expect(out).toContain('lscpu is not here');
    expect(out).toContain('free is not here');
  });
});
