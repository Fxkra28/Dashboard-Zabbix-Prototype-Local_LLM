import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, parseTlsPin } from '../core/config.js';
import { PinnedTlsError, postPinned } from '../clients/pinnedTls.js';
import { ZabbixApiError, ZabbixTimeoutError, zbx } from '../clients/zabbix.js';

/** How zbx() reaches Zabbix while ZBX_TLS_PIN_SHA256 is set. The connection itself is tested in pinned-tls.test.ts. */
vi.mock('../clients/pinnedTls.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/pinnedTls.js')>()),
  postPinned: vi.fn(),
}));

const HTTPS_URL = 'https://zabbix.example.test/api_jsonrpc.php';
const pin = parseTlsPin('AB'.repeat(32), '2099-12-31');
const saved = { zbxUrl: config.zbxUrl, zbxTlsPin: config.zbxTlsPin, zbxToken: config.zbxToken };
const posted = vi.mocked(postPinned);

afterEach(() => {
  Object.assign(config, saved);
  posted.mockReset();
  vi.unstubAllGlobals();
});

function setUp(url: string, withPin = true): void {
  config.zbxUrl = url;
  config.zbxTlsPin = withPin ? pin : undefined;
  config.zbxToken = 'read-token';
}

async function failure(): Promise<Error & { detail?: string }> {
  try {
    await zbx('problem.get', {});
  } catch (err) {
    return err as Error & { detail?: string };
  }
  throw new Error('expected zbx() to reject');
}

function fetchAnswering(result: unknown) {
  const fake = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', result, id: 1 })));
  vi.stubGlobal('fetch', fake);
  return fake;
}

describe('zbx() with ZBX_TLS_PIN_SHA256 set', () => {
  it('posts through the pinned agent and reads the result', async () => {
    setUp(HTTPS_URL);
    posted.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: JSON.stringify({ jsonrpc: '2.0', result: [{ hostid: '1' }], id: 1 }),
    });
    expect(await zbx('host.get', { output: ['hostid'] })).toEqual([{ hostid: '1' }]);
    const [url, headers, body] = posted.mock.calls[0];
    expect(url).toBe(HTTPS_URL);
    expect(headers).toMatchObject({ Authorization: 'Bearer read-token' });
    expect(JSON.parse(body)).toMatchObject({ method: 'host.get', params: { output: ['hostid'] } });
  });

  it('turns a refused certificate into a ZabbixApiError that names the code and keeps the address for the log', async () => {
    setUp(HTTPS_URL);
    posted.mockRejectedValueOnce(
      new PinnedTlsError('ZBX_TLS_PIN_ENDED', 'The exception for the expired certificate ended on 2099-12-31. Renew the certificate.'),
    );
    const err = await failure();
    expect(err).toBeInstanceOf(ZabbixApiError);
    expect(err.message).toContain('problem.get (ZBX_TLS_PIN_ENDED)');
    expect(err.message).toContain('ended on 2099-12-31');
    expect(err.message).not.toContain('zabbix.example.test');
    expect(err.detail).toContain(HTTPS_URL);
  });

  it('turns the deadline into a ZabbixTimeoutError', async () => {
    setUp(HTTPS_URL);
    posted.mockRejectedValueOnce(Object.assign(new Error('No answer within 10000 ms.'), { name: 'TimeoutError' }));
    expect(await failure()).toBeInstanceOf(ZabbixTimeoutError);
  });

  it('leaves an http address on fetch', async () => {
    setUp('http://127.0.0.1:1/api_jsonrpc.php');
    const fake = fetchAnswering(7);
    expect(await zbx('apiinfo.version')).toBe(7);
    expect(fake).toHaveBeenCalledOnce();
    expect(posted).not.toHaveBeenCalled();
  });
});

describe('zbx() without a pin', () => {
  it('keeps an https address on fetch, as before', async () => {
    setUp(HTTPS_URL, false);
    const fake = fetchAnswering('7.0.0');
    expect(await zbx('apiinfo.version')).toBe('7.0.0');
    expect(fake).toHaveBeenCalledOnce();
    expect(posted).not.toHaveBeenCalled();
  });
});
