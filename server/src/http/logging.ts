import type { FastifyRequest } from 'fastify';

/**
 * Log hygiene. A page loaded before the move to the session cookie still sends its JWT as
 * `?token=`, and Fastify's request log line prints the URL whole, so a token in a log file would
 * work as a login until it expires. The BFF itself now reads the cookie (auth.ts).
 */

/** The URL with every `token` query value replaced by `[redacted]`. */
export function redactUrl(url: string): string {
  return url.replace(/([?&]token=)[^&#]*/gi, '$1[redacted]');
}

/**
 * Fastify's default `req` log serializer, field for field, except that the
 * URL goes through `redactUrl`.
 * `hostname` keeps its Fastify 4 name and value (host with port) so log lines
 * read as before; Fastify 5 calls that `req.host` and drops the port from `req.hostname`.
 */
export function serializeRequest(req: FastifyRequest) {
  return {
    method: req.method,
    url: redactUrl(req.url),
    version: req.headers['accept-version'] as string | undefined,
    hostname: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}
