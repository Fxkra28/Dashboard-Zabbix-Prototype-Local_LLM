import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

/** tools/live/sse_hold.py, the check that a live stream stays alive (tracker IN-46), against stand-in streams. */

const SCRIPT = fileURLToPath(new URL('../../../tools/live/sse_hold.py', import.meta.url));
const FIRST = 'event: problems\ndata: []\n\n';
const PING = 'event: ping\ndata: {}\n\n';
const hasPython = spawnSync('python3', ['-V']).status === 0;

/** Serves one stand-in stream, runs the check against it for `seconds`, and shuts the stand-in down. */
async function check(behave: (res: ServerResponse) => void, seconds: number, quietLimit: number, status = 200, extra: string[] = []) {
  const server = createServer((_req, res) => {
    res.writeHead(status, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    behave(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/stream`;
  try {
    return await run(url, seconds, quietLimit, extra);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

function run(url: string, seconds: number, quietLimit: number, extra: string[] = []): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn('python3', ['-I', SCRIPT, url, '--seconds', String(seconds), '--quiet-limit', String(quietLimit), ...extra]);
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.on('close', (code) => resolve({ code, out }));
  });
}

function pingEvery(res: ServerResponse, ms: number): void {
  const timer = setInterval(() => res.write(PING), ms);
  res.on('close', () => clearInterval(timer));
}

describe.skipIf(!hasPython)('sse_hold.py', () => {
  // The open timeout is 1 s and the stream is quiet for 1.6 s: a reader that kept the open timeout would break here, as the old check did at 5 s.
  it.concurrent(
    'passes a stream that stays alive, through a quiet stretch longer than the open timeout',
    async () => {
      const r = await check(
        (res) => {
          res.write(FIRST);
          setTimeout(() => pingEvery(res, 150), 1_600);
        },
        4,
        4,
        200,
        ['--open-timeout', '1'],
      );
      expect(r.out).toMatch(/^PASS/);
      expect(r.out).toContain("'ping'");
      expect(r.code).toBe(0);
    },
    20_000,
  );

  it.concurrent('fails when the server closes the stream after its first frame', async () => {
    const r = await check(
      (res) => {
        res.write(FIRST);
        setTimeout(() => res.end(), 100);
      },
      2,
      10,
    );
    expect(r.out).toMatch(/^FAIL.*the server closed the stream/);
    expect(r.code).toBe(1);
  }, 20_000);

  it.concurrent('fails when the stream falls silent after its first frame', async () => {
    const r = await check((res) => res.write(FIRST), 2.5, 1);
    expect(r.out).toMatch(/^FAIL.*quiet for more than 1 s/);
    expect(r.code).toBe(1);
  }, 20_000);

  it.concurrent('fails when no first frame comes', async () => {
    const r = await check((res) => res.flushHeaders(), 1, 10);
    expect(r.out).toMatch(/^FAIL.*no frame came/);
    expect(r.code).toBe(1);
  }, 20_000);

  it.concurrent('fails on an HTTP error, saying which', async () => {
    const r = await check((res) => res.end('too many screens'), 1, 10, 429);
    expect(r.out).toMatch(/^FAIL.*HTTP 429/);
    expect(r.code).toBe(1);
  }, 20_000);

  it.concurrent('fails, without a traceback, when the stream cannot be opened', async () => {
    const r = await run('http://127.0.0.1:9/stream', 1, 10);
    expect(r.out).toMatch(/^FAIL {2}could not open the stream/);
    expect(r.code).toBe(1);
  }, 20_000);
});
