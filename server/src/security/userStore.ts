import { copyFile, mkdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '../core/state.js';
import { isHash, parseStoredPassword } from './passwords.js';
import { isModuleId, isRole, type ModuleId, type Role } from './modules.js';

/**
 * The portal's users, in a file of their own on the state volume (ADR-0017): `users.json`, mode 0600, written whole and safely, with the file before the last change kept as
 * `users.json.prev`. A file that cannot be read is put aside, never deleted. Without a data folder the store keeps nothing and is not editable, and the users stay in `.env`.
 */

export type Language = 'en' | 'id';

export interface StoredUser {
  /** Never changes, and is what a sign-in provider will be matched to. */
  id: string;
  /** What the person types to sign in. Never changes; sign-in ignores its case. */
  name: string;
  displayName: string;
  role: Role;
  /** What the person sees: the modules of the menu. An administrator has every one whatever this says. */
  modules: ModuleId[];
  language: Language | null;
  /** `argon2id.m.t.p.salt.hash` or `scrypt.N.r.p.salt.hash`, with the settings inside it. */
  hash: string;
  /** Unix seconds. */
  created: number;
  createdBy: string;
  lastSignIn: number;
  disabled: boolean;
  /** Unix seconds after which the person cannot sign in, or null. */
  expires: number | null;
  /** The password is a temporary one the person must change before anything else. */
  mustChange: boolean;
  /** Sessions begun before this moment, in Unix seconds, are void: a changed or reset password ends the older ones. */
  notBefore: number;
}

export const MAX_USERS = 200;
const FILE_NAME = 'users.json';

/** A sign-in name made on the page: three to 64 letters, digits and `. _ @ -`, beginning and ending with a letter or digit. */
export const NAME_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._@-]{1,62}[A-Za-z0-9]$/;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const moment = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const textUpTo = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** The name a dropped record carried, cut short and stripped of control characters, so that the log says who is missing: ` ("name")`, or nothing when it has none (BK-98). */
const droppedName = (item: unknown): string => {
  if (!isObject(item) || typeof item.name !== 'string' || !item.name) return '';
  // eslint-disable-next-line no-control-regex -- a name read from a file must not carry control characters into a log line
  return ` ("${item.name.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 64)}")`;
};

/** One record read back, or null with why. Unknown modules (from a later build) are dropped and said so. */
function userOf(v: unknown, repairs: string[]): StoredUser | null {
  if (!isObject(v)) return null;
  const { id, name, displayName, role, modules, language, hash, created, createdBy, lastSignIn, disabled, expires, mustChange, notBefore } = v;
  if (!textUpTo(id, 64) || id === '' || typeof name !== 'string' || !NAME_SHAPE.test(name) || !textUpTo(displayName, 80)) return null;
  if (!isRole(role) || !Array.isArray(modules) || (language !== null && language !== 'en' && language !== 'id')) return null;
  if (typeof hash !== 'string' || !isHash(parseStoredPassword(hash))) return null;
  if (!moment(created) || !textUpTo(createdBy, 64) || !moment(lastSignIn) || typeof disabled !== 'boolean' || typeof mustChange !== 'boolean' || !moment(notBefore)) return null;
  if (expires !== null && !moment(expires)) return null;
  const kept = modules.filter(isModuleId);
  if (kept.length !== modules.length) repairs.push(`The modules of "${name}" held a name this version does not know; it was dropped.`);
  return { id, name, displayName, role, modules: [...new Set(kept)], language, hash, created, createdBy, lastSignIn, disabled, expires, mustChange, notBefore };
}

/** What a file holds: the users that read well, a line for each thing dropped, and whether the file is of a kind this build reads at all. */
export function readUsers(raw: unknown): { users: StoredUser[]; repairs: string[]; usable: boolean } {
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.users)) return { users: [], repairs: [], usable: false };
  const users: StoredUser[] = [];
  const repairs: string[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const item of raw.users) {
    const user = userOf(item, repairs);
    if (!user) repairs.push(`A record of a user${droppedName(item)} was not whole and was dropped.`);
    else if (names.has(user.name.toLowerCase()) || ids.has(user.id)) repairs.push(`A second record for "${user.name}" was dropped.`);
    else if (users.length >= MAX_USERS) repairs.push(`The file held more than ${MAX_USERS} users; the rest were dropped.`);
    else {
      names.add(user.name.toLowerCase());
      ids.add(user.id);
      users.push(user);
    }
  }
  return { users, repairs, usable: true };
}

export class UsersWriteError extends Error {
  constructor(readonly detail: string) {
    super('The portal could not save the users. Check that its data folder can be written.');
    this.name = 'UsersWriteError';
  }
}

export interface UserStore {
  /** Whether what is kept survives a restart. */
  readonly durable: boolean;
  /** Whether the users can be changed from the page: a store of a data folder, or one a test made. Without it the users are those of `.env`. */
  readonly editable: boolean;
  /** True from a save that did not go through until one that does. */
  failing(): boolean;
  /** Copies: changing them changes nothing kept. */
  list(): StoredUser[];
  /** Applies `edit` to a copy of the users, checks the result, saves it, then makes it the users. One at a time, in the order asked. */
  change(edit: (draft: StoredUser[]) => void): Promise<void>;
}

const copy = (users: StoredUser[]): StoredUser[] => structuredClone(users);

function keep(initial: StoredUser[], opts: { durable: boolean; editable: boolean }, persist: (next: StoredUser[]) => Promise<void>): UserStore {
  let current = initial;
  let queue: Promise<unknown> = Promise.resolve();
  let failing = false;
  return {
    ...opts,
    failing: () => failing,
    list: () => copy(current),
    change(edit) {
      const run = async () => {
        if (!opts.editable) throw new UsersWriteError('not editable');
        const draft = copy(current);
        edit(draft);
        const { users, repairs } = readUsers(JSON.parse(JSON.stringify({ version: 1, users: draft })));
        if (repairs.length || users.length !== draft.length) throw new Error(`The users would be left unusable: ${repairs.join(' ') || 'a record was not whole'}`);
        try {
          await persist(users);
        } catch (err) {
          if (opts.durable) failing = true;
          throw new UsersWriteError(String((err as NodeJS.ErrnoException | undefined)?.code ?? err));
        }
        failing = false;
        current = users;
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}

/** What the portal runs on with no data folder, and what the tests start from: no users of its own, and nothing can be changed. */
export const noUsers = (): UserStore => keep([], { durable: false, editable: false }, async () => undefined);

/** Users kept in memory that can be changed, for the tests. */
export const memoryUsers = (initial: StoredUser[] = []): UserStore => keep(copy(initial), { durable: false, editable: true }, async () => undefined);

async function readFileUsers(file: string): Promise<{ text: string | null; parsed: ReturnType<typeof readUsers> | null }> {
  let text: string | null = null;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (text === null) return { text, parsed: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  return { text, parsed: readUsers(raw) };
}

/**
 * Opens the users in `dir`, or a store that keeps none when `dir` is empty or cannot be used. Never throws: a portal that cannot keep its users still lets the
 * `.env` ones in. A file it cannot read is put aside, not deleted, and the file before the last change is tried; if that cannot be read either, the users of `.env` stand alone.
 */
export async function openUsers(dir: string, warn: (message: string) => void): Promise<UserStore> {
  if (dir === '') return noUsers();
  const file = join(dir, FILE_NAME);
  const durable = { durable: true, editable: true };
  const persist = async (next: StoredUser[]) => {
    await copyFile(file, `${file}.prev`).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
    await writeJsonAtomic(file, { version: 1, users: next });
  };
  try {
    await mkdir(dir, { recursive: true });
    const first = await readFileUsers(file);
    let users: StoredUser[] = [];
    let rewrite = false;
    if (first.parsed?.usable) {
      users = first.parsed.users;
      for (const line of new Set(first.parsed.repairs)) warn(line);
      if (first.parsed.repairs.length > 0) {
        // The file as it was is kept before it is rewritten without the records that were dropped, so that one with a single wrong field can be put back by hand (BK-98).
        const kept = await copyFile(file, `${file}.repaired-${Date.now()}`).then(() => true, () => false);
        if (kept) warn(`The file as it was is kept as ${FILE_NAME}.repaired-<time>.`);
        else warn(`The file as it was could not be copied, so ${FILE_NAME} was left as it is.`);
        rewrite = kept;
      }
    } else if (first.text !== null) {
      await rename(file, `${file}.broken-${Date.now()}`);
      const previous = await readFileUsers(`${file}.prev`).catch(() => ({ text: null, parsed: null }));
      if (previous.parsed?.usable) {
        users = previous.parsed.users;
        warn(`The portal's file of users (${FILE_NAME}) could not be read and was put aside as ${FILE_NAME}.broken-<time>. The file before the last change was used instead: check the last changes to the users.`);
      } else {
        warn(`The portal's file of users (${FILE_NAME}) could not be read and was put aside as ${FILE_NAME}.broken-<time>, and ${FILE_NAME}.prev could not be read either. Only the users of .env can sign in until it is put right.`);
      }
      rewrite = users.length > 0;
    }
    if (rewrite) await writeJsonAtomic(file, { version: 1, users });
    return keep(users, durable, persist);
  } catch {
    warn('The portal cannot read or write its data folder (PORTAL_STATE_DIR) for its users, so they stay in .env and the Users page is read-only.');
    return noUsers();
  }
}
