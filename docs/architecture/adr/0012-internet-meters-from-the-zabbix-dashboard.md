# Draw the internet traffic meters from the gauge widgets of the Zabbix dashboard HCML already keeps

* Status: accepted
* Deciders: HCML internship project, on a request from the mentor
* Date: 2026-10-14

## Context and Problem Statement

HCML watches its internet links on a Zabbix dashboard called "Global view": a grid of gauge widgets, one
for each link. Each gauge shows the traffic on one firewall interface against what that link can carry,
with four colour zones. The mentor asked for the same meters on the portal's start page, "as in the
picture".

A meter needs four facts that the interface itself does not hold: which interface is the internet link,
how much the link can carry (the contract, not the speed of the port), where each colour zone starts, and
what to call it. Where should the portal get them?

## Decision Drivers

* The capacity of a link is a figure somebody typed once, in Zabbix. A second copy drifts from the first,
  and then two screens give two answers about one link.
* The repository is public. A list of HCML's links with their capacities is HCML's estate, and it must
  not be committed ([SC-06](../../../tracker.md)).
* No database ([ADR-0003](0003-no-database.md)) and no write to Zabbix
  ([ADR-0006](0006-read-only-with-one-write.md)).
* Interface data is for a wall screen's account, an operator and an admin (`viewerPolicy.ts`), and the meters are interface data.
* The Zabbix on the development laptop stopped polling on 17 September
  ([ADR-0008](0008-stop-local-polling.md)), and the items behind the meters were last sampled at the backup of
  14 September. Whatever is built has to show an old reading as old and not as current.

## Considered Options

* A list in the settings: for each of about 27 links, a name, an interface item id and a capacity, kept in
  `.env`.
* The same list as a file in the repository.
* Read the dashboard: `dashboard.get`, and one meter for each gauge widget.
* Work the links out: the `INET :` hosts, plus the interface speeds.

## Decision Outcome

Chosen: **read the gauge widgets of the dashboard named by `INTERNET_METERS_DASHBOARD` (default
`Global view`).**

* `GET /api/net/meters` reads the dashboard with `dashboard.get` (kept two minutes), the widgets' items
  with one `item.get` (kept half a minute), and, for an item Zabbix gives no last value for, one row of
  history. It is an operator route, by the existing `/api/net` rule. Nothing is stored.
* One meter for each gauge widget, in the order a person reads the pages, and one for each item: a later
  page that repeats an item adds nothing. A widget that names no item, or an item that is gone, is a meter
  in the state `missing`, so the page says what is wrong and HCML can fix the widget in Zabbix.
* The scale is the widget's `min` and `max`, and its thresholds make the zones. Only what a colour means is
  kept (blue the low end, green normal, yellow high, red critical), and the page draws it in its own
  palette. The meaning is also written as a word under the dial.
* A reading counts as current for three update intervals and at least ten minutes. An older one is
  `stale`: the dial is dimmed and the line under it says when the value is from.
* On the Dashboard the meters are a second view beside the Overview, chosen by a tab and by the address
  (`?view=internet`), like the pages of a Zabbix dashboard. Each view fits a wall screen, and a wall can be
  sent to the meters by its address.

Measured on 14 October 2026 against HCML's restored Zabbix, with read calls only. The dashboard "Global
view" has two pages ("Page 1" and "HCML Network") and 34 gauge widgets on them, bound to 24 distinct
items, every one an interface counter on a firewall (`net.if.in` for 21 of the items and `net.if.out` for
3). The capacities run from 5 to 500 Mbps. Four widgets name no item (three once the repeats are merged),
which is the "No permissions to referred object" in the mentor's picture, and one item has no sample at
all. The newest sample of any of them is from 14 September 07:02 UTC, the moment of the backup. The
portal's route turns them into 27 meters, 21 of them old readings.

### Positive Consequences

* One place holds the capacities, and it is the one HCML already maintains. Change a widget in Zabbix and
  the portal follows within two minutes.
* Nothing about HCML's links is in the repository, in `.env` or in the images.
* No new dependency, no stored state and no write to Zabbix. The only new Zabbix call is a read.
* A widget with a fault shows as one, with the reason, where Zabbix shows an unexplained error.

### Negative Consequences

* **The portal now depends on the shape of a Zabbix widget.** The field names (`itemid.0`, `min`, `max`,
  `thresholds.N.color`, `thresholds.N.threshold`) are Zabbix 7.0's. A later Zabbix may rename them, and
  the meters then read as missing or without a scale until the reader is changed. `meters.test.ts` pins the
  shape the reader expects.
* **A fourteenth read method.** `dashboard.get` joins the thirteen the portal already called (this record said
  twelve and thirteenth until 20 October 2026, when the calls were counted again from the code). A narrower Zabbix role
  for the read token (tracker SC-23) has to allow it.
* **The capacity is as right as the widget.** Nothing here can tell that a widget says 50 Mbps for a link
  that is 100. Of the 27 meters, one is over its capacity on the stored data (113 percent), which is
  either a busy link or a wrong figure.
* **Two screens show one link.** The Zabbix dashboard stays, and so do the portal's meters. They agree
  because they read the same items, not because one is the other.
* **A gauge counts one direction.** As HCML set it: 21 inbound and 3 outbound, the three being on LAN-side
  interfaces, where "Out" is the site's download. The other direction and the interface's own status are
  read too, and shown when they matter (follow-ups, below).
* **Wall accounts, operators and admins only** (operators and admins alone until the wall role of 29 October). The meters are interface data. A wall that signs in as a viewer shows the
  Overview and, since 15 October, the Hosts, which are host data (follow-ups, below).
* **Only the last value.** Nothing is kept, so the portal can say how busy a link is now and not how busy
  it was last week. The Graphs page draws the history.
* **Not seen live here.** The items behind the meters stop at the backup of 14 September, so every meter on the
  development copy of Zabbix is an old reading. The live look comes when the portal is pointed at HCML's own Zabbix.

## Follow-ups, 14 October 2026, later

The first build was out and its limits could be measured, on HCML's restored Zabbix with read calls only:
the hourly trends of the 24 interfaces behind the meters, 2 August to 14 September. Three decisions came
out of that, and one of them (the first) was the reason for the other two. They are built and tested, and
have been in the running portals since 22 October 2026.

**A link that is down says so.** 8 of the 24 interfaces had at least one sample that was not up. Two were
down for long: one for the whole of the data and one for the last 18 days of it. About one in six of the
hours in which a gauge read under 1 percent of its capacity was an hour in which the interface was down,
and the meter called all of them Low. So each meter now reads the status item of the same interface (same
host, same ifIndex, `net.if.status`), and an interface that is `down` (2) or `lowerLayerDown` (7), as the
Network page counts them, is a state of its own: the value becomes the word Down, the needle goes, and the
summary counts it first. 1 is up. Anything else, and no current value, is `unknown` and the page claims
nothing. The status is read from the item only, never from history: an old status says nothing about the
link today.

* Considered: the "Interface down" trigger. It needs the problem list and its tags, and a trigger can be
  switched off for a port nobody watches, which is exactly when the meter would still be called Low.
  Considered: ICMP. It is per host and not per interface.

**The other direction, when it matters.** Only 5 of the 24 links ever had the other direction High or
Critical (by hourly average) in hours when the gauge's own direction was not, and one of them for 563 of
939 hours with its gauge never above Normal. So the other direction is not a second line on every tile:
23 tiles would be crowded for the sake of one or two links. It is read for every meter, on the gauge's own
scale and zones, and written under the dial only when it is High or Critical, counted in the summary, and
a click on the title opens the Graphs page with both directions chosen. The tile's edge turns red or
amber too, as the line is too small to read from across a room. An old reading of it is never drawn.

* **It assumes a link that is the same size both ways**, because the widget gives one maximum. *Confirmed on 22 October 2026: the owner says HCML's links are the same size in both directions. The stored hourly averages agree for every link but one, whose outbound side averaged 126 percent of the widget's capacity in three hours; for that link it is the capacity figure, or what the widget measures, that is wrong, not the assumption.* A link that
  is not (a broadband one, where the upload is a fraction of the download) would read too low in the
  direction the widget does not describe. The capacity is written beside the figure, so the assumption is
  in view.
* Considered: the worse of the two directions as the gauge. That changes HCML's meter, which is the
  thing this decision exists to keep.

**A wall that turns, and fits.** A wall has no one to click it or scroll it. So the Dashboard turns by
itself on a wall for a wall account, an operator or an admin: the Overview, then the meters, 30 seconds each (`rotate=` in
the address changes the seconds, 0 stops it). An address that names a view (`view=`) holds it. A click on a
tab, or on Pause, stops the turning until Resume. A viewer's wall has the Overview and, since 15 October, the Hosts. And the whole wall,
its bar included, is drawn at the scale that fits the screen, all by one factor, because the height of a
tile depends on what it says (a line for the other direction, an old reading's two lines) and the
Overview's own height depends on how the problem names wrap. The scale follows the height of the window in
proportion to 1080p, which the wall is designed for: down to 0.8 of that proportion on a shorter screen
(0.53 at 720 px), and up to the proportion on a taller one (1.33 at 1440 px, 2 at 2160 px, never past 3), so
a wall on a 4K screen is not a small drawing in a large room. Past 35 meters they go on further slides, an
even share each. On the restored data the Overview alone was 1,185 px tall at 1080p, and 27 meters of mixed readings,
drawn from made-up numbers, 1,175 px.

* The Overview has a card for the internet links (how many need someone to look, and which way), so the
  meters, which have a view of their own, do not hide what they show from the first one.
* The meters are asked for once for both views, a minute apart, so the card, the tab and a wall that turns
  to them share one request.
* Considered: stopping the turning while a High problem is open. The restored data has 18 open, so the
  wall would never turn. Considered: ordering the tiles by severity. The positions are what an operator
  learns, and the card and the summary already say what needs a look.

**The Hosts view (15 October).** HCML's Zabbix home carries more than the gauges: host availability, two Top
hosts widgets, web monitoring, system information, problems by severity, a map and a clock, and two more
dashboards of their own for availability and for web checks. The portal showed the gauges, the problems and
the counts, and the Dashboard gets a third view, Hosts, for what it did not show: availability, the devices of
each kind, web monitoring and the ten busiest hosts by CPU and by memory.

* **For everyone.** It is host data, not interface data, so a viewer has it. A viewer's Dashboard has two tabs,
  and a viewer's wall turns between the two. The meters stay for wall accounts, operators and admins.
* **Current figures only.** The portal's rule applies (`isFresh`): a value older than three intervals, and
  ten minutes at least, is not listed, and an old web result is never OK. On a copy of Zabbix that has
  stopped, the lists are empty and the scenarios Unknown, and the page says so.
* **Three requests, held by the Dashboard.** The devices, the busiest hosts and the web scenarios are asked
  for once for the view and the wall, a minute apart, and one that fails does not take the others with it.
* Considered: the map and the clock of the Zabbix home. The Maps page has the topology and the wall has a
  clock. Considered: system information and problems by severity. The Overview has them.

