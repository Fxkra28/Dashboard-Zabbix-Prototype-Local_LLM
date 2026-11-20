# The pages, as questions

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Everyone | about 15 min | [What the portal is](what-it-is.md) | [Who can do what](who-can-do-what.md) |

> **Ringkasan**
>
> - Portal punya 20 halaman. Tiap halaman menjawab satu pertanyaan, misalnya "Apakah ada yang bermasalah sekarang?" atau "Berapa ketersediaan bulan lalu?".
> - Menu dibagi empat: Monitoring, Reports, Assistant dan Administration. Halaman Login adalah satu-satunya yang bisa dibuka tanpa masuk.
> - Setiap orang hanya melihat halaman yang diberikan kepadanya. Guest baru mendapat empat belas halaman, operator ditambah Network dan Links & WAN health, dan admin mendapat semuanya, termasuk Inventory dan Users.
> - Dashboard bisa dipasang di layar dinding. Layar itu berganti tampilan sendiri, dan sebaiknya memakai akun guest yang diberi halaman Network, yang tidak bisa menandai masalah.
> - Angka bulanan (SLA) dihitung portal sendiri dari riwayat masalah, dan bisa diunduh sebagai PDF atau Excel.

The portal has 20 pages. This page lists them by the question each one answers, not in the order of the menu, because that is how people arrive: they have a question and want to know where it is answered. The table says where each page sits in the menu and who can open it. The sections after it say what you will see.

| Page | Menu section | Who can open it |
|---|---|---|
| Dashboard | Monitoring | Anyone who was given it. The internet traffic tab: accounts that have the Network page |
| Problems | Monitoring | Anyone who was given it. Acknowledging: operators and admins |
| Sites | Monitoring | Anyone who was given it |
| Hosts | Monitoring | Anyone who was given it |
| Devices | Monitoring | Anyone who was given it |
| Latest data | Monitoring | Anyone who was given it |
| Graphs | Monitoring | Anyone who was given it. Graphs of network ports: accounts that have the Network page |
| Maps | Monitoring | Anyone who was given it |
| Network | Monitoring | Anyone who was given it |
| Links & WAN health | Monitoring | Anyone who was given it |
| Services | Monitoring | Anyone who was given it |
| SLA | Monitoring | Anyone who was given it |
| Capacity trends | Reports | Anyone who was given it |
| Alert noise | Reports | Anyone who was given it |
| Top 100 triggers | Reports | Anyone who was given it |
| Inventory & ownership scorecard | Reports | Admins |
| Assistant | Assistant | Anyone who was given it |
| Users and access | Administration | Admins |
| Account | none (a link in the top bar) | Anyone signed in |
| Login | none | Anyone. It is the only page that needs no sign-in |

The menu hides the pages your account was not given. That is a convenience. The server refuses a page's data to an account that does not have it, whatever the menu shows. [Who can do what](who-can-do-what.md) has the roles and the pages.

The pictures in this page were taken on the afternoon of 12 November 2026 from a throwaway portal made from the live image, which reads HCML's own Zabbix, with every host name, address and check name replaced. The counts, severities, times and site names are real. Some devices read No data, which is how the portal shows a device that has collected nothing, and the pages have changed a little since the pictures were taken.

## Is anything wrong right now?

### Dashboard

The first page after signing in. It shows how many problems are open at each severity, and a list of the worst ones that changes by itself while you watch, with a small badge that says Live. When the page is not live, the badge says why, and [can I trust it](can-i-trust-it.md) lists the wordings.

A second tab, Hosts, counts the devices that are up, degraded, down or silent, the devices of each kind, the web checks that pass or fail, and the ten busiest devices by processor and by memory. People whose account has the Network page have a third tab with a gauge for each of HCML's internet links, taken from the Zabbix dashboard HCML already keeps. A link that is down says it is down. When a link is busy in the other direction, the gauge shows that too.

The same page is the wall screen. Open with the wall setting on, it drops the menu, enlarges the type, shows a clock and the time of the data, turns between its tabs by itself and scales to fit the window, because nobody can scroll a screen on a wall.

<!-- image: ../../screenshots/dashboard.png | The Dashboard: counts for the estate, the live list of open problems and the problems of each host group -->

<!-- image: ../../screenshots/dashboard-hosts.png | The Dashboard's Hosts tab: hosts up, degraded, down and without data, the devices of each kind, the web checks and the busiest hosts -->

### Problems

The full list of open problems, with a search for a problem or a host, a minimum severity and a choice of acknowledged or not. A long list opens with a hundred rows and a button that adds a hundred more. Each row has an Explain button that writes the problem in plain words, when the portal has a model to ask. Operators and admins also have an acknowledge button on each row; a row they have just acted on says that it was sent and that the portal is waiting for Zabbix, which can take several seconds to show the change.

<!-- image: ../../screenshots/problems.png | Problems: one row for each open problem, with its host, severity, duration and tags, and an Explain button -->

### Alert noise

Which alarms are not worth sending. A trigger can carry three flags. Flapping means it fires over and over and each firing is over within minutes (by default five firings in the period, each under five minutes at the median), which usually means its threshold is too tight. Unactioned means it fires that often and nobody ever acknowledges it, which means the team has learned to ignore it. Chronic means it has been open for more than a day. That last one is not noise: it is one condition nobody has cleared. The page also says how few triggers produced most of the alerts of the period.

### Top 100 triggers

Which alarms fired most in a period you choose, with the number of times each one fired. It counts firings only. Alert noise adds how long each lasted and whether anyone acted, which is what tells noise from a real fault.

## Where is it, what is it, and what is it saying?

### Sites

One card for each of HCML's sites. The card takes the colour of the site's worst problem, counts the devices that answer, those that do not and those with no data, and says where the portal found each device's site: in a tag, in the name, in the inventory record or in the group. The more devices carry an explicit site, the less the portal has to guess.

<!-- image: ../../screenshots/sites.png | Sites: one card for each site, with its problems by severity and how many devices are down -->

### Hosts

Every monitored device with its state: up, down, degraded, no data or disabled. Ping decides first. Degraded means the device answers ping while its other checks stay silent.

### Devices

A tile for each of eight kinds of device: switches, firewalls, access points, radio repeaters, servers, WAN links, web services and other. Each tile says how many there are, how many have a problem and how many do not answer, and opens the list of that kind. The kind comes from the device's template and its name, and the SLA report groups by the same kinds.

<!-- image: ../../screenshots/devices.png | Devices: a tile for each kind of device with its count, and the list of the kind chosen -->

### Latest data

Pick a device, or a group, and see every measurement it has with its newest value. It is the page for the question "what is this device reporting right now?" when the answer is not on a graph.

### Graphs

One device, up to four of its measurements, any period. Show data lists the points of the chart as a table, and a button downloads the same table as a file that opens in a spreadsheet. The page says when a graph is thinner or older than it looks, for example when a series only has values for half of the period.

<!-- image: ../../screenshots/graphs.png | Graphs: one measurement over a calendar month, with its lowest, average, highest and last values -->

<!-- image: ../../screenshots/graphs-show-data.png | Graphs with Show data open: the points of the chart as a table, with the Download CSV button above it -->

### Maps

The maps HCML drew in Zabbix, shown in the page with the problems marked on them. A map for an account without the Network page leaves out the network elements that it may not read.

## How are the links?

### Network

Devices grouped by site, with their network ports and the state of each port. It is the page for "which port is down on that switch?".

<!-- image: ../../screenshots/network.png | Network: devices grouped by site, here 82 up, 11 down and 43 with no data -->

### Links & WAN health

Each WAN link as a path, with its state, its packet loss and its response time, paired with its standby where there is one. By default a link counts as degraded from 2 percent loss and as down from 10 percent.

## How did we do this month?

### Services

A tree of services built from the estate itself, because HCML's Zabbix has none set up. Each node shows its availability for the month against the target, and how many devices below it missed the target. It answers HCML's own complaint that monitoring was about devices and not about services.

### SLA

The monthly figure. It shows Zabbix's own SLA objects when any exist, and the monthly availability that the portal works out itself, by two methods side by side. The strict method counts a device that does not answer as down and leaves out hours when nothing was collected. HCML's report method counts only high packet loss, so a device that is completely down still counts as up. [Can I trust it](can-i-trust-it.md) explains why both are shown. The page offers the month, or the range it is on, as a PDF, an Excel file or a zip of CSV files. The card "Sites below target (strict)" counts the strict method whichever method the tables use, as the report files do, and says how many sites have no data, so that "all sites at or above the target" is never said over sites nobody measured. The banner says when the figures were made, and a month that is still running is read again about every five minutes while the page is open. If the HCML method's figure cannot be read, its card says it is not available and why. The month is always in the address, so a link that is shared keeps the month it was copied on.

The period can also be the last 7 or 30 days. Those windows are for watching: they show how much of the window each device was reachable, by the same engine, up to the time the figures were made, and they have no report files, email or Explain. A window reads one method at a time, so the first time the other method is chosen it waits for its own reading. A month lists, for each device, its incidents and its longest outage as well as its downtime. The period can also be any range of days, a calendar year included, with, if wanted, only some hours of the day and some days of the week, such as 08:00 to 17:00 on weekdays. It is worked out from the months it touches, each read once, so a long range can take a while the first time it is asked for. A range has the same three files and the email as a month. Its file has one figure for the whole range, says on its first page which hours were counted, and has an empty Web checks table, because web checks are measured by calendar month. The monthly schedule stays monthly. The Response tab of the same page lists the problems nobody has acknowledged, by age, and the ones that have waited longest. It is about now, not about a month. The old address of the Availability and response page opens this page on the last 7 days, as that page did.

## What will run out?

### Capacity trends

Processor, memory, disk and network port use for each device over a number of days, read from the hourly averages Zabbix keeps, and roughly when a rising line would reach its limit. Each row has a Graph button; on the network ports an account without the Network page does not get it, because the portal does not show that account interface items on the Graphs page. The report is slow to build on HCML's Zabbix, so the portal keeps it for an hour and may show a copy up to a day old, and says so.

## How complete are our records?

### Inventory and ownership scorecard

For admins. It does not measure the network. It measures the records about it: how many devices have a name that follows HCML's convention, an explicit site, an owner and a criticality. The portal cannot make anyone follow a standard, but it can show the percentage rising as devices get tagged. While no device has an owner or a criticality at all, which is how HCML's Zabbix is today, the page says so, and the list of gaps opens on the naming and site gaps, the ones that can be closed now, unless there are none. The list can show every gap or one kind, and it downloads as a file named after what it holds.

## Can I just ask?

### Assistant

Free questions about the estate in plain words: what is down at a site, which problems are oldest, how the month is going. The portal builds a summary of the estate (it reuses one for up to five minutes while nothing it describes has changed) and gives it to a model with the question. When the question names a site or a device, or asks about last night, a device's CPU, its address, who is in charge, who acknowledged a problem, the SLA of another month, a port, the WAN links, a report or a map, the portal also reads that from Zabbix and adds it, for the pages the person holds. The model has no other source and no tools, and cannot change anything. The page says when the summary was cut short to fit, and its footer says to confirm on the relevant page before acting. [Data in and out](data-in-and-out.md) says what leaves the machine when you ask.

## Who can sign in, and what they see

### Users and access

For admins. The people who can sign in, each with a role and the pages they may open. An admin adds a person with a first password, changes their role and pages, sets a date after which they can no longer sign in, resets a password, or disables the account. A person is never deleted, only disabled, so the log keeps the name. [Who can do what](who-can-do-what.md) says how accounts are made.

### Account

Who is signed in, what that account may do, and the form for changing one's own password. A person whose password is a temporary one sees this form first, and nothing else opens until they have chosen a new password.

## Login

The sign-in page. After signing in, it returns to the page the session ended on, provided that page is on this site.

## Why these pages

HCML named six goals, and each page answers one of them.

| Goal | Where the portal answers it |
|---|---|
| Standard names, sites, owners and criticality | The inventory scorecard measures them, and the Sites page shows how many sites rest on an explicit tag |
| Monitoring by service, not by device | Services and SLA |
| Deeper telecom visibility | Links & WAN health and the internet traffic meters |
| Alerts that carry context | Explain, and Alert noise |
| Dashboards for different roles | The roles, the pages each person has, the three Dashboard tabs and the wall screen |
| Automatic reports | The SLA page (the month, the last 7 and 30 days and the Response tab), Capacity, Top triggers and the SLA files |

Some of these goals are met only in part, and the handbook page on risks, limits and costs, which is kept outside the repository, says which and why.
