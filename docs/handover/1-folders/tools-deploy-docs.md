# Tools, deploy and docs

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators and developers | about 7 min | [The web app](web.md) | [The two copies](the-two-copies.md) |

Beside the server and the web app sit four more places: `tools/` for scripts that check or read, `deploy/` for the scripts that rebuild and watch the running portals, `.github/` for the CI workflow, and `docs/` for everything written. None of them ships in an image. All of them matter on the day something breaks.

## tools

<!-- folder tools -->
`tools/` holds scripts that are not part of the portal. None needs a package of its own: the checkers use Node's standard library, and the two written in TypeScript run through the `tsx` that `server/node_modules` already has. [`tools/README.md`](../../../tools/README.md) lists every tool with the command that runs it.

### check

<!-- folder tools/check -->
The repository checked against itself. They are read-only, CI runs them, and each fails with a message that names the file and the line. `npm run check` at the root runs all of them; the checks that belong to one package, the stylesheet, the tokens, the markdown parser and the unit formatters, live in `web/scripts/` and run in the same command.

<!-- gen:files tools/check -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`diagrams.check.mjs`](../../../tools/check/diagrams.check.mjs) | 136 | 8 | Fails when a diagram source changed after the stamp of its render, or a render has no source. |
| [`diagrams.stamp.mjs`](../../../tools/check/diagrams.stamp.mjs) | 46 | 0 | Writes the stamp on a diagram source after its picture was re-rendered. |
| [`erd.check.ts`](../../../tools/check/erd.check.ts) | 280 | 6 | Fails when the two forms of the database diagram disagree. |
| [`facts.check.mjs`](../../../tools/check/facts.check.mjs) | 657 | 19 | Fails when a count the documents state is not the count the code has. |
| [`handover.check.mjs`](../../../tools/check/handover.check.mjs) | 582 | 19 | Fails when the handbook is out of date with the code, incomplete, or carries something it should not. |
| [`links.check.mjs`](../../../tools/check/links.check.mjs) | 300 | 4 | Fails on a broken relative link or a line citation that runs past its file. |
| [`openapi.check.ts`](../../../tools/check/openapi.check.ts) | 802 | 14 | Fails when the API description and the routes the server registers disagree. |
| [`parity.check.mjs`](../../../tools/check/parity.check.mjs) | 243 | 8 | Lists every file that differs between the two copies and is not on the list of files meant to differ. |
<!-- /gen -->

### live

<!-- folder tools/live -->
Tools that read a running portal and change nothing. `signedin_check.py` signs in through nginx and needs a real account: the user name and password come from the environment of your own shell and are never printed or stored. The page audit and the layout sweep default to every page of the app, and a test fails when a page is added and left out of either list.

<!-- gen:files tools/live -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`api-timing.py`](../../../tools/live/api-timing.py) | 51 | 0 | Times every read endpoint, cold and warm, with its size raw and compressed. |
| [`download-check.mjs`](../../../tools/live/download-check.mjs) | 96 | 0 | Clicks the download buttons in a browser and says whether each file arrived and what is in it. |
| [`enforcing-csp-server.mjs`](../../../tools/live/enforcing-csp-server.mjs) | 34 | 0 | Serves the built web app with the production Content-Security-Policy, to try a policy change before a rebuild. |
| [`keyboard-walk.mjs`](../../../tools/live/keyboard-walk.mjs) | 46 | 0 | Presses Tab through a page and reports stops with no focus ring and elements the keyboard cannot reach. |
| [`layout-sweep.mjs`](../../../tools/live/layout-sweep.mjs) | 94 | 0 | Opens every page at five widths and reports how far each runs past the window. |
| [`load-test.mjs`](../../../tools/live/load-test.mjs) | 22 | 0 | Puts a steady load on the cached read endpoints and reports requests a second and latency. |
| [`page-audit.mjs`](../../../tools/live/page-audit.mjs) | 199 | 0 | Opens every page and reports console errors, failed requests, policy violations, contrast, unnamed controls and load time. |
| [`signedin_check.py`](../../../tools/live/signedin_check.py) | 224 | 0 | Signs in through nginx and checks health, the reports, the downloads, the stream and the problem list. |
| [`sse_hold.py`](../../../tools/live/sse_hold.py) | 139 | 0 | Holds a live stream for a number of seconds and says whether it stayed alive: a first frame, no close by the server, something at least every 20 seconds. |
<!-- /gen -->

### handover

<!-- folder tools/handover -->
The program that writes the generated parts of this handbook. `npm run handover:build` runs it. `tools/check/handover.check.mjs` is its checker.

<!-- gen:files tools/handover -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`build.mjs`](../../../tools/handover/build.mjs) | 41 | 0 | Rewrites the generated blocks of the handbook from the code, and records a reviewed explanation. |
<!-- /gen -->

<!-- folder tools/handover/lib -->
Its pieces: the scope (which files get a card), the model (the code read with TypeScript's own parser), the renderers, the marker syntax and the page reader.

<!-- gen:files tools/handover/lib -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`blocks.mjs`](../../../tools/handover/lib/blocks.mjs) | 114 | 6 | The marker syntax of generated blocks, and the function that reads a page into text and blocks. |
| [`document.mjs`](../../../tools/handover/lib/document.mjs) | 114 | 6 | Reads one handbook page, renders its blocks and keeps the reading time in its box. |
| [`model.mjs`](../../../tools/handover/lib/model.mjs) | 378 | 11 | Reads the code with TypeScript's parser: exports, imports, importers and tests. |
| [`render.mjs`](../../../tools/handover/lib/render.mjs) | 233 | 11 | Turns the model into the tables, trees, indexes and quoted code of the generated blocks. |
| [`scope.mjs`](../../../tools/handover/lib/scope.mjs) | 128 | 16 | Decides which files get a card, which folders get a description, and what is never listed. |
<!-- /gen -->

## deploy

<!-- folder deploy -->
`deploy/` holds the three files an operator uses on the machine that runs the portals.

<!-- gen:files deploy -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`rebuild.sh`](../../../deploy/rebuild.sh) | 349 | 0 | Rebuilds both portals from the commit, checks their settings first, tags the old images, and checks the new ones. |
| [`watch.sh`](../../../deploy/watch.sh) | 424 | 0 | Checks that the portals and their containers answer and tells you when they do not; meant to run from a timer. |
<!-- /gen -->

`rebuild.sh` rebuilds both portals from the commit in the folder, the hosted copy first and then the local-model copy beside it. In a git checkout it refuses a tree whose source differs from the commit, because the build is named after the commit and a name that lies is worse than none; a folder with no git is built under the label `unknown`. `--allow-dirty` builds anyway and labels the build with `-dirty`. It checks the settings before it builds, saves the logs of the running containers, tags the images it replaces `rollback-<day><month>`, waits for both containers of each copy to be healthy, asks what an anonymous caller can see, and prints the one check it cannot make itself: the signed-in one. A copy that fails stops the run before the next one. `rebuild.sh --mark-good`, run once the signed-in check has passed, marks the running images `last-good`. If the build or its checks fail, the script lists `last-good` first, the build last marked good, and then the rollback tags it made. It never pushes anything.

`watch.sh` checks from outside Docker whether each portal answers and whether its containers run, and says so when one goes down, comes back or restarts in a loop. Docker restarts a dead container but tells nobody. It counts a portal as down, Docker as not answering, and a container as stopped, paused, dead, created, restarting or being removed, only after two checks in a row, so a rebuild's restart is not news, and it gives each call to Docker 20 seconds, so a Docker that hangs is reported as not answering. On macOS it can install itself as a per-user timer.

`settings.example` lists every setting that is not a secret, with the default the compose file gives it. Nothing reads it. It is the list to check a real `.env` against, and your real values belong in the encrypted backup of that `.env`.

## .github

<!-- folder .github -->
`dependabot.yml` asks for a weekly pull request for the GitHub actions, the npm packages of `server/` and `web/` (minor and patch updates grouped in one), and the Docker base images of both.

<!-- folder .github/workflows -->
`ci.yml` is the CI workflow. It has five jobs that run side by side, so a failure names its package: the server (install, audit, typecheck, lint, test, build), the web app (the same), the checks (everything under `tools/check` and the package checks), a secret scan of what is pushed, and a build of both Docker images with nginx's own syntax check. It pushes nothing, comments on nothing and deploys nothing. Every action is pinned to a full commit hash, and a test refuses one that is not.

CI runs in the repository that is under git, `hcml-portal`. `hcml-portal-ollama` has no git and no CI of its own; the workflow file is kept in both so that they stay identical.

## docs

<!-- folder docs -->
`docs/` is everything written. Three files sit at its top: `index.md`, which says what is documented and in what order to read it; `getting-started.md`, which goes from a clone to a running portal; and `contributing.md`, which holds the house rules and the reason for each. The folders under it:

| Folder | What it holds |
|---|---|
| `setup/` | The guide: one part for each subsystem, indexed by `setup.md` at the root, and one part for each batch of changes. |
| `architecture/` | The decision records, fifteen of them, each with what was considered, what was chosen and what it cost. |
| `api/` | The API description (`openapi.yaml`), checked against the routes the server registers, and how to view it. |
| `schema/` | The data model at three levels of detail: conceptual, logical, physical. Differs between the copies. |
| `erd/` | The full data model, with the entities read from Zabbix, the ones derived by the portal and the ones local to it, and the reference set behind it. |
| `flow/` | What happens, in three views: the browser, the server and the data. Differs between the copies. |
| `operations/` | Backing up the settings, putting TLS in front, and what comes back after a restart. |
| `design-system/` | The rules, the tokens and the components, with the token files for Figma and Sass, which a program writes. |
| `ux/` | Who uses the portal and how, derived from the code, not from interviews. |
| `screenshots/` | Ten pictures of the main pages with every name replaced. |
| `handover/` | This handbook. |

Most of these folders hold a README that opens them; read it first.

<!-- folder docs/setup -->
The guide is the deepest single description of the portal, in parts of one subsystem each. Parts 1 to 29 describe it as built; the later parts, from 30 on, record what changed on a given day or in a given round of work. The guide is written in the order the work was done, and this handbook is written in the order a reader needs.

<!-- folder docs/architecture -->
`README.md` explains the system at rest and in motion and links the decision records in `adr/`. Start with the first record, which explains why there is a portal at all.

<!-- folder docs/api -->
`openapi.yaml` describes every endpoint: its path, its method, its parameters, its guard and the shape of each answer. A checker holds it to the routes in the server, and a test in the web app holds the types to it. The copy of the file in each portal differs in its `servers` part only.

<!-- folder docs/schema -->
Three pages, read in order: the conceptual model, the logical model and the physical model. Each is the previous one made more concrete. The pictures are PDFs rendered from the `.mmd` files beside them.

<!-- folder docs/erd -->
The full data model in one diagram and in a form split by domain, with a table of every Zabbix call the portal makes and the line that makes it. The database model exists in two forms that a checker keeps equal.

<!-- folder docs/flow -->
Three views of the system in motion: what happens in the browser, what happens to one request inside the server, and where a number comes from. Read them in that order.

<!-- folder docs/operations -->
Three short runbooks: what to back up and how to restore it, how to put TLS in front of the portal, and what comes back after a machine restarts.

<!-- folder docs/design-system -->
The design rules, every token family and every component with its states. `tokens.json`, `_tokens.scss` and `component-tokens.md` are written by `npm run tokens:export` from the stylesheet and are never edited.

<!-- folder docs/ux -->
One page on who uses the portal: the four roles and the acknowledge journey. It says plainly that it is derived from the code and not from interviews, and how little weight that deserves.

<!-- folder docs/screenshots -->
Ten pictures of the main pages, with every host and site name replaced, and a README that describes them. The real screenshots stay in `pic/`, which is never committed.

<!-- folder docs/handover -->
This handbook. `manifest.json` lists its parts and pages, and `README.md` is where to start.
