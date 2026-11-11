# Keep a small state file on a volume for the report's recipients, its schedule and what was sent

* Status: accepted
* Deciders: HCML internship project; the owner asked on 4 November 2026 for the report to go by itself on the first day of each month at midnight, to the people the sender chooses, and for the manual send to stay
* Date: 2026-11-04
* Amends: [ADR-0003](0003-no-database.md), the claim that the portal keeps nothing of its own, and [ADR-0014](0014-email-the-sla-report-through-smtp.md), the rule that a report goes only to the people in `MAIL_TO`

## Context and Problem Statement

[ADR-0014](0014-email-the-sla-report-through-smtp.md) let an administrator email the month's report to a fixed list set in `.env`, and left out the schedule because a schedule needs somewhere to remember what was sent. The owner then asked for three things that each need a memory:

* the people who get the report are chosen in the portal, by whoever sends it, and a list can be kept for next time;
* the report goes by itself on a day and at a time, and must not go twice, or be lost because the machine was asleep at that minute;
* when a send fails, the page, the log and the people who asked to be told say so.

[ADR-0003](0003-no-database.md) says the portal derives everything from Zabbix and keeps nothing, and its compose file declares no volume. The container's root file system is read-only. The machine that runs the portal is the owner's laptop now and HCML's server later: a laptop sleeps, restarts, and is often off HCML's network, where every read of Zabbix times out.

What is the least the portal can keep, where, and what must it refuse to keep?

## Decision Drivers

* Keep as little as possible. Nothing from Zabbix, no report, no password.
* It has to survive a restart and a rebuild, and move to HCML's server with the portal.
* A mistake in the file must not stop the portal from showing monitoring data.
* The schedule has to be provable without waiting a month.
* `hcml-portal-ollama` exists so that nothing leaves the machine. It has no mail settings, and it must not gain a place to keep a schedule it will never run.
* A stolen administrator session must not be able to send the estate anywhere without limit.

## Considered Options

* One small JSON file on a named Docker volume, read at start and written whole on each change.
* The recipients in `.env` as before, and the schedule driven from outside by the host's `cron` or `launchd` calling the BFF.
* A database (SQLite or PostgreSQL) for the three things.
* Memory only: the recipients and the schedule are lost on every restart.
* Zabbix's own reporting or an action that sends mail.
* A separate scheduler container.

## Decision Outcome

Chosen: **one JSON file, `portal-state.json`, in the folder `PORTAL_STATE_DIR`, which the hosted compose file sets to `/data`, the mount of the named volume `portal-state`.**

* **What it holds.** The saved recipients (at most ten). The schedule: on or off, the day (1 to 28), the time, the file kinds, the style, up to three people to tell when a send fails, who set it and when. A record of the last 24 sends: the month, how it was sent, how many people it reached, how large, how many tries, and a word for why it failed. **Never** an address in a record, a figure from Zabbix, a report, or a password.
* **How it is written.** The whole file to a temporary file in the same folder, synced, then renamed into place, with mode 0600, one change at a time in the order asked. A change that would leave the state unusable is refused before anything is written.
* **How it is read.** At start. A file that cannot be read is put aside as `portal-state.json.broken-<time>`, never deleted, and the portal starts empty and says so. A part that is wrong (an address that is not an address, a day of 31) is dropped with a line in the log, and the schedule with a wrong field is dropped whole rather than guessed at.
* **Without the folder.** The portal keeps the same in memory and says that it is not kept. It then refuses to save a schedule, since one that would not survive a restart must not look as if it would. `hcml-portal-ollama` declares no volume and passes no `PORTAL_STATE_DIR`.
* **The scheduler.** Inside the BFF, once a minute. A pure planner decides what is due from the clock, the schedule and the record: the report of a month goes on day D of the month after it, at the chosen time in the report's zone, ten minutes later so that Zabbix has the last values. A slot that came before the schedule was turned on, or before its day or time was changed, is never sent late. A send that fails is tried again after 15 minutes, an hour, then every four hours, until a week after the slot; the people who asked are told once after the third failed try and once when the portal gives up, once if the portal was not running for the whole week, and once when the mail server refused some of the addresses of a send that went (BK-38). Each step is written before the next, so a restart carries on, and a month is sent **at least once**, not exactly once: a crash between the mail server taking the message and the record being saved sends that month again, which is the better mistake.
* **One copy only.** `MAIL_SCHEDULE=off` keeps the monthly send from running on a machine. Two copies of the portal that both read the same Zabbix would both send, so the copy that is not the one to send is switched off.
* **Who a report may go to (amends ADR-0014).** An administrator, to the addresses they type, one to ten of them, each in `MAIL_ALLOWED_DOMAINS` when that list is set, five sends an hour for each person. `MAIL_TO` is only the list the portal starts with. The log line names the number of recipients and their domains and never an address.

### Positive Consequences

* The owner's three requests are met with one small file, and the report goes by itself.
* Restarting, rebuilding or moving the portal loses nothing but a few seconds of waiting, and the page says what happened to each month.
* The state is plain JSON that a person can read, copy to HCML's server, or delete to start again.
* The scheduler is a pure function of a clock, so every case (late, early, failed, restarted, switched off) is a test that runs in milliseconds.

### Negative Consequences

* **The portal now keeps something, so something has to be backed up.** The volume holds only addresses, a schedule and counts, and losing it means setting the schedule again and, at worst, one month sent twice. It is still not in any backup of this Mac (tracker IN-50). `docker compose down -v` deletes it.
* **The container writes to disk.** One folder, `/data`, owned by the `node` user, on the BFF only. The root file system stays read-only and `/tmp` stays in memory.
* **A stolen administrator session can send the report to an address of its choice,** within five an hour, unless `MAIL_ALLOWED_DOMAINS` names the domains HCML may send to. The portal warns at start-up while that list is empty. Before this decision a stolen session could send only to the people already in `MAIL_TO`.
* **A notice uses the account that failed.** A failure notice goes out through the same mail account as the report. When the account is the problem, the notice cannot get out, and the page and the log are the only places that say so.
* **A folder that stops taking writes stops the schedule.** A send that cannot be recorded is not made. The page says so and the log says it once; the scheduler tries a write at each tick and goes on when the folder is back.
* **The laptop is the weak point.** A schedule runs only while the portal runs and can reach Zabbix. On a laptop that sleeps at midnight on the first, the send happens when it wakes and reaches HCML's network, up to a week later, and is marked as late. The proper home for the schedule is HCML's server (tracker IN-43).
* **At least once.** A crash at the wrong moment sends a month twice.
* **A second state to move.** The file does not travel by itself to HCML's server: copy `portal-state.json`, or set the schedule again there.

## Pros and Cons of the Options

### One small JSON file on a named volume

* Good, because it is the least that does the job, and readable by a person.
* Good, because the whole state is one object that a test can build, read back and break.
* Bad, because it is a second thing to back up, and it makes the container write to disk.

### Recipients in `.env`, schedule from the host's `cron` or `launchd`

* Good, because the portal stays stateless.
* Bad, because the recipients would still be chosen by editing a file and restarting, which is what the owner asked not to do, and a scheduler outside the portal has no way to know what was sent. On a laptop that sleeps it also sends nothing when `cron` misses the minute.

### A database

* Good, because it is what a store is for.
* Bad, because three small things do not earn a server, a driver, a migration and a backup routine, and [ADR-0003](0003-no-database.md) was written to keep that out.

### Memory only

* Good, because nothing is written.
* Bad, because the schedule would be forgotten at every restart and a month could be sent twice. This is the behaviour when no folder is set, and the schedule is then refused.

### Zabbix's own reporting or an action that sends mail

* Good, because Zabbix is already the source.
* Bad, because the report is computed in the portal ([ADR-0004](0004-derive-the-sla-in-the-portal.md)), not in Zabbix, and Zabbix cannot attach it.

### A separate scheduler container

* Good, because a failure of the scheduler would not touch the BFF.
* Bad, because it needs the same state, the same mail settings and the same Zabbix reads, so it would duplicate the BFF to avoid sharing a process.

## Links

* [`docs/setup/18-automated-reporting.md`](../../setup/18-automated-reporting.md), *Emailing the report* and *The monthly send*
* [`docs/handover/3-integrations/reports-exports.md`](../../handover/3-integrations/reports-exports.md)
* [`docs/api/openapi.yaml`](../../api/openapi.yaml): `/api/sli/email`, `/api/sli/schedule`
* [`docs/operations/backup-and-restore.md`](../../operations/backup-and-restore.md)
