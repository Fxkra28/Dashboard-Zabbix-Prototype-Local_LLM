# Exercises

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators and developers | about 6 min | [The traps](traps.md) | [The decisions, in plain words](../5-reference/decisions.md) |

Twelve small tasks that show whether you can find your way around, in the order that a new person meets them. The first five are for whoever runs the portal and need no code. The other seven are for whoever changes it. Each has a question, where to look, and the answer, so that you can check yourself. Try each before reading the answer.

## For whoever runs it

### 1. Which build runs, and does it reach Zabbix?

Look at `GET /api/health` on each portal, signed in. The answer holds `build.commit` and `build.time`, the version, when the server started, and `ready`. `ready.ok` is true when Zabbix answered one cached `host.get` within two seconds, and `ready.zabbix` says why when it is not. A build with `-dirty` after the commit was made from files that were not committed. The same build is in the footer of every page.

### 2. A colleague sends a screenshot of an error that says "quote reference 5f2a". Find what happened.

Run `docker logs <server container>` and search for the reference. The server logs one JSON line for each request (the health check's excepted) with `reqId`, and the error line names the Zabbix method, the setting to check, and what Zabbix said. nginx's access line has the same id as `rid=`. That the id travels from nginx to the log to the page is what [one request](../2-code/one-request.md) shows.

### 3. What would the rebuild do right now?

From `hcml-portal`, run `deploy/rebuild.sh --dry-run` and read it. It names the commit the build would carry, whether the tree is clean, which images it would tag for a rollback, in which order it builds the copies, and what makes it refuse. It runs nothing that changes anything.

### 4. How many ways back are there?

`docker images` lists the images of each portal. Those tagged `rollback-<day><month>` are the ways back. The rule keeps the two newest of each image, and an older one is deleted only when the owner says so.

### 5. What does the Dashboard say when Zabbix stops collecting, and where does the wording come from?

The banner reads "Zabbix has collected nothing since" and a time. It comes from `CollectorNotice` in `web/src/shared/components/CollectorNotice.tsx`, which reads the answer of `/api/freshness`. That answer is made by `collectingStatus` in `server/src/domain/reachability.ts`: `stale` is true when the newest value any supported ping item holds is older than `COLLECTING_STALE_SECONDS`, ten minutes. The chapter on [domain and hosts](../2-code/server-domain-and-hosts.md) walks through it.

## For whoever changes it

### 6. Where is the problem list kept for 15 seconds, and what else depends on that number?

`PROBLEMS_TTL_MS` in `server/src/domain/queries.ts`, used by `cachedProblems`. The live stream's tick, `TICK_MS` in `server/src/services/stream.ts`, is defined as the same number, so a tick finds the entry due and reads Zabbix once for every screen. It also passes `maxAgeMs` of 0, because the cache dates an entry from the end of its read. The comment in `routes/problems.ts` and the handbook say 15 seconds too. If you changed it, `stream.test.ts` and `light-reads.test.ts` are the tests to read first.

### 7. Who may call `/api/links`, and how would you prove it?

The `wall` role and above. The rule is in `ROUTE_RULES` in `server/src/security/auth.ts`: `/api/(links|net)` needs `wall`. It is proved by `surface.test.ts`, which pins every route and its role, and `auth-rules.test.ts`. The sidebar needs no change, because `pageRoles` runs `requiredRole` over the route that fills each page, so the menu follows the rule. A viewer who types the address gets the page that says it is for wall screens, and the call is a 403.

### 8. Make the "flapping" flag need ten firings and not five.

No code changes. The flag reads `NOISE_MIN_COUNT`, in `config.noise`, whose default is 5. Set `NOISE_MIN_COUNT=10` in the copy's `.env` and recreate the server container. `compose-env.test.ts` is why Compose passes it: the test fails when the server reads a setting that Compose leaves out. Recreating the container empties the server's cache, so the next request builds the report with the new setting. The same number is the least count for the `unactioned` flag, so that flag moves too, and each copy has its own `.env`: change it in both, or the two portals will disagree.

### 9. Add a field to the Dashboard's counts.

Follow [change recipes](change-recipes.md), numbers 1 and 7. The field is added in `getStats` in `server/src/services/reports.ts`, described under `/api/stats` in `docs/api/openapi.yaml`, regenerated with `npm run gen:api`, added to `Stats` in `web/src/types/dashboard.ts` and to the `stats` shape in `web/src/guards/dashboard.ts`. The compiler leads you to the guard. `statsItemCount.test.ts`, `guardsData.test.ts` and `openapiTypes.test.ts` fail until each is updated, which is how you know you have missed nothing.

### 10. Trace a click on Acknowledge, from the dialog to Zabbix.

`submit` in `web/src/features/problems/AckDialog.tsx` calls `api.acknowledge`, which is `post` in `web/src/api/client.ts` with the `X-HCML-CSRF` header. The server's guard checks the session, the role (`operator`, from `ROUTE_RULES`) and the cross-site header. `actionRoutes` in `server/src/routes/actions.ts` checks the body, builds the message with `[portal:<user>]` in front, and calls `zbxWrite('event.acknowledge', ...)`. Then it invalidates the caches in `STALE_AFTER_WRITE` with a hold and calls `notifyProblemsChanged`, which pushes the list to the live screens. [The write path](../2-code/server-routes.md) has the code.

### 11. What does a restart cost a closed month's SLA?

A closed month cannot change, yet a restart computes it again. The cache is in memory, so a restart loses it, and the first request pays the 20 or so Zabbix calls again. Within a run, `getMonthlySli` keeps a closed month for a day and pins it, so it cannot be pushed out of the cache, and it puts `closed` in the key, so a report built while the month was running is never kept as the final figure. The cost of a restart is on purpose, [ADR-0003](../../architecture/adr/0003-no-database.md) records it, and the warm-up does not include the SLA figures, so the first visit waits.

### 12. Make a new page that only admins may open.

Give its route a rule in `ROUTE_RULES` with the role `admin`, and update `surface.test.ts`. Add the page to `PAGE_API` in `server/src/security/pageAccess.ts`. Describe the route in `docs/api/openapi.yaml`. Add the page's `Route` in `App.tsx`, its link in `Sidebar.tsx`, and its name in the page lists of the live audit tools. The sidebar hides the link from a lower role because `/api/auth/me` sends the role each page needs. The server remains the authority. `/api/reports/inventory` is the existing example of an admin page.
