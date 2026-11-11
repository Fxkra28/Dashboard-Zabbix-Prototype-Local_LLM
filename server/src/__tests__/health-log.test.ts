import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * The container's health check asks every ten seconds, so its request lines were 99.6 percent of the log (IN-64).
 * That one route logs at warning level and above; every other route still logs its requests.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer';
});

const { setupAuth } = await import('../security/auth.js');
const { registerHealth } = await import('../http/health.js');

type Line = { msg: string; level: number };
let app: FastifyInstance;
let lines: Line[];

beforeEach(async () => {
  lines = [];
  app = Fastify({ logger: { level: 'info', stream: { write: (chunk: string) => void lines.push(JSON.parse(chunk) as Line) } } });
  await setupAuth(app);
  registerHealth(app, { get: async () => ({ ok: true }) } as never);
  await app.ready();
});
afterEach(() => app.close());

const requestLines = () => lines.filter((l) => l.msg === 'incoming request' || l.msg === 'request completed');

describe('what the log holds for the health check', () => {
  it('writes no request line for /api/health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(requestLines()).toEqual([]);
  });

  it('still writes the request lines of another route', async () => {
    await app.inject({ method: 'GET', url: '/api/ready' });
    expect(requestLines().map((l) => l.msg).sort()).toEqual(['incoming request', 'request completed']);
  });
});
