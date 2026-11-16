// Closed-loop load test of read endpoints: N clients, each firing its next request as soon as the last one ends.
const BASE = process.argv[2]; const CLIENTS = Number(process.argv[3] || 20); const SECONDS = Number(process.argv[4] || 20);
// The month that has just closed in Asia/Jakarta (UTC+7, no daylight saving), as signedin_check.py works it out: the portal refuses a month more than about 400 days back,
// so a fixed one stops working. MONTH names another.
const MONTH = process.env.MONTH || (() => { const d = new Date(Date.now() + 7 * 3600e3); const m = d.getUTCMonth(); return m === 0 ? `${d.getUTCFullYear() - 1}-12` : `${d.getUTCFullYear()}-${String(m).padStart(2, '0')}`; })();
// A host to ask Latest data about: HOSTID, or the first host the BFF lists.
const HOSTID = process.env.HOSTID || (await (await fetch(BASE + '/api/hosts')).json())[0]?.hostid;
const MIX = ['/api/problems', '/api/hosts/overview', '/api/sites', '/api/stats', '/api/freshness', `/api/sli?month=${MONTH}&profile=hcml-report`, `/api/latest?hostid=${HOSTID}&page=1&pageSize=100`, '/api/net/devices', '/api/links', '/api/reports/problems-by-group', `/api/graph?itemids=63855&month=${MONTH}`, '/api/reports/noise?days=30&top=100'];
const lat = []; let errors = 0; const codes = {}; const end = Date.now() + SECONDS * 1000;
// warm every endpoint once so the figures are of the cached path, then measure
for (const u of MIX) await fetch(BASE + u, { headers: { 'Accept-Encoding': 'gzip' } }).then((r) => r.arrayBuffer());
async function client(i) {
  let k = i;
  while (Date.now() < end) {
    const u = MIX[k++ % MIX.length]; const t = performance.now();
    try { const r = await fetch(BASE + u, { headers: { 'Accept-Encoding': 'gzip' } }); await r.arrayBuffer(); codes[r.status] = (codes[r.status] || 0) + 1; if (!r.ok) errors++; } catch { errors++; }
    lat.push(performance.now() - t);
  }
}
const t0 = performance.now();
await Promise.all(Array.from({ length: CLIENTS }, (_, i) => client(i)));
const secs = (performance.now() - t0) / 1000; lat.sort((a, b) => a - b);
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))].toFixed(1);
console.log(`${CLIENTS} clients, ${secs.toFixed(0)} s: ${lat.length} requests (${(lat.length / secs).toFixed(0)}/s), errors ${errors}, statuses ${JSON.stringify(codes)}`);
console.log(`latency ms: p50 ${q(0.5)}  p95 ${q(0.95)}  p99 ${q(0.99)}  max ${lat[lat.length - 1].toFixed(1)}`);
