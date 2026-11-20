# 19. Authentication & RBAC

[setup.md](../../setup.md) · previous: [§18](18-automated-reporting.md) · next: [§20](20-acknowledge-close-write-back.md)

Implements `plan_1.2.md` (in `myown/documents/plan/`, outside this repo) Phase 7 and closes its defect #5. Every source slide in
HCML's review is stamped Private and Confidential, so an open portal is not deployable.

`AUTH_ENABLED=true` turns on JWT login; the `onRequest` guard then rejects unauthenticated `/api/*`
calls. Exactly five routes are excepted, `/api/health`, `/api/auth/login`, `/api/auth/me`,
`/api/auth/logout` and `/api/auth/request` (a request for an account, which is off unless `ACCOUNT_REQUESTS` is on, FR-62), and the guard judges the route the router matched rather than the URL text, so
an encoded path such as `/%61pi/hosts` is guarded like `/api/hosts`. The Zabbix token is never
exposed either way: RBAC decides who sees which portal view, not what the BFF may ask Zabbix.
`/api/health` is public, so an anonymous caller gets only `ok`, `ts`, `ai`, `aiProvider`, `aiExternal`, `writeBack`, `defaults` and `ready` as `true` or `false`; the version, build, start time, `streams`, `logFile` and the reason behind `ready`
are added for a signed-in caller. Neither reply carries an address, token or error text. `GET /api/auth/me` also returns `pages` and `modules`: the pages this
account has, each with the role it needs, worked out from the same table of routes (`modules.ts`), so the sidebar keeps no copy of it.

## Three roles, and pages of their own

The portal is read-only but for one write (§20), so roles divide by what a person may do, and only an operator may write. What a person may see is a separate list of pages, one list for each person (ADR-0017):

| Role | May | Rationale |
|---|---|---|
| guest | Read the pages the person was given. A new guest starts with every page except Network, Links & WAN health, the Dashboard's Internet traffic view, the Inventory scorecard and Users and access | The plain-language layer exists *precisely* for non-engineers. Gating it higher would defeat its purpose. |
| operator | + acknowledge and close, when write-back is switched on (§20). A new operator starts with the network pages too | The one role that may write. |
| admin | + every page, the Users page, the Inventory & ownership scorecard, and emailing the SLA report (`/api/sli/email`) and setting its monthly schedule (`/api/sli/schedule`) | Governance, not monitoring. Emailing sends a file out of the portal, and the schedule chooses who gets it and when. |

A page of the menu is a module. An administrator ticks the modules of each person on the Users page, and a role's preset only fills in the ticks of a new user: what is stored is the person's own list, and nothing is looked up from the role afterwards. A tick the role cannot use is not kept, so a guest cannot be given the Users page or the scorecard.

The account of a NOC wall screen is a guest who was given Network and Links & WAN health: the wall turns between the Overview and the meters, which are interface data, and a screen anyone can walk up to must never acknowledge or close. The names the roles had before 17 November 2026 still read in `PORTAL_USERS`: `viewer` is a guest with the pages a viewer had, and `wall` is a guest who also has the network pages. A wall screen gets an entry of its own, with a password of its own. The first entry there replaces `PORTAL_USER` and `PORTAL_PASS`, so while those two name your admin, list the admin as well: `admin:<password or hash>:admin,wall:<hash>:wall`.

Enforcement lives in the table of routes in [`modules.ts`](../../server/src/security/modules.ts), **first match wins, and a route with no row is for administrators only**: so a newly added route is protected by default rather than accidentally public, and `surface.test.ts` fails on a route that has none. A row names the pages that own the route and the lowest role. The guard asks for the role first and then for one of the pages. A 403 explains itself: *"This view needs the "admin" role; you are signed in as "guest"."* or *"Your account does not have Network. Ask an administrator for access."*

The sidebar hides what an account can't reach, but that is only courtesy: the BFF enforces it regardless, and the UI never holds a permission decision the server doesn't also make. The Assistant is given only the parts of the estate that the person's own pages show.

## Users

There is no database. The first administrator and any other user can come from the environment, and administrators add the rest on the Users page, which keeps them in a file of their own on the state volume (`users.json`, ADR-0017):

```bash
AUTH_ENABLED=true
JWT_SECRET=<openssl rand -hex 32>       # required; a published value or under 32 bytes stops the boot
PORTAL_USERS=ana:<password-for-ana>:guest,budi:<password-for-budi>:operator,citra:<password-for-citra>:admin
SESSION_COOKIE=hcml_session_ollama      # optional; two portals on one host need different names
SESSION_HOURS=12                        # optional; how long one sign-in lasts, 2 to 24
SESSION_EPOCH=1                         # optional; raise it and restart (in Docker, recreate the container) to end every session at once
# or the single-admin shorthand:
PORTAL_USER=admin
PORTAL_PASS=<password-for-admin>       # a long password of your own: the < > words are placeholders, not values to paste
```

A plain password must be at least 8 characters. Docker compose reads a `$` in `.env` as the start of a variable and drops the rest of the value, so a password that holds one goes in single quotes, `PORTAL_PASS='Str0ng$Passw0rd1'`, and a `PORTAL_USERS` list that holds one goes in single quotes as a whole. A hash made by `scripts/hash-password.ts` has neither problem.

What `PORTAL_USERS` does after the first start (SC-67, SC-68). It adds a person once: at a start with a data folder, an entry whose name the file does not hold is copied into `users.json`, and from then on the file decides. Taking the entry out, or changing its role or password in `.env`, changes nothing for that person, and the start warns about someone who was imported and is no longer listed ("can still sign in"). The way to end a person's access is **Disable** on the Users page, which applies at their next request and closes their open streams. Delete the imported people from `PORTAL_USERS` after the first start; the first administrator stays, as it is the break-glass account and the only one that is changed in `.env`. Left there, an entry is a second copy of the person: if the volume is ever lost or empty they come back with the role and password written in `.env`, disabled people included, and the plain text stays in `.env` and in every backup of it. The start says so, by name, when `.env` and the file both hold a person.

Malformed entries are warned about and skipped; an unknown role falls back to `guest`, never to
something more privileged. The BFF refuses to start while any user's password is empty, is `admin`, or is a plain password shorter than 8 characters (a hash is not measured). It starts, and warns by name
(never the password), when a plain password is on the short list everyone tries (`secret`, `zabbix`, `password`, `changeme`, `123456` and the 308 of SC-71, in any case), when a stored hash is one of those five, or when a password is still a
placeholder such as `<password-for-ana>` pasted from here (SC-46). `POST /api/auth/login` takes 10 attempts a minute per account and address, and locks a name and address for a minute after 10 failures in a row, doubling to 5 minutes; an address that fails 30 times in 15 minutes across at least 10 names is locked the same way (SC-61). With
`AUTH_ENABLED=false` the BFF reports role `admin` so the scaffold runs open with zero setup, and
none of the secret or password checks run: that is a dev convenience and `docker-compose.yml`
defaults it to true.

Next: SSO or LDAP in place of env users. The acknowledge/close write-back that once sat here too is built
(§20), through a separate `ZABBIX_WRITE_TOKEN` that is deliberately not the read-only token.


## Requests for an account (FR-62)

A person who cannot sign in can ask for an account on the sign-in page, and an administrator answers on the Users page. It is off by default: `ACCOUNT_REQUESTS=true` turns it on, and it needs sign-in on and a data folder, because the requests are kept in `requests.json` on the state volume (mode 0600) and the account is made in `users.json`. Both compose files pass the three settings.

| Setting | Default | Meaning |
|---|---|---|
| `ACCOUNT_REQUESTS` | off | `true` offers the form |
| `ACCOUNT_REQUESTS_MAX_PENDING` | 50 | how many requests may wait at once, 1 to 500 |
| `ACCOUNT_REQUESTS_PER_ADDRESS` | 3 | how many one address may leave in a day, 1 to 50 |

The form asks for a name, the pages wanted, chosen from those a guest can hold (never the Users page or the scorecard), and a reason. It is the one public route that writes to disk, so it is held tight:

- It is checked like sign-in is: the portal's own header and origin, and a body over 8 KB is refused. The name is cut at 80 characters and the reason at 500, and control characters are dropped.
- One address may leave 3 a day (429 with `Retry-After`; the count is in memory, so a restart forgets it) and at most 50 may wait at once (503). A request nobody answers is dropped after 30 days.
- A request whose name is already waiting, whatever the case, is dropped, and the answer is the same 202, so the form never says who is known.
- The administrator sees the waiting requests on the Users page, oldest first. **Approve** opens the Add form with the name and pages filled in, and the administrator types the role and a temporary password: the account is made exactly as any other, and the request leaves the list. **Refuse** takes it off the list. Nobody gets an account without an administrator typing it.
- The log gets the step (`account_request`: received, ignored, approved or refused), the address and the name, never the reason.

The five routes are in [`openapi.yaml`](../api/openapi.yaml): `GET` and `POST /api/auth/request`, `GET /api/users/requests` and `POST /api/users/requests/{id}/approve` and `/refuse`. Like the other Users routes the last three answer 503 `sign_in_off` while sign-in is off.

## What changed on 7 October 2026 (tracker SC-14, SC-19, SC-22, BK-03, FR-13, SC-07, SC-20, IN-09)

This section is as it was written on 7 October. The roles were renamed on 17 November: read `viewer` as a guest, and `wall` as a guest who has the network pages (see the end of this chapter).

- Every request looks its user up again. A token is checked, then the user is found and the current role is used, not the one the token was signed with. Disable someone on the Users page (or, for a user kept in `.env` alone, take them out of `PORTAL_USERS` and recreate the container) and their tokens stop working at once; change a role and it takes effect at once. A new `JWT_SECRET` still ends everyone's.
- Tokens name their portal. Each carries an issuer and an audience built from the session cookie name (`hcml-portal:hcml_session`, `hcml-portal:hcml_session_ollama`), so a token from :8081 is refused on :8082 even when both share a `JWT_SECRET`. No `.env` change is needed.
- Names ignore case, and a password may hold a colon. `Ana` and `ana` are one account for sign-in and for the lockout counter. The name is what comes before the first `:` and the role what comes after the last, so the password between them can contain `:`. Two entries that differ only by case are warned about at start.
- Hashed passwords are optional. A password in `PORTAL_USERS` or `PORTAL_PASS` is plain text, as before, or an Argon2id hash of the form `argon2id.m.t.p.salt.hash` (Node's own `crypto`, no new package; a hash of the form `scrypt.N.r.p.salt.hash`, made before 18 November 2026, still reads). From `server/`, run `npx tsx scripts/hash-password.ts` to be asked twice with nothing shown, or read the password without echo and pipe it in, `read -rs PW; printf '%s' "$PW" | npx tsx scripts/hash-password.ts; unset PW`, and paste the line where the password was. The script reads the password from standard input and never from an argument, and the second form never types it into a command, so it stays out of the shell history. A hash of `admin` or of nothing is refused at start, like the plain text. A check costs about 30 ms and 46 MiB, and an unknown name costs one too, so a wrong name is not quicker to refuse. A scrypt hash in `.env` still works but takes about four times as long to refuse a wrong password, which tells a caller that the name exists, and the portal cannot rewrite `.env` as it rewrites the hash of a user of the file at their next sign-in: it names such users in one warning at start, never a password, and a new hash from `scripts/hash-password.ts` replaces it (SC-60).
- Sign-ins are logged. Every attempt writes a line with the account's name when an account holds it (control characters removed, 64 characters at most), or `unknown` and the length of what was typed when none does, so that a password typed into the name box stays out of a log that lasts, the outcome (`success`, `failure`, `locked` or `rate_limited`) and the address, never the password. Five failures in a row for one name, from any address, raise a warning, and again at every fifth.
- `AUTH_ENABLED` is read strictly. Unset or empty is on; empty used to mean off. `true`, `1` and `yes` are on, `false`, `0` and `no` are off, in any case. Anything else, such as a typo, stops the server at start and names the accepted values.
- With sign-in off the server answers only to this machine. Every caller is admin then, so a `Host` that is not `localhost`, `127.0.0.1`, `::1` or the host of `WEB_ORIGIN` gets `421`, which stops a page on another site reaching the dev server by DNS rebinding. Write-back is refused as well unless `ALLOW_WRITE_WITHOUT_AUTH=true`: a dev `server/.env` with sign-in off and a write token now needs that line to acknowledge anything. Report email, the monthly schedule and the saved list of recipients are refused the same way unless `ALLOW_EMAIL_WITHOUT_AUTH=true` (SC-43, SC-49), because every caller would count as an administrator and could send the report to any address; the start-up log says which of the two is the case. Neither setting is passed to the containers.
- Interface data is for wall screens, operators and admins. A viewer does not get items whose key starts with `net.if` from `/api/items` or `/api/latest`, and `/api/graph` answers `403` when asked for one by id (`/api/history` and `/api/trend` did too, until BK-11 removed them). On `/api/maps/detail` a viewer does not get the network hosts, the network host groups or the links that end at them, **but only when `NET_GROUP_IDS` names the network host groups**: with it empty nothing says which hosts are network devices, so nothing is cut. Operators and admins see everything, and an unknown role counts as a viewer. The Capacity report is the one other place interface rows appear: its last panel names the busiest interface ports of each host (the port, the host, the average and the most use), and that report is for every role (decided 11 November 2026, SC-45). `/api/reports/capacity` has no rule of its own, and the viewer policy does not apply to it. The Graph button beside an interface row is for wall screens, operators and admins, since `/api/graph` would refuse a viewer those items (FR-55).
- A public `/api/health` is short. Anyone gets `ok`, `ts`, `ai`, `aiProvider`, `aiExternal`, `writeBack`, `defaults` and `ready`, a plain `true` or `false` for whether Zabbix can be read, so that a monitor needs no account (IN-47); a revoked token reads as any other failure. The version, start time, build, `ready` as the whole check (including `token_rejected`) and the screen count are for a signed-in caller only.

Upgrading from a build before issuer and audience (7 October 2026, SC-14). Tokens issued before the deploy carry neither claim and are refused. Reload every open portal tab right after the deploy and sign in again, wall screens included: a tab left open lands on the sign-in page at its next request.

## What changed on 17 November 2026 (ADR-0017)

- Three roles and a list of pages for each person. `guest`, `operator` and `admin` replace `viewer`, `wall`, `operator` and `admin`. Every route has a row in one table (`security/modules.ts`) that names the pages that own it and the lowest role, and the guard asks for both. The older names still read from `.env` and from older sessions.
- The users have a file. On a portal with a data folder (`PORTAL_STATE_DIR`, which both compose files set), administrators add, change, disable and reset users on the Users page. They are kept in `users.json` on the state volume (mode 0600, hashes only, the version before the last change as `users.json.prev`; a file that cannot be read is put aside as `users.json.broken-<time>`, never deleted). The first administrator of `.env` is the break-glass account and stays there. The other users of `.env` are copied into the file by name at every start while the file can be edited, and a name the file holds is never overwritten. Without a data folder the users stay in `.env` and the page lists them to read only.
- A new or reset user has a temporary password: nothing but choosing a new password works until it is chosen. Everyone but the first administrator changes their own password on the Account page (`POST /api/auth/password`), which ends their older sessions; the first administrator is kept in `.env`, so the page shows a sentence in place of the form and the password is changed there (FR-73). A disabled user, or one past their expiry, is refused on the next request. Nobody is deleted from the page.
- New passwords must have 8 to 256 characters and must not be on the short list (the list is longer since 19 November, below). The cost of one check was raised to N = 2^15, r = 8, p = 3 for scrypt, 0.13 s and 32 MiB on the development Mac, and a sign-in rewrites an older hash at the new cost. Since 18 November the hash is Argon2id at about 30 ms and 46 MiB (see 7 October above).
- The Assistant is scoped. Its summary of the estate is cut by the pages a person has: someone with only the SLA page is given the SLA and the services and nothing about hosts, sites or problems, and the focus on a named site or host is built only for a person who has a page that shows sites or hosts.
- Every change to a user is one `user_admin` line in the log: who, from where, what, to whom, and the role and pages when they changed. Never a password or a hash.

## What changed on 19 November 2026 (tracker SC-57 to SC-71, BK-97 to BK-101, FR-62, FR-70, FR-73)

- A stream ends with the account (SC-57). The live stream checked the session once, when it opened. It now also ends when the person is disabled, is given an expiry or reaches it, has the role or the pages changed, has the password reset or asked for anew, or changes it themselves, and it never outlasts the person's account; the page reconnects as the account allows now, or is sent to sign in (§7). Enabling someone again does not bring their old sessions back: a disable records the time, and a token made before it stays refused.
- A typed password is only ever text (SC-58). A new password shaped like a stored hash was once read as one, which cost the server 4.6 seconds of its main thread; a candidate is now compared as text, and the reading of hashes is kept for the values of `.env` at start.
- The Users routes refuse while sign-in is off (SC-59). With sign-in off everyone counts as an administrator, so an anonymous call could make an administrator that was still there when sign-in was switched on. The Users routes, and the three of requests, now answer 503 `sign_in_off`.
- A name nobody has costs what a wrong password does (SC-60). Where hashes are in use, an unknown name and an account with a plain-text password both pay for a hash check, so the time of a refusal does not say which names are real, and an scrypt hash is rewritten as Argon2id at the person's next sign-in.
- A password spray is locked by address (SC-61): see the sign-in limits above. The log gets one `sign_in_spray` line with the number of failures and names and the length of the lock.
- The password rule (SC-71). A password chosen on the page, or typed by an administrator for a new or reset user, has 8 to 256 characters, is not one of 308 common passwords, is not one of 97 base words with digits or signs after it (`Welcome1!`) or one character repeated, and does not hold `hcml` or the person's sign-in name; the refusal says which in words. The values in `.env` keep the start-up rule: empty, `admin` and under 8 characters stop the start, and a plain password on the lists above (or a pasted placeholder) is warned about, a stored hash being tried against the five short words only.
- Explain follows the pages (SC-62). `/api/explain/problem` belongs to the Problems and Dashboard pages and `/api/explain/sla` to the SLA and Services pages; the Assistant page alone no longer gives either.
- The Assistant, by page and by where the model is (SC-63 to SC-65, SC-69, SC-70). The text of an answer is cleaned before it reaches a model, and a model outside the network never gets the far end of a link, an item's name or description, an alias, map labels, maintenance names, addresses, tags, inventory or contacts. Tags, inventory and contacts need the Inventory page, the names of those who acknowledged a problem need the operator role, and the problem lines of a focus need the Problems or the Dashboard page. Under `AI_LOCAL_ONLY` a model name that leads to the cloud (it ends in `cloud` after a colon, an underscore or a hyphen, as `kimi-k2:cloud` does; such a name also counts as outside the network) is refused, and the request to the model never follows a redirect. See §24 and ADR-0019.
- The users file, hardened (SC-66, BK-97 to BK-101). `.gitignore` names `users.json*`, `requests.json*`, `closed-months.json*` and `*.broken-*`, so a run outside Docker that keeps its state in the repository does not offer them to git. A field the portal does not know in a body for a user is a 400 that names it: `disable` for `disabled` was a 200 that changed nothing. A record that fails the check at start is copied to `users.json.repaired-<time>` before the file is rewritten, and the warning names the person. A failed save answers 500 `users_error` with its own sentence. The start warns when no account can open the Users page. A role such as `constructor` in `PORTAL_USERS` is refused with a warning.
- An open page follows a change of its pages (FR-70). It asks for the account again when its tab is shown or focused, at most once a minute, after each renewal of the session, and every ten minutes while it stays in view, so a page an administrator gives or takes away reaches a screen that is already open. The notice for a page the person lacks has a **Check again** button.
- The Account page knows where the account is kept (FR-73): `GET /api/auth/me` carries `user.source`, `env` or `file`.
- Requests for an account (FR-62), built and off by default: see the section above.
