# The server

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators and developers | about 10 min | [Repository map](repository-map.md) | [The web app](web.md) |

The server is a Fastify application written in TypeScript, running on Node 24. It is a BFF, a backend for the frontend: the one process that holds the Zabbix tokens and any model key, asks Zabbix on behalf of the browser, keeps the answers in memory for a while, and shapes them for the pages. It has no database. Everything it knows is rebuilt from Zabbix after a restart ([decision record 3](../../architecture/adr/0003-no-database.md)), except one small state file in the hosted copy: the people a report goes to, the monthly schedule and a record of the last 24 sends ([decision record 15](../../architecture/adr/0015-keep-a-small-state-file-for-recipients-and-the-schedule.md)).

This page goes through `server/` folder by folder. Each folder has a paragraph on what belongs in it, then a table of its files with their size and what each one is.

## Beside the source

<!-- folder server -->
`server/` is a self-contained npm project: its own `package.json`, its own lockfile, its own `Dockerfile`. Nothing is shared with `web/` except what the root `package.json` runs for both. The code is in `src/`; the rest is how it is built, tested, linted and packed.

<!-- gen:files server -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`eslint.config.js`](../../../server/eslint.config.js) | 18 | 1 | The lint rules for the server. |
| [`vitest.config.ts`](../../../server/vitest.config.ts) | 35 | 1 | The test settings: tests under src/__tests__, isolated per file, never reading a real .env. |
<!-- /gen -->

| File | What it does |
|---|---|
| `package.json`, `package-lock.json` | The dependencies and the scripts: `dev` runs the source with a watcher, `build` compiles to `dist/`, `start` runs the build, `typecheck` checks the code and the tests, `lint` runs eslint with no warnings allowed, `test` runs vitest. |
| `tsconfig.json` | Compiles `src/` to `dist/` as modern modules with strict checking. The tests are left out of the build. |
| `tsconfig.test.json` | Typechecks the tests, which the build never reaches. |
| `Dockerfile` | Two stages. The first installs from the lockfile and compiles. The second installs only the packages that ship, copies the build, runs as the unprivileged `node` user, and starts with `node dist/index.js` so that a stop signal reaches the process. The base image is pinned by tag and by digest. |
| `.dockerignore` | Keeps the installed packages, the build output and every `.env` file out of the build context. |
| `.env.example` | Every setting the server reads, with a safe example value. |

<!-- folder server/scripts -->
`scripts/` holds two commands that are run by hand, never by the server. `hash-password.ts` prints a salted hash for a password, to paste into the users setting. `validate-sli.ts` compares the derived SLA with HCML's own monthly Availability Reports; it needs those spreadsheets, which only we have, and it must not run in CI.

<!-- gen:files server/scripts -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`hash-password.ts`](../../../server/scripts/hash-password.ts) | 69 | 0 | Prints a salted hash of a password, to paste into the users setting. |
| [`validate-sli.ts`](../../../server/scripts/validate-sli.ts) | 233 | 0 | Compares the derived SLA with HCML's own Availability Reports, which only we have. |
<!-- /gen -->

<!-- folder server/scripts/bakeoff -->
The model bake-off: fifty questions asked of one local model about a made-up estate, through the portal's own prompt and request code, and scored by marks that were fixed before any model ran. `run.ts` asks a model and saves the run in `results/`, `rescore.ts` scores saved answers again, and `README.md` holds the marks and what the result does not tell you. `prompt-sample.json` holds the real prompts of four questions for `deploy/model-speed.py`, which runs on a machine that has no Node.

<!-- gen:files server/scripts/bakeoff -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`dump-sample.ts`](../../../server/scripts/bakeoff/dump-sample.ts) | 14 | 0 | Writes the real prompts of four questions for the speed test on a machine with no Node. |
| [`env.ts`](../../../server/scripts/bakeoff/env.ts) | 24 | 2 | Sets what the bake-off tells the portal's code about the model, before that code is imported. |
| [`rescore.ts`](../../../server/scripts/bakeoff/rescore.ts) | 34 | 0 | Scores the saved answers of a run again after a question or a mark was mended. |
| [`run.ts`](../../../server/scripts/bakeoff/run.ts) | 65 | 0 | Asks one model the fifty questions and saves the answers, the scores and the times. |
| [`sample.ts`](../../../server/scripts/bakeoff/sample.ts) | 29 | 3 | Builds the prompts of four questions from the portal's own system text. |
| [`score.ts`](../../../server/scripts/bakeoff/score.ts) | 161 | 7 | How an answer is judged, and the pass marks that were fixed before any model ran. |
<!-- /gen -->

## How the server starts

`src/index.ts` is the only file at the top of `src/`. It does not do work; it puts the pieces in order, and the order matters, because a Fastify hook reaches only the routes registered after it.

1. It builds the app. The request log line hides a `token` in the address; the proxy setting says how many hops to trust; request bodies are validated strictly, without turning `"false"` into `false`; and the request id is the one nginx made, or a new one.
2. It gives the cache the logger, so that an old copy served because Zabbix failed is logged and never silent.
3. It checks the configuration and the users. An unsafe configuration, such as a signing secret that is published in this repository, stops the process here.
4. It registers, in this order: the request id, the host check, the security headers, CORS for one origin, the rate limit, compression, the no-store header, the stale-copy headers, the health routes, the error handler and sign-in.
5. It mounts the route modules, 22 of them.
6. It listens. Then it loads the local model if there is one, starts the readiness probe, reads the slow views once so the first visitor does not wait, and installs the shutdown handler.

## The nine folders of src

<!-- gen:tree server/src depth=1 -->
```text
server/src/
├── __tests__/
├── clients/    5 files
├── core/       15 files
├── domain/     5 files
├── export/     9 files
├── http/       9 files
├── routes/     26 files
├── security/   12 files
├── services/   60 files
└── sli/        11 files
```
<!-- /gen -->

<!-- folder server/src -->
`src/` holds `index.ts` and nine folders. A test fails if another file appears at the top or another folder appears beside them, so a new file has to be put where its kind of job belongs. The dependencies run one way, as [the repository map](repository-map.md) lists: routes call services, and services call the shared folders.

<!-- gen:files server/src -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`index.ts`](../../../server/src/index.ts) | 196 | 0 | The composition root: builds the app, registers the plugins and hooks in a fixed order, mounts every route module, then listens and warms the caches. |
<!-- /gen -->

### core

<!-- folder server/src/core -->
What everything else stands on, and it imports nothing from the other folders. The settings are read once from the environment and typed (`config.ts`), with the checks that refuse an unsafe start. The cache holds each answer for its lifetime, lets concurrent callers share one fetch, keeps the total bounded, and can serve an old copy while a slow refresh runs or when Zabbix fails (`cache.ts`, `staleness.ts`). `gate.ts` lets only so many heavy jobs run together, and drops one that is still waiting when its reader has left (`readerGone.ts` tells it). `logFile.ts` keeps the server's own copy of its log in a volume. `validate.ts` and `schemas.ts` turn a bad query or body into a 400 before a service sees it. A file belongs here only if it needs none of the other folders.

<!-- gen:files server/src/core -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`acceptEncoding.ts`](../../../server/src/core/acceptEncoding.ts) | 18 | 2 | Reads a client's Accept-Encoding header and says whether gzip is allowed. |
| [`cache.ts`](../../../server/src/core/cache.ts) | 438 | 16 | The in-memory cache: lifetimes, one fetch shared by concurrent callers, a size cap, an old copy kept while a slow refresh runs, and invalidation after a write. |
| [`config.ts`](../../../server/src/core/config.ts) | 765 | 22 | Every setting read from the environment, typed, with the checks that refuse an unsafe start. |
| [`delay.ts`](../../../server/src/core/delay.ts) | 24 | 3 | The update interval of an item in seconds, read in one place for the graph, the freshness test and the SLA. |
| [`gate.ts`](../../../server/src/core/gate.ts) | 55 | 4 | Lets only so many heavy jobs run at once and queues the rest. |
| [`localHost.ts`](../../../server/src/core/localHost.ts) | 35 | 1 | Says whether a model's address is on this machine or inside its own network, so that the local-model copy can keep its promise that nothing leaves it. |
| [`logFile.ts`](../../../server/src/core/logFile.ts) | 158 | 8 | The server's own copy of its log, in a file in a volume, closed at a size and with the oldest dropped past a count. |
| [`mailConfig.ts`](../../../server/src/core/mailConfig.ts) | 233 | 12 | Reads the MAIL_ settings into one checked object, with the reasons when email is off. |
| [`readerGone.ts`](../../../server/src/core/readerGone.ts) | 11 | 1 | A signal that fires when a reader's connection closes before the answer is out. |
| [`recipients.ts`](../../../server/src/core/recipients.ts) | 57 | 4 | Checks the addresses a person typed: plain, once each, within the limit and the allowed domains. |
| [`reportChoices.ts`](../../../server/src/core/reportChoices.ts) | 24 | 8 | The file kinds a report comes in and how it is written: a decimal mark, a date shape, a CSV separator. |
| [`schemas.ts`](../../../server/src/core/schemas.ts) | 311 | 18 | The JSON Schema of every POST body, and the rule that a query name may be sent only once. |
| [`staleness.ts`](../../../server/src/core/staleness.ts) | 70 | 6 | Adds the headers that say an answer is an old copy, how old it is, or that a refresh is running. |
| [`state.ts`](../../../server/src/core/state.ts) | 301 | 12 | The portal's small file of its own: saved recipients, the monthly schedule and a record of sends. |
| [`validate.ts`](../../../server/src/core/validate.ts) | 72 | 9 | Parses ids and numbers from a query string and turns a bad one into a 400. |
<!-- /gen -->

### clients

<!-- folder server/src/clients -->
Everything the server calls out to, and nothing else calls out. `zabbix.ts` is the only file that holds a Zabbix token: `zbx` reads with the read token, `zbxWrite` writes with a separate write token, and both give up after a timeout, because `fetch` has none of its own and one hung Zabbix would hold every page open. `ai.ts` is its twin for the model and the file that sends the model key to it (the readiness check in `health.ts` sends the same key when it lists a local server's models). `pinnedTls.ts` connects with a certificate pinned by fingerprint until a set day, for the time when Zabbix's own certificate had expired. `limits.ts` caps how much each person may use the model.

<!-- gen:files server/src/clients -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`ai.ts`](../../../server/src/clients/ai.ts) | 861 | 32 | The only place a model credential is used: Explain and the Assistant call hosted Claude or an OpenAI-compatible server from here, and every answer is checked against a schema. |
| [`limits.ts`](../../../server/src/clients/limits.ts) | 243 | 11 | Per-person caps on the model: calls a minute, and for the hosted model the tokens a day. |
| [`mail.ts`](../../../server/src/clients/mail.ts) | 177 | 11 | Sends the report as an attachment through the SMTP server the settings name. |
| [`pinnedTls.ts`](../../../server/src/clients/pinnedTls.ts) | 155 | 8 | Connects to Zabbix with a certificate pinned by fingerprint until a set day, for the time its own certificate had expired. |
| [`zabbix.ts`](../../../server/src/clients/zabbix.ts) | 215 | 9 | The only place Zabbix tokens are used: zbx reads with the read token, zbxWrite writes with the separate write token, and both give up after a timeout. |
<!-- /gen -->

### domain

<!-- folder server/src/domain -->
What a host, a site and a problem are, in the terms several services share. `naming.ts` reads a host's site and kind of device from its name by HCML's convention. `siteOf.ts` finds the site by four signals, the name among them, for every page and for the SLA and the Assistant. `reachability.ts` gives each host one state, asking ping first. `queries.ts` holds the problem reads that the REST routes and the live stream reuse, so they read one cache entry. `recentValues.ts` reads the newest value of many items at once, because Zabbix's own `lastvalue` costs one query for each item.

<!-- gen:files server/src/domain -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`naming.ts`](../../../server/src/domain/naming.ts) | 132 | 10 | Reads a host's site and kind of device from its name, by HCML's naming convention. |
| [`queries.ts`](../../../server/src/domain/queries.ts) | 224 | 11 | The shared problem reads: the cached problem list with its hosts, and the operational data fetched only for the few problems Explain and the Assistant describe. |
| [`reachability.ts`](../../../server/src/domain/reachability.ts) | 327 | 22 | One reachability state per host, ping first, built from the ping items and the interface availability. |
| [`recentValues.ts`](../../../server/src/domain/recentValues.ts) | 42 | 2 | Reads the newest value of many items with one history call per value type, instead of one query per item. |
| [`siteOf.ts`](../../../server/src/domain/siteOf.ts) | 79 | 6 | Finds a host's site by four signals, the site tag, the name, the inventory and the host group, the same way for the Sites page, the SLA and the Assistant. |
<!-- /gen -->

### security

<!-- folder server/src/security -->
Who may do and see what. `auth.ts` holds sign-in and sign-out, the session cookie, the check that a cookie request carries the cross-site header, the sign-in limits and the guard that every route passes through. There are three roles, from least to most: guest, operator and admin, and each person is also given modules, which are the pages of the menu they may open. `modules.ts` holds the roles, the modules and the one table that says which role and which modules each route of the API needs. `accounts.ts` is the directory of the people who can sign in, from `.env` and from the users file, and `userStore.ts` keeps that file. `passwords.ts` stores a password as a salted scrypt hash and checks it in the same time for a name that does not exist. `viewerPolicy.ts` says what an account without the Network page may not read through the generic routes.

<!-- gen:files server/src/security -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`accounts.ts`](../../../server/src/security/accounts.ts) | 527 | 17 | The directory of people who can sign in, and every change to a user. |
| [`actionLimit.ts`](../../../server/src/security/actionLimit.ts) | 23 | 2 | How many problems one person may acknowledge or close in a minute, counted by event id and not by request. |
| [`audit.ts`](../../../server/src/security/audit.ts) | 123 | 11 | Who used what: one log line for each use of the AI and each report downloaded, and the name of whoever is acting. |
| [`auth.ts`](../../../server/src/security/auth.ts) | 574 | 29 | Sign-in and sign-out, the session cookie, the cross-site check, the role guard on every route, and the sign-in limits. |
| [`heavyLimit.ts`](../../../server/src/security/heavyLimit.ts) | 57 | 7 | How many heavy reports, and how many monthly SLA reads, one person may have waiting or running at once: four of each, and then a 429. |
| [`mailLimit.ts`](../../../server/src/security/mailLimit.ts) | 28 | 3 | Five report emails an hour for each person. |
| [`modules.ts`](../../../server/src/security/modules.ts) | 167 | 24 | The roles, the modules and the one table of which role and modules each route needs. |
| [`passwords.ts`](../../../server/src/security/passwords.ts) | 288 | 21 | How a portal password is stored (a salted Argon2id hash, or scrypt for an older one) and checked, with a decoy check so an unknown name costs the same time. |
| [`requestStore.ts`](../../../server/src/security/requestStore.ts) | 159 | 12 | The file of requests for an account on the state volume, written whole, with a stranger's text cleaned first. |
| [`searchLimit.ts`](../../../server/src/security/searchLimit.ts) | 25 | 2 | How many text searches one person may make a minute in the item picker and in Latest data. |
| [`userStore.ts`](../../../server/src/security/userStore.ts) | 213 | 10 | The users file on the state volume: read back whole or repaired, written safely, with the last version kept. |
| [`viewerPolicy.ts`](../../../server/src/security/viewerPolicy.ts) | 51 | 4 | What a viewer may not read through the generic routes: network interface data. |
<!-- /gen -->

### http

<!-- folder server/src/http -->
The rules every request passes, wired in by `index.ts` around the routes and holding no business logic: the request id, the host check, the rate limit, compression, the no-store header, the error mapping, the health and ready routes, the log hygiene and the clean shutdown. Only `index.ts` imports this folder, apart from the two services that borrow the error sentence.

<!-- gen:files server/src/http -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`compress.ts`](../../../server/src/http/compress.ts) | 84 | 4 | Compresses JSON replies with brotli or gzip, chosen from the request, without a library. |
| [`errors.ts`](../../../server/src/http/errors.ts) | 145 | 2 | Maps every error to a reply and says in plain words when Zabbix cannot be read. |
| [`health.ts`](../../../server/src/http/health.ts) | 217 | 10 | The public health and ready routes: whether the server runs, which build it is, and whether Zabbix and the model answer. |
| [`hostCheck.ts`](../../../server/src/http/hostCheck.ts) | 46 | 3 | With sign-in off, answers only to a Host header that names this machine. |
| [`logging.ts`](../../../server/src/http/logging.ts) | 29 | 2 | Keeps a token out of the request log line. |
| [`noStore.ts`](../../../server/src/http/noStore.ts) | 28 | 2 | Marks every API reply except the health check as not to be stored by a browser or proxy. |
| [`rateLimit.ts`](../../../server/src/http/rateLimit.ts) | 35 | 1 | The per-address request limit, counted before sign-in is checked. |
| [`requestId.ts`](../../../server/src/http/requestId.ts) | 41 | 2 | Gives every request one id, from nginx or newly made, and puts it in the reply and in every error body. |
| [`shutdown.ts`](../../../server/src/http/shutdown.ts) | 116 | 6 | Closes the server cleanly on a stop signal, inside the ten seconds Docker allows. |
<!-- /gen -->

### services

<!-- folder server/src/services -->
Where the work is. A service reads from Zabbix through the clients, rolls the answers up, decides the cache keys and lifetimes, and returns plain values, so a test calls it without starting a server. There is roughly one service for each route. The files fall into five families.

| Family | Files |
|---|---|
| The Dashboard and the problem list | `reports.ts` (counts, the data clock, problems by group, top triggers), `stream.ts` (the live stream), `actions.ts` (the one write), `aging.ts`, `topHosts.ts`, `webMonitoring.ts` |
| Hosts, graphs and sites | `hosts.ts`, `devices.ts`, `history.ts`, `maps.ts`, `sites.ts`, `inventory.ts` |
| The network | `net.ts`, `links.ts`, `meters.ts` |
| Reports and the SLA | `availability.ts`, `incidents.ts`, `noise.ts`, `capacity.ts`, `reportPolicy.ts`, `sla.ts`, `sli.ts`, `sliExport.ts`, `services.ts` |
| The plain-language layer | `explain.ts`, `chat.ts`, and the Assistant in `assistant.ts` with its pieces `assistantAcks.ts`, `assistantAnswer.ts`, `assistantDetail.ts`, `assistantFacts.ts`, `assistantFocus.ts`, `assistantHostInfo.ts`, `assistantInternet.ts`, `assistantLines.ts`, `assistantLinks.ts`, `assistantMaintenance.ts`, `assistantMaps.ts`, `assistantOpen.ts`, `assistantPast.ts`, `assistantPorts.ts`, `assistantPrompt.ts`, `assistantReports.ts`, `assistantSeries.ts`, `assistantSla.ts`, `assistantSnapshot.ts`, `assistantTopics.ts`, `assistantValues.ts` and `assistantWhen.ts` |

`warmUp.ts` belongs to none of them: it reads the slow views once after a start. Nor do `userDirectory.ts` and `users.ts`, which do not read Zabbix: they hold the people who can sign in.

<!-- gen:files server/src/services -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`accountRequests.ts`](../../../server/src/services/accountRequests.ts) | 164 | 13 | The rules of a request for an account: the caps, the copy check, the 30-day life, approval and refusal. |
| [`actions.ts`](../../../server/src/services/actions.ts) | 118 | 15 | The acknowledge and close write-back: validation, the write itself, and the audit line. |
| [`aging.ts`](../../../server/src/services/aging.ts) | 61 | 3 | Open problems by age, and the ones left unacknowledged longest. |
| [`assistant.ts`](../../../server/src/services/assistant.ts) | 28 | 36 | The Assistant's entry point, which the route and the tests import and the pieces never do. |
| [`assistantAcks.ts`](../../../server/src/services/assistantAcks.ts) | 184 | 9 | Who acknowledged a problem and what they wrote, given only to a model on this machine. |
| [`assistantAnswer.ts`](../../../server/src/services/assistantAnswer.ts) | 278 | 6 | Asks the model with a conversation and returns the answer as it is written, from the hosted API or a local server. |
| [`assistantDetail.ts`](../../../server/src/services/assistantDetail.ts) | 464 | 4 | What a question gets beyond the snapshot and the site focus: past problems, latest values, host details and contacts. |
| [`assistantFacts.ts`](../../../server/src/services/assistantFacts.ts) | 80 | 4 | The facts the prompt needs some work to know: hosts per state, since when a host is down, and the whole-list lines. |
| [`assistantFocus.ts`](../../../server/src/services/assistantFocus.ts) | 303 | 7 | The focus block: for a site the question names, every host by state and its worst problems. |
| [`assistantHostInfo.ts`](../../../server/src/services/assistantHostInfo.ts) | 185 | 5 | What a host is, for a question about it: its state, groups and templates and, on this machine only, its addresses, tags, inventory and contacts. |
| [`assistantInternet.ts`](../../../server/src/services/assistantInternet.ts) | 204 | 8 | The internet links as prompt lines, worded as the Internet page words them, for the snapshot and for a site's focus block. |
| [`assistantLines.ts`](../../../server/src/services/assistantLines.ts) | 111 | 12 | Turns Zabbix facts into plain prompt lines that cannot forge the data fence. |
| [`assistantLinks.ts`](../../../server/src/services/assistantLinks.ts) | 50 | 2 | The WAN links and the web checks, each in the words of the page that shows it, worst first. |
| [`assistantMaintenance.ts`](../../../server/src/services/assistantMaintenance.ts) | 102 | 5 | The maintenance windows that are on or coming up, from Zabbix's own definitions. |
| [`assistantMaps.ts`](../../../server/src/services/assistantMaps.ts) | 104 | 7 | What a host is linked to on Zabbix's maps, and the maps there are, as the user's pages allow. |
| [`assistantOpen.ts`](../../../server/src/services/assistantOpen.ts) | 39 | 3 | Every open problem of a site, a host or a severity beyond the few the snapshot names. |
| [`assistantPast.ts`](../../../server/src/services/assistantPast.ts) | 152 | 5 | The problems that opened in a past window, closed or not, read from Zabbix's event history and grouped by host and trigger. |
| [`assistantPorts.ts`](../../../server/src/services/assistantPorts.ts) | 61 | 5 | The state of one port of a switch or firewall: status, speed, traffic and errors. |
| [`assistantPrompt.ts`](../../../server/src/services/assistantPrompt.ts) | 128 | 7 | What the model is told: its rules, the language to answer in, and the fence around the data. |
| [`assistantReports.ts`](../../../server/src/services/assistantReports.ts) | 90 | 8 | The capacity, alert noise, top triggers and inventory scorecard pages in a few lines each. |
| [`assistantSeries.ts`](../../../server/src/services/assistantSeries.ts) | 32 | 1 | The lowest, average, highest and last of an item over a window, as the Graphs page computes them. |
| [`assistantSla.ts`](../../../server/src/services/assistantSla.ts) | 135 | 6 | The SLA of a window other than the month the snapshot holds: a named month, a year, a week, the hours that count. |
| [`assistantSnapshot.ts`](../../../server/src/services/assistantSnapshot.ts) | 571 | 17 | Builds the snapshot of the estate the model answers from, as compact text within a character budget, cached by fingerprint. |
| [`assistantTopics.ts`](../../../server/src/services/assistantTopics.ts) | 160 | 5 | What a question wants beyond the snapshot, read from its English or Bahasa Indonesia words: values, a past time, host details or a person. |
| [`assistantValues.ts`](../../../server/src/services/assistantValues.ts) | 291 | 11 | The latest values of a host, or the highest across the hosts of a site, for a question about them. |
| [`assistantWhen.ts`](../../../server/src/services/assistantWhen.ts) | 164 | 4 | The time a question is about, read from English and Bahasa Indonesia words and cut as an exact window in the SLA time zone. |
| [`availability.ts`](../../../server/src/services/availability.ts) | 185 | 7 | The availability report: how much of a window each host spent in a problem state. |
| [`capacity.ts`](../../../server/src/services/capacity.ts) | 353 | 8 | The capacity report: processor, memory, disk and interface use per host over a number of days, from trends. |
| [`chat.ts`](../../../server/src/services/chat.ts) | 124 | 6 | The Assistant endpoint's logic: turns, history budget, warm slot and the streamed reply. |
| [`closedWeb.ts`](../../../server/src/services/closedWeb.ts) | 113 | 5 | Keeps the web check figures of a closed month as they were first read, and reads the month that has just closed once an hour so that they are the figures of that day. |
| [`closedWebStore.ts`](../../../server/src/services/closedWebStore.ts) | 151 | 9 | The file of those figures, `closed-months.json` on the state volume, read with care and written whole. |
| [`devices.ts`](../../../server/src/services/devices.ts) | 47 | 3 | Every host as a device of one kind, for the Devices page. |
| [`explain.ts`](../../../server/src/services/explain.ts) | 232 | 10 | The plain-language layer: reads one problem or one SLA figure and asks the model to explain it. |
| [`history.ts`](../../../server/src/services/history.ts) | 357 | 17 | The graph pipeline: reads history or trends in pages and returns chart-ready series. |
| [`hosts.ts`](../../../server/src/services/hosts.ts) | 227 | 17 | Hosts, host groups, a host's items and the latest data, with the page limits. |
| [`incidents.ts`](../../../server/src/services/incidents.ts) | 277 | 8 | Problem occurrences over a window, read once for the availability and noise reports, including outages that began before it. |
| [`inventory.ts`](../../../server/src/services/inventory.ts) | 182 | 6 | The inventory and ownership scorecard: which hosts lack an owner, a site or a criticality. |
| [`links.ts`](../../../server/src/services/links.ts) | 256 | 7 | Link and WAN health: one ICMP path per link, with its loss and response time. |
| [`mailState.ts`](../../../server/src/services/mailState.ts) | 40 | 5 | The saved recipients and the record of sends the portal keeps about email. |
| [`maps.ts`](../../../server/src/services/maps.ts) | 160 | 7 | Zabbix maps with their host labels filled in, and the network elements left out for viewers. |
| [`meters.ts`](../../../server/src/services/meters.ts) | 568 | 28 | The internet traffic meters, read from the gauge widgets of a Zabbix dashboard. |
| [`net.ts`](../../../server/src/services/net.ts) | 239 | 10 | Network devices and their interfaces, from the SNMP interface items. |
| [`noise.ts`](../../../server/src/services/noise.ts) | 157 | 6 | The alert-noise report: triggers that flap or fire too often to be useful. |
| [`portalState.ts`](../../../server/src/services/portalState.ts) | 21 | 3 | The one state store the server uses, opened at start-up. |
| [`reportPolicy.ts`](../../../server/src/services/reportPolicy.ts) | 36 | 8 | What the slow reports share: how long an answer is kept and how many run at once. |
| [`reportSchedule.ts`](../../../server/src/services/reportSchedule.ts) | 449 | 3 | The monthly send: what is due each minute, retries for a week, and the notices. |
| [`reports.ts`](../../../server/src/services/reports.ts) | 185 | 7 | The Dashboard's counts, the data clock, problems by group and the top triggers. |
| [`services.ts`](../../../server/src/services/services.ts) | 210 | 6 | The service tree, from Zabbix's services or derived from the estate. |
| [`sites.ts`](../../../server/src/services/sites.ts) | 171 | 11 | The site view: hosts grouped by site, with each site's worst problem. |
| [`sla.ts`](../../../server/src/services/sla.ts) | 112 | 8 | Zabbix's own SLA objects and their figures, read-only. |
| [`sli.ts`](../../../server/src/services/sli.ts) | 152 | 6 | The derived monthly SLA, cached, for the routes. |
| [`sliAsk.ts`](../../../server/src/services/sliAsk.ts) | 80 | 8 | Reads what the SLA is asked for, a month or a range and the hours of the day, and reads the report for it. |
| [`sliExport.ts`](../../../server/src/services/sliExport.ts) | 87 | 8 | Chooses the format and file name of the SLA download, for a month or a range. |
| [`sliMail.ts`](../../../server/src/services/sliMail.ts) | 133 | 8 | Tries the mail login, builds the file and the message, and sends them. |
| [`stream.ts`](../../../server/src/services/stream.ts) | 370 | 17 | The live stream hub: one ticker for every connected screen, frames sent only on change, a keep-alive, and a cap on screens. |
| [`topHosts.ts`](../../../server/src/services/topHosts.ts) | 93 | 7 | The busiest hosts right now by processor and memory. |
| [`userDirectory.ts`](../../../server/src/services/userDirectory.ts) | 33 | 3 | Opens the portal's one directory of users at start-up. |
| [`users.ts`](../../../server/src/services/users.ts) | 52 | 6 | What the Users page reads and changes. |
| [`warmUp.ts`](../../../server/src/services/warmUp.ts) | 49 | 2 | Reads the slow views once after a start, one at a time, so the first visitor does not wait. |
| [`webMonitoring.ts`](../../../server/src/services/webMonitoring.ts) | 91 | 7 | Web scenarios counted as OK, failed or unknown, as the Zabbix widget counts them. |
<!-- /gen -->

### routes

<!-- folder server/src/routes -->
HTTP only. A file here is the HTTP side of one area: it names the paths, reads the query or the body, calls that area's service, and sends the answer or the status. Each file exports its registrar and nothing else. Twenty-six files register 54 of the 61 endpoints. The other seven are in `security/auth.ts` (sign-in, sign-out, who am I, renewal and a change of one's own password) and `http/health.ts` (health and ready). The role and the modules a route needs are named once, in the table of routes in `security/modules.ts`, and not in each handler.

<!-- gen:files server/src/routes -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`accountRequests.ts`](../../../server/src/routes/accountRequests.ts) | 63 | 1 | The five routes for requests for an account: two public ones and three for an administrator. |
| [`actions.ts`](../../../server/src/routes/actions.ts) | 148 | 1 | Acknowledge and close: the portal's only write, for operators and admins. |
| [`analytics.ts`](../../../server/src/routes/analytics.ts) | 48 | 1 | The four heavy reports: availability, alert noise, ageing and capacity. |
| [`chat.ts`](../../../server/src/routes/chat.ts) | 167 | 1 | The Assistant's streamed answer and its warm-up call. |
| [`devices.ts`](../../../server/src/routes/devices.ts) | 6 | 1 | The device list: every host as a device of one kind. |
| [`explain.ts`](../../../server/src/routes/explain.ts) | 67 | 1 | The plain-language explanation of a problem and of an SLA figure. |
| [`history.ts`](../../../server/src/routes/history.ts) | 21 | 1 | The graph route: chart-ready series for one to four items. |
| [`hosts.ts`](../../../server/src/routes/hosts.ts) | 83 | 1 | Hosts, the hosts overview, host groups, a host's items and the latest data. |
| [`inventory.ts`](../../../server/src/routes/inventory.ts) | 7 | 1 | The inventory and ownership scorecard. |
| [`links.ts`](../../../server/src/routes/links.ts) | 6 | 1 | Link and WAN health. |
| [`maps.ts`](../../../server/src/routes/maps.ts) | 18 | 1 | The list of Zabbix maps and the detail of one. |
| [`meters.ts`](../../../server/src/routes/meters.ts) | 7 | 1 | The internet traffic meters. |
| [`net.ts`](../../../server/src/routes/net.ts) | 30 | 1 | Network devices and their interfaces. |
| [`problems.ts`](../../../server/src/routes/problems.ts) | 7 | 1 | The current problem list. |
| [`reports.ts`](../../../server/src/routes/reports.ts) | 15 | 1 | The Dashboard's counts, how fresh the data is, problems by group and the top triggers. |
| [`services.ts`](../../../server/src/routes/services.ts) | 21 | 1 | The service tree, from Zabbix and derived from the estate. |
| [`sites.ts`](../../../server/src/routes/sites.ts) | 6 | 1 | The site view. |
| [`sla.ts`](../../../server/src/routes/sla.ts) | 23 | 1 | Zabbix's own SLA objects and their figures. |
| [`sli.ts`](../../../server/src/routes/sli.ts) | 14 | 1 | The derived monthly SLA. |
| [`sliExport.ts`](../../../server/src/routes/sliExport.ts) | 42 | 1 | The derived monthly SLA as a PDF, an Excel file or a zip of CSV files. |
| [`sliMail.ts`](../../../server/src/routes/sliMail.ts) | 160 | 1 | The two routes for emailing the report, for administrators. |
| [`sliSchedule.ts`](../../../server/src/routes/sliSchedule.ts) | 118 | 1 | The two routes for the monthly send, for administrators. |
| [`stream.ts`](../../../server/src/routes/stream.ts) | 53 | 1 | The live problem stream, as server-sent events. |
| [`topHosts.ts`](../../../server/src/routes/topHosts.ts) | 12 | 1 | The busiest hosts by processor and memory. |
| [`users.ts`](../../../server/src/routes/users.ts) | 52 | 1 | The Users routes: list, add, change and reset a password, for administrators. |
| [`webMonitoring.ts`](../../../server/src/routes/webMonitoring.ts) | 12 | 1 | Web scenarios counted as OK, failed or unknown. |
<!-- /gen -->

### sli

<!-- folder server/src/sli -->
The derived SLA. HCML's Zabbix has no services configured, so the monthly availability of each device is computed here from the ICMP triggers every device already carries ([decision record 4](../../architecture/adr/0004-derive-the-sla-in-the-portal.md)). `engine.ts` reads what Zabbix holds for a span of time and `evaluate.ts` works every figure out from it, for any window and any hours of the day ([decision record 18](../../architecture/adr/0018-evaluate-any-sla-window-from-the-months-read-once.md)); `model.ts` holds the shapes of a report and the small pure rules; `window.ts` checks the windows a request may ask for; `events.ts` reads event history in slices so that nothing is silently cut off; `intervals.ts` merges, clips and subtracts time intervals; `maintenance.ts` turns planned maintenance into windows that are left out; `time.ts` finds the edges of a calendar month in a named time zone; `tree.ts` builds a service tree from the estate; `summary.ts` writes plain lines about the result for the Assistant.

<!-- gen:files server/src/sli -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`engine.ts`](../../../server/src/sli/engine.ts) | 496 | 19 | The derived SLA: monthly availability per host, computed from the ICMP triggers, with maintenance, gaps and coverage. |
| [`evaluate.ts`](../../../server/src/sli/evaluate.ts) | 361 | 6 | The second stage of the SLA: every figure worked out from the data of one month or several, for any window. |
| [`events.ts`](../../../server/src/sli/events.ts) | 177 | 9 | Reads event history in slices so nothing is silently cut off. |
| [`intervals.ts`](../../../server/src/sli/intervals.ts) | 85 | 8 | Interval arithmetic: merge, clip, intersect and complement. |
| [`maintenance.ts`](../../../server/src/sli/maintenance.ts) | 172 | 4 | Turns Zabbix maintenance periods into concrete windows per host, so planned downtime can be left out. |
| [`model.ts`](../../../server/src/sli/model.ts) | 243 | 15 | The shapes of a report and the small pure rules it is built from. |
| [`schedule.ts`](../../../server/src/sli/schedule.ts) | 108 | 12 | When the monthly report is due and what to do about it now. |
| [`summary.ts`](../../../server/src/sli/summary.ts) | 75 | 2 | Plain-text lines about the derived SLA and services, for the Assistant's snapshot. |
| [`time.ts`](../../../server/src/sli/time.ts) | 116 | 12 | Calendar months in a named time zone, as Unix seconds. |
| [`tree.ts`](../../../server/src/sli/tree.ts) | 278 | 5 | A service tree built from the estate itself, for a Zabbix that has no services configured. |
| [`window.ts`](../../../server/src/sli/window.ts) | 87 | 5 | The windows a request may ask for: whole hours, daily hours, weekdays, and the months touched. |
<!-- /gen -->

### export

<!-- folder server/src/export -->
The monthly SLA report as a file. One document model (`types.ts`) is written by a PDF writer (`pdf.ts`, with `pdfFonts.ts` and `logo.ts`) and an Excel writer (`xlsx.ts`, with `zip.ts`). Both are written by hand with nothing but Node, so the server needs no PDF or spreadsheet library ([decision record 11](../../architecture/adr/0011-build-the-sla-report-files-in-the-bff.md)). `slaReport.ts` builds the document from the derived reports, and `theme.ts` carries the portal's colours as numbers.

<!-- gen:files server/src/export -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`csv.ts`](../../../server/src/export/csv.ts) | 109 | 2 | Writes the SLA report as a zip of CSV files. |
| [`logo.ts`](../../../server/src/export/logo.ts) | 524 | 3 | The HCML logo as embedded data, and a small PNG reader that turns it into the pixels a PDF image needs. |
| [`pdf.ts`](../../../server/src/export/pdf.ts) | 833 | 3 | A PDF writer built on Node alone: turns a report document into A4 landscape pages. |
| [`pdfFonts.ts`](../../../server/src/export/pdfFonts.ts) | 180 | 10 | Text widths and encoding for the PDF's built-in fonts, so lines can be fitted and cut. |
| [`slaReport.ts`](../../../server/src/export/slaReport.ts) | 591 | 11 | Builds the monthly SLA report as a document from the two derived reports of one month. |
| [`theme.ts`](../../../server/src/export/theme.ts) | 95 | 6 | The portal's colours as plain numbers, for files that cannot read the stylesheet. |
| [`types.ts`](../../../server/src/export/types.ts) | 134 | 14 | The report document model, shared by the PDF and Excel writers: tables, figures, bars and tones. |
| [`xlsx.ts`](../../../server/src/export/xlsx.ts) | 824 | 1 | An Excel workbook writer built by hand, so no spreadsheet library is needed. |
| [`zip.ts`](../../../server/src/export/zip.ts) | 100 | 2 | A minimal ZIP writer, enough to package an Excel workbook. |
<!-- /gen -->

### The tests

<!-- folder server/src/__tests__ -->
Every server test is here, one file for an area, run by vitest. Most call the real routes against a pretend Zabbix. Four are guardrails rather than tests of behaviour: `layering.test.ts` holds the import rules, `ci-workflow.test.ts` holds the CI workflow to its checklist, `parity-script.test.ts` holds the parity checker, and `rebuild-script.test.ts` holds the rebuild script.

<!-- folder server/src/__tests__/golden -->
Expected outputs that tests compare with what the code gives now, kept as JSON beside the tests so that a change of output has to be made on purpose.

<!-- folder server/src/__tests__/golden/sli -->
Reports of the SLA engine as it was before it was split into reading and evaluating (ADR 0018), each for one made-up estate, month and method. `sli-golden.test.ts` holds the engine to them to the digit, and setting `UPDATE_GOLDEN=1` writes them again on purpose.

<!-- folder server/src/__tests__/helpers -->
The helpers the tests share. `app.ts` builds a small app with only the routes a test asks for and the real error handler. `authApp.ts` builds one with the real sign-in guard from an environment the test chooses. `fakeZabbix.ts` is a made-up estate of three hosts at two sites that answers by Zabbix method name. `pingZabbix.ts` and `sliReportFixture.ts` and `docFixture.ts` make the specific data some tests need. `tlsTestCerts.ts` holds throwaway certificates for the TLS tests. `webStyles.ts` reads the web app's stylesheet as one text, for tests that hold the two packages to each other.
