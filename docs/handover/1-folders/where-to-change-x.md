# Where to change what

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators and developers | about 10 min | [The two copies](the-two-copies.md) | none |

These are the things people most often ask to change, each with the place to change it, what else has to move with it, and what fails if it is missed. Every change to shared code lands in both copies ([the two copies](the-two-copies.md) says how), and `npm run verify` is the last step of every one of them.

A word on the last column. Most of the traps in this repository are a fact written in two places, so the repository holds a checker or a test at each one. The last column names it. A failure there is the system working.

## The API

| You want to | Change | Also move | If you miss it |
|---|---|---|---|
| Add an endpoint | A route file in `server/src/routes/`, registered in `server/src/index.ts`; the work in a service in `server/src/services/` | `docs/api/openapi.yaml` in each copy; a row in the endpoint table of `docs/setup/05-backend-file-by-file.md`; the count of endpoints wherever the documents state it; a call in `web/src/api/`, a shape in `web/src/types/` and a check in `web/src/guards/`; then `npm run gen:api` in `web/` | `openapi.check` fails when the description and the routes differ, `facts.check` when the table or a count is wrong, and a web test when the types and the description differ |
| Accept a request body | The schema in `server/src/core/schemas.ts` | The route that reads it; `docs/api/openapi.yaml` | `request-schemas.test.ts` pins what a bad body gets |
| Change who may call an endpoint | The route rules in `server/src/security/auth.ts` | `server/src/security/pageAccess.ts` if it fills a page; what a viewer may not read is in `server/src/security/viewerPolicy.ts` | `surface.test.ts` pins the rules against the list of routes, so the table in it must change on purpose |
| Add a field to a Zabbix call, or a new call | The service that makes it, through `zbx` in `server/src/clients/zabbix.ts` | The table of Zabbix calls in `docs/erd/database/ERD-Database.md`; the pretend estate in `server/src/__tests__/helpers/fakeZabbix.ts` | `facts.check` compares that table with the lines that name each method |
| Make an endpoint faster | Ask for less, not for the same in a faster way: leave a field out of the call, or read many items in one call as `server/src/domain/recentValues.ts` does | The cache lifetime in the service | The timing tool `tools/live/api-timing.py` shows the cost of every read endpoint, cold and warm |

## Pages and the web app

| You want to | Change | Also move | If you miss it |
|---|---|---|---|
| Add a page | The page in `web/src/features/<feature>/`, a lazy import and a `<Route>` in `web/src/App.tsx`, an entry in `SECTIONS` in `web/src/features/shell/Sidebar.tsx` | The page's entry in `PAGE_API` in `server/src/security/pageAccess.ts`, so the server can tell the sidebar who sees it; the title in `PAGE_TITLES`; the page lists in `tools/live/page-audit.mjs` and `tools/live/layout-sweep.mjs`; the count of pages in the documents | `live-tools.test.ts` fails on a page left out of the audit lists, and `facts.check` on a wrong count |
| Let one feature use another | A line in `MAY_IMPORT` in `web/src/__tests__/layering.test.ts` | The reason, in the page of the guide about the web structure | `layering.test.ts` fails on any import that is not in the table |
| Add a feature folder | The folder, and its line in `MAY_IMPORT` | The row in the table of [the web app](web.md) | `layering.test.ts` fails on a feature folder that is not in the table |
| Change what a page shows for a role | The page's component, and `web/src/shared/hooks/useAuth.ts` for what the role may see | The role rules on the server if the data itself is restricted | A role test for the page, if one exists; the server refuses what the role may not read whatever the page does |
| Change the wording on a page | The component in its feature | Any test that quotes the old sentence: search `web/src` for it | The test that quotes it |
| Change how a number, a percentage or a duration is written | `web/src/shared/lib/units.ts`, and nowhere else | Nothing | `units.check.ts` fails on a page that formats a percentage by hand |
| Change the live problem list | `web/src/shared/hooks/useSSE.ts` and `web/src/features/problems/` for the page; `server/src/services/stream.ts` for what is sent | The tick of the stream follows the cache lifetime of the problem list: `TICK_MS` is `PROBLEMS_TTL_MS`. The page treats three missed pings as a dead line | `stream.test.ts` covers the hub, and `useSSE.test.ts` the watchdog |
| Change the wall screen | `web/src/features/dashboard/` for the rotation and the fit, `web/src/features/shell/useWallMode.ts` for the mode, `web/src/shared/lib/wall.ts` for what it shows in turn | The `wall` role if the data it may read changes | The Dashboard tests in the same folder |

## Looks

| You want to | Change | Also move | If you miss it |
|---|---|---|---|
| Change a colour, a size, a font or the spacing | `web/src/styles/01-tokens.css`, for the light and the dark theme | Run `npm run tokens:export` at the root; `DESIGN.md` if the direction changes | `tokens.check` re-derives the contrast of every pair and fails on an illegible one, or on a token file that differs from the stylesheet |
| Change how one page looks | The numbered part of `web/src/styles/` that holds that page (the table in [the web app](web.md) names them) | Keep a visible focus ring: a rule that sets `outline: none` with nothing in its place is refused | `css.check.mjs` fails on a lost brace, and `markup.test.tsx` on a rule that removes the focus ring |
| Make controls bigger on touch screens | `web/src/styles/19-touch.css` | Nothing | `markup.test.tsx` reads the stylesheet and fails when a control is under 44 pixels where the pointer is coarse |
| Change the depth, the edges or the motion | `web/src/styles/18-soft-depth.css` | `DESIGN.md` section 10 | `tokens.check` measures the edge of every control against 3:1 |

## Behaviour and data

| You want to | Change | Also move | If you miss it |
|---|---|---|---|
| Change how a site or a kind of device is read from a host name | `server/src/domain/naming.ts`, and its copy for the browser, `web/src/shared/lib/sites.ts` | The settings `HOST_NAME_PATTERN`, `SITE_TAG` and `SITE_GROUP_PREFIX` if the convention is in settings | `copiedHelpers.test.ts` runs both over the same names and they must agree |
| Change how a host's state is decided | `server/src/domain/reachability.ts` | The pill in `web/src/shared/components/StatusBadge.tsx`; the guide's description of the states | The reachability tests |
| Change how the SLA is computed | `server/src/sli/engine.ts`; which triggers count is a setting (`SLI_REPORT_TRIGGERS`, `SLI_AVAILABILITY_TRIGGERS`) | The method note in the report files, `server/src/export/slaReport.ts` | `validate-sli.ts` compares it with HCML's own reports, by hand, since only the owner has them |
| Change the reporting time zone | The setting `SLA_TIMEZONE`; the month edges are in `server/src/sli/time.ts` | The browser learns the zone from the server and does not hold its own | `copiedHelpers.test.ts` holds the browser's month edges to the server's |
| Change a threshold or a target | The settings `SLO_TARGET`, `AVAILABILITY_MIN_SEVERITY`, `NOISE_SHORT_SECONDS`, `NOISE_MIN_COUNT`, `LINK_LOSS_WARN` and `LINK_LOSS_CRIT` | `.env` of each copy | Nothing fails: they are read when the server starts, so recreate the server container |
| Change how long an answer is kept | The service that owns the cache key; the problem list's is `PROBLEMS_TTL_MS` in `server/src/domain/queries.ts`; what the slow reports share is in `server/src/services/reportPolicy.ts` | The text on the page that says how old data may be, in `web/src/shared/lib/freshness.ts` | The cache tests |
| Change what the model is told | The rules in `server/src/services/assistantPrompt.ts`; what it knows in `assistantSnapshot.ts`, `assistantFacts.ts` and `assistantFocus.ts`; Explain in `server/src/services/explain.ts` | The caps in `server/src/clients/limits.ts` and the `AI_*` settings | The Assistant tests |
| Change the model or its provider | Settings only, in `.env` | Nothing in the code, unless the new provider speaks neither Anthropic's protocol nor an OpenAI-compatible one: then `server/src/clients/ai.ts` | The AI client tests |
| Change a report file | The content in `server/src/export/slaReport.ts`; the layout in `pdf.ts` or `xlsx.ts` in the same folder | The test document in `server/src/__tests__/helpers/docFixture.ts` | The writers' tests |

## Settings, security and running

| You want to | Change | Also move | If you miss it |
|---|---|---|---|
| Add a setting | Read it in `server/src/core/config.ts` | A default in `docker-compose.yml` of both copies; `deploy/settings.example`; the Configuration table in each `README.md` | `facts.check` fails when the server reads a variable the README does not name |
| Add or change a user, a role or a password | `PORTAL_USERS` in the real `.env`, with a hash from `server/scripts/hash-password.ts` | Recreate the server container. A valid `PORTAL_USERS` list replaces `PORTAL_USER` and `PORTAL_PASS`, so keep the admin in the list | The server refuses to start on a malformed entry |
| End every session at once | Change `SESSION_EPOCH` | Recreate the server container | Nothing: that is what it is for |
| Change the sign-in limits | `LOGIN_ATTEMPTS_PER_MINUTE` and the lock constants in `server/src/security/auth.ts`; the overall limit is the setting `RATE_LIMIT_PER_MINUTE` | `docs/setup/23-hardening-timeouts-rate-limiting-headers.md` | The sign-in tests |
| Change a timeout | `ZABBIX_TIMEOUT_MS`, and the `proxy_read_timeout` values in `web/nginx.conf`, which must stay above it; the pages' own deadlines are in `web/src/api/client.ts` | Both copies; the guide's list of limits | `nginx-conf.test.ts` reads the nginx config the way nginx does |
| Change the security headers or the content-security policy | `web/nginx.conf`. Try the policy first with `tools/live/enforcing-csp-server.mjs` | Rebuild the web image | `nginx-conf.test.ts`, and the page audit reports a violation |
| Update a package or a base image | `npm install` in `server/` or `web/`, never by hand in a lockfile; the Docker base image is pinned by tag and digest in both Dockerfiles | The two Dockerfiles must name the same Node | CI audits the packages that ship. Dependabot proposes the updates |
| Put a change live | `deploy/rebuild.sh` | Tag the old images first; the script does | The script refuses a tree that differs from the commit unless told otherwise |

## Documents

| You want to | Change | Also move | If you miss it |
|---|---|---|---|
| Add a diagram | The `.mmd` source, its PDF render, then `node tools/check/diagrams.stamp.mjs` | The README of the folder | `diagrams.check` fails on a source edited after its stamp |
| Add a part to the guide | A new file in `docs/setup/`, numbered next, and a row in `setup.md` | Every sentence that counts the parts | `facts.check` fails on a wrong count |
| Record a decision | A new file in `docs/architecture/adr/` and its row in the list there | The count of decision records wherever it is stated | `facts.check` |
| Change what differs between the copies | `PER_COPY_FILES` in `tools/check/parity.check.mjs` | The sentence that counts the list in `docs/contributing.md` and both `README.md` files | A test holds those numbers equal to the list |
| Change this handbook | Hand-written text in `docs/handover/`; the generated blocks come from `npm run handover:build` | The reading time follows by itself | `handover.check` |
