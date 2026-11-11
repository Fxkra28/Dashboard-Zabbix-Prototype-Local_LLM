import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance } from 'fastify';

/**
 * One id per request, from the browser's call to the log line. nginx writes it into X-Request-Id
 * (`$request_id`, in bff-proxy.inc) and into its own access log. Here it becomes Fastify's request
 * id: `reqId` on every log line of the request, the X-Request-Id of the reply and `requestId` in
 * the body of every error, so an id read out from an error lets an admin find that request in both
 * logs.
 */

/** What an id may look like: short, with nothing that could break a header or split a log line. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Fastify's `genReqId`. The id the proxy sent when it is well formed, otherwise a new one: the BFF is
 * reachable only through nginx, which overwrites any client value, but a request that arrives some
 * other way must not choose what is written to the log.
 */
export function genReqId(req: Pick<IncomingMessage, 'headers'>): string {
  const sent = req.headers['x-request-id'];
  return typeof sent === 'string' && SAFE_ID.test(sent) ? sent : randomUUID();
}

/**
 * Put the id on every reply, and in every error body. Before the other hooks and routes, so a
 * refusal that comes first (the Host check, the rate limit, the guard) carries it too.
 */
export function registerRequestId(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  // Only a JSON object with a text `error`, at a failure status: the one error shape (errors.ts).
  app.addHook('preSerialization', async (req, reply, payload) => {
    if (reply.statusCode < 400 || typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload;
    const body = payload as Record<string, unknown>;
    return typeof body.error === 'string' && !('requestId' in body) ? { ...body, requestId: req.id } : payload;
  });
}
