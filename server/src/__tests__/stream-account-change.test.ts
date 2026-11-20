import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * A live stream is judged when it opens, so a change made to the person afterwards has to end it (SC-57): a disabled person, one whose pages or password changed, kept
 * receiving the problem list, host and trigger names included, until their token ended, up to twelve hours. Every name and password here is made up.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'root:root-pass-123:admin';
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
const PASSWORD = 'a-long-password-1';

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

async function start() {
  vi.resetModules();
  const { setupAuth } = await import('../security/auth.js');
  const { streamRoutes } = await import('../routes/stream.js');
  const { createDirectory, readEnvUsers } = await import('../security/accounts.js');
  const { memoryUsers } = await import('../security/userStore.js');
  const { hashPassword } = await import('../security/passwords.js');
  const hash = await hashPassword(PASSWORD, { N: 1024, r: 8, p: 1 });
  const record = (name: string) => ({
    id: crypto.randomUUID(), name, displayName: name, role: 'guest' as const, modules: ['dashboard' as const, 'problems' as const], language: null, hash,
    created: 1_790_000_000, createdBy: 'root', lastSignIn: 0, disabled: false, expires: null, mustChange: false, notBefore: 0,
  });
  const directory = createDirectory(readEnvUsers(), memoryUsers([record('ana.putri'), record('olu.putra')]));
  app = Fastify({ logger: false });
  await setupAuth(app, directory);
  await app.register(streamRoutes);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  const signIn = async (username: string) => {
    const res = await app!.inject({ method: 'POST', url: '/api/auth/login', headers: { host: HOST, origin: `http://${HOST}`, 'x-hcml-csrf': '1' }, payload: { username, password: PASSWORD } });
    return res.cookies.find((c) => c.name === 'hcml_session')!.value;
  };
  const { connectedClients } = await import('../services/stream.js');
  /** Opens one screen for each name and waits until all have their first frame. */
  const open = async (...names: string[]) => {
    const list = await Promise.all(names.map(async (n) => openScreen(port, await signIn(n))));
    await Promise.all(list.map((s) => s.opened));
    return list.map((s) => s.screen);
  };
  return { directory, open, connectedClients };
}

const ended = (screen: { ended: boolean }) => vi.waitFor(() => expect(screen.ended).toBe(true));

describe('a live stream after a change to the person', () => {
  it('ends when the person is disabled, for each of their screens, and leaves another person open', async () => {
    const { directory, open, connectedClients } = await start();
    const [a1, a2, other] = await open('ana.putri', 'ana.putri', 'olu.putra');
    expect(connectedClients()).toBe(3);
    await directory.update('ana.putri', { disabled: true }, 'root');
    await ended(a1);
    await ended(a2);
    expect(other.ended).toBe(false);
    expect(connectedClients()).toBe(1);
  });

  it.each([
    ['their pages change', (d: Awaited<ReturnType<typeof start>>['directory']) => d.update('ana.putri', { modules: ['sla'] }, 'root')],
    ['their role changes', (d: Awaited<ReturnType<typeof start>>['directory']) => d.update('ana.putri', { role: 'operator' }, 'root')],
    ['an expiry is set', (d: Awaited<ReturnType<typeof start>>['directory']) => d.update('ana.putri', { expires: Math.floor(Date.now() / 1000) + 3_600 }, 'root')],
    ['an administrator resets their password', (d: Awaited<ReturnType<typeof start>>['directory']) => d.setPassword('ana.putri', 'a-brand-new-password', { mustChange: true })],
    ['they change their own password', (d: Awaited<ReturnType<typeof start>>['directory']) => d.changeOwnPassword('ana.putri', PASSWORD, 'a-brand-new-password')],
  ])('ends when %s', async (_why, change) => {
    const { directory, open } = await start();
    const [mine, other] = await open('ana.putri', 'olu.putra');
    await change(directory);
    await ended(mine);
    expect(other.ended).toBe(false);
  });

  it('stays open for a change that no screen could notice: the name shown, the language', async () => {
    const { directory, open } = await start();
    const [mine] = await open('ana.putri');
    await directory.update('ana.putri', { displayName: 'Ana P.', language: 'id' }, 'root');
    await new Promise((r) => setTimeout(r, 150));
    expect(mine.ended).toBe(false);
  });
});

describe('how long a stream may last', () => {
  it('is the sooner of the token and the account expiry, so a person who expires in a minute does not keep a stream for twelve hours', async () => {
    const { msUntilExpiry } = await import('../services/stream.js');
    const now = Math.floor(Date.now() / 1000);
    const req = (user: object) => ({ user }) as never;
    expect(msUntilExpiry(req({ exp: now + 43_200, expires: now + 60 }))).toBeLessThanOrEqual(60_000);
    expect(msUntilExpiry(req({ exp: now + 43_200, expires: now + 60 }))).toBeGreaterThan(55_000);
    expect(msUntilExpiry(req({ exp: now + 30, expires: now + 600 }))).toBeLessThanOrEqual(30_000);
    expect(msUntilExpiry(req({ exp: now + 30, expires: null }))).toBeLessThanOrEqual(30_000);
    expect(msUntilExpiry(req({ exp: now + 30 }))).toBeLessThanOrEqual(30_000);
    expect(msUntilExpiry({ user: undefined } as never)).toBeNull();
  });
});
