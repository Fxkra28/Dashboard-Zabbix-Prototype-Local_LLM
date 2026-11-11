import type { FastifyInstance } from 'fastify';
import { acceptsGzip } from '../core/acceptEncoding.js';
import { onSignOut, sessionIdOf } from '../security/auth.js';
import { useLogger, refusalFor, subscribe, endStreams, endStreamOf, ownerOf, msUntilExpiry } from '../services/stream.js';

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  useLogger(app.log);
  // close() waits for open connections, and a stream never ends by itself.
  app.addHook('preClose', async () => {
    endStreams();
  });

  app.get('/api/stream', (req, reply) => {
    const refusal = refusalFor(ownerOf(req));
    if (refusal) {
      req.log.warn('live stream refused: connection limit reached');
      return reply.code(429).header('retry-after', '30').send({ error: 'too_many_streams', message: refusal });
    }

    const gzip = acceptsGzip(req.headers['accept-encoding']);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // let nginx pass SSE straight through
      'X-Request-Id': req.id, // writeHead bypasses the reply headers requestId.ts sets
      Vary: 'Accept-Encoding', // writeHead bypasses compress.ts too
      ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
    });

    const unsubscribe = subscribe(reply.raw, ownerOf(req), { gzip });
    // A token is checked when the stream opens only. Ending the stream when it
    // expires makes the browser reconnect with the renewed cookie, or be sent to sign in.
    const left = msUntilExpiry(req);
    const expiry = left === null ? null : setTimeout(() => endStreamOf(reply.raw), left);
    expiry?.unref?.();
    // Signing out ends the session's streams at once, or a screen that was open would keep its frames.
    const session = sessionIdOf(req.user);
    const stopWatching = session ? onSignOut((signedOut) => signedOut === session && endStreamOf(reply.raw)) : undefined;
    const gone = () => {
      if (expiry) clearTimeout(expiry);
      stopWatching?.();
      unsubscribe();
    };
    req.raw.on('close', gone);
    reply.raw.on('close', gone);
  });
}
