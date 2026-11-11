# Conceptual model: HCML Monitoring Portal

The top of three levels. This one answers *what does the business talk about*: 27 entities and 34
associations, with no keys, no foreign keys and no types, because a conceptual model has none of those.
The level below it, [`../vanilla/ERD-Domains.md`](../vanilla/ERD-Domains.md), answers *what does the portal
read and derive*; the one below that, [`../database/ERD-Database.md`](../database/ERD-Database.md), answers
*what does MySQL store*. The index of all three is in [`../../../erd.md`](../erd.md).

The single diagram is [`ERD-Conceptual.mmd`](ERD-Conceptual.mmd), pre-rendered as [`ERD-Conceptual.pdf`](ERD-Conceptual.pdf) (vector, the one to read) and [`ERD-Conceptual.png`](ERD-Conceptual.png).

**Where it comes from.** Not from a schema: a conceptual entity is a judgement, not a generated artefact.
Each one here was read out of the code and the two lower models together, and every cardinality is either
checked against a foreign key in the physical model or, where there is no table at all, cited to the
function that computes it. Each association's evidence is in the last column of the table below; the ones that have
no counterpart in the schema are marked *conceptual only*, and counted under that table.

**Why it merges things the other models separate.** Nobody at HCML says "a host interface", they say "the
switch's management address". So `HOST`, `HOST_INTERFACE`, `HOST_INVENTORY` and `HOST_TAG`, four entities in
the logical model over six tables in the physical one, are one Device here. Six logical shapes that all
answer "what did this achieve over this period": `SliHost`, `SliGroup`, `SliPath`, `HostAvailability`,
`SlaSli`, `ServiceSla` are one Availability Result. That merging is the whole value of this level; if
an entity here maps one-to-one onto a logical one, it is earning nothing.

Reading it: a rectangle is an entity and the properties the business would name · a diamond is a
named association, read in the verb's direction · (min,max) on a leg is how many times one occurrence of
that entity takes part, so `(1,1)` beside Device on *stations* means every device is at exactly one site ·
blue is observed, Zabbix holds it · green is derived, the portal computes it and nothing stores it ·
amber is local to the portal · grey diamonds are the associations themselves.

The approximation. Mermaid has no MCD diagram type, so this is a flowchart wearing
Merise clothes. The diamonds are decorative: nothing validates that one has exactly two legs or that
cardinalities come in pairs. Identifying relationships, generalisation and n-ary associations cannot be
drawn at all. Map links (R30) are the visible casualty: Merise cannot associate an association, so a link
between two map elements is drawn device-to-device with the map scope stated in words instead.

> This document is shared by both portals, byte for byte, as is the diagram it describes. They run one
> source tree; the running portals differ only in `.env`, the compose file and the published port.

To regenerate the renders after editing the `.mmd`:

```bash
npx @mermaid-js/mermaid-cli -i ERD-Conceptual.mmd -o ERD-Conceptual.pdf -w 2600 -b white --pdfFit
npx @mermaid-js/mermaid-cli -i ERD-Conceptual.mmd -o ERD-Conceptual.png -w 2600 -s 2 -b white
```

Then run `node tools/check/diagrams.stamp.mjs` from the repo root. It records which source each render was made from, and CI fails on a source edited after its stamp (`tools/check/diagrams.check.mjs`).

`LR`, not `TB`. A Merise graph puts an extra node on every edge, so its longest path is about double the
logical model's: `TB` came out 3712 × 16590, a 1:4.5 tower. `LR` is 5168 × 1286. Even so the single canvas
is a reference sheet, not a reading diagram. Read the six domain views below instead.

---

## Domain map

Six domains, not the logical model's nine: once several logical entities merge into one conceptual entity,
Governance, Maps and Admin are each too thin to earn a frame of their own.

```mermaid
---
config:
  layout: elk
---
flowchart LR
    EST["Estate<br>4 entities"]
    MEAS["Measurement<br>5"]
    ALERTING["Alerting<br>4"]
    SITES["Sites &amp; paths<br>3"]
    LEVELS["Service levels<br>5"]
    GOV["Governance, maps &amp; assistant<br>6"]

    EST --- MEAS
    EST --- ALERTING
    EST --- SITES
    EST --- GOV
    ALERTING --- LEVELS
    SITES --- LEVELS
    LEVELS --- GOV
```

Every domain touches Estate, because Device is the hub: nine of the 34 associations have a Device leg.
That is also why the single canvas is a hairball and these six views are not.

| Conceptual domain | Logical domains it covers ([`../vanilla/ERD-Domains.md`](../vanilla/ERD-Domains.md)) |
|---|---|
| Estate | Hosts & Inventory |
| Measurement | Metrics & Items |
| Alerting | Events & Incidents |
| Sites & paths | Sites & Links |
| Service levels | Services & SLA |
| Governance, maps & assistant | Governance scorecard, Maps, AI layer, Admin & system |

---

## Estate

```mermaid
---
config:
  layout: elk
---
flowchart TB
    DEVICE["<b>DEVICE</b><br>visible name<br>technical name<br>monitored<br>in maintenance<br>network addresses<br>address kinds<br>site city<br>location<br>owner name<br>owner e-mail<br>labels<br>reporting category"]
    DEVICE_GROUP["<b>DEVICE GROUP</b><br>group name"]
    DEVICE_CLASS["<b>DEVICE CLASS</b><br>class name<br>display label"]
    HOST_STATE["<b>HOST STATE</b><br>state<br>reason<br>ping verdict<br>packet loss<br>latency<br>value freshness<br>ICMP present<br>ICMP unsupported"]
    SITE["<b>SITE</b>"]

    R_BELONGS{"belongs to"}
    R_CLASSES{"classes"}
    R_REACHES{"reaches"}
    R_STATIONS{"stations"}

    DEVICE       ---|"(1,n)"| R_BELONGS
    R_BELONGS    ---|"(0,n)"| DEVICE_GROUP
    DEVICE_CLASS ---|"(0,n)"| R_CLASSES
    R_CLASSES    ---|"(1,1)"| DEVICE
    DEVICE       ---|"(1,1)"| R_REACHES
    R_REACHES    ---|"(1,1)"| HOST_STATE
    SITE         ---|"(1,n)"| R_STATIONS
    R_STATIONS   ---|"(1,1)"| DEVICE

    classDef zbx     fill:#dbeafe,stroke:#2563eb,color:#14213d
    classDef derived fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef assoc   fill:#f1f5f9,stroke:#94a3b8,color:#475569
    classDef stub    fill:#f8fafc,stroke:#cbd5e1,color:#64748b

    class DEVICE,DEVICE_GROUP zbx
    class DEVICE_CLASS,HOST_STATE derived
    class SITE stub
    class R_BELONGS,R_CLASSES,R_REACHES,R_STATIONS assoc
```

Host State is an entity, not a property of Device. The portal answers "is it down?" ping first, because
on 17 September 2026 sixteen of HCML's twenty-three devices marked *unavailable* by Zabbix answered ping,
and forty-three devices had no interface at all. The verdict is five states and eight reasons with a
documented precedence (`server/src/domain/reachability.ts:18,21-29,222-278`), which is more than an attribute can
carry. No existing ERD covers it.

***stations* carries the site signal, and that is why it is an association and not a foreign key.** A
device's site is resolved from four signals in order: its `site` tag, then its own name parsed against
HCML's `<site>.<class>.<seq>` convention, then inventory `site_city`/`location`, then its host group
(`server/src/services/sites.ts:23,83-104`). Which signal answered belongs to neither Device nor Site; it is a
property of *this device being placed at this site*, and it is the only reason the coverage counters can
exist. It also decides governance: the scorecard counts a site resolved from the group as a failure to
declare one, so R2's signal is what makes R28 true or false.

---

## Measurement

```mermaid
---
config:
  layout: elk
---
flowchart TB
    DEVICE["<b>DEVICE</b>"]
    MEASUREMENT["<b>MEASUREMENT</b><br>what is measured<br>collection interval<br>unit<br>newest value<br>when last collected<br>collecting or unsupported<br>labels"]
    OBSERVATION["<b>OBSERVATION</b><br>moment<br>value<br>minimum<br>mean<br>maximum<br>sample count"]
    INTERFACE_READING["<b>INTERFACE READING</b><br>port index<br>port name<br>alias<br>operational status<br>speed<br>bits in<br>bits out<br>utilisation<br>errors<br>discards<br>last collected"]
    CAPACITY_READING["<b>CAPACITY READING</b><br>metric<br>average<br>maximum<br>unit"]
    INTERNET_METER["<b>INTERNET METER</b><br>title<br>direction<br>capacity<br>colour zones<br>current reading<br>when read<br>share of capacity<br>zone<br>link up or down<br>reading state"]

    R_CARRIES{"carries"}
    R_RECORDS{"records"}
    R_EXPOSES{"exposes"}
    R_SUMS{"sums up"}
    R_EVIDENCE{"derives from"}
    R_READS{"reads"}

    DEVICE           ---|"(0,n)"| R_CARRIES
    R_CARRIES        ---|"(1,1)"| MEASUREMENT
    MEASUREMENT      ---|"(0,n)"| R_RECORDS
    R_RECORDS        ---|"(1,1)"| OBSERVATION
    DEVICE           ---|"(0,n)"| R_EXPOSES
    R_EXPOSES        ---|"(1,1)"| INTERFACE_READING
    MEASUREMENT      ---|"(0,1)"| R_SUMS
    R_SUMS           ---|"(1,1)"| CAPACITY_READING
    CAPACITY_READING ---|"(1,1)"| R_EVIDENCE
    R_EVIDENCE       ---|"(0,n)"| OBSERVATION
    INTERNET_METER   ---|"(0,n)"| R_READS
    R_READS          ---|"(0,n)"| MEASUREMENT

    classDef zbx     fill:#dbeafe,stroke:#2563eb,color:#14213d
    classDef derived fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef assoc   fill:#f1f5f9,stroke:#94a3b8,color:#475569
    classDef stub    fill:#f8fafc,stroke:#cbd5e1,color:#64748b

    class MEASUREMENT,OBSERVATION zbx
    class CAPACITY_READING,INTERFACE_READING,INTERNET_METER derived
    class DEVICE stub
    class R_CARRIES,R_EVIDENCE,R_EXPOSES,R_RECORDS assoc
    class R_READS,R_SUMS assoc
```

Observation is one entity at two granularities. The physical model has seven tables: five `history_*`
plus `trends` and `trends_uint`, chosen by value type and age. Conceptually they are one thing: a recorded
sample. The hourly form simply carries minimum, mean, maximum and a sample count where the raw form carries
a value.

**This is the one place the physical model deliberately has no foreign key.** `history.itemid` references
nothing; a key there would cost an index check on every inserted value, and deleting one measurement would
try to cascade millions of row deletes in a single transaction. The relationship is real, the constraint is
absent on purpose. See the *cascade* legend in
[`../database/ERD-Database.md`](../database/ERD-Database.md).

***derives from* carries the evidence source**: trends, raw history on an instance too young to have
trends, or none at all. The same capacity figure means different things depending on which answered, so the
source belongs to the association (`server/src/services/capacity.ts:164-180`).

**Interface Reading is absent from every existing ERD** (`server/src/services/net.ts:7-14,39-54`).

**Internet Meter was added on 20 October 2026**, for what the Dashboard's Internet traffic view draws
(`server/src/services/meters.ts`). It is what HCML's own Zabbix dashboard already shows as a gauge, plus the
portal's reading of it: the capacity and colour zones are the widget's, the value, the zone, the share of the
capacity and the state are the portal's. A meter *reads* up to three Measurements of one interface: the item
the gauge points at, the item of the same interface the other way (so that a link which is busy only on its
upload can say so), and the interface's status item (so that a link which is down is not shown as idle). The
role each plays is the property of the association, and it is many-to-many because one item can be the main
reading of one meter and the other direction of another. Only the first has a key in Zabbix's schema
(`widget_field.value_itemid`), and the dashboard tables are not among the 45 drawn in the physical model, so the
association is *conceptual only* here, as the other two roles are found by item key and have no key at all.

---

## Alerting

```mermaid
---
config:
  layout: elk
---
flowchart TB
    ALERT_RULE["<b>ALERT RULE</b><br>description<br>severity<br>currently firing<br>last change<br>closable by hand"]
    ALERT["<b>ALERT</b><br>moment raised<br>moment cleared<br>severity<br>name<br>acknowledged<br>operational data<br>labels"]
    INCIDENT["<b>INCIDENT</b><br>start<br>end<br>resolved<br>acknowledged"]
    NOISY_RULE["<b>NOISY ALERT RULE</b><br>firing count<br>median duration<br>short-lived firings<br>acknowledgement rate<br>total duration<br>longest<br>still open<br>noise flags"]
    DEVICE["<b>DEVICE</b>"]
    AVAILABILITY_PERIOD["<b>AVAILABILITY PERIOD</b>"]

    R_WATCHES{"watches"}
    R_RAISES{"raises"}
    R_HITS{"hits"}
    R_CLIPS{"clips into"}
    R_WITHIN{"falls within"}
    R_COUNTS{"counts in"}
    R_RANKS{"ranks as"}

    ALERT_RULE ---|"(1,n)"| R_WATCHES
    R_WATCHES  ---|"(0,n)"| DEVICE
    ALERT_RULE ---|"(0,n)"| R_RAISES
    R_RAISES   ---|"(1,1)"| ALERT
    ALERT      ---|"(1,1)"| R_HITS
    R_HITS     ---|"(0,n)"| DEVICE
    ALERT      ---|"(1,1)"| R_CLIPS
    R_CLIPS    ---|"(0,n)"| INCIDENT
    INCIDENT   ---|"(1,1)"| R_WITHIN
    R_WITHIN   ---|"(0,n)"| AVAILABILITY_PERIOD
    INCIDENT   ---|"(0,1)"| R_COUNTS
    R_COUNTS   ---|"(1,n)"| NOISY_RULE
    ALERT_RULE ---|"(1,1)"| R_RANKS
    R_RANKS    ---|"(0,1)"| NOISY_RULE

    classDef zbx     fill:#dbeafe,stroke:#2563eb,color:#14213d
    classDef derived fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef assoc   fill:#f1f5f9,stroke:#94a3b8,color:#475569
    classDef stub    fill:#f8fafc,stroke:#cbd5e1,color:#64748b

    class ALERT,ALERT_RULE zbx
    class INCIDENT,NOISY_RULE derived
    class AVAILABILITY_PERIOD,DEVICE stub
    class R_CLIPS,R_COUNTS,R_HITS,R_RAISES assoc
    class R_RANKS,R_WATCHES,R_WITHIN assoc
```

*watches* is many-to-many, and it is the model's most-mislaid truth. An alert rule has no device column
anywhere: the path runs rule → function → measurement → device, so one expression can watch several devices
at once. The portal collapses that to the first device in five places. The M:N is drawn because it is true;
the collapse is a portal decision, and a lossy one.

**Incident is a reified association, not a thing.** It is one alert seen inside one reporting window, with
its ends clipped to that window, which is exactly *Alert × Availability Period*. It is drawn as an entity
because it carries its own clipped start and end, and because everything downstream (availability, noise)
counts incidents rather than alerts.

---

## Sites & paths

```mermaid
---
config:
  layout: elk
---
flowchart TB
    SITE["<b>SITE</b><br>site name<br>site code<br>naming aliases<br>worst severity now<br>device counts by state<br>declaration coverage"]
    LINK["<b>LINK</b><br>label<br>ping target<br>up<br>packet loss<br>latency<br>jitter<br>state<br>group<br>role"]
    WAN_PATH["<b>WAN PATH</b><br>path name<br>provider<br>path state"]
    DEVICE["<b>DEVICE</b>"]

    R_STATIONS{"stations"}
    R_TERMINATES{"terminates"}
    R_LEG{"is a leg of"}
    R_SERVES{"serves"}

    SITE         ---|"(1,n)"| R_STATIONS
    R_STATIONS   ---|"(1,1)"| DEVICE
    DEVICE       ---|"(0,n)"| R_TERMINATES
    R_TERMINATES ---|"(1,1)"| LINK
    LINK         ---|"(0,1)"| R_LEG
    R_LEG        ---|"(1,n)"| WAN_PATH
    WAN_PATH     ---|"(0,1)"| R_SERVES
    R_SERVES     ---|"(0,n)"| SITE

    classDef derived fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef assoc   fill:#f1f5f9,stroke:#94a3b8,color:#475569
    classDef stub    fill:#f8fafc,stroke:#cbd5e1,color:#64748b

    class LINK,SITE,WAN_PATH derived
    class DEVICE stub
    class R_LEG,R_SERVES,R_STATIONS,R_TERMINATES assoc
```

Every entity in this domain is green. Zabbix has no site object in any form, no link and no path; this
whole domain is the portal's arithmetic and grouping, and it is the point of the project.

***stations* is a total function** (the resolver always returns, falling back to *Unassigned*) so sites
partition the estate and the device counts always add up.

***is a leg of* starts at (0,1), and that matters.** A link with no group label belongs to no path, which is
why the links list and the paths' legs overlap rather than partition. A path is down only when every leg
is down.

---

## Service levels

```mermaid
---
config:
  layout: elk
---
flowchart TB
    BUSINESS_SERVICE["<b>BUSINESS SERVICE</b><br>name<br>status rule<br>current status<br>description<br>labels"]
    SERVICE_AGREEMENT["<b>SERVICE AGREEMENT</b><br>name<br>promised percentage<br>period length<br>enabled<br>timezone<br>working schedule<br>excluded downtime"]
    AVAILABILITY_PERIOD["<b>AVAILABILITY PERIOD</b><br>profile<br>month<br>window start<br>window end<br>measured up to<br>closed<br>timezone<br>target percentage<br>gap policy<br>no-data policy<br>data gaps<br>when generated"]
    AVAILABILITY_RESULT["<b>AVAILABILITY RESULT</b><br>scope<br>achieved percentage<br>downtime<br>uptime<br>window seconds<br>measured seconds<br>coverage<br>incidents<br>longest outage<br>data status<br>measured<br>meeting target<br>error budget"]
    DERIVED_NODE["<b>DERIVED SERVICE NODE</b><br>kind<br>name<br>current status<br>worst in subtree<br>descendant count<br>data status<br>coverage"]
    ALERT["<b>ALERT</b>"]
    DEVICE["<b>DEVICE</b>"]

    R_COMPOSES{"composes"}
    R_COMMITS{"commits to"}
    R_CAUSES{"causes"}
    R_YIELDS{"yields"}
    R_SCORES{"scores"}
    R_ROLLS{"rolls up"}
    R_NESTS{"nests"}
    R_STANDS{"stands for"}

    BUSINESS_SERVICE    ---|"(0,n)"| R_COMPOSES
    R_COMPOSES          ---|"(0,n)"| BUSINESS_SERVICE
    BUSINESS_SERVICE    ---|"(0,n)"| R_COMMITS
    R_COMMITS           ---|"(0,n)"| SERVICE_AGREEMENT
    ALERT               ---|"(0,n)"| R_CAUSES
    R_CAUSES            ---|"(0,n)"| BUSINESS_SERVICE
    AVAILABILITY_PERIOD ---|"(1,n)"| R_YIELDS
    R_YIELDS            ---|"(1,1)"| AVAILABILITY_RESULT
    AVAILABILITY_RESULT ---|"(0,1)"| R_SCORES
    R_SCORES            ---|"(0,n)"| DEVICE
    AVAILABILITY_RESULT ---|"(0,n)"| R_ROLLS
    R_ROLLS             ---|"(0,n)"| AVAILABILITY_RESULT
    DERIVED_NODE        ---|"(0,n)"| R_NESTS
    R_NESTS             ---|"(1,1)"| DERIVED_NODE
    DERIVED_NODE        ---|"(1,1)"| R_STANDS
    R_STANDS            ---|"(0,1)"| DEVICE

    classDef zbx     fill:#dbeafe,stroke:#2563eb,color:#14213d
    classDef derived fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef assoc   fill:#f1f5f9,stroke:#94a3b8,color:#475569
    classDef stub    fill:#f8fafc,stroke:#cbd5e1,color:#64748b

    class BUSINESS_SERVICE,SERVICE_AGREEMENT zbx
    class AVAILABILITY_PERIOD,AVAILABILITY_RESULT,DERIVED_NODE derived
    class ALERT,DEVICE stub
    class R_CAUSES,R_COMMITS,R_COMPOSES,R_NESTS assoc
    class R_ROLLS,R_SCORES,R_STANDS,R_YIELDS assoc
```

Two identically-shaped associations, one difference that matters. *composes* on Business Service is
many-to-many: a shared SD-WAN core legitimately sits under both Offshore and Onshore, so services form a
DAG. *nests* on Derived Service Node is `(1,1)` on the child side: the tree the portal synthesises is a
strict tree, built top-down estate → business or site → class → WAN path → device. Confusing the two is
how a traversal starts double-counting or loops, which is why the real one carries a cycle guard and a depth
limit. They are set side by side deliberately.

***commits to* has no key anywhere in the system.** Nothing joins a service to an agreement: the labels are
matched when the query runs, and every figure is computed on the fly. That is also why nothing stores an
achieved percentage.

**Availability Period's two profiles are one property, not two entities.** `hcml-report` counts only high
ping loss, treats gaps as up and answers 100 % where there is no data; `availability` is strict: ICMP
unavailability or high loss, gaps excluded, no figure at all below half coverage. They change the
arithmetic, not the subject, so they are a property of the period. The whole SLI engine is absent from
every existing ERD (`server/src/sli/engine.ts`, `server/src/sli/tree.ts`).

---

## Governance, maps & assistant

```mermaid
---
config:
  layout: elk
---
flowchart TB
    GOVERNANCE_DIM["<b>GOVERNANCE DIMENSION</b><br>dimension name<br>hint<br>devices answering<br>devices total<br>percentage<br>scored"]
    TOPOLOGY_MAP["<b>TOPOLOGY MAP</b><br>map name<br>canvas size<br>background"]
    SNAPSHOT["<b>ASSISTANT SNAPSHOT</b><br>moment taken<br>rendered text<br>section sizes<br>fingerprint<br>complete<br>truncated<br>devices counted<br>sites counted<br>problems counted<br>unacknowledged counted<br>agreements counted<br>degraded counted"]
    TURN["<b>CONVERSATION TURN</b><br>role<br>content"]
    EXPLANATION["<b>EXPLANATION</b><br>summary<br>business impact<br>recommendation<br>label meanings<br>status<br>meeting target"]
    PORTAL_USER["<b>PORTAL USER</b><br>name<br>password<br>role"]
    DEVICE["<b>DEVICE</b>"]
    SITE["<b>SITE</b>"]
    ALERT["<b>ALERT</b>"]

    R_LACKS{"lacks"}
    R_SHOWS{"shows"}
    R_MAPLINK{"is linked to"}
    R_SUMMARISES{"summarises"}
    R_ANSWERS{"answers from"}
    R_EXPLAINS{"explains"}

    DEVICE       ---|"(0,n)"| R_LACKS
    R_LACKS      ---|"(0,n)"| GOVERNANCE_DIM
    TOPOLOGY_MAP ---|"(0,n)"| R_SHOWS
    R_SHOWS      ---|"(0,n)"| DEVICE
    DEVICE       ---|"(0,n)"| R_MAPLINK
    R_MAPLINK    ---|"(0,n)"| DEVICE
    SNAPSHOT     ---|"(0,n)"| R_SUMMARISES
    R_SUMMARISES ---|"(0,n)"| SITE
    R_SUMMARISES ---|"(0,n)"| ALERT
    TURN         ---|"(1,1)"| R_ANSWERS
    R_ANSWERS    ---|"(0,n)"| SNAPSHOT
    EXPLANATION  ---|"(1,1)"| R_EXPLAINS
    R_EXPLAINS   ---|"(0,1)"| ALERT

    classDef zbx     fill:#dbeafe,stroke:#2563eb,color:#14213d
    classDef derived fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef local   fill:#fef3c7,stroke:#d97706,color:#451a03
    classDef assoc   fill:#f1f5f9,stroke:#94a3b8,color:#475569
    classDef stub    fill:#f8fafc,stroke:#cbd5e1,color:#64748b

    class TOPOLOGY_MAP zbx
    class EXPLANATION,GOVERNANCE_DIM,SNAPSHOT,TURN derived
    class PORTAL_USER local
    class ALERT,DEVICE,SITE stub
    class R_ANSWERS,R_EXPLAINS,R_LACKS,R_MAPLINK assoc
    class R_SHOWS,R_SUMMARISES assoc
```

*lacks* is a pure association, which is why the gap list is not an entity. A device lacking a dimension
*is* the relationship; there is nothing else to say about it.

***summarises* is where the assistant's limits become part of the model.** The snapshot is the whole of what
the assistant knows: it has no tools and cannot query anything, so a device absent from the snapshot does
not exist as far as any answer is concerned. The association therefore carries each section's character
budget and whether that section was cut: the snapshot is capped at 5,500 characters overall, with a budget
per section and at most 20 problems, and the page says *partial view* when a cap fired
(`server/src/services/assistantSnapshot.ts:53-67`). A snapshot is frozen for five minutes and so answers several turns, and a
host-state change must hold for a minute before it forces a rebuild, which is why *answers from* is
`(0,n)` on the snapshot leg.

**Portal User takes part in no association, deliberately.** It is parsed from an environment variable and
never leaves the portal; Zabbix has no idea it exists.

---

## Entities at a glance

`O` observed · `D` derived · `L` local. "Merges" names what this entity absorbs from
[`../vanilla/ERD-Domains.md`](../vanilla/ERD-Domains.md); an entity that merges nothing is earning nothing
at this level, and the rows with a single name in the last column are the ones to question.

| Entity | | Merges, or where it comes from |
|---|---|---|
| Device | O | `ZBX_HOST` + `HOST_INTERFACE` + `HOST_INVENTORY` + `HOST_TAG` |
| Device Group | O | `ZBX_HOST_GROUP` |
| Device Class | D | `naming.ts`: eight classes, no logical equivalent |
| Host State | D | `reachability.ts`, `HostState` + `StateReason` + `Availability` + `IcmpReading`. New |
| Measurement | O | `ZBX_ITEM` + `ITEM_TAG` |
| Observation | O | `ZBX_HISTORY` + `ZBX_TREND`: one concept, two granularities |
| Interface Reading | D | `services/net.ts`, `InterfaceRow` + `OperStatus`. New |
| Internet Meter | D | `METER` and the dashboard gauge widget it is drawn from (`services/meters.ts`). New |
| Capacity Reading | D | `CAPACITY_ROW` |
| Alert Rule | O | `ZBX_TRIGGER` |
| Alert | O | `ZBX_EVENT` / `PROBLEM` + `PROBLEM_TAG` |
| Incident | D | `INCIDENT`: a reified Alert × Period |
| Noisy Alert Rule | D | `NOISY_TRIGGER` + `TOP_TRIGGER` |
| Site | D | `SITE` + `SITE_HOST` |
| Link | D | `LINK` |
| WAN Path | D | `LINK_PATH` + `SliPath`'s path half |
| Business Service | O | `ZBX_SERVICE` + `SERVICE_TAG` |
| Service Agreement | O | `ZBX_SLA` + its schedule and exclusions |
| Availability Period | D | `SliReport` + its basis. New |
| Availability Result | D | `SliHost` + `SliGroup` + `SliPath` + `HostAvailability` + `SlaSli` + `ServiceSla`: six shapes, one fact. New |
| Derived Service Node | D | `sli/tree.ts`. New |
| Governance Dimension | D | `DIMENSION` / `SCORECARD_DIMENSION`, exactly four |
| Topology Map | O | `ZBX_MAP` |
| Assistant Snapshot | D | `CHAT_SNAPSHOT` + the frozen text, sizes and fingerprint |
| Conversation Turn | D | `CHAT_TURN` |
| Explanation | D | `PROBLEM_EXPLANATION` + `TAG_EXPLAINED` + `SLA_EXPLANATION` |
| Portal User | L | `PORTAL_USER` |

### What is deliberately not an entity

The response envelopes, `SITES_RESPONSE`, `LINKS_RESPONSE`, `SERVICES_RESPONSE`, `AVAILABILITY_REPORT`,
`NOISE_REPORT`, `SCORECARD`, `CAPACITY_REPORT`, `AGING_REPORT` are transport, not concepts: they exist
because HTTP needs one object per response. `STATS` and `GROUP_PROBLEMS` are counters. `AGING_BUCKET` and
`TOP_TRIGGER` are presentations of Alert and Alert Rule. `SITE_HOST` is *stations* (R2), `HOST_GAP` is
*lacks* (R28), `GROUP_SCORE` is *lacks* counted per group, and `MAP_ELEMENT` is *shows* (R29): all
associations, none of them things. `MAP_SELEMENT` and `MAP_LINK` disappear for the same reason. `TOP_HOST`
is a presentation of Device and Measurement (the busiest by CPU and by memory), `WEB_SCENARIO` is a Measurement
of a device read as passed, failed or not known, and the tiles of the Devices page and the counts of the
Dashboard's Hosts view are counters, like `STATS`.

---

## Associations at a glance

Read each row as *left, (min,max), verb, (min,max), right*. M:N marks a genuine many-to-many;
carries marks a *relation porteuse*, an association with properties of its own. The last column cites
the physical model where a foreign key backs the cardinality, and the code where none does.

| | Left | | Verb | | Right | Evidence |
|---|---|---|---|---|---|---|
| R1 | Device | (1,n) | belongs to | (0,n) | Device Group | M:N: a link table with a key on both sides |
| R2 | Site | (1,n) | stations | (1,1) | Device | carries the signal · conceptual only, `services/sites.ts:83-104` |
| R3 | Device Class | (0,n) | classes | (1,1) | Device | conceptual only, `naming.ts`, total, defaults to *other* |
| R4 | Device | (1,1) | reaches | (1,1) | Host State | conceptual only, `reachability.ts:255-278`, total, disabled devices included |
| R5 | Device | (0,n) | carries | (1,1) | Measurement | a NOT NULL foreign key |
| R6 | Measurement | (0,n) | records | (1,1) | Observation | no foreign key on purpose. See Measurement above |
| R7 | Device | (0,n) | exposes | (1,1) | Interface Reading | conceptual only, `services/net.ts:57-63`, SNMP devices only |
| R8 | Measurement | (0,1) | sums up | (1,1) | Capacity Reading | keyed by measurement, three metrics only |
| R9 | Capacity Reading | (1,1) | derives from | (0,n) | Observation | carries the evidence source |
| R10 | Alert Rule | (1,n) | watches | (0,n) | Device | M:N, rule → function → measurement → device |
| R11 | Alert Rule | (0,n) | raises | (1,1) | Alert | no foreign key, total in the data |
| R12 | Alert | (1,1) | hits | (0,n) | Device | derived: stitched by a second query, a consequence of R10 + R11 |
| R13 | Alert | (1,1) | clips into | (0,n) | Incident | conceptual only: one incident per alert per window |
| R14 | Incident | (1,1) | falls within | (0,n) | Availability Period | completes R13 |
| R15 | Incident | (0,1) | counts in | (1,n) | Noisy Alert Rule | grouped by rule, above a minimum count |
| R16 | Alert Rule | (1,1) | ranks as | (0,1) | Noisy Alert Rule | only rules above the threshold are ranked |
| R17 | Device | (0,n) | terminates | (1,1) | Link | a link is one device-target pair |
| R18 | Link | (0,1) | is a leg of | (1,n) | WAN Path | carries the leg and the provider · conceptual only |
| R19 | WAN Path | (0,1) | serves | (0,n) | Site | nullable site on the path |
| R20 | Business Service | (0,n) | composes | (0,n) | Business Service | M:N, reflexive, a DAG: a link table |
| R21 | Business Service | (0,n) | commits to | (0,n) | Service Agreement | M:N with no key at all, matched by label at query time |
| R22 | Alert | (0,n) | causes | (0,n) | Business Service | M:N: a link table |
| R23 | Availability Period | (1,n) | yields | (1,1) | Availability Result | a period always yields at least the overall figure |
| R24 | Availability Result | (0,1) | scores | (0,n) | Device | (0,1) because group results score no single device |
| R25 | Availability Result | (0,n) | rolls up | (0,n) | Availability Result | M:N: one device figure feeds site, class and overall at once |
| R26 | Derived Service Node | (0,n) | nests | (1,1) | Derived Service Node | a strict tree, unlike R20 |
| R27 | Derived Service Node | (1,1) | stands for | (0,1) | Device | only nodes of kind *host*; the other kinds stand for a site, class, path or web check |
| R28 | Device | (0,n) | lacks | (0,n) | Governance Dimension | M:N: this is the gap list |
| R29 | Topology Map | (0,n) | shows | (0,n) | Device | M:N, carries the label, position, problem count and worst severity · the element id is a device only for one element type, so no key backs it |
| R30 | Device | (0,n) | is linked to | (0,n) | Device | M:N, reflexive, map-scoped: two real foreign keys between map elements, flattened here because Merise cannot associate an association |
| R31 | Assistant Snapshot | (0,n) | summarises | (0,n) | Site, Alert, Derived Service Node | M:N, carries the section budget and the cut flag |
| R32 | Conversation Turn | (1,1) | answers from | (0,n) | Assistant Snapshot | (0,n) because a snapshot is frozen for five minutes |
| R33 | Explanation | (1,1) | explains | (0,1) | Alert, Service Agreement | (0,1): only a currently-open problem can be explained |
| R34 | Internet Meter | (0,n) | reads | (0,n) | Measurement | M:N, carries the role (the gauge's own item, the other direction, or the status) · conceptual only, `services/meters.ts` |

Eleven are many-to-many: R1, R10, R20, R21, R22, R25, R28, R29, R30, R31, R34. Six carry properties of their own:
R2, R9, R18, R29, R31, R34. Eight are conceptual only, with no counterpart in the schema: R2, R3, R4, R7, R13,
R18, R34, and the derived half of R25.

---

## Keeping this in step

This is the only one of the four ERD documents whose content cannot be regenerated. The logical model can be
read off the API calls and the physical one off `information_schema`; a conceptual entity is a judgement, so
nothing will ever flag this file as stale. Two of the other four already are: the site rule was three
signals here until 18 September 2026, and the assistant's caps were listed as counts long after they became
character budgets.

So, concretely: a change to any of these obliges a change here.

| If this changes | Revisit |
|---|---|
| `server/src/services/sites.ts`: the site signals | R2, and the coverage properties on Site |
| `server/src/domain/reachability.ts`, states or reasons | Host State |
| `server/src/sli/engine.ts`: the profiles, or what a result carries | Availability Period, Availability Result, R23 to R25 |
| `server/src/sli/tree.ts`: the node kinds | Derived Service Node, R26, R27 |
| `server/src/services/assistantSnapshot.ts`: the caps, the freeze or the sections | Assistant Snapshot, R31, R32 |
| `server/src/services/inventory.ts`: the dimensions | Governance Dimension, R28 |
| `server/src/services/meters.ts`: what a meter reads, or the states it can be in | Internet Meter, R34 |
| A new Zabbix API method in `server/src/clients/zabbix.ts` | Whether a new entity is observed rather than derived |

And the other direction: nothing here should be added because the code grew a type. A new interface is a
logical-model change. It belongs here only when someone at HCML would name it.
