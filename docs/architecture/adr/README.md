# Architecture Decision Records

One file per decision, in [MADR](https://adr.github.io/madr/) format. Numbered sequentially and never
renumbered. A superseded ADR is kept and marked, not deleted: the reasoning is the point, and a
decision you cannot see being reversed is a decision nobody can learn from.

These replace `Proto1/DECISION.md`, a single large document that accumulated every decision, drifted,
and was deleted on 22 September 2026. One file per decision does not rot as a unit.

## Index

| # | Decision | Status | Date |
|---|---|---|---|
| [0001](0001-bff-over-zabbix-api.md) | Build a read-only BFF over the Zabbix API rather than modifying Zabbix | accepted | 2026-09-07 |
| [0002](0002-react-typescript-fastify.md) | React + TypeScript + Vite on the front, Fastify + TypeScript on the back | accepted | 2026-09-04 |
| [0003](0003-no-database.md) | The portal owns no database: derive per request, cache in memory | accepted | 2026-09-07 |
| [0004](0004-derive-the-sla-in-the-portal.md) | Compute the monthly SLA in the portal instead of using Zabbix Services and SLA | accepted | 2026-09-15 |
| [0005](0005-provider-neutral-ai-layer.md) | A provider-neutral plain-language layer, and two repositories over one source tree | accepted | 2026-09-18 |
| [0006](0006-read-only-with-one-write.md) | Read-only by default, with exactly one write behind a separate token | accepted | 2026-09-10 |
| [0007](0007-keep-the-zabbix-api.md) | Keep the Zabbix API as the source of truth; do not mirror its telemetry | accepted | 2026-09-22 |
| [0008](0008-stop-local-polling.md) | Stop local polling, and put `zabbix-server` behind a compose profile | accepted | 2026-09-17 |
| [0009](0009-renew-an-open-portals-sign-in.md) | Renew an open portal's sign-in, for every user | accepted, amended by 0010 and on 2026-10-12 | 2026-09-25 |
| [0010](0010-session-cookie.md) | Keep the sign-in token in an httpOnly session cookie | accepted | 2026-09-25 |
| [0011](0011-build-the-sla-report-files-in-the-bff.md) | Build the SLA report files in the BFF, with hand-written PDF and Excel writers instead of a library | accepted | 2026-10-02 |
| [0012](0012-internet-meters-from-the-zabbix-dashboard.md) | Draw the internet traffic meters from the gauge widgets of the Zabbix dashboard HCML already keeps | accepted | 2026-10-14 |
| [0013](0013-layers-features-and-tools.md) | Group the server by layer, the web by feature, and keep the repository's checks in one place | accepted | 2026-10-16 |
| [0014](0014-email-the-sla-report-through-smtp.md) | Email the SLA report through SMTP, when an administrator asks, and keep it off until it is set up | accepted, amended by 0015 | 2026-11-04 |
| [0015](0015-keep-a-small-state-file-for-recipients-and-the-schedule.md) | Keep a small state file on a volume for the report's recipients, its schedule and what was sent | accepted, amended by 0016 | 2026-11-04 |
| [0016](0016-keep-the-web-check-figures-of-closed-months.md) | Keep the web check figures of a closed month as they were when it was first read | accepted | 2026-11-16 |
| [0017](0017-keep-the-portals-users-in-a-file-of-their-own.md) | Keep the portal's users in a file of their own, with a role and a list of modules for each | accepted | 2026-11-17 |
| [0018](0018-evaluate-any-sla-window-from-the-months-read-once.md) | Read each month of Zabbix once, and evaluate any SLA window from what was read | accepted | 2026-11-17 |
| [0019](0019-let-the-portal-read-what-a-question-needs.md) | Let the portal read what a question needs, and keep the model without tools | accepted | 2026-11-18 |

## How they relate

```
0001  BFF over the API
 ├── 0002  the stack
 │    └── 0013  routes call services, the web is grouped by feature, one place for the checks
 ├── 0003  no database ──────────── confirmed for telemetry by 0007
 │    └── 0004  derive the SLA
 │         └── 0011  the SLA report as a file, built per request and stored nowhere
 │              └── 0014  the same file by email, on request
│                   └── 0015  a small state file: the recipients, the monthly schedule, what was sent
│                        └── 0016  a second file beside it: the web check figures of closed months
 ├── 0006  read-only, one write
 │    └── 0012  the internet meters read HCML's own Zabbix dashboard, and store nothing
 └── 0005  provider-neutral AI
      └── 0019  the portal reads what a question needs, and the model keeps no tools

0008  stop polling ──── freezes the dataset 0007 measures against

0009  renew an open portal's sign-in ──── a disabled user cannot renew, per 0017
 └── 0010  the token in an httpOnly cookie ──── still no session store, per 0003

0017  the users in a file of their own ──── amends 0003, 0015 and 0016

0018  any SLA window from the months read once ──── amends 0004
```

## Writing a new one

Copy the [MADR template](https://github.com/adr/madr/blob/main/template/adr-template.md), take the
next number, and add a row above.

Write one for: a technology choice, an architecture pattern, anything with a real trade-off,
anything where the next maintainer would otherwise ask "why on earth is it like this?".

Do not write one for: naming, formatting, anything reversible in an afternoon, or an
implementation detail that belongs in a code comment.

Two house rules, both learned here:

- **Every ADR needs real negative consequences.** One with only upsides is a press release, and every
  decision in this project cost something. If you cannot name the cost, you have not finished thinking.
- **Cite the measurement, not the intuition.** [ADR-0007](0007-keep-the-zabbix-api.md) exists because a
  prediction was written down and a five-minute measurement refuted it. Predictions that are
  never checked become facts by repetition.
