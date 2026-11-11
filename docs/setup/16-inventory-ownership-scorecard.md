# 16. Inventory & ownership scorecard

[setup.md](../../setup.md) · previous: [§15](15-services-tree.md) · next: [§17](17-link-wan-health.md)

Implements `plan_1.2.md` (in `myown/documents/plan/`, outside this repo) Phase 4, serving HCML Goal 1:

> *"Host naming, site mapping, owner, criticality and dependency are not standardised → alarms are
> hard to route to the right PIC."*

The portal is read-only, so it cannot enforce a standard. What it can do is measure one:
turning an invisible governance problem into a number that goes up as hosts get tagged. That is the
entire point of this page.

## The four scored dimensions

| Dimension | Counts as present when | Configure with |
|---|---|---|
| Naming | host name matches a regex | `HOST_NAME_PATTERN` (empty ⇒ *not scored*) |
| Site | an explicit marker exists: tag, host name or inventory | `SITE_TAG` |
| Owner / PIC | inventory `poc_1_name` / `poc_1_email`, or a tag | `OWNER_TAG` |
| Criticality | a criticality tag | `CRITICALITY_TAG` |

Site is deliberately strict. [`resolveSite()`](../../server/src/services/sites.ts) always returns
*something* (falling back to a host group), but the scorecard counts only `tag`, `name` (the host name says the site) and `inventory` as
present. Falling back to a group is exactly the ambiguity Goal 1 names, so it scores as a gap: the
scorecard and the Sites board agree on the same 86% figure for that reason.

## HCML's naming convention

Read off HCML's own Availability Reports (2026-06, -07, -08), not inferred. Two forms coexist:

```
devices    <site>.<class>[.<seq>] NAME     1.2.1 IDX02CORESWITCH    11.3.5 MOPU ARUBA 5
services   <TYPE> : NAME                   INET : SAMPANG WAN 1     SERVER : CUCM JAKARTA
```

Shipped as the value of `HOST_NAME_PATTERN` in the `.env.example` templates (the code's own default is empty, which leaves naming unscored):

```
^(\d{1,2}\.\d{1,2}(\.\d{1,2})?\.?\s|(INET|WEB|SERVER)\s:\s).+$
```

The leading digit is the site:

| # | Site | # | Site | # | Site |
|---|---|---|---|---|---|
| 1 | Jakarta (IDX) | 6 | Sumenep (SUP/STP) | 11 | MOPU / MAC |
| 2 | Surabaya (SBY) | 7 | Sapudi | 12 | Porong (POR) |
| 3 | SSB / Sampang (SAM) | 8 | MDA | 13 | Tanjung Wangi (TJWB) |
| 4 | FPSO KAS3 & BD-WHP | 9 | MBH | 14 | TWSB |
| 5 | Pasuruan / GMS | 10 | FPU | | |

The pattern is deliberately tolerant, and that is the point. HCML does not apply its own
convention consistently: site 1 numbers Cisco switches `1.2.x` while site 9 uses `9.1.1`; site 12
has both `12.1` (FortiGate) and `12.1.1` (Cisco), separated only by depth; `1.2.2.` and `2.1.`
carry stray trailing dots. The scorecard measures whether a host carries *a* recognisable
identifier, enforcing a stricter rule than HCML actually operates would score its estate against
a convention that does not exist. The inconsistency is itself the Goal 1 finding, and belongs in
the report rather than in the regex.

One real host, `INTERNET`, carries no prefix at all and correctly fails. That is a genuine gap,
not a false negative.

Site-group naming is `Site/<CODE>` via `SITE_GROUP_PREFIX`; it only applies when a host has no
`site` tag, no site in its name and no inventory location, since those are checked first (§14).

The fifth dimension HCML lists, dependency, is answered by the
[Services tree](15-services-tree.md#15-services-tree) rather than a per-host field: a host is in a dependency map when
the service hierarchy covers it. Scoring it per host would be a worse answer than the real one.

## Design notes

- A broken `HOST_NAME_PATTERN` doesn't take the endpoint down. An invalid regex is caught and the
  dimension reports `scored: false`, so a config typo degrades to "not measured", never a 500.
- Groups are sorted worst-first: that's where the standardisation work is.
- The gap list downloads as CSV, so the work can be handed to whoever owns those hosts.
- Admin-only: this is governance, not monitoring ([§19](19-authentication-rbac.md#19-authentication--rbac)).

```bash
curl localhost:4000/api/reports/inventory | jq '.overall, [.dimensions[] | {label, pct, scored}]'
```
