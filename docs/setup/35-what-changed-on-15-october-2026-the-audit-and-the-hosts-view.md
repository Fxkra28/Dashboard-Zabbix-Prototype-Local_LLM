# 35. What changed on 15 October 2026, the audit and the Hosts view

[setup.md](../../setup.md) · previous: [§34](34-what-changed-on-14-october-2026-the-follow-ups-to-the-meters.md) · next: [§36](36-what-changed-on-16-october-2026-the-folders.md)

*You asked me to check again what is done, what is partly done and what is not done, and to add the indicators that were missing (the re-audit and MT-08 in [`tracker.md`](../../tracker.md)). The audit changed the code in one small place and added tests. The Hosts view is new. All of it is built and tested in both copies. None of it is in the running portals, which have the build of section 33, until you ask for a rebuild.*

## The audit

Three readers who had not written the code took the 116 rows marked done and checked each against the code, the tests and the files the row names, one for Security and Backend, one for Frontend and UX, one for Integration and the mentor rows. I took the 16 that are not done. 112 of the 116 hold as written. Four were partly true:

* **BK-08.** The row said the limit was built and the endpoint still registered. BK-11 removed `/api/history` on 12 October, with the limit, the header and their tests. The risk is gone, so the row stays done, and its text now says so.
* **IN-09.** "Every reply carries `X-Request-Id`" was true except for the assistant's stream, `POST /api/chat`, which writes its own headers. It carries the id now (`routes/chat.ts`), and `chat-route.test.ts` says so.
* **UX-20.** The pages' own hints keep setting names and "the BFF" for admins, as the row says. Three sentences the server sends do not: "Details are in the BFF log" (an unexpected error in a route, in the assistant and in the live stream), and two that name a setting (the write token and the AI key), which `errors.ts` chose to say so that a person can see what to fix. Marked partly. It is a wording choice, so it is a question in [`tracker.md`](../../tracker.md#needs-your-decision).
* **FR-13.** The row says it itself: sign-in ignores the case of a name, and the example `.env` files still say `Admin`, because I do not open them. Marked partly.

So of the 104 first items 92 are done, 10 are partly done and 2 are not done. None of the 16 rows that were open has closed. Twelve of them wait for you (a secret, a GitHub setting, a licence, a Zabbix role, a server, or a design call), and four have a part left on purpose (BK-13, FR-16, IN-01, IN-11).

Also found, and what I did about it:

* The README said the CSP is report-only. It has been enforced since SC-24. Fixed in both READMEs, and in the notes of IN-02 and ADR-0010.
* The API surface test (`surface.test.ts`) mounted 18 of the 20 route modules, so it did not pin `/api/devices` or `/api/net/meters`, nor the role of either. It mounts all of them now: 22 modules, 39 endpoints, and 45 with health, ready and the four sign-in routes.
* Five behaviours had code and no test: the sign-in probe's retry (FR-02, `useAuth.test.tsx`), the data stamp and the 90-second warning (UX-01), the "12 of N open problems" line and its link (UX-12, both in `freshness.test.tsx`), the dialog's focus trap and the return of focus (UX-08, `useDialogFocus.test.tsx`), and the skip link (UX-10, `routes.test.tsx`).
* `docs/README_copy.md` in the ollama copy is a snapshot the parity script exempts. It still says a mistyped `AI_PROVIDER` falls back silently, which is BK-12's old wording. Left as it is.
* Every diagram render is older than its source by file date, since the hashes were stamped on 13 October. The check (IN-18) compares hashes and passes, and the label words of all ten sources are in their PDFs.

Could not be checked from the files: the contents of every `.env` and `.env.example` (I do not open them), GitHub (whether the pinned actions are the real ones, any run, the billing lock), the advisories `npm audit` reports (they come from the registry), the running containers, the browser runs that a row cites as its evidence, and HCML's live Zabbix.

## Which indicators were missing (MT-08)

HCML's Zabbix has four dashboards. "Global view" holds the 34 gauges the portal already shows and, beside them, a clock, system information, host availability, two Top hosts widgets (CPU and memory), a problem list, problems by severity, a map and two Web monitoring widgets. "System Availability" is a host availability widget on its own, and "Web Monitoring" a web widget on its own, so the team looks at both. (Read with `dashboard.get`, widget types only.) The portal had the gauges, the clock (wall mode), the four counts of system information (the Overview's first row), the problem list and problems by severity (the Overview), and the map (Maps). It had no host availability, no count of web scenarios and no list of the busiest hosts. Those three, and the kinds of device the mentor asked for, are the new Hosts view.

## The Hosts view

A third view of the Dashboard, between the Overview and Internet traffic (`/?view=hosts`):

* **Host availability.** The monitored hosts, and how many are up, degraded, down or have no data, with the share that are up. The state is the portal's own (ping first, and the interface's availability flag when there is no current ping, section 26), the same one the Hosts and Devices pages use, so the numbers agree with them. A disabled host is not counted. A host in a maintenance window is counted in its state, and the total says how many are in one.
* **Devices by kind.** The Devices page's tiles (MT-01). Each links to the Devices page for that kind, except on a wall and for a kind with no device.
* **Web monitoring.** The web scenarios that pass, that fail and that have no current result, and the failed ones listed with the step that failed. Zabbix's widget gives only the counts. The portal lists the failures because a NOC wants to know which one. `GET /api/reports/web-monitoring` reads the result item of each enabled scenario, `web.test.fail[<scenario>]` (0 when every step passed, otherwise the step), with `item.get` and `webitems`, which Zabbix needs before it returns web items at all.
* **Top hosts by CPU and by memory.** Ten hosts each, as Zabbix's widget lists them, with a bar that turns orange from 75 percent and red from 90, and a link to the Graphs page for that item. `GET /api/reports/top-hosts` finds the items the capacity report finds (`system.cpu.util`, `vm.memory.util`, the SNMP forms of Cisco and FortiGate), takes a host's hottest item once, and never takes the idle share.

**Current figures only.** The rule is the portal's everywhere (`isFresh`): a value older than three of its item's intervals, and at least ten minutes, is not shown. An old result is never read as OK, so a web scenario nobody has run lately is Unknown. A list with no current value says so ("No current value: 62 hosts have the item, none collected it lately") instead of listing old figures. The copy of Zabbix on this laptop stopped polling on 14 September, so on it the two lists are empty (62 hosts have each item, none has a current value) and the seven web scenarios of the estate (on one host, all with a stored result of 0 and no collection time) read as Unknown. The availability counts are the Hosts page's own: 139 monitored hosts, 71 up, 24 down and 44 with no data. No ping is current on that copy, so all 95 verdicts of up and down come from the interfaces' availability flags, which keep the answer of the last poll, and the 44 are hosts with no interface (43) or with no verdict (1).

**Who sees it.** Everyone, viewers included. It is host data and not interface data: `/api/devices`, `/api/reports/top-hosts` and `/api/reports/web-monitoring` are viewer routes. A viewer's Dashboard now has two tabs, Overview and Hosts, and a viewer's wall turns between the two. An operator's wall turns between the three (30 seconds each, `rotate=`, Pause, `view=hosts` holds the view, as in section 34).

**The wall.** The slide is fitted like the others (section 34), and a wall cannot scroll, so it lists the first eight hosts of each list and the first three failed scenarios, with "and N more" for the rest. A page lists ten hosts and every failure it was given (up to ten). Measured in headless Chrome with made-up figures, the wall draws the slide at 0.91 on a 1080 px screen (the Overview at 0.96, the meters at 0.92) and at 0.86 with ten scenarios failing, which still fits, and at 0.64 and 0.61 on a 768 px screen. On a phone the panels stack, in the order above.

**One request each.** The Dashboard holds the three requests of the view (`hooks/useHostsView.ts`: the devices, the busiest hosts, the web scenarios), a minute apart, so the tab and a wall that turns to it share them, and one that fails does not take the others with it.

**How it was checked.** `top-hosts-route.test.ts` (10) and `web-monitoring-route.test.ts` (16) against a mocked Zabbix: the states, the counts adding up, the old and empty and text values, the order, the limits, the cache key for each limit, the parameters sent to Zabbix, and a failure that never names Zabbix. On the web, `hostsView.test.ts`, `HostsView.test.tsx` (23), `useHostsView.test.tsx`, `guardsData.test.ts` and `dashboardViews.test.tsx`. 104 deliberate breakages in all, the new tests of the audit included. 15 got through the first tests: 14 each got a test of its own, and the other cannot be reached (an `|| 1` that can never be needed) and was left. In headless Chrome, with scratch servers of made-up numbers, the view was drawn in the light theme, the dark theme, at 390 px and on a wall at 1080 and 768 px.

**Not checked.** The Hosts view against HCML's own, polling Zabbix, which is the only place the busiest hosts and the web scenarios will have current figures. A real wall screen or TV. A phone as a device. The view signed in as a viewer on a running build.

## Left alone, and why

* The map and the clock of the Zabbix home. The Maps page has the topology and the wall has a clock.
* The problem list, problems by severity and system information. The Overview has them.
* A "Zabbix server is running" check. The Overview's notice, "Zabbix has collected nothing since …", says it when the data stops.
* Which web scenario belongs to which site. The scenario's own name and host are written as they are.

## To make it live

Only when you ask for it by name, for example "rebuild both portals". The recipe of section 33 applies, with one change: tag the images from before as `rollback-15oct`.
