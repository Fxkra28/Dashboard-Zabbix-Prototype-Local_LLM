import type { FastifyInstance } from 'fastify';
import { config } from '../core/config.js';
import { createUserBody, nameParams, resetPasswordBody, updateUserBody } from '../core/schemas.js';
import { actor, auditUser } from '../security/audit.js';
import type { NewUser, UserPatch } from '../security/accounts.js';
import { createUser, listUsers, resetPassword, updateUser } from '../services/users.js';

/**
 * The users, for an administrator (ADR-0017). The guard (security/auth.ts, modules.ts) refuses everyone else before any of these runs.
 *
 *   GET   /api/users                      the users, the modules, the presets, and whether they can be changed
 *   POST  /api/users                      a new user
 *   PATCH /api/users/:name                role, modules, name shown, language, expiry, disabled
 *   POST  /api/users/:name/password       a reset, which the person must change at the next sign-in
 *
 * A user is never deleted: they are disabled, so that the log keeps its names.
 */
export async function usersRoutes(app: FastifyInstance): Promise<void> {
  // With sign-in off the guard is not installed and everyone counts as an administrator, so these four would let anyone make one that is still there when sign-in is switched on (SC-59).
  app.addHook('onRequest', async (_req, reply) => {
    if (config.auth.enabled) return;
    return reply.code(503).send({ error: 'sign_in_off', message: 'The users cannot be managed while sign-in is off. Set AUTH_ENABLED=true and sign in as an administrator.' });
  });

  app.get('/api/users', async (req) => listUsers(req.protocol === 'https'));

  app.post('/api/users', { schema: { body: createUserBody }, bodyLimit: 8192 }, async (req, reply) => {
    const user = await createUser(req.body as NewUser, actor(req));
    auditUser(req, 'created', user.name, { role: user.role, modules: user.modules });
    return reply.code(201).send({ user });
  });

  app.patch('/api/users/:name', { schema: { body: updateUserBody, params: nameParams }, bodyLimit: 8192 }, async (req) => {
    const { name } = req.params as { name: string };
    const patch = req.body as UserPatch;
    const user = await updateUser(name, patch, actor(req));
    if (patch.disabled !== undefined) auditUser(req, patch.disabled ? 'disabled' : 'enabled', user.name);
    const grants = patch.role !== undefined || patch.modules !== undefined;
    if (grants || patch.displayName !== undefined || patch.language !== undefined || patch.expires !== undefined || patch.mustChange !== undefined) {
      auditUser(req, 'changed', user.name, grants ? { role: user.role, modules: user.modules } : {});
    }
    return { user };
  });

  app.post('/api/users/:name/password', { schema: { body: resetPasswordBody, params: nameParams }, bodyLimit: 4096 }, async (req) => {
    const { name } = req.params as { name: string };
    const { password, mustChange } = req.body as { password: string; mustChange?: boolean };
    const user = await resetPassword(name, password, mustChange ?? true);
    auditUser(req, 'password_reset', user.name);
    return { user };
  });
}
