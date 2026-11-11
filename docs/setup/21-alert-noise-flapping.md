# 21. Alert noise / flapping

[setup.md](../../setup.md) · previous: [§20](20-acknowledge-close-write-back.md) · next: [§22](22-testing.md)

Implements HCML Goal 4's other half. The review's headline is the whole reason this page exists:

> "The main issue is not the number of alarms, but the quality of information needed to act."

[§13](13-plain-language-layer.md#13-plain-language-layer-ai) answers *context*: what an alarm means. This answers the
question underneath it: which alarms weren't worth sending?

## Why Top 100 triggers isn't enough

Top 100 counts *how often* a trigger fired. That single number can't tell noise from signal.
Measured on the dev instance:

| Trigger | Fired | Median duration | Acknowledged | Reality |
|---|---|---|---|---|
| SD-WAN link flapping | 6 | 4 s | 0% | Pure noise, cleared itself before anyone could look |
| Zabbix agent unavailable | 2 | 153 638 s | 100% | A real fault, open for two days |

Ranked by count, Top 100 puts the noise first. Duration and acknowledgement are what separate
them, so this report adds both.

## The three flags

A trigger carries *flags*, not one category: it can genuinely be both flapping and ignored:

| Flag | Condition | What it tells you |
|---|---|---|
| `flapping` | ≥ `NOISE_MIN_COUNT` firings and median < `NOISE_SHORT_SECONDS` | The threshold is too tight. Retune it. |
| `unactioned` | ≥ `NOISE_MIN_COUNT` firings and ack rate 0 | The team has learned to ignore it: the strongest retune signal there is. |
| `chronic` | still open and longest > 24 h | *Not* noise. One condition nobody has cleared. |

Defaults: `NOISE_SHORT_SECONDS=300`, `NOISE_MIN_COUNT=5`.

Median, not mean. One six-hour outlier would otherwise hide forty ninety-second firings: the
exact pattern the report exists to surface.

## The Pareto line

The headline for management, computed from the same data:

> 5 triggers produced 80% of all alerts in this period.

That is HCML's own sentence turned into a number, and it points at the shortest path to a quieter
NOC: retune the few at the top rather than triage the rest.

## Implementation note: one fetch, two reports

Availability (§18) and this report ask different questions of the same history. Rather than
duplicate the trickiest code in the codebase, `fetchIncidents(window, minSeverity)` in
[`services/incidents.ts`](../../server/src/services/incidents.ts) does the shared work once: fetch
PROBLEM events (and the older outages that ended inside the window, §18), batch-resolve their recoveries
via `r_eventid`, clip to the window. Each report then groups the result its own way: availability by
host (merging overlaps), noise by trigger. The `truncated` flag, which says the look for older outages
was cut short, applies to both, so neither ever presents a short count as authoritative.

## Trying it

```bash
curl "localhost:4000/api/reports/noise?days=7" | jq '.concentration, .counts'
```
