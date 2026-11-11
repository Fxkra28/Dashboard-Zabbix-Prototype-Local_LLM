import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { AJV_OPTIONS } from '../core/schemas.js';
import { memoryState, openState, StateWriteError, type SendRecord, type StateStore } from '../core/state.js';

/**
 * GET and PUT /api/sli/schedule: who may change the monthly send, what is checked before it is saved, what is saved, and
 * what the page is told. The scheduler itself has its own tests; here it is a stand-in that answers what it was told.
 * Every address is made up.
 */
vi.hoisted(() => {
  const admins = Array.from({ length: 4 }, (_, i) => `a${i + 1}:admin-pass:admin`).join(',');
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = `ana:viewer-pass:viewer,olu:operator-pass:operator,${admins}`;
  process.env.MAIL_PROVIDER = 'gmail';
  process.env.MAIL_USER = 'portal.reports@example.com';
  process.env.MAIL_PASS = 'not-a-real-password';
  process.env.MAIL_TO = 'ana@example.org, budi@example.org';
});

const { config } = await import('../core/config.js');
const { setupAuth, tokenClaims } = await import('../security/auth.js');
const { registerErrorHandler } = await import('../http/errors.js');
const { sliScheduleRoutes } = await import('../routes/sliSchedule.js');
const { usePortalState, portalState } = await import('../services/portalState.js');

const NOW = new Date('2026-11-04T05:00:00Z');
const NOW_S = NOW.getTime() / 1000;
type Line = Record<string, unknown> & { msg: string };

let app: FastifyInstance;
let dir: string;
let lines: Line[];
let availability: { available: boolean; why: string };
let next: { month: string; at: number; retrying: boolean } | null;
let problem: string;
const configured = { ...config.mail };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  dir = mkdtempSync(join(tmpdir(), 'schedule-route-'));
  usePortalState(await openState(dir, () => undefined));
  Object.assign(config.mail, configured);
  availability = { available: true, why: '' };
  next = null;
  problem = '';
  lines = [];
  app = Fastify({ ajv: AJV_OPTIONS, logger: { level: 'info', stream: { write: (chunk: string) => void lines.push(JSON.parse(chunk) as Line) } } });
  registerErrorHandler(app);
  await setupAuth(app);
  await app.register(sliScheduleRoutes, { schedule: { availability: () => availability, next: () => next, problem: () => problem } });
  await app.ready();
});
afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const tokenFor = (sub: string, role: string) => app.jwt.sign({ sub, role, ...tokenClaims('hcml_session') }, { expiresIn: '1h' });
const bearer = (sub = 'a1', role = 'admin') => ({ authorization: `Bearer ${tokenFor(sub, role)}` });
const get = (headers: Record<string, string> = bearer()) => app.inject({ method: 'GET', url: '/api/sli/schedule', headers });
const put = (payload: unknown, headers: Record<string, string> = bearer()) =>
  app.inject({ method: 'PUT', url: '/api/sli/schedule', headers, payload: payload as object });

const good = {
  enabled: true,
  day: 1,
  time: '00:00',
  formats: ['pdf'],
  recipients: ['ana@example.org', 'budi@example.org'],
  notify: ['boss@example.org'],
};
const saved = () => portalState().read().mail;
const changes = () => lines.filter((l) => l.event === 'report_schedule_changed');
const send = (over: Partial<SendRecord> = {}): SendRecord => ({
  month: '2026-10',
  trigger: 'schedule',
  by: 'schedule',
  at: NOW_S,
  outcome: 'sent',
  attempts: 1,
  formats: ['pdf'],
  recipients: 2,
  refused: 0,
  bytes: 1000,
  ...over,
});

describe('who may ask', () => {
  it.each([
    ['a viewer', 'ana', 'viewer'],
    ['an operator', 'olu', 'operator'],
  ])('refuses %s to read and to change the schedule', async (_who, sub, role) => {
    expect((await get(bearer(sub, role))).statusCode).toBe(403);
    expect((await put(good, bearer(sub, role))).statusCode).toBe(403);
    expect(saved().schedule).toBeNull();
  });

  it('refuses a request with no sign-in', async () => {
    expect((await get({})).statusCode).toBe(401);
    expect((await put(good, {})).statusCode).toBe(401);
  });

  it('wants the CSRF header on the portal’s own cookie to change it, and not to read it', async () => {
    const page = { host: '127.0.0.1:8081', origin: 'http://127.0.0.1:8081', cookie: `hcml_session=${tokenFor('a1', 'admin')}` };
    expect((await get(page)).statusCode).toBe(200);
    const without = await put(good, page);
    expect(without.statusCode).toBe(403);
    expect(without.json()).toMatchObject({ error: 'csrf' });
    expect(saved().schedule).toBeNull();
    expect((await put(good, { ...page, 'x-hcml-csrf': '1' })).statusCode).toBe(200);
  });
});

describe('what the page is told', () => {
  it('describes a portal with no schedule yet: the saved recipients, nothing set, nothing sent, what a list may hold', async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      available: true,
      why: '',
      timezone: 'Asia/Jakarta',
      schedule: null,
      recipients: ['ana@example.org', 'budi@example.org'],
      next: null,
      sends: [],
      max: 10,
      maxNotify: 3,
      allowedDomains: [],
    });
  });

  it('says it cannot be used, and why, with the reason the scheduler gives', async () => {
    availability = { available: false, why: 'The portal has no data folder to keep a schedule in.' };
    const body = (await get()).json();
    expect(body).toMatchObject({ available: false, why: 'The portal has no data folder to keep a schedule in.' });
  });

  it('shows the schedule that is saved, without the fields that are the scheduler’s own', async () => {
    await put(good);
    const { schedule } = (await get()).json();
    expect(schedule).toEqual({
      enabled: true,
      day: 1,
      time: '00:00',
      formats: ['pdf'],
      style: { decimal: 'dot', date: 'long', separator: 'comma' },
      notify: ['boss@example.org'],
      setBy: 'a1',
      setAt: NOW_S,
    });
  });

  it('says it cannot be used, and why, when the scheduler finds its state folder cannot be written, and names no next send', async () => {
    next = { month: '2026-10', at: NOW_S + 60, retrying: false };
    problem = 'The portal could not write its data folder at its last try.';
    const body = (await get()).json();
    expect(body).toMatchObject({ available: false, why: 'The portal could not write its data folder at its last try.', next: null });
  });

  it('gives the reason the scheduler gives for being off before it says anything about the folder', async () => {
    availability = { available: false, why: 'Email is not set up.' };
    problem = 'The portal could not write its data folder at its last try.';
    expect((await get()).json()).toMatchObject({ available: false, why: 'Email is not set up.' });
  });

  it('names no next send where the schedule cannot run, though the scheduler has one in mind', async () => {
    availability = { available: false, why: 'x' };
    next = { month: '2026-10', at: NOW_S + 3600, retrying: false };
    expect((await get()).json().next).toBeNull();
  });

  it('names the next send as the scheduler says', async () => {
    next = { month: '2026-10', at: NOW_S + 3600, retrying: false };
    expect((await get()).json().next).toEqual({ month: '2026-10', at: NOW_S + 3600, retrying: false });
  });

  it('lists what was sent, newest first, twelve at most, with counts and no address or internal field', async () => {
    await portalState().change((d) => {
      for (let i = 0; i < 15; i++) d.mail.sends.push(send({ month: `2025-${String((i % 12) + 1).padStart(2, '0')}`, at: NOW_S + i, attempts: i + 1, nextAt: NOW_S + 99, noticed: 1, reason: i === 14 ? 'login' : undefined }));
    });
    const { sends } = (await get()).json();
    expect(sends).toHaveLength(12);
    expect(sends[0].attempts).toBe(15);
    expect(sends[11].attempts).toBe(4);
    expect(Object.keys(sends[0]).sort()).toEqual(['at', 'attempts', 'by', 'bytes', 'formats', 'month', 'outcome', 'reason', 'recipients', 'refused', 'trigger']);
    expect(Object.keys(sends[1]).sort()).toEqual(['at', 'attempts', 'by', 'bytes', 'formats', 'month', 'outcome', 'recipients', 'refused', 'trigger']);
    expect(JSON.stringify(sends)).not.toMatch(/@|nextAt|noticed/);
  });

  it('names the domains a report may go to', async () => {
    Object.assign(config.mail, { allowedDomains: ['example.org'] });
    expect((await get()).json().allowedDomains).toEqual(['example.org']);
  });

  it('answers with the saved list from MAIL_TO until the portal has one of its own, then with that', async () => {
    await portalState().change((d) => void (d.mail.recipients = ['cici@example.org']));
    expect((await get()).json().recipients).toEqual(['cici@example.org']);
  });
});

describe('saving a schedule', () => {
  it('keeps it, with who set it and when, and answers with what the page would be told', async () => {
    const res = await put({ ...good, day: 5, time: '08:30', formats: ['csv', 'pdf'], style: { decimal: 'comma', date: 'iso', separator: 'semicolon' } }, bearer('a2'));
    expect(res.statusCode).toBe(200);
    expect(saved().schedule).toEqual({
      enabled: true,
      day: 5,
      time: '08:30',
      formats: ['pdf', 'csv'],
      style: { decimal: 'comma', date: 'iso', separator: 'semicolon' },
      notify: ['boss@example.org'],
      enabledAt: NOW_S,
      setBy: 'a2',
      setAt: NOW_S,
    });
    expect(res.json().schedule).toMatchObject({ day: 5, time: '08:30', formats: ['pdf', 'csv'], setBy: 'a2' });
    expect(res.json()).toMatchObject({ available: true, recipients: good.recipients });
  });

  it('saves the recipients as the list the portal uses, for the schedule and for the button alike', async () => {
    await put({ ...good, recipients: ['cici@example.org', 'dedi@example.org'] });
    expect(saved().recipients).toEqual(['cici@example.org', 'dedi@example.org']);
  });

  it('takes the default style when none is given', async () => {
    await put(good);
    expect(saved().schedule!.style).toEqual({ decimal: 'dot', date: 'long', separator: 'comma' });
  });

  it('lists the formats once, in their order, and the recipients once, as typed', async () => {
    await put({ ...good, formats: ['csv', 'pdf', 'csv'].slice(0, 3), recipients: ['Ana@Example.org', 'ana@example.org', ' budi@example.org'] });
    expect(saved().schedule!.formats).toEqual(['pdf', 'csv']);
    expect(saved().recipients).toEqual(['Ana@Example.org', 'budi@example.org']);
  });

  describe('the moment it starts to count', () => {
    const at = async (state: StateStore, over: object, later: number) => {
      vi.setSystemTime(new Date(NOW.getTime() + later * 1000));
      await put({ ...good, ...over });
      return state.read().mail.schedule!.enabledAt;
    };

    it('is when it is turned on', async () => {
      expect(await at(portalState(), {}, 0)).toBe(NOW_S);
    });

    it('stays when only the files, the people or the style change', async () => {
      await at(portalState(), {}, 0);
      expect(await at(portalState(), { formats: ['pdf', 'xlsx'] }, 600)).toBe(NOW_S);
      expect(await at(portalState(), { recipients: ['cici@example.org'] }, 1200)).toBe(NOW_S);
      expect(await at(portalState(), { notify: [] }, 1800)).toBe(NOW_S);
      expect(await at(portalState(), { style: { decimal: 'comma' } }, 2400)).toBe(NOW_S);
    });

    it('starts again when the day changes, or the time of day', async () => {
      await at(portalState(), {}, 0);
      expect(await at(portalState(), { day: 2 }, 600)).toBe(NOW_S + 600);
      expect(await at(portalState(), { day: 2, time: '01:00' }, 1200)).toBe(NOW_S + 1200);
    });

    it('starts again when it is turned off and on', async () => {
      await at(portalState(), {}, 0);
      expect(await at(portalState(), { enabled: false }, 600)).toBe(NOW_S);
      expect(await at(portalState(), { enabled: true }, 1200)).toBe(NOW_S + 1200);
    });

    it('is the moment of saving, when a schedule is saved turned off for the first time', async () => {
      expect(await at(portalState(), { enabled: false, recipients: [] }, 0)).toBe(NOW_S);
    });
  });

  describe('a month that is still being tried', () => {
    const trying = () => send({ outcome: 'sending', attempts: 2, reason: 'connect', nextAt: NOW_S + 900 });
    const seed = async (...records: SendRecord[]) => {
      await put(good);
      await portalState().change((d) => void d.mail.sends.push(...records));
    };

    it.each([
      ['the day changes', { day: 3 }],
      ['the time of day changes', { time: '00:20' }],
      ['it is turned off', { enabled: false }],
    ])('is given up on, in its record, when %s: the new slot would never send it', async (_what, over) => {
      await seed(trying());
      await put({ ...good, ...over });
      const [record] = saved().sends;
      expect(record).toMatchObject({ month: '2026-10', trigger: 'schedule', outcome: 'failed', reason: 'changed', attempts: 2 });
      expect(record!.nextAt).toBeUndefined();
    });

    it('is left to go on when only the files, the people, the style or the people to tell change', async () => {
      await seed(trying());
      await put({ ...good, formats: ['pdf', 'xlsx'], recipients: ['cici@example.org'], notify: [], style: { decimal: 'comma' } });
      expect(saved().sends[0]).toMatchObject({ outcome: 'sending', reason: 'connect', nextAt: NOW_S + 900 });
    });

    it('leaves a month that went, and a send by hand, as they were', async () => {
      await seed(send({ month: '2026-09' }), send({ trigger: 'manual', by: 'ana', outcome: 'sent' }), send({ trigger: 'manual', by: 'ana', outcome: 'sending' }), trying());
      await put({ ...good, day: 3 });
      expect(saved().sends.map((r) => r.outcome)).toEqual(['sent', 'sent', 'sending', 'failed']);
    });
  });

  it('may be saved turned off with nobody to send to, since nothing will be sent', async () => {
    const res = await put({ ...good, enabled: false, recipients: [] });
    expect(res.statusCode).toBe(200);
    expect(saved().schedule!.enabled).toBe(false);
  });

  it('keeps a list that was saved before when a schedule is saved turned off with none', async () => {
    await put(good);
    const res = await put({ ...good, enabled: false, recipients: [] });
    expect(res.statusCode).toBe(200);
    expect(saved().recipients).toEqual(good.recipients);
    expect(res.json().recipients).toEqual(good.recipients);
    expect(saved().schedule!.enabled).toBe(false);
  });

  it('replaces the saved list when a schedule is saved turned off with a list of its own', async () => {
    await put(good);
    await put({ ...good, enabled: false, recipients: ['carla@example.org'] });
    expect(saved().recipients).toEqual(['carla@example.org']);
  });

  it('still refuses a schedule that is turned on with no one to send to', async () => {
    await put(good);
    const res = await put({ ...good, enabled: true, recipients: [] });
    expect(res.statusCode).toBe(400);
    expect(saved().recipients).toEqual(good.recipients);
  });

  it('writes one line to the log: who, what was set, and how many people, never who', async () => {
    await put({ ...good, day: 3, time: '07:15', formats: ['pdf', 'xlsx'] }, bearer('a3'));
    expect(changes()).toHaveLength(1);
    expect(changes()[0]).toMatchObject({
      user: 'a3',
      enabled: true,
      day: 3,
      time: '07:15',
      formats: ['pdf', 'xlsx'],
      recipients: 2,
      domains: ['example.org'],
      notify: 1,
      msg: 'report schedule changed',
    });
    expect(JSON.stringify(changes())).not.toMatch(/ana@|budi@|boss@/);
  });
});

describe('what is checked before anything is saved', () => {
  it.each([
    ['no body', undefined],
    ['no switch', { ...good, enabled: undefined }],
    ['a switch that is not true or false', { ...good, enabled: 'yes' }],
    ['no day', { ...good, day: undefined }],
    ['a day of zero', { ...good, day: 0 }],
    ['a day past 28', { ...good, day: 29 }],
    ['a day that is not whole', { ...good, day: 1.5 }],
    ['a day that is text', { ...good, day: '1' }],
    ['no time', { ...good, time: undefined }],
    ['a time past midnight', { ...good, time: '24:00' }],
    ['a time with seconds', { ...good, time: '08:00:00' }],
    ['a time with no colon', { ...good, time: '0800' }],
    ['no formats', { ...good, formats: undefined }],
    ['an empty list of formats', { ...good, formats: [] }],
    ['a format it does not make', { ...good, formats: ['pdf', 'exe'] }],
    ['no recipients', { ...good, recipients: undefined }],
    ['recipients that are not a list', { ...good, recipients: 'ana@example.org' }],
    ['a recipient that is not plain', { ...good, recipients: ['ana@example.org', 'nope'] }],
    ['no recipient while the schedule is on', { ...good, recipients: [] }],
    ['more than ten recipients', { ...good, recipients: Array.from({ length: 11 }, (_, i) => `p${i}@example.org`) }],
    ['no one to tell', { ...good, notify: undefined }],
    ['more than three people to tell', { ...good, notify: ['a@example.org', 'b@example.org', 'c@example.org', 'd@example.org'] }],
    ['someone to tell who is not an address', { ...good, notify: ['nope'] }],
    ['a style value that is not a choice', { ...good, style: { separator: 'tab' } }],
    ['a style with a field of its own', { ...good, style: { colour: 'blue' } }],
    ['a field it does not take', { ...good, subject: 'hello' }],
    ['a copy', { ...good, cc: ['spy@example.net'] }],
  ])('refuses %s with a 400 and saves nothing', async (_what, body) => {
    const res = await put(body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad_request' });
    expect(saved().schedule).toBeNull();
    expect(saved().recipients).toEqual([]);
    expect(changes()).toEqual([]);
  });

  it('says in words what is wrong', async () => {
    expect((await put({ ...good, day: 29 })).json().message).toBe('day must be a whole number from 1 to 28.');
    expect((await put({ ...good, time: '8:00' })).json().message).toBe('time must be HH:MM, 24 hours, such as 00:00.');
    expect((await put({ ...good, recipients: [] })).json().message).toBe('Recipients: add at least one address.');
    expect((await put({ ...good, notify: ['a@example.org', 'b@example.org', 'c@example.org', 'd@example.org'] })).json().message).toBe('Failure notices: at most 3 addresses.');
    expect((await put({ ...good, formats: [] })).json().message).toBe('Choose at least one format.');
  });

  it('holds both lists to the domains a report may go to', async () => {
    Object.assign(config.mail, { allowedDomains: ['example.org'] });
    expect((await put({ ...good, recipients: ['ana@example.org', 'spy@elsewhere.net'] })).json().message).toMatch(/spy@elsewhere\.net is outside the domains/);
    expect((await put({ ...good, notify: ['spy@elsewhere.net'] })).json().message).toMatch(/Failure notices: spy@elsewhere\.net is outside the domains/);
    expect(saved().schedule).toBeNull();
    expect((await put(good)).statusCode).toBe(200);
  });

  it('refuses to save where the schedule cannot run, and says why, so no one is told a schedule exists that never will', async () => {
    availability = { available: false, why: 'The portal has no data folder to keep a schedule in.' };
    const res = await put(good);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'schedule_unavailable', message: 'The portal has no data folder to keep a schedule in.' });
    expect(saved().schedule).toBeNull();
  });
});

describe('a state that cannot be saved', () => {
  it('is said in a plain sentence and leaves the old schedule in place', async () => {
    await put(good);
    const store = memoryState();
    await store.change((d) => void (d.mail.schedule = portalState().read().mail.schedule));
    store.change = () => Promise.reject(new StateWriteError('EACCES'));
    usePortalState(store);
    const res = await put({ ...good, day: 9 });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toBe('The portal could not save this. Check that its data folder can be written.');
    expect(portalState().read().mail.schedule!.day).toBe(1);
  });
});
