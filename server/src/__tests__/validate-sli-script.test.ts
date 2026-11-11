import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zip } from '../export/zip.js';

/**
 * scripts/validate-sli.ts compares the derived SLA with HCML's own spreadsheets. A month with no
 * spreadsheet is skipped with one line, and a portal with sign-in on is reached with the account in
 * PORTAL_USER and PORTAL_PASSWORD, as tools/live/signedin_check.py does (IN-49).
 */
const root = fileURLToPath(new URL('../..', import.meta.url));
const PASSWORD = 'a-long-secret-password';

let dir: string;
let server: http.Server | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'validate-sli-'));
});
afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

const cell = (ref: string, v: string | number) =>
  typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
const sheetXml = (rows: (string | number)[][]) =>
  `<worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(`${String.fromCharCode(65 + j)}${i + 1}`, v)).join('')}</row>`).join('')}</sheetData></worksheet>`;

/** A workbook of the four sheets the script reads, holding one host at 99.5 % and one event. */
function workbook(): Buffer {
  const sheets: [string, (string | number)[][]][] = [
    ['Overall', [['Overall Name', 'Overall Availability %'], ['Overall', 99.5]]],
    ['Summary', [['Template Category', 'Average Availability %', 'Total Trigger / Host']]],
    ['Detail Host', [['Host', 'Availability %', 'Downtime Seconds'], ['sw-lt3', 99.5, 100]]],
    ['Event Detail', [['Event'], ['e1']]],
  ];
  const data = (s: string) => Buffer.from(s, 'utf8');
  return zip([
    { name: 'xl/workbook.xml', data: data(`<workbook><sheets>${sheets.map(([n], i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: data(`<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`) },
    ...sheets.map(([, rows], i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: data(sheetXml(rows)) })),
  ]);
}

const report = { overall: { hosts: 1, sli: 99.5 }, categories: [], hosts: [{ name: 'sw-lt3', sli: 99.5, downtime: 100, incidents: 1, category: 'Other' }], stats: { ms: 5 } };

/** A portal that wants a sign-in: ana's password gets a cookie, and the report needs that cookie. */
async function fakePortal(signIn: boolean) {
  const seen: { login?: { body: string; csrf?: string | string[] }; logins: number; reports: number } = { logins: 0, reports: 0 };
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/api/auth/login') {
        seen.login = { body, csrf: req.headers['x-hcml-csrf'] };
        seen.logins++;
        const ok = body.includes(PASSWORD) && req.headers['x-hcml-csrf'] === '1';
        res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json', ...(ok ? { 'set-cookie': ['hcml_session=tok123; Path=/; HttpOnly', 'other=1; Path=/'] } : {}) });
        return res.end('{}');
      }
      if (req.url?.startsWith('/api/sli')) {
        seen.reports++;
        if (signIn && !String(req.headers.cookie).includes('hcml_session=tok123')) {
          res.writeHead(401, { 'content-type': 'application/json' });
          return res.end('{"error":"unauthorized"}');
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(report));
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, seen };
}

function run(args: string[], env: Record<string, string>) {
  return new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
    execFile(`${root}/node_modules/.bin/tsx`, ['scripts/validate-sli.ts', ...args], { cwd: root, env: { PATH: process.env.PATH ?? '', HOME: dir, ...env }, timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ status: err ? Number((err as { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
  });
}

const addSheet = (month: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `Availability_Report_${month}.xlsx`), workbook());
};

describe('scripts/validate-sli.ts, a month with no spreadsheet (IN-49)', () => {
  it('skips each such month with one line, says that nothing was checked, and stops with 2 rather than a stack trace', async () => {
    const res = await run(['2026-06', '2026-07'], { REPORT_DIR: dir, BFF_URL: 'http://127.0.0.1:9' });
    expect(res.status).toBe(2);
    expect(res.stdout).toMatch(/2026-06 skipped: no spreadsheet at .*Availability_Report_2026-06\.xlsx/);
    expect(res.stdout).toMatch(/2026-07 skipped: no spreadsheet at /);
    expect(res.stdout).toMatch(/Nothing was checked/);
    expect(res.stderr).toBe('');
    expect(res.stdout + res.stderr).not.toMatch(/ENOENT|\n\s+at /);
  });

  it('checks the months that have one and skips the rest, passing when those pass', async () => {
    addSheet('2026-06');
    const portal = await fakePortal(false);
    const res = await run(['2026-06', '2026-07'], { REPORT_DIR: dir, BFF_URL: portal.url });
    expect(res.stderr).toBe('');
    expect(res.stdout).toMatch(/2026-06 PASS/);
    expect(res.stdout).toMatch(/2026-07 skipped/);
    expect(res.status).toBe(0);
    expect(portal.seen.reports).toBe(1);
  });
});

describe('scripts/validate-sli.ts, a portal with sign-in on (IN-49)', () => {
  it('signs in once with PORTAL_USER and PORTAL_PASSWORD and sends the session cookie for every month, never printing the password', async () => {
    addSheet('2026-06');
    addSheet('2026-07');
    const portal = await fakePortal(true);
    const res = await run(['2026-06', '2026-07'], { REPORT_DIR: dir, BFF_URL: portal.url, PORTAL_USER: 'ana', PORTAL_PASSWORD: PASSWORD });
    expect(res.stdout).toMatch(/2026-06 PASS/);
    expect(res.stdout).toMatch(/2026-07 PASS/);
    expect(res.status).toBe(0);
    expect(portal.seen.logins).toBe(1);
    expect(portal.seen.reports).toBe(2);
    expect(JSON.parse(portal.seen.login!.body)).toEqual({ username: 'ana', password: PASSWORD });
    expect(portal.seen.login!.csrf).toBe('1');
    expect(res.stdout + res.stderr).not.toContain(PASSWORD);
    expect(res.stdout + res.stderr).not.toContain('tok123');
  });

  it('says what to set when the portal wants a sign-in and no account is given', async () => {
    addSheet('2026-06');
    const portal = await fakePortal(true);
    const res = await run(['2026-06'], { REPORT_DIR: dir, BFF_URL: portal.url });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/PORTAL_USER and PORTAL_PASSWORD/);
    expect(res.stderr).not.toMatch(/\n\s+at /);
  });

  it('reports a refused sign-in without the password', async () => {
    addSheet('2026-06');
    const portal = await fakePortal(true);
    const res = await run(['2026-06'], { REPORT_DIR: dir, BFF_URL: portal.url, PORTAL_USER: 'ana', PORTAL_PASSWORD: 'not-the-password' });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/sign-in as ana was refused/);
    expect(res.stdout + res.stderr).not.toContain('not-the-password');
    expect(portal.seen.reports).toBe(0);
  });

  it('does not sign in when every month is skipped', async () => {
    const portal = await fakePortal(true);
    const res = await run(['2026-06'], { REPORT_DIR: dir, BFF_URL: portal.url, PORTAL_USER: 'ana', PORTAL_PASSWORD: PASSWORD });
    expect(res.status).toBe(2);
    expect(portal.seen.login).toBeUndefined();
  });
});
