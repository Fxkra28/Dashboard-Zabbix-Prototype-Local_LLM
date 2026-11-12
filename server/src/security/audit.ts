import type { FastifyRequest } from 'fastify';
import type { OnUsage } from '../clients/ai.js';
import { chargeTo, type AiKind } from '../clients/limits.js';
import { config } from '../core/config.js';

/**
 * Who used what. Sign-in and write-back already name the person; these lines name who asked the AI and who
 * took a report. Each carries the person, the address and the outcome, and never a question, an answer or a file.
 */

/** Who is acting, for the log and the message tag. Brackets and control characters are dropped, so the tag cannot be closed early. */
export function actor(req: FastifyRequest): string {
  const sub = (req.user as { sub?: unknown } | undefined)?.sub;
  const name = typeof sub === 'string' ? sub.replace(/[\p{Cc}\p{Cf}[\]]/gu, '').trim().slice(0, 64) : '';
  return name || 'anonymous';
}

export type AiOutcome = 'answered' | 'not_found' | 'failed' | 'aborted';

/**
 * One use of the AI, charged to the daily budget as it finishes and logged once when it ends. `tokens` is
 * what the hosted API billed: 0 for an answer from the cache and for a local model.
 */
export function aiUse(req: FastifyRequest, kind: AiKind) {
  const charge = chargeTo(req);
  let tokens = 0;
  let logged = false;
  const onUsage: OnUsage = (used) => {
    tokens += used;
    charge(used);
  };
  const done = (outcome: AiOutcome): void => {
    if (logged) return;
    logged = true;
    req.log.info(
      { event: 'ai_call', user: actor(req), ip: req.ip, kind, outcome, tokens, provider: config.ai.provider, external: config.ai.external },
      `ai ${kind} ${outcome}`,
    );
  };
  return {
    onUsage,
    done,
    /** Runs `task`, logs how it ended and hands on its result, or its error. */
    async run<T>(task: (onUsage: OnUsage) => Promise<T>, outcomeOf: (result: T) => AiOutcome = () => 'answered'): Promise<T> {
      try {
        const result = await task(onUsage);
        done(outcomeOf(result));
        return result;
      } catch (err) {
        done('failed');
        throw err;
      }
    },
  };
}

/** One report taken: who, what and how large. */
export function auditDownload(req: FastifyRequest, report: { report: string; month: string; format: string; bytes: number }): void {
  req.log.info({ event: 'report_download', user: actor(req), ip: req.ip, ...report }, 'report download');
}

export interface EmailAudit {
  /** By hand, from the SLA page, or by the monthly schedule. */
  trigger: 'manual' | 'schedule';
  report: string;
  month: string;
  formats: string[];
  bytes: number;
  recipients: number;
  refused: number;
  /** The domains it went to, in the order they appear. Never an address. */
  domains: string[];
  outcome: 'sent' | 'failed';
  reason?: string;
  /** What the mail server or the code said, scrubbed of secrets, addresses and control characters. A failure only, and for the log alone. */
  detail?: string;
}

interface LineLog {
  info(line: object, message: string): void;
  warn(line: object, message: string): void;
}

/** One report mailed, by the schedule or by someone: what, to how many people and how it ended. Never the addresses, the subject or the file. */
export function logEmail(log: LineLog, user: string, report: EmailAudit, ip?: string): void {
  const line = { event: 'report_email', user, ...(ip === undefined ? {} : { ip }), ...report };
  if (report.outcome !== 'sent') log.warn(line, 'report email failed');
  // The message went, but not to everyone: a person who reads the log should see that, and a person who only reads a count should not have to.
  else if (report.refused > 0) log.warn(line, 'report email sent, but the mail server refused some of the addresses');
  else log.info(line, 'report email sent');
}

/** A month the monthly schedule passed by with no send tried, usually because the portal was not running: it is not a failed send (BK-55). */
export function logSkipped(log: LineLog, user: string, report: Omit<EmailAudit, 'outcome'>): void {
  log.warn({ event: 'report_skipped', user, ...report, outcome: 'missed' }, 'report email skipped: no send was tried before its week ended');
}

export function auditEmail(req: FastifyRequest, report: EmailAudit): void {
  logEmail(req.log, actor(req), report, req.ip);
}
