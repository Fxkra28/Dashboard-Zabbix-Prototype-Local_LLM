# 3. Zabbix-native feature mapping

[setup.md](../../setup.md) · previous: [§2](02-request-lifecycle.md) · next: [§4](04-the-logics-that-match-zabbix.md)

The sidebar and pages intentionally mirror Zabbix's own Monitoring and Reports menus. Each
portal view maps to Zabbix concepts and API methods:

| Portal page (sidebar)      | Zabbix native equivalent        | BFF endpoint                      | Zabbix API methods used                     |
|----------------------------|---------------------------------|-----------------------------------|---------------------------------------------|
| Dashboard              | Monitoring → Dashboard          | `/api/stats`, `/api/reports/problems-by-group`, `/api/problems`; the Hosts view also `/api/devices`, `/api/reports/top-hosts` and `/api/reports/web-monitoring`; wall screens, operators and admins also `/api/net/meters` | `host/item/trigger/hostgroup.get` (counts), `problem.get`, `trigger.get`; for the meters `dashboard.get`, `item.get` and `history.get` |
| Problems               | Monitoring → Problems           | `/api/problems`                   | `problem.get`, `trigger.get` (host names)   |
| Sites                  | *(none: see [§14](14-site-view.md#14-site-view))* | `/api/sites`                  | `host.get` (+ tags, inventory, groups), `problem.get` |
| Hosts                  | Monitoring → Hosts              | `/api/hosts/overview`             | `host.get` (+ interface availability), `problem.get` |
| Devices                | *(none: hosts grouped by kind, §3)* | `/api/devices`                | `host.get` (+ parent templates, interface availability), `problem.get` |
| Latest data            | Monitoring → Latest data        | `/api/latest`                     | `item.get` (lastvalue/lastclock/prevvalue)  |
| Graphs                 | Monitoring → Hosts → Graphs     | `/api/graph`, `/api/items`        | `item.get`, `history.get`, `trend.get`      |
| Maps                   | Monitoring → Maps               | `/api/maps`, `/api/maps/detail`   | `map.get` (selements + links)               |
| Network                | (SNMP/ICMP hosts, §13)          | `/api/net/*`                      | `host.get`, `item.get` (icmp*, net.if.*), `history.get` (ping values) |
| Links & WAN health     | *(none: see [§17](17-link-wan-health.md#17-link--wan-health))* | `/api/links`           | `item.get` (icmpping / icmppingloss / icmppingsec), `history.get` (ping values) |
| Services               | Services                        | `/api/services`                   | `service.get` (+ children, problem events), `sla.get`, `sla.getsli` |
| SLA                    | Services → SLA                  | `/api/sla`, `/api/sla/sli`        | `sla.get`, `sla.getsli`, `service.get` |
| Availability & response | *(none: see [§18](18-automated-reporting.md#18-automated-reporting))* | `/api/reports/availability`, `/api/reports/aging` | `event.get` (problem/recovery pairs) |
| Capacity trends        | Reports → Top 100 (adjacent)    | `/api/reports/capacity`           | `item.get`, `trend.get` → `history.get` fallback |
| Alert noise            | *(none: see [§21](21-alert-noise-flapping.md#21-alert-noise--flapping))* | `/api/reports/noise`  | `event.get` (problem/recovery pairs, per trigger) |
| Top 100 triggers       | Reports → Top 100 triggers      | `/api/reports/top-triggers`       | `event.get` (aggregated by trigger)         |
| Inventory & ownership scorecard | *(none: see [§16](16-inventory-ownership-scorecard.md#16-inventory--ownership-scorecard))* | `/api/reports/inventory` | `host.get` (+ tags, inventory, groups) |

> Config is deliberately *not* re-implemented. Creating hosts/items/triggers/users stays in
> Zabbix's native UI (the "hybrid" approach). The portal is the read-only NOC view.

Six things have no Zabbix equivalent, and they're the point of the portal:

| View | Why Zabbix can't do it | HCML goal |
|---|---|---|
| "Explain" on Problems and SLA ([§13](13-plain-language-layer.md#13-plain-language-layer-ai)) | Zabbix speaks to engineers; this speaks to everyone else | Goal 4 |
| Sites board ([§14](14-site-view.md#14-site-view)) | Zabbix has no site object: it's derived | Goal 5 |
| Inventory & ownership scorecard ([§16](16-inventory-ownership-scorecard.md#16-inventory--ownership-scorecard)) | Zabbix stores the fields but never scores them | Goal 1 |
| Links & WAN health ([§17](17-link-wan-health.md#17-link--wan-health)) | Zabbix has items, not *links* with a main/standby relationship | Goal 3 |
| Availability & aging ([§18](18-automated-reporting.md#18-automated-reporting)) | Zabbix stores events; turning them into uptime is arithmetic it doesn't do | Goal 6 |
| Alert noise ([§21](21-alert-noise-flapping.md#21-alert-noise--flapping)) | Zabbix shows you every alarm; it never tells you which ones weren't worth sending | Goal 4 |
