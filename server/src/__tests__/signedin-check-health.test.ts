import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

/**
 * What tools/live/signedin_check.py asks of a portal about its model and its log file (IN-79, IN-83). rebuild.sh sends the operator to it before
 * `--mark-good`, so it must fail on a copy that has lost what it exists for: the local-model copy that sends a question away, or a log that stopped.
 * Run against a stand-in portal that answers only what `--only-health` asks.
 */
const SCRIPT = fileURLToPath(new URL('../../../tools/live/signedin_check.py', import.meta.url));

interface Portal {
  aiProvider: string;
  aiExternal: boolean;
  model: string;
  /** What `logFile.state` says, and whether the bytes written grow between the two health reads. */
  logState: string;
  logGrows: boolean;
  /** Leave `logFile` out of the answer, as a server that predates it does. */
  noLogFile: boolean;
  /** What the server says of its read of Zabbix: `ok`, or why not. Anything else is a 503 from /api/ready, as the server answers it (IN-91). */
  zabbix: string;
  /** Answer /api/ready with a web page and a 200, as a proxy in front of a dead portal can. */
  readyAsPage?: boolean;
}
const LOCAL: Portal = { aiProvider: 'openai-compatible', aiExternal: false, model: 'ok', logState: 'ok', logGrows: true, noLogFile: false, zabbix: 'ok' };

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

async function standIn(portal: Portal) {
  let written = 1_000;
  const server = http.createServer((req, res) => {
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/bff/api/auth/login') return json(200, { user: { name: 'ana', role: 'admin' } }, { 'Set-Cookie': 'hcml_session=stand-in; Path=/; HttpOnly' });
    if (req.url === '/bff/api/ready') {
      if (portal.logGrows) written += 300;
      if (portal.readyAsPage) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html>Welcome</html>');
      }
      return portal.zabbix === 'ok' ? json(200, { ok: true, zabbix: 'ok', model: portal.model }) : json(503, { ok: false, zabbix: portal.zabbix, model: portal.model });
    }
    if (req.url === '/bff/api/health') {
      return json(200, {
        ok: true,
        aiProvider: portal.aiProvider,
        aiExternal: portal.aiExternal,
        ready: { ok: portal.zabbix === 'ok', zabbix: portal.zabbix, zabbixMs: portal.zabbix === 'ok' ? 5 : null, model: portal.model, checkedAt: 1 },
        ...(portal.noLogFile ? {} : { logFile: { state: portal.logState, written } }),
      });
    }
    return json(404, { error: 'not_found', message: 'stand-in' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The script against the stand-in, asking for the health checks only. */
function check(base: string, args: string[]) {
  return new Promise<{ code: number | null; text: string }>((resolve) => {
    const child = spawn('python3', ['-I', SCRIPT, base, '--only-health', ...args], {
      env: { PATH: process.env.PATH ?? '', PORTAL_USER: 'ana', PORTAL_PASSWORD: 'a-long-enough-password' },
    });
    let text = '';
    child.stdout.on('data', (d) => (text += d));
    child.stderr.on('data', (d) => (text += d));
    child.on('close', (code) => resolve({ code, text }));
  });
}
const lineOf = (text: string, label: RegExp) => text.split('\n').find((l) => label.test(l)) ?? '';

describe('signedin_check.py and the model (IN-79)', () => {
  it('passes a local-model copy whose model is local and answering, when told to expect one', async () => {
    const r = await check(await standIn(LOCAL), ['--expect-ai', 'local']);
    expect(lineOf(r.text, /model is local/)).toMatch(/^PASS/);
    expect(r.code).toBe(0);
  });

  it('fails it when a question would leave the machine, naming the two fields', async () => {
    const r = await check(await standIn({ ...LOCAL, aiExternal: true }), ['--expect-ai', 'local']);
    expect(lineOf(r.text, /model is local/)).toMatch(/^FAIL.*aiExternal=true/);
    expect(r.code).toBe(1);
  });

  it('fails it when its provider is not the local one', async () => {
    const r = await check(await standIn({ ...LOCAL, aiProvider: 'anthropic' }), ['--expect-ai', 'local']);
    expect(lineOf(r.text, /model is local/)).toMatch(/^FAIL.*aiProvider="anthropic"/);
    expect(r.code).toBe(1);
  });

  it.each(['down', 'missing', 'off', 'not_checked'])('fails it when the model reads %s: a local model must answer', async (model) => {
    const r = await check(await standIn({ ...LOCAL, model }), ['--expect-ai', 'local']);
    expect(lineOf(r.text, /model is local/)).toMatch(new RegExp(`^FAIL.*model="${model}"`));
    expect(r.code).toBe(1);
  });

  it('passes the hosted copy when questions go out and the page says so, and fails a hosted copy that sends nothing', async () => {
    const hosted = { ...LOCAL, aiProvider: 'anthropic', aiExternal: true, model: 'not_checked' };
    expect((await check(await standIn(hosted), ['--expect-ai', 'hosted'])).code).toBe(0);
    const r = await check(await standIn({ ...hosted, aiExternal: false }), ['--expect-ai', 'hosted']);
    expect(lineOf(r.text, /hosted model/)).toMatch(/^FAIL/);
    expect(r.code).toBe(1);
  });

  it('asks nothing of the model by default, and refuses a word it does not know', async () => {
    expect((await check(await standIn({ ...LOCAL, aiExternal: true, model: 'down' }), [])).code).toBe(0);
    const r = await check(await standIn(LOCAL), ['--expect-ai', 'maybe']);
    expect(r.code).not.toBe(0);
    expect(r.text).toContain('--expect-ai is local, hosted or any');
    expect(r.text).not.toMatch(/Traceback/);
  });
});

// IN-91: a portal that cannot read Zabbix ended the quick check with '5 of 5 checks passed', which rebuild.sh reads as 'keep these images'.
describe('signedin_check.py and Zabbix (IN-91)', () => {
  const cut = { ...LOCAL, zabbix: 'timeout' };

  it('fails a portal that cannot read Zabbix, naming what the server says of it', async () => {
    const r = await check(await standIn(cut), []);
    expect(lineOf(r.text, /signed-in \/api\/ready/)).toMatch(/^FAIL.*HTTP 503.*zabbix="timeout"/);
    expect(r.code).toBe(1);
    expect(r.text).not.toContain('5 of 5 checks passed');
  });

  it.each(['token_rejected', 'timeout', 'error'])('fails for %s too', async (zabbix) => {
    const r = await check(await standIn({ ...LOCAL, zabbix }), []);
    expect(lineOf(r.text, /signed-in \/api\/ready/)).toMatch(new RegExp(`^FAIL.*zabbix="${zabbix}"`));
    expect(r.code).toBe(1);
  });

  it('does not take a 200 that is not the portal for an answer: the body must say that it is ready', async () => {
    const r = await check(await standIn({ ...LOCAL, readyAsPage: true }), []);
    expect(lineOf(r.text, /signed-in \/api\/ready/)).toMatch(/^FAIL.*HTTP 200/);
    expect(r.code).toBe(1);
  });

  it('passes it again with --expect-zabbix any, for an image tried where Zabbix cannot be reached, and still says what Zabbix answered', async () => {
    const r = await check(await standIn(cut), ['--expect-zabbix', 'any']);
    expect(lineOf(r.text, /signed-in \/api\/ready/)).toMatch(/^PASS.*HTTP 503.*zabbix="timeout"/);
    expect(r.code).toBe(0);
  });

  it('passes a portal that reads Zabbix, by default and when told to expect it', async () => {
    for (const args of [[], ['--expect-zabbix', 'on']]) {
      const r = await check(await standIn(LOCAL), args);
      expect(lineOf(r.text, /signed-in \/api\/ready/), args.join(' ')).toMatch(/^PASS.*HTTP 200.*zabbix="ok"/);
      expect(r.code, args.join(' ')).toBe(0);
    }
  });

  it('refuses a word it does not know, in words', async () => {
    const r = await check(await standIn(LOCAL), ['--expect-zabbix', 'off']);
    expect(r.code).not.toBe(0);
    expect(r.text).toContain('--expect-zabbix is on or any');
    expect(r.text).not.toMatch(/Traceback/);
  });
});

describe('signedin_check.py and the log file (IN-83)', () => {
  it('passes when the file is being written and the bytes grow between two reads', async () => {
    const r = await check(await standIn(LOCAL), []);
    expect(lineOf(r.text, /log file/)).toMatch(/^PASS.*state=ok/);
    expect(r.code).toBe(0);
  });

  it('fails when the bytes written do not grow, though the state says ok', async () => {
    const r = await check(await standIn({ ...LOCAL, logGrows: false }), []);
    expect(lineOf(r.text, /log file/)).toMatch(/^FAIL/);
    expect(r.code).toBe(1);
  });

  it.each(['failing', 'off'])('fails when the state is %s', async (logState) => {
    const r = await check(await standIn({ ...LOCAL, logState }), []);
    expect(lineOf(r.text, /log file/)).toMatch(new RegExp(`^FAIL.*state=${logState}`));
    expect(r.code).toBe(1);
  });

  it('fails, and says why, against a server that predates the field', async () => {
    const r = await check(await standIn({ ...LOCAL, noLogFile: true }), []);
    expect(lineOf(r.text, /log file/)).toMatch(/^FAIL.*no logFile/);
    expect(r.code).toBe(1);
  });
});
