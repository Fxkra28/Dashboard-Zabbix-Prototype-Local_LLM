import type { FastifyInstance } from 'fastify';
import { config } from '../core/config.js';
import { accountRequestBody, createUserBody, idParams, noBody } from '../core/schemas.js';
import { actor, auditRequest, auditUser } from '../security/audit.js';
import type { NewUser } from '../security/accounts.js';
import { approveRequest, listRequests, receiveRequest, refuseRequest, requestInfo, RequestRefused } from '../services/accountRequests.js';

/**
 * Requests for an account (FR-62).
 *
 *   GET  /api/auth/request                      public: whether the form is offered, and the pages it may ask for
 *   POST /api/auth/request                      public: leaves a request. The same answer whether it was kept or was a copy of one waiting
 *   GET  /api/users/requests                    for an administrator: the requests waiting
 *   POST /api/users/requests/:id/approve        makes the account (the body of POST /api/users) and takes the request off the list
 *   POST /api/users/requests/:id/refuse         takes the request off the list
 *
 * The public pair is checked like sign-in is: the portal's own header, and its own origin. Everything about the limits is in services/accountRequests.ts.
 */
export async function accountRequestRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/request', async () => requestInfo());

  app.post('/api/auth/request', { schema: { body: accountRequestBody }, bodyLimit: 8192 }, async (req, reply) => {
    try {
      const outcome = await receiveRequest(req.body as { name: string; pages: string[]; reason: string }, req.ip);
      auditRequest(req, outcome === 'kept' ? 'received' : 'ignored', (req.body as { name: string }).name);
      return reply.code(202).send({ ok: true });
    } catch (err) {
      if (!(err instanceof RequestRefused)) throw err;
      if (err.retryAfter) reply.header('retry-after', String(err.retryAfter));
      return reply.code(err.statusCode).send({ error: err.error, message: err.message });
    }
  });

  await app.register(requestAdminRoutes);
}

/**
 * The three routes for administrators, a plugin of their own so that the hook is theirs alone and no spelling of the path can go around it: the router decodes the path, and a test of the URL would not
 * see `/api/users/%72equests`. With sign-in off the guard is not installed and everyone counts as an administrator, so these are refused as the users routes are (SC-59).
 */
async function requestAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_req, reply) => {
    if (config.auth.enabled) return;
    return reply.code(503).send({ error: 'sign_in_off', message: 'The users cannot be managed while sign-in is off. Set AUTH_ENABLED=true and sign in as an administrator.' });
  });

  app.get('/api/users/requests', async () => listRequests());

  app.post('/api/users/requests/:id/approve', { schema: { body: createUserBody, params: idParams }, bodyLimit: 8192 }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = await approveRequest(id, req.body as NewUser, actor(req));
    auditRequest(req, 'approved', user.name);
    auditUser(req, 'created', user.name, { role: user.role, modules: user.modules, request: true });
    return reply.code(201).send({ user });
  });

  app.post('/api/users/requests/:id/refuse', { schema: { body: noBody, params: idParams }, bodyLimit: 1024 }, async (req) => {
    const { id } = req.params as { id: string };
    const name = await refuseRequest(id);
    auditRequest(req, 'refused', name);
    return { ok: true };
  });
}
