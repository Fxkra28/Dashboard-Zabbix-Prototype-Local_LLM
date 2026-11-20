import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ARGON2_DEFAULTS, ARGON2_SUPPORTED, COMMON_PASSWORDS, SCRYPT_DEFAULTS, decoyVerify, hashPassword, isCommon, isGuessable, isHash, needsRehash, parseStoredPassword, passwordProblem, verifyPassword } from '../security/passwords.js';

/**
 * Password storage: plain text as before, or a self-describing Argon2id or scrypt hash,
 * compared on digests of equal length. Every password here is made up for the test.
 */
const verify = (stored: string, candidate: string) => verifyPassword(parseStoredPassword(stored), candidate);
// A small cost keeps the tests quick; the settings travel inside each hash.
const CHEAP = { N: 1024, r: 8, p: 1 };
const CHEAP_ARGON = { m: 64, t: 1, p: 1 };

describe('hashPassword', () => {
  it('writes argon2id.m.t.p.salt.hash at the OWASP setting when no cost is given, with the settings in the text and nothing PORTAL_USERS or compose would misread', async () => {
    const h = await hashPassword('correct horse: battery, staple');
    const a = /^argon2id\.(\d+)\.(\d+)\.(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(h);
    expect(a, h).not.toBeNull();
    expect({ m: Number(a![1]), t: Number(a![2]), p: Number(a![3]) }).toEqual(ARGON2_DEFAULTS);
    expect(Buffer.from(a![4], 'base64url')).toHaveLength(16);
    expect(Buffer.from(a![5], 'base64url')).toHaveLength(32);
    expect(h).not.toMatch(/[:,$\s]/);
    expect(h).not.toContain('horse');
    expect(await verify(h, 'correct horse: battery, staple')).toBe(true);
    expect(await verify(h, 'correct horse: battery, stapl')).toBe(false);
  });

  it('writes scrypt.N.r.p.salt.hash with the cost settings in the text, and nothing PORTAL_USERS or compose would misread', async () => {
    const h = await hashPassword('correct horse: battery, staple', SCRYPT_DEFAULTS);
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

describe('Argon2id', () => {
  it('has Argon2 in the Node the portal ships on, which is what makes it the default', () => {
    expect(ARGON2_SUPPORTED).toBe(true);
  });

  it('keeps the cost it was made with, gives a new salt each time, and verifies each', async () => {
    const [a, b] = [await hashPassword('same-password', CHEAP_ARGON), await hashPassword('same-password', CHEAP_ARGON)];
    expect(a.startsWith('argon2id.64.1.1.')).toBe(true);
    expect(a).not.toBe(b);
    expect(await verify(a, 'same-password')).toBe(true);
    expect(await verify(b, 'same-password')).toBe(true);
    const dearer = await hashPassword('new-entry', { m: 128, t: 2, p: 2 });
    expect(dearer.startsWith('argon2id.128.2.2.')).toBe(true);
    expect(await verify(dearer, 'new-entry')).toBe(true);
  });

  it('is read as a hash of its own kind, and refused when it is not a usable one', async () => {
    const good = await hashPassword('read-me', CHEAP_ARGON);
    expect(parseStoredPassword(good)).toMatchObject({ kind: 'argon2id', params: CHEAP_ARGON });
    expect(isHash(parseStoredPassword(good))).toBe(true);
    const [, m, t, p, salt, hash] = good.split('.');
    const unusable = [
      `argon2id.${m}.${t}.${p}.${salt}`,
      `argon2id.0.${t}.${p}.${salt}.${hash}`,
      `argon2id.4.${t}.1.${salt}.${hash}`,
      `argon2id.9999999.${t}.${p}.${salt}.${hash}`,
      `argon2id.${m}.0.${p}.${salt}.${hash}`,
      `argon2id.${m}.11.${p}.${salt}.${hash}`,
      `argon2id.${m}.${t}.0.${salt}.${hash}`,
      `argon2id.${m}.${t}.17.${salt}.${hash}`,
      `argon2id.${m}.${t}.${p}.${salt.slice(0, 4)}.${hash}`,
      `argon2id.${m}.${t}.${p}.${salt}.${hash.slice(0, 8)}`,
      'argon2id.',
    ];
    for (const entry of unusable) expect(parseStoredPassword(entry).kind, entry).toBe('invalid');
    expect(await verifyPassword({ kind: 'invalid' }, 'argon2id.')).toBe(false);
    expect(parseStoredPassword('Argon2id.x').kind).toBe('plain');
  });

  it('is told apart from a wrong password of the same length, and from scrypt', async () => {
    const h = await hashPassword('Tr0ub4dor&3', CHEAP_ARGON);
    for (const wrong of ['', 'tr0ub4dor&3', 'Tr0ub4dor&3 ', 'Tr0ub4dor&']) expect(await verify(h, wrong), JSON.stringify(wrong)).toBe(false);
    expect(await verify(await hashPassword('Tr0ub4dor&3', CHEAP), 'Tr0ub4dor&3')).toBe(true);
  });

  it('is judged by the start-up checks like any hash: guessable and common ones are found', async () => {
    expect(isGuessable(await hashPassword('', CHEAP_ARGON))).toBe(true);
    expect(isGuessable(await hashPassword('admin', CHEAP_ARGON))).toBe(true);
    expect(isGuessable(await hashPassword('a-long-real-password', CHEAP_ARGON))).toBe(false);
    expect(isCommon(await hashPassword('secret', CHEAP_ARGON))).toBe(true);
    expect(isCommon(await hashPassword('a-long-real-password', CHEAP_ARGON))).toBe(false);
  });

  it('costs an unknown name the same kind of check as a known one', async () => {
    await expect(decoyVerify('anything')).resolves.toBeUndefined();
  });
});

describe('needsRehash', () => {
  it('rewrites plain text, an Argon2id hash weaker than the default and every scrypt hash, and leaves the rest', async () => {
    expect(needsRehash(parseStoredPassword('plain-pass'))).toBe(true);
    expect(needsRehash(parseStoredPassword(await hashPassword('x-password', CHEAP_ARGON)))).toBe(true);
    expect(needsRehash(parseStoredPassword(await hashPassword('x-password', CHEAP)))).toBe(true);
    expect(needsRehash(parseStoredPassword(await hashPassword('x-password', ARGON2_DEFAULTS)))).toBe(false);
    expect(needsRehash(parseStoredPassword(await hashPassword('x-password', { m: ARGON2_DEFAULTS.m * 2, t: 2, p: 2 })))).toBe(false);
    // A scrypt hash at its own defaults is rewritten as Argon2id at the next sign-in on a Node that has it (SC-60): its check takes four times as long as the others.
    expect(needsRehash(parseStoredPassword(await hashPassword('x-password', SCRYPT_DEFAULTS)))).toBe(ARGON2_SUPPORTED);
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

describe('passwordProblem (SC-58, SC-71)', () => {
  // A hash-shaped text is the password the person typed, not a stored one: reading it as a hash made the server work the hash out at the cost it names (4.6 s and 5.2 s).
  const SALT = 'A'.repeat(22);
  const KEY = 'A'.repeat(43);
  it.each([
    ['an Argon2id one', `argon2id.131072.3.1.${SALT}.${KEY}`],
    ['a scrypt one', `scrypt.131072.8.1.${SALT}.${KEY}`],
  ])('does not work out %s a person types as a new password', (_what, shaped) => {
    const started = performance.now();
    expect(passwordProblem(shaped)).toBeNull();
    expect(performance.now() - started).toBeLessThan(250);
  });

  it.each(['12345678', 'qwerty123', 'password1', 'Zabbix123', 'aaaaaaaa', 'administrator', 'Password123', 'Welcome2026!', 'P@ssw0rd', 'Admin2026', 'november2026', 'qwertyuiop', 'iloveyou', '1qaz2wsx', 'Passw0rd!!', 'Monitoring2026'])('refuses %s, a password people guess', (candidate) => {
    expect(passwordProblem(candidate), candidate).toMatch(/anyone can guess|list of passwords/);
  });

  it.each(['correct horse battery staple', 'k7#Qv9!mTz2w', 'a-long-password-1', 'blue-kettle-ripple-48', 'secretive-ocelot-17', 'zabbix-2026-long-one'])('accepts %s', (candidate) => {
    expect(passwordProblem(candidate), candidate).toBeNull();
  });

  it('refuses a password that holds the company name, whatever the case', () => {
    expect(passwordProblem('Hcml-blue-kettle-48')).toMatch(/hcml/i);
    expect(passwordProblem('blue-kettle-HCML-48')).toMatch(/hcml/i);
  });

  it('refuses a password that holds the sign-in name, whatever the case, and only when the name is known', () => {
    expect(passwordProblem('blue-ANA.PUTRI-48', { name: 'ana.putri' })).toMatch(/sign-in name/);
    expect(passwordProblem('blue-ana.putri-48')).toBeNull();
    expect(passwordProblem('blue-kettle-ripple-48', { name: 'ana.putri' })).toBeNull();
  });

  it('keeps the old rules: too short, too long, empty, admin', () => {
    expect(passwordProblem('short')).toMatch(/at least 8/);
    expect(passwordProblem('x'.repeat(257))).toMatch(/at most 256/);
    expect(passwordProblem('')).toMatch(/at least 8/);
  });

  it('holds a few hundred words, each of eight characters or more, in lower case, once', () => {
    expect(COMMON_PASSWORDS.length).toBeGreaterThanOrEqual(200);
    expect(new Set(COMMON_PASSWORDS).size).toBe(COMMON_PASSWORDS.length);
    for (const word of COMMON_PASSWORDS) {
      expect(word.length, word).toBeGreaterThanOrEqual(8);
      expect(word, word).toBe(word.toLowerCase());
    }
  });

  it('still tries a stored hash against the five words only, so the start-up stays quick', async () => {
    expect(isCommon(await hashPassword('password1', CHEAP))).toBe(false);
    expect(isCommon('password1')).toBe(true);
  });
});
