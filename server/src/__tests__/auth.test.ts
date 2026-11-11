import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * The auth guard over HTTP, mounted the way index.ts mounts it: health first,
 * then setupAuth, then the routes it must cover. Stub routes stand in for the
 * real ones, since the guard decides before any handler runs.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer,olu:operator-pass:operator,adi:admin-pass:admin';
});

const { setupAuth, tokenClaims } = await import('../security/auth.js');
/** The issuer and audience every token of this portal carries; a token without them is refused. */
const CLAIMS = tokenClaims('hcml_session');
/** The configured user for each role. A token's user must still be in PORTAL_USERS. */
const USER_OF: Record<string, string> = { viewer: 'ana', operator: 'olu', admin: 'adi' };
const { registerErrorHandler } = await import('../http/errors.js');

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  app.get('/api/health', async () => ({ ok: true }));
  registerErrorHandler(app);
  await setupAuth(app);
  app.get('/api/hosts', async () => ({ ok: 'hosts' }));
  app.get('/api/links', async () => ({ ok: 'links' }));
  app.get('/api/reports/inventory', async () => ({ ok: 'inventory' }));
  app.get('/api/stream', async () => ({ ok: 'stream' }));
  app.post('/api/problems/acknowledge', async () => ({ ok: 'ack' }));
  // Share a prefix with the public routes; must not share their exemption.
  app.get('/api/healthz', async () => ({ ok: 'healthz' }));
  app.get('/api/auth/extra', async () => ({ ok: 'extra' }));
  await app.ready();
});

afterAll(() => app.close());

const tokenFor = (sub: string, role: string) => app.jwt.sign({ sub, role, ...CLAIMS }, { expiresIn: '1h' });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
/** What the portal's own page sends: the session cookie, the CSRF header and its own origin. */
const HOST = '127.0.0.1:8081';
const page = (token?: string) => ({
  host: HOST,
  origin: `http://${HOST}`,
  'x-hcml-csrf': '1',
  ...(token ? { cookie: `hcml_session=${token}` } : {}),
});
const cookieOnly = (token: string) => ({ host: HOST, cookie: `hcml_session=${token}` });
/** The session cookie a response set, if any. */
const sessionCookie = (res: { cookies: { name: string; value: string; [k: string]: unknown }[] }, name = 'hcml_session') =>
  res.cookies.find((c) => c.name === name);

describe('auth guard', () => {
  it('answers 401 with no token, a malformed token, or one signed with another secret', async () => {
    const foreign = Fastify();
    await foreign.register((await import('@fastify/jwt')).default, { secret: 'a-different-secret-entirely-32-bytes' });
    await foreign.ready();
    const forged = foreign.jwt.sign({ sub: 'adi', role: 'admin' });
    await foreign.close();

    for (const headers of [{}, bearer('not-a-jwt'), bearer(forged)]) {
      const res = await app.inject({ url: '/api/hosts', headers });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'unauthorized', message: 'Sign in to continue.' });
    }
  });

  it('answers 401 for an expired token', async () => {
    const expired = app.jwt.sign({ sub: 'ana', role: 'viewer', ...CLAIMS, exp: Math.floor(Date.now() / 1000) - 60 });
    expect((await app.inject({ url: '/api/hosts', headers: bearer(expired) })).statusCode).toBe(401);
  });

  it('leaves health public', async () => {
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200);
  });

  it('lets each role reach its own routes and answers 403 above it', async () => {
    const cases: [role: string, url: string, method: 'GET' | 'POST', status: number][] = [
      ['viewer', '/api/hosts', 'GET', 200],
      ['viewer', '/api/links', 'GET', 403],
      ['viewer', '/api/reports/inventory', 'GET', 403],
      ['viewer', '/api/problems/acknowledge', 'POST', 403],
      ['operator', '/api/links', 'GET', 200],
      ['operator', '/api/problems/acknowledge', 'POST', 200],
      ['operator', '/api/reports/inventory', 'GET', 403],
      ['admin', '/api/reports/inventory', 'GET', 200],
    ];
    for (const [role, url, method, status] of cases) {
      const res = await app.inject({ method, url, headers: bearer(tokenFor(USER_OF[role], role)) });
      expect(res.statusCode, `${role} ${method} ${url}`).toBe(status);
    }
  });

  it('names the missing role in a 403', async () => {
    const res = await app.inject({ url: '/api/links', headers: bearer(tokenFor('ana', 'viewer')) });
    expect(res.json()).toMatchObject({ error: 'forbidden', message: expect.stringContaining('"wall"') });
  });

  // The role comes from PORTAL_USERS on every request, not from the token.
  it('ignores the role in the token: a role the token invents, or one above the user\'s, gives the configured one', async () => {
    for (const claimed of ['superuser', 'admin', 'operator']) {
      const odd = tokenFor('ana', claimed);
      expect((await app.inject({ url: '/api/hosts', headers: bearer(odd) })).statusCode, claimed).toBe(200);
      expect((await app.inject({ url: '/api/links', headers: bearer(odd) })).statusCode, claimed).toBe(403);
    }
  });

  // The stream takes no ?token=, because EventSource
  // cannot send headers and sends the session cookie like every request.
  it('refuses ?token= on the live stream too, which opens with the cookie instead (tracker SC-03, SC-11)', async () => {
    const token = tokenFor('ana', 'viewer');
    expect((await app.inject({ url: `/api/stream?token=${token}` })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/stream', headers: cookieOnly(token) })).statusCode).toBe(200);
  });

  it('refuses ?token= on every route (tracker SC-03)', async () => {
    const token = tokenFor('ana', 'viewer');
    expect((await app.inject({ url: `/api/hosts?token=${token}` })).statusCode).toBe(401);
    // The header still works when a stray query token rides along.
    expect((await app.inject({ url: `/api/hosts?token=junk`, headers: bearer(token) })).statusCode).toBe(200);
  });

  it('guards the path the router decodes, not the raw URL text (tracker SC-02)', async () => {
    for (const url of ['/%61pi/hosts', '/api/%68osts', '/%61pi/zz-unknown']) {
      expect((await app.inject({ url })).statusCode, url).toBe(401);
    }
    const viewer = bearer(tokenFor('ana', 'viewer'));
    for (const url of ['/api/%6Cinks', '/%61pi/links', '/api/reports/%69nventory']) {
      expect((await app.inject({ url, headers: viewer })).statusCode, url).toBe(403);
    }
  });

  it('exempts only the exact public routes, not everything that shares their prefix', async () => {
    for (const url of ['/api/healthz', '/api/auth/extra', '/api/auth/logout/x']) {
      expect((await app.inject({ url })).statusCode, url).toBe(401);
    }
  });

  it('answers 401 for an unknown /api/ path with no token, rather than revealing it does not exist', async () => {
    expect((await app.inject({ url: '/api/zz-unknown' })).statusCode).toBe(401);
  });
});

/** An app wired the way index.ts wires it: the limiter first, then the guard. */
async function limitedApp(max: number) {
  const { registerRateLimit } = await import('../http/rateLimit.js');
  const limited = Fastify({ logger: false });
  registerErrorHandler(limited);
  await registerRateLimit(limited, max);
  limited.get('/api/health', async () => ({ ok: true }));
  await setupAuth(limited);
  limited.get('/api/hosts', async () => ({ ok: 'hosts' }));
  limited.get('/api/stream', async () => ({ ok: 'stream' }));
  await limited.ready();
  return limited;
}

describe('rate limits', () => {
  it('counts requests the guard refuses, so a flood without a token is throttled too', async () => {
    const limited = await limitedApp(5);
    for (let i = 0; i < 5; i++) expect((await limited.inject({ url: '/api/hosts' })).statusCode).toBe(401);
    const over = await limited.inject({ url: '/api/hosts' });
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ error: 'rate_limited' });
    await limited.close();
  });

  it('leaves health and the live stream out of the count', async () => {
    const limited = await limitedApp(2);
    const token = limited.jwt.sign({ sub: 'ana', role: 'viewer', ...CLAIMS }, { expiresIn: '1h' });
    for (let i = 0; i < 5; i++) {
      expect((await limited.inject({ url: '/api/health' })).statusCode).toBe(200);
      expect((await limited.inject({ url: '/api/stream', headers: cookieOnly(token) })).statusCode).toBe(200);
    }
    await limited.close();
  });

  it('keeps the per-address limit on sign-in, so trying a new username each time does not get round it', async () => {
    const limited = await limitedApp(5);
    const tryAs = (username: string) =>
      limited.inject({ method: 'POST', url: '/api/auth/login', headers: page(), payload: { username, password: 'guess' } });
    for (let i = 0; i < 5; i++) expect((await tryAs(`user${i}`)).statusCode).toBe(401);
    expect((await tryAs('user99')).statusCode).toBe(429);
    await limited.close();
  });

  it('is wired ahead of the guard in index.ts, the order these tests copy', async () => {
    const { readFile } = await import('node:fs/promises');
    const index = await readFile(new URL('../index.ts', import.meta.url), 'utf8');
    const limiter = index.indexOf('await registerRateLimit(app)');
    expect(limiter).toBeGreaterThan(-1);
    expect(limiter).toBeLessThan(index.indexOf('await setupAuth(app)'));
  });

  it('never refuses a sign-out, so a spent allowance cannot leave the cookie working', async () => {
    const limited = await limitedApp(2);
    for (let i = 0; i < 3; i++) await limited.inject({ url: '/api/hosts' });
    expect((await limited.inject({ url: '/api/hosts' })).statusCode).toBe(429);
    const out = await limited.inject({ method: 'POST', url: '/api/auth/logout', headers: page('any-token') });
    expect(out.statusCode).toBe(200);
    expect(sessionCookie(out)?.value).toBe('');
    // Matched by route, so another spelling of the same path is exempt too.
    const encoded = await limited.inject({ method: 'POST', url: '/api/auth/%6Cogout', headers: page('any-token') });
    expect(encoded.statusCode).toBe(200);
    await limited.close();
  });

  it('refuses a sign-in body over 4 KB before it reaches the limiter', async () => {
    const limited = await limitedApp(300);
    const res = await limited.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: page(),
      payload: { username: 'x'.repeat(5000), password: 'guess' },
    });
    expect(res.statusCode).toBe(413);
    await limited.close();
  });

  it('counts one account across an IPv6 /64, as the global limit groups addresses', async () => {
    const { LOGIN_ATTEMPTS_PER_MINUTE } = await import('../security/auth.js');
    const limited = await limitedApp(300);
    const fromHost = (n: number) =>
      limited.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: page(),
        remoteAddress: `2001:db8:1:2::${n.toString(16)}`,
        payload: { username: 'ana', password: 'guess' },
      });
    for (let i = 1; i <= LOGIN_ATTEMPTS_PER_MINUTE; i++) expect((await fromHost(i)).statusCode).toBe(401);
    expect((await fromHost(99)).statusCode).toBe(429);
    // The address stays in the key: the same account from anywhere else is not locked out.
    const elsewhere = (remoteAddress: string) =>
      limited.inject({ method: 'POST', url: '/api/auth/login', headers: page(), remoteAddress, payload: { username: 'ana', password: 'guess' } });
    expect((await elsewhere('2001:db8:1:3::1')).statusCode).toBe(401);
    expect((await elsewhere('10.4.0.1')).statusCode).toBe(401);
    await limited.close();
  });

  it('locks sign-in for longer after each further failure, and a success clears it', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    try {
      const { LOGIN_LOCK_AFTER, LOGIN_LOCK_BASE_MS } = await import('../security/auth.js');
      const limited = await limitedApp(300);
      const tryAs = (password: string) =>
        limited.inject({ method: 'POST', url: '/api/auth/login', headers: page(), payload: { username: 'ana', password } });
      for (let i = 0; i < LOGIN_LOCK_AFTER; i++) expect((await tryAs('guess')).statusCode).toBe(401);
      const locked = await tryAs('viewer-pass');
      expect(locked.statusCode).toBe(429);
      expect(Number(locked.headers['retry-after'])).toBe(LOGIN_LOCK_BASE_MS / 1000);
      // One more failure once the lock is over, and the next lock is twice as long: still
      // refused a minute later, although the flat per-minute window has started again.
      vi.setSystemTime(Date.now() + LOGIN_LOCK_BASE_MS + 1_000);
      expect((await tryAs('guess')).statusCode).toBe(401);
      vi.setSystemTime(Date.now() + LOGIN_LOCK_BASE_MS + 1_000);
      expect((await tryAs('viewer-pass')).statusCode).toBe(429);
      vi.setSystemTime(Date.now() + LOGIN_LOCK_BASE_MS);
      expect((await tryAs('viewer-pass')).statusCode).toBe(200);
      // The success cleared the count: one failure now locks nothing.
      expect((await tryAs('guess')).statusCode).toBe(401);
      expect((await tryAs('viewer-pass')).statusCode).toBe(200);
      await limited.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers 429 after ten attempts a minute on one account, before checking the password', async () => {
    const { LOGIN_ATTEMPTS_PER_MINUTE } = await import('../security/auth.js');
    const limited = await limitedApp(300);

    const attempt = () =>
      limited.inject({ method: 'POST', url: '/api/auth/login', headers: page(), payload: { username: 'ana', password: 'guess' } });
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_MINUTE; i++) expect((await attempt()).statusCode).toBe(401);
    const over = await attempt();
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ error: 'rate_limited' });
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    // Even the right password waits out the window.
    const right = await limited.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: page(),
      payload: { username: 'ana', password: 'viewer-pass' },
    });
    expect(right.statusCode).toBe(429);
    // Another account from the same address is unaffected: behind Docker every
    // browser shares the gateway address, so an address-only key would lock
    // the whole portal out after ten sign-ins.
    const other = await limited.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: page(),
      payload: { username: 'olu', password: 'operator-pass' },
    });
    expect(other.statusCode).toBe(200);
    await limited.close();
  });
});

describe('the Origin check behind a trusted proxy', () => {
  it('compares Origin with the Host header, not an X-Forwarded-Host the client sent', async () => {
    const proxied = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(proxied);
    await setupAuth(proxied);
    await proxied.ready();
    const signIn = (headers: Record<string, string>) =>
      proxied.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: 'adi', password: 'admin-pass' } });
    const spoofed = await signIn({ host: HOST, origin: 'https://evil.example', 'x-forwarded-host': 'evil.example', 'x-hcml-csrf': '1' });
    expect(spoofed.statusCode).toBe(403);
    expect(spoofed.json()).toMatchObject({ error: 'csrf' });
    expect((await signIn(page())).statusCode).toBe(200);
    await proxied.close();
  });
});

describe('POST /api/auth/login', () => {
  // The portal's page sends X-HCML-CSRF with every POST, sign-in included.
  const login = (payload: unknown, headers: Record<string, string> = page()) =>
    app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: payload as object });

  // A body missing a field or holding the wrong type is a 400 now (request-schemas.test.ts).
  it('answers 401 for a wrong password or an unknown user', async () => {
    for (const body of [
      { username: 'ana', password: 'wrong' },
      { username: 'nobody', password: 'viewer-pass' },
    ]) {
      const res = await login(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(401);
      expect(res.json().error).toBe('invalid_credentials');
    }
  });

  // The token travels in an httpOnly cookie, never in the body.
  it('sets an httpOnly, SameSite=Strict session cookie for twelve hours and returns no token', async () => {
    const res = await login({ username: 'olu', password: 'operator-pass' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: { name: 'olu', role: 'operator' }, expiresIn: 43200 });
    const c = sessionCookie(res);
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/', maxAge: 43200 });
    // Plain HTTP, as on 127.0.0.1: a Secure cookie would be dropped by the browser.
    expect(c?.secure).toBeUndefined();
    expect(res.body).not.toContain(c!.value);
    const { sub, role, exp, iat } = app.jwt.decode(c!.value) as { sub: string; role: string; exp: number; iat: number };
    expect({ sub, role, life: exp - iat }).toEqual({ sub: 'olu', role: 'operator', life: 43200 });
    // Bound to this portal by its cookie name.
    expect(app.jwt.decode(c!.value)).toMatchObject({ iss: 'hcml-portal:hcml_session', aud: 'hcml-portal:hcml_session' });
  });

  it('gives a cookie that opens the portal, up to the user\'s role', async () => {
    const token = sessionCookie(await login({ username: 'olu', password: 'operator-pass' }))!.value;
    expect((await app.inject({ url: '/api/links', headers: cookieOnly(token) })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/reports/inventory', headers: cookieOnly(token) })).statusCode).toBe(403);
  });

  it('marks the cookie Secure when the request came over HTTPS through a trusted proxy', async () => {
    const tls = Fastify({ logger: false, trustProxy: true });
    await setupAuth(tls);
    await tls.ready();
    const res = await tls.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { ...page(), origin: `https://${HOST}`, 'x-forwarded-proto': 'https' },
      payload: { username: 'ana', password: 'viewer-pass' },
    });
    expect(res.statusCode).toBe(200);
    expect(sessionCookie(res)?.secure).toBe(true);
    await tls.close();
  });

  it('refuses a sign-in without the X-HCML-CSRF header, or from another site, and sets no cookie', async () => {
    const creds = { username: 'ana', password: 'viewer-pass' };
    const { 'x-hcml-csrf': _, ...noHeader } = page();
    for (const headers of [noHeader, { ...page(), origin: 'https://evil.example' }]) {
      const res = await login(creds, headers);
      expect(res.statusCode, JSON.stringify(headers)).toBe(403);
      expect(res.json().error).toBe('csrf');
      expect(sessionCookie(res)).toBeUndefined();
    }
  });

  // Names are compared without regard to case, and the token carries the name as stored.
  it('matches the username without regard to case, and signs the name as configured', async () => {
    for (const typed of ['Ana', 'ANA', 'aNa']) {
      const res = await login({ username: typed, password: 'viewer-pass' });
      expect(res.statusCode, typed).toBe(200);
      expect(res.json().user).toEqual({ name: 'ana', role: 'viewer' });
      expect((app.jwt.decode(sessionCookie(res)!.value) as { sub: string }).sub).toBe('ana');
    }
    // The password is still exact.
    expect((await login({ username: 'ana', password: 'Viewer-Pass' })).statusCode).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('answers 401 with no token', async () => {
    const res = await app.inject({ url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
  });

  // /api/auth/me also says how long the session has left, since the page cannot read the token.
  it('returns the signed-in user, role and seconds left, from the cookie or a Bearer header', async () => {
    const token = tokenFor('adi', 'admin');
    for (const headers of [bearer(token), cookieOnly(token)]) {
      const res = await app.inject({ url: '/api/auth/me', headers });
      // The menu's role table has its own test (page-access.test.ts).
      const { expiresIn, pages, ...rest } = res.json();
      expect(pages).toBeTypeOf('object');
      expect(rest).toEqual({ authEnabled: true, user: { name: 'adi', role: 'admin' } });
      expect(expiresIn).toBeGreaterThan(3590);
      expect(expiresIn).toBeLessThanOrEqual(3600);
    }
  });

  it('answers 401 for an expired cookie', async () => {
    const expired = app.jwt.sign({ sub: 'ana', role: 'viewer', ...CLAIMS, exp: Math.floor(Date.now() / 1000) - 60 });
    expect((await app.inject({ url: '/api/auth/me', headers: cookieOnly(expired) })).statusCode).toBe(401);
  });
});

describe('CSRF check on cookie requests (tracker SC-11)', () => {
  const ack = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/api/problems/acknowledge', headers });
  const operator = () => tokenFor('olu', 'operator');

  it('refuses a cookie POST without the X-HCML-CSRF header', async () => {
    const res = await ack(cookieOnly(operator()));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'csrf', message: expect.stringContaining('X-HCML-CSRF') });
    // Any value but 1 is not the header either.
    expect((await ack({ ...page(operator()), 'x-hcml-csrf': 'yes' })).statusCode).toBe(403);
  });

  it('refuses a cookie POST whose Origin is another site, or "null"', async () => {
    for (const origin of ['https://evil.example', `http://${HOST.replace('8081', '8082')}`, 'null']) {
      const res = await ack({ ...page(operator()), origin });
      expect(res.statusCode, origin).toBe(403);
      expect(res.json().error).toBe('csrf');
    }
  });

  it('lets a cookie POST through with the header and the page\'s own origin, or with no Origin at all', async () => {
    expect((await ack(page(operator()))).statusCode).toBe(200);
    const { origin: _, ...noOrigin } = page(operator());
    expect((await ack(noOrigin)).statusCode).toBe(200);
  });

  it('asks nothing of a Bearer request, which a cross-site page cannot send', async () => {
    const res = await ack({ ...bearer(operator()), origin: 'https://evil.example', cookie: `hcml_session=${operator()}` });
    expect(res.statusCode).toBe(200);
  });

  it('leaves GET alone: a cookie GET needs no header', async () => {
    expect((await app.inject({ url: '/api/hosts', headers: { ...cookieOnly(operator()), origin: 'https://evil.example' } })).statusCode).toBe(200);
  });
});

describe('POST /api/auth/logout', () => {
  const logout = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/api/auth/logout', headers });

  it('clears the cookie with the same attributes, with or without a cookie, even an expired one', async () => {
    const expired = app.jwt.sign({ sub: 'ana', role: 'viewer', ...CLAIMS, exp: Math.floor(Date.now() / 1000) - 60 });
    // A token of its own: signing out ends it, and tokenFor would hand later tests the same one.
    const own = app.jwt.sign({ sub: 'ana', role: 'viewer', ...CLAIMS, jti: 'clears-the-cookie' }, { expiresIn: '1h' });
    for (const token of [own, expired, undefined]) {
      const res = await logout(page(token));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      const c = sessionCookie(res);
      expect(c).toMatchObject({ value: '', maxAge: 0, httpOnly: true, sameSite: 'Strict', path: '/' });
      expect((c?.expires as Date).getTime()).toBe(0);
    }
  });

  it('needs the X-HCML-CSRF header like any POST that touches the cookie', async () => {
    const { 'x-hcml-csrf': _, ...noHeader } = page(tokenFor('ana', 'viewer'));
    const res = await logout(noHeader);
    expect(res.statusCode).toBe(403);
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('ends the token it signs out, so a copy of it is refused by cookie and by Bearer header', async () => {
    const token = app.jwt.sign({ sub: 'ana', role: 'viewer', ...CLAIMS }, { expiresIn: '3h' });
    expect((await app.inject({ url: '/api/hosts', headers: cookieOnly(token) })).statusCode).toBe(200);
    expect((await logout(page(token))).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/hosts', headers: cookieOnly(token) })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/hosts', headers: { host: HOST, ...bearer(token) } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/auth/me', headers: cookieOnly(token) })).statusCode).toBe(401);
  });

  it('gives two sign-ins of one user in the same second tokens of their own, so signing one out leaves the other', async () => {
    const signIn = () => app.inject({ method: 'POST', url: '/api/auth/login', headers: page(), payload: { username: 'ana', password: 'viewer-pass' } });
    const [a, b] = [sessionCookie(await signIn())!.value, sessionCookie(await signIn())!.value];
    expect(a).not.toBe(b);
    await logout(page(a));
    expect((await app.inject({ url: '/api/hosts', headers: cookieOnly(a) })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/hosts', headers: cookieOnly(b) })).statusCode).toBe(200);
  });

  it('ends only that token: another session of the same user keeps working', async () => {
    const one = app.jwt.sign({ sub: 'ana', role: 'viewer', ...CLAIMS }, { expiresIn: '4h' });
    const other = app.jwt.sign({ sub: 'ana', role: 'viewer', ...CLAIMS }, { expiresIn: '5h' });
    await logout(page(one));
    expect((await app.inject({ url: '/api/hosts', headers: cookieOnly(other) })).statusCode).toBe(200);
  });

  describe('a signed-out session stays signed out (SC-39, SC-40)', () => {
    const signIn = () => app.inject({ method: 'POST', url: '/api/auth/login', headers: page(), payload: { username: 'ana', password: 'viewer-pass' } });
    const renew = async (token: string) => sessionCookie(await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: page(token) }))?.value;
    const hosts = async (headers: Record<string, string>) => (await app.inject({ url: '/api/hosts', headers })).statusCode;

    it('refuses the token whatever the case of the scheme', async () => {
      const token = sessionCookie(await signIn())!.value;
      const accepted = [`Bearer ${token}`, `bearer ${token}`, `BEARER ${token}`];
      // The JWT library takes one space only, so these were never a way in.
      const never = [`Bearer  ${token}`, `Bearer\t${token}`];
      for (const authorization of accepted) expect(await hosts({ host: HOST, authorization }), `before: ${authorization.slice(0, 8)}`).toBe(200);
      for (const authorization of never) expect(await hosts({ host: HOST, authorization }), `before: ${JSON.stringify(authorization.slice(0, 8))}`).toBe(401);
      expect((await logout(page(token))).statusCode).toBe(200);
      for (const authorization of [...accepted, ...never]) expect(await hosts({ host: HOST, authorization }), `after: ${JSON.stringify(authorization.slice(0, 8))}`).toBe(401);
      expect(await hosts(cookieOnly(token))).toBe(401);
    });

    it('signs a token out when it arrives as a header written bearer and no cookie comes with it', async () => {
      const token = sessionCookie(await signIn())!.value;
      expect((await logout({ ...page(), authorization: `bearer ${token}` })).statusCode).toBe(200);
      expect(await hosts(cookieOnly(token))).toBe(401);
      expect(await hosts({ host: HOST, authorization: `Bearer ${token}` })).toBe(401);
    });

    it('carries one session id through the renewals, and gives each token an id of its own', async () => {
      const first = sessionCookie(await signIn())!.value;
      const second = (await renew(first))!;
      const [a, b] = [first, second].map((t) => app.jwt.decode(t) as { sid?: string; jti?: string });
      expect(a.sid).toBeTruthy();
      expect(b.sid).toBe(a.sid);
      expect(b.jti).not.toBe(a.jti);
    });

    it('ends every token of the session when one of them is signed out: the one it was renewed from, and the one it came to', async () => {
      const first = sessionCookie(await signIn())!.value;
      const second = (await renew(first))!;
      expect(await hosts(cookieOnly(first))).toBe(200);
      expect(await hosts(cookieOnly(second))).toBe(200);
      await logout(page(second));
      expect(await hosts(cookieOnly(first))).toBe(401);
      expect(await hosts(cookieOnly(second))).toBe(401);
    });

    it('stops a copy from renewing once the session is signed out, so its renewals do not outlive it', async () => {
      const mine = sessionCookie(await signIn())!.value;
      const copy = (await renew(mine))!; // what someone who copied the cookie holds, and renews on
      const copyRenewed = (await renew(copy))!;
      await logout(page(mine));
      expect(await renew(copy)).toBeUndefined();
      expect(await renew(copyRenewed)).toBeUndefined();
      expect(await hosts(cookieOnly(copyRenewed))).toBe(401);
    });

    it('leaves another session of the same user alone', async () => {
      const [one, other] = [sessionCookie(await signIn())!.value, sessionCookie(await signIn())!.value];
      await logout(page(one));
      expect(await hosts(cookieOnly(other))).toBe(200);
      expect(await renew(other)).toBeTruthy();
    });

    it('takes a token with only a jti, as the sign-ins before this change made, as its own session, and carries it on', async () => {
      const old = app.jwt.sign({ sub: 'ana', role: 'viewer', ...CLAIMS, jti: 'issued-before-sessions' }, { expiresIn: '3h' });
      const renewed = (await renew(old))!;
      expect((app.jwt.decode(renewed) as { sid?: string }).sid).toBe('issued-before-sessions');
      await logout(page(renewed));
      expect(await hosts(cookieOnly(old))).toBe(401);
    });

    it('remembers the session for as long as any of its tokens could last, even when later sign-outs clear out the old entries', async () => {
      const token = sessionCookie(await signIn())!.value;
      await logout(page(token));
      vi.useFakeTimers({ now: Date.now() + 11 * 3600_000, toFake: ['Date'] });
      try {
        // Eleven of the twelve hours have gone: the token itself would still verify, so only the list keeps it out.
        const later = sessionCookie(await signIn())!.value;
        await logout(page(later));
        expect(await hosts(cookieOnly(token))).toBe(401);
      } finally {
        vi.useRealTimers();
      }
    });

    it('remembers it for a whole session length from the sign-out, not only until the token it was signed out with runs out', async () => {
      const start = Date.now();
      const first = sessionCookie(await signIn())!.value;
      vi.useFakeTimers({ now: start + 6 * 3600_000, toFake: ['Date'] });
      try {
        const renewed = (await renew(first))!; // good until eighteen hours after the first sign-in
        expect((await logout(page(first))).statusCode).toBe(200); // the token that ends first
        vi.setSystemTime(start + 13 * 3600_000); // the first token has run out, the renewed one has five hours left
        await logout(page(sessionCookie(await signIn())!.value)); // a sign-out clears the entries that have run out
        expect(await hosts(cookieOnly(renewed))).toBe(401);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not remember a token this portal did not sign, so made-up ones cannot push a real entry out of the list', async () => {
      const real = sessionCookie(await signIn())!.value;
      await logout(page(real));
      // The list holds 10,000 sessions at most and drops the oldest first.
      for (let i = 0; i < 10_050; i += 1) await logout(page(`forged-${i}`));
      expect(await hosts(cookieOnly(real))).toBe(401);
    }, 60_000);
  });
});

describe('with auth off', () => {
  it('reports no session length, and still checks the cookie routes for the CSRF header', async () => {
    vi.resetModules();
    vi.stubEnv('AUTH_ENABLED', 'false');
    try {
      const fresh = await import('../security/auth.js');
      const open = Fastify({ logger: false });
      await fresh.setupAuth(open);
      await open.ready();
      expect((await open.inject({ url: '/api/auth/me' })).json()).toEqual({
        authEnabled: false,
        user: { name: 'anonymous', role: 'admin' },
        expiresIn: null,
        pages: expect.any(Object),
      });
      expect((await open.inject({ method: 'POST', url: '/api/auth/logout' })).statusCode).toBe(403);
      expect((await open.inject({ method: 'POST', url: '/api/auth/logout', headers: page() })).statusCode).toBe(200);
      await open.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('SESSION_COOKIE', () => {
  it('renames the cookie, and only that name opens the portal', async () => {
    vi.resetModules();
    vi.stubEnv('SESSION_COOKIE', 'hcml_session_ollama');
    try {
      const fresh = await import('../security/auth.js');
      const other = Fastify({ logger: false });
      await fresh.setupAuth(other);
      other.get('/api/hosts', async () => ({ ok: 'hosts' }));
      await other.ready();
      const res = await other.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: page(),
        payload: { username: 'ana', password: 'viewer-pass' },
      });
      expect(sessionCookie(res)).toBeUndefined();
      const token = sessionCookie(res, 'hcml_session_ollama')!.value;
      expect((await other.inject({ url: '/api/hosts', headers: { cookie: `hcml_session_ollama=${token}` } })).statusCode).toBe(200);
      expect((await other.inject({ url: '/api/hosts', headers: { cookie: `hcml_session=${token}` } })).statusCode).toBe(401);
      await other.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('POST /api/auth/refresh', () => {
  const refresh = (headers: Record<string, string> = {}, url = '/api/auth/refresh') =>
    app.inject({ method: 'POST', url, headers });
  const claims = (token: string) => app.jwt.decode(token) as { sub: string; role: string; iat: number; exp: number };
  /** The renewed token, which now arrives only in the cookie. */
  const renewed = (res: Parameters<typeof sessionCookie>[0]) => sessionCookie(res)!.value;

  // The fresh token comes back in the cookie, the body says how long it lasts.
  it('swaps a valid cookie for a fresh twelve-hour one for the same user, and that cookie opens the portal', async () => {
    const old = tokenFor('ana', 'viewer');
    const res = await refresh(page(old));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: { name: 'ana', role: 'viewer' }, expiresIn: 43200 });
    expect(sessionCookie(res)).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/', maxAge: 43200 });
    const fresh = claims(renewed(res));
    expect(fresh.sub).toBe('ana');
    expect(fresh.exp - fresh.iat).toBe(12 * 3600);
    expect(fresh.exp).toBeGreaterThan(claims(old).exp);
    expect(res.body).not.toContain(renewed(res));
    expect((await app.inject({ url: '/api/hosts', headers: cookieOnly(renewed(res)) })).statusCode).toBe(200);
  });

  it('renews with a Bearer header too, which needs no CSRF header', async () => {
    const res = await refresh(bearer(tokenFor('ana', 'viewer')));
    expect(res.statusCode).toBe(200);
    expect(claims(renewed(res)).sub).toBe('ana');
  });

  it('refuses a cookie renewal without the X-HCML-CSRF header', async () => {
    const res = await refresh(cookieOnly(tokenFor('ana', 'viewer')));
    expect(res.statusCode).toBe(403);
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('answers 401 with no token, an expired one, a malformed one, or one signed with another secret', async () => {
    const foreign = Fastify();
    await foreign.register((await import('@fastify/jwt')).default, { secret: 'a-different-secret-entirely-32-bytes' });
    await foreign.ready();
    const forged = foreign.jwt.sign({ sub: 'adi', role: 'admin' });
    await foreign.close();
    const expired = app.jwt.sign({ sub: 'ana', role: 'viewer', ...CLAIMS, exp: Math.floor(Date.now() / 1000) - 60 });
    for (const headers of [{}, bearer(expired), bearer('not-a-jwt'), bearer(forged), page(expired), page('not-a-jwt'), page(forged)]) {
      expect((await refresh(headers)).statusCode).toBe(401);
    }
  });

  it('refuses a token sent as ?token=, like every route', async () => {
    expect((await refresh({}, `/api/auth/refresh?token=${tokenFor('ana', 'viewer')}`)).statusCode).toBe(401);
  });

  it('refuses a user no longer in PORTAL_USERS, even with a valid token, and sets no cookie', async () => {
    for (const headers of [bearer(tokenFor('gone', 'admin')), page(tokenFor('gone', 'admin'))]) {
      const res = await refresh(headers);
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('unauthorized');
      expect(sessionCookie(res)).toBeUndefined();
    }
  });

  it('takes the role from the current user list, not from the old token', async () => {
    const res = await refresh(page(tokenFor('ana', 'admin')));
    expect(res.json().user).toEqual({ name: 'ana', role: 'viewer' });
    expect(claims(renewed(res)).role).toBe('viewer');
  });

  it('refuses a name PORTAL_USERS lists twice, rather than renewing into the first entry\'s role', async () => {
    const saved = process.env.PORTAL_USERS;
    process.env.PORTAL_USERS = 'shared:admin-pass:admin,shared:wall-pass:viewer';
    const warnings: string[] = [];
    const dup = Fastify({ logger: false });
    try {
      dup.log.warn = ((m: unknown) => void warnings.push(String(m))) as typeof dup.log.warn;
      await setupAuth(dup);
      await dup.ready();
      const login = await dup.inject({ method: 'POST', url: '/api/auth/login', headers: page(), payload: { username: 'shared', password: 'wall-pass' } });
      expect(login.json().user).toEqual({ name: 'shared', role: 'viewer' });
      const res = await dup.inject({ method: 'POST', url: '/api/auth/refresh', headers: page(sessionCookie(login)!.value) });
      expect(res.statusCode).toBe(401);
      expect(warnings.join(' ')).toContain('names "shared" more than once');
      for (const secret of ['admin-pass', 'wall-pass']) expect(warnings.join(' ')).not.toContain(secret);
    } finally {
      process.env.PORTAL_USERS = saved;
      await dup.close();
    }
  });

  it('is a POST only: a GET cannot renew', async () => {
    for (const headers of [bearer(tokenFor('ana', 'viewer')), cookieOnly(tokenFor('ana', 'viewer'))]) {
      const res = await app.inject({ url: '/api/auth/refresh', headers });
      expect(res.statusCode).toBe(404);
      expect(sessionCookie(res)).toBeUndefined();
    }
  });
});
