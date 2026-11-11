# 5. Backend (BFF): layers and endpoints

[setup.md](../../setup.md) · previous: [§4](04-the-logics-that-match-zabbix.md) · next: [§6](06-frontend-structure.md)

Location: [`server/src/`](../../server/src/). Stack: Node 24 + Fastify 5 + TypeScript (ESM).

## Three layers

[`index.ts`](../../server/src/index.ts) builds the app and mounts the route plugins. A file in
[`routes/`](../../server/src/routes/) is the HTTP side of one area: it names the paths, checks the query or the
body, calls that area's function in [`services/`](../../server/src/services/), and sends the answer or the status.
A file in `services/` holds what the area knows: the Zabbix reads, the roll-ups, the cache keys, the prompts. It
takes plain arguments and returns plain values, so a test calls it without starting a server. What the services
share is in five folders of `server/src/` and in `sli/` and `export/`. `index.ts` is the only file at the top.

The dependencies run one way: `index.ts`, then `routes/`, then `services/`, then the shared files.
[`layering.test.ts`](../../server/src/__tests__/layering.test.ts) fails when a file other than `index.ts`
imports a route, when a service imports a route, or when a route file exports anything but its registrar. A route
therefore never reaches into another route, and what two routes both need has to live in a service. The same test
keeps `core/` free of every other folder, keeps routes and services out of the shared folders (but for the stream
count that the health check reads), lets only `index.ts` import `http/` (but for the one sentence two services show
when Zabbix cannot be read), and fails on a new file at the top of `server/src/`. The reasons are in
[ADR-0013](../architecture/adr/0013-layers-features-and-tools.md).

## Where each file is described

Every folder of `server/src/` (`core/`, `clients/`, `domain/`, `security/`, `http/`, `sli/` and `export/`), every route
with the service behind it, and every file with its purpose are described in the handover handbook, which is written
from the code and checked against it:

- [Server: core and clients](../handover/2-code/server-core-and-clients.md) and
  [domain and hosts](../handover/2-code/server-domain-and-hosts.md): the shared files and the reads of Zabbix.
- [Server: security and HTTP](../handover/2-code/server-security-and-http.md) and
  [routes](../handover/2-code/server-routes.md): the sign-in, the guard, what `index.ts` wires in, and each route.
- [SLA and reports](../handover/2-code/server-sla-and-reports.md), [export](../handover/2-code/server-export.md),
  [live and assistant](../handover/2-code/server-live-and-assistant.md) and
  [network and capacity](../handover/2-code/server-network-and-capacity.md): the services built on them.
- [Every server file with its purpose](../handover/2-code/files-server.md), and
  [one request, start to finish](../handover/2-code/one-request.md).

This part keeps the layers above and the endpoint reference below.

## Endpoint reference (+ cache TTLs)

| Method + path | Returns | Cache |
|---|---|---|
| `GET /api/health` | `{ ok, ts, ai, aiProvider, aiExternal, writeBack, defaults, ready }` for anyone (`ready` is a plain `true` or `false`), plus `version, startedAt, build, streams` and `ready` as an object for a signed-in caller: capability flags (the UI hides actions that aren't configured), the build, whether Zabbix answers, and the screens streaming. Public; 200 even when Zabbix is down | `ready` 15 s |
| `GET /api/ready` | the same facts as a signed-in `/api/health`, plus `ok`; answers 503 while the portal cannot read Zabbix, so a monitor that holds a token needs only the status code. Guarded like any route | `ready` 15 s |
| `GET /api/hosts` | hosts + interfaces (ip/type/available) | 30 s |
| `GET /api/hosts/overview` | hosts + per-host problem severity counts | 15 s |
| `GET /api/hostgroups` | host groups (real hosts only) | 60 s |
| `GET /api/items?hostid=&search=` | items of a host | 30 s |
| `GET /api/latest?hostid=\|groupid=&search=` | items + last value/time/prev | 15 s |
| `GET /api/problems` | enriched current problems | 15 s |
| `GET /api/net/devices` | network hosts + ICMP up/loss/latency | 30 s |
| `GET /api/net/meters` | the gauge widgets of a Zabbix dashboard as meters: item, capacity, colour zones, last value (wall role or above) | 30 s, the dashboard 2 min |
| `GET /api/devices` | every host with its kind of device and template, as the Hosts page lists it | 30 s |
| `GET /api/reports/top-hosts?limit=` | the hosts with the highest CPU and memory use now, 10 each unless asked (up to 20) | 30 s |
| `GET /api/reports/web-monitoring?limit=` | web scenarios that pass, fail or have no current result, and the failed ones (10 unless asked, up to 50) | 30 s |
| `GET /api/reports/top-triggers?days=` | top 100 triggers by event count | 60 s |
| `GET /api/stats` | monitored host, item, trigger and group counts + problem counts | 30 s; the item and trigger counts 1 h, read again in the background |
| `GET /api/freshness` | when Zabbix last collected a value: `{ lastCollectedAt, ageSeconds, stale, staleAfterSeconds, pinged, answering, reachLost }` | 30 s |
| `GET /api/reports/problems-by-group` | severity breakdown per host group | 15 s |
| `GET /api/maps` | map list | 60 s |
| `GET /api/maps/detail?mapid=` | one map's elements + links | 30 s |
| `GET /api/sites` | sites + rolled-up health + hosts, worst first | 15 s |
| `GET /api/sla` | configured SLAs (name, SLO, period) | 60 s |
| `GET /api/sla/sli?slaid=&serviceid=` | current-period SLI per service | 60 s |
| `GET /api/services` | service tree + roll-up status, root causes, SLA | 30 s |
| `GET /api/links` | ICMP link health, loss/latency/jitter, redundant paths | 20 s |
| `GET /api/reports/inventory` | standardisation scorecard + gap list *(admin)* | 60 s |
| `GET /api/reports/availability?days=&severity=` | per-host uptime over a window | 120 s |
| `GET /api/reports/aging` | unacknowledged problems by age | 15 s |
| `GET /api/reports/capacity?days=&top=` | CPU / memory / filesystem trends, and the busiest interfaces | 1 h, then served up to 23 h stale while it is read again |
| `GET /api/reports/noise?days=&severity=` | flapping / unactioned / chronic triggers | 120 s |
| `POST /api/problems/acknowledge` | acknowledge and/or close (operator) | writes |
| `GET /api/explain/problem?eventid=` | plain-language summary + tag glossary | 1 h |
| `GET /api/explain/sla?slaid=&serviceid=` | plain-language SLA standing | 5 min |
| `POST /api/chat` | SSE assistant answer: `context` → `token`… → `done` / `error`. See [§24](24-assistant.md#24-assistant-chat) | snapshot reads share the page caches |
| `GET /api/stream` | SSE live problems | live |
| `POST /api/auth/login` | `{ user, expiresIn }`; the token goes into the httpOnly session cookie, never the body (§8) | none |
| `GET /api/auth/me` | `{ authEnabled, user: { name, role }, expiresIn }`, drives the sidebar's role filter and times renewal | none |
| `POST /api/auth/refresh` | a fresh cookie and `{ user, expiresIn }` for a still-valid session, so an open portal stays signed in (§8) | none |
| `POST /api/auth/logout` | clears the session cookie; public, so an expired session can still sign out | none |
| `GET /api/graph` | chart-ready series for 1 to 4 numeric items over a pinned window | 15 s for a window that ends now, 10 min for one that does not |
| `GET /api/net/interfaces?hostid=` | SNMP interfaces with oper/admin status, speed, utilisation | 15 s |
| `GET /api/sli?month=&profile=` | the derived monthly SLA (§25) | 24 h for a closed month, 5 min for the current one |
| `GET /api/sli/export?month=&format=` | the monthly SLA report as a PDF, an Excel file or a zip of CSV files, not JSON, in the number and date style asked for (§18) | none of its own beyond ten seconds of reuse: it reads the cached reports `/api/sli` fills |
| `GET /api/sli/email` | whether the report can be emailed, from which address, to whom by default and how far a list may go, for administrators (§18) | none: it reads the settings and the saved list |
| `POST /api/sli/email` | emails one month's report, in one to three formats, to the addresses given (or the saved list), in the style given; administrators only (§18) | none of its own: it reads the cached reports `/api/sli` fills |
| `GET /api/sli/schedule` | the monthly send: whether it can run, how it is set, when it goes next, and the last twelve sends; administrators only (§18) | none: it reads the state file |
| `PUT /api/sli/schedule` | sets the monthly send and the saved recipients; administrators only (§18) | none |
| `PUT /api/sli/recipients` | saves the list of recipients (up to ten, each inside the allowed domains) without sending anything; administrators only (§18) | none: it writes the state file |
| `DELETE /api/sli/recipients` | deletes the saved list, and is refused with 409 while the monthly schedule sends to it; administrators only (§18) | none: it writes the state file |
| `GET /api/sla/source` | which SLA backing is in use: Zabbix services, or derived | 60 s |
| `GET /api/services/derived?month=&profile=` | the service tree derived from the estate | 30 s |
| `GET /api/chat/warm` | 202; asks the model to load now so the first question does not wait | none |

The two `/api/explain/*` routes are the only ones that cost money, so they have by far the longest
TTLs: a problem's meaning doesn't change while it's open.

> **This table is a reading aid, not the contract.** The contract is
> [`docs/api/openapi.yaml`](../api/openapi.yaml): every parameter, every status code, both
> security schemes and every response schema. It is checked against the code by
> `npx tsx tools/check/openapi.check.ts`, which fails if a route is registered and undocumented or
> documented and unregistered. The table had no check of its own, which is how it once said "16 modules,
> 35 endpoints" while listing all of them, and how it carried a duplicate `GET /api/auth/me` row
> until 22 Sep 2026. Since 20 October 2026 `tools/check/facts.check.mjs` compares its rows with the spec, one for one
> (the cache column and the descriptions are still read by a person).
