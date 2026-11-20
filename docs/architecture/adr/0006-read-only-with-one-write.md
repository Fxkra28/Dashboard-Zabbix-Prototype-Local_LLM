# Read-only by default, with exactly one write behind a separate token

* Status: accepted
* Deciders: HCML internship project
* Date: 2026-09-10 (recorded as an ADR 2026-09-22)
* Amended: 2026-11-17, by [ADR-0017](0017-keep-the-portals-users-in-a-file-of-their-own.md): the roles are now `guest`, `operator` and `admin`, and each person has a list of pages. Where this record says `viewer` or `wall`, read a guest, and for `wall` a guest who has the Network and Links pages. The write still needs `operator`

## Context and Problem Statement

Operators asked to acknowledge and close problems from the portal rather than switching to Zabbix. The
portal reads HCML's production monitoring system. Any write it can make, a bug in it can make too.

## Decision Drivers

* A bug in an intern project must not be able to delete or alter monitoring configuration.
* Acknowledging is genuinely useful and genuinely low-risk: it annotates an event, it does not change
  what is monitored.
* A deployment that has not opted in to writing should not be able to write at all.

## Considered Options

* No writes. The portal stays a viewer; operators use Zabbix to acknowledge.
* One token with write permission, used for both reads and the write.
* Two tokens: a read-only one for everything, a separate write-capable one for the single write.

## Decision Outcome

Chosen: **two tokens, one write path, three independent gates.**

`ZABBIX_API_TOKEN` is read-only and used by every read. `ZABBIX_WRITE_TOKEN` is separate,
write-capable, and used by exactly one call: `event.acknowledge`, reached only through
`POST /api/problems/acknowledge`.

The gates:

1. Credential. The read token physically cannot write. A write attempt with no write token throws
   before any request leaves the process.
2. Role. The route requires `operator`. Unmatched routes default to `viewer`, so a new route is
   protected by accident rather than exposed by accident.
3. Configuration. With no write token the route returns 503, and `GET /api/health` reports
   `writeBack: false` so the UI hides the buttons instead of offering a call that will fail.

*Amended 20 October 2026.* Gate 1 holds for the portal's code, which uses the read token only
through `zbx()` and the write token only through `zbxWrite()`. For the credential to hold it as well, the read token
should belong to a user whose role allows only the read methods (a change in Zabbix, which is HCML's to make). Until
then, read "cannot write" in this record as "is never used to write", and
"provably read-only" below as a statement about the code.

Event ids must match `/^\d+$/` before reaching Zabbix, the message is capped at 2,048 characters, the
acting user is logged, the cache prefixes that show problem state are invalidated with a 15-second hold, and the change is
pushed to every open SSE client immediately.

### Positive Consequences

* **The entire attack surface against Zabbix is one API method.** Not one route, one *method*: there
  is no `*.create`, `*.update`, `*.delete` or `configuration.import` anywhere in the codebase.
* A deployment that never sets the write token is provably read-only.
* Closing is only offered where Zabbix permits it: `GET /api/problems` carries `manualClose` per
  problem, so the UI never shows a button Zabbix will reject.
* The post-write cache hold closes the race where a refetch issued before the write lands re-caches
  the stale list.

### Negative Consequences

* **Zabbix cannot tell portal operators apart.** All writes carry the one shared token, so the Zabbix
  audit log shows the portal, not the person. There is no Zabbix table that could hold that
  attribution, and the portal has nowhere to keep it either. See [ADR-0003](0003-no-database.md).
  The acting user is written to stdout and then forgotten.
  *Amended 20 October 2026: since 7 October (tracker SC-08) the text of every acknowledgement starts with
  `[portal:<user>]`, so Zabbix's own record (`acknowledges.message`) does name the person, as text, and the BFF
  logs every attempt with the user, address, event ids and action ([§20](../../setup/20-acknowledge-close-write-back.md)).
  Still true: the portal keeps no record of its own.*
* Two credentials to provision, store and rotate rather than one.
* `ROUTE_RULES` reserves `/api/problems/close` but no such route exists: a dead rule that reads
  like a missing feature.
* Roles gate by sensitivity and cost, not by write access: `admin` guards the inventory scorecard, the emailed report and the monthly send, and
  `wall` guards the network pages, none of which writes to Zabbix. That is deliberate, and it
  surprises people who expect the roles to mean read/write.

## Pros and Cons of the Options

### No writes

* Good, because the risk is exactly zero.
* Bad, because operators then keep two tabs open, which is one of the complaints the portal exists to
  answer.

### One token with write permission

* Good, because there is one secret to manage.
* Bad, because every read path in the application is then executing under a credential that could
  delete a host. The blast radius of any bug becomes the whole estate.

### Two tokens

* Good, because the dangerous credential is reachable from exactly one function.
* Bad, because it is a second secret, and because a deployment can be silently half-configured, which
  is why `/api/health` exposes `writeBack`.

## Links

* Follows [ADR-0001](0001-bff-over-zabbix-api.md)
* `setup.md` §19 *Authentication & RBAC*, §20 *Acknowledge / close write-back*
* `server/src/routes/actions.ts`, `server/src/services/actions.ts`, `server/src/clients/zabbix.ts`, `server/src/security/auth.ts`
* Contract: [`../../api/openapi.yaml`](../../api/openapi.yaml) → `POST /api/problems/acknowledge`
