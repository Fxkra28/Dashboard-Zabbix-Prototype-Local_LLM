import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { requiredRole, roleAllows, setupAuth, tokenClaims } from '../security/auth.js';
import { MODULE_IDS, accessOf, grantable, judge, presetFor, refusalText, roleFromName, ruleFor } from '../security/modules.js';
import { registerErrorHandler } from '../http/errors.js';
import { sliExportRoutes } from '../routes/sliExport.js';
import { sampleSliReports } from './helpers/sliReportFixture.js';

vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer,olu:operator-pass:operator,adi:admin-pass:admin';
});

// The Zabbix read behind the export: the guard is what these tests are about, and it decides before any handler runs.
const { sliMock } = vi.hoisted(() => ({ sliMock: vi.fn() }));
vi.mock('../services/sli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/sli.js')>();
  return { ...actual, getMonthlySli: sliMock };
});

/**
 * The routes are an ordered regex table where the first match wins and anything unmatched is closed to everyone but administrators (modules.ts). A typo in one pattern
 * silently moves an endpoint, no error, no log line, just an admin report served to any signed-in user. This table is the only thing that would catch it.
 */
describe('requiredRole', () => {
  const cases: [string, ReturnType<typeof requiredRole>][] = [
    ['/api/reports/inventory', 'admin'],
    ['/api/users', 'admin'],
    ['/api/users/:name', 'admin'],
    ['/api/users/:name/password', 'admin'],
    ['/api/links', 'guest'],
    ['/api/net/devices', 'guest'],
    ['/api/net/interfaces', 'guest'],
    ['/api/net/meters', 'guest'],
    ['/api/sli/email', 'admin'],
    ['/api/sli/schedule', 'admin'],
    ['/api/sli/recipients', 'admin'],
    ['/api/problems/acknowledge', 'operator'],
    ['/api/problems/close', 'operator'],
    ['/api/hosts', 'guest'],
    ['/api/devices', 'guest'],
    ['/api/reports/top-hosts', 'guest'],
    ['/api/reports/web-monitoring', 'guest'],
    ['/api/problems', 'guest'],
    ['/api/reports/availability', 'guest'],
    ['/api/reports/noise', 'guest'],
    ['/api/sla', 'guest'],
    ['/api/sli', 'guest'],
    ['/api/sli/export', 'guest'],
    ['/api/explain/problem', 'guest'],
    ['/api/chat', 'guest'],
    ['/api/auth/password', 'guest'],
  ];

  it.each(cases)('%s requires %s', (url, role) => {
    expect(requiredRole(url)).toBe(role);
  });

  it('fails closed on an unknown route', () => {
    // A route added without a row must still demand a login, and then an administrator, never be open.
    expect(requiredRole('/api/something-invented-later')).toBe('admin');
    expect(ruleFor('/api/something-invented-later')).toBeUndefined();
  });

  it('gives the item, latest-data and map-detail routes to the pages that use them, and the network routes to the Network module alone (SC-20)', () => {
    // Not by a route rule on the role: these routes serve the Graphs, Latest data and Maps pages. viewerPolicy.ts cuts the
    // net.if items and the network hosts for an account without the Network module; viewer-network.test.ts pins that.
    for (const url of ['/api/items', '/api/latest', '/api/maps/detail', '/api/maps', '/api/graph']) {
      expect(requiredRole(url), url).toBe('guest');
      expect(ruleFor(url)!.modules, url).not.toContain('network');
    }
    for (const url of ['/api/net/devices', '/api/net/interfaces', '/api/net/meters']) expect(ruleFor(url)!.modules, url).toEqual(['network']);
  });

  it('keeps the SLA download at guest, whatever else shares its prefix', () => {
    // /api/sli/export must not inherit a stricter rule from a neighbour, nor be left public by one.
    expect(requiredRole('/api/sli/export')).toBe('guest');
    expect(requiredRole('/api/sli/export/anything')).toBe('guest');
    expect(ruleFor('/api/sli/export')!.modules).toEqual(['sla']);
  });

  it('does not let a prefix collision leak the admin report', () => {
    // `/api/reports/inventory` is admin; its siblings must not inherit that,
    // and nothing else may accidentally match the inventory pattern.
    expect(requiredRole('/api/reports/aging')).toBe('guest');
    expect(requiredRole('/api/reports/capacity')).toBe('guest');
    expect(ruleFor('/api/reports/inventory')!.modules).toEqual(['inventory']);
  });

  it('knows the roles an older .env or session names', () => {
    expect(roleFromName('viewer')).toBe('guest');
    expect(roleFromName('wall')).toBe('guest');
    expect(roleFromName('guest')).toBe('guest');
    expect(roleFromName('operator')).toBe('operator');
    expect(roleFromName('superuser')).toBeUndefined();
    expect(roleFromName(7)).toBeUndefined();
  });

  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'isPrototypeOf'])('reads the name of an object property, %s, as no role (BK-101)', (name) => {
    expect(roleFromName(name)).toBeUndefined();
  });
});

describe('roleAllows', () => {
  it('permits equal or higher rank only', () => {
    expect(roleAllows('admin', 'guest')).toBe(true);
    expect(roleAllows('admin', 'operator')).toBe(true);
    expect(roleAllows('admin', 'admin')).toBe(true);
    expect(roleAllows('operator', 'guest')).toBe(true);
    expect(roleAllows('operator', 'operator')).toBe(true);
    expect(roleAllows('guest', 'guest')).toBe(true);
  });

  it('refuses to escalate', () => {
    expect(roleAllows('guest', 'operator')).toBe(false);
    expect(roleAllows('guest', 'admin')).toBe(false);
    expect(roleAllows('operator', 'admin')).toBe(false);
  });
});

describe('judge: the role and then the modules', () => {
  const guest = accessOf('guest', ['dashboard', 'problems']);
  const operator = accessOf('operator', ['problems']);
  const admin = accessOf('admin', []);

  it('lets in a user who holds one of the modules that own the route, and refuses the rest', () => {
    expect(judge(guest, '/api/problems')).toEqual({ ok: true });
    expect(judge(guest, '/api/stats')).toEqual({ ok: true });
    expect(judge(guest, '/api/sla')).toEqual({ ok: false, why: 'module', modules: ['sla', 'services'] });
    expect(judge(guest, '/api/net/devices')).toEqual({ ok: false, why: 'module', modules: ['network'] });
  });

  it('asks for the role first, so a module cannot stand in for one', () => {
    expect(judge(guest, '/api/problems/acknowledge')).toEqual({ ok: false, why: 'role', needs: 'operator' });
    expect(judge(operator, '/api/problems/acknowledge')).toEqual({ ok: true });
    // Holding the module is not holding the role, and the other way round.
    expect(judge(accessOf('operator', ['sla']), '/api/problems/acknowledge')).toEqual({ ok: false, why: 'module', modules: ['problems'] });
  });

  it('keeps an admin-only route for administrators, whatever the grants say', () => {
    expect(judge(accessOf('guest', ['sla', 'inventory', 'users']), '/api/sli/email')).toEqual({ ok: false, why: 'role', needs: 'admin' });
    expect(judge(accessOf('operator', ['inventory']), '/api/reports/inventory')).toEqual({ ok: false, why: 'role', needs: 'admin' });
    expect(judge(accessOf('operator', ['users']), '/api/users')).toEqual({ ok: false, why: 'role', needs: 'admin' });
    expect(judge(admin, '/api/users')).toEqual({ ok: true });
    expect(judge(admin, '/api/sli/email')).toEqual({ ok: true });
  });

  it('closes a route with no row to everyone but administrators', () => {
    expect(judge(guest, '/api/invented')).toEqual({ ok: false, why: 'closed' });
    expect(judge(operator, '/api/invented')).toEqual({ ok: false, why: 'closed' });
    expect(judge(admin, '/api/invented')).toEqual({ ok: true });
  });

  it('leaves the routes every signed-in user needs to everyone', () => {
    expect(judge(accessOf('guest', []), '/api/auth/refresh')).toEqual({ ok: true });
    expect(judge(accessOf('guest', []), '/api/auth/password')).toEqual({ ok: true });
  });

  it('never gives a role a module whose page it cannot reach: an administrator\'s pages are the administrator\'s', () => {
    expect([...accessOf('guest', ['inventory', 'users', 'sla']).modules]).toEqual(['sla']);
    expect([...accessOf('operator', ['users', 'network']).modules]).toEqual(['network']);
    expect(accessOf('admin', []).modules.size).toBe(MODULE_IDS.length);
  });

  it('says why in words', () => {
    expect(refusalText({ ok: false, why: 'role', needs: 'operator' }, 'guest')).toBe('This view needs the "operator" role; you are signed in as "guest".');
    expect(refusalText({ ok: false, why: 'module', modules: ['sla', 'services'] }, 'guest')).toBe('Your account does not have SLA or Services. Ask an administrator for access.');
    expect(refusalText({ ok: false, why: 'closed' }, 'guest')).toBe('This view is for administrators.');
  });

  it('starts a new user of each role from the pages that role is meant for', () => {
    expect(presetFor('guest')).not.toContain('network');
    expect(presetFor('operator')).toEqual(expect.arrayContaining(['network', 'links', 'sla']));
    expect(presetFor('operator')).not.toContain('inventory');
    expect(presetFor('admin')).toEqual([...MODULE_IDS]);
    expect(grantable('guest')).not.toContain('users');
    expect(grantable('admin')).toContain('users');
  });
});

/**
 * The real download route behind the real guard, mounted as index.ts mounts them:
 * error handler, setupAuth, then the routes. Same login rules as the others: a
 * viewer is enough, and a token is read from the header or the session cookie only.
 */
describe('GET /api/sli/export behind the guard', () => {
  let app: FastifyInstance;
  const url = '/api/sli/export?month=2026-08&format=pdf';

  beforeAll(async () => {
    const reports = sampleSliReports();
    sliMock.mockImplementation(async (_month: string, profile: string) => (profile === 'availability' ? reports.strict : reports.hcml));
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    await setupAuth(app);
    await app.register(sliExportRoutes);
    await app.ready();
  });
  afterAll(() => app.close());

  // Carries this portal's issuer and audience, and a user still in PORTAL_USERS, or the guard refuses it.
  const tokenFor = (sub: string, role: string) => app.jwt.sign({ sub, role, ...tokenClaims('hcml_session') }, { expiresIn: '1h' });
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const cookie = (token: string) => ({ host: '127.0.0.1:8081', cookie: `hcml_session=${token}` });
  const calls = () => sliMock.mock.calls.length;

  it('answers 401 with no token, and does no work for it', async () => {
    const before = calls();
    const res = await app.inject({ url });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized', message: 'Sign in to continue.' });
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(calls()).toBe(before);
  });

  it('asks for the token before it looks at the request, so a bad format or month reads 401 too', async () => {
    for (const bad of ['?month=nope&format=pdf', '?month=2026-08&format=csv', '']) {
      expect((await app.inject({ url: `/api/sli/export${bad}` })).statusCode, bad).toBe(401);
    }
  });

  it('lets a viewer have the PDF and the workbook', async () => {
    const headers = bearer(tokenFor('ana', 'viewer'));
    const pdf = await app.inject({ url, headers });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const xlsx = await app.inject({ url: '/api/sli/export?month=2026-08&format=xlsx', headers });
    expect(xlsx.statusCode).toBe(200);
    expect([...xlsx.rawPayload.subarray(0, 2)]).toEqual([0x50, 0x4b]);
  });

  it('lets an operator and an admin have it too', async () => {
    for (const [user, role] of [['olu', 'operator'], ['adi', 'admin']]) {
      expect((await app.inject({ url, headers: bearer(tokenFor(user, role)) })).statusCode, role).toBe(200);
    }
  });

  it('serves a token with a role that does not exist as the user\'s own role, a viewer, which is enough', async () => {
    expect((await app.inject({ url, headers: bearer(tokenFor('ana', 'superuser')) })).statusCode).toBe(200);
  });

  it('answers 401 for a user who is no longer listed, however valid the token', async () => {
    expect((await app.inject({ url, headers: bearer(tokenFor('eve', 'viewer')) })).statusCode).toBe(401);
  });

  it('answers 401 for a malformed token, one signed with another secret, and an expired one', async () => {
    const foreign = Fastify();
    await foreign.register((await import('@fastify/jwt')).default, { secret: 'a-different-secret-entirely-32-bytes' });
    await foreign.ready();
    const forged = foreign.jwt.sign({ sub: 'adi', role: 'admin' });
    await foreign.close();
    const expired = app.jwt.sign({ sub: 'ana', role: 'viewer', ...tokenClaims('hcml_session'), exp: Math.floor(Date.now() / 1000) - 60 });

    for (const token of ['not-a-jwt', forged, expired]) {
      const res = await app.inject({ url, headers: bearer(token) });
      expect(res.statusCode).toBe(401);
      expect(res.headers['content-disposition']).toBeUndefined();
    }
  });

  it('refuses ?token= in the query, as on every route, and still takes the header', async () => {
    const token = tokenFor('ana', 'viewer');
    expect((await app.inject({ url: `${url}&token=${token}` })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: bearer(token) })).statusCode).toBe(200);
    // The guard takes the header and pays the junk no mind; the route then turns the stray parameter away.
    const stray = await app.inject({ url: `${url}&token=junk`, headers: bearer(token) });
    expect(stray.statusCode).toBe(400);
    expect(stray.json()).toMatchObject({ message: 'Only month, from, to, dayHours, days, format, decimal, date and separator are accepted.' });
  });

  it('takes the session cookie, which is how a browser download arrives', async () => {
    const res = await app.inject({ url, headers: cookie(tokenFor('ana', 'viewer')) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('HCML_SLA_Report_2026-08.pdf');
  });

  it('guards the path the router decodes, not the raw URL text', async () => {
    expect((await app.inject({ url: '/%61pi/sli/export?month=2026-08&format=pdf' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/sli/%65xport?month=2026-08&format=pdf' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'HEAD', url })).statusCode).toBe(401);
  });
});
