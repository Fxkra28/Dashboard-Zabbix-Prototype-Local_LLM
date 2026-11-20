# setup.md: How the HCML Monitoring Portal Works

A deep-dive into the architecture, data flow, and the Zabbix-native features this portal
re-implements. Read [README.md](README.md) first for installation and configuration; this document
explains *how it all fits together* and *why*.

It is the reference you grep, not the one you read front to back: 29 parts, one per subsystem, each a file in [`docs/setup/`](docs/setup/).
Sections 14 to 26 are the only written record of why the derived figures are calculated the way they
are, so they matter most when a number has to be defended.

**§§27 to 29 were reconstructed on 22 September 2026**, not restored. They cover the limitations, the
glossary and HCML's six goals: the three things lost when `DOCUMENTATION.md` was deleted on 21
September without ever having been committed. Each says what it was rebuilt from.

For the API contract go to [`docs/api/openapi.yaml`](docs/api/openapi.yaml), which is checked against
the code; for *why* the system is shaped this way go to
[`docs/architecture/adr/`](docs/architecture/adr/).

> On the section citations in the code. Comments across `server/src` and `web/src` cite sections
> of this file: `setup.md §9`, `§20`, `§18` and so on. Until 21 Sep 2026 they cited `instruct.md`,
> the original build brief, which lives outside both repos at `myown/documents/plan/instruct.md` and so
> could not be followed from a clone. The rules themselves did not change; the citations now point at
> the in-repo document that carries them.

## Contents

| § | Part |
|---|---|
| 1 | [The big picture](docs/setup/01-the-big-picture.md) |
| 2 | [Request lifecycle (a concrete example)](docs/setup/02-request-lifecycle.md) |
| 3 | [Zabbix-native feature mapping](docs/setup/03-zabbix-native-feature-mapping.md) |
| 4 | [The "logics" that match Zabbix](docs/setup/04-the-logics-that-match-zabbix.md) |
| 5 | [Backend (BFF): layers and endpoints](docs/setup/05-backend-file-by-file.md) |
| 6 | [Frontend: structure](docs/setup/06-frontend-structure.md) |
| 7 | [Live updates (SSE)](docs/setup/07-live-updates.md) |
| 8 | [Authentication (mechanics)](docs/setup/08-authentication.md) |
| 9 | [Caching strategy](docs/setup/09-caching-strategy.md) |
| 10 | [Network monitoring (SNMP / ICMP)](docs/setup/10-network-monitoring.md) |
| 11 | [Running & deploying](docs/setup/11-running-deploying.md) |
| 12 | [Extending the portal (recipe)](docs/setup/12-extending-the-portal.md) |
| 13 | [Plain-language layer (AI)](docs/setup/13-plain-language-layer.md) |
| 14 | [Site view](docs/setup/14-site-view.md) |
| 15 | [Services tree](docs/setup/15-services-tree.md) |
| 16 | [Inventory & ownership scorecard](docs/setup/16-inventory-ownership-scorecard.md) |
| 17 | [Link & WAN health](docs/setup/17-link-wan-health.md) |
| 18 | [Automated reporting](docs/setup/18-automated-reporting.md) |
| 19 | [Authentication & RBAC](docs/setup/19-authentication-rbac.md) |
| 20 | [Acknowledge / close write-back](docs/setup/20-acknowledge-close-write-back.md) |
| 21 | [Alert noise / flapping](docs/setup/21-alert-noise-flapping.md) |
| 22 | [Testing](docs/setup/22-testing.md) |
| 23 | [Hardening: timeouts, rate limiting, headers](docs/setup/23-hardening-timeouts-rate-limiting-headers.md) |
| 24 | [Assistant (chat)](docs/setup/24-assistant.md) |
| 25 | [Derived SLA and services](docs/setup/25-derived-sla-and-services.md) |
| 26 | [Reachability, caching and operations (second pass, 17 Sep 2026)](docs/setup/26-reachability-caching-and-operations.md) |
| 27 | [Limitations and known gaps](docs/setup/27-limitations-and-known-gaps.md) |
| 28 | [Glossary](docs/setup/28-glossary.md) |
| 29 | [HCML's six optimisation goals, indexed](docs/setup/29-hcmls-six-optimisation-goals-indexed.md) |
