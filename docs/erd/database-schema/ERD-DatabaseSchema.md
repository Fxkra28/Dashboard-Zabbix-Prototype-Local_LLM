# Database schema map: HCML Monitoring Portal

How the two ERDs connect. [`ERD-Mermaid.mmd`](../vanilla/ERD-Mermaid.mmd), explained in [`erd.md`](../erd.md) and [`ERD-Domains.md`](../vanilla/ERD-Domains.md), is the portal's model: the objects it reads through the Zabbix API and the ones it derives from them. [`ERD-Database.mmd`](../database/ERD-Database.mmd), explained in [`ERD-Database.md`](../database/ERD-Database.md), is the 45 MySQL tables underneath. This page maps one onto the other.

Only the 19 blue `ZBX_*` entities have tables. The green and amber ones (`SITE`, `LINK`, `INCIDENT`, `MAP_ELEMENT`, `PORTAL_USER` and the rest) are computed or configured by the portal, and no table holds them. The Zabbix source lines behind each row are cited in [`ERD-Database.md`](../database/ERD-Database.md). One level up, the conceptual model (what the business talks about, with no keys or types) is [`ERD-Conceptual.md`](../conceptual/ERD-Conceptual.md); the index of all three levels is in [`erd.md`](../erd.md#the-three-levels).

The same map as a diagram is [`ERD-DatabaseSchema.mmd`](ERD-DatabaseSchema.mmd), pre-rendered as [`ERD-DatabaseSchema.pdf`](ERD-DatabaseSchema.pdf) (vector, the one to read) and [`ERD-DatabaseSchema.png`](ERD-DatabaseSchema.png): one frame per domain of `ERD-Mermaid.mmd`, with each entity to the left of the tables it uses.

Reading it: a solid line means the entity's rows or fields are read from that table · a dashed line means the API only walks through the table, or computes a field from it · rounded boxes are entities, in the logical ERD's blue · cylinders are tables, each keeping its colour from `ERD-Database.mmd`: blue when its rows reach the portal, grey when they stay inside Zabbix · a table sits in the frame of the entity that reads it, so the only lines between frames are the three dashed ones to tables another domain reads: `ZBX_TRIGGER` → `items`, `ZBX_EVENT` → `items` and `ZBX_SERVICE` → `events`.

> This page is shared by both portals, byte for byte. They run one source tree and read the same
> tables; the running portals differ only in `.env`, the compose file and the published port.

---

## Entity → tables

| Entity in `ERD-Mermaid.mmd` | Read from | Walked or computed from | How the API gets there |
|---|---|---|---|
| `ZBX_HOST` | `hosts` |  | Only plain and discovered hosts come back: templates (`status` 3) and host prototypes (`flags` 2) share the table |
| `ZBX_HOST_INTERFACE` | `interface` |  | `selectInterfaces`, through `interface.hostid` |
| `ZBX_HOST_INVENTORY` | `host_inventory` |  | `selectInventory`; one row per host, none at all when inventory is disabled, which the API returns as `[]` |
| `ZBX_HOST_TAG` | `host_tag` |  | `selectTags` |
| `ZBX_HOST_GROUP` | `hstgrp` | `hosts_groups` | `selectHostGroups` goes through the `hosts_groups` link table; `hostgroup.get` returns only `type` 0, because template groups share `hstgrp` |
| `ZBX_ITEM` | `items`, `item_rtdata` | `history`, `history_str`, `history_log`, `history_uint`, `history_text` | `state` comes from `item_rtdata`; `lastvalue`, `lastclock` and `prevvalue` are computed from the item's history table, not stored |
| `ZBX_ITEM_TAG` | `item_tag` |  | `selectTags` |
| `ZBX_HISTORY` | `history`, `history_str`, `history_log`, `history_uint`, `history_text` |  | One table per `value_type`; `itemid` has no foreign key. `history_bin` exists but is never read |
| `ZBX_TREND` | `trends`, `trends_uint` |  | Float items in `trends`, unsigned ones in `trends_uint`; no foreign key |
| `ZBX_TRIGGER` | `triggers` | `functions`, `items` | `triggers` has no host column, so `selectHosts` walks `functions` → `items` → `hosts` |
| `ZBX_EVENT` | `problem`, `events`, `event_recovery` | `triggers`, `functions`, `items` | `problem.get` reads `problem`; `event.get` reads `events`, with `r_eventid` from `event_recovery`, and walks `functions` → `items` for `selectHosts`. `opdata` is resolved from `triggers`; `suppressed` comes from `event_suppress`, which is not in the database diagram; `objectid` has no foreign key |
| `ZBX_EVENT_TAG` | `problem_tag` |  | Only `problem.get` asks for tags, so `event_tag` is never read |
| `ZBX_SERVICE` | `services`, `services_links`, `service_problem` | `events` | Parents and children from `services_links`; root-cause problems from `service_problem`, their names from a second `event.get` |
| `ZBX_SERVICE_TAG` | `service_tag` |  | `selectTags` |
| `ZBX_SLA` | `sla` |  | Only the SLA's own columns are requested |
| `ZBX_SLI` | none | `sla`, `sla_schedule`, `sla_excluded_downtime`, `sla_service_tag`, `service_tag`, `services`, `service_alarms` | No table stores it: `sla.getsli` finds the SLA's services by matching `sla_service_tag` against `service_tag`, replays their status history from `service_alarms`, and computes every value on the call |
| `ZBX_MAP` | `sysmaps` |  | `map.get` |
| `ZBX_MAP_SELEMENT` | `sysmaps_elements` |  | `hostid` is `elementid` when `elementtype` is 0, with no foreign key; trigger elements live in `sysmap_element_trigger`, which is not in the database diagram |
| `ZBX_MAP_LINK` | `sysmaps_links` |  | `selementid1` and `selementid2` are real foreign keys |

That is 28 solid lines, one for each blue table in `ERD-Database.mmd`, and 19 dashed ones, which bring in the grey tables the API walks through or computes from. `erd.md`'s walk-through diagram uses the same entity names without the `ZBX_` prefix, with `ZBX_EVENT` split into `PROBLEM` and `EVENT`.

---

## The other 11 tables

The rest of `ERD-Database.mmd` backs no entity, so the diagram leaves them out and shows 34 of the 45 tables:

| Why they are in the database diagram | Tables |
|---|---|
| The portal's one write, `event.acknowledge` | `acknowledges`, `task`, `task_close_problem`, `task_acknowledge` |
| A rule the Zabbix server applies to attach problems to services | `service_problem_tag` |
| Authorising every API call | `token`, `users`, `role`, `users_groups`, `usrgrp`, `rights` |

---

## Regenerating

After editing the `.mmd`:

```bash
npx @mermaid-js/mermaid-cli -i ERD-DatabaseSchema.mmd -o ERD-DatabaseSchema.pdf -w 2600 -b white --pdfFit
npx @mermaid-js/mermaid-cli -i ERD-DatabaseSchema.mmd -o ERD-DatabaseSchema.png -w 2600 -s 2 -b white
```

Then run `node tools/check/diagrams.stamp.mjs` from the repo root. It records which source each render was made from, and CI fails on a source edited after its stamp (`tools/check/diagrams.check.mjs`).

The frontmatter selects ELK, as in the other ERDs; keep it, and keep every `style … fill:none` line. Measured with the same crossing script as the other diagrams, adapted for flowchart lines, this layout has 13 line crossings and no line through an unrelated box. Ten of those crossings cannot be avoided: `ZBX_ITEM` and `ZBX_HISTORY` both link to the same five history tables, and two boxes linked to the same five always cross ten times in a two-column drawing. Dagre gives 38 crossings and 1 line through a box. The other layouts tried were worse: separate frames for the two diagrams gave 70 crossings, only their two outer frames 124, tables framed by their `ERD-Database.mmd` domain 39, and no frames at all 24, on a strip 6.6 times taller than wide. With this layout, `NETWORK_SIMPLEX` and `LINEAR_SEGMENTS` placement both also give 13, on taller canvases; `considerModelOrder` changes nothing; `direction TB` gives 13 on a canvas 2.8 times wider than tall; and `mergeEdges: true` gives 13 too, but stays off as in the other diagrams.

Keep this page in step with the two ERDs: an entity or a table added to one of them belongs in this map too, as a row and as a line.
