# 26. Reachability, caching and operations (second pass, 17 Sep 2026)

[setup.md](../../setup.md) · previous: [§25](25-derived-sla-and-services.md) · next: [§27](27-limitations-and-known-gaps.md)

## One host state, ping first

`server/src/domain/reachability.ts` decides one state per host for Sites, Hosts, Network and the assistant:
`up`, `down`, `degraded`, `nodata` or `disabled`, with a `reason`.

| Situation | State | Reason |
|---|---|---|
| Host disabled in Zabbix | `disabled` | `disabled` |
| Fresh ping answered, but the SNMP / agent interface is failing | `degraded` | `snmp-silent` / `agent-silent` |
| Fresh ping answered | `up` | `ping` |
| Fresh ping failed | `down` | `ping` |
| No fresh ping: the interface flags decide | `up` / `down` | `interface` |
| Nothing to go on | `nodata` | `stale`, `no-interface` or `unsupported` |

A ping value is fresh when the item is supported, has collected, and is no older than
`max(3 × delay, 10 min)`. Before, availability came from interface flags alone: 16 of the 23 hosts
shown "unavailable" were answering ping (FortiGates whose SNMP went silent), and 43 hosts with no
interface were "unknown". `/api/sites` and `/api/hosts/overview` add `state` and `reason` (the old
`availability` field stays); sites add `up` / `down` / `degraded` / `nodata` counts and are ordered
by open severity, then hosts down. The Links page applies the same freshness rule.

## Is Zabbix still collecting?

A stopped `zabbix-server` leaves every API call working and every value in place, so a frozen
estate looks live. `GET /api/freshness` rolls up the newest value of any supported ICMP item, from
the same reads the host states make (so it costs Zabbix no extra call): the ping items, listed once
an hour, and their values of the last 15 minutes, one `history.get` per value type, which took HCML's
Zabbix 2.8 s where its own `lastvalue` for the same 405 items took 54.5 s. With nothing in those 15
minutes, Zabbix's own last value of a few items says how long ago it stopped. It says `stale`
once nothing has been collected for ten minutes, the same floor a ping stays fresh for. The
Dashboard polls it every minute: when stale it shows "Zabbix has collected nothing since …" and
turns the Live badge to the late style. No ICMP item means an unknown age, never a stale one.

## Never-measured hosts

`/api/sli` marks a host `measured: false` when none of its ICMP items has ever collected: 45 hosts
in August (42 with no interface in Zabbix, so the ping check cannot run; 3 disabled). HCML's report
method counts each as 100 %; the SLA page lists them and the figures are unchanged
(`scripts/validate-sli.ts` still matches Jun to Aug exactly).

## Reports

- `trend.get` is read in slices of at most ~26,000 rows (items × hours), so 365-day availability
  and capacity reports answer (they returned 502 when Zabbix's frontend ran out of memory).
- `basis=all-problems` honours `month` (a bad, future or >400-day-old month is a 400).
- `/api/reports/noise?top=N` (default 100, max 1,000) returns the top rows and `total`.

## Caching

`cached(key, ttl, fn, { staleMs, staleIfError, pin })` in `cache.ts`:
- at most 500 entries and about 64 MB of values (estimated by `approxBytes`), least recently used
  evicted first. A value bigger than the whole budget is answered but not stored, with a warning;
- `pin`: evicted only after every unpinned entry, so a run of graph keys cannot push out a closed
  month's SLA report (`services/sli.ts` pins closed months). Pins share at most 32 MB;
- `staleMs`: serve the previous value while one background refresh runs, for the slow reports
  (`derived-sli:*`, `avail:*`, `noise:*`, `capacity:*`) and for the views HCML's Zabbix takes tens
  of seconds to build (`SLOW_VIEW`: the Hosts overview, Devices, the network pages, the meters, the
  busiest hosts, web monitoring, services, maps and the SLA), never for the problem list. With
  `noteAge` the answer says how old it is (`X-Data-Refreshing: true` and `X-Data-Age-Seconds`), and
  the page shows "Data from …; a newer copy is being read from Zabbix." once the copy is two
  minutes old;
- `staleIfError`: if Zabbix fails, answer from the last good run rather than a 502. The request is
  told: `staleness.ts` adds `X-Data-Stale: true` and `X-Data-Age-Seconds` to that answer, from a
  note `cache.ts` leaves in a request-scoped store, and to no other. A failure also starts a pause of a minute
  (`REFRESH_RETRY_MS`): until it has passed the same copy is answered without asking Zabbix, so a Zabbix that is
  down is asked about each value once a minute (tracker BK-27, BK-31). The web app shows "Zabbix did
  not answer, so this is the last copy the portal kept, from …" on the SLA, Availability, Capacity
  and Alert noise pages;
- `invalidate(prefix, { holdMs })` also cancels fetches already in flight, so data from before an
  acknowledge is never stored again; after a write, matching keys are held at a ≤ 2 s TTL for 15 s.

## Bandwidth

- JSON over 1 KB is compressed (`compress.ts`): brotli quality 4 or gzip level 6:
  `/api/problems` 459 KB → 25 KB in ~3 ms.
- The live stream (`/api/stream`) runs one shared ticker, sends the problem list when something shown
  changes, never resends an identical one, and respects back-pressure. Its frames carry only the
  fields the Dashboard reads, and go gzipped to a screen that accepts it (166,741 bytes become 18,693
  on HCML's list, §7).
- The web app polls one request at a time, aborts requests nobody needs any more, pauses in hidden
  tabs, dims stale data while new parameters load, and keeps the page when a refresh fails.
- nginx gzips the app's own files over 1 KB; `/bff` is left to `compress.ts`.

## Logs and ports

- No URL carries a token since the session cookie (ADR-0010). A page loaded before that change still
  puts `?token=` on its stream URL until it reloads, so the BFF log still redacts it from request
  URLs, and nginx's access log writes `token=redacted` in its place. nginx's error log records the
  full request line, such a token included, for example while the BFF is down.
- nginx appends the address it sees to `X-Forwarded-For`, and the BFF trusts that one hop, so a
  client cannot choose its own rate-limit key. The sign-in limit is keyed on username and address,
  because behind Docker's port publishing every browser arrives from the same gateway address.
- The live stream has its own nginx location whose error log is set to `crit`, so an unreachable BFF
  does not write an old page's stream token into the error log.
- Docker publishes the portals (8081, and 8082 for the Ollama variant) on `127.0.0.1` only. The local Zabbix
  stack that once published its UI (8080) and a trapper port (10051) was taken down on 29 October 2026.

## Guards against drift

- `web/scripts/css.check.mjs` fails on an unclosed block, a stray `}` or a declaration outside a rule
  (a lost brace once left ~50 rules silently unapplied; Vite does not catch it).
- `tools/check/diagrams.check.mjs` fails when a diagram source was edited after its stamp, the
  `%% source-hash:` line that ends each `.mmd`. A file date cannot say whether a render is old, because a
  git checkout resets it; `tools/check/diagrams.stamp.mjs` sets the stamp, after the re-render.
- The two portals no longer drift by construction: since 18 September they hold the same source tree,
  so `diff -r` over `server/src`, `server/scripts`, `web/src` and `web/scripts` must print nothing.
  That replaced `scripts/check-sync.mjs` and its list of allowed differences, which had nothing left
  to allow.
- `server/src/export/` keeps three copies of things the web app owns, because the BFF cannot import
  the browser bundle or `web/public`: the light-theme colours (`theme.ts`), the HCML logo (`logo.ts`)
  and the SLA page's method note and banner, word for word, with a handful of its other phrases
  (`slaReport.ts`). `export-theme.test.ts`, `export-pdf.test.ts` and `export-sla-report.test.ts` read
  the originals and fail when a copy drifts.

## Assistant speed (local model)

- Reused snapshot. The snapshot is kept for up to 5 minutes and rebuilt at once when a problem
  opens, closes, is acknowledged or re-graded, or when a host's state change has held for a minute.
  The system text stays byte-identical, so Ollama answers from its prompt cache: first word in
  ~0.5 to 2 s instead of 6 to 8 s.
- Native Ollama API. Chat, explain, warm-up and prefill all call `/api/chat` with the same options
  (`AI_NUM_CTX` 8 192, `AI_TEMPERATURE` 0.7, `AI_TOP_P` 0.8, `keep_alive`), so the model is never
  reloaded with a different context size and really stays loaded for `AI_KEEP_ALIVE`.
- Prefill when the Assistant page opens; a focus block for questions that name a site or a host.
- One request at a time: chat, explain and prefill share one slot; a request that waits more
  than 20 s gets `503 ai_busy` with `Retry-After`.

## Zabbix stack settings (`Proto1/docker-compose.yml`)

Retired on 29 October 2026: the portals read HCML's Zabbix (option B), and this local stack was taken down. The
table records how it was tuned while it ran.

| Setting | Why | Measured |
|---|---|---|
| `--innodb-redo-log-capacity=2G`, `--innodb-flush-log-at-trx-commit=2` | the 100 MiB redo log made MySQL checkpoint constantly | writes 1.50 → 0.39 MB/s in a 60 s sample |
| json-file logs, 50 MB × 5 | zabbix-server wrote ~200 MB in 48 h | not measured |
| `stop_grace_period` 60 s (server), 120 s (mysql) | let the server flush trends on shutdown | "syncing trend data done" on restart |
| `ZBX_STARTPINGERS=3` | one pinger was 100 % busy, fping hit its 600 s limit | pinger busy 100 % → 74 % |
| `ZBX_LOGSLOWQUERIES=3000` | slow queries were never logged | not measured |
| `ZBX_MEMORYLIMIT=512M` (web) | `trend.get` exhausted PHP's 128 M | 0 memory errors after a 365-day report |
