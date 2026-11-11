import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * A live stream is checked once, when it opens. Signing out must end the streams of that session
 * (SC-40), or a screen that was open keeps receiving frames after the person has gone.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer,olu:operator-pass:operator';
});
vi.mock('../domain/queries.js', async () => {
  const { cached } = await import('../core/cache.js');
  const getProblems = vi.fn().mockResolvedValue([]);
  return {
    getProblems,
    cachedProblems: (opts?: { maxAgeMs?: number }) => cached('problems', 15_000, getProblems, opts),
    PROBLEMS_TTL_MS: 15_000,
  };
});

const HOST = '127.0.0.1:8081';
const page = (token: string) => ({ host: HOST, origin: `http://${HOST}`, 'x-hcml-csrf': '1', cookie: `hcml_session=${token}` });

let app: FastifyInstance | undefined;
const screens: http.ClientRequest[] = [];
afterEach(async () => {
  for (const req of screens.splice(0)) req.destroy();
  await app?.close();
  app = undefined;
});

/** A screen over a real socket: resolves once its first frame has arrived, and tells when the server ends it. */
function openScreen(port: number, token: string) {
  const screen = { ended: false };
  const opened = new Promise<void>((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/stream', headers: { host: HOST, cookie: `hcml_session=${token}` } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`the stream answered ${res.statusCode}`));
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (chunk: string) => {
        body += chunk;
        if (body.includes('\n\n')) resolve();
      });
      res.on('end', () => {
        screen.ended = true;
      });
    });
    req.on('error', reject);
    screens.push(req);
  });
  return { screen, opened };
}

describe('GET /api/stream and sign-out', () => {
  it('ends the streams of the session that signs out, and leaves another session of the same person and another person open', async () => {
    vi.resetModules();
    const { setupAuth } = await import('../security/auth.js');
    const { streamRoutes } = await import('../routes/stream.js');
    const { connectedClients } = await import('../services/stream.js');
    app = Fastify({ logger: false });
    await setupAuth(app);
    await app.register(streamRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    const signIn = async (username: string, password: string) => {
      const res = await app!.inject({ method: 'POST', url: '/api/auth/login', headers: { host: HOST, origin: `http://${HOST}`, 'x-hcml-csrf': '1' }, payload: { username, password } });
      return res.cookies.find((c) => c.name === 'hcml_session')!.value;
    };
    const [mine, second, other] = [await signIn('ana', 'viewer-pass'), await signIn('ana', 'viewer-pass'), await signIn('olu', 'operator-pass')];
    const a = openScreen(port, mine);
    const b = openScreen(port, second);
    const c = openScreen(port, other);
    await Promise.all([a.opened, b.opened, c.opened]);
    expect(connectedClients()).toBe(3);

    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: page(mine) })).statusCode).toBe(200);
    await vi.waitFor(() => expect(a.screen.ended).toBe(true));
    expect(connectedClients()).toBe(2);
    expect(b.screen.ended).toBe(false);
    expect(c.screen.ended).toBe(false);
  });

  it('ends a stream that was opened with a renewed token when the session is signed out through an earlier one', async () => {
    vi.resetModules();
    const { setupAuth } = await import('../security/auth.js');
    const { streamRoutes } = await import('../routes/stream.js');
    app = Fastify({ logger: false });
    await setupAuth(app);
    await app.register(streamRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { host: HOST, origin: `http://${HOST}`, 'x-hcml-csrf': '1' }, payload: { username: 'ana', password: 'viewer-pass' } });
    const first = login.cookies.find((c) => c.name === 'hcml_session')!.value;
    const renewed = (await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: page(first) })).cookies.find((c) => c.name === 'hcml_session')!.value;
    const screen = openScreen(port, renewed);
    await screen.opened;

    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: page(first) });
    await vi.waitFor(() => expect(screen.screen.ended).toBe(true));
  });
});
