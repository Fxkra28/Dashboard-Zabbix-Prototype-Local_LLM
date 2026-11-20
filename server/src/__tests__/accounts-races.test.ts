import { describe, expect, it, vi } from 'vitest';
import { memoryUsers, type StoredUser } from '../security/userStore.js';

/**
 * A password that changes while another sign-in or change is still making its hash. Making a hash takes tens of milliseconds, and the file is written after it, so what was read before the wait
 * may no longer be what is there: the write must not put back a hash of a password that was just replaced. The hashing is the real one, wrapped so that a test can run a reset in the middle of it.
 */

vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'root:root-pass-123:admin';
});

vi.mock('../security/passwords.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../security/passwords.js')>();
  return { ...real, hashPassword: vi.fn(real.hashPassword) };
});

const { hashPassword, parseStoredPassword, verifyPassword } = await import('../security/passwords.js');
const { createDirectory, readEnvUsers, UserError } = await import('../security/accounts.js');
const real = (await vi.importActual<typeof import('../security/passwords.js')>('../security/passwords.js')).hashPassword;

const CHEAP = { N: 1024, r: 8, p: 1 };

const ana = (hash: string): StoredUser => ({
  id: crypto.randomUUID(),
  name: 'ana.putri',
  displayName: 'Ana Putri',
  role: 'operator',
  modules: ['problems', 'sla'],
  language: null,
  hash,
  created: 1_790_000_000,
  createdBy: 'root',
  lastSignIn: 0,
  disabled: false,
  expires: null,
  mustChange: false,
  notBefore: 0,
});

const directory = (hash: string) => {
  const store = memoryUsers([ana(hash)]);
  return { dir: createDirectory(readEnvUsers(() => {}), store), store };
};

/** Runs `during` inside the next call of the portal's hashing, then makes the hash as usual. */
const duringNextHash = (during: () => Promise<unknown>) =>
  vi.mocked(hashPassword).mockImplementationOnce(async (password, params) => {
    await during();
    return real(password, params);
  });

describe('the rewrite of a weaker hash at sign-in', () => {
  it('does not put a hash of the old password over one an administrator set while it was being made', async () => {
    const { dir, store } = directory(await real('the-old-password', CHEAP));
    duringNextHash(() => dir.setPassword('ana.putri', 'a-brand-new-password', { mustChange: true }));
    await dir.signedIn('ana.putri', 'the-old-password');
    const [after] = store.list();
    expect(await verifyPassword(parseStoredPassword(after.hash), 'a-brand-new-password')).toBe(true);
    expect(await verifyPassword(parseStoredPassword(after.hash), 'the-old-password')).toBe(false);
    expect(after.mustChange).toBe(true);
    // The sign-in itself still counts.
    expect(after.lastSignIn).toBeGreaterThan(0);
  });

  it('still rewrites the hash when nothing changed it meanwhile', async () => {
    const { dir, store } = directory(await real('the-old-password', CHEAP));
    await dir.signedIn('ana.putri', 'the-old-password');
    expect(parseStoredPassword(store.list()[0].hash).kind).toBe('argon2id');
  });
});

describe('a person changing their own password', () => {
  it('is refused, and the administrator\'s reset stands, when the password was reset while the new hash was being made', async () => {
    const { dir, store } = directory(await real('the-current-password', CHEAP));
    duringNextHash(() => dir.setPassword('ana.putri', 'a-reset-by-the-admin', { mustChange: true }));
    const err = await dir.changeOwnPassword('ana.putri', 'the-current-password', 'a-brand-new-password').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as InstanceType<typeof UserError>).statusCode).toBe(409);
    expect((err as Error).message).toMatch(/changed while you were choosing/);
    const [after] = store.list();
    expect(await verifyPassword(parseStoredPassword(after.hash), 'a-reset-by-the-admin')).toBe(true);
    expect(await verifyPassword(parseStoredPassword(after.hash), 'a-brand-new-password')).toBe(false);
    expect(after.mustChange).toBe(true);
  });

  it('still changes it when nothing else did', async () => {
    const { dir, store } = directory(await real('the-current-password', CHEAP));
    await dir.changeOwnPassword('ana.putri', 'the-current-password', 'a-brand-new-password');
    expect(await verifyPassword(parseStoredPassword(store.list()[0].hash), 'a-brand-new-password')).toBe(true);
  });
});
