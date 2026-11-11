import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerErrorHandler } from '../http/errors.js';
import { registerRequestId } from '../http/requestId.js';
import { ZabbixApiError, ZabbixAuthError, ZabbixTimeoutError } from '../clients/zabbix.js';

/** When Zabbix cannot be read, every reader gets the same sentence and a reference; the method, setting and Zabbix's words go to the log under the same request id. */

async function appThatThrows(err: Error) {
  const lines: string[] = [];
  const app = Fastify({ logger: { level: 'info', stream: { write: (line: string) => lines.push(line) } } });
  registerRequestId(app);
  registerErrorHandler(app);
  app.get('/api/x', async () => {
    throw err;
  });
  await app.ready();
  return { app, lines };
}

const CASES: [string, number, string, Error][] = [
  [
    'a Zabbix error',
    502,
    'zabbix_error',
    new ZabbixApiError('problem.get: {"code":-32602,"data":"Invalid params"}', 'ZBX_URL=http://zabbix.internal:8080'),
  ],
  [
    'a timeout',
    503,
    'zabbix_timeout',
    new ZabbixTimeoutError('Zabbix did not respond to item.get within 10000 ms. Check ZBX_URL.', 'ZBX_URL=http://zabbix.internal:8080'),
  ],
  [
    'a rejected token',
    503,
    'zabbix_auth',
    new ZabbixAuthError('Zabbix rejected the API token. Update ZABBIX_API_TOKEN in server/.env.'),
  ],
];

describe('a Zabbix failure as a reader sees it', () => {
  it.each(CASES)('says one sentence with the request id for %s, and keeps the code', async (_name, status, code, err) => {
    const { app } = await appThatThrows(err);
    const res = await app.inject({ url: '/api/x' });
    const id = res.headers['x-request-id'];
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({
      error: code,
      message: `The data source is not answering. Tell an administrator and quote reference ${id}.`,
      requestId: id,
    });
    await app.close();
  });

  it.each(CASES)('names no method, setting or address in the body for %s', async (_name, _status, _code, err) => {
    const { app } = await appThatThrows(err);
    const res = await app.inject({ url: '/api/x' });
    expect(res.body).not.toMatch(/problem\.get|item\.get|ZBX_URL|ZABBIX_API_TOKEN|\.env|zabbix\.internal|Invalid params/);
    await app.close();
  });

  it.each(CASES)('logs the full wording with the same request id for %s', async (_name, _status, _code, err) => {
    const { app, lines } = await appThatThrows(err);
    const res = await app.inject({ url: '/api/x' });
    const logged = lines.map((l) => JSON.parse(l) as { reqId?: string; msg?: string; detail?: string; level: number });
    const line = logged.find((l) => l.level >= 50 && l.msg === err.message);
    expect(line, 'an error line with the original message').toBeDefined();
    expect(line?.reqId).toBe(res.headers['x-request-id']);
    if ('detail' in err && err.detail) expect(line?.detail).toBe(err.detail);
    await app.close();
  });
});
