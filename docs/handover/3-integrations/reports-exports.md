# Report files

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators and developers | about 15 min | [Sign-in](sign-in.md) | [Operations](operations.md) |

## What it is for

The portal hands a month over as a file: a PDF to print or attach to an email, an Excel workbook to sort and total, and a zip of CSV files for a script or a spreadsheet that wants plain numbers. The files hold the figures the SLA page shows, with both methods side by side, and each is built when asked, from the figures already in the server's memory, and kept nowhere. A *Number and date style* button chooses how percentages and dates are written (a dot or a comma, three date shapes, and a comma or a semicolon between the fields of a CSV file) and never changes what a figure says. That is the part of HCML's automated reporting goal that is built. An administrator can also email the files, by hand or by a schedule that sends them by itself on a day of each month (see below).

The files are written by hand, with nothing but Node's own modules: no PDF library and no spreadsheet library ([decision record 11](../../architecture/adr/0011-build-the-sla-report-files-in-the-bff.md) has the reasoning and the price, which is that the project now owns two file formats and every reader's quirks).

## What the portal sends, and what comes back

`GET /api/sli/export?month=YYYY-MM&format=pdf`, `format=xlsx` or `format=csv`. The format is required, and a missing or unknown one is a 400. The month is optional, and is the current one in the reporting time zone when missing. Three style options, `decimal`, `date` and `separator`, are optional too. The format is checked before Zabbix is asked anything, so a bad request costs nothing, and any other parameter is a 400, because a misspelt `month` would otherwise be ignored and the current month served in its place.

The route reads both methods through the same cached function the page uses, so a report the page already loaded is not computed again. It answers with the file and these headers:

| Header | Value | Why |
|---|---|---|
| `Content-Type` | `application/pdf`, the Excel type or `application/zip` for the CSV files | |
| `Content-Disposition` | An attachment named `HCML_SLA_Report_2026-08.pdf`, `.xlsx` or `_csv.zip` | The name comes from the validated month alone, so no request text reaches a header |
| `Content-Length` | The size | |
| `Cache-Control` | `private, no-store` | A closed month never changes and the current one does, and the file is for the person who asked |

A build costs about ten milliseconds of processor time, and a burst of requests would run them back to back with the whole server waiting. So repeats inside ten seconds share one file. The file is keyed on the two cached reports themselves, so a refreshed report starts a new file and nothing outlives them.

## What is in the file

The PDF opens with the overall figures and a bar chart of the SLA by site against the target. After that come tables by category, by site and by device, the WAN paths, the web checks, and the devices never measured, then two notes: how to read the report, and how it was computed. The Excel workbook has a Summary sheet, set to print on one page, and one sheet for each table, with percentages and durations stored as numbers so they sort and total. The durations carry a format that shows hours over a hundred without wrapping at a day.

Both always use the light colours, because they are printed and sent by email, whatever theme the reader's screen is in.

## How it is built

| Step | What | File |
|---|---|---|
| 1 | Both reports are read, strict and HCML's method | `server/src/services/sli.ts` |
| 2 | They become one document: tables, figures, bars, tones and notes, as a pure function with no Zabbix, no settings and no clock but the one it is given | `server/src/export/slaReport.ts`, `server/src/export/types.ts` |
| 3 | The document becomes a PDF 1.4 file: A4 landscape, the standard Helvetica fonts so nothing is embedded, the whole layout done first so "Page x of y" is known, the logo read from an embedded PNG | `server/src/export/pdf.ts`, `pdfFonts.ts`, `logo.ts` |
| 3 | Or an Excel file: SpreadsheetML written by hand, every string through the shared string table, so a device named `=HYPERLINK(...)` stays text and is never evaluated, and the parts in the order the schema wants, because Excel repairs a file that breaks it | `server/src/export/xlsx.ts`, `zip.ts` |
| 4 | The route sends it | `server/src/routes/sliExport.ts`, `server/src/services/sliExport.ts` |

The wording of the report is the SLA page's own, copied, since the browser's bundle cannot be imported on the server, and `export-sla-report.test.ts` fails when a copied sentence drifts.

## The page's side

`web/src/features/sla/ReportDownload.tsx` shows the three file buttons, PDF, Excel and CSV (the style button beside them opens the number and date choices). It fetches the file with an ordinary request, and hands it to the browser through a throwaway link that carries a name, since a blob has no name of its own. It revokes the link after 40 seconds, because Firefox and Safari can cancel a save whose address is revoked at once. It gives up after 440 seconds, a little under the page's own limit of 450 seconds for an SLA read, so the buttons never stay shut for good. It says the file is ready for six seconds. The file always holds both methods, so the toggle beside the buttons does not change it. The SLA page offers the buttons on its derived monthly view. The Availability page offers them only when the period is one calendar month on the strict basis, since a rolling window has no month to report.

The Graphs page has its own download, the points of Show data as a CSV file. Every CSV in the app goes through one writer, `web/src/shared/lib/csv.ts`, which guards against spreadsheet formulas: a text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a quote put in front of it, so that a spreadsheet reads it as text. A number is never changed, because its minus is a real sign.

## What to know

- **The files name every device.** Treat a downloaded report as estate data. It is never committed: the repository ignores any file whose name starts `HCML_SLA_Report_`.
- **Non-Latin text prints as `?` in the PDF**, because it uses the standard fonts. Cyrillic or Chinese device names would be lost there and kept in the Excel file.
- **The CSV is a zip, not one file,** because the report is several tables: a summary, a file for each table and a notes file. A missing figure is a blank in it, never a zero, and a name that starts with `=`, `+`, `-` or `@` has an apostrophe put in front so a spreadsheet does not run it. If Excel puts every row in one column, use the other separator.
- **What Excel shows.** The August workbook, built from HCML's restored data, was opened in Microsoft Excel on 26 October 2026 with no repair prompt, and its render was read page by page. Two small faults it showed were fixed that day. What Excel shows for a download from the live portal itself has not been seen.
- **A closed month is computed again after a restart**, since nothing is stored.

## Emailing a report

An administrator can send a month's report to people they choose, in the copy that uses Claude only: the other copy passes none of the mail settings to its container, so that nothing leaves the machine there. The *Email report* and *Schedule* buttons sit beside the download buttons, show only to administrators and only when email is set up. *Email report* opens a dialog that names the month and the sender and asks for the files (PDF, Excel, a CSV zip; several go in one message), for the addresses (a box that starts with the saved list; up to ten, in the allowed domains if the settings name any) and whether to keep the list for next time. The style comes from the *Number and date style* button.

The settings are the `MAIL_` variables in the root `.env`; [section 18 of the setup guide](../../setup/18-automated-reporting.md) has the table. `MAIL_PROVIDER` picks a preset (`gmail`, `yahoo`, `zoho`, `icloud`) or `smtp` for a server of your own. `MAIL_TO` is only the list the portal starts with and may be blank. `MAIL_ALLOWED_DOMAINS` limits where a report may go, and `MAIL_SCHEDULE=off` keeps the monthly send from running on a machine. With the provider settings blank, email is off and the buttons are not offered. With one that cannot be used, email stays off and the start-up log says which, without the password.

| Step | What | File |
|---|---|---|
| 1 | The settings become one checked object, with the reasons when they cannot be used | `server/src/core/mailConfig.ts`, read by `server/src/core/config.ts` |
| 2 | The addresses typed are checked by one set of rules | `server/src/core/recipients.ts` |
| 3 | The route checks the body, the settings, the month, the formats, the style and the recipients, and a month that ended less than ten minutes ago is refused, as the monthly send waits for it too, then the allowance of five sends an hour for each person | `server/src/routes/sliMail.ts`, `server/src/security/mailLimit.ts` |
| 4 | The mail login is tried first, so a wrong password fails in a second | `server/src/services/sliMail.ts` |
| 5 | The two reports are read, each file is built by the function the download uses, and the message is written from the first-page figures of the same document | `server/src/services/sliMail.ts`, `server/src/services/sliExport.ts` |
| 6 | `nodemailer` sends one message with all the files over TLS or STARTTLS, and a failure becomes one fixed sentence for its kind | `server/src/clients/mail.ts` |
| 7 | One log line says who sent which report to how many people and which domains, and a short record of the send is kept | `server/src/security/audit.ts`, `server/src/services/mailState.ts` |

`nodemailer` is the library added for email, and it has none of its own to bring. The PDF, Excel and CSV writers need no library.

Which accounts work: any whose provider lets an application log in with a name and a password. Gmail, Yahoo, Zoho and iCloud do, with an app password. Outlook.com, Hotmail and Microsoft 365 do not, in general: Microsoft asks for OAuth2, and for Microsoft 365 the password login is turned off by default for existing tenants at the end of December 2026. HCML's own mail is on Microsoft 365, so sending through it waits for a route through Microsoft Graph. That route is not built, and it needs an application registered by HCML's Microsoft 365 administrator and limited to one mailbox.

What to know about it:

- **The message carries the whole report.** It names every device, and once it is in a mailbox the portal's roles no longer protect it. Use a mailbox made for the portal, not a personal one.
- **A stolen administrator session can send the report to an address of its choice, five times an hour, unless `MAIL_ALLOWED_DOMAINS` names the domains.** That is the price of choosing the addresses on the page. The portal warns at start-up while the list is empty. Set it.
- **One real mail server has been reached, and the reports landed in spam.** On 9 November 2026 Gmail accepted the login and two reports, and both landed in the recipient's spam folder (IN-62). Yahoo, Zoho, iCloud and HCML's own were never reached. The tests use a small mail server on the loopback address.
- **The page says what happened in one sentence,** and the log keeps what the mail server said, with the login and the password taken out.

## The monthly send

An administrator can set the report to go by itself: a day of the month (1 to 28) and a time, the files, the people, the style, and up to three people to tell when a send fails. The default the owner asked for is the first of the month at midnight. The *Schedule* dialog shows when the next send is, and the last twelve.

How it works, in short. Once a minute a scheduler inside the server asks a small pure function what is due: the report of a month goes on the chosen day of the month after it, at the chosen time, plus ten minutes for Zabbix to hold the last values. A send that fails is tried again after 15 minutes, an hour, and every four hours for a week, and the people to tell get one message after the third failure, one when the portal gives up, one if the portal was not running for the whole week, one that names every older month it skipped because it was off when the slot came (BK-45), and one if the mail server refused some of the addresses of a send that went. Each step is written to the portal's small state file first, so a restart carries on, and a month is sent at least once. [Decision record 15](../../architecture/adr/0015-keep-a-small-state-file-for-recipients-and-the-schedule.md) has the reasons and the price.

What to know about it:

- **It needs a place to keep the schedule.** The hosted copy's compose file mounts a volume for `portal-state.json`. Without it the dialog says the schedule cannot be used, and refuses to save one that would not survive a restart.
- **It runs only while the portal runs and can reach Zabbix.** The Mac the portal runs on sleeps and leaves HCML's network, so a send may be made hours or days late; after a week it is marked failed, or missed if the portal never started a try. HCML's server is the proper home (IN-43).
- **At least once, not exactly once.** A crash at the wrong moment sends a month twice.
- **Move it with the portal.** Copy `portal-state.json` to the new volume, or set the schedule again, and switch the old one off with `MAIL_SCHEDULE=off` so that two portals do not both send.
- **It has not fired on a real first of the month.** It was driven by a fake clock in the tests, and in a browser on a throwaway by setting it a few minutes ahead.

## How to check it

`tools/live/download-check.mjs` clicks the PDF and Excel buttons (and, given a graph, the CSV button) in a browser, and says whether each file arrived, how many rows and columns a CSV has, and whether the page logged a content-security violation. `tools/live/signedin_check.py` downloads both files. The mail code is held by `mail-config.test.ts`, `mail-config-wiring.test.ts`, `mail-recipients.test.ts`, `mail-client.test.ts`, `mail-route.test.ts`, `mail-service.test.ts` and `mail-limit.test.ts` on the server, and the schedule by `sli-schedule.test.ts`, `report-schedule.test.ts`, `portal-state.test.ts` and `schedule-route.test.ts`. The CSV writer and the style have `export-csv.test.ts`, `export-style.test.ts` and `export-sla-report-style.test.ts`. In the web app `EmailReport.test.tsx`, `ReportSchedule.test.tsx`, `ReportStyleButton.test.tsx` and `reportStyle.test.ts` hold the dialogs. The writers have their own tests with a made-up report of 14 sites and 138 devices, built to hold awkward values: a name that starts with `=`, one with markup, one far too long for its column, and accents.

## Where the code is

| What | File |
|---|---|
| The route and the file cache | `server/src/routes/sliExport.ts`, `server/src/services/sliExport.ts` |
| The document and the writers | `server/src/export/` |
| The buttons | `web/src/features/sla/ReportDownload.tsx` |
| The email button and its dialog | `web/src/features/sla/EmailReport.tsx` |
| The schedule dialog | `web/src/features/sla/ReportSchedule.tsx` |
| The style button and the shared dialog frame | `web/src/features/sla/ReportStyleButton.tsx`, `web/src/features/sla/ReportDialog.tsx` |
| Emailing: the settings, the route, the service and the client | `server/src/core/mailConfig.ts`, `server/src/core/recipients.ts`, `server/src/routes/sliMail.ts`, `server/src/services/sliMail.ts`, `server/src/clients/mail.ts` |
| The monthly send: the planner, the scheduler, the state and the routes | `server/src/sli/schedule.ts`, `server/src/services/reportSchedule.ts`, `server/src/core/state.ts`, `server/src/routes/sliSchedule.ts` |
| The CSV zip and the style | `server/src/export/csv.ts`, `server/src/core/reportChoices.ts` |
| The CSV writer | `web/src/shared/lib/csv.ts` |
| The test document | `server/src/__tests__/helpers/docFixture.ts` |
