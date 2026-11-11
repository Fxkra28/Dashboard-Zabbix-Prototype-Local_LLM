# 33. What changed on 14 October 2026, the mentor's requests

[setup.md](../../setup.md) · previous: [§32](32-what-changed-on-14-october-2026.md) · next: [§34](34-what-changed-on-14-october-2026-the-follow-ups-to-the-meters.md)

*Three requests from your mentor, done at your word after you answered my questions: operators and admins only for the meters, a full Devices page for each kind, and a Show data table that follows the selection (MT-01 to MT-03 in [`tracker.md`](../../tracker.md)). Both portals were rebuilt from it at your word later the same day, so it is live (The rebuild, below).*

## Show data follows the selection (MT-02)

It did follow the selection, one table for each chosen item. What was wrong, found by driving the page in headless Chrome, is that the panel closed itself every time an item was added or removed or the range changed. `GraphView` keys the chart on the selection and the range, so the chart is remounted, and the open state lived inside it. The state is now held by `GraphView`, and `TimeSeriesChart` takes `dataOpen` and `onDataOpenChange` (left out, it keeps its own, as before).

The tables became one. `lib/chartTable.ts` joins the points of all the chosen items on the exact time they carry: trend points sit on the hour, and a downsampled series falls on bucket centres the series share, so they line up. A raw series from an item polled separately may not, and then a row has an empty cell, which says "No value at this time", where a collection gap still says "No data". Nothing is moved or averaged. The table has the time on the left, kept in view when it scrolls sideways, a column group under each item's name, and Average, Min and Max for an item from trends. The header sticks as one block, so the second header row stays under the first. With four items of 1,500 points each, 6,000 rows, the join takes about a millisecond on the development laptop. Drawing that many rows is the larger cost, and the table is built only while it is open.

## The Devices page (MT-01)

`GET /api/devices` reads the Hosts page's overview through the same cache entry (so the host list is asked for once, whichever page asks first) and the templates of each host, kept five minutes, and gives each host the kind `deviceClass` gives it from the template and then the name. The SLA report decides the same way, so a switch is a switch on both. `classes` lists the kinds in the order the page shows them, and a test fails when a kind is added to `naming.ts` and left out of that list.

The page, `/devices`, is a viewer page after Hosts in the menu: a tile for each kind with its count, how many have problems and how many are down, and under them the Hosts page's table with the site and the template added. The kind, the search (name, site or template) and the problems filter live in the address. The tile of a kind with no device is turned off. Operators and admins get a Ports link to the Network page with the device chosen, which keeps interface data with them (`viewerPolicy.ts`). The page offers no way to add or change a device: it is read-only, and a test says so.

On the restored data, 142 hosts: Switches 52, WAN links 22, Firewalls 14, Radio repeaters 13, Access points 31, Servers 3, Web services 3, Other 4. The SLA report counts 138, so its Access points are 30 and its Other 1. "Ethernet" was read as ports, which are not a kind of device, so ports are one click away on the Network page and are not counted for each kind.

## The internet traffic meters (MT-03, [ADR-0012](../architecture/adr/0012-internet-meters-from-the-zabbix-dashboard.md))

**Where the facts come from.** HCML's Zabbix has a dashboard, "Global view", of gauge widgets: each is bound to one interface item and holds the capacity of the link as its maximum and the start of each colour zone. `GET /api/net/meters` reads that dashboard with `dashboard.get` (kept two minutes), so the portal shows the same links with the same scales and nobody keeps a second list. The name is `INTERNET_METERS_DASHBOARD` (default `Global view`; `.env.example`, `deploy/settings.example` and compose carry it). Nothing about HCML's links is written in the repository.

**What a meter is.** One for each gauge widget, in the order a person reads the pages (a page at a time, each from the top row down and from the left), and one for each item, so a page that repeats an item adds nothing. The scale is the widget's minimum and maximum, read with the item's units and an optional K, M, G or T. The zones come from its thresholds, with only what a colour means kept: blue the low end, green normal, yellow or orange high, red critical, grey nothing. The page draws that meaning in its own palette and says it as a word.

**The value.** The item's last value. Zabbix keeps that only for a day, and the copy on the development laptop stopped polling on 14 September, so items with none are read from history, one newest row each, eight at a time, and come back as old readings with their own time. A reading counts as current for three update intervals and at least ten minutes (`isFresh`, as for every other page).

**The states.** `ok` is a current reading. `stale` is an old one: the dial is dimmed and the line under it says "Old reading, from Sep 14 14:01 (29 days ago)". `nodata` is an item that has never held a value. `unsupported` is an item that is disabled or that Zabbix cannot collect. `missing` is a widget that names no item or an item that is gone, which is the "No permissions to referred object" of the Zabbix picture. `invalid` is a widget with no usable maximum. Each says what is wrong in words under the title, and a meter in the red zone also counts in the sentence above the grid.

**Who sees it.** Operators and admins. It is interface data, `/api/net` is an operator rule, and a viewer gets 403 from the route and has no Internet traffic tab. Since 15 October a viewer's Dashboard has the Hosts view instead (section 35), and a wall screen that signs in as a viewer turns between the Overview and the Hosts.

**On the Dashboard.** Two views, like the pages of a Zabbix dashboard, as tabs: Overview and Internet traffic, chosen by the tab and by the address (`/?view=internet`). The wall screen keeps the tabs, so a wall is sent to the meters by its address (`/?wall=1&view=internet`). 27 meters take about a screen and a tenth at 1080p, which is why the wall shows one view or the other, and not both. Since then the wall turns between them and each slide is drawn to fit (section 34). The section polls once a minute.

**How it was checked.** The route and the reader against the shape of HCML's own widgets (`meters.test.ts`, `meters-route.test.ts`), the dial geometry and wording (`gauge.test.ts`), the component in every state (`Gauge.test.tsx`), and the Dashboard for each role (`dashboardViews.test.tsx`). On the restored Zabbix the route returns 27 meters from 34 widgets (21 old readings, 1 item with no sample, 2 items not collected, 3 widgets whose item is gone). In headless Chrome under the enforced policy, in the light theme, the dark theme and at 390 px, the new views have no console error, no failed request, no violation, no failing contrast and no stop without a focus ring. Fresh readings were drawn from a scratch server of made-up numbers, outside the repository, because the stored data is old; they showed the zones in full colour, the needle, the scale, and the zone words in their colours.

**Not checked.** The meters against HCML's own, polling Zabbix. Whether the widgets' capacities are right: one link reads 113 percent of its capacity on the stored data. A phone: the meters were drawn at 390 px in Chrome and not on a device. The look of the wall at 1080p with real readings.

## Left alone, and why

* Direction. Each gauge counts one direction, as HCML set it, 21 inbound and 3 outbound. Since then the other direction shows when it is high or critical (section 34).
* A link that is down and one that is idle both read 0 bps. Since then the interface status decides, and a link that is down says Down (section 34).
* The three widgets that point at items that no longer exist, and two titles with a typo. Fixing them is a change in Zabbix.
* A CSV download of the Show data table, and a count of ports for each kind of device.
* SC-23. `dashboard.get` is now a thirteenth read method that a narrower Zabbix role has to allow.

## The rebuild

Done at your word ("rebuild kedua portal") on 14 October. The four images in use were tagged `rollback-14oct-2` first (`rollback-14oct` already holds the build from before the batches A to C), then hosted and ollama were built in turn as `ce3634d-dirty` (hosted built at 07:11 UTC, ollama at 07:12). `HEAD` has not moved since the first rebuild of the day, so the name is the same as the build before it, and the two are told apart by the time in the footer and by the bundle name:

```sh
cd /Users/muizfata/Intern/Proto1/myown
for n in hcml-portal-portal-web hcml-portal-portal-bff hcml-portal-ollama-portal-web hcml-portal-ollama-portal-bff; do docker tag "${n}:latest" "${n}:rollback-14oct-2"; done
cd hcml-portal && BUILD_COMMIT=ce3634d-dirty BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) docker compose up -d --build
cd ../hcml-portal-ollama && BUILD_COMMIT=ce3634d-dirty BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) docker compose up -d --build
```

Nothing failed this time. No dependency changed, so the `npm ci` layers came from the cache, `tsc` and `vite build` ran in about five seconds, and the ollama build reused the layers of the hosted one. If the web image's `npm ci` fails with `ECONNRESET`, as it did on the first rebuild of the day, run the same command again. The sources were fingerprinted before the build (hosted 421 files, ollama 422) and again after it, with no difference. No source file in either copy changed after the last full run of the suites, at 13:34 WIB, and `server/` and `web/` are identical in the two copies.

Checked without signing in, on both portals: all four containers `healthy` with no restart, and the Zabbix stack untouched (up five days, the same start times as before); the new bundle `index-B6Yb6YcJ.js` (it was `index-ClUUouEi.js`), whose files hold "Internet traffic", `api/net/meters` and `api/devices`; each BFF reports `INTERNET_METERS_DASHBOARD=Global view` and the build stamp; `Content-Security-Policy` sent, and 404 for `/.env`, `/.git/config` and `/assets/index.js.map`; `/bff/api/net/meters`, `/bff/api/devices` and `/bff/api/hosts/overview` refused with 401 (a 404 would mean the route is missing); `/bff/api/health` 200 with no `Cache-Control` and no `Strict-Transport-Security`; and one warning in each BFF's log, that the write token is not set.

Not checked, because it needs a sign-in on this build: the Internet traffic view and the Devices page as an operator or an admin sees them, the 403 a viewer gets from the meters route (tested, not tried on the live build), the footer line (`Build ce3634d-dirty, 14/10/2026, 14.11.47 WIB` on :8081 and `14.12.52 WIB` on :8082), a report download, the live stream and the Problems page. `myown/checks/signedin_check.py` runs three of them, with `PORTAL_USER` and `PORTAL_PASSWORD` set. No secret changed, so sessions stay valid, though an open tab needs a reload to get the new page. On the restored data the meters show old readings, about 30 days old.

To go back: `docker tag <name>:rollback-14oct-2 <name>:latest` for the four images, then `docker compose up -d --no-build` in each folder.
