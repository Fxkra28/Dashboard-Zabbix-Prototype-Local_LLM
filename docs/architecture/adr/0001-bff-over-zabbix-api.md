# Build a read-only BFF over the Zabbix API rather than modifying Zabbix

* Status: accepted
* Deciders: HCML internship project
* Date: 2026-09-07 (recorded as an ADR 2026-09-22)

Technical Story: HCML wanted a branded operations dashboard against their existing Zabbix 7.0
installation, without risking the installation itself.

## Context and Problem Statement

HCML monitors 139 hosts in Zabbix 7.0. The operators found the stock Zabbix UI slow and hard to read,
and management wanted per-site rollups and monthly availability reporting that Zabbix does not
present. How should a better interface be built without endangering a production monitoring system?

## Decision Drivers

* The Zabbix installation is production. Breaking it breaks monitoring for the whole estate.
* Whatever is built must survive Zabbix upgrades.
* Several wanted views (sites, WAN links, incidents, a monthly SLA) have no Zabbix entity at all.
* An intern-scale project: it has to be deliverable and handover-able.

## Considered Options

* Path 0: configure Zabbix natively. Dashboards, host groups, tags, Services and SLA.
* Path 1: white-label the Zabbix frontend. Themes, a custom widget module, branding overrides.
* Path 2: Grafana over the Zabbix datasource.
* Path 3: a separate read-only BFF and web app over the Zabbix JSON-RPC API.

## Decision Outcome

Chosen: **Path 3**, with Path 0 kept for everything Zabbix already does well.

Path 3 is the only option that can express the concepts Zabbix has no table for, while touching
nothing inside the monitoring system. The portal holds a read-only API token and speaks JSON-RPC over
HTTP; it never touches Zabbix's database, its configuration or its files.

*Amended 20 October 2026 (tracker SC-23).* "Read-only token" here, and in "the blast radius on Zabbix is a
read-only token" below, is how the code uses the token. The read token HCML's deployment holds belongs to a
Super admin user (checked 13 October), so it describes the credential that was meant, not yet the real one.
[ADR-0006](0006-read-only-with-one-write.md) has the detail.

### Positive Consequences

* **Zabbix cannot be damaged by the portal.** The read token cannot write, and there is no filesystem
  or database access at all. See [ADR-0006](0006-read-only-with-one-write.md).
* Sites, links, incidents, reachability and the monthly SLA become expressible.
* The API is Zabbix's supported public interface, so a minor upgrade is very unlikely to break it.
* The portal can be deleted without trace; nothing in Zabbix depends on it.

### Negative Consequences

* Everything is recomputed, because nothing is stored: see [ADR-0003](0003-no-database.md).
* A second thing to operate: two containers, a token to rotate, a deployment to keep alive.
* The JSON-RPC boundary is chatty and it costs real time. Measured 22 Sep 2026: one trivial
  `host.get` costs 20 SQL statements upstream, and a 365-day capacity report costs 10,771. See
  [ADR-0007](0007-keep-the-zabbix-api.md).
* Anything Zabbix does natively is now either duplicated or absent. Every page had to be justified
  against "could Zabbix just do this?", `setup.md` §3 is that audit.

## Pros and Cons of the Options

### Path 0: configure Zabbix natively

* Good, because there is nothing extra to run, secure or hand over.
* Good, because it survives upgrades by construction.
* Bad, because dashboards cannot express a derived site rollup: no HCML host carries a site tag, so
  sites have to be parsed out of host names.
* Bad, because Zabbix's Services and SLA are unconfigured at HCML: the `services` table has 0 rows
  and `sla` holds one placeholder. See [ADR-0004](0004-derive-the-sla-in-the-portal.md).
* Kept anyway for collection, triggers, maps and alerting. The portal reads what Path 0 produces.

### Path 1: white-label the Zabbix frontend

* Good, because it reuses every existing page.
* Bad, because it means maintaining a patched copy of a PHP application and re-applying the patches at
  every upgrade.
* Bad, because the frontend is the slow part. Measured: 17 SQL statements to render the login page,
  a page with no data on it. Rebranding it would not make it faster.

### Path 2: Grafana over the Zabbix datasource

* Good, because dashboards and alerting come free.
* Bad, because white-labelling Grafana OSS is an Enterprise feature.
* Bad, because embedding requires `allow_embedding`, which disables framing protection globally.
* Bad, because the derived SLA would still have to be computed somewhere.

### Path 3: a separate BFF

* Good, because the derived layer becomes ordinary code with tests.
* Good, because the blast radius on Zabbix is a read-only token.
* Bad, because it is the most code to write and the most to hand over.

## Links

* Refined by [ADR-0003](0003-no-database.md), [ADR-0006](0006-read-only-with-one-write.md)
* Revisited by [ADR-0007](0007-keep-the-zabbix-api.md)
* `setup.md` §1 *The big picture*, §3 *Zabbix-native feature mapping*
* `flow/ServerFlow.pdf` traces one request through this boundary
