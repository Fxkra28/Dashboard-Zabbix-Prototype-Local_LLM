import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../security/passwords.js';
import { MAX_USERS, NAME_SHAPE, memoryUsers, noUsers, openUsers, readUsers, type StoredUser } from '../security/userStore.js';

/** The file of users (ADR-0017): what it holds, how it is written, and what it does with a file it cannot read. */

const CHEAP = { N: 1024, r: 8, p: 1 };
let HASH: string;
let dir: string;
let warnings: string[];
const warn = (m: string) => void warnings.push(m);

beforeEach(async () => {
  HASH ??= await hashPassword('a-long-test-password', CHEAP);
  dir = await mkdtemp(join(tmpdir(), 'hcml-users-'));
  warnings = [];
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const user = (over: Partial<StoredUser> = {}): StoredUser => ({
  id: crypto.randomUUID(),
  name: 'ana.putri',
  displayName: 'Ana Putri',
  role: 'operator',
  modules: ['problems', 'sla'],
  language: 'id',
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
const file = () => join(dir, 'users.json');
const names = () => readdir(dir).then((l) => l.sort());

describe('readUsers', () => {
  it('reads a whole record back as it was', () => {
    const u = user();
    expect(readUsers({ version: 1, users: [u] })).toEqual({ users: [u], repairs: [], usable: true });
  });

  it('does not read a file of another kind: not an object, another version, no list', () => {
    for (const raw of [undefined, null, [], 'x', { version: 2, users: [] }, { version: 1 }, { version: 1, users: {} }]) expect(readUsers(raw).usable, JSON.stringify(raw)).toBe(false);
  });

  it('drops a record that is not whole, and says so, keeping the rest', () => {
    const good = user();
    const broken = [
      { ...user({ name: 'no.hash' }), hash: 'plain-text' },
      { ...user({ name: 'bad.role' }), role: 'viewer' },
      { ...user({ name: 'no' }) },
      { ...user({ name: 'bad.language' }), language: 'fr' },
      { ...user({ name: 'bad.moment' }), created: -1 },
      'text',
    ];
    const read = readUsers({ version: 1, users: [good, ...broken] });
    expect(read.users).toEqual([good]);
    // The line names the person when the record has a name, so that whoever reads the log knows who is missing (BK-98).
    expect(read.repairs).toEqual([
      'A record of a user ("no.hash") was not whole and was dropped.',
      'A record of a user ("bad.role") was not whole and was dropped.',
      'A record of a user ("no") was not whole and was dropped.',
      'A record of a user ("bad.language") was not whole and was dropped.',
      'A record of a user ("bad.moment") was not whole and was dropped.',
      'A record of a user was not whole and was dropped.',
    ]);
  });

  it('keeps the first of two records with one name, whatever the case, or one id', () => {
    const first = user({ name: 'Ana.Putri' });
    const read = readUsers({ version: 1, users: [first, user({ name: 'ana.putri' }), { ...user({ name: 'someone.else' }), id: first.id }] });
    expect(read.users).toEqual([first]);
    expect(read.repairs).toEqual(['A second record for "ana.putri" was dropped.', 'A second record for "someone.else" was dropped.']);
  });

  it('drops a module this version does not know and keeps the user', () => {
    const read = readUsers({ version: 1, users: [user({ modules: ['sla', 'telepathy' as never, 'sla'] })] });
    expect(read.users[0].modules).toEqual(['sla']);
    expect(read.repairs[0]).toContain('"ana.putri"');
  });

  it(`holds at most ${MAX_USERS} users`, () => {
    const many = Array.from({ length: MAX_USERS + 2 }, (_, i) => user({ name: `user.${String(i).padStart(3, '0')}` }));
    const read = readUsers({ version: 1, users: many });
    expect(read.users).toHaveLength(MAX_USERS);
    expect(read.repairs).toHaveLength(2);
  });

  it('takes a name of 3 to 64 letters, digits and . _ @ -, beginning and ending with a letter or digit', () => {
    for (const ok of ['ana', 'a.b', 'ana@hcml.example', 'a-b_c.d', '9to5', 'x'.repeat(64)]) expect(NAME_SHAPE.test(ok), ok).toBe(true);
    for (const bad of ['', 'ab', '.ana', 'ana.', 'a b', 'ana:pass', 'ana,pass', 'x'.repeat(65), 'änä']) expect(NAME_SHAPE.test(bad), bad).toBe(false);
  });
});

describe('a store that keeps nothing', () => {
  it('has no users and cannot be changed', async () => {
    const store = noUsers();
    expect(store).toMatchObject({ durable: false, editable: false });
    expect(store.list()).toEqual([]);
    await expect(store.change((d) => d.push(user()))).rejects.toThrow('could not save');
  });

  it('is what a portal with no data folder gets', async () => {
    expect(await openUsers('', warn)).toMatchObject({ durable: false, editable: false });
    expect(warnings).toEqual([]);
  });
});

describe('a store in memory that can be changed (for tests)', () => {
  it('applies a change to a copy, and hands out copies', async () => {
    const store = memoryUsers([user()]);
    expect(store).toMatchObject({ durable: false, editable: true });
    const first = store.list();
    first[0].displayName = 'changed outside';
    expect(store.list()[0].displayName).toBe('Ana Putri');
    await store.change((d) => {
      d[0].disabled = true;
    });
    expect(store.list()[0].disabled).toBe(true);
  });

  it('refuses a change that would leave the users unusable, and keeps the old ones', async () => {
    const store = memoryUsers([user()]);
    await expect(store.change((d) => d.push(user({ name: 'ANA.PUTRI' })))).rejects.toThrow('unusable');
    await expect(store.change((d) => void (d[0].role = 'root' as never))).rejects.toThrow('unusable');
    expect(store.list()).toHaveLength(1);
  });

  it('applies changes one at a time, in the order asked', async () => {
    const store = memoryUsers();
    await Promise.all(Array.from({ length: 5 }, (_, i) => store.change((d) => void d.push(user({ name: `user.${i}` })))));
    expect(store.list().map((u) => u.name)).toEqual(['user.0', 'user.1', 'user.2', 'user.3', 'user.4']);
  });
});

describe('the file in the data folder', () => {
  it('writes nothing until there is something to keep, and makes the folder', async () => {
    const inner = join(dir, 'state', 'deeper');
    const store = await openUsers(inner, warn);
    expect(store).toMatchObject({ durable: true, editable: true });
    expect(await readdir(inner)).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('writes the whole file, readable by its owner alone, and keeps the file before the last change as .prev', async () => {
    const store = await openUsers(dir, warn);
    await store.change((d) => void d.push(user()));
    expect(JSON.parse(await readFile(file(), 'utf8'))).toMatchObject({ version: 1, users: [{ name: 'ana.putri' }] });
    expect((await stat(file())).mode & 0o777).toBe(0o600);
    expect(await names()).toEqual(['users.json']);
    await store.change((d) => void d.push(user({ name: 'budi.santoso' })));
    expect(await names()).toEqual(['users.json', 'users.json.prev']);
    expect(JSON.parse(await readFile(`${file()}.prev`, 'utf8')).users.map((u: StoredUser) => u.name)).toEqual(['ana.putri']);
    expect(JSON.parse(await readFile(file(), 'utf8')).users.map((u: StoredUser) => u.name)).toEqual(['ana.putri', 'budi.santoso']);
  });

  it('reads back what it wrote, at the next start', async () => {
    const first = await openUsers(dir, warn);
    await first.change((d) => void d.push(user(), user({ name: 'budi.santoso', role: 'guest', modules: ['dashboard'] })));
    const second = await openUsers(dir, warn);
    expect(second.list().map((u) => u.name)).toEqual(['ana.putri', 'budi.santoso']);
    expect(warnings).toEqual([]);
  });

  it('writes no hash of a password in clear text, and no other secret: the record has the fields of ADR-0017 and no more', async () => {
    const store = await openUsers(dir, warn);
    await store.change((d) => void d.push(user()));
    const [record] = JSON.parse(await readFile(file(), 'utf8')).users;
    expect(Object.keys(record).sort()).toEqual(['created', 'createdBy', 'disabled', 'displayName', 'expires', 'hash', 'id', 'language', 'lastSignIn', 'modules', 'mustChange', 'name', 'notBefore', 'role']);
    expect(record.hash).toMatch(/^(argon2id|scrypt)\.\d+\.\d+\.\d+\./);
  });

  it('puts a file it cannot read aside and starts with the file before it when that reads', async () => {
    const store = await openUsers(dir, warn);
    await store.change((d) => void d.push(user()));
    await store.change((d) => void d.push(user({ name: 'budi.santoso' })));
    await writeFile(file(), '{ this is not json');
    const again = await openUsers(dir, warn);
    expect(again.list().map((u) => u.name)).toEqual(['ana.putri']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('users.json.broken-<time>');
    expect(warnings[0]).toContain('file before the last change was used');
    const left = await names();
    expect(left.filter((n) => n.startsWith('users.json.broken-'))).toHaveLength(1);
    // The put-aside copy is kept, never deleted, and the portal has written the users it started with.
    expect(JSON.parse(await readFile(file(), 'utf8')).users).toHaveLength(1);
  });

  it('starts with no users of its own, and says so, when neither file reads', async () => {
    await writeFile(file(), '[]');
    await writeFile(`${file()}.prev`, 'garbage');
    const store = await openUsers(dir, warn);
    expect(store.list()).toEqual([]);
    expect(store).toMatchObject({ durable: true, editable: true });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Only the users of .env can sign in');
    expect((await names()).some((n) => n.startsWith('users.json.broken-'))).toBe(true);
  });

  it('puts a file of another version aside and does not repair it', async () => {
    await writeFile(file(), JSON.stringify({ version: 2, users: [user()] }));
    const store = await openUsers(dir, warn);
    expect(store.list()).toEqual([]);
    expect(warnings[0]).toContain('could not be read');
  });

  it('repairs a file with a bad record: the rest is kept, the file rewritten, each repair said once', async () => {
    const good = user();
    await writeFile(file(), JSON.stringify({ version: 1, users: [good, { name: 'half' }, { name: 'half too' }] }));
    const store = await openUsers(dir, warn);
    expect(store.list()).toEqual([good]);
    expect(warnings).toEqual([
      'A record of a user ("half") was not whole and was dropped.',
      'A record of a user ("half too") was not whole and was dropped.',
      'The file as it was is kept as users.json.repaired-<time>.',
    ]);
    expect(JSON.parse(await readFile(file(), 'utf8')).users).toEqual([good]);
    // The people dropped are in a copy, so that a record with one wrong field can be put back by hand (BK-98).
    const copies = (await names()).filter((n) => n.startsWith('users.json.repaired-'));
    expect(copies).toHaveLength(1);
    expect(JSON.parse(await readFile(join(dir, copies[0]), 'utf8')).users).toHaveLength(3);
  });

  it('strips what a name could carry into the log from a record that is dropped, and cuts it short', () => {
    const read = readUsers({ version: 1, users: [{ name: 'evil\nname\u0007' + 'x'.repeat(200) }] });
    expect(read.repairs).toHaveLength(1);
    expect([...read.repairs[0]].every((ch) => ch.charCodeAt(0) >= 32)).toBe(true);
    expect(read.repairs[0].length).toBeLessThan(160);
  });

  it('keeps going without a folder it cannot use, and says the users stay in .env', async () => {
    const blocked = join(dir, 'a-file');
    await writeFile(blocked, 'not a folder');
    const store = await openUsers(join(blocked, 'inside'), warn);
    expect(store).toMatchObject({ durable: false, editable: false });
    expect(warnings[0]).toContain('stay in .env');
  });

  // A process that runs as root writes anywhere, so the folder cannot be made read-only for it.
  it.skipIf(process.getuid?.() === 0)('says a save failed, and is whole again at the next that works', async () => {
    const store = await openUsers(dir, warn);
    await store.change((d) => void d.push(user()));
    await mkdir(join(dir, 'ro'), { recursive: true });
    await chmod(dir, 0o500);
    try {
      await expect(store.change((d) => void d.push(user({ name: 'budi.santoso' })))).rejects.toThrow('could not save');
      expect(store.failing()).toBe(true);
      expect(store.list()).toHaveLength(1);
    } finally {
      await chmod(dir, 0o700);
    }
    await store.change((d) => void d.push(user({ name: 'budi.santoso' })));
    expect(store.failing()).toBe(false);
    expect(store.list()).toHaveLength(2);
  });
});
