> **A stale snapshot, kept for reference and not maintained.** This is the README of this copy as it
> stood on 23 September 2026. It moved here from the repository root on 7 October 2026, so the
> relative links below, which were written for the root, no longer resolve. The current file is
> [`../README.md`](../README.md).

# HCML Monitoring Portal: `hcml-portal-ollama`

A bespoke, **service-centric** monitoring portal for HCML built on the **Zabbix API**, with its
plain-language layer running on a **local model**. Nothing about the estate leaves this machine.

Zabbix stays the collection and configuration engine. Keep its native UI for host, item and trigger
admin. This portal is the layer Zabbix's UI cannot be: site-structured, role-aware, plain-language,
and organised around services rather than devices. It covers both server/infrastructure and network
monitoring (SNMP/ICMP), reading everything the same way, through the API.

```
 Browser (React) ──HTTP+SSE──► BFF (Fastify, holds tokens, caches) ──JSON-RPC──► Zabbix API
                                            │
                                            └──── HTTP ────► Ollama on this host
                                                             qwen3:8b · never off-box
```

**The browser never sees a Zabbix or model credential.** Every call goes through the BFF.

The portal is **read-only except acknowledge/close**, and that one write runs on a separate,
write-scoped token. Blank that token and the portal is strictly read-only.

Nine flows are written out in that same one-line form: a page load, the live dashboard, the request
pipeline, the cache, auth, where a number comes from, both AI paths and the one write: in
[`docs/flow/README.md`](docs/flow/README.md#the-nine-flows-one-line-each).

> **This repo and its sibling are one source tree.** `myown/hcml-portal` holds the *same* `server/src`
> and `web/src`, byte for byte, `diff -r` prints nothing. The whole difference between the two is
> which model answers: there, hosted Claude over the Anthropic API; here, `qwen3:8b` on this host.
> That is set in an untracked `.env`, not in code, so the distinction is a configuration choice,
> not a fork. **21 files differ**, all configuration or per-repo perspective: the two `.env` files and
> both `.env.example` templates, `docker-compose.yml` (the published port), `setup.md` (three port
> lines), the eight perspective documents, all now under `docs/`: this README, `AUDIT_REPORT.md`,
> the three `docs/schema/*.mmd` with their PDFs, `docs/schema/README.md`, `docs/flow/DataFlow.mmd` +
> `.pdf` and `docs/flow/README.md`, and three added on 22 Sep with the rest of `docs/`:
> `docs/api/openapi.yaml` (the published port), `docs/architecture/adr/0005-*` (the AI-layer
> perspective) and `docs/index.md`. `diff -rq` is the check, and it prints exactly these 21.

---

## Tech stack

**21 direct dependencies** in total, 11 in the BFF, 10 in the web app. The two heaviest categories
of dependency a project like this usually carries are deliberately absent: there is **no ORM or
database driver** (the portal owns no data: everything comes from Zabbix over the API) and **no
component library** (the UI is plain CSS, so the app runs with zero extra setup).

### BFF: `server/`

| Piece | Version | What it does here |
|---|---|---|
| **Node** | 20 (`node:20-alpine`) | Picked for native `fetch` and `AbortSignal.timeout`. The Zabbix client (174 lines) and the local-model client are written straight onto them, so there is no HTTP-client dependency at all |
| **TypeScript** | ^5.5 | ESM throughout: `"type": "module"`, `NodeNext` resolution, ES2022 target, `strict: true`. Tests live under `src/` (same imports as the code) but are excluded from the shipped `dist/` and typechecked by a second config, `tsconfig.test.json` |
| **Fastify** | ^4.28 | Plugin-scoped hooks are the reason the RBAC guard is a single `onRequest` at the root rather than a check repeated in every handler. 17 route modules register onto it → 38 endpoints, plus `/api/health`, `/api/auth/login` and `/api/auth/me` |
| `@fastify/helmet` | ^11.1 | Security headers. CSP is off: nginx serves the SPA, Fastify only serves JSON |
| `@fastify/cors` | ^9.0 | Exactly one allowed origin, from `WEB_ORIGIN` |
| `@fastify/jwt` | ^8.0 | Signs the 12-hour login token. `?token=` is accepted alongside `Authorization`, because `EventSource` cannot set a header, and `logging.ts` exists to keep that token out of the request log |
| `@fastify/rate-limit` | ^9.1 | Per-IP cap, with `/api/stream` and `/api/health` exempt: a NOC wall that polls must not throttle itself |
| `dotenv` | ^16.4 | `.env` in dev. In Docker, Compose passes the environment directly |
| `@anthropic-ai/sdk` | ^0.124 | **Installed but unused in this copy.** It is the hosted backend of `ai.ts`, which this repo never selects; because the source tree is shared it is still imported at module load and still ships in the image. The backend this copy *does* use (OpenAI-compatible and Ollama-native) is hand-rolled on `fetch`, no SDK |
| **Vitest** | ^2.1 | 336 tests in 19 files, all green (re-run 21 Sep 2026, 2.1 s). Zabbix is mocked at `src/zabbix.ts` (the single module all API traffic funnels through) so the suite needs no live instance and no model |
| **tsx** | ^4.16 | `npm run dev` watch mode, and the standalone checks under `scripts/`. Production runs plain `node dist/index.js` |

Compression (`compress.ts`, gzip/brotli over `node:zlib`) and query validation (`validate.ts`) are
also written rather than installed, `/api/problems` alone is ~446 kB uncompressed and polled every
few seconds.

### Web: `web/`

| Piece | Version | What it does here |
|---|---|---|
| **React** | ^18.3 | — |
| **Vite** | ^5.4 | Dev server proxies `/bff` → `:4000`, so dev and prod hit the same paths. `strictPort: true`, and both the port and the BFF URL are overridable: without that, a second portal silently sliding to `:5174` would still be talking to the first one's BFF |
| `react-router-dom` | ^6.26 | All 18 pages are `lazy()`. The initial bundle is **182 kB JS + 26 kB CSS**; a page after that costs between 1 and 16 kB |
| **ECharts** + `echarts-for-react` | ^5.5 / ^3.0 | Registered selectively (line chart, grid, tooltip, legend, data zoom, canvas renderer) instead of the barrel, which pulls in roughly a megabyte of chart types nothing draws. Imported only by `TimeSeriesChart`, so its 539 kB chunk loads on **Graphs** and **Network** and nowhere else |
| **Custom CSS** | — | One `styles.css`, 2 000 lines, HCML palette `#0067B1`, Inter. Light and dark from one set of CSS variables. `scripts/css.check.mjs` checks it structurally, because Vite's build does not fail on an unclosed block |
| **Hand-rolled, on purpose** | — | `hooks/useSSE.ts` over native `EventSource`; `hooks/useAsync.ts` for server state, in place of a query library; `lib/markdown.ts` in 141 lines, because the assistant's answers are the only markdown in the app and a full renderer is a large attack surface for a small job |

### Around it

| Piece | Version | What it does here |
|---|---|---|
| **Zabbix** | 7.0 | The only data source, read over **JSON-RPC 2.0**, never its database. Two tokens: read everywhere, write only for acknowledge/close |
| **Ollama** | native, on the host | Serves `qwen3:8b` (5.2 GB) at `:11434`. **Not containerised**: Docker Desktop on macOS cannot pass through the Metal GPU, so a containerised Ollama falls back to CPU. The BFF speaks Ollama's **native `/api/chat`** when it answers, because only that API accepts a context size and honours `keep_alive` |
| **Docker Compose** | — | Two services, neither of them a datastore: `portal-bff` (Node) and `portal-web` (nginx) on `127.0.0.1:8082`. Both images are multi-stage and install with `npm ci` against a committed lockfile, so one commit builds the same twice |
| **nginx** | alpine | Serves the build and reverse-proxies `/bff`, with `proxy_buffering off` (SSE never arrives without it), a one-year immutable cache on `/assets/`, and SPA fallback to `index.html` |

Deliberately **not** used: no ORM or database driver (the portal owns no data), no state-management
library (server state is two small hooks), no component library, and no second HTTP client: the
Zabbix client (174 lines) and model client (`ai.ts`, 665) are both hand-rolled around native `fetch`.

---

## Layout

```
hcml-portal-ollama/
├── server/                      # BFF: Fastify + TypeScript (ESM)
│   ├── src/
│   │   ├── index.ts             # app, plugins, route registration
│   │   ├── config.ts            # env config + startup validation
│   │   ├── auth.ts              # JWT login + 3-tier RBAC guard
│   │   ├── zabbix.ts            # JSON-RPC client; read/write token split, timeouts
│   │   ├── queries.ts           # shared Zabbix queries
│   │   ├── cache.ts             # TTL cache, in-flight coalescing, invalidate(prefix)
│   │   ├── ai.ts                # the model client: qwen3:8b here, Claude in the sibling
│   │   ├── chat.ts              # the assistant: estate snapshot + streamed answers
│   │   ├── reachability.ts      # host state: up / down / degraded / nodata / disabled
│   │   ├── naming.ts            # HCML's host-name convention → site + device class
│   │   ├── compress.ts          # gzip/brotli for the JSON API, no dependency
│   │   ├── logging.ts           # request logging, with the ?token= redacted
│   │   ├── validate.ts          # query-string parsing and bounds
│   │   ├── errors.ts            # typed failure → HTTP mapping
│   │   ├── sli/                 # derived SLA: engine, events, intervals, summary, time, tree
│   │   ├── routes/              # 17 modules → 38 endpoints (41 with health, login, auth/me)
│   │   └── __tests__/           # vitest: 19 files, 336 tests
│   ├── scripts/validate-sli.ts  # checks the derived SLA against HCML's published reports
│   ├── scripts/openapi.check.ts # checks docs/api/openapi.yaml against the registered routes
│   └── Dockerfile
├── web/                         # React 18 + TypeScript + Vite 5
│   ├── src/
│   │   ├── pages/               # 18, all lazy-loaded
│   │   ├── components/          # Layout, Sidebar, ExplainPanel, AckDialog, TimeSeriesChart, Markdown, …
│   │   ├── hooks/               # useAsync, useSSE, useAuth, useAi, useUrlState, useDebounced
│   │   ├── lib/                 # markdown, units, severity, sites, time
│   │   └── api.ts, types.ts, theme.ts, styles.css
│   ├── scripts/                 # css.check.mjs, markdown.check.ts, units.check.ts
│   ├── nginx.conf               # serves the build, reverse-proxies /bff
│   └── Dockerfile
├── docs/                        # everything documentary lives here
│   ├── index.md                 # what is documented, and in what order to read it
│   ├── getting-started.md       # clone → running portal
│   ├── contributing.md          # the house rules, and why each one exists
│   ├── api/openapi.yaml         # all 41 endpoints; checked by scripts/openapi.check.ts
│   ├── architecture/adr/        # 8 Architecture Decision Records (MADR)
│   ├── schema/                  # the data model on three pages: CDM · ERD · PDM (start here)
│   ├── flow/                    # WebFlow · ServerFlow · DataFlow, and nine one-line flows
│   └── erd/                     # the exhaustive reference set behind it
├── .github/workflows/           # docs.yml: typechecks, tests and the five checkers
├── setup.md                     # how each subsystem works and why, 29 sections
├── erd.md                       # the data model in full, and the three-levels index
├── AUDIT_REPORT.md              # security audit of the BFF and the AI layer, BE-01…BE-25
└── docker-compose.yml           # portal-web (nginx, :8082) + portal-bff
```

**18 pages**: Dashboard · Problems · Sites · Hosts · Graphs · Latest data · Maps · Network ·
Links & WAN · Services · SLA · Availability · Capacity · Alert noise · Top 100 triggers ·
Inventory scorecard · Ask the assistant · Login

---

## Quick start (local dev)

### 0. Zabbix prep

Create a **read-only role + user** in Zabbix and an **API token** for it. If you want
acknowledge/close, create a **second, write-capable token**: deliberately not the same one, so no
read path can ever write. Smoke-test:

```bash
curl -s http://localhost:8080/api_jsonrpc.php \
  -H 'Content-Type: application/json-rpc' \
  -H 'Authorization: Bearer <TOKEN>' \
  -d '{"jsonrpc":"2.0","method":"host.get","params":{"output":["hostid","name"],"limit":3},"id":1}'
```

### 1. The model

This is the copy that runs its own. Install Ollama **natively**, not in a container, see the stack
table above:

```bash
brew install ollama
brew services start ollama
ollama pull qwen3:8b            # 5.2 GB
ollama list                     # qwen3:8b should be there
```

The portal works without it: leave `AI_BASE_URL` blank and every page still serves, only the
*Explain* buttons disappear and `/api/explain/*` returns 503.

### 2. Backend (BFF)

```bash
cd server
cp .env.example .env            # set ZBX_URL + ZABBIX_API_TOKEN
npm install
npm run dev                     # http://127.0.0.1:4000
npm test                        # 336 tests, no live Zabbix and no model needed

curl localhost:4000/api/health
```

`server/.env.example` in **this** repo already selects the local backend, so copying it needs no
edit. It ships as:

```
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://localhost:11434/v1   # host.docker.internal:11434 from a container
AI_MODEL=qwen3:8b
AI_TIMEOUT_MS=120000
```

The sibling repo `hcml-portal` ships the hosted block instead. Switching this copy to hosted needs
**both** `AI_PROVIDER` and `AI_MODEL` changed, `AI_PROVIDER` alone leaves `qwen3:8b` pointed at the
Anthropic API and every *Explain* fails. And `AI_PROVIDER` accepts only `anthropic` or
`openai-compatible`, falling back to `anthropic` **silently** for anything else, so a typo such as
`AI_PROVIDER=ollama` sends estate data off-box with no error.

### 3. Frontend

```bash
cd web
npm install
npm run dev                     # http://localhost:5173 (proxies /bff → :4000)
```

### 4. Data

Point `ZBX_URL` at a Zabbix that already has hosts. An empty one makes for an empty portal.

> ⚠ **The Zabbix on `:8080` holds HCML's real, restored production data** (139 monitored hosts).
> **The demo-estate seed scripts were removed on 21 September 2026** for that reason: they wrote to
> whatever `ZBX_URL` pointed at, and their host names deliberately copied HCML's real naming
> convention, so a collision would have hit a real host. The demo estate itself: 13 hosts across
> five sites is parked in the `proto1_pgdata` volume and has never shared a database with
> production.
>
> **The scripts are gone for good.** This note used to say they were recoverable from
> `hcml-portal`'s commit `b4a4059`; that was checked on 21 Sep and is false. `tools/` was created on
> 8 September, a day *after* that commit, and was never `git add`ed, and this repo has no version
> control of its own regardless. A genuinely empty dev Zabbix would need them written again.

---

## Deploy (Docker, next to Zabbix)

```bash
cp .env.example .env            # ZBX_URL, ZABBIX_API_TOKEN, a real JWT_SECRET, and the AI block
docker compose up -d --build
# http://127.0.0.1:8082
```

`8082`, not `8081`: the sibling portal keeps `8081`, and with both on one port the second container
can never start. Override with `WEB_PORT`, and keep `WEB_ORIGIN` in step with it.

**Reaching the model from the container.** Ollama runs on the host, so `AI_BASE_URL` must be
`http://host.docker.internal:11434/v1` in the root `.env`, `localhost` inside the container is the
container. This is the same trick `ZBX_URL` uses to reach Zabbix.

`JWT_SECRET` has **no default**. Compose refuses to start without it, and the BFF exits if it is
still the placeholder: an authenticated portal signing tokens with a value published in this repo
looks perfectly healthy while anyone can forge an admin token.

**Reaching Zabbix.** The Zabbix stack runs in its own compose project, so there is no shared network
and no DNS between them. `ZBX_URL` defaults to `http://host.docker.internal:8080/api_jsonrpc.php`,
which works on Docker Desktop. On Linux add `extra_hosts: ["host.docker.internal:host-gateway"]`, or
point `ZBX_URL` at the Zabbix host directly.

The portal runs independently of Zabbix: Zabbix upgrades don't affect it, since it only uses the
stable API.

---

## Usage

Everything above gets the portal running. This section is what it is *for*. The step-by-step first
run (Zabbix token, smoke test, first login) is in
[`docs/getting-started.md`](docs/getting-started.md) and is not repeated here.

### Signing in

There is no user table. Users come from the environment: `PORTAL_USERS` as comma-separated
`name:password:role` triples, or `PORTAL_USER`/`PORTAL_PASS` as the single-admin shorthand. A
successful login returns a JWT valid for **12 hours**, and the browser keeps it in memory only: a
refresh signs you out.

With `AUTH_ENABLED=false`, which is the `server/.env` default for local work, there is no login at
all and every caller is treated as `admin`.

Three roles, and the BFF is what enforces them:

| Role | Can reach |
|---|---|
| `viewer` | Everything not listed below. Unmatched routes require viewer, so a new route is protected by default |
| `operator` | …plus `/api/links`, `/api/net/*` and the acknowledge write |
| `admin` | …plus `/api/reports/inventory` |

The sidebar hides what your role cannot reach, but that is **cosmetic**: the guard is server-side and
returns 403 whatever the browser shows. Passwords are compared in plain text and the rules live in
`server/src/auth.ts:34-40`. See [Known gaps](#known-gaps), audit items BE-13 – BE-17.

### The 18 pages

Grouped by the question each one answers, not by the order they appear in the sidebar.

| Page | Route | What it answers |
|---|---|---|
| Dashboard | `/` | Is anything wrong right now? The only page that streams |
| Problems · Alert noise · Top 100 triggers | `/problems` · `/reports/noise` · `/reports/top-triggers` | What is firing, and what fires so often that nobody reads it any more |
| Sites · Hosts · Latest data · Graphs · Maps | `/sites` · `/hosts` · `/latest` · `/graphs` · `/maps` | Where a device is, what it is reporting, and what it looked like an hour ago |
| Network · Links & WAN | `/network` · `/links` | **operator**: the WAN view: which links are up, and what they cost in latency and loss |
| Services · SLA · Availability | `/services` · `/sla` · `/reports/availability` | The monthly figure. Derived in the portal, validated against HCML's own published reports |
| Capacity | `/reports/capacity` | What is filling up, and roughly when it runs out |
| Inventory scorecard | `/reports/inventory` | **admin**, how complete the inventory data actually is |
| Ask the assistant | `/assistant` | Plain-language questions over the estate |
| Login | `/login` | Only reachable when `AUTH_ENABLED=true` |

Sites, links, incidents, host availability and the SLA are the portal's own work: Zabbix has no
table for any of them. That is the whole reason the portal exists
([ADR-0001](docs/architecture/adr/0001-bff-over-zabbix-api.md)).

### Calling the API

Log in, then send the JWT as a bearer token:

```bash
BFF=http://127.0.0.1:8082/bff        # dev: http://localhost:4000

TOKEN=$(curl -s "$BFF/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"…"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -s "$BFF/api/sites" -H "Authorization: Bearer $TOKEN"
```

There is a **second accepted scheme**: `?token=<jwt>` on the query string. It exists because
`EventSource` cannot set an `Authorization` header, but the guard accepts it on *every* `/api/*`
route, not only the SSE ones (`server/src/auth.ts:129-132`). `logging.ts` redacts it from the request
log; treat a URL carrying one as a credential.

`GET /api/health` and `/api/auth/*` need no token. Every error, at every status, has the same body:
`{ "error": "…", "message": "…" }`.

The full contract is [`docs/api/openapi.yaml`](docs/api/openapi.yaml): 41 endpoints, both security
schemes, every status code, and [`docs/api/README.md`](docs/api/README.md) shows how to read it with
nothing installed. It is checked against the code by `npx tsx server/scripts/openapi.check.ts`, so it
cannot quietly drift.

### The assistant

Optional, off unless configured, and **never called on page load**. Two paths:

- **Explain**: the button on a problem or an SLA figure. Sends that one item, returns a buffered
  answer, cached an hour.
- **Ask the assistant**: the chat page. Sends a rollup of the whole estate and streams the answer
  back token by token over SSE (`POST /api/chat`, events `context`, `token`, `done`, `error`).

In this copy the model is **`qwen3:8b`, served by Ollama on this host**, so what is sent: host
names, trigger names, problem text, **never leaves this machine**. The sibling repo `hcml-portal`
is the same code pointed at hosted Claude over the Anthropic API, where it does. Which one answers is
one line of `.env`
([ADR-0005](docs/architecture/adr/0005-provider-neutral-ai-layer.md)), and exactly what crosses on
each path is itemised in [`docs/flow/README.md`](docs/flow/README.md).

---

## Configuration

All of these are read by the BFF. `.env.example` is committed and must never contain a real
credential; `.env` and `server/.env` are gitignored.

### Connection

| Var | Default | Purpose |
|---|---|---|
| `ZBX_URL` | `http://localhost:8080/api_jsonrpc.php` | Zabbix API endpoint |
| `ZABBIX_API_TOKEN` | — | **Read-only** token. `ZBX_TOKEN` is a deprecated alias that warns at startup |
| `ZABBIX_WRITE_TOKEN` | — | Separate **write** token for acknowledge/close. Blank ⇒ portal is strictly read-only and those routes return 503 |
| `ZABBIX_TIMEOUT_MS` | `10000` | Ceiling on one Zabbix call. Prevents a hung Zabbix hanging every page |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | BFF listen port and interface. `server/.env.example` sets `127.0.0.1` for dev; Docker needs the default |
| `WEB_ORIGIN` | `http://localhost:5173` | Allowed CORS origin. `http://localhost:8082` in Docker |
| `WEB_PORT` | `8082` | Host port Compose publishes the web container on |
| `TRUST_PROXY` | `false` | Honour `X-Forwarded-For`. **On** behind nginx, off otherwise, trusting it with nothing in front lets a client forge its own IP |
| `RATE_LIMIT_PER_MINUTE` | `300` | Per-IP request cap. `/api/stream` and `/api/health` are exempt |

### Access control

| Var | Default | Purpose |
|---|---|---|
| `AUTH_ENABLED` | **`true`** | Secure by default. Set `false` only for local dev |
| `JWT_SECRET` | — | Token signing secret. The server **refuses to start** on the placeholder when auth is on |
| `PORTAL_USER` / `PORTAL_PASS` | `admin` / `admin` | Single-user fallback |
| `PORTAL_USERS` | — | `name:password:role` triples, comma-separated. Roles: `viewer`, `operator`, `admin` |

> Both portals read the same `JWT_SECRET` shape and the token carries no audience claim, so a
> session token minted by one is accepted by the other for its full 12 hours. Fine on one laptop;
> give each copy its own secret before they face different people.

### Grouping and scoring

| Var | Default | Purpose |
|---|---|---|
| `NET_GROUP_IDS` | — | Zabbix host **group ids** holding network devices. Empty = all hosts |
| `SITE_TAG` | `site` | Host tag naming the site: the first of four signals the Sites view tries (tag → host name → inventory → group) |
| `SITE_GROUP_PREFIX` | — | Only host groups with this prefix name sites. Empty = use the first group |
| `OWNER_TAG` / `CRITICALITY_TAG` | `owner` / `criticality` | Tags the inventory scorecard looks for |
| `HOST_NAME_PATTERN` | — | Regex a compliant host name must match. Empty = naming not scored |

### Report thresholds

| Var | Default | Purpose |
|---|---|---|
| `AVAILABILITY_MIN_SEVERITY` | `2` | Severity floor for the availability report. **2, not 3**: HCML's estate alarms at Warning, and a floor of 3 makes the page open empty |
| `LINK_LOSS_WARN` / `LINK_LOSS_CRIT` | `2` / `10` | Packet-loss thresholds, percent |
| `NOISE_SHORT_SECONDS` | `300` | Below this, a cleared incident counts as flapping |
| `NOISE_MIN_COUNT` | `5` | Firings before "flapping" means anything |

### Derived SLA

HCML's Zabbix has no services, so the SLA and Services pages measure availability in the portal
from the ICMP triggers every device already carries. See setup.md, *Derived SLA and services*.
`server/scripts/validate-sli.ts` checks the result against HCML's own published reports.

| Var | Default | Purpose |
|---|---|---|
| `SLO_TARGET` | `99` | Availability target, percent: every row of HCML's reports uses 99 |
| `SLA_TIMEZONE` | `Asia/Jakarta` | Calendar months are cut at midnight in this zone |
| `SLI_PROFILE` | `availability` | Default method: `availability` (strict, unreachable or high loss is down, hours with no data left out) or `hcml-report` (reproduces HCML's published reports) |
| `SLI_REPORT_TRIGGERS` | `High ICMP ping loss` | Trigger names behind HCML's published figures |
| `SLI_AVAILABILITY_TRIGGERS` | `Unavailable by ICMP ping,High ICMP ping loss` | Trigger names that mean "down" for the strict method |
| `SLI_MIN_COVERAGE` | `0.5` | Below this share of collected time a device shows "no data" |
| `SLI_ZBX_PARALLEL` | `4` | Concurrent Zabbix calls while computing one report |

### The plain-language layer

One switch over two backends, which get the same prompt and the same JSON Schemas so they are
directly comparable on the same problem. **What this copy sets is in the right-hand column.**

| Var | Default (shared code) | This copy |
|---|---|---|
| `AI_PROVIDER` | `anthropic` | **`openai-compatible`** |
| `AI_BASE_URL` | — | **`http://host.docker.internal:11434/v1`** (`localhost:11434` outside Docker) |
| `AI_MODEL` | `claude-sonnet-4-6` / `qwen3:8b` per backend | **`qwen3:8b`** |
| `AI_TIMEOUT_MS` | `30000` / `120000` per backend | **`120000`**: a local model generates more slowly and loads from disk when cold |
| `ANTHROPIC_API_KEY` | — | not used by this copy; the hosted backend needs it, and blank ⇒ `/api/explain/*` returns 503 |
| `AI_API_KEY` | — | not used. Only a *hosted* OpenAI-compatible gateway wants one; a local Ollama does not |
| `AI_MAX_RETRIES` | `1` | **Anthropic only**: the SDK implements it. The local backend does not retry |
| `AI_KEEP_ALIVE` | `30m` | How long Ollama keeps the model loaded after its last use (~5 GB resident). Without it the first question after an idle spell waits ~10 s for the load |
| `AI_OLLAMA_NATIVE` | `auto` | `auto` asks `AI_BASE_URL` minus `/v1` for `/api/version` and, if Ollama answers, uses its native `/api/chat` for chat, explain, warm-up and prefill: the only API that takes a context size and honours `AI_KEEP_ALIVE` (each `/v1` call resets the expiry to 5 min). `true` / `false` skip the check; any other server keeps `/v1` |
| `AI_NUM_CTX` | `8192` | Native Ollama only. Context window in tokens, sent with **every** request: Ollama restarts the model, and drops its prompt cache, whenever a request asks for a different size. 8192 tokens of cache take ~0.6 GB, twice Ollama's default of 4096 |
| `AI_TEMPERATURE` / `AI_TOP_P` | `0.7` / `0.8` | Native Ollama only. Stated explicitly, since `/v1` sampled at 1.0. Qwen3's own recommendation for answers without thinking |

> **This is the copy where the governance question does not arise.** The other portal sends host
> names, trigger names and problem descriptions to an external API, and every HCML source document
> is stamped *Private and Confidential*: a policy decision, not a technical one. Here the model is
> a process on the same machine, and the answer never leaves it. That claim is the reason this repo
> exists, and it rests on one `.env` line, so it is worth re-checking after any config change:
> `AI_PROVIDER` must be `openai-compatible` and `AI_BASE_URL` must name this host.

### The assistant

The **Ask the assistant** page (`/assistant`) answers free-form questions: *"what needs attention
right now?"*, *"are we meeting the SLA?"*, from a read-only **snapshot** of the estate: open
problems, sites, unreachable hosts, SLA standing and degraded services, all from the same caches the
pages already use. The model has no tools and can neither query nor change Zabbix; the worst it can
do is be wrong, and the page says so. Answers stream in as they are generated (`POST /api/chat`,
server-sent events), under the `viewer` role like every other read.

The snapshot is **reused for up to five minutes** so the model can answer from its prompt cache
instead of re-reading the estate every question. It is rebuilt at once when a problem opens, closes,
is acknowledged or re-graded, and when a host's state change has held for a minute (links that flap
every few seconds do not force a rebuild). Opening the page pre-reads the current snapshot.
Questions naming a site get a short per-host **focus** block after it. The model answers one request
at a time; a request that waits more than 20 s gets `503 ai_busy` with `Retry-After`.

Measured here on 18 Sep 2026, one question end to end against `qwen3:8b`:

| | |
|---|---|
| First token, **cold** model | 9.7 s, Ollama had been idle past `keep_alive`, so this includes the ~8 s load |
| First token, **warm** | 0.5 – 1.9 s |
| Whole answer | 13.9 s, 69 token frames, no error frame |
| Accuracy | named the three unreachable FPSO ARUBA hosts and the Web Monitoring services down 2+ days, both correct against the pages |

The limit is the context window. Against Ollama the BFF asks for `AI_NUM_CTX` (8 192 tokens) on
every request, so nothing needs setting in Ollama's own environment; through `/v1`
(`AI_OLLAMA_NATIVE=false`, or another server) the server's default applies: 4 096 for Ollama.
Either way the snapshot is capped (20 problems, and a character budget per section) and the page
shows *partial view* when a list was cut.

---

## Testing

```bash
cd server
npm test                        # 336 tests in 19 files
npm run typecheck               # app and tests

npx tsx scripts/validate-sli.ts # optional: derived SLA vs HCML's published reports
```

Zabbix is mocked at `src/zabbix.ts` (the single point all API traffic funnels through) so the
suite needs no live instance and runs in CI. Coverage is weighted toward the code that would produce
*confidently wrong numbers* rather than visible errors: interval merging in the availability report,
the RBAC route table, the API surface and the role each route resolves to, cache coalescing, and the
naming-convention regex.

The web app has three standalone checks rather than a second test runner:

```bash
cd web
node scripts/css.check.mjs      # every block closed: Vite's build does not catch this
npx tsx scripts/markdown.check.ts
npx tsx scripts/units.check.ts
```

## Known gaps

- **This repo has been under git only since 11 November 2026.** Before that its whole history was the filesystem,
  and it is now the reference copy of a source tree that exists twice.
- `AUDIT_REPORT.md` items **BE-12 – BE-17** are open, and since the trees were unified they apply to
  both portals. `PORTAL_PASS` is compared as plain text, and `docker-compose.yml` falls back to
  `admin`/`admin` when it is unset.
- The 18 Sep timings above were taken once each; the cold and warm figures are not comparable with
  one another and neither was repeated.
</content>
</invoke>
