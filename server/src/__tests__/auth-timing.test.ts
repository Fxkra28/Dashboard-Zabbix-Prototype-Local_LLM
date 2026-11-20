import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../security/passwords.js';
import { buildAuthApp, closeAuthApps } from './helpers/authApp.js';

/**
 * A wrong password takes the same time whichever name it is tried against (SC-60). Before, an unknown name cost one Argon2id check, a user with an Argon2id hash
 * the same, a user whose password sits in `.env` as plain text 0.1 ms, so the time told which names exist and which account is the break-glass one.
 * Every name and password here is made up.
 */
afterEach(async () => {
  vi.unstubAllEnvs();
  await closeAuthApps();
});

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe('the time of a wrong password', () => {
  it('is about the same for an unknown name, a user with a hash and a user whose password is plain text', async () => {
    const hashed = await hashPassword('ana-long-password-1');
    const { signIn } = await buildAuthApp({ PORTAL_USERS: `root:plain-root-password:admin,ana:${hashed}:guest` });
    const time = async (name: string) => {
      const started = performance.now();
      const res = await signIn(name, 'a-wrong-password');
      expect(res.statusCode).toBe(401);
      return performance.now() - started;
    };
    // The first Argon2 call pays for loading it; the medians are of the rest.
    await time('warm-up');
    const samples: Record<'unknown' | 'hashed' | 'plain', number[]> = { unknown: [], hashed: [], plain: [] };
    for (let i = 0; i < 7; i++) {
      samples.unknown.push(await time(`nobody-${i}`));
      samples.hashed.push(await time('ana'));
      samples.plain.push(await time('root'));
    }
    const medians = Object.values(samples).map(median);
    expect(Math.max(...medians) / Math.min(...medians), JSON.stringify(medians)).toBeLessThan(1.7);
  });
});
