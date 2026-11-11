# ERD by domain: HCML Monitoring Portal

The same schema as [`ERD-Mermaid.mmd`](ERD-Mermaid.mmd), split for readability. 46 entities and 54 relationships are a lot to take in at once, so this document shows the domain map first, then each domain on its own with full attributes.

Nothing here differs from the single-diagram version: same entities, same attributes, same relationships, same names and PK/FK markers. Only the layout differs. One level up is the conceptual model, which says what the business talks about, with no keys or types: [`ERD-Conceptual.md`](../conceptual/ERD-Conceptual.md). The index of all three levels is in [`erd.md`](../erd.md#the-three-levels).

**Colour marks the layer:** blue `ZBX_*` is read from Zabbix over JSON-RPC · green is derived by the portal, which Zabbix has no equivalent for · amber is local to the portal · grey is an entity belonging to another domain, shown without attributes so the edge has somewhere to land.

**A blue entity's header names the MySQL table it is stored in**, after the dot: `ZBX_HOST · hosts`. Those tables, with their real columns and foreign keys, are diagrammed in [`ERD-Database.md`](../database/ERD-Database.md), and [`ERD-DatabaseSchema.md`](../database-schema/ERD-DatabaseSchema.md) maps every entity to its tables.

---

## Domain map

Nine domains and the relationships that cross between them. Each is a link to its section.

```mermaid
---
config:
  layout: elk
---
flowchart LR
    HOSTS["<b>Hosts & Inventory</b><br/>5 Zabbix · 3 derived"]
    SITES["<b>Sites & Links</b><br/>4 derived"]
    METRICS["<b>Metrics & Items</b><br/>4 Zabbix · 4 derived"]
    EVENTS["<b>Events & Incidents</b><br/>3 Zabbix · 4 derived"]
    SERVICES["<b>Services & SLA</b><br/>4 Zabbix · 2 derived"]
    SCORECARD["<b>Governance scorecard</b><br/>2 derived"]
    AI["<b>AI layer</b><br/>5 derived"]
    MAPS["<b>Maps</b><br/>3 Zabbix · 1 derived"]
    SYSTEM["<b>Admin & system</b><br/>1 derived · 1 local"]

    EVENTS -- "2" --> HOSTS
    AI -- "2" --> SERVICES
    HOSTS -- "3" --> METRICS
    SERVICES -- "1" --> EVENTS
    HOSTS -- "1" --> SITES
    METRICS -- "1" --> SITES
    HOSTS -- "1" --> SCORECARD
    EVENTS -- "1" --> AI
    SERVICES -- "1" --> AI
    AI -- "1" --> EVENTS
    AI -- "1" --> SITES
    HOSTS -- "1" --> MAPS
    EVENTS -- "1" --> MAPS

    classDef d fill:#eef2ff,stroke:#4f46e5,color:#1e1b4b,rx:6,ry:6
    class HOSTS,SITES,METRICS,EVENTS,SERVICES,SCORECARD,AI,MAPS,SYSTEM d
```

| Domain | Entities | Internal | Crossing |
|---|---:|---:|---:|
| [Hosts & Inventory](#hosts--inventory) | 8 | 6 | 8 |
| [Sites & Links](#sites--links) | 4 | 2 | 3 |
| [Metrics & Items](#metrics--items) | 8 | 7 | 4 |
| [Events & Incidents](#events--incidents) | 7 | 7 | 6 |
| [Services & SLA](#services--sla) | 6 | 8 | 4 |
| [Governance scorecard](#governance-scorecard) | 2 | 1 | 1 |
| [AI layer](#ai-layer) | 5 | 2 | 6 |
| [Maps](#maps) | 4 | 4 | 2 |
| [Admin & system](#admin--system) | 2 | 0 | 0 |

---

## Hosts & Inventory

The estate as Zabbix stores it, plus the per-host and per-group roll-ups the portal computes on top.

```mermaid
---
config:
  layout: elk
---
erDiagram
    direction TB
    ZBX_HOST["ZBX_HOST · hosts"] {
        string hostid PK
        string host "technical name, read only for map labels"
        string name "the visible name"
        string status "0 monitored, 1 not monitored"
        string maintenance_status "1 = in maintenance"
        string description
    }
    ZBX_HOST_INTERFACE["ZBX_HOST_INTERFACE · interface"] {
        string ip
        string dns "map labels only"
        string useip "1 = connect by IP"
        string main "1 = the default interface"
        string type "1 agent, 2 SNMP, 3 IPMI, 4 JMX"
        string available "0 unknown, 1 up, 2 down"
    }
    ZBX_HOST_INVENTORY["ZBX_HOST_INVENTORY · host_inventory"] {
        string site_city "site signal, rank 2"
        string location "site signal, rank 3"
        string poc_1_name "owner signal"
        string poc_1_email "owner signal"
        string notes "requested but never read"
    }
    ZBX_HOST_TAG["ZBX_HOST_TAG · host_tag"] {
        string tag "site, owner, criticality"
        string value
    }
    ZBX_HOST_GROUP["ZBX_HOST_GROUP · hstgrp"] {
        string groupid PK
        string name "site fallback when no tag or inventory"
    }
    HOST_AVAILABILITY {
        string hostid PK
        string host
        number availability "percent, overlapping problems merged"
        number downtime "seconds"
        number incidents
        number longest
    }
    GROUP_SCORE {
        string name PK "the host group name"
        number hosts "a host counts in EVERY group it belongs to"
        number complete
        number pct
    }
    GROUP_PROBLEMS {
        string groupid PK
        string name
        number total
        string bySeverity "counts keyed 0 to 5"
    }
    ZBX_ITEM["ZBX_ITEM · items"]
    ZBX_MAP_SELEMENT["ZBX_MAP_SELEMENT · sysmaps_elements"]
    ZBX_TRIGGER["ZBX_TRIGGER · triggers"]
    WEB_SCENARIO
    TOP_HOST

    ZBX_HOST             ||--o{ ZBX_HOST_INTERFACE   : "selectInterfaces"
    ZBX_HOST             ||--o| ZBX_HOST_INVENTORY   : "selectInventory, [] when disabled"
    ZBX_HOST             ||--o{ ZBX_HOST_TAG         : "selectTags"
    ZBX_HOST             }o--o{ ZBX_HOST_GROUP       : "selectHostGroups / selectHosts"
    ZBX_HOST_GROUP       ||--|| GROUP_SCORE          : "derives: compliance rolled up per group"
    ZBX_HOST_GROUP       ||--|| GROUP_PROBLEMS       : "derives: severity histogram per group"

    ZBX_HOST             ||--o{ ZBX_ITEM             : "hostids"
    ZBX_HOST             ||--o{ WEB_SCENARIO         : "hostids"
    ZBX_HOST             ||--o{ TOP_HOST             : "hostids"
    ZBX_TRIGGER          }o--|| ZBX_HOST             : "selectHosts: FIRST HOST ONLY"
    ZBX_HOST             ||--|| SITE_HOST            : "derives: resolveSite() tag, name, inventory, group"
    INCIDENT             }|--|| HOST_AVAILABILITY    : "derives: overlapping intervals merged per host"
    ZBX_HOST             ||--o{ HOST_GAP             : "derives: only when a dimension is missing"
    ZBX_HOST             |o--o{ ZBX_MAP_SELEMENT     : "elements[0].hostid, host elements only"

    classDef zbx      fill:#dbeafe,stroke:#2563eb,color:#14213d
    classDef derived  fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef local    fill:#fef3c7,stroke:#d97706,color:#451a03
    classDef external fill:#f1f5f9,stroke:#94a3b8,color:#475569
    class ZBX_HOST,ZBX_HOST_INTERFACE,ZBX_HOST_INVENTORY,ZBX_HOST_TAG zbx
    class ZBX_HOST_GROUP zbx
    class HOST_AVAILABILITY,GROUP_SCORE,GROUP_PROBLEMS derived
    class HOST_GAP,INCIDENT,SITE_HOST,ZBX_ITEM external
    class ZBX_MAP_SELEMENT,ZBX_TRIGGER external
    class WEB_SCENARIO,TOP_HOST external
```

*Grey, no attributes:* `HOST_GAP`, `INCIDENT`, `SITE_HOST`, `TOP_HOST`, `WEB_SCENARIO`, `ZBX_ITEM`, `ZBX_MAP_SELEMENT`, `ZBX_TRIGGER`. Detailed in [Governance scorecard](#governance-scorecard), [Events & Incidents](#events--incidents), [Sites & Links](#sites--links), [Metrics & Items](#metrics--items), [Metrics & Items](#metrics--items), [Metrics & Items](#metrics--items), [Maps](#maps), [Events & Incidents](#events--incidents).

---

## Sites & Links

Zabbix has no site object. `SITE` is derived from a host tag, falling back to inventory, then host group. A `LINK` is one (host, ping target) pair stitched from up to three ICMP items.

```mermaid
---
config:
  layout: elk
---
erDiagram
    direction TB
    SITE {
        string name PK "derived, never stored anywhere"
        number total
        number available
        number unavailable
        number unknown
        number maintenance
        number disabled
        number problems
        number unacknowledged
        number worst "highest severity here, -1 when clear"
    }
    SITE_HOST {
        string hostid PK
        string name
        string availability "worst-wins across the host interfaces"
        string siteSource "tag, name, inventory or group"
        number problems
    }
    LINK {
        string id PK "hostid:target, a synthetic composite key"
        string host
        string target "ping destination, parsed from the item key"
        string label "taken from the icmppingloss item name"
        boolean up "from icmpping"
        number loss "percent, from icmppingloss"
        number latency "ms, from icmppingsec"
        number jitter "rttMax minus rttMin, needs both modes"
        string state "up, degraded, down, unknown"
        string group "link_group tag, absent = in no path"
        string role "link_role tag, e.g. main or standby"
        string lastclock
    }
    LINK_PATH {
        string name PK "the link_group value"
        string state "DOWN only when every leg is down"
    }
    ZBX_HOST["ZBX_HOST · hosts"]
    ZBX_ITEM["ZBX_ITEM · items"]

    SITE                 ||--|{ SITE_HOST            : "a total function, every host lands in one site"
    LINK_PATH            ||--|{ LINK                 : "grouped by the link_group tag"

    ZBX_HOST             ||--|| SITE_HOST            : "derives: resolveSite() tag, name, inventory, group"
    ZBX_ITEM             }|--|| LINK                 : "derives: 1..3 icmpping items, keyed hostid:target"
    CHAT_SNAPSHOT        ||--o{ SITE                 : "worst first, in a budget of 900 characters"

    classDef zbx      fill:#dbeafe,stroke:#2563eb,color:#14213d
    classDef derived  fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef local    fill:#fef3c7,stroke:#d97706,color:#451a03
    classDef external fill:#f1f5f9,stroke:#94a3b8,color:#475569
    class SITE,SITE_HOST,LINK,LINK_PATH derived
    class CHAT_SNAPSHOT,ZBX_HOST,ZBX_ITEM external
```

*Grey, no attributes:* `CHAT_SNAPSHOT`, `ZBX_HOST`, `ZBX_ITEM`. Detailed in [AI layer](#ai-layer), [Hosts & Inventory](#hosts--inventory), [Metrics & Items](#metrics--items).

---

## Metrics & Items

Items and their stored values: raw history in five MySQL tables and hourly trends in two, the table picked by the item's `value_type`. `lastvalue` and `lastclock` are not stored anywhere, Zabbix reads them back from history, so they go blank once the newest value is older than the history display period. `CAPACITY_ROW` aggregates a trend window, falling back to raw history on a young instance. Three derived entities were added on 20 October 2026, for the Dashboard's views of 14 and 15 October: `METER` (one gauge of the Internet traffic view: a gauge widget of HCML's own Zabbix dashboard, read with `dashboard.get`, and the items behind it), `WEB_SCENARIO` (a web scenario's current result, read from its `web.test.fail[...]` item) and `TOP_HOST` (the busiest hosts by CPU and by memory). The dashboard's own tables are not drawn, as the maintenance tables are not: the portal reads them only to build a meter. A meter also reads the item of the same interface the other way and its status item, which this diagram shows as the one edge to `ZBX_ITEM`.

```mermaid
---
config:
  layout: elk
---
erDiagram
    direction TB
    ZBX_ITEM["ZBX_ITEM · items"] {
        string itemid PK
        string key_ "parsed for icmpping target and mode"
        string name
        string value_type "0 float, 1 char, 2 log, 3 uint, 4 text"
        string units
        string lastvalue "not a column, taken from history"
        string lastclock "blank beyond the history period, 24h default"
        string prevvalue "not a column, taken from history"
        string state "0 normal, 1 not supported, in item_rtdata"
    }
    ZBX_ITEM_TAG["ZBX_ITEM_TAG · item_tag"] {
        string tag "link_group, link_role"
        string value
    }
    ZBX_HISTORY["ZBX_HISTORY · five history tables"] {
        string itemid FK "no constraint in MySQL"
        string clock "the newest one anchors a graph window"
        string value
    }
    ZBX_TREND["ZBX_TREND · trends, trends_uint"] {
        string itemid FK "no constraint in MySQL"
        string value_avg
        string value_max
    }
    CAPACITY_ROW {
        string itemid PK
        string host
        string metric "cpu, memory or disk"
        string units
        number avg
        number max
        string source "trend, history or none"
    }
    METER {
        string id PK "the dashboard page and the widget"
        string title "the widget's name, from dashboard.get"
        string itemid FK "empty when the widget points at no item"
        string direction "in or out, from the item key"
        string link "up, down or unknown, from the status item"
        string units
        number value
        number clock
        number min "the bottom of the gauge"
        number max "the top of the gauge: the capacity of the link"
        string zones "the colour zones, from the widget's thresholds"
        number fraction "value over max"
        string zone "none, low, ok, warn or critical"
        string state "ok, stale, nodata, unsupported, missing or invalid"
        string other "the same interface the other way, on this scale"
    }
    WEB_SCENARIO {
        string itemid PK "web.test.fail[scenario]"
        string hostid FK
        string name "the scenario"
        string state "ok, failed or unknown"
        number step "the step that failed, counting from 1"
        number clock
    }
    TOP_HOST {
        string itemid PK
        string hostid FK
        string metric "cpu or memory"
        number value "percent"
        number clock
    }
    ZBX_HOST["ZBX_HOST · hosts"]

    ZBX_ITEM             ||--o{ ZBX_ITEM_TAG         : "selectTags, link_group + link_role"
    ZBX_ITEM             ||--o{ ZBX_HISTORY          : "itemids, table picked by value_type"
    ZBX_ITEM             ||--o{ ZBX_TREND            : "itemids, hourly aggregates"
    ZBX_ITEM             ||--o| CAPACITY_ROW         : "derives: trend.get, history fallback"
    ZBX_ITEM             |o--o| METER                : "derives: the gauge widget's item, with the other direction and the status item of the same interface"
    ZBX_ITEM             ||--o| WEB_SCENARIO         : "derives: the result item web.test.fail[scenario], webitems"
    ZBX_ITEM             ||--o| TOP_HOST             : "derives: the hottest cpu or memory item of the host"

    ZBX_HOST             ||--o{ ZBX_ITEM             : "hostids"
    ZBX_HOST             ||--o{ WEB_SCENARIO         : "hostids"
    ZBX_HOST             ||--o{ TOP_HOST             : "hostids"
    ZBX_ITEM             }|--|| LINK                 : "derives: 1..3 icmpping items, keyed hostid:target"

    classDef zbx      fill:#dbeafe,stroke:#2563eb,color:#14213d
    classDef derived  fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef local    fill:#fef3c7,stroke:#d97706,color:#451a03
    classDef external fill:#f1f5f9,stroke:#94a3b8,color:#475569
    class ZBX_ITEM,ZBX_ITEM_TAG,ZBX_HISTORY,ZBX_TREND zbx
    class CAPACITY_ROW,METER,WEB_SCENARIO,TOP_HOST derived
    class LINK,ZBX_HOST external
```

*Grey, no attributes:* `LINK`, `ZBX_HOST`. Detailed in [Sites & Links](#sites--links), [Hosts & Inventory](#hosts--inventory).

---

## Events & Incidents

Zabbix stores a problem and its recovery as two separate rows. `INCIDENT` pairs them, and everything downstream, availability, noise, aging, is arithmetic over those pairs. In MySQL the pairing is a table of its own, `event_recovery`, and a problem that is still live also has a row in `problem`.

```mermaid
---
config:
  layout: elk
---
erDiagram
    direction TB
    ZBX_TRIGGER["ZBX_TRIGGER · triggers"] {
        string triggerid PK
        string manual_close "1 = the Close action is permitted"
    }
    ZBX_EVENT["ZBX_EVENT · problem, events"] {
        string eventid PK
        string objectid FK "the trigger id, no constraint in MySQL"
        string object "0 = trigger, the only kind handled"
        string source "0 = triggers, always sent never read"
        string value "1 = PROBLEM"
        string name "the notification text"
        string severity "0 to 5"
        string clock "unix seconds"
        string r_eventid FK "0 means STILL OPEN"
        string acknowledged "0 or 1"
        string opdata "the live value"
        string suppressed "declared, never branched on"
    }
    ZBX_EVENT_TAG["ZBX_EVENT_TAG · problem_tag"] {
        string tag
        string value
    }
    INCIDENT {
        string eventid PK
        string objectid FK "trigger"
        string hostid FK
        string name
        string severity
        number start "clipped to the report window"
        number end "recovery clock, or now when still open"
        boolean resolved
        boolean acknowledged
    }
    NOISY_TRIGGER {
        string objectid PK
        string name
        string host
        string severity
        number count
        number medianDuration "MEDIAN, not mean: one outlier must not hide many"
        number shortLived
        number ackRate "0 to 1"
        number totalDuration
        number longest
        boolean stillOpen
        string flags "flapping, unactioned, chronic"
    }
    TOP_TRIGGER {
        string objectid PK
        string name "taken from the EVENT, never from the trigger"
        string severity
        string host
        number count
    }
    AGING_BUCKET {
        string label PK "Under 1h, 1-4h, 4-24h, Over 24h"
        number count
    }
    ZBX_HOST["ZBX_HOST · hosts"]
    ZBX_SERVICE["ZBX_SERVICE · services"]

    ZBX_EVENT            }o--|| ZBX_TRIGGER          : "objectid, only when object=0"
    ZBX_EVENT            ||--o| ZBX_EVENT            : "r_eventid, the recovery row"
    ZBX_EVENT            ||--o{ ZBX_EVENT_TAG        : "selectTags"
    ZBX_EVENT            ||--|| INCIDENT             : "derives: paired with its recovery row"
    INCIDENT             }|--|| NOISY_TRIGGER        : "derives: grouped by objectid"
    ZBX_EVENT            }o--|| AGING_BUCKET         : "derives: unacknowledged, bucketed by age"
    ZBX_EVENT            }o--|| TOP_TRIGGER          : "derives: counted by objectid, top 100"

    ZBX_TRIGGER          }o--|| ZBX_HOST             : "selectHosts: FIRST HOST ONLY"
    ZBX_SERVICE          ||--o{ ZBX_EVENT            : "selectProblemEvents, the root causes"
    INCIDENT             }|--|| HOST_AVAILABILITY    : "derives: overlapping intervals merged per host"
    ZBX_EVENT            ||--o| PROBLEM_EXPLANATION  : "derives: humanize() through an LLM"
    CHAT_SNAPSHOT        ||--o{ ZBX_EVENT            : "derives: up to 20 problems, worst first, in a budget of 1,850 characters"
    ZBX_EVENT            }o--o{ MAP_ELEMENT          : "derives: open problems and worst severity per host"

    classDef zbx      fill:#dbeafe,stroke:#2563eb,color:#14213d
    classDef derived  fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef local    fill:#fef3c7,stroke:#d97706,color:#451a03
    classDef external fill:#f1f5f9,stroke:#94a3b8,color:#475569
    class ZBX_TRIGGER,ZBX_EVENT,ZBX_EVENT_TAG zbx
    class INCIDENT,NOISY_TRIGGER,TOP_TRIGGER,AGING_BUCKET derived
    class CHAT_SNAPSHOT,HOST_AVAILABILITY,MAP_ELEMENT,PROBLEM_EXPLANATION external
    class ZBX_HOST,ZBX_SERVICE external
```

*Grey, no attributes:* `CHAT_SNAPSHOT`, `HOST_AVAILABILITY`, `MAP_ELEMENT`, `PROBLEM_EXPLANATION`, `ZBX_HOST`, `ZBX_SERVICE`. Detailed in [AI layer](#ai-layer), [Hosts & Inventory](#hosts--inventory), [Maps](#maps), [AI layer](#ai-layer), [Hosts & Inventory](#hosts--inventory), [Services & SLA](#services--sla).

---

## Services & SLA

Services form a DAG, not a tree: one service can have several parents, so any walk must deduplicate by `serviceid`. The SLA-to-SLI join is positional, not keyed. No table stores an SLI: `sla.getsli` computes it from each service's status history in `service_alarms`.

```mermaid
---
config:
  layout: elk
---
erDiagram
    direction TB
    ZBX_SERVICE["ZBX_SERVICE · services"] {
        string serviceid PK
        string name
        number status "-1 OK, else the severity that propagated up"
        string algorithm "carried through, never mapped to a label"
        string sortorder
        string description
    }
    ZBX_SERVICE_TAG["ZBX_SERVICE_TAG · service_tag"] {
        string tag
        string value
    }
    ZBX_SLA["ZBX_SLA · sla"] {
        string slaid PK
        string name
        string slo "target percent"
        string period "0 daily, 1 weekly, 2 monthly, 3 quarterly, 4 annually"
        string status "0 disabled, 1 enabled"
        string timezone
        string description
    }
    ZBX_SLI["ZBX_SLI · computed, no table"] {
        number sli "achieved percent"
        number uptime "seconds"
        number downtime "seconds"
        number error_budget "seconds, negative = SLO missed"
    }
    SERVICE_NODE {
        string serviceid PK
        string name
        number status "-1 OK, else severity"
        number worst "max status anywhere in the subtree"
        number descendants "DISTINCT ids below: the DAG can share children"
    }
    SERVICE_SLA {
        string slaid PK
        string name
        number slo
        number sli
        number errorBudget "seconds, negative = missed"
        boolean meeting "sli >= slo"
    }
    ZBX_EVENT["ZBX_EVENT · problem, events"]

    ZBX_SERVICE          ||--o{ ZBX_SERVICE          : "selectChildren: a DAG, not a tree"
    ZBX_SERVICE          ||--o{ ZBX_SERVICE_TAG      : "selectTags"
    ZBX_SLA              ||--o{ ZBX_SLI              : "sla.getsli, one row per service"
    ZBX_SLI              }o--|| ZBX_SERVICE          : "POSITIONAL index, not a key"
    ZBX_SERVICE          ||--|| SERVICE_NODE         : "derives: the DAG materialised"
    SERVICE_NODE         ||--o{ SERVICE_NODE         : "children, DAG-safe descendant count"
    SERVICE_NODE         ||--o| SERVICE_SLA          : "first SLA wins if several apply"
    ZBX_SLA              ||--o{ SERVICE_SLA          : "derives: SLI grafted onto the node"

    ZBX_SERVICE          ||--o{ ZBX_EVENT            : "selectProblemEvents, the root causes"
    ZBX_SLA              ||--o| SLA_EXPLANATION      : "derives: humanize() through an LLM"
    CHAT_SNAPSHOT        ||--o{ SERVICE_NODE         : "the degraded ones, in a budget of 400 characters"
    CHAT_SNAPSHOT        ||--o{ SERVICE_SLA          : "in a budget of 700 characters"

    classDef zbx      fill:#dbeafe,stroke:#2563eb,color:#14213d
    classDef derived  fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef local    fill:#fef3c7,stroke:#d97706,color:#451a03
    classDef external fill:#f1f5f9,stroke:#94a3b8,color:#475569
    class ZBX_SERVICE,ZBX_SERVICE_TAG,ZBX_SLA,ZBX_SLI zbx
    class SERVICE_NODE,SERVICE_SLA derived
    class CHAT_SNAPSHOT,SLA_EXPLANATION,ZBX_EVENT external
```

*Grey, no attributes:* `CHAT_SNAPSHOT`, `SLA_EXPLANATION`, `ZBX_EVENT`. Detailed in [AI layer](#ai-layer), [AI layer](#ai-layer), [Events & Incidents](#events--incidents).

---

## Governance scorecard

Zabbix stores naming, site, owner and criticality but never scores them. Four dimensions, with a gap row per host that misses any.

```mermaid
---
config:
  layout: elk
---
erDiagram
    direction TB
    SCORECARD_DIMENSION {
        string key PK "naming, site, owner, criticality"
        string label
        string hint
        number present
        number total
        number pct
        boolean scored "false when the rule is not configured"
    }
    HOST_GAP {
        string hostid PK
        string name
        string site
        string missing "which of the four dimensions are absent"
    }
    ZBX_HOST["ZBX_HOST · hosts"]

    SCORECARD_DIMENSION  ||--o{ HOST_GAP             : "a gap names the dimensions it misses"

    ZBX_HOST             ||--o{ HOST_GAP             : "derives: only when a dimension is missing"

    classDef zbx      fill:#dbeafe,stroke:#2563eb,color:#14213d
    classDef derived  fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef local    fill:#fef3c7,stroke:#d97706,color:#451a03
    classDef external fill:#f1f5f9,stroke:#94a3b8,color:#475569
    class SCORECARD_DIMENSION,HOST_GAP derived
    class ZBX_HOST external
```

*Grey, no attributes:* `ZBX_HOST`. Detailed in [Hosts & Inventory](#hosts--inventory).

---

## AI layer

The plain-language layer. Output shape is enforced by a JSON Schema, so the caller parses without a validation dependency.

```mermaid
---
config:
  layout: elk
---
erDiagram
    direction TB
    PROBLEM_EXPLANATION {
        string summary "schema-enforced, never empty"
        string businessImpact
        string recommendation
    }
    TAG_EXPLAINED {
        string tag
        string value
        string meaning "what the tag tells a non-engineer"
    }
    SLA_EXPLANATION {
        string status "a short verdict"
        string plain "the acronyms removed"
        boolean meetingTarget
        string recommendation
    }
    CHAT_SNAPSHOT {
        number generatedAt PK "one per assistant message, never stored"
        number hosts
        number sites
        number problems
        number unacknowledged
        number slas
        number degradedServices
        boolean truncated "a cap fired: the model sees a PARTIAL estate"
        string text "plain text, ~4 chars per token, capped at 5500"
    }
    CHAT_TURN {
        string role "user or assistant"
        string content "capped at 2000 chars, last 12 turns kept"
    }
    ZBX_EVENT["ZBX_EVENT · problem, events"]
    ZBX_SLA["ZBX_SLA · sla"]

    PROBLEM_EXPLANATION  ||--o{ TAG_EXPLAINED        : "one entry per input tag, none invented"
    CHAT_TURN            }o--|| CHAT_SNAPSHOT        : "a fresh snapshot per user message"

    ZBX_EVENT            ||--o| PROBLEM_EXPLANATION  : "derives: humanize() through an LLM"
    ZBX_SLA              ||--o| SLA_EXPLANATION      : "derives: humanize() through an LLM"
    CHAT_SNAPSHOT        ||--o{ ZBX_EVENT            : "derives: up to 20 problems, worst first, in a budget of 1,850 characters"
    CHAT_SNAPSHOT        ||--o{ SITE                 : "worst first, in a budget of 900 characters"
    CHAT_SNAPSHOT        ||--o{ SERVICE_NODE         : "the degraded ones, in a budget of 400 characters"
    CHAT_SNAPSHOT        ||--o{ SERVICE_SLA          : "in a budget of 700 characters"

    classDef zbx      fill:#dbeafe,stroke:#2563eb,color:#14213d
    classDef derived  fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef local    fill:#fef3c7,stroke:#d97706,color:#451a03
    classDef external fill:#f1f5f9,stroke:#94a3b8,color:#475569
    class PROBLEM_EXPLANATION,TAG_EXPLAINED,SLA_EXPLANATION,CHAT_SNAPSHOT derived
    class CHAT_TURN derived
    class SERVICE_NODE,SERVICE_SLA,SITE,ZBX_EVENT external
    class ZBX_SLA external
```

*Grey, no attributes:* `SERVICE_NODE`, `SERVICE_SLA`, `SITE`, `ZBX_EVENT`, `ZBX_SLA`. Detailed in [Services & SLA](#services--sla), [Services & SLA](#services--sla), [Sites & Links](#sites--links), [Events & Incidents](#events--incidents), [Services & SLA](#services--sla).

---

## Maps

Maps with their elements and links. A host element is followed to its host: the BFF resolves label macros such as `{HOSTNAME} ({HOST.IP})` and attaches the host's open problems, which gives `MAP_ELEMENT`. No foreign key backs that step, `sysmaps_elements.elementid` holds a host, map or host-group id depending on `elementtype`, so MySQL cannot enforce it.

```mermaid
---
config:
  layout: elk
---
erDiagram
    direction TB
    ZBX_MAP["ZBX_MAP · sysmaps"] {
        string sysmapid PK
        string name
        string width
        string height
    }
    ZBX_MAP_SELEMENT["ZBX_MAP_SELEMENT · sysmaps_elements"] {
        string selementid PK
        string label
        string x
        string y
        string elementtype "0 host, 1 map, 2 trigger, 3 group, 4 image"
        string hostid FK "elements[0], host elements only"
    }
    ZBX_MAP_LINK["ZBX_MAP_LINK · sysmaps_links"] {
        string linkid PK
        string selementid1 FK
        string selementid2 FK
        string color "hex without the #"
    }
    MAP_ELEMENT {
        string selementid PK
        string labelText "HOSTNAME and HOST.IP macros resolved"
        string hostid FK "host elements only"
        string hostName
        number problems "open problems on that host"
        number maxSeverity "worst of them, -1 when clear"
    }
    ZBX_EVENT["ZBX_EVENT · problem, events"]
    ZBX_HOST["ZBX_HOST · hosts"]

    ZBX_MAP              ||--o{ ZBX_MAP_SELEMENT     : "selectSelements"
    ZBX_MAP              ||--o{ ZBX_MAP_LINK         : "selectLinks"
    ZBX_MAP_LINK         }o--|| ZBX_MAP_SELEMENT     : "selementid1 and selementid2"
    ZBX_MAP_SELEMENT     ||--|| MAP_ELEMENT          : "derives: labels resolved, host status attached"

    ZBX_HOST             |o--o{ ZBX_MAP_SELEMENT     : "elements[0].hostid, host elements only"
    ZBX_EVENT            }o--o{ MAP_ELEMENT          : "derives: open problems and worst severity per host"

    classDef zbx      fill:#dbeafe,stroke:#2563eb,color:#14213d
    classDef derived  fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef local    fill:#fef3c7,stroke:#d97706,color:#451a03
    classDef external fill:#f1f5f9,stroke:#94a3b8,color:#475569
    class ZBX_MAP,ZBX_MAP_SELEMENT,ZBX_MAP_LINK zbx
    class MAP_ELEMENT derived
    class ZBX_EVENT,ZBX_HOST external
```

*Grey, no attributes:* `ZBX_EVENT`, `ZBX_HOST`. Detailed in [Events & Incidents](#events--incidents), [Hosts & Inventory](#hosts--inventory).

---

## Admin & system

Neither read from Zabbix nor derived from it. Portal authentication is entirely local: Zabbix users are never read, although every Zabbix call the portal makes runs as the user that owns its API token; see [API token & permissions](../database/ERD-Database.md#api-token--permissions).

```mermaid
---
config:
  layout: elk
---
erDiagram
    direction TB
    PORTAL_USER {
        string name PK "parsed from PORTAL_USERS, name:password:role"
        string pass "plain text or scrypt hash"
        string role "viewer, wall, operator or admin"
    }
    STATS {
        number hosts
        number items
        number triggers
        number groups
        number problems
        number unacknowledged
        string bySeverity "counts keyed 0 to 5"
    }

    classDef zbx      fill:#dbeafe,stroke:#2563eb,color:#14213d
    classDef derived  fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef local    fill:#fef3c7,stroke:#d97706,color:#451a03
    classDef external fill:#f1f5f9,stroke:#94a3b8,color:#475569
    class STATS derived
    class PORTAL_USER local
```

---
