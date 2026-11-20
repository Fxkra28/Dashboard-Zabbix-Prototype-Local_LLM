# Read each month of Zabbix once, and evaluate any SLA window from what was read

* Status: accepted
* Deciders: HCML internship project; the owner asked on 17 November 2026 for an SLA that can be filtered by a range of days, months or years and by hours of the day, was given this design with the plan that rests on it, and told us to go ahead
* Date: 2026-11-17
* Amends: [ADR-0004](0004-derive-the-sla-in-the-portal.md), where the derived SLA read Zabbix once for each report and each window
* Amended: 2026-11-18 (FR-60): the report files and the email also take a range, and the schedule stays monthly; the last bullet of the decision says how
* Amended: 2026-11-19, after the tenth re-audit (BK-79 to BK-83): an evaluated window is kept for two minutes and shared; a window that begins after the data that was read reads the open month again; a WAN path is measured over the seconds its legs were covered; the incidents of the strict method are the outages of the merged stretches; coverage is written with a decimal below 100 (bullets below)

## Context and Problem Statement

The derived SLA (`sli/engine.ts`) answers one window: a calendar month on the SLA page, in the report files and in the monthly mail, or a rolling number of days on the Rolling tab. It reads the ICMP triggers, their events, the planned maintenance and, in the strict method, a month of hourly trends for every host, and then does arithmetic on time spans. The reading is what costs: about nineteen trend reads of 35 items for a cold month, on a Zabbix whose database disk was 87 % busy when it was measured (tracker BK-25, BK-50), and a gate of two reads at once for the whole portal.

On 17 November 2026 the mentor asked that the SLA be filterable by time: a range of days, months or years, and, within it, chosen hours of the day (for example 08:00 to 17:00 on weekdays). If each new range is a new window for `computeSli`, every choice is a cold read from Zabbix, a year is twelve times a month, and the cache has a key for each pair of dates that anyone typed. The arithmetic is cheap and the same for every window; the data it runs on is the same data.

## Decision Drivers

* The monthly figures, which HCML reads, must not move by a digit.
* A range must cost what its months cost, once, not what its choices cost.
* An outage that crosses the end of a month must be one outage in a range that covers both months, not two.
* The two methods (HCML's own and the strict one) keep their rules for missing data and for the end of a month.
* The portal keeps nothing of HCML's on disk beyond what ADR-0016 allows: the months stay in memory.
* A range must be refused plainly when Zabbix cannot answer it (it keeps events for about a year).

## Considered Options

* Split the engine into reading and evaluating: read each month once and keep what was read, then evaluate any window from the months it touches.
* Compute each window fresh, with a cap on the span.
* Keep a table of per-day figures and add them up.
* Keep the figures of each month and add the months.

## Decision Outcome

Chosen: **split `computeSli` into a reading stage and an evaluating stage, keep the result of the first for each month and method, and let the second answer any window from them.**

* **Stage A, `readSliData`, reads one span** (a calendar month, or the one window of a rolling request) the way the engine always has, and returns what it read instead of a figure. For each trigger: its state when the span opened and its events. For each host: its name, status, category, whether its ICMP was ever collected, its planned maintenance inside the span and, in the strict method, the hours in which it collected data. It also returns how many Zabbix calls it made. It returns no percentage.
* **Stage B, `evaluateSli`, is pure.** From the data of the months a window touches, the window, the daily hours and the method, it computes everything a report holds: each host, the groups (the plain mean of the hosts, HCML's own rule), the WAN paths, the gaps of the estate and the declared spans. It does no input or output.
* **The monthly report is stage B over one month,** plus the web checks, which stay as they are (below). It is tested against reports made by the engine before the split, on fixtures for both methods, and must equal them.
* **Kept per month and method, in memory, with the rules of the monthly report.** The data of a closed month, ten minutes after it ended, is kept for a day and pinned. The data of the open month and of the ten minutes after it is kept for five minutes. The reads go through the same gate of two. A month that failed to read is not kept (BK-51).
* **Events, not figures, are what is kept.** The per-trigger events and the state at the start are kept rather than the merged down intervals, because the number of incidents and the longest outage must be recomputed for any window, and an outage that spans the end of a month is one outage when the months are joined. The events of consecutive months are joined in order and replayed once, from the state the window opens in, exactly as the engine replays them for one long window.
* **Windows.** A window is `from` and `to`, whole hours in the report's time zone (Asia/Jakarta unless set), at most 366 days, starting no more than 400 days back and not in the future. The window ends at the earlier of `to` and the moment the newest month was read. The presets Day, Month and Year are windows: midnight to midnight, a calendar month, a calendar year.
* **Daily hours.** A window may be restricted to the hours of the day from `start` to `end` (whole hours; an `end` that is not after `start` runs through midnight into the next morning), on every day or on chosen weekdays. A span belongs to the day it starts. The spans are built for the window and removed from the measurement with the same interval operations that remove maintenance, so neither the downtime nor the measured time outside them counts. In HCML's method the measured time is the daily hours less maintenance and missing data still counts as up. In the strict method it is the hours with data, less maintenance, inside the daily hours. The gaps of the estate, the groups and the WAN paths follow from that. The jump of a daylight saving change is handled by the time zone code, and Asia/Jakarta has none. Public holidays are not known to the portal and are not excluded.
* **One pass for a range.** A range is evaluated in one pass over its whole window, in both methods, not as the sum of the figures of its months. For the strict method this is the engine's own answer for that window. For HCML's method it differs from the sum of the monthly reports by at most one second for each month end that an outage crosses, because HCML's report clips an outage still open at a month's end to the second before it (`engine.ts`, `to - 1`) and a range does not clip inside itself. A test holds the difference to that.
* **What a window says about itself.** Each host and group carries the measured seconds and the downtime. A window of daily hours reports the seconds of the window that the hours keep, and the host's `window` is that figure. An outage counts as an incident when any part of it lies inside the chosen hours, and the longest outage is the longest part inside them. The page hides the error budget under 24 measured hours, since one five-minute outage is 91.7 % of an hour.
* **No data and partial** are judged for the window: a host has no figure when it collected nothing inside the window and its hours, or less than `SLI_MIN_COVERAGE` of them, and it is partial when it collected less than 95 % of the time the estate as a whole was collecting inside them. The gaps of the estate are recomputed for the window from the hours that each host collected.
* **An evaluated window is kept for two minutes, and shared.** Evaluating a window takes seconds of the one thread of the BFF, so the page, its refresh, a report file and an email of the same choice share one evaluation: it is kept under the method, the window, the month if it is one, the hours and the time of the newest read. It is dropped when a month it was made of is forgotten, so that an empty report is not the answer of the next try. The outages that fall inside the daily hours are found in one pass over the merged spans, not by cutting each outage against each span (BK-79).
* **A window that begins after the data that was read.** A month's data is kept for five minutes while the month runs. A window that starts later than the newest data (a day that is today, asked just after midnight) reads the open month again instead of answering No data for every device with a 200. The month is read again whatever the age of the copy, since a copy stored after the window began may have been read before it, and also when the hours chosen leave nothing measured in what was read. A range that has nothing to measure even then is answered 503 `data_not_read_yet` with `Retry-After: 60`: the request is right and the figures are not there yet, so a page offers Try again (BK-80).
* **How a figure is counted.** A WAN path is measured over the seconds its legs were covered, in both methods, so a path whose two legs are in planned maintenance reads as each leg does (BK-81). In the strict method the incidents of a host are the outages of its merged stretches, the same ones that Downtime and Longest outage use, and not one for each trigger that fired in an outage (BK-82; the two golden files of the July report and of the June to August window moved by one incident for one host each). Coverage is written with one decimal below 100, so that 99.6 does not print as 100 in the PDF and the CSV (BK-83).
* **Web checks stay monthly.** They need the raw readings of the last 31 days and their figures are kept as first read (ADR-0016). A window that is not a calendar month has none, and says so.
* **Limits.** A range holds one place in the person's line of SLA reads (`SLI_READS_PER_PERSON`, four) and its months go through the same gate of two. The first view of a year after a restart reads up to twelve months through that gate, which is slow on HCML's Zabbix; the page says how many months are in, and the months stay for a day. A span of more than 366 days, hours that are not whole, a start that is not before the end, and a start more than 400 days back, or in a month that began more than 400 days back (a range is read in whole months), are refused with a plain message, before anything is read and before a send takes a place in the allowance.
* **Files and the email take a range; the schedule stays monthly (FR-60, 18 November).** The report files (PDF, Excel and the zip of CSV files) and the email take what `/api/sli` takes: a calendar month, or two whole hours, and the hours of the day that count. A file for a range holds one figure for the whole window, not one for each month it touches, and says on its first page which hours were counted; its Web checks table is there and empty, with the reason, since web checks are monthly. It is named by its dates and hours, so two files of the same days differ. The schedule stays monthly: it sends the month that has just closed, and a range has no "next". A repeating range, such as the last seven days every Monday, would be a schedule of its own and is not built. A range is sent by hand and left in the log; the list of recent sends is the schedule's book, kept by month, and only the plain month goes in it.

### Positive Consequences

* A range costs its months, once. A second person, or the same person with other hours, costs nothing at Zabbix.
* Day, Month, Year, a free range and daily hours are one code path, tested against the monthly one.
* A rolling window and a month use the same evaluation, so a rule is written once.
* A later change, such as public holidays or another daily rule, is one more set of spans removed from the measurement.

### Negative Consequences

* **The engine is in two parts,** with a data type between them, and the reading stage had to be separated from the arithmetic it was written around.
* **Memory.** Each month and method holds its events and the hours of its hosts. Measured on 17 November 2026 on a made-up estate of 139 hosts with two triggers each, on the development Mac (Node 25): about 45 bytes an event, so a month of 28,000 events is 1.3 MB and one of 278,000 events is 12.6 MB. HCML's real count of events in a month is not known: it is `stats.events` of a monthly report, to be read on the real data. The cache sizes a value by walking it, and stops at 500,000 values, about 170,000 events, where it counted 10.7 MB for a month that held 56.5 MB. So the data of a month carries its own estimate (`sliDataBytes`, given to the cache as `weigh`), and the cache's limits (`MAX_BYTES`, `MAX_PINNED_BYTES`) hold it.
* **A month can be read twice.** The report of a month and the data under a range are kept apart, so a month asked for as a report and again inside a range is read from Zabbix once for each. A closed month costs that once a day.
* **A cold year is slow.** Twelve months through a gate of two, on a Zabbix that takes seconds to minutes for each.
* **A rolling window still reads for itself,** because it ends now and its data is not a month's.
* **HCML's method has no figure of its own for a range,** since HCML publishes monthly reports. The range is that method's rules over a longer window, and the page says so.

## Pros and Cons of the Options

### Split the engine, keep what was read

* Good, because the cost is the months and not the choices, and the monthly figures are held by tests.
* Bad, because it is a refactor of the engine that every SLA figure goes through.

### Compute each window fresh, with a cap on the span

* Good, because it is the smallest change: the engine already takes `from` and `to`.
* Bad, because every range and every hour choice is a cold read from a slow Zabbix, the cache would hold a key for each pair of dates, and a year is a very long wait.

### A table of per-day figures

* Good, because a range would be a sum of rows.
* Bad, because a day's figures cannot give the figures of a window of hours, a longest outage or a count of incidents, and it keeps a new table of derived data on disk, which ADR-0003 and ADR-0016 argued against.

### The figures of each month, added up

* Good, because it is simple.
* Bad, because a percentage of a month cannot be added: months have different measured time, and an outage that crosses a month end would count twice. Only the seconds can be added, and they cannot give daily hours.

## Links

* [ADR-0004](0004-derive-the-sla-in-the-portal.md), [ADR-0016](0016-keep-the-web-check-figures-of-closed-months.md)
* `server/src/sli/engine.ts`, `server/src/sli/window.ts`, `server/src/services/sli.ts`
* [`docs/api/openapi.yaml`](../../api/openapi.yaml): `GET /api/sli`
