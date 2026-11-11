# 17. Link & WAN health

[setup.md](../../setup.md) · previous: [§16](16-inventory-ownership-scorecard.md) · next: [§18](18-automated-reporting.md)

Implements `plan_1.2.md` (in `myown/documents/plan/`, outside this repo) Phase 5, serving HCML Goal 3 (telecom deep
visibility). HCML runs 12 main + 10 redundant SD-WAN links, 10 P2P radio links, 18 internet
accesses and Starlink offshore. Their own topology slide flags
*"SD-WAN (to_mda_via_sapudi)(internal4): High packet loss"*. That class of fault deserves a
first-class view, not a row buried in Latest data.

## What a "link" is

Zabbix has items, not links. A link here is one (host, ping target) pair, stitched back together
from the three items Zabbix collects per target:

| Item key | Gives |
|---|---|
| `icmpping[<target>]` | up / down |
| `icmppingloss[<target>]` | packet loss %, and usually the most descriptive item *name* |
| `icmppingsec[<target>,,,,,<mode>]` | RTT; `min`/`max` modes let jitter be derived |

Two details that are easy to get wrong:

- `monitored: true` is mandatory. Without it `item.get` also returns template items, and the
  page fills with hundreds of identical unassigned prototypes. (Measured: 100+ phantom ICMP keys.)
- Zabbix stores RTT in seconds; the page reports milliseconds. Jitter is `max − min`, and is
  simply absent unless the min/max mode items exist: it is never faked.

## Redundancy is the point

A main + standby pair is only *truly* down when every leg is: that distinction is why the
redundancy is paid for. Pairing comes from the item tag `link_group` (with `link_role` naming the
leg); HCML tags no item with it, so the pairs are made from the host names (`wanPairKey`). A path rolls up as: all legs up ⇒ `up`;
some up ⇒ `degraded`; none up ⇒ `degraded` if any leg is degraded, `unknown` if all are unknown, otherwise `down`.

State per link is from `LINK_LOSS_WARN` (default 2%) and `LINK_LOSS_CRIT` (default 10%):
down if the ping fails or loss ≥ crit, degraded at ≥ warn, otherwise up. Wall role or above
([§19](19-authentication-rbac.md#19-authentication--rbac)).
