# Keep the web check figures of a closed month as they were when it was first read

* Status: accepted
* Deciders: HCML internship project; the owner chose this on 16 November 2026, when asked whether a closed month's web check answers should be kept as they were, and so lifted for this one file the rule of 29 October that nothing of HCML's is kept on disk
* Date: 2026-11-16
* Amended: 2026-11-17, by [ADR-0017](0017-keep-the-portals-users-in-a-file-of-their-own.md): the rule that a file on the state volume holds nothing that identifies a person or a secret is kept for this file, and not for the third file beside it that holds the users
* Amends: [ADR-0003](0003-no-database.md) and [ADR-0015](0015-keep-a-small-state-file-for-recipients-and-the-schedule.md), which say that the state holds no figure from Zabbix, and [ADR-0004](0004-derive-the-sla-in-the-portal.md), where a closed month was derived afresh every time

## Context and Problem Statement

The web check figures of a month that has closed change after it has closed. Two things do it. The engine counts an hour in which a check both passed and failed only while its raw readings are under 31 days old, so a month's figures move for about a month after it closes. And HCML's Zabbix most likely deletes old trend rows as they pass its retention, and the report reads the trends from there. On 12 November the August report's seven web checks each lost two hours of coverage between two fetches 36 minutes apart, and one went from partial to no data (tracker BK-60). A month that has been reported can read differently later, in the page, in the PDF, in the workbook and in the monthly mail.

On 14 November the page and the reports were made to say so in a sentence. The question left was whether to keep the figures as they were. [ADR-0007](0007-keep-the-zabbix-api.md) had weighed a file of closed months (1,668 rows a year, about 326 KiB) and not taken it. The portal would then store something it derives, and the owner had said on 29 October that nothing of HCML's should be kept on disk, only in memory. A copy kept in memory would be lost at every rebuild and so would keep nothing.

## Decision Drivers

* A figure that was reported must not quietly become another figure.
* Keep as little as possible: only what ages, only what is derived, nothing that identifies a person or a secret.
* A fault in the file must never stop the portal from reporting.
* The hosts' figures must still move when a maintenance period is corrected, since that is a correction and is meant to show.
* A rollback to an older image must not misread what a newer one wrote.

## Considered Options

* Keep only the web check figures of each closed month, in a file of their own beside the portal's state.
* Keep the whole report of each closed month.
* Keep them in memory only.
* Keep the sentence and nothing else (the state since 14 November).
* Read the retention of the web items from HCML's Zabbix and refuse to report a month whose readings have aged out.

## Decision Outcome

Chosen: **a second small file, `closed-months.json`, in `PORTAL_STATE_DIR` (`/data`, the volume `portal-state`), holding the web check figures of each month that has closed, as the portal first read them.**

* **What it holds.** For each month, as `YYYY-MM`: when the figures were taken, and for each web scenario its item id, its name, its figure, its downtime, its coverage and its data status. At most 36 months, the newest. No host, no site, no address, no user, no password, no report.
* **Which months, and which method.** A month that has closed and settled (ten minutes after its end, as the monthly send waits), under the strict method, which is the only one that has web checks. A month still running or only just ended is never kept, and neither is a rolling window.
* **When it is taken.** At the first read of the month after it has settled, by whoever asks. And once an hour a check reads the month that has just closed, so that the figures kept are those of the day it closed and not of whoever opens the page first. The first check follows two minutes after start-up. A month that closed before this decision is kept from its first read afterwards, and says when that was.
* **What a later read gives.** The kept figures, with the time they were taken, whatever the engine and Zabbix now say. Everything else in the report is computed afresh as before, so the hosts' figures still follow a corrected maintenance period.
* **What the page and the files say.** "The web check figures of this month are those taken on 2 November 2026, and kept as they were. Readings that had aged out by then are not counted." instead of the sentence that they can change. The report carries the time in `webTakenAt`, in unix seconds, in `/api/sli`.
* **A file of its own, not a part of `portal-state.json`.** The state file says in its header that it never holds a figure from Zabbix, and an older image that read a newer state file might take it for a file to put aside, and with it the recipients and the schedule. The new file is one an older image does not know and so does not touch.
* **How it is written and read.** As the state is: the whole file to a temporary file in the same folder, synced, then renamed into place, mode 0600, one change at a time. At start a file that cannot be read, or is of another version, is put aside as `closed-months.json.broken-<time>`, never deleted, and the portal starts empty and says so. A month that is wrong is dropped and the rest are kept.
* **Without a folder, or with one that takes no writes.** Nothing is kept, the page keeps its older sentence, and the log says so once. Figures kept only in memory would not outlive a restart, so they are not kept at all. A write that fails leaves the report as it came and is tried again at the next read.
* **Both copies.** `hcml-portal-ollama` reports the same months, so it mounts the volume `portal-state` at `/data` as well. It first held only this file there; since 16 November (FR-56) it keeps its saved list and schedule in it too.

### Positive Consequences

* A figure that was reported stays the figure. The page, the PDF, the workbook, the CSV and the monthly mail of one month agree with each other and with last week's.
* It is a few kilobytes a year, plain JSON a person can read, copy to another machine or delete to start again.
* The hosts' figures are untouched, so a corrected maintenance period still corrects them.
* An older image ignores the file, so going back and forward again loses nothing.

### Negative Consequences

* **The portal keeps a derived figure of HCML's on disk,** which [ADR-0003](0003-no-database.md), [ADR-0015](0015-keep-a-small-state-file-for-recipients-and-the-schedule.md) and the owner's rule of 29 October said it would not. What is kept is a few scenario names and percentages, not a copy of any table of HCML's, and the owner has chosen it. A reader who wants the rule whole can delete the file and set no `PORTAL_STATE_DIR`.
* **A month first read late is kept late.** One that closed long before this decision, or whose first read came days after it closed, is kept as it reads then, with the day that was, and the readings that had aged out by then are not in it. The sentence says so.
* **A bad first figure stays.** If the first read comes while Zabbix is failing to collect, the month is kept with those figures. Deleting the file, or its entry, takes them again from Zabbix.
* **A second thing to back up,** which is also a second thing that can be lost: losing it loses nothing that cannot be taken again, only the claim that the figure is the old one.
* **The local-model copy gains a volume,** and so a name in `docker volume ls` and a folder that the container writes to.

## Pros and Cons of the Options

### Only the web check figures, in a file of their own

* Good, because it is what ages, and the least that fixes it.
* Good, because the hosts' own figures keep following corrections.
* Bad, because it is a second file and a second thing to back up.

### The whole report of each closed month

* Good, because every figure of a month would be fixed, as it was.
* Bad, because the hosts' figures are meant to move when a maintenance period is edited, so keeping them would freeze a mistake. Also about 326 KiB a year of HCML's host names, which is more of HCML's data on disk than the problem asks for.

### In memory only

* Good, because nothing is written, which was the owner's rule.
* Bad, because a rebuild or a restart would lose it, and the figure would change again at the next read, which is the fault.

### The sentence only

* Good, because it changes no design.
* Bad, because the figure still changes, and the sentence only says that it may.

### Read the retention and refuse

* Good, because it would not give a figure that is wrong.
* Bad, because it needs HCML's network and rights this portal does not have, and it leaves a month with no answer for the one that read well last week.

## Links

* [`docs/operations/backup-and-restore.md`](../../operations/backup-and-restore.md)
* [`docs/api/openapi.yaml`](../../api/openapi.yaml): `webTakenAt` of `SliReport`
* [`docs/handover/3-integrations/reports-exports.md`](../../handover/3-integrations/reports-exports.md)
* `server/src/services/closedWebStore.ts`, `server/src/services/closedWeb.ts`
