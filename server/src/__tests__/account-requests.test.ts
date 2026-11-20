import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryUsers, noUsers } from '../security/userStore.js';
import { memoryRequests, noRequests, openRequests, readRequests, RequestsWriteError, type AccountRequest, type RequestStore } from '../security/requestStore.js';

/**
 * Requests for an account (FR-62): a stranger leaves a name, the pages they want and a reason; an administrator approves it, which makes the account, or refuses it. The one public route that
 * writes to disk, so what is tested here is mostly what it refuses: off by default, the portal's own header, text it will not keep, copies, the limit of an address, the cap on what waits, and expiry.
 */

vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'root:root-pass-123:admin,guy:guest-pass-123:viewer';
  process.env.ACCOUNT_REQUESTS = 'true';
  process.env.ACCOUNT_REQUESTS_MAX_PENDING = '5';
  process.env.ACCOUNT_REQUESTS_PER_ADDRESS = '3';
});

const { setupAuth } = await import('../security/auth.js');
const { createDirectory, readEnvUsers } = await import('../security/accounts.js');
const { useUserDirectory } = await import('../services/userDirectory.js');
const { useRequestStore, forgetAddresses } = await import('../services/accountRequests.js');
const { registerErrorHandler } = await import('../http/errors.js');
const { AJV_OPTIONS } = await import('../core/schemas.js');
const { accountRequestRoutes } = await import('../routes/accountRequests.js');
const { usersRoutes } = await import('../routes/users.js');

const HOST = '127.0.0.1:8081';
const page = (token?: string) => ({ host: HOST, origin: `http://${HOST}`, 'x-hcml-csrf': '1', ...(token ? { cookie: `hcml_session=${token}` } : {}) });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const NOW = '2026-11-19T04:00:00Z';

let app: FastifyInstance;
let log: Record<string, unknown>[];

async function start(users = memoryUsers(), requests = memoryRequests()) {
  log = [];
  const directory = createDirectory(readEnvUsers(), users);
  useUserDirectory(directory);
  useRequestStore(requests);
  forgetAddresses();
  app = Fastify({ ajv: AJV_OPTIONS, logger: { level: 'info', stream: { write: (line: string) => void log.push(JSON.parse(line)) } } });
  registerErrorHandler(app);
  await setupAuth(app, directory);
  await app.register(accountRequestRoutes);
  await app.register(usersRoutes);
  await app.ready();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  await start();
});
afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  useUserDirectory(null);
  useRequestStore(null);
});

const BODY = { name: 'Budi Santoso', pages: ['problems', 'sla'], reason: 'I watch the Surabaya office link for the morning handover.' };
const ask = (body: unknown = BODY, remoteAddress = '10.0.0.1', headers: Record<string, string> = page()) => app.inject({ method: 'POST', url: '/api/auth/request', headers, payload: body as object, remoteAddress });
const tokenOf = async (username: string, password: string) => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: page(), payload: { username, password } });
  const token = res.cookies.find((c) => c.name === 'hcml_session')?.value;
  if (!token) throw new Error(`sign-in as ${username} gave ${res.statusCode}`);
  return token;
};
const admin = () => tokenOf('root', 'root-pass-123');
const as = (token: string, method: 'GET' | 'POST', url: string, payload?: object) => app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });
const waiting = async () => (await as(await admin(), 'GET', '/api/users/requests')).json().requests as { id: string; name: string; pages: string[]; reason: string; created: number }[];
const events = (action?: string) => log.filter((l) => l.event === 'account_request' && (!action || l.action === action));

describe('whether the form is offered', () => {
  it('is on when the setting is on and the portal has somewhere to keep requests and accounts', async () => {
    const res = await app.inject({ url: '/api/auth/request' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ enabled: true, nameMax: 80, reasonMax: 500 });
  });

  it('offers the pages a guest may have, and not the Users page or the scorecard', async () => {
    const { pages } = (await app.inject({ url: '/api/auth/request' })).json() as { pages: { id: string; label: string }[] };
    const ids = pages.map((p) => p.id);
    expect(ids).toContain('problems');
    expect(ids).toContain('sla');
    expect(ids).not.toContain('users');
    expect(ids).not.toContain('inventory');
    expect(pages.find((p) => p.id === 'sla')?.label).toBe('SLA');
  });

  it('is off, and the endpoint says there is none, when the portal has no data folder for requests', async () => {
    await app.close();
    await start(memoryUsers(), noRequests());
    expect((await app.inject({ url: '/api/auth/request' })).json()).toEqual({ enabled: false });
    const res = await ask();
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });

  it('is off when the users cannot be changed either, since an approval could make no account', async () => {
    await app.close();
    await start(noUsers(), memoryRequests());
    expect((await app.inject({ url: '/api/auth/request' })).json()).toEqual({ enabled: false });
    expect((await ask()).statusCode).toBe(404);
  });
});

describe('the request of a person who is not signed in', () => {
  it('is kept, and answered with the same words whatever became of it', async () => {
    const res = await ask();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
    const [kept] = await waiting();
    expect(kept).toMatchObject({ name: 'Budi Santoso', pages: ['problems', 'sla'], reason: BODY.reason });
    expect(kept.id).toMatch(/^[A-Za-z0-9_-]{8,}$/);
    expect(kept.created).toBe(Math.floor(Date.parse(NOW) / 1000));
  });

  it('is checked like sign-in is: without the portal’s own header, or from another site, it is refused before anything is read', async () => {
    const { 'x-hcml-csrf': _drop, ...noHeader } = page();
    const missing = await ask(BODY, '10.0.0.1', noHeader);
    expect(missing.statusCode).toBe(403);
    expect(missing.json().error).toBe('csrf');
    const foreign = await ask(BODY, '10.0.0.1', { ...page(), origin: 'https://evil.example' });
    expect(foreign.statusCode).toBe(403);
    expect(await waiting()).toEqual([]);
  });

  it('says what is wrong with what was typed, in words', async () => {
    const refuse = async (body: unknown) => {
      const res = await ask(body);
      expect(res.statusCode).toBe(400);
      return res.json().message as string;
    };
    expect(await refuse({ ...BODY, name: ' ' })).toBe('Enter your name.');
    expect(await refuse({ ...BODY, name: 'B' })).toBe('Enter your name.');
    expect(await refuse({ ...BODY, pages: [] })).toBe('Choose at least one page.');
    expect(await refuse({ ...BODY, pages: ['bogus'] })).toBe('Choose the pages from the list.');
    expect(await refuse({ ...BODY, pages: ['problems', 'users'] })).toBe('Choose the pages from the list.');
    expect(await refuse({ ...BODY, pages: ['inventory'] })).toBe('Choose the pages from the list.');
    expect(await refuse({ ...BODY, reason: ' ' })).toBe('Say what you need the account for.');
    expect(await waiting()).toEqual([]);
  });

  it('refuses a body of the wrong shape, an extra field, and one that is too large to be a request', async () => {
    expect((await ask({ name: 'Budi', pages: 'problems', reason: 'x' })).statusCode).toBe(400);
    expect((await ask({ ...BODY, role: 'admin' })).statusCode).toBe(400);
    expect((await ask({ ...BODY, reason: 'x'.repeat(5_000) })).statusCode).toBe(400);
    expect((await ask({ ...BODY, reason: 'x'.repeat(20_000) })).statusCode).toBe(413);
    expect(await waiting()).toEqual([]);
  });

  it('keeps no control character and no mark that reorders text, which an administrator would otherwise read as something else', async () => {
    const res = await ask({ name: 'Bu\u0000di\u202e Santo\u200bso', pages: ['sla'], reason: 'line one\u0007\n\n\n\nline\u202etwo' });
    expect(res.statusCode).toBe(202);
    const [kept] = await waiting();
    expect(kept.name).toBe('Bu di Santo so');
    expect(kept.reason).toBe('line one\n\nline two');
    // eslint-disable-next-line no-control-regex -- the point of the test
    expect(JSON.stringify(kept)).not.toMatch(/[\u0000-\u0008\u200b-\u202e]/);
  });

  it('keeps the first 80 characters of a longer name and the first 500 of a longer reason', async () => {
    await ask({ name: 'N'.repeat(120), pages: ['sla'], reason: 'r'.repeat(4_000) });
    expect((await waiting())[0].name).toHaveLength(80);
    expect((await waiting())[0].reason).toHaveLength(500);
  });

  it('drops a copy of a request that is waiting, in silence: the answer is the same, nothing is added, and the log says so', async () => {
    await ask();
    const again = await ask({ ...BODY, name: 'budi  santoso ', pages: ['sla'], reason: 'Another try.' }, '10.0.0.2');
    expect(again.statusCode).toBe(202);
    expect(again.json()).toEqual({ ok: true });
    expect(await waiting()).toHaveLength(1);
    expect(events('received')).toHaveLength(1);
    expect(events('ignored')).toHaveLength(1);
  });

  it('writes one line to the log for it, with the name and the address and never the reason', async () => {
    await ask();
    const [line] = events('received');
    expect(line).toMatchObject({ user: 'anonymous', ip: '10.0.0.1', target: 'Budi Santoso' });
    expect(JSON.stringify(log)).not.toContain('morning handover');
  });
});

describe('the limits of a stranger', () => {
  it('lets an address leave three requests in a day, and tells it when it may ask again', async () => {
    for (const name of ['Ana Putri', 'Bayu Aji', 'Citra Dewi']) expect((await ask({ ...BODY, name })).statusCode).toBe(202);
    const refused = await ask({ ...BODY, name: 'Dewi Lestari' });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ error: 'rate_limited' });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(80_000);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(86_400);
    expect(await waiting()).toHaveLength(3);
  });

  it('counts each address by itself, and a day later counts again', async () => {
    for (const name of ['Ana Putri', 'Bayu Aji', 'Citra Dewi']) await ask({ ...BODY, name });
    expect((await ask({ ...BODY, name: 'Eka Wulan' }, '10.0.0.2')).statusCode).toBe(202);
    vi.setSystemTime(new Date(Date.parse(NOW) + 86_401_000));
    expect((await ask({ ...BODY, name: 'Dewi Lestari' })).statusCode).toBe(202);
  });

  // A /64 is one person's, as the sign-in limits take it: a script on one network has as many addresses as it likes.
  it('counts the addresses of one IPv6 network as one, and another network by itself', async () => {
    for (const [i, name] of ['Ana Putri', 'Bayu Aji', 'Citra Dewi'].entries()) expect((await ask({ ...BODY, name }, `2001:db8:1:1::${i + 1}`)).statusCode).toBe(202);
    expect((await ask({ ...BODY, name: 'Dewi Lestari' }, '2001:db8:1:1:aaaa::9')).statusCode).toBe(429);
    expect((await ask({ ...BODY, name: 'Eka Wulan' }, '2001:db8:1:2::1')).statusCode).toBe(202);
  });

  it('counts a refused request against the address as well, so that a script cannot try names for free', async () => {
    for (let i = 0; i < 3; i++) expect((await ask({ ...BODY, name: ' ' })).statusCode).toBe(400);
    // A bad request is not counted: it was refused before it asked for a place.
    expect((await ask()).statusCode).toBe(202);
  });

  it('holds at most five waiting, whoever asks, and has room again when one is answered', async () => {
    for (let i = 1; i <= 5; i++) expect((await ask({ ...BODY, name: `Person ${i}` }, `10.0.1.${i}`)).statusCode).toBe(202);
    const full = await ask({ ...BODY, name: 'Person 6' }, '10.0.1.6');
    expect(full.statusCode).toBe(503);
    expect(full.json()).toMatchObject({ error: 'requests_full' });
    const [first] = await waiting();
    expect((await as(await admin(), 'POST', `/api/users/requests/${first.id}/refuse`)).statusCode).toBe(200);
    expect((await ask({ ...BODY, name: 'Person 7' }, '10.0.1.7')).statusCode).toBe(202);
  });

  it('answers a copy of a waiting request as it answers a new one when the list is full, so that the answer says nothing about who is waiting', async () => {
    for (let i = 1; i <= 5; i++) await ask({ ...BODY, name: `Person ${i}` }, `10.0.3.${i}`);
    const copy = await ask({ ...BODY, name: 'person 1' }, '10.0.3.9');
    const fresh = await ask({ ...BODY, name: 'Person 9' }, '10.0.3.10');
    expect(fresh.statusCode).toBe(503);
    expect(copy.statusCode).toBe(503);
    expect(copy.json()).toEqual(fresh.json());
  });

  it('drops a request nobody answered in thirty days, from the list at once and from the file when the next comes', async () => {
    await ask();
    expect(await waiting()).toHaveLength(1);
    vi.setSystemTime(new Date(Date.parse(NOW) + 31 * 86_400_000));
    expect(await waiting()).toEqual([]);
    await ask({ ...BODY, name: 'Citra Dewi' }, '10.0.0.9');
    expect((await waiting()).map((r) => r.name)).toEqual(['Citra Dewi']);
  });

  it('does not let thirty-day-old requests fill the cap', async () => {
    for (let i = 1; i <= 5; i++) await ask({ ...BODY, name: `Person ${i}` }, `10.0.2.${i}`);
    vi.setSystemTime(new Date(Date.parse(NOW) + 31 * 86_400_000));
    expect((await ask({ ...BODY, name: 'Person 6' }, '10.0.2.6')).statusCode).toBe(202);
  });
});

describe('who may read and answer the requests', () => {
  it('is an administrator alone: nobody signed out, and no guest', async () => {
    await ask();
    const [kept] = await waiting();
    expect((await app.inject({ url: '/api/users/requests' })).statusCode).toBe(401);
    const guest = await tokenOf('guy', 'guest-pass-123');
    for (const [method, url] of [['GET', '/api/users/requests'], ['POST', `/api/users/requests/${kept.id}/refuse`], ['POST', `/api/users/requests/${kept.id}/approve`]] as const) {
      expect((await as(guest, method, url, method === 'POST' ? { name: 'x' } : undefined)).statusCode, `${method} ${url}`).toBe(403);
    }
    expect(await waiting()).toHaveLength(1);
  });

  it('lists the oldest first, with what the person typed', async () => {
    await ask({ ...BODY, name: 'Ana Putri' });
    vi.setSystemTime(new Date(Date.parse(NOW) + 60_000));
    await ask({ ...BODY, name: 'Bayu Aji' }, '10.0.0.2');
    expect((await waiting()).map((r) => r.name)).toEqual(['Ana Putri', 'Bayu Aji']);
    expect((await as(await admin(), 'GET', '/api/users/requests')).json()).toMatchObject({ enabled: true, max: 5 });
  });
});

describe('an administrator’s answer', () => {
  const ACCOUNT = { name: 'budi.santoso', displayName: 'Budi Santoso', role: 'guest', modules: ['problems', 'sla'], password: 'a-long-password-1' };

  it('approves it by making the account, with the password the administrator chose, and takes it off the list', async () => {
    await ask();
    const [kept] = await waiting();
    const res = await as(await admin(), 'POST', `/api/users/requests/${kept.id}/approve`, ACCOUNT);
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ name: 'budi.santoso', role: 'guest', modules: ['problems', 'sla'] });
    expect(await waiting()).toEqual([]);
    expect(await app.inject({ method: 'POST', url: '/api/auth/login', headers: page(), payload: { username: 'budi.santoso', password: 'a-long-password-1' } }).then((r) => r.statusCode)).toBe(200);
    expect(events('approved')).toEqual([expect.objectContaining({ user: 'root', target: 'budi.santoso' })]);
    expect(log.some((l) => l.event === 'user_admin' && l.action === 'created' && l.target === 'budi.santoso')).toBe(true);
    expect(JSON.stringify(log)).not.toContain('a-long-password-1');
  });

  it('leaves the request where it is when the account cannot be made, so that it can be tried again', async () => {
    await ask();
    const [kept] = await waiting();
    const token = await admin();
    const taken = await as(token, 'POST', `/api/users/requests/${kept.id}/approve`, { ...ACCOUNT, name: 'guy' });
    expect(taken.statusCode).toBe(409);
    const weak = await as(token, 'POST', `/api/users/requests/${kept.id}/approve`, { ...ACCOUNT, password: 'short' });
    expect(weak.statusCode).toBe(400);
    expect(await waiting()).toHaveLength(1);
    expect(events('approved')).toEqual([]);
  });

  it('says there is no such request for one that another administrator has answered, or that never was', async () => {
    await ask();
    const [kept] = await waiting();
    const token = await admin();
    expect((await as(token, 'POST', `/api/users/requests/${kept.id}/refuse`)).statusCode).toBe(200);
    const again = await as(token, 'POST', `/api/users/requests/${kept.id}/approve`, ACCOUNT);
    expect(again.statusCode).toBe(404);
    expect((await as(token, 'POST', `/api/users/requests/${kept.id}/refuse`)).statusCode).toBe(404);
    expect((await as(token, 'POST', '/api/users/requests/nothing-like-it/refuse')).statusCode).toBe(404);
  });

  it('refuses it by taking it off the list, and writes a line to the log', async () => {
    await ask();
    const [kept] = await waiting();
    expect((await as(await admin(), 'POST', `/api/users/requests/${kept.id}/refuse`)).json()).toEqual({ ok: true });
    expect(await waiting()).toEqual([]);
    expect(events('refused')).toEqual([expect.objectContaining({ user: 'root', target: 'Budi Santoso' })]);
  });
});

describe('two answers to one request at once', () => {
  const ACCOUNT = { name: 'budi.santoso', displayName: 'Budi Santoso', role: 'guest', modules: ['problems', 'sla'], password: 'a-long-password-1' };
  const accountNames = async (token: string) => ((await as(token, 'GET', '/api/users')).json().users as { name: string }[]).map((u) => u.name);

  it('lets one of two approvals win, whatever name each typed, and tells the other that it was answered', async () => {
    await ask();
    const [kept] = await waiting();
    const token = await admin();
    const results = await Promise.all([
      as(token, 'POST', `/api/users/requests/${kept.id}/approve`, ACCOUNT),
      as(token, 'POST', `/api/users/requests/${kept.id}/approve`, { ...ACCOUNT, name: 'budi.s', displayName: 'Budi S' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 404]);
    expect((await accountNames(token)).filter((n) => n.startsWith('budi'))).toHaveLength(1);
    expect(await waiting()).toEqual([]);
  });

  it('tells a refusal that comes while an approval is under way that the request was answered, and makes one account', async () => {
    await ask();
    const [kept] = await waiting();
    const token = await admin();
    const approving = as(token, 'POST', `/api/users/requests/${kept.id}/approve`, ACCOUNT);
    // The password of the new account is being hashed, which takes tens of milliseconds.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const refused = await as(token, 'POST', `/api/users/requests/${kept.id}/refuse`);
    expect(refused.statusCode).toBe(404);
    expect((await approving).statusCode).toBe(201);
    expect((await accountNames(token)).filter((n) => n === 'budi.santoso')).toHaveLength(1);
    expect(events('refused')).toEqual([]);
  });

  it('puts the request back when the account it was taken for cannot be made, so that it can be tried again', async () => {
    await ask();
    const [kept] = await waiting();
    const token = await admin();
    expect((await as(token, 'POST', `/api/users/requests/${kept.id}/approve`, { ...ACCOUNT, name: 'guy' })).statusCode).toBe(409);
    expect((await waiting()).map((r) => r.id)).toEqual([kept.id]);
    expect((await as(token, 'POST', `/api/users/requests/${kept.id}/approve`, ACCOUNT)).statusCode).toBe(201);
  });
});

// A write that fails says so in words of its own, as the users file does (BK-99), and the request is not lost.
describe('a save of the requests that fails', () => {
  const waitingOne: AccountRequest = { id: 'abcdefghijkl', name: 'Budi Santoso', pages: ['sla'], reason: 'For the handover.', created: Math.floor(Date.parse(NOW) / 1000) };
  const failing = (): RequestStore => ({
    ...memoryRequests([waitingOne]),
    change: async () => {
      throw new RequestsWriteError('ENOSPC');
    },
  });

  it('answers a stranger with its own sentence and not the unexpected-error one, and never says why in the response', async () => {
    await app.close();
    await start(memoryUsers(), failing());
    const res = await ask({ ...BODY, name: 'Citra Dewi' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'requests_error', message: expect.stringContaining('could not save the requests') });
    expect(JSON.stringify(res.json())).not.toContain('ENOSPC');
    expect(log.some((l) => l.level === 50 && JSON.stringify(l).includes('ENOSPC'))).toBe(true);
  });

  it('answers an administrator the same way, and makes no account for an approval it could not record', async () => {
    await app.close();
    await start(memoryUsers(), failing());
    const token = await admin();
    const refused = await as(token, 'POST', `/api/users/requests/${waitingOne.id}/refuse`);
    expect(refused.statusCode).toBe(500);
    expect(refused.json().error).toBe('requests_error');
    const approved = await as(token, 'POST', `/api/users/requests/${waitingOne.id}/approve`, { name: 'budi.santoso', displayName: 'Budi', role: 'guest', modules: ['sla'], password: 'a-long-password-1' });
    expect(approved.statusCode).toBe(500);
    expect(approved.json().error).toBe('requests_error');
    expect(((await as(token, 'GET', '/api/users')).json().users as { name: string }[]).some((u) => u.name === 'budi.santoso')).toBe(false);
  });
});

describe('the file of requests', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'requests-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const one = (over: Partial<AccountRequest> = {}): AccountRequest => ({ id: 'abcdefghijkl', name: 'Budi Santoso', pages: ['sla'], reason: 'For the handover.', created: 1_790_000_000, ...over });

  it('keeps requests across a restart, in a file only its owner can read', async () => {
    const warnings: string[] = [];
    const first = await openRequests(dir, (m) => warnings.push(m));
    await first.change((draft) => void draft.push(one()));
    const second = await openRequests(dir, (m) => warnings.push(m));
    expect(second.list()).toEqual([one()]);
    expect(((await stat(join(dir, 'requests.json'))).mode & 0o777).toString(8)).toBe('600');
    expect(warnings).toEqual([]);
  });

  it('puts aside a file it cannot read, says so, and starts with none', async () => {
    await writeFile(join(dir, 'requests.json'), '{ not json');
    const warnings: string[] = [];
    const store = await openRequests(dir, (m) => warnings.push(m));
    expect(store.list()).toEqual([]);
    expect(warnings.join(' ')).toMatch(/put aside as requests\.json\.broken-/);
    expect((await readdir(dir)).some((f) => f.startsWith('requests.json.broken-'))).toBe(true);
    await store.change((draft) => void draft.push(one()));
    expect(JSON.parse(await readFile(join(dir, 'requests.json'), 'utf8')).requests).toHaveLength(1);
  });

  it('drops a record that is not whole and says how many, keeping the others', async () => {
    const good = one();
    await writeFile(join(dir, 'requests.json'), JSON.stringify({ version: 1, requests: [good, { id: 'x', name: '' }, { ...good, id: 'zzzzzzzzzz', pages: ['bogus'] }] }));
    const warnings: string[] = [];
    const store = await openRequests(dir, (m) => warnings.push(m));
    expect(store.list()).toEqual([good]);
    expect(warnings[0]).toMatch(/2 requests .* were not whole/);
  });

  it('keeps nothing and is not editable when there is no data folder, or one that cannot be written', async () => {
    expect((await openRequests('', () => undefined)).editable).toBe(false);
    // A file where the folder should be: the folder cannot be made.
    await writeFile(join(dir, 'blocker'), 'a file');
    const warnings: string[] = [];
    const blocked = await openRequests(join(dir, 'blocker', 'inside'), (m) => warnings.push(m));
    expect(blocked.editable).toBe(false);
    expect(warnings.join(' ')).toMatch(/cannot read or write its data folder/);
    await expect(blocked.change((draft) => void draft.push(one()))).rejects.toThrow(/could not save the requests/);
  });

  it('refuses to save a list that would not read back', () => {
    expect(readRequests({ version: 2, requests: [] }).usable).toBe(false);
    expect(readRequests({ version: 1, requests: [one(), one()] })).toMatchObject({ dropped: 1 });
    expect(readRequests({ version: 1, requests: [one({ pages: Array(25).fill('sla') })] })).toMatchObject({ dropped: 1 });
  });
});
