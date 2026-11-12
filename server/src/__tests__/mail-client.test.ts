import { afterEach, describe, expect, it } from 'vitest';
import { createMailer, failureWords, MailError, scrub, verifyLimit, type MailFailure, type OutgoingMail } from '../clients/mail.js';
import type { MailSettings } from '../core/mailConfig.js';
import { closedPort, startFakeSmtp, type FakeSmtp, type FakeSmtpOptions } from './helpers/fakeSmtp.js';
import { TEST_CA } from './helpers/tlsTestCerts.js';

/**
 * The mail client against a small server on the loopback address (helpers/fakeSmtp.ts): the bytes that reach it, the
 * order of encryption and login, and what each kind of failure turns into. Every address and password is made up.
 */

const PASS = 'not-a-real-password';
const login = { user: 'portal@example.com', pass: PASS };

const settings = (port: number, over: Partial<MailSettings> = {}): MailSettings => ({
  enabled: true,
  provider: 'smtp',
  host: '127.0.0.1',
  port,
  security: 'tls',
  ...login,
  from: 'portal@example.com',
  fromName: 'HCML Monitoring Portal',
  to: [],
  allowedDomains: [],
  schedule: true,
  problems: [],
  ...over,
});

/** The test certificate is for "localhost" and signed by the test CA. */
const trust = { tls: { ca: TEST_CA, servername: 'localhost' } };

const FILE = Buffer.from('%PDF-1.4 a report of 31 bytes\n');
const mail: OutgoingMail = {
  to: ['ana@example.org', 'budi@example.org'],
  subject: 'HCML SLA report, August 2026',
  text: 'The report for August 2026 is attached.\n',
  attachments: [{ filename: 'HCML_SLA_Report_2026-08.pdf', content: FILE, contentType: 'application/pdf' }],
};

const servers: FakeSmtp[] = [];
async function start(options: FakeSmtpOptions): Promise<FakeSmtp> {
  const smtp = await startFakeSmtp(options);
  servers.push(smtp);
  return smtp;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

/** A header's value, with its folded lines joined. */
function header(raw: string, name: string): string | undefined {
  const m = new RegExp(`^${name}: (.*(?:\\r\\n[ \\t].*)*)`, 'im').exec(raw);
  return m?.[1]?.replace(/\r\n[ \t]+/g, ' ');
}

/** The attached file's bytes, read back out of the message. */
function attachmentOf(raw: string): Buffer | null {
  const m = /Content-Disposition: attachment;[\s\S]*?\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/.exec(raw);
  return m ? Buffer.from(m[1].replace(/\r\n/g, ''), 'base64') : null;
}

/** Every attached file, by name, read back out of the message. */
function attachmentsOf(raw: string): { name: string; type: string; content: Buffer }[] {
  const found: { name: string; type: string; content: Buffer }[] = [];
  // A long header is folded onto several lines; joined, each part's type is on one line.
  const unfolded = raw.replace(/\r\n[ \t]+/g, ' ');
  const part = /Content-Type:\s*([^;\r\n]+)[^\r\n]*\r\n(?:[^\r\n]+\r\n)*?Content-Disposition: attachment;\s*filename="?([^"\r\n;]+)"?[\s\S]*?\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g;
  for (const m of unfolded.matchAll(part)) found.push({ type: m[1]!.trim(), name: m[2]!, content: Buffer.from(m[3]!.replace(/\r\n/g, ''), 'base64') });
  return found;
}

async function failure(run: Promise<unknown>): Promise<MailError> {
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(MailError);
  return err as MailError;
}

describe('what a timeout is told (FR-35)', () => {
  it('says the report may or may not have gone, and where to look, since the server may have had it whole', () => {
    expect(failureWords('timeout')).toBe(
      'The mail server did not answer in time, so the report may or may not have gone. Look under Last sends in the Schedule dialog, or ask the people it was sent to, before you send it again.',
    );
  });

  it('keeps the sentence of every other kind as it was, and none of them says the report may have gone', () => {
    for (const kind of ['login', 'connect', 'tls', 'recipients', 'rejected', 'other'] as const) expect(failureWords(kind)).not.toMatch(/may or may not/);
  });
});

describe('sending the report', () => {
  it('names the sender as MAIL_FROM_NAME says, and not as the portal does by default (IN-62)', async () => {
    const smtp = await start({ mode: 'tls', login });
    await createMailer(settings(smtp.port, { fromName: 'Laporan SLA HCML' }), trust).send(mail);
    expect(header(smtp.messages[0]!.raw, 'From')).toContain('Laporan SLA HCML <portal@example.com>');
    expect(header(smtp.messages[0]!.raw, 'From')).not.toContain('HCML Monitoring Portal');
  });

  it('delivers it to every recipient over TLS, after logging in, with the file attached', async () => {
    const smtp = await start({ mode: 'tls', login });
    const result = await createMailer(settings(smtp.port), trust).send(mail);

    expect(result).toEqual({ accepted: 2, refused: 0 });
    expect(smtp.logins).toEqual([{ ...login, ok: true, encrypted: true }]);
    expect(smtp.messages).toHaveLength(1);
    const [got] = smtp.messages;
    expect(got).toMatchObject({ from: 'portal@example.com', to: ['ana@example.org', 'budi@example.org'], encrypted: true });
    expect(header(got.raw, 'Subject')).toBe('HCML SLA report, August 2026');
    expect(header(got.raw, 'From')).toContain('HCML Monitoring Portal <portal@example.com>');
    expect(header(got.raw, 'To')).toMatch(/ana@example\.org.*budi@example\.org/);
    expect(got.raw).toMatch(/filename="?HCML_SLA_Report_2026-08\.pdf"?/);
    expect(got.raw).toMatch(/Content-Type: application\/pdf/);
    expect(attachmentOf(got.raw)?.equals(FILE)).toBe(true);
    expect(got.raw).toContain('The report for August 2026 is attached.');
  });

  it('sends to the addresses of the message, whatever the settings list', async () => {
    const smtp = await start({ mode: 'tls', login });
    await createMailer(settings(smtp.port, { to: ['old@example.org'] }), trust).send({ ...mail, to: ['new@example.org'] });
    expect(smtp.messages[0].to).toEqual(['new@example.org']);
    expect(header(smtp.messages[0].raw, 'To')).toBe('new@example.org');
  });

  it('attaches every file it is given, each with its own name and type, in one message', async () => {
    const smtp = await start({ mode: 'tls', login });
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]);
    const sheet = Buffer.from('PK workbook bytes');
    await createMailer(settings(smtp.port), trust).send({
      ...mail,
      attachments: [
        { filename: 'HCML_SLA_Report_2026-08.pdf', content: FILE, contentType: 'application/pdf' },
        { filename: 'HCML_SLA_Report_2026-08.xlsx', content: sheet, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        { filename: 'HCML_SLA_Report_2026-08_csv.zip', content: zip, contentType: 'application/zip' },
      ],
    });
    expect(smtp.messages).toHaveLength(1);
    const got = attachmentsOf(smtp.messages[0].raw);
    expect(got.map((a) => a.name)).toEqual(['HCML_SLA_Report_2026-08.pdf', 'HCML_SLA_Report_2026-08.xlsx', 'HCML_SLA_Report_2026-08_csv.zip']);
    expect(got.map((a) => a.type)).toEqual(['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip']);
    expect(got[0]!.content.equals(FILE)).toBe(true);
    expect(got[1]!.content.equals(sheet)).toBe(true);
    expect(got[2]!.content.equals(zip)).toBe(true);
  });

  it('keeps the type it is given for a file, whatever the name ends in', async () => {
    const smtp = await start({ mode: 'tls', login });
    await createMailer(settings(smtp.port), trust).send({ ...mail, attachments: [{ filename: 'report.data', content: FILE, contentType: 'application/pdf' }] });
    expect(attachmentsOf(smtp.messages[0].raw)[0]).toMatchObject({ name: 'report.data', type: 'application/pdf' });
  });

  it('sends a note with no attachment at all, as plain text', async () => {
    const smtp = await start({ mode: 'tls', login });
    await createMailer(settings(smtp.port), trust).send({ ...mail, attachments: [], subject: 'Notice', text: 'The report was not sent.\n' });
    const raw = smtp.messages[0].raw;
    expect(raw).not.toMatch(/Content-Disposition: attachment/i);
    expect(header(raw, 'Content-Type')).toMatch(/^text\/plain/);
    expect(raw).toContain('The report was not sent.');
  });

  it('refuses a message with nobody to send it to, before it connects to anything', async () => {
    const err = await failure(createMailer(settings(await closedPort())).send({ ...mail, to: [] }));
    expect(err.kind).toBe('recipients');
  });

  it.each(['ana@example.org\r\nBcc: spy@example.net', 'ana@example.org\nX-Evil: 1', 'not an address', 'Ana <ana@example.org>'])(
    'refuses %j as an address before it reaches the server, since a header is how a message gets forged',
    async (address) => {
      const smtp = await start({ mode: 'tls', login });
      const err = await failure(createMailer(settings(smtp.port), trust).send({ ...mail, to: ['budi@example.org', address] }));
      expect(err.kind).toBe('recipients');
      expect(smtp.messages).toEqual([]);
      expect(smtp.logins).toEqual([]);
    },
  );

  it('marks the message as automatic, so an out-of-office reply does not come back to the portal', async () => {
    const smtp = await start({ mode: 'tls', login });
    await createMailer(settings(smtp.port), trust).send(mail);
    expect(header(smtp.messages[0].raw, 'Auto-Submitted')).toBe('auto-generated');
    expect(header(smtp.messages[0].raw, 'X-Auto-Response-Suppress')).toBe('All');
  });

  it('upgrades with STARTTLS before it logs in, so the password is never sent in the clear', async () => {
    const smtp = await start({ mode: 'starttls', login });
    await createMailer(settings(smtp.port, { security: 'starttls' }), trust).send(mail);

    expect(smtp.logins).toEqual([{ ...login, ok: true, encrypted: true }]);
    expect(smtp.messages[0].encrypted).toBe(true);
    expect(smtp.clearText.join('\n')).not.toMatch(/AUTH/i);
  });

  it('will not log in over a connection it could not encrypt, when STARTTLS is asked for', async () => {
    const smtp = await start({ mode: 'starttls', login, withholdStarttls: true });
    const err = await failure(createMailer(settings(smtp.port, { security: 'starttls' }), trust).send(mail));

    expect(err.kind).toBe('tls');
    expect(smtp.logins).toEqual([]);
    expect(smtp.messages).toEqual([]);
    expect(smtp.clearText.join('\n')).not.toMatch(/AUTH/i);
  });

  it('sends without encryption and without a login only when the settings say so', async () => {
    const smtp = await start({ mode: 'plain' });
    const result = await createMailer(settings(smtp.port, { security: 'none', user: '', pass: '' })).send(mail);

    expect(result).toEqual({ accepted: 2, refused: 0 });
    expect(smtp.logins).toEqual([]);
    expect(smtp.messages[0].encrypted).toBe(false);
  });

  it('stays unencrypted on "none" even when the server offers STARTTLS: the administrator said no encryption', async () => {
    const smtp = await start({ mode: 'starttls' });
    await createMailer(settings(smtp.port, { security: 'none', user: '', pass: '' })).send(mail);
    expect(smtp.messages[0].encrypted).toBe(false);
    expect(smtp.clearText.join('\n')).not.toMatch(/STARTTLS/i);
  });

  it('says how many recipients the server refused, when it took the message for the others', async () => {
    const smtp = await start({ mode: 'tls', login, refuse: ['ana@example.org'] });
    const result = await createMailer(settings(smtp.port), trust).send(mail);

    expect(result).toEqual({ accepted: 1, refused: 1 });
    expect(smtp.messages[0].to).toEqual(['budi@example.org']);
  });

  it('fails as "recipients" when the server refuses every one', async () => {
    const smtp = await start({ mode: 'tls', login, refuse: ['ana@example.org', 'budi@example.org'] });
    const err = await failure(createMailer(settings(smtp.port), trust).send(mail));
    expect(err.kind).toBe('recipients');
    expect(smtp.messages).toEqual([]);
  });
});

describe('checking the settings without sending', () => {
  it('logs in and leaves, and sends nothing', async () => {
    const smtp = await start({ mode: 'tls', login });
    await createMailer(settings(smtp.port), trust).verify();
    expect(smtp.logins).toEqual([{ ...login, ok: true, encrypted: true }]);
    expect(smtp.messages).toEqual([]);
  });

  it('fails as a login failure on a wrong password', async () => {
    const smtp = await start({ mode: 'tls', login });
    const err = await failure(createMailer(settings(smtp.port, { pass: 'wrong-password' }), trust).verify());
    expect(err.kind).toBe('login');
    expect(smtp.messages).toEqual([]);
  });
});

describe('what each failure turns into', () => {
  it('a wrong password: a sentence about the login, with the server’s code kept for the log and the password nowhere', async () => {
    const smtp = await start({ mode: 'tls', login });
    const err = await failure(createMailer(settings(smtp.port, { pass: 'wrong-password' }), trust).send(mail));

    expect(err.kind).toBe('login');
    expect(err.message).toMatch(/refused the login/);
    expect(err.message).toMatch(/app password/);
    expect(err.detail).toMatch(/535/);
    expect(`${err.message} ${err.detail}`).not.toContain('wrong-password');
  });

  it('a port nobody listens on: the mail server could not be reached', async () => {
    const err = await failure(createMailer(settings(await closedPort())).send(mail));
    expect(err.kind).toBe('connect');
    expect(err.message).toMatch(/could not reach/);
  });

  it('a server that never answers: a timeout, not a hang', async () => {
    const smtp = await start({ mode: 'plain', silent: true });
    const mailer = createMailer(settings(smtp.port, { security: 'none', user: '', pass: '' }), {
      timeoutsMs: { connect: 300, greeting: 300, socket: 300 },
    });
    const started = Date.now();
    const err = await failure(mailer.send(mail));
    expect(err.kind).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('a server that never answers the check before a send: nothing could have gone, so it is not told as a timeout (BK-52)', async () => {
    const smtp = await start({ mode: 'plain', silent: true });
    const mailer = createMailer(settings(smtp.port, { security: 'none', user: '', pass: '' }), {
      timeoutsMs: { connect: 300, greeting: 300, socket: 300 },
    });
    const err = await failure(mailer.verify());
    expect(err.kind).toBe('connect');
    expect(err.message).not.toMatch(/may or may not/);
    expect(err.message).toMatch(/could not reach/);
  });

  it('a server that greets and then ignores EHLO: the check gives up on its own short limit, not after the long send timeout (BK-52)', async () => {
    const smtp = await start({ mode: 'plain', ignoreCommands: true });
    const mailer = createMailer(settings(smtp.port, { security: 'none', user: '', pass: '' }), {
      timeoutsMs: { connect: 300, greeting: 300, socket: 120_000, verify: 400 },
    });
    const started = Date.now();
    const err = await failure(mailer.verify());
    expect(err.kind).toBe('connect');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('limits the silence of the check before a send to 15 seconds at most, to the socket timeout when that is shorter, and to its own setting when it has one (BK-52)', () => {
    expect(verifyLimit({ socket: 60_000 })).toBe(15_000);
    expect(verifyLimit({ socket: 120_000 })).toBe(15_000);
    expect(verifyLimit({ socket: 900 })).toBe(900);
    expect(verifyLimit({ socket: 120_000, verify: 400 })).toBe(400);
  });

  it('a send keeps the longer socket timeout, because a message may be large: the short limit belongs to the check alone (BK-52)', async () => {
    const smtp = await start({ mode: 'plain', ignoreCommands: true });
    const mailer = createMailer(settings(smtp.port, { security: 'none', user: '', pass: '' }), {
      timeoutsMs: { connect: 300, greeting: 300, socket: 900, verify: 100 },
    });
    const started = Date.now();
    const err = await failure(mailer.send(mail));
    expect(err.kind).toBe('timeout');
    expect(Date.now() - started).toBeGreaterThanOrEqual(700);
  });

  it('a certificate the portal does not trust: a TLS failure, and the connection goes no further', async () => {
    const smtp = await start({ mode: 'tls', login });
    const err = await failure(createMailer(settings(smtp.port)).send(mail));
    expect(err.kind).toBe('tls');
    expect(smtp.logins).toEqual([]);
    expect(smtp.messages).toEqual([]);
  });

  it('tells a person to check the sender and the addresses a report goes to, not the list in the settings that is only where it starts', () => {
    const words = new MailError('recipients', '550').message;
    expect(words).toContain('MAIL_FROM');
    expect(words).toContain('the addresses the report goes to');
    expect(words).not.toContain('MAIL_TO');
  });

  it('each kind has its own sentence, and none of them carries what the server said', () => {
    const kinds: MailFailure[] = ['login', 'connect', 'timeout', 'tls', 'recipients', 'rejected', 'other'];
    const words = kinds.map((kind) => new MailError(kind, '550 5.1.1 secret@example.net').message);
    expect(new Set(words).size).toBe(kinds.length);
    for (const w of words) expect(w).not.toMatch(/secret@example\.net|550/);
  });
});

describe('scrub, for what goes to the log', () => {
  it('removes the secrets, control characters and the length past 300', () => {
    const out = scrub(`535 login for portal@example.com with ${PASS} failed\r\nBcc: x\u0000${'z'.repeat(400)}`, [PASS, 'portal@example.com']);
    expect(out).not.toContain(PASS);
    expect(out).not.toContain('portal@example.com');
    expect(out).not.toMatch(/\p{Cc}/u);
    expect(out.length).toBeLessThanOrEqual(301);
  });

  it('masks an address a server echoes back, so the log does not name the people a report went to', () => {
    expect(scrub('550 5.1.1 <ana@example.org>: Recipient address rejected', [])).toBe('550 5.1.1 <[address]>: Recipient address rejected');
    expect(scrub('rcpt ana@example.org, budi@example.org refused', [])).toBe('rcpt [address], [address] refused');
  });

  it('leaves a secret of nothing alone', () => {
    expect(scrub('abc', [''])).toBe('abc');
  });
});
