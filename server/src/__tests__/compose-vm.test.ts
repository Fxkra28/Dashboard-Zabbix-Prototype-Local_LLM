import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { isLocalBaseUrl } from '../core/localHost.js';

/**
 * The overlays that put the local model on the machine that hosts the portal (docker-compose.vm.yml, docker-compose.vm-gpu.yml). Nothing of them has run on a machine yet, so what is
 * held here is what can be held without one: what they say, that the portal's own file is left as it was, and that Compose itself merges the three without complaint.
 */

const root = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
/** The file without its comments, line by line. */
const code = (rel: string) => readFileSync(root(rel), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l));
const vm = code('docker-compose.vm.yml').join('\n');
const gpu = code('docker-compose.vm-gpu.yml').join('\n');

describe('docker-compose.vm.yml', () => {
  it('adds Ollama as a service of the project and publishes its port on the machine\'s loopback and nowhere else (IN-101)', () => {
    expect(vm).toMatch(/^ {2}ollama:\s*$/m);
    expect(vm).toMatch(/expose:\s*\n\s*- "11434"/);
    // deploy/model-speed.py asks http://127.0.0.1:11434 by default, on the machine itself: that port must be there, and only there.
    const ports = /^ {4}ports:\s*\n((?:\s+- .+\n)+)/m.exec(vm)?.[1].trim().split('\n').map((l) => l.replace(/^\s*- /, ''));
    expect(ports).toEqual(['"127.0.0.1:11434:11434"']);
  });

  // IN-101: the speed test is run on the machine itself and asks the address the overlay publishes there; one without the other is a test that finds nothing, or one that finds something else.
  it('is asked by deploy/model-speed.py at the address it publishes on the machine, and nowhere else', () => {
    const speed = readFileSync(root('deploy/model-speed.py'), 'utf8');
    const asked = /"OLLAMA_BASE",\s*"http:\/\/([\d.]+:\d+)"/.exec(speed)?.[1];
    const published = /^\s+- "([\d.]+:\d+):11434"$/m.exec(vm)?.[1];
    expect(asked, 'the speed test has a default address').toBeDefined();
    expect(published, 'the overlay publishes a port').toBeDefined();
    expect(asked).toBe(published);
  });

  it('is the one place that says where the portal finds the model, so that no line of .env can send it elsewhere (IN-99)', () => {
    expect(vm).not.toContain('${AI_BASE_URL');
    expect(vm).toMatch(/^ {6}AI_BASE_URL: http:\/\/ollama:11434\/v1$/m);
  });

  it('pins the image to a version, and lets a machine name another in the environment', () => {
    const image = /image: \$\{OLLAMA_IMAGE:-([^}]+)\}/.exec(vm)?.[1];
    expect(image).toMatch(/^ollama\/ollama:\d+\.\d+\.\d+$/);
    expect(vm).not.toMatch(/:latest/);
  });

  it('answers one question at a time, keeps one model loaded, and limits the memory it may take', () => {
    expect(vm).toContain('OLLAMA_NUM_PARALLEL: ${OLLAMA_NUM_PARALLEL:-1}');
    expect(vm).toContain('OLLAMA_MAX_LOADED_MODELS: "1"');
    expect(vm).toMatch(/mem_limit: \$\{OLLAMA_MEM_LIMIT:-\d+g\}/);
    expect(vm).toMatch(/memswap_limit: \$\{OLLAMA_MEM_LIMIT:-\d+g\}/);
  });

  // SC-70: a model whose name ends -cloud is run by ollama.com once Ollama is signed in, and the question and the estate would go out while the portal reports a local model. The portal refuses such
  // a name itself (AI_LOCAL_ONLY); this switches the service's own way to it off, and a release that does not know the setting ignores it.
  it('switches off the cloud models of Ollama, as a second lock beside the portal\'s refusal of their names (SC-70)', () => {
    expect(vm).toMatch(/^ {6}OLLAMA_NO_CLOUD: "1"$/m);
  });

  it('keeps the models on a named volume, so that a rebuild does not fetch them again', () => {
    expect(vm).toContain('- ollama-models:/root/.ollama');
    expect(vm).toMatch(/^volumes:\s*\n {2}ollama-models:\s*$/m);
  });

  it('points the portal at it by its service name, which the local-only rule counts as the machine\'s own network, and makes the portal wait for nothing', () => {
    const url = /AI_BASE_URL: (http:\/\/\S+)$/m.exec(vm)?.[1];
    expect(url).toBe('http://ollama:11434/v1');
    expect(isLocalBaseUrl(url!)).toBe(true);
    expect(vm).not.toMatch(/depends_on/);
    // Of the portal it changes the model's address and nothing else.
    const bff = vm.slice(vm.indexOf('  portal-bff:'), vm.indexOf('volumes:\n  ollama-models'));
    expect(bff.match(/^ {6}[A-Z_]+:/gm)).toEqual(['      AI_BASE_URL:']);
  });
});

describe('docker-compose.vm-gpu.yml', () => {
  it('reserves one NVIDIA card for the model and does nothing else', () => {
    expect(gpu).toMatch(/driver: nvidia/);
    expect(gpu).toMatch(/count: 1\b/);
    expect(gpu).toContain('capabilities: [gpu]');
    expect(gpu).not.toMatch(/image:|environment:|volumes:|ports:/);
  });

  it('is the only file that asks for a card, so that a machine without one can leave it out', () => {
    expect(vm).not.toMatch(/nvidia|gpu/i);
    expect(code('docker-compose.yml').join('\n')).not.toMatch(/nvidia/i);
  });
});

describe('the portal\'s own compose file', () => {
  it('is left as it was for a Mac: no Ollama service, and the web port still on the loopback only', () => {
    const base = code('docker-compose.yml').join('\n');
    expect(base).not.toMatch(/^ {2}ollama:/m);
    expect(base).toMatch(/- "127\.0\.0\.1:\$\{WEB_PORT:-\d+\}:8080"/);
  });
});

const run = promisify(execFile);
const hasCompose = (() => {
  try {
    execFileSync('docker', ['compose', 'version'], { stdio: 'ignore', timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
})();

/** Compose reads the files and prints what they add up to; it needs no running Docker. An empty env file keeps it from reading the machine's own .env. */
describe.skipIf(!hasCompose)('Compose, merging the files', { timeout: 60_000 }, () => {
  const config = async (...files: string[]) => {
    const args = ['compose', '--env-file', '/dev/null', ...files.flatMap((f) => ['-f', root(f)]), 'config'];
    const { stdout } = await run('docker', args, { env: { ...process.env, JWT_SECRET: 'validation-only' }, timeout: 50_000 });
    return stdout;
  };

  it('merges the portal\'s file with the model service, with and without the card', async () => {
    const [plain, withCard] = await Promise.all([config('docker-compose.yml', 'docker-compose.vm.yml'), config('docker-compose.yml', 'docker-compose.vm.yml', 'docker-compose.vm-gpu.yml')]);
    expect(plain).toMatch(/^ {2}ollama:/m);
    expect(plain).toMatch(/image: ollama\/ollama:\d+\.\d+\.\d+/);
    expect(plain).toContain('AI_BASE_URL: http://ollama:11434/v1');
    expect(plain).not.toMatch(/nvidia/);
    expect(withCard).toMatch(/driver: nvidia/);
    expect(withCard).toMatch(/count: 1/);
  });

  it('publishes on the machine the portal\'s own port and the model\'s, each on the loopback and nowhere else', async () => {
    const merged = await config('docker-compose.yml', 'docker-compose.vm.yml', 'docker-compose.vm-gpu.yml');
    const published = [...merged.matchAll(/published: "?(\d+)"?/g)].map((m) => m[1]);
    expect(published).toHaveLength(2);
    expect(published).toContain('11434');
    expect([...merged.matchAll(/host_ip: (\S+)/g)].map((m) => m[1])).toEqual(['127.0.0.1', '127.0.0.1']);
  });

  // IN-99: the example the documents tell a reader to start from must not beat the overlay's address for the model. The empty env file of the tests above could not see it.
  it.each([['.env.example'], ['server/.env.example']])('gives the portal the overlay\'s model address when %s is the env file', async (example) => {
    const envFile = root(example);
    const args = ['compose', '--env-file', envFile, '-f', root('docker-compose.yml'), '-f', root('docker-compose.vm.yml'), 'config'];
    const { stdout } = await run('docker', args, { env: { ...process.env, JWT_SECRET: 'validation-only' }, timeout: 50_000 });
    expect(stdout).toContain('AI_BASE_URL: http://ollama:11434/v1');
    expect(stdout).not.toContain('host.docker.internal:11434');
  });

  // DC-77: the overlay that tls.md gives for a proxy container is a file Compose accepts beside the portal's own, and adds the one service.
  it('merges the proxy overlay of tls.md with the portal\'s file', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const doc = readFileSync(root('docs/operations/tls.md'), 'utf8');
    const overlay = [...doc.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]).find((body) => body.includes('tls-proxy:'));
    expect(overlay, 'tls.md has the overlay').toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), 'tls-overlay-'));
    try {
      writeFileSync(join(dir, 'docker-compose.proxy.yml'), overlay!);
      const args = ['compose', '--env-file', '/dev/null', '-f', root('docker-compose.yml'), '-f', join(dir, 'docker-compose.proxy.yml'), 'config', '--services'];
      const { stdout } = await run('docker', args, { env: { ...process.env, JWT_SECRET: 'validation-only' }, timeout: 50_000 });
      expect(stdout.split('\n').filter(Boolean).sort()).toEqual(['portal-bff', 'portal-web', 'tls-proxy']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // IN-100: a COMPOSE_FILE line in .env gives every plain command the same files. Compose reads it from the folder's .env and takes its names from the folder the command runs in.
  it('reads the files of a COMPOSE_FILE line in the .env of the folder, and the names in it are those of the folder the command runs in', async () => {
    const { mkdtempSync, writeFileSync, copyFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'compose-file-'));
    try {
      for (const f of ['docker-compose.yml', 'docker-compose.vm.yml']) copyFileSync(root(f), join(dir, f));
      writeFileSync(join(dir, '.env'), 'JWT_SECRET=validation-only\nCOMPOSE_FILE=docker-compose.yml:docker-compose.vm.yml\n');
      const ask = (cwd: string) => run('docker', ['compose', '--project-directory', dir, 'config', '--services'], { cwd, timeout: 50_000 });
      expect((await ask(dir)).stdout.split('\n').filter(Boolean)).toContain('ollama');
      // From another folder the relative names do not resolve: the scripts of deploy/ change into the folder first.
      await expect(ask(tmpdir())).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
