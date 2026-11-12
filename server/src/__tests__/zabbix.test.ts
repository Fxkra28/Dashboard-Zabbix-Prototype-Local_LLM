import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { config } from '../core/config.js';
import { registerErrorHandler } from '../http/errors.js';
import { ZabbixApiError, ZabbixAuthError, ZabbixRefusedError, ZabbixTimeoutError, requestNeverLeft, zbx } from '../clients/zabbix.js';

/**
 * The JSON-RPC client against a throwaway local HTTP server standing in for
 * api_jsonrpc.php: real sockets and a real `fetch`, so a body that stalls or
 * is not JSON fails the way it would against a struggling Zabbix.
 */
type Handler = (res: http.ServerResponse) => void;
let answer: Handler = (res) => res.end('{}');
let server: http.Server;
let url = '';

const saved = { zbxUrl: config.zbxUrl, zbxTimeoutMs: config.zbxTimeoutMs };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    // No keep-alive: afterEach closes idle connections, and fetch would reuse
    // a closed one in the next test and fail it with ECONNRESET.
    res.setHeader('Connection', 'close');
    req.resume();
    req.on('end', () => answer(res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api_jsonrpc.php`;
});

afterEach(() => {
  config.zbxUrl = saved.zbxUrl;
  config.zbxTimeoutMs = saved.zbxTimeoutMs;
  server.closeIdleConnections();
});

afterAll(async () => {
  // The stalled body's response never ends by itself.
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function zabbixAnswers(handler: Handler): void {
  config.zbxUrl = url;
  config.zbxTimeoutMs = 1_000;
  answer = handler;
}

/** What `zbx()` rejected with. */
async function failure(method = 'host.get'): Promise<Error & { detail?: string }> {
  try {
    await zbx(method, {});
  } catch (err) {
    return err as Error & { detail?: string };
  }
  throw new Error('expected zbx() to reject');
}

describe('zbx()', () => {
  it('returns the JSON-RPC result', async () => {
    zabbixAnswers((res) => res.end(JSON.stringify({ jsonrpc: '2.0', result: [{ hostid: '1' }], id: 1 })));
    expect(await zbx('host.get')).toEqual([{ hostid: '1' }]);
  });

  it('turns a non-JSON 200 into a typed error that keeps the address out of the message', async () => {
    // What zabbix-web printed when PHP ran out of memory on a large trend.get.
    zabbixAnswers((res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<br />\n<b>Fatal error</b>: Allowed memory size of 134217728 bytes exhausted');
    });
    const err = await failure('trend.get');
    expect(err).toBeInstanceOf(ZabbixApiError);
    expect(err.message).toMatch(/^trend\.get: Zabbix returned a non-JSON response/);
    expect(err.message).not.toContain('127.0.0.1');
    expect(err.detail).toContain(url);
    expect(err.detail).toContain('Allowed memory size');
  });

  it('treats a JSON body that is not an object as non-JSON-RPC, not a crash', async () => {
    zabbixAnswers((res) => res.end('null'));
    expect(await failure()).toBeInstanceOf(ZabbixApiError);
  });

  it('times out a body that stalls after the headers', async () => {
    zabbixAnswers((res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"jsonrpc":"2.0","result":[');
      // …and never finishes.
    });
    config.zbxTimeoutMs = 100;
    const err = await failure('history.get');
    expect(err).toBeInstanceOf(ZabbixTimeoutError);
    expect(err.message).toContain('history.get');
    expect(err.message).not.toContain('127.0.0.1');
  });

  it('lets one read wait longer than ZABBIX_TIMEOUT_MS when it asks to', async () => {
    zabbixAnswers((res) => {
      setTimeout(() => res.end('{"jsonrpc":"2.0","result":"33227","id":1}'), 300);
    });
    config.zbxTimeoutMs = 100;
    await expect(zbx('item.get', { countOutput: true }, { timeoutMs: 2_000 })).resolves.toBe('33227');
    expect((await failure('item.get')).message).toContain('within 100 ms');
  });

  it('names the limit the read asked for when that one runs out', async () => {
    zabbixAnswers((res) => {
      setTimeout(() => res.end('{"jsonrpc":"2.0","result":"1","id":1}'), 300);
    });
    config.zbxTimeoutMs = 2_000;
    const err = await zbx('item.get', {}, { timeoutMs: 100 }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(ZabbixTimeoutError);
    expect((err as Error).message).toContain('within 100 ms');
  });

  it('names the system error code but not the address when nothing answers', async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    config.zbxUrl = `http://127.0.0.1:${port}/api_jsonrpc.php`;

    const err = await failure();
    expect(err).toBeInstanceOf(ZabbixApiError);
    expect(err.message).toContain('ECONNREFUSED');
    expect(err.message).not.toContain(String(port));
    expect(err.detail).toContain(config.zbxUrl);
  });

  it('keeps Zabbix error text and the auth distinction', async () => {
    zabbixAnswers((res) =>
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32602, data: 'Invalid parameter "/1".' }, id: 1 })),
    );
    const err = await failure();
    expect(err).toBeInstanceOf(ZabbixApiError);
    expect(err.message).toContain('Invalid parameter');

    zabbixAnswers((res) =>
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32602, data: 'Not authorized.' }, id: 1 })),
    );
    expect(await failure()).toBeInstanceOf(ZabbixAuthError);
  });

  it('marks an error Zabbix itself answered with as a refusal, which is still an API error (BK-43)', async () => {
    zabbixAnswers((res) =>
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32500, data: 'Cannot close problem: the trigger does not allow it.' }, id: 1 })),
    );
    const err = await failure();
    expect(err).toBeInstanceOf(ZabbixRefusedError);
    expect(err).toBeInstanceOf(ZabbixApiError);
    expect(err.message).toContain('Cannot close problem');
  });

  it('does not call a Zabbix that could not be reached, an HTTP error or a body that is not JSON a refusal (BK-43)', async () => {
    zabbixAnswers((res) => res.end('<html>login</html>'));
    expect(await failure()).not.toBeInstanceOf(ZabbixRefusedError);

    zabbixAnswers((res) => {
      res.statusCode = 503;
      res.end('busy');
    });
    const http503 = await failure();
    expect(http503).toBeInstanceOf(ZabbixApiError);
    expect(http503).not.toBeInstanceOf(ZabbixRefusedError);

    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    config.zbxUrl = `http://127.0.0.1:${port}/api_jsonrpc.php`;
    expect(await failure()).not.toBeInstanceOf(ZabbixRefusedError);
  });

  it('maps both failures to typed responses whose bodies do not carry ZBX_URL', async () => {
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    app.get('/probe', () => zbx('problem.get'));
    await app.ready();

    zabbixAnswers((res) => res.end('<html>login</html>'));
    const nonJson = await app.inject({ url: '/probe' });
    expect(nonJson.statusCode).toBe(502);
    expect(nonJson.json().error).toBe('zabbix_error');
    expect(nonJson.body).not.toContain('127.0.0.1');

    zabbixAnswers((res) => res.writeHead(200).write('{'));
    config.zbxTimeoutMs = 100;
    const stalled = await app.inject({ url: '/probe' });
    expect(stalled.statusCode).toBe(503);
    expect(stalled.json().error).toBe('zabbix_timeout');
    expect(stalled.body).not.toContain('127.0.0.1');
    await app.close();
  });
});

describe('zbx() and whether a failed request may have been applied (BK-53)', () => {
  const maybeApplied = async () => ((await failure('event.acknowledge')) as ZabbixApiError).maybeApplied;
  const closedPort = async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    return port;
  };

  it('marks an HTTP error status: the request arrived, and what it did is not said', async () => {
    zabbixAnswers((res) => {
      res.statusCode = 500;
      res.end('<html>Internal Server Error</html>');
    });
    expect(await maybeApplied()).toBe(true);
  });

  it('marks a 200 that is not JSON-RPC', async () => {
    zabbixAnswers((res) => res.end('<html>login</html>'));
    expect(await maybeApplied()).toBe(true);
  });

  it('marks a connection that was cut after the request arrived', async () => {
    zabbixAnswers((res) => res.socket?.destroy());
    expect(await maybeApplied()).toBe(true);
  });

  it('does not mark a port nobody listens on: the request never left', async () => {
    config.zbxUrl = `http://127.0.0.1:${await closedPort()}/api_jsonrpc.php`;
    expect(await maybeApplied()).toBe(false);
  });

  it('does not mark an error Zabbix answered with: it said no', async () => {
    zabbixAnswers((res) => res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32500, data: 'Cannot close problem.' }, id: 1 })));
    const err = await failure('event.acknowledge');
    expect(err).toBeInstanceOf(ZabbixRefusedError);
    expect((err as ZabbixApiError).maybeApplied).toBe(false);
  });
});

describe('requestNeverLeft (BK-53)', () => {
  it.each([
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EAI_FAIL',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENETDOWN',
    'UND_ERR_CONNECT_TIMEOUT',
    'ERR_INVALID_URL',
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ])('says that a failure with %s came before the request left', (code) => {
    expect(requestNeverLeft(code)).toBe(true);
  });

  it.each(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'ETIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT', 'ERR_STREAM_PREMATURE_CLOSE'])(
    'does not say it for %s, which can come after the request was sent',
    (code) => {
      expect(requestNeverLeft(code)).toBe(false);
    },
  );

  it.each([undefined, null, 7, ''])('does not say it when the code is %j', (code) => {
    expect(requestNeverLeft(code)).toBe(false);
  });
});
