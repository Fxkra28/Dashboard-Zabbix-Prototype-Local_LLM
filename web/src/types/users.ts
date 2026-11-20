/** The users of the portal, for the Users page (ADR-0017). */

import type { Language, ModuleId, Role } from './auth';

/** A user as the page reads them. The server never sends a password or a hash. */
export interface UserRecord {
  name: string;
  displayName: string;
  role: Role;
  modules: ModuleId[];
  language: Language | null;
  /** `env` for a user kept in `.env`, which the page cannot change. */
  source: 'env' | 'file';
  /** The first administrator of `.env`: it signs in with the password there whatever the state of the file. */
  breakGlass: boolean;
  disabled: boolean;
  /** Unix seconds after which the user cannot sign in, or null. */
  expires: number | null;
  mustChange: boolean;
  created: number | null;
  createdBy: string | null;
  lastSignIn: number | null;
}

export interface ModuleInfo {
  id: ModuleId;
  label: string;
  /** The path of its page. */
  page: string;
  /** Its page needs the administrator role, so it cannot be given to anyone else. */
  adminOnly: boolean;
}

export interface UsersResponse {
  users: UserRecord[];
  modules: ModuleInfo[];
  /** The modules a new user of each role starts with: only a start. */
  presets: Record<Role, ModuleId[]>;
  /** Whether the users are kept across a restart, and whether the page may change them. */
  durable: boolean;
  editable: boolean;
  /** A save failed and has not worked since. */
  failing: boolean;
  /** The page was reached over HTTPS. */
  secure: boolean;
}

export interface NewUser {
  name: string;
  displayName?: string;
  role: Role;
  modules?: ModuleId[];
  language?: Language | null;
  password: string;
  expires?: number | null;
  mustChange?: boolean;
}

export interface UserPatch {
  displayName?: string;
  role?: Role;
  modules?: ModuleId[];
  language?: Language | null;
  disabled?: boolean;
  expires?: number | null;
  mustChange?: boolean;
}

export interface UserResult {
  user: UserRecord;
}

/** What a change of one's own password answers: the renewed session, as sign-in does. */
export interface PasswordChanged {
  ok: boolean;
  user: { name: string; role: Role };
  expiresIn: number;
}

/** What the sign-in page asks before it offers the form for an account (FR-62): off by default, and then only `enabled: false`. */
export interface RequestInfo {
  enabled: boolean;
  /** The pages a person may ask for. */
  pages?: { id: ModuleId; label: string }[];
  nameMax?: number;
  reasonMax?: number;
}

/** What a person who is not signed in leaves. */
export interface NewRequest {
  name: string;
  pages: ModuleId[];
  reason: string;
}

/** A request waiting for an administrator. `name` and `reason` are what a stranger typed: shown as text, never as markup. */
export interface AccountRequestRecord {
  id: string;
  name: string;
  pages: ModuleId[];
  reason: string;
  /** Unix seconds. */
  created: number;
}

export interface RequestsResponse {
  enabled: boolean;
  /** The most that wait at once. */
  max: number;
  requests: AccountRequestRecord[];
}
