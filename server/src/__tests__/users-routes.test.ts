import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { memoryUsers, noUsers, UsersWriteError, type UserStore } from '../security/userStore.js';

/**
 * The users, for an administrator, behind the real sign-in guard (ADR-0017): who may read and change them, what a change does to the session of the person it is made to, what
 * the log says and does not say, and what the modules of a user let them reach.
 */

vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'root:root-pass-123:admin,guy:guest-pass-123:viewer,opi:operator-pass-1:operator';
});

const { setupAuth } = await import('../security/auth.js');
const { createDirectory, readEnvUsers } = await import('../security/accounts.js');
const { useUserDirectory } = await import('../services/userDirectory.js');
const { registerErrorHandler } = await import('../http/errors.js');
const { AJV_OPTIONS } = await import('../core/schemas.js');
const { usersRoutes } = await import('../routes/users.js');

const HOST = '127.0.0.1:8081';
const page = (token?: string) => ({ host: HOST, origin: `http://${HOST}`, 'x-hcml-csrf': '1', ...(token ? { cookie: `hcml_session=${token}` } : {}) });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

let app: FastifyInstance;
let store: UserStore;
let log: Record<string, unknown>[];

async function start(users: UserStore = memoryUsers()) {
  store = users;
  log = [];
  const directory = createDirectory(readEnvUsers(), store);
  useUserDirectory(directory);
  // The validator as index.ts sets it: no coercion of types, so a text where a list belongs is refused and not made into one.
  app = Fastify({ ajv: AJV_OPTIONS, logger: { level: 'info', stream: { write: (line: string) => void log.push(JSON.parse(line)) } } });
  registerErrorHandler(app);
  await setupAuth(app, directory);
  await app.register(usersRoutes);
  // The routes of two pages, and the acknowledge write, as the guard sees them.
  app.get('/api/sla', async () => ({ ok: 'sla' }));
  app.get('/api/problems', async () => ({ ok: 'problems' }));
  app.post('/api/problems/acknowledge', async () => ({ ok: 'acknowledged' }));
  await app.ready();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T05:00:00Z'));
  await start();
});
afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  useUserDirectory(null);
});

const signIn = (username: string, password: string) => app.inject({ method: 'POST', url: '/api/auth/login', headers: page(), payload: { username, password } });
const tokenOf = async (username: string, password: string) => {
  const res = await signIn(username, password);
  const token = res.cookies.find((c) => c.name === 'hcml_session')?.value;
  if (!token) throw new Error(`sign-in as ${username} gave ${res.statusCode}: ${res.body}`);
  return token;
};
const as = (token: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });
const admin = () => tokenOf('root', 'root-pass-123');
const later = (seconds: number) => vi.setSystemTime(new Date(Date.now() + seconds * 1000));

const NEW = { name: 'budi.santoso', role: 'guest', modules: ['sla'], password: 'a-long-password-1' };

describe('who may read and change the users', () => {
  it('refuses a person who is not signed in, a guest and an operator, and says what it is', async () => {
    expect((await app.inject({ url: '/api/users' })).statusCode).toBe(401);
    for (const [name, password] of [['guy', 'guest-pass-123'], ['opi', 'operator-pass-1']]) {
      const token = await tokenOf(name, password);
      for (const [method, url, payload] of [['GET', '/api/users'], ['POST', '/api/users', NEW], ['PATCH', '/api/users/guy', { disabled: true }], ['POST', '/api/users/guy/password', { password: 'a-long-password-1' }]] as const) {
        const res = await as(token, method, url, payload);
        expect(res.statusCode, `${name} ${method} ${url}`).toBe(403);
        expect(res.json().error).toBe('forbidden');
      }
    }
    expect(store.list()).toEqual([]);
  });

  it('lists the users of .env and of the file to an administrator, the break-glass one first, with no hash, and what is needed to draw the page', async () => {
    const root = await admin();
    await as(root, 'POST', '/api/users', NEW);
    const res = await as(root, 'GET', '/api/users');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.users.map((u: { name: string; source: string; breakGlass: boolean }) => [u.name, u.source, u.breakGlass])).toEqual([
      ['root', 'env', true],
      ['budi.santoso', 'file', false],
      ['guy', 'env', false],
      ['opi', 'env', false],
    ]);
    expect(JSON.stringify(body)).not.toMatch(/scrypt|a-long-password-1|root-pass-123|hash/);
    expect(body.modules).toContainEqual({ id: 'users', label: 'Users and access', page: '/users', adminOnly: true });
    expect(body.modules.find((m: { id: string }) => m.id === 'sla')).toMatchObject({ adminOnly: false });
    expect(body.presets.guest).not.toContain('network');
    expect(body.presets.operator).toContain('network');
    expect(body).toMatchObject({ editable: true, durable: false, failing: false, secure: false });
  });

  it('says the users cannot be changed on a portal with no data folder, and refuses to change them', async () => {
    await app.close();
    await start(noUsers());
    const root = await admin();
    expect((await as(root, 'GET', '/api/users')).json()).toMatchObject({ editable: false, durable: false });
    const res = await as(root, 'POST', '/api/users', NEW);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'conflict', message: expect.stringContaining('no data folder') });
  });

  it('asks the cookie that carries a change for the portal\'s own header, like every cookie POST', async () => {
    const root = await admin();
    const { 'x-hcml-csrf': _, ...noHeader } = page(root);
    const res = await app.inject({ method: 'POST', url: '/api/users', headers: noHeader, payload: NEW });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('csrf');
    expect((await app.inject({ method: 'PATCH', url: '/api/users/guy', headers: noHeader, payload: { disabled: true } })).json().error).toBe('csrf');
    expect((await app.inject({ method: 'POST', url: '/api/users', headers: page(root), payload: NEW })).statusCode).toBe(201);
  });
});

describe('adding a user', () => {
  it('answers 201 with the user and no secret, and writes one line of the log that names who did what to whom', async () => {
    const root = await admin();
    const res = await as(root, 'POST', '/api/users', NEW);
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ name: 'budi.santoso', role: 'guest', modules: ['sla'], mustChange: true, source: 'file', createdBy: 'root' });
    const lines = log.filter((l) => l.event === 'user_admin');
    expect(lines).toEqual([expect.objectContaining({ action: 'created', user: 'root', target: 'budi.santoso', role: 'guest', modules: ['sla'], ip: expect.any(String) })]);
    expect(JSON.stringify(log)).not.toContain('a-long-password-1');
  });

  it('turns away what is wrong in words, and a name that is taken however it is spelled', async () => {
    const root = await admin();
    const bad = async (payload: object, status: number, text: string | RegExp) => {
      const res = await as(root, 'POST', '/api/users', { ...NEW, ...payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(status);
      expect(res.json().message, JSON.stringify(payload)).toMatch(text);
    };
    await bad({ password: 'short' }, 400, 'at least 8');
    await bad({ password: 'password' }, 400, 'anyone can guess');
    await bad({ name: 'GUY' }, 409, 'already a user called');
    await bad({ name: 'Root' }, 409, 'already a user called');
    await bad({ modules: ['inventory'] }, 400, 'inventory');
    await bad({ role: 'superuser' }, 400, /role/);
    await bad({ modules: 'sla' }, 400, /./);
    expect((await as(root, 'POST', '/api/users', { name: 'only.name' })).statusCode).toBe(400);
    expect(store.list()).toEqual([]);
  });
});

describe('what a new user can do', () => {
  it('has a temporary password: nothing but choosing a new one is open until it is chosen', async () => {
    const root = await admin();
    await as(root, 'POST', '/api/users', NEW);
    const signed = await signIn('Budi.Santoso', 'a-long-password-1');
    expect(signed.statusCode).toBe(200);
    expect(signed.json()).toMatchObject({ user: { name: 'budi.santoso', role: 'guest' }, mustChange: true });
    const budi = signed.cookies[0].value;

    const me = await as(budi, 'GET', '/api/auth/me');
    expect(me.json()).toMatchObject({ mustChange: true, modules: ['sla'] });
    const refused = await as(budi, 'GET', '/api/sla');
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: 'password_change_required', message: 'Choose a new password before you continue.' });

    later(3);
    const wrong = await as(budi, 'POST', '/api/auth/password', { current: 'not-the-password', password: 'my-own-new-password' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().message).toContain('current password is not right');
    const done = await app.inject({ method: 'POST', url: '/api/auth/password', headers: page(budi), payload: { current: 'a-long-password-1', password: 'my-own-new-password' } });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ ok: true, user: { name: 'budi.santoso', role: 'guest' } });
    expect(done.json().mustChange).toBeUndefined();
    // The session is renewed in the same answer; the one before it is void.
    const renewed = done.cookies.find((c) => c.name === 'hcml_session')!.value;
    expect((await as(budi, 'GET', '/api/sla')).statusCode).toBe(401);
    expect((await as(renewed, 'GET', '/api/sla')).statusCode).toBe(200);
    expect((await as(renewed, 'GET', '/api/auth/me')).json().mustChange).toBeUndefined();
    expect((await signIn('budi.santoso', 'a-long-password-1')).statusCode).toBe(401);
    expect((await signIn('budi.santoso', 'my-own-new-password')).statusCode).toBe(200);
    expect(log.filter((l) => l.event === 'user_admin' && l.action === 'password_changed')).toEqual([expect.objectContaining({ user: 'budi.santoso', target: 'budi.santoso' })]);
    expect(JSON.stringify(log)).not.toMatch(/my-own-new-password|a-long-password-1|not-the-password/);
  });

  it('reaches the routes of the modules it was given and no others, and sees only those pages', async () => {
    const root = await admin();
    await as(root, 'POST', '/api/users', { ...NEW, mustChange: false });
    const budi = await tokenOf('budi.santoso', 'a-long-password-1');
    expect((await as(budi, 'GET', '/api/sla')).statusCode).toBe(200);
    const refused = await as(budi, 'GET', '/api/problems');
    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toBe('Your account does not have Dashboard or Problems. Ask an administrator for access.');
    const me = (await as(budi, 'GET', '/api/auth/me')).json();
    expect(Object.keys(me.pages)).toEqual(['/sla']);
    expect(me.modules).toEqual(['sla']);
    expect(me.user).toEqual({ name: 'budi.santoso', role: 'guest', displayName: 'budi.santoso', source: 'file' });
  });

  // FR-73: the Account page offers the form for the password only to an account the portal can change.
  it('says where an account is kept, so that the page does not offer a form that is refused for an account of .env', async () => {
    const root = await admin();
    expect((await as(root, 'GET', '/api/auth/me')).json().user).toMatchObject({ name: 'root', source: 'env' });
    await as(root, 'POST', '/api/users', { ...NEW, mustChange: false });
    const budi = await tokenOf('budi.santoso', 'a-long-password-1');
    expect((await as(budi, 'GET', '/api/auth/me')).json().user.source).toBe('file');
    // What the page is told is what the BFF then does: a change of password for the account of .env is refused.
    const refused = await app.inject({ method: 'POST', url: '/api/auth/password', headers: page(root), payload: { current: 'root-pass-123', password: 'another-long-password-1' } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toContain('kept in .env');
  });
});

describe('a change takes effect on the next request of the person it is made to', () => {
  async function budi(over: object = {}) {
    const root = await admin();
    await as(root, 'POST', '/api/users', { ...NEW, mustChange: false, ...over });
    return { root, token: await tokenOf('budi.santoso', 'a-long-password-1') };
  }

  it('widens and narrows the modules, and the role', async () => {
    const { root, token } = await budi({ role: 'operator', modules: ['problems'] });
    expect((await as(token, 'POST', '/api/problems/acknowledge', {})).statusCode).toBe(200);
    expect((await as(token, 'GET', '/api/sla')).statusCode).toBe(403);
    const patched = await as(root, 'PATCH', '/api/users/budi.santoso', { modules: ['problems', 'sla'] });
    expect(patched.json().user.modules).toEqual(['problems', 'sla']);
    expect((await as(token, 'GET', '/api/sla')).statusCode).toBe(200);
    await as(root, 'PATCH', '/api/users/budi.santoso', { role: 'guest' });
    const demoted = await as(token, 'POST', '/api/problems/acknowledge', {});
    expect(demoted.statusCode).toBe(403);
    expect(demoted.json().message).toBe('This view needs the "operator" role; you are signed in as "guest".');
    expect((await as(token, 'GET', '/api/sla')).statusCode).toBe(200);
    expect(log.filter((l) => l.event === 'user_admin' && l.action === 'changed').map((l) => [l.target, l.role])).toEqual([['budi.santoso', 'operator'], ['budi.santoso', 'guest']]);
  });

  it('disables: the open session ends at once, and sign-in says what it says for a wrong password; enabling brings the session back', async () => {
    const { root, token } = await budi();
    await as(root, 'PATCH', '/api/users/budi.santoso', { disabled: true });
    expect((await as(token, 'GET', '/api/sla')).statusCode).toBe(401);
    const refused = await signIn('budi.santoso', 'a-long-password-1');
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toEqual({ error: 'invalid_credentials', message: 'Invalid username or password.' });
    await as(root, 'PATCH', '/api/users/budi.santoso', { disabled: false });
    expect((await as(token, 'GET', '/api/sla')).statusCode).toBe(200);
    expect(log.filter((l) => l.event === 'user_admin').map((l) => l.action)).toEqual(['created', 'disabled', 'enabled']);
  });

  it('expires: sign-in and the open session both stop when the time comes', async () => {
    const { token } = await budi({ expires: Math.floor(Date.now() / 1000) + 3600 });
    expect((await as(token, 'GET', '/api/sla')).statusCode).toBe(200);
    later(3601);
    expect((await as(token, 'GET', '/api/sla')).statusCode).toBe(401);
    expect((await signIn('budi.santoso', 'a-long-password-1')).statusCode).toBe(401);
  });

  it('resets a password: the older sessions end, the new password is temporary, and the log says who did it and nothing else', async () => {
    const { root, token } = await budi();
    later(3);
    const res = await as(root, 'POST', '/api/users/budi.santoso/password', { password: 'reset-by-the-admin-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ name: 'budi.santoso', mustChange: true });
    expect((await as(token, 'GET', '/api/sla')).statusCode).toBe(401);
    expect((await signIn('budi.santoso', 'a-long-password-1')).statusCode).toBe(401);
    expect((await signIn('budi.santoso', 'reset-by-the-admin-1')).json().mustChange).toBe(true);
    expect(log.filter((l) => l.action === 'password_reset')).toEqual([expect.objectContaining({ user: 'root', target: 'budi.santoso' })]);
    expect(JSON.stringify(log)).not.toContain('reset-by-the-admin-1');
    expect((await as(root, 'POST', '/api/users/budi.santoso/password', { password: 'short' })).statusCode).toBe(400);
    expect((await as(root, 'POST', '/api/users/nobody.here/password', { password: 'reset-by-the-admin-1' })).statusCode).toBe(404);
  });

  it('keeps an administrator from locking themselves out, and refuses what is kept in .env', async () => {
    const root = await admin();
    await as(root, 'POST', '/api/users', { name: 'second.admin', role: 'admin', password: 'a-long-password-1', mustChange: false });
    const second = await tokenOf('second.admin', 'a-long-password-1');
    const self = await as(second, 'PATCH', '/api/users/second.admin', { disabled: true });
    expect(self.statusCode).toBe(409);
    expect(self.json().message).toContain('your own account');
    expect((await as(second, 'PATCH', '/api/users/second.admin', { role: 'operator' })).statusCode).toBe(409);
    for (const name of ['root', 'guy']) {
      const res = await as(second, 'PATCH', `/api/users/${name}`, { disabled: true });
      expect(res.statusCode, name).toBe(409);
      expect(res.json().message).toContain('kept in .env');
    }
    expect((await as(second, 'PATCH', '/api/users/nobody.here', { disabled: true })).statusCode).toBe(404);
    expect((await as(second, 'PATCH', '/api/users/guy', {})).statusCode).toBe(400);
    expect((await as(root, 'PATCH', '/api/users/second.admin', { disabled: true })).statusCode).toBe(200);
  });
});

describe('a user of .env', () => {
  it('signs in as before, with the pages their role had, and cannot change their own password here', async () => {
    const guy = await tokenOf('guy', 'guest-pass-123');
    expect((await as(guy, 'GET', '/api/sla')).statusCode).toBe(200);
    const res = await as(guy, 'POST', '/api/auth/password', { current: 'guest-pass-123', password: 'a-long-password-1' });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain('kept in .env');
  });

  it('is told apart from a file user in the log by the file\'s lines only: signing in writes no user_admin line', async () => {
    await tokenOf('guy', 'guest-pass-123');
    expect(log.filter((l) => l.event === 'user_admin')).toEqual([]);
    expect(log.filter((l) => l.event === 'sign_in')).toEqual([expect.objectContaining({ user: 'guy', outcome: 'success' })]);
  });
});

describe('a body with a field the portal does not know (BK-97)', () => {
  it('is refused with a 400 that names the field, and changes nothing', async () => {
    const root = await admin();
    await as(root, 'POST', '/api/users', NEW);
    const typo = await as(root, 'PATCH', '/api/users/budi.santoso', { disable: true });
    expect(typo.statusCode).toBe(400);
    expect(typo.json()).toMatchObject({ error: 'bad_request', message: expect.stringContaining('disable') });
    expect(store.list()[0].disabled).toBe(false);

    const create = await as(root, 'POST', '/api/users', { ...NEW, name: 'second.person', expire: 1_800_000_000 });
    expect(create.statusCode).toBe(400);
    expect(store.list().map((u) => u.name)).toEqual(['budi.santoso']);

    const reset = await as(root, 'POST', '/api/users/budi.santoso/password', { password: 'a-long-password-2', must_change: false });
    expect(reset.statusCode).toBe(400);
  });
});

describe('Disable and then Enable (SC-57)', () => {
  it('leave a session from before the Disable void: only a new sign-in works', async () => {
    const root = await admin();
    await as(root, 'POST', '/api/users', { ...NEW, mustChange: false });
    const before = await tokenOf('budi.santoso', 'a-long-password-1');
    expect((await as(before, 'GET', '/api/sla')).statusCode).toBe(200);
    later(5);
    expect((await as(root, 'PATCH', '/api/users/budi.santoso', { disabled: true })).statusCode).toBe(200);
    expect((await as(before, 'GET', '/api/sla')).statusCode).toBe(401);
    later(5);
    expect((await as(root, 'PATCH', '/api/users/budi.santoso', { disabled: false })).statusCode).toBe(200);
    expect((await as(before, 'GET', '/api/sla')).statusCode).toBe(401);
    const after = await tokenOf('budi.santoso', 'a-long-password-1');
    expect((await as(after, 'GET', '/api/sla')).statusCode).toBe(200);
  });
});

describe('a save of the users that fails (BK-99)', () => {
  it('answers with its own sentence and not the unexpected-error one, and never says why in the response', async () => {
    const failing: UserStore = {
      ...memoryUsers(),
      change: async () => {
        throw new UsersWriteError('ENOSPC');
      },
    };
    await app.close();
    await start(failing);
    const root = await admin();
    const res = await as(root, 'POST', '/api/users', NEW);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'users_error', message: expect.stringContaining('could not save the users') });
    expect(JSON.stringify(res.json())).not.toContain('ENOSPC');
    expect(log.some((l) => l.level === 50 && JSON.stringify(l).includes('ENOSPC'))).toBe(true);
  });
});
