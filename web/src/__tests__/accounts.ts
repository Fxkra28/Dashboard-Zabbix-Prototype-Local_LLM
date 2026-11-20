import type { Me, ModuleId, Role } from '../types';

/**
 * The accounts the tests sign in as, by the names they had before the roles became guest, operator and admin with a list of modules for each (ADR-0017): a viewer is a guest
 * with the pages a viewer had, and a wall screen's account the same with the network pages as well.
 */
export type Kind = 'viewer' | 'wall' | 'operator' | 'admin';

const GUEST: ModuleId[] = ['dashboard', 'problems', 'sites', 'hosts', 'devices', 'latest', 'graphs', 'maps', 'services', 'sla', 'capacity', 'noise', 'top-triggers', 'assistant'];
const ALL: ModuleId[] = [...GUEST, 'network', 'links', 'inventory', 'users'];

export const KINDS: Record<Kind, { role: Role; modules: ModuleId[] }> = {
  viewer: { role: 'guest', modules: GUEST },
  wall: { role: 'guest', modules: [...GUEST, 'network', 'links'] },
  operator: { role: 'operator', modules: [...GUEST, 'network', 'links'] },
  admin: { role: 'admin', modules: ALL },
};

/** The page each module opens, and the role that page needs: the server's table (security/modules.ts), which `GET /api/auth/me` turns into `pages`. */
export const PAGE_OF: Record<ModuleId, { page: string; needs: Role }> = {
  dashboard: { page: '/', needs: 'guest' },
  problems: { page: '/problems', needs: 'guest' },
  sites: { page: '/sites', needs: 'guest' },
  hosts: { page: '/hosts', needs: 'guest' },
  devices: { page: '/devices', needs: 'guest' },
  latest: { page: '/latest', needs: 'guest' },
  graphs: { page: '/graphs', needs: 'guest' },
  maps: { page: '/maps', needs: 'guest' },
  network: { page: '/network', needs: 'guest' },
  links: { page: '/links', needs: 'guest' },
  services: { page: '/services', needs: 'guest' },
  sla: { page: '/sla', needs: 'guest' },
  capacity: { page: '/reports/capacity', needs: 'guest' },
  noise: { page: '/reports/noise', needs: 'guest' },
  'top-triggers': { page: '/reports/top-triggers', needs: 'guest' },
  inventory: { page: '/reports/inventory', needs: 'admin' },
  assistant: { page: '/assistant', needs: 'guest' },
  users: { page: '/users', needs: 'admin' },
};

/** The `pages` of an account that holds these modules, as the server states them. */
export const pagesOf = (modules: ModuleId[]): Record<string, Role> => Object.fromEntries(modules.map((m) => [PAGE_OF[m].page, PAGE_OF[m].needs]));

/** What GET /api/auth/me says for an account of this kind. */
export const meFor = (kind: Kind, over: Partial<Me> = {}): Me => ({
  authEnabled: true,
  user: { name: 'x', role: KINDS[kind].role },
  expiresIn: 3600,
  modules: KINDS[kind].modules,
  pages: pagesOf(KINDS[kind].modules),
  ...over,
});

/** An account with a list of modules of its own, which none of the four kinds is (ADR-0017): a guest with Hosts and no Graphs, or with Network and no Graphs. */
export const meWith = (modules: ModuleId[], role: Role = 'guest', over: Partial<Me> = {}): Me => ({
  authEnabled: true,
  user: { name: 'budi.santoso', role },
  expiresIn: 3600,
  modules,
  pages: pagesOf(modules),
  ...over,
});
