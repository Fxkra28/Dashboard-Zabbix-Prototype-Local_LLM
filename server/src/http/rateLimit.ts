import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { config } from '../core/config.js';

/** Matched against the route the router found, so no spelling of these paths is counted. */
const EXEMPT = new Set(['/api/stream', '/api/health', '/api/auth/logout']);

/**
 * Rate limiting, ahead of the auth guard: call it before setupAuth. The plugin's own hooks go on
 * each route and run after every root hook, so the guard's 401s and the CSRF check's 403s would
 * never be counted and a route with a limit of its own (sign-in) would lose this one. As a root
 * onRequest hook it counts every request first, with sign-in's per-account limit on top (auth.ts);
 * POST /api/auth/login is the target that matters, being otherwise an unthrottled password oracle.
 *
 * SSE and health are exempt: /api/stream holds one long-lived connection per NOC screen rather than
 * making repeated requests, and /api/health is polled deliberately by every page and by container
 * health checks. So is sign-out: a refused one would leave the cookie working behind a page showing
 * sign-in.
 */
export async function registerRateLimit(app: FastifyInstance, max = config.rateLimitPerMinute): Promise<void> {
  await app.register(rateLimit, {
    global: false,
    max,
    timeWindow: '1 minute',
    allowList: (req) => EXEMPT.has(req.routeOptions.url ?? ''),
    // The plugin throws what this returns, so it passes through the error
    // handler: `statusCode` is what keeps it a 429 there rather than a 500.
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'rate_limited',
      message: `Too many requests: the limit is ${ctx.max} per minute. Retry in ${ctx.after}.`,
    }),
  });
  app.addHook('onRequest', app.rateLimit());
}
