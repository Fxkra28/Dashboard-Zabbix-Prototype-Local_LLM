import { vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * A BFF with the real sign-in guard, built from an environment of the test's choosing. config.ts
 * and auth.ts read the environment once at import, so each build loads them afresh. Every log
 * line the app writes is kept, parsed, in `log`: the start-up warnings and the sign-in events.
 * All values here are made up for the tests.
 */
export const HOST = '127.0.0.1:8081';
export const SECRET = 'test-only-secret-at-least-32-bytes-long';

/** What the portal's own page sends: the CSRF header and its own origin, and the session cookie when signed in. */
export const page = (token?: string, cookieName = 'hcml_session') => ({
  host: HOST,
  origin: `http://${HOST}`,
  'x-hcml-csrf': '1',
  ...(token ? { cookie: `${cookieName}=${token}` } : {}),
});
export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export type LogLine = Record<string, unknown> & { level: number; msg: string };

const open: FastifyInstance[] = [];

/** Close every app a test built. Call from afterEach, with vi.unstubAllEnvs(). */
export async function closeAuthApps(): Promise<void> {
  await Promise.all(open.splice(0).map((app) => app.close()));
}

export async function buildAuthApp(env: Record<string, string> = {}) {
  vi.resetModules();
  const merged = {
    AUTH_ENABLED: 'true',
    JWT_SECRET: SECRET,
    PORTAL_USERS: 'ana:viewer-pass:viewer,olu:operator-pass:operator,adi:admin-pass:admin',
    PORTAL_USER: 'admin',
    PORTAL_PASS: 'a-long-real-password',
    ...env,
  };
  for (const [key, value] of Object.entries(merged)) vi.stubEnv(key, value);
  const auth = await import('../../security/auth.js');

  const log: LogLine[] = [];
  const app = Fastify({ logger: { level: 'info', stream: { write: (line: string) => void log.push(JSON.parse(line)) } } });
  await auth.setupAuth(app);
  app.get('/api/hosts', async () => ({ ok: 'hosts' }));
  app.get('/api/links', async () => ({ ok: 'links' }));
  app.get('/api/reports/inventory', async () => ({ ok: 'inventory' }));
  app.get('/api/whoami', async (req) => ({ role: auth.roleOf(req) }));
  await app.ready();
  open.push(app);

  const signIn = (username: unknown, password: unknown, remoteAddress?: string) =>
    app.inject({ method: 'POST', url: '/api/auth/login', headers: page(), payload: { username, password } as object, remoteAddress });
  /** The session cookie a response set. */
  const cookieOf = (res: { cookies: { name: string; value: string }[] }, name = 'hcml_session') =>
    res.cookies.find((c) => c.name === name)?.value;
  /** Sign in and hand back the token, which a test sends back as a cookie or a Bearer header. */
  const tokenFor = async (username: string, password: string) => {
    const res = await signIn(username, password);
    const token = cookieOf(res);
    if (!token) throw new Error(`sign-in as ${username} gave ${res.statusCode}`);
    return token;
  };
  const events = (event = 'sign_in') => log.filter((l) => l.event === event);
  const warnings = () => log.filter((l) => l.level === 40).map((l) => l.msg);

  return { app, auth, log, signIn, cookieOf, tokenFor, events, warnings };
}
