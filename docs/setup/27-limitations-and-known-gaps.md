# 27. Limitations and known gaps

[setup.md](../../setup.md) · previous: [§26](26-reachability-caching-and-operations.md) · next: [§28](28-glossary.md)

*Reconstructed 22 September 2026. A section like this existed in `DOCUMENTATION.md`, which was
deleted on 21 September and was never under version control, so this is rebuilt from the surviving
audit findings, plan documents and logs rather than restored. Where the original said something this
does not, that is lost.*

Be suspicious of a system that documents no limitations. Everything below is known and accepted,
not discovered by a reader.

## What the portal cannot do, by design

| | |
|---|---|
| **It cannot collect anything** | Zabbix polls; the portal reads items. If Zabbix does not collect it, no portal feature can invent it |
| **It cannot change monitoring** | One write exists, `event.acknowledge`. No host, item, trigger or template can be created, edited or deleted. See [ADR-0006](../architecture/adr/0006-read-only-with-one-write.md) |
| **It remembers almost nothing** | Every derived value dies on restart. The portal keeps no audit trail of its own (who acknowledged what is in the text Zabbix stores, `[portal:<user>]`, and in the BFF's log), no saved views, no user table. The one thing it keeps is a small state file in the hosted copy: the saved report recipients, the monthly schedule and the last 24 sends ([ADR-0003](../architecture/adr/0003-no-database.md), amended; [ADR-0015](../architecture/adr/0015-keep-a-small-state-file-for-recipients-and-the-schedule.md)) |
| **It cannot see past Zabbix's retention** | 31 days of raw history, 365 days of trends and events. A two-year question has no answer through this API |

## Goals only partly met

- Goal 3, telecom deep visibility: the WAN and radio-link half is built (§17). SIP trunk and
  UHF/VHF radio monitoring is not, and cannot be: HCML's Zabbix does not collect that data. This is
  a Zabbix-side prerequisite for the engineering team, decided out of scope on 2026-09-07.
- Goal 5, role-based dashboards: the site view and RBAC are built. Role-scoped landing pages
  are not, because they need HCML to define what each role should see first.
- Goal 4: the alert-noise report and the plain-language layer are built. Cross-trigger
  correlation is not.
- Goal 6: availability, capacity, aging and top-triggers are built, and so is an on-demand PDF
  and Excel download, and a zip of CSV files, of the monthly SLA report, which an administrator can also email to people they choose, and have sent by itself every month (§18).

## Security, still open

- A password can still be plain text in `.env` (an scrypt hash is accepted since 7 October 2026, SC-22)
  and users come from environment variables, so adding one needs a restart. The audit items on this,
  BE-12 to BE-17, are closed.
- `server/.env` has held a random `JWT_SECRET` of its own since 13 October 2026 (DOC-11, SC-04), where
  it held the placeholder the BFF is designed to refuse. It still runs with `AUTH_ENABLED=false` for local
  development. The sign-in path itself has been exercised against a local BFF started with a test secret
  (ADR-0009, ADR-0010).
- Each running portal has a `JWT_SECRET` of its own since 13 October 2026 (SC-14). A token also names its
  portal (the issuer and audience come from the cookie name), so one minted by :8081 is refused on :8082
  either way; a secret for each copy means a leak of one cannot forge a session on the other.
- `hcml-portal-ollama` is not under version control at all. Everything in it exists in one place
  on one disk. B1.
- The Anthropic API key was flagged for rotation on 10 September. The key the running hosted portal
  holds was refused by Anthropic on 16 October (401, `invalid x-api-key`), so it no longer works and
  Explain and the Assistant of that portal answer nothing until a valid one is in `.env`. FE-02, SC-01.

## Measurement and performance

- The assistant's snapshot is always truncated. It is capped at 20 problems and a per-section
  character budget against roughly 660 open problems, so `truncated` is effectively always true.
  BE-22.
- Heavy reports are slow, and the reason is now measured. A 365-day capacity report costs ~112
  Zabbix calls and 10,771 SQL statements upstream, because each JSON-RPC call carries about 20
  statements of fixed frontend overhead. [ADR-0007](../architecture/adr/0007-keep-the-zabbix-api.md).
- `stats.zabbixCalls` under-reports. Sliced `event.get` recursion is counted once, so the true
  figure is higher whenever a window exceeds 5,000 events.
- Nobody has measured the cache hit rate. The 24-hour SLA TTL is a ceiling, not a floor, for the month in progress: with a
  500-entry LRU and parameterised keys, ordinary browsing can evict a fresh report in minutes. A closed month is pinned and stays. How
  often the expensive path actually runs is unknown, and it is the number that decides whether any of
  the performance work matters.
- Every performance figure in this project is single-user and single-shot. There is no p95 and no
  concurrency data anywhere.
- The SLA report files were checked on test data. The August workbook was opened in Microsoft Excel on
  26 October 2026 with no repair prompt and read page by page. Both files were also downloaded from the
  running portal, on 12 October (size, pages and sheets read), on 15 October (a 200 in the BFF log) and,
  for October's workbook, on 27 October. What Excel shows for a download from the live portal itself has
  not been seen. §18 lists what each was checked with.

## Data and correctness

- Since 29 October 2026 the portals read HCML's own Zabbix and the figures are current. Until then they read a copy frozen at
  17 September 2026 16:59:37 ([ADR-0008](../architecture/adr/0008-stop-local-polling.md)). The biggest reads are slow on HCML's Zabbix:
  [what waits, and for how long](../operations/after-a-restart.md).
- 42 of the 135 monitored ICMP items have no trend data at all: they are address-less
  placeholders. Availability figures cover the 93 that do.
- Hourly averages are integer-truncated for unsigned items by Zabbix itself, in `trends_uint`.
  Nothing downstream can recover the precision.
- `web/src/types/` is a hand-maintained mirror of the server's types, and in six places it is
  looser than the server. Since 19 October a test holds it to `docs/api/openapi.yaml` in one
  direction (FR-16: the app may not ask more of an answer than the file promises), and the file was
  corrected against the server's own types and tried on 40 real answers. Nothing compares the file's
  schemas with what the server sends, and nothing checks the six places. The server is authoritative.

## Documentation

- The diagrams cannot be regenerated from anything. A conceptual model is a judgement, so nothing
  will ever flag it as stale. `erd/conceptual/ERD-Conceptual.md` ends with the list of code changes
  that oblige a change to it; that list is the only guard.
- The glossary and this section were lost and rebuilt, not restored. See §28.
