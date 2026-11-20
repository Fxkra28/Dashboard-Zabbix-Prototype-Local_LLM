import { viewOf, type NewUser, type UserPatch, type UserView } from '../security/accounts.js';
import { MODULES, ROLES, moduleRole, presetFor, type ModuleId, type Role } from '../security/modules.js';
import { userDirectory } from './userDirectory.js';

/**
 * What the Users page reads and changes (ADR-0017): the list of users with the modules and the presets to choose from, and the four changes an administrator
 * can make. The rules (the last administrator, one's own account, passwords) are the directory's, in security/accounts.ts.
 */

export interface ModuleInfo {
  id: ModuleId;
  label: string;
  page: string;
  /** Its page needs the administrator role, so it cannot be given to anyone else. */
  adminOnly: boolean;
}

export interface UsersView {
  users: UserView[];
  modules: ModuleInfo[];
  /** The modules a new user of each role starts with. */
  presets: Record<Role, ModuleId[]>;
  /** Whether the users are kept across a restart, and whether the page may change them. Without a data folder they are those of `.env` and neither holds. */
  durable: boolean;
  editable: boolean;
  /** A save failed and has not worked since: the page says so. */
  failing: boolean;
  /** The page was reached over HTTPS. Real accounts wait for it. */
  secure: boolean;
}

export function listUsers(secure: boolean): UsersView {
  const directory = userDirectory();
  const users = directory.accounts().map(viewOf);
  users.sort((a, b) => Number(b.breakGlass) - Number(a.breakGlass) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return {
    users,
    modules: MODULES.map((m) => ({ id: m.id, label: m.label, page: m.page, adminOnly: moduleRole(m.id) === 'admin' })),
    presets: Object.fromEntries(ROLES.map((r) => [r, presetFor(r)])) as Record<Role, ModuleId[]>,
    durable: directory.store.durable,
    editable: directory.store.editable,
    failing: directory.store.failing(),
    secure,
  };
}

export const createUser = async (input: NewUser, actor: string): Promise<UserView> => viewOf(await userDirectory().create(input, actor));

export const updateUser = async (name: string, patch: UserPatch, actor: string): Promise<UserView> => viewOf(await userDirectory().update(name, patch, actor));

export const resetPassword = async (name: string, password: string, mustChange: boolean): Promise<UserView> =>
  viewOf(await userDirectory().setPassword(name, password, { mustChange }));
