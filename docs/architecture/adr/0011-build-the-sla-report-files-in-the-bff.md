# Build the SLA report files in the BFF, with hand-written PDF and Excel writers instead of a library

* Status: accepted
* Deciders: HCML internship project
* Date: 2026-10-01

## Context and Problem Statement

The SLA page shows the month's availability, and nothing takes it off the screen as a file. HCML
publishes its own monthly Availability Report as a workbook. A PDF can be printed or attached to an
email, and an Excel file can be sorted and totalled. `setup.md` §27 listed a scheduled PDF export as
the part of Goal 6 (automated reporting) that was not built.

Should the portal hand the month over as a file, where should that file be made, and with what?

## Decision Drivers

* The file must carry the figures the SLA page shows, both methods, and not a second calculation that
  could disagree with the screen.
* The files are printed and attached to emails, so they need a fixed page and the light colours,
  whatever theme the reader's screen uses.
* The dependency rule in [`contributing.md`](../../contributing.md), *Zero new dependencies*: 35
  direct dependencies when this was written (40 on 20 October 2026, after the server's linter and the OpenAPI
  types, which are dev tools; 13 shipped then and now), and each addition needs a real argument. A runtime
  dependency in the BFF also enters the image and the `npm audit` that CI runs on what ships.
* No database ([ADR-0003](0003-no-database.md)) and no write to Zabbix
  ([ADR-0006](0006-read-only-with-one-write.md)): a file is built per request and kept nowhere.
* A scheduled or emailed report is the rest of Goal 6. Nothing in a browser runs when nobody has the
  page open, so whatever is built now should be usable from the server.
* The BFF image is built from `server/` alone, so `web/public` is not in it.

## Considered Options

* A PDF library and a spreadsheet library in the BFF. Two packages from npm, one per format.
* Write the files in the browser, with a library. The SLA page already holds both methods'
  figures.
* Hand-written writers in the BFF, on Node's own `zlib` and `crypto` modules.

## Decision Outcome

Chosen: **hand-written writers in the BFF.**

* `GET /api/sli/export?month=YYYY-MM&format=pdf|xlsx` reads both methods, `availability` and
  `hcml-report`, through `getMonthlySli`, the cache `/api/sli` fills, and builds the file from them,
  reusing a built file for ten seconds. It is a viewer route, works with the session cookie or a Bearer
  token, and keeps nothing longer. The file name comes from the validated month alone, and the answer is
  `Cache-Control: private, no-store` and is never compressed.
* `slaReport.ts` turns the two reports into one document model (`types.ts`): key figures, one bar
  chart, six tables and two notes. `pdf.ts` and `xlsx.ts` turn that model into a file and know nothing
  about SLAs, targets or Zabbix, so the two files cannot say different things. A third format would
  be a third writer.
* The PDF is A4 landscape, written by hand with the standard Helvetica fonts and no embedded font, so
  there is no font file to ship. The workbook is SpreadsheetML written by hand and packed by a small
  zip writer (`zip.ts`). Every text in it goes through the shared-string table, so a device named
  `=HYPERLINK(...)` stays a name and is never evaluated.
* Three things are copied from the web app, because the BFF cannot import the browser bundle or
  `web/public`: the light-theme colours (`theme.ts`), the logo (`logo.ts`, as base64) and the SLA
  page's wording. A test fails when a copy drifts: `export-theme.test.ts` compares every colour with
  `web/src/styles/01-tokens.css`, `export-pdf.test.ts` compares the logo byte for byte, and `export-sla-report.test.ts`
  reads the page's source for the sentences. Reports always take the light theme.
* In the browser, `ReportDownload.tsx` shows the two buttons, *PDF report* and *Excel report*, on the
  SLA page and, for one calendar month on the ICMP basis, on the Availability page. It fetches the
  file and saves it under the name the BFF sent.

Verified by the `export-*.test.ts` files in `server/src/__tests__/` and by
`web/src/features/sla/ReportDownload.test.tsx` and `web/src/__tests__/reportApi.test.ts`. The server tests read the
PDF back (cross-reference table, page tree, bookmarks that point at real pages, every text inside its
margin and its column) and unzip the workbook (every part listed and present, relationships, style
ids, element order). They give both writers hostile names: a leading `=`, `+`, `-` or `@`, a literal
`_x0041_`, characters XML 1.0 forbids, and a name too long for its column. The same document and time
give the same bytes. The route tests run behind the production plugin order (helmet, CORS,
compression, the error handler) and check that the file is left untouched and keeps its download
headers. The web tests cover the buttons: one request however often they are pressed, a failure
named by format, and a month change dropping the request still in flight.

By hand, the PDF was checked with `pdfinfo`, `pypdf` in strict mode and a visual review of each page,
and the workbook with `openpyxl`'s strict reader, macOS Quick Look and a check of element order
against the schema. The workbook has not been opened in Microsoft Excel, and neither file has been
run on HCML's own data, because Docker was down. Later both were downloaded from the running portal on
HCML's restored data (12 October: size, pages and sheets read; 15 October: a 200 in the BFF log); the
workbook still has not been opened in Microsoft Excel. On the test report (138 devices, 14 sites) the PDF
is about 10 pages and 69 KB and the workbook about 23 KB. In a fresh process the first PDF took about
60 ms and later ones about 10 ms, measured on 2 October 2026 on the development laptop.

### Positive Consequences

* No new dependency. The BFF still has 8 runtime dependencies (the same on 20 October 2026). Nothing more to install, audit or
  update, and no font in the image.
* The figures cannot disagree with the page. Both read the same cached reports, and the report's
  wording is tested against the page's. A month already loaded on the SLA page costs no further
  Zabbix call.
* One model, two files. The PDF and the workbook say the same thing by construction, and a
  change to a table is made once.
* A script gets the same file. The work is in the BFF, so `curl` with a Bearer token fetches it,
  and a scheduled or emailed report, if HCML asks for one, can reuse the writers.
* The bytes repeat. The same document and time give the same file, so tests compare files
  instead of looking at them.
* Hostile names stay inert. Every cell is text and never a formula, so a device named
  `=HYPERLINK(...)` cannot run in Excel.

### Negative Consequences

* **The project now owns two file formats.** The PDF writer is roughly 800 lines and the workbook
  writer roughly 650, with a zip packer and a font-width table beneath them, where a library would be
  one line in `package.json` each. Every reader's quirk is ours to find, and nobody upstream fixes it.
* **Not proven in Microsoft Excel.** Excel is stricter than the readers the workbook was checked
  with, and a mistake in element order makes it offer to repair the file. The writer follows the
  schema's order and a test pins it, but the first real open could still find something.
* Checked on test data only. The 138 devices are made up, in the shape of the production report.
  Real names that are longer, odder or in another script could be cut or printed differently.
* The PDF is Western European letters only. It embeds no font, so other scripts print as `?`, and
  a name too long for its column is cut with an ellipsis, after the columns have been sized to the
  content. It is not PDF/A and not tagged for screen readers. A library that embeds fonts would
  cover other scripts.
* Three copies to keep in step. The colours, the logo and the page's wording are copied, and the
  logo is a 34 KB PNG written out as base64 in a TypeScript file. Tests fail when a copy drifts, so a
  rebrand or a rewording means a second edit and a regenerated file.
* Synchronous work on the event loop. Both writers compress with `zlib`'s synchronous calls, and
  the BFF answers nothing else while one runs. At 138 devices that is tens of milliseconds. It grows
  with the number of rows. A built file is reused for ten seconds, so a burst of requests for one
  month and format costs one build and the work is bounded at one build per month and format every
  ten seconds. Beyond that the per-IP rate limit is the only limit.
* A file can be built from old figures. The cache `/api/sli` fills serves its last good run while
  Zabbix is failing, and the answer is still a 200. A file for a month still running states how far
  its figures run, but the status code does not say that they are old.
* A group row's downtime adds up all its devices, including devices with too little data to
  score, which are left out of the group's average. `aggregate()` in `server/src/sli/engine.ts` does
  this and the SLA page shows the same sum, so a group's downtime and its SLA do not always describe
  the same devices. The report's notes say that a group row adds up all its devices.

Not done when this was written: a scheduled report, which would need HCML to say who gets it and when, a mail
relay or a folder to write to, and somewhere for the schedule to live, while the portal keeps nothing
([ADR-0003](0003-no-database.md)). Goal 6 stays partial. An emailed report, on an administrator's request, was added on
4 November 2026: see [ADR-0014](0014-email-the-sla-report-through-smtp.md). Also not done then: a CSV file of this report (other pages have one: Alert noise, the Inventory scorecard and, since
19 October 2026, the Graphs page's Show data), a chart in the
workbook, fonts beyond Western European letters, and an export of any page but the SLA report. The
Availability page's buttons download this report, not that page's own table. Amended 9 November 2026: the scheduled report and the CSV file were built on 4 November 2026 (tracker IN-59 and FR-27, [ADR-0015](0015-keep-a-small-state-file-for-recipients-and-the-schedule.md)).

## Pros and Cons of the Options

### A PDF library and a spreadsheet library in the BFF

* Good, because the details of both formats would be someone else's solved problem, and a library
  that embeds fonts would print any script.
* Good, because there would be far less code to own here.
* Bad, because the BFF's runtime dependencies would go from 8 to at least 10, in the image and under
  `npm audit`, with whatever each package pulls in.
* Bad, because `contributing.md` asks for a real argument for each new dependency, and the project
  has so far hand-written what it could instead: a zip reader and a YAML extractor. This comparison
  rests on that rule, not on a measurement of any library.

### Write the files in the browser, with a library

* Good, because the page already holds both methods' figures, so the BFF does no extra work and the
  file matches the screen by construction.
* Bad, because it adds a runtime dependency to the web app and ships its code to the browser, for
  something only some visits use.
* Bad, because it works only with a browser open. A script cannot fetch the file, and a scheduled or
  emailed report would need a second implementation on the server.

### Hand-written writers in the BFF

* Good, because it adds nothing to either `package.json`, and the page, a script and a later
  schedule all get the same file.
* Bad, because the project owns the formats, and every limit above is ours to fix.

## Links

* Follows [ADR-0004](0004-derive-the-sla-in-the-portal.md), whose figures it prints, and
  [ADR-0003](0003-no-database.md), which is why the files are built per request and kept nowhere
* The dependency rule: [`contributing.md`](../../contributing.md), *Zero new dependencies*
* `setup.md` §18 *The SLA report as a file*; `server/src/routes/sliExport.ts`, `server/src/services/sliExport.ts`, `server/src/export/`,
  `web/src/features/sla/ReportDownload.tsx`
* Contract: [`../../api/openapi.yaml`](../../api/openapi.yaml) → `GET /api/sli/export`
