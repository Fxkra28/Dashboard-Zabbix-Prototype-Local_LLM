import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * How the environment sets the AI notice and the caps. The portal says in /api/health whether a
 * question to the AI leaves this machine, and the web shows a notice from that and nothing else:
 * only the hosted Anthropic backend sends data out, so a local model, on whatever address, shows
 * nothing. config.ts also reads each cap from the environment with a default, and never requires
 * one. Each case re-imports config, which reads the environment once.
 */

vi.mock('../domain/queries.js', () => ({
  getProblems: vi.fn().mockResolvedValue([]),
  cachedProblems: vi.fn().mockResolvedValue([]),
  PROBLEMS_TTL_MS: 15_000,
}));

const NAMES = [
  'AI_PROVIDER',
  'AI_API_KEY',
  'ANTHROPIC_API_KEY',
  'AI_BASE_URL',
  'AI_CHAT_PER_MINUTE',
  'AI_EXPLAIN_PER_MINUTE',
  'AI_MAX_CONCURRENT',
  'AI_DAILY_TOKENS_PER_USER',
  'AI_DAILY_TOKENS_TOTAL',
];

async function load(env: Record<string, string>) {
  vi.resetModules();
  // Nothing from the machine running the tests may leak into the case.
  for (const name of NAMES) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries({ AUTH_ENABLED: 'true', JWT_SECRET: 'test-only-secret-at-least-32-bytes-long', ...env })) {
    vi.stubEnv(name, value);
  }
  return import('../core/config.js');
}

/** What an anonymous caller of GET /api/health is told. */
async function healthUnder(env: Record<string, string>) {
  await load(env);
  const { registerHealth } = await import('../http/health.js');
  const app = Fastify({ logger: false });
  registerHealth(app, { get: async () => ({}), warm: () => undefined } as never);
  await app.ready();
  const body = (await app.inject({ url: '/api/health' })).json() as Record<string, unknown>;
  await app.close();
  return body;
}

afterEach(() => vi.unstubAllEnvs());

const HOSTED = { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'fake-key-for-tests' };

describe('GET /api/health says whether a question leaves this machine', () => {
  it('says so for the hosted API, and names it', async () => {
    expect(await healthUnder(HOSTED)).toMatchObject({ ai: true, aiProvider: 'anthropic', aiExternal: true });
  });

  it('says so for the hosted API when AI_PROVIDER is left out, as a portal set up with only a key runs it', async () => {
    expect(await healthUnder({ ANTHROPIC_API_KEY: 'fake-key-for-tests' })).toMatchObject({ aiProvider: 'anthropic', aiExternal: true });
  });

  it('shows nothing for a local model, whatever its address', async () => {
    for (const baseUrl of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:11434/v1',
      'http://host.docker.internal:11434/v1',
      'http://10.9.8.7:11434/v1',
    ]) {
      const body = await healthUnder({ AI_PROVIDER: 'openai-compatible', AI_BASE_URL: baseUrl });
      expect(body, baseUrl).toMatchObject({ ai: true, aiProvider: 'openai-compatible', aiExternal: false });
    }
  });

  it('shows nothing while the AI is off: there is no question to send', async () => {
    expect(await healthUnder({ AI_PROVIDER: 'anthropic' })).toMatchObject({ ai: false, aiExternal: false });
    // The placeholder .env.example ships is not a key.
    expect(await healthUnder({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'your_anthropic_api_key_here' })).toMatchObject({ ai: false, aiExternal: false });
    expect(await healthUnder({ AI_PROVIDER: 'openai-compatible' })).toMatchObject({ ai: false, aiExternal: false });
  });

  it('keeps every field it had', async () => {
    expect(await healthUnder(HOSTED)).toMatchObject({ ok: true, ai: true, writeBack: expect.any(Boolean), defaults: expect.any(Object) });
  });
});

describe('config.ai.external', () => {
  it('is true only for the hosted backend', async () => {
    expect((await load(HOSTED)).config.ai.external).toBe(true);
    expect((await load({ AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'https://gateway.example.com/v1' })).config.ai.external).toBe(false);
    expect((await load({ AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'http://localhost:11434/v1' })).config.ai.external).toBe(false);
  });
});

describe('config.ai.limits (SC-09)', () => {
  const DEFAULTS = { chatPerMinute: 10, explainPerMinute: 10, maxConcurrent: 4, dailyTokensPerUser: 500_000, dailyTokensTotal: 2_000_000 };

  it('needs nothing set: every cap has a default', async () => {
    expect((await load({})).config.ai.limits).toEqual(DEFAULTS);
  });

  it('reads each cap from its variable, rounding down', async () => {
    const { config } = await load({
      AI_CHAT_PER_MINUTE: '6.9',
      AI_EXPLAIN_PER_MINUTE: '20',
      AI_MAX_CONCURRENT: '2',
      AI_DAILY_TOKENS_PER_USER: '100000',
      AI_DAILY_TOKENS_TOTAL: '750000.5',
    });
    expect(config.ai.limits).toEqual({ chatPerMinute: 6, explainPerMinute: 20, maxConcurrent: 2, dailyTokensPerUser: 100_000, dailyTokensTotal: 750_000 });
  });

  it('falls back to the default for an empty or non-numeric value, as docker-compose passes an unset one', async () => {
    for (const value of ['', '  ', 'lots']) {
      const env = Object.fromEntries(NAMES.filter((n) => /PER_MINUTE|CONCURRENT|TOKENS/.test(n)).map((n) => [n, value]));
      expect((await load(env)).config.ai.limits, JSON.stringify(value)).toEqual(DEFAULTS);
    }
  });

  it('cannot set a rate or a concurrency below 1, since 0 would refuse every call', async () => {
    for (const value of ['0', '-3', '0.5']) {
      const { limits } = (await load({ AI_CHAT_PER_MINUTE: value, AI_EXPLAIN_PER_MINUTE: value, AI_MAX_CONCURRENT: value })).config.ai;
      expect([limits.chatPerMinute, limits.explainPerMinute, limits.maxConcurrent], value).toEqual([1, 1, 1]);
    }
  });

  it('lets a token budget be 0, or less, which switches it off', async () => {
    expect((await load({ AI_DAILY_TOKENS_PER_USER: '0', AI_DAILY_TOKENS_TOTAL: '0' })).config.ai.limits).toMatchObject({ dailyTokensPerUser: 0, dailyTokensTotal: 0 });
    expect((await load({ AI_DAILY_TOKENS_PER_USER: '-5', AI_DAILY_TOKENS_TOTAL: '-5' })).config.ai.limits).toMatchObject({ dailyTokensPerUser: 0, dailyTokensTotal: 0 });
  });
});
