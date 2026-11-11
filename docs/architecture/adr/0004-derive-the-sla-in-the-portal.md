# Compute the monthly SLA in the portal instead of using Zabbix Services and SLA

* Status: accepted
* Deciders: HCML internship project
* Date: 2026-09-15 (recorded as an ADR 2026-09-22, with the confirming measurement)

## Context and Problem Statement

HCML publishes a monthly Availability Report per device. Zabbix 7.0 ships a Services tree and an SLA
engine that exist to answer exactly this. Should the portal use them, or measure availability itself?

## Decision Drivers

* The answer must reproduce HCML's published figures, or nobody will trust the page.
* Whatever is chosen must work against HCML's Zabbix as it is actually configured.
* The portal is forbidden from writing configuration into production Zabbix.

## Considered Options

* Use Zabbix's native Services + SLA (`service.get`, `sla.get`, `sla.getsli`).
* Configure Services in Zabbix first, then use the native engine.
* Replay trigger events in the portal and compute availability there.

## Decision Outcome

Chosen: **replay the events in the portal.**

The deciding fact is not an opinion about which engine is better. It is that there is nothing in
Zabbix's to use. Measured directly against the production copy on 22 September 2026:

| Table | Rows |
|---|---|
| `services` | 0 |
| `services_links`, `service_problem`, `service_alarms`, `service_tag` | 0 |
| `sla` | 1, `SLA:1`, weekly, SLO 99, no service tags, no schedule, nothing attached |

Zabbix's SLA engine has nothing to measure. `sla.getsli` against it returns an empty result, which is
why `/api/sla/source` exists at all: it reports `real: false` and the UI switches to the derived view.

The engine replays trigger PROBLEM/OK events into intervals, clips them to the window, merges
overlaps so two simultaneous problems are not counted twice, and aggregates by host, site, category
and class. Two profiles: `hcml-report` reproduces HCML's method, `availability` is the stricter figure
that also requires evidence the data was actually collected.

Planned maintenance, decided 25 September 2026: time inside a Zabbix maintenance window counts
neither as down nor in the total, in both profiles, and the report says so in
`basis.maintenancePolicy`. The windows come from `maintenance.get`, expanded per host in
`sli/maintenance.ts`, so an edited or deleted period changes past months too. On that day HCML's Zabbix
defined no maintenance periods at all, so no published figure changed.

### Positive Consequences

* **It is validated to the digit** against HCML's own xlsx reports by
  `server/scripts/validate-sli.ts`: 2026-06 99.3796 %, 2026-07 99.7167 %, 2026-08
  99.2313 %; 138 of 138 hosts within 60 seconds of downtime; incident counts 739/739, 1165/1165,
  1417/1417. That is the strongest correctness claim anywhere in the project.
* The method is inspectable. `basis` in every response states which triggers count and how gaps
  and no-data are treated, so two profiles can be compared like for like instead of argued about.
* It requires no write into production Zabbix, which the portal is not permitted to make.
* It works today, against the estate as configured, with nobody configuring anything first.

### Negative Consequences

* **It is a reimplementation of something Zabbix ships**, and it has to stay correct as Zabbix's own
  semantics evolve.
* It is the second most expensive thing the portal does. The strict profile costs ~20 Zabbix calls
  and pulls up to ~103,000 trend rows for one month, and about 97 % of those rows exist only to
  answer one boolean per item-hour, "did this hour collect data?".
* Its `stats.zabbixCalls` counter under-reports: sliced `event.get` recursion is counted once, so
  the true call count is higher whenever a window exceeds 5,000 events.
* If HCML ever configures Services properly, this becomes duplication and should be revisited.
* A closed month's figure is immutable but is still recomputed after every restart. See
  [ADR-0003](0003-no-database.md).

## Pros and Cons of the Options

### Use Zabbix's native Services + SLA

* Good, because it would be Zabbix's own answer, maintained by Zabbix.
* Bad, because at HCML it returns nothing. Zero services.
* Bad, because it is not the cheap lookup it appears to be: no table stores an SLI. `sla.getsli`
  replays `service_alarms` on every call, so it moves the same replay into PHP rather than reading a
  stored value.

### Configure Services in Zabbix first

* Good, because it would make the native engine usable and benefit every Zabbix consumer, not just
  the portal.
* Bad, because it means creating ~139 services and SLAs by writing configuration into HCML's
  production Zabbix: which this project is explicitly not allowed to do.
* Worth revisiting if HCML's own team wants it. It is the better long-term answer; it is simply
  not the portal's to make.

### Replay events in the portal

* Good, because it is verifiable against a published external figure.
* Bad, because it is a reimplementation with a real maintenance cost.

## Links

* Depends on [ADR-0003](0003-no-database.md)
* `setup.md` §25 *Derived SLA and services*; `server/src/sli/engine.ts`
* Validation: `server/scripts/validate-sli.ts`
* Measurement: `myown/bench/results/gate0-2026-09-22.md`
