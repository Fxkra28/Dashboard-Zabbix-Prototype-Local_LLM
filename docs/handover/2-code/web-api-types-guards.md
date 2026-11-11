# Web app: the API client, the types and the guards

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 25 min | [Web app: the shell and the shared code](web-shell-and-shared.md) | [Web app: the pages](web-features.md) |

Everything a page knows about the server goes through three folders. `api/` makes the requests: one method for each endpoint, the deadline of each, and what a 401 or a failed answer becomes. `types/` says what each answer looks like, in one place. `guards/` checks, at run time, that an answer really has that shape before a page reads it, so a server that answers with something unexpected gives a calm error and not a blank page. This chapter walks through the three, and then the part that holds them together: the session.

## The api object

`web/src/api/index.ts` puts the calls of the whole app into one object, `api`, built from ten small ones, one file for each part of the portal: `problems.ts`, `hosts.ts`, `graphs.ts`, `network.ts`, `meters.ts`, `dashboard.ts`, `reports.ts`, `sla.ts`, `assistant.ts` and `shell.ts`. A page and a test that replaces `api` import from `../api` and need not know which file holds a call.

<!-- gen:snippet web/src/api/problems.ts#problemsApi sha=daef9e81d528 -->
`web/src/api/problems.ts:12-21`

```ts
export const problemsApi = {
  problems: () => request<Problem[]>('/api/problems', { guard: problemListGuard }),
  /** The portal's only write. Operator role + ZABBIX_WRITE_TOKEN required. */
  acknowledge: (body: {
    eventids: string[];
    message?: string;
    close?: boolean;
    acknowledge?: boolean;
  }) => post<AcknowledgeResult>('/api/problems/acknowledge', body),
};
```
<!-- /gen -->

<!-- gen:snippet web/src/api/index.ts#api sha=ac3032438019 -->
`web/src/api/index.ts:21-32`

```ts
export const api = {
  ...shellApi,
  ...hostsApi,
  ...problemsApi,
  ...graphsApi,
  ...networkApi,
  ...metersApi,
  ...dashboardApi,
  ...reportsApi,
  ...slaApi,
  ...assistantApi,
};
```
<!-- /gen -->

1. A call is one line: the path, the type the answer is read as, and the guard that checks it. `problems` reads `/api/problems` as a list of `Problem` and hands `problemListGuard` to `request`. `acknowledge` is the portal's only write and goes through `post`.
2. `streamUrl` gives the address of the live stream, `/bff/api/stream`. The browser sends the session cookie with an `EventSource` like any same-origin request, so no token rides in the address.
3. The file ends with a listener on `pageshow`. Back can bring a page out of the browser's back and forward cache exactly as it was left, although the session may have ended since: after a sign-out in another tab, the signed-in page would sit behind the sign-in page. So on a restored page the code asks again. A sign-out goes straight to sign-in. Otherwise the server's 401 does, and another user who signed in meanwhile gets the menus redrawn for them (`AUTH_CHANGED`).
4. `session.ts` does not import this file or the calls. It holds the session and the sign-in, and everything else may use it.

## The transport

`web/src/api/client.ts`. The one place a request leaves the page, the deadline of each, the check of an answer's shape, and what a 401 or a failed reply turns into.

<!-- gen:snippet web/src/api/client.ts#withSignal sha=0bcc643a7308 -->
`web/src/api/client.ts:22-30`

```ts
export function withSignal<T>(signal: AbortSignal | undefined, fn: () => T): T {
  const previous = currentSignal;
  currentSignal = signal;
  try {
    return fn();
  } finally {
    currentSignal = previous;
  }
}
```
<!-- /gen -->

<!-- gen:snippet web/src/api/client.ts#HttpFailure sha=ae21881a5573 -->
`web/src/api/client.ts:37-46`

```ts
export class HttpFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly told: boolean,
  ) {
    super(message);
    this.name = 'HttpFailure';
  }
}
```
<!-- /gen -->

<!-- gen:snippet web/src/api/client.ts#fetchOk sha=770d99be7392 -->
`web/src/api/client.ts:49-70`

```ts
export async function fetchOk(path: string, signal: AbortSignal | undefined): Promise<Response> {
  // Same-origin, so the browser sends the session cookie by itself.
  const res = await fetch(`/bff${path}`, { signal });

  if (res.status === 401) {
    endSession();
    goToSignIn();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    // The BFF returns a typed body for the failures an operator can act on:
    // a rejected Zabbix token, the AI layer off or unreachable. Show that
    // message instead of a bare status code.
    const body = (await res.json().catch(() => null)) as
      | { error?: unknown; message?: unknown }
      | null;
    // Only words count: an empty message or an object would read as a blank or "[object Object]".
    const said = [body?.message, body?.error].find((v): v is string => typeof v === 'string' && v.trim() !== '');
    throw new HttpFailure(said ?? `${path}: HTTP ${res.status}`, res.status, said !== undefined);
  }
  return res;
}
```
<!-- /gen -->

1. `useAsync` cancels a request nobody will read: the page moved to another device, reloaded or closed. Instead of threading a signal through every `api` method, it sets `currentSignal` around its synchronous call to the fetcher, through `withSignal`. `request` reads it before its first `await`, so every request that call starts picks it up. One started later, after an `await`, does not.
2. `fetchOk` is the GET behind every read, JSON or file. A 401 ends the session and goes to sign-in, so a page never has to handle it. Any other failure becomes an `HttpFailure`, which carries the status and `told`, whether the server said why in its own words.
3. The server returns a typed body for the failures an operator can act on, such as a rejected Zabbix token or the AI layer being off, so the message is shown and not a bare status. Only words count: an empty message or an object would read as a blank or "[object Object]". When the server did not speak, as with nginx's 502 page or an empty 504, the message is only the route and the status, which is for a log and not for a person.

<!-- gen:snippet web/src/api/client.ts#request sha=f64a3f45df65 -->
`web/src/api/client.ts:89-121`

```ts
export async function request<T>(
  path: string,
  init: { signal?: AbortSignal; timeoutMs?: number; guard?: Guard<T> } = {},
): Promise<T> {
  const caller = init.signal ?? currentSignal;
  const abort = new AbortController();
  const cancel = () => abort.abort();
  if (caller?.aborted) cancel();
  else caller?.addEventListener('abort', cancel, { once: true });
  const limit = init.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, limit);
  try {
    const res = await fetchOk(path, abort.signal);
    const json = (await res.json()) as T;
    // An answer of the wrong shape becomes the page's ordinary error, not a crash in whatever reads it.
    const body = init.guard ? assertFits(init.guard, json, path) : json;
    // An old copy kept because Zabbix failed is flagged in a header, not the body.
    noteStaleCopy(body, res.headers);
    return body;
  } catch (err) {
    if (timedOut && !caller?.aborted) {
      throw new Error(`No answer from the server within ${Math.round(limit / 1000)} seconds.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener('abort', cancel);
  }
}
```
<!-- /gen -->

<!-- gen:snippet web/src/api/client.ts#post sha=3154f192b54e -->
`web/src/api/client.ts:173-173`

```ts
export const post = <T>(path: string, body: unknown, guard?: Guard<T>, timeoutMs?: number): Promise<T> => write<T>('POST', path, body, guard, timeoutMs);
```
<!-- /gen -->

<!-- gen:snippet web/src/api/client.ts#qs sha=e720a6f6cbcb -->
`web/src/api/client.ts:177-183`

```ts
export const qs = (params: Record<string, string | number | undefined>) => {
  const p = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return p ? `?${p}` : '';
};
```
<!-- /gen -->

1. Every request has a deadline, `REQUEST_TIMEOUT_MS`, 330 seconds. One page took HCML's Zabbix 256 seconds, and without a deadline a stalled request would freeze a page's polling until nginx gave up, with no "refresh failed" note. Explain and the first monthly SLA after a restart are given 450 seconds, below nginx's 480.
2. The deadline is a plain controller joined to the caller's signal, because `AbortSignal.timeout` and `AbortSignal.any` are missing in older browsers. Only a deadline that passed reads as a failure, "No answer from the server within N seconds". A cancel from the caller stays a cancel.
3. The answer is parsed and, when the call named a guard, checked by `assertFits`. A body of the wrong shape becomes the page's ordinary error and not a crash in whatever reads it. Then `noteStaleCopy` records whether the headers say it is an old copy.
4. `post` and `put` are for the writes, and both are one function with the verb as its first argument. Each sends the `X-HCML-CSRF` header, which the server refuses a cookie POST without, and turns a failure into an error whose text is the server's message. It has the deadline of a read, 330 seconds, unless the caller names another: the email is given 450, as long as a download, because the server builds the report before it sends. A timeout says that the change may have been made, because the server can finish after the page gave up and a person who sent it again would do it twice. A write may name a guard too, as a read does: the answer to saving the schedule is the schedule as it now stands, and is checked the same way.
5. `qs` builds a query string from an object and leaves out a value that is undefined or empty, and encodes the rest.

Tests: `requestTimeout.test.ts` and `guardedReads.test.tsx`.

## The session

`web/src/api/session.ts`. The token itself lives in an httpOnly cookie that no script on the page can read, and the browser sends it with every same-origin request. What the page keeps is when the session ends, by its own clock, from the `expiresIn` that the server gives with each sign-in, renewal and `/api/auth/me`.

<!-- gen:snippet web/src/api/session.ts#recordSession sha=57d641c67a2d -->
`web/src/api/session.ts:53-59`

```ts
export function recordSession(expiresIn: unknown, user?: { name: string; role: string } | null): void {
  if (typeof expiresIn === 'number' && expiresIn > 0) {
    session = { endsAt: Date.now() + expiresIn * 1000, lifeMs: expiresIn * 1000 };
    signedOut = false;
  }
  if (user) lastUser = { name: user.name, role: user.role };
}
```
<!-- /gen -->

<!-- gen:snippet web/src/api/session.ts#goToSignIn sha=8024facf2117 -->
`web/src/api/session.ts:111-116`

```ts
export function goToSignIn(): void {
  // Every refused session and every sign-out in another tab ends here: the Assistant's conversation goes with it.
  clearConversation();
  if (location.pathname === '/login') return;
  location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}
```
<!-- /gen -->

<!-- gen:snippet web/src/api/session.ts#doRenew sha=e7414ff3969f -->
`web/src/api/session.ts:133-167`

```ts
async function doRenew(): Promise<'renewed' | 'failed' | 'signed-out'> {
  if (signedOut || signingOut > 0) return 'signed-out';
  type Renewed = { user?: { name: string; role: string }; expiresIn?: unknown };
  let res: Response;
  let body: Renewed | null = null;
  // A request that never answers would hold renewal up until the session ran
  // out (nginx waits up to an hour): give up and let the retry take over. A
  // plain controller, since AbortSignal.timeout is missing before Chrome 103 and Safari 16.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30_000);
  try {
    res = await fetch('/bff/api/auth/refresh', { method: 'POST', headers: CSRF, signal: abort.signal });
    if (res.ok) body = (await res.json().catch(() => null)) as Renewed | null;
  } catch {
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
  if (signedOut) return 'signed-out';
  if (res.status === 401) {
    // Refused: stop renewing until a sign-in, here or in another tab.
    signedOut = true;
    session = null;
    goToSignIn();
    return 'signed-out';
  }
  if (typeof body?.expiresIn !== 'number' || !body.user) return 'failed';
  const was = lastUser;
  recordSession(body.expiresIn, body.user);
  if (was && (was.role !== body.user.role || was.name !== body.user.name)) {
    userOrRoleChanged();
    announce('changed');
  }
  return 'renewed';
}
```
<!-- /gen -->

1. `recordSession` stores the end as a time on this page's own clock, and remembers the user so a renewal can tell when the role changed. `sessionTiming` gives that to `useSessionRenewal`.
2. `goToSignIn` goes to `/login?next=...`, remembering the page to come back to, so a wall screen returns to its wall mode and a filtered list to its filters. It also clears the Assistant's conversation, because every refused session and every sign-out in another tab ends here, and the next person must not read it.
3. `doRenew` posts to `/api/auth/refresh` with a 30-second deadline, since a request that never answered would hold renewal up until the session ran out. It is not started while a sign-out request is out (`signingOut`). It gives one of three answers. `signed-out` when the server refused it with a 401, with the page already on its way to sign-in, or when the user signed out meanwhile. `failed` when the server did not answer, which is worth another try. `renewed` otherwise. When the user or the role changed, `userOrRoleChanged` tells the parts of the page that keep something for one person, fires `AUTH_CHANGED` for the menus, and the other tabs are told too.
4. Tabs share the cookie but not this module. A `BroadcastChannel` named `hcml-auth` tells the others when the session changes hands: a sign-out in one tab sends the rest to sign-in, and a sign-in or a change of role makes them ask again. Where `BroadcastChannel` is missing, before Safari 15.4, each tab finds out at its next request.
5. A renewal on its way would set the cookie again after a sign-out cleared it. So `logout` waits for a renewal in flight (`renewing`) before it tells the server, and a tab that hears a sign-out clears the cookie once more when its own renewal lands.
6. `onSessionChange` lets a part of the page that keeps something for one person drop it when the person changes. It runs at a sign-in, at a sign-out, at a change of role, when another tab reports one and when a page comes back from the browser's back and forward cache under another person. A listener that throws is logged and does not stop the others or the sign-out. The item picker's list of a host, which the server cuts by role, is dropped this way.

<!-- gen:snippet web/src/api/session.ts#login sha=a0d5389cd288 -->
`web/src/api/session.ts:170-189`

```ts
export async function login(username: string, password: string) {
  const res = await fetch('/bff/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...CSRF },
    body: JSON.stringify({ username, password }),
  });
  // Only a 401 means the credentials were wrong: a 429 (rate limit) or a BFF that is down must not
  // read as "Invalid credentials".
  if (res.status === 401) throw new Error('Invalid username or password.');
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new Error(b?.message ?? `Sign-in failed (HTTP ${res.status}). The portal is not answering. Try again, or tell the portal admin.`);
  }
  const data = (await res.json()) as { user: { name: string; role: string }; expiresIn: number };
  recordSession(data.expiresIn, data.user);
  startConversation(); // a sign-in starts a conversation of its own, whoever was here before
  sessionChanged();
  announce('signed-in');
  return data.user;
}
```
<!-- /gen -->

<!-- gen:snippet web/src/api/session.ts#logout sha=d72c365eca23 -->
`web/src/api/session.ts:211-226`

```ts
export async function logout(): Promise<void> {
  signingOut++;
  try {
    await renewing?.catch(() => undefined);
    await postLogout();
  } finally {
    signingOut--;
  }
  // The next person at this workstation must not read the conversation. Only now: a sign-out that failed leaves the page as it was.
  clearConversation();
  signedOut = true;
  session = null;
  lastUser = null;
  sessionChanged();
  announce('signed-out');
}
```
<!-- /gen -->

1. `login` posts the name and password and sets nothing itself: the server sets the cookie, and the answer names the user and how long the session lasts. Only a 401 means the credentials were wrong. A 429 from the rate limit, or a server that is down, must not read as "Invalid username or password", so each gets its own message. A sign-in also starts a conversation of its own for the Assistant, whoever was here before.
2. `logout` holds renewals back while a sign-out request is out (`signingOut` counts the requests, so two presses overlap safely), waits for a renewal in flight and calls the server, which it gives 30 seconds. Only when the server has answered does it clear the Assistant's conversation, count the page as signed out and tell the other tabs. If the request fails or gets no answer, the cookie still works, so the page stays signed in, keeps its conversation, keeps renewing and passes the error to the caller, which says so.
3. Older builds kept the token in `localStorage`. The module removes that key when it loads, since it would still work as a bearer token until it ended, and nothing reads it now.

## The types

`web/src/types/` holds what each answer looks like, one file for each part of the portal and an `index.ts` that re-exports them all, so a page writes one import. They are hand-written, because the browser reads the answers and a type says what the page relies on.

<!-- gen:snippet web/src/types/problems.ts#Problem sha=5f8140bb0d49 -->
`web/src/types/problems.ts:3-20`

```ts
export interface Problem {
  eventid: string;
  objectid: string;
  object: string;
  name: string;
  severity: string; // '0'..'5'
  clock: string;
  r_eventid?: string; // '0' when still open
  r_clock?: string;
  acknowledged: string; // '0' | '1'
  suppressed?: string;
  opdata?: string;
  tags?: { tag: string; value: string }[];
  host?: string;
  hostid?: string;
  /** Whether the trigger permits manual close, gates the Close option (§20). */
  manualClose?: boolean;
}
```
<!-- /gen -->

1. A field that Zabbix sends as text stays text: `severity` is `'0'` to `'5'` and `acknowledged` is `'0'` or `'1'`. The page converts at the place it needs a number. A field the server may leave out is marked optional, and `manualClose` is the one that gates the Close option in the dialog.
2. The server describes the same answers in `docs/api/openapi.yaml`, and `web/src/generated/openapi.ts` is made from that file by `npm run gen:api`. `openapiTypes.test.ts` holds the hand-written types and the generated ones apart. At compile time, every answer the app reads is checked against the file: what the file says an answer can be has to be something the app's type accepts, and `npm run typecheck` fails otherwise. At run time, every `request` call in `api/` must have an entry in the test's table, and the generated file must be current.
3. The comparison is one way, on purpose. A field that the file lists and the app ignores is fine. What fails is a field the app needs and the file does not promise.

## The guards

`web/src/guards/`. A hand-written check that an answer has the shape a page relies on. The shapes stay in `types/`, the one source: each shape is typed `Shape<T>`, which makes the compiler ask for every field of `T`. A field added to a type, or dropped from one, is a build error in the guard and not a blank page in the browser.

<!-- gen:snippet web/src/guards/shape.ts#shape sha=3ba096ef3887 -->
`web/src/guards/shape.ts:71-80`

```ts
export const shape =
  <T>(fields: Shape<T>): Check =>
  (v) => {
    if (!isObject(v)) return bad(v, 'an object');
    for (const [key, check] of Object.entries<Check>(fields)) {
      const m = check(v[key]);
      if (m) return under(key, m);
    }
    return null;
  };
```
<!-- /gen -->

<!-- gen:snippet web/src/guards/shape.ts#listOf sha=f013a2b8311f -->
`web/src/guards/shape.ts:48-57`

```ts
export const listOf =
  (item: Check): Check =>
  (v) => {
    if (!Array.isArray(v)) return bad(v, 'a list');
    for (let i = 0; i < v.length; i++) {
      const m = item(v[i]);
      if (m) return under(`[${i}]`, m);
    }
    return null;
  };
```
<!-- /gen -->

<!-- gen:snippet web/src/guards/shape.ts#guard sha=f054ffaab53c -->
`web/src/guards/shape.ts:91-99`

```ts
export function guard<T>(what: string, check: Check): Guard<T> {
  return {
    what,
    misfit: (value) => {
      const m = check(value);
      return m ? `${m.path || 'the answer'} ${m.why}` : null;
    },
  };
}
```
<!-- /gen -->

<!-- gen:snippet web/src/guards/problems.ts#problem sha=7c6d5ad71e9d -->
`web/src/guards/problems.ts:6-22`

```ts
const problem = shape<Problem>({
  eventid: text,
  objectid: text,
  object: text,
  name: text,
  severity: text,
  clock: text,
  r_eventid: opt(text),
  r_clock: opt(text),
  acknowledged: text,
  suppressed: opt(text),
  opdata: opt(text),
  tags: opt(listOf(tag)),
  host: opt(text),
  hostid: opt(text),
  manualClose: opt(flag),
});
```
<!-- /gen -->

1. A `Check` takes a value and returns null when it fits, or a `Misfit` with a path and a reason. The small ones are `text`, `num`, `flag`, `opt` (a key that may be left out), `orNull`, `listOf` (every item passes), `recordOf` (every value of an object passes) and `lazy` (for a service tree, which is as deep as the estate's groups).
2. `shape<T>(fields)` checks an object field by field and reports the first that is wrong, with its path, such as `[3].tags[0].value is missing`. What is checked is the type's own claim: a required field is there and has the right kind, an optional one has the right kind when it is there, and an object may carry more than it names. The values behind a union such as a host state are checked only as text, so a state that a newer server adds reads as no state and does not fail the page.
3. `guard(what, check)` makes the object a call hands to `request`. `what` is how the answer is called to a person, "the problem list", and `misfit` gives the first thing wrong, for a log.
4. The guard of the problem list is also used for each `problems` frame of the live stream, through the fourth argument of `useSSE`.

<!-- gen:snippet web/src/guards/misfit.ts#assertFits sha=c818cdc169ea -->
`web/src/guards/misfit.ts:36-41`

```ts
export function assertFits<T>(guard: Guard<T>, body: unknown, path: string): T {
  const detail = guard.misfit(body);
  if (detail === null) return body as T;
  noteMisfit(path, detail);
  throw new UnreadableAnswer(path, guard.what, detail);
}
```
<!-- /gen -->

<!-- gen:snippet web/src/guards/misfit.ts#noteMisfit sha=46f0b69880e3 -->
`web/src/guards/misfit.ts:27-33`

```ts
export function noteMisfit(source: string, detail: string): void {
  const line = `${source}: ${detail}`;
  // Capped, so a list that differs at every row cannot fill the console or grow this set for ever.
  if (told.has(line) || told.size >= 50) return;
  told.add(line);
  console.warn(`The portal's answer did not match what the page expects. ${line}`);
}
```
<!-- /gen -->

1. `assertFits` returns the body itself when it fits, and throws an `UnreadableAnswer` when it does not. The page shows that as its ordinary error: "The portal sent back the problem list in a form this page cannot read. Try again in a minute, or tell the portal admin." The message does not say Zabbix, or the error state would add its hint about reaching Zabbix, which is not the fault.
2. The detail, the path and the reason, goes to the console, once. A bad answer repeats on every poll, so `noteMisfit` remembers each line, and stops remembering at 50, so a list that differs at every row cannot fill the console or grow the set for ever.
3. `guards/index.ts` re-exports every guard, so `api/` imports from `../guards` and does not need to know which file holds a name. One file holds the checks for each part of the portal: `problems`, `hosts`, `graphs`, `network`, `meters`, `dashboard`, `reports`, `sla`, `assistant` and `auth`.

Tests: `guards.test.ts` holds the first guards and the stream, `guardsData.test.ts` holds the rest. For each guard it proves three things: a complete answer passes, every field is checked at all (which a guard that left a field to `any` would not be), and what the type makes required is required while what it makes optional is optional, which the compiler cannot say.
