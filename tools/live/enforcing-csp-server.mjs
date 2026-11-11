// A stand-in for the web container's nginx, for a trial: serves web/dist with an ENFORCING Content-Security-Policy
// (the production nginx enforces the same policy since 14 Oct 2026) and proxies /bff to the dev BFF. Nothing here ships.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
// web/dist of this repository, built with `npm run build` in web/.
const DIST = process.env.DIST || fileURLToPath(new URL('../../web/dist', import.meta.url));
const PORT = Number(process.env.PORT || 5199);
const CSP = "default-src 'self'; script-src 'self'; style-src " + (process.env.STYLE_SRC || "'self' 'unsafe-inline'") + "; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer((req, res) => {
  if (req.url.startsWith('/bff/')) {
    const up = http.request({ host: '127.0.0.1', port: Number(process.env.BFF_PORT || 4000), method: req.method, path: req.url.slice(4), headers: { ...req.headers, host: `localhost:${PORT}` } }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { res.writeHead(502); res.end('bad gateway'); });
    // A browser that goes away ends its stream upstream too, as nginx does; without this the BFF counts it for ever.
    res.on('close', () => up.destroy());
    req.pipe(up);
    return;
  }
  if (req.url === '/__neg') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': CSP });
    res.end('<!doctype html><html lang="en"><head><title>neg</title></head><body><main><h1>Negative control</h1><p style="color:#bbb;background:#ccc">grey text on grey, low contrast</p><input><button></button><script>window.inline=1</script><img src="https://example.invalid/x.png" alt=""></main></body></html>');
    return;
  }
  let path = decodeURIComponent(req.url.split('?')[0]);
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' });
  res.end(readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`csp trial server on :${PORT}`));
