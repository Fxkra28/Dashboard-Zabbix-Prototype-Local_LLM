# Server: security and http

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 45 min | [Server: the core and the clients](server-core-and-clients.md) | [Server: domain and hosts](server-domain-and-hosts.md) |

`security/` decides who may do and see what: roles, the guard on every route, passwords, and what a viewer may not read. `http/` is the rules every request passes before it reaches a route: the request id, the host check, the rate limit, compression, the error mapping, the health check and the clean shutdown. The two folders are wired in by `server/src/index.ts` in an order that matters, since a Fastify hook reaches only the routes registered after it. [The sign-in page](../3-integrations/sign-in.md) is the view from outside; this chapter is the code.

## Who may do what

### requiredRole

`server/src/security/auth.ts`. Says which role a route needs. It is the whole of the authorisation table.

<!-- gen:snippet server/src/security/auth.ts#ROUTE_RULES sha=042c0027cc29 -->
`server/src/security/auth.ts:38-45`

```ts
const ROUTE_RULES: { pattern: RegExp; role: Role }[] = [
  { pattern: /^\/api\/reports\/inventory/, role: 'admin' },
  // Sends a file out of the portal, and sets who gets it and when.
  { pattern: /^\/api\/sli\/(email|schedule|recipients)/, role: 'admin' },
  { pattern: /^\/api\/(links|net)\b/, role: 'wall' },
  // The acknowledge/close write-back.
  { pattern: /^\/api\/problems\/(acknowledge|close)/, role: 'operator' },
];
```
<!-- /gen -->

<!-- gen:snippet server/src/security/auth.ts#requiredRole sha=aff13eb0268e -->
`server/src/security/auth.ts:47-49`

```ts
export function requiredRole(url: string): Role {
  return ROUTE_RULES.find((r) => r.pattern.test(url))?.role ?? 'viewer';
}
```
<!-- /gen -->

1. `ROUTE_RULES` is a list of patterns and the lowest role for each. The inventory report needs `admin`, so do emailing the SLA report (`/api/sli/email`, because it sends a file out of the portal) and setting its monthly schedule (`/api/sli/schedule`, because it chooses who gets it and when) and its saved list of people (`/api/sli/recipients`), the links and everything under `/api/net` need `wall`, and acknowledge and close need `operator`.
2. `requiredRole(url)` returns the role of the first pattern that matches, and `viewer` when none does. So a new route is protected by default: it needs a signed-in user at least. To open a route to a lower role, or close one to a higher, you change this list, and nothing else.
3. The sidebar does not keep a second copy. `pageRoles` runs `requiredRole` over the API route that fills each page ([below](#pageroles)), so the menu and the guard cannot disagree.

The trap is the URL it is given. The guard passes it the route the router matched, not the raw text, because the router decodes the path first: `/%61pi/hosts` reaches the `/api/hosts` handler, and judging the raw text would let that request through with no token. Tests: `auth-rules.test.ts` and `surface.test.ts`, which pins the rules against the list of routes so that a change has to be made on purpose, and `mail-route.test.ts` and `schedule-route.test.ts`, which hold the email and schedule routes to `admin`.

### csrfRefusal

`server/src/security/auth.ts`. Refuses a request that could be a cross-site forgery. A page on another site must not be able to make a signed-in browser acknowledge a problem.

<!-- gen:snippet server/src/security/auth.ts#csrfRefusal sha=9a96c76a3444 -->
`server/src/security/auth.ts:137-147`

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

`server/src/security/auth.ts`. The whole of sign-in, in one function with a few dozen small ones inside it. It registers the four auth routes and the guard, and holds the state that must not outlive the process: the users, the sign-out list and the failure counts. The function is 254 lines, so four parts are quoted.

**The check of a token.** Every protected request goes through `authenticate`.

<!-- gen:snippet server/src/security/auth.ts#setupAuth lines=25-54 sha=e8aa26749515 -->
`server/src/security/auth.ts:334-363` (lines 25 to 54 of setupAuth)

```ts
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
```
<!-- /gen -->

1. `jwtVerify` checks the signature, the expiry, and the issuer and audience that belong to this copy. Any failure, one step, `null`.
2. The epoch inside the token must equal `SESSION_EPOCH` now. A token with no epoch counts as epoch one, so the default changes nothing for old tokens. Changing the setting ends every session.
3. A session signed out before its tokens expired is refused: `signedOut` holds the ids of such sessions, in memory, for a whole session length. The id is the `sid` of the verified token, never the header text, so no spelling of the `Authorization` header gets round it. Every token of one sign-in and every token a renewal gives carries the same `sid`, so signing out one of them ends the chain. A token from before the id existed is known by its `jti`. Signing out also ends the open live streams of that session. What is not ended: a copy of a token that someone keeps renewing after the owner only closed the tab, without signing out, lives until the user is removed from the list, `SESSION_EPOCH` is raised or `JWT_SECRET` changes. There is no absolute age on purpose, because a wall screen has to stay signed in.
4. `currentUser` looks the name up in the configured users again. If it is gone, the token is refused, whatever it says. If a name is listed twice, the token's role must still be one of theirs.
5. `req.user` gets the role configured now, not the one the token was signed with, and `roleOf` reads it from here on. Demote someone, restart, and their next click is already a viewer's.

**The signing of a token.**

<!-- gen:snippet server/src/security/auth.ts#setupAuth lines=79-86 sha=e8aa26749515 -->
`server/src/security/auth.ts:388-395` (lines 79 to 86 of setupAuth)

```ts
  const token = app.jwt.sign({ sub: u.name, role: u.role, ep: config.auth.sessionEpoch, jti: randomUUID(), sid }, { expiresIn: tokenLifetime(), ...claimsOfThisPortal });
  const { iat, exp } = app.jwt.decode(token) as { iat: number; exp: number };
  reply.setCookie(cookieName, token, { ...cookieOptions(req), maxAge: exp - iat });
  return { user: { name: u.name, role: u.role }, expiresIn: exp - iat };
};

// Before the guard, and with auth off too: login and logout set cookies either way.
app.addHook('onRequest', async (req, reply) => {
```
<!-- /gen -->

The token carries the name, the role, the epoch, a unique id `jti` and a session id `sid`. The `jti` keeps two sign-ins in the same second apart. The `sid` is the one a sign-in starts and a renewal passes on, so signing out one sign-in leaves the other alone. `claimsOfThisPortal` adds the issuer and audience made from the cookie name. The cookie is set with `maxAge` from the token itself, and the answer carries the lifetime and never the token, so no script learns it. `cookieOptions` makes it `HttpOnly`, `SameSite=Strict` and `Secure` only when the request arrived over HTTPS.

**Sign-in, and the lock.**

<!-- gen:snippet server/src/security/auth.ts#setupAuth lines=151-176 sha=e8aa26749515 -->
`server/src/security/auth.ts:460-485` (lines 151 to 176 of setupAuth)

```ts
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
```
<!-- /gen -->

1. The route runs `loginLimit` first, as a `preHandler`, since the body is not parsed earlier. That is where the per-account limit and the lock are enforced. The body schema and a 4 KB limit are set on the route.
2. `findUser` checks the password against every entry of that name, and a name nobody holds still costs one hash check (`decoyVerify`), so an unknown name is not quicker to refuse than a known one.
3. A failure is counted (`recordFailure`) and logged with the name as typed and the address, never the password. From ten failures in a row for one account and address, sign-in is locked for a minute, doubling with each further failure up to five minutes. Every fifth failure for one name logs a warning.
4. The answer to a failure is the same for a wrong name and a wrong password: 401 `invalid_credentials`. A success clears the counts.

**The guard.**

<!-- gen:snippet server/src/security/auth.ts#setupAuth lines=213-238 sha=e8aa26749515 -->
`server/src/security/auth.ts:522-547` (lines 213 to 238 of setupAuth)

```ts
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

```
<!-- /gen -->

One `onRequest` hook for every route under `/api` except the four public ones. For `/api/health` it only notes that the caller is signed in, so that the answer can carry more. For the rest, no session is a 401 "Sign in to continue.", and a role below `requiredRole` is a 403 that names both roles. With sign-in off, `setupAuth` returns before this hook is registered, which is why every caller is then an admin. Tests: `auth.test.ts`, `auth-sessions.test.ts`, `auth-users.test.ts`, `auth-rules.test.ts`.

### assertUsers

`server/src/security/auth.ts`. Refuses to start with a password anyone can guess.

<!-- gen:snippet server/src/security/auth.ts#assertUsers sha=cc5d7ead9945 -->
`server/src/security/auth.ts:243-272`

```ts
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
```
<!-- /gen -->

1. With sign-in off it does nothing.
2. If `PORTAL_USERS` is set but holds no valid `name:password:role` entry, the start fails and says why. The reasons are collected without their text, so a malformed entry cannot put a password in the message.
3. The users are loaded as the guard will load them. A hash that is not a usable `scrypt.N.r.p.salt.hash` stops the start too. Only the single-admin shorthand can reach this point with a broken hash, since a broken `PORTAL_USERS` entry is skipped above.
4. A password that is empty or the built-in `admin` stops the start, naming the users and never the passwords. A hash is tested against both guesses once, at start, so hashing `admin` does not get round the refusal.
5. A password on a short list (`secret`, `zabbix`, `password`, `changeme` and `123456`, in any case), or one that is still a placeholder such as `<a long password>` pasted from the documents, does not stop the start. One warning names the users and never the passwords (SC-46), because a weak choice is not an unset one. A hash is tried against each word of the list in lower case, once, at start.

It is the reason copying `.env.example` over `.env` does not give a portal with `admin` as its password. `index.ts` runs it right after `assertConfig`. Tests: `startup-guards.test.ts`, `auth-users.test.ts` and `passwords.test.ts`.

### verifyPassword, decoyVerify and hashPassword

`server/src/security/passwords.ts`. How a password is stored and checked.

<!-- gen:snippet server/src/security/passwords.ts#parseStoredPassword sha=758b5de33d21 -->
`server/src/security/passwords.ts:38-52`

```ts
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
```
<!-- /gen -->

<!-- gen:snippet server/src/security/passwords.ts#verifyPassword sha=7ed407697bcc -->
`server/src/security/passwords.ts:65-69`

```ts
export async function verifyPassword(stored: StoredPassword, candidate: string): Promise<boolean> {
  if (stored.kind === 'plain') return timingSafeEqual(sha256(candidate), stored.digest);
  if (stored.kind === 'scrypt') return timingSafeEqual(await derive(candidate, stored.salt, stored.hash.length, stored.params), stored.hash);
  return false;
}
```
<!-- /gen -->

<!-- gen:snippet server/src/security/passwords.ts#decoyVerify sha=98479844d96c -->
`server/src/security/passwords.ts:74-76`

```ts
export async function decoyVerify(candidate: string): Promise<void> {
  await derive(candidate, DECOY_SALT, KEY_BYTES, SCRYPT_DEFAULTS);
}
```
<!-- /gen -->

<!-- gen:snippet server/src/security/passwords.ts#hashPassword sha=d1536d03502a -->
`server/src/security/passwords.ts:79-83`

```ts
export async function hashPassword(password: string, params: ScryptParams = SCRYPT_DEFAULTS): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, params);
  return `scrypt.${params.N}.${params.r}.${params.p}.${salt.toString('base64url')}.${key.toString('base64url')}`;
}
```
<!-- /gen -->

1. A stored password is either plain text, or the self-describing `scrypt.N.r.p.salt.hash`. Anything that does not start with `scrypt.` is plain. A string that starts like a hash but cannot be used, for example a cost that would ask for gigabytes, is `invalid`, and the start fails on it.
2. `verifyPassword` compares digests of equal length with `timingSafeEqual`, so the time taken does not say how much of a guess was right. A plain password is compared as the SHA-256 of both sides, which makes the lengths equal. A hash is recomputed with its own salt and cost and compared the same way.
3. `decoyVerify` does the work of one check with nothing to compare, with the default cost, so a name that does not exist is not quicker to refuse.
4. `hashPassword` makes a new entry with a fresh 16-byte salt and the default cost, 32 MiB and about 100 ms a check. The cost travels with each hash, so raising the default later leaves older entries working. `server/scripts/hash-password.ts` is the command line around it.

Tests: `passwords.test.ts`.

### networkItemsDenied

`server/src/security/viewerPolicy.ts`. Keeps network interface data from a viewer on routes that read an item by its id.

<!-- gen:snippet server/src/security/viewerPolicy.ts#hasNetworkItem sha=66462b1cf9ad -->
`server/src/security/viewerPolicy.ts:34-44`

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

<!-- gen:snippet server/src/security/viewerPolicy.ts#networkItemsDenied sha=ed8cc1cfd4f8 -->
`server/src/security/viewerPolicy.ts:50-53`

```ts
export async function networkItemsDenied(req: FastifyRequest, itemids: readonly string[]): Promise<string | null> {
  if (!hidesNetwork(req) || !(await hasNetworkItem(itemids))) return null;
  return `Network interface data needs the "wall" role; you are signed in as "${roleOf(req)}".`;
}
```
<!-- /gen -->

The Network and Links pages start at the wall role, but the items list, the latest data and the graph are viewer routes that can return the same interface data. For lists the items whose key starts with `net.if` are left out (`withoutNetworkItems`, which returns a new array, so a cached list is never changed). A graph reads an item by id, and ids can be guessed, which is the gap this closes.

1. `networkItemsDenied` first asks `hidesNetwork`, which is true for any role below wall. A wall account, an operator or an admin costs no lookup at all.
2. For a viewer, `hasNetworkItem` asks Zabbix for the keys of the ids, in one `item.get`, cached for five minutes under a `typed` key made from the sorted ids (the ids are the caller's, so at most 150 such entries are kept), so a graph that polls does not ask every time.
3. An id Zabbix does not know has no key and counts as not an interface item, so the route's own "unknown item" answer is the one the caller sees.
4. If any id is an interface item, the answer is the 403 sentence that names the wall role and the caller's own role. Otherwise `null`, and the read goes on.

Tests: `viewer-network.test.ts` and `viewer-network-ids.test.ts`.

### pageRoles

`server/src/security/pageAccess.ts`. The sidebar's source of truth: for each page, the role it needs.

<!-- gen:snippet server/src/security/pageAccess.ts#pageRoles sha=c8df6e798c4a -->
`server/src/security/pageAccess.ts:33-35`

```ts
export function pageRoles(roleFor: (url: string) => Role): Record<string, Role> {
  return Object.fromEntries(Object.entries(PAGE_API).map(([page, api]) => [page, roleFor(api)]));
}
```
<!-- /gen -->

`PAGE_API` pairs each page of the menu with the API route that fills it. `pageRoles` runs a function that maps a route to its role, here `requiredRole`, over every pair. `GET /api/auth/me` returns the result as `pages`, and the sidebar shows only those a role may open. A page added to the menu and left out of `PAGE_API` fails `page-access.test.ts`, so the menu cannot offer a page whose rule nobody wrote down.

### aiUse, auditDownload and actor

`server/src/security/audit.ts`. The log said who signed in and who acknowledged a problem, and said nothing of who asked the hosted model about HCML's data or who took a report. Two lines now do.

1. `aiUse(req, kind)` wraps one use of the AI for the explain routes and the chat route. It hands the model call a function to report the tokens it used, adds them up, charges them to the daily budget, and logs one `ai_call` line when the use ends: the user, the address, the kind (`explain` or `chat`), how it ended (`answered`, `not_found`, `failed` or `aborted`), the tokens, the provider, and whether the model is outside the building. A second call to its `done` writes nothing, so a use is on record once.
2. The line holds no question, no answer and no facts about the estate. An answer that came from the cache costs no tokens and still has its line, so it shows who looked.
3. `auditDownload` writes a `report_download` line for each SLA report taken: the user, the address, the report, the month, the format and the size in bytes.
4. `actor` is the name of whoever is acting, with brackets and control characters taken out, or `anonymous`. The write-back tag and these lines use the same one.

A line is written by the process that served the request, to the container's log. Docker keeps five files of 50 MB for each container and deletes them when the container is made again, so `deploy/rebuild.sh` saves a compressed copy of the logs first. Where logs go beyond that, and for how long, is for whoever runs the portal to decide. The request line itself still carries no user name. Tests: `usage-log.test.ts`, `usage-log-sla.test.ts` and `download-log.test.ts`.

### searchGuard

`server/src/security/searchLimit.ts`. A text search in the item picker or in Latest data is a cold read of Zabbix whenever the text is new, and the global limit is one bucket for a whole address. So each person has an allowance of 120 searches a minute. `searchGuard` is a `preHandler` of `/api/items` and `/api/latest`: a request with no search text, or only spaces, is not counted; past the allowance the answer is a 429 `rate_limited` with a `retry-after`, before any read of Zabbix. Tests: `search-limit.test.ts`.

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

<!-- gen:snippet server/src/http/errors.ts#registerErrorHandler sha=8b7b7f2402eb -->
`server/src/http/errors.ts:35-120`

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
      req.log.warn('a report email was asked for, but email is not set up');
      return reply.code(503).send({ error: 'mail_disabled', message: err.message });
    }
    if (err instanceof MailError) {
      // `detail` is what the mail server said: the log gets it, the response never does.
      req.log.error({ detail: err.detail, kind: err.kind }, 'the mail server did not take the report');
      return reply.code(502).send({ error: 'mail_error', message: err.message });
    }
    if (err instanceof ScheduleUnavailableError) {
      return reply.code(503).send({ error: 'schedule_unavailable', message: err.message });
    }
    if (err instanceof StateWriteError) {
      // `detail` is the system's code for the failure: the log gets it, the response never does.
      req.log.error({ detail: err.detail }, 'the portal could not save its state');
      return reply.code(500).send({ error: 'state_error', message: err.message });
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

1. A `BadRequestError`, or a body or query a schema refused, is a 400 `bad_request` with its own message.
2. The four Zabbix errors are 503 or 502 with a fixed sentence for the person at the screen, "The data source is not answering. Tell an administrator and quote reference ...", and the details, the method and the setting to check and Zabbix's own words, go to the log. A rejected token and a Zabbix that does not answer in time are 503, because both mean the data source is not usable right now and not that the portal is at fault; every other failure of the call, a refused connection included, is 502 `zabbix_error`.
3. The AI errors come next: not switched on, 503; busy, 503 with `Retry-After`, because a local model answering someone else is expected under load; and a failure upstream, 502. Their details also go to the log and never to the browser.
4. Email follows the same rule. Email not set up is 503 `mail_disabled`, and a refusal by the mail server is 502 `mail_error` with one fixed sentence for its kind (login, connection, time, TLS, recipients, message, other). What the server said goes to the log, with the login name and the password taken out. The monthly schedule adds two: 503 `schedule_unavailable` where it cannot run on this portal (the message says what to change), and 500 `state_error` when the portal could not save its small state file, with a fixed sentence and the system's own code in the log only.
5. Anything else with a 4xx status, such as malformed JSON, a wrong content type or a body too large, is passed on with its message. Anything else is a bug: it is logged in full, and the browser gets "The portal hit an unexpected error. Tell an administrator and quote reference ..." and never the internal wording.
6. An unknown route is a 404 that names the method and path, without the query string.

It lives in its own module so the tests can exercise it against a bare Fastify instance, since `index.ts` starts a listening server on import. Tests: `ai-errors.test.ts`, `routes.test.ts`, `zabbix.test.ts`, `mail-route.test.ts` and `schedule-route.test.ts`.

### createReadiness

`server/src/http/health.ts`. The cached check of whether Zabbix and the model answer, so that polling health cannot pile calls onto Zabbix.

<!-- gen:snippet server/src/http/health.ts#createReadiness sha=2e3d45b786b0 -->
`server/src/http/health.ts:78-134`

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
3. `check()` runs Zabbix's probe under a limit of two seconds, racing it against a timer. The probe is `host.get` with a limit of one host: the cheapest authenticated read there is (`apiinfo.version` is refused with a token). A probe abandoned on the timeout has its late failure swallowed, since that is not news.
4. The model probe runs beside it. With no model it is `off`. For the hosted provider it is `not_checked`, because a probe would be billed. For a local model it asks `/models` and says `ok` or `down`.
5. The result says `ok` only when Zabbix answered. `warm()` starts the first check at boot so that the first health call finds an answer.

`GET /api/health` always answers 200. A signed-in caller gets this result as `ready`, and anyone else gets only whether it is `ok`, as a plain `true` or `false` (IN-47). `GET /api/ready` answers 503 while it is not `ok`. Tests: `health.test.ts`.

### installShutdown

`server/src/http/shutdown.ts`. Closes the server cleanly on a stop signal, inside the ten seconds Docker allows.

<!-- gen:snippet server/src/http/shutdown.ts#installShutdown sha=6e51a1715a82 -->
`server/src/http/shutdown.ts:38-75`

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
