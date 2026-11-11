import { afterEach, describe, expect, it, vi } from 'vitest';
import { bearer, buildAuthApp, closeAuthApps, page } from './helpers/authApp.js';
import { hashPassword } from '../security/passwords.js';

/**
 * Who can sign in, and what the BFF says about it: how PORTAL_USERS is read,
 * names without regard to case and the sign-in log. Every password and name here
 * is made up for the tests.
 */
afterEach(async () => {
  vi.unstubAllEnvs();
  await closeAuthApps();
});

const CHEAP = { N: 1024, r: 8, p: 1 };

describe('PORTAL_USERS entries (SC-22)', () => {
  it('takes the name before the first colon and the role after the last, so a password may hold colons', async () => {
    const { signIn } = await buildAuthApp({ PORTAL_USERS: 'ana:pa:ss:w0rd:operator,budi:plain-pass:viewer' });
    const ana = await signIn('ana', 'pa:ss:w0rd');
    expect(ana.statusCode).toBe(200);
    expect(ana.json().user).toEqual({ name: 'ana', role: 'operator' });
    // Only the whole password signs in, not the piece before the first colon.
    expect((await signIn('ana', 'pa')).statusCode).toBe(401);
    expect((await signIn('budi', 'plain-pass')).statusCode).toBe(200);
  });

  it('still reads name:password with no role as a viewer, and a trailing colon the same', async () => {
    const { signIn } = await buildAuthApp({ PORTAL_USERS: 'cici:only-pass,dede:other-pass:' });
    expect((await signIn('cici', 'only-pass')).json().user).toEqual({ name: 'cici', role: 'viewer' });
    expect((await signIn('dede', 'other-pass')).json().user).toEqual({ name: 'dede', role: 'viewer' });
  });

  it('reads an entry whose last part is not a role as before: that part is an unknown role, a viewer, and no warning shows it', async () => {
    const { signIn, warnings } = await buildAuthApp({ PORTAL_USERS: 'eko:the-pass:vewer,fifi:fine-pass:admin' });
    const eko = await signIn('eko', 'the-pass');
    expect(eko.json().user).toEqual({ name: 'eko', role: 'viewer' });
    const all = warnings().join(' ');
    expect(all).toContain('PORTAL_USERS entry for "eko" has an unknown role');
    for (const secret of ['the-pass', 'vewer', 'fine-pass']) expect(all).not.toContain(secret);
  });

  it('skips an entry with no name or no password, by position, without echoing it', async () => {
    const { signIn, warnings } = await buildAuthApp({ PORTAL_USERS: ':nameless-pass:admin,gigi::admin,hana:hana-pass:viewer' });
    expect((await signIn('hana', 'hana-pass')).statusCode).toBe(200);
    expect((await signIn('gigi', '')).statusCode).toBe(401);
    const all = warnings().join(' ');
    expect(all).toContain('entry 1 of 3');
    expect(all).toContain('entry 2 of 3');
    expect(all).not.toContain('nameless-pass');
  });
});

describe('scrypt hashes in PORTAL_USERS and PORTAL_PASS (SC-22)', () => {
  it('signs in with the password behind a hash, refuses any other, and leaves plain entries beside it working', async () => {
    const hash = await hashPassword('hashed:pass,word', CHEAP);
    const { signIn } = await buildAuthApp({ PORTAL_USERS: `ana:${hash}:admin,budi:plain-pass:viewer` });
    const ana = await signIn('ana', 'hashed:pass,word');
    expect(ana.statusCode).toBe(200);
    expect(ana.json().user).toEqual({ name: 'ana', role: 'admin' });
    for (const wrong of ['hashed:pass', 'Hashed:pass,word', '', hash]) {
      expect((await signIn('ana', wrong)).statusCode, JSON.stringify(wrong)).toBe(401);
    }
    expect((await signIn('budi', 'plain-pass')).statusCode).toBe(200);
  });

  it('takes a hash in PORTAL_PASS too, for the single-admin shorthand', async () => {
    const hash = await hashPassword('the-one-password', CHEAP);
    const { signIn } = await buildAuthApp({ PORTAL_USERS: '', PORTAL_USER: 'boss', PORTAL_PASS: hash });
    expect((await signIn('boss', 'the-one-password')).json().user).toEqual({ name: 'boss', role: 'admin' });
    expect((await signIn('boss', hash)).statusCode).toBe(401);
  });

  it('skips an entry that starts like a hash but is not one, warning by position and never echoing it', async () => {
    const broken = 'scrypt.32768.8.1.not-a-real-salt-or-hash';
    const { signIn, warnings } = await buildAuthApp({ PORTAL_USERS: `ana:${broken}:admin,budi:budi-pass:viewer` });
    expect((await signIn('ana', broken)).statusCode).toBe(401);
    expect((await signIn('budi', 'budi-pass')).statusCode).toBe(200);
    const all = warnings().join(' ');
    expect(all).toContain('entry 1 of 2');
    expect(all).toContain('not a usable hash');
    expect(all).not.toContain('not-a-real-salt');
  });

  it('spends a hash check on a name nobody holds, so an unknown name is not quicker to refuse than a known one', async () => {
    const { signIn } = await buildAuthApp({ PORTAL_USERS: `ana:${await hashPassword('ana-pass', CHEAP)}:viewer` });
    await signIn('warm-up', 'x');
    const started = performance.now();
    expect((await signIn('nobody-by-this-name', 'guess')).statusCode).toBe(401);
    // The decoy runs at the default cost, about 100 ms; with none it would be a millisecond or two.
    expect(performance.now() - started).toBeGreaterThan(15);
  });
});

describe('names without regard to case (FR-13)', () => {
  it('signs in whatever the case typed, and keeps the name as written in the token, the answer and renewal', async () => {
    const { signIn, app, cookieOf } = await buildAuthApp({ PORTAL_USERS: 'Olu.Ade:op-pass:operator' });
    for (const typed of ['olu.ade', 'OLU.ADE', 'Olu.Ade']) {
      const res = await signIn(typed, 'op-pass');
      expect(res.statusCode, typed).toBe(200);
      expect(res.json().user).toEqual({ name: 'Olu.Ade', role: 'operator' });
      expect((app.jwt.decode(cookieOf(res)!) as { sub: string }).sub).toBe('Olu.Ade');
    }
    const token = cookieOf(await signIn('OLU.ADE', 'op-pass'))!;
    expect((await app.inject({ url: '/api/links', headers: bearer(token) })).statusCode).toBe(200);
    const renewed = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: page(token) });
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json().user.name).toBe('Olu.Ade');
  });

  it('keeps the password exact, and an unknown name unknown', async () => {
    const { signIn } = await buildAuthApp({ PORTAL_USERS: 'Olu:op-pass:operator' });
    expect((await signIn('OLU', 'OP-PASS')).statusCode).toBe(401);
    expect((await signIn('olu2', 'op-pass')).statusCode).toBe(401);
  });

  it('lets two entries that differ only by case each sign in with their own password, the spelling typed first', async () => {
    const { signIn, warnings } = await buildAuthApp({ PORTAL_USERS: 'Ana:pass-one:viewer,ana:pass-two:admin' });
    expect((await signIn('ana', 'pass-two')).json().user).toEqual({ name: 'ana', role: 'admin' });
    expect((await signIn('ANA', 'pass-one')).json().user).toEqual({ name: 'Ana', role: 'viewer' });
    expect((await signIn('Ana', 'pass-one')).json().user).toEqual({ name: 'Ana', role: 'viewer' });
    expect((await signIn('ANA', 'pass-two')).json().user).toEqual({ name: 'ana', role: 'admin' });
    expect(warnings().join(' ')).toContain('differ only by case');
  });

  it('when two such entries share a password, signs in the one spelled as typed, and the first for any other case', async () => {
    const { signIn } = await buildAuthApp({ PORTAL_USERS: 'Ana:same-pass:viewer,ana:same-pass:admin' });
    expect((await signIn('ana', 'same-pass')).json().user).toEqual({ name: 'ana', role: 'admin' });
    expect((await signIn('Ana', 'same-pass')).json().user).toEqual({ name: 'Ana', role: 'viewer' });
    expect((await signIn('ANA', 'same-pass')).json().user).toEqual({ name: 'Ana', role: 'viewer' });
  });

  it('counts "ANA" and "ana" as one account for the lock, so changing case does not buy more guesses', async () => {
    const { signIn, auth } = await buildAuthApp({ PORTAL_USERS: 'ana:right-pass:viewer' });
    const spellings = ['ana', 'ANA', 'Ana', 'aNa', 'anA'];
    for (let i = 0; i < auth.LOGIN_LOCK_AFTER; i++) expect((await signIn(spellings[i % spellings.length], 'guess')).statusCode).toBe(401);
    // Locked now, whatever spelling and even with the right password.
    for (const typed of ['ana', 'ANA']) expect((await signIn(typed, 'right-pass')).statusCode, typed).toBe(429);
  });
});

describe('the sign-in log (SC-19)', () => {
  it('logs a success at info with the name, the outcome and the address, and never the password', async () => {
    const { signIn, events, log } = await buildAuthApp();
    await signIn('ana', 'viewer-pass', '203.0.113.7');
    expect(events()).toEqual([expect.objectContaining({ level: 30, event: 'sign_in', user: 'ana', outcome: 'success', ip: '203.0.113.7' })]);
    expect(JSON.stringify(log)).not.toContain('viewer-pass');
  });

  it('logs a failure for a wrong password and for an unknown name, the name as typed', async () => {
    const { signIn, events, log } = await buildAuthApp();
    await signIn('ana', 'wrong-guess-one', '203.0.113.8');
    await signIn('Nobody', 'wrong-guess-two', '203.0.113.9');
    expect(events().map(({ level, user, outcome, ip }) => ({ level, user, outcome, ip }))).toEqual([
      { level: 30, user: 'ana', outcome: 'failure', ip: '203.0.113.8' },
      { level: 30, user: 'Nobody', outcome: 'failure', ip: '203.0.113.9' },
    ]);
    expect(JSON.stringify(log)).not.toMatch(/wrong-guess/);
  });

  it('cuts a long name short and drops control characters, so a request cannot fill or forge a log line', async () => {
    const { signIn, events } = await buildAuthApp();
    await signIn('n'.repeat(200), 'x');
    await signIn('line one\nline two\u0000end', 'x');
    const [long, odd] = events().map((e) => e.user as string);
    expect(long).toBe('n'.repeat(64));
    expect(odd).toBe('line one line two end');
  });

  it('logs an attempt refused for a lock, as locked', async () => {
    const { signIn, events, auth } = await buildAuthApp();
    for (let i = 0; i < auth.LOGIN_LOCK_AFTER; i++) await signIn('ana', 'guess', '203.0.113.20');
    const refused = await signIn('ana', 'viewer-pass', '203.0.113.20');
    expect(refused.statusCode).toBe(429);
    expect(events().at(-1)).toMatchObject({ user: 'ana', outcome: 'locked', ip: '203.0.113.20' });
  });

  it('warns after five failures in a row for one name, from any address, and again at every fifth', async () => {
    const { signIn, events, log, auth } = await buildAuthApp();
    expect(auth.LOGIN_WARN_AFTER).toBe(5);
    const warns = () => events('sign_in_repeated_failures');
    // Different addresses and spellings: this is about the name, not the address.
    for (let i = 1; i < auth.LOGIN_WARN_AFTER; i++) await signIn(i % 2 ? 'ana' : 'ANA', 'guess', `203.0.113.${i}`);
    expect(warns()).toEqual([]);
    await signIn('ana', 'guess', '203.0.113.99');
    expect(warns()).toEqual([expect.objectContaining({ level: 40, user: 'ana', failures: 5, ip: '203.0.113.99' })]);
    for (let i = 0; i < auth.LOGIN_WARN_AFTER; i++) await signIn('ana', 'guess', `203.0.114.${i}`);
    expect(warns().map((w) => w.failures)).toEqual([5, 10]);
    expect(JSON.stringify(log)).not.toContain('guess"');
  });

  it('starts the count again after a success, and counts each name on its own', async () => {
    const { signIn, events } = await buildAuthApp();
    const warns = () => events('sign_in_repeated_failures');
    for (let i = 0; i < 4; i++) await signIn('ana', 'guess', `203.0.113.${i}`);
    expect((await signIn('ana', 'viewer-pass', '203.0.113.50')).statusCode).toBe(200);
    for (let i = 0; i < 4; i++) await signIn('ana', 'guess', `203.0.113.${60 + i}`);
    for (let i = 0; i < 4; i++) await signIn('olu', 'guess', `203.0.113.${70 + i}`);
    expect(warns()).toEqual([]);
  });

  it('forgets failures older than the window', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    try {
      const { signIn, events } = await buildAuthApp();
      for (let i = 0; i < 4; i++) await signIn('ana', 'guess', `203.0.113.${i}`);
      vi.setSystemTime(Date.now() + 16 * 60_000);
      await signIn('ana', 'guess', '203.0.113.40');
      expect(events('sign_in_repeated_failures')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the first PORTAL_USERS entry (MT-06)', () => {
  it('replaces PORTAL_USER and PORTAL_PASS, so a new wall account needs the admin listed beside it', async () => {
    const wall = await hashPassword('wall-screen-pass', CHEAP);
    const alone = await buildAuthApp({ PORTAL_USERS: `wall:${wall}:wall`, PORTAL_USER: 'boss', PORTAL_PASS: 'boss-pass' });
    expect((await alone.signIn('wall', 'wall-screen-pass')).json().user).toEqual({ name: 'wall', role: 'wall' });
    expect((await alone.signIn('boss', 'boss-pass')).statusCode).toBe(401);
    await closeAuthApps();
    const both = await buildAuthApp({ PORTAL_USERS: `boss:boss-pass:admin,wall:${wall}:wall` });
    expect((await both.signIn('boss', 'boss-pass')).json().user).toEqual({ name: 'boss', role: 'admin' });
    expect((await both.signIn('wall', 'wall-screen-pass')).json().user).toEqual({ name: 'wall', role: 'wall' });
  });
});
