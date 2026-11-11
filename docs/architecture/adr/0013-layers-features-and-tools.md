# Group the server by layer, the web by feature, and keep the repository's checks in one place

* Status: accepted
* Deciders: HCML internship project, from a review of the folder structure of both portals; the owner chose
  which of the review's items to do, and to keep the two copies separate
* Date: 2026-10-16

## Context and Problem Statement

On 16 October 2026 the folder structure of `hcml-portal` and `hcml-portal-ollama` was reviewed against
production practice and the usual rules of software construction: cohesion, coupling, one reason to change, a
dependency direction. The code worked and was tested. The structure was what slowed a reader down.

* **The 22 files of `server/src/routes/` held 4,728 lines**, and each mixed two jobs: the HTTP side of an endpoint
  (its path, its query, its status codes) and everything it knew (the Zabbix reads, the roll-ups, the cache
  keys, the prompts). A route file imported another route file to reuse a function, and `index.ts` mounted
  them all. To test the logic of an endpoint you had to know which route it was hiding in.
* **`web/src/` was grouped by kind** (`pages/`, `components/`, `hooks/`, `lib/`), so one feature was spread over
  four folders and its tests lived in a fifth, `__tests__/`, which held 79 files. The whole theme was one
  `styles.css` of 3,250 lines, and the deep reference was one `setup.md` of 2,457 lines.
* **The checks were in three places.** The ones that check the repository were in `web/scripts/` and
  `server/scripts/`, the ones that read a running portal were in `myown/checks/` outside the repository, and
  there was no root `package.json`, so no single command said "is this repository sound".

What is the layout that lets a reader find the code of one thing, change it, and know what else it touches, without
changing what the portal does?

## Decision Drivers

* A change to one endpoint, or one page, should touch one place, and a reader should be able to say which.
* Logic should be reachable without Fastify, and a feature without the rest of the app.
* A rule that is only written in a document is broken within a month. Every rule here has to be a test that
  fails.
* No behaviour changes. The 45 endpoints (when this was written) stay as they are, the built stylesheet stays byte for byte the same, and
  every test that passed before passes after.
* The zero-dependency rule: no workspace tool, no monorepo manager, no new package.
* The two copies stay separate ([ADR-0005](0005-provider-neutral-ai-layer.md)). The same layout goes into both
  and the files that differ by design stay the ones `parity.check.mjs` lists.
* "Just that, without taking it all apart": the aim is to move code to where it belongs, not to rewrite it.

## Considered Options

* Leave the layout and describe it better in the docs.
* Layers on the server (`routes/` call `services/`), features on the web, `tools/` and a root `package.json`
  for the checks, done by moving code mechanically and guarded by tests. This is the chosen option, with the 25 files
  that sat flat beside `index.ts` grouped into five folders by kind.
* A full domain layout of the whole server (`domain/`, `application/`, `infrastructure/`), arranged around a model of
  the estate. Not chosen: the shared files are grouped by what kind of file they are, which needs no such model.
* One repository for both portals with a profile for each, which the review also proposed. The owner keeps the
  copies separate, so it is not part of this decision.
* npm workspaces for `server/` and `web/`.

## Decision Outcome

Chosen: **routes call services, the web is grouped by feature, and the repository has one place for its
checks.**

* **Server.** `routes/<area>.ts` is a registrar: it names the paths, checks the query or the body, calls one
  function of `services/<area>.ts` and sends the answer or the status. `services/<area>.ts` holds the logic and
  takes plain arguments. The direction is `index.ts`, then `routes/`, then `services/`, then the shared folders.
  `routes/` went from 4,728 lines to 685 (690 on 19 October) and holds 39 of the 45 endpoints (sign-in is in `security/auth.ts`, the health
  check in `http/health.ts`), `services/` held 5,639 then and holds 5,737 in 33 files now. The 25 files that sat flat beside `index.ts` went into five
  folders by what they are for: `core/` (config, the cache and its stale marker, the gate, query parsing, the body
  schemas), `clients/` (the Zabbix client, the model client, the caps on its use), `domain/` (naming rules,
  reachability, the shared reads), `security/` (sign-in and roles, passwords, the page table, the viewer policy) and
  `http/` (the hooks `index.ts` wires in, error mapping, the health check, shutdown). `index.ts` is the only file
  left at the top. Only their paths changed: 385 import specifiers in 121 files, and the one place that read a path
  from its own location (`http/health.ts` reading `package.json`). Two moves were not a plain
  split: the old root `chat.ts` became `services/assistant.ts` and stayed apart from `services/chat.ts`, so that
  a test can still replace the assistant without replacing the helpers of the route; and the old root `meters.ts`
  was merged into `services/meters.ts`. State that a route used to assign at module level (the warm-up clock,
  the last prompt the model read, the logger) became functions in the service (`claimWarmSlot()`,
  `noteModelRead()`, `useLogger()`), because a service cannot be assigned to from outside.
* **Web.** `features/<name>/` holds a part of the portal with its pages, components, hooks, logic and their tests
  beside them: assistant, auth, dashboard, graphs, hosts, meters, network, problems, reports, shell, sla.
  `shared/` holds what two or more features use. The root keeps the app shell and the contract with the BFF
  (`App.tsx`, `main.tsx`, `theme.ts`, and the folders `api/`, `types/` and `guards/`, which were three files until 19 October). 146 files moved, 91 sources and 55 tests. The tests that cut
  across features stay in `__tests__/`. Three files that differed from a neighbour only by letter case
  (`Markdown.tsx` and `markdown.ts`, `HostsView.tsx` and `hostsView.ts`, `Gauge.tsx` and `gauge.ts`) could not
  share a folder on a case-insensitive disk, so the lower-case ones are now `parseMarkdown.ts`, `hostsFigures.ts`
  and `gaugeDial.ts`.
* **Styles.** `styles.css` is 20 numbered parts in `web/src/styles/`, and `index.css` imports them in order. The
  order is the cascade, so a new rule goes into the part it belongs to, and the build serves the same one sheet:
  its SHA-256 is the same before and after.
* **The setup guide.** `setup.md` is the index and `docs/setup/NN-title.md` are its 35 parts (38 since 20 October, three parts of changes more), each the text of
  one section line for line. Only parts 11 and 19 differ between the copies, where `setup.md` as a whole did.
* **Tools.** `tools/check/` holds the six checkers that read the repository (a seventh, `facts.check.mjs`, was added on 20 October 2026), `tools/live/` the eight scripts that
  read a running portal (moved in from `myown/checks/`), and a root `package.json` with scripts only:
  `npm run check`, and `npm run verify` for typecheck, lint, test, build and check in one go. The checks that belong
  to one package stay in it (`web/scripts/`, `server/scripts/`). `.github/workflows/ci.yml` runs five jobs
  (server, web, checks, secrets, images) and replaces `docs.yml`.

Each rule is a test, not a sentence:

| Rule | Where it fails |
|---|---|
| Only `index.ts` imports a route; no service imports a route; a route file exports its registrar and nothing else; `core/` imports nothing outside `core/`; the shared folders import no route and no service (one named exception); only `index.ts` imports `http/` (two named exceptions, both to `http/errors.ts`); nothing is left at the top of `src/` but `index.ts`; no import cycle among the files of `services/`; no piece of the assistant imports its entry file `assistant.ts`, which tests replace | `server/src/__tests__/layering.test.ts` |
| Root files (but `App` and `main`) and `shared/` import no feature; a feature imports another only where a table allows it; no cycle between the features that table allows; no import cycle among the shipped files, a type-only import not counting; no shipped file imports a test | `web/src/__tests__/layering.test.ts` |
| The parts of the stylesheet and the list in `index.css` agree | `web/src/__tests__/stylesheet.test.ts` |
| Every link in the docs resolves, and a line citation neither runs past its file nor names one that is gone | `tools/check/links.check.mjs` |
| The two copies differ in the files meant to and no others | `tools/check/parity.check.mjs` |
| The workflow runs the checks it claims, from folders that exist | `server/src/__tests__/ci-workflow.test.ts` |

How it was done: by the TypeScript compiler's API and not by hand, so that a moved function is the same text and
only its imports changed. Each stage ended with the tests green, the stylesheet's hash unchanged and a typecheck
of both configurations. Mutation checks showed that each layering rule fails when broken.

### Positive Consequences

* The code of an endpoint is two short files: the route, 7 to 119 lines, and the service. A service can be
  tested with no server.
* A feature on the web is one folder with its tests inside it, and the table in the layering test shows, in one
  place, which features know each other. The dashboard knows four, the others at most two.
* The checks have one home and one command. A new contributor runs `npm run verify` and gets CI's answer for the code:
  typecheck, lint, tests, builds and checks. The audit, the secret scan and the image builds run in CI alone.
* The rules cannot erode quietly: a route that imports another route fails a test the day it is written.
* The server has a linter since 19 October (ST-06): `npm run lint` in `server/`, run by `npm run lint` at the root
  and by a step of `ci.yml`, with no warning allowed. The layering tests cover the folder rules, and the linter the code.
* The setup guide and the stylesheet can be read and diffed in parts. A change to one subsystem touches one file
  of the guide.

### Negative Consequences

* **History is harder to follow.** 146 web files and 25 server files changed folder, and the logic of 22 routes moved to new files.
  `git blame` on a moved line points at the commit of the move, and `git log --follow` loses a file that was
  split. The older records name the old tree and are left as written: `tracker.md`, `CHANGELOG.md`,
  `AUDIT_REPORT.md` and the "What changed" parts of the setup guide, whose paths and line citations were right on
  their day: they say `server/src/zabbix.ts` where the file is now `server/src/clients/zabbix.ts`. The changelog entry
  of 16 October has a table from the old paths to the new.
* **An endpoint is now two files.** A change to what an endpoint reads and to what it accepts opens a service and
  a route. For a small area that is more ceremony than it earns: `routes/links.ts` is seven lines.
* **The layering tests read import specifiers with a regular expression**, not the module graph. They do not
  see a path alias (the project has none) or an import built at run time. A real graph tool would see more, and
  would be a dependency.
* **The table of allowed couplings is upkeep.** Each new coupling between two features is a line someone has to
  add, which is the point, and also a friction that will be argued with.
* **Moved first, split after.** The 16 October step moved files and left the large ones whole: `services/analytics.ts`
  was 1,011 lines and `services/assistant.ts` 1,040, and on the web `api.ts`, `types.ts` and `guards.ts` held every
  feature's part. On 19 October (ST-07, ST-08) they were split by the same compiler-API method, each declaration
  keeping its own text. Analytics became `incidents`, `availability`, `noise`, `aging`, `capacity` and `reportPolicy`.
  The assistant became six `assistant*.ts` pieces behind `assistant.ts`, which stays as the one entry the route,
  `chat.ts` and the tests import and mock; the pieces import one another directly. The web's three became `api/`,
  `types/` and `guards/`, a file for each feature behind an `index.ts` that re-exports the same names, so no page
  changed an import and `vi.mock('../../api')` still replaces the module a page loads. They stayed at the root and
  not inside the features, because the root may import no feature and a page of any feature calls any of them. Two
  rules came with it (the table above): no import cycle in `services/` and none among the web's shipped files, and
  no piece of the assistant imports its entry.
* **Two edges run against the grain.** `http/health.ts` reads the live stream count from `services/stream.ts`, and
  two services (`chat.ts`, `stream.ts`) read one sentence from `http/errors.ts`. The layering test names both. A
  constant and a function could be moved to remove them; this step moved files and left them.
* **A folder is a choice, and some files could go in two.** `limits.ts` (the caps on the model's use) is in
  `clients/` because `ai.ts` imports it, though it also guards routes. `schemas.ts` describes HTTP bodies and is in
  `core/`, because both `auth.ts` and `errors.ts` import it and putting it in `http/` would make two folders import
  each other. Another reader would choose differently, and the tests pin only the direction, not the choice.
* **The restore patch is tied to the layout.** `myown/documents/patches/bk-11-removed-endpoints.patch` restores five endpoints
  that were removed on 12 October (BK-11). It was made again for this layout, twice, as the layout changed twice that day, and is checked with
  `patch -p1 -R --dry-run`, but a patch is not a module: the next layout change breaks it again. It was made again on
  19 October, after the server linter had removed a type from one of its tests, and a copy of the restored tree was
  typechecked, linted and tested. A restore also needs `npm run gen:api` in `web/`, because the OpenAPI file gets its
  five paths back and a web test fails while the generated types are older than the file.
* **The CI is still unproven on GitHub.** The workflow has never run there (the account is locked for billing,
  tracker IN-30). Its typecheck, lint, test, build and check commands were run locally (`npm run verify`) and a test reads the file; the audit, the secret scan and the image builds were not run, which is not the same.

## Confirmation

`npm run verify` at the root of either copy. The numbers on 19 October 2026: server 78 test files and 1,687
tests, web 81 files and 1,173 tests. With both copies side by side, `node tools/check/parity.check.mjs` reports no
unlisted difference.

## More Information

* [`setup.md`](../../../setup.md) §5 (the server's files), §6 (the web's folders) and §12 (the recipe for a new
  view) describe the layout as it is.
* [`tools/README.md`](../../../tools/README.md) lists the checkers and the live tools.
* [ADR-0002](0002-react-typescript-fastify.md) chose the stack this layout is arranged in.
