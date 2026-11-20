# Web app: the shell and the shared code

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 45 min | [The folders of the web app](../1-folders/web.md) | [Web app: the API client, the types and the guards](web-api-types-guards.md) |

The web app is React with TypeScript, built by Vite into static files, and served by nginx. It talks to one address only, `/bff`, which nginx passes to the server, so the browser never sees Zabbix. There is no state library and no data library. The parts every page leans on are a few small hooks and components, and this chapter walks through them: how the page starts, how a page loads data and keeps it fresh, how it follows a live stream, how it knows who is signed in, how it keeps its state in the address, and what it says when the data is old or failed.

## How the page starts

`web/src/main.tsx` starts the app in three lines of work, in this order. It installs `reloadOnStaleChunks`, which is explained below. It starts `loadCapabilities`, a public and cheap read that learns the server's time zone before any page labels a time in it. Then it renders `App` inside React's `StrictMode`. `App.tsx` holds the route table.

### AppRoutes

`web/src/App.tsx`. Every page is its own chunk.

<!-- gen:snippet web/src/App.tsx#AppRoutes sha=17d76b51a8ab -->
`web/src/App.tsx:41-79`

```tsx
export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <Suspense fallback={<Loading label="Loading…" />}>
            <Login />
          </Suspense>
        }
      />
      {/* The Suspense boundary lives inside Layout, around <Outlet />, so the
          sidebar and topbar stay painted while a page chunk loads. */}
      <Route element={<Layout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/problems" element={<Problems />} />
        <Route path="/sites" element={<Sites />} />
        <Route path="/hosts" element={<Hosts />} />
        <Route path="/devices" element={<Devices />} />
        <Route path="/graphs" element={<HostDetail />} />
        <Route path="/latest" element={<LatestData />} />
        <Route path="/maps" element={<Maps />} />
        <Route path="/network" element={<Network />} />
        <Route path="/links" element={<Links />} />
        <Route path="/services" element={<Services />} />
        <Route path="/sla" element={<Sla />} />
        <Route path="/reports/availability" element={<AvailabilityRedirect />} />
        <Route path="/reports/capacity" element={<Capacity />} />
        <Route path="/reports/noise" element={<AlertNoise />} />
        <Route path="/reports/top-triggers" element={<TopTriggers />} />
        <Route path="/reports/inventory" element={<Inventory />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/users" element={<Users />} />
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
```
<!-- /gen -->

1. Importing every page at the top would make one chunk of about 1.3 MB, and opening the Dashboard would download the charting library for the two pages that draw graphs and the report code for pages most viewers never open. So each page is loaded with `lazy` and fetched on its first visit.
2. The sign-in page is lazy too, but it sits outside `Layout`, since it is the one page a visitor who is not signed in reaches and it should not carry the rest with it.
3. The `Suspense` boundary is inside `Layout`, around the outlet, so the sidebar and the top bar stay painted while a page's chunk loads.
4. `AppRoutes` is a separate export from `App` so a test can mount the route table in a memory router, without the browser router. `routes.test.tsx` does so.
5. The Users page and the account page are two more lazy routes inside `Layout`. The route table does not keep a person away from a page they do not have: `Layout` shows a page that says so, because the server refuses that page's data anyway.

### Layout

`web/src/features/shell/Layout.tsx`. The frame around every page: the skip link, the sidebar, the top bar and the main area.

<!-- gen:snippet web/src/features/shell/Layout.tsx#Layout lines=2-33 sha=0a6b57c54a90 -->
`web/src/features/shell/Layout.tsx:35-66` (lines 2 to 33 of Layout)

```tsx
const { pathname } = useLocation();
const navigationType = useNavigationType();
const navigate = useNavigate();
const { me, role, pages } = useAuth();
// The form that a temporary password forces is swapped for the page in the same render as the answer, so the words that say the password was changed are kept here (UX-71).
const [passwordChanged, setPasswordChanged] = useState(false);
const title = titleFor(pathname) ?? 'Page not found';
// A page of the menu that this user does not have (ADR-0017): the server refuses its data too, so it says so instead of drawing a page of refusals.
const key = keyOf(pathname);
const denied = pages !== null && key in PAGE_TITLES && !(key in pages);
const firstPage = pages ? Object.keys(PAGE_TITLES).find((p) => p in pages) : undefined;
usePageTitle(title);

// The route the session landed on, which decides the sidebar's first width.
const landing = useRef(pathname).current;

// After a link in the content, or Back, the control that was pressed has left with the old page and focus would fall to the body: the next Tab would start at the skip link again, and a
// screen reader would hear nothing of the new page. So focus goes to the main area, on a change of page and not on the first one or on a change of the address's query (UX-80).
// The password was just changed: the page that opens now is where the person goes on from, and the words above it are read (UX-71).
const noticeUp = passwordChanged && !me?.mustChange;
useEffect(() => {
  if (!noticeUp) return;
  focusMain();
  const id = setTimeout(() => setPasswordChanged(false), 10_000);
  return () => clearTimeout(id);
}, [noticeUp]);
const shownPath = useRef(pathname);
useEffect(() => {
  if (shownPath.current === pathname) return;
  shownPath.current = pathname;
  // A redirect replaces the address: it is the first page being found, not a move the person made, and the first Tab must still reach the skip link.
  if (navigationType === 'REPLACE') return;
```
<!-- /gen -->

1. `titleFor`, a small function above `Layout`, finds the page's menu name from the address, ignoring case and a trailing slash as the router does, and the title is shown in the top bar and set as the browser tab's name (`usePageTitle`). An address that is not a page is "Page not found".
2. The sidebar's first width is decided once, from the route the session landed on, and not again on later navigation: the Dashboard starts as a rail because it is the route meant for a wall, and moving the sidebar under someone who never touched it would be rude. A stored choice always wins, and a narrow screen forces the rail.
3. `useSessionRenewal` keeps an open page signed in, when sign-in is on. `useWallMode` reads `?wall=1` from the address. When wall mode starts or ends, the button that was pressed has left the page with the chrome around it, so focus is sent to the main area, or back to the button, unless it has already gone somewhere on its own. After a change of page, and not on the first one, a redirect (which replaces the address: it is the first page being found, and the first Tab must still reach the skip link) or a change of the address's query, focus goes to the main area too, since the control that was pressed has left with the old page (UX-80). When Check again on the notice of a page the account lacks brings the page, focus goes to the main area as well, since the button that was pressed has gone with the notice. `useAccessWatch` and the `onRenewed` of `useSessionRenewal` ask for the account again, so a change of pages reaches the open page (FR-70), and after a forced password change the shell shows "Your password was changed." above the page and focuses it (UX-71).
4. `signOut` calls `logout`, which also tells the other tabs, and moves on to the sign-in page only once the server has answered. While the request is out the button reads "Signing out..." and ignores a second press. It is marked `aria-disabled` and not `disabled`, because a disabled button drops the focus it holds, and after a failed sign-out a keyboard user would have had to find it again (UX-61). When the sign-out did not get through, the page stays, says "Sign-out did not reach the portal. You are still signed in. Try again." beside the button, and the person can press it again.
5. `useTopBarHeight` keeps the custom property `--topbar-h` at the measured height of the top bar, which the stylesheet's `scroll-padding-top` reads, so a bar that wraps onto a second row on a narrow window or at high zoom never covers a control reached with the keyboard (UX-51). It takes the property away in wall mode, where there is no bar.
6. In the markup that follows the quoted lines, the first Tab stop is a "Skip to content" link, so a keyboard user passes up to 21 sidebar stops to reach the page (WCAG 2.4.1). In wall mode the sidebar, the top bar and the link are not drawn. The main area holds `ErrorBoundary` keyed by the path, and `Suspense`, around the outlet.
7. `Layout` also looks at the person's pages. An address of the menu that the account does not have shows `NoAccess`, with a link to the first page it does have and a Check again button (the alert is the sentence that says what is wrong, and the answer of the button is beside it, since an alert is read again whole when anything in it changes), and the Dashboard's own address sends the person to that first page instead. A temporary password shows the form for a new password (`ChangePassword`, forced) in place of every page. The role chip in the top bar and the link to the account page follow `me`.

### ErrorBoundary and reloadOnStaleChunks

`web/src/features/shell/ErrorBoundary.tsx`. Two protections against a page that cannot be shown.

<!-- gen:snippet web/src/features/shell/ErrorBoundary.tsx#ErrorBoundary sha=39c29ecbc06b -->
`web/src/features/shell/ErrorBoundary.tsx:8-40`

```tsx
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="panel">
        {/* An alert, so a screen reader says the page broke (UX-55). The engine's own words are for an administrator, and kept closed. */}
        <div className="state error" role="alert">
          <div className="state-title">This page hit an error</div>
          <div className="state-hint">The page could not be drawn.</div>
          <details className="state-hint">
            <summary>Technical detail</summary>
            <div className="mono state-detail">{error.message || String(error)}</div>
          </details>
          <div className="muted state-hint">Other pages still work. Reloading fetches the latest version of the portal.</div>
          <button className="btn state-action" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
```
<!-- /gen -->

<!-- gen:snippet web/src/features/shell/ErrorBoundary.tsx#reloadOnStaleChunks sha=59a2605a1fb3 -->
`web/src/features/shell/ErrorBoundary.tsx:50-80`

```tsx
export function reloadOnStaleChunks(): void {
  // True while this page load is itself that reload (or one is under way).
  let reloaded = false;
  try {
    reloaded = sessionStorage.getItem(RELOADED_KEY) !== null;
  } catch {
    /* storage blocked: the guard lasts for this page only */
  }
  if (reloaded) {
    window.setTimeout(() => {
      reloaded = false;
      try {
        sessionStorage.removeItem(RELOADED_KEY);
      } catch {
        /* ignore */
      }
    }, 30_000);
  }

  window.addEventListener('vite:preloadError', (event) => {
    if (reloaded) return; // let the error reach the page's error card
    reloaded = true;
    try {
      sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    event.preventDefault();
    window.location.reload();
  });
}
```
<!-- /gen -->

1. `ErrorBoundary` catches a page that throws while rendering, so one broken view shows an error card inside the layout and does not blank the portal with its sidebar. `Layout` keys it by the path, so leaving the crashed page starts clean. The card is an alert, so a screen reader says that the page broke, and it says it in plain words: the engine's own message is for an administrator and sits in a closed "Technical detail" (UX-55).
2. After a deploy, a tab opened earlier asks for page chunks that no longer exist, and Vite reports `vite:preloadError`. `reloadOnStaleChunks` reloads the page once to pick up the new build. A flag in the session storage stops a loop when the chunk is missing for another reason, and it clears after 30 seconds, so a later deploy can reload again.

Tests: `mainZone.test.tsx`.

## Loading data: useAsync

`web/src/shared/hooks/useAsync.ts`. Every page that reads the server uses it. It fetches, polls, and keeps what is already on screen while a new selection loads.

<!-- gen:snippet web/src/shared/hooks/useAsync.ts#useAsync lines=35-75 sha=810129290205 -->
`web/src/shared/hooks/useAsync.ts:82-122` (lines 35 to 75 of useAsync)

```ts

/** Arm the next poll, counted from when the last run settled. */
const schedule = () => {
  stopTimer();
  const every = latest.current.intervalMs;
  if (!every || !mounted || current || document.visibilityState === 'hidden') return;
  timer = window.setTimeout(() => start(false), Math.max(0, settledAt + every - Date.now()));
};

const start = (depsChanged: boolean, deps = latest.current.deps) => {
  stopTimer();
  current?.controller.abort();
  const run: Run = { id: ++seq, controller: new AbortController(), deps };
  current = run;
  if (depsChanged) setSnap((s) => ({ ...s, loading: true, error: null, stale: s.data !== null }));

  let promise: Promise<T>;
  try {
    promise = withSignal(run.controller.signal, () => latest.current.fn(run.controller.signal));
  } catch (err) {
    promise = Promise.reject(err);
  }
  promise
    .then(
      (data) => {
        if (current !== run) return;
        setSnap({ data, error: null, loading: false, stale: false, updatedAt: serverNow(), retryable: true });
      },
      (err: unknown) => {
        // An aborted run was replaced or dropped on purpose, not a failure to show.
        if (current !== run || run.controller.signal.aborted) return;
        const message = String((err as { message?: unknown } | null)?.message ?? err);
        setSnap((s) => ({ ...s, error: message, loading: false, retryable: !refusedOutright(err) }));
      },
    )
    .finally(() => {
      if (current !== run) return;
      current = null;
      settledAt = Date.now();
      schedule();
    });
```
<!-- /gen -->

<!-- gen:snippet web/src/shared/hooks/useAsync.ts#useAsync lines=77-100 sha=810129290205 -->
`web/src/shared/hooks/useAsync.ts:124-147` (lines 77 to 100 of useAsync)

```ts

/** The deps effect: fetch for these `deps`, and let go of the run on cleanup. */
const attach = (deps: unknown[]) => {
  mounted = true;
  const rehearsal = dropping !== undefined;
  window.clearTimeout(dropping);
  dropping = undefined;
  // React's StrictMode (dev only) unmounts and remounts every component
  // once. Keep the request already running for the same deps rather than
  // aborting it and asking again.
  if (!(rehearsal && current && sameDeps(current.deps, deps))) start(true, deps);

  return () => {
    mounted = false;
    stopTimer();
    const run = current;
    if (!run) return;
    dropping = window.setTimeout(() => {
      dropping = undefined;
      if (current !== run) return;
      current = null;
      run.controller.abort();
    });
  };
```
<!-- /gen -->

1. `useAsync(fn, deps, intervalMs)` returns `data`, `error`, `loading`, `stale`, `updatedAt`, `retryable` and `reload`. A change in `deps` runs the fetch again, and `intervalMs` polls. `updatedAt` is on the server's clock (`serverNow`, FR-74). `retryable` is false for a refusal of the request itself, a 400 to 499 other than 408, 429 and 499, because asking again would get the same refusal (FR-68).
2. Only the most recent run may write state. Without that, a slow answer for an old selection could overwrite a fast one for the new selection: pick host A and then host B, and host A's items land last and stay on screen. `start` makes a run, aborts the run before it, and each `then` checks `current !== run` first.
3. A run that is replaced, or whose component unmounts, is aborted. `fn` may take the signal, and every `api` call it makes in its first synchronous stretch gets it anyway, through `withSignal` in the API client.
4. Polls are one after another: `schedule` arms the next only once the last has settled, counted from when it settled, so a slow server is never asked twice at once. They pause while the tab is hidden and catch up on return if one came due.
5. While new `deps` load, the previous data stays with `stale: true`, so a page can dim it and not blank it. A failed poll keeps the last good data and sets `error`, which the page shows as a note.
6. `reload` reads again with the same `deps`. When what is on screen is a failure with nothing of its own beside it (a first load that failed, or a new selection that failed over the old data), it clears that failure and shows the loading state at once, so that a Try again button visibly does something and not nothing until the answer lands. A failed refresh that still has its own data keeps its note until the next answer (UX-49).
7. `attach` is the effect for `deps`. React's `StrictMode` unmounts and remounts every component once in development, so on a remount with the same `deps` it keeps the request already running and does not abort and ask again.

Tests: `useAsync.test.ts`.

## Live data: useSSE

`web/src/shared/hooks/useSSE.ts`. Follows one named event of a server-sent event stream, which the Dashboard and the Problems page use for the problem list. It returns the latest payload, when it arrived, whether the line is connected, and the last error. Each thing it handles would otherwise fail silently.

<!-- gen:snippet web/src/shared/hooks/useSSE.ts#useSSE lines=16-38 sha=eca9c86ac1ac -->
`web/src/shared/hooks/useSSE.ts:62-84` (lines 16 to 38 of useSSE)

```ts
// Jittered so a room of wall screens does not reconnect in step.
const reopenLater = () => {
  if (retry || document.visibilityState === 'hidden') return;
  const ceiling = Math.min(60_000, 2_000 * 2 ** attempt++);
  retry = setTimeout(() => {
    retry = null;
    if (!es) open();
  }, ceiling / 2 + Math.random() * (ceiling / 2));
};

// Re-armed by every frame, error frames included: they prove the line is alive.
const watch = (source: EventSource) => {
  if (!silentMs) return;
  if (quiet) clearTimeout(quiet);
  quiet = setTimeout(() => {
    if (es !== source) return;
    source.close();
    es = null;
    haveList = false;
    setConnected(false);
    reopenLater();
  }, silentMs);
};
```
<!-- /gen -->

<!-- gen:snippet web/src/shared/hooks/useSSE.ts#useSSE lines=60-91 sha=eca9c86ac1ac -->
`web/src/shared/hooks/useSSE.ts:106-137` (lines 60 to 91 of useSSE)

```ts
// Both a server-sent `event: error` frame and a dropped connection arrive
// here. Only the frame carries data.
source.onerror = (e) => {
  const raw = (e as MessageEvent).data;
  setConnected(false);
  haveList = false;
  if (typeof raw === 'string') {
    watch(source);
    try {
      setError((JSON.parse(raw) as { message?: string }).message ?? 'The live stream reported an error.');
    } catch {
      setError('The live stream reported an error.');
    }
    return;
  }
  // The page cannot see the httpOnly cookie, so it asks; with auth off
  // the answer is always yes. It asks what the account may open, so that a page taken away
  // from the person, which is also why the server ended the stream, is found out now.
  if (!checkingAuth) {
    checkingAuth = true;
    void recheckAccess().finally(() => {
      checkingAuth = false;
    });
  }
  // CONNECTING means the browser is already retrying; CLOSED means it gave up.
  if (source.readyState === EventSource.CLOSED) {
    if (es === source) es = null;
    reopenLater();
  }
};

source.addEventListener(event, (e) => {
```
<!-- /gen -->

<!-- gen:snippet web/src/shared/hooks/useSSE.ts#useSSE lines=93-116 sha=eca9c86ac1ac -->
`web/src/shared/hooks/useSSE.ts:139-162` (lines 93 to 116 of useSSE)

```ts
      const frame: unknown = JSON.parse((e as MessageEvent).data);
      const misfit = guard?.misfit(frame) ?? null;
      if (guard && misfit !== null) {
        // The line is alive (so it is watched), but what it carried cannot be shown.
        noteMisfit(`the ${event} frame of ${url}`, misfit);
        watch(source);
        haveList = false;
        setConnected(false);
        setError(unreadableMessage(guard.what));
        return;
      }
      setData(frame as T);
      watch(source);
      attempt = 0;
      haveList = true;
      setUpdatedAt(serverNow());
      setConnected(true);
      setError(null);
    } catch {
      /* ignore malformed frame */
    }
  });
};

```
<!-- /gen -->

1. A line can stay open and go quiet. With `silentMs` (both pages pass `STREAM_SILENT_MS`, 45 seconds, three missed keep-alives), `watch` is re-armed by every frame. When it fires, the stream is closed, reported as not connected so that the page polls, and reopened.
2. `reopenLater` backs off from 2 seconds to 60, and is jittered, so a room of wall screens does not reconnect in step. A reply that is not an event stream, such as nginx's 502 while the server restarts, makes `EventSource` give up for good, which is why a closed stream is reopened by hand.
3. `EventSource` cannot see an HTTP status, so an expired session would reconnect with the same dead credential every few seconds for ever. On a dropped connection one call to `recheckAccess`, which asks `/api/auth/me`, settles it: `request` turns a 401 into a sign-out, and an answer that names other pages than the ones the page holds reaches every open page at once, since the server also ends a person's streams when their pages change (SC-57, FR-70). A server `event: error` frame arrives in the same handler, and only the frame carries data, so the hook shows the message and stays not connected, and the badge does not keep saying "Live" over data that has stopped.
4. A frame is parsed and, when the hook was given a `guard`, checked. A frame of the wrong shape is not shown. It is reported through `noteMisfit` and the page falls back to polling until a good frame arrives.
5. The server does not resend a list that has not changed. The `ping` event carries the list's age, and `updatedAt` follows it, on the server's clock (`serverNow`, FR-74), so a quiet estate still reads as current and the page does not call a steady line "no new data". A hidden tab closes the stream and reopens it on return, and `connected` keeps its last value meanwhile.

Tests: `useSSE.test.ts`.

## Who is signed in

### useAuth

`web/src/shared/hooks/useAuth.ts`. One shared probe of `/api/auth/me` that every page reads through the hook.

<!-- gen:snippet web/src/shared/hooks/useAuth.ts#roleAllows sha=37c30c27167c -->
`web/src/shared/hooks/useAuth.ts:15-16`

```ts
export const roleAllows = (has: Role | null, needs: Role) =>
  has !== null && RANK[has] >= RANK[needs];
```
<!-- /gen -->

<!-- gen:snippet web/src/shared/hooks/useAuth.ts#useAuth lines=16-48 sha=88d0f0acc560 -->
`web/src/shared/hooks/useAuth.ts:89-121` (lines 16 to 48 of useAuth)

```ts
let alive = true;
let timer: ReturnType<typeof setTimeout> | undefined;
let delay = 5_000;

// A 401 never lands here (request() signs the user out), so null means the BFF did not answer:
// a restart or a 502. Caching that for the whole tab would hide Sign out, the role menus and
// Acknowledge until a reload (useAi had the same bug), so a failure is forgotten and asked
// again, backing off.
const load = () => {
  probe ??= api.me().catch(() => {
    probe = null;
    return null;
  });
  void probe.then((v) => {
    if (!alive) return;
    if (v) held = v;
    setMe(v);
    setLoading(false);
    if (v === null) {
      timer = setTimeout(load, delay);
      delay = Math.min(delay * 2, 60_000);
    }
  });
};
load();
// A renewal, or another tab's sign-in, brought a different user or role:
// ask again, so the menus and the role chip follow what the BFF now enforces.
const onChange = () => {
  clearTimeout(timer);
  delay = 5_000;
  load();
};
window.addEventListener(AUTH_CHANGED, onChange);
```
<!-- /gen -->

1. `roleAllows` uses the same ranks as the server: guest 1, operator 2 and admin 3. With sign-in off the server says the role is admin, so nothing in the web app special-cases an unauthenticated page. `hasModule` and `can` say whether the person holds a page of the menu: an administrator holds every one, and a server that does not say which pages a person has is taken to allow them, because it still refuses what the person may not read.
2. The probe is kept in a module-level promise, so any number of components share one request. A 401 never reaches the hook, because `request` signs the user out first, so a null answer means the server did not answer: a restart, or a 502. Caching that for the whole tab would hide Sign out, the role menus and Acknowledge until a reload, so a failure is forgotten and asked again, backing off from 5 seconds to a minute.
3. A renewal, or another tab's sign-in, can bring a different user or role. The `AUTH_CHANGED` event makes the hook ask again, so the menus and the role chip follow what the server now enforces. The answer also carries `pages`, the pages this person has with the role each needs, and `modules`, so the sidebar keeps no list of its own. `recheckAccess` asks again on purpose (FR-70): an administrator who gives or takes away a page changes what the server allows at once, but a page held the list it fetched at load. A different answer for the same person raises `ACCESS_CHANGED`, which every hook takes (`accessKey` compares the role, the pages, the modules and `mustChange`), and an answer for another person behind the cookie also clears what the pages keep for one person. `useAccessWatch` calls it when a tab is shown or focused, at most once a minute, and every ten minutes while it stays in view.

Tests: `useAuth.test.tsx`.

### useSessionRenewal

`web/src/features/shell/useSessionRenewal.ts`. Keeps an open portal signed in, for every user, for as long as the page stays open. A closed tab renews nothing, and neither does a machine that slept past the session.

<!-- gen:snippet web/src/features/shell/useSessionRenewal.ts#useSessionRenewal lines=11-49 sha=1a23ebe437de -->
`web/src/features/shell/useSessionRenewal.ts:40-78` (lines 11 to 49 of useSessionRenewal)

```ts
let retry = RETRY_MS;
// No attempt before this: the gap after a renewal, or the backoff after a failure.
let notBefore = 0;

const dueIn = () => {
  const session = sessionTiming();
  if (session === null) return 0;
  return session.endsAt - Math.min(MARGIN_MS, session.lifeMs / 4) - Date.now();
};
const wait = () => Math.max(dueIn(), notBefore - Date.now());

const arm = (ms: number) => {
  clearTimeout(timer);
  timer = setTimeout(() => void tick(), Math.max(0, Math.min(CHECK_MS, ms)));
};

const tick = async () => {
  if (!alive || busy) return;
  // Signed out: keep watching, cheaply, in case another tab signs in again.
  if (isSignedOut()) return arm(CHECK_MS);
  if (wait() > 0) return arm(wait());
  busy = true;
  let outcome: Awaited<ReturnType<typeof renewSession>>;
  try {
    outcome = await renewSession();
  } catch {
    outcome = 'failed';
  } finally {
    busy = false;
  }
  if (!alive) return;
  // Signed out meanwhile (maybe by another tab): keep watching, since a
  // later sign-in in any tab brings a session this page must renew too.
  if (outcome === 'signed-out') return arm(CHECK_MS);
  if (outcome === 'renewed') {
    retry = RETRY_MS;
    notBefore = Date.now() + MIN_GAP_MS;
    renewed.current?.();
  } else {
```
<!-- /gen -->

1. The page cannot read its token, which is an httpOnly cookie. So the deadline comes from the `expiresIn` that the server sent with the last sign-in, renewal or `/api/auth/me`, counted from when this page received it. It is never an expiry compared with the local clock, so a wall computer whose clock is hours wrong still renews on time.
2. `dueIn` is the time until the session ends, less an hour or a quarter of its life, whichever is smaller. A 12-hour session is renewed with 1 hour left.
3. `arm` waits at most a minute (`CHECK_MS`), because a timer does not run while the machine sleeps and one 11-hour timer once fired an hour late after an hour's nap. The check also runs when the page wakes, gains focus or comes back online.
4. A renewal leaves a gap of at least 30 seconds before the next, so no arithmetic surprise can become a request loop. A failed renewal is retried after a minute, doubling up to ten, until the session runs out and a request signs the page out. A "signed-out" answer is not the end: the hook keeps watching cheaply, since a sign-in in any tab brings a session this page must renew. `useSessionRenewal(enabled, onRenewed)` runs `onRenewed` after each renewal, which the shell uses to ask for the account again (FR-70), since a wall screen is never reloaded.

The functions it calls, `renewSession` and the rest of the session, are in [the next chapter](web-api-types-guards.md).

## The address as state: useUrlState

`web/src/shared/hooks/useUrlState.ts`. A filter, a sort or a selection lives in the query string, so Back restores it and a link carries it.

<!-- gen:snippet web/src/shared/hooks/useUrlState.ts#useSearchPatch sha=cefcd6dbad6e -->
`web/src/shared/hooks/useUrlState.ts:12-30`

```ts
export function useSearchPatch(): (patch: Record<string, string | null>) => void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return useCallback(
    (patch) => {
      // A late write (a debounce firing) must not land on the page navigated to.
      if (window.location.pathname !== pathname) return;
      const params = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') params.delete(k);
        else params.set(k, v);
      }
      const search = params.toString() ? `?${params}` : '';
      if (search === window.location.search) return;
      navigate({ search, hash: window.location.hash }, { replace: true });
    },
    [navigate, pathname],
  );
}
```
<!-- /gen -->

<!-- gen:snippet web/src/shared/hooks/useUrlState.ts#useUrlState sha=8008cd58d114 -->
`web/src/shared/hooks/useUrlState.ts:64-104`

```ts
export function useUrlState<T extends UrlValue>(
  key: string,
  fallback: T,
  { options, debounceMs, keepDefault }: { options?: readonly T[]; debounceMs?: number; keepDefault?: boolean } = {},
): [T, (value: T) => void] {
  const { search } = useLocation();
  const patch = useSearchPatch();
  const fromUrl = parse(new URLSearchParams(search).get(key), fallback, options);

  // What was just set, shown until the URL: updated in a transition, or after
  // the debounce, says the same. Without it a controlled input could briefly
  // render the old value mid-typing and lose the caret.
  const [draft, setDraft] = useState<{ value: T } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (draft && timer.current === undefined && Object.is(draft.value, fromUrl)) setDraft(null);
  }, [draft, fromUrl]);

  const setValue = useCallback(
    (value: T) => {
      const write = () => {
        timer.current = undefined;
        patch({ [key]: !keepDefault && Object.is(value, fallback) ? null : serialize(value) });
        // Unchanged URL (or a value the URL can't hold): nothing to wait for.
        setDraft((d) => (d && Object.is(d.value, value) ? { value } : d));
      };
      setDraft({ value });
      window.clearTimeout(timer.current);
      if (debounceMs) timer.current = window.setTimeout(write, debounceMs);
      else write();
    },
    [patch, key, fallback, debounceMs, keepDefault],
  );

  useEffect(() => {
    if (keepDefault && new URLSearchParams(window.location.search).get(key) === null) patch({ [key]: serialize(fallback) });
  }, [keepDefault, key, fallback, patch]);

  return [draft ? draft.value : fromUrl, setValue];
}
```
<!-- /gen -->

1. `useSearchPatch` changes query parameters in place, and a `null` or an empty value removes one. It replaces the history entry and does not push one, so a filter changed ten times leaves one Back step. It reads the live address and not the render's copy, so several patches in one event all land: React Router's own `setSearchParams(prev => ...)` hands every call the same `prev`, and the second undoes the first.
2. A late write, such as a debounce that fires after the person has moved on, must not land on the page navigated to, so the patch is dropped when the path is no longer the one that made it.
3. `useUrlState(key, fallback, options)` is one piece of state of a given type. The default value is left out of the address, unless `keepDefault` is set. It is for a default that is worked out again on every render, the last closed month on the SLA and Services pages, which would open another month in a link copied last month: the value is then always written, and the default is written once when the page opens without it, replacing the entry and not adding one (FR-53). `options` lists the values accepted from the address, and anything else reads as the default. With `debounceMs`, the value updates at once and the address once typing pauses, since browsers throttle a history write for each keystroke.
4. `draft` shows what was just set until the address says the same. Without it a controlled input could render the old value in the middle of typing and lose the caret.

Tests: `useUrlState.test.tsx`.

## What a page says about its data

### Freshness: noteStaleCopy

`web/src/shared/lib/freshness.ts`. The server marks an answer that is not live in its headers, not in its body, so the body is unchanged and the page has to remember the mark against the parsed object.

<!-- gen:snippet web/src/shared/lib/freshness.ts#noteStaleCopy sha=cd3a131e5d5b -->
`web/src/shared/lib/freshness.ts:24-34`

```ts
export function noteStaleCopy(body: unknown, headers: Headers, receivedAt = serverNow()): void {
  if (typeof body !== 'object' || body === null) return;
  const failed = headers.get('X-Data-Stale') === 'true';
  const refreshing = !failed && headers.get('X-Data-Refreshing') === 'true';
  if (!failed && !refreshing) return;
  const raw = headers.get('X-Data-Age-Seconds');
  const age = raw === null || raw.trim() === '' ? NaN : Number(raw);
  const known = Number.isFinite(age) && age >= 0;
  if (refreshing && (!known || age < REFRESHING_NOTICE_AFTER_S)) return;
  copies.set(body, { asOf: known ? receivedAt - age * 1000 : null, refreshing });
}
```
<!-- /gen -->

<!-- gen:snippet web/src/shared/lib/freshness.ts#staleCopyOf sha=235b7423fd6d -->
`web/src/shared/lib/freshness.ts:41-46`

```ts
export function staleCopyOf(body: unknown): { asOf: number | null; refreshing?: true } | null {
  if (typeof body !== 'object' || body === null) return null;
  const copy = copies.get(body);
  if (!copy) return null;
  return copy.refreshing ? { asOf: copy.asOf, refreshing: true } : { asOf: copy.asOf };
}
```
<!-- /gen -->

1. `X-Data-Stale: true` means the server could not reach Zabbix and answered with the last copy it kept. `X-Data-Refreshing: true` means a slow view's last copy is being answered while a newer one is read, which is not a failure. Both come with `X-Data-Age-Seconds`.
2. `noteStaleCopy` is called by the API layer for every JSON reply. It records the mark in a `WeakMap` keyed by the body object itself, so whoever renders that object can ask `staleCopyOf`, and nothing has to be passed through the components.
3. A refreshing copy younger than `REFRESHING_NOTICE_AFTER_S`, two minutes, is not announced: it is no older than Zabbix's own data. The same file turns ages and moments into words, `ageWords`, `momentWords` and `staleWhen`, so the notices read "from 08:48 (1 h 12 min ago)". A moment is measured on the server's clock (`serverNow`, FR-74), so a PC whose clock is wrong prints the right age.

Tests: `freshness.test.tsx`.

### Loading, error and empty: Async

`web/src/shared/components/states.tsx`. The states a data view can be in, and the one component that picks.

<!-- gen:snippet web/src/shared/components/states.tsx#hintFor sha=0fceb2b6a0a2 -->
`web/src/shared/components/states.tsx:20-41`

```tsx
function hintFor(message: string, admin: boolean): string | null {
  // The sentence already tells everyone else to ask an administrator, so only the admin gets a line.
  if (/data source is not answering/i.test(message)) {
    return admin
      ? 'Check that ZBX_URL and ZABBIX_API_TOKEN are set on the BFF and that Zabbix is reachable. The BFF log holds the cause under that reference.'
      : null;
  }
  const zabbix =
    (/zabbix/i.test(message) && !/"code":\s*-?\d/.test(message)) ||
    // Zabbix's web server itself failing: "problem.get: HTTP 502 Bad Gateway"
    /^[a-z]+\.[a-z]+: HTTP \d{3}/i.test(message);
  if (zabbix) {
    return admin
      ? 'Check that ZBX_URL and ZABBIX_API_TOKEN are set on the BFF and that Zabbix is reachable.'
      : 'Cannot reach the monitoring server. Tell the portal admin.';
  }
  // No JSON body at all: the request never reached a working BFF.
  if (/failed to fetch|networkerror|load failed|: HTTP 5\d\d$/i.test(message)) {
    return admin ? 'Check that the BFF is running.' : 'The portal is not answering. Try again, or tell the portal admin.';
  }
  return null;
}
```
<!-- /gen -->

<!-- gen:snippet web/src/shared/components/states.tsx#Async sha=cee658036004 -->
`web/src/shared/components/states.tsx:163-204`

```tsx
export function Async<T>({
  loading,
  error,
  data,
  stale = false,
  updatedAt,
  children,
  loadingLabel,
  onRetry,
  retryable = true,
  footer,
}: {
  loading: boolean;
  error: string | null;
  data: T | null;
  /** `data` is the previous selection's (useAsync's `stale`): dim it. */
  stale?: boolean;
  /** When `data` arrived (useAsync's `updatedAt`), for the refresh-failed note. */
  updatedAt?: number | null;
  loadingLabel?: string;
  children: (data: T) => ReactNode;
  /** For a page that does not poll: the error then has a Try again button (useAsync's `reload`). */
  onRetry?: () => void;
  /** useAsync's `retryable`: false for an answer that asking again cannot change, which then has no Try again button. */
  retryable?: boolean;
  /** Drawn after the content, outside what dims and goes inert while it is stale: for a control that changes the selection, a pager, so that it keeps its focus (UX-57). */
  footer?: (data: T) => ReactNode;
}) {
  if (error && (data == null || stale)) return <ErrorState message={error} onRetry={retryable ? onRetry : undefined} />;
  if (loading && data == null) return <Loading label={loadingLabel} />;
  if (data == null) return <Empty>No data.</Empty>;
  const copy = staleCopyOf(data);
  return (
    <>
      <Loaded stale={stale} error={error} updatedAt={updatedAt}>
        {copy && <StaleCopy asOf={copy.asOf} refreshing={copy.refreshing} />}
        {children(data)}
      </Loaded>
      {footer?.(data)}
    </>
  );
}
```
<!-- /gen -->

1. `Async` takes `useAsync`'s fields and draws loading, error, empty or the content. An error replaces the content only when there is nothing of this selection's to show: a failed poll keeps the last good data and adds a note, while a failed load for a new selection does not leave the old one standing in for it.
2. When the data is an old copy (`staleCopyOf`), `StaleCopy` says so above it, and `Loaded` dims the content while it still belongs to the previous selection and tops it with the "Refresh failed" note after a failed refresh. Dimmed content is also `inert`, so that Tab and Enter do not reach a button inside it, such as Download CSV, which would act on the old selection's rows (FR-54).
3. A control that changes the selection itself, a pager, must not sit inside the dimmed, inert content: it would lose the focus the moment it was pressed. `footer` draws it after the `Loaded` wrapper, outside what dims and goes inert, and only when `Async` is showing content, so no pager stands under an error or a first load (UX-57). `inertWhen`, the helper that writes the `inert` attribute, is also what keeps the Graphs item list out of reach while the next host's list loads (UX-58).
4. A page that does not poll passes `onRetry` (`useAsync`'s `reload`), and the error then has a "Try again" button. It is shown only when nothing of the current selection is on screen, and it is left off when `retryable` is false, which is `useAsync`'s answer for a refusal that asking again cannot change (FR-68). The pages without an interval are the SLA month and window, Capacity, Alert noise, Top triggers and both Explain panels (UX-49), and the Graphs host list, a host's items in the picker, the chart of a past month or a fixed range (a range that ends now polls and has no button), the Maps list and the Latest data menus, whose notice has a button of its own (UX-60).
5. `hintFor` chooses what to tell the reader to check. The server's one sentence, "The data source is not answering", already says to ask an administrator, so only an admin gets a further line, naming `ZBX_URL` and `ZABBIX_API_TOKEN`. A fetch that never reached the server means the server itself, and a refusal for a role, or for a page the account does not have ("Your account does not have Network. Ask an administrator for access."), is said calmly as a status, with no Try again, and not as a failure (FR-71).

### TableWrap

`web/src/shared/components/TableWrap.tsx`. The box that lets a wide table scroll.

<!-- gen:snippet web/src/shared/components/TableWrap.tsx#markScrollable sha=121833274324 -->
`web/src/shared/components/TableWrap.tsx:4-14`

```tsx
function markScrollable(el: HTMLElement, label: string) {
  if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
    el.tabIndex = 0;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', label);
  } else {
    el.removeAttribute('tabindex');
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
  }
}
```
<!-- /gen -->

<!-- gen:snippet web/src/shared/components/TableWrap.tsx#TableWrap sha=631f75d67271 -->
`web/src/shared/components/TableWrap.tsx:20-51`

```tsx
export function TableWrap({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const watch = useRef<ResizeObserver | null>(null);
  const name = useRef(label);

  // After every render, since the table inside may now be wider or taller, and a table that arrives late is watched from then on.
  // The attributes go on the element itself and not through state, which would render the whole table a second time.
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    name.current = label;
    markScrollable(el, label);
    if (typeof ResizeObserver === 'undefined') return;
    // The box follows the window and the sidebar; the table follows its data and its fonts.
    watch.current ??= new ResizeObserver(() => markScrollable(el, name.current));
    watch.current.observe(el);
    el.querySelectorAll('table').forEach((table) => watch.current?.observe(table));
  });
  useEffect(
    () => () => {
      watch.current?.disconnect();
      watch.current = null;
    },
    [],
  );

  return (
    <div ref={box} className={className ? `table-wrap ${className}` : 'table-wrap'}>
      {children}
    </div>
  );
}
```
<!-- /gen -->

1. A box that scrolls must be reachable by keyboard (WCAG 2.1.1), so while it holds more than it shows, in either direction, it takes a tab stop, a region role and a name. While it does not scroll it takes all three away, and stays out of the tab order.
2. A `ResizeObserver` watches the box and each table inside it, since the box follows the window and the sidebar and the table follows its data and its fonts. The attributes go on the element itself and not through state, which would render the whole table a second time.

Tests: `TableWrap.test.tsx`.

## The smaller pieces

- `useDialogFocus` gives a modal dialog what it owes a keyboard user: focus moves in on open, Tab and Shift+Tab stay inside, and focus returns to whatever opened it. When the opener is gone, such as the Ack button of a problem that was just closed, focus goes to the main area (`focusMain`). `useDialogFocus.test.tsx` holds it.
- `useDebounced` gives a value once it has stopped changing, `useNow` the time re-read on an interval, and `useReportTimeZone` the reporting time zone, re-rendering when the server's answer changes it.
- `shared/lib/` holds the pure helpers: `severity.ts` (severity names, ages, durations, availability text), `time.ts` (dates and months in the reporting zone), `units.ts` (Zabbix units as words), `csv.ts` (the one CSV writer, which guards against a cell that a spreadsheet would run as a formula), `plural.ts`, `sites.ts` (the browser's copy of the site-naming rules, held equal to the server's by `copiedHelpers.test.ts`), `wall.ts` and `chatStore.ts`, which [the features chapter](web-features.md) explains.
- `shared/components/` holds `StatusBadge` (the pills), `KpiCard`, `Field`, `Pager`, `NoData`, `BrandMark`, `CollectorNotice` (the banner for a stopped collector or a Zabbix cut off from the network) and `icons`.
