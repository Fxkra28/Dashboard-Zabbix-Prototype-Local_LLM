# Tests and checkers

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 10 min | [Web app: the stylesheet](web-styles.md) | [Server files, one card each](files-server.md) |

Two kinds of thing keep this repository true. Tests run the code and say it behaves. Checkers read the repository and say it agrees with itself: the routes with the API description, the documents with the code, the two copies with each other. `npm run verify` at the root runs both, with the type checks, the linters and the builds. This chapter says how the tests are organised, what the eleven checkers guard, and how a rule is written so that it can fail.

## The server's tests

The server's tests are `server/src/__tests__/*.test.ts`, run by Vitest. The settings in `server/vitest.config.ts` matter, and each has a reason.

1. A test file is isolated. Route tests mock `server/src/clients/zabbix.ts` once for each file, and without isolation a mock from one file would leak into the next through the module cache.
2. The developer's `server/.env` is never loaded: `DOTENV_CONFIG_PATH` points at nothing. Its real tokens would reach every test, and CI would fail what a laptop passes.
3. `ZBX_URL` points at the discard port on the machine itself, so a call that escapes its mock fails and never reaches a real Zabbix.

A route test builds an application with only the route module under test and the real error handler, and drives it with `app.inject()`: no socket and no live Zabbix. The helper is `server/src/__tests__/helpers/app.ts`. Its `buildTestApp` clears the cache first, because route handlers cache by key, and without that a value cached by one test would be served to the next, and the second test would never call its mock. Its fixtures, `zHost` and `zProblem`, give every field as text, as Zabbix does, so a test cannot hide a bug that a number where a string belongs would cause.

All Zabbix traffic goes through `zbx` and `zbxWrite`, so one `vi.mock` of that module covers every route. The mock keeps the real error classes (`importOriginal`), because `errors.ts` branches on `instanceof`, and a stubbed class would make every failure test pass for the wrong reason. A test says what Zabbix answers for each method, and anything it leaves out answers an empty list.

The other helpers in the folder are `fakeZabbix.ts`, a small made-up estate that answers by Zabbix method, with three hosts at two sites, one open problem, and ping and interface items. `pingZabbix.ts`, a stand-in for the ping reads of `reachability.ts`. `authApp.ts`, an application with the real sign-in guard, built from an environment the test chooses, which keeps every log line it writes, parsed. `sliReportFixture.ts`, the two derived SLA reports for August 2026, shaped like production with made-up names. `docFixture.ts`, a realistic report document with awkward values on purpose. `webStyles.ts`, the web stylesheet as one text. And `tlsTestCerts.ts`, throwaway certificates for the pin tests: a test authority and two certificates for localhost, one of them expired.

## The web app's tests

The web app's tests are `*.test.ts` and `*.test.tsx` files next to the code they test, and a few in `web/src/__tests__/`. `web/vitest.config.ts` sets `jsdom` as the browser, runs `src/__tests__/setup.ts` before each file, and isolates each file, because the session state in `api/` is module-level and each file needs a fresh one.

1. `setup.ts` adds Testing Library's matchers and unmounts after each test by itself, since Vitest's globals are off and Testing Library cannot do it on its own then.
2. Vitest blanks every stylesheet by default. The tests read the stylesheet as text, so `css.include` lets `styles/*.css` through, and `src/__tests__/stylesheet.ts` joins the parts.
3. A test may read a file of the repository outside `web/` as text, such as `docs/api/openapi.yaml`, so the server's file system allowance includes `..`.
4. A page is tested by mounting it in a memory router, with `api` replaced, and looking at what the person would see: the text, the roles and the labels. `routes.test.tsx` mounts the whole route table. The accessibility of the markup is held by tests of structure, such as `markup.test.tsx`, and by `tools/live/page-audit.mjs` and `keyboard-walk.mjs` against a running portal, which are not part of `verify`.

## Tests that hold files together

Some tests do not run the code. They read two files and fail when they disagree, which is how a hand-kept copy stays honest.

| Test | What it holds together |
|---|---|
| `stylesheet.test.ts` (web) | The list of parts in `index.css` and the part files, and the cascade order |
| `themeBeforePaint.test.ts` (web) | The key `public/theme.js` reads and the key the app writes for the theme |
| `copiedHelpers.test.ts` (web) | The browser's copies of the server's site-naming and time helpers, which it cannot import |
| `openapiTypes.test.ts` (web) | The web app's hand-written types and the types generated from `docs/api/openapi.yaml` |
| `openapi-contract.test.ts` (server) | The routes' answers against the API description |
| `surface.test.ts` (server) | Every route and its role, pinned: a change to who may call what has to be made on purpose, in two places |
| `ci-workflow.test.ts` (server) | The CI workflow's pinned actions, jobs and the list of checkers it runs |
| `nginx-conf.test.ts` (server) | `web/nginx.conf`, read the way nginx reads it: timeouts, headers, the locations |
| `compose-env.test.ts` (server) | `docker-compose.yml` against every setting the server reads, since Compose hands a container only what it lists |
| `rebuild-script.test.ts`, `watch-script.test.ts` (server) | The rebuild and watcher scripts, run as dry runs in small git trees with stand-ins for Docker and curl |
| `export-theme.test.ts`, `export-writers-agree.test.ts` (server) | The report colours against the stylesheet, and the PDF and the workbook against each other |
| `live-tools.test.ts` (server) | Every page of the app is in the live audit tools' lists |
| `handover-check.test.ts` (server) | The handbook's generator and its checker, each rule shown to fail on a one-page handbook with that fault |

## The eleven checkers

`npm run check` runs eleven checkers. They are read-only, they run in CI, and each fails with a message that names the file and the line. Seven are in `tools/check/`, four in the web app's `scripts/`.

| Checker | What it guards | Command |
|---|---|---|
| `openapi.check.ts` | `docs/api/openapi.yaml` lists exactly the routes the server registers, with their methods, parameters, guards and error answers | `npm run check:api` |
| `erd.check.ts` | The database diagram exists in two forms, `.mmd` and `.erd`, and they say the same | `npm run check:erd` |
| `css.check.mjs` | The stylesheet is structurally sound: no lost brace | `npm run check:styles` |
| `tokens.check.mjs` | Contrast of every colour pair, and no value past the tokens | `npm run check:styles` |
| `markdown.check.ts` | The Assistant's markdown parser, case by case | `npm run check:web` |
| `units.check.ts` | The unit and duration formatters, case by case | `npm run check:web` |
| `links.check.mjs` | Every relative link in the Markdown resolves, spelled exactly, and a `path:line` citation does not run past its file | `npm run check:docs` |
| `facts.check.mjs` | The counts the documents state are the ones the code has: endpoints, route modules, Zabbix methods, parts, ADRs, pages, dependencies, test files, checkers, and the cards a card page says it has. The tracker is a well-formed table: ten cells in every row, a mark that fits its status, one row for each id, and the totals it and the open-items page state are the rows' | `npm run check:docs` |
| `diagrams.check.mjs` | Each diagram source matches the stamp of its render, and its PDF exists | `npm run check:docs` |
| `handover.check.mjs` | This handbook against the code, and its rules | `npm run check:handover` |
| `parity.check.mjs` | The two copies hold the same files, apart from the listed ones. Without a sibling, as in CI, it runs only its own self-test | `npm run check:parity` |

Read the header of each file for the whole account. `facts.check.mjs` records why it exists: an endpoint table that said 35 while listing all of them, "13 read methods" in five documents when the code called 14, a glossary that said 11 ADRs beside 13 files. Each was found by reading, weeks late.

## A rule that can fail

A checker that can never fail checks nothing, so each one carries a self-test: a handful of bad and good inputs, with the number of problems each must produce. Here are two rules of this handbook's checker as an example.

<!-- gen:snippet tools/check/handover.check.mjs#generatedProblems sha=103f07d58426 -->
`tools/check/handover.check.mjs:48-53`

```js
export function generatedProblems(inside, text) {
  const kind = GENERATED_KIND[inside];
  if (!kind) return [];
  const has = splitBlocks(text).some((p) => p.type === 'block' && p.kind === kind);
  return has ? [] : [{ line: 1, message: `${inside} has no generated block (<!-- gen:${kind} -->)` }];
}
```
<!-- /gen -->

<!-- gen:snippet tools/check/handover.check.mjs#checkStyle sha=e9b7e97c20a5 -->
`tools/check/handover.check.mjs:98-105`

```js
export function checkStyle(text, { chars = true, words = true } = {}) {
  const found = [];
  text.split('\n').forEach((line, i) => {
    if (chars) for (const [re, what] of BANNED_CHARS) if (re.test(line)) found.push({ line: i + 1, message: what });
    if (words) for (const re of BANNED_WORDS) if (re.test(line)) found.push({ line: i + 1, message: `the phrase "${line.match(re)[0]}" reads as written by a template` });
  });
  return found;
}
```
<!-- /gen -->

1. A rule is a pure function of the text. `generatedProblems` takes the page's place in the handbook and its text, and returns a list of problems, each with a line and a message. It reads no file, so a test can call it with a string.
2. `checkStyle` reads every line and tests it against a list of banned characters and a list of banned phrases. It reads quoted code too: a dash is a dash anywhere, so a quote of code that holds one is cut with `lines=` or described. The list is built from code points in `handover.check.mjs`, so the file itself holds none of the characters it forbids.
3. `selfTest`, in the same file, feeds each rule a bad input and a good one and compares the count of problems with what it must be. `handover-check.test.ts` runs it, and runs the checker against small handbooks built for the test, each with one fault, to see that the rule meant to find it does.
4. The checker runs in `npm run check` and in the CI job of the checks. A change to the code that makes a quoted snippet stale fails it until the explanation beside the snippet is read again and `node tools/handover/build.mjs --accept` is run on the page.

## What verify does

`npm run verify` runs, in order, the type checks of both packages (the code and its tests), the linters with no warnings allowed, the tests of both packages, the builds of both, and then `npm run check`. It takes about five minutes. Run it before anything is committed, in each copy, since the two copies are separate folders that must hold the same code (only the hosted one is under git). CI runs the same steps, apart from the checks that need both copies, and adds an audit of the packages that ship, a scan for secrets and a build of both images. [GitHub and CI](../3-integrations/github-ci.md) has the whole list.

The tools in `tools/live/` are not part of `verify`. They need a running portal and, for the signed-in checks, a person's own name and password in their own shell: `signedin_check.py`, `sse_hold.py`, `page-audit.mjs`, `layout-sweep.mjs`, `keyboard-walk.mjs`, `download-check.mjs`, `load-test.mjs`, `api-timing.py` and `enforcing-csp-server.mjs`. The tools README says what each one does.
