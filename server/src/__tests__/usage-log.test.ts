import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Who used the AI (SC-42). The log said who signed in and who acknowledged a problem, and nothing of
 * who asked the hosted model about HCML's data. Each use is now one line: who, from where, which kind,
 * how it ended and how many tokens; never the question or the answer. Report downloads are in
 * download-log.test.ts.
 */
vi.mock('../services/assistant.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/assistant.js')>()),
  getSnapshot: vi.fn(),
  streamAnswer: vi.fn(),
  buildFocus: vi.fn(async () => null),
}));
vi.mock('../clients/ai.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/ai.js')>()),
  humanize: vi.fn(),
  warmModel: vi.fn(async () => undefined),
  prefillModel: vi.fn(async () => true),
}));
vi.mock('../domain/queries.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/queries.js')>();
  const { cached } = await import('../core/cache.js');
  const getProblems = vi.fn();
  return {
    ...actual,
    getProblems,
    cachedProblems: () => cached('problems', actual.PROBLEMS_TTL_MS, getProblems),
    withOpdata: async (problems: unknown[]) => problems,
  };
});

const BASE_ENV = {
  AUTH_ENABLED: 'true',
  JWT_SECRET: 'test-only-secret-at-least-32-bytes-long',
  PORTAL_USERS: 'ana:viewer-pass:viewer,olu:operator-pass:operator,x[y]z:bracket-pass:operator',
  AI_PROVIDER: 'anthropic',
  ANTHROPIC_API_KEY: 'fake-key-for-tests',
  AI_EXPLAIN_PER_MINUTE: '2',
};
const LOCAL_ENV = { AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'http://localhost:11434/v1' };

const META = { generatedAt: 1, hosts: 1, sites: 1, problems: 1, unacknowledged: 0, slas: 0, degradedServices: 0, truncated: false };
const EXPLANATION = { summary: 'The switch lost its uplink at Sampang.', tagsExplained: [], businessImpact: 'b', recommendation: 'r' };
const QUESTION = 'which switch at Sampang is down';
const ANSWER = 'Switch lt3 has no uplink.';

type Line = Record<string, unknown> & { msg: string };
const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

/** The portal fresh under `env`, with every log line kept. `tokens` is what the mocked model reports for a call. */
async function portal(env: Record<string, string> = {}, tokens = 0) {
  vi.resetModules();
  for (const name of ['AI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_BASE_URL', 'AI_MAX_CONCURRENT', 'SLA_TIMEZONE']) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries({ ...BASE_ENV, ...env })) vi.stubEnv(name, value);

  const [{ registerErrorHandler }, { setupAuth, tokenClaims }, chatModule, aiModule, queries] = await Promise.all([
    import('../http/errors.js'),
    import('../security/auth.js'),
    import('../services/assistant.js'),
    import('../clients/ai.js'),
    import('../domain/queries.js'),
  ]);
  const { chatRoutes } = await import('../routes/chat.js');
  const { explainRoutes } = await import('../routes/explain.js');

  vi.mocked(chatModule.getSnapshot).mockResolvedValue({ text: 'SNAPSHOT', meta: META, sizes: {}, fingerprint: 'f', complete: true, frozen: false } as never);
  vi.mocked(chatModule.streamAnswer).mockImplementation(async function* (_turns, _snapshot, _signal, options) {
    options?.onUsage?.(tokens);
    yield ANSWER;
  });
  vi.mocked(aiModule.humanize).mockImplementation((async (_kind: unknown, _payload: unknown, onUsage?: (n: number) => void) => {
    onUsage?.(tokens);
    return EXPLANATION;
  }) as never);
  vi.mocked(queries.getProblems).mockResolvedValue(
    ['1', '2', '3'].map((eventid) => ({ eventid, name: 'High ICMP ping loss', severity: '2', clock: '1788838236', acknowledged: '0', r_eventid: '0', host: 'h' })) as never,
  );

  const lines: Line[] = [];
  const app = Fastify({ logger: { level: 'info', stream: { write: (chunk: string) => void lines.push(JSON.parse(chunk) as Line) } } });
  apps.push(app);
  registerErrorHandler(app);
  await setupAuth(app);
  await app.register(chatRoutes);
  await app.register(explainRoutes);
  await app.ready();

  const as = (sub: string, role = 'viewer') => ({ authorization: `Bearer ${app.jwt.sign({ sub, role, ...tokenClaims('hcml_session') }, { expiresIn: '1h' })}` });
  return {
    app,
    lines,
    chatMock: vi.mocked(chatModule.streamAnswer),
    modelMock: vi.mocked(aiModule.humanize),
    uses: () => lines.filter((l) => l.event === 'ai_call'),
    ask: (sub: string, remoteAddress = '10.9.8.7') =>
      app.inject({ method: 'POST', url: '/api/chat', headers: as(sub), remoteAddress, payload: { messages: [{ role: 'user', content: QUESTION }] } }),
    explain: (sub: string, eventid = '1', remoteAddress = '10.9.8.7') => app.inject({ url: `/api/explain/problem?eventid=${eventid}`, headers: as(sub), remoteAddress }),
  };
}

describe('one line for each use of the AI', () => {
  it('says who asked Explain, from where, how it ended and what it cost, and not a word of the answer', async () => {
    const { explain, uses, lines } = await portal({}, 1200);
    expect((await explain('ana')).statusCode).toBe(200);
    expect(uses()).toHaveLength(1);
    expect(uses()[0]).toMatchObject({
      event: 'ai_call',
      user: 'ana',
      ip: '10.9.8.7',
      kind: 'explain',
      outcome: 'answered',
      tokens: 1200,
      provider: 'anthropic',
      external: true,
      msg: 'ai explain answered',
    });
    expect(JSON.stringify(lines)).not.toContain(EXPLANATION.summary);
  });

  it('says who asked the Assistant, with the tokens of the answer, and not the question or the answer', async () => {
    const { ask, uses, lines } = await portal({}, 500);
    expect((await ask('olu')).statusCode).toBe(200);
    expect(uses()).toHaveLength(1);
    expect(uses()[0]).toMatchObject({ user: 'olu', kind: 'chat', outcome: 'answered', tokens: 500, external: true, msg: 'ai chat answered' });
    const everything = JSON.stringify(lines);
    expect(everything).not.toContain(QUESTION);
    expect(everything).not.toContain(ANSWER);
  });

  it('logs a repeat of an explanation answered from the cache as a use that cost no tokens', async () => {
    const { explain, uses, modelMock } = await portal({}, 800);
    await explain('ana');
    await explain('olu');
    expect(modelMock).toHaveBeenCalledTimes(1);
    expect(uses().map((l) => [l.user, l.tokens])).toEqual([['ana', 800], ['olu', 0]]);
  });

  it('logs a problem that is not there, and a model that failed, and still answers as before', async () => {
    const { explain, uses, modelMock } = await portal({}, 300);
    const missing = await explain('ana', '99');
    expect(missing.statusCode).toBe(404);
    modelMock.mockRejectedValueOnce(new Error('upstream is down'));
    const failed = await explain('ana', '2');
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    expect(uses().map((l) => [l.outcome, l.tokens])).toEqual([['not_found', 0], ['failed', 0]]);
  });

  it('logs a chat that failed', async () => {
    const { ask, uses, chatMock } = await portal({}, 100);
    // A stream whose first read fails, as one does when the model goes away mid-answer.
    chatMock.mockImplementationOnce(() => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('the model went away')) }) }) as never);
    await ask('ana');
    expect(uses()).toHaveLength(1);
    expect(uses()[0]).toMatchObject({ kind: 'chat', outcome: 'failed' });
  });

  it('marks a local model as not external, with no tokens', async () => {
    const { explain, uses } = await portal(LOCAL_ENV, 0);
    await explain('ana');
    expect(uses()[0]).toMatchObject({ provider: 'openai-compatible', external: false, tokens: 0 });
  });

  it('writes nothing for a call the limit turned away', async () => {
    const { explain, uses } = await portal({ AI_EXPLAIN_PER_MINUTE: '1' }, 10);
    await explain('ana', '1');
    expect((await explain('ana', '2')).statusCode).toBe(429);
    expect(uses()).toHaveLength(1);
  });

  it('cleans the name as the write-back trail does', async () => {
    const { explain, uses } = await portal({}, 10);
    await explain('x[y]z');
    expect(uses()[0].user).toBe('xyz');
  });
});

describe('aiUse', () => {
  it('logs a use once, whichever way the route reports its end', async () => {
    vi.resetModules();
    const { aiUse } = await import('../security/audit.js');
    const info = vi.fn();
    const req = { log: { info }, user: { sub: 'ana' }, ip: '10.9.8.7' } as never;
    const use = aiUse(req, 'chat');
    use.onUsage(30);
    use.onUsage(12);
    use.done('answered');
    use.done('failed');
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toMatchObject({ outcome: 'answered', tokens: 42 });
  });
});
