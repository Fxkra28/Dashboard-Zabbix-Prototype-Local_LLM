# 15. Services tree

[setup.md](../../setup.md) · previous: [§14](14-site-view.md) · next: [§16](16-inventory-ownership-scorecard.md)

Implements `plan_1.2.md` (in `myown/documents/plan/`, outside this repo) Phase 2, serving HCML Goal 2: the review's
*stated core problem*:

> Monitoring is still device-centric and reactive; the target is service-centric and proactive.

Every other page in this portal answers *"which host is broken?"*. This one answers *"which
service is degraded, and why?"*, so a failure reads as "BD FPSO, Voice path is degraded,
because the agent on FGR-60F-DELTA-01 stopped reporting" rather than a bare host alert.

## Zabbix does the roll-up; the portal makes it legible

Zabbix already computes service status and attributes the causing problems. `service.get` gives:

| Field | Meaning |
|---|---|
| `status` | `-1` = OK, otherwise the severity that propagated up from below |
| `problem_events` | the problems Zabbix blames for that status (snake_case in the response) |
| `algorithm` | `0` set to OK · `1` most critical if all children have problems · `2` most critical of children |
| `parents` / `children` | the hierarchy |

[`services/services.ts`](../../server/src/services/services.ts) assembles roots (services with no parents),
recurses, and attaches each service's SLA, `sla.get` + `sla.getsli`, so target and achieved sit on
the same row as the status.

## Services are a DAG, not a tree

A shared dependency legitimately sits under two parents (in the demo data of September, since deleted, *Shared SD-WAN core*
hangs off both Offshore and Onshore). Two consequences the code handles explicitly:

- Recursion is path-guarded and depth-capped (`MAX_DEPTH`), so a malformed hierarchy can't hang
  the request.
- `descendants` counts distinct service ids, not tree positions. Summing `1 + child.descendants`
  double-counts a shared node: the root reported *6 services below* when only 5 existed.

That shared node is also the clearest demonstration of the whole feature: when it degrades, *both*
branches degrade with it. That is a dependency, which is exactly what device-centric monitoring
cannot show.

## On the page

Degraded branches are expanded by default and healthy ones folded away: a NOC wall should open
on what's broken. Each row carries a status dot in the Zabbix severity colour, an OK/severity badge,
the distinct count below it, and (when measured) an SLA chip reading `achieved% / target%`, green
when meeting. Leaves list their root causes beneath them, prefixed *"because …"*; parents don't
repeat what their children already say. Where a service has an SLA, the
[plain-language layer](13-plain-language-layer.md#13-plain-language-layer-ai) is one click away: scoped to that service, so
the explanation talks about *that* path and no other.

## Trying it

```bash
curl localhost:4000/api/services | jq '{total, degraded, worst}'
```
