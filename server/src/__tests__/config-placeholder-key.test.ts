import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The API key .env.example ships is a placeholder, not a key.
 * config.ts reads the environment once at import, so each case re-imports it.
 */
const PLACEHOLDER = 'your_anthropic_api_key_here';
const REAL = 'sk-ant-test-key-not-real';

async function load(env: Record<string, string>) {
  vi.resetModules();
  // Nothing from the machine running the tests may leak into the case.
  for (const name of ['AI_PROVIDER', 'AI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_BASE_URL']) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const { assertConfig, config } = await import('../core/config.js');
  const warnings: string[] = [];
  assertConfig((m) => warnings.push(m));
  return { config, warnings };
}

// Auth off keeps assertConfig from refusing to start on the test's lack of a JWT secret.
const base = { AUTH_ENABLED: 'false', ZABBIX_API_TOKEN: 't', ZABBIX_WRITE_TOKEN: 't' };

afterEach(() => vi.unstubAllEnvs());

describe('the placeholder API key from .env.example', () => {
  it('is not a key: Explain and the Assistant stay off', async () => {
    const { config } = await load({ ...base, ANTHROPIC_API_KEY: PLACEHOLDER });
    expect(config.ai.apiKey).toBe('');
    expect(config.ai.enabled).toBe(false);
  });

  it('says so at startup, by variable name, and the usual "not set" warning follows', async () => {
    const { warnings } = await load({ ...base, ANTHROPIC_API_KEY: PLACEHOLDER });
    const said = warnings.filter((w) => /placeholder/i.test(w));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('ANTHROPIC_API_KEY');
    expect(said[0]).toContain('.env.example');
    expect(warnings.some((w) => /ANTHROPIC_API_KEY is not set/.test(w))).toBe(true);
  });

  it('is recognised by its start, whatever the case, and with spaces around it', async () => {
    for (const value of ['your_key', 'YOUR_KEY_HERE', '  your_anthropic_api_key_here  ']) {
      const { config } = await load({ ...base, ANTHROPIC_API_KEY: value });
      expect(config.ai.enabled, JSON.stringify(value)).toBe(false);
    }
  });

  it('does not stop a real key from counting, and a real key draws no placeholder warning', async () => {
    const { config, warnings } = await load({ ...base, ANTHROPIC_API_KEY: REAL });
    expect(config.ai.apiKey).toBe(REAL);
    expect(config.ai.enabled).toBe(true);
    expect(warnings.filter((w) => /placeholder/i.test(w))).toEqual([]);
  });

  it('does not stop a key that merely contains the word, or starts differently', async () => {
    for (const value of ['sk-ant-your_key', 'yourkey', 'my_your_key']) {
      const { config } = await load({ ...base, ANTHROPIC_API_KEY: value });
      expect(config.ai.apiKey, value).toBe(value);
    }
  });

  it('is skipped in favour of the other variable when that one holds a real key', async () => {
    const first = await load({ ...base, AI_API_KEY: PLACEHOLDER, ANTHROPIC_API_KEY: REAL });
    expect(first.config.ai.apiKey).toBe(REAL);
    const second = await load({ ...base, AI_API_KEY: REAL, ANTHROPIC_API_KEY: PLACEHOLDER });
    expect(second.config.ai.apiKey).toBe(REAL);
  });

  it('names both variables when both hold it', async () => {
    const { warnings, config } = await load({ ...base, AI_API_KEY: PLACEHOLDER, ANTHROPIC_API_KEY: PLACEHOLDER });
    expect(config.ai.enabled).toBe(false);
    expect(warnings.find((w) => /placeholder/i.test(w))).toContain('AI_API_KEY and ANTHROPIC_API_KEY');
  });

  it('never reaches a local model as a Bearer token: no key is sent, and the model still works', async () => {
    const { config, warnings } = await load({
      ...base,
      AI_PROVIDER: 'openai-compatible',
      AI_BASE_URL: 'http://localhost:11434/v1',
      AI_API_KEY: PLACEHOLDER,
    });
    expect(config.ai.apiKey).toBe('');
    expect(config.ai.enabled).toBe(true);
    expect(warnings.some((w) => /placeholder/i.test(w))).toBe(true);
  });

  it('is not the local model’s business when it sits in the Anthropic variable only', async () => {
    const { config, warnings } = await load({
      ...base,
      AI_PROVIDER: 'openai-compatible',
      AI_BASE_URL: 'http://localhost:11434/v1',
      ANTHROPIC_API_KEY: PLACEHOLDER,
    });
    expect(config.ai.enabled).toBe(true);
    expect(warnings.filter((w) => /placeholder/i.test(w))).toEqual([]);
  });
});
