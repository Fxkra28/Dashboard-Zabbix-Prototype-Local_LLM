import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The load test and the timing table of tools/live named fixed months (2026-08 and 2026-09), and the portal refuses a month more than about 400 days
 * back, so from July 2027 every such request would answer 400 with no explanation (IN-88). They ask for the month that has just closed in Asia/Jakarta,
 * as signedin_check.py does, and MONTH names another. Run against a stand-in portal that records what it was asked.
 */
const tools = (name: string) => fileURLToPath(new URL(`../../../tools/live/${name}`, import.meta.url));

/** YYYY-MM of the month before this one in Asia/Jakarta (UTC+7, no daylight saving). */
function monthJustClosed(now = Date.now()): string {
  const d = new Date(now + 7 * 3_600_000);
  const month = d.getUTCMonth(); // 0 is January
  return month === 0 ? `${d.getUTCFullYear() - 1}-12` : `${d.getUTCFullYear()}-${String(month).padStart(2, '0')}`;
}

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

async function standIn() {
  const asked: string[] = [];
  const server = http.createServer((req, res) => {
    asked.push(req.url ?? '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, asked };
}

function run(cmd: string, args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; text: string }>((resolve) => {
    const child = spawn(cmd, args, { env: { PATH: process.env.PATH ?? '', ...env } });
    let text = '';
    child.stdout.on('data', (d) => (text += d));
    child.stderr.on('data', (d) => (text += d));
    child.on('close', (code) => resolve({ code, text }));
  });
}

const monthsIn = (urls: string[]) => [...new Set(urls.flatMap((u) => [...u.matchAll(/month=(\d{4}-\d{2})/g)].map((m) => m[1])))].sort();

describe('tools/live/load-test.mjs', () => {
  it('asks for the month that has just closed, and no fixed month', async () => {
    const portal = await standIn();
    const r = await run('node', [tools('load-test.mjs'), portal.base, '1', '1'], { HOSTID: '10001' });
    expect(r.code).toBe(0);
    expect(monthsIn(portal.asked)).toEqual([monthJustClosed()]);
    expect(portal.asked.some((u) => u.startsWith('/api/sli?month='))).toBe(true);
  });

  it('asks for the month MONTH names, when it is set', async () => {
    const portal = await standIn();
    await run('node', [tools('load-test.mjs'), portal.base, '1', '1'], { HOSTID: '10001', MONTH: '2026-03' });
    expect(monthsIn(portal.asked)).toEqual(['2026-03']);
  });
});

describe('tools/live/api-timing.py', () => {
  const out = mkdtempSync(join(tmpdir(), 'api-timing-'));
  afterEach(() => rmSync(join(out, 'timing.json'), { force: true }));

  it('asks for the month that has just closed in every URL that names one, and no fixed month', async () => {
    const portal = await standIn();
    const r = await run('python3', ['-I', tools('api-timing.py')], { BFF: portal.base, OUT: join(out, 'timing.json'), HOSTID: '1', ITEMID: '2', IFHOSTID: '3', MAPID: '4' });
    expect(r.code).toBe(0);
    expect(monthsIn(portal.asked)).toEqual([monthJustClosed()]);
    expect(portal.asked.filter((u) => u.includes('month=')).length).toBeGreaterThan(6);
  }, 60_000);

  it('asks for the month MONTH names, when it is set', async () => {
    const portal = await standIn();
    await run('python3', ['-I', tools('api-timing.py')], { BFF: portal.base, OUT: join(out, 'timing.json'), HOSTID: '1', ITEMID: '2', IFHOSTID: '3', MAPID: '4', MONTH: '2026-03' });
    expect(monthsIn(portal.asked)).toEqual(['2026-03']);
  }, 60_000);
});
