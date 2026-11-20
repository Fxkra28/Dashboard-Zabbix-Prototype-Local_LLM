# Keep the portal's users in a file of their own, with a role and a list of modules for each

* Status: accepted
* Deciders: HCML internship project; the owner asked on 17 November 2026 what is best practice for storing users in production, was given this recommendation with the plan that rests on it, and told us to go ahead
* Date: 2026-11-17
* Amended: 2026-11-18: the shipped image was tried, and a candidate image built from the working tree kept the users file on its volume across a restart
* Amended: 2026-11-18, later: new hashes are Argon2id and not scrypt (the passwords and the last two negative consequences)
* Amended: 2026-11-19, after the tenth re-audit: the Assistant's data follows the pages, and the Explain routes no longer list the Assistant page (SC-62, SC-65); open streams end with the account (SC-57); a wrong name costs a hash check, and one address that tries one password on many names is locked (SC-60, SC-61); the start warns about people copied from `.env` (SC-67, SC-68); a stronger rule for new passwords (SC-71); and a person who cannot sign in can ask for an account, off unless a setting turns it on (FR-62)
* Amends: [ADR-0003](0003-no-database.md), which says the portal owns no store and that its users live in `.env`, [ADR-0015](0015-keep-a-small-state-file-for-recipients-and-the-schedule.md), whose file never holds a password, and [ADR-0016](0016-keep-the-web-check-figures-of-closed-months.md), whose file holds "nothing that identifies a person or a secret"

## Context and Problem Statement

The portal knows its users from `PORTAL_USERS` in `.env`, as `name:password:role` triples, and from the single pair `PORTAL_USER` and `PORTAL_PASS`. There are four ranked roles (`viewer`, `wall`, `operator`, `admin`), and what a role may open is the same for everyone who holds it. That was enough for a portal run by one person. On 17 November 2026 the mentor asked for three things that it cannot do:

1. Three roles, **admin, operator and guest**, where an admin chooses **which modules** (the sidebar's pages) each person sees, and sees the list of all users. Operator and guest see only the modules granted to them. A guest only reads.
2. Grants **per user**, not per role (the owner's answer of the same day).
3. **Single sign-on later**, which needs a user to be a record that can be matched to someone else's identity.

A per-user grant has nowhere to live in `.env`: adding a person, changing a role or taking one away means editing a file on the server and recreating the container, a password may sit there in plain text, nothing records who changed what, and a person cannot be disabled without deleting the line. A portal that holds the sign-in of a whole estate's monitoring needs a store, and the state volume already exists (`portal-state`, ADR-0015).

## Decision Drivers

* A change of a user must survive a restart and a rebuild, and take effect on that user's next click.
* A file that is half written, or lost, must never lock everyone out.
* A password is never stored in a form that can be read back, and never reaches a log.
* Who did what to whom must be on the record.
* No new service for an estate with a few dozen users at most.
* A rollback to an older image must not misread what a newer one wrote, and must not lose the users.
* SSO and a database must be possible later without throwing this away.

## Considered Options

* Keep `PORTAL_USERS` in `.env` and add a module list to each triple.
* A users file of its own on the state volume (`users.json`).
* SQLite on the state volume (`node:sqlite`).
* A database server (PostgreSQL or the like).
* Have no local users at all and rely on the identity provider alone.

## Decision Outcome

Chosen: **a file of its own, `users.json`, in `PORTAL_STATE_DIR`, with SQLite as the way up when the triggers below are met.** It is best practice for a portal of this size in the way that matters: the file is small, readable by a person, written whole and safely, backed up with the rest of the volume, and the interface that reads and writes it (`UserStore`) is the only place that knows it is a file.

* **What it holds.** For each user: an internal id, the sign-in name, the name shown, the role, the list of modules, the language (`en` or `id`, or none), the password hash, when it was created and by whom, the last sign-in, whether it is disabled, an expiry date or none, whether the password must be changed at the next sign-in, and a "sessions before this time are void" moment. No password in clear text, no token, nothing from Zabbix. This is the first file of the portal that identifies people and holds something derived from a secret, which is why this ADR amends the three above.

  ```json
  { "version": 1,
    "users": [{ "id": "<internal id>", "name": "<sign-in name>", "displayName": "<shown name>",
      "role": "operator", "modules": ["problems", "sites", "sla"], "language": "id",
      "hash": "argon2id.<m>.<t>.<p>.<salt>.<hash>", "created": 0, "createdBy": "<sign-in name>",
      "lastSignIn": 0, "disabled": false, "expires": null, "mustChange": false, "notBefore": 0 }] }
  ```

* **Roles are action levels, modules are visibility.** `guest` reads. `operator` also acknowledges and closes problems. `admin` also manages users and modules, reads the inventory scorecard, and sends or schedules the SLA report by mail. A module is one page of the menu: the Dashboard, Problems, Sites, Hosts, Devices, Latest data, Graphs, Maps, Network, Links & WAN health, Services, SLA, Capacity trends, Alert noise, Top 100 triggers, Inventory & ownership scorecard and the Assistant. An admin has every module, always. A grant is stored for each user. The form for a new user starts with the ticks of a preset for its role, and the preset is only a starting point: nothing is looked up from the role afterwards. A grant gives visibility and never an admin action: a route that needs `admin` still needs it whatever the modules.
* **Enforced on the API, not in the menu.** Hiding a link protects nothing when pages share routes. One table (`security/modules.ts`) lists each route, the modules that own it (a user needs any one of them) and the role it needs, and replaces the two lists that did this job (`ROUTE_RULES` in `auth.ts` and `PAGE_API` in `pageAccess.ts`). A route that is in no row is refused to everyone but admins, so a new route is closed by default, and a test fails when a registered route has no row. Routes that two pages both use (the problem list, for the Dashboard and for Problems) belong to both modules: that is the limit of what a per-page grant can mean, and it is stated in the handbook. `GET /api/auth/me` returns the pages this user has, with the role each needs, so the sidebar keeps working as it does now, and the list of modules.
* **The Assistant follows the grants.** Its snapshot of the estate is built in sections, each tied to a module, and a user's text holds only the sections of the modules they have. It is cached for each set of grants. What a question reads beyond the snapshot follows the pages too (SC-65, [ADR-0019](0019-let-the-portal-read-what-a-question-needs.md)): tags, inventory fields and contacts need the Inventory page, even for a model on this machine; the names of who acknowledged a problem need the operator role; and the problem lines of a site or host focus need Problems or the Dashboard, a person with neither being given counts. When something is held back the model is told so (`NOT GIVEN TO THIS USER`), so that it does not answer none about what it was never shown. Explain follows the route table: `/api/explain/problem` is for Problems and the Dashboard, `/api/explain/sla` for SLA and Services, and the Assistant page alone gives neither of them (SC-62).
* **Old names keep working.** In `.env`, `viewer` reads as a guest with the modules a viewer had, `wall` as a guest with those and the network ones (Network, Links & WAN health), and `operator` and `admin` as themselves. A user with no role in `.env` is a guest, as before.
* **One administrator stays in `.env`.** The first `admin` entry of `PORTAL_USERS`, or the `PORTAL_USER` and `PORTAL_PASS` pair, is the break-glass account. It signs in with the password in `.env` whatever the state of the file, is listed as "kept in `.env`", and cannot be edited, disabled or demoted from the page. A user of the file may not take its name. If the file is lost or broken, this is how the portal is repaired.
* **The other `.env` users are a seed.** At every start, a name that is in `PORTAL_USERS` and not in the file is added to it, with a hash made from its password and the modules of the preset for its role. A name that the file already holds is left alone, and the log says once that `.env` was not used for it. So `.env` still adds a person and a change on the page is not undone by a restart. The log also asks for the entries to be deleted from `PORTAL_USERS` once they are in the file (the first administrator stays): while they stay, a file that is lost brings every one of them back from `.env` with the role and the password written there, disabled people included (SC-68). The import is kept as it is, and not made a one-time act, so that a portal started on a new volume still has its people. A person copied in earlier and since taken out of `PORTAL_USERS` still signs in, because the file decides: the start names them, and the way to end their access is Disable on the Users page (SC-67).
* **How it is written.** As `closed-months.json` is (ADR-0016): the whole file to a temporary file in the same folder, synced, then renamed into place, mode 0600, one change at a time. Before each replacement the old file is kept as `users.json.prev`. At start, a file that cannot be read, or is of another version, is put aside as `users.json.broken-<time>`, never deleted, and `users.json.prev` is tried; if that cannot be read either, the portal starts with the `.env` users alone and says so in the log. A user record that is wrong is dropped with a line in the log, and the rest are kept.
* **Without a data folder.** The users stay in `.env` as they are today, the page lists them as read-only and says why, and nothing is written. A portal that cannot keep its users still lets them in.
* **Passwords.** A hash is Argon2id or scrypt, with its settings inside it, so a hash of either kind keeps verifying. New hashes are Argon2id at OWASP's first setting of 46 MiB, one pass and one lane (`argon2id.<m>.<t>.<p>.<salt>.<hash>`, the memory in KiB), made with Node's own `crypto.argon2`, which has been there since Node 24.7, and scrypt at N=2^15, r=8, p=3 on a Node without it. A hash made with weaker settings than its kind's, or a plain password imported from `.env`, is rewritten at the next successful sign-in. A scrypt hash is rewritten as Argon2id too, on a Node that has `crypto.argon2` (SC-60), so a build from before 18 November cannot read it afterwards (DC-69); a user who signs in on a Node without it keeps the scrypt hash. Tried on an image built for x86-64 on 18 November 2026: Node 24.22.2 has `crypto.argon2`, a user added on the Users page and signed in through a TLS proxy was stored with an `argon2id.47104.1.1` hash, and that hash verified again after the volume was backed up, wiped and restored. A password is at least eight characters, not on the short list, not a placeholder. A new user gets a password set by the admin and must change it at the first sign-in (`mustChange`). A reset by an admin and a change by the user both void the user's older sessions (`notBefore`).
* **A new password has a rule, and a wrong name costs a check.** A password chosen on the page has 8 to 256 characters, is not on a list of 308 passwords that people choose (keyboard walks, runs of digits, well-known words with digits or signs after them, with office and Indonesian ones) and is not one of 97 base words with an ending of digits and signs or look-alike letters (`Welcome2026!`), and does not hold `hcml` or the sign-in name (SC-71). It is only ever read as text: read as a stored hash, a typed password of the shape of one made the server work out a hash on its main thread (SC-58). Where hashes are in use, an unknown name and an account whose password is plain text pay one hash check as a decoy, so that the time of a wrong password does not say which names exist (SC-60), and an older scrypt hash is rewritten as Argon2id at the next sign-in. Besides the lock for one name (10 failures in a row, a minute doubling to five), an address that fails 30 times in 15 minutes over at least 10 different names is locked the same way, so that one password tried once on each name is slowed too (SC-61).
* **Sessions end with the account.** A live stream is judged when it opens, so it is ended when the person is disabled, passes their expiry, has a role or pages changed, has the password reset or changes their own, when the token ends, and at sign-out; the screen reconnects as the account allows now (SC-57). Disabling a person sets the moment before which their tokens are void, so Enable does not bring an old token back.
* **A person can ask for an account (FR-62).** A form on the sign-in page leaves a name, the pages wanted and a reason; an administrator approves it on the Users page, which makes the account with a temporary password as before, or refuses it. It is off unless `ACCOUNT_REQUESTS=true`, and it needs sign-in on and a data folder. It is the one public route that writes to disk, so it is held: the portal's own header and origin, text cleaned of control characters, 50 requests waiting at most, 3 a day from one address, a copy of a waiting request dropped without a word (so the form says nothing of who is known), thirty days of life, and one log line for each step that never holds the reason. The requests are in `requests.json` on the same volume.
* **Disable, never delete.** A disabled user cannot sign in and is refused on the next request of a session already open. The record stays, so the audit trail keeps its names and a name is never reused by someone else. A guest can be given an expiry date, which has the same effect when it passes. The last enabled admin cannot be disabled or demoted, and no one can disable or demote their own account.
* **Audit.** Each sign-in, creation, change of role or modules, password change, reset, disabling and enabling is one log line: who, what, whom and from which address. Never a password or a hash.
* **Backup and transport.** `users.json` is on the state volume, so it is in the backup of that volume ([backup-and-restore](../../operations/backup-and-restore.md)), which is encrypted and kept off the machine, and it is treated as a secret there. Real accounts wait for HTTPS: the Users page says so when the connection is not encrypted.
* **SSO prepared, not built.** A user has an internal id, and a sign-in provider is an interface with one implementation, the local password. A person who later arrives through an identity provider is matched to a record by that provider's subject, and the provider's groups can map to a role and modules. It needs HCML's provider and the portal's final HTTPS name, and is built then.
* **When this moves to SQLite.** About a hundred users, a second portal instance (a file on one volume cannot be shared), or HCML naming a database it wants the portal to use. `UserStore` is the seam, and the move is a new implementation of it and a one-time import.

### Positive Consequences

* A person can be added, changed, disabled and given modules from a page, and it takes effect at once, with no restart and no edit of a secret file.
* A lost or broken file cannot lock the portal: one administrator is in `.env`.
* The password of a user is not read from `.env` again once the user is in the file, provided the entry is deleted from `.env` as the start asks (SC-68), and it is never in clear text anywhere that the portal writes.
* SSO and a database are a step from here, not a rewrite.

### Negative Consequences

* **The portal now keeps a file that identifies people and holds hashes.** ADR-0003, ADR-0015 and ADR-0016 said that it would not. The file is one line of about 300 bytes a user, mode 0600, on a volume that is backed up encrypted, and the owner has chosen it.
* **A second source of truth for a name.** `.env` seeds the file and then stops mattering for that name, which surprises a person who edits `.env` and sees nothing change. The log says so, and the handbook does too.
* **A grant on a route two pages share is shared.** A user with the Dashboard and not Problems can still read the problem list, because the Dashboard shows it. Per-page grants cannot be stricter than the pages are.
* **One instance only.** Two portals on one volume would overwrite each other's changes. The deployment has one.
* **A check costs 46 MiB of memory.** About 30 ms for Argon2id, against 127 ms for the scrypt it replaces, timed on the development Mac on 18 November 2026 (a server may take longer), on a sign-in that is rare and limited to ten attempts a minute. An unknown name costs one too.
* **A build from before 18 November 2026 cannot read an Argon2id hash.** It takes any text that does not begin with `scrypt.` for a plain password, so a user whose hash was written as Argon2id (a new user, a changed password, or an old hash rewritten at a sign-in) cannot sign in on that build until an administrator sets the password again. The break-glass administrator of `.env` is not affected. Before going back to an older image, keep the copy of `users.json` taken before the update ([backup-and-restore](../../operations/backup-and-restore.md)) and put it back with the old image.
* **A Node without Argon2 cannot check an Argon2id hash.** The image pins Node 24.22 and `engines` asks for 24, so this holds only for a development run on an older Node, which then makes scrypt hashes and refuses to sign in a user whose hash is Argon2id.

## Pros and Cons of the Options

### `PORTAL_USERS` in `.env`, with modules added

* Good, because nothing new is stored and nothing changes for the owner.
* Bad, because every change is an edit of a secret file and a restart, passwords may stay in clear text, and there is no audit and no disabling.

### A users file of its own

* Good, because it is the smallest thing that fixes all of that, and it is the pattern the portal already uses and tests.
* Bad, because it is one more file to back up, it holds hashes, and it cannot be shared by two instances.

### SQLite

* Good, because it is the upgrade path for users, audit and anything else the portal will want to keep, with transactions.
* Bad, because a binary file cannot be read or repaired by hand, and a few dozen users do not need it. `node:sqlite` was run on the shipped base image on 18 November 2026 (Node 24.22.2 on Alpine, as the unprivileged user with a read-only root): it opened a database on a volume with the write-ahead log, wrote, and read the row back after reopening. That removes the doubt about the image, not the other two reasons.

### A database server

* Good, because it is what a larger system would use.
* Bad, because HCML has not named a database, the owner's rule of 26 October holds CRUD until it does, and it would be a third container for a few dozen rows.

### The identity provider alone

* Good, because the portal would hold no password at all.
* Bad, because HCML has not named a provider and SSO is later, and a portal with no local account has no way in when the provider is down.

## Links

* [ADR-0003](0003-no-database.md), [ADR-0015](0015-keep-a-small-state-file-for-recipients-and-the-schedule.md), [ADR-0016](0016-keep-the-web-check-figures-of-closed-months.md): what this amends
* [`docs/operations/backup-and-restore.md`](../../operations/backup-and-restore.md)
* [`docs/handover/3-integrations/sign-in.md`](../../handover/3-integrations/sign-in.md) and [`docs/handover/0-everyone/who-can-do-what.md`](../../handover/0-everyone/who-can-do-what.md)
* `server/src/security/modules.ts`, `server/src/security/userStore.ts`, `server/src/security/passwords.ts`
