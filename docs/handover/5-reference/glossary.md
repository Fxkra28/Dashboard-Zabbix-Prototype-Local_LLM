# Glossary

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 5 min | [What is still open](open-items.md) | [How the handbook is kept true](how-the-handbook-is-kept-true.md) |

The words this project uses in a particular way, in alphabetical order, with the page that explains each. The first group is Zabbix's own vocabulary, which the portal reads and does not change. The words from `docs/setup/28-glossary.md` and part 0's questions and terms are for readers who do not read code. This one is for the person who does.

## Zabbix's words

| Term | What it means here |
|---|---|
| Event | A trigger changing state. A problem event and its later recovery event bracket one outage |
| History | The raw values Zabbix collected. It is kept for a short time, so anything older than a few weeks comes from trends |
| Host | A monitored thing. Zabbix keeps hosts and templates in one table, so any count has to ask for monitored hosts only |
| Item | One measurement on one host, named by its key, such as `icmpping` |
| Maintenance | A planned window in which a host's problems are suppressed. The SLA leaves that time out of the measurement |
| Opdata | Operational data: the figures Zabbix shows beside a problem's name. Zabbix fills it one problem at a time, which is slow, so the problem list leaves it out |
| Problem | An event that is unresolved. Zabbix's `problem.get` lists these |
| Trend | The hourly minimum, average and maximum of an item, kept for a year. It is the only source for a long graph |
| Trigger | An expression over items that turns a measurement into a problem |

## The portal's words

| Term | What it means here, and where to read more |
|---|---|
| Acknowledge | The portal's one write: it annotates a problem, and can close it when the trigger allows. The server sends `event.acknowledge` with a separate token. [Server: routes](../2-code/server-routes.md) |
| Async | The web component that draws loading, error, empty or the content, from a hook's fields. [Web app: the shell and the shared code](../2-code/web-shell-and-shared.md) |
| Assistant | The page where a free question is answered by a model from a snapshot of the estate. It has no tools and cannot change anything. [Server: live and assistant](../2-code/server-live-and-assistant.md) |
| BFF | Backend for frontend: the Fastify server. It holds the tokens, caches, works out the derived figures, and is the only thing the browser talks to |
| Cache entry | A value held in memory under a key, with a lifetime, an optional stale window, and an optional pin. [Server: the core and the clients](../2-code/server-core-and-clients.md) |
| Card | In this handbook, the block for one code file, with its exports and who imports it. Written by the build, with a sentence by a person above it |
| Category | The monitoring template an availability trigger comes from. HCML's reports group their rows by it |
| Coverage | The share of a period in which an item really collected data. It tells "up" from "nobody was looking" |
| Data status | Whether a figure rests on full, partial or no measurement: `ok`, `partial` or `nodata` |
| Derived | Worked out by the portal from what Zabbix holds, because Zabbix has no table for it: sites, links, host states, the monthly SLA |
| Device class | One of eight kinds a host is put in from its template and its name: firewall, switch, access point, repeater, WAN link, web service, server, other |
| Error budget | The seconds of downtime a target still allows in a month. Negative means the target was missed |
| Explain | The button that puts one problem or one SLA figure into plain words. Cached, and on demand only |
| Fingerprint | A short string that stands for a state. The live stream's says whether a frame is worth sending, and a handbook snippet's says which code its explanation was written against |
| Freshness | When Zabbix last collected a value. The Dashboard says so when it was long ago, and when almost nothing answers ping |
| Gate | A limit on how many jobs run at once, such as the two heavy reports at a time and the one local model request |
| Guard (server) | The hook that checks every `/api` request: who is signed in, and whether their role is enough |
| Guard (web) | A hand-written check that an answer has the shape a page relies on. A mismatch is the page's ordinary error |
| Hold | A short life given to a cache key after a write, so the first refetch is not read as the old state |
| Host state | The portal's judgement of a host: up, down, degraded, no data or disabled. Ping decides first, and the interface flags only stand in when there is no recent ping |
| Incident | A problem paired with its recovery, clipped to a window |
| Interval | A span `[start, end)` in Unix seconds. The SLA is arithmetic on intervals |
| Link | A path that Zabbix pings, with its loss and its delay. Two legs of one path make a redundant pair |
| Meter | One gauge of the Dashboard's Internet traffic view, drawn from a gauge widget of HCML's Zabbix dashboard |
| Parity | The two copies of the portal holding the same files, apart from the short list that differs on purpose |
| Pin | Two things. A pinned cache entry is never evicted. A pinned certificate is trusted by its fingerprint until a set day |
| Profile | The method the SLA used: `hcml-report`, which reproduces HCML's own figures, or `availability`, the strict one |
| Rail | The sidebar drawn as a narrow strip. A narrow screen forces it |
| Reference | The request id shown in an error, to be quoted to whoever reads the log |
| Role | `viewer`, `wall`, `operator` or `admin`, in that order of rank. The server's rules decide which a route needs |
| Slice | A window of time, or a set of items, small enough for one Zabbix request. Events and trends are read in slices |
| Snapshot | The estate as compact plain text, which the Assistant answers from. It is capped in characters, and reused while nothing it describes changes |
| Stale copy | An answer that is an old copy kept because Zabbix failed, marked in a header. A refreshing copy is an old one shown while a newer one is read |
| Stream | The live problem list, sent as server-sent events by one shared ticker |
| Wall mode | The Dashboard drawn for a screen nobody can click: no menus, larger type, turning by itself between its views |
| Warm-up | The server reading the slow views once after a start, so the first visitor finds them ready |
| Write-back | The acknowledge and close path. Off unless there is a write token and sign-in is on |
