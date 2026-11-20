import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { normalizeIP } from '@fastify/rate-limit';
import { config, SESSION_EPOCH_DEFAULT } from '../core/config.js';
import { changePasswordBody, loginBody, noBody } from '../core/schemas.js';
import { accessOfAccount, createDirectory, parseEnvUsers, readEnvUsers, usable, type Account, type Directory } from './accounts.js';
import { auditUser } from './audit.js';
import { MODULE_IDS, judge, pagesOf, refusalText, roleFromName, ruleFor, type Access, type ModuleId, type Role } from './modules.js';
import { decoyVerify, isCommon, isGuessable, isHash, isTooShort, MIN_PASSWORD_LENGTH, verifyPassword } from './passwords.js';

/**
 * Portal auth and RBAC. Every source slide in HCML's review is stamped Private and Confidential, so
 * an open portal is not deployable: a JWT, three roles and a list of modules for each user gate the portal's own routes.
 * The Zabbix token is never exposed either way; RBAC decides who sees which portal view, not what the BFF may
 * ask Zabbix.
 *
 * A role says what a user may do (modules.ts): a guest reads, an operator also acknowledges and closes, an admin also
 * manages users and sends the report out. The modules say what they may see. Who the users are, and how they are kept, is in accounts.ts (ADR-0017).
 */

export { ROLES, isRole, roleAllows, type Role } from './modules.js';
export { parseEnvUsers } from './accounts.js';

/** The role a route needs: the role of its row in the table of routes, and administrator for a route that has none (modules.ts). */
export function requiredRole(url: string): Role {
  return ruleFor(url)?.role ?? 'admin';
}

/** Reachable without a token. Matched exactly, so a route added under these paths is not public by accident. */
export const PUBLIC_ROUTES = new Set(['/api/health', '/api/auth/login', '/api/auth/me', '/api/auth/logout', '/api/auth/request']);

/**
 * The header every cookie-authenticated POST must carry.
 * A page on another site cannot add a custom header without a CORS preflight,
 * and the BFF's CORS setting refuses that preflight for any other origin.
 */
export const CSRF_HEADER = 'x-hcml-csrf';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Public, but they set or clear the session cookie, or write a request to disk, so they are checked like any cookie POST. */
const COOKIE_ROUTES = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/request']);

/** Sign-in attempts per minute per account and client address, on top of the global limit. */
export const LOGIN_ATTEMPTS_PER_MINUTE = 10;

/**
 * A name and a password fit in 4 KB. The 1 MB default let one request carry a
 * megabyte-long name into the sign-in limiter's memory.
 */
export const LOGIN_BODY_LIMIT = 4096;

/**
 * Backoff after failed sign-ins: from this many failures in a row for one account and address,
 * sign-in is locked for a minute, doubling with each further failure up to the cap; a success
 * clears it. The cap is short because behind Docker every browser shares one address, so a long
 * lock would lock the account out for everyone.
 */
export const LOGIN_LOCK_AFTER = 10;
export const LOGIN_LOCK_BASE_MS = 60_000;
export const LOGIN_LOCK_MAX_MS = 5 * 60_000;
/** Failures older than this are forgotten; at most this many keys are remembered. */
const LOGIN_FAIL_TTL_MS = 60 * 60_000;
const LOGIN_FAIL_KEYS = 10_000;

/**
 * A password spray: one common password tried once against each of many names, which the lock of each name never sees (SC-61). From this many failed sign-ins from one address inside
 * the window, spread over at least this many names, the address is locked like a name is, for as long and with the same doubling and cap. A person who mistypes their own password
 * is on one name and is stopped by that name's lock; the names condition keeps an office behind one address from being locked by a few of them at once.
 */
export const SPRAY_FAILURES = 30;
export const SPRAY_NAMES = 10;
const SPRAY_WINDOW_MS = 15 * 60_000;

/**
 * How long one token lasts: SESSION_HOURS, twelve unless set. An open portal renews its
 * own before then (POST /api/auth/refresh).
 */
export const tokenLifetime = (): string => `${config.auth.sessionHours}h`;

/**
 * The issuer and audience every token carries and every request is checked against. Taken
 * from the session cookie name, which already differs per copy, so a token from :8081 is refused
 * on :8082 even with a shared JWT_SECRET, and no .env change is needed.
 */
export const tokenClaims = (cookieName: string) => ({ iss: `hcml-portal:${cookieName}`, aud: `hcml-portal:${cookieName}` });

/**
 * Sign-in logging: the name as typed is logged only when an account holds it, cut short and stripped of control
 * characters; any other name is logged as unknown with its length. From this many failures in a row for one name (any address)
 * a warning is logged, and again at every multiple of it; failures older than the window are forgotten.
 */
const LOG_NAME_MAX = 64;
export const LOGIN_WARN_AFTER = 5;
const LOGIN_WARN_WINDOW_MS = 15 * 60_000;

/** @fastify/jwt takes the Bearer header when there is one, else the cookie. This is its test for the header. */
const hasBearer = (req: FastifyRequest) => /^Bearer\s/i.test(req.headers.authorization ?? '');

/**
 * Whether an Origin header names this request's own origin. Compared by host
 * and port, so a TLS proxy that does not pass the scheme on is not refused.
 * The host is the Host header as it arrived, never X-Forwarded-Host: with a
 * proxy trusted, Fastify's req.host reads that header, which a client can set.
 * So a TLS proxy in front must keep the browser's Host (setup.md section 23).
 */
function sameOrigin(origin: string, host: string): boolean {
  try {
    const from = new URL(origin);
    return host !== '' && from.host === new URL(`${from.protocol}//${host}`).host;
  } catch {
    return false; // "null" (a sandboxed frame, a privacy mode) or garbage
  }
}

/**
 * Why an unsafe request is refused as a possible cross-site forgery, or null
 * when it may go on. Only requests the browser authenticates by itself, with
 * the cookie, are checked: a Bearer header proves the caller is a script that
 * holds the token. The sign-in and sign-out routes are checked always.
 */
export function csrfRefusal(req: FastifyRequest, cookieName: string): string | null {
  if (!UNSAFE_METHODS.has(req.method)) return null;
  const route = routeOf(req);
  if (!route.startsWith('/api/')) return null;
  const byCookie = !hasBearer(req) && Boolean(req.cookies?.[cookieName]);
  if (!byCookie && !COOKIE_ROUTES.has(route)) return null;
  if (req.headers[CSRF_HEADER] !== '1') return 'The request is missing the portal\'s X-HCML-CSRF header.';
  const origin = req.headers.origin;
  if (origin !== undefined && !sameOrigin(origin, req.headers.host ?? '')) return 'The request came from another site.';
  return null;
}

/**
 * The route to judge a request by. The router decodes the path before it matches, so `/%61pi/hosts`
 * reaches the `/api/hosts` handler; judging the raw URL text would let that request past the guard
 * with no token. With no match (a 404 on its way) the decoded path is used, so an unknown /api/
 * path still needs a token rather than revealing that it does not exist.
 */
export function routeOf(req: FastifyRequest): string {
  const matched = req.routeOptions?.url;
  if (matched) return matched;
  const path = (req.raw.url ?? '').split('?')[0];
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Refuse to start with a password anyone can guess: empty (what copying
 * .env.example gave) or the built-in "admin", and a plain password under MIN_PASSWORD_LENGTH characters. Passwords on a short list are
 * warned about, not refused. Names the users, never the passwords. Only with auth on.
 */
export function assertUsers(warn: (message: string) => void = () => undefined): void {
  if (!config.auth.enabled) return;
  // Falling back to PORTAL_USER/PORTAL_PASS here would blame a user nobody configured.
  const raw = (process.env.PORTAL_USERS ?? '').trim();
  const notes: string[] = [];
  if (raw && !parseEnvUsers(raw, (m) => notes.push(m)).length) {
    throw new Error(`AUTH_ENABLED=true but no PORTAL_USERS entry is a valid name:password:role triple. ${notes.join(' ')}`);
  }
  const loaded = readEnvUsers(() => undefined);
  // Only the PORTAL_USER/PORTAL_PASS pair can get here with a broken hash: a PORTAL_USERS entry like that is skipped above.
  if (loaded.some((u) => u.check.kind === 'invalid')) {
    throw new Error('AUTH_ENABLED=true but PORTAL_PASS starts with "scrypt." or "argon2id." and is not a usable hash.');
  }
  const weak = loaded.filter((u) => isGuessable(u.pass));
  if (weak.length) {
    throw new Error(
      `AUTH_ENABLED=true but ${weak.map((u) => `"${u.name}"`).join(', ')} ` +
        `${weak.length === 1 ? 'has' : 'have'} an empty password or the default "admin". ` +
        'Set PORTAL_PASS, or PORTAL_USERS as name:password:role triples, in .env.',
    );
  }
  // Docker compose reads a "$" in .env as the start of a variable and drops the rest, so a long password can reach the server short (SC-55).
  const short = loaded.filter((u) => isTooShort(u.pass));
  if (short.length) {
    throw new Error(
      `AUTH_ENABLED=true but ${short.map((u) => `"${u.name}"`).join(', ')} ${short.length === 1 ? 'has' : 'have'} a password shorter than ${MIN_PASSWORD_LENGTH} characters. ` +
        'Docker compose cuts a password in .env at its first "$" unless it is in single quotes, so a long one can arrive short. ' +
        'Put the password in single quotes, use a longer one, or store a hash made by scripts/hash-password.ts.',
    );
  }
  // Not a refusal: a password on a short list is a weak choice and not an unset one, and the owner may have reasons.
  const common = loaded.filter((u) => isCommon(u.pass));
  if (common.length) {
    warn(
      `${common.map((u) => `"${u.name}"`).join(', ')} ${common.length === 1 ? 'has' : 'have'} a password that is on every short list of passwords, ` +
        'or is still a placeholder from the documents. Anyone can guess it. Set a long one in .env.',
    );
  }
}

/** The role attached to a request. With auth off everyone is admin. */
export function roleOf(req: FastifyRequest): Role {
  if (!config.auth.enabled) return 'admin';
  return roleFromName((req.user as { role?: unknown } | undefined)?.role) ?? 'guest';
}

/** The modules of the user of a request, as the guard found them. With auth off everyone has every one. */
export function modulesOf(req: FastifyRequest): ReadonlySet<ModuleId> {
  if (!config.auth.enabled) return new Set(MODULE_IDS);
  const modules = (req.user as { modules?: unknown } | undefined)?.modules;
  return new Set(Array.isArray(modules) ? (modules as ModuleId[]) : []);
}

/** The language the user chose for the Assistant and Explain, or null. */
export function languageOf(req: FastifyRequest): 'en' | 'id' | null {
  const language = (req.user as { language?: unknown } | undefined)?.language;
  return language === 'en' || language === 'id' ? language : null;
}

/** Whether the user of a request holds one of these modules: an administrator holds all. */
export const hasModule = (req: FastifyRequest, ...ids: ModuleId[]): boolean => roleOf(req) === 'admin' || ids.some((id) => modulesOf(req).has(id));

/**
 * The session a token belongs to: its sid, else its jti (tokens from before sessions had one), else a hash of what it says.
 * Read from the claims of a verified token, never from the header text, so no spelling of the header gets round a sign-out.
 */
export function sessionIdOf(claims: unknown): string | undefined {
  const c = (claims ?? {}) as { sid?: unknown; jti?: unknown; sub?: unknown; iat?: unknown; exp?: unknown };
  if (typeof c.sid === 'string' && c.sid) return c.sid;
  if (typeof c.jti === 'string' && c.jti) return c.jti;
  if (typeof c.sub !== 'string' || typeof c.iat !== 'number' || typeof c.exp !== 'number') return undefined;
  return createHash('sha256').update(`${c.sub}|${c.iat}|${c.exp}`).digest('base64url');
}

const signOutListeners = new Set<(session: string) => void>();
/** Call `listener` with the id of each session that signs out. Returns the function that stops it. */
export function onSignOut(listener: (session: string) => void): () => void {
  signOutListeners.add(listener);
  return () => void signOutListeners.delete(listener);
}

/** Requests the guard saw arrive with a valid session on a public route that shows more to a signed-in caller. */
const signedInRequests = new WeakSet<FastifyRequest>();

/**
 * Whether the caller of a public route is signed in, for GET /api/health to show more to them. It
 * is the guard's own verdict (token checked, user still in PORTAL_USERS), never a 401 for a bad or
 * missing token, and false when the guard is not mounted. With auth off everyone counts as signed in.
 */
export const isSignedIn = (req: FastifyRequest): boolean => !config.auth.enabled || signedInRequests.has(req);

/** What a route's guard may let through for an account that must change its password first: choosing the new one, and ending or renewing the session. */
const MUST_CHANGE_OK = new Set(['/api/auth/password', '/api/auth/refresh', '/api/auth/me', '/api/auth/logout']);

/** `directory` is who can sign in. Left out, it is the users of `.env` alone, which is what a portal with no data folder runs on. */
export async function setupAuth(app: FastifyInstance, directory: Directory = createDirectory(readEnvUsers((m) => app.log.warn(m)))): Promise<void> {
  const cookieName = config.auth.sessionCookie;
  // The token lives in an httpOnly cookie that page scripts cannot read.
  // A Bearer header still works, for scripts and tests.
  await app.register(cookie);
  const claimsOfThisPortal = tokenClaims(cookieName);
  await app.register(jwt, {
    secret: config.auth.jwtSecret,
    cookie: { cookieName, signed: false },
    // requiredClaims: without it a token with no iss or aud passes the allowed* checks unexamined.
    verify: { allowedIss: claimsOfThisPortal.iss, allowedAud: claimsOfThisPortal.aud, requiredClaims: ['iss', 'aud'] },
  });
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  // Sessions signed out before their tokens expire, with the time the last of those tokens could still be valid.
  // In memory, so a restart of the BFF forgets them; SESSION_EPOCH still ends every session at once.
  const signedOut = new Map<string, number>();

  /**
   * The account a token belongs to, or undefined when that user is gone. A name
   * listed twice in `.env` cannot say which entry signed in, so the token's role must still be one of theirs.
   */
  const currentUser = (sub: unknown, tokenRole: unknown): Account | undefined => {
    const named = directory.accounts().filter((a) => a.name === sub);
    return named.length === 1 ? named[0] : named.find((a) => a.role === roleFromName(tokenRole));
  };

  /**
   * Check the token, then look its user up again: a user removed, disabled or past their expiry is refused, a password changed since the token was made voids it,
   * and the role and modules in force are those of now, not those the token was signed with. Null when any of that fails. req.user carries them from here on
   * (roleOf and modulesOf read it).
   */
  const authenticate = async (req: FastifyRequest) => {
    let claims: { sub?: unknown; role?: unknown; exp?: number; iat?: number; ep?: unknown };
    try {
      claims = (await req.jwtVerify()) as typeof claims;
    } catch {
      return null;
    }
    // A token from before the epoch was raised. One with no epoch is epoch 1, so the default changes nothing for it.
    if (String(claims.ep ?? SESSION_EPOCH_DEFAULT) !== config.auth.sessionEpoch) return null;
    const session = sessionIdOf(claims);
    if (session && signedOut.has(session)) return null;
    const user = currentUser(claims.sub, claims.role);
    if (!user || !usable(user, nowSeconds())) return null;
    if (user.notBefore > 0 && (claims.iat ?? 0) < user.notBefore) return null;
    const access = accessOfAccount(user);
    req.user = { ...claims, role: user.role, modules: [...access.modules], language: user.language, expires: user.expires };
    return { claims, user, access };
  };

  // Secure only over HTTPS: a browser drops a Secure cookie sent over plain
  // HTTP, which is how the portal runs on 127.0.0.1. Behind a TLS proxy the
  // scheme comes from X-Forwarded-Proto, trusted as TRUST_PROXY says.
  const cookieOptions = (req: FastifyRequest) => ({
    httpOnly: true,
    sameSite: 'strict' as const,
    path: '/',
    secure: req.protocol === 'https',
  });

  /**
   * The entry a sign-in names, whatever the case of the name, when the password fits. Every entry
   * of that name is checked and the one spelled as typed wins, so "Ana" and "ana" listed apart each
   * keep their own. A name nobody holds still costs one hash check where hashes are in use.
   */
  const findUser = async (username: string, password: string): Promise<Account | undefined> => {
    const named = directory.named(username);
    // Where hashes are in use a hash check is what a name costs, so the time of a wrong password does not say which names exist (SC-60): an unknown name pays one as a decoy, and so does
    // a user whose password is plain text in `.env`, the break-glass one among them, which would answer in a tenth of a millisecond.
    const hashesInUse = directory.accounts().some((a) => isHash(a.check));
    if (!named.length && hashesInUse) await decoyVerify(password);
    const matches: Account[] = [];
    // A disabled or expired account is checked like any other and then refused with the same words, so the answer does not say that the name exists.
    for (const a of named) {
      if (hashesInUse && !isHash(a.check)) await decoyVerify(password);
      if ((await verifyPassword(a.check, password)) && usable(a, nowSeconds())) matches.push(a);
    }
    return matches.find((a) => a.name === username) ?? matches[0];
  };

  /**
   * Sign a token for `u` into the session cookie; the body carries its lifetime, never the token. A renewal keeps the sid,
   * so signing out ends every token of the chain; the jti keeps two tokens of one second apart.
   */
  const issue = (u: Account, req: FastifyRequest, reply: FastifyReply, sid: string = randomUUID()) => {
    const token = app.jwt.sign({ sub: u.name, role: u.role, ep: config.auth.sessionEpoch, jti: randomUUID(), sid }, { expiresIn: tokenLifetime(), ...claimsOfThisPortal });
    const { iat, exp } = app.jwt.decode(token) as { iat: number; exp: number };
    reply.setCookie(cookieName, token, { ...cookieOptions(req), maxAge: exp - iat });
    return { user: { name: u.name, role: u.role }, expiresIn: exp - iat, ...(u.mustChange ? { mustChange: true } : {}) };
  };

  // Before the guard, and with auth off too: login and logout set cookies either way.
  app.addHook('onRequest', async (req, reply) => {
    const refusal = csrfRefusal(req, cookieName);
    if (refusal) return reply.code(403).send({ error: 'csrf', message: `${refusal} Reload the page and try again.` });
  });

  // A sign-in limit on top of the global one, because 300 a minute is a lot of guesses. Keyed on
  // the account as well as the address: behind Docker every browser arrives from one gateway
  // address, so an address-only key made ten sign-ins a minute everyone's allowance. Runs at
  // preHandler, since the body is not parsed at onRequest, and as a check of its own, because the
  // plugin runs one limiter per request and the global one has already run. The name is lower-cased
  // (sign-in ignores case) and hashed to a fixed size; the address is grouped as the global limit
  // groups it (an IPv6 /64).
  const nameDigest = (req: FastifyRequest) => {
    const { username } = (req.body ?? {}) as { username?: unknown };
    return createHash('sha256').update(typeof username === 'string' ? username.toLowerCase() : '').digest('base64url');
  };
  const loginKey = (req: FastifyRequest) => `login|${normalizeIP(req.ip)}|${nameDigest(req)}`;
  const loginCheck = app.hasDecorator('createRateLimit')
    ? app.createRateLimit({ max: LOGIN_ATTEMPTS_PER_MINUTE, timeWindow: '1 minute', keyGenerator: loginKey })
    : null;
  // Consecutive failures per sign-in key, in insertion order so the oldest is dropped first.
  const failures = new Map<string, { count: number; last: number; until: number }>();
  const refuse = (reply: FastifyReply, seconds: number, message: string): never => {
    reply.header('retry-after', String(seconds));
    throw Object.assign(new Error(message), { statusCode: 429, error: 'rate_limited' });
  };
  // Every attempt is logged: the name, the outcome and the address, never the password.
  const typedName = (req: FastifyRequest) => {
    const { username } = (req.body ?? {}) as { username?: unknown };
    // eslint-disable-next-line no-control-regex -- a typed name must not carry control characters into a log line
    return typeof username === 'string' ? username.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, LOG_NAME_MAX) : '';
  };
  // A name no account holds is logged as unknown with its length: a password typed into the name box must not stay in a log that lasts (SC-52).
  const loggedName = (req: FastifyRequest) => {
    const typed = typedName(req);
    if (typed && directory.named(typed).length) return { user: typed };
    const { username } = (req.body ?? {}) as { username?: unknown };
    return { user: 'unknown', nameLength: typeof username === 'string' ? username.length : 0 };
  };
  const logAttempt = (req: FastifyRequest, outcome: 'success' | 'failure' | 'locked' | 'rate_limited') =>
    req.log.info({ event: 'sign_in', ...loggedName(req), outcome, ip: req.ip }, `sign-in ${outcome}`);
  // Failures per address across names, for the spray check. Oldest dropped first, like `failures`.
  const sprays = new Map<string, { start: number; failures: number; names: Set<string>; until: number; locks: number; lastLock: number }>();
  const noteSpray = (req: FastifyRequest) => {
    const key = normalizeIP(req.ip);
    const now = Date.now();
    const spray = sprays.get(key) ?? { start: now, failures: 0, names: new Set<string>(), until: 0, locks: 0, lastLock: 0 };
    if (now - spray.start > SPRAY_WINDOW_MS) Object.assign(spray, { start: now, failures: 0, names: new Set<string>() });
    spray.failures += 1;
    spray.names.add(nameDigest(req));
    if (spray.failures >= SPRAY_FAILURES && spray.names.size >= SPRAY_NAMES) {
      const locks = (spray.lastLock && now - spray.lastLock < LOGIN_FAIL_TTL_MS ? spray.locks : 0) + 1;
      const seconds = Math.min(LOGIN_LOCK_BASE_MS * 2 ** (locks - 1), LOGIN_LOCK_MAX_MS) / 1000;
      req.log.warn(
        { event: 'sign_in_spray', failures: spray.failures, names: spray.names.size, ip: req.ip, lockedSeconds: seconds },
        'failed sign-ins from one address across many names: the address is locked',
      );
      Object.assign(spray, { until: now + seconds * 1000, locks, lastLock: now, start: now, failures: 0, names: new Set<string>() });
    }
    sprays.delete(key);
    sprays.set(key, spray);
    if (sprays.size > LOGIN_FAIL_KEYS) sprays.delete(sprays.keys().next().value as string);
  };
  const loginLimit = async (req: FastifyRequest, reply: FastifyReply) => {
    const now = Date.now();
    const sprayed = sprays.get(normalizeIP(req.ip));
    if (sprayed && sprayed.until > now) {
      const seconds = Math.ceil((sprayed.until - now) / 1000);
      logAttempt(req, 'locked');
      refuse(reply, seconds, `Too many failed sign-ins from this address. Retry in ${seconds} s.`);
    }
    const locked = failures.get(loginKey(req));
    if (locked && locked.until > now) {
      const seconds = Math.ceil((locked.until - now) / 1000);
      logAttempt(req, 'locked');
      refuse(reply, seconds, `Too many failed sign-ins for this account. Retry in ${seconds} s.`);
    }
    const limit = await loginCheck?.(req);
    if (!limit || limit.isAllowed || !limit.isExceeded) return;
    logAttempt(req, 'rate_limited');
    refuse(reply, limit.ttlInSeconds, `Too many sign-in attempts: the limit is ${limit.max} a minute per account. Retry in ${limit.ttlInSeconds} s.`);
  };
  // Failures in a row per name, from any address, for the warning. Oldest dropped first, like `failures`.
  const nameFailures = new Map<string, { count: number; last: number }>();
  const warnOnRepeats = (req: FastifyRequest) => {
    const user = typedName(req);
    const key = user.toLowerCase();
    const now = Date.now();
    const prev = nameFailures.get(key);
    const count = (prev && now - prev.last < LOGIN_WARN_WINDOW_MS ? prev.count : 0) + 1;
    nameFailures.delete(key);
    nameFailures.set(key, { count, last: now });
    if (nameFailures.size > LOGIN_FAIL_KEYS) nameFailures.delete(nameFailures.keys().next().value as string);
    if (count % LOGIN_WARN_AFTER === 0) {
      req.log.warn({ event: 'sign_in_repeated_failures', ...loggedName(req), failures: count, ip: req.ip }, 'repeated failed sign-ins for one name');
    }
  };
  const recordFailure = (key: string) => {
    const now = Date.now();
    const prev = failures.get(key);
    const count = (prev && now - prev.last < LOGIN_FAIL_TTL_MS ? prev.count : 0) + 1;
    const until =
      count >= LOGIN_LOCK_AFTER ? now + Math.min(LOGIN_LOCK_BASE_MS * 2 ** (count - LOGIN_LOCK_AFTER), LOGIN_LOCK_MAX_MS) : 0;
    failures.delete(key);
    failures.set(key, { count, last: now, until });
    if (failures.size > LOGIN_FAIL_KEYS) failures.delete(failures.keys().next().value as string);
  };

  app.post('/api/auth/login', { schema: { body: loginBody }, preHandler: loginLimit, bodyLimit: LOGIN_BODY_LIMIT }, async (req, reply) => {
    const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const found = typeof username === 'string' && typeof password === 'string' ? await findUser(username, password) : undefined;
    if (!found) {
      recordFailure(loginKey(req));
      noteSpray(req);
      logAttempt(req, 'failure');
      warnOnRepeats(req);
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Invalid username or password.' });
    }

    failures.delete(loginKey(req));
    nameFailures.delete(typedName(req).toLowerCase());
    logAttempt(req, 'success');
    // Records the sign-in, and rewrites a hash that is weaker than the portal's now. It never fails the sign-in.
    await directory.signedIn(found.name, password as string);
    return issue(found, req, reply);
  });

  app.get('/api/auth/me', async (req, reply) => {
    // With auth off the UI still needs a role so it knows what to render.
    if (!config.auth.enabled) {
      // No accounts, so no page to manage them: everything else is open.
      const open: Access = { role: 'admin', modules: new Set(MODULE_IDS.filter((m) => m !== 'users')) };
      return { authEnabled: false, user: { name: 'anonymous', role: 'admin' as Role }, expiresIn: null, pages: pagesOf(open), modules: [...open.modules] };
    }
    const session = await authenticate(req);
    if (!session) return reply.code(401).send({ error: 'unauthorized', message: 'Your session has expired. Sign in again.' });
    const { user, access } = session;
    return {
      authEnabled: true,
      // The role and the modules configured now, so a demoted user sees the menus the BFF will serve.
      // `source` says where the account is kept: one of `.env` cannot change its password on the Account page (FR-73).
      user: { name: user.name, role: user.role, displayName: user.displayName, source: user.source, ...(user.language ? { language: user.language } : {}) },
      // Relative, so the page times its renewal without trusting its own clock.
      expiresIn: Math.max(0, (session.claims.exp ?? 0) - nowSeconds()),
      // The pages this user has, each with the role it needs, from the table of routes (modules.ts), so the sidebar keeps no copy.
      pages: pagesOf(access),
      modules: [...access.modules],
      ...(user.mustChange ? { mustChange: true } : {}),
    };
  });

  // Public, so an expired or missing cookie can still be cleared. Ends the whole session (every token, every renewal, its open
  // streams), whatever the spelling of the header; only a token this BFF signed is remembered, so made-up ones cannot fill the list.
  app.post('/api/auth/logout', { schema: { body: noBody } }, async (req, reply) => {
    const claims = (await req.jwtVerify().catch(() => null)) as { exp?: number } | null;
    const session = claims?.exp ? sessionIdOf(claims) : undefined;
    if (session) {
      const now = Math.floor(Date.now() / 1000);
      for (const [key, exp] of signedOut) if (exp <= now) signedOut.delete(key);
      // No token of the session can outlast one signed this second.
      signedOut.set(session, now + config.auth.sessionHours * 3600);
      if (signedOut.size > LOGIN_FAIL_KEYS) signedOut.delete(signedOut.keys().next().value as string);
      for (const listener of signOutListeners) listener(session);
    }
    reply.clearCookie(cookieName, cookieOptions(req));
    return { ok: true };
  });

  if (!config.auth.enabled) return;

  // Guard every /api/* route except the public four. The token comes from the Bearer header or the
  // session cookie, never the query string: the live stream sends the cookie like any request, so
  // no token lands in a URL, a log or browser history.
  app.addHook('onRequest', async (req, reply) => {
    const route = routeOf(req);
    if (!route.startsWith('/api/')) return;
    // Public, but a signed-in caller is told more: look at the session, never refuse for it.
    if (route === '/api/health') {
      if (await authenticate(req)) signedInRequests.add(req);
      return;
    }
    if (PUBLIC_ROUTES.has(route)) return;

    // A removed or disabled user gets the same 401 as a bad token; the role and modules are the current ones, not the token's.
    const session = await authenticate(req);
    if (!session) return reply.code(401).send({ error: 'unauthorized', message: 'Sign in to continue.' });

    // A temporary password is for choosing a new one, and nothing else.
    if (session.user.mustChange && !MUST_CHANGE_OK.has(route)) {
      return reply.code(403).send({ error: 'password_change_required', message: 'Choose a new password before you continue.' });
    }
    const verdict = judge(session.access, route);
    if (!verdict.ok) return reply.code(403).send({ error: 'forbidden', message: refusalText(verdict, session.user.role) });
  });

  // The person's own change of password. The current one is asked for, and tried at most as often as a sign-in is; a change ends the older sessions of the person and renews this one.
  const passwordCheck = app.hasDecorator('createRateLimit')
    ? app.createRateLimit({ max: LOGIN_ATTEMPTS_PER_MINUTE, timeWindow: '1 minute', keyGenerator: (req) => `password|${String((req.user as { sub?: unknown } | undefined)?.sub)}` })
    : null;
  const passwordLimit = async (req: FastifyRequest, reply: FastifyReply) => {
    const limit = await passwordCheck?.(req);
    if (!limit || limit.isAllowed || !limit.isExceeded) return;
    refuse(reply, limit.ttlInSeconds, `Too many tries to change the password. Retry in ${limit.ttlInSeconds} s.`);
  };
  app.post('/api/auth/password', { schema: { body: changePasswordBody }, bodyLimit: LOGIN_BODY_LIMIT, preHandler: passwordLimit }, async (req, reply) => {
    const { current, password } = req.body as { current: string; password: string };
    const { sub } = (req.user ?? {}) as { sub?: unknown };
    const account = directory.accounts().find((a) => a.name === sub);
    if (!account) return reply.code(401).send({ error: 'unauthorized', message: 'Your session has expired. Sign in again.' });
    const changed = await directory.changeOwnPassword(account.name, current, password);
    auditUser(req, 'password_changed', changed.name);
    return { ok: true, ...issue(changed, req, reply, sessionIdOf(req.user)) };
  });

  // An open portal swaps its token for a fresh one before it runs out, for every user. The guard
  // above has already checked the one presented. The user is looked up again, so a user removed
  // from PORTAL_USERS cannot renew and a changed role takes effect. A name listed twice is refused:
  // taking the first entry let a sign-in with one entry's password renew into the other entry's
  // role.
  app.post('/api/auth/refresh', { schema: { body: noBody } }, async (req, reply) => {
    const { sub } = (req.user ?? {}) as { sub?: unknown };
    const matches = directory.accounts().filter((a) => a.name === sub);
    const found = matches.length === 1 ? matches[0] : undefined;
    if (!found) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Your session has expired. Sign in again.' });
    }
    return issue(found, req, reply, sessionIdOf(req.user));
  });
}
