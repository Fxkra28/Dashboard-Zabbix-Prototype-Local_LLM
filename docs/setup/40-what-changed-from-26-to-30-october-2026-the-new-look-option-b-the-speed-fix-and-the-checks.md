# 40. What changed from 26 to 30 October 2026, the new look, option B, the speed fix and the checks that followed

[setup.md](../../setup.md) · previous: [§39](39-what-changed-on-22-october-2026-the-answers-the-restart-policies-and-the-rebuild.md)

*From 26 to 29 October you asked for a softer look and a design system, a feature audit, a change of data source twice, and on 29 October for the portal to ask HCML's Zabbix for less. On 30 October you asked me to do and check what was left unproven. The rows are UX-30, UX-31, IN-33 to IN-42, BK-17 to BK-25, MT-04 and MT-06 of [`tracker.md`](../../tracker.md), and the daily accounts are in `myown/documents/log/` (`10-26-26-hcml-portal.md` to `10-29-26-hcml-portal.md`), outside the repository.*

## 26 October: a softer look, and a design system

The page and its cards became one soft plane (`#E3E9F1` light, `#14263A` dark), separated by depth: what stands above the page is raised, and a field is pressed in. Controls keep a 1 px edge at 3:1 (`#748496`, `#517492`), because a shadow alone measured 1.20 to 1.59:1. Motion is one entrance and a few lifts, with a reduced-motion rule, and the expanded sidebar shows the logo in white. The SLA report files keep white paper. The rules are in `web/src/styles/18-soft-depth.css` and [DESIGN.md section 10](../../DESIGN.md) (row UX-30).

The design system is [`docs/design-system`](../design-system/README.md): the rules, every token family, each component with its states, `tokens.json` and `_tokens.scss` generated from the stylesheet, and a drift check inside `tokens.check`. Its audit found twelve gaps, all fixed the same day (row UX-31): new scales for spacing, weights, line heights and control heights, a KPI stripe only where a state sets one, a part `19-touch.css` that makes every control at least 44 px where the pointer is coarse, a danger button and one disabled look.

## 26 October: the feature audit

Every feature was tested on throwaway copies of the live build: 45 endpoints, 19 pages in both themes, 99 control actions and 38 accessibility scans with no WCAG 2.2 AA violation. Nine findings were fixed (IN-33 to IN-37, BK-17, UX-32, UX-33, SC-31), then UX-34 (the count that read "0 matching" while loading), UX-35 (the theme before the first paint), BK-18 (the SLA workbook's durations and its Summary page) and BK-19 (the Triggers card counts only monitored triggers: 15,111, not 18,104). Live as `0aa74d2` since 20:42.

## 26 to 28 October: two ways to get current data

HCML's own Zabbix was blocked by an expired certificate, so on 26 October the local copy's collector was switched on (option C). That evening the Mac left HCML's network and the copy recorded five hours of false outages (IN-39). On 27 October: `SLA_NO_DATA_WINDOWS` marks such hours as no data, the Dashboard says when Zabbix cannot reach the network, a guard script pauses the collector (written, not installed), the Assistant states counts over every open problem (BK-20), touch targets are 44 px (UX-36, UX-37) and each query declares its names (BK-14). IN-40 added an exception for HCML's expired certificate, by fingerprint and until a set day; it is live and switched off, because HCML's Zero Trust gateway refuses the route anyway.

## 29 October: HCML's Zabbix over its LAN address

The LAN address answers with the renewed certificate, so no exception is needed. Each copy has a `docker-compose.override.yml` that points `zabbix.hcml.co.id` at it for the backend alone, kept out of git because it names an internal address. Limits were raised for slow reads: one Zabbix read 300 s, a page 330 s, nginx 360 s, the SLA and an explanation 450 s, nginx 480 s. Option C was retired (IN-42), and its volume, snapshot and images were deleted later that day, keeping the September dump. HCML's Zabbix answered small reads in 0.1 s but the problem list in 43 s and every ping item in 81 s, and the cause is its database server: the disk 87 % busy all week, the programs using about 3 of 64 GB, MySQL at Ubuntu's defaults. The request for HCML IT is section 3 of its note.

## 29 October: the portal asks for less

Row BK-22: the problem list leaves out `opdata` (35 to 46 s down to 0.9 s) and Explain and the Assistant read it for the few problems they describe; known triggers keep their hosts (9.7 s down to 0.1 s); the item and trigger counts run in the background; the list is cached 15 s and the stream ticks at that pace; the ping items are listed once an hour and read in bulk (54.5 s down to 2.8 s). Row BK-23: the slow views answer from their last copy while one refresh runs, with `X-Data-Refreshing` and `X-Data-Age-Seconds`, and the page says how old the data is once the copy is two minutes old; a warm-up reads them once after a start; the Capacity report is kept an hour and shown for up to a day. The problem list is never answered that way. Also: a `wall` role (MT-06), `deploy/watch.sh` (IN-31), a settings gate in `deploy/rebuild.sh` (IN-38) and a look at the two long-down meter links on live data (MT-04, HCML's to fix).

## 30 October: checking the 17:03 build

A throwaway portal made from the live image read HCML's Zabbix, with the write token and the AI key blank and test accounts only. The same 19 pages, as the admin:

| | Whole pass | Slowest pages |
|---|---|---|
| Right after a start | 268.6 s | Noise report 61.7 s, Services 52.0 s, Availability 38.7 s, SLA 38.1 s, Dashboard 32.9 s |
| A few minutes later | 33.7 s | Graphs 21.8 s, the Dashboard 3.4 s |
| After 10 minutes idle | 170.3 s | Availability 58.1 s, Noise 47.9 s, Dashboard 30.1 s, Graphs 15.2 s, Network 11.2 s |

The signed-in check passed 7 of 7; Chrome loaded 38 of 38 pages clean as the admin, and 36 of 38 as the wall account (the other two are the inventory, 403 for it by design); WebKit shows each role the menu its role should. The four roles match the route rules on real data, and the wall account was refused the acknowledge request before write-back was even asked.

The checking found faults of mine, now fixed in the source: the live stream pinged every 30 s instead of every 15 s (BK-24), the documents told a wall account to be added in a way that would have locked the admin out, a viewer was told a network page is "for the wall role" and that interface data "needs the operator role", the tracker row IN-25 listed a file removed on 29 October, and on a VM with one copy `deploy/watch.sh` would have reported the other copy missing. It also found a slow page, BK-25: the Graphs page waited 15 to 22 s for its item list, because `/api/items` asked Zabbix for each item's last value, one item at a time. At your word (option A) it no longer asks: `lastvalue` and `lastclock` left the item list, the OpenAPI files and the web types (they stay in `/api/latest`), and the Graphs page opens in 1.1 s, a host of 609 graphable items in 0.95 s instead of 20 to 32 s.

## Numbers

Server 1,837 tests in 85 files and web 1,216 in 83, `npm run verify` at exit 0, the ten checkers pass. The rollback tags are cut to the two newest of each image (34 to 8).

Still yours: the sign-in of the live portals (`tools/live/signedin_check.py`, with your password in your own shell), the wall account (`admin:<password or hash>:admin,wall:<hash>:wall` in `PORTAL_USERS`, then recreate the backend), HCML IT's database settings, whether the repository goes private (SC-06), the commit of the working tree, and a yes for running Firefox once outside the sandbox.
