// Press Tab through a page the way a keyboard user does, and report every stop that shows no focus ring, and anything unreachable.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
const BASE = process.argv[2]; const ROUTES = (process.argv[3] || '/').split(',');
const profile = mkdtempSync(join(tmpdir(), 'hcml-tab-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--use-mock-keychain', '--password-store=basic', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); rmSync(profile, { recursive: true, force: true }); } catch {} });
for (let i = 0; i < 100 && !existsSync(join(profile, 'DevToolsActivePort')); i++) await sleep(100);
const [port, path] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n');
const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (!m.method) pend.get(m.id)?.(m); };
const send = (method, params = {}, sessionId) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params, sessionId })); });
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
const c = async (m, p) => { const r = await send(m, p, sessionId); if (r.error) throw new Error(m + ': ' + r.error.message); return r.result; };
await c('Page.enable'); await c('Runtime.enable');
await c('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const ev = async (e) => (await c('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
const key = (type, k, code, vk) => c('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk });
for (const route of ROUTES) {
  await c('Page.navigate', { url: BASE + route }); await sleep(3500);
  const focusable = await ev(`[...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary')].filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; }).length`);
  await ev(`[...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary')].filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; }).forEach((e, i) => e.setAttribute('data-tw', i))`);
  const visited = new Set();
  const seen = new Set(); const noRing = []; let lostAt = null; let steps = 0;
  const limit = focusable + 15;
  for (let i = 0; i < limit; i++) {
    await key('keyDown', 'Tab', 'Tab', 9); await key('keyUp', 'Tab', 'Tab', 9); steps++;
    const a = await ev(`(() => { const e = document.activeElement; if (!e || e === document.body) return { body: true }; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); const ring = (parseFloat(s.outlineWidth) > 0 && s.outlineStyle !== 'none') || (s.boxShadow && s.boxShadow !== 'none'); const tw = e.getAttribute('data-tw'); const label = (e.getAttribute('aria-label') || e.innerText || e.getAttribute('title') || e.id || '').trim().replace(/\\s+/g, ' ').slice(0, 30); return { tw, id: e.tagName.toLowerCase() + '|' + (e.className && String(e.className).split(' ')[0]) + '|' + label + '|' + Math.round(r.x) + ',' + Math.round(r.y), fv: e.matches(':focus-visible'), ring, inView: r.bottom > 0 && r.top < innerHeight }; })()`);
    if (a.body) { lostAt = lostAt ?? steps; continue; }
    seen.add(a.id); if (a.tw !== null) visited.add(a.tw);
    if (!a.ring) noRing.push(a.id);
  }
  const missed = await ev(`[...document.querySelectorAll('[data-tw]')].filter((e) => !${JSON.stringify([])}.includes(e.getAttribute('data-tw'))).map((e) => ({ tw: e.getAttribute('data-tw'), tag: e.tagName.toLowerCase(), cls: String(e.className).split(' ')[0], role: e.getAttribute('role'), tabindex: e.getAttribute('tabindex'), text: (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 24), href: (e.getAttribute('href') || '').slice(0, 40), inside: (e.closest('details, [hidden], [aria-hidden=true], [inert], .table-wrap, summary') || {}).tagName || '', y: Math.round(e.getBoundingClientRect().y + scrollY) }))`);
  globalThis.__missed = missed;
  const notReached = missed.filter((m) => !visited.has(m.tw));
  const kinds = {}; for (const m of notReached) { const k = `${m.tag}${m.cls ? '.' + m.cls : ''}${m.tabindex !== null ? '[tabindex=' + m.tabindex + ']' : ''}`; kinds[k] = (kinds[k] || 0) + 1; }
  if (process.env.SHOW) console.log(JSON.stringify(notReached.slice(0, 6)));
  console.log(`   not reached by Tab: ${notReached.length} ->`, JSON.stringify(kinds));
  console.log(`${route.padEnd(14)} focusable ${String(focusable).padStart(3)} | tab stops reached ${String(seen.size).padStart(3)} in ${steps} presses | stops with no ring: ${noRing.length}${noRing.length ? ' e.g. ' + JSON.stringify(noRing.slice(0, 3)) : ''} | focus fell to the page body at press ${lostAt ?? 'never'}`);
}
process.exit(0);
