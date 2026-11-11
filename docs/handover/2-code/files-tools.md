# Tools files, one card each

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 5 min | [Web app files, one card each](files-web.md) | [The A to Z index of names](symbols.md) |

Every file of the checkers, the handbook generator and the other tools has one card on this page, 25 in all, grouped by folder and in alphabetical order. A card is the file in a few lines. The sentence under its heading says what the file is for and where the handbook walks through it, and a person wrote it. The block below that sentence is written by `npm run handover:build` from the code, so it cannot drift: the file's size, its exports with the first sentence of each comment, what it imports, who imports it, and which tests import it.

Use the page when you know a file name and want to know what it is for and what would be hit if you changed it. The A to Z index of every name is [the symbols page](symbols.md). The same cards for the server and for the web app are [Server files](files-server.md) and [Web app files](files-web.md).

## `deploy`

### `deploy/rebuild.sh`

Rebuilds both portals from the commit, checks their settings first, tags the old images, and checks the new ones. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card deploy/rebuild.sh -->
322 lines, 0 exports. Imported by 0 files.

Imports: none

Imported by: none
<!-- /gen -->

### `deploy/watch.sh`

Checks that the portals and their containers answer and tells you when they do not; meant to run from a timer. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card deploy/watch.sh -->
401 lines, 0 exports. Imported by 0 files.

Imports: none

Imported by: none
<!-- /gen -->

## `tools/check`

### `tools/check/diagrams.check.mjs`

Fails when a diagram source changed after the stamp of its render, or a render has no source. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card tools/check/diagrams.check.mjs -->
136 lines, 8 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `STAMP_PREFIX` | constant | 29 | `const STAMP_PREFIX` |  |
| `bodyOf` | function | 33 | `function bodyOf(text)` | The source as it is hashed: LF line ends, no stamp line, exactly one final newline. |
| `hashOf` | function | 38 | `const hashOf = (text) =>` |  |
| `stamped` | function | 41 | `function stamped(text)` | `text` with its stamp set to the hash of the rest, as the last line. |
| `stampState` | function | 48 | `function stampState(text)` | What the stamp in `text` says: 'fresh', 'stale' (edited since), 'unstamped' or 'duplicated'. |
| `filesEndingIn` | function | 58 | `function filesEndingIn(root, endings)` | Every file under `root` whose name ends in one of `endings`, as absolute paths. |
| `checkDiagrams` | function | 75 | `function checkDiagrams(root)` | The problems under `root`, one line each, and how many sources were looked at. |
| `selfTest` | function | 96 | `function selfTest()` | The self-test: a stamp that can never fail checks nothing. |

Imports: none

Packages: `node:crypto`, `node:fs`, `node:path`, `node:url`

Imported by: `tools/check/diagrams.stamp.mjs`
<!-- /gen -->

### `tools/check/diagrams.stamp.mjs`

Writes the stamp on a diagram source after its picture was re-rendered. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card tools/check/diagrams.stamp.mjs -->
46 lines, 0 exports. Imported by 0 files.

Imports: `tools/check/diagrams.check.mjs`

Packages: `node:fs`, `node:path`, `node:url`

Imported by: none
<!-- /gen -->

### `tools/check/erd.check.ts`

Fails when the two forms of the database diagram disagree. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card tools/check/erd.check.ts -->
280 lines, 6 exports. Imported by 0 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Column` | interface | 37 | `interface Column` |  |
| `Relation` | interface | 42 | `interface Relation` |  |
| `Model` | interface | 47 | `interface Model` |  |
| `parseMermaid` | function | 67 | `function parseMermaid(source: string): Model` |  |
| `parseErd` | function | 122 | `function parseErd(json: string): Model` |  |
| `compare` | function | 166 | `function compare(mmd: Model, erd: Model): string[]` |  |

Imports: none

Packages: `node:fs`, `node:path`, `node:url`

Imported by: none
<!-- /gen -->

### `tools/check/facts.check.mjs`

Fails when a count the documents state is not the count the code has. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card tools/check/facts.check.mjs -->
657 lines, 19 exports. Imported by 0 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `toNumber` | function | 44 | `function toNumber(text)` | A count written as digits (with a thousands comma) or as a word, or null. |
| `countEndpoints` | function | 67 | `function countEndpoints(root)` | The routes the BFF registers: `app.get(`, `app.post(` and the like at the start of a line, in the files that register any. |
| `countRouteModules` | function | 83 | `function countRouteModules(root)` | Route modules: `await app.register(somethingRoutes)` in index.ts, with or without options after the name. |
| `zabbixCalls` | function | 90 | `function zabbixCalls(root)` | Every Zabbix method named as a string in server/src outside tests and comments: method -> file -> [lines], and which are written. |
| `environmentVariables` | function | 115 | `function environmentVariables(root)` | The environment variables server/src reads: `process.env.NAME`, `process.env['NAME']` and `envNum('NAME', ...)`, outside tests. |
| `documentedVariables` | function | 127 | `function documentedVariables(readme)` | The names in backticks in the Configuration section of a README. |
| `countErd` | function | 135 | `function countErd(text)` | Entities and relationships of an erDiagram, and of the ERD-Database tables. |
| `countConceptual` | function | 147 | `function countConceptual(text)` | The rows of the entity and association tables of ERD-Conceptual.md. |
| `testCounts` | function | 192 | `function testCounts(root)` | How many tests the last `npm test` ran, from the file each package's vitest config has it write (`.test-counts.json`, which git ignores). |
| `gatherFacts` | function | 209 | `function gatherFacts(root)` | Everything the code says, by name. |
| `RULES` | constant | 251 | `const RULES` | The statements to look for. |
| `checkText` | function | 325 | `function checkText(text, facts)` | The statements in `text` that the code contradicts, with their line numbers, how many were checked, and how many were left alone because their... |
| `openapiEndpoints` | function | 362 | `function openapiEndpoints(text)` | Endpoints of docs/api/openapi.yaml as "METHOD /path", read the way openapi.check does: a path at two spaces, a method at four. |
| `endpointTableRows` | function | 378 | `function endpointTableRows(text)` | Rows of the endpoint table of setup/05, as "METHOD /path" with the query string cut off. |
| `citedLines` | function | 385 | `function citedLines(cell)` | "file:line" and ":line" tokens of one cell of the call table, as file -> [lines]. |
| `checkCallTable` | function | 403 | `function checkCallTable(text, calls)` | The table of calls in ERD-Database.md against the lines of server/src: one problem for each method that differs. |
| `checkTracker` | function | 430 | `function checkTracker(text)` | The rows of the tracker (a row is a table row whose first cell is a mark) and what is wrong with them. |
| `checkOpenItemsTotals` | function | 461 | `function checkOpenItemsTotals(text, totals)` | The sentence at the head of the open-items page that gives the tracker's totals. |
| `checkFacts` | function | 468 | `function checkFacts(root)` |  |

Imports: none

Packages: `node:fs`, `node:os`, `node:path`, `node:url`

Imported by: none
<!-- /gen -->

### `tools/check/handover.check.mjs`

Fails when the handbook is out of date with the code, incomplete, or carries something it should not. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card tools/check/handover.check.mjs -->
582 lines, 19 exports. Imported by 0 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `generatedProblems` | function | 48 | `function generatedProblems(inside, text)` | A generated page holds its block. |
| `checkStyle` | function | 98 | `function checkStyle(text, { chars = true, words = true } = {})` | The problems in `text` for the style rule, as { line, message }. |
| `checkSecrets` | function | 110 | `function checkSecrets(text)` | The problems in `text` for the secrets rule: an address, a mailbox, a token, a home folder. |
| `checkBox` | function | 129 | `function checkBox(text)` |  |
| `checkHeadings` | function | 141 | `function checkHeadings(text)` |  |
| `checkEveryone` | function | 170 | `function checkEveryone(text)` | The part for people who do not read code: no fenced block and no inline code that is an identifier or a path. |
| `checkSummary` | function | 198 | `function checkSummary(text)` | The Indonesian summary: a quote that opens with Ringkasan and holds five bullets, before the first section heading. |
| `looksLikeName` | function | 229 | `function looksLikeName(token)` | Does this token look like a name worth looking up? |
| `buildCorpus` | function | 236 | `function buildCorpus(root)` | Every word of the code and the settings, for looking a name up. |
| `checkReferences` | function | 265 | `function checkReferences(text, corpus, root)` | Backticked names and paths in the hand-written text of a page that name nothing in the code. |
| `readManifest` | function | 294 | `function readManifest(root)` |  |
| `manifestProblems` | function | 303 | `function manifestProblems(manifest, pagesOnDisk)` | The parts that exist, in the manifest's order, with their pages as paths below docs/handover. |
| `cardProblems` | function | 322 | `function cardProblems(pages, model)` | Cards: one per code file, each with a few words of hand-written text above its block. |
| `folderProblems` | function | 342 | `function folderProblems(pages, root)` | Folder descriptions: `<!-- folder PATH -->` marks the paragraph that describes a folder. |
| `snippetProblems` | function | 360 | `function snippetProblems(text)` | Quoted code is followed by words: a run of quotes may end in one explanation, and the last quote of a run needs 40 of them. |
| `purposeProblems` | function | 376 | `function purposeProblems(text)` | The last column of every file table says something: at least three words. |
| `perCopyProblems` | function | 390 | `function perCopyProblems(text, files = PER_COPY_FILES)` | The page about the two copies names every file that is meant to differ between them. |
| `checkHandbook` | function | 397 | `function checkHandbook(root)` | Every problem under `root`, one { page, line, rule, message } each, and what was looked at. |
| `selfTest` | function | 457 | `function selfTest()` |  |

Imports: `tools/check/parity.check.mjs`, `tools/handover/lib/blocks.mjs`, `tools/handover/lib/document.mjs`, `tools/handover/lib/model.mjs`, `tools/handover/lib/render.mjs`, `tools/handover/lib/scope.mjs`

Packages: `node:fs`, `node:path`, `node:url`

Imported by: none
<!-- /gen -->

### `tools/check/links.check.mjs`

Fails on a broken relative link or a line citation that runs past its file. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card tools/check/links.check.mjs -->
300 lines, 4 exports. Imported by 0 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `relativeLinks` | function | 61 | `function relativeLinks(text)` | Relative link targets in `text`, with their line numbers, outside code and HTML comments. |
| `lineCitations` | function | 103 | `function lineCitations(text)` | Line citations in `text` (`file.ts:12-30`), outside fenced code. |
| `citedFile` | function | 137 | `function citedFile(root, docDir, path)` | The file a citation names: from the repo root, or the way the documents shorten it (`routes/x.ts`, `features/x/Y.tsx`), or beside the document. |
| `checkLinks` | function | 179 | `function checkLinks(root)` | Broken links and overrunning citations under `root`, and how many of each were checked. |

Imports: none

Packages: `node:fs`, `node:os`, `node:path`, `node:url`

Imported by: none
<!-- /gen -->

### `tools/check/openapi.check.ts`

Fails when the API description and the routes the server registers disagree. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card tools/check/openapi.check.ts -->
802 lines, 14 exports. Imported by 0 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Route` | interface | 45 | `interface Route` |  |
| `routesIn` | function | 61 | `function routesIn(source: string, where = '<memory>'): Route[]` | Every route registration in a TypeScript source file. |
| `specPaths` | function | 90 | `function specPaths(yaml: string): string[]` | Path keys under `paths:` in an OpenAPI document, in file order. |
| `toTemplate` | function | 110 | `const toTemplate = (path: string): string =>` | A route's `:id` as the spec writes it, `{id}`. |
| `paramsOf` | function | 113 | `const paramsOf = (path: string): string[] =>` | The parameter names in a path, in order, from the route form or the spec form. |
| `SpecOp` | interface | 118 | `interface SpecOp` |  |
| `specOperations` | function | 212 | `function specOperations(yaml: string): SpecOp[]` | Every operation under `paths:`: its method, path, whether it opts out of security, the status codes it documents and the path parameters it declares. |
| `cutDescriptions` | function | 242 | `function cutDescriptions(yaml: string): { line: number; entry: string }[]` | The lines where YAML cuts a description short. |
| `Guard` | interface | 302 | `interface Guard` |  |
| `guardIn` | function | 314 | `function guardIn(source: string): Guard \| null` | The guard's two tables, read out of the source that holds them (`PUBLIC_ROUTES` and `ROUTE_RULES` in auth.ts), or null when either is missing: a... |
| `RoleEntry` | interface | 328 | `interface RoleEntry` | One entry of the Roles table: a path, with the method it names if it names one, and whether a star made it stand for everything below. |
| `rolesTable` | function | 339 | `function rolesTable(yaml: string): Map<string, RoleEntry[]> \| null` | The `### Roles` table in the spec's description: for each role, the paths its row names in backticks (`/api/net/*` stands for everything below... |
| `compareRoles` | function | 361 | `function compareRoles(table: Map<string, RoleEntry[]>, ops: SpecOp[], guard: Guard): string[]` | The Roles table against the guard's rules, both ways: every path the table names has the role of its row, and every operation the rules put above... |
| `compare` | function | 385 | `function compare(routes: Route[], ops: SpecOp[], guard: Guard)` | Everything the registered routes and the spec must agree on, as a list of problems (empty when they agree), plus how many operations the guard... |

Imports: none

Packages: `node:fs`, `node:path`, `node:url`

Imported by: none
<!-- /gen -->

### `tools/check/parity.check.mjs`

Lists every file that differs between the two copies and is not on the list of files meant to differ. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card tools/check/parity.check.mjs -->
243 lines, 8 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `OWN_ROOT_DIRS` | constant | 34 | `const OWN_ROOT_DIRS = new Set(['pic'])` | Folders skipped only when they sit at the root: each copy's own screenshots, which show real host names and are not committed. |
| `PER_COPY_FILES` | constant | 38 | `const PER_COPY_FILES` | Files meant to differ between the copies, each in both: the copy's own configuration and perspective. |
| `ENV_FILES` | constant | 59 | `const ENV_FILES` | The `.env*` files that differ by design. |
| `ONE_COPY_ONLY` | constant | 61 | `const ONE_COPY_ONLY` | Files that belong to one copy only, by the name of its folder. |
| `filesUnder` | function | 67 | `function filesUnder(root)` | Every file under `root`, as sorted paths relative to it with forward slashes. |
| `compareTrees` | function | 86 | `function compareTrees(a, b)` | Differences between two trees that are not on the allowed list, one line each. |
| `staleListEntries` | function | 111 | `function staleListEntries(root)` | Entries of the list of files meant to differ that are not in `root`: the list has gone stale, for example after a rename. |
| `selfTest` | function | 121 | `function selfTest()` | Self-test on small trees made for the purpose, named like the real copies because the one-copy-only rule goes by the folder's name. |

Imports: none

Packages: `node:fs`, `node:os`, `node:path`, `node:url`

Imported by: `tools/check/handover.check.mjs`, `tools/handover/lib/scope.mjs`
<!-- /gen -->

## `tools/handover`

### `tools/handover/build.mjs`

Rewrites the generated blocks of the handbook from the code, and records a reviewed explanation. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card tools/handover/build.mjs -->
41 lines, 0 exports. Imported by 0 files.

Imports: `tools/handover/lib/document.mjs`, `tools/handover/lib/model.mjs`

Packages: `node:fs`, `node:path`, `node:url`

Imported by: none
<!-- /gen -->

## `tools/handover/lib`

### `tools/handover/lib/blocks.mjs`

The marker syntax of generated blocks, and the function that reads a page into text and blocks. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card tools/handover/lib/blocks.mjs -->
114 lines, 6 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `parseArgs` | function | 17 | `function parseArgs(text = '')` | `a/b.ts#name sha=abc depth=2` -> { target: 'a/b.ts#name', options: { sha: 'abc', depth: '2' } }. |
| `openLine` | function | 30 | `function openLine(kind, target, options)` | The opening line of a block, rebuilt from its parts so a rewrite keeps one spelling. |
| `splitBlocks` | function | 40 | `function splitBlocks(text)` | The parts of `text`, in order: `{ type: 'text', text }` for hand-written lines and `{ type: 'block', kind, target, options, body, line }` for each... |
| `joinBlocks` | function | 83 | `function joinBlocks(parts, render)` | Joins the parts back into a document. |
| `proseOf` | function | 96 | `function proseOf(markdown)` | The text of `markdown` that a reader reads: no generated blocks, no fenced code, no comments. |
| `maskBlocks` | function | 106 | `function maskBlocks(text)` | `text` with every line of every generated block (markers included) emptied, so line numbers stay where they were. |

Imports: none

Imported by: `tools/check/handover.check.mjs`, `tools/handover/lib/document.mjs`
<!-- /gen -->

### `tools/handover/lib/document.mjs`

Reads one handbook page, renders its blocks and keeps the reading time in its box. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card tools/handover/lib/document.mjs -->
116 lines, 7 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `HANDOVER_DIR` | constant | 10 | `const HANDOVER_DIR` |  |
| `listPages` | function | 13 | `function listPages(root)` | Every Markdown file of the handbook, as sorted posix paths from the repository root. |
| `isHandbook` | function | 32 | `const isHandbook = (root) =>` |  |
| `boxOf` | function | 41 | `function boxOf(text)` | The box under the title: who the page is for, how long it takes, what to read before and after. |
| `readingTime` | function | 58 | `function readingTime(text)` | The reading time of a page, counting its prose and the code it quotes, with the box's own time left out of the count. |
| `processDocument` | function | 74 | `function processDocument(model, root, docRel, text, { fill = true, accept = false } = {})` | Renders every generated block of `text` and sets the reading time. |
| `readPage` | function | 116 | `const readPage = (root, rel) =>` |  |

Imports: `tools/handover/lib/blocks.mjs`, `tools/handover/lib/render.mjs`

Packages: `node:fs`, `node:path`

Imported by: `tools/check/handover.check.mjs`, `tools/handover/build.mjs`
<!-- /gen -->

### `tools/handover/lib/model.mjs`

Reads the code with TypeScript's parser: exports, imports, importers and tests. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card tools/handover/lib/model.mjs -->
378 lines, 11 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `loadTypescript` | function | 15 | `function loadTypescript(root)` | The `typescript` package of this tree's server. |
| `clip` | function | 28 | `function clip(text, max)` | `text` cut at a space before `max` characters, with `...` where it was cut. |
| `firstSentence` | function | 37 | `function firstSentence(comment)` | The first sentence of a comment: up to the first full stop followed by a space, or all of it. |
| `parseSource` | function | 138 | `function parseSource(ts, rel, text)` | Everything a file declares at its top level, exported or not (a snippet may quote a private helper), and what it exports. |
| `resolveImport` | function | 230 | `function resolveImport(fromRel, spec, known)` | The file a relative import names, as a path from the root, or null when it names none of `known`. |
| `packageOf` | function | 239 | `function packageOf(spec)` | The package an import names: `@fastify/cookie`, `react`, `node:fs`. |
| `routeEndpoints` | function | 246 | `function routeEndpoints(text)` | The endpoints a route file registers, as `GET /api/x`: for the card, and for finding the tests that call them. |
| `countTests` | function | 253 | `function countTests(text)` | How many tests a test file declares: `it(`, `test(` and their `.each`, `.skip` and `.only` forms, at any depth. |
| `describeTitles` | function | 258 | `function describeTitles(text)` | The title of each top-level `describe` of a test file. |
| `buildModel` | function | 268 | `function buildModel(root)` | Reads the whole tree: every card file and every test file, parsed, with the links between them. |
| `snippetHash` | function | 378 | `const snippetHash = (text) =>` | The hash a snippet records: the text of the quoted declaration, lines trimmed at the end, LF endings. |

Imports: `tools/handover/lib/scope.mjs`

Packages: `node:crypto`, `node:fs`, `node:module`, `node:path`

Imported by: `tools/check/handover.check.mjs`, `tools/handover/build.mjs`, `tools/handover/lib/render.mjs`
<!-- /gen -->

### `tools/handover/lib/render.mjs`

Turns the model into the tables, trees, indexes and quoted code of the generated blocks. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card tools/handover/lib/render.mjs -->
233 lines, 11 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `short` | function | 27 | `function short(rel)` | `server/src/core/cache.ts` -> `core/cache.ts`: the folder a page of cards is about is already known to its reader. |
| `relLink` | function | 32 | `function relLink(fromDoc, target)` | The relative link from the Markdown file `fromDoc` to the file `target`, both given from the repository root. |
| `renderCard` | function | 45 | `function renderCard(model, rel)` | The count line, the table of exports, and the lines that say what the file imports and who imports it. |
| `purposesOf` | function | 76 | `function purposesOf(body)` | Rows of an existing `files` table, as file name -> the last cell, so a rewrite keeps what a person wrote there. |
| `renderFiles` | function | 86 | `function renderFiles(model, dir, docRel, previous = '')` | A table of the card files directly inside `dir`, with the last column kept from `previous`. |
| `renderTree` | function | 100 | `function renderTree(root, target, { depth = 1, files = 'no' } = {})` | What a directory holds, one level at a time, as a fenced tree. |
| `renderTestsMap` | function | 133 | `function renderTestsMap(model)` | Every test file, by package: how many tests it holds, what its first describe says, and the code it imports. |
| `renderSymbols` | function | 151 | `function renderSymbols(model)` | Every declared export of every card file, A to Z, each with the place it is declared. |
| `resolveSnippet` | function | 183 | `function resolveSnippet(model, target, options = {})` | The text a snippet block quotes, where it sits, and the hash of the whole declaration. |
| `renderSnippet` | function | 222 | `function renderSnippet(model, target, options = {})` | The caption and the fenced quote of a snippet block. |
| `readingMinutes` | function | 228 | `function readingMinutes(prose, codeLines = 0)` | A chapter's reading time in minutes, rounded: about 200 words a minute for prose, and a code line takes as long as ten words. |

Imports: `tools/handover/lib/model.mjs`, `tools/handover/lib/scope.mjs`

Packages: `node:fs`, `node:path`

Imported by: `tools/check/handover.check.mjs`, `tools/handover/lib/document.mjs`
<!-- /gen -->

### `tools/handover/lib/scope.mjs`

Decides which files get a card, which folders get a description, and what is never listed. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card tools/handover/lib/scope.mjs -->
139 lines, 17 exports, 1 re-export. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SKIP_DIRS` | constant | 11 | `const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.vite', '__pycache__'])` | Never entered or listed: dependencies, build output, version control, and each copy's own screenshots. |
| `NEVER_LISTED` | constant | 14 | `const NEVER_LISTED = new Set(['.DS_Store', 'docker-compose.override.yml', 'api-timing.json', '.test-counts.json'])` | Files that exist in one working copy and not in the other, or hold an address or a secret: never listed. |
| `isNeverListed` | function | 15 | `const isNeverListed = (name) =>` |  |
| `OWN_ROOT_DIRS` | constant | 18 | `const OWN_ROOT_DIRS = new Set(['pic'])` | The folder at the root that holds each copy's own screenshots. |
| `PER_COPY_FILES` | re-export | 21 | `from '../../check/parity.check.mjs'` |  |
| `CODE_EXT` | constant | 24 | `const CODE_EXT = /\.(ts\|tsx\|mjs\|js\|py\|sh\|css)$/` | Code, by extension. |
| `isTestFile` | function | 25 | `const isTestFile = (rel) =>` |  |
| `CARD_ROOTS` | constant | 28 | `const CARD_ROOTS` | The roots whose code files each get a card, and the area (a page of cards) each belongs to. |
| `CARD_EXTRA` | constant | 38 | `const CARD_EXTRA` | Code files outside those roots that are still part of the build: configuration written in code. |
| `GENERATED_FILES` | constant | 48 | `const GENERATED_FILES = new Set(['web/src/generated/openapi.ts'])` | Files under a card root that are not authored code: generated output. |
| `walk` | function | 51 | `function walk(root, dir = '', { includeOwn = false } = {})` | Every file under `dir`, as sorted posix paths relative to `root`. |
| `walkDirs` | function | 66 | `function walkDirs(root, dir = '')` | Every directory under `dir`, as sorted posix paths relative to `root`. |
| `cardFiles` | function | 80 | `function cardFiles(root)` | The files that get a card: authored or generated code under the card roots, tests left out. |
| `areaOf` | function | 91 | `function areaOf(rel)` | The page of cards a file belongs to: server, web or tools. |
| `testFiles` | function | 98 | `function testFiles(root)` | The test files (beside the code or under __tests__), for relating tests to the code they cover. |
| `folderCards` | function | 112 | `function folderCards(root)` | The folders that get a description: every directory under the source roots, and the named top-level ones. |
| `dirOf` | function | 131 | `const dirOf = (rel) =>` | `a/b/c.ts` -> `a/b`. |
| `isDir` | function | 133 | `const isDir = (abs) =>` |  |

Imports: `tools/check/parity.check.mjs`

Packages: `node:fs`, `node:path`

Imported by: `tools/check/handover.check.mjs`, `tools/handover/lib/model.mjs`, `tools/handover/lib/render.mjs`
<!-- /gen -->

## `tools/live`

### `tools/live/api-timing.py`

Times every read endpoint, cold and warm, with its size raw and compressed. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card tools/live/api-timing.py -->
51 lines, 0 exports. Imported by 0 files.

Imports: none

Imported by: none
<!-- /gen -->

### `tools/live/download-check.mjs`

Clicks the download buttons in a browser and says whether each file arrived and what is in it. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card tools/live/download-check.mjs -->
96 lines, 0 exports. Imported by 0 files.

Imports: none

Packages: `node:child_process`, `node:fs`, `node:os`, `node:path`, `node:timers`

Imported by: none
<!-- /gen -->

### `tools/live/enforcing-csp-server.mjs`

Serves the built web app with the production Content-Security-Policy, to try a policy change before a rebuild. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card tools/live/enforcing-csp-server.mjs -->
34 lines, 0 exports. Imported by 0 files.

Imports: none

Packages: `node:fs`, `node:http`, `node:path`, `node:url`

Imported by: none
<!-- /gen -->

### `tools/live/keyboard-walk.mjs`

Presses Tab through a page and reports stops with no focus ring and elements the keyboard cannot reach. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card tools/live/keyboard-walk.mjs -->
46 lines, 0 exports. Imported by 0 files.

Imports: none

Packages: `node:child_process`, `node:fs`, `node:os`, `node:path`, `node:timers`

Imported by: none
<!-- /gen -->

### `tools/live/layout-sweep.mjs`

Opens every page at five widths and reports how far each runs past the window. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card tools/live/layout-sweep.mjs -->
94 lines, 0 exports. Imported by 0 files.

Imports: none

Packages: `node:child_process`, `node:fs`, `node:os`, `node:path`, `node:timers`

Imported by: none
<!-- /gen -->

### `tools/live/load-test.mjs`

Puts a steady load on the cached read endpoints and reports requests a second and latency. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card tools/live/load-test.mjs -->
22 lines, 0 exports. Imported by 0 files.

Imports: none

Imported by: none
<!-- /gen -->

### `tools/live/page-audit.mjs`

Opens every page and reports console errors, failed requests, policy violations, contrast, unnamed controls and load time. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card tools/live/page-audit.mjs -->
199 lines, 0 exports. Imported by 0 files.

Imports: none

Packages: `node:child_process`, `node:fs`, `node:os`, `node:path`, `node:timers`

Imported by: none
<!-- /gen -->

### `tools/live/signedin_check.py`

Signs in through nginx and checks health, the reports, the downloads, the stream and the problem list. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card tools/live/signedin_check.py -->
202 lines, 0 exports. Imported by 0 files.

Imports: none

Imported by: none
<!-- /gen -->

### `tools/live/sse_hold.py`

Holds a live stream for a number of seconds and says whether it stayed alive: a first frame, no close by the server, and something at least every 20 seconds. `signedin_check.py` uses it for its stream step, and it runs alone against any stream. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card tools/live/sse_hold.py -->
139 lines, 0 exports. Imported by 0 files.

Imports: none

Imported by: none
<!-- /gen -->
