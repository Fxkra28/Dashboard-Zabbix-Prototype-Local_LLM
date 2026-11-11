import { afterEach, describe, expect, it, vi } from 'vitest';

/** What the BFF says at startup about ZBX_TLS_PIN_SHA256 and ZBX_TLS_PIN_UNTIL. config.ts reads the environment once, so each case re-imports it. */
const FINGERPRINT = 'ab'.repeat(32);

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const name of ['ZBX_URL', 'ZBX_TLS_PIN_SHA256', 'ZBX_TLS_PIN_UNTIL']) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const { assertConfig, config } = await import('../core/config.js');
  const warnings: string[] = [];
  assertConfig((m) => warnings.push(m));
  return { config, said: warnings.filter((w) => /ZBX_TLS_PIN|expired Zabbix certificate/.test(w)) };
}

// Auth off keeps assertConfig from refusing to start on the test's lack of a JWT secret.
const base = { AUTH_ENABLED: 'false', ZABBIX_API_TOKEN: 't', ZBX_URL: 'https://zabbix.example.test/api_jsonrpc.php' };

afterEach(() => vi.unstubAllEnvs());

describe('the exception for an expired Zabbix certificate, at startup', () => {
  it('says at every start that it is on and on which day it ends, in WIB', async () => {
    const { config, said } = await load({ ...base, ZBX_TLS_PIN_SHA256: FINGERPRINT, ZBX_TLS_PIN_UNTIL: '2099-12-31' });
    expect(config.zbxTlsPin?.until).toBe('2099-12-31');
    expect(said).toEqual([expect.stringContaining('until the end of 2099-12-31 WIB')]);
  });

  it('says when it has ended', async () => {
    const { said } = await load({ ...base, ZBX_TLS_PIN_SHA256: FINGERPRINT, ZBX_TLS_PIN_UNTIL: '2020-01-01' });
    expect(said).toEqual([expect.stringContaining('ended on 2020-01-01')]);
  });

  it('is off, and says so, when only one half is set or a half cannot be read', async () => {
    const halves: Record<string, string>[] = [
      { ZBX_TLS_PIN_SHA256: FINGERPRINT },
      { ZBX_TLS_PIN_SHA256: FINGERPRINT, ZBX_TLS_PIN_UNTIL: '30/11/2026' },
    ];
    for (const env of halves) {
      const { config, said } = await load({ ...base, ...env });
      expect(config.zbxTlsPin).toBeUndefined();
      expect(said).toEqual([expect.stringContaining('go together')]);
    }
  });

  it('is not used with an http address', async () => {
    const http = { ...base, ZBX_URL: 'http://zabbix.example.test/api_jsonrpc.php' };
    const { said } = await load({ ...http, ZBX_TLS_PIN_SHA256: FINGERPRINT, ZBX_TLS_PIN_UNTIL: '2099-12-31' });
    expect(said).toEqual([expect.stringContaining('not https')]);
  });

  it('says nothing when neither is set', async () => {
    expect((await load(base)).said).toEqual([]);
  });
});
