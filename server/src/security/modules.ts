/**
 * Who may open what (ADR-0017). A user has a role, which says what they may do, and a list of modules, which says what they may see. A module is one page of the portal's menu.
 * One table of routes says which modules own each route of the API and which role it needs; a user passes when their role is high enough and they hold one of the modules that
 * own the route. An administrator holds every module. A route that is in no row is closed to everyone but administrators, so a new route is protected by default, and a test
 * fails when a registered route has no row.
 *
 *   guest      reads.
 *   operator   also acknowledges and closes problems.
 *   admin      also manages users and modules, reads the inventory scorecard, and sends or schedules the SLA report by mail.
 */

export const ROLES = ['guest', 'operator', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { guest: 1, operator: 2, admin: 3 };

export const isRole = (v: unknown): v is Role => ROLES.includes(v as Role);
export const roleAllows = (has: Role, needs: Role): boolean => RANK[has] >= RANK[needs];

/** The names a role had before 17 November 2026, which `.env` and older sessions may still carry. */
export const LEGACY_ROLES: Readonly<Record<string, Role>> = { viewer: 'guest', wall: 'guest' };

/** A role as written in `.env` or in an older session, or undefined when it is none the portal knows. */
export const roleFromName = (raw: unknown): Role | undefined =>
  isRole(raw) ? raw : typeof raw === 'string' && Object.hasOwn(LEGACY_ROLES, raw) ? LEGACY_ROLES[raw] : undefined;

/** One page of the menu, and the route that fills it, so that the menu can never say what the guard does not. */
export const MODULES = [
  { id: 'dashboard', page: '/', label: 'Dashboard', entry: '/api/problems' },
  { id: 'problems', page: '/problems', label: 'Problems', entry: '/api/problems' },
  { id: 'sites', page: '/sites', label: 'Sites', entry: '/api/sites' },
  { id: 'hosts', page: '/hosts', label: 'Hosts', entry: '/api/hosts' },
  { id: 'devices', page: '/devices', label: 'Devices', entry: '/api/devices' },
  { id: 'latest', page: '/latest', label: 'Latest data', entry: '/api/latest' },
  { id: 'graphs', page: '/graphs', label: 'Graphs', entry: '/api/graph' },
  { id: 'maps', page: '/maps', label: 'Maps', entry: '/api/maps' },
  { id: 'network', page: '/network', label: 'Network', entry: '/api/net/devices' },
  { id: 'links', page: '/links', label: 'Links & WAN health', entry: '/api/links' },
  { id: 'services', page: '/services', label: 'Services', entry: '/api/services' },
  { id: 'sla', page: '/sla', label: 'SLA', entry: '/api/sli' },
  { id: 'capacity', page: '/reports/capacity', label: 'Capacity trends', entry: '/api/reports/capacity' },
  { id: 'noise', page: '/reports/noise', label: 'Alert noise', entry: '/api/reports/noise' },
  { id: 'top-triggers', page: '/reports/top-triggers', label: 'Top 100 triggers', entry: '/api/reports/top-triggers' },
  { id: 'inventory', page: '/reports/inventory', label: 'Inventory & ownership scorecard', entry: '/api/reports/inventory' },
  { id: 'assistant', page: '/assistant', label: 'Assistant', entry: '/api/chat' },
  { id: 'users', page: '/users', label: 'Users and access', entry: '/api/users' },
] as const;

export type ModuleId = (typeof MODULES)[number]['id'];
export const MODULE_IDS: readonly ModuleId[] = MODULES.map((m) => m.id);
export const isModuleId = (v: unknown): v is ModuleId => MODULE_IDS.includes(v as ModuleId);
export const moduleLabel = (id: ModuleId): string => MODULES.find((m) => m.id === id)?.label ?? id;

interface RouteRule {
  pattern: RegExp;
  /** The modules that own the route: holding any one is enough. `any` is for the routes that every signed-in user needs to use the portal at all. */
  modules: readonly ModuleId[] | 'any';
  role: Role;
}

/** First match wins. Order matters where a pattern is a prefix of another: the narrower comes first. */
export const ROUTES: readonly RouteRule[] = [
  { pattern: /^\/api\/users\b/, modules: ['users'], role: 'admin' },
  { pattern: /^\/api\/auth\/(password|refresh)$/, modules: 'any', role: 'guest' },
  { pattern: /^\/api\/ready$/, modules: 'any', role: 'guest' },
  // Governance, and what leaves the portal: the emailed report and the monthly send.
  { pattern: /^\/api\/reports\/inventory/, modules: ['inventory'], role: 'admin' },
  { pattern: /^\/api\/sli\/(email|schedule|recipients)/, modules: ['sla'], role: 'admin' },
  // The acknowledge/close write-back.
  { pattern: /^\/api\/problems\/(acknowledge|close)/, modules: ['problems'], role: 'operator' },
  { pattern: /^\/api\/problems\b/, modules: ['dashboard', 'problems'], role: 'guest' },
  { pattern: /^\/api\/(stats|freshness|stream)\b/, modules: ['dashboard', 'problems'], role: 'guest' },
  { pattern: /^\/api\/net\b/, modules: ['network'], role: 'guest' },
  { pattern: /^\/api\/links\b/, modules: ['links'], role: 'guest' },
  { pattern: /^\/api\/maps\b/, modules: ['maps'], role: 'guest' },
  { pattern: /^\/api\/graph\b/, modules: ['graphs'], role: 'guest' },
  { pattern: /^\/api\/devices\b/, modules: ['devices', 'hosts', 'dashboard'], role: 'guest' },
  { pattern: /^\/api\/sites\b/, modules: ['sites'], role: 'guest' },
  { pattern: /^\/api\/latest\b/, modules: ['latest'], role: 'guest' },
  { pattern: /^\/api\/items\b/, modules: ['graphs', 'latest', 'hosts'], role: 'guest' },
  { pattern: /^\/api\/hostgroups\b/, modules: ['hosts', 'latest'], role: 'guest' },
  { pattern: /^\/api\/hosts\b/, modules: ['hosts', 'graphs', 'latest'], role: 'guest' },
  { pattern: /^\/api\/services\b/, modules: ['services'], role: 'guest' },
  { pattern: /^\/api\/sla\b/, modules: ['sla', 'services'], role: 'guest' },
  { pattern: /^\/api\/sli\b/, modules: ['sla'], role: 'guest' },
  { pattern: /^\/api\/reports\/availability/, modules: ['sla'], role: 'guest' },
  { pattern: /^\/api\/reports\/aging/, modules: ['sla', 'problems', 'dashboard'], role: 'guest' },
  { pattern: /^\/api\/reports\/capacity/, modules: ['capacity'], role: 'guest' },
  { pattern: /^\/api\/reports\/noise/, modules: ['noise'], role: 'guest' },
  { pattern: /^\/api\/reports\/top-triggers/, modules: ['top-triggers'], role: 'guest' },
  { pattern: /^\/api\/reports\/(problems-by-group|top-hosts|web-monitoring)/, modules: ['dashboard'], role: 'guest' },
  // Explain is opened from these pages. The Assistant page is not one of them: it asks the model by `/api/chat`, and a person who holds it alone must not read a problem's detail or the derived SLA (SC-62).
  { pattern: /^\/api\/explain\/problem/, modules: ['problems', 'dashboard'], role: 'guest' },
  { pattern: /^\/api\/explain\/sla/, modules: ['sla', 'services'], role: 'guest' },
  { pattern: /^\/api\/chat\b/, modules: ['assistant'], role: 'guest' },
];

export function ruleFor(route: string): RouteRule | undefined {
  return ROUTES.find((r) => r.pattern.test(route));
}

/** What a signed-in user may do and see. */
export interface Access {
  role: Role;
  modules: ReadonlySet<ModuleId>;
}

export type Verdict =
  | { ok: true }
  | { ok: false; why: 'role'; needs: Role }
  | { ok: false; why: 'module'; modules: readonly ModuleId[] }
  | { ok: false; why: 'closed' };

/** Whether `access` may use `route`. An administrator may use every route that has a row, and any that has none. */
export function judge(access: Access, route: string): Verdict {
  const rule = ruleFor(route);
  if (!rule) return access.role === 'admin' ? { ok: true } : { ok: false, why: 'closed' };
  if (!roleAllows(access.role, rule.role)) return { ok: false, why: 'role', needs: rule.role };
  if (rule.modules === 'any' || access.role === 'admin') return { ok: true };
  return rule.modules.some((m) => access.modules.has(m)) ? { ok: true } : { ok: false, why: 'module', modules: rule.modules };
}

/** The sentence for a refusal, as the guard sends it. */
export function refusalText(verdict: Exclude<Verdict, { ok: true }>, role: Role): string {
  if (verdict.why === 'role') return `This view needs the "${verdict.needs}" role; you are signed in as "${role}".`;
  if (verdict.why === 'module') return `Your account does not have ${verdict.modules.map(moduleLabel).join(' or ')}. Ask an administrator for access.`;
  return 'This view is for administrators.';
}

/** The role a module's own page needs, from the rules that guard its route. */
export const moduleRole = (id: ModuleId): Role => {
  const entry = MODULES.find((m) => m.id === id)!.entry;
  return ruleFor(entry)?.role ?? 'admin';
};

/** The modules a person of this role could be given: an administrator's own pages are for administrators alone. */
export const grantable = (role: Role): ModuleId[] => MODULE_IDS.filter((id) => roleAllows(role, moduleRole(id)));

/** What a viewer could open before 17 November 2026: everything but the network pages, the inventory scorecard and the user pages. */
export const GUEST_MODULES: readonly ModuleId[] = [
  'dashboard', 'problems', 'sites', 'hosts', 'devices', 'latest', 'graphs', 'maps', 'services', 'sla', 'capacity', 'noise', 'top-triggers', 'assistant',
];
const NETWORK_MODULES: readonly ModuleId[] = ['network', 'links'];

/** The ticks a new user of this role starts with. They are only a start: what is stored is the list of the user, and nothing is looked up from the role afterwards. */
export function presetFor(role: Role): ModuleId[] {
  if (role === 'admin') return [...MODULE_IDS];
  if (role === 'operator') return [...GUEST_MODULES, ...NETWORK_MODULES];
  return [...GUEST_MODULES];
}

/** The modules a user of `.env` gets from the name of their role there: a `wall` account has the network pages, a `viewer` does not. */
export function modulesForEnvRole(raw: string | undefined): ModuleId[] {
  if (raw === 'wall') return [...GUEST_MODULES, ...NETWORK_MODULES];
  const role = roleFromName(raw) ?? 'guest';
  return presetFor(role);
}

/** What a user has, with an administrator's every module and nothing the role cannot reach. */
export function accessOf(role: Role, modules: readonly ModuleId[]): Access {
  return { role, modules: new Set(role === 'admin' ? MODULE_IDS : modules.filter((m) => grantable(role).includes(m))) };
}

/** The pages a user has, each with the role it needs, as `GET /api/auth/me` tells the menu: a page the user lacks is not in it. */
export function pagesOf(access: Access): Record<string, Role> {
  return Object.fromEntries(MODULES.filter((m) => access.modules.has(m.id)).map((m) => [m.page, moduleRole(m.id)]));
}
