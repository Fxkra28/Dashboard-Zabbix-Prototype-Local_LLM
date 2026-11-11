import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * The two SLA explanations are logged like the problem one (SC-42): who, from where, and the tokens the model
 * used. The explanations themselves are stand-ins that report 77 tokens through the callback they are given.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer,olu:operator-pass:operator';
  process.env.AI_PROVIDER = 'anthropic';
  process.env.ANTHROPIC_API_KEY = 'fake-key-for-tests';
});
vi.mock('../services/explain.js', () => {
  const answer = { status: 'Met', plain: 'on target', meetingTarget: true, recommendation: 'none' };
  const call = async (...args: unknown[]) => {
    (args.at(-1) as (n: number) => void)(77);
    return answer;
  };
  return { explainProblem: vi.fn(call), explainDerivedSla: vi.fn(call), explainZabbixSla: vi.fn(call) };
});

const { setupAuth, tokenClaims } = await import('../security/auth.js');
const { registerErrorHandler } = await import('../http/errors.js');
const { explainRoutes } = await import('../routes/explain.js');

type Line = Record<string, unknown> & { msg: string };
let app: FastifyInstance;
let lines: Line[];

beforeEach(async () => {
  lines = [];
  app = Fastify({ logger: { level: 'info', stream: { write: (chunk: string) => void lines.push(JSON.parse(chunk) as Line) } } });
  registerErrorHandler(app);
  await setupAuth(app);
  await app.register(explainRoutes);
  await app.ready();
});
afterEach(() => app.close());

const as = (sub: string, role: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub, role, ...tokenClaims('hcml_session') }, { expiresIn: '1h' })}` });

describe('the SLA explanations in the log', () => {
  it('names who asked, for the derived SLA and for one of Zabbix\'s own, with the tokens each used', async () => {
    expect((await app.inject({ url: '/api/explain/sla?source=derived&month=2026-09', headers: as('ana', 'viewer'), remoteAddress: '10.9.8.7' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/explain/sla?slaid=3', headers: as('olu', 'operator'), remoteAddress: '10.9.8.8' })).statusCode).toBe(200);
    const uses = lines.filter((l) => l.event === 'ai_call');
    expect(uses.map((l) => [l.user, l.ip, l.kind, l.outcome, l.tokens])).toEqual([
      ['ana', '10.9.8.7', 'explain', 'answered', 77],
      ['olu', '10.9.8.8', 'explain', 'answered', 77],
    ]);
  });
});
