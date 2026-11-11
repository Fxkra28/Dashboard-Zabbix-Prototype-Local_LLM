import type { FastifyInstance, FastifyRequest } from 'fastify';
import { MailDisabledError, MailError } from '../clients/mail.js';
import { config, emailRefusal, mailNow } from '../core/config.js';
import { MAX_RECIPIENTS } from '../core/mailConfig.js';
import { checkRecipients, domainsOf } from '../core/recipients.js';
import { emailReportBody, recipientsBody } from '../core/schemas.js';
import { BadRequestError } from '../core/validate.js';
import { actor, auditEmail } from '../security/audit.js';
import { tooManySends } from '../security/mailLimit.js';
import { addSend, clearRecipients, ListInUseError, saveRecipients, savedRecipients } from '../services/mailState.js';
import { portalState } from '../services/portalState.js';
import { emailReport } from '../services/sliMail.js';
import { parseFormats, parseStyle } from '../services/sliExport.js';
import { SETTLE_SECONDS } from '../sli/schedule.js';
import { checkPeriodStart, monthBounds, parseMonth } from '../sli/time.js';

const ASKED = ['month', 'formats', 'to', 'remember', 'style'];
const STYLE_KEYS = ['decimal', 'date', 'separator'];

/** Keeps a record of the send. The report has gone already, so a failure here is logged and not passed on. */
async function note(req: FastifyRequest, record: Parameters<typeof addSend>[0]): Promise<void> {
  try {
    await addSend(record);
  } catch (err) {
    req.log.warn({ event: 'send_not_recorded', reason: err instanceof Error ? err.name : 'error' }, 'could not keep a record of a report email');
  }
}

export async function sliMailRoutes(app: FastifyInstance): Promise<void> {
  // Lets the screen offer the button only where it works, and say who a report would reach. Administrators only (auth.ts).
  app.get('/api/sli/email', async () =>
    mailNow().enabled
      ? {
          enabled: true,
          from: config.mail.from,
          recipients: savedRecipients(),
          max: MAX_RECIPIENTS,
          allowedDomains: config.mail.allowedDomains,
          kept: portalState().durable,
        }
      : { enabled: false, from: '', recipients: [] as string[], max: MAX_RECIPIENTS, allowedDomains: [] as string[], kept: false },
  );

  // Administrators only (auth.ts). Replaces the portal's own list, with the checks every list has.
  app.put('/api/sli/recipients', { schema: { body: recipientsBody } }, async (req) => {
    if (emailRefusal()) throw new MailDisabledError(emailRefusal());
    const body = req.body as Record<string, unknown>;
    if (Object.keys(body).some((key) => key !== 'recipients')) throw new BadRequestError('Only recipients is accepted.');
    const list = checkRecipients(body.recipients, { allowedDomains: config.mail.allowedDomains, min: 1 });
    await saveRecipients(list);
    req.log.info({ event: 'report_recipients_saved', user: actor(req), ip: req.ip, saved: list.length }, 'the saved list of recipients was replaced');
    return { recipients: savedRecipients(), saved: list.length };
  });

  // Administrators only (auth.ts). Empties the portal's own list; the one MAIL_TO started with applies again.
  app.delete('/api/sli/recipients', async (req, reply) => {
    if (emailRefusal()) throw new MailDisabledError(emailRefusal());
    // With the schedule on and nobody else to fall back on, the next monthly send would have no one to go to.
    let removed: number;
    try {
      removed = await clearRecipients((state) => state.mail.schedule?.enabled === true && config.mail.to.length === 0);
    } catch (err) {
      if (!(err instanceof ListInUseError)) throw err;
      return reply.code(409).send({
        error: 'schedule_uses_list',
        message: 'The monthly schedule sends to this list, and nothing else says who gets the report. Turn the schedule off, or save another list, first.',
      });
    }
    // By count: no address goes into a log (FR-28).
    req.log.info({ event: 'report_recipients_deleted', user: actor(req), ip: req.ip, removed }, 'the saved list of recipients was deleted');
    return { recipients: savedRecipients(), removed };
  });

  app.post('/api/sli/email', { schema: { body: emailReportBody } }, async (req, reply) => {
    const body = req.body as { month: string; formats: unknown; to?: unknown; remember?: boolean; style?: Record<string, unknown> };
    if (Object.keys(body).some((key) => !ASKED.includes(key))) {
      throw new BadRequestError('Only month, formats, to, remember and style are accepted.');
    }
    if (body.style && Object.keys(body.style).some((key) => !STYLE_KEYS.includes(key))) {
      throw new BadRequestError('Only decimal, date and separator are accepted in style.');
    }
    if (!mailNow().enabled) throw new MailDisabledError(emailRefusal() || undefined);
    // Before the reports are read and before the allowance is counted, so a bad request costs nothing.
    const month = parseMonth(body.month);
    const bounds = monthBounds(month, config.sla.timezone);
    const now = Math.floor(Date.now() / 1000);
    checkPeriodStart(bounds.from, now);
    // The monthly send waits as long for Zabbix's last values of a month, and a report sent before then would say the month had closed.
    if (now >= bounds.to && now < bounds.to + SETTLE_SECONDS) {
      const minutes = Math.ceil((bounds.to + SETTLE_SECONDS - now) / 60);
      throw new BadRequestError(`That month ended a moment ago, and Zabbix is still adding its last values. Send it in about ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    }
    const formats = parseFormats(body.formats);
    const style = parseStyle(body.style ?? {});
    const rules = { allowedDomains: config.mail.allowedDomains, min: 1 };
    const to = body.to === undefined ? checkRecipients(savedRecipients(), rules) : checkRecipients(body.to, rules);
    if (tooManySends(req, reply)) return reply;

    const user = actor(req);
    const domains = domainsOf(to);
    const base = { trigger: 'manual' as const, report: 'sla', month, formats, domains };
    const record = { month, trigger: 'manual' as const, by: user, at: Math.floor(Date.now() / 1000), attempts: 1, formats };

    let sent;
    try {
      sent = await emailReport({ month, formats, to, style, sentBy: user });
    } catch (err) {
      const reason = err instanceof MailError ? err.kind : 'error';
      auditEmail(req, { ...base, bytes: 0, recipients: 0, refused: 0, outcome: 'failed', reason });
      await note(req, { ...record, outcome: 'failed', recipients: 0, refused: 0, bytes: 0, reason });
      throw err;
    }
    auditEmail(req, { ...base, bytes: sent.bytes, recipients: sent.accepted, refused: sent.refused, outcome: 'sent' });
    await note(req, { ...record, outcome: 'sent', recipients: sent.accepted, refused: sent.refused, bytes: sent.bytes });

    let remembered = false;
    if (body.remember === true) {
      try {
        await saveRecipients(to);
        remembered = true;
      } catch (err) {
        req.log.warn({ event: 'recipients_not_saved', reason: err instanceof Error ? err.name : 'error' }, 'could not save the list of recipients');
      }
    }
    return { sent: sent.accepted, refused: sent.refused, month, files: sent.files, remembered };
  });
}
