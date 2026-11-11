# 32. What changed on 14 October 2026

[setup.md](../../setup.md) · previous: [§31](31-what-changed-on-13-october-2026.md) · next: [§33](33-what-changed-on-14-october-2026-the-mentors-requests.md)

*Batches A, B and C of the second audit in [`tracker.md`](../../tracker.md), done at your word (the code only, with the `.env` permissions included): SC-24 to SC-29, BK-15, BK-16, FR-19, UX-25 to UX-28, IN-29 and IN-32, 15 of the 21 rows. Both portals were then rebuilt from it at your word, as `ce3634d-dirty`, and it is not committed yet.*

## The web container's headers (SC-24, SC-28)

`web/nginx.conf` sends `Content-Security-Policy` where it sent `Content-Security-Policy-Report-Only`, in all five locations that set headers. The policy is the same one. Before enforcing it, every page was opened in headless Chrome behind a stand-in for nginx that enforced it (`myown/checks/enforcing-csp-server.mjs`): all 18 routes, in the light and dark themes and at 390 px, with no violation, and then the four downloads (the two CSV files, the SLA PDF and the Excel file), which a blob link could have lost. All four arrived.

A new location answers 404 for a path with a dot-file segment (`/.env`, `/.git/config`, `/x/.hidden`), before the logo location because the first regex that matches wins, and it leaves `/bff` alone. The pattern is `^/(?!bff/)(.*/)?\.`. A throwaway nginx of the same image, with the new file mounted, answered 404 for those paths and for `/%2eenv`, 200 for the pages, the logo and the font, and 502 (no BFF behind it) for `/bff/.env`, so the BFF still gets that path. `nginx -t` passed.

## The BFF's replies (SC-27, SC-29)

`noStore.ts` puts `Cache-Control: no-store` on every `/api` reply unless the route already chose one (the SLA download, the two streams) or it is `/api/health`. helmet's `hsts` is off: the header over plain HTTP claimed a TLS that is not there, so [`docs/operations/tls.md`](../operations/tls.md) now says the proxy in front is the one that sends it.

`errors.ts` answers a failed Zabbix read with one sentence, "The data source is not answering. Tell an administrator and quote reference <request id>.", for the three typed failures (a Zabbix error 502, a timeout and a rejected token 503). The method name, the setting to check and what Zabbix said went from the body to the log, and the log line now carries the same request id (`req.log`, where it was `app.log`). The live stream and the Assistant say the sentence without a reference. An administrator still sees the settings to check under it (`states.tsx`). The `error` codes did not change. The message of `zabbix_write_disabled` still names its setting: it is shown only to someone who pressed Acknowledge, and the write token is off.

## Heavy reports (BK-15)

`gate.ts` lets two jobs run at once and queues the rest in order. The noise, both availability and the capacity reports read Zabbix through it, so a new `days` or `severity` waits for one of two places instead of all reaching MySQL at once. A cached answer does not wait, and four requests for one query still share one read. Waiting changes no status code and no field. Not done: the second step of the row, rounding `days` to the values the page offers, which would change what the API accepts.

## Graphs and Latest data (FR-19)

When the host list cannot load, Graphs shows the error in its Items panel and "Hosts unavailable" in the menu, and says "No hosts to show." when the list loads empty. Latest data shows the error in place of the table when nothing is picked and a menu list failed, and a note above the table when the address names a host. The row said these error cards have a Retry button. They do not: `ErrorState` has none, and a page recovers on its next load. That was not added.

## Small fixes (UX-25 to UX-28, BK-16, IN-29, IN-32)

* UX-25: a `::placeholder` rule in the theme's `--muted`. In the dark theme it measured 3.78:1 and now passes; with the rule taken out the audit finds 3.78 again on the two pages tried. The Maps legend dots (1.5 to 3.6:1) are left alone: they are `aria-hidden` and the words beside them say the same.
* UX-26: `MonthSelect` ties its label to the menu with `useId`; `MethodToggle` uses `FieldGroup`; 13 fields that had neither `id` nor `name` have a `name`, and a test reads every `input`, `select` and `textarea` in `web/src` for one.
* UX-27: the port buttons, sort headers, Services arrows, the SLA list's summary and the chart chips reach 24 px, with negative margins so no row or chip grows. At 1440 px the audit found 57 targets under 24 px, and now finds 3: the check boxes, which are 16 px inside 38 px labels.
* UX-28: `count(n, 'host')` in `lib/plural.ts`, in the nine places of the row and three more (Maps elements and links, the services count on the SLA page).
* BK-16: `BuiltFile`, `PING` and `hoursToIntervals` are gone.
* IN-29: `.nvmrc` holds `24`, both `package.json` files say `"node": ">=24 <25"`, and `docs.yml` reads `.nvmrc`. This Mac runs Node 25.9, so `npm install` still prints a warning here, and the tests pass.
* IN-32: `docs/flow/README.md` cites `rateLimit.ts:22-35`, and `links.check.mjs` now fails on a line citation that runs past the end of its file. It proves the lines exist and no more. The three records of past code (`tracker.md`, `CHANGELOG.md`, `AUDIT_REPORT.md`) are left out of it.

## Files and dependencies (SC-25, SC-26)

The four `.env` files are mode 600 (`stat -f %Lp`): only their permissions were touched, and they were not opened. `docs/operations/backup-and-restore.md` says to check it. `npm audit fix` in both folders changed `fast-jwt` 6.3.3 to 6.3.4 and `source-map-js` 1.2.1 to 1.2.2, the lockfiles only, and `npm audit` reports 0 in both.

## Checked

Server 1,537 tests in 70 files, web 844 in 59 files, both typechecks, the lint, the build, the nine checkers and the BK-11 restore patch, in both copies. Each new test was tried against the old code: the heavy-report gate removed from one report fails all three of its tests, and the old Graphs and Latest data pages fail six of the nine FR-19 tests. `download-check.mjs` is new in `myown/checks/`.

On the day of the rebuild all of it was run again on the final sources, which were fingerprinted before and after and had not changed: the suites, typechecks, lint, build, checkers, parity and the restore patch in both copies; 18 pages in headless Chrome under the enforced policy (light, dark and 390 px) with no console error, no failed request and no policy violation; the four downloads; and the three controls against the old code. The page audit still lists the three 16 px check boxes and the seven Maps legend dots, which are left as said above.

Not checked: a signed-in pass on the rebuilt portals, anything on a phone, and the gate under real concurrent load (its tests use a stand-in for Zabbix, and the pages and downloads above ran one request at a time against HCML's restored data).

## The rebuild

Done at your word ("rebuild") on 14 October. The four images in use were tagged `rollback-14oct` first, then hosted and ollama were built in turn as `ce3634d-dirty` (hosted built at 05:24 UTC and started at 05:25, ollama built at 05:25 and started at 05:26):

```sh
cd /Users/muizfata/Intern/Proto1/myown
for n in hcml-portal-portal-web hcml-portal-portal-bff hcml-portal-ollama-portal-web hcml-portal-ollama-portal-bff; do docker tag "${n}:latest" "${n}:rollback-14oct"; done
cd hcml-portal && BUILD_COMMIT=ce3634d-dirty BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) docker compose up -d --build
cd ../hcml-portal-ollama && BUILD_COMMIT=ce3634d-dirty BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) docker compose up -d --build
```

The first hosted attempt failed in the web image's `npm ci` with `ECONNRESET` after 12 minutes. The Docker network was slow (one registry request took 69 s from inside Docker), and nothing running was touched, because a build that fails stops before any container is recreated. The second attempt went through, and the ollama build reused the cached layers. If it happens again, run the same command again.

Checked without signing in, on both portals: all four containers `healthy` with no restart, and the Zabbix stack untouched (the same start times as before); the new bundle `index-ClUUouEi.js` (it was `index-DIeBCwKH.js`), whose Graphs chunk holds "No hosts to show" and "Hosts unavailable"; `Content-Security-Policy` sent in place of the report-only header; 404 for `/.env`, `/.git/config`, `/a/.hidden`, `/%2eenv` and `/assets/.x`, and 200 for `/`, `/problems`, `/graphs`, the logo and the font (`font/woff2`, cached for 30 days), with `/bff/.env` still answered by the BFF; `/bff/api/health` 200 with `writeBack: false`, no `Cache-Control` and no `Strict-Transport-Security`; `/bff/api/problems` 401 with `Cache-Control: no-store`; and one warning in each BFF's log, that the write token is not set.

Not checked, because it needs a sign-in on this build: the footer line (`Build ce3634d-dirty, 14/10/2026, 12.24.42 WIB` on :8081 and `12.25.58 WIB` on :8082), a report download through nginx's buffer, the live stream, the Problems page and a viewer's maps. `myown/checks/signedin_check.py` runs the first three, with `PORTAL_USER` and `PORTAL_PASSWORD` set. No secret changed in this round, so sessions stay valid, though an open tab needs a reload to get the new page.

To go back: `docker tag <name>:rollback-14oct <name>:latest` for the four images, then `docker compose up -d --no-build` in each folder.

## Left alone

* SC-23 (the Zabbix tokens belong to a Super admin), IN-27, IN-28, IN-30, IN-31 and SC-30: batches D and E, which need you in Zabbix or your word. Since then: IN-28 was done on 19 October ([§37](37-what-changed-on-19-october-2026-the-check-and-six-rows.md)) and SC-30 is partly done, as the `LICENSE` and `SECURITY.md` files exist since 16 October ([§36](36-what-changed-on-16-october-2026-the-folders.md)); SC-23, IN-27, IN-30 and IN-31 are still open on 20 October.
* SC-06, SC-01 and IN-08, as before.
