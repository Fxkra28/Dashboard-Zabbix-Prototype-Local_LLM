# 8. Authentication (mechanics)

[setup.md](../../setup.md) · previous: [§7](07-live-updates.md) · next: [§9](09-caching-strategy.md)

`AUTH_ENABLED=true` turns on a JWT flow: `POST /api/auth/login` sets a JWT (12 h unless `SESSION_HOURS` says otherwise) carrying the
user's role in a session cookie; an `onRequest` guard then rejects unauthenticated `/api/*` calls
(`/api/health`, `/api/auth/login`, `/api/auth/me` and `/api/auth/logout` excepted) and checks the role
against the route. The Zabbix token is never exposed regardless: portal auth gates the portal's
own routes only.

No script on the page can read the token. The cookie is named by `SESSION_COOKIE` (default
`hcml_session`; hcml-portal-ollama's compose sets `hcml_session_ollama`, because cookies ignore ports)
and is `HttpOnly`, `SameSite=Strict`, `Path=/`, with a `Max-Age` of the session length (12 h by default), and `Secure` when the request
came over HTTPS. The browser sends it with every same-origin request, the SSE stream included.
[`api/session.ts`](../../web/src/api/session.ts) keeps only when the session ends, from the `expiresIn` that sign-in,
renewal and `/api/auth/me` return, and redirects to `/login` on a 401, keeping the page to return to
after sign-in.

Every POST from the page carries `X-HCML-CSRF: 1`. The BFF refuses a POST that authenticates with the
cookie, and any sign-in or sign-out, without that header or with an `Origin` from another host:
403 `csrf`. A script can send `Authorization: Bearer <jwt>` instead; the header wins over the cookie
and needs no CSRF header, except to sign in or out. `POST /api/auth/logout` clears the cookie, and the tabs tell each other
over a `BroadcastChannel`, so signing out in one sends the others to `/login`.
[ADR-0010](../architecture/adr/0010-session-cookie.md) has the trade-off.

An open page renews its token an hour before it runs out with `POST /api/auth/refresh`
([`useSessionRenewal.ts`](../../web/src/features/shell/useSessionRenewal.ts)), so a wall screen stays signed in while
it is open. The BFF looks the user up again on each renewal: a user no longer in `PORTAL_USERS`, or a
name listed there twice, is refused, and the new token carries the role configured now.
[ADR-0009](../architecture/adr/0009-renew-an-open-portals-sign-in.md) has the trade-off.

> Roles, route rules, and the user model are in [§19](19-authentication-rbac.md#19-authentication--rbac). That section is
> the authority; this one is just the transport.
