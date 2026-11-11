import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { codingWeight } from '../core/acceptEncoding.js';

/**
 * Compression for the JSON API, without a dependency. /api/problems alone is ~446 KB, polled every
 * few seconds by every open Problems page. Brotli at quality 4 takes it to ~25 KB in ~1.4 ms; gzip
 * level 6 (for clients without brotli) to ~28 KB in ~3 ms. Quality 4 on purpose: Node's default of
 * 11 took 612 ms on the same body, all of it on the event loop every other request waits behind.
 *
 * An onSend hook, so it only sees bodies sent through `reply.send()`. /api/chat writes server-sent
 * events straight to the socket and is untouched. /api/stream does too, and compresses itself
 * (services/stream.ts): a hook here would hold each event back in a buffer.
 */

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** Below this, headers and framing eat most of the saving. */
export const MIN_BYTES = 1024;

export type Encoding = 'br' | 'gzip';

/**
 * The encoding to answer an Accept-Encoding header with: the one the client
 * weights higher, brotli on a tie, none if neither is acceptable. `q=0` means
 * "not this one"; `*` stands for anything not listed.
 */
export function pickEncoding(header: string | string[] | undefined): Encoding | null {
  const br = codingWeight(header, 'br');
  const gz = codingWeight(header, 'gzip');
  if (br <= 0 && gz <= 0) return null;
  return br >= gz ? 'br' : 'gzip';
}

/** Add a field to Vary, keeping what is there (CORS and the dev proxy add `Origin`). */
function appendVary(reply: FastifyReply, field: string): void {
  const existing = reply.getHeader('vary');
  const fields = (Array.isArray(existing) ? existing.join(',') : String(existing ?? ''))
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  if (fields.some((f) => f === '*' || f.toLowerCase() === field.toLowerCase())) return;
  reply.header('vary', [...fields, field].join(', '));
}

/** Register before the routes: a hook applies only to routes added after it. */
export function registerCompression(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.method === 'HEAD' || reply.statusCode === 204 || reply.statusCode === 304) return payload;
    if (reply.hasHeader('content-encoding')) return payload;
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
    if (!String(reply.getHeader('content-type') ?? '').startsWith('application/json')) return payload;
    const size = Buffer.byteLength(payload);
    if (size < MIN_BYTES) return payload;

    // The body depends on Accept-Encoding whether or not this client gets it
    // compressed, so a cache in between must key on it either way.
    appendVary(reply, 'Accept-Encoding');
    const encoding = pickEncoding(req.headers['accept-encoding']);
    if (!encoding) return payload;

    try {
      const body =
        encoding === 'br'
          ? await brotli(payload, {
              params: {
                [constants.BROTLI_PARAM_QUALITY]: 4,
                [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
                [constants.BROTLI_PARAM_SIZE_HINT]: size,
              },
            })
          : await gzipAsync(payload, { level: 6 });
      reply.header('content-encoding', encoding);
      // Fastify sets it again from the compressed body it is handed.
      reply.removeHeader('content-length');
      return body;
    } catch (err) {
      req.log.warn({ err }, 'response compression failed; sending it uncompressed');
      return payload;
    }
  });
}
