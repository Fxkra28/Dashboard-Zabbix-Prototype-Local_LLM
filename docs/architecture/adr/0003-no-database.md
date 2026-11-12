# The portal owns no database: derive per request, cache in memory

* Status: accepted
* Deciders: HCML internship project
* Date: 2026-09-07 (recorded as an ADR 2026-09-22)
* Amended: 2026-10-07, the claim that the portal has no state to back up (the `.env` files are state)
* Amended: 2026-11-04, by [ADR-0015](0015-keep-a-small-state-file-for-recipients-and-the-schedule.md): the hosted copy keeps one small file of its own, on a volume

## Context and Problem Statement

The portal presents concepts Zabbix has no table for: sites, WAN links, incidents, host reachability,
a monthly SLA. Something has to produce them. Should the portal own a datastore to keep them in?

## Decision Drivers

* Two sources of truth for the same number is the classic way to ship a wrong dashboard.
* Anything stored must be backed up, migrated, and kept in step with Zabbix.
* The estate is small: 139 hosts, ~660 open problems, 23 host groups.
* Most screens need data that is seconds old, which a copy cannot be.

## Considered Options

* No store. Derive on every request; cache in process for seconds.
* Redis. A shared cache, so several BFF instances and SSE fan-out can share state.
* An application database (PostgreSQL) holding the derived entities.
* A mirror of Zabbix's measurement data, so the portal queries its own copy.

## Decision Outcome

Chosen: **no store at all.** Every derived value is computed per request and held in a single
module-level `Map` with an LRU cap of 500 entries or about 64 MB and per-key TTLs from 15 seconds to 24 hours.

The cache coalesces concurrent misses onto one upstream fetch, so twenty NOC screens cost one Zabbix
read. The slow report families may serve a stale value rather than an error, and say so in two response
headers (`X-Data-Stale`, `X-Data-Age-Seconds`); since 29 October 2026 the views HCML's Zabbix takes tens of
seconds to build may answer from their last copy while a newer one is read, with `X-Data-Refreshing`
and its age. The problem list never may.

### Positive Consequences

* **There is one source of truth, and it is Zabbix.** The portal cannot disagree with it.
* No database to back up, no migration to run, no schema to version. The portal's settings are the
  exception: see the first negative consequence below.
* Deleting the portal leaves no data behind, only its `.env` files and, in the hosted copy, one small
  volume ([ADR-0015](0015-keep-a-small-state-file-for-recipients-and-the-schedule.md)). The local-model
  copy's compose file declares no volumes at all.
* Freshness is a TTL, visible in one place per route, not an ETL schedule.

### Negative Consequences

* **The `.env` files are the portal's only state, and nothing backs them up.** The users and their
  roles (`PORTAL_USERS`), the Zabbix read and write tokens, the model key, `JWT_SECRET` and the SLA
  settings live there. Git ignores them on purpose, so a lost laptop or a deleted file takes all of
  it, and this ADR once said the portal had no state to back up, which was wrong (corrected
  2026-10-07, tracker IN-24). The answer is a backup of those files, kept encrypted and off the
  machine, and a versioned list of the non-secret settings:
  [`operations/backup-and-restore.md`](../../operations/backup-and-restore.md) and
  `deploy/settings.example`.
* Everything is lost on restart: including a closed month's SLA report that had been cached for
  24 hours and is, by definition, never going to change again. That report costs ~20 Zabbix calls to
  rebuild and it is rebuilt after every deploy, twice, because two stacks run.
* The 24-hour TTL is a ceiling, not a floor. Keys are parameterised: `graph:<ids>:<from>:<to>`,
  `net:interfaces:<hostid>` across 139 hosts, against a 500-entry cap, so ordinary browsing can evict a
  fresh SLA report within minutes. **Nobody has measured the real hit rate.**
* Portal-side state has nowhere to live. `security/auth.ts:174` says it outright: *"Users come from env:
  there is no database yet (that phase was deferred)."* Consequences: a password may still sit in
  plain text in the `.env` file (an scrypt hash is accepted since 7 October 2026), adding a user needs
  a restart, there are no saved views, and, because the single write uses one shared Zabbix token,
  Zabbix structurally cannot record which portal operator acknowledged an event. No Zabbix table could
  hold that.
* Horizontal scaling would need Redis, because the cache and the SSE client set are per process.

## Pros and Cons of the Options

### No store

* Good, because it makes a stale-data class of bug impossible.
* Bad, because it also makes durable portal-side state impossible.

### Redis

* Good, because it survives a restart and allows more than one instance.
* Bad, because it is a third container for an estate of 139 hosts and one instance.
* The `docker-compose.yml` service exists, commented out, for exactly this reason.

### An application database for derived entities

* Good, because the closed-month SLA would be computed once, ever.
* Bad, because the derived entities are cheap: the expensive one is the SLA, and that is a handful of
  immutable rows per year, not a database's worth. 139 hosts × 12 months ≈ 1,668 rows.

### A mirror of Zabbix's measurement data

* Good, because it would outlive Zabbix's own retention: 31 days of history, 365 of trends.
* Bad, because it is a third copy of HCML production data, plus an ETL to keep alive.
* Bad, because Zabbix's own tables are hostile to it: `trends_uint` (102.9 M rows) has exactly one
  index, the clustered primary key.
* Rejected in [ADR-0007](0007-keep-the-zabbix-api.md) after measurement, not on principle.

## Links

* Follows [ADR-0001](0001-bff-over-zabbix-api.md)
* Confirmed by [ADR-0007](0007-keep-the-zabbix-api.md)
* [`operations/backup-and-restore.md`](../../operations/backup-and-restore.md): what the portal does keep
* `setup.md` §9 *Caching strategy*; `server/src/core/cache.ts`
* `flow/DataFlow.pdf`: every green box is derived and has no table anywhere
