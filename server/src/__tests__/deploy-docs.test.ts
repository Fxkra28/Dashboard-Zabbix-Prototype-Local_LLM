import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The deployment documents, read as text.
 *
 * Nothing else notices when a document stops matching the deployment: a diagram says HTTPS where
 * nginx listens on plain HTTP, a page says "nothing to back up" while the users and tokens sit in
 * untracked .env files, a settings list falls behind docker-compose.yml. This keeps each of those
 * true, in whichever copy it runs in. The TLS recipes themselves cannot run here: what is checked
 * is that the page still names what a recipe needs, and that the BFF does with the proxy's headers
 * what the page says it does.
 */
const root = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(root(rel), 'utf8');
/** Prose with its line breaks folded, so a phrase is found wherever a line was wrapped. */
const flat = (rel: string) => read(rel).replace(/\s+/g, ' ');

/** The credentials: the settings that must never appear with a value outside `.env`. */
const SECRETS = ['JWT_SECRET', 'ZABBIX_API_TOKEN', 'ZABBIX_WRITE_TOKEN', 'PORTAL_PASS', 'PORTAL_USERS', 'PORTAL_USER', 'ANTHROPIC_API_KEY', 'AI_API_KEY', 'MAIL_PASS'];
/** Fixed in docker-compose.yml, not read from anyone's `.env`: the port, the heap size set with the memory limit, and the folder of the state volume. */
const NOT_SETTINGS = ['PORT', 'NODE_OPTIONS', 'PORTAL_STATE_DIR'];
/** Settings whose default differs between the two copies, so the example shows them as comments. */
const PER_COPY = ['WEB_PORT', 'WEB_ORIGIN', 'SESSION_COOKIE', 'AI_PROVIDER', 'AI_BASE_URL', 'MAIL_PROVIDER', 'MAIL_HOST', 'MAIL_PORT', 'MAIL_SECURITY', 'MAIL_USER', 'MAIL_FROM', 'MAIL_TO', 'MAIL_ALLOWED_DOMAINS', 'MAIL_SCHEDULE'];

/** The portal-bff service's `environment:` block: each name with its default, or null where it is fixed. Plain line reading, as compose-env.test.ts does. */
function composeEnv(): Map<string, string | null> {
  const lines = read('docker-compose.yml').split('\n');
  const start = lines.findIndex((l) => /^ {2}portal-bff:\s*$/.test(l));
  const env = lines.findIndex((l, i) => i > start && /^ {4}environment:\s*$/.test(l));
  expect(start, 'a portal-bff service').toBeGreaterThanOrEqual(0);
  expect(env, 'its environment block').toBeGreaterThan(start);
  const out = new Map<string, string | null>();
  for (const line of lines.slice(env + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (!/^ {6}\S/.test(line)) break;
    const m = /^ {6}([A-Z][A-Z0-9_]*):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const d = /^\$\{[A-Z0-9_]+:-([^}]*)\}$/.exec(m[2]);
    out.set(m[1], d ? d[1] : null);
  }
  return out;
}

describe('the browser-to-nginx hop is drawn as plain HTTP (tracker IN-26)', () => {
  // The same sentence in every copy and every document, so that the two copies cannot disagree again.
  const NOTE = "plain HTTP on this computer's loopback address";
  const DOCS = ['README.md', 'docs/index.md', 'docs/setup/01-the-big-picture.md', 'docs/flow/README.md'];

  it.each(DOCS)('%s labels the hop HTTP, says it is loopback and points at the TLS page', (rel) => {
    const text = read(rel);
    expect(text, rel).not.toMatch(/HTTPS\s*\+\s*SSE/);
    expect(flat(rel), rel).toContain(NOTE);
    expect(text, rel).toMatch(/operations\/tls\.md/);
    // The port is the one compose maps to, which is the one nginx.conf listens on (container-hardening.test.ts).
    const inside = /127\.0\.0\.1:\$\{WEB_PORT:-\d+\}:(\d+)"/.exec(read('docker-compose.yml'))?.[1];
    expect(inside, 'compose publishes portal-web on 127.0.0.1').toBeDefined();
    expect(flat(rel), rel).toContain(`nginx listens on port ${inside} inside its container`);
  });

  it('has no HTTPS label on any diagram source', () => {
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(root(dir), { withFileTypes: true })) {
        if (e.isDirectory()) walk(`${dir}/${e.name}`);
        else if (e.name.endsWith('.mmd')) sources.push(`${dir}/${e.name}`);
      }
    };
    walk('docs');
    expect(sources.length).toBeGreaterThanOrEqual(6);
    // Capitals only: a "https://" link in a comment is not a label.
    for (const rel of sources) expect(read(rel), rel).not.toMatch(/HTTPS(?!:\/\/)/);
  });
});

describe('docs/operations/tls.md (tracker IN-26)', () => {
  const text = read('docs/operations/tls.md');
  const fences = [...text.matchAll(/```(\w*)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1], body: m[2] }));
  const fence = (lang: string) => fences.find((f) => f.lang === lang)?.body ?? '';
  /** The host port this copy publishes on loopback (1) and the container port it maps to (2). */
  const published = /127\.0\.0\.1:\$\{WEB_PORT:-(\d+)\}:(\d+)"/.exec(read('docker-compose.yml'));

  it('gives an nginx server block that terminates TLS, redirects, forwards the protocol and the Host, and sends HSTS', () => {
    const nginx = fence('nginx');
    for (const needle of [
      'listen 443 ssl;',
      'ssl_certificate ',
      'return 301 https://',
      'Strict-Transport-Security',
      'proxy_set_header X-Forwarded-Proto $scheme;',
      'proxy_set_header Host $http_host;',
      'proxy_buffering off;',
    ]) {
      expect(nginx, needle).toContain(needle);
    }
    // The BFF sends none (hsts: false, no-store.test.ts); a browser reads only the first, so the recipe hides one in case helmet's is turned on.
    expect(nginx).toContain('proxy_hide_header Strict-Transport-Security;');
  });

  it('gives a Caddy site and Traefik labels that send HSTS, and the stream setting for Caddy', () => {
    expect(fence('caddyfile')).toContain('Strict-Transport-Security');
    expect(fence('caddyfile')).toMatch(/reverse_proxy 127\.0\.0\.1:\d+/);
    expect(fence('caddyfile')).toContain('flush_interval -1');
    expect(fence('yaml')).toContain('headers.stsSeconds=');
  });

  it('gives the two .env settings as lines to copy, and starts HSTS short', () => {
    expect(fence('text')).toContain('TRUST_PROXY=2');
    expect(fence('text')).toMatch(/^WEB_ORIGIN=https:\/\//m);
    expect(text).toContain('max-age=300');
    expect(text).toContain('31536000');
  });

  it('forwards to the loopback port this copy publishes, and names the other copy\'s port too', () => {
    expect(published, 'portal-web publishes on 127.0.0.1').not.toBeNull();
    expect(['8081', '8082']).toContain(published![1]);
    expect(text).toContain('127.0.0.1:8081');
    expect(text).toContain('127.0.0.1:8082');
  });

  // nginx moved from 80 to 8080 when it went non-root: a recipe that still said 80 would
  // send a proxy on the compose network, or Traefik's load balancer, to a port nothing listens on.
  it('names the port nginx listens on inside the container, wherever a recipe needs it', () => {
    const inside = published![2];
    expect(text).toContain(`listens on port ${inside},`);
    expect(text).toContain(`http://portal-web:${inside}`);
    expect(text).toContain(`loadbalancer.server.port=${inside}`);
    expect(text).not.toMatch(/portal-web:80\b(?!\d)/);
    expect(text).not.toMatch(/server\.port=80\b(?!\d)/);
  });

  it('says it was not run against a live proxy', () => {
    expect(flat('docs/operations/tls.md')).toContain('were **not run** against a live proxy');
  });
});

describe('TLS in front: what the BFF does with the proxy headers (docs/operations/tls.md)', () => {
  afterEach(() => vi.unstubAllEnvs());

  /** One request through the chain the page describes: client, the TLS proxy, the portal's nginx, then the BFF. */
  async function seen(trustProxy: string | undefined, headers: Record<string, string>) {
    vi.resetModules();
    vi.stubEnv('TRUST_PROXY', trustProxy);
    const { config, trustProxyOption } = await import('../core/config.js');
    const app = Fastify({ trustProxy: trustProxyOption(config.trustProxy) });
    app.get('/p', async (req) => ({ protocol: req.protocol, ip: req.ip, host: req.headers.host }));
    // The BFF's own peer is the nginx container. The client is 203.0.113.9; the TLS proxy wrote it, and nginx appended the proxy's 192.168.1.5.
    const res = await app.inject({
      url: '/p',
      remoteAddress: '172.18.0.3',
      headers: { host: 'portal.example.com', 'x-forwarded-for': '203.0.113.9, 192.168.1.5', ...headers },
    });
    await app.close();
    return res.json() as { protocol: string; ip: string; host: string };
  }

  it('with TRUST_PROXY=2 reads the browser\'s address and the https the proxy sent, and keeps the Host', async () => {
    const r = await seen('2', { 'x-forwarded-proto': 'https' });
    expect(r).toEqual({ protocol: 'https', ip: '203.0.113.9', host: 'portal.example.com' });
  });

  it('with the default TRUST_PROXY=true takes the TLS proxy for the client, which is why the page says 2', async () => {
    const r = await seen('true', { 'x-forwarded-proto': 'https' });
    expect(r.ip).toBe('192.168.1.5');
    expect(r.protocol).toBe('https');
  });

  it('takes the request for plain HTTP when the proxy sends no X-Forwarded-Proto: the session cookie would not be Secure', async () => {
    expect((await seen('2', {})).protocol).toBe('http');
  });

  it('ignores a client\'s own X-Forwarded-Proto when no proxy is trusted', async () => {
    expect((await seen(undefined, { 'x-forwarded-proto': 'https' })).protocol).toBe('http');
  });
});

describe('docs/operations/backup-and-restore.md (tracker IN-24)', () => {
  const text = read('docs/operations/backup-and-restore.md');

  it('names both .env files and what is in them', () => {
    expect(text).toContain('`.env` in the repository root');
    expect(text).toContain('`server/.env`');
    for (const name of ['PORTAL_USERS', 'JWT_SECRET', 'ZABBIX_API_TOKEN', 'ZABBIX_WRITE_TOKEN']) expect(text, name).toContain(name);
  });

  it('says to keep the copy encrypted and off this computer, with a command that derives its key properly', () => {
    expect(text).toMatch(/encrypted copy/i);
    expect(text).toContain('off this computer');
    // `openssl enc` without -pbkdf2 derives the key from the passphrase with a single MD5 pass.
    for (const m of text.matchAll(/openssl enc [^\n\\]*/g)) expect(m[0], m[0]).toContain('-pbkdf2');
    expect(text).toMatch(/write outside the repository folder/i);
  });

  it('has a numbered restore checklist that ends in a health check and a fresh copy', () => {
    const checklist = text.split('## Restore checklist')[1]?.split('\n## ')[0] ?? '';
    const steps = [...checklist.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(checklist).toContain('/bff/api/health');
    expect(checklist).toContain('fresh encrypted copy');
  });

  // /api/health tells only a signed-in caller whether Zabbix answers (health.test.ts). A step
  // that sent someone to look for `ready` in a bare curl would send them to a field that is not there.
  it('does not promise `ready` to the curl, which is not signed in', () => {
    const steps = text.split('## Restore checklist')[1]?.split('\n## ')[0]?.split(/^(?=\d+\. )/m) ?? [];
    const curlStep = steps.find((s) => s.includes('curl '));
    expect(curlStep, 'a step that runs curl').toBeDefined();
    expect(curlStep).not.toContain('ready');
    const readyStep = steps.find((s) => s.includes('ready.ok'));
    expect(readyStep, 'a step that names ready.ok').toBeDefined();
    expect(readyStep).toMatch(/signed.in/);
  });

  it('says what to do with no copy, and owns up to the older claim it corrects', () => {
    expect(text).toContain('## If there is no copy');
    expect(flat('docs/operations/backup-and-restore.md')).toContain('older claim');
  });
});

describe('"nothing to back up" is gone from the documents it was in (tracker IN-24)', () => {
  it.each(['docs/index.md', 'docs/architecture/adr/0003-no-database.md', 'docs/flow/README.md'])('%s', (rel) => {
    expect(flat(rel)).not.toMatch(/nothing to back up/i);
  });

  it('docs/index.md says the .env files are kept, and links the backup page', () => {
    const text = flat('docs/index.md');
    expect(text).toContain('only its own settings');
    expect(text).toContain('untracked `.env` files');
    expect(text).toContain('operations/backup-and-restore.md');
  });

  it('ADR-0003 lists the .env files as the portal\'s state, and links the backup page', () => {
    const text = flat('docs/architecture/adr/0003-no-database.md');
    expect(text).toContain("The `.env` files are the portal's only state, and nothing backs them up");
    expect(text).toContain('operations/backup-and-restore.md');
    expect(text).toContain('Amended: 2026-10-07');
  });

  it.each(['README.md', 'docs/index.md'])('%s links both operations pages', (rel) => {
    const text = read(rel);
    expect(text, rel).toContain('operations/backup-and-restore.md');
    expect(text, rel).toContain('operations/tls.md');
  });

  it('the setup guide links the TLS page from §1 and the backup page from §11', () => {
    expect(read('docs/setup/01-the-big-picture.md')).toContain('operations/tls.md');
    expect(read('docs/setup/11-running-deploying.md')).toContain('operations/backup-and-restore.md');
  });
});

describe('deploy/settings.example (tracker IN-24)', () => {
  const lines = read('deploy/settings.example').split('\n');
  const active = new Map<string, string>();
  for (const line of lines) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) active.set(m[1], m[2]);
  }
  const compose = composeEnv();

  it('is not named like a .env file, so nothing treats it as one', () => {
    expect(existsSync(root('deploy/settings.example'))).toBe(true);
    expect(readdirSync(root('deploy')).filter((n) => n.includes('.env'))).toEqual([]);
  });

  it('holds no secret: no line, active or commented, sets one', () => {
    for (const name of SECRETS) {
      expect(active.has(name), name).toBe(false);
      expect(lines.some((l) => new RegExp(`^\\s*#?\\s*${name}=`).test(l)), `${name} in a comment`).toBe(false);
    }
  });

  it('sets only settings that docker-compose.yml passes to the BFF', () => {
    const unknown = [...active.keys()].filter((k) => !compose.has(k));
    expect(unknown, 'settings the example sets that compose never passes').toEqual([]);
  });

  it('lists every non-secret setting that compose passes, so it cannot fall behind', () => {
    const listed = (name: string) => lines.some((l) => new RegExp(`^#?\\s*${name}=`).test(l));
    const missing = [...compose.keys(), 'WEB_PORT'].filter((k) => !SECRETS.includes(k) && !NOT_SETTINGS.includes(k) && !listed(k));
    expect(missing, 'passed by docker-compose.yml but absent from deploy/settings.example').toEqual([]);
  });

  it('gives each active setting the default docker-compose.yml gives it', () => {
    for (const [name, value] of active) {
      const fallback = compose.get(name);
      expect(fallback, `${name}: compose gives it a default, or move it to the commented per-copy lines`).not.toBeNull();
      expect(value, name).toBe(fallback);
    }
  });

  it('keeps the settings that differ between the copies as comments, naming both values', () => {
    for (const name of PER_COPY) {
      expect(active.has(name), `${name} would give one copy the other's value`).toBe(false);
      expect(lines.some((l) => l.startsWith(`# ${name}=`)), name).toBe(true);
    }
    const port = lines.find((l) => l.startsWith('# WEB_PORT='));
    expect(port).toContain('8081');
    expect(port).toContain('8082');
  });
});

describe('the new documents', () => {
  it.each(['docs/operations/tls.md', 'docs/operations/backup-and-restore.md', 'deploy/settings.example'])('%s has no em or en dash', (rel) => {
    // Built from code points, so that this file holds neither character itself.
    const dashes = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
    expect(read(rel)).not.toMatch(dashes);
  });
});
