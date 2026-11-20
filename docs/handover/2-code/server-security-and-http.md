# Server: security and http

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 60 min | [Server: the core and the clients](server-core-and-clients.md) | [Server: domain and hosts](server-domain-and-hosts.md) |

`security/` decides who may do and see what: roles, the guard on every route, passwords, and what a viewer may not read. `http/` is the rules every request passes before it reaches a route: the request id, the host check, the rate limit, compression, the error mapping, the health check and the clean shutdown. The two folders are wired in by `server/src/index.ts` in an order that matters, since a Fastify hook reaches only the routes registered after it. [The sign-in page](../3-integrations/sign-in.md) is the view from outside; this chapter is the code.

## Who may do what

### The table of routes

`server/src/security/modules.ts`. Says who may use each route of the API. A person has a role, which is what they may do, and modules, which is what they may see; a module is one page of the menu. It is the whole of the authorisation table, and the menu is made from the same table.

<!-- gen:snippet server/src/security/modules.ts#ROUTES sha=00ff01fdf05c -->
`server/src/security/modules.ts:62-96`

```ts
export const ROUTES: readonly RouteRule[] = [
  { pattern: /^\/api\/users\b/, modules: ['users'], role: 'admin' },
  { pattern: /^\/api\/auth\/(password|refresh)$/, modules: 'any', role: 'guest' },
  { pattern: /^\/api\/ready$/, modules: 'any', role: 'guest' },
  // Governance, and what leaves the portal: the emailed report and the monthly send.
  { pattern: /^\/api\/reports\/inventory/, modules: ['inventory'], role: 'admin' },
  { pattern: /^\/api\/sli\/(email|schedule|recipients)/, modules: ['sla'], role: 'admin' },
  // The acknowledge/close write-back.
  { pattern: /^\/api\/problems\/(acknowledge|close)/, modules: ['problems'], role: 'operator' },
  { pattern: /^\/api\/problems\b/, modules: ['dashboard', 'problems'], role: 'guest' },
  { pattern: /^\/api\/(stats|freshness|stream)\b/, modules: ['dashboard', 'problems'], role: 'guest' },
  { pattern: /^\/api\/net\b/, modules: ['network'], role: 'guest' },
  { pattern: /^\/api\/links\b/, modules: ['links'], role: 'guest' },
  { pattern: /^\/api\/maps\b/, modules: ['maps'], role: 'guest' },
  { pattern: /^\/api\/graph\b/, modules: ['graphs'], role: 'guest' },
  { pattern: /^\/api\/devices\b/, modules: ['devices', 'hosts', 'dashboard'], role: 'guest' },
  { pattern: /^\/api\/sites\b/, modules: ['sites'], role: 'guest' },
  { pattern: /^\/api\/latest\b/, modules: ['latest'], role: 'guest' },
  { pattern: /^\/api\/items\b/, modules: ['graphs', 'latest', 'hosts'], role: 'guest' },
  { pattern: /^\/api\/hostgroups\b/, modules: ['hosts', 'latest'], role: 'guest' },
  { pattern: /^\/api\/hosts\b/, modules: ['hosts', 'graphs', 'latest'], role: 'guest' },
  { pattern: /^\/api\/services\b/, modules: ['services'], role: 'guest' },
  { pattern: /^\/api\/sla\b/, modules: ['sla', 'services'], role: 'guest' },
  { pattern: /^\/api\/sli\b/, modules: ['sla'], role: 'guest' },
  { pattern: /^\/api\/reports\/availability/, modules: ['sla'], role: 'guest' },
  { pattern: /^\/api\/reports\/aging/, modules: ['sla', 'problems', 'dashboard'], role: 'guest' },
  { pattern: /^\/api\/reports\/capacity/, modules: ['capacity'], role: 'guest' },
  { pattern: /^\/api\/reports\/noise/, modules: ['noise'], role: 'guest' },
  { pattern: /^\/api\/reports\/top-triggers/, modules: ['top-triggers'], role: 'guest' },
  { pattern: /^\/api\/reports\/(problems-by-group|top-hosts|web-monitoring)/, modules: ['dashboard'], role: 'guest' },
  // Explain is opened from these pages. The Assistant page is not one of them: it asks the model by `/api/chat`, and a person who holds it alone must not read a problem's detail or the derived SLA (SC-62).
  { pattern: /^\/api\/explain\/problem/, modules: ['problems', 'dashboard'], role: 'guest' },
  { pattern: /^\/api\/explain\/sla/, modules: ['sla', 'services'], role: 'guest' },
  { pattern: /^\/api\/chat\b/, modules: ['assistant'], role: 'guest' },
];
```
<!-- /gen -->

<!-- gen:snippet server/src/security/modules.ts#judge sha=1670e93c7284 -->
`server/src/security/modules.ts:115-121`

```ts
export function judge(access: Access, route: string): Verdict {
  const rule = ruleFor(route);
  if (!rule) return access.role === 'admin' ? { ok: true } : { ok: false, why: 'closed' };
  if (!roleAllows(access.role, rule.role)) return { ok: false, why: 'role', needs: rule.role };
  if (rule.modules === 'any' || access.role === 'admin') return { ok: true };
  return rule.modules.some((m) => access.modules.has(m)) ? { ok: true } : { ok: false, why: 'module', modules: rule.modules };
}
```
<!-- /gen -->

<!-- gen:snippet server/src/security/auth.ts#requiredRole sha=67cae8df3b09 -->
`server/src/security/auth.ts:27-29`

```ts
export function requiredRole(url: string): Role {
  return ruleFor(url)?.role ?? 'admin';
}
```
<!-- /gen -->

1. A role is `guest` (reads), `operator` (also acknowledges and closes problems) or `admin` (also manages users, reads the inventory scorecard, and sends or schedules the SLA report by mail). A module is a page of the menu, and `users` is the page that manages them. `viewer` and `wall`, the names the roles had before 17 November 2026, are still read from `.env` and from older sessions: `viewer` is a guest, and `wall` is a guest with the Network and Links pages (`modulesForEnvRole`).
2. `ROUTES` is a list of patterns, each with the modules that own the route and the lowest role. Holding any one of those modules is enough, and `any` is for the few routes every signed-in person needs. The first row that matches wins, so a narrower pattern sits above the wider one it is a prefix of. The two Explain rows belong to the Problems and Dashboard pages and to the SLA and Services pages, and not to the Assistant page (SC-62). The five routes for requests for an account have rows or a place in `PUBLIC_ROUTES`: the public pair needs no session, and the other three are for administrators (FR-62).
3. `judge` asks for the role first, so a module can never stand in for a role, and then for a module. An administrator holds every module. A route that has no row is closed to everyone but administrators, so a new route is protected by default, and `surface.test.ts` fails when a registered route has none.
4. `requiredRole(url)` in `auth.ts` is the role of the row, or `admin` when there is none.
5. `accessOf` builds what a person has from their role and their list. An administrator has every module, and anyone else keeps only the modules their role can reach (`grantable`), so a ticked box cannot lift a guest over the role. `pagesOf` turns that into the menu: each page the person has, with the role it needs. The sidebar keeps no second copy, so the menu and the guard cannot disagree. A page added to the menu without a module fails `page-access.test.ts`.
6. `presetFor` gives the ticks a new user starts with: a guest's pages, an operator's pages and the network pages, or every page for an administrator. They are only a start. What is stored is the list of the user, and nothing is looked up from the role afterwards.

The trap is the URL it is given. The guard passes it the route the router matched, not the raw text, because the router decodes the path first: `/%61pi/hosts` reaches the `/api/hosts` handler, and judging the raw text would let that request through with no token. Tests: `auth-rules.test.ts` and `surface.test.ts`, which pins the rules against the list of routes so that a change has to be made on purpose, and `mail-route.test.ts` and `schedule-route.test.ts`, which hold the email and schedule routes to `admin`.

### csrfRefusal

`server/src/security/auth.ts`. Refuses a request that could be a cross-site forgery. A page on another site must not be able to make a signed-in browser acknowledge a problem.

<!-- gen:snippet server/src/security/auth.ts#csrfRefusal sha=9a96c76a3444 -->
`server/src/security/auth.ts:124-134`

```ts
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
```
<!-- /gen -->

1. Only unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`) on `/api/` are checked. A read changes nothing.
2. `byCookie` is true when the browser authenticated the request by itself: there is a session cookie and no Bearer header. A script that holds a token and sends it in a header proves it is a script, so it needs no further check. Sign-in and sign-out set cookies, so they are checked always.
3. The request must carry the header `X-HCML-CSRF: 1`. Another site cannot add a custom header without a CORS preflight, and the server's CORS setting allows only `WEB_ORIGIN`, so the preflight fails.
4. If an `Origin` header is present, it must be the `Host` the server received (`sameOrigin`). A sandboxed frame sends the origin `null`, which is refused.

It returns the reason, or `null` to go on, which `setupAuth` turns into a 403 `csrf` with "Reload the page and try again." A proxy that changes `Host` makes every sign-in fail here, which is why the proxy must keep it. Tests: `auth.test.ts`.

### setupAuth

`server/src/security/auth.ts`. Registers the cookie and token plugins, the sign-in, the session routes and the guard. Quoted in parts.

**The check of a token.** Every protected request goes through `authenticate`.

<!-- gen:snippet server/src/security/auth.ts#setupAuth lines=19-50 sha=b0c987718fbb -->
`server/src/security/auth.ts:271-302` (lines 19 to 50 of setupAuth)

```ts
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
```
<!-- /gen -->

1. `jwtVerify` checks the signature, the expiry, and the issuer and audience that belong to this copy. Any failure, one step, `null`.
2. The epoch inside the token must equal `SESSION_EPOCH` now. A token with no epoch counts as epoch one, so the default changes nothing for old tokens. Changing the setting ends every session.
3. A session signed out before its tokens expired is refused: `signedOut` holds the ids of such sessions, in memory, for a whole session length. The id is the `sid` of the verified token, never the header text, so no spelling of the `Authorization` header gets round it. Every token of one sign-in and every token a renewal gives carries the same `sid`, so signing out one of them ends the chain. A token from before the id existed is known by its `jti`. Signing out also ends the open live streams of that session. What is not ended: a copy of a token that someone keeps renewing after the owner only closed the tab, without signing out, lives until the user is disabled on the Users page (for a user kept in `.env` alone, until the entry is taken out and the container recreated), `SESSION_EPOCH` is raised or `JWT_SECRET` changes. There is no absolute age on purpose, because a wall screen has to stay signed in.
4. `currentUser` looks the name up in the directory of users again (`.env` and the file). If it is gone, the token is refused, whatever it says. If a name is listed twice in `.env`, the token's role must still be one of theirs. A user who is disabled or past their expiry is refused (`usable`), and so is a token made before the user's `notBefore`, which is how a changed or reset password ends the older sessions. A disable sets `notBefore` too, so that enabling the person again does not bring the old tokens back (SC-57).
5. `req.user` gets the role and the modules in force now, not those the token was signed with, and `roleOf` and `modulesOf` read them from here on. Change a user on the Users page and their next request is judged by it, with no restart. A change in `.env`, which holds the first administrator and any entry not yet copied to the file, needs a restart and a new container.

**The signing of a token.**

<!-- gen:snippet server/src/security/auth.ts#setupAuth lines=76-85 sha=b0c987718fbb -->
`server/src/security/auth.ts:328-337` (lines 76 to 85 of setupAuth)

```ts
    if (hashesInUse && !isHash(a.check)) await decoyVerify(password);
    if ((await verifyPassword(a.check, password)) && usable(a, nowSeconds())) matches.push(a);
  }
  return matches.find((a) => a.name === username) ?? matches[0];
};

/**
 * Sign a token for `u` into the session cookie; the body carries its lifetime, never the token. A renewal keeps the sid,
 * so signing out ends every token of the chain; the jti keeps two tokens of one second apart.
 */
```
<!-- /gen -->

The token carries the name, the role, the epoch, a unique id `jti` and a session id `sid`. The `jti` keeps two sign-ins in the same second apart. The `sid` is the one a sign-in starts and a renewal passes on, so signing out one sign-in leaves the other alone. `claimsOfThisPortal` adds the issuer and audience made from the cookie name. The cookie is set with `maxAge` from the token itself, and the answer carries the lifetime and never the token, so no script learns it. `cookieOptions` makes it `HttpOnly`, `SameSite=Strict` and `Secure` only when the request arrived over HTTPS. A user whose password is temporary gets `mustChange: true` in the answer, so that the page asks for a new one at once.

**Sign-in, and the lock.**

<!-- gen:snippet server/src/security/auth.ts#setupAuth lines=157-184 sha=b0c987718fbb -->
`server/src/security/auth.ts:409-436` (lines 157 to 184 of setupAuth)

```ts
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
```
<!-- /gen -->

1. The route runs `loginLimit` first, as a `preHandler`, since the body is not parsed earlier. That is where the per-account limit and the lock are enforced. The body schema and a 4 KB limit are set on the route.
2. `findUser` checks the password against every entry of that name in the directory, and a name nobody holds still costs one hash check (`decoyVerify`), so an unknown name is not quicker to refuse than a known one, and an account whose password is plain text pays one too where hashes are in use (SC-60). A disabled or expired account is checked like any other and then refused with the same words, so the answer does not say that the name exists.
3. A failure is counted (`recordFailure`) and logged with the account's name when an account holds it, or as `unknown` with the length of what was typed when none does (a password typed into the name box must not stay in a log that lasts), and the address, never the password. From ten failures in a row for one account and address, sign-in is locked for a minute, doubling with each further failure up to five minutes. Every fifth failure for one name logs a warning. Failures are also counted for the address across names: 30 inside 15 minutes over at least ten names lock the address the same way, whatever the names, and log one `sign_in_spray` line (SC-61).
4. The answer to a failure is the same for a wrong name and a wrong password: 401 `invalid_credentials`. A success clears the counts.
5. After a success, `directory.signedIn` records the time and rewrites a hash that is weaker than the settings of now (`needsRehash`), so a raised cost reaches old hashes as people sign in, and an scrypt hash becomes Argon2id (SC-60). It never fails the sign-in.

**Who is signed in.**

<!-- gen:snippet server/src/security/auth.ts#setupAuth lines=186-207 sha=b0c987718fbb -->
`server/src/security/auth.ts:438-459` (lines 186 to 207 of setupAuth)

```ts
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
```
<!-- /gen -->

`GET /api/auth/me` is public, so that a page can find out whether it is signed in. With sign-in off every caller is an administrator with every module but `users`, since there are no accounts to manage. Otherwise it answers with the user, the seconds left on the session, `pages` (the pages this user has, each with the role it needs) and `modules`, and `mustChange` when the password is a temporary one. `user.source` is `env` or `file`, so that the Account page knows whether the password can be changed there (FR-73). The role and modules are those in force now, so a demoted user sees the menus the portal will serve.

**The guard.**

<!-- gen:snippet server/src/security/auth.ts#setupAuth lines=228-251 sha=b0c987718fbb -->
`server/src/security/auth.ts:480-503` (lines 228 to 251 of setupAuth)

```ts
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
```
<!-- /gen -->

One `onRequest` hook for every route under `/api` except the five public ones (`PUBLIC_ROUTES`: health, sign-in, who is signed in, sign-out and the request for an account). For `/api/health` it only notes that the caller is signed in, so that the answer can carry more. For the rest, no session is a 401 "Sign in to continue.". A person whose password is temporary may use only the few routes that let them choose a new one (`MUST_CHANGE_OK`), and anything else is a 403 `password_change_required`. Then `judge` decides from the table of routes: a role that is too low, or none of the modules that own the route, is a 403 `forbidden` whose sentence comes from `refusalText`. With sign-in off, `setupAuth` returns before this hook is registered, which is why every caller is then an administrator.

**A person's own password.**

<!-- gen:snippet server/src/security/auth.ts#setupAuth lines=253-270 sha=b0c987718fbb -->
`server/src/security/auth.ts:505-522` (lines 253 to 270 of setupAuth)

```ts
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
```
<!-- /gen -->

`POST /api/auth/password` takes the current password and a new one, for a user of the file (a user of `.env` changes it in `.env`, and the answer says so). The new one is refused when it is too short, too long, on the lists people guess (308 common passwords, 97 base words with digits or signs after them, one character repeated) or holds `hcml` or the sign-in name (`passwordProblem`, SC-71); it is only ever read as text, never as a stored hash (SC-58). The route is tried at most as often as a sign-in, per person. A change ends the person's older sessions and answers with a fresh token for the same session, so they stay signed in, and writes a `user_admin` line with the action `password_changed` to the log. Tests: `auth.test.ts`, `auth-sessions.test.ts`, `auth-users.test.ts`, `auth-rules.test.ts` and `users-routes.test.ts`.

### assertUsers

`server/src/security/auth.ts`. Refuses to start with a password anyone can guess.

<!-- gen:snippet server/src/security/auth.ts#assertUsers sha=4f1a87e63896 -->
`server/src/security/auth.ts:158-196`

```ts
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
```
<!-- /gen -->

1. With sign-in off it does nothing.
2. If `PORTAL_USERS` is set but holds no valid `name:password:role` entry, the start fails and says why. The reasons are collected without their text, so a malformed entry cannot put a password in the message.
3. The users are loaded as the guard will load them. A hash that is not a usable `argon2id.m.t.p.salt.hash` or `scrypt.N.r.p.salt.hash` stops the start too. Only the single-admin shorthand can reach this point with a broken hash, since a broken `PORTAL_USERS` entry is skipped above.
4. A password that is empty or the built-in `admin` stops the start, naming the users and never the passwords. A hash is tested against both guesses once, at start, so hashing `admin` does not get round the refusal.
5. A plain password shorter than 8 characters (`MIN_PASSWORD_LENGTH`) stops the start too, naming the users and never the passwords. A hash is not measured, since it is long whatever the password. The cause it guards against is Docker compose: it reads a `$` in `.env` as the start of a variable and drops the rest, so a long password can reach the server short, and the message says to put the password in single quotes, use a longer one, or store a hash made by `scripts/hash-password.ts` (SC-55).
6. A password on a short list (`secret`, `zabbix`, `password`, `changeme` and `123456`, in any case), or one that is still a placeholder such as `<a long password>` pasted from the documents, does not stop the start. One warning names the users and never the passwords (SC-46), because a weak choice is not an unset one. A hash is tried against each word of the list in lower case, once, at start.

It is the reason copying `.env.example` over `.env` does not give a portal with `admin` as its password. It reads the users of `.env` only: a password chosen on the Users page or the account page goes through `passwordProblem`, which refuses the same guesses. `index.ts` runs it right after `assertConfig`. Tests: `startup-guards.test.ts`, `auth-users.test.ts` and `passwords.test.ts`.

### Users and the file they are kept in

`server/src/security/accounts.ts` and `server/src/security/userStore.ts`. Who can sign in, and where that is kept (ADR 0017).

<!-- gen:snippet server/src/security/userStore.ts#readUsers sha=b2a3bb8d06d2 -->
`server/src/security/userStore.ts:71-89`

```ts
export function readUsers(raw: unknown): { users: StoredUser[]; repairs: string[]; usable: boolean } {
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.users)) return { users: [], repairs: [], usable: false };
  const users: StoredUser[] = [];
  const repairs: string[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const item of raw.users) {
    const user = userOf(item, repairs);
    if (!user) repairs.push(`A record of a user${droppedName(item)} was not whole and was dropped.`);
    else if (names.has(user.name.toLowerCase()) || ids.has(user.id)) repairs.push(`A second record for "${user.name}" was dropped.`);
    else if (users.length >= MAX_USERS) repairs.push(`The file held more than ${MAX_USERS} users; the rest were dropped.`);
    else {
      names.add(user.name.toLowerCase());
      ids.add(user.id);
      users.push(user);
    }
  }
  return { users, repairs, usable: true };
}
```
<!-- /gen -->

1. The users of `.env` (`PORTAL_USERS`, or `PORTAL_USER` and `PORTAL_PASS`) are read as they always were (`readEnvUsers`). The first administrator among them is the break-glass account. It stays in `.env`, the page cannot change or disable it, and it is the way in when the file is lost or empty.
2. On a portal with a data folder, `openUsers` keeps the other users in `users.json` on the state volume: mode 0600, password hashes only, written whole to a temporary file and renamed, with the file before the last change kept as `users.json.prev`. A file this build cannot read is put aside as `users.json.broken-<time>` and never deleted, and the `.prev` copy is used instead. Without a data folder the store keeps nothing and cannot be edited, and the users are those of `.env`.
3. `readUsers` reads a record back and drops what is not whole: a record with a field missing, a second record with a name or an id already seen, and any beyond `MAX_USERS`. It lists what it dropped in `repairs`. A module this build does not know is dropped and the user is kept, so a file written by a later build does not lock anyone out. Before the file is rewritten without a dropped record, the old file is copied to `users.json.repaired-<time>`, and the warning names the person (BK-98).
4. `createDirectory` joins the two. The break-glass account is first, then the users of the file, then any user of `.env` that the file does not hold. While the store can be edited, `seed` copies the users of `.env` into it by name at every start, and never overwrites a name the file already holds: from then on the file decides that person's password, role and modules, and the start says so. The start also names a person who was imported before and is no longer listed in `PORTAL_USERS`, who can still sign in (SC-67), and warns when nobody can open the Users page (`adminWarning`, BK-100).
5. A change is made on a copy, checked by reading it back as a file, saved, and only then made the users, one at a time in the order asked. A save that fails leaves the old users in force and sets `failing`, which the Users page says. A change that would leave no administrator who can sign in is refused (`adminLeft`).
6. A user is never deleted from the page, only disabled, so the log keeps a name to point to. `disabled`, `expires`, `mustChange` and `notBefore` decide whether a session still works: `usable` says whether the person may sign in at all, and a session begun before `notBefore` is void, which is how a changed or reset password ends the older ones.
7. A new user is given a temporary password and `mustChange`, so nothing but choosing a new password is open until it is chosen. Every change to a user writes one `user_admin` line to the log that says who did what to whom, with no password and no hash in it. A user kept in `.env` is changed in `.env`, and the page says so.

Tests: `user-store.test.ts`, `accounts.test.ts` and `users-routes.test.ts`.

### verifyPassword, decoyVerify and hashPassword

`server/src/security/passwords.ts`. How a password is stored and checked.

<!-- gen:snippet server/src/security/passwords.ts#parseStoredPassword sha=1538351483c7 -->
`server/src/security/passwords.ts:78-93`

```ts
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
```
<!-- /gen -->

<!-- gen:snippet server/src/security/passwords.ts#verifyPassword sha=ef75575be431 -->
`server/src/security/passwords.ts:121-126`

```ts
export async function verifyPassword(stored: StoredPassword, candidate: string): Promise<boolean> {
  if (stored.kind === 'plain') return timingSafeEqual(sha256(candidate), stored.digest);
  if (stored.kind === 'scrypt') return timingSafeEqual(await derive(candidate, stored.salt, stored.hash.length, stored.params), stored.hash);
  if (stored.kind === 'argon2id' && ARGON2_SUPPORTED) return timingSafeEqual(await deriveArgon2(candidate, stored.salt, stored.hash.length, stored.params), stored.hash);
  return false;
}
```
<!-- /gen -->

<!-- gen:snippet server/src/security/passwords.ts#decoyVerify sha=2b0b73939571 -->
`server/src/security/passwords.ts:131-134`

```ts
export async function decoyVerify(candidate: string): Promise<void> {
  if (ARGON2_SUPPORTED) await deriveArgon2(candidate, DECOY_SALT, KEY_BYTES, ARGON2_DEFAULTS);
  else await derive(candidate, DECOY_SALT, KEY_BYTES, SCRYPT_DEFAULTS);
}
```
<!-- /gen -->

<!-- gen:snippet server/src/security/passwords.ts#hashPassword sha=b23d68111734 -->
`server/src/security/passwords.ts:140-150`

```ts
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
```
<!-- /gen -->

1. A stored password is either plain text, or a self-describing hash of one of two kinds: `argon2id.m.t.p.salt.hash` (m is the memory in KiB, t the passes, p the lanes) or `scrypt.N.r.p.salt.hash`. Anything that starts with neither is plain. A string that starts like a hash but cannot be used, for example a cost that would ask for gigabytes, is `invalid`, and the start fails on it. Argon2id is Node's own (`crypto.argon2`, from Node 24.7). A process without it reads and writes scrypt and cannot check an Argon2id hash, which is why the image pins Node 24 and `engines` asks for it.
2. `verifyPassword` compares digests of equal length with `timingSafeEqual`, so the time taken does not say how much of a guess was right. A plain password is compared as the SHA-256 of both sides, which makes the lengths equal. A hash is recomputed by its own kind, with its own salt and cost, and compared the same way.
3. `decoyVerify` does the work of one check with nothing to compare, at the cost of a new hash (Argon2id, or scrypt on a Node without it), so a name that does not exist is not quicker to refuse.
4. `hashPassword` makes a new entry with a fresh 16-byte salt. Without settings it is Argon2id at `ARGON2_DEFAULTS` (m 47104, t 1, p 1: 46 MiB, about 30 ms a check on the development Mac against 127 ms for the scrypt it replaces), or scrypt at `SCRYPT_DEFAULTS` (N 32768, r 8, p 3) on a Node that has no Argon2. The cost travels with each hash, so raising the default later leaves older entries working, and `needsRehash` says that a plain one, or a hash weaker than the default of its kind, should be rewritten, so the next sign-in does it. A scrypt hash at its defaults is left alone: rewriting it as Argon2id would stop an older build from reading it. `server/scripts/hash-password.ts` is the command line around it.

Tests: `passwords.test.ts`.

### networkItemsDenied

`server/src/security/viewerPolicy.ts`. Keeps network interface data from an account without the Network page on routes that read an item by its id.

<!-- gen:snippet server/src/security/viewerPolicy.ts#hasNetworkItem sha=66462b1cf9ad -->
`server/src/security/viewerPolicy.ts:32-42`

```ts
async function hasNetworkItem(itemids: readonly string[]): Promise<boolean> {
  const ids = [...new Set(itemids)].sort();
  if (!ids.length) return false;
  const found = await cached(
    `itemkeys:${ids.join(',')}`,
    300_000,
    () => zbx<{ itemid: string; key_?: string }[]>('item.get', { itemids: ids, output: ['itemid', 'key_'], webitems: true }),
    { typed: true },
  );
  return found.some((item) => isNetworkKey(item.key_));
}
```
<!-- /gen -->

<!-- gen:snippet server/src/security/viewerPolicy.ts#networkItemsDenied sha=779de06f009b -->
`server/src/security/viewerPolicy.ts:48-51`

```ts
export async function networkItemsDenied(req: FastifyRequest, itemids: readonly string[]): Promise<string | null> {
  if (!hidesNetwork(req) || !(await hasNetworkItem(itemids))) return null;
  return `Network interface data is for accounts that have the Network page; you are signed in as "${roleOf(req)}".`;
}
```
<!-- /gen -->

The Network and Links pages need the Network and Links modules, but the items list, the latest data and the graph are routes of other pages that can return the same interface data. For lists the items whose key starts with `net.if` are left out (`withoutNetworkItems`, which returns a new array, so a cached list is never changed). A graph reads an item by id, and ids can be guessed, which is the gap this closes.

1. `networkItemsDenied` first asks `hidesNetwork`, which is true for an account that does not hold the Network module. An account that holds it, and every administrator, costs no lookup at all.
2. For any other account, `hasNetworkItem` asks Zabbix for the keys of the ids, in one `item.get`, cached for five minutes under a `typed` key made from the sorted ids (the ids are the caller's, so at most 150 such entries are kept), so a graph that polls does not ask every time.
3. An id Zabbix does not know has no key and counts as not an interface item, so the route's own "unknown item" answer is the one the caller sees.
4. If any id is an interface item, the answer is the 403 sentence that says interface data is for accounts that have the Network page, and names the caller's own role. Otherwise `null`, and the read goes on.

Tests: `viewer-network.test.ts` and `viewer-network-ids.test.ts`.

### aiUse, auditDownload and actor

`server/src/security/audit.ts`. The log said who signed in and who acknowledged a problem, and said nothing of who asked the hosted model about HCML's data, who took a report or who changed a user. Three lines now do.

1. `aiUse(req, kind)` wraps one use of the AI for the explain routes and the chat route. It hands the model call a function to report the tokens it used, adds them up, charges them to the daily budget, and logs one `ai_call` line when the use ends: the user, the address, the kind (`explain` or `chat`), how it ended (`answered`, `not_found`, `failed` or `aborted`), the tokens, the provider, and whether the model is outside the building. A second call to its `done` writes nothing, so a use is on record once.
2. The line holds no question, no answer and no facts about the estate. An answer that came from the cache costs no tokens and still has its line, so it shows who looked.
3. `auditDownload` writes a `report_download` line for each SLA report taken: the user, the address, the report, the month, the format and the size in bytes.
4. `auditUser` writes a `user_admin` line for each change to a user: the person acting, the address, the action (`created`, `changed`, `disabled`, `enabled`, `password_reset` or `password_changed`), the user it was done to, and the role and modules when they were part of the change. Never a password or a hash.
5. `actor` is the name of whoever is acting, with brackets and control characters taken out, or `anonymous`. The write-back tag and these lines use the same one.

A line is written by the process that served the request, to the container's log and to the server's own file in the `portal-logs` volume (`core/logFile.ts`), which a rebuild keeps. Docker keeps five files of 50 MB for each container and deletes them when the container is made again, so `deploy/rebuild.sh` saves a compressed copy of the logs first. Where logs go beyond that, and for how long, is for whoever runs the portal to decide. The request line itself still carries no user name. Tests: `usage-log.test.ts`, `usage-log-sla.test.ts` and `download-log.test.ts`.

### searchGuard

`server/src/security/searchLimit.ts`. A text search in the item picker or in Latest data is a cold read of Zabbix whenever the text is new, and the global limit is one bucket for a whole address. So each person has an allowance of 120 searches a minute. `searchGuard` is a `preHandler` of `/api/items` and `/api/latest`: a request with no search text, or only spaces, is not counted; past the allowance the answer is a 429 `rate_limited` with a `retry-after`, before any read of Zabbix. Tests: `search-limit.test.ts`.

### heavyReportGuard

`server/src/security/heavyLimit.ts`. The heavy reports (availability, noise, capacity and top triggers) read thousands of SQL statements for a new `days`, behind a gate of two places, and the cache cannot stop a script from asking for a new `days` each time. `heavyReportGuard` is a `preHandler` of those four routes and counts the requests each person has waiting or running: four at most, which is two pages open, and then a 429 `rate_limited` with a `retry-after`, so that a script that keeps its connections open cannot fill the line while everyone else waits. A request that fails its schema is not counted, a place is given back when the answer is sent or the reader leaves, and another person is never refused because of the first (BK-75). The same file counts a second line the same way, for the monthly SLA reads: `sliReadGuard` is a `preHandler` of `/api/sli` and of the derived service tree and takes one place, and `sliExportGuard` is one of the report file and takes two, because the file reads both methods. Four places at most, which is two pages of both methods, or a page and a file, behind the gate of two places that `getMonthlySli` waits in. The two lines are counted apart, so four heavy reports do not use up the places for a month (BK-76). Both come from one small function that counts the places of each person in a map and gives them back once, when the connection closes. Tests: `heavy-limit.test.ts`, `sli-limit.test.ts`.

## What every request passes

### genReqId and registerRequestId

`server/src/http/requestId.ts`. Gives every request one id, from the browser's call to the log line.

<!-- gen:snippet server/src/http/requestId.ts#genReqId sha=0446c2680e45 -->
`server/src/http/requestId.ts:21-24`

```ts
export function genReqId(req: Pick<IncomingMessage, 'headers'>): string {
  const sent = req.headers['x-request-id'];
  return typeof sent === 'string' && SAFE_ID.test(sent) ? sent : randomUUID();
}
```
<!-- /gen -->

<!-- gen:snippet server/src/http/requestId.ts#registerRequestId sha=f7b86457e376 -->
`server/src/http/requestId.ts:30-41`

```ts
export function registerRequestId(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  // Only a JSON object with a text `error`, at a failure status: the one error shape (errors.ts).
  app.addHook('preSerialization', async (req, reply, payload) => {
    if (reply.statusCode < 400 || typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload;
    const body = payload as Record<string, unknown>;
    return typeof body.error === 'string' && !('requestId' in body) ? { ...body, requestId: req.id } : payload;
  });
}
```
<!-- /gen -->

1. nginx writes `$request_id` into `X-Request-Id` and into its own access log. `genReqId` is Fastify's hook for the request id: it takes the one the proxy sent when it is well formed, 8 to 64 letters, digits, dots, dashes or underscores, and otherwise makes a new one. A request that arrives some other way must not choose what is written to the log.
2. `registerRequestId` puts the id on every reply as `X-Request-Id`, in an `onRequest` hook registered before everything else, so a refusal that comes first (the host check, the rate limit, the guard) carries it too.
3. `preSerialization` adds `requestId` to the body of any error: a JSON object with a text `error` at a failure status. That is the id a person reads out, and an administrator finds it in both logs.

Tests: `request-id.test.ts`.

### registerHostCheck

`server/src/http/hostCheck.ts`. With sign-in off, answers only to a `Host` that names this machine.

<!-- gen:snippet server/src/http/hostCheck.ts#registerHostCheck sha=eb9cb4f20e1f -->
`server/src/http/hostCheck.ts:38-46`

```ts
export function registerHostCheck(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    if (config.auth.enabled || hostAllowed(req.headers.host)) return;
    return reply.code(421).send({
      error: 'misdirected_request',
      message: 'With sign-in off, this server answers only on localhost.',
    });
  });
}
```
<!-- /gen -->

With sign-in off every caller is an admin. A page on another site that points its own domain at the loopback address (DNS rebinding) could then read the development server as if it were the owner. Its requests still carry its own domain as the `Host`, which no loopback caller sends. So `hostAllowed` accepts `localhost`, `127.0.0.1`, `::1` and the host of `WEB_ORIGIN`, whatever the port, and anything else gets a 421 `misdirected_request`. With sign-in on there is a token to check, and the hook does nothing. It is registered before CORS and the routes, so nothing answers a request that is refused here.

### registerRateLimit

`server/src/http/rateLimit.ts`. The overall limit for each client address, counted before sign-in is checked.

<!-- gen:snippet server/src/http/rateLimit.ts#registerRateLimit sha=e8c796f606f6 -->
`server/src/http/rateLimit.ts:20-35`

```ts
export async function registerRateLimit(app: FastifyInstance, max = config.rateLimitPerMinute): Promise<void> {
  await app.register(rateLimit, {
    global: false,
    max,
    timeWindow: '1 minute',
    allowList: (req) => EXEMPT.has(req.routeOptions.url ?? ''),
    // The plugin throws what this returns, so it passes through the error
    // handler: `statusCode` is what keeps it a 429 there rather than a 500.
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'rate_limited',
      message: `Too many requests: the limit is ${ctx.max} per minute. Retry in ${ctx.after}.`,
    }),
  });
  app.addHook('onRequest', app.rateLimit());
}
```
<!-- /gen -->

1. The plugin runs with `global: false` and one `onRequest` hook calls `app.rateLimit()`. Registered as a root hook ahead of `setupAuth`, it counts every request first, so the guard's 401s and the cross-site check's 403s are counted too. The plugin's own per-route hooks would run after every root hook, and a flood would never be counted.
2. `allowList` exempts three routes by the route the router found: the live stream, the health check and sign-out. The stream holds one long connection for each screen and makes no repeated requests, the health check is polled on purpose by every page and by container checks, and a refused sign-out would leave a cookie working behind a page that shows sign-in.
3. The refusal is built as a 429 `rate_limited` with the limit in words. It passes through the error handler, and `statusCode` is what keeps it a 429 there and not a 500.

The limit is `RATE_LIMIT_PER_MINUTE`, 300. Behind Docker every browser arrives from the gateway's address, so it is one bucket for everyone, which is why `TRUST_PROXY` has to match the number of proxies.

### registerCompression

`server/src/http/compress.ts`. Compresses JSON replies with brotli or gzip, with no dependency.

<!-- gen:snippet server/src/http/compress.ts#registerCompression sha=f477c8a88822 -->
`server/src/http/compress.ts:49-84`

```ts
export function registerCompression(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.method === 'HEAD' || reply.statusCode === 204 || reply.statusCode === 304) return payload;
    if (reply.hasHeader('content-encoding')) return payload;
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
    if (!String(reply.getHeader('content-type') ?? '').startsWith('application/json')) return payload;
    const size = Buffer.byteLength(payload);
    if (size < MIN_BYTES) return payload;

    // The body depends on Accept-Encoding whether or not this client gets it
    // compressed, so a cache in between must key on it either way.
    appendVary(reply, 'Accept-Encoding');
    const encoding = pickEncoding(req.headers['accept-encoding']);
    if (!encoding) return payload;

    try {
      const body =
        encoding === 'br'
          ? await brotli(payload, {
              params: {
                [constants.BROTLI_PARAM_QUALITY]: 4,
                [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
                [constants.BROTLI_PARAM_SIZE_HINT]: size,
              },
            })
          : await gzipAsync(payload, { level: 6 });
      reply.header('content-encoding', encoding);
      // Fastify sets it again from the compressed body it is handed.
      reply.removeHeader('content-length');
      return body;
    } catch (err) {
      req.log.warn({ err }, 'response compression failed; sending it uncompressed');
      return payload;
    }
  });
}
```
<!-- /gen -->

The problem list alone is about 446 KB, polled every 30 seconds by every open Problems page, and every 3 seconds while a page waits for an acknowledgement to show. Brotli at quality 4 takes it to about 25 KB in about 1.4 ms, and gzip at level 6 for clients without brotli to about 28 KB in about 3 ms. Quality 4 is deliberate: Node's default of 11 took 612 ms on the same body, all on the event loop that every other request waits behind.

1. An `onSend` hook sees only bodies sent through `reply.send()`. The Assistant writes its events straight to the socket and the live stream compresses itself, because a hook would hold each event back in a buffer.
2. It skips HEAD, 204 and 304, replies that are already encoded, bodies that are not a string or a buffer, anything but `application/json`, and anything under 1 KB, where headers and framing eat the saving.
3. `Vary: Accept-Encoding` is added whether or not this client gets it compressed, since a cache between must key on it either way.
4. `pickEncoding` takes the coding the client weights higher, brotli on a tie, none if neither is acceptable.
5. If compressing fails, it logs a warning and sends the body uncompressed.

Tests: `compress.test.ts`.

### registerErrorHandler

`server/src/http/errors.ts`. Maps every failure to one reply shape: `{ error, message }`, plus `requestId`.

<!-- gen:snippet server/src/http/errors.ts#registerErrorHandler sha=387a76573c41 -->
`server/src/http/errors.ts:38-145`

```ts
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof BadRequestError) {
      return reply.code(400).send({ error: 'bad_request', message: err.message });
    }
    // A body schema (schemas.ts) refused the request: the same 400 as the handlers' own checks.
    const invalid = validationProblem(err);
    if (invalid) return reply.code(400).send({ error: 'bad_request', message: invalid });
    // The message of each Zabbix failure names the method and the setting to check, and `detail`
    // names ZBX_URL and what Zabbix sent back: the log gets both, the response body neither.
    if (err instanceof ZabbixAuthError) {
      req.log.error(err.message);
      return reply.code(503).send({ error: 'zabbix_auth', message: sourceDown(req.id) });
    }
    if (err instanceof ZabbixTimeoutError) {
      req.log.error({ detail: err.detail }, err.message);
      return reply.code(503).send({ error: 'zabbix_timeout', message: sourceDown(req.id) });
    }
    if (err instanceof ZabbixWriteDisabledError) {
      req.log.warn({ detail: err.detail }, 'zabbix write-back is not switched on');
      return reply.code(503).send({ error: 'zabbix_write_disabled', message: err.message });
    }
    if (err instanceof ZabbixApiError) {
      req.log.error({ detail: err.detail }, err.message);
      return reply.code(502).send({ error: 'zabbix_error', message: sourceDown(req.id) });
    }
    // The AI layer is optional garnish: when it fails, say so plainly and
    // leave the rest of the portal alone.
    if (err instanceof AiDisabledError) {
      req.log.warn({ detail: err.detail }, 'AI is not switched on');
      return reply.code(503).send({ error: 'ai_disabled', message: err.message });
    }
    if (err instanceof AiBusyError) {
      // One local model, one answer at a time: expected under load, not a fault.
      return reply.code(503).header('retry-after', '10').send({ error: 'ai_busy', message: err.message });
    }
    if (err instanceof AiUpstreamError) {
      // `detail` names the model address and what it sent back: the log gets it, the response never does.
      app.log.error({ detail: err.detail }, err.message);
      return reply.code(502).send({ error: 'ai_error', message: err.message });
    }

    if (err instanceof MailDisabledError) {
      req.log.warn('email, or its saved list, was asked for, but it is off on this portal');
      return reply.code(503).send({ error: 'mail_disabled', message: err.message });
    }
    if (err instanceof MailError) {
      // `detail` is what the mail server said: the log gets it, the response never does.
      req.log.error({ detail: err.detail, kind: err.kind }, 'the mail server did not take the report');
      return reply.code(502).send({ error: 'mail_error', message: err.message });
    }
    if (err instanceof EmptyReportError) {
      req.log.warn('a report email was asked for, but the report had no device in it');
      return reply.code(502).send({ error: 'empty_report', message: err.message });
    }
    if (err instanceof ScheduleUnavailableError) {
      return reply.code(503).send({ error: 'schedule_unavailable', message: err.message });
    }
    if (err instanceof DataNotReadYetError) {
      // The request is right and the figures are not there yet: a page may try again, which a 400 tells it not to.
      return reply.code(503).header('retry-after', '60').send({ error: 'data_not_read_yet', message: err.message });
    }
    // The reader left before their read began (gate.ts, cache.ts): nobody is there to be told, so this writes no line of its own.
    if (err instanceof Cancelled) {
      return reply.code(499).send({ error: 'cancelled', message: 'The read was dropped because its reader left.' });
    }
    if (err instanceof StateWriteError) {
      // `detail` is the system's code for the failure: the log gets it, the response never does.
      req.log.error({ detail: err.detail }, 'the portal could not save its state');
      return reply.code(500).send({ error: 'state_error', message: err.message });
    }
    if (err instanceof UsersWriteError) {
      // The same for the file of users: a full or read-only volume says what to check instead of the unexpected-error sentence (BK-99).
      req.log.error({ detail: err.detail }, 'the portal could not save its users');
      return reply.code(500).send({ error: 'users_error', message: err.message });
    }
    if (err instanceof RequestsWriteError) {
      // And for the file of requests for an account, which a stranger's request and an administrator's answer both write.
      req.log.error({ detail: err.detail }, 'the portal could not save its requests for an account');
      return reply.code(500).send({ error: 'requests_error', message: err.message });
    }

    // Fastify's own client errors (malformed JSON, wrong content type, body too
    // large) and the rate limiter's 429 carry a 4xx status and a message worth
    // showing. Anything else is a bug: log it in full, and do not hand its
    // internal wording to the browser.
    // Fastify 5 types `err` as unknown (anything can be thrown), so read each field defensively.
    const e = (err ?? {}) as { statusCode?: unknown; error?: unknown; code?: unknown; message?: unknown };
    const status = Number(e.statusCode);
    if (status >= 400 && status < 500) {
      return reply.code(status).send({
        error:
          typeof e.error === 'string' ? e.error : typeof e.code === 'string' ? e.code.toLowerCase() : 'bad_request',
        message: e.message,
      });
    }
    req.log.error(err);
    return reply
      .code(500)
      .send({ error: 'internal', message: `The portal hit an unexpected error. Tell an administrator and quote reference ${req.id}.` });
  });

  app.setNotFoundHandler((req, reply) =>
    reply
      .code(404)
      .send({ error: 'not_found', message: `No such endpoint: ${req.method} ${req.url.split('?')[0]}` }),
  );
}
```
<!-- /gen -->

1. A `BadRequestError`, or a body or query a schema refused, is a 400 `bad_request` with its own message. A body with a field the schema does not list is refused the same way, naming the field (BK-97).
2. The four Zabbix errors are 503 or 502 with a fixed sentence for the person at the screen, "The data source is not answering. Tell an administrator and quote reference ...", and the details, the method and the setting to check and Zabbix's own words, go to the log. A rejected token and a Zabbix that does not answer in time are 503, because both mean the data source is not usable right now and not that the portal is at fault; every other failure of the call, a refused connection included, is 502 `zabbix_error`.
3. The AI errors come next: not switched on, 503; busy, 503 with `Retry-After`, because a local model answering someone else is expected under load; and a failure upstream, 502. Their details also go to the log and never to the browser.
4. Email follows the same rule. Email not set up is 503 `mail_disabled`, a month in which neither method finds a device is 502 `empty_report` with a sentence that says where to look (BK-51), and a refusal by the mail server is 502 `mail_error` with one fixed sentence for its kind (login, connection, time, TLS, recipients, message, other). What the server said goes to the log, with the login name and the password taken out. The monthly schedule adds two: 503 `schedule_unavailable` where it cannot run on this portal (the message says what to change), and 500 `state_error` when the portal could not save its small state file, with a fixed sentence and the system's own code in the log only. A failed save of the users file is the same kind of failure, 500 `users_error`, with a sentence that says to check the data folder (BK-99), and a failed save of the file of requests for an account is 500 `requests_error`, the same way. A request that is right and cannot be answered yet, because no reading is newer than the start of the range it asks for, is 503 `data_not_read_yet` with `Retry-After: 60`: a page may ask again, which a 400 would tell it not to (BK-80).
5. A read dropped because its reader left (`Cancelled`, from the gate, or from the cache when a reader's own signal fires) is a 499 `cancelled`, and the handler writes no line of its own; Fastify's request line is still there. The connection is closed, so nobody reads the answer, and an expected thing is not an error.
6. Anything else with a 4xx status, such as malformed JSON, a wrong content type or a body too large, is passed on with its message. Anything else is a bug: it is logged in full, and the browser gets "The portal hit an unexpected error. Tell an administrator and quote reference ..." and never the internal wording.
7. An unknown route is a 404 that names the method and path, without the query string.

It lives in its own module so the tests can exercise it against a bare Fastify instance, since `index.ts` starts a listening server on import. Tests: `ai-errors.test.ts`, `routes.test.ts`, `zabbix.test.ts`, `mail-route.test.ts`, `schedule-route.test.ts` and `reader-gone.test.ts`.

### createReadiness

`server/src/http/health.ts`. The cached check of whether Zabbix and the model answer, so that polling health cannot pile calls onto Zabbix.

<!-- gen:snippet server/src/http/health.ts#createReadiness sha=2e3d45b786b0 -->
`server/src/http/health.ts:98-154`

```ts
export function createReadiness(opts: ReadinessOptions = {}) {
  const probes = opts.probes ?? { zabbix: zabbixProbe, model: modelProbe };
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? READY_TTL_MS;
  const staleMs = opts.staleMs ?? READY_STALE_MS;
  const timeoutMs = opts.timeoutMs ?? READY_TIMEOUT_MS;
  let last: Readiness | null = null;
  let flight: Promise<Readiness> | null = null;

  async function check(): Promise<Readiness> {
    const started = now();
    let timer: NodeJS.Timeout | undefined;
    const call = Promise.resolve().then(probes.zabbix);
    call.catch(() => undefined); // abandoned on a timeout: its late failure is not news
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(TIMED_OUT), timeoutMs);
      timer.unref?.();
    });
    const [z, model] = await Promise.all([
      Promise.race([call, limit]).then(
        (): { state: ZabbixState; ms: number | null } => ({ state: 'ok', ms: now() - started }),
        (err: unknown) => ({ state: stateOf(err), ms: null }),
      ),
      probes.model().catch((): ModelState => 'down'),
    ]);
    clearTimeout(timer);
    return { ok: z.state === 'ok', zabbix: z.state, zabbixMs: z.ms, model, checkedAt: now() };
  }

  function refresh(): Promise<Readiness> {
    flight ??= check()
      .then((r) => (last = r))
      .finally(() => {
        flight = null;
      });
    return flight;
  }

  return {
    /** The answer to give now: fresh, recent and refreshing behind it, or a new check if there is none worth giving. */
    async get(): Promise<Readiness> {
      if (last) {
        const age = now() - last.checkedAt;
        if (age < ttlMs) return last;
        if (age < staleMs) {
          void refresh();
          return last;
        }
      }
      return refresh();
    },
    /** Start the first check without waiting, so the first health call finds an answer. */
    warm(): void {
      void refresh();
    },
  };
}
```
<!-- /gen -->

1. `get()` answers from the last check while it is younger than `ttlMs`. Between that and `staleMs` it answers with the last check and starts a new one behind it. Only older than that does it wait for a new check.
2. `refresh()` has one check in flight at a time: `flight ??=` reuses the running one.
3. `check()` runs Zabbix's probe under a limit of two seconds, racing it against a timer. The probe is `host.get` with a limit of one host: the cheapest authenticated read there is (`apiinfo.version` is refused with a token). The call itself is given the same limit, so a slow Zabbix is not left running behind the answer, and a probe abandoned on the timeout has its late failure swallowed, since that is not news.
4. The model probe runs beside it. With no model it is `off`. For the hosted provider it is `not_checked`, because a probe would be billed. For a local model it asks `/models`: `down` when the server does not answer, `missing` when it answers and its list lacks `AI_MODEL` (`isListed` reads a name without a tag as `:latest`, as Ollama does), and `ok` otherwise (BK-66).
5. The result says `ok` only when Zabbix answered. `warm()` starts the first check at boot so that the first health call finds an answer.
6. A signed-in caller also gets `logFile`, from `logFileStatus()` in `core/logFile.ts`: `off` when `LOG_DIR` is empty, `ok`, or `failing` while the file cannot be written, with the bytes that have reached it since the process started. A log that stopped being written leaves the person reading `docker logs` with no word of it (IN-83).

`GET /api/health` always answers 200. A signed-in caller gets this result as `ready`, and anyone else gets only whether it is `ok`, as a plain `true` or `false` (IN-47). `GET /api/ready` answers 503 while it is not `ok`. Tests: `health.test.ts`.

### installShutdown

`server/src/http/shutdown.ts`. Closes the server cleanly on a stop signal, inside the ten seconds Docker allows.

<!-- gen:snippet server/src/http/shutdown.ts#installShutdown sha=6e51a1715a82 -->
`server/src/http/shutdown.ts:39-76`

```ts
export function installShutdown(app: FastifyInstance, opts: ShutdownOptions = {}): () => void {
  const { timeoutMs = SHUTDOWN_TIMEOUT_MS, source = process, exit = (code) => process.exit(code) } = opts;
  let closing = false;

  const onSignal = (signal: NodeJS.Signals): void => {
    if (closing) {
      // A second Ctrl-C in a terminal means "now".
      app.log.warn(`${signal} again: exiting without waiting`);
      exit(1);
      return;
    }
    closing = true;
    app.log.info(`${signal} received: closing the BFF`);
    const hard = setTimeout(() => {
      app.log.error(`Closing took longer than ${timeoutMs} ms: exiting anyway`);
      exit(1);
    }, timeoutMs);
    hard.unref?.();
    app.close().then(
      () => {
        clearTimeout(hard);
        app.log.info('BFF closed');
        exit(0);
      },
      (err: unknown) => {
        clearTimeout(hard);
        app.log.error(err);
        exit(1);
      },
    );
  };

  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  for (const s of signals) source.on(s, onSignal);
  return () => {
    for (const s of signals) source.off(s, onSignal);
  };
}
```
<!-- /gen -->

1. Node as process 1 ignores a signal it has no handler for, so the handler is installed for `SIGTERM` and `SIGINT`. The handler is its own module because `index.ts` starts a server on import, which a test could not drive. The source, the exit function and the timeout can be passed in for the same reason.
2. The first signal sets `closing` and starts a hard timer of eight seconds, `SHUTDOWN_TIMEOUT_MS`, under Docker's ten. `app.close()` ends the live streams and closes the server. It also pauses the monthly scheduler when the close begins and waits up to five seconds (`STOP_WAIT_MS`) for a send that is under way, so that the send is recorded; the eight-second timer still ends the process. On success it clears the timer and exits 0, on failure it logs and exits 1, and if closing takes longer than the timer the process exits 1 anyway.
3. A second signal means "now": it logs and exits at once, which is what a second Ctrl-C in a terminal means.
4. It returns a function that takes the handlers off again.

`init: true` in the compose file makes sure the signal reaches Node. Tests: `shutdown.test.ts`.

### installCrashLog

In the same module, installed first in `index.ts`. An uncaught exception or an unhandled rejection is written with `app.log.fatal`, with the error and its stack, once, and the process exits with 1. Node's own report goes to stderr, which a rebuild deletes with the container, so without this the reason for a crash would not be in `bff.log` (BK-68). The source and the exit function can be passed in, as for `installShutdown`. Tests: `shutdown.test.ts`.
