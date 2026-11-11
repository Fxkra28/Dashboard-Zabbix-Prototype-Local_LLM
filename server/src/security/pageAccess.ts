import type { Role } from './auth.js';

/**
 * Every page in the portal's menu, with the API route that fills it.
 *
 * The role a page needs is the role its route needs in auth.ts, so the menu cannot say something
 * the guard does not. `GET /api/auth/me` returns the result and the sidebar filters with it instead
 * of keeping a second copy of the rules. A new page goes in this list: a test fails when the
 * sidebar lists a page that is missing here.
 */
export const PAGE_API: Readonly<Record<string, string>> = {
  '/': '/api/problems',
  '/problems': '/api/problems',
  '/sites': '/api/sites',
  '/hosts': '/api/hosts',
  '/devices': '/api/devices',
  '/latest': '/api/latest',
  '/graphs': '/api/graph',
  '/maps': '/api/maps',
  '/network': '/api/net/devices',
  '/links': '/api/links',
  '/services': '/api/services',
  '/sla': '/api/sli',
  '/reports/availability': '/api/reports/availability',
  '/reports/capacity': '/api/reports/capacity',
  '/reports/noise': '/api/reports/noise',
  '/reports/top-triggers': '/api/reports/top-triggers',
  '/reports/inventory': '/api/reports/inventory',
  '/assistant': '/api/chat',
};

/** The minimum role for each page, judged by the same rules that guard its route. */
export function pageRoles(roleFor: (url: string) => Role): Record<string, Role> {
  return Object.fromEntries(Object.entries(PAGE_API).map(([page, api]) => [page, roleFor(api)]));
}
