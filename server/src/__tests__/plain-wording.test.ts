import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerErrorHandler, SOURCE_DOWN } from '../http/errors.js';
import { genReqId, registerRequestId } from '../http/requestId.js';
import { ZabbixWriteDisabledError } from '../clients/zabbix.js';
import { AI_MESSAGE, AiDisabledError } from '../clients/ai.js';
import { publicMessage } from '../services/chat.js';

/**
 * UX-20: a sentence the server sends to a screen is the same plain thing for everyone, an operator included: what
 * happened, and to tell an administrator. The setting to change, the file it lives in and the server's own wording go to the log.
 */

/** Names of settings (ZABBIX_WRITE_TOKEN), the file they live in, and the part of the system that is nothing to a reader. */
const INTERNAL = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\.env\b|\bBFF\b|\bnpm\b|\bdocker\b/;

/** An app with the real error handler, and the log lines it writes. */
async function appRunning(routes: (app: ReturnType<typeof Fastify>) => void) {
  const lines: string[] = [];
  const app = Fastify({ logger: { level: 'info', stream: { write: (line: string) => lines.push(line) } }, genReqId });
  registerRequestId(app);
  registerErrorHandler(app);
  routes(app);
  return { app, log: () => lines.join('\n') };
}

describe('the sentences a screen can be sent', () => {
  it('name no setting, no file and no part of the system', () => {
    const sentences = {
      aiOff: new AiDisabledError().message,
      writeOff: new ZabbixWriteDisabledError().message,
      sourceDown: SOURCE_DOWN,
      assistantCrash: publicMessage(new Error('boom at /srv/app/chat.ts:12')),
      ...AI_MESSAGE,
    };
    for (const [name, text] of Object.entries(sentences)) {
      expect(text, name).not.toMatch(INTERNAL);
      expect(text, name).not.toMatch(/[—–]/);
    }
  });

  it('tell the reader to ask an administrator when only an administrator can act', () => {
    for (const text of [new AiDisabledError().message, new ZabbixWriteDisabledError().message, AI_MESSAGE.refused, publicMessage(new Error('x'))]) {
      expect(text).toMatch(/Tell an administrator/i);
    }
  });
});

describe('what is kept for the log (UX-20)', () => {
  it('writes the setting for a missing write token to the log and not to the response', async () => {
    const { app, log } = await appRunning((a) =>
      a.get('/x', async () => {
        throw new ZabbixWriteDisabledError();
      }),
    );
    const res = await app.inject({ url: '/x' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'zabbix_write_disabled', message: 'Acknowledge and Close are not switched on for this portal. Tell an administrator.' });
    expect(res.body).not.toMatch(/ZABBIX_WRITE_TOKEN|\.env/);
    expect(log()).toContain('ZABBIX_WRITE_TOKEN');
    expect(log()).toContain('server/.env');
    await app.close();
  });

  it('writes the setting for a model that is not switched on to the log, whichever provider', async () => {
    const { app, log } = await appRunning((a) =>
      a.get('/x', async () => {
        throw new AiDisabledError();
      }),
    );
    const res = await app.inject({ url: '/x' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('ai_disabled');
    expect(res.json().message).toBe('AI explanations are not switched on for this portal. Tell an administrator.');
    expect(res.body).not.toMatch(/ANTHROPIC_API_KEY|AI_BASE_URL|\.env/);
    expect(log()).toMatch(/ANTHROPIC_API_KEY|AI_BASE_URL/);
    await app.close();
  });

  it('gives an unexpected error a reference to quote, and finds the cause in the log under that reference', async () => {
    const { app, log } = await appRunning((a) =>
      a.get('/x', async () => {
        throw new TypeError('Cannot read properties of undefined (reading hosts)');
      }),
    );
    const res = await app.inject({ url: '/x' });
    const id = String(res.headers['x-request-id']);
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toBe(`The portal hit an unexpected error. Tell an administrator and quote reference ${id}.`);
    expect(res.body).not.toMatch(/reading hosts|BFF/);
    // The cause is in the log, on a line that carries the same reference.
    const line = log().split('\n').find((l) => l.includes('reading hosts'));
    expect(line, 'the cause is logged').toBeDefined();
    expect(line).toContain(id);
    await app.close();
  });
});
