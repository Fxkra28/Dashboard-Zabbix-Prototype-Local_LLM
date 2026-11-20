import { randomUUID } from 'node:crypto';
import { config } from '../core/config.js';
import { hashPassword, isHash, needsRehash, parseStoredPassword, passwordProblem, verifyPassword, type StoredPassword } from './passwords.js';
import { MODULE_IDS, accessOf, grantable, isModuleId, isRole, modulesForEnvRole, presetFor, roleFromName, type Access, type ModuleId, type Role } from './modules.js';
import { NAME_SHAPE, MAX_USERS, noUsers, type Language, type StoredUser, type UserStore } from './userStore.js';

/**
 * Who can sign in (ADR-0017): the users of the file, and the users of `.env`. The first administrator of `.env` is the break-glass account: it signs in with the password
 * in `.env` whatever the state of the file, and cannot be changed from the page. The other users of `.env` are a seed: a name that the file does not hold is added to it
 * at start, and a name that it does hold is left alone. Without a data folder the users are those of `.env` and nothing can be changed.
 */

/** A refusal of a change to a user, which the error handler sends as it is: a status, a code and a sentence. */
export class UserError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409,
    readonly error: 'bad_request' | 'not_found' | 'conflict',
  ) {
    super(message);
    this.name = 'UserError';
  }
}
const bad = (m: string) => new UserError(m, 400, 'bad_request');
const conflict = (m: string) => new UserError(m, 409, 'conflict');

/** One entry of `PORTAL_USERS`, or the single administrator of `PORTAL_USER` and `PORTAL_PASS`. */
export interface EnvUser {
  name: string;
  /** As written in `.env`: plain text or a hash. Never logged. */
  pass: string;
  check: StoredPassword;
  role: Role;
  modules: ModuleId[];
  breakGlass: boolean;
}

/** Sign-in compares names without regard to case; the name as written is kept. */
export const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * One entry as name, password and role: the name is what comes before the first ':', the role what comes after the last, so the password in between may hold ':' too.
 * An entry with a single ':' has no role.
 */
function splitEntry(entry: string): { name: string; pass: string; role?: string } {
  const first = entry.indexOf(':');
  if (first < 0) return { name: entry.trim(), pass: '' };
  const last = entry.lastIndexOf(':');
  const name = entry.slice(0, first).trim();
  if (last === first) return { name, pass: entry.slice(first + 1).trim() };
  return { name, pass: entry.slice(first + 1, last).trim(), role: entry.slice(last + 1).trim() };
}

/**
 * The valid `PORTAL_USERS` triples. Warnings name an entry by its position, never its text: a malformed entry, or a role that is really the rest of a password, would
 * otherwise put a password in the log.
 */
export function parseEnvUsers(raw: string, warn: (m: string) => void): EnvUser[] {
  const entries = raw.split(',');
  const users: EnvUser[] = [];
  entries.forEach((entry, i) => {
    const { name, pass, role } = splitEntry(entry);
    if (!name || !pass) {
      warn(`PORTAL_USERS entry ${i + 1} of ${entries.length} is not name:password:role. Skipped.`);
      return;
    }
    const check = parseStoredPassword(pass);
    if (check.kind === 'invalid') {
      warn(`PORTAL_USERS entry ${i + 1} of ${entries.length} starts with "scrypt." or "argon2id." but is not a usable hash. Skipped.`);
      return;
    }
    if (role && roleFromName(role) === undefined) warn(`PORTAL_USERS entry for "${name}" has an unknown role; it gets guest.`);
    // A token names its user, not which of two same-named entries signed in, so a renewal cannot tell them apart (POST /api/auth/refresh refuses it).
    // With auth off there are no sessions to warn about.
    if (config.auth.enabled && users.some((u) => u.name === name)) {
      warn(`PORTAL_USERS names "${name}" more than once. Each entry can sign in, but its sessions are not renewed: they end an hour before their ${config.auth.sessionHours} hours. Give each entry its own name.`);
    } else if (config.auth.enabled && users.some((u) => sameName(u.name, name))) {
      warn(`PORTAL_USERS has names that differ only by case, including "${name}". Sign-in ignores case, so give each entry a name that differs by more than that.`);
    }
    users.push({ name, pass, check, role: roleFromName(role) ?? 'guest', modules: modulesForEnvRole(role), breakGlass: false });
  });
  return users;
}

/**
 * The users of `.env`: `PORTAL_USERS` as `name:password:role` triples, comma-separated, or the single administrator of `PORTAL_USER` and `PORTAL_PASS`. A password is plain text
 * or a scrypt hash (passwords.ts). The roles `viewer` and `wall` still read, as a guest with the pages they had. The first administrator is the break-glass account.
 */
export function readEnvUsers(warn: (m: string) => void = () => undefined): EnvUser[] {
  const raw = (process.env.PORTAL_USERS ?? '').trim();
  const users = raw ? parseEnvUsers(raw, warn) : [];
  if (!users.length) {
    const { user: name, pass } = config.auth;
    return [{ name, pass, check: parseStoredPassword(pass), role: 'admin', modules: [...MODULE_IDS], breakGlass: true }];
  }
  const first = users.find((u) => u.role === 'admin');
  if (first) first.breakGlass = true;
  return users;
}

/** A user as the rest of the portal sees them, from the file or from `.env`. */
export interface Account {
  name: string;
  displayName: string;
  role: Role;
  modules: ModuleId[];
  language: Language | null;
  source: 'env' | 'file';
  breakGlass: boolean;
  check: StoredPassword;
  disabled: boolean;
  expires: number | null;
  mustChange: boolean;
  notBefore: number;
  id: string | null;
  created: number | null;
  createdBy: string | null;
  lastSignIn: number | null;
}

const fromEnv = (u: EnvUser): Account => ({
  name: u.name,
  displayName: u.name,
  role: u.role,
  modules: u.modules,
  language: null,
  source: 'env',
  breakGlass: u.breakGlass,
  check: u.check,
  disabled: false,
  expires: null,
  mustChange: false,
  notBefore: 0,
  id: null,
  created: null,
  createdBy: null,
  lastSignIn: null,
});

const fromFile = (u: StoredUser): Account => ({
  name: u.name,
  displayName: u.displayName,
  role: u.role,
  modules: u.modules,
  language: u.language,
  source: 'file',
  breakGlass: false,
  check: parseStoredPassword(u.hash),
  disabled: u.disabled,
  expires: u.expires,
  mustChange: u.mustChange,
  notBefore: u.notBefore,
  id: u.id,
  created: u.created,
  createdBy: u.createdBy,
  lastSignIn: u.lastSignIn,
});

export const accessOfAccount = (a: Account): Access => accessOf(a.role, a.modules);

/** Whether the account may sign in, or keep a session, at `nowSeconds`: not disabled, and not past its expiry. */
export const usable = (a: Account, nowSeconds: number): boolean => !a.disabled && !(a.expires !== null && a.expires <= nowSeconds);

/** What the Users page is told about a user: everything but the hash. */
export interface UserView {
  name: string;
  displayName: string;
  role: Role;
  modules: ModuleId[];
  language: Language | null;
  /** `env` for a user kept in `.env`, which the page cannot change. */
  source: 'env' | 'file';
  breakGlass: boolean;
  disabled: boolean;
  expires: number | null;
  mustChange: boolean;
  created: number | null;
  createdBy: string | null;
  lastSignIn: number | null;
}

export function viewOf(a: Account): UserView {
  return {
    name: a.name,
    displayName: a.displayName,
    role: a.role,
    modules: a.role === 'admin' ? [...MODULE_IDS] : [...accessOfAccount(a).modules],
    language: a.language,
    source: a.source,
    breakGlass: a.breakGlass,
    disabled: a.disabled,
    expires: a.expires,
    mustChange: a.mustChange,
    created: a.created,
    createdBy: a.createdBy,
    lastSignIn: a.lastSignIn || null,
  };
}

export interface NewUser {
  name: string;
  displayName?: string;
  role: Role;
  /** Left out: the preset of the role. */
  modules?: ModuleId[];
  language?: Language | null;
  password: string;
  expires?: number | null;
  /** Left out: true, so the person chooses their own at the first sign-in. */
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

const nowSeconds = () => Math.floor(Date.now() / 1000);

const accountListeners = new Set<(name: string) => void>();
/** Call `listener` with the name of each person whose live screens should end because their account changed (SC-57). Returns the function that stops it. */
export function onAccountChange(listener: (name: string) => void): () => void {
  accountListeners.add(listener);
  return () => void accountListeners.delete(listener);
}
const announce = (name: string) => {
  for (const listener of accountListeners) {
    try {
      listener(name);
    } catch {
      // A screen that cannot be ended is no reason to fail a change that is already saved.
    }
  }
};

/**
 * A warning for the log when no one can open the Users page: no entry of `.env` is an administrator and the file holds no enabled one. Null otherwise, and with sign-in off, where no one
 * signs in (BK-100). Only a `.env` edit and a new container put it right, so the start says so.
 */
export function adminWarning(directory: Directory, now: number = nowSeconds()): string | null {
  if (!config.auth.enabled) return null;
  if (directory.accounts().some((a) => a.role === 'admin' && usable(a, now))) return null;
  return 'No account can open the Users page: no entry of PORTAL_USERS is an administrator, and the file of users holds no enabled administrator. Add an entry name:password:admin to PORTAL_USERS in .env and recreate the container.';
}

/**
 * The advice for users of `.env` whose password is a hash older than the portal's own: refusing a wrong password takes longer for them than for any other name, which tells a caller
 * that the name exists (SC-60). The file's users are rewritten at their next sign-in; `.env` is read-only to the portal, so only its owner can replace these.
 */
export function legacyHashWarning(users: readonly EnvUser[]): string | null {
  const names = users.filter((u) => (u.check.kind === 'scrypt' || u.check.kind === 'argon2id') && needsRehash(u.check)).map((u) => `"${u.name}"`);
  if (!names.length) return null;
  return `The password of ${names.join(', ')} in .env is an older kind of hash. The portal takes longer to refuse a wrong password for ${names.length === 1 ? 'it' : 'them'} than for any other name, which tells a caller that the name exists. Make a new hash with "npx tsx scripts/hash-password.ts" (run from server/) and put it in .env.`;
}

/** The advice that follows a start in which `.env` and the file both hold a person (SC-68). */
const LEFT_IN_ENV = 'Delete them from PORTAL_USERS (the first administrator stays): if the file is ever lost, they come back from .env with the role and password written there, disabled people included.';

export interface Directory {
  readonly store: UserStore;
  /** The users that can sign in, the break-glass one first. Several of one name only when `.env` repeats one. */
  accounts(): Account[];
  /** Every account whose name is `name`, whatever the case. */
  named(name: string): Account[];
  /** The account of this exact name, if only one has it. */
  byName(name: string): Account | undefined;
  /** Adds the users of `.env` that the file does not hold. Never throws; says in `warn` what it did not do. */
  seed(warn: (m: string) => void): Promise<void>;
  create(input: NewUser, actor: string): Promise<Account>;
  update(name: string, patch: UserPatch, actor: string): Promise<Account>;
  /** An administrator's reset: the person must choose their own at the next sign-in unless `mustChange` is false. */
  setPassword(name: string, password: string, opts: { mustChange: boolean }): Promise<Account>;
  /** The person's own change: their current password is checked first. */
  changeOwnPassword(name: string, current: string, next: string): Promise<Account>;
  /** Records a sign-in, and rewrites a hash that is weaker than the portal's now. Never throws: a sign-in does not wait on the file. */
  signedIn(name: string, password: string): Promise<void>;
}

/** The directory of `.env`'s users and a store's. `store` may be one that keeps nothing and cannot be changed. */
export function createDirectory(env: EnvUser[], store: UserStore = noUsers()): Directory {
  /** The names of `.env`'s break-glass account, in lower case: a record of the file under one of them is hidden, and is not the account. */
  const reservedNames = () => new Set(env.filter((u) => u.breakGlass).map((u) => u.name.toLowerCase()));
  const accounts = (): Account[] => {
    const breakGlass = env.filter((u) => u.breakGlass).map(fromEnv);
    const reserved = reservedNames();
    const file = store.list().filter((u) => !reserved.has(u.name.toLowerCase())).map(fromFile);
    const held = new Set(file.map((a) => a.name.toLowerCase()));
    // An entry of `.env` that the file holds is the file's. Entries of `.env` that repeat a name stay as they are: each can sign in (readEnvUsers warns).
    const rest = env.filter((u) => !u.breakGlass && !held.has(u.name.toLowerCase())).map(fromEnv);
    return [...breakGlass, ...file, ...rest];
  };

  const editable = () => {
    if (!store.editable) throw conflict('This portal has no data folder, so its users are kept in .env and cannot be changed here.');
  };
  const fileUser = (name: string): StoredUser => {
    const stored = store.list().find((u) => u.name === name);
    if (stored && !reservedNames().has(name.toLowerCase())) return stored;
    if (accounts().some((a) => a.name === name)) throw conflict(`"${name}" is kept in .env and cannot be changed here.`);
    throw new UserError(`There is no user "${name}".`, 404, 'not_found');
  };
  const checkModules = (role: Role, modules: ModuleId[]): ModuleId[] => {
    if (role === 'admin') return [...MODULE_IDS];
    const allowed = grantable(role);
    const bad_ = modules.filter((m) => !allowed.includes(m));
    if (bad_.length) throw bad(`A ${role} cannot be given ${bad_.join(', ')}: ${bad_.length === 1 ? 'it is a page' : 'they are pages'} for administrators.`);
    return [...new Set(modules)];
  };
  /** Whether, once `draft` is saved, someone can still sign in as an administrator. */
  const adminLeft = (draft: StoredUser[], now: number) =>
    env.some((u) => u.role === 'admin') || draft.some((u) => u.role === 'admin' && !u.disabled && !(u.expires !== null && u.expires <= now));

  return {
    store,
    accounts,
    named: (name) => accounts().filter((a) => sameName(a.name, name)),
    byName(name) {
      const found = accounts().filter((a) => a.name === name);
      return found.length === 1 ? found[0] : undefined;
    },

    async seed(warn) {
      if (!store.editable) return;
      const have = new Set(store.list().map((u) => u.name.toLowerCase()));
      const candidates = env.filter((u) => !u.breakGlass);
      const left = candidates.filter((u) => have.has(u.name.toLowerCase()));
      if (left.length) {
        warn(`PORTAL_USERS lists ${left.length} user${left.length === 1 ? '' : 's'} that the file of users already holds. The file is used for ${left.length === 1 ? 'it' : 'them'}; change them on the Users page. ${LEFT_IN_ENV}`);
      }
      // A person imported earlier and taken out of PORTAL_USERS since still signs in: the file decides, and removing the entry changes nothing (SC-67).
      const listed = new Set(candidates.map((u) => u.name.toLowerCase()));
      const gone = store.list().filter((u) => u.createdBy === 'PORTAL_USERS' && !u.disabled && !listed.has(u.name.toLowerCase()));
      if (gone.length) {
        const shown = gone.slice(0, 10).map((u) => `"${u.name}"`).join(', ') + (gone.length > 10 ? ` and ${gone.length - 10} more` : '');
        warn(`${gone.length} user${gone.length === 1 ? '' : 's'} imported from PORTAL_USERS ${gone.length === 1 ? 'is' : 'are'} no longer listed there and can still sign in: ${shown}. Taking an entry out of .env does not end access: Disable the person on the Users page.`);
      }
      const fresh: EnvUser[] = [];
      for (const u of candidates) {
        if (have.has(u.name.toLowerCase())) continue;
        if (!NAME_SHAPE.test(u.name)) warn(`PORTAL_USERS holds the name "${u.name.slice(0, 64)}", which the file of users cannot take (3 to 64 letters, digits and . _ @ -). It signs in from .env and cannot be changed on the Users page.`);
        else fresh.push(u);
        have.add(u.name.toLowerCase());
      }
      if (!fresh.length) return;
      try {
        const hashed = await Promise.all(fresh.map(async (u) => (isHash(u.check) ? u.pass : hashPassword(u.pass))));
        const now = nowSeconds();
        await store.change((draft) => {
          fresh.forEach((u, i) => {
            if (draft.length >= MAX_USERS) return;
            draft.push({
              id: randomUUID(),
              name: u.name,
              displayName: u.name,
              role: u.role,
              modules: u.role === 'admin' ? [...MODULE_IDS] : u.modules.filter((m) => grantable(u.role).includes(m)),
              language: null,
              hash: hashed[i],
              created: now,
              createdBy: 'PORTAL_USERS',
              lastSignIn: 0,
              disabled: false,
              expires: null,
              mustChange: false,
              notBefore: 0,
            });
          });
        });
        warn(`${fresh.length} user${fresh.length === 1 ? '' : 's'} of PORTAL_USERS ${fresh.length === 1 ? 'was' : 'were'} added to the file of users. From now on the file decides their passwords, roles and pages. ${fresh.length === 1 ? 'Delete it' : 'Delete them'} from PORTAL_USERS (the first administrator stays): if the file is ever lost, ${fresh.length === 1 ? 'it comes' : 'they come'} back from .env with the role and password written there.`);
      } catch {
        warn('The users of PORTAL_USERS could not be added to the file of users. They sign in from .env, and the Users page cannot change them.');
      }
    },

    async create(input, actor) {
      editable();
      const name = input.name.trim();
      if (!NAME_SHAPE.test(name)) throw bad('The sign-in name must have 3 to 64 letters, digits and . _ @ -, and begin and end with a letter or digit.');
      if (accounts().some((a) => sameName(a.name, name))) throw conflict(`There is already a user called "${name}", whatever the case.`);
      if (!isRole(input.role)) throw bad('The role must be guest, operator or admin.');
      const modules = checkModules(input.role, input.modules ?? presetFor(input.role));
      const displayName = (input.displayName ?? '').trim() || name;
      if (displayName.length > 80) throw bad('The name shown must have at most 80 characters.');
      const problem = passwordProblem(input.password, { name });
      if (problem) throw bad(problem);
      const now = nowSeconds();
      if (input.expires != null && input.expires <= now) throw bad('The expiry must be a time in the future.');
      const hash = await hashPassword(input.password);
      const record: StoredUser = {
        id: randomUUID(),
        name,
        displayName,
        role: input.role,
        modules,
        language: input.language ?? null,
        hash,
        created: now,
        createdBy: actor,
        lastSignIn: 0,
        disabled: false,
        expires: input.expires ?? null,
        mustChange: input.mustChange ?? true,
        notBefore: 0,
      };
      await store.change((draft) => {
        if (draft.length >= MAX_USERS) throw conflict(`The portal holds at most ${MAX_USERS} users.`);
        if (draft.some((u) => sameName(u.name, name))) throw conflict(`There is already a user called "${name}", whatever the case.`);
        draft.push(record);
      });
      return fromFile(record);
    },

    async update(name, patch, actor) {
      editable();
      fileUser(name);
      const now = nowSeconds();
      let updated: StoredUser | undefined;
      await store.change((draft) => {
        const user = draft.find((u) => u.name === name);
        if (!user) throw new UserError(`There is no user "${name}".`, 404, 'not_found');
        const role = patch.role ?? user.role;
        if (patch.role !== undefined && !isRole(patch.role)) throw bad('The role must be guest, operator or admin.');
        if (patch.modules !== undefined && !patch.modules.every(isModuleId)) throw bad('A module is not one the portal has.');
        if (patch.displayName !== undefined) {
          const shown = patch.displayName.trim() || user.name;
          if (shown.length > 80) throw bad('The name shown must have at most 80 characters.');
          user.displayName = shown;
        }
        // A role is a step in what a person may do, and the modules follow it: a new role keeps the modules the person may still have and nothing they may not.
        if (patch.role !== undefined || patch.modules !== undefined) {
          user.modules = checkModules(role, patch.modules ?? (role === 'admin' ? [] : user.modules.filter((m) => grantable(role).includes(m))));
          user.role = role;
        }
        if (patch.language !== undefined) user.language = patch.language;
        if (patch.disabled !== undefined) {
          // Sessions begun before a Disable stay void when the person is enabled again: Enable brought back every token that the person, or a thief, still held (SC-57).
          if (patch.disabled && !user.disabled) user.notBefore = now;
          user.disabled = patch.disabled;
        }
        if (patch.expires !== undefined) {
          if (patch.expires !== null && patch.expires <= now) throw bad('The expiry must be a time in the future.');
          // An expiry that had passed and is moved or cleared brings the person back, and not the sessions of before it.
          if (user.expires !== null && user.expires <= now) user.notBefore = now;
          user.expires = patch.expires;
        }
        if (patch.mustChange !== undefined) user.mustChange = patch.mustChange;
        if (name === actor && (user.disabled || user.role !== 'admin' || (user.expires !== null && user.expires <= now))) {
          throw conflict('You cannot disable, demote or expire your own account: ask another administrator.');
        }
        if (!adminLeft(draft, now)) throw conflict('That would leave no administrator who can sign in.');
        updated = user;
      });
      // What a screen already open could still show: the person is gone, or may see other pages, so their live screens end and come back as the new account allows.
      if (patch.disabled === true || patch.expires !== undefined || patch.role !== undefined || patch.modules !== undefined || patch.mustChange === true) announce(name);
      return fromFile(updated!);
    },

    async setPassword(name, password, opts) {
      editable();
      fileUser(name);
      const problem = passwordProblem(password, { name });
      if (problem) throw bad(problem);
      const hash = await hashPassword(password);
      const now = nowSeconds();
      let updated: StoredUser | undefined;
      await store.change((draft) => {
        const user = draft.find((u) => u.name === name);
        if (!user) throw new UserError(`There is no user "${name}".`, 404, 'not_found');
        user.hash = hash;
        user.mustChange = opts.mustChange;
        user.notBefore = now;
        updated = user;
      });
      announce(name);
      return fromFile(updated!);
    },

    async changeOwnPassword(name, current, next) {
      editable();
      const stored = fileUser(name);
      if (!(await verifyPassword(parseStoredPassword(stored.hash), current))) throw bad('The current password is not right.');
      const problem = passwordProblem(next, { name });
      if (problem) throw bad(problem);
      if (current === next) throw bad('Choose a password that is not the one you have now.');
      const hash = await hashPassword(next);
      const now = nowSeconds();
      let updated: StoredUser | undefined;
      await store.change((draft) => {
        const user = draft.find((u) => u.name === name);
        if (!user) throw new UserError(`There is no user "${name}".`, 404, 'not_found');
        // The current password was checked against the hash read above; a reset that landed while the new hash was being made stands.
        if (user.hash !== stored.hash) throw conflict('Your password was changed while you were choosing a new one. Sign in with the password you were given.');
        user.hash = hash;
        user.mustChange = false;
        user.notBefore = now;
        updated = user;
      });
      announce(name);
      return fromFile(updated!);
    },

    async signedIn(name, password) {
      if (!store.editable) return;
      try {
        const stored = store.list().find((u) => u.name === name);
        if (!stored || reservedNames().has(name.toLowerCase())) return;
        const now = nowSeconds();
        const rehash = needsRehash(parseStoredPassword(stored.hash)) ? await hashPassword(password) : null;
        if (!rehash && now - stored.lastSignIn < 60) return;
        await store.change((draft) => {
          const user = draft.find((u) => u.name === name);
          if (!user) return;
          user.lastSignIn = now;
          // Only over the hash the password was checked against: a reset that landed while the new one was being made stands.
          if (rehash && user.hash === stored.hash) user.hash = rehash;
        });
      } catch {
        // The sign-in has succeeded; a file that cannot be written is already in the log.
      }
    },
  };
}
