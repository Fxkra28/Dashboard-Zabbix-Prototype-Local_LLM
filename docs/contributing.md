# Contributing

One rule governs all the others: **this is one source tree living in two folders.**

`hcml-portal` and `hcml-portal-ollama` hold the same `server/src`, the same `web/src` and the same
`scripts/`: byte for byte. The only difference between them is which model answers, and that is set
in an untracked `.env`, not in code ([ADR-0005](architecture/adr/0005-provider-neutral-ai-layer.md)).
Every change to shared code lands in both folders, in the same commit-shaped unit of work.

```bash
diff -rq -x node_modules -x dist -x .DS_Store -x '*.tsbuildinfo' -x .test-counts.json -x .git -x pic \
  ../hcml-portal ../hcml-portal-ollama
```

That must print exactly 22 differing files, all of them configuration or per-repo perspective,
and one more line, `Only in ../hcml-portal-ollama/docs: README_copy.md`. That file is a snapshot of
the ollama README from 23 September, kept for reference and not maintained. It sat in that folder's
root until 7 October 2026, where it made the count 22. Any other line means you changed something
in one folder and not the other. The full list of the 22 (18 files meant to differ and the four `.env*` files) is in both `README.md` files.

`node tools/check/parity.check.mjs` makes the same comparison with the allowed files written down
by name: 18 files, and the four `.env*` files, which it skips without opening. It prints one line
per difference outside that list and exits 1 if there is any. A file on the list that one copy
lacks is a difference too, and so is `README_copy.md` anywhere but `docs/` in the ollama copy.
No folder is on the list. `docs/flow/` and `docs/schema/` hold files that must match
(`ServerFlow`, `WebFlow`) beside files that differ, and only the ones that differ are named. In CI,
which holds one tree, it checks that every name on the list is a file in that tree, so a rename
cannot leave the list pointing at nothing, and then says it compared nothing.

The exclusions are not cosmetic. Every one of them is already in `.gitignore`, so none is a
divergence anyone can commit, but `diff` does not read `.gitignore`. Without them the number stops meaning
anything: the `.tsbuildinfo` files are written by whichever folder you last ran `npm run build` in,
so they differ whenever you have worked in one and not the other. `pic/` holds each copy's own
screenshots for the documents, one folder for each set (`pic/09`, taken on 8 October, and `pic/10`, retaken on 9 November). They differ by design,
and they show real host names, so they are never committed (the Code of Conduct below says why:
"Never commit estate data"). `parity.check.mjs` skips that one folder, at the root only.
`vite.config.js` is no longer
excluded. Builds used to write it next to `vite.config.ts`, and Vite loads the `.js` first, so a
stale one in one folder silently replaced that folder's real config. `tsconfig.node.json` now
writes it under `node_modules/.tmp`, and one that turns up beside the source shows here.

**Why not one repository with two deployment profiles?** It was considered (tracker IN-13): a
`deploy/hosted.env.example` and a `deploy/local.env.example`, with the local copy started by
`docker compose -p hcml-portal-ollama --env-file deploy/local.env up -d`, and the per-copy
documents kept as separate files. It was not done: on 7 October 2026 the owner accepted the
default of keeping two folders, because merging them changes how both live portals are built and
started. The parity script is the guard until then, and the price is unchanged: a fix is two
edits, two builds and two deployments. To revisit it, start from the 18 files the script lists:
they are what would become profile files.

---

## Code of Conduct

Be plain with each other, and precise about the machine. Beyond that, this project's conduct rules
are about the data, because the data is real:

- **The Zabbix instance is production.** HCML's 139 monitored hosts across 14 sites. Read-only API
  calls only, no create, no update, no delete, no acknowledge, no writes of any kind while
  developing. Alerting is disabled on that instance on purpose; leave it disabled. The BFF backs this
  up: with `AUTH_ENABLED=false` it refuses acknowledge and close unless `ALLOW_WRITE_WITHOUT_AUTH=true`
  is set, so leave that unset in a dev `server/.env`.
- **Never commit estate data.** No per-host output, no Availability Report spreadsheets, no database
  dump, no screenshots with real host names in them. A downloaded SLA report, PDF, Excel or CSV, is
  per-host output: it names every device. The one exception is [`screenshots/`](screenshots/README.md),
  where every name is replaced and every image is looked at before it is added.
- **Never commit a credential.** `.env` and `server/.env` are gitignored and must stay that way.
  `.env.example` is committed and must never hold a real value, not a Zabbix token, not an API key,
  not a password, not a `JWT_SECRET`.
- **If you find a credential in the history or in a file, say so immediately** rather than quietly
  removing it. It has to be rotated, not deleted.
- **Say when you do not know.** A guess written confidently is the most expensive thing anyone has
  contributed to this project so far. See *Numbers in documents*, below.

---

## Development Setup

Full instructions, including the Zabbix token and the Docker route, are in
[`getting-started.md`](getting-started.md). This section does not repeat them. The short version:

```bash
cd server && cp .env.example .env    # set ZBX_URL and ZABBIX_API_TOKEN
npm install && npm run dev           # BFF on :4000

cd ../web
npm install && npm run dev           # Vite on :5173, proxying /bff to :4000
```

You need Node 24 (`.nvmrc` names it, and `engines` in both `package.json` files allows 24 only: vitest and jsdom do not support 25, which npm reports as a warning and the tests still pass on; 24.15 is the oldest jsdom accepts without one), npm, and a reachable Zabbix 7.0. You do not need a database: there isn't one
([ADR-0003](architecture/adr/0003-no-database.md)), and you do not need a model endpoint unless you
are working on the plain-language layer.

---

## The checks

Fourteen committed checks, each one written because something specific broke. Run the ones your change
can affect; run all of them before you call a change finished: `npm run verify` at the repository root does
the typechecks, the lint, both test suites, both builds and every checker below (`npm run check` is the checkers alone).

| Check | Run it | What it exists to prevent |
|---|---|---|
| Tests | `npm test` in `server/` | 3097 tests, 122 files. The status-code semantics are pinned here: a rejected token is 503, never 502 or 504. The SLA report files are pinned here too: the tests read each PDF and workbook back, and compare the theme colours, the logo and the wording copied from the web app with their originals. Files that are not code are read as text too, because nothing else would notice them breaking: `docker-compose.yml` against the BFF's settings and the Dockerfile's build arguments, `nginx.conf`, and the CI workflow |
| Web tests | `npm test` in `web/` | 1844 tests in 119 files, in jsdom. They pin bugs that were found once: a slow answer for an old selection overwriting the new one, and, caught in review, sign-in returning to `/LOGIN` (the sign-in page again) and the wall bringing back a row marked "Cleared" after it had left the screen. Also the 401 handling and the CSRF header, and the report download buttons: one request however often they are pressed, and a month change dropping the request still in flight. Also the notices that say data is old (Zabbix stopped collecting, or a report is the last copy kept), the CSV formula guard, and the Assistant's conversation being cleared at sign-out |
| Lint | `npm run lint` in `server/` and in `web/` | The web: typescript-eslint, the two classic react-hooks rules and jsx-a11y. Three `eslint-disable` comments pointed at the hooks rule before anything ran it, and the first run found 14 form labels tied to no control. The server: the recommended rules of ESLint and typescript-eslint, no warning allowed. It had no linter until 19 October, when the first run found 22 findings; the eight `eslint-disable` lines left name their reason |
| Types | `npm run typecheck` in `server/` and in `web/` | Both check their test config too |
| API contract | `npm run check:api` at the root | The endpoint table drifted twice: it claimed 35 endpoints while listing all of them, and 23 of 35 line citations pointed at unrelated lines after the route files grew. A third hand-written list would drift the same way. The same check refuses a description that YAML cuts at a comma, and holds each GET route's query names (`singleValues` in `schemas.ts`) to the file's `in: query` parameters and their 400. The tests hold the answers to the file: the server's `openapi-contract.test.ts` asks for every operation against a made-up estate and checks the status and the body against the file, and the web's `openapiTypes.test.ts` holds the app's types to it (below) |
| Database ERD | `npm run check:erd` at the root | The database ERD exists twice, as `ERD-Database.mmd` and as `ERD-Database.erd`. Two hand-maintained copies of one model is the shape that has drifted every previous time here |
| Stylesheet | `node scripts/css.check.mjs` in `web/` (every part of `src/styles/`) | A lost `}` once left about 50 rules silently unapplied in one portal while the other looked fine. Vite's build fails on none of this |
| Design tokens | `node scripts/tokens.check.mjs` in `web/` (the parts of `src/styles/` read as one sheet) | The sheet held 42 padding values, 16 font sizes and 14 radii against 13 tokens, and three of its colours failed WCAG unnoticed: `--muted` sat 0.07 short of AA for as long as the file existed. Contrast is computed here, not asserted, so a token edited to an illegible colour fails instead of shipping |
| Parsers | `../server/node_modules/.bin/tsx scripts/markdown.check.ts` and `units.check.ts` in `web/` | The assistant's markdown renderer and the unit/duration formatters: standalone scripts, written before the web had a test runner |
| Links | `node tools/check/links.check.mjs` at the root | 41 relative links per copy had broken again after the ERD folder moved, 30 of them in `docs/erd/erd.md`. macOS resolves a wrong-case path, so the check matches each segment's exact spelling, and a link out of the repo fails, because a checkout does not have it |
| Facts | `node tools/check/facts.check.mjs` at the root | A count written once and never compared again: an endpoint table that said 35 while listing all of them, "13 read methods" in five documents when the code called 14, a glossary that said 11 ADRs beside 13 files, "18 route modules" beside 22, an endpoint table with no row for `/api/ready`, a table of Zabbix calls whose line numbers had moved, two card pages that said 104 and 167 cards beside 120 and 177. It reads the counts off the code and the sentences that state them off the documents, and leaves a line that tells of the past alone. It also reads the tracker as a table: ten cells in every row (a pipe inside a code span splits a cell, which went unseen for five days), a mark that fits its status, one row for each id, and totals that the rows bear out. It does not read what a sentence means, so a line citation that still exists but says something else is for a person |
| Diagrams | `node tools/check/diagrams.check.mjs` at the root | Nine renders in one copy and eight in the other were older than their sources by file date, and a file date is no use in a git checkout. Each `.mmd` now ends with a stamp holding the hash of its source, and the check fails when the source changed after it. It cannot see whether the render was redone: `node tools/check/diagrams.stamp.mjs` is where that is said, run last |
| Handbook | `node tools/check/handover.check.mjs` at the root | The handover handbook in `docs/handover/` falling behind the code: a generated block that no longer matches, a quoted snippet whose explanation was written against other code, a folder or a file with no description, and a page that breaks its writing rules. It was written to be true, and nothing else would keep it so |
| Copies | `node tools/check/parity.check.mjs` at the root | The two folders drifting: it lists every file that differs between them, or exists in one only, outside the short list meant to differ, which names its 18 files one by one. Until it existed the recipe above was a number someone had to remember, and `README_copy.md` had already made that number wrong once |

When a response in `docs/api/openapi.yaml` changes, run `npm run gen:api` in `web/` and commit
`src/generated/openapi.ts` with it. The web tests fail while that file is stale, and `npm run typecheck` fails when the
file says an answer can be something the app's own type (`web/src/types/`) does not accept: a field the app needs
and the file does not promise, a field the file allows to be absent or null, or a kind the app cannot hold. The error names the
place, such as `/api/hosts[].status`. It is one way: a field the file lists and the app ignores is fine. A new data
call in `web/src/api/` goes in the table at the top of `web/src/__tests__/openapiTypes.test.ts`, or that test fails.

`server/scripts/validate-sli.ts` is a fifteenth, but it is not part of the routine set: it needs
HCML's real Availability Report spreadsheets in `~/Downloads` (or `REPORT_DIR`) and a running BFF with sign-in off, since it sends no credentials. It compares the
derived SLA against HCML's own published figures, and it never runs in CI.

`.github/workflows/ci.yml` runs everything in the table above on push and pull request, as five jobs (server, web, checks, secret scan, images). It also
runs `npm audit --omit=dev --audit-level=high` in `server/` and `web/`, which fails on a high or
critical advisory in a package that ships, builds the web app (`tsc -b` also typechecks
`vite.config.ts`, which `npm run typecheck` never reaches), builds both Docker images without
pushing them, and runs `nginx -t` in the web image. CI holds one tree, so the parity check runs only
its own self-test there, and confirms that every file on its list exists: run the comparison on the machine that has both copies. The workflow has
not run on GitHub yet, so the image builds, `nginx -t` and the secret scan below are untested until it does.

Since 12 October 2026 (tracker SC-17) the workflow's token is read-only, and every action in it is pinned
to a full commit SHA, with the tag it came from in the comment after it: a tag can be moved to other code, a
SHA cannot. The `secrets` job runs gitleaks over the commits of each push and pull request. It does not
read the history already in the repository, so the token in `cb97069` does not fail it; revoking that token is
the fix. It posts no comments and uploads no findings, because on a public repository either would repeat what
it found, and manual runs skip it. `.github/dependabot.yml` opens a pull request a week for the actions, the
npm packages of `server/` and `web/` (minor and patch releases together, a major alone) and the base image of
each Dockerfile, which the digests would otherwise freeze. `ci-workflow.test.ts` fails on an action pinned any
other way. The SHAs and the gitleaks job have not run on GitHub yet (the account's billing lock, IN-30); the Dependabot file has, and its 15 pull requests are open.

Run the same scan before a commit, on the files that would be pushed and not on the ignored ones, so that a new test string that looks like a key is found here and not by the first push (IN-72). A made-up value that must stay is named by its own text in `.gitleaks.toml`, with a comment. The `|| [ $? -eq 23 ]` lets a file that is tracked and deleted in the working tree pass: rsync stops at it with that code, and the scan would otherwise be skipped.

```bash
tree=$(mktemp -d) && git ls-files -z --cached --others --exclude-standard | { rsync -a --from0 --files-from=- ./ "$tree/" || [ $? -eq 23 ]; } \
  && docker run --rm -v "$tree":/repo zricethezav/gitleaks:latest detect --no-git --source /repo --config /repo/.gitleaks.toml --redact --no-banner -v; rm -rf "$tree"
```

### Writing a new checker

Follow the eleven that exist. The house pattern, in order of how often it has mattered:

1. A self-test over fixtures, before it touches a real file. `openapi.check.ts`,
   `css.check.mjs` and `tokens.check.mjs` all do this. A checker that has never failed has never
   been tested, and this is not a formality: `tokens.check.mjs` failed its own first run because the
   expected contrast in one fixture was wrong, which is exactly the arithmetic the checker exists to
   stop anyone doing by hand.
2. A header comment naming the regression it prevents: the specific one, with what it cost.
3. Zero npm dependencies. See below.
4. `console.error` per problem, then a count, then an explicit `process.exit(1)`.
5. Read-only. A check that can write is a migration.

---

## Zero new dependencies

9 runtime + 9 dev on the server, 5 + 18 on the web: 41 in all, 14 of them shipped. Adding to either
list needs a real argument, not a convenience one. Two were added on 19 October 2026, both dev only and never in
an image: the server's four lint packages (`eslint`, `@eslint/js`, `typescript-eslint` and `globals`, ST-06), and the web's
18th, `openapi-typescript` (FR-16),
a web dev dependency that never reaches the built site. It turns `docs/api/openapi.yaml` into
`web/src/generated/openapi.ts`, and reading OpenAPI properly is what a library is for; the hand-written YAML scan
of `openapi.check.ts` is not up to it. The server's contract test needed a YAML parser and a validator and added
neither: `npm run gen:api` also writes `web/src/generated/openapi.json` with the parser openapi-typescript ships,
and the test reads that copy with the Ajv Fastify already runs on. One runtime library has been added for a feature: `nodemailer`, the server's ninth, on 4 November 2026 ([ADR-0014](architecture/adr/0014-email-the-sla-report-through-smtp.md); the report writers stay hand-rolled).

Two precedents set the bar: `validate-sli.ts` hand-wrote a
zip reader rather than add an xlsx parser, and `openapi.check.ts` hand-wrote a YAML path extractor
rather than add a YAML parser. Both are about twenty lines. Both are still correct.

The PDF and Excel writers are the next precedent, and a far larger one. `server/src/export/` writes
the SLA report as a PDF and as a workbook with Node's `zlib` and `crypto` modules and no library. The
PDF writer alone is roughly 800 lines.
[ADR-0011](architecture/adr/0011-build-the-sla-report-files-in-the-bff.md) records what that costs:
the project now owns two file formats, their limits and every reader's quirks. Read it before
reaching for a library, or for a third hand-written format.

The handbook tools in `tools/handover/` add nothing to either list: they read the code with the `typescript` package the server already has installed, which the CI job for the checks installs too.

Deliberately absent: no ORM or database driver (the
portal owns no database; the hosted copy keeps one small file of its own, ADR-0015), no state-management library (server state is two small hooks), no component
library, no PDF or spreadsheet library, and no second HTTP client: the Zabbix client and the model
client are both hand-rolled around native `fetch`.

---

## Design

`DESIGN.md` at each repo root is the design direction: identity, palette, typography, mood. It is the
portal owner's, and it is the input to every visual decision. The antislop rules (not kept in this repository) are the filter that checks
work against it. The two are not interchangeable, and a filter never supplies taste.

Colours, spacing, type sizes, radii and elevation all come from the tokens in
`web/src/styles/01-tokens.css`. Reaching past it to a raw value fails `tokens.check.mjs`, which is the point:
dark mode works only because every colour resolves through a token, so one hardcoded hex is one
element that stays light on a dark page.

The exception is a canvas. ECharts cannot resolve `var()`, so `TimeSeriesChart.tsx` reads the tokens
with `getComputedStyle` at render time, and calls `useThemeChange` so a theme switch renders it again.
Anything else drawn to a canvas has to do the same.

## Diagrams

The Mermaid sources in [`schema/`](schema/), [`flow/`](flow/) and [`erd/`](erd/) each have a committed
render beside them. After editing a `.mmd`, **re-render and check the picture, not the source.** The
tested `mermaid-cli` invocation is in each folder's README, along with the rules that were learned by
breaking them: an unfilled subgraph frame, no bare `%%`, no numeric HTML entities in labels.

When the render is done, run `node tools/check/diagrams.stamp.mjs` from the repo root. It sets the
last line of each `.mmd` you changed to `%% source-hash:` and the hash of the source, and refuses a
source whose PDF is older than it. `node tools/check/diagrams.check.mjs` fails, in CI too, on a source
edited after its stamp. A comment-only edit that cannot change the picture takes `--force`.

Count that each lane still reads in order and that no box has lost an edge. A Mermaid diagram that
parses is not a Mermaid diagram that is readable.

---

## Decisions

A decision that shapes the system gets an [ADR](architecture/adr/): MADR format, the next number in
sequence, from the template the existing thirteen follow. Record what was considered and rejected, and
record at least one negative consequence: an ADR with only upsides is a press release.

Write one for: a technology choice, an architectural pattern, anything with a real trade-off,
anything the team needs to agree on. Do not write one for: naming, formatting, a config tweak, or
anything you could reverse in an afternoon.

---

## Numbers in documents

The recurring failure in this project is confident documentation that nobody checked. A sentence
claiming some deleted scripts were recoverable from a particular commit was repeated into four
documents until it read as established fact; the scripts had never been tracked. An endpoint count was
wrong in a summary for a week while the table beneath it was right.

So, when you write a figure down:

- Date it and name where it came from. "139 monitored hosts" is a measurement, and measurements
  have a timestamp.
- Say "reconstructed" when it is. `setup.md` §§27 to 29 are marked that way because they were
  rebuilt from other sources, not restored from the original.
- Prefer a check to a promise. If a number can be compared with the code by a script, write the
  script. That is why `openapi.check.ts` exists.
- `ls` and `test -e` lie on APFS, which is case-insensitive. Only `os.listdir()` gives you the
  true case of a filename. A link that resolves on this laptop can 404 on a Linux CI runner.
