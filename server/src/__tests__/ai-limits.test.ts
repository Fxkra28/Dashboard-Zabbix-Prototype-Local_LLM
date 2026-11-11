import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * The caps on Explain and the Assistant: calls a minute for each user, and a daily token budget for
 * the hosted API. The real routes are mounted the way index.ts mounts them (global rate limit,
 * error handler, auth guard) with the model mocked, because the limit has to hold in that
 * arrangement: the rate-limit plugin's own route option does not, which is why limits.ts has a
 * guard.
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
// The real list cache over the stand-in, and the opdata a problem already has kept as it is.
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
  PORTAL_USERS: 'ana:viewer-pass:viewer,olu:operator-pass:operator',
  AI_PROVIDER: 'anthropic',
  ANTHROPIC_API_KEY: 'fake-key-for-tests',
  AI_CHAT_PER_MINUTE: '3',
  AI_EXPLAIN_PER_MINUTE: '2',
  AI_DAILY_TOKENS_PER_USER: '1000',
  AI_DAILY_TOKENS_TOTAL: '1500',
};
const LOCAL_ENV = { AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'http://localhost:11434/v1' };

const META = { generatedAt: 1, hosts: 1, sites: 1, problems: 1, unacknowledged: 0, slas: 0, degradedServices: 0, truncated: false };
const EXPLANATION = { summary: 's', tagsExplained: [], businessImpact: 'b', recommendation: 'r' };

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

/**
 * The portal fresh under `env`: config is read at import, so each scenario reloads the
 * modules. `chargeEach` is what the mocked model reports as the tokens a call used.
 */
async function portal(env: Record<string, string> = {}, chargeEach = { chat: 0, explain: 0 }) {
  vi.resetModules();
  // Nothing from the machine running the tests may leak into the case.
  for (const name of ['AI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_BASE_URL', 'AI_MAX_CONCURRENT', 'SLA_TIMEZONE']) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries({ ...BASE_ENV, ...env })) vi.stubEnv(name, value);

  const [{ registerErrorHandler }, { registerRateLimit }, { setupAuth, tokenClaims }, chatModule, aiModule, queries, limits] =
    await Promise.all([
      import('../http/errors.js'),
      import('../http/rateLimit.js'),
      import('../security/auth.js'),
      import('../services/assistant.js'),
      import('../clients/ai.js'),
      import('../domain/queries.js'),
      import('../clients/limits.js'),
    ]);
  const { chatRoutes } = await import('../routes/chat.js');
  const { explainRoutes } = await import('../routes/explain.js');

  vi.mocked(chatModule.getSnapshot).mockResolvedValue({ text: 'SNAPSHOT', meta: META, sizes: {}, fingerprint: 'f', complete: true, frozen: false } as never);
  vi.mocked(chatModule.streamAnswer).mockImplementation(async function* (_turns, _snapshot, _signal, options) {
    options?.onUsage?.(chargeEach.chat);
    yield 'An answer.';
  });
  vi.mocked(aiModule.humanize).mockImplementation((async (_kind: unknown, _payload: unknown, onUsage?: (n: number) => void) => {
    onUsage?.(chargeEach.explain);
    return EXPLANATION;
  }) as never);
  vi.mocked(queries.getProblems).mockResolvedValue(
    ['1', '2', '3', '4'].map((eventid) => ({ eventid, name: 'High ICMP ping loss', severity: '2', clock: '1788838236', acknowledged: '0', r_eventid: '0', host: 'h' })) as never,
  );

  const app = Fastify({ logger: false });
  apps.push(app);
  // As index.ts orders them: the global limit, the error handler, then auth, then the routes.
  await registerRateLimit(app);
  registerErrorHandler(app);
  await setupAuth(app);
  await app.register(chatRoutes);
  await app.register(explainRoutes);
  await app.ready();

  const as = (sub: string, role = 'viewer') => ({
    authorization: `Bearer ${app.jwt.sign({ sub, role, ...tokenClaims('hcml_session') }, { expiresIn: '1h' })}`,
  });
  return {
    app,
    as,
    ...limits,
    mocks: { streamAnswer: vi.mocked(chatModule.streamAnswer), humanize: vi.mocked(aiModule.humanize) },
    ask: (sub: string) =>
      app.inject({ method: 'POST', url: '/api/chat', headers: as(sub), payload: { messages: [{ role: 'user', content: 'hi' }] } }),
    explainProblem: (sub: string, eventid = '1') => app.inject({ url: `/api/explain/problem?eventid=${eventid}`, headers: as(sub) }),
    explainSla: (sub: string) => app.inject({ url: '/api/explain/sla', headers: as(sub) }),
  };
}

describe('calls a minute for each user', () => {
  it('stops one account after its Assistant allowance, says when to retry in plain words, and leaves another account alone', async () => {
    const { ask } = await portal();
    for (let i = 0; i < 3; i++) expect((await ask('ana')).statusCode).toBe(200);

    const refused = await ask('ana');
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({
      error: 'rate_limited',
      message: expect.stringMatching(/^You are asking too quickly: the limit is 3 questions to the assistant a minute for each person\. Try again in \d+ seconds?\.$/),
    });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(60);

    expect((await ask('olu')).statusCode).toBe(200);
  });

  it('counts Explain apart from the Assistant, and the problem and SLA explanations together', async () => {
    const { ask, explainProblem, explainSla } = await portal();
    expect((await explainProblem('ana')).statusCode).toBe(200);
    // No slaid: the route answers 400 for it, but the call was made and is counted.
    expect((await explainSla('ana')).statusCode).toBe(400);

    const refused = await explainProblem('ana', '2');
    expect(refused.statusCode).toBe(429);
    expect(refused.json().message).toMatch(/limit is 2 explanations a minute/);
    expect((await explainSla('ana')).statusCode).toBe(429);

    expect((await ask('ana')).statusCode).toBe(200);
    expect((await explainProblem('olu')).statusCode).toBe(200);
  });

  it('does not count the warm-up call the Assistant page makes when it opens', async () => {
    const { app, as } = await portal();
    for (let i = 0; i < 6; i++) expect((await app.inject({ url: '/api/chat/warm', headers: as('ana') })).statusCode).toBe(202);
  });

  it('applies to a local model as well: the two portals are compared under the same rules', async () => {
    const { ask } = await portal(LOCAL_ENV);
    for (let i = 0; i < 3; i++) expect((await ask('ana')).statusCode).toBe(200);
    expect((await ask('ana')).statusCode).toBe(429);
  });

  it('counts by client address when auth is off, as the live screens do', async () => {
    const { app } = await portal({ AUTH_ENABLED: 'false' });
    const from = (remoteAddress: string) =>
      app.inject({ method: 'POST', url: '/api/chat', remoteAddress, payload: { messages: [{ role: 'user', content: 'hi' }] } });
    for (let i = 0; i < 3; i++) expect((await from('10.0.0.5')).statusCode).toBe(200);
    expect((await from('10.0.0.5')).statusCode).toBe(429);
    expect((await from('10.0.0.6')).statusCode).toBe(200);
  });
});

describe('the daily token budget of the hosted API', () => {
  it('answers a plain 429 once a user has used their tokens, for the Assistant and for Explain, and leaves another user alone', async () => {
    const { ask, explainProblem, aiBudget } = await portal({}, { chat: 1_200, explain: 0 });
    expect((await ask('ana')).statusCode).toBe(200);
    expect(aiBudget.usedBy('user:ana')).toBe(1_200);

    for (const refused of [await ask('ana'), await explainProblem('ana')]) {
      expect(refused.statusCode).toBe(429);
      expect(refused.json().error).toBe('ai_budget');
      expect(refused.json().message).toMatch(/^You have used your share of AI answers for today\. It starts again at midnight \(Asia\/Jakarta\), about \d+ (minutes?|hours) from now\. The rest of the portal still works\.$/);
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(86_400);
    }
    // The budget says no before the model is asked, not after.
    expect(await ask('ana').then((r) => r.statusCode)).toBe(429);

    expect((await ask('olu')).statusCode).toBe(200);
  });

  it('refuses everyone once the whole portal has used its tokens', async () => {
    const { ask, explainProblem, mocks } = await portal({ AI_CHAT_PER_MINUTE: '50' }, { chat: 900, explain: 700 });
    expect((await ask('ana')).statusCode).toBe(200); // ana 900
    expect((await explainProblem('olu')).statusCode).toBe(200); // olu 700, 1,600 in all of 1,500
    mocks.streamAnswer.mockClear();

    for (const sub of ['ana', 'olu']) {
      const refused = await ask(sub);
      expect(refused.statusCode).toBe(429);
      expect(refused.json()).toMatchObject({ error: 'ai_budget', message: expect.stringMatching(/^The portal has used all of its AI answers for today\./) });
    }
    expect(mocks.streamAnswer).not.toHaveBeenCalled();
  });

  it('charges a model call and not an answer served from the cache', async () => {
    const { explainProblem, aiBudget, mocks } = await portal({ AI_EXPLAIN_PER_MINUTE: '50' }, { chat: 0, explain: 400 });
    await explainProblem('ana', '1');
    await explainProblem('ana', '1'); // cached: humanize is not called again
    expect(mocks.humanize).toHaveBeenCalledTimes(1);
    expect(aiBudget.usedBy('user:ana')).toBe(400);
    await explainProblem('ana', '2');
    expect(aiBudget.usedBy('user:ana')).toBe(800);
    expect(aiBudget.usedBy()).toBe(800);
  });

  it('is switched off by 0, for one budget or both', async () => {
    const { ask } = await portal({ AI_DAILY_TOKENS_PER_USER: '0', AI_DAILY_TOKENS_TOTAL: '0', AI_CHAT_PER_MINUTE: '50' }, { chat: 10_000_000, explain: 0 });
    for (let i = 0; i < 5; i++) expect((await ask('ana')).statusCode).toBe(200);
  });

  it('is not enforced for a local model, which has no bill', async () => {
    const { ask, aiBudget } = await portal({ ...LOCAL_ENV, AI_DAILY_TOKENS_PER_USER: '1', AI_DAILY_TOKENS_TOTAL: '1', AI_CHAT_PER_MINUTE: '50' }, { chat: 5_000, explain: 0 });
    for (let i = 0; i < 3; i++) expect((await ask('ana')).statusCode).toBe(200);
    // The table holds what the mocked model reported, so it is the guard, not an empty table, that lets these through.
    expect(aiBudget.refusal('user:ana')).not.toBeNull();
  });
});

describe('MinuteLimit', () => {
  it('lets max calls through, then names the seconds left, and opens a new minute when it is over', async () => {
    vi.resetModules();
    const { MinuteLimit } = await import('../clients/limits.js');
    let now = 1_000_000;
    const limit = new MinuteLimit(2, () => now);

    expect(limit.take('ana')).toBeNull();
    now += 10_000;
    expect(limit.take('ana')).toBeNull();
    now += 10_000;
    expect(limit.take('ana')).toBe(40); // the minute began at the first call, 20 s ago
    expect(limit.take('olu')).toBeNull(); // another key has its own

    now += 40_000;
    expect(limit.take('ana')).toBeNull();
  });

  it('keeps its table bounded when every call comes from a new key', async () => {
    vi.resetModules();
    const { MinuteLimit } = await import('../clients/limits.js');
    let now = 0;
    const limit = new MinuteLimit(1, () => now);
    for (let i = 0; i < 6_000; i++) limit.take(`ip:${i}`);
    // The oldest were dropped to make room, so the newest is still counted and an old one starts again.
    expect(limit.take('ip:5999')).not.toBeNull();
    expect(limit.take('ip:0')).toBeNull();
    now += 61_000;
    expect(limit.take('ip:5999')).toBeNull();
  });
});

describe('DailyTokens', () => {
  async function budget(limits = { perUser: 1_000, total: 0 }, zone = 'Asia/Jakarta', start = '2026-10-07T16:59:00Z') {
    vi.resetModules();
    const { DailyTokens } = await import('../clients/limits.js');
    const clock = { t: Date.parse(start) };
    return { clock, tokens: new DailyTokens(() => limits, () => zone, () => clock.t) };
  }

  it('starts everyone again at midnight in the portal zone, not in UTC', async () => {
    // 16:59 UTC is 23:59 in Jakarta: one minute of the day left.
    const { clock, tokens } = await budget();
    tokens.record('user:ana', 1_000);
    const refusal = tokens.refusal('user:ana');
    expect(refusal?.retryAfter).toBe(60);
    expect(refusal?.message).toContain('midnight (Asia/Jakarta), about 1 minute from now');

    clock.t += 2 * 60_000; // 17:01 UTC, after midnight in Jakarta, still the same day in UTC
    expect(tokens.refusal('user:ana')).toBeNull();
    expect(tokens.usedBy('user:ana')).toBe(0);
  });

  it('counts one user apart from another, and each token once', async () => {
    const { tokens } = await budget({ perUser: 1_000, total: 0 });
    tokens.record('user:ana', 999);
    tokens.record('user:olu', 5);
    expect(tokens.refusal('user:ana')).toBeNull();
    tokens.record('user:ana', 1);
    expect(tokens.refusal('user:ana')).not.toBeNull();
    expect(tokens.refusal('user:olu')).toBeNull();
    expect(tokens.usedBy()).toBe(1_005);
  });

  it('ignores a count that is not a positive number', async () => {
    const { tokens } = await budget();
    for (const bad of [0, -5, Number.NaN]) tokens.record('user:ana', bad);
    expect(tokens.usedBy('user:ana')).toBe(0);
  });

  it('rolls over at the end of a month and of a year', async () => {
    // 16:30 UTC on 31 October is 23:30 in Jakarta, so the day ends in 30 minutes.
    const october = await budget({ perUser: 1, total: 0 }, 'Asia/Jakarta', '2026-10-31T16:30:00Z');
    october.tokens.record('user:ana', 1);
    expect(october.tokens.refusal('user:ana')?.retryAfter).toBe(30 * 60);
    october.clock.t += 31 * 60_000;
    expect(october.tokens.refusal('user:ana')).toBeNull();

    const december = await budget({ perUser: 1, total: 0 }, 'Asia/Jakarta', '2026-12-31T16:30:00Z');
    december.tokens.record('user:ana', 1);
    expect(december.tokens.refusal('user:ana')?.retryAfter).toBe(30 * 60);
    december.clock.t += 31 * 60_000;
    expect(december.tokens.refusal('user:ana')).toBeNull();
  });

  it('says the wait in hours when it is long, and falls back to UTC for a zone it does not know', async () => {
    const { tokens } = await budget({ perUser: 1, total: 0 }, 'Not/AZone', '2026-10-07T05:00:00Z');
    tokens.record('user:ana', 1);
    const refusal = tokens.refusal('user:ana');
    expect(refusal?.retryAfter).toBe(19 * 3_600);
    expect(refusal?.message).toContain('about 19 hours from now');
  });
});
