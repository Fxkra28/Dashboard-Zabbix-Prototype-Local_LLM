import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { PUBLIC_ROUTES } from '../security/auth.js';
import { ruleFor } from '../security/modules.js';
import { toMs } from '../services/links.js';

vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: vi.fn().mockResolvedValue([]), zbxWrite: vi.fn() };
});

/**
 * The API surface, pinned.
 *
 * Not a style check: the table of routes in security/modules.ts is matched against URL
 * strings, so a route added or renamed without a matching row would be closed to everyone
 * but administrators. This test makes any change to the surface visible in a
 * diff, and fails for a route that has no row.
 */
async function registerAll() {
  // Named explicitly rather than picked out of each module's exports: several
  // modules export helpers alongside their plugin, and registering the wrong
  // one silently produces an empty, passing surface.
  const plugins = await Promise.all([
    import('../routes/hosts.js').then((m) => m.hostRoutes),
    import('../routes/devices.js').then((m) => m.deviceRoutes),
    import('../routes/problems.js').then((m) => m.problemRoutes),
    import('../routes/history.js').then((m) => m.historyRoutes),
    import('../routes/net.js').then((m) => m.netRoutes),
    import('../routes/meters.js').then((m) => m.meterRoutes),
    import('../routes/topHosts.js').then((m) => m.topHostRoutes),
    import('../routes/webMonitoring.js').then((m) => m.webMonitoringRoutes),
    import('../routes/stream.js').then((m) => m.streamRoutes),
    import('../routes/reports.js').then((m) => m.reportRoutes),
    import('../routes/maps.js').then((m) => m.mapRoutes),
    import('../routes/sla.js').then((m) => m.slaRoutes),
    import('../routes/explain.js').then((m) => m.explainRoutes),
    import('../routes/sites.js').then((m) => m.siteRoutes),
    import('../routes/services.js').then((m) => m.serviceRoutes),
    import('../routes/inventory.js').then((m) => m.inventoryRoutes),
    import('../routes/links.js').then((m) => m.linkRoutes),
    import('../routes/analytics.js').then((m) => m.analyticsRoutes),
    import('../routes/actions.js').then((m) => m.actionRoutes),
    import('../routes/chat.js').then((m) => m.chatRoutes),
    import('../routes/sli.js').then((m) => m.sliRoutes),
    import('../routes/sliExport.js').then((m) => m.sliExportRoutes),
    import('../routes/sliMail.js').then((m) => m.sliMailRoutes),
    import('../routes/users.js').then((m) => m.usersRoutes),
    import('../routes/accountRequests.js').then((m) => m.accountRequestRoutes),
  ]);
  // The schedule route takes the scheduler it asks, as index.ts hands it; the surface does not call it.
  const { sliScheduleRoutes } = await import('../routes/sliSchedule.js');
  const schedule = { availability: vi.fn(), next: vi.fn(), problem: vi.fn() };

  const app = Fastify({ logger: false });
  const routes: string[] = [];
  app.addHook('onRoute', (r) => {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    for (const m of methods) {
      if (m === 'HEAD') continue; // Fastify pairs a HEAD with every GET
      routes.push(`${m} ${r.url}`);
    }
  });

  for (const plugin of plugins) await app.register(plugin);
  await app.register(sliScheduleRoutes, { schedule });
  await app.ready();
  return { app, routes };
}

/** The route modules `registerAll` mounts, by file name. */
const MOUNTED = [
  'hosts', 'devices', 'problems', 'history', 'net', 'meters', 'topHosts', 'webMonitoring', 'stream', 'reports', 'maps', 'sla',
  'explain', 'sites', 'services', 'inventory', 'links', 'analytics', 'actions', 'chat', 'sli', 'sliExport', 'sliMail', 'sliSchedule', 'users', 'accountRequests',
];

describe('API surface', () => {
  // IN-82: the surface test once mounted 22 of the 24 modules, so the six routes that send a report or keep the schedule were pinned by nothing.
  it('mounts every route module there is, so that a new one cannot be left out of the pins below', () => {
    const files = readdirSync(new URL('../routes', import.meta.url))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => f.slice(0, -3))
      .sort();
    expect(files).toEqual([...MOUNTED].sort());
  });

  it('registers exactly the 54 route-module endpoints', async () => {
    // Plus /api/health and /api/ready (health.ts), POST /api/auth/login, GET
    // /api/auth/me, POST /api/auth/refresh, POST /api/auth/password and POST /api/auth/logout, which live in
    // auth.ts, 61 endpoints in total.
    const { app, routes } = await registerAll();
    expect(routes.sort()).toMatchInlineSnapshot(`
      [
        "DELETE /api/sli/recipients",
        "GET /api/auth/request",
        "GET /api/chat/warm",
        "GET /api/devices",
        "GET /api/explain/problem",
        "GET /api/explain/sla",
        "GET /api/freshness",
        "GET /api/graph",
        "GET /api/hostgroups",
        "GET /api/hosts",
        "GET /api/hosts/overview",
        "GET /api/items",
        "GET /api/latest",
        "GET /api/links",
        "GET /api/maps",
        "GET /api/maps/detail",
        "GET /api/net/devices",
        "GET /api/net/interfaces",
        "GET /api/net/meters",
        "GET /api/problems",
        "GET /api/reports/aging",
        "GET /api/reports/availability",
        "GET /api/reports/capacity",
        "GET /api/reports/inventory",
        "GET /api/reports/noise",
        "GET /api/reports/problems-by-group",
        "GET /api/reports/top-hosts",
        "GET /api/reports/top-triggers",
        "GET /api/reports/web-monitoring",
        "GET /api/services",
        "GET /api/services/derived",
        "GET /api/sites",
        "GET /api/sla",
        "GET /api/sla/sli",
        "GET /api/sla/source",
        "GET /api/sli",
        "GET /api/sli/email",
        "GET /api/sli/export",
        "GET /api/sli/schedule",
        "GET /api/stats",
        "GET /api/stream",
        "GET /api/users",
        "GET /api/users/requests",
        "PATCH /api/users/:name",
        "POST /api/auth/request",
        "POST /api/chat",
        "POST /api/problems/acknowledge",
        "POST /api/sli/email",
        "POST /api/users",
        "POST /api/users/:name/password",
        "POST /api/users/requests/:id/approve",
        "POST /api/users/requests/:id/refuse",
        "PUT /api/sli/recipients",
        "PUT /api/sli/schedule",
      ]
    `);
    await app.close();
  });

  it('has exactly one endpoint that writes to Zabbix, and pins every other route that is not a GET', async () => {
    // The portal is read-only except acknowledge/close (setup.md §20). A new
    // non-GET route appearing here is a design change, not a detail: it is
    // a Zabbix write (and must then be gated like acknowledge), or it sends a
    // report or keeps the portal's own list and schedule (administrators only,
    // below), or, like /api/chat, it is a POST only because its input (the
    // conversation) travels in the body, and performs no write at all. All are
    // pinned so none can drift in unnoticed.
    const { app, routes } = await registerAll();
    const notGet = routes.filter((r) => !r.startsWith('GET ')).sort();
    // POST /api/auth/request is the one route anyone can reach that writes to disk (FR-62): a request for an account, capped and off unless a setting is on.
    expect(notGet).toEqual([
      'DELETE /api/sli/recipients',
      'PATCH /api/users/:name',
      'POST /api/auth/request',
      'POST /api/chat',
      'POST /api/problems/acknowledge',
      'POST /api/sli/email',
      'POST /api/users',
      'POST /api/users/:name/password',
      'POST /api/users/requests/:id/approve',
      'POST /api/users/requests/:id/refuse',
      'PUT /api/sli/recipients',
      'PUT /api/sli/schedule',
    ]);
    await app.close();
  });

  it('gives every route a row in the table of routes, and gates the privileged ones', async () => {
    const { app, routes } = await registerAll();
    // The public routes are judged before the table is read (security/auth.ts), so they have no row.
    const urls = [...new Set(routes.map((r) => r.split(' ')[1]))].filter((url) => !PUBLIC_ROUTES.has(url));
    // A route with no row is closed to everyone but administrators, so none of these may be one.
    expect(urls.filter((url) => ruleFor(url) === undefined)).toEqual([]);
    const byRole = urls.reduce<Record<string, string[]>>((acc, url) => {
      (acc[ruleFor(url)!.role] ??= []).push(url);
      return acc;
    }, {});

    // The routes that send a report out of the portal, and set who gets it and when, and the ones that manage users, are the administrator's (IN-82).
    expect(byRole.admin.sort()).toEqual([
      '/api/reports/inventory',
      '/api/sli/email',
      '/api/sli/recipients',
      '/api/sli/schedule',
      '/api/users',
      '/api/users/:name',
      '/api/users/:name/password',
      '/api/users/requests',
      '/api/users/requests/:id/approve',
      '/api/users/requests/:id/refuse',
    ]);
    expect(byRole.operator).toEqual(['/api/problems/acknowledge']);
    // The network routes belong to the Network and Links modules, and to nothing else.
    const owners = (url: string) => ruleFor(url)!.modules;
    for (const url of ['/api/net/devices', '/api/net/interfaces', '/api/net/meters']) expect(owners(url), url).toEqual(['network']);
    expect(owners('/api/links')).toEqual(['links']);
    await app.close();
  });

  // IN-94: the folders were listed by hand and left out clients/, where zbxWrite lives, and index.ts. Every source file is read, in any folder, a new one included.
  it('calls the Zabbix write in one module only, the one that acknowledges and closes', () => {
    const sources = (readdirSync(new URL('../', import.meta.url), { recursive: true }) as string[])
      .map((f) => f.split(sep).join('/'))
      .filter((f) => f.endsWith('.ts') && !f.startsWith('__tests__/'))
      // The one that defines it.
      .filter((f) => f !== 'clients/zabbix.ts');
    expect(sources).toEqual(expect.arrayContaining(['index.ts', 'clients/mail.ts', 'routes/actions.ts', 'core/config.ts']));
    const asked = sources.filter((f) => /\bzbxWrite\b/.test(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')));
    expect(asked).toEqual(['routes/actions.ts']);
  });
});

describe('toMs', () => {
  it('converts seconds to milliseconds without a float tail', () => {
    // The artifact this replaced: (0.0405 - 0.0125) * 1000 = 27.999999999999996
    expect(toMs(0.0405 - 0.0125)).toBe(28);
    expect(toMs(0.0123)).toBe(12.3);
    expect(toMs(0)).toBe(0);
  });

  it('passes undefined through so "no data" stays distinct from zero', () => {
    expect(toMs(undefined)).toBeUndefined();
  });
});
