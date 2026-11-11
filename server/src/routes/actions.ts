import type { FastifyInstance } from 'fastify';
import { zbxWrite } from '../clients/zabbix.js';
import { invalidate } from '../core/cache.js';
import { config, writeBackEnabled } from '../core/config.js';
import { notifyProblemsChanged } from '../services/stream.js';
import { acknowledgeBody } from '../core/schemas.js';
import { isZabbixId } from '../core/validate.js';
import {
  ACTION_CLOSE,
  ACTION_ACKNOWLEDGE,
  ACTION_MESSAGE,
  MAX_MESSAGE,
  MAX_EVENTIDS,
  trailOf,
  logAttempt,
  answered,
  AckBody,
  STALE_AFTER_WRITE,
  WRITE_HOLD_MS,
  writeFailure,
} from '../services/actions.js';

/** The first `max` characters, without the first half of a pair that the cut would split: Zabbix may refuse a lone half. */
function cutText(text: string, max: number): string {
  const cut = text.slice(0, max);
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
}

export async function actionRoutes(app: FastifyInstance): Promise<void> {
  // What is turned away outside the handler (no token, a viewer, a bad body, a limit) is on record too,
  // with whatever is known of it: the guard answers before the body is read, so those lines name no events.
  app.addHook('onResponse', async (req, reply) => {
    if (reply.statusCode < 400 || answered.has(req)) return;
    req.log.warn({ ...trailOf(req), status: reply.statusCode }, reply.statusCode >= 500 ? 'zabbix write-back failed' : 'zabbix write-back refused');
  });

  app.post('/api/problems/acknowledge', { schema: { body: acknowledgeBody }, preValidation: logAttempt }, async (req, reply) => {
    const trail = trailOf(req);
    const user = trail.user;
    // A refusal is logged too, so a probe or a slip leaves a line with the same fields.
    const refuse = (status: number, error: string, message: string, fix?: string) => {
      answered.add(req);
      req.log.warn({ ...trail, status, error, fix }, 'zabbix write-back refused');
      return reply.code(status).send({ error, message });
    };

    if (!writeBackEnabled()) {
      // The reader is told to ask an administrator; the setting to change goes to the log.
      return refuse(
        503,
        'zabbix_write_disabled',
        config.zbxWriteToken
          ? 'Acknowledge and Close are off while sign-in is off. Tell an administrator.'
          : 'Acknowledge and Close are not switched on for this portal. Tell an administrator.',
        config.zbxWriteToken
          ? 'For local dev only, set ALLOW_WRITE_WITHOUT_AUTH=true in server/.env.'
          : 'Set ZABBIX_WRITE_TOKEN in server/.env.',
      );
    }

    if (req.body != null && (typeof req.body !== 'object' || Array.isArray(req.body))) {
      return refuse(400, 'bad_request', 'The request body must be a JSON object.');
    }
    const body = (req.body ?? {}) as AckBody;
    const raw = Array.isArray(body.eventids) ? body.eventids : [body.eventids];
    const eventids = raw.filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (!eventids.length) {
      return refuse(400, 'bad_request', 'eventids is required: one or more Zabbix event ids.');
    }
    if (eventids.length > MAX_EVENTIDS) {
      return refuse(400, 'bad_request', `At most ${MAX_EVENTIDS} event ids per request.`);
    }
    // Ids go straight into a write against Zabbix; refuse anything that is not one.
    if (eventids.some((id) => !isZabbixId(id))) {
      return refuse(400, 'bad_request', 'eventids must be numeric Zabbix event ids.');
    }

    // Types are checked, not coerced: a non-string message would throw into a
    // 500, and the text "false" would count as true for `acknowledge`. null is
    // read as "not given".
    if (body.message != null && typeof body.message !== 'string') {
      return refuse(400, 'bad_request', 'message must be text.');
    }
    for (const flag of ['acknowledge', 'close'] as const) {
      if (body[flag] != null && typeof body[flag] !== 'boolean') {
        return refuse(400, 'bad_request', `${flag} must be true or false.`);
      }
    }

    const note = (body.message ?? '').trim();
    const acknowledge = body.acknowledge ?? true;
    const close = body.close === true;

    // What the caller asked for. The reply reports this, so the field means what it always did.
    let asked = 0;
    if (acknowledge) asked |= ACTION_ACKNOWLEDGE;
    if (close) asked |= ACTION_CLOSE;
    if (note) asked |= ACTION_MESSAGE;

    if (asked === 0) {
      return refuse(400, 'bad_request', 'Nothing to do. Supply acknowledge, close, or a message.');
    }

    // Zabbix files the write under the token's owner, so the portal user goes into the text. The tag
    // comes first: a "[portal:...]" typed after it is only text, and the cut to Zabbix's limit keeps it.
    const tag = `[portal:${user}]`;
    const message = cutText(note ? `${tag} ${note}` : tag, MAX_MESSAGE);
    const action = asked | ACTION_MESSAGE;
    const sent = { ...trail, eventids, action, close, acknowledge };

    let result: { eventids: string[] } | undefined;
    try {
      result = await zbxWrite<{ eventids: string[] }>('event.acknowledge', { eventids, action, message });
    } catch (err) {
      answered.add(req);
      req.log.warn({ ...sent, err: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }, 'zabbix write-back failed');
      const told = writeFailure(err, req.id);
      if (!told) throw err;
      // The error handler's own log line, which this answer skips: the address Zabbix was asked at is in it.
      req.log.error({ detail: (err as { detail?: string }).detail }, (err as Error).message);
      return reply.code(told.status).send({ error: told.error, message: told.message });
    }

    // Without this the change wouldn't surface until the 15 s cache expired, and
    // the click would look like it did nothing.
    for (const key of STALE_AFTER_WRITE) invalidate(key, { holdMs: WRITE_HOLD_MS });
    // Live screens get the new list now, not on the stream's next tick.
    void notifyProblemsChanged();

    req.log.info(sent, 'zabbix write-back');

    return { ok: true, eventids: result?.eventids ?? eventids, action: asked };
  });
}
