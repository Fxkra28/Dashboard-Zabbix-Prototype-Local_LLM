import { afterEach, describe, expect, it, vi } from 'vitest';

/** STREAM_MAX_CLIENTS and STREAM_MAX_PER_USER as config.ts reads them. Own file: reloading config would split it for stream.test.ts. */
afterEach(() => vi.unstubAllEnvs());

async function streamLimits(env: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return (await import('../core/config.js')).config.stream;
}

describe('config.stream', () => {
  it('reads both limits from the environment, rounding down', async () => {
    expect(await streamLimits({ STREAM_MAX_CLIENTS: '40', STREAM_MAX_PER_USER: '2.9' })).toEqual({ maxClients: 40, maxPerUser: 2 });
  });

  it('cannot be set below 1, since 0 would refuse every screen', async () => {
    for (const value of ['0', '-3', '0.5']) {
      expect(await streamLimits({ STREAM_MAX_CLIENTS: value, STREAM_MAX_PER_USER: value }), value).toEqual({
        maxClients: 1,
        maxPerUser: 1,
      });
    }
  });

  it('falls back to 100 and 5 when unset, empty or not a number', async () => {
    for (const value of ['', 'many']) {
      expect(await streamLimits({ STREAM_MAX_CLIENTS: value, STREAM_MAX_PER_USER: value }), value).toEqual({
        maxClients: 100,
        maxPerUser: 5,
      });
    }
  });
});
