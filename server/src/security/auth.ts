import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { normalizeIP } from '@fastify/rate-limit';
import { config, SESSION_EPOCH_DEFAULT } from '../core/config.js';
import { pageRoles } from './pageAccess.js';
import { loginBody, noBody } from '../core/schemas.js';
import { decoyVerify, isCommon, isGuessable, parseStoredPassword, verifyPassword, type StoredPassword } from './passwords.js';

/**
 * Portal auth and RBAC. Every source slide in HCML's review is stamped Private and Confidential, so
 * an open portal is not deployable: a JWT and four roles gate the portal's own routes. The Zabbix
 * token is never exposed either way; RBAC decides who sees which portal view, not what the BFF may
 * ask Zabbix.
 *
 * Roles divide by sensitivity and cost, not by write access:
 *
 *   viewer:   all monitoring, plus the plain-language "Explain" actions. The AI layer exists for
 *             non-engineers, so gating it above this role would defeat its purpose.
 *   wall:     + the engineering surfaces (network, links, the meters), to read only: the account
 *             of a NOC screen, which never acknowledges or closes (tracker MT-06).
 *   operator: + acknowledge/close.
 *   admin:    + governance (the inventory scorecard) and what leaves the portal: the emailed report and the monthly send.
 */

export const ROLES = ['viewer', 'wall', 'operator', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { viewer: 1, wall: 2, operator: 3, admin: 4 };

export const isRole = (v: unknown): v is Role => ROLES.includes(v as Role);

/**
 * Minimum role per route, first match wins. Anything unmatched needs `viewer`,
 * so a new route is protected by default rather than accidentally public.
 */
const ROUTE_RULES: { pattern: RegExp; role: Role }[] = [
  { pattern: /^\/api\/reports\/inventory/, role: 'admin' },
  // Sends a file out of the portal, and sets who gets it and when.
  { pattern: /^\/api\/sli\/(email|schedule|recipients)/, role: 'admin' },
  { pattern: /^\/api\/(links|net)\b/, role: 'wall' },
  // The acknowledge/close write-back.
  { pattern: /^\/api\/problems\/(acknowledge|close)/, role: 'operator' },
];

export function requiredRole(url: string): Role {
  return ROUTE_RULES.find((r) => r.pattern.test(url))?.role ?? 'viewer';
}

export const roleAllows = (has: Role, needs: Role) => RANK[has] >= RANK[needs];

/** Reachable without a token. Matched exactly, so a route added under these paths is not public by accident. */
const PUBLIC_ROUTES = new Set(['/api/health', '/api/auth/login', '/api/auth/me', '/api/auth/logout']);

/**
 * The header every cookie-authenticated POST must carry.
 * A page on another site cannot add a custom header without a CORS preflight,
 * and the BFF's CORS setting refuses that preflight for any other origin.
 */
export const CSRF_HEADER = 'x-hcml-csrf';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Public, but they set or clear the session cookie, so they are checked like any cookie POST. */
const COOKIE_ROUTES = new Set(['/api/auth/login', '/api/auth/logout']);

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
 * Sign-in logging: the name as typed is logged, so it is cut short and stripped of control
 * characters. From this many failures in a row for one name (any address) a warning is logged, and
 * again at every multiple of it; failures older than the window are forgotten.
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

interface PortalUser {
  name: string;
  /** As written in the env: plain text or an scrypt hash. Never logged. */
  pass: string;
  /** `pass` ready to compare with a sign-in (passwords.ts). */
  check: StoredPassword;
  role: Role;
}

/**
 * Users come from env: there is no database yet (that phase was deferred).
 * `PORTAL_USERS` is `name:password:role` triples, comma-separated;
 * `PORTAL_USER` / `PORTAL_PASS` remain as the single-admin shorthand.
 * A password is plain text or an scrypt hash (passwords.ts).
 */
function loadUsers(warn: (m: string) => void): PortalUser[] {
  const raw = (process.env.PORTAL_USERS ?? '').trim();
  const users = raw ? parseUsers(raw, warn) : [];
  const { user: name, pass } = config.auth;
  return users.length ? users : [{ name, pass, check: parseStoredPassword(pass), role: 'admin' }];
}

/**
 * One entry as name, password and role: the name is what comes before the
 * first ':', the role what comes after the last, so the password in between
 * may hold ':' too. An entry with a single ':' has no role.
 */
function splitEntry(entry: string): { name: string; pass: string; role?: string } {
  const first = entry.indexOf(':');
  if (first < 0) return { name: entry.trim(), pass: '' };
  const last = entry.lastIndexOf(':');
  const name = entry.slice(0, first).trim();
  if (last === first) return { name, pass: entry.slice(first + 1).trim() };
  return { name, pass: entry.slice(first + 1, last).trim(), role: entry.slice(last + 1).trim() };
}

/**
 * The valid `PORTAL_USERS` triples. Warnings name an entry by its position,
 * never its text: a malformed entry, or a role that is really the rest of a
 * password, would otherwise put a password in the log.
 */
function parseUsers(raw: string, warn: (m: string) => void): PortalUser[] {
  const entries = raw.split(',');
  const users: PortalUser[] = [];
  entries.forEach((entry, i) => {
    const { name, pass, role } = splitEntry(entry);
    if (!name || !pass) {
      warn(`PORTAL_USERS entry ${i + 1} of ${entries.length} is not name:password:role. Skipped.`);
      return;
    }
    const check = parseStoredPassword(pass);
    if (check.kind === 'invalid') {
      warn(`PORTAL_USERS entry ${i + 1} of ${entries.length} starts with "scrypt." but is not a usable hash (scrypt.N.r.p.salt.hash). Skipped.`);
      return;
    }
    if (role && !isRole(role)) warn(`PORTAL_USERS entry for "${name}" has an unknown role; it gets viewer.`);
    // A token names its user, not which of two same-named entries signed in,
    // so a renewal cannot tell them apart (POST /api/auth/refresh refuses it).
    // With auth off there are no sessions to warn about.
    if (config.auth.enabled && users.some((u) => u.name === name)) {
      warn(`PORTAL_USERS names "${name}" more than once. Each entry can sign in, but its sessions are not renewed: they end an hour before their ${config.auth.sessionHours} hours. Give each entry its own name.`);
    } else if (config.auth.enabled && users.some((u) => sameName(u.name, name))) {
      warn(`PORTAL_USERS has names that differ only by case, including "${name}". Sign-in ignores case, so give each entry a name that differs by more than that.`);
    }
    users.push({ name, pass, check, role: isRole(role) ? role : 'viewer' });
  });
  return users;
}

/** Sign-in compares names without regard to case; the name as written in the env is kept. */
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Refuse to start with a password anyone can guess: empty (what copying
 * .env.example gave) or the built-in "admin". Passwords on a short list are
 * warned about, not refused. Names the users, never the passwords. Only with auth on.
 */
export function assertUsers(warn: (message: string) => void = () => undefined): void {
  if (!config.auth.enabled) return;
  // Falling back to PORTAL_USER/PORTAL_PASS here would blame a user nobody configured.
  const raw = (process.env.PORTAL_USERS ?? '').trim();
  const notes: string[] = [];
  if (raw && !parseUsers(raw, (m) => notes.push(m)).length) {
    throw new Error(`AUTH_ENABLED=true but no PORTAL_USERS entry is a valid name:password:role triple. ${notes.join(' ')}`);
  }
  const loaded = loadUsers(() => undefined);
  // Only the PORTAL_USER/PORTAL_PASS pair can get here with a broken hash: a PORTAL_USERS entry like that is skipped above.
  if (loaded.some((u) => u.check.kind === 'invalid')) {
    throw new Error('AUTH_ENABLED=true but PORTAL_PASS starts with "scrypt." and is not a usable hash (scrypt.N.r.p.salt.hash).');
  }
  const weak = loaded.filter((u) => isGuessable(u.pass));
  if (weak.length) {
    throw new Error(
      `AUTH_ENABLED=true but ${weak.map((u) => `"${u.name}"`).join(', ')} ` +
        `${weak.length === 1 ? 'has' : 'have'} an empty password or the default "admin". ` +
        'Set PORTAL_PASS, or PORTAL_USERS as name:password:role triples, in .env.',
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
  const user = req.user as { role?: unknown } | undefined;
  return isRole(user?.role) ? user.role : 'viewer';
}

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

export async function setupAuth(app: FastifyInstance): Promise<void> {
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
  const users = loadUsers((m) => app.log.warn(m));
  const hashed = users.some((u) => u.check.kind === 'scrypt');

  // Sessions signed out before their tokens expire, with the time the last of those tokens could still be valid.
  // In memory, so a restart of the BFF forgets them; SESSION_EPOCH still ends every session at once.
  const signedOut = new Map<string, number>();

  /**
   * The configured user a token belongs to, or undefined when that user is gone. A name
   * listed twice cannot say which entry signed in, so the token's role must still be one of theirs.
   */
  const currentUser = (sub: unknown, tokenRole: unknown): PortalUser | undefined => {
    const named = users.filter((u) => u.name === sub);
    return named.length === 1 ? named[0] : named.find((u) => u.role === tokenRole);
  };

  /**
   * Check the token, then look its user up again: a user removed from PORTAL_USERS is refused, and
   * the role in force is the one configured now, not the one the token was signed with. Null when
   * either fails. req.user carries that current role from here on (roleOf reads it).
   */
  const authenticate = async (req: FastifyRequest) => {
    let claims: { sub?: unknown; role?: unknown; exp?: number; ep?: unknown };
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
    if (!user) return null;
    req.user = { ...claims, role: user.role };
    return { claims, user };
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
  const findUser = async (username: string, password: string): Promise<PortalUser | undefined> => {
    const named = users.filter((u) => sameName(u.name, username));
    if (!named.length && hashed) await decoyVerify(password);
    const matches: PortalUser[] = [];
    for (const u of named) if (await verifyPassword(u.check, password)) matches.push(u);
    return matches.find((u) => u.name === username) ?? matches[0];
  };

  /**
   * Sign a token for `u` into the session cookie; the body carries its lifetime, never the token. A renewal keeps the sid,
   * so signing out ends every token of the chain; the jti keeps two tokens of one second apart.
   */
  const issue = (u: PortalUser, req: FastifyRequest, reply: FastifyReply, sid: string = randomUUID()) => {
    const token = app.jwt.sign({ sub: u.name, role: u.role, ep: config.auth.sessionEpoch, jti: randomUUID(), sid }, { expiresIn: tokenLifetime(), ...claimsOfThisPortal });
    const { iat, exp } = app.jwt.decode(token) as { iat: number; exp: number };
    reply.setCookie(cookieName, token, { ...cookieOptions(req), maxAge: exp - iat });
    return { user: { name: u.name, role: u.role }, expiresIn: exp - iat };
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
  const loginKey = (req: FastifyRequest) => {
    const { username } = (req.body ?? {}) as { username?: unknown };
    const name = createHash('sha256').update(typeof username === 'string' ? username.toLowerCase() : '').digest('base64url');
    return `login|${normalizeIP(req.ip)}|${name}`;
  };
  const loginCheck = app.hasDecorator('createRateLimit')
    ? app.createRateLimit({ max: LOGIN_ATTEMPTS_PER_MINUTE, timeWindow: '1 minute', keyGenerator: loginKey })
    : null;
  // Consecutive failures per sign-in key, in insertion order so the oldest is dropped first.
  const failures = new Map<string, { count: number; last: number; until: number }>();
  const refuse = (reply: FastifyReply, seconds: number, message: string): never => {
    reply.header('retry-after', String(seconds));
    throw Object.assign(new Error(message), { statusCode: 429, error: 'rate_limited' });
  };
  // Every attempt is logged: the name as typed, the outcome and the address, never the password.
  const typedName = (req: FastifyRequest) => {
    const { username } = (req.body ?? {}) as { username?: unknown };
    // eslint-disable-next-line no-control-regex -- a typed name must not carry control characters into a log line
    return typeof username === 'string' ? username.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, LOG_NAME_MAX) : '';
  };
  const logAttempt = (req: FastifyRequest, outcome: 'success' | 'failure' | 'locked' | 'rate_limited') =>
    req.log.info({ event: 'sign_in', user: typedName(req), outcome, ip: req.ip }, `sign-in ${outcome}`);
  const loginLimit = async (req: FastifyRequest, reply: FastifyReply) => {
    const locked = failures.get(loginKey(req));
    const now = Date.now();
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
      req.log.warn({ event: 'sign_in_repeated_failures', user, failures: count, ip: req.ip }, 'repeated failed sign-ins for one name');
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
      logAttempt(req, 'failure');
      warnOnRepeats(req);
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Invalid username or password.' });
    }

    failures.delete(loginKey(req));
    nameFailures.delete(typedName(req).toLowerCase());
    logAttempt(req, 'success');
    return issue(found, req, reply);
  });

  app.get('/api/auth/me', async (req, reply) => {
    // With auth off the UI still needs a role so it knows what to render.
    if (!config.auth.enabled) {
      return { authEnabled: false, user: { name: 'anonymous', role: 'admin' as Role }, expiresIn: null, pages: pageRoles(requiredRole) };
    }
    const session = await authenticate(req);
    if (!session) return reply.code(401).send({ error: 'unauthorized', message: 'Your session has expired. Sign in again.' });
    return {
      authEnabled: true,
      // The role configured now, so a demoted user sees the menus the BFF will serve.
      user: { name: session.user.name, role: session.user.role },
      // Relative, so the page times its renewal without trusting its own clock.
      expiresIn: Math.max(0, (session.claims.exp ?? 0) - Math.floor(Date.now() / 1000)),
      // The role each menu page needs, from the rules that guard its route, so the sidebar keeps no copy.
      pages: pageRoles(requiredRole),
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

    // A removed user gets the same 401 as a bad token; the role is the current one, not the token's.
    const session = await authenticate(req);
    if (!session) return reply.code(401).send({ error: 'unauthorized', message: 'Sign in to continue.' });

    const has = session.user.role;
    const needs = requiredRole(route);
    if (!roleAllows(has, needs)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: `This view needs the "${needs}" role; you are signed in as "${has}".`,
      });
    }
  });

  // An open portal swaps its token for a fresh one before it runs out, for every user. The guard
  // above has already checked the one presented. The user is looked up again, so a user removed
  // from PORTAL_USERS cannot renew and a changed role takes effect. A name listed twice is refused:
  // taking the first entry let a sign-in with one entry's password renew into the other entry's
  // role.
  app.post('/api/auth/refresh', { schema: { body: noBody } }, async (req, reply) => {
    const { sub } = (req.user ?? {}) as { sub?: unknown };
    const matches = users.filter((u) => u.name === sub);
    const found = matches.length === 1 ? matches[0] : undefined;
    if (!found) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Your session has expired. Sign in again.' });
    }
    return issue(found, req, reply, sessionIdOf(req.user));
  });
}
