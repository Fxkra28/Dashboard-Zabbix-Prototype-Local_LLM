import * as nodeCrypto from 'node:crypto';
import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * How a portal password is stored. An entry in PORTAL_USERS, or PORTAL_PASS, is either plain text
 * or a self-describing hash, of one of two kinds:
 *
 *   argon2id.<m>.<t>.<p>.<salt>.<hash>     m is the memory in KiB, t the passes, p the lanes
 *   scrypt.<N>.<r>.<p>.<salt>.<hash>       N, r and p are scrypt's cost settings
 *
 * The settings are in decimal, salt and hash are base64url. The settings travel with each hash, so raising the cost later leaves older entries working, and both kinds verify. New hashes are
 * Argon2id (OWASP's first choice, ADR-0017) when this Node has it, and scrypt otherwise. The text holds no ':' or ',' (PORTAL_USERS separators) and no '$' (docker compose reads it in .env
 * files). `npx tsx scripts/hash-password.ts` makes one.
 */
export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/**
 * 32 MiB and 0.13 s a check on the development Mac, more on a smaller machine: a sign-in is rare, and the limiter caps how often it can be tried. OWASP's setting of N = 2^15 with p = 3 (ADR-0017):
 * the same strength as N = 2^17 with p = 1, in a quarter of the memory. Hashes made with weaker settings keep verifying, and are rewritten at the next sign-in.
 */
export const SCRYPT_DEFAULTS: ScryptParams = { N: 32_768, r: 8, p: 3 };

/** Argon2id's cost settings; the memory is in KiB. */
export interface Argon2Params {
  m: number;
  t: number;
  p: number;
}

/** OWASP's first setting for Argon2id: 46 MiB, one pass, one lane. About 30 ms a check on the development Mac (18 November 2026), and the same strength as the second setting (19 MiB, two passes). */
export const ARGON2_DEFAULTS: Argon2Params = { m: 47_104, t: 1, p: 1 };
/** What a hash may ask of the machine, in KiB, so a typo in an entry cannot ask for gigabytes. */
const MAX_ARGON2_KIB = 256 * 1024;

/** Argon2 arrived in Node 24.7. A process without it can still read and write scrypt, and cannot check an Argon2id hash. */
const nodeArgon2 = (nodeCrypto as { argon2?: typeof nodeCrypto.argon2 }).argon2;
const nodeArgon2Sync = (nodeCrypto as { argon2Sync?: typeof nodeCrypto.argon2Sync }).argon2Sync;
export const ARGON2_SUPPORTED = typeof nodeArgon2 === 'function' && typeof nodeArgon2Sync === 'function';

const SALT_BYTES = 16;
const KEY_BYTES = 32;
/** What a hash may ask of the machine, so a typo in an entry cannot ask for gigabytes. */
const MAX_SCRYPT_BYTES = 256 * 1024 * 1024;

export type StoredPassword =
  | { kind: 'plain'; digest: Buffer }
  | { kind: 'scrypt'; params: ScryptParams; salt: Buffer; hash: Buffer }
  | { kind: 'argon2id'; params: Argon2Params; salt: Buffer; hash: Buffer }
  /** Starts like a hash but is not a usable one. */
  | { kind: 'invalid' };

const sha256 = (text: string) => createHash('sha256').update(text).digest();

const HASH_SHAPE = /^scrypt\.(\d{1,8})\.(\d{1,3})\.(\d{1,3})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;
const ARGON2_SHAPE = /^argon2id\.(\d{1,7})\.(\d{1,2})\.(\d{1,2})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

/** Whether a read password is a usable hash, whichever kind. */
export const isHash = (stored: StoredPassword): boolean => stored.kind === 'scrypt' || stored.kind === 'argon2id';

function parseArgon2(stored: string): StoredPassword {
  const m = ARGON2_SHAPE.exec(stored);
  if (!m) return { kind: 'invalid' };
  const [mem, t, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const salt = Buffer.from(m[4], 'base64url');
  const hash = Buffer.from(m[5], 'base64url');
  const usable =
    p >= 1 && p <= 16 && t >= 1 && t <= 10 && mem >= 8 * p && mem <= MAX_ARGON2_KIB &&
    salt.length >= 8 && salt.length <= 64 && salt.toString('base64url') === m[4] &&
    hash.length >= 16 && hash.length <= 128 && hash.toString('base64url') === m[5];
  return usable ? { kind: 'argon2id', params: { m: mem, t, p }, salt, hash } : { kind: 'invalid' };
}

/** Read a stored password. Anything that does not start with `scrypt.` or `argon2id.` is plain text. */
export function parseStoredPassword(stored: string): StoredPassword {
  if (stored.startsWith('argon2id.')) return parseArgon2(stored);
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

const argon2Options = (message: string, salt: Buffer, keyLength: number, { m, t, p }: Argon2Params) => ({ message, nonce: salt, parallelism: p, tagLength: keyLength, memory: m, passes: t });

const deriveArgon2 = (password: string, salt: Buffer, keyLength: number, params: Argon2Params) =>
  new Promise<Buffer>((resolve, reject) => {
    if (!nodeArgon2) return reject(new Error('This Node has no Argon2.'));
    nodeArgon2('argon2id', argon2Options(password, salt, keyLength, params), (err, key) => (err ? reject(err) : resolve(key)));
  });

/** One guess against a hash of either kind, for the start-up checks. A hash this Node cannot work out is no match. */
function matchesGuess(parsed: StoredPassword, guess: string): boolean {
  if (parsed.kind === 'scrypt') return timingSafeEqual(scryptSync(guess, parsed.salt, parsed.hash.length, options(parsed.params)), parsed.hash);
  if (parsed.kind === 'argon2id' && nodeArgon2Sync) return timingSafeEqual(nodeArgon2Sync('argon2id', argon2Options(guess, parsed.salt, parsed.hash.length, parsed.params)), parsed.hash);
  return false;
}

/**
 * Whether `candidate` is the stored password. Both sides are digests of equal length, compared with
 * timingSafeEqual, so the time taken does not say how much of a guess was right.
 */
export async function verifyPassword(stored: StoredPassword, candidate: string): Promise<boolean> {
  if (stored.kind === 'plain') return timingSafeEqual(sha256(candidate), stored.digest);
  if (stored.kind === 'scrypt') return timingSafeEqual(await derive(candidate, stored.salt, stored.hash.length, stored.params), stored.hash);
  if (stored.kind === 'argon2id' && ARGON2_SUPPORTED) return timingSafeEqual(await deriveArgon2(candidate, stored.salt, stored.hash.length, stored.params), stored.hash);
  return false;
}

const DECOY_SALT = Buffer.alloc(SALT_BYTES, 1);

/** The cost of one hash check with nothing to compare, so an unknown name is not quicker to refuse than a known one: that of a new hash. */
export async function decoyVerify(candidate: string): Promise<void> {
  if (ARGON2_SUPPORTED) await deriveArgon2(candidate, DECOY_SALT, KEY_BYTES, ARGON2_DEFAULTS);
  else await derive(candidate, DECOY_SALT, KEY_BYTES, SCRYPT_DEFAULTS);
}

/**
 * A hash entry for `password`, with a fresh salt. Without settings it is Argon2id at `ARGON2_DEFAULTS`, or scrypt at `SCRYPT_DEFAULTS` on a Node that has no Argon2; with
 * settings, the kind they belong to.
 */
export async function hashPassword(password: string, params?: ScryptParams | Argon2Params): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  if (params && 'm' in params) {
    const key = await deriveArgon2(password, salt, KEY_BYTES, params);
    return `argon2id.${params.m}.${params.t}.${params.p}.${salt.toString('base64url')}.${key.toString('base64url')}`;
  }
  if (!params && ARGON2_SUPPORTED) return hashPassword(password, ARGON2_DEFAULTS);
  const scryptParams = params ?? SCRYPT_DEFAULTS;
  const key = await derive(password, salt, KEY_BYTES, scryptParams);
  return `scrypt.${scryptParams.N}.${scryptParams.r}.${scryptParams.p}.${salt.toString('base64url')}.${key.toString('base64url')}`;
}

/**
 * Whether a stored password is weaker than what a new one gets: a plain text one, a scrypt hash, or an Argon2id hash with less than its defaults. Rewritten at a sign-in that proves it.
 * A scrypt hash is rewritten too, on a Node that has Argon2 (SC-60): its check takes four times as long as the others, which told a caller which names exist. A build from before 18 November
 * cannot read the new hash (DC-69).
 */
export const needsRehash = (stored: StoredPassword): boolean =>
  stored.kind === 'plain' ||
  (stored.kind === 'scrypt' && (ARGON2_SUPPORTED || stored.params.N < SCRYPT_DEFAULTS.N || stored.params.r < SCRYPT_DEFAULTS.r || stored.params.p < SCRYPT_DEFAULTS.p)) ||
  (stored.kind === 'argon2id' && (stored.params.m < ARGON2_DEFAULTS.m || stored.params.t < ARGON2_DEFAULTS.t || stored.params.p < ARGON2_DEFAULTS.p));

/** The fewest characters a plain password may have. A hash is exempt: its length says nothing about the password inside it. */
export const MIN_PASSWORD_LENGTH = 8;

/** Whether a stored plain password is under the minimum, counted in characters. Docker compose cuts an unquoted one at its first "$" (SC-55). */
export const isTooShort = (stored: string): boolean => parseStoredPassword(stored).kind === 'plain' && Array.from(stored).length < MIN_PASSWORD_LENGTH;

/**
 * On every short list of passwords, and the one Zabbix ships with. Compared in lower case. A stored hash is tried against these five only: each guess costs one hash check, and the
 * start-up makes it for every hash in `.env`.
 */
const COMMON = ['secret', 'zabbix', 'password', 'changeme', '123456'] as const;

/**
 * Passwords that people choose, of eight characters or more (a shorter one is refused for its length), in lower case: keyboard walks, runs of digits, and the well-known words with a
 * digit or a sign after them, with the ones of an office network and the Indonesian ones (SC-71). A plain password and a new one are compared with these; a stored hash is not.
 */
export const COMMON_PASSWORDS: readonly string[] = [
  'password', 'password1', 'password12', 'password123', 'password1234', 'password12345', 'password!', 'password@123', 'password#1', 'password01',
  'password2', 'password99', 'passw0rd', 'passw0rd1', 'passw0rd123', 'p@ssw0rd', 'p@ssw0rd1', 'p@ssw0rd123', 'p@ssword', 'p@ssword1', 'p@ssword123',
  'pa55word', 'pa55w0rd', 'pa$$word', 'pa$$w0rd', 'pass1234', 'pass12345', 'pass123456', 'passpass', 'passw0rd!', 'welcome1', 'welcome12',
  'welcome123', 'welcome1234', 'welcome@123', 'welcome#1', 'welcome!', 'admin123', 'admin1234', 'admin12345', 'admin@123', 'admin#123',
  'administrator', 'administrator1', 'administrator123', 'adminadmin', 'admin1admin', 'changeme', 'changeme1', 'changeme123', 'changeme!',
  'changeme@123', 'letmein1', 'letmein12', 'letmein123', 'letmein!', 'iloveyou', 'iloveyou1', 'iloveyou123', 'iloveyou!', '12345678', '123456789',
  '1234567890', '12345678910', '0123456789', '987654321', '9876543210', '87654321', '76543210', '11111111', '111111111', '1111111111', '22222222',
  '33333333', '44444444', '55555555', '66666666', '77777777', '88888888', '99999999', '00000000', '000000000', '0000000000', '12341234', '12121212',
  '11223344', '12344321', '123123123', '123321123', '123456123', '112233445566', '12345678a', '1234567a', '1q2w3e4r', '1q2w3e4r5t', '1q2w3e4r5t6y',
  '1qaz2wsx', '1qaz2wsx3edc', '1qazxsw2', 'q1w2e3r4', 'q1w2e3r4t5', '1qaz@wsx', '1q2w3e4r!', 'qwertyui', 'qwertyuiop', 'qwerty12', 'qwerty123',
  'qwerty1234', 'qwerty12345', 'qwerty@123', 'qwerty#123', 'qwertyuiop123', 'qwertyuiop1', 'qwerty123456', 'qwer1234', 'qwer12345', 'asdfghjk',
  'asdfghjkl', 'asdf1234', 'asdfasdf', 'asdfghjkl123', 'asdfghjkl1', 'zxcvbnm1', 'zxcvbnm123', 'zxcv1234', 'zxcvbnm!', '1234qwer', '1234abcd',
  'abcd1234', 'abcd12345', 'abcdefgh', 'abcdefg1', 'abcdef123', 'abcdefghi', 'abc12345', 'abc123456', 'abc123abc', 'aa123456', 'a1234567',
  'a12345678', 'a1b2c3d4', 'a1b2c3d4e5', 'aaaaaaaa', 'aaaa1111', 'aaaaaaaaa', 'zaq12wsx', 'zaq1zaq1', 'zaq1xsw2', 'xsw23edc', 'zaq1@wsx', 'test1234',
  'test12345', 'testing123', 'testtest', 'tester123', 'test@123', 'testing1', 'default123', 'default1', 'guest1234', 'guest123', 'user1234',
  'user12345', 'root1234', 'rootroot', 'root@123', 'toor1234', 'monkey123', 'dragon123', 'football1', 'football123', 'baseball1', 'superman1',
  'batman123', 'trustno1', 'sunshine1', 'princess1', 'starwars1', 'whatever1', 'shadow123', 'master123', 'michael123', 'jessica123', 'charlie123',
  'mustang123', 'freedom1', 'computer1', 'internet1', 'network1', 'network123', 'network@123', 'monitor123', 'monitoring', 'monitoring1',
  'monitoring123', 'monitoring@123', 'server123', 'server1234', 'server@123', 'system123', 'system@123', 'secret123', 'secret1234', 'secretpassword',
  'supersecret', 'mysecret1', 'mypassword', 'mypassword1', 'mypassword123', 'my_password', 'mypass123', 'zabbix123', 'zabbix1234', 'zabbix@123',
  'zabbixadmin', 'zabbix12345', 'zabbixzabbix', 'cisco123', 'cisco1234', 'cisco@123', 'ciscocisco', 'mikrotik', 'mikrotik1', 'mikrotik123',
  'ubnt1234', 'ubntubnt', 'huawei123', 'huawei@123', 'huawei1234', 'fortinet1', 'fortigate', 'fortigate1', 'jakarta123', 'jakarta2026',
  'jakarta@123', 'surabaya1', 'surabaya123', 'indonesia', 'indonesia1', 'indonesia123', 'indonesia2026', 'indonesia@123', 'rahasia123',
  'rahasia1234', 'rahasia!', 'bismillah', 'bismillah1', 'bismillah123', 'sayang123', 'sayangku', 'sayangku1', 'cintaku123', 'cinta123', 'bandung123',
  'semarang1', 'medan1234', 'company1', 'company123', 'portal123', 'portal1234', 'login1234', 'access123', 'security1', 'security123', 'manager123',
  'support123', 'service123', 'hello1234', 'hello123', '1password', 'password1!', 'welcome2024', 'welcome2025', 'welcome2026', 'admin2024',
  'admin2025', 'admin2026', 'password2024', 'password2025', 'password2026', 'summer2024', 'summer2025', 'summer2026', 'winter2024', 'winter2025',
  'winter2026', 'spring2026', 'autumn2026', 'qazwsxedc', 'qazwsx123', 'qazxswedc', 'wsxedcrfv', '1234567q', '123456q7', '123qweasd', '123qweasdzxc',
  'qweasdzxc', 'qweasd123', 'iloveyou2', 'loveyou1', 'loveyou123', 'trustme1', 'letmeinplease', 'abc@1234', 'abc#1234', 'abcd@1234', 'abcd#1234',
  'a@123456',
];
const COMMON_SET: ReadonlySet<string> = new Set<string>([...COMMON, ...COMMON_PASSWORDS]);

/** Words that, with digits or a sign after them, or a letter swapped for a look-alike, are still the password everyone tries: Welcome2026!, P@ssw0rd, Monitoring2026. */
const BASE_WORDS: ReadonlySet<string> = new Set([
  'password', 'welcome', 'letmein', 'iloveyou', 'loveyou', 'admin', 'administrator', 'root', 'toor', 'guest', 'test', 'testing', 'tester', 'secret', 'zabbix', 'changeme',
  'qwerty', 'qwertyui', 'qwertyuiop', 'asdfgh', 'asdfghjk', 'asdfghjkl', 'zxcvbn', 'zxcvbnm', 'abcdef', 'abcdefgh', 'monkey', 'dragon', 'football', 'baseball', 'superman', 'batman',
  'trustno', 'sunshine', 'princess', 'starwars', 'whatever', 'shadow', 'master', 'michael', 'jessica', 'charlie', 'mustang', 'hunter', 'freedom', 'computer', 'internet', 'network',
  'networking', 'monitor', 'monitoring', 'server', 'system', 'cisco', 'mikrotik', 'ubnt', 'huawei', 'fortinet', 'fortigate', 'jakarta', 'surabaya', 'bandung', 'indonesia',
  'rahasia', 'bismillah', 'sayang', 'sayangku', 'cinta', 'cintaku', 'company', 'portal', 'login', 'access', 'security', 'default', 'manager', 'support', 'service', 'user', 'username',
  'hello', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'summer', 'winter', 'spring', 'autumn',
]);
const LOOKALIKES: ReadonlyMap<string, string> = new Map([['@', 'a'], ['0', 'o'], ['$', 's'], ['5', 's'], ['3', 'e'], ['1', 'i'], ['!', 'i']]);

/** The letters a password is made of once its ending of digits and signs is cut off and its look-alikes are read as letters: `Welcome2026!` is `welcome`, `P@ssw0rd` is `password`. */
export const stemOf = (password: string): string =>
  Array.from(password.toLowerCase().replace(/[^\p{L}]+$/u, ''))
    .map((ch) => LOOKALIKES.get(ch) ?? ch)
    .join('');

/** Whether a plain text is empty or the built-in "admin". Text only: it never reads the text as a hash. */
const isGuessableText = (text: string): boolean => text === '' || text === 'admin';

/** Whether a plain text is on the lists above, or is still a placeholder such as `<a long password>` pasted from the documents. Text only. */
const isCommonText = (text: string): boolean => {
  const trimmed = text.trim();
  return COMMON_SET.has(trimmed.toLowerCase()) || /^<[^<>]+>$/.test(trimmed);
};

/**
 * Whether a stored password is on that list, or is still a placeholder such as `<a long password>` pasted from the documents. Weaker than
 * `isGuessable`: the start-up warns about it and does not refuse. A hash is tried against the five short words only.
 */
export function isCommon(stored: string): boolean {
  const parsed = parseStoredPassword(stored);
  if (parsed.kind === 'plain') return isCommonText(stored);
  if (!isHash(parsed)) return false;
  return COMMON.some((guess) => matchesGuess(parsed, guess));
}

/**
 * Whether a stored password is one anyone can guess: empty, or the built-in "admin". A hash is
 * checked against both, once, at start, so hashing "admin" does not get round the start-up refusal.
 */
export function isGuessable(stored: string): boolean {
  const parsed = parseStoredPassword(stored);
  if (parsed.kind === 'plain') return isGuessableText(stored);
  if (!isHash(parsed)) return false;
  return ['', 'admin'].some((guess) => matchesGuess(parsed, guess));
}

export const MAX_PASSWORD_LENGTH = 256;

/** The words of the refusal of a chosen password that people guess. */
const GUESSED = 'That password is on a list of passwords that anyone can guess. Choose another.';

/** Whether a password someone chooses is one people guess: on the lists, a word of them with digits or signs after it, or one character repeated. Text only. */
const isGuessedChoice = (candidate: string): boolean =>
  isGuessableText(candidate) || isCommonText(candidate) || /^(.)\1+$/su.test(candidate.toLowerCase()) || BASE_WORDS.has(stemOf(candidate));

/** What a password chosen on the page is judged beside: the sign-in name of the person it is for. */
export interface PasswordContext {
  name?: string;
}

/**
 * Why a password chosen on the page is refused, in words, or null when it is fit to use: long enough, not too long, not on the lists of passwords people guess, and not holding the
 * company name or the sign-in name. The candidate is only ever read as text. Read as a stored hash, a candidate of the shape of one made the server work that hash out on its main thread
 * at the cost it names, 4.6 seconds for an Argon2id one and 5.2 for a scrypt one (SC-58).
 */
export function passwordProblem(candidate: string, context: PasswordContext = {}): string | null {
  const length = Array.from(candidate).length;
  if (length < MIN_PASSWORD_LENGTH) return `The password must have at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (length > MAX_PASSWORD_LENGTH) return `The password must have at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (isGuessedChoice(candidate)) return GUESSED;
  const lower = candidate.toLowerCase();
  const name = (context.name ?? '').trim().toLowerCase();
  if (lower.includes('hcml') || (name.length >= 3 && lower.includes(name))) return 'The password must not contain "hcml" or the sign-in name.';
  return null;
}
