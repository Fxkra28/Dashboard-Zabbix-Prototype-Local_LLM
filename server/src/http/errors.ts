import type { FastifyInstance } from 'fastify';
import {
  ZabbixApiError,
  ZabbixAuthError,
  ZabbixTimeoutError,
  ZabbixWriteDisabledError,
} from '../clients/zabbix.js';
import { AiBusyError, AiDisabledError, AiUpstreamError } from '../clients/ai.js';
import { MailDisabledError, MailError } from '../clients/mail.js';
import { StateWriteError } from '../core/state.js';
import { BadRequestError, ScheduleUnavailableError } from '../core/validate.js';
import { validationProblem } from '../core/schemas.js';

/**
 * What a screen is told when Zabbix cannot be read. The method name, the setting to check and Zabbix's own words go to the log with the request id,
 * so the reference below finds the line; a viewer cannot act on them.
 */
export const SOURCE_DOWN = 'The data source is not answering.';
const sourceDown = (requestId: string) => `${SOURCE_DOWN} Tell an administrator and quote reference ${requestId}.`;

/**
 * Map the BFF's typed failures onto HTTP, in one response shape.
 *
 * Every error body is `{ error, message }`: `error` a stable code a client can branch on, `message`
 * a sentence for whoever is reading the screen.
 *
 * The distinction that matters: a rejected token, an unreachable Zabbix and a missing write token
 * are all *configuration* states, not server faults. Each gets a 503 with a message naming what to
 * fix, because "the portal is broken" and "ZABBIX_WRITE_TOKEN is unset" need very different
 * responses.
 *
 * Lives in its own module so the tests can exercise it against a bare Fastify instance: index.ts
 * starts a listening server on import.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof BadRequestError) {
      return reply.code(400).send({ error: 'bad_request', message: err.message });
    }
    // A body schema (schemas.ts) refused the request: the same 400 as the handlers' own checks.
    const invalid = validationProblem(err);
    if (invalid) return reply.code(400).send({ error: 'bad_request', message: invalid });
    // The message of each Zabbix failure names the method and the setting to check, and `detail`
    // names ZBX_URL and what Zabbix sent back: the log gets both, the response body neither.
    if (err instanceof ZabbixAuthError) {
      req.log.error(err.message);
      return reply.code(503).send({ error: 'zabbix_auth', message: sourceDown(req.id) });
    }
    if (err instanceof ZabbixTimeoutError) {
      req.log.error({ detail: err.detail }, err.message);
      return reply.code(503).send({ error: 'zabbix_timeout', message: sourceDown(req.id) });
    }
    if (err instanceof ZabbixWriteDisabledError) {
      req.log.warn({ detail: err.detail }, 'zabbix write-back is not switched on');
      return reply.code(503).send({ error: 'zabbix_write_disabled', message: err.message });
    }
    if (err instanceof ZabbixApiError) {
      req.log.error({ detail: err.detail }, err.message);
      return reply.code(502).send({ error: 'zabbix_error', message: sourceDown(req.id) });
    }
    // The AI layer is optional garnish: when it fails, say so plainly and
    // leave the rest of the portal alone.
    if (err instanceof AiDisabledError) {
      req.log.warn({ detail: err.detail }, 'AI is not switched on');
      return reply.code(503).send({ error: 'ai_disabled', message: err.message });
    }
    if (err instanceof AiBusyError) {
      // One local model, one answer at a time: expected under load, not a fault.
      return reply.code(503).header('retry-after', '10').send({ error: 'ai_busy', message: err.message });
    }
    if (err instanceof AiUpstreamError) {
      // `detail` names the model address and what it sent back: the log gets it, the response never does.
      app.log.error({ detail: err.detail }, err.message);
      return reply.code(502).send({ error: 'ai_error', message: err.message });
    }

    if (err instanceof MailDisabledError) {
      req.log.warn('a report email was asked for, but email is not set up');
      return reply.code(503).send({ error: 'mail_disabled', message: err.message });
    }
    if (err instanceof MailError) {
      // `detail` is what the mail server said: the log gets it, the response never does.
      req.log.error({ detail: err.detail, kind: err.kind }, 'the mail server did not take the report');
      return reply.code(502).send({ error: 'mail_error', message: err.message });
    }
    if (err instanceof ScheduleUnavailableError) {
      return reply.code(503).send({ error: 'schedule_unavailable', message: err.message });
    }
    if (err instanceof StateWriteError) {
      // `detail` is the system's code for the failure: the log gets it, the response never does.
      req.log.error({ detail: err.detail }, 'the portal could not save its state');
      return reply.code(500).send({ error: 'state_error', message: err.message });
    }

    // Fastify's own client errors (malformed JSON, wrong content type, body too
    // large) and the rate limiter's 429 carry a 4xx status and a message worth
    // showing. Anything else is a bug: log it in full, and do not hand its
    // internal wording to the browser.
    // Fastify 5 types `err` as unknown (anything can be thrown), so read each field defensively.
    const e = (err ?? {}) as { statusCode?: unknown; error?: unknown; code?: unknown; message?: unknown };
    const status = Number(e.statusCode);
    if (status >= 400 && status < 500) {
      return reply.code(status).send({
        error:
          typeof e.error === 'string' ? e.error : typeof e.code === 'string' ? e.code.toLowerCase() : 'bad_request',
        message: e.message,
      });
    }
    req.log.error(err);
    return reply
      .code(500)
      .send({ error: 'internal', message: `The portal hit an unexpected error. Tell an administrator and quote reference ${req.id}.` });
  });

  app.setNotFoundHandler((req, reply) =>
    reply
      .code(404)
      .send({ error: 'not_found', message: `No such endpoint: ${req.method} ${req.url.split('?')[0]}` }),
  );
}
