# 14. Site view

[setup.md](../../setup.md) · previous: [§13](13-plain-language-layer.md) · next: [§15](15-services-tree.md)

Implements `plan_1.2.md` (in `myown/documents/plan/`, outside this repo) Phase 1, serving HCML Goal 5 (*"dashboards are not
tailored for NOC, engineers, and management"*). HCML's estate is organised by site: JKT HQ, SBY,
SSB, FPSO KAS3, BD-WHP, MOPU/MAC, MBH, MDA, MDK, Sapudi, Sumenep, ORF Porong, TWSB, GMS Pasuruan,
but every view before this one was a flat host list. Management reads sites, not hostnames.

## Zabbix has no "site"

There is no site object in the Zabbix API, so the BFF derives one. HCML's Goal 1 says site
mapping *isn't standardised yet*, so [`services/sites.ts`](../../server/src/services/sites.ts) refuses to
assume a convention and instead tries the most deliberate signal first:

| # | Signal | Zabbix source | Why this order |
|---|---|---|---|
| 1 | Host tag `site` | `selectTags` | Deliberate and unambiguous. Tag name is `SITE_TAG`. |
| 2 | Site code in the host name | [`naming.ts`](../../server/src/domain/naming.ts) `siteFromHostName()` | HCML's own convention: `4.3.3 FPSO ARUBA 3` is site 4, `INET : SAMPANG WAN 1` is site 3. No HCML host carries a site tag, and its host groups (`ARUBA`, `FIREWALL DEVICES HCML`) name device types, not places. The name signal places 134 of 142 hosts. |
| 3 | Host inventory | `selectInventory` → `site_city`, then `location` | Zabbix's own field for this. |
| 4 | Host group | `selectHostGroups` | Every host has one, so this always resolves. |

> **Gotcha:** Zabbix has no `site_name` inventory field: the real ones are `site_city` and
> `location`. Asking for a field that doesn't exist is silently ignored, not an error.
>
> Set `SITE_GROUP_PREFIX` (e.g. `Site/`) when site groups are named `Site/JKT HQ`; the prefix is
> stripped. Left empty, step 4 uses the host's first host group: a guess, and reported as one.

## Coverage is the Goal 1 metric

The response carries `coverage: { hosts, tag, name, inventory, group }`, and the page turns it into one
sentence: *"86% of hosts carry an explicit site; the rest are grouped by host group, which is a
guess."* The portal is read-only so it can't enforce standards, but it measures them, which is
what makes Goal 1 actionable. As HCML tags hosts, the number goes up.

## What the board shows

Sites sort worst-first (highest live severity, then most unreachable hosts, then name) so a NOC
wall leads with what needs attention. Each card carries the site's worst-severity colour stripe,
problem and unacknowledged counts, Zabbix severity chips, and down/unknown/maintenance tallies.
Selecting a card lists that site's hosts with availability, status, and per-host severity chips.

Availability is rolled up per Zabbix 7.0 semantics: availability lives on the *interface*, and the
host state is worst wins (any interface unavailable ⇒ host unavailable), matching
[`shared/lib/severity.ts`](../../web/src/shared/lib/severity.ts) `hostAvailability()`.

## Trying it

```bash
curl localhost:4000/api/sites | jq '.coverage, [.sites[] | {name, worst, problems}]'
```
