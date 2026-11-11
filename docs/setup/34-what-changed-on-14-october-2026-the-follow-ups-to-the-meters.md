# 34. What changed on 14 October 2026, the follow-ups to the meters

[setup.md](../../setup.md) · previous: [§33](33-what-changed-on-14-october-2026-the-mentors-requests.md) · next: [§35](35-what-changed-on-15-october-2026-the-audit-and-the-hosts-view.md)

*Three things you decided after the mentor round, and what I measured before building them: a link that is down says so, the other direction shows when it is high, and a wall that turns by itself and fits its screen (MT-04 to MT-07 in [`tracker.md`](../../tracker.md)). They are built and tested in both copies. They are not in the running portals, which have the build of section 33, until you ask for a rebuild.*

## What the stored data said

The Zabbix on the development laptop holds the hourly trends of every item. I read those for the 24 interfaces behind the meters, from 2 August to 14 September, with read calls only, so that the decisions rest on figures. I used hourly averages and not peaks: an hourly peak is often above the widget's capacity, in places by tens of times, which says something about the capacities (see the figure that reads 113 percent) and nothing reliable about load.

* **Down.** 8 of the 24 interfaces had at least one sample that was not up. Two were down for long: one for all of the stored data, one for the last 18 days of it. In about one hour in six in which a gauge read under 1 percent of its capacity (1,377 of 8,642), the interface was down, and the meter called every one of them Low.
* **The other direction.** For 19 links (one of them has no samples at all) it never reached a high or critical zone. For 5 it did in hours when the gauge's own direction was not high, and for one of them that was 563 of its 939 hours, with its gauge never above Normal. The other four: 32 hours, 5, 4 and 1.
* **Where the status is.** All 24 interfaces have a status item, `net.if.status[ifOperStatus.N]`, on the same host and with the same number as the counters. The keys are the same on all 14 hosts.
* **Open problems.** 18 are open at High on the restored data, which is why the wall does not stop turning while one is open.

The names of the links are not here or anywhere in the repository.

## A link that is down (MT-04)

Each meter has a `link`: `up`, `down` or `unknown`. `meters.ts` `linkOf` reads the interface's own status, IF-MIB ifOperStatus: 1 is up, 2 (down) and 7 (lowerLayerDown) are down, as the Network page counts them, and anything else (testing, dormant, not present) or no current value is `unknown`, which claims nothing. The status item is found beside the widget's item: same host, same ifIndex (the number at the end of the key's first argument). `pairSiblings` does that from one `item.get` by key prefix (`net.if.in[`, `net.if.out[`, `net.if.status[`) for the widgets' hosts, kept two minutes with the dashboard. Its value is asked for with the gauges' own, and it is never read from history: a status from days ago says nothing about the link today. Where there are two candidates the operational status wins over an administrative one, then a counter of the same width, then the lowest id.

On the page a link that is down writes the word Down in place of the value, in the red text colour, keeps the dial with its zones dimmed and no needle, says "Interface down, not an idle link." under it, drops `role="meter"` (there is no value to give), and counts first in the sentence over the grid ("27 links. 2 down. 5 critical, 2 high."). The reading it had stays in the answer.

## The other direction (MT-05)

Each meter also has `other`: the item of the opposite direction on the same interface, with its value on the gauge's own scale and zones, found as the status is. Only a current value counts and none is read from history. The page writes it under the dial when it is High or Critical, as "Out 41 Mbps · 82% of 50 Mbps · Critical", and `summary.otherHigh` counts it ("3 with the other direction high or critical"). It is not shown otherwise: a line on every tile would crowd 23 of them for one or two links. The tile also gets an edge, red for a Critical other direction and amber for a High one (option B of five compared on 15 October), because the line of text is too small to read from across a room. The same red edge marks a Critical gauge and a link that is down, so every tile that needs a look shows from the same distance. It adds no height.

**It assumes a link that is the same size both ways**, because the widget gives one maximum. The capacity is written in the same line, so the assumption is in view. A broadband link, whose upload is a fraction of its download, would read too low in the direction the widget does not describe.

## The wall (MT-06)

For an operator or an admin `/?wall=1` shows the Overview and then the meters, 30 seconds each (since 15 October, with the Hosts between them: section 35). `rotate=` in the address sets the seconds (10 to 600), `rotate=0` stops the turning, and `view=overview` or `view=internet` holds that view, as before (`view=hosts` too, since 15 October). A Pause button in the wall's bar stops it where it is, and a click on a tab stops it on that view and writes it in the address; Resume starts it again from the Overview. Entering the wall again starts it turning. A viewer's wall had the Overview alone, and since 15 October it turns between the Overview and the Hosts, and asks for nothing more. **A wall that is to turn has to be signed in as an operator or an admin** (docs/ux/README.md says what that costs).

The whole wall, its bar included, is drawn at the scale that fits the screen (`lib/fit.ts`, `hooks/useFitHeight.ts`): it is laid out `1 / scale` times as wide and scaled, by one factor, so that a smaller drawing also holds more tiles to a row. A search by halves finds the largest scale that fits, to about a hundredth. The scale is bounded by the height of the window in proportion to 1080p, which the wall is designed for: on a shorter screen from 0.8 of that proportion up to 1 (so 0.53 to 1 at 720 px), and on a taller one from 0.8 up to the proportion (1.33 at 1440 px, 2 at 2160 px, never past 3). A wall on a 4K screen at 100 percent is therefore not a small drawing in a large room, and a laptop shows the whole of it. Measured in headless Chrome with the 27 meters of mixed readings and the Overview on HCML's real problem names, the lowest edge of the slide was:

| Screen | Overview | 27 meters |
|---|---|---|
| 1280 by 720 | 685 px | 576 px |
| 1366 by 768 | 729 px | 616 px |
| 1600 by 900 | 863 px | 732 px |
| 1920 by 1080 | 1,048 px | 885 px |
| 2560 by 1440 | 1,403 px | 1,180 px |
| 3840 by 2160 | 2,123 px | 1,782 px |

Nothing runs past the window at any of them. Past 35 meters they go on more slides, an even share each, with "Page 1 of 2" in the heading. The text is small on a laptop (about 8 px at 720 px high, the same proportion as on a 1080p wall), which is read from a distance. The Overview alone was 1,185 px tall at 1080p on the restored data, and about 1,130 px without the tab strip, which is 57 px, so the wall's promise that it fits 1080p did not hold for HCML's own names until now.

## The card and the click-through (MT-07)

The Overview has a fifth card in the problem row for operators and admins: how many links need a look (down, critical or high, or the other direction high, each link once) and which way. It is red when a link is down or critical and orange when the worst is high, and with no current reading it says "none with a current reading" and does not claim all is well. The meters are asked for once for both views, a minute apart (`hooks/useMeters.ts`), so the card, the tab and a wall that turns to them share one request. That is a change: the Overview used to ask for nothing until the second tab was chosen.

The title of a meter is a link to the Graphs page with its item first and the other direction beside it, and an old reading opens the month it is from, as the last day would show nothing. A screen reader hears where it goes (`aria-describedby`), and the name of the meter stays its title.

Two small changes were made on the way. The title of a meter wraps to a second line before it is cut, as "SITE TWO INTER…" could not tell the first link from the second. And the sentence over the grid says "None high or critical" with a capital.

## Screen sizes

The pages other than the wall are ordinary scrolling pages, and they follow the window. `layout-sweep.mjs` measured 15 routes (the Dashboard and its meters, Problems, Sites, Hosts, Devices, Latest data, Graphs, Maps, Network, Links, Services, SLA and three reports) at 1024 by 768, 1280 by 720, 1366 by 768, 1536 by 864, 1920 by 1080, 2560 by 1440 and 3840 by 2160: none runs past the window sideways at any size. A 4K screen at 100 percent shows everything small, as it does for any web page; the browser's zoom, or the system's scaling, is what makes it larger.

## Checked

Server 1,622 tests in 73 files, web 1,037 in 70, both typechecks, the lint, the build, the nine checkers and the BK-11 restore patch, in both copies. 23 deliberate breakages (the status values, the pairing by host and by index, the freshness of a neighbour, the summary counts, the turning, Pause, the pin by address, the viewer's request, the fit's arithmetic and others) were each tried against the tests and each was caught. In headless Chrome under the enforced policy the Dashboard, the meters and the wall, in the light and dark themes, at 390 px and at 1920 by 1080, have no console error, no failed request, no violation, no failing contrast, no unnamed control and no small target, and the keyboard walk finds no stop without a focus ring, the title links included. The fresh readings were drawn from scratch servers of made-up numbers outside the repository: 27 of mixed readings, 27 quiet, 27, 35 and 36 of the tallest tiles, and 40 and 60 quiet.

Not checked: the new states against HCML's own, polling Zabbix, which is the only place a link will read as down; a real wall screen or TV; a phone as a device.

## Left alone, and why

* The tiles are not ordered by severity. The positions are what an operator learns, and the card and the sentence say what needs a look.
* The wall does not stop turning while a High problem is open: 18 are open on the restored data, so it would never turn.
* The scale of the wall can step by a hundredth when the lists change length. It is not smoothed.
* A CSV download of the Show data table, and a count of ports for each kind of device, as before.

## To make it live

Only when you ask for it by name, for example "rebuild both portals". The recipe of section 33 applies, with one change: tag the images from before as `rollback-14oct-3`, because `rollback-14oct-2` already holds the build from before the mentor round.
