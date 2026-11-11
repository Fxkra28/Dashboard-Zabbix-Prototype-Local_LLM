import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCRYPT_DEFAULTS, hashPassword, isCommon, isGuessable, parseStoredPassword, verifyPassword } from '../security/passwords.js';

/**
 * Password storage: plain text as before, or a self-describing scrypt hash,
 * compared on digests of equal length. Every password here is made up for the test.
 */
const verify = (stored: string, candidate: string) => verifyPassword(parseStoredPassword(stored), candidate);
// A small cost keeps the tests quick; the settings travel inside each hash.
const CHEAP = { N: 1024, r: 8, p: 1 };

describe('hashPassword', () => {
  it('writes scrypt.N.r.p.salt.hash with the cost settings in the text, and nothing PORTAL_USERS or compose would misread', async () => {
    const h = await hashPassword('correct horse: battery, staple');
    const m = /^scrypt\.(\d+)\.(\d+)\.(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(h);
    expect(m, h).not.toBeNull();
    expect({ N: Number(m![1]), r: Number(m![2]), p: Number(m![3]) }).toEqual(SCRYPT_DEFAULTS);
    expect(Buffer.from(m![4], 'base64url')).toHaveLength(16);
    expect(Buffer.from(m![5], 'base64url')).toHaveLength(32);
    // ':' and ',' split a PORTAL_USERS entry, '$' is read by docker compose, and a space would be trimmed.
    expect(h).not.toMatch(/[:,$\s]/);
    // The password never appears in what is stored.
    expect(h).not.toContain('horse');
  });

  it('gives a different hash each time (a fresh salt), and every one verifies', async () => {
    const [a, b] = [await hashPassword('same-password', CHEAP), await hashPassword('same-password', CHEAP)];
    expect(a).not.toBe(b);
    expect(await verify(a, 'same-password')).toBe(true);
    expect(await verify(b, 'same-password')).toBe(true);
  });

  it('keeps the cost it was made with, so a hash made at another cost still verifies', async () => {
    const old = await hashPassword('old-entry', CHEAP);
    expect(old.startsWith('scrypt.1024.8.1.')).toBe(true);
    expect(await verify(old, 'old-entry')).toBe(true);
    const dearer = await hashPassword('new-entry', { N: 2048, r: 8, p: 2 });
    expect(dearer.startsWith('scrypt.2048.8.2.')).toBe(true);
    expect(await verify(dearer, 'new-entry')).toBe(true);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and refuses a wrong one, an empty one and a near miss', async () => {
    const h = await hashPassword('Tr0ub4dor&3', CHEAP);
    expect(await verify(h, 'Tr0ub4dor&3')).toBe(true);
    for (const wrong of ['', 'tr0ub4dor&3', 'Tr0ub4dor&3 ', 'Tr0ub4dor&', 'x']) expect(await verify(h, wrong), JSON.stringify(wrong)).toBe(false);
  });

  it('keeps plain entries working: the exact text signs in, anything else does not', async () => {
    expect(await verify('plain-pass', 'plain-pass')).toBe(true);
    expect(await verify('plain-pass', 'Plain-pass')).toBe(false);
    expect(await verify('with:colon', 'with:colon')).toBe(true);
  });

  it('compares digests of one length, so a password of any length is judged and never throws', async () => {
    // timingSafeEqual throws on buffers of different lengths; comparing the raw text would.
    for (const candidate of ['', 'x', 'x'.repeat(5000)]) {
      expect(await verify('plain-pass', candidate)).toBe(false);
      expect(await verify(await hashPassword('plain-pass', CHEAP), candidate)).toBe(false);
    }
  });

  it('never verifies an entry that is not a usable hash', async () => {
    expect(await verifyPassword({ kind: 'invalid' }, 'scrypt.')).toBe(false);
  });
});

describe('parseStoredPassword', () => {
  it('reads anything that does not start with "scrypt." as plain text', () => {
    for (const plain of ['admin', 'Scrypt.x', 'my-scrypt.pass', 'a.b.c.d.e.f']) expect(parseStoredPassword(plain).kind, plain).toBe('plain');
  });

  const SALT = 'AAAAAAAAAAAAAAAAAAAAAA'; // 16 bytes
  const KEY = 'A'.repeat(43); // 32 bytes
  it('accepts a well-formed hash', () => {
    expect(parseStoredPassword(`scrypt.32768.8.1.${SALT}.${KEY}`)).toMatchObject({ kind: 'scrypt', params: { N: 32768, r: 8, p: 1 } });
  });

  it.each([
    ['no fields', 'scrypt.'],
    ['too few fields', 'scrypt.32768.8.1.AAAA'],
    ['too many fields', `scrypt.32768.8.1.${SALT}.${KEY}.x`],
    ['N not a power of two', `scrypt.32000.8.1.${SALT}.${KEY}`],
    ['N too small to mean anything', `scrypt.512.8.1.${SALT}.${KEY}`],
    ['r of zero', `scrypt.32768.0.1.${SALT}.${KEY}`],
    ['p too high', `scrypt.32768.8.17.${SALT}.${KEY}`],
    ['more memory than any sign-in should take', `scrypt.1048576.8.1.${SALT}.${KEY}`],
    ['a salt under 8 bytes', `scrypt.32768.8.1.AAAA.${KEY}`],
    ['a hash under 16 bytes', `scrypt.32768.8.1.${SALT}.AAAA`],
    ['characters outside base64url', `scrypt.32768.8.1.${SALT}.${KEY.slice(0, 40)}+/=`],
    ['base64 that does not round-trip', `scrypt.32768.8.1.${SALT}.${'A'.repeat(42)}B`],
  ])('refuses %s', (_why, text) => {
    expect(parseStoredPassword(text).kind).toBe('invalid');
  });
});

describe('isGuessable', () => {
  it('flags an empty password and "admin", plain or hashed, and nothing else', async () => {
    expect([isGuessable(''), isGuessable('admin'), isGuessable('a-long-real-password')]).toEqual([true, true, false]);
    expect(isGuessable(await hashPassword('', CHEAP))).toBe(true);
    expect(isGuessable(await hashPassword('admin', CHEAP))).toBe(true);
    expect(isGuessable(await hashPassword('a-long-real-password', CHEAP))).toBe(false);
  });

  it('leaves an unusable hash to the parser, which refuses it', () => {
    expect(isGuessable('scrypt.nonsense')).toBe(false);
  });
});

describe('isCommon (SC-46)', () => {
  it.each(['secret', 'Secret', 'ZABBIX', ' password ', 'changeme', 'ChangeMe', '123456'])('flags %j, whatever its case and spaces', (stored) => {
    expect(isCommon(stored)).toBe(true);
  });

  it.each(['<a long password>', '<password>', ' <your password> '])('flags the placeholder %j from the documents', (stored) => {
    expect(isCommon(stored)).toBe(true);
  });

  it.each(['a-long-real-password', 'secretive', 'zabbix-2026-long-one', 'pass word', '1234567', '<open', 'close>', ''])('leaves %j alone', (stored) => {
    expect(isCommon(stored)).toBe(false);
  });

  it('flags a hash of a common password, and of nothing else', async () => {
    expect(isCommon(await hashPassword('secret', CHEAP))).toBe(true);
    expect(isCommon(await hashPassword('zabbix', CHEAP))).toBe(true);
    expect(isCommon(await hashPassword('a-long-real-password', CHEAP))).toBe(false);
    expect(isCommon('scrypt.nonsense')).toBe(false);
  });
});

describe('scripts/hash-password.ts', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const run = (input: string) =>
    spawnSync(`${root}/node_modules/.bin/tsx`, ['scripts/hash-password.ts'], { cwd: root, input, encoding: 'utf8' });

  it('prints one hash for the password on standard input, which signs in, and nothing else', async () => {
    const res = run('pa:ss,word with spaces\n');
    expect(res.status).toBe(0);
    const hash = res.stdout.trim();
    expect(res.stdout).toBe(`${hash}\n`);
    expect(res.stderr).toBe('');
    expect(await verify(hash, 'pa:ss,word with spaces')).toBe(true);
    // One trailing newline is the Enter key, not part of the password.
    expect(await verify(hash, 'pa:ss,word with spaces\n')).toBe(false);
    expect(res.stdout).not.toContain('word');
  });

  it('takes a password with no trailing newline as it is, and drops one CRLF', async () => {
    expect(await verify(run('no-newline').stdout.trim(), 'no-newline')).toBe(true);
    expect(await verify(run('windows-style\r\n').stdout.trim(), 'windows-style')).toBe(true);
  });

  it('refuses an empty password: exit code 1, no hash, and a message on standard error', () => {
    for (const input of ['', '\n']) {
      const res = run(input);
      expect(res.status, JSON.stringify(input)).toBe(1);
      expect(res.stdout).toBe('');
      expect(res.stderr).toContain('No password given');
    }
  });
});
