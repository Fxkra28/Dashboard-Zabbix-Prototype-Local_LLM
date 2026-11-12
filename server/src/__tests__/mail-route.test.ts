import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { AJV_OPTIONS } from '../core/schemas.js';
import { resolveMail } from '../core/mailConfig.js';
import { memoryState, StateWriteError } from '../core/state.js';
import { buildSlaReportDoc } from '../export/slaReport.js';
import { readZip } from './helpers/readZip.js';
import { sampleSliReports } from './helpers/sliReportFixture.js';

/**
 * Emailing the SLA report: who may, what is checked before anything is read or sent, what goes out, what each
 * failure is told, and the one log line it leaves. The mail server is a stand-in here (the client has its own tests
 * against a real socket); the report files are the real ones. Every address and password is made up.
 */
vi.hoisted(() => {
  // a1 to a17 are named in the tests; f1 to f60 are the ones `freshAdmin` hands out, one allowance each.
  const admins = [
    ...Array.from({ length: 17 }, (_, i) => `a${i + 1}:admin-pass:admin`),
    ...Array.from({ length: 60 }, (_, i) => `f${i + 1}:admin-pass:admin`),
  ].join(',');
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = `ana:viewer-pass:viewer,olu:operator-pass:operator,${admins}`;
  process.env.MAIL_PROVIDER = 'gmail';
  process.env.MAIL_USER = 'portal.reports@example.com';
  process.env.MAIL_PASS = 'not-a-real-password';
  process.env.MAIL_TO = 'ana@example.org, budi@example.org';
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
const { setupAuth, tokenClaims } = await import('../security/auth.js');
const { registerErrorHandler } = await import('../http/errors.js');
const { sliMailRoutes } = await import('../routes/sliMail.js');
const { MailError } = await import('../clients/mail.js');
const { SENDS_PER_HOUR } = await import('../security/mailLimit.js');
const { portalState, usePortalState } = await import('../services/portalState.js');

type Line = Record<string, unknown> & { msg: string };
let app: FastifyInstance;
let lines: Line[];
const configured = { ...config.mail };
const { strict, hcml } = sampleSliReports();

beforeEach(async () => {
  // The route refuses a month that has not started or is over about 400 days back, so the clock is fixed, as in the engine's tests.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-17T03:00:00Z'));
  lines = [];
  usePortalState(memoryState());
  mailer.verify.mockReset().mockResolvedValue(undefined);
  mailer.send.mockReset().mockResolvedValue({ accepted: 2, refused: 0 });
  reads.get.mockReset().mockImplementation(async (_month: string, profile: string) => (profile === 'hcml-report' ? hcml : strict));
  Object.assign(config.mail, configured);
  app = Fastify({ ajv: AJV_OPTIONS, logger: { level: 'info', stream: { write: (chunk: string) => void lines.push(JSON.parse(chunk) as Line) } } });
  registerErrorHandler(app);
  await setupAuth(app);
  await app.register(sliMailRoutes);
  await app.ready();
});
afterEach(async () => {
  vi.useRealTimers();
  await app.close();
});

const tokenFor = (sub: string, role: string) => app.jwt.sign({ sub, role, ...tokenClaims('hcml_session') }, { expiresIn: '1h' });
const bearer = (sub: string, role = 'admin') => ({ authorization: `Bearer ${tokenFor(sub, role)}` });

let nextAdmin = 0;
/** A different administrator each time, so the allowance of one does not use up the next test's. The clock is fixed, so no allowance comes back; 60 names hold 300 sends. */
const freshAdmin = () => `f${(nextAdmin++ % 60) + 1}`;

const send = (payload: unknown, headers: Record<string, string> = bearer(freshAdmin()), remoteAddress = '10.9.8.7') =>
  app.inject({ method: 'POST', url: '/api/sli/email', headers, payload: payload as object, remoteAddress });
const ok = { month: '2026-08', formats: ['pdf'] };
const SEED = ['ana@example.org', 'budi@example.org'];
const emails = () => lines.filter((l) => l.event === 'report_email');

describe('who may ask', () => {
  it.each([
    ['a viewer', 'ana', 'viewer'],
    ['an operator', 'olu', 'operator'],
  ])('refuses %s, and builds and sends nothing', async (_who, sub, role) => {
    const res = await send(ok, bearer(sub, role));
    expect(res.statusCode).toBe(403);
    expect(reads.get).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(emails()).toEqual([]);
  });

  it('refuses a request with no sign-in', async () => {
    expect((await send(ok, {})).statusCode).toBe(401);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('wants the CSRF header on the portal’s own cookie, and takes the request with it', async () => {
    const page = { host: '127.0.0.1:8081', origin: 'http://127.0.0.1:8081', cookie: `hcml_session=${tokenFor(freshAdmin(), 'admin')}` };
    const without = await send(ok, page);
    expect(without.statusCode).toBe(403);
    expect(without.json()).toMatchObject({ error: 'csrf' });
    expect(mailer.send).not.toHaveBeenCalled();

    const withHeader = await send(ok, { ...page, 'x-hcml-csrf': '1' });
    expect(withHeader.statusCode).toBe(200);
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });
});

describe('what the screen may know before it asks', () => {
  const info = (headers: Record<string, string>) => app.inject({ url: '/api/sli/email', headers });

  it('tells an administrator whether email is on, from where and to whom', async () => {
    const res = await info(bearer(freshAdmin()));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true, from: 'portal.reports@example.com', recipients: SEED, max: 10, allowedDomains: [], kept: false });
  });

  it('lists the recipients the portal saved in place of the ones in MAIL_TO once it has some', async () => {
    await portalState().change((d) => void (d.mail.recipients = ['cici@example.org']));
    expect((await info(bearer(freshAdmin()))).json()).toMatchObject({ recipients: ['cici@example.org'] });
  });

  it('says whether what is saved survives a restart, and which domains a report may go to', async () => {
    Object.assign(config.mail, { allowedDomains: ['example.org'] });
    expect((await info(bearer(freshAdmin()))).json()).toMatchObject({ kept: false, allowedDomains: ['example.org'] });
  });

  it('names no sender when email is off, whatever a half-set configuration holds', async () => {
    Object.assign(config.mail, resolveMail({}), { from: 'half.set@example.com' });
    expect((await info(bearer(freshAdmin()))).json().from).toBe('');
  });

  it('names no address when email is off', async () => {
    Object.assign(config.mail, resolveMail({}));
    expect((await info(bearer(freshAdmin()))).json()).toEqual({ enabled: false, from: '', recipients: [], max: 10, allowedDomains: [], kept: false });
  });

  it('is for administrators only', async () => {
    expect((await info(bearer('olu', 'operator'))).statusCode).toBe(403);
    expect((await info(bearer('ana', 'viewer'))).statusCode).toBe(403);
    expect((await info({})).statusCode).toBe(401);
  });
});

describe('what is checked first', () => {
  it.each([
    ['no body', undefined],
    ['no month', { formats: ['pdf'] }],
    ['no formats', { month: '2026-08' }],
    ['an empty list of formats', { month: '2026-08', formats: [] }],
    ['a month that is not one', { month: 'nope', formats: ['pdf'] }],
    ['a month in the wrong form', { month: '2026-8', formats: ['pdf'] }],
    ['a format it does not make', { month: '2026-08', formats: ['exe'] }],
    ['one good format and one it does not make', { month: '2026-08', formats: ['pdf', 'exe'] }],
    ['a number for the month', { month: 202608, formats: ['pdf'] }],
    ['a single format where a list is wanted', { month: '2026-08', formats: 'pdf' }],
    ['the old single format', { month: '2026-08', format: 'pdf' }],
    ['more formats than there are', { month: '2026-08', formats: ['pdf', 'xlsx', 'csv', 'pdf'] }],
    ['a list of addresses that is not a list', { ...ok, to: 'ana@example.org' }],
    ['an address that is not plain', { ...ok, to: ['ana@example.org', 'nope'] }],
    ['an address with a line break', { ...ok, to: ['ana@example.org\r\nBcc: spy@example.net'] }],
    ['no address at all', { ...ok, to: [] }],
    ['more than ten addresses', { ...ok, to: Array.from({ length: 11 }, (_, i) => `p${i}@example.org`) }],
    ['a remember that is not true or false', { ...ok, remember: 'yes' }],
    ['a style value that is not a choice', { ...ok, style: { decimal: 'point' } }],
    ['a style with a field of its own', { ...ok, style: { colour: 'blue' } }],
  ])('refuses %s with a 400, before a report is read', async (_what, body) => {
    const res = await send(body);
    expect(res.statusCode).toBe(400);
    expect(reads.get).not.toHaveBeenCalled();
    expect(mailer.verify).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('refuses a subject, a message or a copy in the request: only the month, the files, the people and the style are asked', async () => {
    for (const extra of [{ subject: 'hello' }, { text: 'hello' }, { cc: 'spy@example.net' }, { bcc: ['spy@example.net'] }, { attachments: ['x'] }]) {
      const res = await send({ ...ok, ...extra });
      expect(res.statusCode, JSON.stringify(extra)).toBe(400);
    }
    expect(mailer.send).not.toHaveBeenCalled();
    expect(reads.get).not.toHaveBeenCalled();
  });

  it('refuses a month that ended less than ten minutes ago, as the monthly send waits for it, before anything is read (reviewer, 11 November)', async () => {
    // 00:03 on 1 September in Jakarta: August ended three minutes ago, and Zabbix is still adding its last values.
    vi.setSystemTime(new Date('2026-08-31T17:03:00Z'));
    const res = await send({ month: '2026-08', formats: ['pdf'] });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('That month ended a moment ago, and Zabbix is still adding its last values. Send it in about 7 minutes.');
    expect(reads.get).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
    // Ten minutes after the end it goes, and so does the month still running.
    vi.setSystemTime(new Date('2026-08-31T17:10:01Z'));
    expect((await send({ month: '2026-08', formats: ['pdf'] })).statusCode).toBe(200);
    expect((await send({ month: '2026-09', formats: ['pdf'] })).statusCode).toBe(200);
  });

  it('says which fields it takes', async () => {
    expect((await send({ ...ok, cc: 'x@example.org' })).json().message).toBe('Only month, formats, to, remember and style are accepted.');
    expect((await send({ ...ok, style: { colour: 'blue' } })).json().message).toBe('Only decimal, date and separator are accepted in style.');
  });

  it('says in words what was wrong with the recipients', async () => {
    const res = await send({ ...ok, to: ['ana@example.org', 'nope'] });
    expect(res.json()).toEqual({ error: 'bad_request', message: 'Recipients: "nope" is not a plain address such as name@example.com.' });
  });

  it('refuses an address outside the domains a report may go to, and says which', async () => {
    Object.assign(config.mail, { allowedDomains: ['example.org'] });
    const res = await send({ ...ok, to: ['ana@example.org', 'spy@elsewhere.net'] });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Recipients: spy@elsewhere.net is outside the domains this portal may send to (example.org).');
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('has nobody to send to when no address is given and none is saved or set', async () => {
    Object.assign(config.mail, { to: [] });
    const res = await send(ok);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Recipients: add at least one address.');
    expect(mailer.verify).not.toHaveBeenCalled();
  });

  it('answers 503 when email is not set up, and reads nothing', async () => {
    Object.assign(config.mail, resolveMail({}));
    const res = await send(ok);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'mail_disabled' });
    expect(res.json().message).toMatch(/MAIL_/);
    expect(reads.get).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('checks the mail login before it reads Zabbix, so a wrong password costs a second and not a minute', async () => {
    mailer.verify.mockRejectedValue(new MailError('login', '535 5.7.8 Username and Password not accepted'));
    const res = await send(ok);
    expect(res.statusCode).toBe(502);
    expect(reads.get).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });
});

describe('what goes out', () => {
  it('sends the PDF the download would give, with the month in the subject, and says how many it reached', async () => {
    const res = await send(ok);
    expect(res.statusCode).toBe(200);
    const size = mailer.send.mock.calls[0][0].attachments[0].content.length;
    expect(res.json()).toEqual({
      sent: 2,
      refused: 0,
      month: '2026-08',
      files: [{ format: 'pdf', fileName: 'HCML_SLA_Report_2026-08.pdf', bytes: size }],
      remembered: false,
    });

    expect(mailer.verify).toHaveBeenCalledTimes(1);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const mail = mailer.send.mock.calls[0][0];
    expect(mail.to).toEqual(SEED);
    expect(mail.subject).toBe('HCML SLA availability report, August 2026');
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0].filename).toBe('HCML_SLA_Report_2026-08.pdf');
    expect(mail.attachments[0].contentType).toBe('application/pdf');
    expect(mail.attachments[0].content.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(reads.get).toHaveBeenCalledWith('2026-08', 'availability');
    expect(reads.get).toHaveBeenCalledWith('2026-08', 'hcml-report');
  });

  it('sends the workbook for xlsx', async () => {
    const res = await send({ month: '2026-08', formats: ['xlsx'] });
    expect(res.statusCode).toBe(200);
    const mail = mailer.send.mock.calls[0][0];
    expect(mail.attachments[0].filename).toBe('HCML_SLA_Report_2026-08.xlsx');
    expect(mail.attachments[0].contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(mail.attachments[0].content.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('sends the CSV files as one zip for csv, named so that nobody takes it for another kind of zip', async () => {
    const res = await send({ month: '2026-08', formats: ['csv'] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ files: [{ format: 'csv', fileName: 'HCML_SLA_Report_2026-08_csv.zip' }] });
    const mail = mailer.send.mock.calls[0][0];
    expect(mail.attachments[0].filename).toBe('HCML_SLA_Report_2026-08_csv.zip');
    expect(mail.attachments[0].contentType).toBe('application/zip');
    expect(mail.attachments[0].content.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('sends several formats in one message, in the order pdf, xlsx, csv whatever order they were asked for', async () => {
    const res = await send({ month: '2026-08', formats: ['csv', 'pdf', 'xlsx'] });
    expect(res.statusCode).toBe(200);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const mail = mailer.send.mock.calls[0][0];
    expect(mail.attachments.map((a: { filename: string }) => a.filename)).toEqual([
      'HCML_SLA_Report_2026-08.pdf',
      'HCML_SLA_Report_2026-08.xlsx',
      'HCML_SLA_Report_2026-08_csv.zip',
    ]);
    expect(res.json().files.map((f: { format: string }) => f.format)).toEqual(['pdf', 'xlsx', 'csv']);
    expect(mail.text).toContain('The attached files hold both methods in full.');
  });

  it('logs the size of everything that was attached, not of the first file alone', async () => {
    await send({ month: '2026-08', formats: ['pdf', 'xlsx', 'csv'] });
    const total = mailer.send.mock.calls[0][0].attachments.reduce((n: number, a: { content: Buffer }) => n + a.content.length, 0);
    expect(emails()[0]).toMatchObject({ formats: ['pdf', 'xlsx', 'csv'], bytes: total });
    expect(portalState().read().mail.sends[0]).toMatchObject({ bytes: total });
  });

  it('sends a format named twice once', async () => {
    const res = await send({ month: '2026-08', formats: ['pdf', 'pdf'] });
    expect(res.statusCode).toBe(200);
    expect(mailer.send.mock.calls[0][0].attachments).toHaveLength(1);
    expect(mailer.send.mock.calls[0][0].text).toContain('The attached file holds both methods in full.');
  });

  it('sends to the addresses of the request, in place of the saved ones, all in one message', async () => {
    const res = await send({ ...ok, to: ['cici@example.org', ' dedi@example.org ', 'CICI@example.org'] });
    expect(res.statusCode).toBe(200);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(mailer.send.mock.calls[0][0].to).toEqual(['cici@example.org', 'dedi@example.org']);
  });

  it('sends to the saved list when the request names nobody, and the saved list wins over MAIL_TO', async () => {
    await portalState().change((d) => void (d.mail.recipients = ['eka@example.org']));
    await send(ok);
    expect(mailer.send.mock.calls[0][0].to).toEqual(['eka@example.org']);
  });

  it('writes the files and the message in the style asked for', async () => {
    const res = await send({ month: '2026-08', formats: ['csv'], style: { decimal: 'comma', date: 'iso', separator: 'semicolon' } });
    expect(res.statusCode).toBe(200);
    const mail = mailer.send.mock.calls[0][0];
    const files = readZip(mail.attachments[0].content);
    const site = [...files].find(([name]) => name.endsWith('02-by-site.csv'))![1].toString('utf8');
    expect(site.split('\r\n')[0]).toContain(';');
    expect(site.split('\r\n')[1]).toMatch(/;\d+,\d+;/);
    expect(mail.text).toMatch(/Generated \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    const doc = buildSlaReportDoc(strict, hcml, new Date(), { decimal: 'comma', date: 'iso', separator: 'semicolon' });
    expect(mail.text).toContain(`${doc.kpis[0]!.label}: ${doc.kpis[0]!.value}`);
    expect(doc.kpis[0]!.value).toMatch(/,/);
  });

  it('writes in the default style when none is given', async () => {
    await send({ month: '2026-08', formats: ['xlsx'] });
    const doc = buildSlaReportDoc(strict, hcml, new Date());
    expect(mailer.send.mock.calls[0][0].text).toContain(`${doc.kpis[0]!.label}: ${doc.kpis[0]!.value}`);
  });

  it('saves the list that was typed, after the report has gone, when asked to remember it', async () => {
    const res = await send({ ...ok, to: ['cici@example.org', 'dedi@example.org'], remember: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().remembered).toBe(true);
    expect(portalState().read().mail.recipients).toEqual(['cici@example.org', 'dedi@example.org']);
    expect((await app.inject({ url: '/api/sli/email', headers: bearer(freshAdmin()) })).json().recipients).toEqual(['cici@example.org', 'dedi@example.org']);
  });

  it('leaves the saved list alone when not asked to remember, and when remember is false', async () => {
    await send({ ...ok, to: ['cici@example.org'] });
    await send({ ...ok, to: ['cici@example.org'], remember: false }, bearer(freshAdmin()));
    expect(portalState().read().mail.recipients).toEqual([]);
  });

  it('does not save a list for a report that did not go', async () => {
    mailer.send.mockRejectedValue(new MailError('rejected', '554'));
    await send({ ...ok, to: ['cici@example.org'], remember: true });
    expect(portalState().read().mail.recipients).toEqual([]);
  });

  it('still says the report went when the list could not be saved, and says that it was not', async () => {
    const store = memoryState();
    store.change = () => Promise.reject(new StateWriteError('EACCES'));
    usePortalState(store);
    const res = await send({ ...ok, to: ['cici@example.org'], remember: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sent: 2, remembered: false });
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it('keeps a record of the send, by hand and by whom, with how many it reached and never who', async () => {
    await send({ month: '2026-08', formats: ['pdf', 'csv'] }, bearer('a9'));
    const [record] = portalState().read().mail.sends;
    expect(record).toMatchObject({ month: '2026-08', trigger: 'manual', by: 'a9', outcome: 'sent', attempts: 1, formats: ['pdf', 'csv'], recipients: 2, refused: 0 });
    expect(record!.bytes).toBeGreaterThan(1000);
    expect(JSON.stringify(portalState().read())).not.toContain('ana@example.org');
  });

  it('keeps a record of a failed send too, with why', async () => {
    mailer.send.mockRejectedValue(new MailError('login', '535'));
    await send(ok, bearer('a8'));
    expect(portalState().read().mail.sends[0]).toMatchObject({ trigger: 'manual', by: 'a8', outcome: 'failed', reason: 'login', recipients: 0 });
  });

  it('does not fail the send when the record cannot be kept', async () => {
    const store = memoryState();
    store.change = () => Promise.reject(new StateWriteError('EACCES'));
    usePortalState(store);
    expect((await send(ok)).statusCode).toBe(200);
    expect(emails()[0]).toMatchObject({ outcome: 'sent' });
  });

  it('writes a plain-text body from the report’s own figures, the same four the first page shows', async () => {
    await send(ok, bearer('a10'));
    const { text } = mailer.send.mock.calls[0][0];
    const doc = buildSlaReportDoc(strict, hcml, new Date());
    const [head, , ...rest] = text.split('\n');
    expect(text).toContain('The attached file holds both methods in full.');
    expect(head).toBe(`${doc.title}, ${doc.subtitle}`);
    const kpiLines = doc.kpis.map((k) => `${k.label}: ${k.value}${k.detail ? ` (${k.detail})` : ''}`);
    expect(rest.slice(0, kpiLines.length)).toEqual(kpiLines);
    expect(text).toContain(`Period: ${doc.period}`);
    expect(text).toContain('Sent by a10 from the HCML Monitoring Portal.');
    expect(text).toContain('This message is automatic. Replies are not read.');
    // Built from code points, so that this file holds neither character itself.
    expect(text).not.toMatch(new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`));
  });

  it('says so when the server refused some of the recipients', async () => {
    mailer.send.mockResolvedValue({ accepted: 1, refused: 1 });
    const res = await send(ok);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sent: 1, refused: 1 });
  });

  it('reads each method once for the month, though the file and the body are both made from it', async () => {
    await send(ok);
    expect(reads.get).toHaveBeenCalledTimes(2);
  });
});

describe('deleting the saved list (FR-31)', () => {
  const remove = (headers: Record<string, string> = bearer(freshAdmin())) => app.inject({ method: 'DELETE', url: '/api/sli/recipients', headers, remoteAddress: '10.9.8.7' });
  const keep = (list: string[]) => portalState().change((d) => void (d.mail.recipients = list));
  const kept = () => portalState().read().mail.recipients;
  const savedLog = () => lines.filter((l) => l.event === 'report_recipients_deleted');
  const turnScheduleOn = () =>
    portalState().change((d) => {
      d.mail.schedule = { enabled: true, day: 1, time: '00:00', formats: ['pdf'], style: { decimal: 'dot', date: 'long', separator: 'comma' }, notify: [], enabledAt: 1, setBy: 'a1', setAt: 1 };
    });

  it('empties the saved list and answers with the list that applies now, which is the one MAIL_TO started with', async () => {
    await keep(['carla@example.org', 'dewi@example.org']);
    const res = await remove();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ recipients: SEED, removed: 2 });
    expect(kept()).toEqual([]);
  });

  it('answers with nobody when MAIL_TO started with nobody, and removed 0 for a list that was already empty', async () => {
    config.mail.to = [];
    const res = await remove();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ recipients: [], removed: 0 });
  });

  it('is for administrators only, and changes nothing for anyone else', async () => {
    await keep(['carla@example.org']);
    expect((await remove(bearer('ana', 'viewer'))).statusCode).toBe(403);
    expect((await remove(bearer('olu', 'operator'))).statusCode).toBe(403);
    expect((await remove({})).statusCode).toBe(401);
    expect(kept()).toEqual(['carla@example.org']);
  });

  it('wants the CSRF header on the portal’s own cookie, and takes the request with it', async () => {
    await keep(['carla@example.org']);
    const page = { host: '127.0.0.1:8081', origin: 'http://127.0.0.1:8081', cookie: `hcml_session=${tokenFor(freshAdmin(), 'admin')}` };
    const without = await remove(page);
    expect(without.statusCode).toBe(403);
    expect(without.json()).toMatchObject({ error: 'csrf' });
    expect(kept()).toEqual(['carla@example.org']);
    expect((await remove({ ...page, 'x-hcml-csrf': '1' })).statusCode).toBe(200);
    expect(kept()).toEqual([]);
  });

  it('writes one log line with who, from where and how many, and never an address', async () => {
    await keep(['carla@example.org', 'dewi@example.org', 'eko@example.org']);
    await remove(bearer('a4'));
    expect(savedLog()).toEqual([expect.objectContaining({ user: 'a4', ip: '10.9.8.7', removed: 3 })]);
    expect(JSON.stringify(lines)).not.toMatch(/carla@|dewi@|eko@/);
  });

  it('is refused, with the list kept, while the monthly schedule is on and nothing else says who gets the report', async () => {
    config.mail.to = [];
    await keep(['carla@example.org']);
    await turnScheduleOn();
    const res = await remove();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'schedule_uses_list' });
    expect(res.json().message).toMatch(/schedule/i);
    expect(kept()).toEqual(['carla@example.org']);
    expect(savedLog()).toEqual([]);
  });

  it('cannot be raced: a schedule change already waiting in the queue is applied before the question is asked (reviewer, 11 November)', async () => {
    config.mail.to = [];
    await keep(['carla@example.org']);
    const store = portalState();
    const queued: (() => void)[] = [];
    let asked = 0;
    // A store whose changes wait for a signal, so that the two requests meet in the queue in the order the race needs.
    usePortalState({
      ...store,
      change: (edit) => {
        asked++;
        return new Promise<void>((resolve, reject) => queued.push(() => store.change(edit).then(resolve, reject)));
      },
    });
    const turningOn = turnScheduleOn();
    const deleting = remove();
    await vi.waitFor(() => expect(asked).toBe(2));
    for (const go of queued) go();
    const res = await deleting;
    await turningOn;
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'schedule_uses_list' });
    expect(store.read().mail.recipients).toEqual(['carla@example.org']);
    expect(store.read().mail.schedule?.enabled).toBe(true);
  });

  it('is allowed while the schedule is on when MAIL_TO can take over', async () => {
    await keep(['carla@example.org']);
    await turnScheduleOn();
    expect((await remove()).statusCode).toBe(200);
    expect(kept()).toEqual([]);
  });

  it('is allowed while the schedule is off', async () => {
    config.mail.to = [];
    await keep(['carla@example.org']);
    await portalState().change((d) => {
      d.mail.schedule = { enabled: false, day: 1, time: '00:00', formats: ['pdf'], style: { decimal: 'dot', date: 'long', separator: 'comma' }, notify: [], enabledAt: 1, setBy: 'a1', setAt: 1 };
    });
    expect((await remove()).statusCode).toBe(200);
  });

  it('says so in a plain sentence, and keeps the list, when the folder cannot be written', async () => {
    await keep(['carla@example.org']);
    const real = portalState();
    usePortalState({ ...real, change: async () => { throw new StateWriteError('EACCES'); }, read: () => real.read() });
    const res = await remove();
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('state_error');
    expect(res.body).not.toContain('EACCES');
    usePortalState(real);
    expect(kept()).toEqual(['carla@example.org']);
  });
});

describe('replacing the saved list (FR-31)', () => {
  const replace = (recipients: unknown, headers: Record<string, string> = bearer(freshAdmin()), body: object = { recipients: recipients as string[] }) =>
    app.inject({ method: 'PUT', url: '/api/sli/recipients', headers, payload: body, remoteAddress: '10.9.8.7' });
  const kept = () => portalState().read().mail.recipients;
  const savedLog = () => lines.filter((l) => l.event === 'report_recipients_saved');

  it('saves the list as given and answers with it', async () => {
    const res = await replace(['carla@example.org', 'dewi@example.org']);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ recipients: ['carla@example.org', 'dewi@example.org'], saved: 2 });
    expect(kept()).toEqual(['carla@example.org', 'dewi@example.org']);
  });

  it('trims each address and drops a repeat of any case, as every list does', async () => {
    const res = await replace(['  carla@example.org ', 'CARLA@example.org', '', 'dewi@example.org']);
    expect(res.json()).toEqual({ recipients: ['carla@example.org', 'dewi@example.org'], saved: 2 });
  });

  it.each([
    ['an address that is not plain', ['carla@example.org', 'not an address'], /not a plain address/],
    ['more than the most', Array.from({ length: 11 }, (_, i) => `p${i}@example.org`), /at most 10 addresses/],
    ['no address at all, which is what Delete the saved list is for', [], /add at least one address/],
  ])('refuses %s, and keeps the list it had', async (_why, list, words) => {
    await portalState().change((d) => void (d.mail.recipients = ['old@example.org']));
    const res = await replace(list);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(words);
    expect(kept()).toEqual(['old@example.org']);
  });

  it('refuses an address outside the domains the portal may send to', async () => {
    config.mail.allowedDomains = ['example.org'];
    const res = await replace(['spy@elsewhere.net']);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/outside the domains this portal may send to \(example\.org\)/);
    expect(kept()).toEqual([]);
  });

  it.each([
    ['a body with no list', {}],
    ['a list that is not a list', { recipients: 'carla@example.org' }],
    ['a field it does not take', { recipients: ['carla@example.org'], enabled: true }],
  ])('refuses %s', async (_why, body) => {
    const res = await replace(undefined, bearer(freshAdmin()), body);
    expect(res.statusCode).toBe(400);
    expect(kept()).toEqual([]);
  });

  it('is for administrators only, and changes nothing for anyone else', async () => {
    expect((await replace(['carla@example.org'], bearer('ana', 'viewer'))).statusCode).toBe(403);
    expect((await replace(['carla@example.org'], bearer('olu', 'operator'))).statusCode).toBe(403);
    expect((await replace(['carla@example.org'], {})).statusCode).toBe(401);
    expect(kept()).toEqual([]);
  });

  it('wants the CSRF header on the portal’s own cookie', async () => {
    const page = { host: '127.0.0.1:8081', origin: 'http://127.0.0.1:8081', cookie: `hcml_session=${tokenFor(freshAdmin(), 'admin')}` };
    const without = await replace(['carla@example.org'], page);
    expect(without.statusCode).toBe(403);
    expect(without.json()).toMatchObject({ error: 'csrf' });
    expect((await replace(['carla@example.org'], { ...page, 'x-hcml-csrf': '1' })).statusCode).toBe(200);
  });

  it('writes one log line with who, from where and how many, and never an address', async () => {
    await replace(['carla@example.org', 'dewi@example.org'], bearer('a3'));
    expect(savedLog()).toEqual([expect.objectContaining({ user: 'a3', ip: '10.9.8.7', saved: 2 })]);
    expect(JSON.stringify(lines)).not.toMatch(/carla@|dewi@/);
  });
});

describe('the API description', () => {
  type Shape = { required: string[]; properties: Record<string, unknown> };
  const spec = JSON.parse(readFileSync(fileURLToPath(new URL('../../../web/src/generated/openapi.json', import.meta.url)), 'utf8')) as {
    paths: Record<string, Record<string, { responses: Record<string, { content?: { 'application/json': { schema: Shape } } }> }>>;
  };
  const shapeOf = (method: 'get' | 'post') => spec.paths['/api/sli/email']![method]!.responses['200']!.content!['application/json']!.schema;

  it('names the fields the answer to a send has, and no others', async () => {
    const body = (await send(ok)).json() as object;
    expect(Object.keys(body).sort()).toEqual([...shapeOf('post').required].sort());
    expect(Object.keys(body).sort()).toEqual(Object.keys(shapeOf('post').properties).sort());
  });

  it('names the fields the answer to the screen\u2019s question has, on and off', async () => {
    for (const settings of [configured, resolveMail({})]) {
      Object.assign(config.mail, settings);
      const body = (await app.inject({ url: '/api/sli/email', headers: bearer(freshAdmin()) })).json() as object;
      expect(Object.keys(body).sort()).toEqual([...shapeOf('get').required].sort());
    }
  });
});

describe('what each failure is told', () => {
  it.each([
    ['login', /refused the login/],
    ['connect', /could not reach/],
    ['timeout', /did not answer in time, so the report may or may not have gone\. Look under Last sends/],
    ['tls', /secure connection/],
    ['recipients', /refused the sender or every recipient/],
    ['rejected', /did not accept the message/],
    ['other', /could not be sent/],
  ] as const)('%s: a 502 with its own sentence, and the server’s words only in the log', async (kind, words) => {
    mailer.send.mockRejectedValue(new MailError(kind, '550 5.1.1 hidden-detail@example.net'));
    const res = await send(ok);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'mail_error' });
    expect(res.json().message).toMatch(words);
    expect(res.body).not.toContain('hidden-detail');
    expect(JSON.stringify(lines)).toContain('hidden-detail');
  });

  it('a failure while reading Zabbix sends nothing and is not called a mail failure', async () => {
    reads.get.mockRejectedValue(new Error('boom'));
    const res = await send(ok);
    expect(res.statusCode).toBe(500);
    expect(mailer.send).not.toHaveBeenCalled();
    expect(emails()[0]).toMatchObject({ outcome: 'failed', reason: 'error' });
  });
});

describe('the log line', () => {
  it('says who sent which report to how many people, and how large it was', async () => {
    const res = await send(ok, bearer('a14'), '10.9.8.7');
    expect(res.statusCode).toBe(200);
    expect(emails()).toHaveLength(1);
    const size = mailer.send.mock.calls[0][0].attachments[0].content.length;
    expect(emails()[0]).toMatchObject({
      event: 'report_email',
      trigger: 'manual',
      user: 'a14',
      ip: '10.9.8.7',
      report: 'sla',
      month: '2026-08',
      formats: ['pdf'],
      bytes: size,
      recipients: 2,
      domains: ['example.org'],
      refused: 0,
      outcome: 'sent',
      msg: 'report email sent',
    });
  });

  it('records a failure with its kind, at a level that gets noticed', async () => {
    mailer.send.mockRejectedValue(new MailError('recipients', '550'));
    await send(ok);
    expect(emails()).toHaveLength(1);
    expect(emails()[0]).toMatchObject({ outcome: 'failed', reason: 'recipients', recipients: 0, msg: 'report email failed', level: 40 });
  });

  it('holds no address, no subject, no body, no password and no file', async () => {
    await send(ok);
    const line = JSON.stringify(emails());
    for (const secret of ['ana@', 'budi@', '@example.org"', 'portal.reports@example.com', 'not-a-real-password', 'HCML SLA availability', '%PDF']) {
      expect(line).not.toContain(secret);
    }
  });

  it('writes nothing for a request that was refused', async () => {
    await send({ month: 'nope', formats: ['pdf'] });
    await send(ok, bearer('ana', 'viewer'));
    expect(emails()).toEqual([]);
  });
});

describe('how often one person may send', () => {
  it(`allows ${SENDS_PER_HOUR} an hour, then says 429 with the wait, and sends nothing more`, async () => {
    const headers = bearer('a13');
    for (let i = 0; i < SENDS_PER_HOUR; i++) expect((await send(ok, headers)).statusCode, `send ${i + 1}`).toBe(200);
    const res = await send(ok, headers);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(3500);
    expect(res.json()).toMatchObject({ error: 'rate_limited' });
    expect(res.json().message).toMatch(new RegExp(`${SENDS_PER_HOUR} .* an hour`));
    expect(mailer.send).toHaveBeenCalledTimes(SENDS_PER_HOUR);
  });

  it('counts a person on their own: another administrator still sends', async () => {
    for (let i = 0; i <= SENDS_PER_HOUR; i++) await send(ok, bearer('a16'));
    expect((await send(ok, bearer('a15'))).statusCode).toBe(200);
  });

  it('does not count a request that was refused for its form, or while email is off', async () => {
    const headers = bearer('a12');
    for (let i = 0; i < 3; i++) await send({ month: 'nope', formats: ['pdf'] }, headers);
    Object.assign(config.mail, resolveMail({}));
    for (let i = 0; i < 3; i++) await send(ok, headers);
    Object.assign(config.mail, configured);
    for (let i = 0; i < SENDS_PER_HOUR; i++) expect((await send(ok, headers)).statusCode, `send ${i + 1}`).toBe(200);
  });

  it('counts an attempt the mail server turned down: the account was used all the same', async () => {
    mailer.send.mockRejectedValue(new MailError('rejected', '554'));
    const headers = bearer('a11');
    for (let i = 0; i < SENDS_PER_HOUR; i++) await send(ok, headers);
    mailer.send.mockResolvedValue({ accepted: 2, refused: 0 });
    expect((await send(ok, headers)).statusCode).toBe(429);
  });
});

describe('a month nobody can report', () => {
  it.each(['2099-01', '2015-01'])('refuses %s with a 400 before the mail login, the reports and the allowance', async (month) => {
    const res = await send({ month, formats: ['pdf'] });
    expect(res.statusCode).toBe(400);
    expect(mailer.verify).not.toHaveBeenCalled();
    expect(reads.get).not.toHaveBeenCalled();
    expect(portalState().read().mail.sends).toEqual([]);
    expect(emails()).toEqual([]);
  });

  it('does not use up the allowance', async () => {
    const admin = bearer('a17');
    for (let i = 0; i < SENDS_PER_HOUR + 2; i++) {
      expect((await send({ month: '2099-01', formats: ['pdf'] }, admin)).statusCode).toBe(400);
    }
    expect((await send(ok, admin)).statusCode).toBe(200);
  });
});

describe('a send that some addresses refused', () => {
  it('is logged at warning level, with the numbers', async () => {
    mailer.send.mockResolvedValue({ accepted: 1, refused: 1 });
    const res = await send(ok);
    expect(res.statusCode).toBe(200);
    expect(emails()).toHaveLength(1);
    expect(emails()[0]).toMatchObject({ level: 40, outcome: 'sent', recipients: 1, refused: 1 });
  });

  it('is logged at information level when every address took it', async () => {
    await send(ok);
    expect(emails()[0]).toMatchObject({ level: 30, outcome: 'sent', refused: 0 });
  });
});

describe('a report with no device in it (BK-51)', () => {
  const emptied = (r: typeof strict) => ({ ...r, hosts: [], overall: { ...r.overall, hosts: 0, withData: 0 } });

  it('is not mailed: the answer says why, and nothing goes out', async () => {
    reads.get.mockImplementation(async (_m: string, profile: string) => emptied(profile === 'hcml-report' ? hcml : strict));
    const res = await send(ok);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'empty_report' });
    expect(res.json().message).toMatch(/no device/i);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('is logged as a failed email with the reason empty, and no address', async () => {
    reads.get.mockImplementation(async (_m: string, profile: string) => emptied(profile === 'hcml-report' ? hcml : strict));
    await send(ok);
    expect(emails()[0]).toMatchObject({ outcome: 'failed', reason: 'empty' });
    expect(JSON.stringify(emails())).not.toMatch(/ana@|budi@/);
  });

  it('is still mailed when only one of the two profiles has no device', async () => {
    reads.get.mockImplementation(async (_m: string, profile: string) => (profile === 'hcml-report' ? emptied(hcml) : strict));
    expect((await send(ok)).statusCode).toBe(200);
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });
});

describe('the ten minutes after a month ends, at their edges (BK-54)', () => {
  const END = Date.parse('2026-08-31T17:00:00Z');
  const later = (seconds: number) => vi.setSystemTime(new Date(END + seconds * 1000));

  it.each([
    [0, 'about 10 minutes'],
    [1, 'about 10 minutes'],
    [540, 'about 1 minute'],
    [599, 'about 1 minute'],
  ])('refuses %i seconds after the end, and says %s', async (seconds, words) => {
    later(seconds);
    const res = await send({ month: '2026-08', formats: ['pdf'] });
    expect(res.statusCode).toBe(400);
    // 'about 1 minute' is also the start of 'about 1 minutes', so the end of the word is pinned too.
    expect(res.json().message).toMatch(new RegExp(`${words}(?!s)`));
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('allows the send exactly ten minutes after the end, the second the closed month is read for good', async () => {
    later(600);
    expect((await send({ month: '2026-08', formats: ['pdf'] })).statusCode).toBe(200);
  });

  it('never delays the month before the one that just ended', async () => {
    later(1);
    expect((await send({ month: '2026-07', formats: ['pdf'] })).statusCode).toBe(200);
  });
});
