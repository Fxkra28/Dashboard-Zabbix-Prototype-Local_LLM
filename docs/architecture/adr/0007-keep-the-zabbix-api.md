# Keep the Zabbix API as the source of truth; do not mirror its telemetry

* Status: accepted
* Deciders: HCML internship project
* Date: 2026-09-22

Technical Story: *"Is it better to use Zabbix to get the data, or make my own SQL database?"*, asked
because the Zabbix web UI is slow and some portal reports take seconds.

## Context and Problem Statement

The portal reads everything over Zabbix's JSON-RPC API. Zabbix already has a MySQL database behind
that API. The heavy reports are visibly slow: a 365-day capacity report took 1.7 s warm, a monthly
SLA 1.4 s. Should the portal keep going through the API, query Zabbix's MySQL directly, or build a
datastore of its own?

## Decision Drivers

* Whatever answers this must be measured, not argued. Nine days of logs contained no per-stage
  timing at all, and the monthly SLA had never been timed once.
* HCML production data already exists twice on this laptop: an 8 GB dump and a 19 GB volume. A third
  copy needs a real justification.
* Zabbix's internal schema is not a public interface and changes between major versions.

## Considered Options

* A: the Zabbix JSON-RPC API, as today.
* B: direct read-only SQL against Zabbix's own MySQL. Not a new database; a second door into the
  same one.
* C: a portal-owned datastore, fed from Zabbix.

## Decision Outcome

Chosen: **A stays the source of truth. C is rejected for telemetry. B is justified but deferred behind
three cheaper fixes.**

The measurement, taken 22 September against the frozen production copy, did not say what anyone
expected. The pre-registered prediction was that MySQL would be under 20 % of wall clock and the cost
would be the API boundary: serialisation, HTTP, JSON parsing. That was wrong, and so was the
opposite.

> **One trivial `host.get` with `countOutput: true` (a call returning a single integer) costs
> 20 SQL statements and examines 582 rows.** Rendering the Zabbix login page, which shows no data
> at all, costs 17.

About 19 of those 20 are fixed per-call overhead: authenticate the token, load the session, read
`config`, resolve permissions. The 365-day capacity report makes ~112 API calls, because `trend.get`
is sliced to stay inside Zabbix's PHP memory limit, so it pays that toll 112 times:

| | Wall | SQL statements |
|---|---:|---:|
| Zabbix API | 1.71 s | 10,771 |
| The same question as SQL | 0.317 s | 2 |

**The cost is neither the network boundary nor the volume of data. It is Zabbix's per-request
frontend overhead.** That reframes everything: a datastore of your own would not make the *Zabbix UI*
any faster, because the UI still runs Zabbix's PHP and still pays the 17 statements.

### Positive Consequences

* One source of truth survives. The portal cannot disagree with Zabbix.
* No third copy of HCML production data, no ETL, no retention policy to own.
* Three cheaper fixes were found, ranked, and they come first:
  1. Re-tune `TREND_MAX_ROWS`. The 112-call slicing exists for a 128 MB PHP limit that has been
     512 MB since 17 September; nobody re-tuned it. One constant.
  2. Persist closed-month SLA results to a file: 1,668 rows a year, ~326 KiB.
  3. Lazy-load the second SLA profile, which the page currently fetches eagerly alongside the first.
* The decision now rests on numbers that are written down and reproducible.

### Negative Consequences

* **The slow reports stay slow until those three fixes land.** This ADR defers work rather than doing it.
* Option B is left on the table rather than settled, so the question can be reopened: deliberately,
  but it is still an open loop.
* Retention is a real limit that this decision accepts. Zabbix housekeeping keeps 31 days of
  history and 365 of trends. Any analysis beyond a year is impossible from the API, and nothing the
  portal does today needs it. If that changes, the answer is an archive, not a live mirror.
* Measured single-user and single-shot, on one laptop with Docker Desktop in the path. Valid
  arm-versus-arm on this copy only; the absolute milliseconds do not transfer.

## Pros and Cons of the Options

### A: the Zabbix API

* Good, because it is the supported public interface and survives upgrades.
* Good, because it enforces Zabbix's own permissions.
* Bad, because ~20 SQL statements of fixed overhead per call is unavoidable through it.

### B: direct SQL against Zabbix's MySQL

* Good, because it skips the frontend entirely. Measured 5.4× on the capacity report.
* Bad, because it binds to an internal schema that is explicitly not an API.
* Bad, because it bypasses Zabbix's permission model.
* Bad, because there is no route to it today: `mysql` publishes no port and the stacks share no
  network, so enabling it means re-opening something that was deliberately closed.

### C: a portal-owned datastore for telemetry

* Good, because it could outlive Zabbix's retention.
* Bad, because it is no faster than B: the portal's queries are all anchored on known item ids,
  and `trends_uint`'s clustered primary key `(itemid, clock)` is already optimal for them. No index
  you could add to your own schema would help. You would pay ETL, retention and staleness to buy what
  B gives for nothing.
* Bad, because `trends_uint.value_avg` is `bigint unsigned`: hourly averages are already
  integer-truncated upstream, so copying preserves the loss rather than fixing it.

## Links

* Supersedes the deleted `Proto1/DECISION.md`, which asked this question and never answered it
* Confirms [ADR-0003](0003-no-database.md) for telemetry, and leaves its portal-state gap open
* Full measurement: `myown/bench/README.md`, `myown/bench/results/gate0-2026-09-22.md`
