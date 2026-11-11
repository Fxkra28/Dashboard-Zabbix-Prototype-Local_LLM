# Keep the sign-in token in an httpOnly session cookie

* Status: accepted
* Deciders: HCML internship project (the owner decided audit item SC-11 in `tracker.md` on 25 September 2026)
* Date: 2026-09-25

## Context and Problem Statement

Since sign-in was added, the browser kept its 12-hour JWT in `localStorage` under `hcml_token` and
sent it as `Authorization: Bearer` on every request. Any script running on the page could read it
and send it somewhere else, where it worked on every route, acknowledge included, until it ended.
With [ADR-0009](0009-renew-an-open-portals-sign-in.md) a stolen token can also be renewed without
end. The Content-Security-Policy that would limit an injected script is still report-only
(tracker IN-02; it has been enforced since 14 October, SC-24).

The live stream had the same token in its URL, `/api/stream?token=…`, because `EventSource`
cannot set a header. A URL reaches access logs, error logs and browser history. nginx and the BFF
redacted it from their logs, but the credential was still in the URL (the part of SC-03 left open).

## Decision Drivers

* No script on the page should be able to read the credential.
* No credential in any URL, the stream's included.
* Keep ADR-0009's renewal: 12-hour tokens, renewed about an hour before they end while a page is open.
* Scripts and tests keep a way in without a browser.
* No database ([ADR-0003](0003-no-database.md)), so no server-side session store.

## Considered Options

* The JWT in an httpOnly, SameSite=Strict cookie, with a CSRF header on unsafe requests.
* A token in memory with a refresh cookie. Page scripts hold a short-lived token and a reload
  goes through a refresh cookie. It still needs a cookie and CSRF protection on the refresh route,
  and the stream still needs a token in its URL or a ticket.
* A short-lived, single-use stream ticket, the SC-03 follow-up. It fixes the stream's URL only;
  the token stays readable in `localStorage`.
* Server-side sessions behind an opaque ID. They would allow revocation (SC-14), but need a
  session store, which ADR-0003 rules out.

## Decision Outcome

Chosen: **the JWT in an httpOnly cookie**, because one change takes the token away from page scripts
and out of the stream's URL while the token stays a stateless JWT.

* `@fastify/cookie` is registered before `@fastify/jwt`, which reads the token from the cookie named
  by `SESSION_COOKIE` (default `hcml_session`). An `Authorization: Bearer` header still works and wins
  when both are present, for scripts and tests.
* `POST /api/auth/login` and `POST /api/auth/refresh` set the cookie: `HttpOnly`, `SameSite=Strict`,
  `Path=/`, `Max-Age=43200` (the token's lifetime), and `Secure` when the request arrived over HTTPS
  (`request.protocol`, which trusts `X-Forwarded-Proto` as far as `TRUST_PROXY` says). The body is
  `{ user, expiresIn }` and never carries the token. `GET /api/auth/me` returns `expiresIn` too. A new
  public route, `POST /api/auth/logout`, clears the cookie, even when it has expired.
* CSRF: a `POST`, `PUT`, `PATCH` or `DELETE` on `/api/*` that authenticates with the cookie, and every
  sign-in and sign-out, must carry `X-HCML-CSRF: 1` and, when the browser sends an `Origin`, one
  naming the request's own host and port. Anything else gets 403 `csrf`. A Bearer request is not
  checked, except on sign-in and sign-out, because a browser never adds that header on its own. A page on another site cannot add
  a custom header without a CORS preflight, and the BFF's CORS setting answers only for `WEB_ORIGIN`.
* The stream no longer accepts `?token=`. `EventSource` sends the cookie like any same-origin request.
* nginx passes the browser's `Host` with its port (`$http_host`, where `$host` dropped the port), and
  the Vite dev proxy keeps it (`changeOrigin: false`), so the `Origin` comparison sees what the
  browser saw. It reads the `Host` header itself, never `X-Forwarded-Host`, which a client can set.
  A TLS proxy in front must therefore keep the browser's `Host` too.
* The web app keeps no token. It records when the session ends from `expiresIn` and renews from
  that (ADR-0009). Tabs tell each other about a sign-in, a sign-out or a changed role over a
  `BroadcastChannel`; on a sign-out the others go to the sign-in page. A token left in
  `localStorage` by an earlier build is deleted when the app starts.

Verified by the server tests: `auth.test.ts` now has 48 (24 before) and `startup-guards.test.ts` 11
(9 before). They cover the cookie's attributes and `Max-Age`, a body with no token, the cookie
opening guarded routes up to the user's role, `Secure` behind a trusted HTTPS proxy, the CSRF
refusals (no header, a foreign or `null` origin) and passes (header with the page's own origin or
none, any Bearer request other than sign-in and sign-out, any GET), `?token=` refused on the stream, refresh and me with
`expiresIn`, logout with and without a cookie, a renamed cookie, an invalid `SESSION_COOKIE`
refused at start, an `X-Forwarded-Host` that cannot stand in for `Host` behind a trusted proxy, and
a rate limit that counts refused requests, holds across usernames on sign-in, counts one account
across an IPv6 /64, never refuses a sign-out and caps a sign-in body at 4 KB. In headless Chrome, against a local BFF behind `vite preview`: `document.cookie`
was empty after sign-in, no request sent an `Authorization` header, the stream URL had no token and
sent the cookie, a POST without the header got 403, and signing out in one tab moved a second tab
to `/login?next=%2Fhosts`.

### Positive Consequences

* No script on the page can read the token. An injected script can still act as the user while the
  page is open, but it cannot carry the token away to use elsewhere.
* No credential in any URL: SC-03 is closed. The log redaction stays, for pages loaded before this
  change.
* Sign-out and role changes reach every open tab at once, not only at each tab's next request.

### Negative Consequences

* **A CSRF surface that did not exist before.** A browser never sent the Bearer header by itself;
  it sends a cookie with every request to the portal. Every state-changing route now depends on
  `SameSite=Strict` and the `X-HCML-CSRF` check, and both cover unsafe methods only: a route that
  changed state on a GET would be open to forgery, so writes must stay on POST. `WEB_ORIGIN` is still
  allowed credentials by CORS (tracker SC-18), so a page served from that origin could send the
  header.
* Cookies ignore ports. Everything on one host name shares its cookies, so the two portals on
  127.0.0.1:8081 and :8082 need different names (`SESSION_COOKIE=hcml_session_ollama` in the ollama
  copy), or signing in to one replaces the other's session. Any other service on the same host, on
  any port, receives the cookie and can overwrite it, and SameSite does not separate ports: only the
  `Origin` check stops a POST from such a page.
* Secure only over HTTPS. Over plain HTTP, the default Docker deployment on 127.0.0.1, the cookie
  is not `Secure`, because a browser would drop it. Behind a TLS proxy it is `Secure` only when that
  proxy sends `X-Forwarded-Proto: https` and `TRUST_PROXY` is on: Fastify reads that header from the
  nearest hop, nginx, which passes it through unchanged.
* Plain-HTTP deployments stay readable on the wire. A portal reached over plain HTTP from a
  network sends the cookie in clear on every request, as it did the header. A TLS proxy is still
  required before exposing the portal beyond 127.0.0.1.
* **Revocation, since 3 November 2026.** Sign-out used to clear the cookie in that browser only, and a copied token
  kept working until it expired. Every token now carries a session id that renewals pass on, and sign-out puts it on a list in
  memory, so the whole chain is refused, and the live streams of the session are closed. What stays: a copy that someone
  keeps renewing after the owner only closed the tab lives until the user is removed, `SESSION_EPOCH` is raised or
  `JWT_SECRET` changes. The text below is the decision as it was written.
* **Still no revocation (as written in October).** Sign-out clears the cookie in that browser, but a copied token keeps
  working until it expires, up to 12 hours (the `SESSION_HOURS` default). Taking the user out of
  `PORTAL_USERS` and restarting the BFF stops its renewal (ADR-0009); a new `JWT_SECRET`, or since
  12 October 2026 a higher `SESSION_EPOCH`, ends every session at once (SC-14). An open live stream used to be the exception: it
  was checked only when it opened. Since 7 October 2026 the BFF ends it when its token expires, and
  the browser reconnects with the renewed cookie (SC-15).
  A sign-out that cannot reach the BFF leaves the cookie in place, although the page shows the
  sign-in form.
* Scripts change. Sign-in no longer returns the token in the body. A script takes it from the
  `Set-Cookie` header and sends it back as the cookie or as a Bearer header.
* More moving parts: a new runtime dependency, a changed nginx `Host` header, a header on every
  POST, and a `BroadcastChannel`, which Safari before 15.4 lacks; there, other tabs find out at their
  next request.
