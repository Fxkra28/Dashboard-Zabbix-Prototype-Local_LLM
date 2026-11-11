import { afterEach, describe, expect, it, vi } from 'vitest';
import { bearer, buildAuthApp, closeAuthApps, page } from './helpers/authApp.js';

/**
 * What a session token is worth. It names its portal (issuer and audience, from the session cookie
 * name) and its user, who is looked up again on every request: a user taken out of PORTAL_USERS is
 * refused, and the role in force is the one configured now.
 *
 * Taking a user out or changing a role means restarting the BFF, so "the same token before and
 * after" is two apps built from two environments, with one JWT_SECRET between them.
 */
afterEach(async () => {
  vi.unstubAllEnvs();
  await closeAuthApps();
});

const ME = '/api/auth/me';
const refresh = (app: Awaited<ReturnType<typeof buildAuthApp>>['app'], token: string) =>
  app.inject({ method: 'POST', url: '/api/auth/refresh', headers: page(token) });

describe('tokens are bound to this portal', () => {
  it('carry an issuer and an audience made from the session cookie name', async () => {
    for (const [env, name] of [[{}, 'hcml_session'], [{ SESSION_COOKIE: 'hcml_session_ollama' }, 'hcml_session_ollama']] as const) {
      const { app, signIn, cookieOf } = await buildAuthApp(env);
      const token = cookieOf(await signIn('ana', 'viewer-pass'), name)!;
      expect(app.jwt.decode(token)).toMatchObject({ iss: `hcml-portal:${name}`, aud: `hcml-portal:${name}`, sub: 'ana', role: 'viewer' });
    }
  });

  it('are refused without an issuer or audience, or with the wrong ones, though the secret is right', async () => {
    const { app } = await buildAuthApp();
    const good = { iss: 'hcml-portal:hcml_session', aud: 'hcml-portal:hcml_session' };
    const sign = (claims: object) => app.jwt.sign({ sub: 'ana', role: 'viewer', ...claims }, { expiresIn: '1h' });
    // The control: the same token with both claims right is let in, on every route that reads a token.
    const ok = sign(good);
    expect((await app.inject({ url: '/api/hosts', headers: bearer(ok) })).statusCode).toBe(200);
    expect((await app.inject({ url: ME, headers: bearer(ok) })).statusCode).toBe(200);
    expect((await refresh(app, ok)).statusCode).toBe(200);

    const refused = {
      'neither claim (a token from before this change)': sign({}),
      'no audience': sign({ iss: good.iss }),
      'no issuer': sign({ aud: good.aud }),
      'another portal as issuer': sign({ ...good, iss: 'hcml-portal:hcml_session_ollama' }),
      'another portal as audience': sign({ ...good, aud: 'hcml-portal:hcml_session_ollama' }),
      'an unrelated audience': sign({ ...good, aud: 'somewhere-else' }),
    };
    for (const [why, token] of Object.entries(refused)) {
      for (const headers of [bearer(token), page(token)]) {
        expect((await app.inject({ url: '/api/hosts', headers })).statusCode, `hosts, ${why}`).toBe(401);
        expect((await app.inject({ url: ME, headers })).statusCode, `me, ${why}`).toBe(401);
        expect((await refresh(app, token)).statusCode, `refresh, ${why}`).toBe(401);
      }
    }
  });

  it('from one copy do not open the other, though both share JWT_SECRET and the user list', async () => {
    const hosted = await buildAuthApp();
    const hostedToken = hosted.cookieOf(await hosted.signIn('adi', 'admin-pass'))!;
    const local = await buildAuthApp({ SESSION_COOKIE: 'hcml_session_ollama' });
    const localToken = local.cookieOf(await local.signIn('adi', 'admin-pass'), 'hcml_session_ollama')!;

    // Each opens its own portal.
    expect((await hosted.app.inject({ url: '/api/hosts', headers: bearer(hostedToken) })).statusCode).toBe(200);
    expect((await local.app.inject({ url: '/api/hosts', headers: bearer(localToken) })).statusCode).toBe(200);
    // Neither opens the other, as a Bearer header or under the other's cookie name.
    expect((await local.app.inject({ url: '/api/hosts', headers: bearer(hostedToken) })).statusCode).toBe(401);
    expect((await hosted.app.inject({ url: '/api/hosts', headers: bearer(localToken) })).statusCode).toBe(401);
    expect((await local.app.inject({ url: '/api/hosts', headers: page(hostedToken, 'hcml_session_ollama') })).statusCode).toBe(401);
    expect((await refresh(local.app, hostedToken)).statusCode).toBe(401);
  });
});

describe('the user is looked up on every request', () => {
  const WITH_ANA = 'ana:viewer-pass:operator,olu:operator-pass:operator,adi:admin-pass:admin';
  const WITHOUT_ANA = 'olu:operator-pass:operator,adi:admin-pass:admin';

  it('refuses a user who is no longer listed, on guarded routes, on /me and on renewal', async () => {
    const before = await buildAuthApp({ PORTAL_USERS: WITH_ANA });
    const ana = await before.tokenFor('ana', 'viewer-pass');
    const olu = await before.tokenFor('olu', 'operator-pass');
    expect((await before.app.inject({ url: '/api/hosts', headers: bearer(ana) })).statusCode).toBe(200);

    const after = await buildAuthApp({ PORTAL_USERS: WITHOUT_ANA });
    for (const headers of [bearer(ana), page(ana)]) {
      const hosts = await after.app.inject({ url: '/api/hosts', headers });
      expect(hosts.statusCode).toBe(401);
      expect(hosts.json()).toEqual({ error: 'unauthorized', message: 'Sign in to continue.' });
      const me = await after.app.inject({ url: ME, headers });
      expect(me.statusCode).toBe(401);
      expect(me.json().error).toBe('unauthorized');
      expect((await refresh(after.app, ana)).statusCode).toBe(401);
    }
    // A user who is still listed is not affected.
    expect((await after.app.inject({ url: '/api/hosts', headers: bearer(olu) })).statusCode).toBe(200);
  });

  it('uses the role configured now when the user has been demoted: the token\'s admin is a viewer today', async () => {
    const before = await buildAuthApp({ PORTAL_USERS: WITH_ANA });
    const token = await before.tokenFor('ana', 'viewer-pass'); // an operator then
    expect((await before.app.inject({ url: '/api/links', headers: bearer(token) })).statusCode).toBe(200);

    const after = await buildAuthApp({ PORTAL_USERS: 'ana:viewer-pass:viewer' });
    expect((await after.app.inject({ url: '/api/hosts', headers: bearer(token) })).statusCode).toBe(200);
    const links = await after.app.inject({ url: '/api/links', headers: page(token) });
    expect(links.statusCode).toBe(403);
    expect(links.json().message).toContain('you are signed in as "viewer"');
    expect((await after.app.inject({ url: ME, headers: bearer(token) })).json().user).toEqual({ name: 'ana', role: 'viewer' });
    // Code that asks for the request's role (roleOf) sees the current one too.
    expect((await after.app.inject({ url: '/api/whoami', headers: bearer(token) })).json()).toEqual({ role: 'viewer' });
  });

  it('uses the role configured now when the user has been promoted', async () => {
    const before = await buildAuthApp({ PORTAL_USERS: 'ana:viewer-pass:viewer' });
    const token = await before.tokenFor('ana', 'viewer-pass');
    expect((await before.app.inject({ url: '/api/links', headers: bearer(token) })).statusCode).toBe(403);

    const after = await buildAuthApp({ PORTAL_USERS: 'ana:viewer-pass:operator' });
    expect((await after.app.inject({ url: '/api/links', headers: bearer(token) })).statusCode).toBe(200);
    expect((await after.app.inject({ url: '/api/reports/inventory', headers: bearer(token) })).statusCode).toBe(403);
    expect((await after.app.inject({ url: ME, headers: bearer(token) })).json().user.role).toBe('operator');
  });

  it('takes a name listed twice for the roles its entries hold, and no other', async () => {
    const { app, tokenFor } = await buildAuthApp({ PORTAL_USERS: 'dup:admin-pass:admin,dup:view-pass:viewer' });
    const asAdmin = await tokenFor('dup', 'admin-pass');
    const asViewer = await tokenFor('dup', 'view-pass');
    expect((await app.inject({ url: '/api/reports/inventory', headers: bearer(asAdmin) })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/hosts', headers: bearer(asViewer) })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/reports/inventory', headers: bearer(asViewer) })).statusCode).toBe(403);
    // A token claiming a role neither entry holds is not one either of them was given.
    const forged = app.jwt.sign({ sub: 'dup', role: 'operator', iss: 'hcml-portal:hcml_session', aud: 'hcml-portal:hcml_session' }, { expiresIn: '1h' });
    expect((await app.inject({ url: '/api/hosts', headers: bearer(forged) })).statusCode).toBe(401);
  });

  it('matches the name in the token exactly: a differently-cased one is another user', async () => {
    const { app } = await buildAuthApp({ PORTAL_USERS: 'Ana:viewer-pass:viewer' });
    const claims = { role: 'viewer', iss: 'hcml-portal:hcml_session', aud: 'hcml-portal:hcml_session' };
    const named = (sub: string) => bearer(app.jwt.sign({ sub, ...claims }, { expiresIn: '1h' }));
    expect((await app.inject({ url: '/api/hosts', headers: named('Ana') })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/hosts', headers: named('ana') })).statusCode).toBe(401);
  });
});

describe('how long a sign-in lasts, and ending every session at once (SC-14)', () => {
  const claims = { iss: 'hcml-portal:hcml_session', aud: 'hcml-portal:hcml_session' };

  it('lasts twelve hours unless SESSION_HOURS says otherwise, in the token, the cookie and the answer', async () => {
    const cases: [Record<string, string>, number][] = [[{}, 43_200], [{ SESSION_HOURS: '4' }, 14_400], [{ SESSION_HOURS: '2' }, 7_200], [{ SESSION_HOURS: '24' }, 86_400], [{ SESSION_HOURS: '2.5' }, 9_000]];
    for (const [env, seconds] of cases) {
      const { app, signIn, cookieOf } = await buildAuthApp(env);
      const res = await signIn('ana', 'viewer-pass');
      expect(res.json().expiresIn, JSON.stringify(env)).toBe(seconds);
      const { iat, exp } = app.jwt.decode(cookieOf(res)!) as { iat: number; exp: number };
      expect(exp - iat, JSON.stringify(env)).toBe(seconds);
      expect(res.cookies.find((c) => c.name === 'hcml_session')?.maxAge, JSON.stringify(env)).toBe(seconds);
    }
  });

  it('renews for the length now configured, not the one the old token had', async () => {
    const before = await buildAuthApp();
    const token = await before.tokenFor('ana', 'viewer-pass');
    const after = await buildAuthApp({ SESSION_HOURS: '4' });
    const renewed = await refresh(after.app, token);
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json().expiresIn).toBe(14_400);
  });

  it('stamps each token with the epoch it was issued under: 1 by default, else the one set', async () => {
    for (const [env, epoch] of [[{}, '1'], [{ SESSION_EPOCH: '7' }, '7'], [{ SESSION_EPOCH: ' 2026-10 ' }, '2026-10']] as const) {
      const { app, signIn, cookieOf } = await buildAuthApp({ ...env });
      expect(app.jwt.decode(cookieOf(await signIn('ana', 'viewer-pass'))!), JSON.stringify(env)).toMatchObject({ ep: epoch });
    }
  });

  it('ends every session when the epoch is raised, on every route that reads a token, and renewal too', async () => {
    const before = await buildAuthApp();
    const token = await before.tokenFor('ana', 'viewer-pass');
    // The control: under the epoch it was issued in, the token works everywhere.
    expect((await before.app.inject({ url: '/api/hosts', headers: bearer(token) })).statusCode).toBe(200);

    // The same secret, the same users, one number higher.
    const after = await buildAuthApp({ SESSION_EPOCH: '2' });
    for (const headers of [bearer(token), page(token)]) {
      expect((await after.app.inject({ url: '/api/hosts', headers })).statusCode).toBe(401);
      expect((await after.app.inject({ url: ME, headers })).statusCode).toBe(401);
      expect((await refresh(after.app, token)).statusCode).toBe(401);
    }
    // Signing in again works, and the new token opens it.
    const fresh = await after.tokenFor('ana', 'viewer-pass');
    expect((await after.app.inject({ url: '/api/hosts', headers: bearer(fresh) })).statusCode).toBe(200);
    // And going back to the old number does not bring the old sessions back for a token issued under 2.
    const back = await buildAuthApp({ SESSION_EPOCH: '1' }); // named, because the stub of the build above would otherwise stay
    expect((await back.app.inject({ url: '/api/hosts', headers: bearer(fresh) })).statusCode).toBe(401);
  });

  it('lets a token from before the epoch existed through while the epoch is 1, and refuses it once it is raised', async () => {
    const { app } = await buildAuthApp();
    const old = app.jwt.sign({ sub: 'ana', role: 'viewer', ...claims }, { expiresIn: '1h' }); // no ep claim
    expect((await app.inject({ url: '/api/hosts', headers: bearer(old) })).statusCode).toBe(200);
    expect((await refresh(app, old)).statusCode).toBe(200);

    const raised = await buildAuthApp({ SESSION_EPOCH: '2' });
    expect((await raised.app.inject({ url: '/api/hosts', headers: bearer(old) })).statusCode).toBe(401);
  });
});
