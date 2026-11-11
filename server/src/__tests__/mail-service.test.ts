import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveMail } from '../core/mailConfig.js';
import { sampleSliReports } from './helpers/sliReportFixture.js';

/**
 * services/sliMail.ts on its own: what it does when email is off (the route checks that first, so the route's tests never
 * reach it), and the notice the schedule sends, which carries no file. The mail server is a stand-in. No address is real.
 */
vi.hoisted(() => {
  process.env.MAIL_PROVIDER = 'gmail';
  process.env.MAIL_USER = 'portal.reports@example.com';
  process.env.MAIL_PASS = 'not-a-real-password';
});

const mailer = vi.hoisted(() => ({ verify: vi.fn(), send: vi.fn() }));
vi.mock('../clients/mail.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/mail.js')>()),
  createMailer: vi.fn(() => mailer),
}));
const reads = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../services/sli.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/sli.js')>()),
  getMonthlySli: reads.get,
}));

const { config } = await import('../core/config.js');
const { MailDisabledError } = await import('../clients/mail.js');
const { emailReport, sendNotice } = await import('../services/sliMail.js');

const configured = { ...config.mail };
const { strict, hcml } = sampleSliReports();

beforeEach(() => {
  Object.assign(config.mail, configured);
  mailer.verify.mockReset().mockResolvedValue(undefined);
  mailer.send.mockReset().mockResolvedValue({ accepted: 2, refused: 0 });
  reads.get.mockReset().mockImplementation(async (_m: string, profile: string) => (profile === 'hcml-report' ? hcml : strict));
});
afterEach(() => Object.assign(config.mail, configured));

describe('email that is off', () => {
  beforeEach(() => Object.assign(config.mail, resolveMail({})));

  it('sends no report, logs in nowhere and reads nothing', async () => {
    await expect(emailReport({ month: '2026-08', formats: ['pdf'], to: ['ana@example.org'], sentBy: 'ana' })).rejects.toBeInstanceOf(MailDisabledError);
    expect(mailer.verify).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(reads.get).not.toHaveBeenCalled();
  });

  it('sends no notice', async () => {
    await expect(sendNotice(['ana@example.org'], 'Subject', 'Text')).rejects.toBeInstanceOf(MailDisabledError);
    expect(mailer.send).not.toHaveBeenCalled();
  });
});

describe('a notice', () => {
  it('is a message to the people named, with a subject and a text and no file', async () => {
    await sendNotice(['ana@example.org', 'budi@example.org'], 'The subject', 'The text.\n');
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(mailer.send).toHaveBeenCalledWith({ to: ['ana@example.org', 'budi@example.org'], subject: 'The subject', text: 'The text.\n', attachments: [] });
  });

  it('reads no report and logs in only to send', async () => {
    await sendNotice(['ana@example.org'], 's', 't');
    expect(reads.get).not.toHaveBeenCalled();
  });
});

describe('a report', () => {
  it('reports every file it made, with its size, and the total', async () => {
    const sent = await emailReport({ month: '2026-08', formats: ['pdf', 'csv'], to: ['ana@example.org'], sentBy: 'ana' });
    expect(sent.files.map((f) => f.format)).toEqual(['pdf', 'csv']);
    expect(sent.files.map((f) => f.fileName)).toEqual(['HCML_SLA_Report_2026-08.pdf', 'HCML_SLA_Report_2026-08_csv.zip']);
    expect(sent.files.every((f) => f.bytes > 500)).toBe(true);
    expect(sent.bytes).toBe(sent.files[0]!.bytes + sent.files[1]!.bytes);
    expect(sent).toMatchObject({ accepted: 2, refused: 0 });
  });

  it('uses the clock it is given, so a report made by the schedule carries the moment of the schedule', async () => {
    await emailReport({ month: '2026-08', formats: ['xlsx'], to: ['ana@example.org'], sentBy: 'the monthly schedule', now: new Date('2026-09-01T00:10:00+07:00') });
    expect(mailer.send.mock.calls[0][0].text).toContain('Generated 1 Sep 2026 00:10 (Asia/Jakarta). Sent by the monthly schedule');
  });
});
