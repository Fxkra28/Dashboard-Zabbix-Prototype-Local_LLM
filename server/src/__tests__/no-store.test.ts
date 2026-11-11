import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { askedPath, registerNoStore } from '../http/noStore.js';

/** Signed-in replies tell a browser and a proxy to keep nothing. */

async function appWithRoutes() {
  const app = Fastify({ logger: false });
  registerNoStore(app);
  app.get('/api/problems', async () => ({ ok: true }));
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/sli/export', async (_req, reply) => reply.header('Cache-Control', 'private, no-store').send('x'));
  app.get('/api/stream', async (_req, reply) => reply.header('Cache-Control', 'no-cache').send('x'));
  app.get('/elsewhere', async () => ({ ok: true }));
  app.get('/api/boom', async () => {
    throw new Error('boom');
  });
  await app.ready();
  return app;
}

describe('Cache-Control on /api replies', () => {
  it('sets no-store on a normal reply, with a query string too', async () => {
    const app = await appWithRoutes();
    expect((await app.inject({ url: '/api/problems' })).headers['cache-control']).toBe('no-store');
    expect((await app.inject({ url: '/api/problems?days=7' })).headers['cache-control']).toBe('no-store');
  });

  it('sets it on an error reply as well', async () => {
    const app = await appWithRoutes();
    const res = await app.inject({ url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('leaves the public health check alone', async () => {
    const app = await appWithRoutes();
    expect((await app.inject({ url: '/api/health' })).headers['cache-control']).toBeUndefined();
    expect((await app.inject({ url: '/api/health?x=1' })).headers['cache-control']).toBeUndefined();
  });

  it('keeps a value the route chose', async () => {
    const app = await appWithRoutes();
    expect((await app.inject({ url: '/api/sli/export' })).headers['cache-control']).toBe('private, no-store');
    expect((await app.inject({ url: '/api/stream' })).headers['cache-control']).toBe('no-cache');
  });

  it('does not touch a path outside /api', async () => {
    const app = await appWithRoutes();
    expect((await app.inject({ url: '/elsewhere' })).headers['cache-control']).toBeUndefined();
  });

  it('reads a path written with encoded letters as the path it names (SC-34)', async () => {
    const app = await appWithRoutes();
    expect((await app.inject({ url: '/%61pi/problems' })).headers['cache-control']).toBe('no-store');
    expect((await app.inject({ url: '/api/%70roblems?days=7' })).headers['cache-control']).toBe('no-store');
    expect((await app.inject({ url: '/%61pi/nothing-here' })).headers['cache-control']).toBe('no-store');
    expect((await app.inject({ url: '/%61pi/health' })).headers['cache-control']).toBeUndefined();
    expect((await app.inject({ url: '/%65lsewhere' })).headers['cache-control']).toBeUndefined();
  });

  it('cuts the host of an absolute-form request line, which a direct client may send (SC-34)', async () => {
    const app = await appWithRoutes();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const get = (path: string) =>
      new Promise<string | undefined>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.headers['cache-control']));
        });
        req.on('error', reject);
        req.end();
      });
    try {
      expect(await get('http://example.test/api/problems')).toBe('no-store');
      expect(await get('HTTPS://example.test:8443/%61pi/problems?days=7')).toBe('no-store');
      expect(await get('http://example.test/api/health')).toBeUndefined();
      expect(await get('http://example.test/elsewhere')).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('cuts the query and decodes the escapes, and keeps the path as it came when an escape is broken (SC-34)', () => {
    expect(askedPath('/%61pi/problems?days=7')).toBe('/api/problems');
    expect(askedPath('http://example.test/api/problems')).toBe('/api/problems');
    expect(askedPath('/api/problems')).toBe('/api/problems');
    expect(askedPath('/api/%E0%A4%A')).toBe('/api/%E0%A4%A'); // Fastify answers such a path with a 400 before any hook runs
  });

  it('keeps the header on a CORS preflight and a HEAD request, as before (SC-34)', async () => {
    const app = Fastify({ logger: false });
    registerNoStore(app);
    await app.register(cors, { origin: 'http://localhost:8081', credentials: true });
    app.get('/api/problems', async () => ({ ok: true }));
    await app.ready();
    const preflight = await app.inject({ method: 'OPTIONS', url: '/api/problems', headers: { origin: 'http://localhost:8081', 'access-control-request-method': 'GET' } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'HEAD', url: '/api/problems' })).headers['cache-control']).toBe('no-store');
  });
});

describe('wiring in index.ts', () => {
  const read = async () => {
    const { readFile } = await import('node:fs/promises');
    return readFile(new URL('../index.ts', import.meta.url), 'utf8');
  };

  it('registers the hook before the guard and the routes', async () => {
    const index = await read();
    const hook = index.indexOf('registerNoStore(app)');
    expect(hook).toBeGreaterThan(-1);
    expect(hook).toBeLessThan(index.indexOf('await setupAuth(app)'));
    expect(hook).toBeLessThan(index.indexOf('await app.register(hostRoutes)'));
  });

  it('turns HSTS off in helmet, because the portal is served over plain HTTP', async () => {
    expect(await read()).toMatch(/await app\.register\(helmet, \{[^}]*hsts: false[^}]*\}\)/);
    const off = Fastify({ logger: false });
    await off.register(helmet, { contentSecurityPolicy: false, hsts: false });
    off.get('/api/x', async () => ({}));
    expect((await off.inject({ url: '/api/x' })).headers['strict-transport-security']).toBeUndefined();
    const on = Fastify({ logger: false });
    await on.register(helmet, { contentSecurityPolicy: false });
    on.get('/api/x', async () => ({}));
    expect((await on.inject({ url: '/api/x' })).headers['strict-transport-security']).toBeDefined();
  });
});
