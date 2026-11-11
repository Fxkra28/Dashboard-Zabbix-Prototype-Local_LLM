import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { redactUrl, serializeRequest } from '../http/logging.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJub2MiLCJyb2xlIjoidmlld2VyIn0.c2lnbmF0dXJl';

describe('redactUrl', () => {
  it('replaces the token wherever it sits in the query', () => {
    expect(redactUrl(`/api/stream?token=${JWT}`)).toBe('/api/stream?token=[redacted]');
    expect(redactUrl(`/api/stream?token=${JWT}&x=1`)).toBe('/api/stream?token=[redacted]&x=1');
    expect(redactUrl(`/api/stream?x=1&token=${encodeURIComponent(JWT)}`)).toBe('/api/stream?x=1&token=[redacted]');
    expect(redactUrl(`/api/stream?TOKEN=${JWT}`)).toBe('/api/stream?TOKEN=[redacted]');
  });

  it('leaves URLs without a token as they are', () => {
    expect(redactUrl('/api/problems')).toBe('/api/problems');
    expect(redactUrl('/api/graph?itemids=1,2&from=10')).toBe('/api/graph?itemids=1,2&from=10');
    // Only the parameter named `token`, not one that merely ends in it.
    expect(redactUrl('/api/x?csrftoken=abc')).toBe('/api/x?csrftoken=abc');
  });
});

describe('serializeRequest', () => {
  it("keeps the token out of Fastify's request log line", async () => {
    const lines: string[] = [];
    const app = Fastify({
      logger: {
        level: 'info',
        stream: { write: (line: string) => lines.push(line) },
        serializers: { req: serializeRequest },
      },
    });
    let seen = '';
    app.get('/api/stream', async (req) => {
      seen = (req.query as { token?: string }).token ?? '';
      return { ok: true };
    });

    const res = await app.inject({ url: `/api/stream?token=${JWT}&x=1`, remoteAddress: '10.1.2.3' });
    expect(res.statusCode).toBe(200);
    expect(seen).toBe(JWT); // the route still gets the real token

    const incoming = lines.map((l) => JSON.parse(l)).find((l) => l.msg === 'incoming request');
    expect(incoming.req).toMatchObject({
      method: 'GET',
      url: '/api/stream?token=[redacted]&x=1',
      hostname: 'localhost:80',
      remoteAddress: '10.1.2.3',
    });
    expect(lines.join('\n')).not.toContain(JWT);
    await app.close();
  });
});
