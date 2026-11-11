import type { FastifyInstance } from 'fastify';
import { config } from '../core/config.js';

/**
 * With sign-in off, answer only to a Host that names this machine.
 *
 * Every caller is admin when auth is off, so a page on another site that points its own domain at
 * 127.0.0.1 (DNS rebinding) could read the dev BFF as if it were the owner. That page's requests
 * still carry its own domain as the Host, which no loopback caller sends. With sign-in on there is
 * a token to check instead, so this does nothing.
 */

const LOOPBACK = ['localhost', '127.0.0.1', '::1'];

/** The name inside a Host header: no port, no brackets, lower case. Null when it is not a plain host. */
export function hostnameOf(header: string | undefined): string | null {
  const m = /^(?:\[([0-9a-f:.]+)\]|([a-z0-9.-]+))(?::\d{1,5})?$/i.exec((header ?? '').trim());
  const name = m?.[1] ?? m?.[2];
  return name ? name.toLowerCase().replace(/\.$/, '') : null;
}

/** The host of WEB_ORIGIN, or null when it is not a URL. */
function originHost(webOrigin: string): string | null {
  try {
    return hostnameOf(new URL(webOrigin).host);
  } catch {
    return null;
  }
}

/** Whether a Host header is localhost, 127.0.0.1, ::1 or the WEB_ORIGIN host, whatever the port. */
export function hostAllowed(header: string | undefined, webOrigin: string = config.webOrigin): boolean {
  const name = hostnameOf(header);
  return name !== null && (LOOPBACK.includes(name) || name === originHost(webOrigin));
}

/** Register before CORS and the routes, so nothing answers a request that is refused here. */
export function registerHostCheck(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    if (config.auth.enabled || hostAllowed(req.headers.host)) return;
    return reply.code(421).send({
      error: 'misdirected_request',
      message: 'With sign-in off, this server answers only on localhost.',
    });
  });
}
