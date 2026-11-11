# Documentation

A branded, read-only operations portal over HCML's Zabbix 7.0: 139 monitored hosts across 14 sites.
The portal presents things Zabbix has no table for: sites, WAN links, incidents, host reachability and
a monthly availability figure validated against HCML's own published reports.

**This copy is `hcml-portal-ollama`.** Its plain-language layer is `qwen3:8b` running on this host, so
no question and no summary of the estate leaves the machine. The sibling `hcml-portal` runs the same code against
hosted Claude, where it does. (It never emails a report either: its compose file passes no mail settings.) Which model answers is one line of `.env` under `npm run dev`, and
fixed to the local model by this copy's `docker-compose.yml`:
[ADR-0005](architecture/adr/0005-provider-neutral-ai-layer.md).

```text
Browser (React)  ──HTTP+SSE──►  BFF (Fastify, holds tokens, caches)  ──JSON-RPC──►  Zabbix API
                                         └──── HTTP ────►  Ollama on this host · qwen3:8b
```

The first arrow is plain HTTP on this computer's loopback address: nginx listens on port 8080 inside
its container and Docker publishes it on `127.0.0.1` only. Nothing in this repository terminates
TLS, so before the portal is reached from another machine, put TLS in front of it:
[`operations/tls.md`](operations/tls.md).

Nine flows are written out in that form (a page load, the live dashboard, the request pipeline, the
cache, auth, where a number comes from, both AI paths and the one write) in
[`flow/README.md`](flow/README.md#the-nine-flows-one-line-each).

## Start here

| If you want to… | Read |
|---|---|
| Run it | [`getting-started.md`](getting-started.md) |
| Back it up, or restore it | [`operations/backup-and-restore.md`](operations/backup-and-restore.md) |
| Reach it from another machine | [`operations/tls.md`](operations/tls.md): TLS in front, with HSTS |
| Know what comes back after a restart | [`operations/after-a-restart.md`](operations/after-a-restart.md): the restart policies, the order, the check |
| Call it | [`api/openapi.yaml`](api/openapi.yaml), 51 endpoints · [how to view it](api/README.md) |
| Download the monthly SLA report | [`setup/18-automated-reporting.md`](setup/18-automated-reporting.md) for the buttons, the endpoint and how the files are built |
| Understand why it is shaped this way | [`architecture/adr/`](architecture/adr/): fifteen decisions |
| See how it works | [`architecture/`](architecture/): diagrams and the subsystem index |
| See what it looks like | [`screenshots/README.md`](screenshots/README.md): the main pages as images, with every name replaced |
| See who uses it | [`ux/README.md`](ux/README.md): the four roles and the acknowledge journey, derived from the code |
| Change how it looks, or hand it to a designer | [`design-system/README.md`](design-system/README.md): the rules, the tokens, every component with its states, and the token files for Figma and Sass |
| Change something | [`../setup.md`](../setup.md), 40 parts, one per subsystem |
| Change it safely | [`contributing.md`](contributing.md): the house rules, and why each one exists |
| Take it over, or learn it from the folders down to the functions | [`handover/README.md`](handover/README.md): the handover handbook. Where everything is, what the code does, what the portal talks to, and a part for people who do not read code |
| Know what is wrong with it | [`../AUDIT_REPORT.md`](../AUDIT_REPORT.md) and `setup.md` §27 |

## The shape of it in one table

| | |
|---|---|
| Front end | React 18 + TypeScript + Vite, ECharts. 19 pages, 1769 tests, linted with eslint |
| Back end | Fastify 5 + TypeScript on Node 24. 24 route modules, 51 endpoints, 2976 tests, linted with eslint |
| Data source | The Zabbix JSON-RPC API. Nothing else: no database, no volumes, no data files |
| Writes | Exactly one: acknowledge/close, behind a separate token and the operator role |
| Downloads | The monthly SLA report as a PDF, an Excel file or a zip of CSV files, in the number and date style chosen, built when asked from the cached figures and never stored |
| State | One in-process `Map`, 500 entries or about 64 MB, TTLs from 15 s to 24 h. Lost on restart |
| Settings | Untracked `.env` files: users, roles, tokens, the signing secret and the SLA settings. **The one thing to back up**: [`operations/backup-and-restore.md`](operations/backup-and-restore.md) |

## Two facts to know first

**The portal owns no estate data, only its own settings.** Every site, link, incident and SLA figure
is computed per request and gone when the process restarts. So there is no database to back up or
migrate, and equally nothing survives a deploy. [ADR-0003](architecture/adr/0003-no-database.md).
What it does keep is its configuration. The users and their roles, the Zabbix and model tokens,
`JWT_SECRET` and the SLA settings live in untracked `.env` files that git ignores. Lose them and the
portal cannot start until someone writes them again, so keep an encrypted copy of each:
[`operations/backup-and-restore.md`](operations/backup-and-restore.md).

**The data is HCML's own, and current.** Since 29 October 2026 both portals read HCML's Zabbix through its
API. Before that they read a copy restored on a laptop and frozen at 17 September 2026 at 16:59:37, because a
development laptop should not be polling production equipment ([ADR-0008](architecture/adr/0008-stop-local-polling.md)).
HCML's Zabbix answers its biggest reads slowly, so the first visit to a page after a restart can take a minute
or more: [what waits, and for how long](operations/after-a-restart.md).

## Where everything lives

```
README.md                  install, configure, run
setup.md                   the index of the deep reference: 40 parts, one per subsystem, in docs/setup/
AUDIT_REPORT.md            what two audits found, and what is still open
tracker.md                 every row of work and its state; the history of the changes is in CHANGELOG.md
package.json               the root scripts: `npm run verify` runs every check
tools/                     check/ (the repository against itself), live/ (tools that read a running portal) and handover/ (writes the handbook)
LICENSE  SECURITY.md       the terms the code is shared on, and how to report a vulnerability
docs/
  index.md                 this file
  getting-started.md
  contributing.md          the house rules, and why each one exists
  setup/                   the deep reference, one file for each subsystem (indexed by setup.md)
  api/openapi.yaml         the contract: 51 endpoints
  architecture/adr/        why it is the way it is: 15 decisions
  schema/  flow/  erd/     the diagrams; erd/erd.md is the data model in prose
  screenshots/             the main pages as images, with host names, addresses and interface descriptions replaced
  ux/                      who uses it: the four roles and the acknowledge journey (derived, not interviewed)
  operations/              backing up and restoring the .env files; TLS beyond localhost; what comes back after a restart
  handover/                the handover handbook: folders, code, integrations and working; start at its README
deploy/
  settings.example         every non-secret setting and its default, versioned
  rebuild.sh               rebuilds the portals from the commit, then checks what came up
  watch.sh                 tells someone when a portal or a container stops: a LaunchAgent on the Mac, cron elsewhere
.github/
  workflows/ci.yml         five jobs: server, web, the eleven checkers, a secret scan, both Docker builds
  dependabot.yml           weekly pull requests for the actions, the npm packages and the base images
```

## A note on trusting these documents

Two audits and a benchmark have gone through this project, and what they kept finding was confident
documentation that nobody had checked. A sentence about a git commit was repeated into four documents
until it read as fact, and was false. An endpoint count was wrong in a summary for a week while the
table beneath it was right.

So: numbers here are dated and sourced where they matter, the API contract has an automated check
behind it, and where something is reconstructed rather than known, it says so.
