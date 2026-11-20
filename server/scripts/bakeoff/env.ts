/**
 * What the bake-off tells the portal's code about the model. The portal reads its settings once, when its code is first imported, so a script imports this file before
 * anything of the portal's.
 */

export const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

export const model = arg('model');

Object.assign(process.env, {
  AI_PROVIDER: 'openai-compatible',
  AI_BASE_URL: arg('base') ?? 'http://127.0.0.1:11434/v1',
  AI_MODEL: model ?? 'qwen3:8b',
  AI_OLLAMA_NATIVE: 'true',
  AI_NUM_CTX: '8192',
  AI_KEEP_ALIVE: '15m',
  AI_TIMEOUT_MS: '300000',
  AUTH_ENABLED: 'false',
});
delete process.env.AI_TEMPERATURE;
delete process.env.AI_TOP_P;
