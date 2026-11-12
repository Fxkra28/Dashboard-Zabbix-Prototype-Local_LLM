# 18. Automated reporting

[setup.md](../../setup.md) · previous: [§17](17-link-wan-health.md) · next: [§19](19-authentication-rbac.md)

Implements `plan_1.2.md` (in `myown/documents/plan/`, outside this repo) Phase 6, serving HCML Goal 6: *"hard to see SLA,
capacity trends, and recurring issues."* Recurring issues were already covered by Top 100 triggers;
these add the other two, plus response time.

## Availability: `/api/reports/availability`

Zabbix stores events; turning them into uptime is arithmetic it doesn't do. The BFF replays history:

1. `event.get` for PROBLEM events in the window (severity-filtered), read in slices that halve until
   none holds a full page, so a busy month is never a silently cut list. The same for the 31 days
   before it, and `problem.get` for every problem still open now, whatever its age.
2. Each carries `r_eventid`; the window's recovery events are read once, and any other recovery is
   fetched by id in batches of 2,000 for its clock.
3. An outage that began before that look-back and ended inside the window is found from the other
   end (BK-04). A recovery event carries no link to its problem, so the first recovery of each trigger
   that no known problem explains is followed back: the trigger's last problem before the look-back
   is asked for, and kept when it names that recovery. Zabbix gives a recovery severity 0 whatever the
   trigger's priority, so the severity floor is applied to the triggers, not to the recoveries.
4. Each problem becomes an interval, clipped to the window; still-open ones run to *now*.
5. Overlapping intervals are merged per host: two simultaneous problems are one outage, not
   two. Without this, availability can go *negative*, which is the trap here.

All of it is `fetchIncidents()` in [`services/incidents.ts`](../../server/src/services/incidents.ts).

Availability is then *"share of the period with no open problem at or above the chosen severity"*,
and the page says exactly that, because it isn't the same thing as ICMP uptime.

> The look for older outages is bounded: at most 200 triggers (`LONG_OUTAGE_LOOKUPS`). Past that the
> report sets `truncated: true`, and the UI labels the figures a floor. Silently understating downtime
> while looking authoritative would be worse than saying so. (A window so dense that one second holds
> a full page of events is refused with an error rather than reported on.) Still missed: a problem
> that began before the look-back and was resolved after the window ended.

## Action aging: `/api/reports/aging`

How long problems sit unacknowledged, in buckets (<1h, 1–4h, 4–24h, >24h) plus the longest-waiting
list. This is the *"the team repeats manual checks"* half of Goal 4, measured.

## Capacity: `/api/reports/capacity`

Reads `trend.get` (hourly aggregates), falling back to `history.get` on an instance too young to
have trends: otherwise a fresh deployment shows an empty report and looks broken. Verified key
matchers:

| Metric | Matches | Trap |
|---|---|---|
| CPU | `system.cpu.util`, with or without empty brackets, and the SNMP forms with an OID such as `system.cpu.util[cpmCPUTotal5minRev.19]` | `system.cpu.util[,idle]` is the *idle* share: the opposite |
| Memory | `vm.memory.util`, `vm.memory.utilization` and the SNMP forms with an OID | `vm.memory.size[available]` is bytes, not a percentage |
| Filesystem | keys ending `,pused]`, and `vfs.fs.pfree` (used = 100 minus free; FortiGate reports free space only) | none |

Rows carry `source: 'trend' | 'history' | 'none'`, and the page states when a zero means *no data*
rather than *idle*.

## The SLA report as a file: `/api/sli/export`

The monthly SLA report downloads as a PDF, to print or attach to an email, as an Excel workbook,
to sort and total, or as a zip of CSV files, for a script or for a spreadsheet that wants plain
numbers. Goal 6 is *Automated reporting*, and this is its on-demand part: someone asks,
and the file is made. An administrator can also email the files to people they choose (*Emailing the report*, below),
and have them go by themselves on a day of each month (*The monthly send*, below).

On the page. The SLA page (its *Derived monthly SLA* view) and the Availability page each show
three buttons in the controls row, *PDF report*, *Excel report* and *CSV report*, and a fourth, *Number and date style*, in a group of its own. The Availability page shows them
only when the period is one calendar month and the basis is Availability (ICMP): a rolling window
and the legacy basis have no SLA month to report. Its buttons download the same report as the SLA
page's, not that page's own table. Both pages keep the buttons off until the figures on screen have
loaded. A press calls `GET /api/sli/export` and saves the answer under the name the BFF sends, such
as `HCML_SLA_Report_2026-08.pdf`. While a file is being prepared the button reads *Preparing PDF…*
and a second press does nothing. A failure appears next to the buttons and names the format that
failed. The code is `web/src/features/sla/ReportDownload.tsx` and `api.sliExport` in `web/src/api/sla.ts`.

Number and date style. *Number and date style* opens a dialog with three choices, each shown with an example, and keeps them in
this browser the moment they are made (`localStorage`, under `hcml.report-style`; a private window that will not keep them uses
the defaults). The next download, and the next email sent from this browser, is written in that style. **The style changes how a
figure and a date are written and never what they say**: a figure, a verdict, the order of the rows and the colours are the same
in every style, and a test holds that.

| Choice | Values | What it changes |
|---|---|---|
| Decimal mark | a dot (`99.38%`, the default) or a comma (`99,38%`) | The percentages in the text of the PDF, the workbook's summary and tables, and the CSV files. The workbook stores a figure as a number, which Excel shows by the viewer's own locale |
| Dates | `4 Nov 2026` (the default), `04/11/2026` (day, month, year) or `2026-11-04` | The dates in the text: the period, the time of generation, the spans with no data. The month's name on the first page and the file name are not changed |
| CSV separator | a comma (the default) or a semicolon | What a CSV file puts between its fields. The PDF and the workbook have none and ignore it |

If Excel puts every row of a CSV file in one column, choose the other separator. A decimal comma in a file separated by commas is
put in quotes, which is what a CSV reader needs, so a decimal comma is easiest to read in a file separated by semicolons.

What is in the file. All three files are made from one document, so they say the same thing.

| | PDF | Excel |
|---|---|---|
| Key figures | Four cards: overall SLA by each method, devices measured, sites below target | The same four as a table on the *Summary* sheet, below the report's title, month, period and time of generation |
| Chart | SLA by site against the target line, worst site first | None. The figures are in the tables |
| Tables | By category, By site, By device, WAN paths, Web checks, Devices never measured, each column sized to its longest value before any name is cut | One sheet each, in that order, each column sized to its longest value (up to 45 characters). The sheet for *Devices never measured* is named *Never measured* |
| Notes | *How to read this report* and *How it was computed* | The same two, under the key figures on the *Summary* sheet |
| Print | A4 landscape. A header band with the logo on page 1, a footer with the report name and *Page x of y*, and a bookmark for the chart, each table and each note | A4 landscape, one page wide. The header row repeats on every printed page, and the footer carries the page numbers |

The figures are the page's. The route asks for both methods, `availability` (strict) and
`hcml-report`, through `getMonthlySli`, the cache `/api/sli` fills (§25), so a month the SLA page
has already loaded costs no further Zabbix call. Every table puts the strict figure first and HCML's
beside it, and the *Status* columns judge the strict one. They say Met, Missed or No data in words,
so a verdict never rests on colour. A device with no data reads No data, never 0%. A figure that
would round up to the target while falling short prints more digits (98.996%, not 99.00%), so it
never sits beside the word Missed looking like a pass. The wording is the SLA page's. The period
line says whether the month has closed; for a month still running it says how far the figures run
and that they are not final.

How it is built. `server/src/export/` builds the report once as a document model (`types.ts`):
key figures, an optional bar chart, tables and notes, each figure already formatted and carrying the
tone it takes. `slaReport.ts` fills the model from the two derived reports. It is pure, with no
Zabbix, no config and no clock but the one it is handed. Two writers turn the same model into a
file, and neither knows anything about SLAs, targets or Zabbix. They use no library. Both are
written on Node's `zlib` and `crypto` modules and no package was added (ADR-0011,
`docs/architecture/adr/0011-build-the-sla-report-files-in-the-bff.md`).

The PDF writer is `pdf.ts`, with `pdfFonts.ts` and `logo.ts`. It writes A4 landscape by hand with
the standard Helvetica fonts, which no viewer needs embedded, so the file stays small and opens the
same everywhere. It lays out every page before it draws one, so *Page x of y* is right. It sizes a
table's columns to their content first, and cuts a name that is still too long with an ellipsis. The
logo is a copy of `web/public/logo-mark.png` in `logo.ts`, beside a small PNG reader, because the
BFF image holds `server/` only. A test compares the copy with the original byte for byte.

The workbook writer is `xlsx.ts`, with `zip.ts`. It writes SpreadsheetML by hand and packs it with a
small zip writer. The header row is blue and frozen, rows are banded, each table sheet has a filter
over its rows, and Met and Missed show in words and colour. Percentages are stored as numbers in
percent points (98.9812, not 0.989812) and shown with four decimals and a % sign. Durations are
stored as times formatted `[h]\:mm\:ss`, the colons escaped so that an Excel whose time separator is
a dot (Indonesian) still shows 4:19:35, and counts as numbers, so all of them sort and total. The
Summary prints on one page; each table sheet prints one page wide and as many long as it needs. A
missing figure is the text *No data*, never an empty cell. Every text is stored as text and is never
evaluated as a formula, so a device named `=HYPERLINK(...)` stays a name. The elements in each part
follow the schema's order, because Excel offers to repair a file that breaks it.

Colours. Reports always use the light theme, because they are printed and attached to email,
whatever theme the viewer's screen uses. The colours are copied from the light tokens in
`web/src/styles/01-tokens.css` into `theme.ts`, and `export-theme.test.ts` fails if one drifts.

The CSV files. `format=csv` answers one zip, `HCML_SLA_Report_2026-08_csv.zip`, holding a folder of the same name with
`00-summary.csv` (the report, the period, the time and the four key figures), a file for each table in the report's order
(`01-by-category.csv`, `02-by-site.csv`, `03-by-device.csv`, `04-wan-paths.csv`, `05-web-checks.csv`, `06-never-measured.csv`)
and `notes.txt`, which says what each file is, why an empty one is empty, how the files are written, and carries the report's
two notes. The files are UTF-8 with a byte order mark, so Excel shows accents correctly, and every line ends with CR and LF.
A percent column holds the figure as the report prints it without the percent sign, and its header says `in %`; a duration
column holds whole seconds, and its header says `in seconds`; a figure that is missing is a blank, **never a zero**, and the
Status column still says *No data* in words. A name that starts with `=`, `+`, `-` or `@` has an apostrophe put in front, so that a
spreadsheet does not run it as a formula (the PDF and the workbook cannot run one). The code is `server/src/export/csv.ts`, which
builds the zip from the same document as the other two writers; the style, and the names of the file kinds, are in `server/src/core/reportChoices.ts`.

The route. `GET /api/sli/export?month=YYYY-MM&format=pdf|xlsx|csv`, with the optional `decimal=dot|comma`, `date=long|numeric|iso`
and `separator=comma|semicolon`, viewer role like the pages it
serves ([§19](19-authentication-rbac.md#19-authentication--rbac)), by session cookie or bearer token:

```bash
# -f makes curl fail on an HTTP error, so an error message is not saved as the file
curl -fsS "$BFF/api/sli/export?month=2026-08&format=xlsx" -H "Authorization: Bearer $TOKEN" -o report.xlsx
```

`month` defaults to the current month in `SLA_TIMEZONE`. `format` is required. A bad month, format or style
is a 400, refused before Zabbix is asked, so it costs nothing. So is any other parameter, so a misspelt
`month` is not quietly read as the current month. The engine adds a 400 for a month
that has not started or is more than about 400 days back, and a Zabbix failure is the usual 502 or
503. The file name is made from the validated month alone, so no request text can reach a header.
The answer carries `Cache-Control: private, no-store` and is never compressed. Nothing is kept for
long: a built file is reused for ten seconds, so a burst of requests for one month and format shares
one build (about 10 ms of CPU), and after that it is built again from the cached figures.

Stale figures. The route reads the same cache as `/api/sli`, which serves its last good run
while Zabbix is failing (`staleIfError`, §26). The file is then a 200 built from older figures, and
the response says so with `X-Data-Stale: true` and `X-Data-Age-Seconds`. For
a month still running, its period line shows how far the figures run, for each method when the two
end more than a minute apart.

Size and speed. The test report has 138 devices across 14 sites. Its PDF is about 10 pages and
69 KB, and its workbook is about 23 KB. In a fresh process the first PDF took about 60 ms and later
ones about 10 ms, and the workbook took about 14 ms, then 9 ms. These are single builds on the
development laptop, measured on 2 Oct 2026. Both writers compress with synchronous `zlib` calls, so
the BFF answers nothing else while one runs, and the time grows with the number of rows.

How it was checked. `server/src/__tests__/export-*.test.ts` build both files from a report
shaped like the real one and read them back. For the PDF that means its cross-reference table, page
tree and bookmarks, and that every text sits inside its margin and its column. For the workbook it
means the parts, the relationships, the style ids and the element order. The tests give the writers
hostile names (a leading `=`, `+`, `-` or `@`, a literal `_x0041_`, characters XML forbids, a name
too long for its column) and check that the same document and time give the same bytes.
`ReportDownload.test.tsx` and `reportApi.test.ts` cover the buttons and the download request. By
hand, the PDF was checked with `pdfinfo`, `pypdf`'s strict reader and a visual review, and the
workbook with `openpyxl`'s strict reader, macOS Quick Look and a check of element order against the
schema. **Not checked: Microsoft Excel itself, and HCML's own data.** Every name in the test report
is made up. Docker, and the Zabbix stack in it, was down when the checks were made, so no report
could be built from HCML's data.

What the files leave out.

- The PDF embeds no font. Text outside Western European letters prints as `?`, so a device named in
  Cyrillic or Chinese would show as a row of question marks. Accents and curly quotes print as
  written. The PDF is not PDF/A and is not tagged for screen readers.
- The workbook has no chart. The same figures are in its tables.
- The CSV files are a zip (below), not one file, because the report is several tables. The Alert noise page, the Inventory scorecard and the Graphs page's Show data each have a CSV of their own.
- A group row's downtime adds up the downtime of all the group's devices, including devices with too
  little data to score. Those devices are left out of the group's average but not out of its
  downtime. `aggregate()` in `server/src/sli/engine.ts` does this and the SLA page shows the same
  sum, so a group's downtime and its SLA do not always describe the same devices. The report's notes
  say that a group row adds up all its devices.

## Emailing the report: `/api/sli/email`

An administrator can send a month's report to people they choose, in `hcml-portal` only: the compose file of `hcml-portal-ollama`
passes none of the mail settings, on purpose, so that nothing leaves the machine there and the buttons are never offered. This is the second half of Goal 6's on-demand
part: the files are the ones the downloads give, and they travel by email instead of to the browser. The same report can also go by itself every month (*The monthly send*, below).

On the page. An *Email report* button and a *Schedule* button sit in the controls row of the SLA page and of the Availability page, in a group
of their own beside the download buttons, and they show in the same cases. *Email report* goes off and on with the download buttons, until the figures have loaded; *Schedule* needs no figures and stays on. Only an
administrator sees them, and only when email is set up: the page asks `GET /api/sli/email`, an administrator-only route
that says whether email is on, from which address, the saved list of recipients, how many addresses a list may hold, which domains they may be in and whether the list survives a restart; a failed answer shows nothing. *Email report* opens a
dialog in the shape of the Acknowledge dialog (focus moves in and stays, Escape closes it, focus goes back to the button). It names the month and shows the sender, and holds:

- **Files**: a tick box each for the PDF (ticked at first), the Excel file and the CSV zip. At least one. Several go in **one message**, in that order.
- **Send to**: a box with the saved list, one address on each line. Type over it, add to it, or paste a list separated by commas, semicolons or spaces. Up to ten addresses, and only in the allowed domains when the portal names some. It is where a person says who gets this report.
- **Remember this list for next time**: unticked at first. Ticked, the list typed becomes the one the button and the schedule start with, once the report has gone, and the dialog says so: *The saved list is also the one the monthly send goes to.* If the portal has no data folder it says so: the list is then forgotten when the portal restarts. The page asks for the list again after a send or a schedule has kept one, so the next dialog starts from it; a change another administrator makes shows after a reload.
- **Saved list (N people)**: a button under the box that opens the saved list as it is: each address with a *Remove* button, a box to add one, and *Delete the saved list*, which asks first. Each change is saved at once (`PUT` and `DELETE /api/sli/recipients`, administrator, the CSRF header; the log holds how many addresses, never one), and the box above follows the list unless something else was typed in it. Removing the last address deletes the list, and deleting is refused while the monthly schedule is on and `MAIL_TO` holds nobody, since the next send would have no one to go to. When the portal has no list of its own it uses `MAIL_TO`, which the view then shows, and *Delete the saved list* says that nothing was deleted (FR-31). The view is off while a send runs.
- A line that says the style the files will be written in (*Style: decimal dot, dates like 4 Nov 2026*, and the CSV separator once the CSV zip is ticked), taken from the *Number and date style* dialog.

While a send runs the button reads *Sending…* and the dialog cannot be closed. After 30 seconds a button *Close, the send continues* appears: the page then says that the send goes on and where its result will be (*Last sends* in the Schedule dialog), keeps *Email report* off until it ends, and says how it ended when it does, with a *Dismiss* button (FR-35). After it, the dialog says *Sent the PDF and the Excel file to 2 people.*, with how many
addresses the mail server refused if any and whether the list was saved, or keeps the portal's sentence about what went wrong, and what was typed, so the person can try again. When the web server answers instead of the portal, which it does while the portal restarts, the dialog says *The portal did not answer (HTTP 502). The report may or may not have gone: look under Last sends in the Schedule dialog, or ask the people it was sent to, before you press Send report again.* A connection that drops says the same, since the portal may already have the request. If the portal said the report went, in words the page cannot read (or answered success with something that is not JSON), the dialog says that it went and asks for a reload, and *Send report* gives way to *Close*. *Save* in the Schedule dialog says the same kinds of things about the schedule, and a failed read of the schedule says only that the portal did not answer and to try again (tracker FR-29).

Settings. Eleven variables in the root `.env` of `hcml-portal`, handed to the container by its `docker-compose.yml`. With the first eight blank
email is off and the buttons are not offered. `PORTAL_STATE_DIR` is not a setting you edit: the compose file sets it to the folder of the data volume.

| Variable | What it holds |
|---|---|
| `MAIL_PROVIDER` | `gmail`, `yahoo`, `zoho`, `icloud`, or `smtp` for a server of your own |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURITY` | Only for `smtp`, or to name another server for a provider (`smtp.zoho.eu` for Zoho in Europe). Security is `tls` (port 465), `starttls` (port 587) or `none`; blank follows the port |
| `MAIL_USER`, `MAIL_PASS` | The login. For Gmail, Yahoo, Zoho and iCloud the password is an app password, never the usual one. Spaces in a Gmail app password are removed |
| `MAIL_FROM` | The sender address. Blank means `MAIL_USER`. Gmail sends as the signed-in account whatever this says |
| `MAIL_TO` | **The list the portal starts with**, up to 10 addresses separated by commas, spaces or semicolons. It may be blank: the people who get a report are chosen in the portal, and once the portal has a list of its own, that one is used and `MAIL_TO` is no longer read |
| `MAIL_ALLOWED_DOMAINS` | The only domains a report may go to, such as `hcml.co.id`, up to 20. Blank means any address, and the start-up log then says so in a warning. **Set it**: it is what keeps a stolen administrator session from sending the report to an address of its choice |
| `MAIL_SCHEDULE` | `off` keeps the monthly send from running on this machine; blank or `on` leaves it on. Use `off` on a copy of the portal that must not send, since two copies that read the same Zabbix would both send |
| `MAIL_FROM_NAME` | The name shown beside the sender's address, up to 64 characters, blank for `HCML Monitoring Portal`. No `<`, `>`, `"`, `\` or `@` in it, and no line break or other invisible character (a zero-width space, a right-to-left mark): a name that could be read as another sender, or as a header, turns email off. A name people know the reports by is one of the things that helps a mail program place a message from a new sender (IN-62); the sending account stays the owner's choice |
| `PORTAL_STATE_DIR` | Where the portal keeps its small file of its own (below). The compose file sets it to `/data`, the volume `portal-state` |

A setting that is present and cannot be used leaves email off, and the start-up log says which one, in a line that begins
*Email is off*. The portal still starts: a typo in `.env` must not stop monitoring. The password is never written in
that line. `MAIL_SECURITY=none` is refused when there is a password, so a login never travels unencrypted, and with
`starttls` the connection is encrypted before the login and a server that does not offer it is a failure. A line break
in any setting turns email off, because that is how a mail header is forged. An address in `MAIL_TO` outside `MAIL_ALLOWED_DOMAINS` is a mistake and turns email off too. All of this is `server/src/core/mailConfig.ts`.

With sign-in off, email is off too, although it is set up, unless `ALLOW_EMAIL_WITHOUT_AUTH=true` is set (SC-43): every caller would count as an administrator and could send the report to any address, or set the schedule. The start-up log says so in a line that begins *Email is off while sign-in is off*, `GET /api/sli/email` answers `enabled: false`, so the buttons are not offered, and the Schedule dialog gives the same reason. The setting is for local development and is not passed to the containers. The saved list of recipients is refused the same way, with or without mail settings (SC-49): `PUT` and `DELETE /api/sli/recipients` answer 503 with the same reason, so that nobody who reaches a portal with sign-in off can plant a list before email is set up.

Which accounts can be used. Any account whose provider lets an application log in to its SMTP server with a name and a password.

| Account | Works | What it needs |
|---|---|---|
| Gmail, Google Workspace | yes | 2-Step Verification on, and an app password; `smtp.gmail.com`, port 465 |
| Yahoo Mail | yes | An app password; `smtp.mail.yahoo.com`, port 465 |
| Zoho Mail | yes | An application-specific password when two-factor sign-in is on; `smtp.zoho.com`, port 465; a regional server through `MAIL_HOST` |
| iCloud Mail | yes | Two-factor sign-in and an app-specific password; `smtp.mail.me.com`, port 587 |
| A web host's mailbox, a company mail server, a mail service that offers SMTP | as `smtp` | The server name, port and login its provider states |
| A relay that trusts the portal's address | as `smtp` | `MAIL_SECURITY=none` and no login |
| Outlook.com, Hotmail, Microsoft 365 | not by password | Microsoft asks for OAuth2, which this version does not offer. Microsoft 365 turns the password login off by default for existing tenants at the end of December 2026; an administrator can turn it back on, and then `smtp` with `smtp.office365.com` can work. A route through Microsoft Graph is not built |

Recipients can be at any provider. Use a mailbox made for the portal, not a personal one: the file names every device, and
once it is in an inbox the portal's roles no longer protect it. The Gmail and iCloud settings come from Google's and Apple's own help pages, read on 4 November 2026. The Yahoo and Zoho
settings come from third-party guides and were not checked against those providers' pages.

The route. `POST /api/sli/email` with `{ "month": "2026-08", "formats": ["pdf", "csv"], "to": ["ana@example.org"], "remember": true, "style": { "decimal": "comma" } }`, administrator role (the role table in
`server/src/security/auth.ts`), and the CSRF header like every write sent with the cookie. Only `month` and `formats` are required. `to` left out means the saved list. Nothing else in the body is
accepted: a subject, a message, a copy or a blind copy is a 400, so no request can add text or hidden recipients to the message.
`GET /api/sli/email` is the question the page asks. The checks run in this order, and the first to fail answers: the
shape of the body (400), whether email is set up (503 `mail_disabled`), the month, the formats, the style and the recipients (400, each with a sentence that says what is wrong; a month that has not started, that is more than about 400 days back or that ended less than ten minutes ago, while Zabbix is still adding its last values, is one of them, so it costs neither an allowance nor a mail login), the allowance
(429), the mail login (502 `mail_error`, before Zabbix is asked, so a wrong password costs a second and not a minute),
and then the two reports are read and the message is sent. A month in which neither method finds a device is not sent, since the page would be empty and the send would read as a success: the answer is 502 `empty_report`, with a sentence that says where to look, the log line is a failure with the reason `empty`, and the monthly send counts it as a failed try (BK-51). Both are in `docs/api/openapi.yaml`.

What goes out. **One message** to every address, with each file attached under the name its download uses, such as
`HCML_SLA_Report_2026-08.pdf`; the subject `HCML SLA availability report, August 2026`; and a plain-text body made from
the report's own document: its four first-page figures in the same words, the period, who sent it and when it was made,
and a line saying the message is automatic. The files are built by the same function as the downloads (`fileFor`), so they
hold the same figures. The message carries `Auto-Submitted: auto-generated`, so an out-of-office reply is not sent back. Every address is in its To line, so each person who gets the report sees the other addresses (SC-50): the portal sends one message, not one for each person, and uses no blind copy. The Email and Schedule dialogs say so beside the box. With `MAIL_ALLOWED_DOMAINS` blank a list can mix colleagues and people outside HCML, so name the domains to keep it to one.

Limits. 5 sends an hour for each person, counted in memory (§23) in a fixed hour, so ten can go across the edge of two. At most 10 recipients, each a plain address: no name, no quotes, and none of `%`, `!`, `|` or `/` before the @, which an old mail server reads as a route to another domain or as a command. Ten seconds to connect and to
get the server's greeting, and a minute of silence on an open connection. The check before a send waits through at most 15 seconds of silence, since nothing has been handed over by then, and a silence there is told as `connect`, not as `timeout` (BK-52). A failure at the mail server is one fixed
sentence for its kind, `login`, `connect`, `timeout`, `tls`, `recipients`, `rejected` or `other`, which names the setting
to check (the one for `timeout` says that the report may or may not have gone, since the server may have had the whole message when it stopped answering: FR-35, and the notice of the monthly send says that the report may have reached some or all of the people, not that nobody has it, when any try of the month ended in a timeout, or never ended as when the portal stopped in the middle of a send, and the planner tries again as after any failure: BK-52); what the server said goes to the log only, first line, cut to 300 characters, with the login name, the
password and every address taken out. If the server takes the message for some addresses and refuses others, the send counts as made: the refused ones are a number in the dialog and in the log, and the log line is a warning. A monthly send also tells the people listed under *If a send fails, also tell*, once, with how many addresses took the message and how many refused it, and never an address: a mistyped address would otherwise lose a person's report unseen. The refused addresses have not received it, so send it to them by hand (tracker BK-38). One case of the doubt is not told: nodemailer reports every connection that is closed under way in the same way and does not say in which step, so a connection closed while the message was handed over reads as `connect`, and the notice then says that nobody has the report although the server may have had it whole (BK-52, not fixed).

The log. One line for each attempt that passed its checks, `report_email`: who (the user, or `schedule`), `trigger` (`manual` or `schedule`), the month, the
formats, the size, how many recipients the server took and how many it refused, **the domains they are in**, whether it was `sent` or `failed`, and for
a failure its kind and, for the log alone, a `detail`: what the mail server or the code said, with secrets and addresses masked (HCML's Zabbix is named by the class of its failure only). Never the addresses, the subject, a file or the password. A send is logged at information level; a failure, and a send that the mail server took for only some of the addresses, at warning level. The portal also keeps a short record of each send in its state file (below).

Other log events. `report_schedule_changed` (information): who set the monthly send, and the day, the time, the files and how many people, never an address. `report_skipped` (warning): a month the monthly send passed by with no send tried, usually because the portal was not running when its slot came, with the month and `outcome: missed`; it is not a `report_email` line and not a failed send (BK-55). `report_state_unwritable` (error): the data folder stopped taking writes, so a send is not made, and one that went is recorded when the folder takes writes again. `report_schedule_error` (warning): the scheduler's check failed in a way it did not expect, and it tries again a minute later. `report_notice_failed` (warning): a notice to the people who asked to be told could not be sent, with the kind of failure. `recipients_not_saved` and `send_not_recorded` (warning): the report went, but the saved list or the record of the send could not be kept. `sign_in_repeated_failures` (warning, [§19](19-authentication-rbac.md)): several wrong passwords for one name.

## The monthly send

The report of the month that has closed can go by itself, on a day of the month and at a time, to the people listed. This is
what the owner asked for on 4 November 2026: the first day of the month at midnight, the default, to the people the sender chooses,
with the manual button kept beside it. The decision, and what it costs, is
[ADR-0015](../architecture/adr/0015-keep-a-small-state-file-for-recipients-and-the-schedule.md).

On the page. The *Schedule* button, beside *Email report*, opens one dialog that first reads the schedule and then is its form:

- a status line: *No schedule is set*, *The schedule is off*, *Next send: the report for November 2026, on 12/1/2026, 12:10:00 AM WIB* (the date is written as the browser writes dates, so the order of day and month follows its language), or *The report for October 2026 has not gone yet. The portal tries again at ...*;
- **Send the report every month** (the switch), **Day of the month** (1 to 28, so that every month has the day) and **Time of day**, in the report's time zone, with the note that the portal waits ten minutes after it so that Zabbix has the last values of the month;
- **Files**, **Send to** (the same saved list the *Email report* button starts with), and **Style** (the same three choices as the style dialog, saved with the schedule so that a change made in somebody's browser does not change it);
- **If a send fails, also tell**: up to three addresses;
- the last twelve sends, those made by hand and those made by the schedule, one line each, with counts and never an address.

*Save* sends it all in one request (`PUT /api/sli/schedule`). With the switch on, the box needs at least one address. With the switch off and the box empty, *Save* leaves the saved list as it was, so that turning the monthly send off does not make the portal forget the people (the owner's word, 9 November; tracker BK-41). The saved list can be read, changed and deleted in the *Saved list* view of the Email and Schedule dialogs (FR-31). Where the schedule cannot run, the dialog says why in a notice and shuts the fields and *Save*: email is not set up, `MAIL_SCHEDULE=off`, or the portal has no data folder to keep a schedule in.

What the portal keeps. One small file, `portal-state.json`, in the folder `PORTAL_STATE_DIR`, which the hosted compose file mounts as the named volume `portal-state` at `/data`. It holds the saved recipients, the schedule, and a record of the last 24 sends:
the month, how it was sent, how many people it reached, how large, how many tries, and a word for why it failed. It never holds an address in a record, a figure from Zabbix, a report or a password (the addresses are in the recipient list and in the people to tell). It is written whole to a temporary file and renamed, with mode 0600, one change at a time, and read at start: a file it cannot read is put aside as `portal-state.json.broken-<time>`, never deleted, and a part that is wrong is dropped with a line in the log. `docker compose down -v` deletes it.
**Copy it, or set the schedule again, when the portal moves to HCML's server.**

One portal for each state folder. The portal reads the file once, at start, and keeps its own copy in memory, so two portals on one folder overwrite each other's changes, and with the schedule on in both they would both send (tracker IN-63). A file that is there and cannot be read (the usual cause is a file put in as root, mode 0600) makes the portal say *cannot read its state file in its data folder* at start, and keep nothing across a restart until that is put right. The hosted compose file gives its portal its own volume. To put a saved file back, stop the portal, copy the file in as root and give it to the portal's user, and start it again: `docker compose stop portal-bff`, then `docker run --rm -v hcml-portal_portal-state:/data -v ~/hcml-backup:/backup:ro alpine sh -c 'cp /backup/portal-state.json /data/portal-state.json && chown 1000:1000 /data/portal-state.json && chmod 600 /data/portal-state.json'`, then `docker compose start portal-bff` (copying as user 1000 fails when the backup belongs to another user, IN-77). A file that the portal's user does not own has mode 0600 and the portal cannot read it: it then says that it cannot read its state file in its data folder, for example because the file belongs to another user, and keeps nothing across a restart until that is put right.

When it sends. Once a minute, and soon after the portal starts, the scheduler asks a pure planner (`server/src/sli/schedule.ts`) what is due. The report of a month goes on day *D* of the month after it, at the chosen time, plus ten minutes. A slot that came before the schedule was turned on, or before its day or time was changed, is never sent late. Nor is an older month whose slot came by while the portal was not running: it is recorded as *missed*, or as *failed* when a try was made and never ended, and the people to tell get one message that names every month that went by (BK-45). Only the newest month is sent. A month is sent once: each step is written to the state before the next, so a restart carries on. A send that fails is tried again after 15 minutes, an hour, and then every four hours, **for a week after its slot**. The people to tell get one message after the third failed try (*has not been sent yet*, with the reason, when it will stop trying and how to send by hand) and one when the portal gives up; a month the portal was not running for the whole week is marked *missed* and told once. They also get one message for a month that the mail server took for only some of the addresses. The page and the log say the same without anyone being told. It is **at least once**, not exactly once: a crash, or a stop that does not wait long enough (it waits five seconds), between the mail server taking the message and the record being saved, sends that month again. A save that fails while the portal keeps running does not: the portal remembers the month as taken, writes the log line first, and records it when the folder takes writes again (tracker BK-39). A stop (`docker compose stop`, a rebuild) stops the timers at once, so that no new check starts, and waits until five seconds after that for a send that is running to be recorded. The portal gives itself eight seconds to close in all, so a manual send still in flight then is cut off: its dialog says that the portal did not answer and that the report may or may not have gone. Changing the day, the time or the switch while a month is being tried gives that month up: its record says *not sent (the schedule was changed)* and nobody is told, since the person who changed it is there, so send it by hand. A notice goes through the same mail account as the report, so when the account is itself the problem (a revoked app password) the notice cannot get out either, and the page and the log are then the only places that say so. The people to tell are checked against the allowed domains again at each notice, in case the list of domains changed after they were saved. The record keeps 24 sends; past that a manual send goes first, so a busy week cannot make the portal forget a month it sent.

Where it runs. Only while the portal runs and can reach Zabbix. The portal's Mac sleeps, restarts, and is often off HCML's network, where every read of Zabbix times out: a send that was due while it slept is made when it wakes and reaches HCML's network, up to a week later, and the people who asked are told if it takes longer. The proper home for the schedule is HCML's server (IN-43). Two copies of the portal that both read the same Zabbix would both send: switch the one that must not with `MAIL_SCHEDULE=off`.

When the data folder stops taking writes. If it does so after the portal started (a full disk, a volume that went read-only), the portal cannot record a send, and a send it cannot record is not made. The dialog then says so, the log gets one error line (`report_state_unwritable`) for as long as it lasts, and the scheduler tries a write at each tick and goes on when the folder is back. The scheduler does one send at a time and has no deadline of its own: a read of Zabbix ends by `ZABBIX_TIMEOUT_MS` for each call, which is what stops a send that waits on Zabbix.

Checked. `sli-schedule.test.ts` holds the maths: the slot of every month, the planner's every case (early, on time, late, expired, retried, already sent, switched off, enabled after the slot) at the second. `report-schedule.test.ts` drives the scheduler with a fake clock, a real state folder and stand-in senders: that a month is sent once and survives a restart, the retry times, the notices, the week's end, every reason for a failure, one send at a time, the timers, a month the mail server took and the state could not record (it is recorded before the planner looks, whatever became of the schedule meanwhile), a stop while a send runs, and an address the mail server refused. `portal-state.test.ts` writes real files: the round trip, the file's mode, a half-written file, a folder that cannot be written, a file that cannot be read, a part that is wrong. `schedule-route.test.ts` and `mail-route.test.ts` hold the roles, the CSRF header, what is checked before anything is saved or sent, the log lines, and that a month nobody can report costs no allowance and no login. `shutdown.test.ts` closes a real server with a request in flight, to see the schedule paused when the close begins and waited for once the requests are drained. Each part of the code was broken on purpose to see a test fail, in two rounds, and again for each fix that followed. The breaks that no test catches change nothing a person can see: the `fsync` before the state file is renamed, the queue's second `then(run)`, which is the same call, the rollover from December in `slotFor`, which the year arithmetic reaches another way, a control character inside a domain of `MAIL_ALLOWED_DOMAINS`, which the same rule refuses earlier, the guards that skip a change of state after a dialog has gone (React 18 ignores one) and the order in which the page picks between two sentences of which only one can exist. On 10 November 2026 the stop and the refused address were also tried in a container (a throwaway of the live image, started with `--init` as production starts it, on a data volume with a schedule that was due, and a small mail server on the same Mac that holds the message open and refuses one address). A stop while the server answered within five seconds recorded the month as sent and left nothing to send again at the next start; a stop while it answered after twenty-five seconds cut the send off after five seconds, left the record 'sending' and sent the report again at the next start, as this section says; and the notice for the refused address carried the two numbers and no address. **Not checked on this day** is listed at the end of this section.

Not checked. A real mail server, in part. Gmail was reached on 9 November 2026: the login worked and two reports were accepted, and both landed in the recipient's spam folder (tracker IN-62). Yahoo, Zoho, iCloud and HCML's own were never reached, so their login, their
limits and where a first message from a new sender lands (inbox or junk) are unknown there. What a recipient's program shows
of the message and of the attachments. The TLS and STARTTLS paths against a public certificate: the tests trust their own. That the schedule has fired on a real first of the month: it has been driven by a fake clock, and on 4 November on two throwaways of the live image by setting it a few minutes ahead (one sent on time across a restart of the container; the other was stopped across its due time, started after it, failed once because its mail server was shut and sent on the retry; see the tracker). The two notices that wait for a third failed try were not seen on a real clock.
The `fsync` before the state file is renamed: no test can show it failing.

What it leaves out. A route for Microsoft 365
through Microsoft Graph, with an application limited to one mailbox, which waits for HCML's Microsoft 365 administrator. HTML mail, a copy to the sender, a different schedule for each recipient, a day past the 28th,
more than one schedule, and a report for a period that is not a month.
