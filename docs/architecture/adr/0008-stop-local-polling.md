# Stop local polling, and put `zabbix-server` behind a compose profile

* Status: accepted
* Deciders: HCML internship project
* Date: 2026-09-17, amended 2026-09-22

## Context and Problem Statement

To develop against realistic data, HCML's production Zabbix database was restored onto a laptop on
15 September. The restored stack includes `zabbix-server`, and a Zabbix server does not just serve
data, it polls. From 15 to 17 September this laptop was polling 95 of HCML's real production
devices over the corporate network, in parallel with HCML's own Zabbix doing the same.

## Decision Drivers

* A development laptop must not be a second monitoring system aimed at production equipment.
* The restored data must not be deleted by housekeeping.
* No alert may reach a real HCML recipient from a development copy.
* The safe configuration must be the default, not something remembered.

## Considered Options

* Keep polling, so the data stays current.
* Stop `zabbix-server`, keeping MySQL and the frontend on the stored data.
* Delete the restored data entirely.

## Decision Outcome

Chosen: **stop `zabbix-server`, keep the data.** Stopped 17 September at 16:59:37, cleanly, it
flushed its trends and exited 0.

**Amended 22 September**, after finding that the safe path was one forgotten flag away from the unsafe
one. `zabbix-web` declared `depends_on: zabbix-server`, so `docker compose up -d`, or even
`up -d zabbix-web`, started the poller. The documented safe form was `--no-deps mysql zabbix-web`,
i.e. the non-default.

That is now inverted. `zabbix-server` sits behind `profiles: ["poller"]`, so a plain
`docker compose up -d` brings up MySQL and the frontend only, and polling requires
`docker compose --profile poller up -d`. Verified: `docker compose config --services` returns
`mysql` and `zabbix-web` and nothing else.

### Positive Consequences

* **HCML's production devices are no longer polled from this laptop.** Settles audit item BE-24.
* Housekeeping cannot run, because housekeeping is a `zabbix-server` function. The 2.22 years of
  restored trends are safe from the `hk_trends='365d'` policy that is armed in the data.
* No alert can be sent, for the same reason: alerting is also `zabbix-server`'s job. Three
  independent layers now: no server process, all 7 actions disabled, all 43 media types disabled.
* MySQL write volume fell to 0 MB in a 60-second sample, from 1.50 MB/s before tuning.
* The dataset is frozen, which makes every benchmark repeatable: [ADR-0007](0007-keep-the-zabbix-api.md)
  depends on that.
* The dangerous action is now explicit and named. `--profile poller` is hard to type by accident.

### Negative Consequences

* **The data is frozen at 17 September 16:59:37 and will never advance.** Every figure the portal
  shows is a snapshot of that moment. Anyone demoing it has to say so.
* Ping-based host states show as stale roughly ten minutes after any restart, which looks like a bug
  and is not.
* A fresh restore of `myown/zabbix_backup.sql` is armed: the dump carries actions 3, 7 and 9 at
  `status=0`, meaning *enabled*, including "Send Alert to Power Automate". The disabled state lives
  only inside the restored volume. **Anyone restoring that dump must disable actions and media types
  before `zabbix-server` ever touches it.**
* The compose file is now the only place this decision is encoded, and `Proto1` is not a git
  repository, so the profile change has no history behind it.

## Pros and Cons of the Options

### Keep polling

* Good, because the data stays live and demos show real current state.
* Bad, because a laptop is polling production equipment with no mandate, no change control, and no
  one expecting the traffic.
* Bad, because the restored history would be deleted by housekeeping within the hour unless suppressed.

### Stop the server, keep the data

* Good, because the whole estate's stored history stays usable for development.
* Bad, because the data is a fixed snapshot from then on.

### Delete the restored data

* Good, because it removes a copy of production data from a laptop.
* Bad, because it destroys the only dataset that makes the derived SLA verifiable against HCML's
  published reports, and that validation is the project's strongest correctness claim.

## Links

* Enables [ADR-0007](0007-keep-the-zabbix-api.md), which needs a frozen dataset to measure against
* `myown/documents/log/09-17-26-zabbix-stack.md` §5.3: the original decision
* `myown/documents/log/09-22-26.md`: the `depends_on` finding and the profile change
* `Proto1/docker-compose.yml`: the `poller` profile
