import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * How a portal password is stored. An entry in PORTAL_USERS, or PORTAL_PASS, is either plain text
 * or a self-describing scrypt hash:
 *
 *   scrypt.<N>.<r>.<p>.<salt>.<hash>
 *
 * N, r and p are scrypt's cost settings in decimal, salt and hash are base64url. The settings
 * travel with each hash, so raising the cost later leaves older entries working. The text holds no
 * ':' or ',' (PORTAL_USERS separators) and no '$' (docker compose reads it in .env files). `npx tsx
 * scripts/hash-password.ts` makes one.
 */
export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** 32 MiB and about 100 ms a check: a sign-in is rare, and the limiter caps how often it can be tried. */
export const SCRYPT_DEFAULTS: ScryptParams = { N: 32_768, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 32;
/** What a hash may ask of the machine, so a typo in an entry cannot ask for gigabytes. */
const MAX_SCRYPT_BYTES = 256 * 1024 * 1024;

export type StoredPassword =
  | { kind: 'plain'; digest: Buffer }
  | { kind: 'scrypt'; params: ScryptParams; salt: Buffer; hash: Buffer }
  /** Starts like a hash but is not a usable one. */
  | { kind: 'invalid' };

const sha256 = (text: string) => createHash('sha256').update(text).digest();

const HASH_SHAPE = /^scrypt\.(\d{1,8})\.(\d{1,3})\.(\d{1,3})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

/** Read a stored password. Anything that does not start with `scrypt.` is plain text. */
export function parseStoredPassword(stored: string): StoredPassword {
  if (!stored.startsWith('scrypt.')) return { kind: 'plain', digest: sha256(stored) };
  const m = HASH_SHAPE.exec(stored);
  if (!m) return { kind: 'invalid' };
  const [N, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const salt = Buffer.from(m[4], 'base64url');
  const hash = Buffer.from(m[5], 'base64url');
  const usable =
    Number.isInteger(Math.log2(N)) && N >= 1024 &&
    r >= 1 && r <= 32 && p >= 1 && p <= 16 &&
    128 * N * r <= MAX_SCRYPT_BYTES &&
    salt.length >= 8 && salt.length <= 64 && salt.toString('base64url') === m[4] &&
    hash.length >= 16 && hash.length <= 128 && hash.toString('base64url') === m[5];
  return usable ? { kind: 'scrypt', params: { N, r, p }, salt, hash } : { kind: 'invalid' };
}

const options = ({ N, r, p }: ScryptParams): ScryptOptions => ({ N, r, p, maxmem: 256 * N * r });

const derive = (password: string, salt: Buffer, keyLength: number, params: ScryptParams) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, options(params), (err, key) => (err ? reject(err) : resolve(key)));
  });

/**
 * Whether `candidate` is the stored password. Both sides are digests of equal length, compared with
 * timingSafeEqual, so the time taken does not say how much of a guess was right.
 */
export async function verifyPassword(stored: StoredPassword, candidate: string): Promise<boolean> {
  if (stored.kind === 'plain') return timingSafeEqual(sha256(candidate), stored.digest);
  if (stored.kind === 'scrypt') return timingSafeEqual(await derive(candidate, stored.salt, stored.hash.length, stored.params), stored.hash);
  return false;
}

const DECOY_SALT = Buffer.alloc(SALT_BYTES, 1);

/** The cost of one hash check with nothing to compare, so an unknown name is not quicker to refuse than a known one. */
export async function decoyVerify(candidate: string): Promise<void> {
  await derive(candidate, DECOY_SALT, KEY_BYTES, SCRYPT_DEFAULTS);
}

/** A hash entry for `password`, with a fresh salt. */
export async function hashPassword(password: string, params: ScryptParams = SCRYPT_DEFAULTS): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, params);
  return `scrypt.${params.N}.${params.r}.${params.p}.${salt.toString('base64url')}.${key.toString('base64url')}`;
}

/** On every short list of passwords, and the one Zabbix ships with. Compared in lower case. */
const COMMON = ['secret', 'zabbix', 'password', 'changeme', '123456'] as const;

/**
 * Whether a stored password is on that list, or is still a placeholder such as `<a long password>` pasted from the documents. Weaker than
 * `isGuessable`: the start-up warns about it and does not refuse. A hash is tried against each word in lower case only.
 */
export function isCommon(stored: string): boolean {
  const parsed = parseStoredPassword(stored);
  if (parsed.kind === 'plain') {
    const text = stored.trim();
    return COMMON.includes(text.toLowerCase() as (typeof COMMON)[number]) || /^<[^<>]+>$/.test(text);
  }
  if (parsed.kind !== 'scrypt') return false;
  return COMMON.some((guess) => timingSafeEqual(scryptSync(guess, parsed.salt, parsed.hash.length, options(parsed.params)), parsed.hash));
}

/**
 * Whether a stored password is one anyone can guess: empty, or the built-in "admin". A hash is
 * checked against both, once, at start, so hashing "admin" does not get round the start-up refusal.
 */
export function isGuessable(stored: string): boolean {
  const parsed = parseStoredPassword(stored);
  if (parsed.kind === 'plain') return stored === '' || stored === 'admin';
  if (parsed.kind !== 'scrypt') return false;
  return ['', 'admin'].some((guess) =>
    timingSafeEqual(scryptSync(guess, parsed.salt, parsed.hash.length, options(parsed.params)), parsed.hash),
  );
}
