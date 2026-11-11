/** Who is signed in, what the server says about itself, and the roles. */

export type Role = 'viewer' | 'wall' | 'operator' | 'admin';

export interface Me {
  authEnabled: boolean;
  user: { name: string; role: Role } | null;
  /** Seconds until the session ends; null with auth off. */
  expiresIn?: number | null;
  /** The role each menu page needs, from the server's own route rules. Absent from a BFF that predates it. */
  pages?: Record<string, Role>;
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
