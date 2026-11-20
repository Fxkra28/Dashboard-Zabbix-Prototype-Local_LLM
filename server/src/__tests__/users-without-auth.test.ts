import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { memoryUsers } from '../security/userStore.js';

/**
 * The Users routes while sign-in is off (SC-59). With no sign-in the guard is not installed and everyone counts as an administrator, so an anonymous request created an
 * administrator that was still there when sign-in was switched on. The routes answer 503 with a sentence instead, as the email routes do (SC-43). Every name is made up.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'false';
  process.env.PORTAL_USERS = 'root:root-pass-123:admin';
});

const { config } = await import('../core/config.js');
const { setupAuth } = await import('../security/auth.js');
const { createDirectory, readEnvUsers } = await import('../security/accounts.js');
const { useUserDirectory } = await import('../services/userDirectory.js');
const { registerErrorHandler } = await import('../http/errors.js');
const { AJV_OPTIONS } = await import('../core/schemas.js');
const { usersRoutes } = await import('../routes/users.js');
const { accountRequestRoutes } = await import('../routes/accountRequests.js');

let app: FastifyInstance;
const store = memoryUsers();

beforeEach(async () => {
  config.auth.enabled = false;
  useUserDirectory(createDirectory(readEnvUsers(), store));
  app = Fastify({ ajv: AJV_OPTIONS, logger: false });
  registerErrorHandler(app);
  await setupAuth(app);
  await app.register(usersRoutes);
  await app.register(accountRequestRoutes);
  await app.ready();
});
afterEach(async () => {
  config.auth.enabled = true;
  await app.close();
  useUserDirectory(null);
});

const WHY = /sign-in is off/i;

describe('the Users routes with sign-in off', () => {
  it.each([
    ['GET', '/api/users', undefined],
    ['POST', '/api/users', { name: 'planted.admin', role: 'admin', password: 'a-long-password-1' }],
    ['PATCH', '/api/users/someone', { disabled: true }],
    ['POST', '/api/users/someone/password', { password: 'a-long-password-1' }],
  ] as const)('answer %s %s with a 503 and the reason', async (method, url, payload) => {
    const res = await app.inject({ method, url, headers: { 'x-hcml-csrf': '1' }, ...(payload ? { payload } : {}) });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'sign_in_off' });
    expect(res.json().message).toMatch(WHY);
  });

  it('leave no user behind: the planted administrator is not in the file', async () => {
    await app.inject({ method: 'POST', url: '/api/users', headers: { 'x-hcml-csrf': '1' }, payload: { name: 'planted.admin', role: 'admin', password: 'a-long-password-1' } });
    expect(store.list()).toEqual([]);
  });
});

/**
 * The requests for an account wait in a file that outlives the sign-in setting, so an approval with sign-in off would plant an administrator as well. The guard is a hook of a plugin of those routes alone,
 * not a test of the URL: the router decodes the path, and `/api/users/%72equests` is the same route as `/api/users/requests`.
 */
describe('the routes of the requests for an account, for an administrator, with sign-in off', () => {
  const approval = { name: 'planted.admin', role: 'admin', password: 'a-long-password-1' };

  it.each([
    ['GET', '/api/users/requests', undefined],
    ['GET', '/api/users/%72equests', undefined],
    ['POST', '/api/users/requests/abc/approve', approval],
    ['POST', '/api/users/%72equests/abc/approve', approval],
    ['POST', '/api/users/requests/abc/refuse', {}],
    ['POST', '/api/users/%72equests/abc/refuse', {}],
    ['POST', '/api/users/requests/%61bc/approve', approval],
  ] as const)('answer %s %s with a 503 and the reason', async (method, url, payload) => {
    const res = await app.inject({ method, url, headers: { 'x-hcml-csrf': '1' }, ...(payload ? { payload } : {}) });
    expect(res.statusCode, url).toBe(503);
    expect(res.json()).toMatchObject({ error: 'sign_in_off' });
    expect(res.json().message).toMatch(WHY);
  });

  it('leave the public pair of the same file alone', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/request' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('enabled');
  });
});
