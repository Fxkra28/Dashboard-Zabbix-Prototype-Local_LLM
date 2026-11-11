import type { FastifyInstance } from 'fastify';

/**
 * `Cache-Control: no-store` on every `/api` reply, so a browser or proxy on a shared NOC workstation keeps no copy of signed-in data.
 * Left as they are: the public health check, a reply that chose its own value (the SLA download, the two streams), and anything outside `/api`.
 */

const PUBLIC_PATHS = new Set(['/api/health']);

/** The path a client asked for: the host of an absolute-form request line and the query cut off, the escapes decoded, so `/%61pi/problems` counts as `/api/problems`. */
export function askedPath(url: string): string {
  const path = (url.split('?', 1)[0] ?? '').replace(/^https?:\/\/[^/]*/i, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function registerNoStore(app: FastifyInstance): void {
  app.addHook('onSend', (req, reply, payload, done) => {
    const path = askedPath(req.url);
    if (path.startsWith('/api/') && !PUBLIC_PATHS.has(path) && !reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-store');
    }
    done(null, payload);
  });
}
