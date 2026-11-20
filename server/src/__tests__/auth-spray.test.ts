import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthApp, closeAuthApps } from './helpers/authApp.js';

/**
 * A password spray: one common password tried once against many names from one address (SC-61). Every limit before this was for one name, so such a run was never
 * limited or noticed. Past SPRAY_FAILURES failures across SPRAY_NAMES names in one window the address is locked for a while, and one warning says how many names.
 * Every name here is made up.
 */
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await closeAuthApps();
});

const spray = async (signIn: (u: unknown, p: unknown, address?: string) => Promise<{ statusCode: number }>, names: number, perName: number, address?: string) => {
  for (let n = 0; n < names; n++) for (let k = 0; k < perName; k++) expect((await signIn(`guess-${n}`, 'Summer2026!', address)).statusCode).toBe(401);
};

describe('failed sign-ins from one address across names', () => {
  it('lock the address once there are 30 of them across 10 names, say so once with the numbers, and let it in again later', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    const { auth, signIn, warnings, events } = await buildAuthApp();
    await spray(signIn, 10, 3);
    const locked = await signIn('adi', 'admin-pass');
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBe(auth.LOGIN_LOCK_BASE_MS / 1000);
    expect(locked.json().message).toMatch(/Too many failed sign-ins from this address/);
    expect(warnings().filter((m) => /many names/.test(m))).toHaveLength(1);
    expect(events('sign_in_spray')[0]).toMatchObject({ failures: 30, names: 10 });
    // Another address is not affected, and the lock ends by itself.
    expect((await signIn('adi', 'admin-pass', '10.9.9.9')).statusCode).toBe(200);
    vi.setSystemTime(Date.now() + auth.LOGIN_LOCK_BASE_MS + 1_000);
    expect((await signIn('adi', 'admin-pass')).statusCode).toBe(200);
  });

  it('do not lock the address when they are on a few names: that is a person mistyping, and the lock of each name covers it', async () => {
    const { signIn } = await buildAuthApp();
    await spray(signIn, 5, 6);
    expect((await signIn('adi', 'admin-pass')).statusCode).toBe(200);
  });

  it('are forgotten after the window, so a slow run is not counted for ever', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    const { signIn } = await buildAuthApp();
    await spray(signIn, 9, 3);
    vi.setSystemTime(Date.now() + 16 * 60_000);
    await spray(signIn, 9, 3);
    expect((await signIn('adi', 'admin-pass')).statusCode).toBe(200);
  });

  it('lock for twice as long the next time, up to the cap of the lock of one name', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    const { auth, signIn } = await buildAuthApp();
    await spray(signIn, 10, 3);
    expect(Number((await signIn('adi', 'admin-pass')).headers['retry-after'])).toBe(auth.LOGIN_LOCK_BASE_MS / 1000);
    vi.setSystemTime(Date.now() + auth.LOGIN_LOCK_BASE_MS + 1_000);
    await spray(signIn, 10, 3);
    expect(Number((await signIn('adi', 'admin-pass')).headers['retry-after'])).toBe((auth.LOGIN_LOCK_BASE_MS * 2) / 1000);
  });
});
