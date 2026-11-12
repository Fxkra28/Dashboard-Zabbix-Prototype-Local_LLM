import type { ConnectionOptions } from 'node:tls';
import { createTransport, type NodemailerError } from 'nodemailer';
import { plainAddress, type MailSettings } from '../core/mailConfig.js';

/**
 * The portal's one way out for email: the report as attachments to the people the caller names. Nothing is read from disk or a
 * URL, and a login never travels unencrypted (STARTTLS comes first and its absence is a failure; `none` is refused with a password).
 */

export type MailFailure = 'login' | 'connect' | 'timeout' | 'tls' | 'recipients' | 'rejected' | 'other';

/** What a person is told. The server's own words go to the log, with the secrets taken out. */
const WORDS: Record<MailFailure, string> = {
  login:
    'The mail server refused the login. Check MAIL_USER and MAIL_PASS. Gmail, Yahoo and iCloud need an app password, not the usual one.',
  connect: 'The portal could not reach the mail server. Check MAIL_HOST and MAIL_PORT, and that this machine may connect to it.',
  timeout:
    'The mail server did not answer in time, so the report may or may not have gone. Look under Last sends in the Schedule dialog, or ask the people it was sent to, before you send it again.',
  tls: 'The secure connection to the mail server failed. Check MAIL_PORT and MAIL_SECURITY, and that the server has a valid certificate.',
  recipients: 'The mail server refused the sender or every recipient. Check MAIL_FROM and the addresses the report goes to.',
  rejected: 'The mail server did not accept the message.',
  other: 'The message could not be sent. The reason is in the portal log.',
};

/** The fixed sentence for a kind of failure, for a message the portal writes to a person. */
export const failureWords = (kind: MailFailure): string => WORDS[kind];

export class MailError extends Error {
  constructor(
    readonly kind: MailFailure,
    /** The server's code and first line, for the log and not for the screen. */
    readonly detail: string,
  ) {
    super(WORDS[kind]);
    this.name = 'MailError';
  }
}

export class MailDisabledError extends Error {
  constructor(message = 'Email is not set up on this portal. An administrator sets the MAIL_ settings in .env and restarts it.') {
    super(message);
    this.name = 'MailDisabledError';
  }
}

export interface Attachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface OutgoingMail {
  /** Who it goes to. Each address is checked here again, so nothing a caller forgot to check can forge a header. */
  to: string[];
  subject: string;
  text: string;
  /** None for a note. */
  attachments: Attachment[];
}

export interface Mailer {
  /** Connects and logs in, then leaves: a wrong setting fails here, in a second, and not after a report is built. */
  verify(): Promise<void>;
  /** How many recipients the server took the message for, and how many it refused. */
  send(message: OutgoingMail): Promise<{ accepted: number; refused: number }>;
}

export interface MailerOptions {
  /** Added to the TLS settings; the tests use it to trust their own certificate. */
  tls?: ConnectionOptions;
  /** `verify` limits the silence the check before a send waits through; it defaults to 15 seconds or `socket`, whichever is less. */
  timeoutsMs?: { connect: number; greeting: number; socket: number; verify?: number };
}

const LOG_MAX = 300;

/** `text` with each secret, every address and every control character taken out, and cut short. */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join('***');
  out = out.replace(/[^\s<>()",;:]+@[^\s<>()",;:]+/g, '[address]');
  out = out.replace(/\p{Cc}+/gu, ' ').trim();
  return out.length > LOG_MAX ? `${out.slice(0, LOG_MAX)}…` : out;
}

const CERTIFICATE = /certificate|self[- ]signed|unable to verify|altname|\btls\b|\bssl\b/i;

function kindOf(err: NodemailerError): MailFailure {
  const cause = (err as { cause?: { code?: unknown; message?: unknown } }).cause;
  const certificate = CERTIFICATE.test(`${err.message} ${String(cause?.code ?? '')} ${String(cause?.message ?? '')}`);
  switch (err.code) {
    case 'EAUTH':
    case 'ENOAUTH':
      return 'login';
    case 'ETIMEDOUT':
      return 'timeout';
    case 'ETLS':
    case 'EREQUIRETLS':
      return 'tls';
    case 'ECONNECTION':
    case 'ESOCKET':
    case 'EDNS':
    case 'EPROXY':
      return certificate ? 'tls' : 'connect';
    case 'EENVELOPE':
      return 'recipients';
    case 'EMESSAGE':
      return 'rejected';
    default:
      return certificate ? 'tls' : 'other';
  }
}

function toMailError(err: unknown, secrets: readonly string[]): MailError {
  const e = (err ?? {}) as NodemailerError;
  const first = String(e.response ?? e.message ?? '').split(/\r?\n/)[0];
  const detail = [e.code, e.responseCode, e.command, first].filter((p) => p !== undefined && p !== '').join(' ');
  return new MailError(kindOf(e), scrub(detail, secrets));
}

/** How much silence the check before a send waits through: its own setting, else 15 seconds, and never more than the socket timeout. */
export function verifyLimit(timeouts: { socket: number; verify?: number }): number {
  return timeouts.verify ?? Math.min(timeouts.socket, 15_000);
}

export function createMailer(settings: MailSettings, options: MailerOptions = {}): Mailer {
  const timeouts = options.timeoutsMs ?? { connect: 10_000, greeting: 10_000, socket: 60_000 };
  // The check before a send waits through less silence than a send, which may carry a large file: a server that greets and then says nothing is found out in seconds.
  const verifyMs = verifyLimit(timeouts);
  const connection = (socketTimeout: number) =>
    createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.security === 'tls',
      requireTLS: settings.security === 'starttls',
      ignoreTLS: settings.security === 'none',
      auth: settings.user ? { user: settings.user, pass: settings.pass } : undefined,
      connectionTimeout: timeouts.connect,
      greetingTimeout: timeouts.greeting,
      socketTimeout,
      dnsTimeout: timeouts.connect,
      disableFileAccess: true,
      disableUrlAccess: true,
      tls: { minVersion: 'TLSv1.2', ...options.tls },
    });
  const transport = connection(timeouts.socket);
  const secrets = [settings.pass, settings.user];

  return {
    async verify() {
      try {
        await connection(verifyMs).verify();
      } catch (err) {
        const failure = toMailError(err, secrets);
        // Nothing has been handed over yet, so a silent server is one that could not be reached, not one that may have taken the report.
        throw failure.kind === 'timeout' ? new MailError('connect', failure.detail) : failure;
      }
    },
    async send(message) {
      if (message.to.length === 0 || !message.to.every(plainAddress)) throw new MailError('recipients', 'no usable recipient');
      try {
        const info = await transport.sendMail({
          from: { name: settings.fromName, address: settings.from },
          to: message.to,
          subject: message.subject,
          text: message.text,
          attachments: message.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
          // Nobody reads the reply: this keeps an out-of-office answer from coming back here.
          headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
        });
        return { accepted: info.accepted.length, refused: info.rejected.length };
      } catch (err) {
        throw toMailError(err, secrets);
      }
    },
  };
}
