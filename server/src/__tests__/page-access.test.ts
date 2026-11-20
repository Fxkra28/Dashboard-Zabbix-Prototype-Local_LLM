import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `GET /api/auth/me` returns the pages the user has, each with the role it needs, worked out from the table of routes (security/modules.ts), and the sidebar filters with that
 * instead of copying the rules by hand. These tests keep the menu and the server from drifting apart.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer,wen:wall-pass:wall,olu:operator-pass:operator,adi:admin-pass:admin';
});

const { setupAuth, tokenClaims } = await import('../security/auth.js');
const { MODULES, MODULE_IDS, moduleRole, ruleFor } = await import('../security/modules.js');
const { registerErrorHandler } = await import('../http/errors.js');

let app: FastifyInstance;
beforeAll(async () => {
  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await setupAuth(app);
  await app.ready();
});
afterAll(() => app.close());

const me = async (name: string, role: string) => {
  // A user of PORTAL_USERS above, with this portal's issuer and audience: both are checked.
  const token = app.jwt.sign({ sub: name, role, ...tokenClaims('hcml_session') }, { expiresIn: '1h' });
  const res = await app.inject({ url: '/api/auth/me', headers: { host: '127.0.0.1:8081', cookie: `hcml_session=${token}` } });
  return res.json() as { pages: Record<string, string>; modules: string[]; user: { role: string } };
};

const SERVER_SRC = fileURLToPath(new URL('..', import.meta.url));
const SIDEBAR = fileURLToPath(new URL('../../../web/src/features/shell/Sidebar.tsx', import.meta.url));

/** Every non-test source file under server/src. */
function sources(dir = SERVER_SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('GET /api/auth/me: pages and modules', () => {
  it('gives an administrator every page, each with the role its route needs, the scorecard and the user pages for administrators', async () => {
    const { pages, modules, user } = await me('adi', 'admin');
    expect(user.role).toBe('admin');
    expect(Object.keys(pages).sort()).toEqual(MODULES.map((m) => m.page).sort());
    expect(modules.sort()).toEqual([...MODULE_IDS].sort());
    for (const m of MODULES) expect(pages[m.page], m.page).toBe(moduleRole(m.id));
    expect(pages['/reports/inventory']).toBe('admin');
    expect(pages['/users']).toBe('admin');
    expect(pages['/problems']).toBe('guest');
  });

  it('gives a viewer of .env the pages a viewer had, a guest without the network pages, the scorecard and the user pages', async () => {
    const { pages, user } = await me('ana', 'viewer');
    expect(user.role).toBe('guest');
    for (const page of ['/', '/problems', '/sites', '/hosts', '/devices', '/latest', '/graphs', '/maps', '/services', '/sla', '/reports/capacity', '/reports/noise', '/reports/top-triggers', '/assistant']) {
      expect(pages[page], page).toBe('guest');
    }
    for (const page of ['/network', '/links', '/reports/inventory', '/users']) expect(pages, page).not.toHaveProperty(page);
  });

  it('gives a wall account of .env the network pages too, as a guest, and an operator of .env the same pages', async () => {
    const wall = await me('wen', 'wall');
    expect(wall.user.role).toBe('guest');
    expect(wall.pages['/network']).toBe('guest');
    expect(wall.pages['/links']).toBe('guest');
    expect(wall.pages).not.toHaveProperty('/reports/inventory');
    const operator = await me('olu', 'operator');
    expect(Object.keys(operator.pages).sort()).toEqual(Object.keys(wall.pages).sort());
  });
});

describe('the table of routes and the menu agree', () => {
  const sidebar = readFileSync(SIDEBAR, 'utf8');
  const menuPages = [...sidebar.matchAll(/\bto:\s*'([^']+)'/g)].map((m) => m[1]);

  it('reads the menu, so a change to the file format cannot make this pass on nothing', () => {
    expect(menuPages.length).toBeGreaterThanOrEqual(18);
  });

  it('has a module for every page in the menu, and no module for a page that is not', () => {
    expect([...menuPages].sort()).toEqual(MODULES.map((m) => m.page).sort());
  });

  it('has the module itself among the owners of the route that fills its page', () => {
    for (const m of MODULES) {
      const rule = ruleFor(m.entry);
      expect(rule, `${m.page} via ${m.entry} has no row`).toBeDefined();
      expect(rule!.modules, `${m.id} does not own ${m.entry}`).toContain(m.id);
    }
  });

  it('has no page for the Availability & response report, which the SLA page took over', () => {
    expect(MODULES.map((m) => m.page)).not.toContain('/reports/availability');
    expect(menuPages).not.toContain('/reports/availability');
    // The SLA page reads the availability and aging reports too, and a guest with the SLA page may read both.
    expect(MODULES.find((m) => m.id === 'sla')!.entry).toBe('/api/sli');
    for (const url of ['/api/sli', '/api/reports/availability', '/api/reports/aging']) expect(ruleFor(url)!.role, url).toBe('guest');
    expect(ruleFor('/api/reports/availability')!.modules).toContain('sla');
  });

  it('keeps no role rules of its own', () => {
    // A role written next to a menu item is a second copy of the table of routes.
    expect(sidebar).not.toMatch(/\brole:\s*'(guest|operator|admin)'/);
  });

  it('points every page at a route the server really registers', () => {
    const code = sources()
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    for (const api of new Set(MODULES.map((m) => m.entry))) {
      const registered = new RegExp(`\\.(get|post)\\(\\s*['"\`]${api.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}['"\`]`);
      expect(code, `${api} is not registered`).toMatch(registered);
    }
  });
});
