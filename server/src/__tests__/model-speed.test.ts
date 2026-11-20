import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * deploy/model-speed.py (the speed test of the VM runbook) against an Ollama that is made up here: what it asks, in what order, what it reads of the answers, and the verdict it gives.
 * Nothing is timed by this test: the durations are the ones the made-up server reports, as Ollama reports its own.
 */

const run = promisify(execFile);
const script = fileURLToPath(new URL('../../../deploy/model-speed.py', import.meta.url));
const sample = JSON.parse(readFileSync(fileURLToPath(new URL('../../scripts/bakeoff/prompt-sample.json', import.meta.url)), 'utf8')) as { prefix: string; questions: { q: string; tail: string }[] };

const hasPython = (() => {
  try {
    execFileSync('python3', ['-I', '-c', 'import sys'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

interface Fake {
  /** Nanoseconds Ollama reports for loading the model and for reading the prompt, the first time after an unload. */
  loadNs?: number;
  readNs?: number;
  size?: number;
  vram?: number;
  /** Refuse `think` as a model with no thinking mode does. */
  refuseThink?: boolean;
  missing?: boolean;
}

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

async function fakeOllama(o: Fake = {}) {
  const seen: { path: string; body: Record<string, unknown> | null }[] = [];
  let loaded = false;
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      seen.push({ path: `${req.method} ${req.url}`, body });
      const reply = (status: number, json: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.url === '/api/generate') {
        loaded = false;
        return reply(200, { done: true });
      }
      if (req.url === '/api/ps') return reply(200, { models: loaded ? [{ name: 'fake:9b', size: o.size ?? 8e9, size_vram: o.vram ?? 8e9 }] : [] });
      if (req.url === '/api/chat') {
        if (o.missing) return reply(404, { error: "model 'fake:9b' not found" });
        if (o.refuseThink && body && 'think' in body) return reply(400, { error: '"fake:9b" does not support thinking' });
        const cold = !loaded;
        loaded = true;
        return reply(200, {
          done: true,
          load_duration: cold ? (o.loadNs ?? 2e9) : 0,
          prompt_eval_count: 2851,
          prompt_eval_duration: cold ? (o.readNs ?? 6e9) : 0.3e9,
          eval_count: 100,
          eval_duration: 2e9,
        });
      }
      return reply(404, {});
    });
  });
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
  return { base: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, seen };
}

const speed = async (args: string[]) => {
  try {
    const { stdout, stderr } = await run('python3', ['-I', script, ...args], { timeout: 60_000 });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

describe.skipIf(!hasPython)('deploy/model-speed.py', () => {
  it('passes a model whose cold first word comes within the limit, and tells where it sits and how fast it answers', async () => {
    const { base } = await fakeOllama({ loadNs: 2e9, readNs: 6e9 });
    const out = await speed(['fake:9b', '--base', base]);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toContain('sits on       100% GPU (8.0 GB of 8.0 GB on the card)');
    expect(out.stdout).toContain('cold          first word after 8.0 s (load 2.0 s, then 2851 tokens read in 6.0 s, 475 tokens a second)');
    expect(out.stdout).toContain('warm          first word after 0.3 s');
    expect(out.stdout).toContain('speed         50 tokens a second while answering');
    expect(out.stdout).toMatch(/four at once {2}the last was done after \d+\.\d s \(each: \d+\.\d, \d+\.\d, \d+\.\d, \d+\.\d\)/);
    expect(out.stdout).toContain('verdict       PASS: the first word of a cold question came after 8.0 s; the limit is 30 s');
  });

  it('fails one that is slower than the limit, which is the answer to give for a processor that reads the prompt too slowly', async () => {
    const { base } = await fakeOllama({ loadNs: 3e9, readNs: 129e9, vram: 0 });
    const out = await speed(['fake:9b', '--base', base]);
    expect(out.code).toBe(1);
    expect(out.stdout).toContain('sits on       100% processor');
    expect(out.stdout).toContain('verdict       FAIL: the first word of a cold question came after 132.0 s; the limit is 30 s');
  });

  it('keeps to the limit it is given, and says when a model is only partly on the card', async () => {
    const { base } = await fakeOllama({ loadNs: 2e9, readNs: 6e9, size: 10e9, vram: 6e9 });
    const out = await speed(['fake:9b', '--base', base, '--limit', '5']);
    expect(out.code).toBe(1);
    expect(out.stdout).toContain('60% GPU / 40% processor');
    expect(out.stdout).toContain('the limit is 5 s');
  });

  it('asks as the portal does: the whole system text, then the question, with the thinking switch off, and unloads first', async () => {
    const { base, seen } = await fakeOllama();
    await speed(['fake:9b', '--base', base, '--num-ctx', '4096']);
    expect(seen[0]).toMatchObject({ path: 'POST /api/generate', body: { model: 'fake:9b', keep_alive: 0 } });
    const chats = seen.filter((s) => s.path === 'POST /api/chat');
    // One cold, one warm, four at once.
    expect(chats).toHaveLength(6);
    const first = chats[0]!.body as { messages: { role: string; content: string }[]; think: boolean; stream: boolean; options: { num_ctx: number } };
    expect(first.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(first.messages[0]!.content).toBe(`${sample.prefix}\n\n${sample.questions[0]!.tail}`);
    expect(first.messages[1]!.content).toBe(sample.questions[0]!.q);
    expect(first).toMatchObject({ think: false, stream: false, options: { num_ctx: 4096 } });
  });

  it('asks again without the thinking switch of a model that has no such mode', async () => {
    const { base, seen } = await fakeOllama({ refuseThink: true });
    const out = await speed(['fake:9b', '--base', base]);
    expect(out.code, out.stderr).toBe(0);
    const chats = seen.filter((s) => s.path === 'POST /api/chat').map((s) => s.body as Record<string, unknown>);
    expect(chats[0]).toHaveProperty('think');
    expect(chats[1]).not.toHaveProperty('think');
  });

  it('says what to do when the model is not on the machine, and when Ollama does not answer, and ends with 2, not with a verdict', async () => {
    const { base } = await fakeOllama({ missing: true });
    const missing = await speed(['fake:9b', '--base', base]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('ollama pull fake:9b');
    expect(missing.stdout).not.toContain('verdict');
    server?.close();
    const down = await speed(['fake:9b', '--base', 'http://127.0.0.1:9']);
    expect(down.code).toBe(2);
    expect(down.stderr).toContain('does not answer');
  });
});
