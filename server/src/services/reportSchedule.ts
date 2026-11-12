import { MailError, failureWords, scrub, type MailFailure } from '../clients/mail.js';
import { ZabbixAuthError, ZabbixTimeoutError, ZabbixApiError } from '../clients/zabbix.js';
import { addressDomain, plainAddress } from '../core/mailConfig.js';
import { checkRecipients, domainsOf } from '../core/recipients.js';
import { StateWriteError, type Schedule, type SendRecord, type StateStore } from '../core/state.js';
import { BadRequestError, EMPTY_REPORT_WORDS, EmptyReportError } from '../core/validate.js';
import { logEmail, logSkipped, type EmailAudit } from '../security/audit.js';
import { CATCH_UP_SECONDS, planNext, retryDelay, skippedSlots, type Plan, type SkippedSlot } from '../sli/schedule.js';
import type { EmailedReport, EmailRequest } from './sliMail.js';

/**
 * The monthly send. Once a minute it asks the planner (sli/schedule.ts) what is due and does it: send the month that has
 * closed, try again later if that fails, give up after a week. Every step is written to the state before the next, so a
 * restart picks up where it was and a month is not sent twice. At least once, not exactly once: a crash between the mail
 * server taking the message and the record being saved sends that month again, which is the better mistake.
 */

const TICK_MS = 60_000;
/** Soon after start-up, so a portal that was down at the slot does not wait a minute to catch up. */
const FIRST_TICK_MS = 5_000;
/** The failed try after which the people who asked are told once that it has not gone yet. */
const WARN_AFTER_ATTEMPTS = 3;
/** How long a stop waits for a send that is running. Docker gives a stopping container ten seconds. */
const STOP_WAIT_MS = 5_000;

interface LineLog {
  info(line: object, message: string): void;
  warn(line: object, message: string): void;
  error(line: object, message: string): void;
}

export interface ScheduleDeps {
  /** Unix seconds. */
  now(): number;
  state(): StateStore;
  /** `off` says why email is refused although it is set up, for the page; empty when it is not refused. */
  settings(): { enabled: boolean; schedule: boolean; allowedDomains: string[]; to: string[]; off?: string };
  send(request: EmailRequest): Promise<EmailedReport>;
  notice(to: string[], subject: string, text: string): Promise<void>;
  timezone: string;
  log: LineLog;
  /** How long `stop` waits for a check that is running, in milliseconds. Default 5000. */
  stopWaitMs?: number;
}

export interface ReportSchedule {
  tick(): Promise<void>;
  start(): void;
  /** Stops the timers, so that no new check starts. The server calls it when a close begins, while it still drains its requests. */
  pause(): void;
  /** Pauses, then waits for a check that is running, so a send that is under way is recorded. The wait counts from the pause. */
  stop(): Promise<void>;
  /** Whether the schedule can run on this machine, and if not, why in a sentence. */
  availability(): { available: boolean; why: string };
  /** A sentence when the data folder stopped taking writes after the portal started, so nothing can be sent or kept; empty otherwise. */
  problem(): string;
  /** The next send, for the page. Null when none is due. */
  next(): { month: string; at: number; retrying: boolean } | null;
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1 Nov 2026 00:10 (Asia/Jakarta)". */
function momentText(seconds: number, tz: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(seconds * 1000))
      .map((p) => [p.type, p.value]),
  );
  return `${Number(parts.day)} ${SHORT[Number(parts.month) - 1]} ${parts.year} ${parts.hour}:${parts.minute} (${tz})`;
}

/** "October 2026". */
function monthWords(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "August 2026, September 2026 and October 2026". */
function monthList(months: readonly string[]): string {
  const words = months.map(monthWords);
  return words.length < 3 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

const ZABBIX_WORDS = 'The portal could not read the figures from Zabbix. Check that this machine can reach it.';
const OTHER_WORDS = 'The report could not be made. The reason is in the portal log.';

/** The kind of failure as one word, which is all that is kept and logged: what a server said stays out of both. */
function reasonOf(err: unknown): string {
  if (err instanceof MailError) return err.kind;
  if (err instanceof ZabbixApiError || err instanceof ZabbixTimeoutError || err instanceof ZabbixAuthError) return 'zabbix';
  if (err instanceof EmptyReportError) return 'empty';
  if (err instanceof BadRequestError) return 'recipients';
  return 'error';
}

/** What a failure said, for the log alone. A mail server's reply is scrubbed already; HCML's Zabbix is named by its class only. */
function detailOf(err: unknown): string {
  if (err instanceof MailError) return err.detail;
  if (err instanceof ZabbixApiError || err instanceof ZabbixTimeoutError || err instanceof ZabbixAuthError) return err.constructor.name;
  return scrub(err instanceof Error ? `${err.name}: ${err.message}` : String(err), []);
}

function reasonWords(reason: string | undefined): string {
  if (reason === 'zabbix') return ZABBIX_WORDS;
  if (reason === 'empty') return EMPTY_REPORT_WORDS;
  if (reason !== undefined && ['login', 'connect', 'timeout', 'tls', 'recipients', 'rejected', 'other'].includes(reason)) return failureWords(reason as MailFailure);
  return OTHER_WORDS;
}

// After a timeout the mail server may have taken the message, so only a certain failure may say that nobody has it (BK-52).
const NOBODY_HAS_IT = 'Nobody has received it.';
const MAY_HAVE_IT = 'It may have reached some or all of the people.';

/**
 * Whether a month's message may have been handed over although the record says it failed: a try that ended in a timeout, now or earlier
 * (`unsure`), or a try that never ended, as when the portal stopped in the middle of a send (a try was made, and no reason was written).
 */
const mayHaveGone = (r: SendRecord): boolean => r.unsure === true || r.reason === 'timeout' || (r.attempts > 0 && r.reason === undefined);
const BY_HAND = 'You can send the report by hand: open the SLA page, choose the month and press Email report.';
const BY_HAND_EACH = 'You can send each report by hand: open the SLA page, choose the month and press Email report.';
const FOOT = 'This message is automatic. Replies are not read.';

function warningNotice(record: SendRecord, slot: number, tz: string): { subject: string; text: string } {
  return {
    subject: `HCML SLA report for ${monthWords(record.month)} has not been sent yet`,
    text: [
      `The portal has not managed to send the SLA report for ${monthWords(record.month)} on time.`,
      `It has tried ${record.attempts} times; the last try was at ${momentText(record.at, tz)}.`,
      `Why: ${reasonWords(record.reason)}`,
      `The portal will keep trying until ${momentText(slot + CATCH_UP_SECONDS, tz)}.`,
      BY_HAND,
      FOOT,
      '',
    ].join('\n'),
  };
}

function failedNotice(record: SendRecord, tz: string): { subject: string; text: string } {
  return {
    subject: `HCML SLA report for ${monthWords(record.month)} was not sent`,
    text: [
      `The portal stopped trying to send the SLA report for ${monthWords(record.month)}.`,
      `It tried ${record.attempts} times; the last try was at ${momentText(record.at, tz)}.`,
      `Why: ${reasonWords(record.reason)}`,
      `${mayHaveGone(record) ? MAY_HAVE_IT : NOBODY_HAS_IT} ${BY_HAND}`,
      FOOT,
      '',
    ].join('\n'),
  };
}

function missedNotice(month: string, slot: number, tz: string): { subject: string; text: string } {
  return {
    subject: `HCML SLA report for ${monthWords(month)} was missed`,
    text: [
      `The portal did not send the SLA report for ${monthWords(month)}.`,
      `It was due at ${momentText(slot, tz)}, and the portal was not running, or could not start the send, in the week after that.`,
      `Nobody has received it. ${BY_HAND}`,
      FOOT,
      '',
    ].join('\n'),
  };
}

function skippedNotice(slots: readonly SkippedSlot[], ended: readonly SendRecord[], tz: string): { subject: string; text: string } {
  const unsure = ended.filter(mayHaveGone).map((r) => r.month);
  const others = unsure.length < slots.length ? '; the others were not sent' : '';
  return {
    subject: `HCML SLA reports for ${monthList(slots.map((s) => s.month))} were not sent`,
    text: [
      `The portal did not send the SLA reports for ${slots.length} months. Each is listed with the time it was due.`,
      ...slots.map((s) => `${monthWords(s.month)}: due ${momentText(s.slot, tz)}`),
      'The portal was not running, or could not finish the send, in the week after each of these times.',
      unsure.length === 0
        ? `Nobody has received them. ${BY_HAND_EACH}`
        : `${unsure.length === 1 ? 'The report for' : 'The reports for'} ${monthList(unsure)} may have reached some or all of the people${others}. ${BY_HAND_EACH}`,
      FOOT,
      '',
    ].join('\n'),
  };
}

function refusedNotice(record: SendRecord, sent: EmailedReport, tz: string): { subject: string; text: string } {
  return {
    subject: `HCML SLA report for ${monthWords(record.month)} did not reach everyone`,
    text: [
      `The portal sent the SLA report for ${monthWords(record.month)} at ${momentText(record.at, tz)}.`,
      `The mail server took it for ${sent.accepted} of ${sent.accepted + sent.refused} addresses and refused ${sent.refused}.`,
      'The usual cause is an address with a typo, or one that does not exist. The saved list is in the Schedule dialog on the SLA page.',
      `The people whose addresses were refused have not received it. ${BY_HAND}`,
      FOOT,
      '',
    ].join('\n'),
  };
}

export function createReportSchedule(deps: ScheduleDeps): ReportSchedule {
  let running = false;
  // The folder's failure is said once for as long as it lasts, not at every minute.
  let reported = false;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let first: ReturnType<typeof setTimeout> | undefined;
  /** The check that is running, so that a stop can wait for it. */
  let current: Promise<void> | undefined;
  /** Months the mail server has taken and the state could not yet record. They are recorded at the next look and never sent again. */
  const taken = new Map<string, EmailedReport>();
  /** When the close began, so that a stop counts its wait from there and not from its own start. */
  let pausedAt: number | undefined;

  function availability(): { available: boolean; why: string } {
    const settings = deps.settings();
    if (!settings.enabled) return { available: false, why: settings.off || 'Email is not set up. An administrator sets the MAIL_ settings in .env and restarts the portal.' };
    if (!settings.schedule) return { available: false, why: 'The monthly schedule is switched off on this machine (MAIL_SCHEDULE=off).' };
    if (!deps.state().durable) return { available: false, why: 'The portal has no data folder to keep a schedule in. An administrator sets PORTAL_STATE_DIR to a folder that outlives the container.' };
    return { available: true, why: '' };
  }

  const problem = (): string =>
    deps.state().failing() ? 'The portal could not write its data folder at its last try, so it cannot keep the schedule or send by it. Check that PORTAL_STATE_DIR can be written.' : '';

  const plan = (): Plan => {
    const s = deps.state().read();
    return planNext(deps.now(), s.mail.schedule, s.mail.sends, deps.timezone);
  };

  function next(): { month: string; at: number; retrying: boolean } | null {
    const p = plan();
    if (p.kind === 'wait') return { month: p.month, at: p.at, retrying: false };
    if (p.kind === 'backoff') return { month: p.month, at: p.at, retrying: true };
    if (p.kind === 'send') return { month: p.month, at: deps.now(), retrying: p.attempt > 1 };
    return null;
  }

  const audit = (record: Pick<SendRecord, 'month' | 'formats'>, to: string[], over: Partial<EmailAudit>): EmailAudit => ({
    trigger: 'schedule',
    report: 'sla',
    month: record.month,
    formats: record.formats,
    bytes: 0,
    recipients: 0,
    refused: 0,
    domains: domainsOf(to.filter(plainAddress)),
    outcome: 'failed',
    ...over,
  });

  /** Writes one record of the schedule's own: the new one, or the changes to the one for the month. */
  async function put(month: string, make: (old: SendRecord | undefined) => SendRecord): Promise<SendRecord> {
    let saved!: SendRecord;
    await deps.state().change((draft) => {
      const at = draft.mail.sends.findIndex((r) => r.trigger === 'schedule' && r.month === month);
      saved = make(at >= 0 ? draft.mail.sends[at] : undefined);
      if (at >= 0) draft.mail.sends[at] = saved;
      else draft.mail.sends.push(saved);
    });
    return saved;
  }

  async function tell(schedule: Schedule | null, message: { subject: string; text: string }): Promise<void> {
    if (!schedule) return;
    // The list was checked when it was saved; the domains a report may go to can have changed since.
    const allowed = deps.settings().allowedDomains;
    const to = allowed.length > 0 ? schedule.notify.filter((a) => allowed.includes(addressDomain(a))) : schedule.notify;
    if (to.length === 0) return;
    try {
      await deps.notice(to, message.subject, message.text);
    } catch (err) {
      deps.log.warn({ event: 'report_notice_failed', reason: err instanceof MailError ? err.kind : 'error' }, 'could not send a notice about the monthly report');
    }
  }

  /** What is known of a send whose record is gone from the state, for example after a file was put back from an older copy. */
  const unrecorded = (month: string, sent: EmailedReport): SendRecord => ({
    month,
    trigger: 'schedule',
    by: 'schedule',
    at: deps.now(),
    outcome: 'sent',
    attempts: 1,
    formats: sent.files.map((f) => f.format),
    recipients: sent.accepted,
    refused: sent.refused,
    bytes: sent.bytes,
  });

  /** Records a month as sent, and tells the people to tell when the mail server refused some of the addresses. */
  async function conclude(month: string, sent: EmailedReport): Promise<void> {
    const done = await put(month, (old) => {
      const { nextAt: _nextAt, reason: _reason, unsure: _unsure, ...rest } = old ?? unrecorded(month, sent);
      return { ...rest, at: deps.now(), outcome: 'sent', recipients: sent.accepted, refused: sent.refused, bytes: sent.bytes };
    });
    taken.delete(month);
    // A month that is recorded as sent is never looked at again, so the notice goes once; if the portal stops here, it does not go.
    if (sent.refused > 0) await tell(deps.state().read().mail.schedule, refusedNotice(done, sent, deps.timezone));
  }

  /**
   * Records the months the mail server took and the state could not yet record. It runs before the planner reads the records: the planner would
   * otherwise send such a month again, or give it up as unsent at the end of the week, or never see it because the schedule had moved or been switched off.
   */
  async function settle(): Promise<void> {
    for (const [month, sent] of [...taken]) await conclude(month, sent);
  }

  async function attempt(p: Extract<Plan, { kind: 'send' }>, schedule: Schedule): Promise<void> {
    const t = deps.now();
    const settings = deps.settings();
    const saved = deps.state().read().mail.recipients;
    const to = saved.length > 0 ? saved : settings.to;
    const base = { month: p.month, trigger: 'schedule' as const, by: 'schedule', formats: schedule.formats };

    // Written before the send, so a crash in the middle leaves a trace and the next look tries again.
    await put(p.month, (old) => ({ ...(old ?? { recipients: 0, refused: 0, bytes: 0, ...base }), ...base, at: t, outcome: 'sending', attempts: p.attempt }));

    let sent: EmailedReport;
    try {
      checkRecipients(to, { allowedDomains: settings.allowedDomains, min: 1 });
      sent = await deps.send({ month: p.month, formats: schedule.formats, to, style: schedule.style, sentBy: 'the monthly schedule', now: new Date(t * 1000) });
    } catch (err) {
      const reason = reasonOf(err);
      const nextAt = deps.now() + retryDelay(p.attempt);
      const final = nextAt > p.slot + CATCH_UP_SECONDS;
      const failed = await put(p.month, (old) => {
        // The schedule moved while this send was out: the move gave the month up, and a retry would be for a slot nobody watches.
        if (old!.outcome === 'failed' && old!.reason === 'changed') return old!;
        const { nextAt: _nextAt, ...rest } = old!;
        // A timeout may have come after the server took the message: the doubt stays through every later try, whatever it said.
        const doubt = reason === 'timeout' ? { unsure: true as const } : {};
        return { ...rest, at: deps.now(), outcome: final ? 'failed' : 'sending', reason, ...doubt, ...(final ? {} : { nextAt }) };
      });
      logEmail(deps.log, 'schedule', audit(failed, to, { reason, detail: detailOf(err) }));
      if (failed.reason === 'changed') return;

      // The count is written before the notice goes, so a crash in between loses a notice and never sends one twice.
      if (final) {
        await put(p.month, (old) => ({ ...old!, noticed: 2 }));
        await tell(schedule, failedNotice(failed, deps.timezone));
      } else if (p.attempt >= WARN_AFTER_ATTEMPTS && (failed.noticed ?? 0) < 1) {
        await put(p.month, (old) => ({ ...old!, noticed: 1 }));
        await tell(schedule, warningNotice(failed, p.slot, deps.timezone));
      }
      return;
    }
    // From here the mail server has the message. Whatever fails next, this month is not sent again.
    taken.set(p.month, sent);
    // The log line goes first, so that it exists even when the save does not.
    logEmail(deps.log, 'schedule', audit({ month: p.month, formats: schedule.formats }, to, { bytes: sent.bytes, recipients: sent.accepted, refused: sent.refused, outcome: 'sent' }));
    await conclude(p.month, sent);
  }

  /** Ends months that will not be sent: failed when a try was made, missed when none was. The record holds the notice count before the notice goes, as in `attempt`. */
  async function giveUp(schedule: Schedule, slots: readonly SkippedSlot[]): Promise<void> {
    const t = deps.now();
    const ended: SendRecord[] = [];
    for (const s of slots) {
      const base = { month: s.month, trigger: 'schedule' as const, by: 'schedule', formats: schedule.formats };
      const record = await put(s.month, (old) =>
        old
          ? { ...old, outcome: 'failed', nextAt: undefined, noticed: 2 }
          : { ...base, at: t, outcome: 'missed', attempts: 0, recipients: 0, refused: 0, bytes: 0, reason: 'not running', noticed: 2 },
      );
      const line = audit(record, [], { reason: record.reason ?? 'expired' });
      // A month that was never tried is a skipped month, not a send that failed (BK-55).
      if (record.outcome === 'missed') logSkipped(deps.log, 'schedule', line);
      else logEmail(deps.log, 'schedule', line);
      ended.push(record);
    }
    const [only] = slots;
    if (only && slots.length === 1) await tell(schedule, only.attempted ? failedNotice(ended[0]!, deps.timezone) : missedNotice(only.month, only.slot, deps.timezone));
    else await tell(schedule, skippedNotice(slots, ended, deps.timezone));
  }

  async function look(): Promise<void> {
    try {
      // A write of nothing, to find out whether a folder that stopped taking writes takes them again.
      if (deps.state().failing()) await deps.state().change(() => undefined);
      if (!deps.state().failing()) reported = false;
      await settle();
      if (!availability().available) return;
      let schedule = deps.state().read().mail.schedule;
      if (!schedule) return;
      let p = plan();
      // Months before the newest were never judged: they are recorded and never sent late.
      const older = skippedSlots(deps.now(), schedule, deps.state().read().mail.sends, deps.timezone);
      const ending = p.kind === 'expired' ? [...older, { month: p.month, slot: p.slot, attempted: p.attempted }] : older;
      if (ending.length > 0) {
        await giveUp(schedule, ending);
        // The notice can take seconds: what is due is judged again from the schedule as it is now.
        schedule = deps.state().read().mail.schedule;
        if (!schedule) return;
        p = plan();
      }
      if (p.kind === 'send') await attempt(p, schedule);
    } catch (err) {
      if (err instanceof StateWriteError) {
        if (!reported) deps.log.error({ event: 'report_state_unwritable', reason: err.detail }, 'the portal could not write its data folder, so the monthly report can be neither sent nor recorded');
        reported = true;
      } else {
        deps.log.warn({ event: 'report_schedule_error', reason: err instanceof Error ? err.name : 'error' }, 'the monthly report schedule could not run');
      }
    } finally {
      running = false;
    }
  }

  function pause(): void {
    if (ticker) clearInterval(ticker);
    if (first) clearTimeout(first);
    ticker = undefined;
    first = undefined;
    pausedAt ??= Date.now();
  }

  async function tick(): Promise<void> {
    if (running || pausedAt !== undefined) return;
    running = true;
    current = look();
    await current;
  }

  return {
    tick,
    availability,
    problem,
    next,
    start() {
      if (ticker) return;
      ticker = setInterval(() => void tick(), TICK_MS);
      ticker.unref();
      first = setTimeout(() => void tick(), FIRST_TICK_MS);
      first.unref();
    },
    pause,
    async stop() {
      pause();
      if (!running || !current) return;
      const wait = (deps.stopWaitMs ?? STOP_WAIT_MS) - (Date.now() - (pausedAt ?? Date.now()));
      if (wait <= 0) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const patience = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, wait);
        timer.unref();
      });
      await Promise.race([current, patience]);
      clearTimeout(timer);
    },
  };
}
