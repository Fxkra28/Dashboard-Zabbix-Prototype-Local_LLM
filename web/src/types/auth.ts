/** Who is signed in, what the server says about itself, and the roles and modules (ADR-0017). */

/** What a user may do: a guest reads, an operator also acknowledges and closes, an admin also manages users and sends the report out. */
export type Role = 'guest' | 'operator' | 'admin';

/** One page of the menu, and what a user may see is a list of them. `inventory` and `users` are for administrators. */
export type ModuleId =
  | 'dashboard'
  | 'problems'
  | 'sites'
  | 'hosts'
  | 'devices'
  | 'latest'
  | 'graphs'
  | 'maps'
  | 'network'
  | 'links'
  | 'services'
  | 'sla'
  | 'capacity'
  | 'noise'
  | 'top-triggers'
  | 'inventory'
  | 'assistant'
  | 'users';

export type Language = 'en' | 'id';

export interface Me {
  authEnabled: boolean;
  /** `source` is where the account is kept: one of `.env` (the first administrator) cannot change its password on the Account page. Absent from a BFF that predates it. */
  user: { name: string; role: Role; displayName?: string; language?: Language; source?: 'env' | 'file' } | null;
  /** Seconds until the session ends; null with auth off. */
  expiresIn?: number | null;
  /** The pages this user has, each with the role it needs, from the server's table of routes. A page the user lacks is not in it. Absent from a BFF that predates it. */
  pages?: Record<string, Role>;
  /** The modules this user holds. Absent from a BFF that predates them. */
  modules?: ModuleId[];
  /** The password is a temporary one that must be changed before anything else. */
  mustChange?: boolean;
}

/** GET /api/health: what the page needs to know about the server before anything else. */
export interface Health {
  ok: boolean;
  ts: number;
  ai: boolean;
  aiProvider?: string;
  aiExternal?: boolean;
  writeBack: boolean;
  defaults?: { availabilityMinSeverity?: number; timezone?: string };
  /** Only in the reply a signed-in caller gets. */
  build?: { commit?: string; time?: string };
  /** Whether Zabbix can be read: a plain true or false for anyone, and for a signed-in caller the BFF's cached check of Zabbix and of the AI model. */
  ready?: boolean | { model?: string };
}
