# 28. Glossary

[setup.md](../../setup.md) · previous: [§27](27-limitations-and-known-gaps.md) · next: [§29](29-hcmls-six-optimisation-goals-indexed.md)

*Reconstructed 22 September 2026. `DOCUMENTATION.md` carried a glossary; no copy survives and no
other document quotes it, so this is written from scratch against the code and the data model rather
than recovered. Terms are the ones this project uses in a specific way.*

## Zabbix's vocabulary, as this portal consumes it

| Term | What it means here |
|---|---|
| Host | A monitored thing. Note Zabbix keeps hosts *and templates* in one table discriminated by `status`, so any count must filter: 139 monitored plain hosts, 313 templates, 40 prototypes |
| Item | One metric on one host, identified by a `key_` such as `icmpping`. ~51,800 in HCML's estate |
| Trigger | An expression over items that turns a measurement into a problem |
| Event | A trigger changing state. A PROBLEM event and its later OK event bracket one outage |
| Problem | An event that is currently unresolved. ~660 open at HCML |
| History | Raw collected values. Kept 31 days by HCML's policy |
| Trend | Hourly min/avg/max per item. Kept 365 days, and the only source for anything older than a month |
| Host group | Zabbix's grouping. 23 of them; the portal uses them as the weakest of four site signals |
| Service / SLA | Zabbix 7.0's native service tree and SLA engine. Both are empty at HCML: 0 services, 1 placeholder SLA |
| Maintenance | A window in which a host's problems are suppressed |

## The portal's own vocabulary: none of these is a Zabbix entity

| Term | What it means here |
|---|---|
| Site | One of 14 HCML locations. Zabbix has no site entity, and no HCML host carries a site tag, so a site is resolved from four ranked signals: tag, host name, inventory, group |
| Site source | Which of those four signals actually resolved a given host. Reported per host, because the mix is the standardisation metric |
| Link | A WAN path, synthesised from a host's `icmpping` / `icmppingloss` / `icmppingsec` item triplet. Paired with its standby by the `link_group` item tag |
| Incident | A problem event paired with its recovery, clipped to the reporting window and merged with overlapping ones so two simultaneous problems are not double-counted |
| Host state | The portal's own reachability judgement: up, down, degraded, nodata, disabled. Ping first, interface flags only as a fallback, because on 17 Sep 16 of 23 hosts Zabbix called unavailable answered ping |
| State reason | Which signal decided the host state. Provenance, so a wrong call can be traced rather than argued about |
| Derived SLA / SLI | Monthly availability computed by replaying trigger events, because Zabbix's own engine has nothing configured |
| Profile | Which method the SLA used. `hcml-report` reproduces HCML's published figures; `availability` is the stricter one that also requires evidence data was collected |
| Coverage | The fraction of an interval in which an item actually collected data. Distinguishes "up" from "we were not looking" |
| Basis | The declared rules behind a figure, which triggers count, how gaps and no-data are treated. Present in every SLI response so two numbers can be compared honestly |
| Data status | Whether a figure rests on real measurement, partial measurement, or none |
| Device kind | One of eight kinds a host is put in from its template and its name: switches, firewalls, access points, radio repeaters, servers, WAN links, web services, other. The Devices page and the Dashboard's Hosts view count by it, and so does the SLA report |
| Meter | One gauge of the Dashboard's Internet traffic view. It is drawn from a gauge widget of HCML's own Zabbix dashboard, with the capacity and colour zones the widget gives, the item's last value (or its last row in history), the zone as a word, and whether the interface behind it is up |
| Wall | The Dashboard drawn for a screen nobody can click (`?wall=1`): it turns between its views by itself, and is drawn at the scale that fits the window. Also called wall mode |

## Project vocabulary

| Term | What it means here |
|---|---|
| BFF | Backend-for-frontend. The Fastify service; holds the Zabbix token, caches, derives, and never lets the browser talk to Zabbix |
| The derived layer | Everything the portal computes that Zabbix stores no row for. Green in every diagram |
| The two portals | `hcml-portal` (hosted model) and `hcml-portal-ollama` (local model). Byte-identical source; 22 files differ |
| Explain | The per-problem plain-language summary. One problem, cached an hour |
| The Assistant | The conversational page. Sends the whole estate snapshot, streamed, never cached |
| Stale-while-revalidate | Serving an expired cached value instantly while refreshing behind it. Allowed on the slow views (the Hosts overview, Devices, the Network and Maps pages, the internet meters, the busiest hosts, web monitoring, the SLA and the service pages), never on problem or acknowledgement state |
| Write-back | The single acknowledge/close path. Off unless `ZABBIX_WRITE_TOKEN` is set |
| Guard | A hand-written run-time check that an answer from the BFF has the shape a page relies on (`web/src/guards/`). A mismatch becomes the page's ordinary error message, not a blank page |
| Generated types | `web/src/generated/openapi.ts`, made from `docs/api/openapi.yaml` by `npm run gen:api`. A test makes the typecheck fail where the file promises less than the app's own types need |
| Layers | The server's direction of import: `index.ts`, then `routes/`, then `services/`, then the shared folders. A test fails on a file that breaks it ([ADR-0013](../architecture/adr/0013-layers-features-and-tools.md)) |
