import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The local-model copy promises that no question leaves the machine (SC-53). Its compose file sets AI_LOCAL_ONLY, and the server then
 * refuses to start with a model outside this machine's own network, unless AI_ALLOW_REMOTE says the owner means it.
 * config.ts reads the environment once at import, so each case re-imports it.
 */
const NAMES = ['AI_PROVIDER', 'AI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_BASE_URL', 'AI_LOCAL_ONLY', 'AI_ALLOW_REMOTE', 'AI_MODEL'];
const base = { AUTH_ENABLED: 'false', ZABBIX_API_TOKEN: 't', ZABBIX_WRITE_TOKEN: 't' };

async function start(env: Record<string, string>) {
  vi.resetModules();
  for (const name of NAMES) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries({ ...base, ...env })) vi.stubEnv(name, value);
  const { assertConfig, config } = await import('../core/config.js');
  const warnings: string[] = [];
  const run = () => assertConfig((m) => warnings.push(m));
  return { config, warnings, run };
}

afterEach(() => vi.unstubAllEnvs());

const LOCAL_COPY = { AI_LOCAL_ONLY: 'true', AI_PROVIDER: 'openai-compatible' };

describe('AI_LOCAL_ONLY', () => {
  it('starts with a model on this machine or its own network', async () => {
    for (const AI_BASE_URL of ['http://host.docker.internal:11434/v1', 'http://localhost:11434/v1', 'http://10.1.2.3:11434/v1', 'http://ollama:11434/v1']) {
      const { run, warnings } = await start({ ...LOCAL_COPY, AI_BASE_URL });
      expect(run, AI_BASE_URL).not.toThrow();
      expect(warnings.filter((w) => /AI_ALLOW_REMOTE|send nothing away/.test(w)), AI_BASE_URL).toEqual([]);
    }
  });

  it('refuses to start with a model outside it, and says which setting allows that, without naming the address', async () => {
    const { run } = await start({ ...LOCAL_COPY, AI_BASE_URL: 'https://gateway.example.com/v1' });
    expect(run).toThrow(/AI_ALLOW_REMOTE/);
    expect(run).toThrow(/send nothing away/);
    expect(run).not.toThrow(/gateway\.example\.com/);
  });

  it('refuses an address it cannot read, as one it cannot show to be local', async () => {
    const { run } = await start({ ...LOCAL_COPY, AI_BASE_URL: 'ollama:11434' });
    expect(run).toThrow(/AI_ALLOW_REMOTE/);
  });

  it('refuses the hosted API too, since it is outside by its nature', async () => {
    const { run } = await start({ AI_LOCAL_ONLY: 'true', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test-key-not-real' });
    expect(run).toThrow(/AI_ALLOW_REMOTE/);
  });

  it('starts, and says so in a warning, when AI_ALLOW_REMOTE=true: the notice then shows on every answer', async () => {
    const { run, warnings, config } = await start({ ...LOCAL_COPY, AI_BASE_URL: 'https://gateway.example.com/v1', AI_ALLOW_REMOTE: 'true' });
    expect(run).not.toThrow();
    expect(config.ai.external).toBe(true);
    expect(warnings.some((w) => /AI_ALLOW_REMOTE=true/.test(w) && /every question/.test(w))).toBe(true);
  });

  it('takes only the word true for AI_ALLOW_REMOTE', async () => {
    for (const AI_ALLOW_REMOTE of ['yes', '1', 'TRUE ', 'false', '']) {
      const { run } = await start({ ...LOCAL_COPY, AI_BASE_URL: 'https://gateway.example.com/v1', AI_ALLOW_REMOTE });
      if (AI_ALLOW_REMOTE.trim().toLowerCase() === 'true') expect(run, AI_ALLOW_REMOTE).not.toThrow();
      else expect(run, JSON.stringify(AI_ALLOW_REMOTE)).toThrow(/AI_ALLOW_REMOTE/);
    }
  });

  it('asks nothing of a portal that is off, or of a copy that is not local-only', async () => {
    expect((await start({ AI_LOCAL_ONLY: 'true', AI_PROVIDER: 'openai-compatible' })).run).not.toThrow(); // no AI_BASE_URL: the AI is off
    expect((await start({ AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'https://gateway.example.com/v1' })).run).not.toThrow();
    expect((await start({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test-key-not-real' })).run).not.toThrow();
  });
});

describe('a cloud model behind a local address (SC-70)', () => {
  const LOCAL_ADDRESS = { ...LOCAL_COPY, AI_BASE_URL: 'http://ollama:11434/v1' };

  it.each(['gpt-oss:120b-cloud', 'qwen3-coder:480b-cloud', 'kimi-k2:cloud', 'DeepSeek-V3.1:671b-CLOUD'])('refuses %s, which Ollama sends to ollama.com whatever address it is asked at', async (AI_MODEL) => {
    const { run, config } = await start({ ...LOCAL_ADDRESS, AI_MODEL });
    expect(config.ai.external).toBe(true);
    expect(run).toThrow(/ollama\.com/);
    expect(run).toThrow(/AI_ALLOW_REMOTE/);
  });

  it.each(['qwen3:8b', 'gemma4:12b', 'cloudy-bert:7b', 'mycloud'])('keeps %s, a model that runs on this machine', async (AI_MODEL) => {
    const { run, config } = await start({ ...LOCAL_ADDRESS, AI_MODEL });
    expect(config.ai.external).toBe(false);
    expect(run, AI_MODEL).not.toThrow();
  });

  it('starts with a cloud model when AI_ALLOW_REMOTE=true, and says so in a warning', async () => {
    const { run, warnings } = await start({ ...LOCAL_ADDRESS, AI_MODEL: 'gpt-oss:120b-cloud', AI_ALLOW_REMOTE: 'true' });
    expect(run).not.toThrow();
    expect(warnings.some((w) => /AI_ALLOW_REMOTE=true/.test(w))).toBe(true);
  });

  it('counts a cloud model as outside in a copy that is not local-only too, so the outside-model rules apply to it', async () => {
    const { config, run } = await start({ AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'http://ollama:11434/v1', AI_MODEL: 'gpt-oss:120b-cloud' });
    expect(config.ai.external).toBe(true);
    expect(run).not.toThrow();
  });
});
