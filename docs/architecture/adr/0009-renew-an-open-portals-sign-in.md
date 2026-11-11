# Renew an open portal's sign-in, for every user

* Status: accepted
* Deciders: HCML internship project (the owner chose it in DESIGN.md section 9, "Wall sign-in")
* Date: 2026-09-25
* Amended: 2026-09-25 by [ADR-0010](0010-session-cookie.md). The token moved from `localStorage` into
  an httpOnly cookie, and renewal is timed from the `expiresIn` the BFF sends. The bullets below
  describe the renewal as it works now.
* Amended: 2026-10-12 (tracker SC-14). Since 7 October every request looks its user up again, so a removed
  user loses access at once rather than at the next renewal. The 12 hours is now the default of `SESSION_HOURS`,
  a setting from 2 to 24, and raising `SESSION_EPOCH` ends every session without a new secret.

## Context and Problem Statement

A sign-in gives the browser a JWT that lasts 12 hours (`tokenLifetime()` in `server/src/security/auth.ts`, set by `SESSION_HOURS`),
and until now nothing could extend it. The Dashboard polls the BFF every 15 and 30 seconds, so within
about 15 seconds of the twelfth hour a request came back 401, `web/src/api.ts` (now `web/src/api/session.ts`) cleared the token, and
the page jumped to the login screen. A wall screen switched on at 07:00 showed a login form from about
19:00 until someone typed a password into it.

The BFF keeps no list of issued tokens. It checks each one's signature and expiry and nothing else,
so a token cannot be cancelled on its own before it runs out.

## Decision Drivers

* A wall display must stay live without anyone at its keyboard (UX-15).
* The owner asked for the same behaviour for every user, not only for a wall account.
* No new dependency and no database ([ADR-0003](0003-no-database.md)): users still come from the
  environment.
* A token in the browser must stay a short-lived credential, not a permanent one issued up front.

## Considered Options

* Renew while open. The page swaps its still-valid token for a fresh 12-hour one an hour before
  it runs out, with a new route, `POST /api/auth/refresh`.
* A longer lifetime, for example 30 days. One line to change, but every token, including one on
  a laptop left closed in a bag, would stay valid for the whole of it.
* A refresh token in an `httpOnly` cookie, the pattern that keeps the long-lived credential away
  from page scripts. It needs a cookie plugin (a new dependency), CSRF protection and nginx changes,
  which is more than this prototype's threat model asked for at the time. ADR-0010 later moved the
  token itself into such a cookie.

## Decision Outcome

Chosen: **renew while open.**

* `POST /api/auth/refresh` sits behind the guard, so it takes a valid token from the session cookie
  or an `Authorization` header; an expired token, a missing one or a `?token=` gets 401. The fresh
  token goes back in the cookie, and the body says how long it lasts (`expiresIn`, in seconds).
* It looks the user up again in the user list the BFF loaded at start. A user no longer in
  `PORTAL_USERS` gets 401, and the new token carries the role configured now, not the one in the old
  token. A name listed twice is refused too, with a warning at start: a token names its user, not
  which entry signed in, and taking the first entry let a sign-in with one entry's password renew
  into the other entry's role.
* The web app (`web/src/features/shell/useSessionRenewal.ts`) renews an hour before the session ends, or at
  three quarters of what was left when that is under four hours. The page cannot read the token, so
  the deadline comes from `expiresIn`, which sign-in, renewal and `GET /api/auth/me` all return:
  the time the page received it plus that many seconds, never an expiry against the local clock, so
  a wall PC whose clock is hours off still renews on time. It is checked every minute and whenever
  the page wakes, gains focus or comes back online, because a timer does not run while the machine
  sleeps. A page load asks `/api/auth/me` first, so it renews on schedule rather than at once.
* When a renewal brings a different role, the page asks `/api/auth/me` again, so its menus follow
  the role the BFF now enforces, and tells its other tabs to do the same.
* A renewal that cannot reach the BFF is retried from one minute, backing off to ten, until the token
  runs out. A 401 signs the page out, as any other 401 does, and after signing in again the page
  returns to where it was, so a wall screen comes back in wall mode.

Verified by nine tests in `server/src/__tests__/auth.test.ts`: renewal for the same user with a
fresh 12-hour lifetime in a fresh cookie, the renewed cookie opening a guarded route, renewal with a
Bearer header, 403 for a cookie renewal without the CSRF header, 401 for a missing, expired,
malformed or foreign-secret token and for a query-string token, 401 for a user removed from the list,
the role read from the current list, 401 for a name listed twice (with the warning, which names no
password), and 404 for a GET. The web side was exercised in headless Chrome against a mock BFF
issuing two-minute tokens, before ADR-0010.

### Positive Consequences

* A wall screen stays signed in for as long as its page is open.
* Removing a user still works as it did: because each renewal looks the user up again, someone
  taken out of `PORTAL_USERS` loses access within 12 hours of the BFF restart, when their current
  token runs out (a live stream is ended by the BFF at that moment, SC-15). Without that lookup, renewal would have made a removed user's access endless. A
  changed role reaches an open page at its next renewal instead of at the next sign-in. Audit item
  SC-14 in `tracker.md` (no revocation) is only partly closed: one person's token still cannot be
  cancelled alone.
* A closed tab renews nothing. A laptop that sleeps past the expiry wakes to the login page; one
  that wakes before it renews within a minute.

### Negative Consequences

* **A token that keeps being renewed never ends.** Before, a stolen token worked for at most 12
  hours. Now whoever holds one can renew it every 11 hours indefinitely. The owner accepted this
  trade-off: "an unattended, open portal also stays signed in" (DESIGN.md section 9).
* The only ways to end such a session early are removing the user and restarting the BFF (at the
  next renewal, within 12 hours, when this was decided, and at once since 7 October), or changing
  `JWT_SECRET` or raising `SESSION_EPOCH`, either of which signs everyone out at once.
* Renewal makes a stolen token worth more. Until ADR-0010 the token sat in `localStorage`, readable
  by any script on the page. It is in an httpOnly cookie now, so an injected script can act as the
  user while the page is open but cannot carry the token away.
* Every open tab renews on its own.

A maximum session length (for example "sign in again every 7 days") would need one extra claim, the
original sign-in time, carried from token to token and checked by the refresh route. It is not built,
because the owner chose no timeout.
