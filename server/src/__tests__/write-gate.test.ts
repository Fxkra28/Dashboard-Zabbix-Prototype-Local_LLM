import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { assertConfig, config, writeBackEnabled } from '../core/config.js';
import { hostAllowed, hostnameOf, registerHostCheck } from '../http/hostCheck.js';
import { buildTestApp } from './helpers/app.js';

/**
 * Write-back with sign-in off. With auth off every caller is admin, so a dev BFF with a write token
 * in its .env would let any page that reached it acknowledge and close for production. So
 * write-back is off unless ALLOW_WRITE_WITHOUT_AUTH=true, and with auth off only a Host that names
 * this machine is answered.
 */
const { zbxWriteMock } = vi.hoisted(() => ({ zbxWriteMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/zabbix.js')>()),
  zbxWrite: zbxWriteMock,
}));

const saved = {
  enabled: config.auth.enabled,
  allow: config.auth.allowWriteWithoutAuth,
  token: config.zbxWriteToken,
  origin: config.webOrigin,
};

beforeEach(() => {
  zbxWriteMock.mockReset().mockResolvedValue({ eventids: ['109'] });
  config.zbxWriteToken = 'test-only-not-a-real-token';
});
afterEach(() => {
  config.auth.enabled = saved.enabled;
  config.auth.allowWriteWithoutAuth = saved.allow;
  config.zbxWriteToken = saved.token;
  config.webOrigin = saved.origin;
  vi.unstubAllEnvs();
});

describe('writeBackEnabled', () => {
  it('needs a write token, and then either sign-in or the opt-in', () => {
    const cases: [token: string, auth: boolean, optIn: boolean, expected: boolean][] = [
      ['t', true, false, true],
      ['t', true, true, true],
      ['t', false, false, false],
      ['t', false, true, true],
      ['', true, false, false],
      ['', false, true, false],
    ];
    for (const [token, auth, optIn, expected] of cases) {
      config.zbxWriteToken = token;
      config.auth.enabled = auth;
      config.auth.allowWriteWithoutAuth = optIn;
      expect(writeBackEnabled(), `token ${token ? 'set' : 'blank'}, auth ${auth}, opt-in ${optIn}`).toBe(expected);
    }
  });
});

describe('POST /api/problems/acknowledge with sign-in off', () => {
  async function ack() {
    const { actionRoutes } = await import('../routes/actions.js');
    const app = await buildTestApp(actionRoutes);
    const res = await app.inject({ method: 'POST', url: '/api/problems/acknowledge', payload: { eventids: ['109'] } });
    await app.close();
    return res;
  }

  it('is refused with 503 zabbix_write_disabled, and writes nothing, unless the opt-in is set', async () => {
    config.auth.enabled = false;
    config.auth.allowWriteWithoutAuth = false;
    const res = await ack();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'zabbix_write_disabled', message: 'Acknowledge and Close are off while sign-in is off. Tell an administrator.' });
    expect(zbxWriteMock).not.toHaveBeenCalled();
  });

  it('goes through with the opt-in', async () => {
    config.auth.enabled = false;
    config.auth.allowWriteWithoutAuth = true;
    const res = await ack();
    expect(res.statusCode).toBe(200);
    expect(zbxWriteMock).toHaveBeenCalledTimes(1);
  });

  it('is not held back by the opt-in being off while sign-in is on', async () => {
    config.auth.enabled = true;
    config.auth.allowWriteWithoutAuth = false;
    expect((await ack()).statusCode).toBe(200);
  });

  it('still says the token is missing, not the opt-in, when there is no token', async () => {
    config.auth.enabled = false;
    config.auth.allowWriteWithoutAuth = true;
    config.zbxWriteToken = '';
    const res = await ack();
    expect(res.statusCode).toBe(503);
    // The reader is told the feature is not switched on; the setting to change is in the log (plain-wording.test.ts).
    expect(res.json().message).toBe('Acknowledge and Close are not switched on for this portal. Tell an administrator.');
    expect(zbxWriteMock).not.toHaveBeenCalled();
  });
});

describe('assertConfig with sign-in off and a write token', () => {
  const warnings = () => {
    const out: string[] = [];
    assertConfig((m) => out.push(m));
    return out.join('\n');
  };

  it('says write-back is refused, and how to allow it in dev', () => {
    config.auth.enabled = false;
    config.auth.allowWriteWithoutAuth = false;
    expect(warnings()).toMatch(/ZABBIX_WRITE_TOKEN is set but AUTH_ENABLED=false: acknowledge\/close is refused.*ALLOW_WRITE_WITHOUT_AUTH=true/);
  });

  it('warns that anyone who reaches the server can write when the opt-in is on', () => {
    config.auth.enabled = false;
    config.auth.allowWriteWithoutAuth = true;
    expect(warnings()).toMatch(/ALLOW_WRITE_WITHOUT_AUTH=true: with sign-in off, anyone who reaches this server can acknowledge and close/);
  });

  it('says nothing about it with sign-in on', () => {
    const secret = config.auth.jwtSecret;
    config.auth.enabled = true;
    config.auth.jwtSecret = 'test-only-secret-at-least-32-bytes-long';
    try {
      expect(warnings()).not.toMatch(/ALLOW_WRITE_WITHOUT_AUTH/);
    } finally {
      config.auth.jwtSecret = secret;
    }
  });
});

describe('hostnameOf and hostAllowed', () => {
  it('reads the name out of a Host header, whatever the port, brackets or case', () => {
    expect(hostnameOf('localhost')).toBe('localhost');
    expect(hostnameOf('LocalHost:4000')).toBe('localhost');
    expect(hostnameOf('127.0.0.1:5173')).toBe('127.0.0.1');
    expect(hostnameOf('[::1]:4000')).toBe('::1');
    expect(hostnameOf('[::1]')).toBe('::1');
    expect(hostnameOf('localhost.')).toBe('localhost');
  });

  it('returns null for anything that is not a plain host', () => {
    for (const header of [undefined, '', ' ', 'a b', 'evil.com@localhost', 'localhost/x', 'localhost:', 'localhost:123456', 'http://localhost', '[::1', '::1']) {
      expect(hostnameOf(header), String(header)).toBeNull();
    }
  });

  it('accepts localhost, 127.0.0.1, ::1 and the WEB_ORIGIN host, and nothing else', () => {
    const origin = 'http://portal.hcml.test:8081';
    for (const host of ['localhost', 'localhost:4000', '127.0.0.1', '127.0.0.1:8081', '[::1]:4000', 'portal.hcml.test', 'PORTAL.HCML.TEST:8081']) {
      expect(hostAllowed(host, origin), host).toBe(true);
    }
    for (const host of ['evil.example', 'evil.example:4000', '127.0.0.1.evil.example', 'localhost.evil.example', 'notlocalhost', '127.0.0.2', '0.0.0.0', '192.168.1.5:4000', undefined, '']) {
      expect(hostAllowed(host, origin), String(host)).toBe(false);
    }
  });

  it('ignores a WEB_ORIGIN that is not a URL', () => {
    expect(hostAllowed('localhost', 'not a url')).toBe(true);
    expect(hostAllowed('evil.example', 'not a url')).toBe(false);
  });
});

describe('the Host check hook', () => {
  async function server() {
    const app = Fastify({ logger: false });
    // Registered as index.ts does: first, so CORS and the routes never answer a refused Host.
    registerHostCheck(app);
    await app.register(cors, { origin: config.webOrigin, credentials: true });
    app.get('/api/health', async () => ({ ok: true }));
    app.get('/api/hosts', async () => ({ secret: 'estate' }));
    await app.ready();
    return app;
  }
  const at = (host: string, url = '/api/hosts') => ({ url, headers: { host } });

  it('answers 421 to a Host that is not this machine when sign-in is off, and says nothing of the estate', async () => {
    config.auth.enabled = false;
    config.webOrigin = 'http://localhost:5173';
    const app = await server();
    for (const host of ['rebind.evil.example', 'rebind.evil.example:4000', '127.0.0.1.evil.example', '192.168.1.5:4000']) {
      const res = await app.inject(at(host));
      expect(res.statusCode, host).toBe(421);
      expect(res.json()).toEqual({ error: 'misdirected_request', message: 'With sign-in off, this server answers only on localhost.' });
      expect(res.body).not.toContain('estate');
      expect(res.body).not.toContain('rebind');
    }
    await app.close();
  });

  it('answers a Host that names this machine, the WEB_ORIGIN host included', async () => {
    config.auth.enabled = false;
    config.webOrigin = 'http://dev.hcml.test:5173';
    const app = await server();
    for (const host of ['localhost:4000', '127.0.0.1:4000', '[::1]:4000', 'dev.hcml.test:5173']) {
      expect((await app.inject(at(host))).statusCode, host).toBe(200);
    }
    // The container's health check calls 127.0.0.1 on the BFF's port.
    expect((await app.inject(at('127.0.0.1:4000', '/api/health'))).statusCode).toBe(200);
    await app.close();
  });

  it('refuses a rebinding page before CORS answers its preflight', async () => {
    config.auth.enabled = false;
    config.webOrigin = 'http://localhost:5173';
    const app = await server();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/hosts',
      headers: { host: 'rebind.evil.example', origin: 'http://rebind.evil.example', 'access-control-request-method': 'GET' },
    });
    expect(res.statusCode).toBe(421);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('checks nothing with sign-in on: the token does that', async () => {
    config.auth.enabled = true;
    const app = await server();
    expect((await app.inject(at('rebind.evil.example'))).statusCode).toBe(200);
    await app.close();
  });

  it('is registered in index.ts before CORS and every route', () => {
    const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const hook = index.indexOf('registerHostCheck(app)');
    expect(hook).toBeGreaterThan(-1);
    for (const later of ['await app.register(cors', 'await registerRateLimit(app)', 'await setupAuth(app)', 'await app.register(hostRoutes)']) {
      expect(index.indexOf(later), later).toBeGreaterThan(hook);
    }
  });
});

// Last in the file: it resets the module registry to read the variable afresh, which would split `config` in two for any test after it.
describe('ALLOW_WRITE_WITHOUT_AUTH', () => {
  async function optIn(value: string | undefined) {
    vi.resetModules();
    vi.stubEnv('ALLOW_WRITE_WITHOUT_AUTH', value);
    return (await import('../core/config.js')).config.auth.allowWriteWithoutAuth;
  }

  it('is off when unset, empty or anything but "true"', async () => {
    for (const value of [undefined, '', 'false', '0', '1', 'yes', 'on']) expect(await optIn(value), String(value)).toBe(false);
  });

  it('is on for "true", whatever the case or the spaces, as AUTH_ENABLED is read', async () => {
    for (const value of ['true', 'TRUE', ' True ']) expect(await optIn(value), value).toBe(true);
  });
});
