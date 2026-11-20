import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Directory, EnvUser } from '../security/accounts.js';
import { MODULE_IDS, presetFor } from '../security/modules.js';
import { hashPassword, parseStoredPassword, verifyPassword } from '../security/passwords.js';
import { memoryUsers, noUsers, type StoredUser, type UserStore } from '../security/userStore.js';

/** Who can sign in (ADR-0017): the users of .env, the users of the file, the seed between them, and the rules of a change. */

vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
});
const { createDirectory, readEnvUsers, parseEnvUsers, usable, viewOf, UserError, onAccountChange, adminWarning, legacyHashWarning } = await import('../security/accounts.js');
const { initUsers, useUserDirectory } = await import('../services/userDirectory.js');
const { config } = await import('../core/config.js');

const warnings: string[] = [];
const warn = (m: string) => void warnings.push(m);
const CHEAP = { N: 1024, r: 8, p: 1 };
let HASH: string;
beforeEach(async () => {
  warnings.length = 0;
  HASH ??= await hashPassword('a-long-test-password', CHEAP);
  vi.unstubAllEnvs();
});

const env = (entries: string): EnvUser[] => {
  vi.stubEnv('PORTAL_USERS', entries);
  return readEnvUsers(warn);
};
const stored = (over: Partial<StoredUser> = {}): StoredUser => ({
  id: crypto.randomUUID(),
  name: 'ana.putri',
  displayName: 'Ana Putri',
  role: 'operator',
  modules: ['problems', 'sla'],
  language: null,
  hash: HASH,
  created: 1_790_000_000,
  createdBy: 'root',
  lastSignIn: 0,
  disabled: false,
  expires: null,
  mustChange: false,
  notBefore: 0,
  ...over,
});
const directory = (entries = 'root:root-pass-123:admin', users: StoredUser[] = []): { dir: Directory; store: UserStore } => {
  const store = memoryUsers(users);
  return { dir: createDirectory(env(entries), store), store };
};
const rejects = async (promise: Promise<unknown>, status: number, text: string | RegExp) => {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err, `no refusal, wanted ${text}`).toBeInstanceOf(UserError);
  expect((err as InstanceType<typeof UserError>).statusCode).toBe(status);
  expect((err as Error).message).toMatch(text);
};

describe('the users of .env', () => {
  it('read viewer as a guest with the pages a viewer had, and wall as a guest with the network pages too', () => {
    const users = env('v:viewer-pass:viewer,w:wall-pass:wall,o:operator-pass:operator,a:admin-pass:admin,g:guest-pass:guest,n:no-role-pass');
    const byName = Object.fromEntries(users.map((u) => [u.name, u]));
    expect(users.map((u) => u.role)).toEqual(['guest', 'guest', 'operator', 'admin', 'guest', 'guest']);
    expect(byName.v.modules).toEqual(presetFor('guest'));
    expect(byName.v.modules).not.toContain('network');
    expect(byName.w.modules).toEqual(expect.arrayContaining(['network', 'links', 'sla']));
    expect(byName.w.modules).not.toContain('inventory');
    expect(byName.o.modules).toEqual(presetFor('operator'));
    expect(byName.a.modules).toEqual([...MODULE_IDS]);
    expect(byName.g.modules).toEqual(presetFor('guest'));
    expect(byName.n.role).toBe('guest');
  });

  it('make the first administrator the break-glass account, and only that one', () => {
    const users = env('v:viewer-pass:viewer,a:admin-pass:admin,b:other-admin-pass:admin');
    expect(users.map((u) => u.breakGlass)).toEqual([false, true, false]);
  });

  it('are the single administrator of PORTAL_USER and PORTAL_PASS when PORTAL_USERS is empty, which is the break-glass account', () => {
    vi.stubEnv('PORTAL_USERS', '');
    const users = readEnvUsers();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ name: config.auth.user, role: 'admin', breakGlass: true });
  });

  it('warn by position, never by text, and name a role they do not know', () => {
    env(':nameless:admin,gigi::admin,hana:hana-pass:vewer');
    expect(warnings.some((w) => w.includes('entry 1 of 3'))).toBe(true);
    expect(warnings.some((w) => w.includes('entry for "hana" has an unknown role; it gets guest'))).toBe(true);
    for (const secret of ['nameless', 'hana-pass', 'vewer']) expect(warnings.join(' ')).not.toContain(secret);
  });

  it('parse an entry like the sign-in has always read it: the password may hold colons', () => {
    expect(parseEnvUsers('ana:pa:ss:w0rd:operator', warn)[0]).toMatchObject({ name: 'ana', pass: 'pa:ss:w0rd', role: 'operator' });
    expect(parseEnvUsers('ana:pa:ss', warn)[0]).toMatchObject({ pass: 'pa', role: 'guest' });
  });
});

describe('who is in the directory', () => {
  it('with no store of its own: the users of .env, the break-glass one first, and nothing can be changed', async () => {
    const dir = createDirectory(env('v:viewer-pass:viewer,a:admin-pass:admin'), noUsers());
    expect(dir.accounts().map((a) => [a.name, a.source, a.breakGlass])).toEqual([['a', 'env', true], ['v', 'env', false]]);
    await rejects(dir.create({ name: 'new.user', role: 'guest', password: 'a-long-password-1' }, 'a'), 409, 'no data folder');
    await rejects(dir.update('v', { disabled: true }, 'a'), 409, 'no data folder');
  });

  it('with a store: the break-glass account first, then the file, then any .env user the file does not hold', () => {
    const { dir } = directory('o:operator-pass:operator,root:root-pass-123:admin', [stored({ name: 'ana.putri' }), stored({ name: 'o' })]);
    // `o` is in the file as well as in .env: the file's is the one that signs in.
    expect(dir.accounts().map((a) => [a.name, a.source])).toEqual([['root', 'env'], ['ana.putri', 'file'], ['o', 'file']]);
  });

  it('never lets a file user take the name of the break-glass account, whatever the case', () => {
    const { dir } = directory('root:root-pass-123:admin', [stored({ name: 'ROOT' })]);
    expect(dir.accounts().map((a) => [a.name, a.source])).toEqual([['root', 'env']]);
  });

  it('keeps entries of .env that repeat a name, each able to sign in', () => {
    const dir = createDirectory(env('dup:admin-pass:admin,dup:view-pass:viewer'), memoryUsers());
    expect(dir.accounts().map((a) => a.role)).toEqual(['admin', 'guest']);
    expect(dir.byName('dup')).toBeUndefined();
    expect(dir.named('DUP')).toHaveLength(2);
  });

  it('finds by the exact name, and by the name without regard to case', () => {
    const { dir } = directory('root:root-pass-123:admin', [stored({ name: 'Ana.Putri' })]);
    expect(dir.byName('Ana.Putri')?.source).toBe('file');
    expect(dir.byName('ana.putri')).toBeUndefined();
    expect(dir.named('ANA.PUTRI')).toHaveLength(1);
  });

  it('says a user is usable until they are disabled or past their expiry', () => {
    const { dir } = directory('root:root-pass-123:admin', [stored({ name: 'ana.putri', expires: 2_000 }), stored({ name: 'budi.santoso', disabled: true })]);
    const [, ana, budi] = dir.accounts();
    expect(usable(ana, 1_999)).toBe(true);
    expect(usable(ana, 2_000)).toBe(false);
    expect(usable(budi, 0)).toBe(false);
    expect(usable(dir.accounts()[0], 9_999_999_999)).toBe(true);
  });
});

describe('the seed from .env', () => {
  it('adds the users of PORTAL_USERS that the file does not hold, as users of the file with a hash and the pages of their role, and leaves the break-glass account in .env', async () => {
    const { dir, store } = directory('root:root-pass-123:admin,vin:viewer-pass:viewer,wal:wall-pass:wall,opa:operator-pass:operator');
    await dir.seed(warn);
    const users = store.list();
    expect(users.map((u) => u.name)).toEqual(['vin', 'wal', 'opa']);
    expect(users.map((u) => u.role)).toEqual(['guest', 'guest', 'operator']);
    expect(users[1].modules).toEqual(expect.arrayContaining(['network', 'links']));
    expect(users[0]).toMatchObject({ createdBy: 'PORTAL_USERS', mustChange: false, disabled: false, language: null });
    // No password in clear text is kept: a hash is, and it checks out.
    expect(JSON.stringify(users)).not.toMatch(/viewer-pass|wall-pass|operator-pass/);
    expect(users.every((u) => parseStoredPassword(u.hash).kind === 'argon2id')).toBe(true);
    expect(await verifyPassword(parseStoredPassword(users[0].hash), 'viewer-pass')).toBe(true);
    expect(warnings.join(' ')).toContain('3 users of PORTAL_USERS were added');
    // SC-68: the entries stay in .env, and a lost file brings every one of them back with the role and password written there.
    expect(warnings.join(' ')).toMatch(/Delete them from PORTAL_USERS/);
    expect(dir.accounts().map((a) => [a.name, a.source])).toEqual([['root', 'env'], ['vin', 'file'], ['wal', 'file'], ['opa', 'file']]);
  });

  it('keeps a hash from .env as it is, and does not add a name the file already holds', async () => {
    const hash = await hashPassword('hashed-in-env', CHEAP);
    const { dir, store } = directory(`root:root-pass-123:admin,vin:${hash}:viewer,opa:operator-pass:operator`, [stored({ name: 'OPA', role: 'admin' })]);
    await dir.seed(warn);
    expect(store.list().map((u) => [u.name, u.role])).toEqual([['OPA', 'admin'], ['vin', 'guest']]);
    expect(store.list()[1].hash).toBe(hash);
    expect(warnings.join(' ')).toContain('already holds');
    expect(warnings.join(' ')).toMatch(/Delete them from PORTAL_USERS/);
  });

  it('adds nothing a second time, so a user disabled in the file stays disabled and one changed on the page stays changed', async () => {
    const { dir, store } = directory('root:root-pass-123:admin,vin:viewer-pass:viewer');
    await dir.seed(warn);
    await dir.update('vin', { disabled: true, role: 'operator' }, 'root');
    warnings.length = 0;
    await dir.seed(warn);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ disabled: true, role: 'operator' });
  });

  it('leaves a name the file cannot take in .env, and says so without the password', async () => {
    const { dir, store } = directory('root:root-pass-123:admin,ab:short-name-pass:viewer,fine.name:fine-pass-1:viewer');
    await dir.seed(warn);
    expect(store.list().map((u) => u.name)).toEqual(['fine.name']);
    expect(warnings.join(' ')).toContain('"ab"');
    expect(warnings.join(' ')).not.toContain('short-name-pass');
    expect(dir.accounts().map((a) => [a.name, a.source])).toEqual([['root', 'env'], ['fine.name', 'file'], ['ab', 'env']]);
  });

  it('does nothing without a store that can be changed, and never throws when it cannot save', async () => {
    const dir = createDirectory(env('root:root-pass-123:admin,vin:viewer-pass:viewer'), noUsers());
    await dir.seed(warn);
    expect(dir.accounts()).toHaveLength(2);
    const failing = memoryUsers();
    vi.spyOn(failing, 'change').mockRejectedValue(new Error('disk full'));
    await createDirectory(env('root:root-pass-123:admin,vin:viewer-pass:viewer'), failing).seed(warn);
    expect(warnings.join(' ')).toContain('could not be added');
  });
});

describe('adding a user', () => {
  it('gives the user the pages of the role, a hash and a temporary password, and the name and case as typed', async () => {
    const { dir, store } = directory();
    const account = await dir.create({ name: 'Budi.Santoso', role: 'operator', password: 'a-long-password-1' }, 'root');
    expect(account).toMatchObject({ name: 'Budi.Santoso', displayName: 'Budi.Santoso', role: 'operator', source: 'file', mustChange: true, disabled: false, createdBy: 'root', language: null });
    expect(account.modules).toEqual(presetFor('operator'));
    const [record] = store.list();
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await verifyPassword(parseStoredPassword(record.hash), 'a-long-password-1')).toBe(true);
    expect(record.hash).not.toContain('a-long-password-1');
  });

  it('keeps the modules it is given, drops nothing for a guest, and gives an administrator every one', async () => {
    const { dir } = directory();
    expect((await dir.create({ name: 'guest.one', role: 'guest', modules: ['sla', 'sla', 'noise'], password: 'a-long-password-1' }, 'root')).modules).toEqual(['sla', 'noise']);
    expect((await dir.create({ name: 'admin.two', role: 'admin', modules: [], password: 'a-long-password-1' }, 'root')).modules).toEqual([...MODULE_IDS]);
  });

  it('refuses a module the role cannot have, a name that is taken whatever the case, a bad name and a weak password, each in words', async () => {
    const { dir } = directory('root:root-pass-123:admin', [stored({ name: 'ana.putri' })]);
    const base = { name: 'new.user', role: 'guest' as const, password: 'a-long-password-1' };
    await rejects(dir.create({ ...base, modules: ['sla', 'inventory'] }, 'root'), 400, 'inventory');
    await rejects(dir.create({ ...base, role: 'operator', modules: ['users'] }, 'root'), 400, /pages? for administrators/);
    await rejects(dir.create({ ...base, name: 'ANA.PUTRI' }, 'root'), 409, 'already a user called');
    await rejects(dir.create({ ...base, name: 'ROOT' }, 'root'), 409, 'already a user called');
    await rejects(dir.create({ ...base, name: 'no' }, 'root'), 400, 'sign-in name');
    await rejects(dir.create({ ...base, name: 'with space' }, 'root'), 400, 'sign-in name');
    await rejects(dir.create({ ...base, password: 'short' }, 'root'), 400, 'at least 8');
    await rejects(dir.create({ ...base, password: 'password' }, 'root'), 400, 'anyone can guess');
    await rejects(dir.create({ ...base, password: 'x'.repeat(257) }, 'root'), 400, 'at most 256');
    await rejects(dir.create({ ...base, role: 'owner' as never }, 'root'), 400, 'guest, operator or admin');
    await rejects(dir.create({ ...base, displayName: 'x'.repeat(81) }, 'root'), 400, 'at most 80');
    await rejects(dir.create({ ...base, expires: 5 }, 'root'), 400, 'in the future');
  });
});

describe('changing a user', () => {
  const two = () => directory('root:root-pass-123:admin', [stored({ name: 'ana.putri', role: 'operator', modules: ['problems', 'sla', 'network'] }), stored({ name: 'second.admin', role: 'admin', modules: [...MODULE_IDS] })]);

  it('changes the name shown, the language, the expiry and the modules', async () => {
    const { dir } = two();
    const in30Days = Math.floor(Date.now() / 1000) + 30 * 86_400;
    const account = await dir.update('ana.putri', { displayName: 'Ana P.', language: 'id', expires: in30Days, modules: ['problems'] }, 'root');
    expect(account).toMatchObject({ displayName: 'Ana P.', language: 'id', expires: in30Days, modules: ['problems'] });
    expect((await dir.update('ana.putri', { displayName: '  ' }, 'root')).displayName).toBe('ana.putri');
    expect((await dir.update('ana.putri', { expires: null }, 'root')).expires).toBeNull();
  });

  it('keeps the modules a new role still allows, and gives an administrator all of them', async () => {
    const { dir } = two();
    expect((await dir.update('ana.putri', { role: 'guest' }, 'root')).modules).toEqual(['problems', 'sla', 'network']);
    expect((await dir.update('ana.putri', { role: 'admin' }, 'root')).modules).toEqual([...MODULE_IDS]);
    // Demoted from administrator, the person keeps what a guest may have and loses the administrator's own pages.
    const back = await dir.update('ana.putri', { role: 'guest' }, 'root');
    expect(back.modules).toEqual(expect.arrayContaining(['problems', 'sla']));
    expect(back.modules).not.toEqual(expect.arrayContaining(['users']));
    expect(back.modules).not.toContain('inventory');
  });

  it('refuses a module that does not exist, and an administrator page for a guest', async () => {
    const { dir } = two();
    await rejects(dir.update('ana.putri', { modules: ['sla', 'telepathy' as never] }, 'root'), 400, 'not one the portal has');
    await rejects(dir.update('ana.putri', { modules: ['inventory'] }, 'root'), 400, 'inventory');
  });

  it('disables and enables, and ends no administrator it should not', async () => {
    const { dir } = two();
    expect((await dir.update('ana.putri', { disabled: true }, 'root')).disabled).toBe(true);
    expect((await dir.update('ana.putri', { disabled: false }, 'root')).disabled).toBe(false);
  });

  it('keeps an administrator from disabling, demoting or expiring their own account', async () => {
    const { dir } = two();
    await rejects(dir.update('second.admin', { disabled: true }, 'second.admin'), 409, 'your own account');
    await rejects(dir.update('second.admin', { role: 'operator' }, 'second.admin'), 409, 'your own account');
    await rejects(dir.update('second.admin', { expires: Math.floor(Date.now() / 1000) + 1 }, 'second.admin').then(() => Promise.reject(new UserError('no refusal', 409, 'conflict')), (e) => Promise.reject(e)), 409, 'no refusal');
    // Another administrator can.
    expect((await dir.update('second.admin', { disabled: true }, 'root')).disabled).toBe(true);
  });

  it('leaves the change out and the users as they were when it would leave no administrator who can sign in', async () => {
    const store = memoryUsers([stored({ name: 'only.admin', role: 'admin', modules: [...MODULE_IDS] })]);
    // No administrator in .env, so the file's is the last one.
    const dir = createDirectory(env('v:viewer-pass:viewer'), store);
    await rejects(dir.update('only.admin', { disabled: true }, 'someone'), 409, 'no administrator');
    await rejects(dir.update('only.admin', { role: 'operator' }, 'someone'), 409, 'no administrator');
    expect(store.list()[0]).toMatchObject({ disabled: false, role: 'admin' });
  });

  it('counts the break-glass account as an administrator who can always sign in', async () => {
    const { dir } = directory('root:root-pass-123:admin', [stored({ name: 'only.admin', role: 'admin', modules: [...MODULE_IDS] })]);
    expect((await dir.update('only.admin', { disabled: true }, 'root')).disabled).toBe(true);
  });

  it('refuses a user kept in .env, the break-glass one included, and one that is not there', async () => {
    const { dir } = directory('root:root-pass-123:admin,v:viewer-pass:viewer', [stored()]);
    await rejects(dir.update('root', { disabled: true }, 'x'), 409, 'kept in .env');
    await rejects(dir.update('v', { role: 'admin' }, 'x'), 409, 'kept in .env');
    await rejects(dir.setPassword('root', 'a-long-password-1', { mustChange: true }), 409, 'kept in .env');
    await rejects(dir.update('nobody', { disabled: true }, 'x'), 404, 'no user "nobody"');
  });

  it('shows what the Users page needs and no hash', async () => {
    const { dir } = two();
    const view = viewOf(dir.accounts().find((a) => a.name === 'ana.putri')!);
    expect(Object.keys(view).sort()).toEqual(['breakGlass', 'created', 'createdBy', 'disabled', 'displayName', 'expires', 'language', 'lastSignIn', 'modules', 'mustChange', 'name', 'role', 'source']);
    expect(viewOf(dir.accounts()[0])).toMatchObject({ name: 'root', source: 'env', breakGlass: true, modules: [...MODULE_IDS], lastSignIn: null });
  });
});

describe('passwords', () => {
  it('resets, voids older sessions and asks for a new one at the next sign-in, unless it is told not to', async () => {
    const { dir } = directory('root:root-pass-123:admin', [stored()]);
    const before = Math.floor(Date.now() / 1000);
    const reset = await dir.setPassword('ana.putri', 'a-brand-new-password', { mustChange: true });
    expect(reset).toMatchObject({ mustChange: true });
    expect(reset.notBefore).toBeGreaterThanOrEqual(before);
    expect(await verifyPassword(reset.check, 'a-brand-new-password')).toBe(true);
    expect((await dir.setPassword('ana.putri', 'another-new-password', { mustChange: false })).mustChange).toBe(false);
    await rejects(dir.setPassword('ana.putri', 'short', { mustChange: true }), 400, 'at least 8');
    await rejects(dir.setPassword('nobody', 'a-brand-new-password', { mustChange: true }), 404, 'no user');
  });

  it('lets a user change their own when they know the current one, ends their older sessions and clears the temporary mark', async () => {
    const own = await hashPassword('the-current-password', CHEAP);
    const { dir } = directory('root:root-pass-123:admin', [stored({ hash: own, mustChange: true })]);
    await rejects(dir.changeOwnPassword('ana.putri', 'not-the-current', 'a-brand-new-password'), 400, 'current password is not right');
    await rejects(dir.changeOwnPassword('ana.putri', 'the-current-password', 'short'), 400, 'at least 8');
    await rejects(dir.changeOwnPassword('ana.putri', 'the-current-password', 'the-current-password'), 400, 'not the one you have now');
    const changed = await dir.changeOwnPassword('ana.putri', 'the-current-password', 'a-brand-new-password');
    expect(changed.mustChange).toBe(false);
    expect(changed.notBefore).toBeGreaterThan(0);
    expect(await verifyPassword(changed.check, 'a-brand-new-password')).toBe(true);
    expect(await verifyPassword(changed.check, 'the-current-password')).toBe(false);
    await rejects(dir.changeOwnPassword('root', 'root-pass-123', 'a-brand-new-password'), 409, 'kept in .env');
  });

  it('records a sign-in at most once a minute, and rewrites a weaker hash with the portal\'s own', async () => {
    const weak = await hashPassword('weak-hash-password', CHEAP);
    const { dir, store } = directory('root:root-pass-123:admin', [stored({ hash: weak })]);
    await dir.signedIn('ana.putri', 'weak-hash-password');
    const [after] = store.list();
    expect(after.lastSignIn).toBeGreaterThan(0);
    expect(parseStoredPassword(after.hash)).toMatchObject({ kind: 'argon2id', params: { m: 47_104, t: 1, p: 1 } });
    expect(await verifyPassword(parseStoredPassword(after.hash), 'weak-hash-password')).toBe(true);

    const changes = vi.spyOn(store, 'change');
    await dir.signedIn('ana.putri', 'weak-hash-password');
    expect(changes).not.toHaveBeenCalled();
    // A name the file does not hold is no one's sign-in to record, and a store that fails does not fail the sign-in.
    await dir.signedIn('root', 'root-pass-123');
    changes.mockRejectedValue(new Error('disk full'));
    store.list()[0].lastSignIn = 0;
    await expect(dir.signedIn('nobody', 'x')).resolves.toBeUndefined();
  });
});

describe('a person who left .env and stayed in the file (SC-67)', () => {
  it('is named in one warning at start: removing the entry does not end their access, and Disable does', async () => {
    const { dir } = directory('root:root-pass-123:admin', [
      stored({ name: 'the.leaver', createdBy: 'PORTAL_USERS' }),
      stored({ name: 'already.disabled', createdBy: 'PORTAL_USERS', disabled: true }),
      stored({ name: 'made.on.the.page', createdBy: 'root' }),
    ]);
    await dir.seed(warn);
    const text = warnings.join(' ');
    expect(text).toContain('"the.leaver"');
    expect(text).not.toContain('already.disabled');
    expect(text).not.toContain('made.on.the.page');
    expect(text).toMatch(/still sign in/);
    expect(text).toMatch(/Disable/);
  });

  it('is not named while the entry is still in PORTAL_USERS, and nothing is said when no one has left', async () => {
    const { dir } = directory('root:root-pass-123:admin,vin:viewer-pass:viewer');
    await dir.seed(warn);
    warnings.length = 0;
    await dir.seed(warn);
    expect(warnings.join(' ')).not.toMatch(/still sign in/);
  });
});

describe('what Disable and Enable leave behind (SC-57)', () => {
  const two = () => directory('root:root-pass-123:admin', [stored({ name: 'ana.putri' }), stored({ name: 'long.gone', expires: 1_000 })]);

  it('voids the older sessions when a person is disabled, and keeps that when they are enabled again', async () => {
    const { dir } = two();
    const before = Math.floor(Date.now() / 1000);
    const disabled = await dir.update('ana.putri', { disabled: true }, 'root');
    expect(disabled.notBefore).toBeGreaterThanOrEqual(before);
    const enabled = await dir.update('ana.putri', { disabled: false }, 'root');
    expect(enabled.notBefore).toBe(disabled.notBefore);
  });

  it('leaves the sessions alone for a change that disables no one', async () => {
    const { dir } = two();
    expect((await dir.update('ana.putri', { displayName: 'Ana', language: 'id', mustChange: false }, 'root')).notBefore).toBe(0);
    expect((await dir.update('ana.putri', { disabled: false }, 'root')).notBefore).toBe(0);
  });

  it('voids the older sessions when an expiry that has passed is moved forward, so they do not come back with it', async () => {
    const { dir } = two();
    const later = Math.floor(Date.now() / 1000) + 86_400;
    const revived = await dir.update('long.gone', { expires: later }, 'root');
    expect(revived.notBefore).toBeGreaterThan(0);
    // An expiry set on a person who has none, or moved while it is still ahead, signs nobody out.
    expect((await dir.update('ana.putri', { expires: later }, 'root')).notBefore).toBe(0);
    expect((await dir.update('ana.putri', { expires: later + 3_600 }, 'root')).notBefore).toBe(0);
  });
});

describe('telling the live screens of a person that their account changed (SC-57)', () => {
  const two = () => directory('root:root-pass-123:admin', [stored({ name: 'ana.putri' }), stored({ name: 'second.admin', role: 'admin', modules: [...MODULE_IDS] })]);

  it('announces a disable, an expiry, a role or pages, a forced change, a reset and the own change of password, and nothing else', async () => {
    const { dir } = two();
    const heard: string[] = [];
    const stop = onAccountChange((name) => void heard.push(name));
    const quiet = async (change: Promise<unknown>) => {
      const was = heard.length;
      await change;
      expect(heard.length).toBe(was);
    };
    const loud = async (change: Promise<unknown>) => {
      const was = heard.length;
      await change;
      expect(heard.slice(was)).toEqual(['ana.putri']);
    };
    await quiet(dir.update('ana.putri', { displayName: 'Ana P.' }, 'root'));
    await quiet(dir.update('ana.putri', { language: 'id' }, 'root'));
    await quiet(dir.update('ana.putri', { disabled: false }, 'root'));
    await loud(dir.update('ana.putri', { disabled: true }, 'root'));
    await quiet(dir.update('ana.putri', { disabled: false }, 'root'));
    await loud(dir.update('ana.putri', { modules: ['sla'] }, 'root'));
    await loud(dir.update('ana.putri', { role: 'guest' }, 'root'));
    await loud(dir.update('ana.putri', { expires: Math.floor(Date.now() / 1000) + 86_400 }, 'root'));
    await loud(dir.update('ana.putri', { mustChange: true }, 'root'));
    await loud(dir.setPassword('ana.putri', 'a-brand-new-password-2', { mustChange: false }));
    await loud(dir.changeOwnPassword('ana.putri', 'a-brand-new-password-2', 'another-brand-new-password'));
    stop();
    await dir.update('ana.putri', { disabled: true }, 'root');
    expect(heard).toHaveLength(7);
  });

  it('says nothing for a change that was refused', async () => {
    const { dir } = two();
    const heard: string[] = [];
    const stop = onAccountChange((name) => void heard.push(name));
    await rejects(dir.update('second.admin', { disabled: true }, 'second.admin'), 409, 'your own account');
    await rejects(dir.setPassword('ana.putri', 'short', { mustChange: true }), 400, 'at least 8');
    stop();
    expect(heard).toEqual([]);
  });
});

describe('a portal with no one who can open the Users page (BK-100)', () => {
  const NOW = 2_000_000_000;
  it('says so when no entry of .env and no enabled user of the file is an administrator', () => {
    const { dir } = directory('v:viewer-pass:viewer,o:operator-pass:operator');
    expect(adminWarning(dir, NOW)).toMatch(/administrator/);
    expect(adminWarning(dir, NOW)).toContain('PORTAL_USERS');
  });

  it('counts a disabled administrator of the file, and one past their expiry, as none', () => {
    const disabled = directory('v:viewer-pass:viewer', [stored({ name: 'off.admin', role: 'admin', modules: [...MODULE_IDS], disabled: true })]);
    const expired = directory('v:viewer-pass:viewer', [stored({ name: 'old.admin', role: 'admin', modules: [...MODULE_IDS], expires: NOW - 1 })]);
    expect(adminWarning(disabled.dir, NOW)).not.toBeNull();
    expect(adminWarning(expired.dir, NOW)).not.toBeNull();
  });

  it('says nothing with an administrator in .env, with an enabled one in the file, or with the single administrator of PORTAL_USER', () => {
    expect(adminWarning(directory('root:root-pass-123:admin,v:viewer-pass:viewer').dir, NOW)).toBeNull();
    expect(adminWarning(directory('v:viewer-pass:viewer', [stored({ name: 'on.admin', role: 'admin', modules: [...MODULE_IDS] })]).dir, NOW)).toBeNull();
    vi.stubEnv('PORTAL_USERS', '');
    expect(adminWarning(createDirectory(readEnvUsers(warn), memoryUsers()), NOW)).toBeNull();
  });

  it('says nothing with sign-in off, where no one signs in', () => {
    config.auth.enabled = false;
    try {
      expect(adminWarning(directory('v:viewer-pass:viewer').dir, NOW)).toBeNull();
    } finally {
      config.auth.enabled = true;
    }
  });
});

describe('a hash in .env that takes longer to refuse (SC-60)', () => {
  it('names the users whose hash is older than the portal\'s own, and says why, without a password', async () => {
    const current = await hashPassword('a-long-test-password');
    const text = legacyHashWarning(env(`ana:${HASH}:operator,root:root-pass-123:admin,budi:${HASH}:guest,cici:${current}:guest`));
    expect(text).toContain('"ana", "budi"');
    expect(text).not.toContain('"root"');
    expect(text).not.toContain('"cici"');
    expect(text).toMatch(/tells a caller that the name exists/);
    expect(text).toMatch(/scripts\/hash-password\.ts/);
    expect(text).not.toContain(HASH);
    expect(text).not.toContain('root-pass-123');
  });

  it('says nothing when every hash is current and every other password is plain', async () => {
    const current = await hashPassword('a-long-test-password');
    expect(legacyHashWarning(env(`root:root-pass-123:admin,cici:${current}:guest`))).toBeNull();
    expect(legacyHashWarning([])).toBeNull();
  });

  it('is said once at start-up, with the other warnings about .env', async () => {
    vi.stubEnv('PORTAL_USERS', `ana:${HASH}:admin`);
    const said: string[] = [];
    await initUsers((m) => said.push(m));
    useUserDirectory(null);
    expect(said.filter((m) => m.includes('older kind of hash'))).toHaveLength(1);
  });
});

describe('a record of the file under a break-glass name', () => {
  // The first administrator of .env is the account of that name; a record of the file with the same name, left from before .env was reordered, is hidden and is not it.
  it('is not the account: it cannot be changed, and a sign-in does not touch it', async () => {
    const { dir, store } = directory('root:root-pass-123:admin', [stored({ name: 'root', hash: HASH })]);
    await rejects(dir.changeOwnPassword('root', 'a-long-test-password', 'a-brand-new-password'), 409, 'kept in .env');
    await rejects(dir.setPassword('root', 'a-brand-new-password', { mustChange: true }), 409, 'kept in .env');
    await rejects(dir.update('root', { disabled: true }, 'someone.else'), 409, 'kept in .env');
    await dir.signedIn('root', 'root-pass-123');
    expect(store.list()[0].lastSignIn).toBe(0);
    expect(store.list()[0].hash).toBe(HASH);
  });
});
