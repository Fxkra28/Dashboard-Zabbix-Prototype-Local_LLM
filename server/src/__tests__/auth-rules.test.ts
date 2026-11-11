import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { requiredRole, roleAllows, setupAuth, tokenClaims } from '../security/auth.js';
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
 * The route rules are an ordered regex list where the first match wins and
 * anything unmatched falls back to `viewer`. A typo in one pattern silently
 * downgrades an endpoint, no error, no log line, just an admin report served
 * to any signed-in user. This table is the only thing that would catch it.
 */
describe('requiredRole', () => {
  const cases: [string, ReturnType<typeof requiredRole>][] = [
    ['/api/reports/inventory', 'admin'],
    ['/api/links', 'wall'],
    ['/api/net/devices', 'wall'],
    ['/api/net/interfaces', 'wall'],
    ['/api/net/meters', 'wall'],
    ['/api/sli/email', 'admin'],
    ['/api/sli/schedule', 'admin'],
    ['/api/sli/recipients', 'admin'],
    ['/api/problems/acknowledge', 'operator'],
    ['/api/problems/close', 'operator'],
    ['/api/hosts', 'viewer'],
    ['/api/devices', 'viewer'],
    ['/api/reports/top-hosts', 'viewer'],
    ['/api/reports/web-monitoring', 'viewer'],
    ['/api/problems', 'viewer'],
    ['/api/reports/availability', 'viewer'],
    ['/api/reports/noise', 'viewer'],
    ['/api/sla', 'viewer'],
    ['/api/sli', 'viewer'],
    ['/api/sli/export', 'viewer'],
    ['/api/explain/problem', 'viewer'],
    ['/api/chat', 'viewer'],
  ];

  it.each(cases)('%s requires %s', (url, role) => {
    expect(requiredRole(url)).toBe(role);
  });

  it('fails closed on an unknown route', () => {
    // A route added without a rule must still demand a login, never be public.
    expect(requiredRole('/api/something-invented-later')).toBe('viewer');
  });

  it('keeps the item, latest-data and map-detail routes at viewer: a viewer is kept from interface data inside them (SC-20)', () => {
    // Not by a route rule: these three serve the Graphs, Latest data and Maps pages. viewerPolicy.ts cuts the
    // net.if items and the network hosts for a viewer; viewer-network.test.ts pins that. A rule here would
    // lock the viewer out of the whole page instead.
    for (const url of ['/api/items', '/api/latest', '/api/maps/detail', '/api/maps', '/api/graph']) {
      expect(requiredRole(url), url).toBe('viewer');
    }
  });

  it('keeps the SLA download at viewer, whatever else shares its prefix', () => {
    // /api/sli/export must not inherit a stricter rule from a neighbour, nor be left public by one.
    expect(requiredRole('/api/sli/export')).toBe('viewer');
    expect(requiredRole('/api/sli/export/anything')).toBe('viewer');
  });

  it('does not let a prefix collision leak the admin report', () => {
    // `/api/reports/inventory` is admin; its siblings must not inherit that,
    // and nothing else may accidentally match the inventory pattern.
    expect(requiredRole('/api/reports/aging')).toBe('viewer');
    expect(requiredRole('/api/reports/capacity')).toBe('viewer');
  });
});

describe('roleAllows', () => {
  it('permits equal or higher rank only', () => {
    expect(roleAllows('admin', 'viewer')).toBe(true);
    expect(roleAllows('admin', 'operator')).toBe(true);
    expect(roleAllows('admin', 'admin')).toBe(true);
    expect(roleAllows('operator', 'viewer')).toBe(true);
    expect(roleAllows('operator', 'operator')).toBe(true);
    expect(roleAllows('operator', 'wall')).toBe(true);
    expect(roleAllows('wall', 'wall')).toBe(true);
    expect(roleAllows('wall', 'viewer')).toBe(true);
    expect(roleAllows('viewer', 'viewer')).toBe(true);
  });

  it('refuses to escalate', () => {
    expect(roleAllows('viewer', 'operator')).toBe(false);
    expect(roleAllows('viewer', 'wall')).toBe(false);
    expect(roleAllows('viewer', 'admin')).toBe(false);
    expect(roleAllows('operator', 'admin')).toBe(false);
  });

  it('keeps a wall screen read-only: it reads the network pages and can never acknowledge or close (MT-06)', () => {
    expect(roleAllows('wall', requiredRole('/api/net/meters'))).toBe(true);
    expect(roleAllows('wall', requiredRole('/api/links'))).toBe(true);
    expect(roleAllows('wall', requiredRole('/api/problems/acknowledge'))).toBe(false);
    expect(roleAllows('wall', requiredRole('/api/problems/close'))).toBe(false);
    expect(roleAllows('wall', requiredRole('/api/reports/inventory'))).toBe(false);
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
    expect(stray.json()).toMatchObject({ message: 'Only month, format, decimal, date and separator are accepted.' });
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
