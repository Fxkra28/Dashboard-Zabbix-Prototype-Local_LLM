import type { FastifyInstance } from 'fastify';
import { config, signInRefusal } from '../core/config.js';
import { MAX_RECIPIENTS } from '../core/mailConfig.js';
import { checkRecipients, domainsOf } from '../core/recipients.js';
import { scheduleBody } from '../core/schemas.js';
import type { PortalState, Schedule, SendRecord } from '../core/state.js';
import { BadRequestError, ScheduleUnavailableError } from '../core/validate.js';
import { actor } from '../security/audit.js';
import { savedRecipients } from '../services/mailState.js';
import { portalState } from '../services/portalState.js';
import type { ReportSchedule } from '../services/reportSchedule.js';
import { parseFormats, parseStyle } from '../services/sliExport.js';

const ASKED = ['enabled', 'day', 'time', 'formats', 'style', 'recipients', 'notify'];
const STYLE_KEYS = ['decimal', 'date', 'separator'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_NOTIFY = 3;
const SENDS_SHOWN = 12;

/** A record as the page sees it: what happened, with counts, and none of the scheduler's own bookkeeping. */
const shown = ({ nextAt: _nextAt, noticed: _noticed, unsure: _unsure, ...record }: SendRecord): Omit<SendRecord, 'nextAt' | 'noticed' | 'unsure'> => record;

/** The schedule as the page sees it. */
const scheduleView = ({ enabledAt: _enabledAt, ...schedule }: Schedule): Omit<Schedule, 'enabledAt'> => schedule;

interface ScheduleRouteOptions {
  schedule: Pick<ReportSchedule, 'availability' | 'next' | 'problem'>;
}

export async function sliScheduleRoutes(app: FastifyInstance, options: ScheduleRouteOptions): Promise<void> {
  const view = (state: PortalState) => {
    const refusal = signInRefusal();
    // With sign-in off every caller counts as an administrator: the page is told why, and shown nothing the portal keeps, whether or not mail is set up (SC-43, SC-49).
    if (refusal) {
      return {
        available: false,
        why: refusal,
        timezone: config.sla.timezone,
        schedule: null,
        recipients: [] as string[],
        next: null,
        sends: [],
        max: MAX_RECIPIENTS,
        maxNotify: MAX_NOTIFY,
        allowedDomains: [] as string[],
      };
    }
    const ready = options.schedule.availability();
    // A folder that stopped taking writes is said like any other reason the schedule cannot run, after the ones that come first.
    const trouble = ready.available ? options.schedule.problem() : '';
    const available = ready.available && trouble === '';
    const why = ready.why || trouble;
    return {
      available,
      why,
      timezone: config.sla.timezone,
      schedule: state.mail.schedule ? scheduleView(state.mail.schedule) : null,
      recipients: savedRecipients(),
      next: available ? options.schedule.next() : null,
      sends: state.mail.sends.slice(-SENDS_SHOWN).reverse().map(shown),
      max: MAX_RECIPIENTS,
      maxNotify: MAX_NOTIFY,
      allowedDomains: config.mail.allowedDomains,
    };
  };

  // Administrators only (auth.ts).
  app.get('/api/sli/schedule', async () => view(portalState().read()));

  app.put('/api/sli/schedule', { schema: { body: scheduleBody } }, async (req) => {
    const body = req.body as Record<string, unknown>;
    if (Object.keys(body).some((key) => !ASKED.includes(key))) {
      throw new BadRequestError('Only enabled, day, time, formats, style, recipients and notify are accepted.');
    }
    const style = body.style as Record<string, unknown> | undefined;
    if (style && Object.keys(style).some((key) => !STYLE_KEYS.includes(key))) {
      throw new BadRequestError('Only decimal, date and separator are accepted in style.');
    }
    const { available, why } = options.schedule.availability();
    if (!available) throw new ScheduleUnavailableError(why);

    const day = body.day as number;
    if (day < 1 || day > 28) throw new BadRequestError('day must be a whole number from 1 to 28.');
    const time = body.time as string;
    if (!TIME.test(time)) throw new BadRequestError('time must be HH:MM, 24 hours, such as 00:00.');
    const enabled = body.enabled as boolean;
    const formats = parseFormats(body.formats);
    const chosenStyle = parseStyle(style ?? {});
    const allowedDomains = config.mail.allowedDomains;
    const recipients = checkRecipients(body.recipients, { allowedDomains, min: enabled ? 1 : 0 });
    const notify = checkRecipients(body.notify, { allowedDomains, max: MAX_NOTIFY, what: 'Failure notices' });

    const user = actor(req);
    const now = Math.floor(Date.now() / 1000);
    await portalState().change((draft) => {
      const old = draft.mail.schedule;
      // A slot that came before this moment is never sent, so a schedule turned on today does not send last month's report late.
      const restarted = enabled && (!old || !old.enabled || old.day !== day || old.time !== time);
      // A month still being tried is given up on when the schedule moves: the new slot would never send it, and its record would say "trying" for ever.
      if (!old || old.enabled !== enabled || old.day !== day || old.time !== time) {
        for (const r of draft.mail.sends) {
          if (r.trigger !== 'schedule' || r.outcome !== 'sending') continue;
          r.outcome = 'failed';
          r.reason = 'changed';
          delete r.nextAt;
        }
      }
      // Turned off with an empty list leaves the saved people as they were: nobody who saves it off means to forget them.
      if (enabled || recipients.length > 0) draft.mail.recipients = recipients;
      draft.mail.schedule = { enabled, day, time, formats, style: chosenStyle, notify, enabledAt: restarted || !old ? now : old.enabledAt, setBy: user, setAt: now };
    });
    req.log.info(
      { event: 'report_schedule_changed', user, ip: req.ip, enabled, day, time, formats, recipients: recipients.length, domains: domainsOf(recipients), notify: notify.length },
      'report schedule changed',
    );
    return view(portalState().read());
  });
}
