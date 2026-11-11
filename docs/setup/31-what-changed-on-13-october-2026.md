# 31. What changed on 13 October 2026

[setup.md](../../setup.md) · previous: [§30](30-what-changed-on-12-october-2026.md) · next: [§32](32-what-changed-on-14-october-2026.md)

*The "priorities 1 to 4" round of [`tracker.md`](../../tracker.md), done at your word, "everything except SC-06, IN-08 and SC-01": UX-14, UX-17, UX-18, UX-21, IN-21, IN-18, IN-01, the decision to keep SC-15 as it is, and the four items that live in `.env` files, IN-06, SC-14, SC-04 and SC-20, for which you allowed those lines to be opened. You had not chosen between the options, so each item took the smallest choice, named below. Each is built and tested in both copies, and both portals were rebuilt from this code the same morning and are running it (the last subsections give the steps and what was checked).*

## Narrow screens and wide tables (UX-14; §6)

The look in headless Chrome on 8 October found the Dashboard wider than the window at 390 px, and the Problems table wider than its card at 1440 px.

The first came from one rule. `.two-col`, the two-column grid of the Dashboard and the Inventory report, used bare `1fr` columns, and a `1fr` column cannot shrink below its widest content, so the host-group table, which sat in no scrolling box, set the width of the whole grid. The columns are now `minmax(0, 1.4fr) minmax(0, 1fr)` (a single `minmax(0, 1fr)` below 1100 px), the table sits in a `table-wrap`, and the Inventory gap-list controls wrap and shrink. `markup.test.tsx` fails on a table outside a `table-wrap` and on a `.two-col` track that cannot shrink.

Before the fix, 4 of the 85 combinations of page and width (17 pages at 1440, 1024, 720, 390 and 320 px) ran past the window: the Dashboard at 390 px (189 px) and 320 px (259 px), and the Inventory report at 390 px (55 px) and 320 px (125 px). After it: all 85 combinations fit, with no page wider than its window. A browser zoom of 200 percent on a 1440 px window is the 720 px column. The sweep is `myown/checks/layout-sweep.mjs`, which reads a dev portal and clicks nothing. It emulates a phone in headless Chrome; no real phone was used.

The second was the Problems table: 1,283 px wide in a card 1,094 px wide, so Explain and Ack sat past the right edge until the card was scrolled. The widest column was Tags, 288 px, set by one tag of 43 characters among the 666 problems of the restored data. Capping the chips at 10rem left the table 85 px too wide, and letting them wrap squeezed the column to 79 px, so the Actions column now stays in view instead: `position: sticky; right: 0` with an opaque fill (`.sticky-end`), on the Problems, Hosts and Sites, Latest data, Capacity and SLA tables. At 1440, 1024 and 390 px the Problems Actions header sits at the card's right edge while the table scrolls 189, 605 and 1,027 px, and the Hosts and Latest data tables do the same at 1024 px (124 and 204 px). The content and the type are as they were.

## Charts: Show data (UX-17; §6)

A "Show data" button under each chart's summary opens the plotted values as plain tables, one per series, and "Hide data" closes them. It is a real button with `aria-expanded` and `aria-controls`. Each table has a caption naming the series and the columns Time and Value, or Time, Average, Min and Max for a series from hourly trends, the ones whose tooltip shows a range. It is a table per series, not one merged table, because the items of different hosts are sampled at different moments. A long series scrolls in its own box, 320 px tall, which takes focus so the keyboard can scroll it, and its header row stays in view. The tables are built only while open: a series holds up to 1,500 points, the BFF's default. Checked in headless Chrome on a September item: 325 rows and the four columns. `TimeSeriesChart.test.tsx` has six new tests.

## Network ports and device cards (UX-18; §6)

A port row was a focusable `<tr>` with a tooltip as its only name. The interface name is now a button (`Gi1/0/2`, with the tooltip as its description and `aria-pressed` for the port that is open). The row has no tab stop and no title, and a click anywhere else on it still opens the graph, for a mouse. A port with nothing to graph is plain text.

A selected device card is drawn with a 2 px shadow ring instead of an outline, because the keyboard focus ring is an outline, and the old `.device.sel` outline replaced it: a focused card looked the same as a selected one. A card that is both now shows both, the focus ring 4 px outside the selection ring (measured in Chrome: a `0 0 0 2px` shadow, and a solid 2 px outline at offset 4 px).

Four facts that lived only in tooltips are now also text for a screen reader, and the tooltip stays for the mouse: why a refresh failed, that a figure rests on partial data (the asterisk is hidden from a reader and the words replace it), what the devices-with-data count on the SLA page counts, and what "degraded" means on a site. The other tooltips repeat visible text, describe a button, or give an item's key, and a button's tooltip is already its description. Tests: `networkPorts.test.tsx` (9) and `tooltipFacts.test.tsx` (4).

## Explain and the Assistant say when the model is not answering (IN-21; §24)

`/api/health` has carried `ready.model` since 7 October, from one cached `GET {AI_BASE_URL}/models`: `ok`, `down`, `off`, or `not_checked` for the hosted Anthropic model, which a probe would bill. The web app now reads it. When the Explain panel or the Assistant opens it asks `/api/health` once, and when `model` is `down` a note says "The AI model is not answering right now, so a request may fail. The rest of the portal is not affected." It is the `refresh-failed` note, at the top of the Explain dialog's body and above the Assistant's question box.

The buttons stay enabled. The check is cached for 15 seconds, and an older answer is served for up to a minute while a new check runs, so it can lag a model that has just come back, and a button that is disabled by a stale answer is worse than one that fails. The note never shows on the hosted copy, whose state is `not_checked`, and a failed health call shows nothing. `modelNotice.test.tsx` has 12 tests, and a mutant that stops reading `down` fails four of them.

## The type scale (UX-21)

Both inline `fontSize: 12.5` (the average value in the Capacity table, the device summary on Network) are `12`, the `--t-sm` step the other inline sizes use. `tokens.check.mjs` lists no exceptions now, and still fails when a listed one stops occurring.

## Diagram freshness (IN-18)

Each of the ten `.mmd` sources ends with `%% source-hash: <12 hex>`, the SHA-256 of the source without that line. `web/scripts/diagrams.check.mjs` fails when a source differs from its stamp, when a source has no PDF beside it, and when a PDF or PNG sits in a folder of sources with no source of its own. It is read-only, and CI runs it after the link check.

`web/scripts/diagrams.stamp.mjs` writes the stamp, and is the step run after a re-render. It refuses a source whose PDF is older than the source, the one mistake it can see, and `--force` stamps anyway for an edit that cannot change the picture, such as a comment. A stamp does not prove that the render was redone; it is the person's word, which is why stamping is a separate step from checking.

Mermaid ignores the comment: ServerFlow, CDM and the database ERD (the ELK layout) rendered identically with and without it, the SVG compared after the ids were normalised and the rough.js jitter removed for the ERD. `diagrams-check.test.ts` has 12 tests. Both copies were stamped after the re-render of 12 October.

## The build stamp and the changelog (IN-01)

`CHANGELOG.md` lists what changed in each build, newest first, and names the commit. Both portals were built as `748136c-dirty`: the hash of `HEAD`, and `-dirty` because the working tree held changes that were not yet committed. The work was committed afterwards as `cef91b3`, and the running portals report `748136c-dirty` until they are rebuilt. To stamp a build the same way:

```sh
BUILD_COMMIT=$(git rev-parse --short HEAD)$([ -n "$(git status --porcelain)" ] && echo -dirty) \
BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) docker compose up -d --build
```

The `hcml-portal-ollama` copy has no git of its own, so it takes the hash of `hcml-portal`. Nothing is tagged: say if you want a tag on `cef91b3`.

## The four `.env` changes (IN-06, SC-14, SC-04, SC-20; §8, §10, §19)

You allowed those lines to be opened, and nothing was printed: a script changed the named keys and reported only whether each was set and how long it was. The four files were copied to a private folder first. Your encrypted copies of these files ([`docs/operations/backup-and-restore.md`](../operations/backup-and-restore.md)) hold the old values now, so make new ones: that page asks for a new copy after every change to a token, `JWT_SECRET` or a setting.

| Item | File | Before | Now |
|---|---|---|---|
| IN-06 | the `.env` beside `docker-compose.yml`, both copies | `ZABBIX_WRITE_TOKEN` set | empty |
| SC-14 | the same two files | one `JWT_SECRET`, the same in both | a different random 64-character `JWT_SECRET` in each |
| SC-04 | `server/.env`, both copies | the 29-character placeholder, the same in both | a random 64-character secret, different in each |
| SC-20 | the root `.env`, both copies | no `NET_GROUP_IDS` | `NET_GROUP_IDS=7,19,20,22,23,24` |

IN-06. Acknowledge and Close are off in both portals. The buttons are gone, the Problems page says "Acknowledge is off on this portal. Ask the portal admin to turn it on.", and each BFF logs one warning at its start. Zabbix here is a restored database with no server process, so a close would be accepted, queued and never applied. To turn it on again, make an API token in Zabbix for a user who may update problems, put it in `.env` as `ZABBIX_WRITE_TOKEN=`, and run `docker compose up -d portal-bff`.

SC-14. Each portal has a secret of its own, so a leak of one cannot forge a session on the other. Every session ended when the BFFs were recreated: each open page reaches the sign-in form at its next request.

SC-04. The dev secrets are real now, which means a dev BFF started with `AUTH_ENABLED=true` no longer refuses on the placeholder. Dev still runs with sign-in off.

SC-20. Zabbix has nine host groups. The six that name network gear are in: ARUBA (7), IP INTERNET PUBLIC (19), REPEATER (20), HCML Network (22), FIREWALL DEVICES HCML (23) and SWITCH DEVICE HCML (24). Left out are Zabbix servers (4), Virtual machines (6) and Web Monitoring (25). Each choice was measured before it was written, by starting extra dev BFFs on other ports with `NET_GROUP_IDS` in their environment and comparing what `/api/net/devices` and `/api/links` returned:

| Groups | Devices on the Network page | Links |
|---|---|---|
| none set (before) | 142 | 135 |
| 7, 19, 20, 22, 23, 24 (now) | 139 | 135 |
| 22, 23, 24 only | 133 | 130 |

The three hosts that went are the ones in none of the six groups. The last row shows why the three HCML groups alone were not enough: nine devices and five links of Aruba, repeaters and the internet probes sit in the other three.

It also does what SC-20 is for: a viewer's maps lose the network hosts and their links. HCML has four maps, with 38 elements and 36 links, and 31 of those elements and all 36 links are network hosts, so a viewer's maps are close to empty. An operator sees them whole. If that is not what you want, blank the line and run `docker compose up -d portal-bff`: the map is cut only while the variable is set, and the operator's pages go back to every host.

## Putting it live (done on 13 October)

Both portals were rebuilt from this code on the morning of 13 October, at your word, hosted first (04:48:36 UTC) and then ollama (04:48:55). The images of the 12 October build are tagged `<name>:rollback-13oct` (for example `hcml-portal-portal-bff:rollback-13oct`). The command, in each folder:

```sh
BUILD_COMMIT=748136c-dirty BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) docker compose up -d --build
```

Checked without signing in: all four containers `healthy` with no restart, and the Zabbix stack untouched; both pages serve the new bundle `index-DIeBCwKH.js`, and the lazy chunks hold "Show data", the model note and the `sticky-end` class; each BFF reports `NET_GROUP_IDS=7,19,20,22,23,24`, an empty write token, its own 64-character `JWT_SECRET` (the two differ) and its build stamp; `/api/health` answers `writeBack: false` on both; `/api/problems` is refused with 401; the BFFs log one warning each, that the write token is not set, and the web logs hold nothing.

Not checked, because it needs a sign-in on this build: the footer line (`Build 748136c-dirty, 13/10/2026, 11.48.36 WIB` on :8081 and `11.48.55 WIB` on :8082), a report download through nginx's buffer, the live stream, the Problems page without its buttons, and a viewer's maps. `myown/checks/signedin_check.py` runs the first four against a portal; it reads the sign-in from `PORTAL_USER` and `PORTAL_PASSWORD` and prints neither.

To go back: `docker tag <name>:rollback-13oct <name>:latest` for the four images, then `docker compose up -d --no-build` in each folder. The settings are a separate matter. The `.env` values from before the change are in the private folder the work used, which goes when the macOS temp folder is cleaned; a write token can be made again in Zabbix.

## Screenshots in the README and the docs

`docs/screenshots/` holds seven images of the main pages (the Dashboard in the light and dark themes and on a narrow screen, Problems, Sites, Graphs and Network), and the README and the getting-started guide show some of them. The repository is public and the portal shows HCML's host names, so the images were made with the names replaced, not edited afterwards. A capture script drives Chrome and rewrites every host name, IP address and interface description in the page. It reads the real host list from the portal at run time, so nothing real is written in the script, and it refuses to write an image while a real name is left.

The stand-ins are stable, so one host has one name in every image: `1.4 SW-04` for a host with a site number, `INET : JAKARTA WAN-114` for a link, an address in 198.18.0.0/15, and `link-` with three digits for a description or a link name. Its first runs stopped on what they found, and each find got a rule: the free-text values of problem tags (`health-check`, `description`), SD-WAN link names in square brackets in problem texts, and VPN tunnel and interface labels in the Graphs item list. After that every image was looked at, because the check reads text and cannot read a chart.

The script and its self-test (a made-up estate, with eight mutants of the script, all caught) are in `myown/screenshots/`, outside the repository, because the script works from the real host list. The images came from a dev portal running this code with sign-in off, which shows the pages an administrator sees. The unreplaced originals stay in `pic/`, which git ignores.

Left out on purpose: the SLA page, which prints each site's availability for the month, figures a reader could take for HCML's own. The images do show the size and shape of the estate, 139 hosts and 666 open problems, though not what the devices are called. If that is too much, the counts can be replaced as well. A new image goes through the same capture, and `docs/contributing.md` says so.

## Left alone, and why

* SC-06, SC-01 and IN-08. Making the GitHub repository private and revoking the token in `cb97069`, rotating the Anthropic key, and putting `hcml-portal-ollama` under git are yours, and you said to leave them.
* SC-15. The caps stay: 100 screens in all (`STREAM_MAX_CLIENTS`) and 5 per user (`STREAM_MAX_PER_USER`). A wall of more than five screens on one shared login needs the second raised in `.env`.
* BK-14. Query and response schemas change how every query string is read, and generating the OpenAPI file adds `@fastify/swagger`, a dependency.
* FR-16. What is left is generating the web types from the OpenAPI file with `openapi-typescript`, a dev dependency.
* IN-11. A smaller stream frame risks delaying frames past the 45 second watchdog that the Dashboard uses to notice a dead stream.
* BK-13. Rounding explicit graph ranges to the minute gains nothing: the range picker already sends minute-aligned times.
* IN-13 and IN-25. One repository with two deployment profiles is a structure decision, and the Linux compose file needs a Linux server to try it on.
