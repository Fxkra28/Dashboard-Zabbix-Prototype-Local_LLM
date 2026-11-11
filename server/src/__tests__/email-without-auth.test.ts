import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { AJV_OPTIONS } from '../core/schemas.js';
import { memoryState } from '../core/state.js';

/**
 * Email and the monthly schedule while sign-in is off (SC-43). With no sign-in, anyone who reaches the portal counts as
 * an administrator and could send the report to any address, so both are refused as acknowledge and close are, unless
 * ALLOW_EMAIL_WITHOUT_AUTH=true says that is meant. Every address and password is made up.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'false';
  process.env.ALLOW_EMAIL_WITHOUT_AUTH = '';
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

const { config, mailNow, emailRefusal } = await import('../core/config.js');
const { setupAuth } = await import('../security/auth.js');
const { registerErrorHandler } = await import('../http/errors.js');
const { sliMailRoutes } = await import('../routes/sliMail.js');
const { sliScheduleRoutes } = await import('../routes/sliSchedule.js');
const { sendNotice, emailReport } = await import('../services/sliMail.js');
const { MailDisabledError } = await import('../clients/mail.js');
const { createReportSchedule } = await import('../services/reportSchedule.js');
const { portalState, usePortalState } = await import('../services/portalState.js');

const WHY = /sign-in is off/i;
let app: FastifyInstance;

beforeEach(async () => {
  config.auth.enabled = false;
  config.auth.allowEmailWithoutAuth = false;
  usePortalState(memoryState());
  mailer.verify.mockReset().mockResolvedValue(undefined);
  mailer.send.mockReset().mockResolvedValue({ accepted: 2, refused: 0 });
  app = Fastify({ ajv: AJV_OPTIONS, logger: false });
  registerErrorHandler(app);
  await setupAuth(app);
  await app.register(sliMailRoutes);
  await app.register(sliScheduleRoutes, { schedule: { availability: () => ({ available: true, why: '' }), next: () => null, problem: () => '' } });
  await app.ready();
});
afterEach(async () => {
  config.auth.enabled = true;
  config.auth.allowEmailWithoutAuth = false;
  await app.close();
});

const post = () => app.inject({ method: 'POST', url: '/api/sli/email', payload: { month: '2026-08', formats: ['pdf'] } });

describe('the settings as they apply now', () => {
  it('are set up, and refused for want of sign-in, with the reason in words', () => {
    expect(config.mail.enabled).toBe(true);
    expect(mailNow().enabled).toBe(false);
    expect(mailNow().off).toMatch(WHY);
    expect(mailNow().off).toContain('ALLOW_EMAIL_WITHOUT_AUTH=true');
    expect(emailRefusal()).toBe(mailNow().off);
  });

  it('are on with the opt-in, and say nothing', () => {
    config.auth.allowEmailWithoutAuth = true;
    expect(mailNow()).toMatchObject({ enabled: true, off: '' });
    expect(emailRefusal()).toBe('');
  });

  it('are on with sign-in on, whatever the opt-in', () => {
    config.auth.enabled = true;
    expect(mailNow()).toMatchObject({ enabled: true, off: '' });
  });

  it('stay off, with no refusal to explain, when email is not set up at all', () => {
    const saved = config.mail.enabled;
    config.mail.enabled = false;
    try {
      expect(mailNow()).toMatchObject({ enabled: false, off: '' });
    } finally {
      config.mail.enabled = saved;
    }
  });
});

describe('the schedule page with sign-in off (reviewer, 11 November)', () => {
  const keepPeople = () =>
    portalState().change((d) => {
      d.mail.recipients = ['carla@example.org'];
      d.mail.schedule = { enabled: true, day: 1, time: '00:00', formats: ['pdf'], style: { decimal: 'dot', date: 'long', separator: 'comma' }, notify: ['boss@example.org'], enabledAt: 1, setBy: 'a1', setAt: 1 };
    });

  it('says why and shows none of what the portal keeps, as the email page shows nothing', async () => {
    await keepPeople();
    const res = await app.inject({ method: 'GET', url: '/api/sli/schedule' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: false, schedule: null, recipients: [], next: null, sends: [], allowedDomains: [] });
    expect(res.json().why).toMatch(WHY);
    expect(res.body).not.toMatch(/carla|boss|a1/);
  });

  it('shows it all again with the opt-in', async () => {
    await keepPeople();
    config.auth.allowEmailWithoutAuth = true;
    const res = await app.inject({ method: 'GET', url: '/api/sli/schedule' });
    expect(res.json()).toMatchObject({ available: true, recipients: ['carla@example.org'], schedule: { enabled: true, notify: ['boss@example.org'] } });
  });
});

describe('the email routes with sign-in off', () => {
  it('tell the page that email is off, so the button is not offered', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sli/email' });
    expect(res.json()).toMatchObject({ enabled: false, recipients: [] });
  });

  it('refuse a send with a sentence that names the reason, and read and send nothing', async () => {
    const res = await post();
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('mail_disabled');
    expect(res.json().message).toMatch(WHY);
    expect(mailer.verify).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('refuse before the hour’s allowance is counted, so a refused request costs nothing', async () => {
    for (let i = 0; i < 8; i++) expect((await post()).statusCode, `request ${i + 1}`).toBe(503);
  });

  it('refuse to delete the saved list too, since every caller would be an administrator', async () => {
    await portalState().change((d) => void (d.mail.recipients = ['carla@example.org']));
    const res = await app.inject({ method: 'DELETE', url: '/api/sli/recipients' });
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toMatch(WHY);
    config.auth.allowEmailWithoutAuth = true;
    expect((await app.inject({ method: 'DELETE', url: '/api/sli/recipients' })).statusCode).toBe(200);
  });

  it('refuse to replace the saved list too', async () => {
    const put = () => app.inject({ method: 'PUT', url: '/api/sli/recipients', payload: { recipients: ['carla@example.org'] } });
    const res = await put();
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toMatch(WHY);
    expect(portalState().read().mail.recipients).toEqual([]);
    config.auth.allowEmailWithoutAuth = true;
    expect((await put()).statusCode).toBe(200);
  });

  it('offer the button again with the opt-in', async () => {
    config.auth.allowEmailWithoutAuth = true;
    const res = await app.inject({ method: 'GET', url: '/api/sli/email' });
    expect(res.json()).toMatchObject({ enabled: true, from: 'portal.reports@example.com' });
  });
});

describe('the senders with sign-in off', () => {
  it('send no notice and no report', async () => {
    await expect(sendNotice(['ana@example.org'], 'subject', 'text')).rejects.toBeInstanceOf(MailDisabledError);
    await expect(emailReport({ month: '2026-08', formats: ['pdf'], to: ['ana@example.org'], sentBy: 'x' })).rejects.toBeInstanceOf(MailDisabledError);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('carry the reason in the error a person reads', async () => {
    await expect(sendNotice(['ana@example.org'], 's', 't')).rejects.toThrow(WHY);
  });
});

describe('the monthly schedule with sign-in off', () => {
  const schedule = () =>
    createReportSchedule({
      now: () => Math.floor(Date.now() / 1000),
      state: () => memoryState(),
      settings: mailNow,
      send: async () => {
        throw new Error('must not send');
      },
      notice: async () => undefined,
      timezone: 'Asia/Jakarta',
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });

  it('is not available, and says why in the reason it gives the page', () => {
    const { available, why } = schedule().availability();
    expect(available).toBe(false);
    expect(why).toMatch(WHY);
    expect(why).toContain('ALLOW_EMAIL_WITHOUT_AUTH=true');
  });

  it('is not turned away for want of sign-in once the opt-in is given', () => {
    config.auth.allowEmailWithoutAuth = true;
    expect(schedule().availability().why).not.toMatch(WHY);
  });
});
