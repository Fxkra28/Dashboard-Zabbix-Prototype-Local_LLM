// Clicks the download buttons of a running portal in headless Chrome and says whether each file arrived, with the page's
// Content-Security-Policy violations. Read-only: the BFF builds the files from what Zabbix already holds.
//
//   node download-check.mjs --base http://127.0.0.1:5199 [--month 2026-09] [--graph '/graphs?hostid=10084&itemid=23296,23297']
//
// `--graph` is a Graphs address with items in it, and adds the CSV under its Show data table. It is not guessed: which items exist is the portal's to say.
//
// Why: an enforcing policy can block what a blob link or a fetch does, and page-audit.mjs never clicks anything.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const BASE = (arg('base') || '').replace(/\/$/, '');
const MONTH = arg('month');
const GRAPH = arg('graph');
if (!BASE) { console.error('Needs --base'); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), 'hcml-dl-'));
const downloads = mkdtempSync(join(tmpdir(), 'hcml-dl-files-'));
const chrome = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic', '--disable-extensions', '--disable-sync', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); rmSync(downloads, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

const file = join(profile, 'DevToolsActivePort');
for (let i = 0; i < 100 && !existsSync(file); i++) await sleep(100);
const [port, path] = readFileSync(file, 'utf8').trim().split('\n');
const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('devtools refused')); });
let id = 0; const pending = new Map(); const listeners = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method) { for (const fn of listeners) fn(m.method, m.params); return; }
  const p = m.id && pending.get(m.id); if (!p) return; pending.delete(m.id);
  m.error ? p.rej(new Error(`${p.method}: ${m.error.message}`)) : p.res(m.result);
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej, method }); ws.send(JSON.stringify({ id: n, method, params, sessionId })); });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const cdp = (m, p) => send(m, p, sessionId);
for (const d of ['Page', 'Runtime', 'Log', 'Audits']) await cdp(`${d}.enable`);
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });

let csp = []; let problems = []; let started = []; let done = [];
listeners.push((method, p) => {
  if (method === 'Audits.issueAdded' && p.issue.code === 'ContentSecurityPolicyIssue') {
    const c = p.issue.details.contentSecurityPolicyIssueDetails;
    csp.push(`${c.isReportOnly ? 'report-only ' : ''}${c.violatedDirective} blocked ${String(c.blockedURL || c.contentSecurityPolicyViolationType).slice(0, 80)}`);
  }
  if (method === 'Runtime.consoleAPICalled' && p.type === 'error') problems.push((p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160));
  if (method === 'Log.entryAdded' && p.entry.level === 'error') problems.push(`${p.entry.source}: ${p.entry.text.slice(0, 160)}`);
  if (method === 'Browser.downloadWillBegin') started.push(p.suggestedFilename);
  if (method === 'Browser.downloadProgress' && p.state === 'completed') done.push(p.guid);
});

const ev = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const open = async (route) => { await cdp('Page.navigate', { url: BASE + route }); await sleep(1500); for (let i = 0; i < 60; i++) { if (await ev(`document.readyState === 'complete' && document.querySelectorAll('.spinner').length === 0`)) break; await sleep(300); } await sleep(500); };

const results = [];
async function click(what, route, selectorJs) {
  csp = []; problems = []; started = []; done = [];
  const before = new Set(readdirSync(downloads));
  await open(route);
  // A page may still be drawing when it reports ready, so the button is looked for for a few seconds before it counts as missing.
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    found = await ev(`(() => { const el = ${selectorJs}; if (!el || el.disabled) return false; el.click(); return true; })()`);
    if (!found) await sleep(250);
  }
  if (!found) { results.push({ what, ok: false, why: 'the button was not found' }); return; }
  for (let i = 0; i < 120 && !done.length; i++) await sleep(500); // a month of SLA can take a while to build
  await sleep(400);
  const fresh = readdirSync(downloads).filter((f) => !before.has(f) && !f.endsWith('.crdownload'));
  // A CSV is described by its shape, never its content: rows and columns of the first line.
  const shape = (f) => {
    if (!f.endsWith('.csv')) return '';
    const lines = readFileSync(join(downloads, f), 'utf8').split('\n');
    return `, ${lines.length - 1} rows after the heading, ${lines[0].split('","').length} columns`;
  };
  const sizes = fresh.map((f) => `${f} ${statSync(join(downloads, f)).size} B${shape(f)}`);
  results.push({ what, ok: done.length > 0 && fresh.length > 0 && csp.length === 0, suggested: started, files: sizes, csp: [...new Set(csp)], console: [...new Set(problems)].slice(0, 3) });
}

await click('CSV from Alert noise', '/reports/noise', `[...document.querySelectorAll('button')].find((b) => /Download CSV/.test(b.textContent))`);
await click('CSV from the Inventory gap list', '/reports/inventory', `[...document.querySelectorAll('button')].find((b) => /Download CSV/.test(b.textContent))`);
if (GRAPH) await click('CSV from the Graphs Show data table', GRAPH, `[...document.querySelectorAll('button')].find((b) => /Download CSV/.test(b.textContent))`);
const slaRoute = `/sla${MONTH ? `?month=${MONTH}` : ''}`;
await click('SLA report, first button (PDF)', slaRoute, `document.querySelectorAll('.report-actions button')[0]`);
await click('SLA report, second button (Excel)', slaRoute, `document.querySelectorAll('.report-actions button')[1]`);

for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.what}: ${r.why ?? ''}${r.files ? r.files.join(', ') : ''}${r.csp?.length ? ` | CSP ${r.csp.join('; ')}` : ''}${r.console?.length ? ` | console ${r.console.join('; ')}` : ''}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
