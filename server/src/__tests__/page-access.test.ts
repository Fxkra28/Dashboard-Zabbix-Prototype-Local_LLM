import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `GET /api/auth/me` returns the role each menu page needs, worked out from the guard's own rules,
 * and the sidebar filters with that instead of copying the role rules by hand. These tests keep the
 * menu and the server from drifting apart.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer,olu:operator-pass:operator,adi:admin-pass:admin';
});

const { setupAuth, requiredRole, tokenClaims } = await import('../security/auth.js');
const { PAGE_API, pageRoles } = await import('../security/pageAccess.js');
const { registerErrorHandler } = await import('../http/errors.js');

let app: FastifyInstance;
beforeAll(async () => {
  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await setupAuth(app);
  await app.ready();
});
afterAll(() => app.close());

const me = async (role: string) => {
  // The user for the role from PORTAL_USERS above, with this portal's issuer and audience: both are checked.
  const sub = { viewer: 'ana', operator: 'olu', admin: 'adi' }[role];
  const token = app.jwt.sign({ sub, role, ...tokenClaims('hcml_session') }, { expiresIn: '1h' });
  const res = await app.inject({ url: '/api/auth/me', headers: { host: '127.0.0.1:8081', cookie: `hcml_session=${token}` } });
  return res.json() as { pages: Record<string, string> };
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

describe('GET /api/auth/me: pages', () => {
  it('gives each page the role its API route needs, the same for every caller', async () => {
    for (const role of ['viewer', 'operator', 'admin']) {
      const { pages } = await me(role);
      expect(pages).toEqual(pageRoles(requiredRole));
      for (const [page, api] of Object.entries(PAGE_API)) expect(pages[page], `${page} via ${api}`).toBe(requiredRole(api));
    }
  });

  it('marks the engineering pages wall, which a wall screen and an operator both pass, the scorecard admin, and the rest viewer', async () => {
    const { pages } = await me('viewer');
    expect(pages['/network']).toBe('wall');
    expect(pages['/links']).toBe('wall');
    expect(pages['/reports/inventory']).toBe('admin');
    expect(pages['/problems']).toBe('viewer');
    expect(pages['/sla']).toBe('viewer');
    expect(pages['/assistant']).toBe('viewer');
  });
});

describe('the sidebar and the server agree on the pages', () => {
  const sidebar = readFileSync(SIDEBAR, 'utf8');
  const menuPages = [...sidebar.matchAll(/\bto:\s*'([^']+)'/g)].map((m) => m[1]);

  it('reads the menu, so a change to the file format cannot make this pass on nothing', () => {
    expect(menuPages.length).toBeGreaterThanOrEqual(17);
  });

  it('has an entry in the server table for every page in the menu, and no entry for a page that is not', () => {
    expect([...menuPages].sort()).toEqual(Object.keys(PAGE_API).sort());
  });

  it('keeps no role rules of its own', () => {
    // A role written next to a menu item is a second copy of auth.ts ROUTE_RULES.
    expect(sidebar).not.toMatch(/\brole:\s*'(viewer|operator|admin)'/);
  });

  it('points every page at a route the server really registers', () => {
    const code = sources()
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    for (const api of new Set(Object.values(PAGE_API))) {
      const registered = new RegExp(`\\.(get|post)\\(\\s*['"\`]${api.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}['"\`]`);
      expect(code, `${api} is not registered`).toMatch(registered);
    }
  });
});
