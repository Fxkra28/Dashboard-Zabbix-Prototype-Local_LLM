// A read-only audit of every page of a running portal, in headless Chrome over the DevTools protocol (no packages).
//
//   node page-audit.mjs --base http://127.0.0.1:5199 [--theme light|dark] [--view 1440x900] [--routes /,/problems] [--out file.json]
//
// Per page: console errors and failed requests, Chrome's own issues (Content-Security-Policy, low text contrast, form
// labels), load timing (LCP, layout shift, bytes, requests, the slowest API call), and a few checks of the markup
// (title, lang, names of buttons and links, labelled fields, tab stops, touch targets under 24 px, duplicate ids).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const BASE = (arg('base') || '').replace(/\/$/, '');
const THEME = arg('theme') || 'light';
const [VW, VH] = (arg('view') || '1440x900').split('x').map(Number);
const MOBILE = VW < 500;
const OUT = arg('out');
const ROUTES = (arg('routes') || '/,/problems,/sites,/hosts,/devices,/latest,/graphs,/maps,/network,/links,/services,/sla,/reports/availability,/reports/capacity,/reports/noise,/reports/top-triggers,/reports/inventory,/assistant,/no-such-page').split(',');
if (!BASE) { console.error('Needs --base'); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), 'hcml-audit-'));
const chrome = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic', '--disable-extensions', '--disable-sync', '--hide-scrollbars', '--force-color-profile=srgb', '--lang=en-ID', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

async function connect() {
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
  return {
    send: (method, params = {}, sessionId) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej, method }); ws.send(JSON.stringify({ id: n, method, params, sessionId })); }),
    onEvent: (fn) => listeners.push(fn),
  };
}
const { send, onEvent } = await connect();
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const cdp = (m, p) => send(m, p, sessionId);
for (const d of ['Page', 'Runtime', 'Network', 'Log', 'Audits']) await cdp(`${d}.enable`);
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: THEME }] });
await cdp('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Jakarta' }).catch(() => undefined);
await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: MOBILE });
// LCP and layout shift, recorded from the first byte of every document.
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__lcp = 0; window.__cls = 0;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
` });

let cur = null; // the page being measured
onEvent((method, p) => {
  if (!cur) return;
  if (method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning')) cur.console.push(`${p.type}: ${(p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160)}`);
  if (method === 'Runtime.exceptionThrown') cur.console.push(`exception: ${(p.exceptionDetails.exception?.description || p.exceptionDetails.text || '').slice(0, 160)}`);
  if (method === 'Log.entryAdded' && (p.entry.level === 'error' || p.entry.level === 'warning')) cur.console.push(`${p.entry.source}/${p.entry.level}: ${p.entry.text.slice(0, 200)}`);
  if (method === 'Audits.issueAdded') {
    const i = p.issue; const d = i.details;
    if (i.code === 'LowTextContrastIssue') { const c = d.lowTextContrastIssueDetails; cur.contrast.push({ sel: c.violatingNodeSelector, ratio: +c.contrastRatio.toFixed(2), need: c.thresholdAA, size: c.fontSize, weight: c.fontWeight }); }
    else if (i.code === 'ContentSecurityPolicyIssue') { const c = d.contentSecurityPolicyIssueDetails; cur.csp.push(`${c.isReportOnly ? 'report-only ' : ''}${c.violatedDirective} blocked ${String(c.blockedURL || c.contentSecurityPolicyViolationType).slice(0, 80)}`); }
    else if (i.code === 'GenericIssue') cur.generic.push(d.genericIssueDetails.errorType);
    else cur.other.push(i.code);
  }
  if (method === 'Network.requestWillBeSent') cur.req.set(p.requestId, { url: p.request.url, t0: p.timestamp, method: p.request.method });
  if (method === 'Network.responseReceived') { const r = cur.req.get(p.requestId); if (r) { r.status = p.response.status; r.type = p.type; r.mime = p.response.mimeType; } }
  if (method === 'Network.loadingFinished') { const r = cur.req.get(p.requestId); if (r) { r.bytes = p.encodedDataLength; r.t1 = p.timestamp; } }
  if (method === 'Network.loadingFailed') { const r = cur.req.get(p.requestId); if (r && !p.canceled) cur.failed.push(`${r.method} ${new URL(r.url).pathname} ${p.errorText}`); }
});

const ev = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };

const MARKUP = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const name = (e) => (e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') && [...e.getAttribute('aria-labelledby').split(' ')].map((i) => document.getElementById(i)?.textContent || '').join(' ')) || e.innerText || e.textContent || e.getAttribute('title') || e.getAttribute('alt') || '').trim();
  const sel = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '');
  const out = { title: document.title, lang: document.documentElement.lang, h1: document.querySelectorAll('h1').length, landmarks: { main: document.querySelectorAll('main').length, nav: document.querySelectorAll('nav').length, header: document.querySelectorAll('header, [role=banner]').length } };
  out.imgNoAlt = [...document.querySelectorAll('img:not([alt])')].map(sel).slice(0, 3);
  out.noName = [...document.querySelectorAll('button, a[href], [role=button], [role=link], [role=tab], summary')].filter((e) => vis(e) && !name(e)).map(sel).slice(0, 6);
  out.noLabel = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter((e) => vis(e) && !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !e.getAttribute('title')).map(sel).slice(0, 6);
  out.posTabindex = [...document.querySelectorAll('[tabindex]')].filter((e) => Number(e.getAttribute('tabindex')) > 0).map(sel).slice(0, 3);
  const small = [...document.querySelectorAll('button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=checkbox], summary')].filter(vis).filter((e) => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; });
  out.smallTargets = small.length; out.smallExamples = small.slice(0, 4).map((e) => sel(e) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
  const ids = {}; document.querySelectorAll('[id]').forEach((e) => { ids[e.id] = (ids[e.id] || 0) + 1; }); out.dupIds = Object.entries(ids).filter(([, n]) => n > 1).map(([i]) => i).slice(0, 4);
  out.skipLink = !!document.querySelector('a[href^="#"]:not([href="#"])');
  out.overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  out.errorState = [...document.querySelectorAll('.state.error, [role=alert]')].map((e) => e.innerText.trim().slice(0, 80)).slice(0, 3);
  out.rows = document.querySelectorAll('main tbody tr').length;
  return out;
})()`;


// Text contrast, worked out in the page: Chrome's own Audits.checkContrast is not in this build, so this does what axe does.
const CONTRAST = `(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const norm = (css) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3]));
  const backdrop = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage !== 'none') return null;
      const c = norm(s.backgroundColor);
      if (c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break; }
    }
    let base = [255, 255, 255];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const opacityOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  const sel = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/)[0] : '');
  const seen = new Map();
  let checked = 0, skipped = 0;
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const text = n.nodeValue.trim(); if (!text) continue;
    const el = n.parentElement; if (!el) continue;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'].includes(el.tagName)) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    if (!rects.length) continue;
    if (el.closest('[disabled], [aria-disabled="true"]')) { skipped++; continue; }
    const bg = backdrop(el); if (!bg) { skipped++; continue; }
    let fg = norm(s.color); fg[3] *= opacityOf(el);
    const fgOnBg = over(fg, bg);
    const r = ratio(fgOnBg, bg);
    const px = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    checked++;
    if (r + 0.005 < need) {
      const key = [fgOnBg.map(Math.round).join(','), bg.map(Math.round).join(','), px, bold].join('|');
      const hit = seen.get(key) || { sel: sel(el), sample: text.slice(0, 30), ratio: +r.toFixed(2), need, fg: fgOnBg.map(Math.round), bg: bg.map(Math.round), size: px, bold, count: 0 };
      hit.count++; seen.set(key, hit);
    }
  }
  // placeholders
  for (const i of document.querySelectorAll('input[placeholder], textarea[placeholder]')) {
    const s = getComputedStyle(i, '::placeholder'); const bg = backdrop(i); if (!bg) continue;
    const fg = norm(s.color); const fgOnBg = over(fg, bg); const r = ratio(fgOnBg, bg); checked++;
    if (r + 0.005 < 4.5) { const key = 'ph|' + fgOnBg.map(Math.round).join(',') + '|' + bg.map(Math.round).join(','); const hit = seen.get(key) || { sel: 'placeholder of ' + sel(i), sample: i.placeholder.slice(0, 30), ratio: +r.toFixed(2), need: 4.5, fg: fgOnBg.map(Math.round), bg: bg.map(Math.round), size: parseFloat(s.fontSize), bold: false, count: 0 }; hit.count++; seen.set(key, hit); }
  }
  return { checked, skipped, failing: [...seen.values()].sort((a, b) => a.ratio - b.ratio).slice(0, 12) };
})()`;

const results = [];
for (const route of ROUTES) {
  cur = { route, console: [], contrast: [], csp: [], generic: [], other: [], failed: [], req: new Map() };
  await ev(`(localStorage.setItem('hcml.sidebar.collapsed', 'false'), ${THEME === 'dark' ? "localStorage.setItem('hcml.theme', 'dark')" : "localStorage.removeItem('hcml.theme')"}, true)`).catch(() => undefined);
  const t0 = Date.now();
  await cdp('Page.navigate', { url: BASE + route });
  await sleep(1200);
  let calm = 0;
  for (let i = 0; i < 80; i++) {
    const s = await ev(`({ ready: document.readyState, busy: document.querySelectorAll('.spinner,[aria-busy="true"]').length })`).catch(() => null);
    calm = s && s.ready === 'complete' && s.busy === 0 ? calm + 1 : 0;
    if (calm >= 3) break;
    await sleep(300);
  }
  await sleep(900);
  await sleep(300);
  const contrast = await ev(CONTRAST);
  const m = await ev(MARKUP);
  const perf = await ev(`(() => { const n = performance.getEntriesByType('navigation')[0]; return { lcp: Math.round(window.__lcp), cls: +window.__cls.toFixed(3), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; })()`);
  const metrics = Object.fromEntries((await cdp('Performance.getMetrics').catch(() => ({ metrics: [] }))).metrics.map((x) => [x.name, x.value]));
  const reqs = [...cur.req.values()].filter((r) => r.bytes !== undefined);
  const api = reqs.filter((r) => r.url.includes('/bff/api/') && !r.url.includes('/stream'));
  const sum = (a) => a.reduce((n, r) => n + r.bytes, 0);
  const slow = api.map((r) => ({ path: new URL(r.url).pathname.replace('/bff', '') + new URL(r.url).search.slice(0, 40), ms: Math.round((r.t1 - r.t0) * 1000), kb: Math.round(r.bytes / 1024) })).sort((a, b) => b.ms - a.ms)[0];
  const bad = [...cur.req.values()].filter((r) => r.status >= 400 && !r.url.includes('/api/auth')).map((r) => `${r.status} ${new URL(r.url).pathname}`);
  results.push({
    route, ...m, ...perf, wallMs: Date.now() - t0,
    requests: reqs.length, kbTotal: Math.round(sum(reqs) / 1024), kbJs: Math.round(sum(reqs.filter((r) => r.type === 'Script')) / 1024), kbApi: Math.round(sum(api) / 1024), apiCalls: api.length, slowestApi: slow,
    heapMb: Math.round((metrics.JSHeapUsedSize || 0) / 1048576), domNodes: metrics.Nodes,
    consoleProblems: [...new Set(cur.console)].slice(0, 6), failed: [...new Set([...cur.failed, ...bad])].slice(0, 6),
    csp: [...new Set(cur.csp)].slice(0, 6), contrast: contrast.failing, contrastChecked: contrast.checked, contrastSkipped: contrast.skipped, generic: [...new Set(cur.generic)], otherIssues: [...new Set(cur.other)],
  });
  const r = results[results.length - 1];
  const worst = r.contrast.length ? Math.min(...r.contrast.map((c) => c.ratio)) : null;
  const failingCount = r.contrast.reduce((n, c) => n + c.count, 0);
  console.log(`${route.padEnd(24)} lcp ${String(r.lcp).padStart(5)}ms cls ${r.cls} ${String(r.kbTotal).padStart(5)}kB ${String(r.requests).padStart(3)}req api ${r.apiCalls}/${r.kbApi}kB slow ${r.slowestApi ? r.slowestApi.ms + 'ms ' + r.slowestApi.path : '-'} | console ${r.consoleProblems.length} failed ${r.failed.length} csp ${r.csp.length} contrast ${failingCount}/${r.contrastChecked}${worst ? ' (worst ' + worst + ')' : ''} noName ${r.noName.length} noLabel ${r.noLabel.length} small ${r.smallTargets} dupId ${r.dupIds.length}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
process.exit(0);
