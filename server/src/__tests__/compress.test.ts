import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import Fastify, { type FastifyInstance } from 'fastify';
import { MIN_BYTES, pickEncoding, registerCompression } from '../http/compress.js';
import { acceptsGzip, codingWeight } from '../core/acceptEncoding.js';

/**
 * Compression as a browser sees it, through `app.inject()`: decoded bodies
 * must match exactly, and everything that is not a large JSON body must pass
 * through as it was.
 */
const rows = Array.from({ length: 200 }, (_, i) => ({
  eventid: String(1000 + i),
  name: `High ICMP ping loss on 4.3.${i} FPSO ARUBA`,
  severity: String(i % 6),
  acknowledged: i % 3 === 0 ? '1' : '0',
}));

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  registerCompression(app);
  app.get('/big', async () => rows);
  app.get('/small', async () => ({ ok: true }));
  app.get('/text', async (_req, reply) => reply.type('text/plain').send('x'.repeat(5 * MIN_BYTES)));
  app.get('/varied', async (_req, reply) => {
    reply.header('vary', 'Origin');
    return rows;
  });
  // Written like /api/stream: straight to the socket, never through reply.send().
  app.get('/raw', (_req, reply) => {
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
    reply.raw.end(`event: problems\ndata: ${JSON.stringify(rows)}\n\n`);
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('pickEncoding', () => {
  it('prefers brotli, falls back to gzip, and honours q-values and *', () => {
    expect(pickEncoding('gzip, deflate, br, zstd')).toBe('br');
    expect(pickEncoding('gzip, deflate')).toBe('gzip');
    expect(pickEncoding('br;q=0, gzip')).toBe('gzip');
    expect(pickEncoding('br;q=0.5, gzip;q=1.0')).toBe('gzip');
    expect(pickEncoding('*')).toBe('br');
    expect(pickEncoding('*, br;q=0')).toBe('gzip');
    expect(pickEncoding(['gzip', 'br'])).toBe('br');
  });

  it('answers none when nothing usable is offered', () => {
    expect(pickEncoding(undefined)).toBeNull();
    expect(pickEncoding('')).toBeNull();
    expect(pickEncoding('identity')).toBeNull();
    expect(pickEncoding('deflate, gzip;q=0')).toBeNull();
  });
});

describe('registerCompression', () => {
  const json = JSON.stringify(rows);

  it('round-trips a large JSON body through brotli', async () => {
    const res = await app.inject({ url: '/big', headers: { 'accept-encoding': 'gzip, deflate, br' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.headers['vary']).toBe('Accept-Encoding');
    expect(Number(res.headers['content-length'])).toBe(res.rawPayload.length);
    expect(res.rawPayload.length).toBeLessThan(json.length / 4);
    expect(brotliDecompressSync(res.rawPayload).toString()).toBe(json);
  });

  it('round-trips through gzip for a client without brotli', async () => {
    const res = await app.inject({ url: '/big', headers: { 'accept-encoding': 'gzip, deflate' } });
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(Number(res.headers['content-length'])).toBe(res.rawPayload.length);
    expect(gunzipSync(res.rawPayload).toString()).toBe(json);
  });

  it('sends it plain, still marked as varying, when the client asks for no encoding', async () => {
    const res = await app.inject({ url: '/big' });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['vary']).toBe('Accept-Encoding');
    expect(res.body).toBe(json);
  });

  it('leaves small bodies alone', async () => {
    const res = await app.inject({ url: '/small', headers: { 'accept-encoding': 'br' } });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['vary']).toBeUndefined();
    expect(res.json()).toEqual({ ok: true });
  });

  it('leaves HEAD alone, with the length of the plain body', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/big', headers: { 'accept-encoding': 'br' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(Number(res.headers['content-length'])).toBe(Buffer.byteLength(json));
    expect(res.rawPayload.length).toBe(0);
  });

  it('leaves bodies that are not JSON alone', async () => {
    const res = await app.inject({ url: '/text', headers: { 'accept-encoding': 'br' } });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toHaveLength(5 * MIN_BYTES);
  });

  it('appends to an existing Vary rather than replacing it', async () => {
    const res = await app.inject({ url: '/varied', headers: { 'accept-encoding': 'br' } });
    expect(res.headers['vary']).toBe('Origin, Accept-Encoding');
    expect(res.headers['content-encoding']).toBe('br');
  });

  it('does not touch a response written straight to the socket, like the SSE stream', async () => {
    const res = await app.inject({ url: '/raw', headers: { 'accept-encoding': 'br' } });
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['vary']).toBeUndefined();
    expect(res.body).toBe(`event: problems\ndata: ${json}\n\n`);
  });
});

describe('acceptsGzip (the live stream, IN-11)', () => {
  it('is true when gzip is named or the wildcard allows it, and for the header a browser sends over plain HTTP', () => {
    expect(acceptsGzip('gzip, deflate')).toBe(true);
    expect(acceptsGzip('GZIP')).toBe(true);
    expect(acceptsGzip('identity, *')).toBe(true);
    expect(acceptsGzip(['deflate', 'gzip;q=0.5'])).toBe(true);
  });

  it('is false when gzip is refused, not offered, or the header is missing', () => {
    expect(acceptsGzip(undefined)).toBe(false);
    expect(acceptsGzip('')).toBe(false);
    expect(acceptsGzip('br')).toBe(false);
    expect(acceptsGzip('gzip;q=0, br')).toBe(false);
    expect(acceptsGzip('*;q=0, br')).toBe(false);
    expect(acceptsGzip('identity')).toBe(false);
  });

  it('reads a weight the way pickEncoding does: its own q, else the wildcard, else 0, and a broken q as 0', () => {
    expect(codingWeight('gzip;q=0.3, *;q=0.1', 'gzip')).toBe(0.3);
    expect(codingWeight('gzip;q=0.3, *;q=0.1', 'br')).toBe(0.1);
    expect(codingWeight('gzip;q=oops', 'gzip')).toBe(0);
    expect(codingWeight(undefined, 'gzip')).toBe(0);
  });
});
