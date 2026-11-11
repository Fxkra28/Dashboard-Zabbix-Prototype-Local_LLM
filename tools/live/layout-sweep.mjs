// Layout measurements in headless Chrome over the DevTools protocol (no packages, the same approach as page-audit.mjs).
// Reads a dev portal with sign-in off. Nothing is clicked and no write is made.
//
//   node layout-sweep.mjs --base http://localhost:5173 [--routes /,/problems] [--views 1440x900,390x844] [--shots <dir>] [--eval "<js>"]
//
// For each route and viewport it prints how far the page overflows sideways (document width minus window width) and,
// when it does, the outermost elements that stick out and are not inside a scrolling box.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const BASE = (arg('base') || 'http://localhost:5173').replace(/\/$/, '');
const ROUTES = (arg('routes') || '/,/problems,/sites,/hosts,/devices,/latest,/maps,/network,/links,/services,/sla,/reports/availability,/reports/capacity,/reports/noise,/reports/top-triggers,/reports/inventory,/assistant,/graphs').split(',');
const VIEWS = (arg('views') || '1440x900,720x900,390x844,320x640').split(',').map((v) => v.split('x').map(Number));
const SHOTS = arg('shots');
const EXTRA = arg('eval');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'hcml-measure-'));
const chrome = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  '--use-mock-keychain', '--password-store=basic', '--disable-extensions', '--disable-sync', '--hide-scrollbars', '--force-color-profile=srgb', '--lang=en-ID', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

async function connect() {
  const file = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(file); i++) await sleep(100);
  const [port, path] = readFileSync(file, 'utf8').trim().split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('devtools refused')); });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method) return; const p = m.id && pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p.rej(new Error(`${p.method}: ${m.error.message}`)) : p.res(m.result); };
  return (method, params = {}, sessionId) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej, method }); ws.send(JSON.stringify({ id: n, method, params, sessionId })); });
}
const send = await connect();
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const cdp = (m, p) => send(m, p, sessionId);
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await cdp('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Jakarta' }).catch(() => undefined);
const ev = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

const PROBE = (DEVW) => `(() => {
  const W = ${DEVW};
  const doc = document.documentElement.scrollWidth;
  const clipped = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true; } return false; };
  const out = new Set();
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > W + 1 && !clipped(el)) out.add(el);
  }
  const top = [...out].filter((el) => !out.has(el.parentElement));
  return { W, doc, over: doc - W, culprits: top.slice(0, 4).map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), cls: (el.className && el.className.baseVal === undefined ? String(el.className) : '').slice(0, 40), w: Math.round(r.width), right: Math.round(r.right), text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 32) }; }) };
})()`;

async function load(route, [w, h]) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await cdp('Page.navigate', { url: BASE + route });
  await sleep(1200);
  // Settled: loaded, nothing busy, and that held for two checks in a row. A page with no table or card (a map, a chart) is settled too.
  let calm = 0;
  for (let i = 0; i < 40; i++) {
    const s = await ev(`({ ready: document.readyState, busy: document.querySelectorAll('.spinner,[aria-busy="true"]').length })`).catch(() => null);
    calm = s && s.ready === 'complete' && s.busy === 0 ? calm + 1 : 0;
    if (calm >= 2) { await sleep(700); return true; }
    await sleep(300);
  }
  return false;
}

for (const route of ROUTES) {
  for (const view of VIEWS) {
    const ok = await load(route, view);
    const m = await ev(PROBE(view[0]));
    const flag = m.over > 1 ? `OVERFLOW ${m.over}px` : 'fits';
    console.log(`${route.padEnd(24)} ${view.join('x').padEnd(9)} ${ok ? '' : '(still loading) '}${flag}${m.over > 1 ? '  ' + JSON.stringify(m.culprits) : ''}`);
    if (EXTRA) console.log('   eval:', JSON.stringify(await ev(EXTRA)).slice(0, 3000));
    if (SHOTS) {
      const shot = await cdp('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SHOTS, `${route.replace(/\W+/g, '_') || 'home'}-${view.join('x')}.png`), Buffer.from(shot.data, 'base64'));
    }
  }
}
process.exit(0);
