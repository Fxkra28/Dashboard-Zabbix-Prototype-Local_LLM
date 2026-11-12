import { createMailer, MailDisabledError } from '../clients/mail.js';
import { mailNow } from '../core/config.js';
import { EmptyReportError } from '../core/validate.js';
import { buildSlaReportDoc } from '../export/slaReport.js';
import { DEFAULT_STYLE, type Format, type ReportStyle } from '../core/reportChoices.js';
import type { ReportDoc } from '../export/types.js';
import { forgetMonthlySli, getMonthlySli } from './sli.js';
import { FORMATS, fileFor, fileNameFor } from './sliExport.js';

/**
 * The monthly SLA report by email: the files the download gives, attached to one short message, to the addresses the
 * caller names. Who may name them is decided before this is called (routes/sliMail.ts, services/reportSchedule.ts).
 */

export interface EmailedFile {
  format: Format;
  fileName: string;
  bytes: number;
}

export interface EmailedReport {
  files: EmailedFile[];
  accepted: number;
  refused: number;
  /** All the files together. */
  bytes: number;
}

/** The report's own first-page figures, so a reader sees how the month went before opening a file. */
export function bodyOf(doc: ReportDoc, sentBy: string, files: number): string {
  const figures = doc.kpis.map((k) => `${k.label}: ${k.value}${k.detail ? ` (${k.detail})` : ''}`);
  return [
    `${doc.title}, ${doc.subtitle}`,
    '',
    ...figures,
    '',
    `Period: ${doc.period}`,
    files === 1 ? 'The attached file holds both methods in full.' : 'The attached files hold both methods in full.',
    '',
    `${doc.generated}. Sent by ${sentBy} from the HCML Monitoring Portal.`,
    'This message is automatic. Replies are not read.',
    '',
  ].join('\n');
}

export interface EmailRequest {
  month: string;
  /** In the order they are attached. */
  formats: Format[];
  to: string[];
  style?: ReportStyle;
  /** Named in the message: a user name, or "the monthly schedule". */
  sentBy: string;
  now?: Date;
}

export async function emailReport(input: EmailRequest): Promise<EmailedReport> {
  const { month, formats, to, sentBy } = input;
  const style = input.style ?? DEFAULT_STYLE;
  const settings = mailNow();
  if (!settings.enabled) throw new MailDisabledError(settings.off || undefined);

  const mailer = createMailer(settings);
  // First, so a wrong password fails in a second and not after a minute of reading Zabbix.
  await mailer.verify();

  const [strict, hcml] = await Promise.all([getMonthlySli(month, 'availability'), getMonthlySli(month, 'hcml-report')]);
  // Mailing a report with no device in either profile would send an empty page as a success (BK-51). It is not kept either: a closed
  // month is cached for a day, and every retry of the week would be answered with the empty report after the cause was put right.
  if (strict.overall.hosts === 0 && hcml.overall.hosts === 0) {
    forgetMonthlySli(month);
    throw new EmptyReportError();
  }
  const now = input.now ?? new Date();
  const files = formats.map((format) => ({ format, fileName: fileNameFor(month, format), body: fileFor(format, strict, hcml, now, style) }));
  const doc = buildSlaReportDoc(strict, hcml, now, style);

  const { accepted, refused } = await mailer.send({
    to,
    subject: `HCML ${doc.title}, ${doc.subtitle}`,
    text: bodyOf(doc, sentBy, files.length),
    attachments: files.map((f) => ({ filename: f.fileName, content: f.body, contentType: FORMATS[f.format].type })),
  });
  return {
    files: files.map((f) => ({ format: f.format, fileName: f.fileName, bytes: f.body.length })),
    accepted,
    refused,
    bytes: files.reduce((n, f) => n + f.body.length, 0),
  };
}

/** A short message with no file, to the people who asked to be told when something goes wrong. */
export async function sendNotice(to: string[], subject: string, text: string): Promise<void> {
  const settings = mailNow();
  if (!settings.enabled) throw new MailDisabledError(settings.off || undefined);
  await createMailer(settings).send({ to, subject, text, attachments: [] });
}
