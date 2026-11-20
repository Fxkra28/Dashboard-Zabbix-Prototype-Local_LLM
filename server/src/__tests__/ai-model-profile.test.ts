import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * What each model family is asked for (P3.3): the switch that stops it thinking, and the sampling its own card gives for answers without thinking. A model the portal
 * does not know has neither, and the owner's AI_TEMPERATURE and AI_TOP_P still overrule a card.
 */

const BASE = { AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'http://localhost:11434/v1', AI_OLLAMA_NATIVE: 'true' };

async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries({ ...BASE, ...env })) vi.stubEnv(k, v);
  return import('../clients/ai.js');
}
afterEach(() => vi.unstubAllEnvs());

describe('modelProfile', () => {
  it('knows the families that think first, and asks Qwen3 and Qwen3.5 and Gemma 4 for what their cards give', async () => {
    const { modelProfile } = await load();
    expect(modelProfile('qwen3:8b')).toEqual({ reasoning: true, sampling: { temperature: 0.7, top_p: 0.8, top_k: 20 } });
    expect(modelProfile('qwen3.5:9b')).toEqual({ reasoning: true, sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5 } });
    expect(modelProfile('gemma4:12b')).toEqual({ reasoning: true, sampling: { temperature: 1.0, top_p: 0.95, top_k: 64 } });
    expect(modelProfile('gemma4:26b').reasoning).toBe(true);
    for (const model of ['deepseek-r1:8b', 'gpt-oss:20b', 'magistral:24b']) expect(modelProfile(model), model).toEqual({ reasoning: true });
  });

  it('leaves a model it does not know with no switch and no sampling of its own', async () => {
    const { modelProfile, thinkingControl, samplingFor } = await load();
    for (const model of ['llama3.1:8b', 'mistral:7b', 'claude-sonnet-4-6', '']) {
      expect(modelProfile(model), model).toEqual({ reasoning: false });
      expect(thinkingControl(model), model).toEqual({});
      expect(samplingFor(model), model).toEqual({ temperature: 0.7, top_p: 0.8 });
    }
  });

  it('keeps Qwen3.5 apart from Qwen3: the penalty is its card\'s alone', async () => {
    const { samplingFor } = await load();
    expect(samplingFor('qwen3:8b')).not.toHaveProperty('presence_penalty');
    expect(samplingFor('qwen3.5:9b').presence_penalty).toBe(1.5);
    expect(samplingFor('gemma4:12b')).toEqual({ temperature: 1.0, top_p: 0.95, top_k: 64 });
  });

  it('lets the owner\'s settings overrule a card, each on its own', async () => {
    const both = await load({ AI_TEMPERATURE: '0.3', AI_TOP_P: '0.5' });
    expect(both.samplingFor('gemma4:12b')).toEqual({ temperature: 0.3, top_p: 0.5, top_k: 64 });
    const one = await load({ AI_TEMPERATURE: '0.2' });
    expect(one.samplingFor('qwen3:8b')).toEqual({ temperature: 0.2, top_p: 0.8, top_k: 20 });
    // Set and empty is not set.
    const blank = await load({ AI_TEMPERATURE: '' });
    expect(blank.samplingFor('gemma4:12b').temperature).toBe(1.0);
  });
});

describe('the request a model gets', () => {
  it('stops a thinking model from thinking and gives it its card\'s sampling, in the native body', async () => {
    const { ollamaChatBody } = await load({ AI_MODEL: 'gemma4:12b' });
    const body = ollamaChatBody([], { numPredict: 700 });
    expect(body).toMatchObject({ model: 'gemma4:12b', think: false, options: { num_ctx: 8192, num_predict: 700, temperature: 1.0, top_p: 0.95, top_k: 64 } });
  });

  it('sends nothing a model without the switch could refuse', async () => {
    const { ollamaChatBody } = await load({ AI_MODEL: 'llama3.1:8b' });
    const body = ollamaChatBody([], { numPredict: 700 });
    expect(body).not.toHaveProperty('think');
    expect(body.options).toEqual({ num_ctx: 8192, num_predict: 700, temperature: 0.7, top_p: 0.8 });
  });

  it('asks for the reasoning switch of /v1 only from the families that have it', async () => {
    const { thinkingControl } = await load();
    expect(thinkingControl('qwen3.5:9b')).toEqual({ reasoning_effort: 'none' });
    expect(thinkingControl('gemma4:12b')).toEqual({ reasoning_effort: 'none' });
    expect(thinkingControl('llama3.1:8b')).toEqual({});
  });
});

describe('the language of an explanation', () => {
  it('asks for Bahasa Indonesia, keeping the keys, the names and the numbers, only when the user chose it', async () => {
    const { languageLine } = await load();
    expect(languageLine('id')).toContain('Bahasa Indonesia');
    expect(languageLine('id')).toContain('JSON keys');
    expect(languageLine('en')).toBe('');
    expect(languageLine(null)).toBe('');
    expect(languageLine(undefined)).toBe('');
  });
});
