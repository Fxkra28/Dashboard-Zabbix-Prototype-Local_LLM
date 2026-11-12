# Audit report: `hcml-portal-ollama` (BFF and AI service)

| | |
|---|---|
| **Date** | 2026-09-15 |
| **Scope** | `server/` (the Fastify BFF: endpoints, auth, validation, errors, the Zabbix client, the local-model integration) plus the database it reaches through Zabbix and every port and env setting |
| **Counterpart report** | [`../hcml-portal/AUDIT_REPORT.md`](../hcml-portal/AUDIT_REPORT.md) covers the web front end and the calls it makes |
| **Data behind it** | Zabbix 7.0.30 on MySQL 8.0.46, restored from HCML's production backup |

> **Since 2026-09-18** the two repos hold the same source tree, so every finding in this report and in
> its counterpart applies to **both** portals. Only `.env` and the published port differ.

> **Status update, 2026-10-13.** Where a finding below was fixed later, its Status cell now ends with a dated note and the id of the item in [`tracker.md`](tracker.md), which is the live list. The findings themselves are left as they were written.

> **A correction to the brief.** This is not a standalone back-end service, and `hcml-portal` is not a
> front-end-only app. Both repos contain a full `web/` + `server/` pair. This repo is a copy of
> `hcml-portal` that adds a local OpenAI-compatible model (Ollama) and an Assistant. This report takes the
> BFF half as requested. Its fixes were applied to **both** BFFs, since they share almost all their code.
>
> **Neither portal has a database of its own**: no ORM, no migrations, no SQL. §4 therefore audits the
> Zabbix database it reads, **through the Zabbix API only**.

## How this was audited

| Method | What it covered |
|---|---|
| Route extraction | All 41 `app.get` / `app.post` registrations, with file and line (38 in route modules, plus health, login and `auth/me`) |
| Live probes against `:4000` | Each input-taking endpoint with missing, non-numeric and out-of-range values |
| Throwaway BFF on `:4010` | `AI_TIMEOUT_MS=3000`, `RATE_LIMIT_PER_MINUTE=5`, to force the timeout and 429 paths |
| Network exposure test | Every service port requested from the machine's LAN address, `198.18.0.20` |
| End-to-end flows | Explain and Assistant against local `qwen3:8b`; sign-in, stream and acknowledge validation on Docker |
| MySQL inspection | Schema version, indexes, `performance_schema` statement digests, connection settings |
| Static checks | `tsc` (source and tests), `vitest`, `npm audit`, a secret scan of env files and git history |

## Result at a glance

| Check | Before | After |
|---|---|---|
| Unauthenticated HCML data readable from the LAN on `:4000` | **yes**, `GET /api/problems` returned 449 KB | **no**, connection refused |
| `?hours=abc` on `/api/history` | 20,218 points / 1.39 MB (time bound dropped) | 121 points (1 h window) |
| `?days=abc` on availability | `from: null`, `windowSeconds: null` | `windowSeconds: 604800` |
| Routes returning a raw 500 for a missing id | 8 | 0, all `400 bad_request` |
| Error response shapes in use | 4 | 1: `{ error, message }` |
| Mid-stream model timeout, as shown to the user | `The operation was aborted due to timeout` | `qwen3:8b did not finish its answer within 3000 ms — raise AI_TIMEOUT_MS, or ask a narrower question.` |
| Tests | 119 | **123** (`hcml-portal`: 94 → 98) |
| `tsc` | pass | pass |

---

## 1. Overview

The BFF sits between the browser and Zabbix. It owns both Zabbix API tokens, so the browser never sees
Zabbix. It adds what Zabbix lacks: site roll-ups, link health, a governance scorecard, availability and
noise reports, and a plain-language layer. It serves JSON and two Server-Sent-Event streams, and it
performs exactly one write, `event.acknowledge`, using a separate write token.

This variant's difference is the AI layer. `AI_PROVIDER=openai-compatible` points the Explain actions and
the Assistant at a local model, so HCML's data, stamped *Private and Confidential*, never leaves the
machine.

## 2. Backend architecture

**Stack:** Node.js with TypeScript (ESM, NodeNext); Fastify 4 with `@fastify/helmet`, `@fastify/cors`,
`@fastify/rate-limit` and `@fastify/jwt`; `@anthropic-ai/sdk` for the hosted provider; plain `fetch` for
Zabbix and for OpenAI-compatible models; `vitest` for tests.

**Boot order** (`server/src/index.ts`) matters, because each step protects the ones after it:

```
assertConfig()          refuses to start on the default JWT secret; warns on unsafe settings
helmet                  security headers
cors                    origin = WEB_ORIGIN                                    index.ts:41
rate-limit              RATE_LIMIT_PER_MINUTE per IP; /api/stream and /api/health exempt   index.ts:52
GET /api/health         public
registerErrorHandler    one { error, message } shape + 404 handler           errors.ts:29,77
setupAuth               JWT guard + role rules on every other /api/*          auth.ts:35
17 route modules
listen(HOST, PORT)                                                            index.ts:106
```

| Module | Responsibility |
|---|---|
| `zabbix.ts` | JSON-RPC client. `zbx()` read token, `zbxWrite()` write token; `ZABBIX_TIMEOUT_MS` abort; typed `ZabbixAuthError` / `ZabbixTimeoutError` / `ZabbixApiError` / `ZabbixWriteDisabledError` |
| `cache.ts` | In-memory TTL cache that coalesces concurrent misses (`cached()`, line 13). Shared keys such as `problems` and `hosts:meta` keep N screens from costing N Zabbix calls |
| `validate.ts` | `requireId()` (line 22), `optionalId()`, `intParam()` (line 39). Added in this audit |
| `errors.ts` | Maps typed errors to HTTP status codes in one response shape |
| `auth.ts` | Login from env users, 12-hour JWT, `viewer` < `operator` < `admin` rules per route prefix |
| `queries.ts` | `getProblems()` (problems enriched with host via one `trigger.get`), `getHostsWithMeta()` |
| `ai.ts` | Explain: one Zabbix object in, JSON-schema-shaped plain language out, via Anthropic or OpenAI-compatible |
| `chat.ts` | Assistant: builds a read-only text snapshot of the estate and streams an answer |
| `routes/*.ts` | 17 modules, 38 endpoints (§3); 41 with `/api/health`, `/api/auth/login`, `/api/auth/me` |

**Integration with the web app:** the browser calls `/bff/api/*` on its own origin. The Vite dev proxy
(`web/vite.config.ts`) or nginx (`web/nginx.conf`) strips `/bff` and forwards to this process. EventSource
cannot set headers, so `/api/stream` takes the JWT as `?token=`.

## 3. API endpoints exposed

**Auth:** every `/api/*` path except `/api/health` and `/api/auth/*` requires a JWT when `AUTH_ENABLED=true`.
The role column is the minimum role.

**Errors, identical on every route:**

| Status | Meaning |
|---|---|
| 400 `bad_request` | Missing or malformed input |
| 401 `unauthorized` / `invalid_credentials` | Not signed in, or wrong credentials |
| 403 `forbidden` | Role too low |
| 404 `not_found` | No such route or object |
| 429 `rate_limited` | Rate limit reached |
| 502 `zabbix_error` / `ai_error` | Zabbix or the model failed |
| 503 `zabbix_auth` / `zabbix_timeout` / `zabbix_write_disabled` / `ai_disabled` | A configuration problem |
| 500 `internal` | A bug; the detail is logged, never sent |

All bodies are `{ error: string, message: string }`.

| Method | Path | Role | Request | Response (200) | Other statuses | Defined at |
|---|---|---|---|---|---|---|
| POST | `/api/auth/login` | public | body `{ username, password }` | `{ token, user: { name, role } }` | 401, 429 | `auth.ts:89` |
| GET | `/api/auth/me` | public | Bearer | `{ authEnabled, user: { name, role } }` | 401 | `auth.ts:103` |
| GET | `/api/health` | public | — | `{ ok, ts, ai, writeBack, defaults: { availabilityMinSeverity } }` | — | `index.ts:88` |
| GET | `/api/hosts` | viewer | — | `{ hostid, name, status, maintenance_status, interfaces[] }[]` | 502, 503 | `routes/hosts.ts:52` |
| GET | `/api/hosts/overview` | viewer | — | hosts + `problems: { total, bySeverity }` | 502, 503 | `routes/hosts.ts:65` |
| GET | `/api/hostgroups` | viewer | — | `{ groupid, name }[]` | 502, 503 | `routes/hosts.ts:94` |
| GET | `/api/items` | viewer | `hostid` **required**, `search?` | `{ itemid, name, key_, value_type, units, lastvalue }[]` | 400 | `routes/hosts.ts:107` |
| GET | `/api/latest` | viewer | `hostid` or `groupid`, `search?` | `{ items: LatestItem[], truncated }` (500-item page) | 502 | `routes/hosts.ts:154` |
| GET | `/api/problems` | viewer | — | `ZbxProblem[]` + `host`, `hostid`, `manualClose` | 502, 503 | `routes/problems.ts:7` |
| GET | `/api/stream` | viewer | `?token=` | SSE: `event: problems` every 5 s, `event: error { message }`, keep-alive every 15 s | 401 | `routes/stream.ts:222` |
| POST | `/api/problems/acknowledge` | **operator** | body `{ eventids: string[] or string, message?, acknowledge?=true, close? }` | `{ ok: true, eventids, action }` | 400, 502 (e.g. close refused), 503 | `routes/actions.ts:68` |
| GET | `/api/history` | viewer | `itemid` **required**; `hours` 1–168 (1); `history` 0–4 (0) | `{ itemid, clock, value, ns }[]`, window ending at the item's newest value | 400 | `routes/history.ts:260` |
| GET | `/api/trend` | viewer | `itemid` **required**; `hours` 1–8760 (168) | Zabbix trend rows | 400 | `routes/history.ts:284` |
| GET | `/api/net/devices` | **operator** | — | hosts + `icmp: { up, loss, latency } or null` | 502 | `routes/net.ts:166` |
| GET | `/api/net/ports` | **operator** | `hostid` **required** | `{ itemid, name, key_, lastvalue, units, value_type }[]` | 400 | `routes/net.ts:201` |
| GET | `/api/net/status` | **operator** | `hostid` **required** | `ifOperStatus` items | 400 | `routes/net.ts:258` |
| GET | `/api/net/map` | **operator** | `mapid` **required** | raw `map.get` | 400 | `routes/net.ts:273` |
| GET | `/api/maps` | viewer | — | `{ sysmapid, name, width, height }[]` | 502 | `routes/maps.ts:57` |
| GET | `/api/maps/detail` | viewer | `mapid` **required** | `map.get` + each element `labelText`, `hostid?`, `hostName?`, `problems?`, `maxSeverity?` | 400 | `routes/maps.ts:66` |
| GET | `/api/reports/top-triggers` | viewer | `days` 1–365 (7) | `{ triggers[], truncated, days }` | 502 | `routes/reports.ts:14` |
| GET | `/api/stats` | viewer | — | `{ hosts, items, triggers, groups, problems, unacknowledged, bySeverity }` | 502 | `routes/reports.ts:62` |
| GET | `/api/reports/problems-by-group` | viewer | — | `{ groupid, name, total, bySeverity }[]` | 502 | `routes/reports.ts:90` |
| GET | `/api/sla` | viewer | — | `{ slaid, name, slo, period, status, timezone, description }[]` | 502 | `routes/sla.ts:113` |
| GET | `/api/sla/sli` | viewer | `slaid` (absent → `[]`), `serviceid?` | `{ serviceid, name, sli, uptime, downtime, error_budget, period_from, period_to }[]` | 502 | `routes/sla.ts:115` |
| GET | `/api/explain/problem` | viewer | `eventid` **required** | `{ summary, tagsExplained[], businessImpact, recommendation }` | 400, 404, 502, 503 | `routes/explain.ts:64` |
| GET | `/api/explain/sla` | viewer | `slaid` **required**, `serviceid?` | `{ status, plain, meetingTarget, recommendation }` | 400, 404, 502, 503 | `routes/explain.ts:103` |
| POST | `/api/chat` | viewer | body `{ messages: { role: "user" or "assistant", content }[] }`, last turn `user`; ≤ 12 turns × 2,000 chars | SSE: `context` (snapshot meta) → `token { t }`… → `done { ms }` or `error { message }` | 400, 503 | `routes/chat.ts:119` |
| GET | `/api/sites` | viewer | — | `{ sites: Site[], coverage }` | 502 | `routes/sites.ts:200` |
| GET | `/api/services` | viewer | — | `{ tree: ServiceNode[], total, degraded, worst }` | 502 | `routes/services.ts:193` |
| GET | `/api/reports/inventory` | **admin** | — | `{ dimensions[], overall, groups[], gaps[] }` | 502 | `routes/inventory.ts:186` |
| GET | `/api/links` | **operator** | — | `{ links[], paths[], summary, thresholds }` | 502 | `routes/links.ts:243` |
| GET | `/api/reports/availability` | viewer | `days` 1–365 (7); `severity` 0–5 (`AVAILABILITY_MIN_SEVERITY`) | `{ from, to, windowSeconds, minSeverity, hosts[], truncated }` | 502 | `routes/analytics.ts:830` |
| GET | `/api/reports/noise` | viewer | `days` 1–365 (7); `severity` 0–5 (0) | `NoiseReport` | 502 | `routes/analytics.ts:869` |
| GET | `/api/reports/aging` | viewer | — | `{ buckets[], unacknowledged, total, oldest[] }` | 502 | `routes/analytics.ts:884` |
| GET | `/api/reports/capacity` | viewer | `days` 1–365 (7); `top` 1–50 (10) | `{ days, metrics: { key, label, rows[] }[] }` | 502 | `routes/analytics.ts:886` |
| GET | `/api/graph` | viewer | `itemids` 1–4 **required**; `hours` \| `from`+`to` \| `month`; `points` 200–3000 (1500) | `{ from, to, source, series[{ itemid, name, units, step, points[ms, avg, min, max], stats, coverage }], latestClock, downsampled }` | 400 | `routes/history.ts` *(added 2026-09-17)* |
| GET | `/api/net/interfaces` | **operator** | `hostid` **required**; `search?`, `status?`, `page?`, `pageSize?` | `{ rows[{ name, alias, operStatus, speed, inBps, outBps, utilisation, errors… }], total, summary, page, pageSize }` | 400 | `routes/net.ts` *(added 2026-09-17)* |
| GET | `/api/sli` | viewer | `month?` YYYY-MM; `profile?` availability \| hcml-report | `SliReport`. Derived monthly SLA per device, category, site, class; WAN paths; web checks; gaps | 400 | `routes/sli.ts` *(added 2026-09-17)* |
| GET | `/api/services/derived` | viewer | `month?`, `profile?` | service tree in `/api/services` shape, built from the estate | 400 | `routes/services.ts` *(added 2026-09-17)* |
| GET | `/api/sla/source` | viewer | — | `{ real, slas, services }` | 502 | `routes/sla.ts` *(added 2026-09-17)* |
| GET | `/api/chat/warm` | viewer | — | 202 `{ warming: true }`, loads the local model | 503 | `routes/chat.ts` *(added 2026-09-17)* |

**Contract cross-check.** Every web client call has a matching route, method and response type.
**Three routes are never called by the web app:** `/api/trend`, `/api/net/status` and `/api/net/map` (BE-18). They were removed on 2026-10-12, with `/api/history` and `/api/net/ports`; the table above lists the endpoints as they were on the audit's dates.

**Versioning.** None. Everything lives under `/api/` with no version marker.

**Breaking changes made in this audit** (none affects the bundled web app):
- `/api/items` now needs `hostid`, and the history, trend, network and map-detail routes need their id.
  Missing ids used to produce a 500, so no working caller relied on the old behaviour.
- 400 and 401 bodies moved from `{ error: "<sentence>" }` to `{ error: code, message }`. The web client
  reads `message ?? error`, so it is compatible.
- Upstream Zabbix failures moved from 500 to 502.

**OpenAPI.** None exists, and no route declares a Fastify JSON schema. Validation is by hand (BE-19).

## 4. Database schema summary

The portal has **no database of its own**: no `pg`/`mysql`/`prisma`/`knex` dependency, no migrations, no
SQL. Every read and the single write go through the Zabbix JSON-RPC API; Zabbix's PHP frontend runs the
SQL. What follows audits that database, since it is what this BFF ultimately reads and writes.

| Property | Value |
|---|---|
| Engine | MySQL 8.0.46, `utf8mb4_bin` (Docker service `mysql`, `Proto1/docker-compose.yml`) |
| Schema | Zabbix 7.0.30; `dbversion` 7000000 / 7000030; **203 tables**; 65 changelog triggers |
| Drift / migrations | None. `zabbix-server` checks `dbversion` at start and accepted it; the frontend and server are pinned to `ubuntu-7.0.30` |
| Size | ~8 GB. `history_uint` 99.4 M rows, `trends_uint` 102.9 M, `events` 581,803 |

### API method → tables it reads

| Portal call | Zabbix tables | Relations used |
|---|---|---|
| `host.get` | `hosts`, `interface`, `hosts_groups`, `hstgrp`, `host_tag`, `host_inventory` | host 1–n interface, n–m group, 1–n tag, 1–0..1 inventory |
| `item.get` | `items`, `item_tag` (+ latest value from history) | host 1–n item |
| `history.get` / `trend.get` | `history`, `history_uint` / `trends`, `trends_uint` | item 1–n row, keyed `(itemid, clock)` |
| `problem.get`, `trigger.get` | `problem`, `problem_tag`, `triggers`, `functions` | problem → trigger via `objectid` → items → host |
| `event.get` | `events`, `event_recovery`, `event_tag` | problem event 1–0..1 recovery event |
| `event.acknowledge` | `acknowledges`, `events`, `problem`, `task` | the only write |
| `map.get` | `sysmaps`, `sysmaps_elements`, `sysmaps_links` | map 1–n element, element–element links |
| `service.get`, `sla.get`, `sla.getsli` | `services`, `services_links`, `service_problem`, `sla`, `sla_service_tag` | services form a DAG |

### Indexes on the hot paths

| Table | Index | Portal query it serves |
|---|---|---|
| `history_uint`, `history` | `PRIMARY (itemid, clock, ns)` | Graphs, and the newest-value lookup (`ORDER BY clock DESC LIMIT 1`): ~72 µs average over 97,088 calls |
| `trends_uint`, `trends` | `PRIMARY (itemid, clock)` | Capacity report |
| `events` | `events_1 (source, object, objectid, clock)`, `events_2 (source, object, clock)` | Availability, noise, top triggers |
| `problem` | `problem_1 (source, object, objectid)`, `problem_3 (r_eventid)` | Problems, stream, sites, maps |
| `items` | `items_1 (hostid, key_)`, `items_8 (key_)` | Item lookups; now also key-prefix search (BE-10) |

**Measured from `performance_schema`.** Averages are microseconds unless marked.
- Every frontend-originated `SELECT` used an index.
- The only no-index reads were `zabbix-server`'s own config sync (`changelog`, `hostmacro`).
- **Item substring search:** a `LIKE '%…%'` key search read all ~52k items, at **~105 ms per call**, from
  the links and capacity reports. Fixed in BE-10.
- **Event report query:** ~330 ms per call, examining 127,700 rows. Acceptable for 2-minute-cached
  reports.

### N+1, transactions, pooling, timeouts

| Concern | Finding |
|---|---|
| N+1 | `routes/services.ts:72` ran one `sla.getsli` per SLA **one after another**; now parallel (BE-09). `getProblems()` enriches with a single batched `trigger.get` (`queries.ts:28`). Recoveries are fetched in one batch (`routes/analytics.ts`) |
| Transactions | The portal's only write is one `event.acknowledge` call, which Zabbix applies as one unit; no multi-step writes exist. (During the restore, two portal tokens were inserted directly as token ids 4 and 5, two statements outside a transaction; they committed and were verified) |
| Pooling | BFF → Zabbix uses Node's `fetch` (undici keep-alive pool). PHP-FPM → MySQL opens a connection per request. MySQL `max_connections` 151, peak used **39** |
| Timeouts | BFF → Zabbix `ZABBIX_TIMEOUT_MS` 10 s; MySQL `wait_timeout` 28,800 s; `slow_query_log` off |
| Credentials | Hardcoded in `Proto1/docker-compose.yml:53-54`, `:79` and `:110` (`MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`) and in the healthcheck command at line 59 (BE-21; the fix was applied on 2026-10-12). MySQL is not published outside the Docker network. Portal tokens are env-only; `.env` files are gitignored, and the secret scan of `hcml-portal`'s git history found only a placeholder (`sk-ant-...`) in `howits.md`, the file renamed to `setup.md` on 21 Sep 2026; this repo has no git history of its own |

## 5. Ollama integration notes

| Aspect | Implementation | Verdict |
|---|---|---|
| Provider switch | `AI_PROVIDER`; `openai-compatible` needs only `AI_BASE_URL`. `ANTHROPIC_API_KEY` is never sent to a non-Anthropic host | Sound |
| Explain request | `POST {AI_BASE_URL}/chat/completions` with `response_format: json_schema` (strict), which makes Ollama constrain the sampler to the schema (`ai.ts:238`) | Sound: output shape is guaranteed |
| Thinking control | `reasoning_effort: "none"` for qwen3, deepseek-r1, gpt-oss and magistral (`ai.ts:182`). `/no_think` and `think:false` do not work on Ollama's `/v1` | Sound |
| Timeout | `AbortSignal.timeout(AI_TIMEOUT_MS)`, 120 s for local (`ai.ts:244`). TimeoutError and unreachable-host errors are wrapped into `AiUpstreamError` → 502 with a message that names the fix | Sound |
| Empty output | `assertComplete()` rejects schema-valid but blank answers (`ai.ts:281`) | Sound |
| Streaming | `/api/chat` sends `stream: true`; `readOpenAiStream()` parses `data:` frames, drops reasoning-only frames, stops at `[DONE]` (`chat.ts:282`) | Sound |
| Client disconnect | Abort follows the **response** `close`, not the request, which has already ended once the JSON body is read (`routes/chat.ts:78`) | Sound |
| Mid-stream timeout | The timeout covers the whole answer. When it fired mid-stream the reader threw a bare DOMException, shown to the user verbatim | **Fixed** (`chat.ts:388-401`, BE-06) |
| Caching | Problem explanations 1 h, SLA explanations 5 min. Failures are not cached (`cache.ts` stores only on success) | Sound |
| Reachability from Docker | The portal container reached `host.docker.internal:11434` and listed `qwen3:8b` (verified). Ollama itself listens on `127.0.0.1` only | Sound |
| Measured on HCML data | Explain 30.6 s; Assistant first answer 6.8 s (9 token frames). `qwen3:8b`, 100 % GPU | Usable; Explain is slow |
| Context budget | The snapshot is capped at 40 problems, 30 sites, 5,500 chars (`chat.ts:49-54`) to fit Ollama's default 4,096-token window. With ~665 open problems it is always `truncated` | **Limitation** (BE-22) |
| Concurrency | One model slot shared by `/api/explain/*`, `/api/chat` and prefill; a request that waits over 20 s gets `503 ai_busy` | **Fixed** (BE-23) |

## 6. Issues found

Severity: **High**: data exposure or wrong results · **Medium**: incorrect behaviour or a meaningful risk ·
**Low**: hygiene or hardening. *Confirm* marks items not applied because they change auth logic, ports
already in use, production data or dependencies. They need your decision first.

| # | Severity | File:line | Issue | Status |
|---|---|---|---|---|
| BE-01 | **High** | `server/src/config.ts:94`, `server/src/index.ts:106`, `server/.env` | The dev BFF listened on `0.0.0.0` with `AUTH_ENABLED=false` on a laptop inside HCML's network, with the macOS firewall off. `http://198.18.0.20:4000/api/problems` returned **449 KB of HCML production data with no login**, and the acknowledge endpoint was reachable the same way | **Fixed.** New `HOST` setting (default `0.0.0.0`, so Docker is unchanged); `server/.env` sets `127.0.0.1`; startup warns when auth is off and `HOST=0.0.0.0` (`config.ts:238`). LAN re-test: connection refused |
| BE-02 | **High** | `server/src/routes/history.ts:37`, `routes/analytics.ts:555,562,571`, `routes/reports.ts:15` | A non-numeric window became NaN, which **survives** `Math.min(Math.max(…))` and which Zabbix reads as "no time bound". `?hours=abc` returned 20,218 points / 1.39 MB; `?days=abc` returned `from: null` | **Fixed.** `intParam()` (`validate.ts:39`): NaN falls back to the default, values are clamped. History capped at 168 h |
| BE-03 | Medium | `routes/hosts.ts:64`, `routes/history.ts:32,55`, `routes/net.ts:53,67,82`, `routes/maps.ts:66`, `routes/explain.ts:24` | Missing or non-numeric ids reached Zabbix as `[undefined]` and came back as **500** "Database error occurred". The web Graphs page triggered this on every visit | **Fixed.** `requireId()` → `400 bad_request` before any Zabbix call |
| BE-04 | Medium | `server/src/errors.ts:29-82`, `auth.ts:96,116,134`, `routes/actions.ts:59,64,77`, `routes/explain.ts:32,58` | Four error shapes: Fastify's `{ statusCode, error, message }` for 404s and crashes, a sentence in `error` for 400s, `{ error }` alone for 401s, `{ error, message }` elsewhere. Crashes also sent their internal message to the browser | **Fixed.** One `{ error, message }` shape, a not-found handler, 4xx passthrough, and a generic `500 internal` with the detail kept in the log |
| BE-05 | Medium | `server/src/zabbix.ts:50,89` | JSON-RPC errors and non-2xx responses became plain `Error` (500), and a refused connection was re-thrown raw | **Fixed.** `ZabbixApiError` → 502 `zabbix_error` with Zabbix's own message; unreachable Zabbix names `ZBX_URL` |
| BE-06 | Medium | `server/src/chat.ts:388-401` | A model timeout during streaming reached the Assistant as `The operation was aborted due to timeout` | **Fixed.** Rewrapped as `AiUpstreamError`; a user pressing Stop is still passed through untouched. Verified on the throwaway `:4010` instance |
| BE-07 | Medium | `server/src/config.ts:17` | Numeric env used `Number(process.env.X ?? default)`. `??` lets `""` through and `Number('')` is 0, so `PORT=` meant a random port and `ZABBIX_TIMEOUT_MS=` meant every Zabbix call timed out instantly | **Fixed.** `envNum()` treats empty or non-numeric as unset; string defaults moved to `||` |
| BE-08 | Low | `server/src/index.ts:62` | The rate limiter throws its builder's object, which the stricter error handler would have turned into a 500 | **Fixed.** Carries `statusCode: 429`. Verified: request 5 of 5/min returned `429 rate_limited` |
| BE-09 | Low | `server/src/routes/services.ts:72-80` | N+1: one `sla.getsli` per SLA, awaited one after another | **Fixed.** `Promise.all`, still first-SLA-wins |
| BE-10 | Low | `routes/links.ts:111`, `routes/analytics.ts:472` | `item.get` substring search (`LIKE '%icmpping%'`) scanned all ~52k items, ~105 ms per call | **Fixed.** `startSearch: true`: every key searched is a prefix, so the `items_8(key_)` index applies |
| BE-11 | Low | `routes/actions.ts:64`, `routes/stream.ts:31`, `auth.ts:89-98` | The write accepted non-numeric event ids; the stream's error frame sent `String(err)` ("Error: …"); login did not type-check its body | **Fixed** |
| BE-12 | **High** | `server/src/auth.ts:132` | The guard accepts `?token=` on **every** route, not just `/api/stream`. Tokens in URLs are written to proxy access logs and browser history, and any GET link carrying one is replayable for 12 hours | **Confirm.** Recommend accepting `?token=` only when the path is `/api/stream`, ideally with a short-lived single-use stream ticket. **Fixed 2026-09-24 (tracker SC-03), and stricter since 2026-09-29:** no route takes `?token=` any more, the stream included, because it opens with the session cookie. |
| BE-13 | Medium | `server/src/config.ts:168`, `docker-compose.yml` `PORTAL_PASS` default | With auth on and no `PORTAL_PASS`/`PORTAL_USERS`, sign-in is `admin`/`admin` | **Confirm.** A warning was added (`config.ts:247`). Recommend refusing to start, as for `JWT_SECRET`. **Fixed 2026-09-24 (tracker SC-04):** with sign-in on, the BFF refuses to start when any password is empty or `admin` (a scrypt hash of either too), and compose has no default password. Since 2026-10-13 the dev `server/.env` files hold a random `JWT_SECRET` each (DOC-11). |
| BE-14 | Medium | `server/src/index.ts:52` | Login is limited only by the global 300/min per IP, which allows ~430,000 password guesses a day from one address | **Confirm.** Recommend a per-route limit on `POST /api/auth/login` (e.g. 10/min). **Fixed 2026-09-24 (tracker SC-05):** sign-in allows 10 attempts a minute per account and address, and since 2026-09-30 locks for a minute after 10 failures in a row, doubling to 5 minutes. The proxy setting trusts one hop, so a forged `X-Forwarded-For` is ignored. |
| BE-15 | Low | `server/src/auth.ts:127-128` | Guard exemptions use `startsWith('/api/health')` and `startsWith('/api/auth/')`, so any future route under those prefixes would be public | **Confirm.** Recommend exact matches. **Fixed 2026-09-24 (tracker SC-02):** the public routes are matched exactly (`/api/health`, `/api/auth/login`, `/api/auth/me` and, since SC-11, `/api/auth/logout`), and the guard judges the route the router matched, not the URL text. |
| BE-16 | Low | `server/src/auth.ts:59-76,93` | Passwords are plain text in env and compared with `===` (not constant-time) | Recommended: bcrypt/argon2 hashes in env and `crypto.timingSafeEqual`. **Fixed 2026-10-07 (tracker SC-22):** passwords are compared in constant time, and an entry may be an scrypt hash made by `server/scripts/hash-password.ts`. Plain text entries still work, so existing setups keep signing in. |
| BE-17 | Medium | `server/package.json:19,22,13,28` | `npm audit`: 9 vulnerabilities. **Critical:** `fast-jwt` via `@fastify/jwt` (improper `iss` validation, `crit` header); `vitest` (dev only). **High:** `fastify` (DoS, content-type bypass), `find-my-way`, `vite`. All fixes are major versions (Fastify 5, `@fastify/jwt` 10, vitest 4) | **Confirm.** Not applied. **Fixed 2026-09-29 (tracker SC-12):** Fastify 5.12, `@fastify/jwt` 10.2, Vitest 5 and Vite 8 are in, and both images run Node 24 LTS. `npm audit` was recorded at 0 advisories in either app on 2026-09-30; it was not re-run since, because it needs the registry. |
| BE-18 | Low | `routes/history.ts:55`, `routes/net.ts:67,82` | Dead endpoints: `/api/trend`, `/api/net/status`, `/api/net/map`. Nothing calls them, and `/api/net/map` duplicates `/api/maps/detail` without label resolution | Recommended: remove, or document as public API. Now validated either way. **Fixed 2026-10-12:** these three and two more nobody called (`/api/history`, `/api/net/ports`) were removed with their tests and OpenAPI entries (tracker BK-11); `myown/documents/patches/bk-11-removed-endpoints.patch` puts them back |
| BE-19 | Low | all `routes/*.ts` | No route declares a Fastify JSON schema, no OpenAPI document exists, and there is no `/api/v1` version prefix | Recommended: `@fastify/swagger` from per-route schemas, which would also replace hand validation. **Partly fixed 2026-10-07 (tracker BK-14):** the five POST routes have body schemas with the usual 400, `docs/api/openapi.yaml` exists, and `server/scripts/openapi.check.ts` compares it with the routes (methods, path parameters and the documented 401, 403 and 400). Query and response schemas, a generated document and an `/api/v1` prefix are left: the prefix would break clients and the generator adds a dependency, so it is the owner's call. |
| BE-20 | Low | `server/src/index.ts:41` | CORS sets `credentials: true`, but auth is a Bearer header and no cookies exist. Browser traffic is same-origin through the proxy anyway | Recommended: drop `credentials`. **Done by other work (tracker SC-18):** since the session moved to a cookie (SC-11), `credentials: true` is needed, and it is kept together with the CSRF header and a single allowed origin. |
| BE-21 | Medium | `Proto1/docker-compose.yml:53-54`, `:79`, `:110` (`MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`), `:59` (healthcheck), `:126` (published 8080) | MySQL passwords are hardcoded in Compose and in the healthcheck command. Zabbix frontend (8080) and trapper (10051) are published on all interfaces; `172.31.99.158:8080` answered 200 from the LAN with HCML production data behind it | **Partly fixed 2026-09-17:** 8080 bound to `127.0.0.1`, 10051 no longer published. The hardcoded credentials remain (moving them was declined). **Prepared 2026-10-07, applied 2026-10-12:** `myown/documents/patches/in-23-zabbix-compose-env.patch` moves them to an untracked `.env` next to that file, with the steps in `myown/documents/patches/in-23-README.md`. Applied with the `.env` written first (mode 600): the five lines now read the two variables from it, `docker compose config` hashed the same before and after, and nothing was recreated. `Proto1/docker-compose/docker-compose.yml.bak` holds the old literals and is the undo; the passwords still reach the containers as environment variables, so `docker inspect` shows them |
| BE-22 | Low | `server/src/chat.ts:49-54` | The snapshot budget (40 problems, 5,500 chars) is sized for Ollama's default 4,096-token context. On HCML's ~665 open problems every answer comes from a partial view; it correctly declined to name the worst site | **Improved 2026-09-17:** the BFF requests an 8 192-token context (`AI_NUM_CTX`) on the native API, the snapshot budgets were raised, and questions naming a site get a per-site focus block. Very large estates are still summarised |
| BE-23 | Low | `routes/explain.ts`, `routes/chat.ts:42` | No concurrency limit against one local model | **Fixed 2026-09-17:** one model slot shared by chat, explain and prefill; a request waiting over 20 s gets `503 ai_busy` |
| BE-24 | Medium | `Proto1/docker-compose.yml` (`zabbix-server`) | The restored `zabbix-server` actively polls HCML's production devices from this laptop (95 hosts / 17,600 items reached). Alerting is off, but it is a second poller on production equipment | **Settled 2026-09-22.** Local polling was stopped on 17 Sep, and `zabbix-server` now sits behind the `poller` profile in `Proto1/docker-compose.yml`: a plain `docker compose up -d` starts MySQL and the frontend only, and polling takes a deliberate `docker compose --profile poller up -d`. Housekeeping is off so the imported history is kept. Alerting actions and media types are disabled inside the restored volume, not in the dump, so a fresh restore is armed until they are switched off. **Re-read 2026-10-07:** `zabbix-server` is still behind the `poller` profile (`Proto1/docker-compose.yml:73`), and no service in that file has a restart policy, so a Docker or Mac restart starts nothing by itself: Zabbix is started by hand, and the poller only with the profile. **Re-read 2026-10-12:** unchanged. The profile is still at `Proto1/docker-compose.yml:73`, and the IN-23 edit replaced the five password lines in place, so no line moved |
| BE-25 | Low | `docker-compose.yml:88` | Both variants publish 8081, so they cannot run side by side | **Fixed 2026-09-17:** this variant defaults to `127.0.0.1:8082` (its web container could not start while hcml-portal held 8081) |

## 7. Port and env configuration used

| Service | Port | Bound to | Source | Status |
|---|---|---|---|---|
| BFF (dev) | 4000 | **127.0.0.1** (was all interfaces) | `PORT`, `HOST` in `server/.env` | Fixed, BE-01 |
| BFF (Docker) | 4000 | Docker network only (`expose`) | `docker-compose.yml` | OK |
| Web (dev, Vite) | 5173 | localhost | `VITE_PORT` | OK |
| Web (Docker, nginx) | **8082** | **127.0.0.1** | `docker-compose.yml:88` (`WEB_PORT`) | Fixed, BE-25 |
| Ollama | 11434 | 127.0.0.1 | Ollama default; `AI_BASE_URL=http://localhost:11434/v1` (dev), `http://host.docker.internal:11434/v1` (Docker, `docker-compose.yml:53`) | OK, verified from the container |
| Zabbix frontend / API | 8080 | 127.0.0.1 (since 2026-09-17) | `Proto1/docker-compose.yml`; `ZBX_URL` | BE-21 |
| Zabbix server trapper | 10051 | all interfaces | `Proto1/docker-compose.yml`, since 2026-09-17 the trapper is not published at all | Confirm, BE-21 |
| MySQL | 3306 | Docker network only | `Proto1/docker-compose.yml` | OK |

**Cross-check of `.env`, `.env.example` and Compose, both repos.**
- `PORT=4000`, dev `WEB_ORIGIN=http://localhost:5173`, Docker `WEB_ORIGIN=http://localhost:8081`,
  `ZBX_URL` (`localhost:8080` in dev, `host.docker.internal:8080` in Docker) and `TRUST_PROXY` (`false` in
  dev, `true` in Docker) all agree.
- `AUTH_ENABLED` differs by design: `false` in the dev `server/.env`, `true` in the examples and in Docker.
- **Mismatches:** `PORTAL_USER` is `Admin` in the examples but `admin` in Compose and the root `.env`,
  and case-sensitive. `hcml-portal` publishes 8081 and this repo 8082; both use 4000/5173 in dev.

**Recommended fixed assignment,** pending your go-ahead, since the current defaults are in use:

| Service | `hcml-portal` | `hcml-portal-ollama` |
|---|---|---|
| BFF (dev) | 4000 | **4001** |
| Web (dev) | 5173 | **5174** |
| Web (Docker) | 8081 | **8082** |
| Zabbix 8080 / 10051 | shared, bind `127.0.0.1` | shared |
| Ollama 11434 | — | `127.0.0.1` (unchanged) |

Both ends are already configurable without code changes. For example:
`PORT=4001` in `server/.env`, plus `VITE_PORT=5174 BFF_URL=http://localhost:4001` for the dev web app,
and `WEB_PORT=8082` for Docker.

## 8. Remaining TODOs

1. ~~**Auth decisions:** BE-12 (`?token=` everywhere), BE-13 (default password), BE-14 (login rate
   limit), BE-15 (exact exemptions); then BE-16.~~ Done: BE-12 to BE-15 on 2026-09-24 and BE-16 on 2026-10-07 (tracker SC-03,
   SC-04, SC-05, SC-02, SC-22). The dev `server/.env` placeholder `JWT_SECRET` (DOC-11) was replaced on 2026-10-13.
2. **Network exposure decisions:** bind Zabbix 8080 and 10051 and the Docker web port to `127.0.0.1`,
   and move the MySQL credentials out of Compose (BE-21; applied on 2026-10-12, see its row).
3. **Decide whether the local `zabbix-server` should keep polling HCML's production network** (BE-24; settled, it is off unless started with the `poller` profile).
4. ~~**Plan the Fastify 5 / `@fastify/jwt` 10 upgrade** for the critical `fast-jwt` advisory (BE-17).~~ Done 2026-09-29 (tracker SC-12).
5. **Remove or document the three dead endpoints** (BE-18; removed on 2026-10-12, with two more); add route schemas and an OpenAPI document (BE-19).
   The OpenAPI document exists (`docs/api/openapi.yaml`, checked against the routes) and the POST routes have body schemas;
   query and response schemas, a generated document and an `/api/v1` prefix are left (tracker BK-14).
6. **Assistant quality on a large estate:** a bigger context window and per-site aggregation (BE-22); a
   model concurrency limit (BE-23). BE-23 was fixed 2026-09-17, and BE-22 improved the same day; very large estates are still summarised.
7. ~~**Adopt the port plan** in §7.~~ Done 2026-09-17 (BE-25): this copy publishes on `127.0.0.1:8082`.

## Files changed by this audit

**Both BFFs:**
- New: `server/src/validate.ts`.
- Changed:
  - Core: `server/src/zabbix.ts`, `server/src/errors.ts`, `server/src/config.ts`, `server/src/index.ts`, `server/src/auth.ts`.
  - Routes: `server/src/routes/{history,hosts,net,maps,reports,analytics,actions,explain,services,links,stream}.ts`.
  - Tests: `server/src/__tests__/routes.test.ts`, with 4 new tests for validation, NaN windows, 502/404 shape, and no leaked internals.
  - Config: `server/.env.example` and `server/.env` (`HOST`), `docker-compose.yml` (`WEB_PORT`).

**This repo only:** `server/src/chat.ts`.

**Shared web fixes,** detailed in the counterpart report: `web/src/api.ts`, `App.tsx`, `index.html`,
`vite.config.ts`, `hooks/useAsync.ts`, `hooks/useSSE.ts`, `hooks/useAi.ts`, `pages/Login.tsx`,
`pages/HostDetail.tsx`, `pages/Overview.tsx`, `pages/Inventory.tsx`, `components/states.tsx`.

---

# Second audit: 21 September 2026 (documentation and repository integrity)

| | |
|---|---|
| **Date** | 2026-09-21 |
| **Scope** | Both repos after that day's restructuring: `tools/` deleted, `DOCUMENTATION.md` deleted, `howits.md` renamed to `setup.md`, `ERD.md` moved back to the repo root, `ERD/` `Flow/` `Schema/` recased, 46 link targets rewritten |
| **Method** | Four independent audit agents (links and references · repo parity · document-vs-code accuracy · deletion fallout and secrets), each finding then re-checked by a separate adversarial agent instructed to assume it was wrong and reproduce it from scratch |
| **Counterpart report** | [`../hcml-portal/AUDIT_REPORT.md`](../hcml-portal/AUDIT_REPORT.md) carries the same section plus the findings specific to that repo |
| **Result** | 45 findings raised, **30 confirmed**, 2 refuted, the rest informational. No credential leak. Source tree parity intact. |

> **A note on method.** This machine's filesystem is APFS and **case-insensitive**, so `ls`, `test -e`
> and `[ -e ]` resolve `Schema/` when the real directory is `schema/`. Every agent was required to use
> `python3 os.listdir()` for any claim about a filename, and the `git` CLI was unusable throughout
> (it exits 69 on an unaccepted Xcode licence), so all git facts below come from parsing
> `.git/index` and the object store directly.

## Result at a glance

| Severity | Count | Theme |
|---|---|---|
| **High** | 6 | No version control here at all; two deletions unrecoverable; this repo's own template configures the *hosted* model; a self-contradicting PDM comment |
| Medium | 14 | Stale counts and line citations, lowercase folder names left in prose, a falsified evidence line |
| Low | 4 | Orphaned renders, placeholder `JWT_SECRET`, dangling `instruct.md` citations |
| Verified clean | 9 | Parity, links, anchors, casing on disk, secrets, tests, endpoints, pages, dependencies |

---

## B1 · HIGH: this repository has no version control

> ⚠ **PARTLY RESOLVED 12 Nov 2026.** This repository has been under git since 11 November 2026, with a remote of its own. Whether that remote is private is the owner's to say. The description below is kept as the record of what was wrong.


`os.listdir()` of this repo's root returns `.gitignore` but **no `.git`**. No parent directory up to
`/Users/muizfata` contains one, and an `os.walk` of the whole tree finds no `.git` directory or
worktree pointer. The sibling `hcml-portal` does have one.

Everything deleted, renamed or recased here on 21 September, `tools/` (7 files),
`DOCUMENTATION.md`, `howits.md`→`setup.md`, the `ERD`/`Schema`/`Flow` recasing, the 46 link
rewrites: therefore exists in **exactly one place on one disk**, with no history and no remote.

`hcml-portal` at least has an off-disk backstop (`origin/main` = `b4a4059`, three weeks stale). This
repo has no equivalent at any staleness. **`git init` and commit is the highest-value action
available here**, and it is blocked only by the unaccepted Xcode licence.

## B2 · HIGH: the deleted files were never under version control, and three documents claim they were

> ⚠ **STILL OPEN.** Nothing below has been fixed.


Identical to **A1** in the counterpart report, and worse here because of B1. Parsing
`hcml-portal`'s object store directly: two commits, 88 paths in `b4a4059`'s tree, **zero** containing
`tools` or ending in `.py`, and `DOCUMENTATION.md` absent from both commit trees and every loose
blob. `tools/` was created on **8 September**, one day *after* the final commit. `.gitignore` never
excluded it: it was simply never added.

`~/.Trash` is empty, `mdfind` returns nothing, there are no APFS snapshots. **The six Python scripts
and `DOCUMENTATION.md` are permanently gone from both repos.**

This repo's `README.md:208` says "The scripts are recoverable from `hcml-portal`'s commit
`b4a4059`." That is false, and the byte-identity argument does not rescue it: a commit that never
contained the path cannot restore it, and this repo has no repository of its own regardless.

**Recorded nowhere now**, from the deleted `DOCUMENTATION.md`: the **six-goals framing**, the
**Limitations / known-gaps** section, and the **glossary**. Reconstruct them into `setup.md`.

## B3 · HIGH: this repo's `.env.example` configures the *hosted* model

> ✅ **RESOLVED 21 Sep 2026.** The defect below is fixed; the description is kept as the record of what was wrong. Verification is in *Fix round* at the end of this report.


This is the local-model repository. Its `setup.md` and `README.md` tell a new user to
`cp .env.example .env`. Both templates then select **Anthropic**:

- `server/.env.example` is **byte-identical** to the sibling's (`md5` matches, 7 099 bytes)
- the root `.env.example` differs from the sibling in **exactly one line**, `WEB_ORIGIN`'s port,
  with no model change at all
- both declare `AI_PROVIDER=anthropic` and `AI_MODEL=claude-sonnet-4-6`, with the local block
  commented out

The real `.env` files *are* correct (`AI_PROVIDER=openai-compatible`, `AI_BASE_URL`,
`AI_MODEL=qwen3:8b`), so the running system is fine, but anyone following this repo's own
instructions lands on the hosted backend, which is the one thing this repository exists to avoid.
Compounding it, `AI_PROVIDER` silently falls back to `anthropic` for any unrecognised value, so the
mistake is invisible.

**Fix:** in this repo, make both `.env.example` files select the local backend by default and comment
out the Anthropic block, mirroring how the two real `.env` files already differ.

## B4 · HIGH: `Schema/PDM.mmd` contradicts itself and points at itself as "the local-model copy"

> ✅ **RESOLVED 21 Sep 2026.** The defect below is fixed; the description is kept as the record of what was wrong. Verification is in *Fix round* at the end of this report.


The intended divergence for `PDM.mmd` is a title line plus one comment. The new comment was
**inserted without deleting the old one**:

- lines 32–35 (new): the rows "are summarised by a model on this machine and never cross the network"
- lines 37–39 (old): "in this copy the explanation layer sends a problem, its host and its tags to
  the **Anthropic API**. The local-model copy is `hcml-portal-ollama/schema/PDM.pdf`."

A document telling the reader it is the hosted copy, and directing them to *itself* for the local
one. Both cannot be true. **Fix:** delete lines 37–39 and re-render `Schema/PDM.pdf`.

Scope note: Mermaid `%%` comments are not rendered, and `pdftotext` over the current `PDM.pdf` finds
none of this text, so the contradiction is in the source only. It still ships to anyone reading the
`.mmd`, and the PDFs are stale anyway (**DOC-08**).

## B5 · HIGH: `setup.md` contradicts itself on the size of the test suite

> ✅ **RESOLVED 21 Sep 2026.** The defect below is fixed; the description is kept as the record of what was wrong. Verification is in *Fix round* at the end of this report.


Identical to **A2**. Line 158 says "336 vitest tests"; line 932 says "91 tests"; line 936 says
"covers all fifteen route modules"; line 157 says "the sixteen route plugins". Measured: **336 tests
in 19 files, 17 route modules.** `setup.md` differs between the repos only in three port lines, so
each correction is one fix applied twice. Its §5 endpoint table also omits `/api/graph`,
`/api/net/interfaces` and `/api/chat/warm`, all three already listed correctly in §3 of this report.

## B6 · MEDIUM: findings in this repo

> **Mixed.** Most rows below are resolved and say so inline. `DOC-11` (the placeholder `JWT_SECRET`, a credential change left for the author) was the last one open, and was replaced on 2026-10-13. See *Fix round*.


| Id | Finding | Fix |
|---|---|---|
| **DOC-14** | ~~§3's architecture line (75) and module table (89) said "**16 route modules**" and "16 modules, 35 endpoints", while the §3 table below them lists all 41 endpoints correctly~~ **Fixed 21 Sep:** both summaries now read 17 modules / 38 endpoints | — |
| **DOC-15** | **23 of 35** "Defined at" line citations in the §3 table point at unrelated lines: the route files grew after the 15 Sep audit. 12 are still correct | Regenerate the numbers, or drop `:N` and cite the file only |
| **DOC-16** | §7's port table says this repo publishes **8081** and that "both publish 8081"; it publishes **8082** (`docker-compose.yml:88`, `.env` `WEB_ORIGIN`). The same section's recommended-assignment table already shows 8082 | Update the row; drop the sentence: the split is implemented |
| **DOC-17** | BE-21's evidence line now reads "the git history secret scan found only a placeholder (`sk-ant-…` in `setup.md`)". The rename sweep rewrote a sentence describing a **past** state: no file named `setup.md` has ever been in git history, and this repo has no history at all | "…in `howits.md` (renamed `setup.md` on 21 Sep 2026)", and name whose history was scanned |
| **DOC-18** | **Partly withdrawn.** The original sentence ("Both folders are named `flow/` in lowercase, in both repos") was **correct**; this audit wrongly called it false because the auditing session had renamed the folders to uppercase against the author's intent. What *was* a real defect: the block used `diff`, which on a case-insensitive volume resolves a wrong-case path and on a case-sensitive one prints an error easy to mistake for success. **Fixed 21 Sep:** folders restored to lowercase `flow/`, the sentence reinstated, and the commands switched to `cmp … && echo OK` so a missing path cannot masquerade as a clean diff. Both commands were run and pass | — |
| **DOC-03** | Every `docker-compose.yml` citation is off by 12–25 lines after today's edits | Cite the env key name, not the line |
| **DOC-04** | **Withdrawn: the premise was wrong.** This finding asserted the directories should be `Schema/` `Flow/` `ERD/` and the lowercase prose was the defect. The opposite is true: **lowercase is the intended convention**, and the auditing session had itself renamed the folders to uppercase against the author's intent. The real defect was link targets and display text drifting to uppercase. **Fixed 21 Sep:** all seven directories per repo restored to lowercase (`erd/ flow/ schema/`, and `conceptual/ database/ database-schema/ vanilla/`), `ERD.md` → `erd.md`, and 96 link targets plus 84 prose/label lines lowercased to match | — |
| **DOC-05** | Line 44 was corrected to "(174 lines)" but line 82 still says the clients are "about forty lines each": the file now contradicts itself. Measured: `zabbix.ts` **174**, `ai.ts` **665** | Make line 82 match line 44 |
| **DOC-07** | ~~`schema/README.md` said "43 entities" here and "41" in the sibling, about a byte-identical `erd.md`~~ **Fixed 21 Sep:** counted from `erd/vanilla/ERD-Mermaid.mmd`, **43 entities across 9 domains**; both copies now say 43 | Count once, write the same number in both |
| **DOC-08** | All three `Schema/*.mmd` edited today at 12:11; all six `Schema/*.pdf` still at 18 Sep. `Flow/` was re-rendered at 12:22 | Re-render after fixing B4, then re-confirm zero red fills |
| **DOC-09** | The recasing pass rewrote `](…)` targets only, **13 lowercase paths survive** in Mermaid `%%` comments and README prose | Rewrite all 13 |
| **DOC-10** | This report says "Only `.env` and the published port differ"; `README.md:27` gives a fuller but still incomplete list, omitting `AUDIT_REPORT.md`, `setup.md`, `Flow/README.md` and `Schema/README.md`. The measured divergence is **18 files** (17 at audit time; the B3 fix made `server/.env.example` differ too) | State the real list once and reference it |
| **DOC-11** | `server/.env` sets `JWT_SECRET` to the exact 29-character built-in placeholder the BFF is designed to refuse (`config.ts:7`) | Generate a real secret |
| **DOC-12** | ~~Source comments cite `instruct.md`, which is in neither repo (it lives at `myown/documents/plan/instruct.md`)~~ **Fixed 21 Sep:** all **8** citations repointed at the equivalent `setup.md` section, identically in both repos; a provenance note at the top of `setup.md` records where they came from | — |
| **DOC-13** | `ERD/Conceptual` is the only ERD leaf whose `.md` does not link its own renders: three orphans | Add the links |

## B7 · Verified clean

Re-derived independently, not taken on trust:

- **Source parity holds.** `server/src`, `web/src`, `server/scripts`, `web/scripts` byte-identical
  to the sibling.
- **286 path links and 208 anchors resolve case-sensitively**, and every directory's on-disk casing
  is now correct (`os.listdir`, not `test -e`).
- **No reference to any file deleted or renamed today survives** in either repo.
- **No credential leak.** Real secrets are confined to gitignored, untracked `.env` files.
- **The `tools/` deletion is clean**: nothing here still expects those scripts.
- **Measured accurate:** 336 tests / 19 files, 17 route modules → 38 endpoints (41 with health,
  login and `auth/me`), 18 pages, 21 direct dependencies, `styles.css` 2 000 lines, `markdown.ts`
  141, `zabbix.ts` 174, and the 182 kB + 26 kB bundle figures.
- **`Flow/WebFlow.mmd` and `Flow/ServerFlow.mmd` are byte-identical** between repos, and
  `Flow/DataFlow.mmd` here carries **no** `external` class: the local-model perspective is intact
  in the source.
- **Open items unchanged:** 5 FE and 6 BE, plus BE-21/BE-22 partial. None were resolved or
  invalidated by the 21 September changes.

**Refuted by the adversarial pass:** that `server/.env.example` *differing* was the defect: the
templates were byte-**identical**, which is B3, and the fix deliberately made them differ, and that the stale `Schema` PDFs necessarily
misinform (the mtime gap is real; the content difference is unverified).

## B8 · Outside both repos

- **`Proto1/SETUP.md` does not exist in any casing**, yet **12 links** across `DECISION.md`,
  `README.md`, `CUSTOMIZE.md` and `presentation.md` point at it: one added on 21 Sep in
  `DECISION.md` §6b, which cites a rollback procedure "documented in `SETUP.md`".
- **`presentation.md` links `instruct.md` six times** as a root sibling; it is at
  `myown/documents/plan/instruct.md`.
- **`myown/documents/plan/Improve_1.0.md:611`** still links `hcml-portal/tools/`, deleted on 21 Sep.


---

# Fix round: 21 September 2026

Applied after the audit above, then re-verified by five independent agents whose findings were each
attacked by a second agent instructed to break them. Every number below was re-derived from the
files, not copied from the audit.

## Resolved

| Finding | What changed | Verified by |
|---|---|---|
| **A2 / B5** `setup.md` self-contradiction | "91 tests" → **336 in 19 files**; "fifteen route modules" → **seventeen**; "sixteen route plugins" → **seventeen**; `routes/sli.ts` row added | `npm test` = 336/19; 17 `app.register(...Routes)` in `index.ts`; 17 files in `server/src/routes` |
| **A2 / B5-e** endpoint coverage | 9 rows added to the *Endpoint reference* table | table now lists **41 of 41** live endpoints, set-compared against `app.get`/`app.post` in source |
| **B3** local-model template | both `.env.example` files now select `openai-compatible` / `qwen3:8b`; hosted block commented with the silent-fallback warning | parsed both files: **no duplicate keys** (a duplicate `AI_TIMEOUT_MS` was introduced and removed); README walkthrough rewritten to match |
| **B4** `schema/PDM.mmd` contradiction | the stale hosted-Claude paragraph removed | no self-contradiction remains; all six schema PDFs re-rendered, 1 page each, portal red = 1 CDM / 6 ERD, ollama red = **0** |
| **DOC-01** page count | Routes table gained `/assistant`; counts say 18 | `App.tsx` has 18 `lazy()`; `web/src/pages` holds 18 files |
| **DOC-02** drifted web citations | 9 line citations → symbol citations; `FE-03` → `login()`, `FE-21` → the footer note | every cited symbol exists in its cited file |
| **DOC-03** compose citations | re-anchored and each now names the env key | all 11 checked land on the right key |
| **DOC-07** entity count | both copies now say **43 entities across 9 domains** | counted from `erd/vanilla/ERD-Mermaid.mmd`: 43 entities, 9 subgraphs |
| **DOC-08** stale renders | all six `schema/*.pdf` re-rendered from current sources | `%PDF-1.4`, 1 page each |
| **DOC-12** `instruct.md` citations | all 8 source comments repointed at `setup.md` sections, identically in both repos | `grep -rn instruct` over `server/src` + `web/src` returns only the word "instructions"; parity, 336 tests and both typechecks clean |
| **DOC-13** orphaned renders | `erd/conceptual/ERD-Conceptual.md` now links its `.mmd`, `.pdf`, `.png` | link check |
| **DOC-14** stale counts | "16 route modules" → 17; "16 modules, 35 endpoints" → 17/38; route-extraction line 35 → 41 | matches the §3 table, which was already correct |
| **DOC-15** endpoint citations | every "Defined at" line re-derived from source | **35 of 35** now land on the real registration line (was 12) |
| **DOC-16** port table | this repo's row now reads **8082 / 127.0.0.1** | `docker-compose.yml:88`, `.env` `WEB_ORIGIN` |
| **DOC-17** falsified evidence | BE-21's secret-scan sentence restored to name `howits.md` and whose history was scanned | — |
| **DOC-18** parity recipe | commands now use `cmp … && echo OK` instead of `diff` | both commands run and pass |
| **DOC-05 / DOC-06 / DOC-10** | client line counts corrected (174 / 665), layout trees completed, divergence restated as **18 files** | `wc -l`; `diff -rq` counts exactly 18 |

## Withdrawn: the audit was wrong

| Finding | Why |
|---|---|
| **DOC-04**, **DOC-09**, part of **DOC-18** | These were premised on `ERD/ Flow/ Schema/` being the correct casing. **They are not.** Lowercase is the project's convention; the auditing session had renamed the folders against the author's intent and then audited against its own change. All seven directories per repo are back to lowercase (`erd/ flow/ schema/`, `conceptual/ database/ database-schema/ vanilla/`), `ERD.md` → `erd.md`, and every reference lowercased to match. **296 links, 0 broken** under a case-sensitive resolver |
| **FE-21**'s issue statement | The footer no longer says "Written by Claude"; it is already provider-neutral |

## Still open

| Finding | Why it was not fixed |
|---|---|
| **A1 / B2** deleted files unrecoverable | **Fixed.** The three "recoverable from `b4a4059`" passages were corrected on 2026-09-21, and the lost `DOCUMENTATION.md` sections (six-goals framing, Limitations, glossary) were rewritten on 2026-09-22 from the surviving audit findings, plans and logs as `setup.md` §27 to 29, each marked as reconstructed |
| **B1** no version control here | **Done in part (tracker IN-08).** `hcml-portal-ollama` has been a git repository since 11 November 2026, with a remote of its own. Whether that remote is private is the owner's to say. The other option, folding that copy into `hcml-portal` as a deployment profile, is IN-13 |
| **DOC-11** placeholder `JWT_SECRET` | **Fixed 2026-10-13 (tracker SC-04).** Both dev `server/.env` files now hold a random 64-character secret of their own, so a BFF started with sign-in on no longer refuses on it |

## Caveat on this record

The verification run was launched **before** the casing reversal, so its casing dimension judged
against the wrong premise; those results are discounted above and the casing work was re-verified
separately. Everything else it checked: counts, citations, `.env.example`, `schema/PDM.mmd`, and
collateral damage from find/replace is unaffected.
