# Web app files, one card each

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 30 min | [Server files, one card each](files-server.md) | [Tools files, one card each](files-tools.md) |

Every code file of the web app, its stylesheet parts and its checks has one card on this page, 178 in all, grouped by folder and in alphabetical order. A card is the file in a few lines. The sentence under its heading says what the file is for and where the handbook walks through it, and a person wrote it. The block below that sentence is written by `npm run handover:build` from the code, so it cannot drift: the file's size, its exports with the first sentence of each comment, what it imports, who imports it, and which tests import it.

Use the page when you know a file name and want to know what it is for and what would be hit if you changed it. The A to Z index of every name is [the symbols page](symbols.md). The same cards for the server and for the tools are [Server files](files-server.md) and [Tools files](files-tools.md).

## `web`

### `web/eslint.config.js`

The lint rules for the web app, including accessibility and hook rules. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/eslint.config.js -->
33 lines, 1 export. Imported by 0 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | constant | 8 | `export default defineConfig([// vite.config.js and .d.ts: tsc -b output from before it moved to node_modules/.tmp...` |  |

Imports: none

Packages: `@eslint/js`, `eslint`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react-hooks`, `globals`, `typescript-eslint`

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/vite.config.ts`

The build and dev-server settings, and the proxy to the server in development. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/vite.config.ts -->
33 lines, 1 export. Imported by 0 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | constant | 12 | `export default defineConfig(({ mode }) => { const env = loadEnv(mode, '.', ''); return { plugins: [react()], // Vite...` | Dev: proxy /bff -> the BFF so the browser never sees Zabbix. |

Imports: none

Packages: `@vitejs/plugin-react`, `vite`

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/vitest.config.ts`

The test settings: jsdom, the set-up file, and the stylesheet kept readable for the tests. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card web/vitest.config.ts -->
20 lines, 1 export. Imported by 0 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | constant | 4 | `export default defineConfig({ plugins: [react()], // A test may read a file of the repository outside web/ as text...` |  |

Imports: none

Packages: `@vitejs/plugin-react`, `vitest`

Imported by: none

Tests that import it: none
<!-- /gen -->

## `web/public`

### `web/public/theme.js`

Sets the theme before the first paint, so there is no flash. Walked through in [Tests and checkers](tests-and-checkers.md), [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/public/theme.js -->
8 lines, 0 exports. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

## `web/scripts`

### `web/scripts/css.check.mjs`

Checks the stylesheet is structurally sound. Walked through in [Tests and checkers](tests-and-checkers.md), [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/scripts/css.check.mjs -->
110 lines, 1 export. Imported by 0 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `checkCss` | function | 14 | `function checkCss(text)` | Problems found in `text`, each prefixed with its line number. |

Imports: none

Packages: `node:fs`, `node:url`

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/scripts/markdown.check.ts`

Assertions for the Assistant's markdown parser. Walked through in [Tests and checkers](tests-and-checkers.md), [Web app: the pages](web-features.md).

<!-- gen:card web/scripts/markdown.check.ts -->
93 lines, 0 exports. Imported by 0 files.

Imports: `features/assistant/parseMarkdown.ts`

Packages: `node:assert`

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/scripts/openapi-json.mjs`

Writes the API description as JSON beside the generated types, for the server's contract test. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/scripts/openapi-json.mjs -->
20 lines, 0 exports. Imported by 0 files.

Imports: none

Packages: `node:fs`, `node:module`, `node:url`

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/scripts/tokens.check.mjs`

Re-derives the contrast of every token pair and fails on an illegible one. Walked through in [Tests and checkers](tests-and-checkers.md), [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/scripts/tokens.check.mjs -->
704 lines, 16 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `parseColor` | function | 47 | `function parseColor(value)` | [r, g, b, a] in 0..255 / 0..1, from #rgb, #rrggbb, rgb() or rgba(). |
| `composite` | function | 65 | `function composite(fg, bg)` | A translucent colour over an opaque one, since contrast needs what the eye gets. |
| `luminance` | function | 70 | `function luminance([r, g, b])` |  |
| `contrast` | function | 78 | `function contrast(fg, bg)` |  |
| `parseTokens` | function | 89 | `function parseTokens(css)` | The custom properties declared in each token block, by the selector that opens it. |
| `resolve` | function | 124 | `function resolve(name, theme, base)` | Follow `var(--x)` chains inside one theme, falling back to the light theme. |
| `PAIRS` | constant | 140 | `const PAIRS` | Every pair the interface actually renders. |
| `checkContrast` | function | 216 | `function checkContrast(blocks)` |  |
| `checkRawColors` | function | 250 | `function checkRawColors(css)` | A raw colour anywhere but a token block. |
| `scalesOf` | function | 280 | `function scalesOf(tokens)` | The scales in a token block: the values a raw number may take, by family. |
| `checkRawSizes` | function | 319 | `function checkRawSizes(css, tokens)` | Values off their scale. |
| `checkBreakpoints` | function | 364 | `function checkBreakpoints(css, tokens)` | A media query's width is a --bp-* token's: min-width at it, max-width 0.02 px under it. |
| `checkStatusText` | function | 390 | `function checkStatusText(css)` |  |
| `TSX_EXCEPTIONS` | constant | 405 | `const TSX_EXCEPTIONS` | Off-scale sizes in the TSX files that are known and accepted, by file under src/ and the declaration, with how many: `'features/x/X.tsx':... |
| `scanTsx` | function | 418 | `function scanTsx(source, tokens)` | What a TSX file does that the tokens exist to prevent. |
| `checkTsx` | function | 467 | `function checkTsx(source, file, tokens, exceptions = TSX_EXCEPTIONS)` | The problems in one TSX file, after the known exceptions are allowed for. |

Imports: `web/scripts/tokens.export.mjs`

Packages: `node:fs`, `node:path`, `node:url`

Imported by: `web/scripts/tokens.export.mjs`

Tests that import it: `__tests__/tokenPairs.test.ts`
<!-- /gen -->

### `web/scripts/tokens.export.mjs`

Writes the token files for design tools from the stylesheet. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/scripts/tokens.export.mjs -->
248 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `exportProblems` | function | 231 | `function exportProblems()` | The files that are missing or say something else than the stylesheet: what tokens.check reports. |

Imports: `web/scripts/tokens.check.mjs`

Packages: `node:fs`, `node:path`, `node:url`

Imported by: `web/scripts/tokens.check.mjs`

Tests that import it: none
<!-- /gen -->

### `web/scripts/units.check.ts`

Assertions for the unit formatters, and a scan for percentages formatted by hand in a page. Walked through in [Tests and checkers](tests-and-checkers.md).

<!-- gen:card web/scripts/units.check.ts -->
107 lines, 1 export. Imported by 0 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `HAND_ROLLED_PERCENT` | constant | 85 | `const HAND_ROLLED_PERCENT = /\.toFixed\(\s*\d+\s*\)\s*\}?\s*%/` | No page may format a percentage by hand: `x.toFixed(2)%` is how Links read 0.5% while Network read 0.50 %. |

Imports: `shared/lib/sites.ts`, `shared/lib/time.ts`, `shared/lib/units.ts`

Packages: `node:assert`, `node:fs`, `node:path`, `node:url`

Imported by: none

Tests that import it: none
<!-- /gen -->

## `web/src`

### `web/src/App.tsx`

The route table: every page is loaded on demand, and the sign-in page sits outside the shell. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/App.tsx -->
82 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `AppRoutes` | component | 38 | `function AppRoutes()` | The route table on its own, so a test can mount it in a MemoryRouter. |
| `default` | component | 76 | `function App()` |  |

Imports: `features/assistant/Assistant.tsx`, `features/auth/Login.tsx`, `features/dashboard/Overview.tsx`, `features/graphs/HostDetail.tsx`, `features/hosts/Devices.tsx`, `features/hosts/Hosts.tsx`, `features/hosts/LatestData.tsx`, `features/network/Links.tsx`, `features/network/Maps.tsx`, `features/network/Network.tsx`, `features/network/Sites.tsx`, `features/problems/Problems.tsx`, `features/reports/AlertNoise.tsx`, `features/reports/Capacity.tsx`, `features/reports/Inventory.tsx`, `features/reports/TopTriggers.tsx`, and 6 more

Packages: `react`, `react-router-dom`

Imported by: `main.tsx`

Tests that import it: `__tests__/mainZone.test.tsx`, `__tests__/routes.test.tsx`
<!-- /gen -->

### `web/src/main.tsx`

The entry: reloads on a stale chunk, asks the server for its time zone, then renders the app. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/main.tsx -->
17 lines, 0 exports. Imported by 0 files.

Imports: `App.tsx`, `features/assistant/useAi.ts`, `features/shell/ErrorBoundary.tsx`, `styles/index.css`

Packages: `react`, `react-dom`

Imported by: none

Tests that import it: `__tests__/mainZone.test.tsx`
<!-- /gen -->

### `web/src/theme.ts`

The severity names and colours the canvas charts fall back to, because a canvas cannot read a stylesheet variable. Walked through in [Server: export](server-export.md), [Web app: the pages](web-features.md), [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/theme.ts -->
32 lines, 2 exports. Imported by 9 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `theme` | constant | 11 | `const theme` | The light theme's values, duplicated here only as fallbacks for the canvas. |
| `SEVERITIES` | constant | 25 | `const SEVERITIES` | Zabbix severities 0..5, names + colors matching Zabbix's own palette. |

Imports: none

Imported by: `features/dashboard/Overview.tsx`, `features/graphs/TimeSeriesChart.tsx`, `features/network/Sites.tsx`, `features/problems/Problems.tsx`, `features/reports/AlertNoise.tsx`, `features/sla/Availability.tsx`, `features/sla/Services.tsx`, `shared/components/StatusBadge.tsx`, `shared/lib/severity.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/vite-env.d.ts`

Tells TypeScript about the types Vite adds. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/vite-env.d.ts -->
1 line, 0 exports. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

## `web/src/api`

### `web/src/api/assistant.ts`

The calls behind Explain and the Assistant: two explanations, the streamed chat and its warm-up. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/api/assistant.ts -->
96 lines, 4 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ExplainSlaQuery` | type | 8 | `type ExplainSlaQuery = \| { slaid: string; serviceid?: string } \| { source: 'derived'; month?: string; profile?:...` |  |
| `chatStream` | function | 19 | `async function chatStream(messages: ChatMessage[], on: { onContext?: (c: ChatContext) => void; onToken: (t: string)...` | The assistant. |
| `chatWarm` | function | 76 | `async function chatWarm(): Promise<void>` | Ask the BFF to load the local model now, so the first question does not wait for it. |
| `assistantApi` | constant | 80 | `const assistantApi` |  |

Imports: `api/client.ts`, `api/session.ts`, `guards/index.ts`, `types/index.ts`

Imported by: `api/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/api/client.ts`

The one place a request leaves the page: deadlines, the abort signal, the 401 handling and the failure message. Walked through in [Web app: the API client, the types and the guards](web-api-types-guards.md).

<!-- gen:card web/src/api/client.ts -->
183 lines, 11 exports. Imported by 11 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `currentSignal` | constant | 19 | `let currentSignal: AbortSignal \| undefined` | The abort signal for requests started right now; see `withSignal`. |
| `withSignal` | function | 22 | `function withSignal<T>(signal: AbortSignal \| undefined, fn: () => T): T` | Run `fn`, attaching `signal` to each `request()` it starts synchronously. |
| `HttpFailure` | class | 37 | `class HttpFailure extends Error` | A reply that was not a success. |
| `fetchOk` | function | 49 | `async function fetchOk(path: string, signal: AbortSignal \| undefined): Promise<Response>` | The GET behind every read, JSON or file, so a 401 and a failure's message are handled in one place. |
| `EXPLAIN_TIMEOUT_MS` | constant | 76 | `const EXPLAIN_TIMEOUT_MS = 450_000` | An explanation reads Zabbix, then waits on a language model (30 s with one retry hosted, 120 s local). |
| `SLI_TIMEOUT_MS` | constant | 79 | `const SLI_TIMEOUT_MS = 450_000` | The first monthly SLA after a restart is computed from months of events. |
| `request` | function | 89 | `async function request<T>(path: string, init: { signal?: AbortSignal; timeoutMs?: number; guard?: Guard<T> } = {}):...` | All portal data goes through /bff (proxied to the BFF); the browser never sees Zabbix. |
| `post` | function | 173 | `const post = <T>(path: string, body: unknown, guard?: Guard<T>, timeoutMs?: number): Promise<T> =>` |  |
| `put` | function | 174 | `const put = <T>(path: string, body: unknown, guard?: Guard<T>): Promise<T> =>` |  |
| `del` | function | 175 | `const del = <T>(path: string, guard?: Guard<T>): Promise<T> =>` |  |
| `qs` | function | 177 | `const qs = (params: Record<string, string \| number \| undefined>) =>` |  |

Imports: `api/session.ts`, `guards/index.ts`, `shared/lib/freshness.ts`

Imported by: `api/assistant.ts`, `api/dashboard.ts`, `api/graphs.ts`, `api/hosts.ts`, `api/index.ts`, `api/meters.ts`, `api/network.ts`, `api/problems.ts`, `api/reports.ts`, `api/shell.ts`, `api/sla.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/api/dashboard.ts`

The calls behind what the Dashboard shows besides the problem list. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/api/dashboard.ts -->
16 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `dashboardApi` | constant | 7 | `const dashboardApi` |  |

Imports: `api/client.ts`, `guards/index.ts`, `types/index.ts`

Imported by: `api/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/api/graphs.ts`

The call behind the Graphs page. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/api/graphs.ts -->
22 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `graphsApi` | constant | 7 | `const graphsApi` |  |

Imports: `api/client.ts`, `guards/index.ts`, `types/index.ts`

Imported by: `api/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/api/hosts.ts`

The calls behind the Hosts, Devices and Latest data pages. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/api/hosts.ts -->
24 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `hostsApi` | constant | 7 | `const hostsApi` |  |

Imports: `api/client.ts`, `guards/index.ts`, `types/index.ts`

Imported by: `api/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/api/index.ts`

Joins the per-feature calls into the one api object the pages import. Walked through in [Web app: the API client, the types and the guards](web-api-types-guards.md).

<!-- gen:card web/src/api/index.ts -->
61 lines, 1 export, 19 re-exports. Imported by 37 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `api` | constant | 21 | `const api` |  |
| `recordSession` | re-export | 34 | `from './session'` |  |
| `sessionTiming` | re-export | 34 | `from './session'` |  |
| `isSignedOut` | re-export | 34 | `from './session'` |  |
| `AUTH_CHANGED` | re-export | 34 | `from './session'` |  |
| `goToSignIn` | re-export | 34 | `from './session'` |  |
| `renewSession` | re-export | 34 | `from './session'` |  |
| `login` | re-export | 34 | `from './session'` |  |
| `logout` | re-export | 34 | `from './session'` |  |
| `onSessionChange` | re-export | 34 | `from './session'` |  |
| `withSignal` | re-export | 35 | `from './client'` |  |
| `HttpFailure` | re-export | 35 | `from './client'` |  |
| `fileNameFrom` | re-export | 36 | `from './sla'` |  |
| `reportFileName` | re-export | 36 | `from './sla'` |  |
| `AvailabilityQuery` | re-export | 37 | `from './sla'` |  |
| `ReportFormat` | re-export | 37 | `from './sla'` |  |
| `ExplainSlaQuery` | re-export | 38 | `from './assistant'` |  |
| `chatStream` | re-export | 39 | `from './assistant'` |  |
| `chatWarm` | re-export | 39 | `from './assistant'` |  |
| `streamUrl` | re-export | 40 | `from './problems'` |  |

Imports: `api/assistant.ts`, `api/client.ts`, `api/dashboard.ts`, `api/graphs.ts`, `api/hosts.ts`, `api/meters.ts`, `api/network.ts`, `api/problems.ts`, `api/reports.ts`, `api/session.ts`, `api/shell.ts`, `api/sla.ts`

Imported by: `features/assistant/Assistant.tsx`, `features/assistant/ExplainPanel.tsx`, `features/assistant/useAi.ts`, `features/assistant/useModel.ts`, `features/auth/Login.tsx`, `features/dashboard/Overview.tsx`, `features/dashboard/useHostsView.ts`, `features/graphs/HostDetail.tsx`, `features/graphs/ItemPicker.tsx`, `features/graphs/TimeSeriesChart.tsx`, `features/hosts/Devices.tsx`, `features/hosts/Hosts.tsx`, `features/hosts/LatestData.tsx`, `features/meters/useMeters.ts`, and 23 more

Tests that import it: `__tests__/OperatorWording.test.tsx`, `__tests__/aiLimitMessage.test.ts`, `__tests__/backForward.test.ts`, `__tests__/backForwardUser.test.ts`, `__tests__/chatStreamEnd.test.ts`, `__tests__/countPills.test.tsx`, `__tests__/guardedReads.test.tsx`, `__tests__/hostListFailure.test.tsx`, and 50 more
<!-- /gen -->

### `web/src/api/meters.ts`

The call behind the internet traffic meters. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/api/meters.ts -->
10 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `metersApi` | constant | 7 | `const metersApi` |  |

Imports: `api/client.ts`, `guards/index.ts`, `types/index.ts`

Imported by: `api/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/api/network.ts`

The calls behind the network pages: devices and interfaces, maps, sites and links. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/api/network.ts -->
22 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `networkApi` | constant | 7 | `const networkApi` |  |

Imports: `api/client.ts`, `guards/index.ts`, `types/index.ts`

Imported by: `api/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/api/problems.ts`

The problem list, the live stream's address and the portal's one write. Walked through in [Web app: the API client, the types and the guards](web-api-types-guards.md).

<!-- gen:card web/src/api/problems.ts -->
21 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `streamUrl` | function | 8 | `function streamUrl(): string` | The live stream. |
| `problemsApi` | constant | 12 | `const problemsApi` |  |

Imports: `api/client.ts`, `guards/index.ts`, `types/index.ts`

Imported by: `api/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/api/reports.ts`

The calls behind the reports. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/api/reports.ts -->
17 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `reportsApi` | constant | 7 | `const reportsApi` |  |

Imports: `api/client.ts`, `guards/index.ts`, `types/index.ts`

Imported by: `api/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/api/session.ts`

Sign-in, sign-out, session renewal, the cross-site header on every POST, and what happens when a session ends. Walked through in [Web app: the API client, the types and the guards](web-api-types-guards.md).

<!-- gen:card web/src/api/session.ts -->
226 lines, 13 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `onSessionChange` | function | 26 | `function onSessionChange(listener: () => void): () => void` | For what a page keeps for one person: `listener` runs whenever this tab or another signs in, signs out or changes role. |
| `CSRF` | constant | 42 | `const CSRF` | Every POST carries this; with the session in a cookie the BFF refuses one without it. |
| `recordSession` | function | 53 | `function recordSession(expiresIn: unknown, user?: { name: string; role: string } \| null): void` | Note a session the BFF just described: `expiresIn` seconds from now. |
| `sessionTiming` | function | 62 | `const sessionTiming = () =>` | When the session ends and how long it had left when the page heard, or null when unknown. |
| `isSignedOut` | function | 64 | `const isSignedOut = () =>` |  |
| `lastKnownUser` | function | 67 | `const lastKnownUser = () =>` | The user the last answer named, so a page that comes back from the back/forward cache can tell whether someone else signed in meanwhile. |
| `endSession` | function | 70 | `function endSession(): void` | A refused request ends what the page knew of its session; sign-in takes over from there (`goToSignIn`). |
| `AUTH_CHANGED` | constant | 75 | `const AUTH_CHANGED` | Fired on window when the user or role may have changed, here or in another tab, so the menus follow it (useAuth). |
| `userOrRoleChanged` | function | 87 | `function userOrRoleChanged(): void` | Another person or another role is signed in on this page: the menus follow it, and so does what a page keeps for one person. |
| `goToSignIn` | function | 111 | `function goToSignIn(): void` | Off to sign in, remembering the page to come back to, so a wall screen returns to its wall mode and a filtered list to its filters. |
| `renewSession` | function | 124 | `function renewSession(): Promise<'renewed' \| 'failed' \| 'signed-out'>` | Swap the session for a fresh one (POST /api/auth/refresh). |
| `login` | function | 170 | `async function login(username: string, password: string)` | Sign in. |
| `logout` | function | 211 | `async function logout(): Promise<void>` | Sign out, here and in every other tab, once the server has answered: a failed request leaves the page signed in and the caller gets the error. |

Imports: `shared/lib/chatStore.ts`

Imported by: `api/assistant.ts`, `api/client.ts`, `api/index.ts`, `api/shell.ts`

Tests that import it: `__tests__/signOutFailure.test.ts`
<!-- /gen -->

### `web/src/api/shell.ts`

The two calls the shell makes first: what the server says about itself and who is signed in. Walked through in [Web app: the API client, the types and the guards](web-api-types-guards.md).

<!-- gen:card web/src/api/shell.ts -->
17 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `shellApi` | constant | 8 | `const shellApi` |  |

Imports: `api/client.ts`, `api/session.ts`, `guards/index.ts`, `types/index.ts`

Imported by: `api/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/api/sla.ts`

The calls behind availability and SLA, and the SLA report downloads. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/api/sla.ts -->
123 lines, 5 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ReportFormat` | type | 8 | `type ReportFormat = 'pdf' \| 'xlsx' \| 'csv'` | The three file types the monthly SLA report comes in. |
| `fileNameFrom` | function | 15 | `function fileNameFrom(disposition: string \| null, fallback: string): string` | The file name a Content-Disposition header proposes, or `fallback` when it names none. |
| `reportFileName` | function | 42 | `function reportFileName(disposition: string \| null, month: string, format: ReportFormat): string` | The name to save a report under: the one the BFF sent when it ends in the format's own extension and holds no invisible formatting characters... |
| `AvailabilityQuery` | interface | 56 | `interface AvailabilityQuery` |  |
| `slaApi` | constant | 66 | `const slaApi` |  |

Imports: `api/client.ts`, `guards/index.ts`, `types/index.ts`

Imported by: `api/index.ts`

Tests that import it: none
<!-- /gen -->

## `web/src/features/assistant`

### `web/src/features/assistant/AiDataNotice.tsx`

Says next to an AI answer whether the question left this machine. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/assistant/AiDataNotice.tsx -->
18 lines, 1 export. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 13 | `function AiDataNotice({ kind }: { kind: keyof typeof SENT })` | Says next to an AI answer when the question left this machine: the hosted portal names Anthropic, and a local model shows nothing. |

Imports: `features/assistant/useAi.ts`

Imported by: `features/assistant/Assistant.tsx`, `features/assistant/ExplainPanel.tsx`

Tests that import it: none
<!-- /gen -->

### `web/src/features/assistant/Assistant.tsx`

The Assistant page: free-form questions about the estate, answered as they are written. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/assistant/Assistant.tsx -->
316 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ContextStrip` | component | 42 | `function ContextStrip({ context }: { context: ChatContext \| null })` |  |
| `default` | component | 79 | `function Assistant()` |  |

Imports: `api/index.ts`, `features/assistant/AiDataNotice.tsx`, `features/assistant/Markdown.tsx`, `features/assistant/ModelOfflineNotice.tsx`, `features/assistant/useAi.ts`, `shared/components/states.tsx`, `shared/hooks/useAuth.ts`, `shared/hooks/useNow.ts`, `shared/lib/chatStore.ts`, `shared/lib/plural.ts`, `types/index.ts`

Packages: `react`

Imported by: `App.tsx`

Tests that import it: `__tests__/OperatorWording.test.tsx`, `features/assistant/Assistant.test.tsx`, `features/assistant/ContextStrip.test.tsx`, `features/assistant/aiNotice.test.tsx`, `features/assistant/assistantSignOutRace.test.tsx`, `features/assistant/modelNotice.test.tsx`
<!-- /gen -->

### `web/src/features/assistant/ExplainPanel.tsx`

The slide-over that explains one problem or one SLA figure in plain words. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/assistant/ExplainPanel.tsx -->
254 lines, 3 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ProblemExplainPanel` | component | 95 | `function ProblemExplainPanel({ problem, onClose, }: { problem: Problem; onClose: () => void; })` | Tags + notification wording for one problem. |
| `DerivedSlaScope` | interface | 171 | `interface DerivedSlaScope` | One scope of the portal-derived monthly SLA (source=derived on the BFF). |
| `SlaExplainPanel` | component | 183 | `function SlaExplainPanel(props: \| { sla: Pick<Sla, 'slaid' \| 'name'> & { slo: Sla['slo'] \| number }; serviceid?:...` |  |

Imports: `api/index.ts`, `features/assistant/AiDataNotice.tsx`, `features/assistant/ModelOfflineNotice.tsx`, `shared/components/NoData.tsx`, `shared/components/StatusBadge.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useDialogFocus.ts`, `shared/lib/severity.ts`, `types/index.ts`

Packages: `react`

Imported by: `features/problems/Problems.tsx`, `features/sla/Services.tsx`, `features/sla/Sla.tsx`

Tests that import it: `features/assistant/aiNotice.test.tsx`, `features/assistant/modelNotice.test.tsx`
<!-- /gen -->

### `web/src/features/assistant/Markdown.tsx`

Draws the small slice of markdown the Assistant may write. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/assistant/Markdown.tsx -->
81 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 40 | `function Markdown({ text, className }: { text: string; className?: string })` |  |

Imports: `features/assistant/parseMarkdown.ts`

Packages: `react`

Imported by: `features/assistant/Assistant.tsx`

Tests that import it: none
<!-- /gen -->

### `web/src/features/assistant/ModelOfflineNotice.tsx`

Says so when the AI model is not answering, before a click that would only fail. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/assistant/ModelOfflineNotice.tsx -->
15 lines, 1 export. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 7 | `function ModelOfflineNotice()` | Says so when the AI model is not answering, before a click that would only fail. |

Imports: `features/assistant/useModel.ts`

Imported by: `features/assistant/Assistant.tsx`, `features/assistant/ExplainPanel.tsx`

Tests that import it: none
<!-- /gen -->

### `web/src/features/assistant/parseMarkdown.ts`

Reads the assistant's markdown into blocks and inline pieces, allowing nothing that could carry a link or a script. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/assistant/parseMarkdown.ts -->
155 lines, 4 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Inline` | type | 11 | `type Inline = \| { type: 'text'; text: string } \| { type: 'bold'; children: Inline[] } \| { type: 'code'; text: string }` |  |
| `Block` | type | 16 | `type Block = \| { type: 'paragraph'; lines: Inline[][]; strong?: boolean } \| { type: 'ul'; items: Inline[][] } \|...` |  |
| `parseInline` | function | 43 | `function parseInline(text: string, allowBold = true): Inline[]` | Left to right: a backtick with a closing partner opens a code span (literal content); "**" with a closing partner opens bold, whose content may... |
| `parseMarkdown` | function | 89 | `function parseMarkdown(text: string): Block[]` |  |

Imports: none

Imported by: `web/scripts/markdown.check.ts`, `features/assistant/Markdown.tsx`

Tests that import it: `features/assistant/parseMarkdown.test.ts`
<!-- /gen -->

### `web/src/features/assistant/useAi.ts`

Asks the server once what it can do (AI on or off, its time zone) and shares the answer. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/assistant/useAi.ts -->
98 lines, 3 exports. Imported by 8 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `loadCapabilities` | function | 47 | `function loadCapabilities(): Promise<Capabilities>` | Ask /api/health once and share the answer; also where the server's time zone is taken (main.tsx starts this). |
| `useCapabilities` | hook | 72 | `function useCapabilities(): Capabilities & { retry: () => void }` |  |
| `useAiEnabled` | hook | 96 | `function useAiEnabled(): boolean` | Convenience for the pages that only care about the plain-language layer. |

Imports: `api/index.ts`, `shared/lib/time.ts`

Packages: `react`

Imported by: `features/assistant/AiDataNotice.tsx`, `features/assistant/Assistant.tsx`, `features/problems/Problems.tsx`, `features/shell/Sidebar.tsx`, `features/sla/Availability.tsx`, `features/sla/Services.tsx`, `features/sla/Sla.tsx`, `main.tsx`

Tests that import it: `__tests__/OperatorWording.test.tsx`, `features/assistant/aiNotice.test.tsx`, `features/assistant/useAi.test.tsx`, `features/problems/ProblemsPage.test.tsx`, `features/shell/LayoutSignOut.test.tsx`, `features/shell/Sidebar.test.tsx`
<!-- /gen -->

### `web/src/features/assistant/useModel.ts`

Whether the AI model is known not to answer. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/assistant/useModel.ts -->
27 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `useModelDown` | hook | 12 | `function useModelDown(): boolean` | Whether the AI model is known not to answer, from the `ready.model` a signed-in /api/health carries (the BFF checks it at most every 15 s). |

Imports: `api/index.ts`

Packages: `react`

Imported by: `features/assistant/ModelOfflineNotice.tsx`

Tests that import it: `features/assistant/modelNotice.test.tsx`
<!-- /gen -->

## `web/src/features/auth`

### `web/src/features/auth/Login.tsx`

The sign-in page, and the safe path to return to afterwards. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/auth/Login.tsx -->
106 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `returnPath` | function | 11 | `function returnPath(search: string): string` | Where to go after signing in: the page the session ended on (api/session.ts goToSignIn), but only a path on this site, never another origin. |
| `default` | component | 26 | `function Login()` |  |

Imports: `api/index.ts`, `shared/components/BrandMark.tsx`, `shared/hooks/useAuth.ts`

Packages: `react`, `react-router-dom`

Imported by: `App.tsx`

Tests that import it: `features/auth/Login.test.tsx`, `features/auth/returnPath.test.ts`
<!-- /gen -->

## `web/src/features/dashboard`

### `web/src/features/dashboard/HostsView.tsx`

The Dashboard's Hosts view: availability, device kinds, web monitoring and the busiest hosts. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/dashboard/HostsView.tsx -->
150 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 128 | `function HostsView({ q, wall }: { q: HostsViewQuery; wall: boolean })` | The Dashboard's Hosts view. |

Imports: `features/dashboard/hostsFigures.ts`, `features/dashboard/useHostsView.ts`, `features/hosts/deviceTally.ts`, `shared/components/KpiCard.tsx`, `shared/components/states.tsx`, `shared/hooks/useReportTimeZone.ts`, `shared/lib/time.ts`, `types/index.ts`

Packages: `react`, `react-router-dom`

Imported by: `features/dashboard/Overview.tsx`

Tests that import it: `features/dashboard/HostsView.test.tsx`
<!-- /gen -->

### `web/src/features/dashboard/Overview.tsx`

The Dashboard: the counts and live problem list, with tabs for the internet meters and the Hosts view, in normal or wall mode. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/dashboard/Overview.tsx -->
441 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 121 | `function Overview()` |  |

Imports: `api/index.ts`, `features/dashboard/HostsView.tsx`, `features/dashboard/Tabs.tsx`, `features/dashboard/liveList.ts`, `features/dashboard/useFitHeight.ts`, `features/dashboard/useHostsView.ts`, `features/dashboard/useWallRotation.ts`, `features/meters/InternetMeters.tsx`, `features/meters/useMeters.ts`, `features/problems/ProblemsTable.tsx`, `features/problems/useChangeHighlight.ts`, `features/shell/Layout.tsx`, `guards/index.ts`, `shared/components/BrandMark.tsx`, `shared/components/CollectorNotice.tsx`, `shared/components/KpiCard.tsx`, and 14 more

Packages: `react`, `react-router-dom`

Imported by: `App.tsx`

Tests that import it: `__tests__/OperatorWording.test.tsx`, `__tests__/guardedReads.test.tsx`, `features/dashboard/dashboardViews.test.tsx`, `shared/lib/freshness.test.tsx`
<!-- /gen -->

### `web/src/features/dashboard/Tabs.tsx`

The accessible tabs pattern used by the Dashboard and the SLA page. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/dashboard/Tabs.tsx -->
65 lines, 3 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `tabButtonId` | function | 7 | `const tabButtonId = (id: string, key: string) =>` | The ARIA tabs pattern, as the SLA page does it (one tab stop, arrow keys with Home and End, a panel the selected tab controls). |
| `tabsPanelId` | function | 8 | `const tabsPanelId = (id: string) =>` |  |
| `Tabs` | component | 10 | `function Tabs<K extends string>({ id, label, tabs, value, onChange, className = '', }: { /** Unique on the page: it...` |  |

Imports: none

Packages: `react`

Imported by: `features/dashboard/Overview.tsx`

Tests that import it: `features/dashboard/Tabs.test.tsx`
<!-- /gen -->

### `web/src/features/dashboard/fit.ts`

The scale that makes a wall screen's content fit its window. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/dashboard/fit.ts -->
42 lines, 4 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `DESIGN_HEIGHT` | constant | 6 | `const DESIGN_HEIGHT = 1080` |  |
| `FIT_MIN` | constant | 9 | `const FIT_MIN = 0.8` | The smallest scale at 1080p: the wall's text at this factor is about a normal page's. |
| `fitBounds` | function | 18 | `function fitBounds(windowHeight: number): { min: number; max: number }` | The smallest and largest scale for a window this tall, in proportion to 1080p: never above 1 at or below it. |
| `fitScale` | function | 27 | `function fitScale(heightAt: (scale: number) => number, room: number, bounds = fitBounds(DESIGN_HEIGHT)): number` | The largest scale within `bounds` at which the grid fits `room` pixels; `heightAt(s)` is its height laid out 1/s times as wide, as it is when... |

Imports: none

Imported by: `features/dashboard/useFitHeight.ts`

Tests that import it: `features/dashboard/fit.test.ts`, `features/dashboard/useFitHeight.test.tsx`
<!-- /gen -->

### `web/src/features/dashboard/hostsFigures.ts`

Host availability and usage words, as the Zabbix widgets count and name them. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/dashboard/hostsFigures.ts -->
56 lines, 12 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `HostAvailability` | interface | 3 | `interface HostAvailability` |  |
| `availability` | function | 15 | `function availability(devices: Device[]): HostAvailability` | Host availability as Zabbix's "Host availability" widget counts it, from the portal's own reachability states (ping first, the interface flags as... |
| `percentUp` | function | 30 | `const percentUp = (a: HostAvailability): number \| null =>` | The share of the monitored hosts that are up, to one decimal; null with none. |
| `BUSY` | constant | 33 | `const BUSY = 75` | From this share of use a host is written in the warning colour, and from the higher one in the critical colour. |
| `HOT` | constant | 34 | `const HOT = 90` |  |
| `usageWords` | function | 37 | `const usageWords = (value: number): string =>` | How a use figure reads: "87%". |
| `emptyTopWords` | function | 40 | `function emptyTopWords(m: TopHostsMetric): string` | The line under a list of busy hosts when it has no rows, and why. |
| `WEB_SUB` | constant | 46 | `const WEB_SUB` | What a tile of web monitoring says under its count. |
| `NO_WEB_WORDS` | constant | 49 | `const NO_WEB_WORDS` | The panel's line when Zabbix has no web scenario to count. |
| `WALL_FAILURES` | constant | 52 | `const WALL_FAILURES = 3` | The most a wall lists of the failed scenarios and of each list of busy hosts: it cannot scroll, and the slide has to fit with the rest. |
| `WALL_TOP_ROWS` | constant | 53 | `const WALL_TOP_ROWS = 8` |  |
| `failureWords` | function | 56 | `const failureWords = (f: WebFailure): string =>` | Which step of a scenario failed. |

Imports: `types/index.ts`

Imported by: `features/dashboard/HostsView.tsx`

Tests that import it: `features/dashboard/hostsFigures.test.ts`
<!-- /gen -->

### `web/src/features/dashboard/liveList.ts`

Which problems the Dashboard's live list shows, worst first. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/dashboard/liveList.ts -->
32 lines, 4 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `LIVE_ROWS` | constant | 4 | `const LIVE_ROWS = 12` | Rows in the live list; the rest are one click away on the Problems page (DESIGN.md section 9). |
| `worstFirst` | function | 7 | `const worstFirst = (a: Problem, b: Problem) =>` | Worst first: severity, then newest. |
| `topRows` | function | 13 | `const topRows = (open: Problem[]) =>` | The rows the live list shows for an open list, before any cleared ones are added back. |
| `liveRows` | function | 19 | `function liveRows(open: Problem[], cleared: Problem[]): Problem[]` | The live list: the worst LIVE_ROWS open problems, plus any that just cleared (the wall's highlight), each in the place its severity and age give it. |

Imports: `types/index.ts`

Imported by: `features/dashboard/Overview.tsx`

Tests that import it: `features/dashboard/liveList.test.ts`, `features/problems/useChangeHighlight.test.ts`
<!-- /gen -->

### `web/src/features/dashboard/useFitHeight.ts`

Draws the wall's content at the scale that fits and sizes its box to match. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/dashboard/useFitHeight.ts -->
66 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `useFitHeight` | hook | 11 | `function useFitHeight<W extends HTMLElement, I extends HTMLElement>(enabled: boolean, deps: unknown[])` | On a wall (`enabled`), draws `inner` at the scale that fits the window below it and sizes `wrap` to what is seen: the grid is laid out at 1/scale... |

Imports: `features/dashboard/fit.ts`

Packages: `react`

Imported by: `features/dashboard/Overview.tsx`

Tests that import it: `features/dashboard/useFitHeight.test.tsx`
<!-- /gen -->

### `web/src/features/dashboard/useHostsView.ts`

Loads what the Hosts view needs in one place. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/dashboard/useHostsView.ts -->
16 lines, 2 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `useHostsView` | hook | 9 | `function useHostsView()` | What the Dashboard's Hosts view shows: every host as a device (the Devices page's own request), the busiest hosts by CPU and memory, and the web... |
| `HostsViewQuery` | type | 16 | `type HostsViewQuery = ReturnType<typeof useHostsView>` |  |

Imports: `api/index.ts`, `shared/hooks/useAsync.ts`, `types/index.ts`

Imported by: `features/dashboard/HostsView.tsx`, `features/dashboard/Overview.tsx`

Tests that import it: `features/dashboard/HostsView.test.tsx`, `features/dashboard/useHostsView.test.tsx`
<!-- /gen -->

### `web/src/features/dashboard/useWallRotation.ts`

Turns through the wall's slides, 30 seconds on each unless the address says `rotate=` (10 to 600; 0 stops it). No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/dashboard/useWallRotation.ts -->
22 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `useWallRotation` | hook | 8 | `function useWallRotation(slides: Slide[], seconds: number, paused: boolean)` | Turns through the slides, `seconds` on each; stands still with one slide, 0 seconds, or while `paused`. |

Imports: `shared/lib/wall.ts`

Packages: `react`

Imported by: `features/dashboard/Overview.tsx`

Tests that import it: none
<!-- /gen -->

## `web/src/features/graphs`

### `web/src/features/graphs/HostDetail.tsx`

The Graphs page: one host, up to four items, any range. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/graphs/HostDetail.tsx -->
177 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 37 | `function HostDetail()` | Graphs: one host, up to four of its items, any range. |

Imports: `api/index.ts`, `features/graphs/ItemPicker.tsx`, `features/graphs/RangePicker.tsx`, `features/graphs/TimeSeriesChart.tsx`, `shared/components/Field.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useUrlState.ts`, `shared/lib/sites.ts`, `types/index.ts`

Packages: `react`, `react-router-dom`

Imported by: `App.tsx`

Tests that import it: `__tests__/hostListFailure.test.tsx`, `features/graphs/HostDetail.test.tsx`
<!-- /gen -->

### `web/src/features/graphs/ItemPicker.tsx`

A searchable, grouped picker for the items of one host. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/graphs/ItemPicker.tsx -->
266 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 82 | `function ItemPicker({ hostid, selected, onChange, onItems, max = 4, }: { hostid: string; selected: string[]...` | Searchable, grouped picker for up to `max` graphable items of one host. |

Imports: `api/index.ts`, `features/graphs/unitScales.ts`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/lib/sites.ts`, `types/index.ts`

Packages: `react`

Imported by: `features/graphs/HostDetail.tsx`

Tests that import it: `features/graphs/ItemPickerPressed.test.tsx`, `features/graphs/ItemPickerSession.test.tsx`, `features/graphs/unitScales.test.tsx`
<!-- /gen -->

### `web/src/features/graphs/RangePicker.tsx`

The time range: presets, a custom range and a live range, kept in the address. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/graphs/RangePicker.tsx -->
165 lines, 5 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `PRESETS` | constant | 8 | `const PRESETS: { label: string; hours: number }[]` |  |
| `rangeKey` | function | 27 | `function rangeKey(r: GraphRange): string` | A stable string for a range. |
| `isLiveRange` | function | 32 | `function isLiveRange(r: GraphRange): boolean` | Does the window end at "now" (so the graph should refresh)? |
| `useUrlRange` | hook | 43 | `function useUrlRange(defaultHours = 24): [GraphRange, (r: GraphRange) => void]` | The graph range, kept in the URL so a graph can be linked: `range=24h` \| `month=2026-08` \| `from=<epoch s>&to=<epoch s>`. |
| `default` | component | 69 | `function RangePicker({ value, onChange }: { value: GraphRange; onChange: (r: GraphRange) => void })` | Presets ending now, a calendar month (in the report zone), or a custom from/to. |

Imports: `shared/hooks/useReportTimeZone.ts`, `shared/hooks/useUrlState.ts`, `shared/lib/time.ts`, `types/index.ts`

Packages: `react`, `react-router-dom`

Imported by: `features/graphs/HostDetail.tsx`, `features/graphs/TimeSeriesChart.tsx`, `features/network/Network.tsx`

Tests that import it: `__tests__/reportZoneUi.test.tsx`, `features/graphs/graphZone.test.tsx`
<!-- /gen -->

### `web/src/features/graphs/StaleNote.tsx`

Says so when a graph is thinner or older than it looks. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/graphs/StaleNote.tsx -->
58 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 16 | `function StaleNote({ from, to, series, latestClock, }: { from: number; to: number; series: GraphSeries[]...` | Says so when a graph is thinner or older than it looks: - "Data covers 0.5 h of 24 h" when a series has values for under 90 % of the window; - "No... |

Imports: `shared/lib/severity.ts`, `types/index.ts`

Imported by: `features/graphs/TimeSeriesChart.tsx`

Tests that import it: none
<!-- /gen -->

### `web/src/features/graphs/TimeSeriesChart.tsx`

The chart: draws the series with ECharts, with its tooltip and the Show data table. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/graphs/TimeSeriesChart.tsx -->
512 lines, 3 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `seriesColors` | function | 64 | `function seriesColors(): string[]` | The four series colours, read out of the stylesheet rather than written here, because ECharts paints to a canvas and a canvas cannot resolve... |
| `default` | component | 102 | `function TimeSeriesChart({ series, from, to, height = 320, dataOpen, onDataOpenChange, }: { series: GraphSeries[]...` | Line chart for 1 to 4 /api/graph series. |
| `GraphView` | component | 443 | `function GraphView({ itemids, range, height, empty = 'No data in this range.', }: { itemids: string[]; range:...` | Fetch + stale note + chart for a set of items over a range. |

Imports: `api/index.ts`, `features/graphs/RangePicker.tsx`, `features/graphs/StaleNote.tsx`, `features/graphs/chartCsv.ts`, `features/graphs/chartTable.ts`, `features/graphs/unitScales.ts`, `features/graphs/useThemeChange.ts`, `shared/components/NoData.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useReportTimeZone.ts`, `shared/lib/csv.ts`, `shared/lib/severity.ts`, `shared/lib/time.ts`, `shared/lib/units.ts`, `theme.ts`, and 1 more

Packages: `echarts`, `echarts-for-react`, `react`

Imported by: `features/graphs/HostDetail.tsx`, `features/network/Network.tsx`

Tests that import it: `features/graphs/GraphView.test.tsx`, `features/graphs/TimeSeriesChart.test.tsx`, `features/graphs/TimeSeriesChartSeries.test.tsx`, `features/graphs/chartZone.test.tsx`, `features/graphs/graphZone.test.tsx`, `features/graphs/unitScales.test.tsx`, `features/graphs/useThemeChange.test.tsx`, `features/network/networkPorts.test.tsx`
<!-- /gen -->

### `web/src/features/graphs/chartCsv.ts`

The Show data table as rows for a CSV file. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/graphs/chartCsv.ts -->
37 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `chartCsvRows` | function | 11 | `function chartCsvRows(series: GraphSeries[], tz = reportTimeZone()): unknown[][]` | The Show data table as rows for a CSV file: the same rows, joined on time exactly as the table joins them, and the same columns (Average, Min and... |
| `chartCsvFileName` | function | 33 | `function chartCsvFileName(from: number, to: number, tz = reportTimeZone()): string` | `hcml-graph-2026-10-19.csv`, or `hcml-graph-2026-10-18-to-2026-10-19.csv` when the window spans two days of the report zone. |

Imports: `features/graphs/chartTable.ts`, `shared/lib/time.ts`, `types/index.ts`

Imported by: `features/graphs/TimeSeriesChart.tsx`

Tests that import it: `features/graphs/chartCsv.test.ts`
<!-- /gen -->

### `web/src/features/graphs/chartTable.ts`

The Show data table: the series joined on time. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/graphs/chartTable.ts -->
47 lines, 4 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `isRanged` | function | 7 | `const isRanged = (s: GraphSeries): boolean =>` | The same condition as the tooltip's range: a trend point carries its min and max, a step line does not. |
| `ChartTable` | interface | 9 | `interface ChartTable` |  |
| `chartTable` | function | 23 | `function chartTable(series: GraphSeries[]): ChartTable` | The plotted points of every series as one table, a column group per series, joined on the exact time a point carries. |
| `seriesLabel` | function | 40 | `function seriesLabel(s: GraphSeries, all: GraphSeries[]): string` | A series' name without the shared "Interface X(alias): " prefix when every series has it, and with its host when the hosts differ. |

Imports: `types/index.ts`

Imported by: `features/graphs/TimeSeriesChart.tsx`, `features/graphs/chartCsv.ts`

Tests that import it: `features/graphs/chartTable.test.ts`
<!-- /gen -->

### `web/src/features/graphs/unitScales.ts`

The most kinds of unit one graph holds, two, and how a list of units is counted. Walked through in [Web: the features](web-features.md).

<!-- gen:card web/src/features/graphs/unitScales.ts -->
5 lines, 2 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `MAX_UNIT_SCALES` | constant | 2 | `const MAX_UNIT_SCALES = 2` | A graph has a scale on each side, so it can hold two kinds of unit at most. |
| `unitFamilies` | function | 5 | `const unitFamilies = (units: (string \| undefined)[]): string[] =>` | The kinds of unit among these, each once, in the order it first appears; no unit is a kind of its own. |

Imports: none

Imported by: `features/graphs/ItemPicker.tsx`, `features/graphs/TimeSeriesChart.tsx`

Tests that import it: `features/graphs/unitScales.test.tsx`
<!-- /gen -->

### `web/src/features/graphs/useThemeChange.ts`

Redraws when the theme changes, because a canvas cannot follow a CSS variable. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/graphs/useThemeChange.ts -->
18 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `useThemeChange` | hook | 6 | `function useThemeChange(): void` | Re-renders when data-theme or the system colour scheme changes: a canvas cannot follow a CSS variable by itself. |

Imports: none

Packages: `react`

Imported by: `features/graphs/TimeSeriesChart.tsx`

Tests that import it: `features/graphs/useThemeChange.test.tsx`
<!-- /gen -->

## `web/src/features/hosts`

### `web/src/features/hosts/Devices.tsx`

The Devices page: a tile for each kind of device, and the hosts of the chosen kind. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/hosts/Devices.tsx -->
126 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 17 | `function Devices()` | Devices: every host as a device of one kind (naming.ts, the same kind the SLA report uses), a tile for each kind and the list of the one chosen. |

Imports: `api/index.ts`, `features/hosts/HostTable.tsx`, `features/hosts/deviceTally.ts`, `shared/components/Field.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useAuth.ts`, `shared/hooks/useUrlState.ts`, `shared/lib/plural.ts`, `types/index.ts`

Packages: `react`

Imported by: `App.tsx`

Tests that import it: `__tests__/countPills.test.tsx`, `features/hosts/Devices.test.tsx`
<!-- /gen -->

### `web/src/features/hosts/HostTable.tsx`

A host as the Hosts page and a site list it. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/hosts/HostTable.tsx -->
116 lines, 2 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `HostTableRow` | type | 9 | `type HostTableRow = HostOverview & Partial<Pick<SiteHost, 'availability' \| 'siteSource'>> & { category?: string }` | A host as the Hosts page lists it, or as a site lists its own (which also says where the site came from). |
| `HostTable` | component | 23 | `function HostTable({ hosts, siteFrom = false, showSite = false, showCategory = false, portsLink = false, }: { hosts:...` | The host table of the Hosts page and of an open site; `siteFrom` adds the "Site from" column. |

Imports: `shared/components/NoData.tsx`, `shared/components/StatusBadge.tsx`, `shared/components/TableWrap.tsx`, `shared/lib/severity.ts`, `types/index.ts`

Packages: `react-router-dom`

Imported by: `features/hosts/Devices.tsx`, `features/hosts/Hosts.tsx`, `features/network/Sites.tsx`

Tests that import it: `__tests__/sharedPieces.test.tsx`
<!-- /gen -->

### `web/src/features/hosts/Hosts.tsx`

The Hosts page. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/hosts/Hosts.tsx -->
63 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 11 | `function Hosts()` |  |

Imports: `api/index.ts`, `features/hosts/HostTable.tsx`, `shared/components/Field.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useUrlState.ts`, `shared/lib/plural.ts`, `types/index.ts`

Packages: `react`

Imported by: `App.tsx`

Tests that import it: `__tests__/countPills.test.tsx`, `__tests__/guardedReads.test.tsx`, `__tests__/sharedPages.test.tsx`, `__tests__/urlFilters.test.tsx`
<!-- /gen -->

### `web/src/features/hosts/LatestData.tsx`

The Latest data page: pick a host and see every item's latest value. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/hosts/LatestData.tsx -->
262 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 22 | `function LatestData()` | Monitoring → Latest data: pick a host (or group) and see every item's latest value. |

Imports: `api/index.ts`, `shared/components/Field.tsx`, `shared/components/NoData.tsx`, `shared/components/Pager.tsx`, `shared/components/TableWrap.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useDebounced.ts`, `shared/hooks/useUrlState.ts`, `shared/lib/severity.ts`, `shared/lib/sites.ts`, `types/index.ts`

Packages: `react`, `react-router-dom`

Imported by: `App.tsx`

Tests that import it: `__tests__/hostListFailure.test.tsx`, `__tests__/pagePastEnd.test.tsx`, `__tests__/sharedPages.test.tsx`, `features/hosts/LatestDataAny.test.tsx`
<!-- /gen -->

### `web/src/features/hosts/deviceTally.ts`

What a kind of device adds up to: how many, how many in trouble, how many silent. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/hosts/deviceTally.ts -->
21 lines, 3 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Tally` | interface | 4 | `interface Tally` | What a kind of device adds up to: how many, how many have a problem, how many do not answer. |
| `tally` | function | 10 | `const tally = (list: Device[]): Tally =>` |  |
| `trouble` | function | 17 | `const trouble = (t: Tally): string =>` | The small print under a count: what is wrong with the devices of the kind, or that nothing is. |

Imports: `types/index.ts`

Imported by: `features/dashboard/HostsView.tsx`, `features/hosts/Devices.tsx`

Tests that import it: `features/dashboard/hostsFigures.test.ts`
<!-- /gen -->

## `web/src/features/meters`

### `web/src/features/meters/Gauge.tsx`

One internet traffic meter, drawn as a dial. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/meters/Gauge.tsx -->
115 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 10 | `function Gauge({ meter: m, now }: { meter: Meter; now: number })` | One internet traffic meter, the dial of HCML's Zabbix gauge widget in the portal's palette. |

Imports: `features/meters/gaugeDial.ts`, `types/index.ts`

Packages: `react`, `react-router-dom`

Imported by: `features/meters/InternetMeters.tsx`

Tests that import it: `features/meters/Gauge.test.tsx`
<!-- /gen -->

### `web/src/features/meters/InternetMeters.tsx`

The meters: one gauge for each gauge widget of the Zabbix dashboard. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/meters/InternetMeters.tsx -->
55 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 15 | `function InternetMeters({ q, page }: { q: MetersQuery; page?: { index: number; pages: number } })` | The internet traffic meters: one gauge per gauge widget of the Zabbix dashboard HCML keeps (INTERNET_METERS_DASHBOARD). |

Imports: `features/meters/Gauge.tsx`, `features/meters/gaugeDial.ts`, `features/meters/useMeters.ts`, `shared/components/states.tsx`, `shared/hooks/useNow.ts`, `shared/hooks/useReportTimeZone.ts`, `shared/lib/time.ts`, `shared/lib/wall.ts`

Packages: `react`

Imported by: `features/dashboard/Overview.tsx`

Tests that import it: `features/meters/InternetMeters.test.tsx`
<!-- /gen -->

### `web/src/features/meters/gaugeDial.ts`

The dial as numbers and words: arcs, ticks and the reading. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/meters/gaugeDial.ts -->
177 lines, 17 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `DIAL` | constant | 11 | `const DIAL` | The dial of one internet traffic meter, as numbers and words: Gauge.tsx draws them. |
| `dialPoint` | function | 26 | `function dialPoint(fraction: number, radius: number): { x: number; y: number }` | A point on the dial: fraction 0 is the left end of the half circle, 1 the right end, 0.5 the top. |
| `arcPath` | function | 32 | `function arcPath(from: number, to: number, radius: number = DIAL.radius): string` | The path of the arc between two fractions of the dial, travelling left to right over the top. |
| `Segment` | interface | 38 | `interface Segment` |  |
| `segments` | function | 45 | `function segments(zones: MeterZone[], min: number, max: number): Segment[]` | The zones as stretches of the dial, 0 to 1. |
| `Tick` | interface | 54 | `interface Tick` |  |
| `ticks` | function | 63 | `function ticks(zones: MeterZone[], min: number, max: number, units: string): Tick[]` | Where the scale is written: both ends, and wherever a zone starts unless that is too near another label. |
| `LEVEL_WORD` | constant | 80 | `const LEVEL_WORD: Record<MeterLevel, string \| null>` | The word for a zone, as the chip under a gauge says it. |
| `percentOf` | function | 89 | `function percentOf(m: Meter): number \| null` | How far along the scale the value is, in percent, not held to 100: a link over its capacity says so. |
| `valueWords` | function | 94 | `const valueWords = (m: Meter): string =>` |  |
| `capacityWords` | function | 96 | `const capacityWords = (m: Meter): string =>` |  |
| `footWords` | function | 99 | `function footWords(m: Meter, now: number): string` | What the line under a gauge says: the zone and the share of the capacity, or why there is no gauge. |
| `historyLink` | function | 126 | `function historyLink(m: Meter): string \| null` | The Graphs page for a link: its own item first, then the other direction. |
| `headline` | function | 134 | `function headline(m: Meter): string` | The big text of a gauge: the value, or what stands in for one. |
| `hasDial` | function | 151 | `const hasDial = (m: Meter): boolean =>` | Whether a gauge is drawn: it needs a scale, and an item that can be read. |
| `otherWords` | function | 157 | `function otherWords(m: Meter): string \| null` | The other direction, written only when it is High or Critical now, as a gauge that counts one direction cannot show it. |
| `summaryWords` | function | 166 | `function summaryWords(s: MetersResponse['summary']): string` | One sentence over the grid: how many links, how many are down, high or critical (in either direction), old, or without a gauge. |

Imports: `shared/lib/freshness.ts`, `shared/lib/plural.ts`, `shared/lib/time.ts`, `shared/lib/units.ts`, `types/index.ts`

Imported by: `features/meters/Gauge.tsx`, `features/meters/InternetMeters.tsx`

Tests that import it: `features/meters/Gauge.test.tsx`, `features/meters/gaugeDial.test.ts`
<!-- /gen -->

### `web/src/features/meters/useMeters.ts`

Asks for the meters once a minute. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/meters/useMeters.ts -->
17 lines, 2 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `useMeters` | hook | 9 | `function useMeters(enabled: boolean)` | The internet traffic meters, asked once a minute and held by the Dashboard for both views, so the card, the tab and a turning wall share one request. |
| `MetersQuery` | type | 17 | `type MetersQuery = ReturnType<typeof useMeters>` |  |

Imports: `api/index.ts`, `shared/hooks/useAsync.ts`, `types/index.ts`

Imported by: `features/dashboard/Overview.tsx`, `features/meters/InternetMeters.tsx`

Tests that import it: `features/meters/InternetMeters.test.tsx`
<!-- /gen -->

## `web/src/features/network`

### `web/src/features/network/Links.tsx`

The Links and WAN health page. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/network/Links.tsx -->
268 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 96 | `function Links()` |  |

Imports: `api/index.ts`, `shared/components/Field.tsx`, `shared/components/KpiCard.tsx`, `shared/components/NoData.tsx`, `shared/components/TableWrap.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useUrlState.ts`, `shared/lib/severity.ts`, `shared/lib/units.ts`, `types/index.ts`

Packages: `react`

Imported by: `App.tsx`

Tests that import it: `features/network/Links.test.tsx`
<!-- /gen -->

### `web/src/features/network/Maps.tsx`

The Maps page: the list of Zabbix maps and the topology of the chosen one. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/network/Maps.tsx -->
285 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 46 | `function Maps()` | Monitoring → Maps: list Zabbix maps and render the selected map's topology. |

Imports: `api/index.ts`, `features/network/mapLabels.ts`, `shared/components/Field.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useUrlState.ts`, `shared/lib/plural.ts`, `shared/lib/severity.ts`, `types/index.ts`

Packages: `react`

Imported by: `App.tsx`

Tests that import it: `features/network/MapsPage.test.tsx`
<!-- /gen -->

### `web/src/features/network/Network.tsx`

The Network page: devices grouped by site, with their interfaces. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/network/Network.tsx -->
370 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 56 | `function Network()` |  |

Imports: `api/index.ts`, `features/graphs/RangePicker.tsx`, `features/graphs/TimeSeriesChart.tsx`, `shared/components/Field.tsx`, `shared/components/NoData.tsx`, `shared/components/Pager.tsx`, `shared/components/StatusBadge.tsx`, `shared/components/TableWrap.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useAuth.ts`, `shared/hooks/useDebounced.ts`, `shared/hooks/useUrlState.ts`, `shared/lib/sites.ts`, `shared/lib/units.ts`, `types/index.ts`

Packages: `react`

Imported by: `App.tsx`

Tests that import it: `__tests__/OperatorWording.test.tsx`, `__tests__/pagePastEnd.test.tsx`, `__tests__/sharedPages.test.tsx`, `features/network/networkPorts.test.tsx`
<!-- /gen -->

### `web/src/features/network/Sites.tsx`

The Sites page: a card for each site with its worst problem. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/network/Sites.tsx -->
220 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 129 | `function Sites()` |  |

Imports: `api/index.ts`, `features/hosts/HostTable.tsx`, `shared/components/Field.tsx`, `shared/components/StatusBadge.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useUrlState.ts`, `shared/lib/plural.ts`, `theme.ts`, `types/index.ts`

Packages: `react`

Imported by: `App.tsx`

Tests that import it: `__tests__/countPills.test.tsx`, `__tests__/sharedPages.test.tsx`, `__tests__/tooltipFacts.test.tsx`, `__tests__/urlFilters.test.tsx`
<!-- /gen -->

### `web/src/features/network/mapLabels.ts`

Where each element's name goes on a map, kept inside the map. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/network/mapLabels.ts -->
138 lines, 10 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ICON_W` | constant | 13 | `const ICON_W = 48` | An element's box, as MapCanvas draws it. |
| `ICON_H` | constant | 14 | `const ICON_H = 32` |  |
| `MAX_CHARS` | constant | 21 | `const MAX_CHARS = 26` | A name is cut here, with an ellipsis. |
| `textWidth` | function | 54 | `const textWidth = (line: string, size: number) =>` | The width a line takes at a type size, in map units. |
| `Box` | type | 56 | `type Box = { x1: number; y1: number; x2: number; y2: number }` |  |
| `clipLine` | function | 61 | `const clipLine = (line: string) =>` | The name line as drawn: cut at MAX_CHARS. |
| `labelBox` | function | 67 | `function labelBox(x: number, y: number, lines: string[], dy: number): Box \| null` | The box a label takes at (x, y) when shifted `dy` down from its usual place, in map units. |
| `LabelItem` | type | 85 | `type LabelItem = { id: string; x: number; y: number; lines: string[]; /** Placed first, and so kept nearest its...` |  |
| `LabelPlacement` | type | 96 | `type LabelPlacement = { dy: number; hidden: boolean }` |  |
| `placeLabels` | function | 115 | `function placeLabels(items: LabelItem[]): Map<string, LabelPlacement>` | A place for every name, so that no two names overlap and no name covers an element. |

Imports: none

Imported by: `features/network/Maps.tsx`

Tests that import it: `features/network/mapLabels.test.ts`
<!-- /gen -->

## `web/src/features/problems`

### `web/src/features/problems/AckDialog.tsx`

The acknowledge and close dialog: the portal's only write. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/problems/AckDialog.tsx -->
205 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 27 | `function AckDialog({ problem, onClose, onDone, }: { problem: Problem; onClose: () => void; /** Called once Zabbix...` |  |

Imports: `api/index.ts`, `shared/components/StatusBadge.tsx`, `shared/hooks/useDialogFocus.ts`, `shared/lib/freshness.ts`, `types/index.ts`

Packages: `react`

Imported by: `features/problems/Problems.tsx`

Tests that import it: `features/problems/AckDialog.test.tsx`
<!-- /gen -->

### `web/src/features/problems/AckPill.tsx`

Whether a problem has been acknowledged. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/problems/AckPill.tsx -->
4 lines, 1 export. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `AckPill` | component | 2 | `function AckPill({ acknowledged }: { acknowledged: string })` | Whether a problem has been acknowledged, from Zabbix's '0' or '1'. |

Imports: none

Imported by: `features/problems/Problems.tsx`, `features/problems/ProblemsTable.tsx`

Tests that import it: `__tests__/sharedPieces.test.tsx`
<!-- /gen -->

### `web/src/features/problems/Problems.tsx`

The Problems page: filters, the table, live updates and Explain. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/problems/Problems.tsx -->
412 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 59 | `function Problems()` |  |

Imports: `api/index.ts`, `features/assistant/ExplainPanel.tsx`, `features/assistant/useAi.ts`, `features/problems/AckDialog.tsx`, `features/problems/AckPill.tsx`, `features/problems/liveChange.ts`, `guards/index.ts`, `shared/components/CollectorNotice.tsx`, `shared/components/Field.tsx`, `shared/components/NoData.tsx`, `shared/components/StatusBadge.tsx`, `shared/components/TableWrap.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useAuth.ts`, `shared/hooks/useSSE.ts`, and 4 more

Packages: `react`, `react-router-dom`

Imported by: `App.tsx`

Tests that import it: `__tests__/guardedReads.test.tsx`, `features/problems/ProblemsPage.test.tsx`
<!-- /gen -->

### `web/src/features/problems/ProblemsTable.tsx`

The problem table, with rows marked when they appear or clear. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/problems/ProblemsTable.tsx -->
62 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 11 | `function ProblemsTable({ problems, marks, }: { problems: Problem[]; marks?: ReadonlyMap<string, ChangeMark>; })` | `marks` flags rows that just appeared or cleared (the wall screen's highlight, useChangeHighlight). |

Imports: `features/problems/AckPill.tsx`, `features/problems/useChangeHighlight.ts`, `shared/components/NoData.tsx`, `shared/components/StatusBadge.tsx`, `shared/components/TableWrap.tsx`, `shared/lib/severity.ts`, `types/index.ts`

Packages: `react-router-dom`

Imported by: `features/dashboard/Overview.tsx`

Tests that import it: `__tests__/sharedPages.test.tsx`, `features/problems/ProblemsPage.test.tsx`
<!-- /gen -->

### `web/src/features/problems/liveChange.ts`

What a live frame says about the list, as one comparable string. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/problems/liveChange.ts -->
13 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `changeKey` | function | 8 | `function changeKey(problems: readonly Problem[]): string` | What the live stream's frames say about a list, as one comparable string: which problems there are and how each stands (open or resolved... |

Imports: `types/index.ts`

Imported by: `features/problems/Problems.tsx`

Tests that import it: `features/problems/liveChange.test.ts`
<!-- /gen -->

### `web/src/features/problems/useChangeHighlight.ts`

How long a new problem stays marked and a cleared one stays on screen. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/problems/useChangeHighlight.ts -->
109 lines, 4 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ChangeMark` | type | 4 | `type ChangeMark = 'new' \| 'cleared'` |  |
| `HIGHLIGHT_MS` | constant | 7 | `const HIGHLIGHT_MS = 10_000` | How long a problem that appeared stays marked, and one that cleared stays on screen. |
| `useReducedMotion` | hook | 12 | `function useReducedMotion(): boolean` | Whether the user has asked the system for less motion, following changes to the setting. |
| `useChangeHighlight` | hook | 43 | `function useChangeHighlight(open: Problem[] \| null, held: ReadonlySet<string>, on: boolean, shownOf: (open:...` | Problems that appeared in or cleared from the open list, for the wall screen's short highlight (DESIGN.md section 9). |

Imports: `types/index.ts`

Packages: `react`

Imported by: `features/dashboard/Overview.tsx`, `features/problems/ProblemsTable.tsx`

Tests that import it: `features/problems/useChangeHighlight.test.ts`
<!-- /gen -->

## `web/src/features/reports`

### `web/src/features/reports/AlertNoise.tsx`

The alert-noise report page. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/reports/AlertNoise.tsx -->
276 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 64 | `function AlertNoise()` |  |

Imports: `api/index.ts`, `shared/components/Field.tsx`, `shared/components/KpiCard.tsx`, `shared/components/NoData.tsx`, `shared/components/StatusBadge.tsx`, `shared/components/TableWrap.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useUrlState.ts`, `shared/lib/csv.ts`, `shared/lib/plural.ts`, `shared/lib/time.ts`, `shared/lib/units.ts`, `theme.ts`, `types/index.ts`

Packages: `react`

Imported by: `App.tsx`

Tests that import it: `__tests__/urlFilters.test.tsx`, `features/reports/csvPages.test.tsx`
<!-- /gen -->

### `web/src/features/reports/Capacity.tsx`

The capacity trends page. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/reports/Capacity.tsx -->
190 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 126 | `function Capacity()` |  |

Imports: `api/index.ts`, `shared/components/Field.tsx`, `shared/components/NoData.tsx`, `shared/components/TableWrap.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useUrlState.ts`, `types/index.ts`

Packages: `react-router-dom`

Imported by: `App.tsx`

Tests that import it: `features/reports/Capacity.test.tsx`, `shared/lib/freshness.test.tsx`
<!-- /gen -->

### `web/src/features/reports/Inventory.tsx`

The inventory and ownership scorecard page, for admins. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/reports/Inventory.tsx -->
235 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 63 | `function Inventory()` |  |

Imports: `api/index.ts`, `shared/components/NoData.tsx`, `shared/components/TableWrap.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useUrlState.ts`, `shared/lib/csv.ts`, `shared/lib/plural.ts`, `shared/lib/time.ts`, `types/index.ts`

Packages: `react`

Imported by: `App.tsx`

Tests that import it: `__tests__/urlFilters.test.tsx`, `features/reports/csvPages.test.tsx`
<!-- /gen -->

### `web/src/features/reports/TopTriggers.tsx`

The top 100 triggers page. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/reports/TopTriggers.tsx -->
95 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 21 | `function TopTriggers()` | Reports → Top 100 triggers: which triggers fired most in the window. |

Imports: `api/index.ts`, `shared/components/Field.tsx`, `shared/components/NoData.tsx`, `shared/components/StatusBadge.tsx`, `shared/components/TableWrap.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useUrlState.ts`, `types/index.ts`

Packages: `react`

Imported by: `App.tsx`

Tests that import it: `__tests__/urlFilters.test.tsx`
<!-- /gen -->

## `web/src/features/shell`

### `web/src/features/shell/ErrorBoundary.tsx`

Catches a page that throws and reloads once when an old page asks for a chunk that is gone. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/features/shell/ErrorBoundary.tsx -->
75 lines, 2 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ErrorBoundary` | class | 8 | `class ErrorBoundary extends Component<` | Catches a page that throws while rendering, so one broken view shows an error card inside the layout instead of blanking the whole portal, sidebar... |
| `reloadOnStaleChunks` | function | 45 | `function reloadOnStaleChunks(): void` | After a deploy, a tab opened earlier asks for page chunks that no longer exist, and Vite reports `vite:preloadError`. |

Imports: none

Packages: `react`

Imported by: `features/shell/Layout.tsx`, `main.tsx`

Tests that import it: `__tests__/mainZone.test.tsx`, `features/shell/ErrorBoundary.test.tsx`
<!-- /gen -->

### `web/src/features/shell/Layout.tsx`

The shell around every page: sidebar, top bar, the page title and the Outlet. Walked through in [Web app: the pages](web-features.md), [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/features/shell/Layout.tsx -->
140 lines, 3 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `LayoutContext` | type | 16 | `type LayoutContext = { wall: boolean; exitWall: () => void }` | What a page learns from the shell, via useOutletContext. |
| `titleFor` | function | 19 | `function titleFor(pathname: string): string \| null` | A page's menu name, or null for an address that is not a page. |
| `default` | component | 24 | `function Layout()` |  |

Imports: `api/index.ts`, `features/shell/ErrorBoundary.tsx`, `features/shell/Sidebar.tsx`, `features/shell/TodayDate.tsx`, `features/shell/usePageTitle.ts`, `features/shell/useSessionRenewal.ts`, `features/shell/useUiPrefs.ts`, `features/shell/useWallMode.ts`, `shared/components/states.tsx`, `shared/hooks/useAuth.ts`, `shared/hooks/useDialogFocus.ts`

Packages: `react`, `react-router-dom`

Imported by: `App.tsx`, `features/dashboard/Overview.tsx`

Tests that import it: `__tests__/narrowScreen.test.tsx`, `__tests__/routes.test.tsx`, `features/shell/LayoutSignOut.test.tsx`
<!-- /gen -->

### `web/src/features/shell/NotFound.tsx`

The page for an address that is not a page. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/shell/NotFound.tsx -->
15 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 4 | `function NotFound()` | Any address that is not a page: said plainly, with a way back, rather than a silent jump to the Dashboard. |

Imports: none

Packages: `react-router-dom`

Imported by: `App.tsx`

Tests that import it: none
<!-- /gen -->

### `web/src/features/shell/Sidebar.tsx`

The grouped menu, filtered by the role, with the build in its footer. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/shell/Sidebar.tsx -->
197 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `PAGE_TITLES` | constant | 77 | `const PAGE_TITLES: Record<string, string>` | The top bar's page title for each route: the menu label that opens it. |
| `default` | component | 135 | `function Sidebar({ collapsed, locked = false, onToggle, }: { collapsed: boolean; /** The screen is too narrow to...` |  |

Imports: `features/assistant/useAi.ts`, `features/shell/build.ts`, `features/shell/useBuild.ts`, `shared/components/BrandMark.tsx`, `shared/components/icons.tsx`, `shared/hooks/useAuth.ts`, `types/index.ts`

Packages: `react`, `react-router-dom`

Imported by: `features/shell/Layout.tsx`

Tests that import it: `features/shell/Sidebar.test.tsx`
<!-- /gen -->

### `web/src/features/shell/TodayDate.tsx`

Today's date, re-read every minute. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/shell/TodayDate.tsx -->
10 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 6 | `function TodayDate()` | Today's date in the report zone, re-read every minute so an open tab turns over at midnight there; its own component, so only this span re-renders. |

Imports: `shared/hooks/useNow.ts`, `shared/hooks/useReportTimeZone.ts`, `shared/lib/time.ts`

Imported by: `features/shell/Layout.tsx`

Tests that import it: `__tests__/zoneClocks.test.tsx`, `features/shell/TodayDate.test.tsx`
<!-- /gen -->

### `web/src/features/shell/build.ts`

Turns the build the server reports into the footer label. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/shell/build.ts -->
24 lines, 2 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Build` | interface | 4 | `interface Build` | The build the BFF is running, from a signed-in /api/health. |
| `buildLabel` | function | 16 | `function buildLabel(build: Build \| null): string \| null` | The line the sidebar shows under its footer: `Build abc1234, 07/10/2026, 16.19.57 WIB`. |

Imports: `shared/lib/time.ts`

Imported by: `features/shell/Sidebar.tsx`, `features/shell/useBuild.ts`

Tests that import it: `features/shell/buildLabel.test.ts`
<!-- /gen -->

### `web/src/features/shell/useBuild.ts`

Asks the server which build it runs. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/shell/useBuild.ts -->
28 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `useBuild` | hook | 11 | `function useBuild(signedIn: boolean): Build \| null` | Which build the BFF is running, for the sidebar footer. |

Imports: `api/index.ts`, `features/shell/build.ts`

Packages: `react`

Imported by: `features/shell/Sidebar.tsx`

Tests that import it: none
<!-- /gen -->

### `web/src/features/shell/usePageTitle.ts`

Names the browser tab after the page. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/shell/usePageTitle.ts -->
18 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `APP_TITLE` | constant | 3 | `const APP_TITLE` |  |
| `usePageTitle` | hook | 6 | `function usePageTitle(page: string): void` | Names the browser tab and its history entry after the page, with the portal's name after it. |

Imports: none

Packages: `react`

Imported by: `features/shell/Layout.tsx`

Tests that import it: `__tests__/routes.test.tsx`
<!-- /gen -->

### `web/src/features/shell/useSessionRenewal.ts`

Keeps an open page signed in for as long as it stays open. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/features/shell/useSessionRenewal.ts -->
95 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `useSessionRenewal` | hook | 30 | `function useSessionRenewal(enabled: boolean): void` | Keeps an open portal signed in, for every user, for as long as the page stays open (DESIGN.md section 9, "Wall sign-in"). |

Imports: `api/index.ts`

Packages: `react`

Imported by: `features/shell/Layout.tsx`

Tests that import it: none
<!-- /gen -->

### `web/src/features/shell/useUiPrefs.ts`

The theme, the narrow-screen rule and the collapsed sidebar, kept in the browser. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/features/shell/useUiPrefs.ts -->
116 lines, 6 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Theme` | type | 32 | `type Theme = 'system' \| 'light' \| 'dark'` |  |
| `THEME_KEY` | constant | 35 | `const THEME_KEY` | public/theme.js reads the same key before the first paint; a test holds the two together. |
| `useTheme` | hook | 42 | `function useTheme(): [Theme, (next: Theme) => void]` | `system` leaves the attribute off, so the stylesheet's `prefers-color-scheme` block decides. |
| `NARROW_QUERY` | constant | 66 | `const NARROW_QUERY` | Below --bp-md (720px) the page is too narrow for the full sidebar; the .98 leaves no gap at a fractional width under zoom. |
| `useNarrowScreen` | hook | 76 | `function useNarrowScreen(): boolean` | Whether the window is narrow, following a resize or a change of zoom. |
| `useSidebarRail` | hook | 97 | `function useSidebarRail(landingPath: string): [boolean, () => void, boolean]` | Whether the sidebar is a rail, the toggle for it, and whether the screen is forcing it. |

Imports: none

Packages: `react`

Imported by: `features/shell/Layout.tsx`

Tests that import it: `__tests__/narrowScreen.test.tsx`, `__tests__/themeBeforePaint.test.ts`
<!-- /gen -->

### `web/src/features/shell/useWallMode.ts`

The wall mode: no sidebar, larger type, a clock and the age of the data. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/features/shell/useWallMode.ts -->
54 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `useWallMode` | hook | 12 | `function useWallMode(): { wall: boolean; enter: () => void; exit: () => void }` | The Dashboard's wall mode (DESIGN.md section 9): no sidebar or top bar, larger type, a clock and a "data as of" stamp. |

Imports: `shared/hooks/useUrlState.ts`

Packages: `react`, `react-router-dom`

Imported by: `features/shell/Layout.tsx`

Tests that import it: none
<!-- /gen -->

## `web/src/features/sla`

### `web/src/features/sla/Availability.tsx`

The availability and response report page. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/sla/Availability.tsx -->
432 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 148 | `function Availability()` |  |

Imports: `api/index.ts`, `features/assistant/useAi.ts`, `features/sla/EmailReport.tsx`, `features/sla/ReportDownload.tsx`, `features/sla/Sli.tsx`, `shared/components/Field.tsx`, `shared/components/KpiCard.tsx`, `shared/components/NoData.tsx`, `shared/components/StatusBadge.tsx`, `shared/components/TableWrap.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useReportTimeZone.ts`, `shared/hooks/useUrlState.ts`, `shared/lib/plural.ts`, `shared/lib/time.ts`, and 3 more

Packages: `react`, `react-router-dom`

Imported by: `App.tsx`

Tests that import it: `__tests__/reportZoneUi.test.tsx`, `features/sla/ReportDownload.test.tsx`, `features/sla/slaKpiCards.test.tsx`, `shared/lib/freshness.test.tsx`
<!-- /gen -->

### `web/src/features/sla/EmailReport.tsx`

The Email report and Schedule buttons and the dialog for emailing a month's report by hand. It asks the server whether email is on and shows itself only to administrators. In the dialog the person ticks the files (PDF, Excel, a zip of CSV files), types the addresses and may keep the list for next time, and afterwards it says in words which files went to how many people, or why they did not. When a send or a schedule has kept a list it asks the server again, so the next dialog starts from that list.

<!-- gen:card web/src/features/sla/EmailReport.tsx -->
294 lines, 2 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `LEAVE_AFTER_MS` | constant | 35 | `const LEAVE_AFTER_MS = 30_000` | A send that takes longer than this can be left: the page goes on waiting, and says where the result will be. |
| `default` | component | 223 | `function EmailReport({ month, disabled = false }: { month: string; disabled?: boolean })` |  |

Imports: `api/index.ts`, `features/sla/FileChoices.tsx`, `features/sla/ReportDialog.tsx`, `features/sla/ReportDownload.tsx`, `features/sla/ReportSchedule.tsx`, `features/sla/SavedList.tsx`, `features/sla/addresses.ts`, `features/sla/reportStyle.ts`, `guards/index.ts`, `shared/hooks/useAuth.ts`, `types/index.ts`

Packages: `react`

Imported by: `features/sla/Availability.tsx`, `features/sla/Sla.tsx`

Tests that import it: `features/sla/EmailReport.test.tsx`
<!-- /gen -->

### `web/src/features/sla/FileChoices.tsx`

The tick boxes for the kinds of file a report comes in: PDF, Excel and the CSV zip. What it hands on is always in the same order, whatever order they were ticked in.

<!-- gen:card web/src/features/sla/FileChoices.tsx -->
41 lines, 3 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `FILE_CHOICES` | constant | 4 | `const FILE_CHOICES: { format: ReportFileFormat; label: string; noun: string }[]` | The kinds of file the report comes in, in the order they are listed and attached. |
| `nounOf` | function | 10 | `const nounOf = (format: ReportFileFormat): string =>` |  |
| `default` | component | 13 | `function FileChoices({ chosen, onChange, disabled = false, }: { chosen: readonly ReportFileFormat[]; onChange:...` | Which files to send: one checkbox each, and at least one is the person's to keep. |

Imports: `types/index.ts`

Imported by: `features/sla/EmailReport.tsx`, `features/sla/ReportSchedule.tsx`

Tests that import it: `features/sla/FileChoices.test.tsx`
<!-- /gen -->

### `web/src/features/sla/ReportDialog.tsx`

The frame the report dialogs share, in the shape of the Acknowledge dialog: a backdrop, a head, a body and a foot. Escape, the cross and the backdrop close it, unless work is under way; a press that begins inside and ends on the backdrop does not. It also holds `useReveal`, which brings a result into view when the foot stays put while the body scrolls.

<!-- gen:card web/src/features/sla/ReportDialog.tsx -->
90 lines, 3 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `useReveal` | hook | 11 | `function useReveal(ref: RefObject<HTMLElement>, when: unknown): void` | Brings the element into view when `when` turns on: the foot stays in view while the body scrolls, so a result at the other end would go unseen. |
| `ReportDialogProps` | interface | 17 | `interface ReportDialogProps` |  |
| `default` | component | 32 | `function ReportDialog({ title, sub, busy = false, onClose, onSubmit, initialFocus, note, actions, children }:...` |  |

Imports: `shared/hooks/useDialogFocus.ts`

Packages: `react`, `react-dom`

Imported by: `features/sla/EmailReport.tsx`, `features/sla/ReportSchedule.tsx`, `features/sla/ReportStyleButton.tsx`

Tests that import it: `features/sla/ReportDialog.test.tsx`
<!-- /gen -->

### `web/src/features/sla/ReportDownload.tsx`

The buttons that download a month's SLA report as a PDF, an Excel file or a zip of CSV files. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/sla/ReportDownload.tsx -->
162 lines, 4 exports, 1 re-export. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `REVOKE_AFTER_MS` | re-export | 22 |  |  |
| `GIVE_UP_AFTER_MS` | constant | 24 | `const GIVE_UP_AFTER_MS = 440_000` | A request that has not answered by now is given up on, so the buttons never stay shut for good. |
| `READY_FOR_MS` | constant | 26 | `const READY_FOR_MS = 6_000` | Long enough for "ready" to be heard, short enough that nobody meets it later as stale news. |
| `monthInWords` | function | 29 | `function monthInWords(month: string): string` | "August 2026". |
| `default` | component | 52 | `function ReportDownload({ month, disabled = false }: { month: string; disabled?: boolean })` |  |

Imports: `api/index.ts`, `features/sla/ReportStyleButton.tsx`, `features/sla/reportStyle.ts`, `shared/lib/saveFile.ts`

Packages: `react`

Imported by: `features/sla/Availability.tsx`, `features/sla/EmailReport.tsx`, `features/sla/ReportSchedule.tsx`, `features/sla/Sla.tsx`

Tests that import it: `features/sla/ReportDownload.test.tsx`
<!-- /gen -->

### `web/src/features/sla/ReportSchedule.tsx`

The Schedule button and its dialog, for administrators. One dialog from the press to the close: it reads the schedule, then is the form for the day, the time, the files, the people, who to tell and the style, with the next send and the last twelve under it. Saving sends everything in one request.

<!-- gen:card web/src/features/sla/ReportSchedule.tsx -->
324 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `sendLine` | function | 58 | `function sendLine(r: SendRecord, tz: string): string` |  |
| `default` | component | 314 | `function ReportSchedule({ info, onSaved }: { info: EmailInfo; onSaved?: () => void })` |  |

Imports: `api/index.ts`, `features/sla/FileChoices.tsx`, `features/sla/ReportDialog.tsx`, `features/sla/ReportDownload.tsx`, `features/sla/SavedList.tsx`, `features/sla/StyleFields.tsx`, `features/sla/addresses.ts`, `features/sla/reportStyle.ts`, `guards/index.ts`, `shared/lib/time.ts`, `types/index.ts`

Packages: `react`

Imported by: `features/sla/EmailReport.tsx`

Tests that import it: `features/sla/ReportSchedule.test.tsx`
<!-- /gen -->

### `web/src/features/sla/ReportStyleButton.tsx`

The Number and date style button and its dialog. A choice is kept in this browser the moment it is made and used by the next download or email.

<!-- gen:card web/src/features/sla/ReportStyleButton.tsx -->
51 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 39 | `function ReportStyleButton()` |  |

Imports: `features/sla/ReportDialog.tsx`, `features/sla/StyleFields.tsx`, `features/sla/reportStyle.ts`, `types/index.ts`

Packages: `react`

Imported by: `features/sla/ReportDownload.tsx`

Tests that import it: `features/sla/ReportStyleButton.test.tsx`
<!-- /gen -->

### `web/src/features/sla/SavedList.tsx`

The view of the saved list of people a report goes to, shown inside the Email and Schedule dialogs for administrators. It lists each address with a button to remove it, has a box to add one and a button to delete the whole list, and saves each change at once through `api.sliRecipientsSave` and `api.sliRecipientsDelete`. It says what applies afterwards, either the list the portal started with (`MAIL_TO`) or nobody, and it gives a failure in the portal's own words, or says that the list may or may not have changed when the answer never came (FR-31). One change goes at a time, and a late answer after the dialog has gone changes nothing on the page.

<!-- gen:card web/src/features/sla/SavedList.tsx -->
221 lines, 1 export. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 26 | `function SavedList({ saved, max, allowedDomains, disabled = false, onChanged, }: { saved: string[]; max: number...` |  |

Imports: `api/index.ts`, `features/sla/addresses.ts`, `guards/index.ts`

Packages: `react`

Imported by: `features/sla/EmailReport.tsx`, `features/sla/ReportSchedule.tsx`

Tests that import it: `features/sla/SavedList.test.tsx`
<!-- /gen -->

### `web/src/features/sla/Services.tsx`

The service tree page. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/sla/Services.tsx -->
449 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 402 | `function Services()` |  |

Imports: `api/index.ts`, `features/assistant/ExplainPanel.tsx`, `features/assistant/useAi.ts`, `features/sla/Sli.tsx`, `features/sla/percent.ts`, `shared/components/Field.tsx`, `shared/components/StatusBadge.tsx`, `shared/components/icons.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useReportTimeZone.ts`, `shared/hooks/useUrlState.ts`, `shared/lib/plural.ts`, `shared/lib/time.ts`, `theme.ts`, `types/index.ts`

Packages: `react`

Imported by: `App.tsx`

Tests that import it: `__tests__/urlFilters.test.tsx`, `features/sla/Services.test.tsx`
<!-- /gen -->

### `web/src/features/sla/Sla.tsx`

The SLA page: Zabbix's SLA objects and the derived monthly figure, in tabs. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/sla/Sla.tsx -->
846 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 770 | `function SlaPage()` |  |

Imports: `api/index.ts`, `features/assistant/ExplainPanel.tsx`, `features/assistant/useAi.ts`, `features/sla/EmailReport.tsx`, `features/sla/ReportDownload.tsx`, `features/sla/Sli.tsx`, `shared/components/Field.tsx`, `shared/components/KpiCard.tsx`, `shared/components/NoData.tsx`, `shared/components/TableWrap.tsx`, `shared/components/states.tsx`, `shared/hooks/useAsync.ts`, `shared/hooks/useReportTimeZone.ts`, `shared/hooks/useUrlState.ts`, `shared/lib/freshness.ts`, `shared/lib/plural.ts`, and 4 more

Packages: `react`, `react-router-dom`

Imported by: `App.tsx`

Tests that import it: `__tests__/reportZoneUi.test.tsx`, `features/sla/ReportDownload.test.tsx`, `features/sla/SlaTabs.test.tsx`, `features/sla/slaKpiCards.test.tsx`, `shared/lib/freshness.test.tsx`
<!-- /gen -->

### `web/src/features/sla/Sli.tsx`

Small shared pieces of the derived SLA views: the month picker, pills and notes. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/sla/Sli.tsx -->
203 lines, 14 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `DERIVED_BANNER` | constant | 16 | `const DERIVED_BANNER` |  |
| `METHOD_LABEL` | constant | 19 | `const METHOD_LABEL: Record<SliProfile, string>` |  |
| `METHOD_NOTE` | constant | 25 | `const METHOD_NOTE` | One short sentence on why the two figures differ. |
| `fmtPct` | function | 30 | `const fmtPct = (v: number \| null \| undefined, digits: number = PERCENT_DP.availability, target?: number) =>` | Pass `target` whenever the figure is shown beside Met or Missed, so rounding cannot print it as the target. |
| `fmtDur` | function | 35 | `const fmtDur = (seconds: number \| null \| undefined) =>` |  |
| `NoDataPill` | component | 38 | `function NoDataPill({ title }: { title?: string })` |  |
| `SliPill` | component | 47 | `function SliPill({ sli, target, dataStatus, digits = PERCENT_DP.availability, }: { sli: number \| null; target:...` | A percentage against the target: green met, red missed, grey "No data", never 0%. |
| `CoverageText` | component | 78 | `function CoverageText({ coverage }: { coverage: number \| null \| undefined })` |  |
| `MonthSelect` | component | 85 | `function MonthSelect({ value, onChange, label = 'Month', }: { value: string; onChange: (m: string) => void; label?:...` | The current month (marked "so far") and the 11 before it, in the report zone. |
| `lastClosedMonth` | function | 112 | `const lastClosedMonth = () =>` | The last closed month: a full month is the natural default for an SLA. |
| `MethodToggle` | component | 114 | `function MethodToggle({ value, onChange, label = 'Method', }: { value: SliProfile; onChange: (p: SliProfile) =>...` |  |
| `gapsSummary` | function | 179 | `const gapsSummary = (gaps: SliGap[]) =>` | "Excluded 6.9 days with no collected data: 1 - 2 Aug, 8 - 11 Aug …" |
| `declaredSummary` | function | 182 | `const declaredSummary = (windows: SliGap[]) =>` | The spans the setting SLA_NO_DATA_WINDOWS declares not measured, such as a collector that ran off HCML's network. |
| `GapsNote` | component | 190 | `function GapsNote({ gaps, windows, profile, }: { gaps: SliGap[] \| undefined; windows: SliGap[] \| undefined; /**...` |  |

Imports: `features/sla/percent.ts`, `shared/components/Field.tsx`, `shared/components/NoData.tsx`, `shared/hooks/useReportTimeZone.ts`, `shared/lib/time.ts`, `shared/lib/units.ts`, `types/index.ts`

Packages: `react`

Imported by: `features/sla/Availability.tsx`, `features/sla/Services.tsx`, `features/sla/Sla.tsx`

Tests that import it: `__tests__/markup.test.tsx`, `__tests__/reportZoneUi.test.tsx`, `__tests__/tooltipFacts.test.tsx`, `__tests__/urlFilters.test.tsx`, `features/sla/SliPill.test.tsx`, `features/sla/percent.test.ts`
<!-- /gen -->

### `web/src/features/sla/StyleFields.tsx`

The three choices of a report's style as selects with an example of each, shared by the style dialog and the schedule dialog.

<!-- gen:card web/src/features/sla/StyleFields.tsx -->
56 lines, 1 export. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 6 | `function StyleFields({ style, onChange, first, disabled = false, }: { style: ReportStyle; onChange: (next:...` | The three choices of a report's style, as selects with an example of each, and the one hint that saves a person a search. |

Imports: `features/sla/reportStyle.ts`, `types/index.ts`

Packages: `react`

Imported by: `features/sla/ReportSchedule.tsx`, `features/sla/ReportStyleButton.tsx`

Tests that import it: none
<!-- /gen -->

### `web/src/features/sla/addresses.ts`

Small text helpers the email and schedule dialogs share: split a box of addresses into a list, put a list back as lines, and write a list of words as a sentence.

<!-- gen:card web/src/features/sla/addresses.ts -->
17 lines, 4 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `splitAddresses` | function | 2 | `const splitAddresses = (text: string): string[] =>` | Text typed in a box, as a list of addresses: commas, semicolons, spaces and line breaks all separate them. |
| `joinAddresses` | function | 5 | `const joinAddresses = (list: readonly string[]): string =>` | A list of addresses as the box shows it: one on each line. |
| `wordsList` | function | 8 | `function wordsList(items: readonly string[]): string` | "a", "a and b", "a, b and c". |
| `domainsList` | function | 14 | `function domainsList(domains: readonly string[]): string` | The domains an address may be in, as a sentence part: "example.org", "example.org or hcml.co.id". |

Imports: none

Imported by: `features/sla/EmailReport.tsx`, `features/sla/ReportSchedule.tsx`, `features/sla/SavedList.tsx`

Tests that import it: `features/sla/addresses.test.ts`
<!-- /gen -->

### `web/src/features/sla/percent.ts`

Prints a percentage without rounding a miss up to the target. Walked through in [Web app: the pages](web-features.md).

<!-- gen:card web/src/features/sla/percent.ts -->
16 lines, 1 export. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `percentText` | function | 7 | `function percentText(value: number, target: number, digits = 2): string` | 98.996 against 99 must not print as "99.00%": digits are added from `digits` until the text is on the real side. |

Imports: `shared/lib/units.ts`

Imported by: `features/sla/Services.tsx`, `features/sla/Sli.tsx`

Tests that import it: `features/sla/percent.test.ts`
<!-- /gen -->

## `web/src/generated`

### `web/src/features/sla/reportStyle.ts`

The choices of a report's style with their examples, and the person's own choice kept in this browser: read back with every value checked, and never a reason for the page to fail when the browser will not keep it.

<!-- gen:card web/src/features/sla/reportStyle.ts -->
62 lines, 8 exports. Imported by 5 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `DEFAULT_REPORT_STYLE` | constant | 9 | `const DEFAULT_REPORT_STYLE: ReportStyle` |  |
| `REPORT_STYLE_KEY` | constant | 11 | `const REPORT_STYLE_KEY` |  |
| `DECIMAL_CHOICES` | constant | 13 | `const DECIMAL_CHOICES: { value: ReportStyle['decimal']; label: string }[]` |  |
| `DATE_CHOICES` | constant | 18 | `const DATE_CHOICES: { value: ReportStyle['date']; label: string }[]` |  |
| `SEPARATOR_CHOICES` | constant | 24 | `const SEPARATOR_CHOICES: { value: ReportStyle['separator']; label: string }[]` |  |
| `readReportStyle` | function | 33 | `function readReportStyle(): ReportStyle` |  |
| `writeReportStyle` | function | 49 | `function writeReportStyle(style: ReportStyle): void` |  |
| `styleSentence` | function | 58 | `function styleSentence(style: ReportStyle, withCsv: boolean): string` | One line for a dialog that writes in the person's style: "Style: decimal dot, dates like 4 Nov 2026, CSV separated by commas." |

Imports: `types/index.ts`

Imported by: `features/sla/EmailReport.tsx`, `features/sla/ReportDownload.tsx`, `features/sla/ReportSchedule.tsx`, `features/sla/ReportStyleButton.tsx`, `features/sla/StyleFields.tsx`

Tests that import it: `features/sla/EmailReport.test.tsx`, `features/sla/ReportDownload.test.tsx`, `features/sla/ReportSchedule.test.tsx`, `features/sla/ReportStyleButton.test.tsx`, `features/sla/reportStyle.test.ts`
<!-- /gen -->

### `web/src/generated/openapi.ts`

Types made from the API description by a tool; never edited by hand. Walked through in [Web app: the API client, the types and the guards](web-api-types-guards.md).

<!-- gen:card web/src/generated/openapi.ts -->
4563 lines, generated, never edited by hand. Imported by 0 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `paths` | interface | 6 | `interface paths` |  |
| `webhooks` | type | 1389 | `type webhooks = Record<string, never>` |  |
| `components` | interface | 1390 | `interface components` |  |
| `$defs` | type | 2578 | `type $defs = Record<string, never>` |  |
| `operations` | interface | 2579 | `interface operations` |  |

Imports: none

Imported by: none

Tests that import it: `__tests__/openapiTypes.test.ts`
<!-- /gen -->

## `web/src/guards`

### `web/src/guards/assistant.ts`

The checks for the Explain answers. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/guards/assistant.ts -->
19 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `problemExplanationGuard` | constant | 16 | `const problemExplanationGuard = guard<ProblemExplanation>('the explanation', problemExplanation)` | GET /api/explain/problem. |
| `slaExplanationGuard` | constant | 19 | `const slaExplanationGuard = guard<SlaExplanation>('the explanation', slaExplanation)` | GET /api/explain/sla, and the neutral answer the BFF gives without a model when nothing was measured (`noData`). |

Imports: `guards/shape.ts`, `types/index.ts`

Imported by: `guards/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/guards/auth.ts`

The check for who is signed in. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/guards/auth.ts -->
14 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `meGuard` | constant | 14 | `const meGuard = guard<Me>('your sign-in details', me)` | GET /api/auth/me. |

Imports: `guards/shape.ts`, `types/index.ts`

Imported by: `guards/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/guards/dashboard.ts`

The checks for what the Dashboard shows besides the problem list. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/guards/dashboard.ts -->
59 lines, 5 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `statsGuard` | constant | 47 | `const statsGuard = guard<Stats>('the dashboard counts', stats)` | GET /api/stats. |
| `groupProblemsGuard` | constant | 50 | `const groupProblemsGuard = guard<GroupProblems[]>('the problems by host group', listOf(groupProblems))` | GET /api/reports/problems-by-group. |
| `freshnessGuard` | constant | 53 | `const freshnessGuard = guard<Freshness>('the data freshness', freshness)` | GET /api/freshness. |
| `topHostsGuard` | constant | 56 | `const topHostsGuard = guard<TopHostsResponse>('the busiest hosts', topHosts)` | GET /api/reports/top-hosts. |
| `webMonitoringGuard` | constant | 59 | `const webMonitoringGuard = guard<WebMonitoringResponse>('web monitoring', webMonitoring)` | GET /api/reports/web-monitoring. |

Imports: `guards/shape.ts`, `types/index.ts`

Imported by: `guards/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/guards/graphs.ts`

The check for a graph. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/guards/graphs.ts -->
42 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `graphGuard` | constant | 42 | `const graphGuard = guard<GraphResponse>('the graph', graph)` | GET /api/graph. |

Imports: `guards/shape.ts`, `types/index.ts`

Imported by: `guards/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/guards/hosts.ts`

The checks for hosts, devices and items. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/guards/hosts.ts -->
88 lines, 9 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `hostInterface` | constant | 6 | `const hostInterface = shape<HostInterface>({ ip: text, type: opt(text), available: opt(text) })` |  |
| `siteRef` | constant | 8 | `const siteRef = shape<SiteRef>({ code: num, name: text })` |  |
| `hostFields` | constant | 11 | `const hostFields: Shape<Host>` | The fields of `Host`, which HostOverview and NetDevice extend. |
| `hostOverviewGuard` | constant | 73 | `const hostOverviewGuard = guard<HostOverview[]>('the host list', listOf(hostOverview))` | GET /api/hosts/overview. |
| `devicesGuard` | constant | 76 | `const devicesGuard = guard<DevicesResponse>('the device list', devices)` | GET /api/devices. |
| `hostListGuard` | constant | 79 | `const hostListGuard = guard<Host[]>('the host list', listOf(host))` | GET /api/hosts. |
| `hostGroupListGuard` | constant | 82 | `const hostGroupListGuard = guard<HostGroup[]>('the host groups', listOf(hostGroup))` | GET /api/hostgroups. |
| `itemListGuard` | constant | 85 | `const itemListGuard = guard<Item[]>('the item list', listOf(item))` | GET /api/items, by host or by id. |
| `latestGuard` | constant | 88 | `const latestGuard = guard<LatestResponse>('the latest data', latest)` | GET /api/latest. |

Imports: `guards/shape.ts`, `types/index.ts`

Imported by: `guards/index.ts`, `guards/network.ts`, `guards/sla.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/guards/index.ts`

Joins the per-feature checks behind one import. Walked through in [Web app: the API client, the types and the guards](web-api-types-guards.md).

<!-- gen:card web/src/guards/index.ts -->
41 lines, 0 exports, 45 re-exports. Imported by 17 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Guard` | re-export | 6 | `from './shape'` |  |
| `assertFits` | re-export | 8 | `from './misfit'` |  |
| `noteMisfit` | re-export | 8 | `from './misfit'` |  |
| `UnreadableAnswer` | re-export | 8 | `from './misfit'` |  |
| `unreadableMessage` | re-export | 8 | `from './misfit'` |  |
| `devicesGuard` | re-export | 10 | `from './hosts'` |  |
| `hostGroupListGuard` | re-export | 10 | `from './hosts'` |  |
| `hostListGuard` | re-export | 10 | `from './hosts'` |  |
| `hostOverviewGuard` | re-export | 10 | `from './hosts'` |  |
| `itemListGuard` | re-export | 10 | `from './hosts'` |  |
| `latestGuard` | re-export | 10 | `from './hosts'` |  |
| `problemListGuard` | re-export | 12 | `from './problems'` |  |
| `graphGuard` | re-export | 14 | `from './graphs'` |  |
| `linksGuard` | re-export | 16 | `from './network'` |  |
| `mapDetailGuard` | re-export | 16 | `from './network'` |  |
| `mapListGuard` | re-export | 16 | `from './network'` |  |
| `netDevicesGuard` | re-export | 16 | `from './network'` |  |
| `netInterfacesGuard` | re-export | 16 | `from './network'` |  |
| `sitesGuard` | re-export | 16 | `from './network'` |  |
| `metersGuard` | re-export | 18 | `from './meters'` |  |
| `freshnessGuard` | re-export | 20 | `from './dashboard'` |  |
| `groupProblemsGuard` | re-export | 20 | `from './dashboard'` |  |
| `statsGuard` | re-export | 20 | `from './dashboard'` |  |
| `topHostsGuard` | re-export | 20 | `from './dashboard'` |  |
| `webMonitoringGuard` | re-export | 20 | `from './dashboard'` |  |
| `agingGuard` | re-export | 22 | `from './reports'` |  |
| `capacityGuard` | re-export | 22 | `from './reports'` |  |
| `noiseGuard` | re-export | 22 | `from './reports'` |  |
| `scorecardGuard` | re-export | 22 | `from './reports'` |  |
| `topTriggersGuard` | re-export | 22 | `from './reports'` |  |
| `availabilityGuard` | re-export | 25 | `from './sla'` |  |
| `derivedServicesGuard` | re-export | 26 | `from './sla'` |  |
| `deletedRecipientsGuard` | re-export | 27 | `from './sla'` |  |
| `emailInfoGuard` | re-export | 28 | `from './sla'` |  |
| `emailSentGuard` | re-export | 29 | `from './sla'` |  |
| `savedRecipientsGuard` | re-export | 30 | `from './sla'` |  |
| `scheduleInfoGuard` | re-export | 31 | `from './sla'` |  |
| `servicesGuard` | re-export | 32 | `from './sla'` |  |
| `slaListGuard` | re-export | 33 | `from './sla'` |  |
| `slaSliGuard` | re-export | 34 | `from './sla'` |  |
| `slaSourceGuard` | re-export | 35 | `from './sla'` |  |
| `sliGuard` | re-export | 36 | `from './sla'` |  |
| `problemExplanationGuard` | re-export | 39 | `from './assistant'` |  |
| `slaExplanationGuard` | re-export | 39 | `from './assistant'` |  |
| `meGuard` | re-export | 41 | `from './auth'` |  |

Imports: `guards/assistant.ts`, `guards/auth.ts`, `guards/dashboard.ts`, `guards/graphs.ts`, `guards/hosts.ts`, `guards/meters.ts`, `guards/misfit.ts`, `guards/network.ts`, `guards/problems.ts`, `guards/reports.ts`, `guards/shape.ts`, `guards/sla.ts`

Imported by: `api/assistant.ts`, `api/client.ts`, `api/dashboard.ts`, `api/graphs.ts`, `api/hosts.ts`, `api/meters.ts`, `api/network.ts`, `api/problems.ts`, `api/reports.ts`, `api/shell.ts`, `api/sla.ts`, `features/dashboard/Overview.tsx`, `features/problems/Problems.tsx`, `features/sla/EmailReport.tsx`, and 3 more

Tests that import it: `__tests__/guardedReads.test.tsx`, `__tests__/guardsData.test.ts`, `features/sla/EmailReport.test.tsx`, `features/sla/ReportSchedule.test.tsx`, `guards.test.ts`, `shared/hooks/useSSE.test.ts`
<!-- /gen -->

### `web/src/guards/meters.ts`

The check for the internet traffic meters. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/guards/meters.ts -->
57 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `metersGuard` | constant | 57 | `const metersGuard = guard<MetersResponse>('the internet traffic meters', meters)` | GET /api/net/meters. |

Imports: `guards/shape.ts`, `types/index.ts`

Imported by: `guards/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/guards/misfit.ts`

What happens when an answer fails its check: the message a page shows and the console line. Walked through in [Web app: the API client, the types and the guards](web-api-types-guards.md).

<!-- gen:card web/src/guards/misfit.ts -->
41 lines, 4 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `unreadableMessage` | function | 9 | `const unreadableMessage = (what: string) =>` | What a person reads when an answer fails its check. |
| `UnreadableAnswer` | class | 13 | `class UnreadableAnswer extends Error` | The error for an answer that failed its check; `detail` is the first thing wrong, for a log. |
| `noteMisfit` | function | 27 | `function noteMisfit(source: string, detail: string): void` | A bad answer repeats on every poll: say what was wrong once, in the console, for whoever opens it. |
| `assertFits` | function | 36 | `function assertFits<T>(guard: Guard<T>, body: unknown, path: string): T` | `body` itself when it fits `guard`; otherwise an UnreadableAnswer, which the page shows as its ordinary error. |

Imports: `guards/shape.ts`

Imported by: `guards/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/guards/network.ts`

The checks for the network pages. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/guards/network.ts -->
134 lines, 6 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `netDevicesGuard` | constant | 119 | `const netDevicesGuard = guard<NetDevice[]>('the network devices', listOf(netDevice))` | GET /api/net/devices. |
| `netInterfacesGuard` | constant | 122 | `const netInterfacesGuard = guard<NetInterfacesResponse>('the interface list', netInterfaces)` | GET /api/net/interfaces. |
| `mapListGuard` | constant | 125 | `const mapListGuard = guard<ZMap[]>('the map list', listOf(zmap))` | GET /api/maps. |
| `mapDetailGuard` | constant | 128 | `const mapDetailGuard = guard<MapDetail[]>('the map', listOf(mapDetail))` | GET /api/maps/detail. |
| `sitesGuard` | constant | 131 | `const sitesGuard = guard<SitesResponse>('the site list', sites)` | GET /api/sites. |
| `linksGuard` | constant | 134 | `const linksGuard = guard<LinksResponse>('the link health', links)` | GET /api/links. |

Imports: `guards/hosts.ts`, `guards/shape.ts`, `types/index.ts`

Imported by: `guards/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/guards/problems.ts`

The check for the problem list, which the live frames pass through too. Walked through in [Web app: the API client, the types and the guards](web-api-types-guards.md).

<!-- gen:card web/src/guards/problems.ts -->
25 lines, 1 export. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `problemListGuard` | constant | 25 | `const problemListGuard = guard<Problem[]>('the problem list', listOf(problem))` | GET /api/problems, and each `problems` frame of the live stream. |

Imports: `guards/shape.ts`, `types/index.ts`

Imported by: `guards/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/guards/reports.ts`

The checks for the reports. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/guards/reports.ts -->
90 lines, 5 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `topTriggersGuard` | constant | 78 | `const topTriggersGuard = guard<TopTriggersReport>('the top triggers', topTriggers)` | GET /api/reports/top-triggers. |
| `scorecardGuard` | constant | 81 | `const scorecardGuard = guard<ScorecardResponse>('the inventory scorecard', scorecard)` | GET /api/reports/inventory. |
| `agingGuard` | constant | 84 | `const agingGuard = guard<AgingReport>('the problem ageing', aging)` | GET /api/reports/aging. |
| `capacityGuard` | constant | 87 | `const capacityGuard = guard<CapacityReport>('the capacity report', capacity)` | GET /api/reports/capacity. |
| `noiseGuard` | constant | 90 | `const noiseGuard = guard<NoiseReport>('the alert noise report', noise)` | GET /api/reports/noise. |

Imports: `guards/shape.ts`, `types/index.ts`

Imported by: `guards/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/guards/shape.ts`

The building blocks of a check: text, number, flag, list and object shapes. Walked through in [Web app: the API client, the types and the guards](web-api-types-guards.md).

<!-- gen:card web/src/guards/shape.ts -->
109 lines, 17 exports. Imported by 12 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Check` | type | 19 | `type Check = (value: unknown) => Misfit \| null` |  |
| `Shape` | type | 21 | `type Shape<T> = { [K in keyof T]-?: Check }` |  |
| `bad` | function | 23 | `const bad = (value: unknown, kind: string): Misfit =>` |  |
| `under` | function | 27 | `const under = (head: string, m: Misfit): Misfit =>` |  |
| `text` | function | 31 | `const text: Check = (v) =>` |  |
| `num` | function | 33 | `const num: Check = (v) =>` |  |
| `flag` | function | 35 | `const flag: Check = (v) =>` |  |
| `opt` | function | 38 | `const opt = (check: Check): Check =>` | A key that may be left out (JSON has no undefined, so left out is all it can be). |
| `orNull` | function | 43 | `const orNull = (check: Check): Check =>` |  |
| `listOf` | function | 48 | `const listOf = (item: Check): Check =>` |  |
| `recordOf` | function | 60 | `const recordOf = (value: Check): Check =>` | An object whose every value passes `value`, under keys of any name ("severity" -> count). |
| `shape` | function | 71 | `const shape = <T>(fields: Shape<T>): Check =>` |  |
| `Guard` | interface | 83 | `interface Guard<T>` | A checked kind of answer: what it is called to a person, and how to tell whether a value is one. |
| `guard` | function | 91 | `function guard<T>(what: string, check: Check): Guard<T>` |  |
| `tag` | constant | 101 | `const tag = shape<{ tag: string; value: string }>({ tag: text, value: text })` |  |
| `counts` | constant | 103 | `const counts = recordOf(num)` |  |
| `lazy` | function | 106 | `const lazy = (get: () => Check): Check =>` | A service tree is as deep as the estate's groups, so a node names its children through this. |

Imports: none

Imported by: `guards/assistant.ts`, `guards/auth.ts`, `guards/dashboard.ts`, `guards/graphs.ts`, `guards/hosts.ts`, `guards/index.ts`, `guards/meters.ts`, `guards/misfit.ts`, `guards/network.ts`, `guards/problems.ts`, `guards/reports.ts`, `guards/sla.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/guards/sla.ts`

The checks for availability and SLA. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/guards/sla.ts -->
248 lines, 12 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `availabilityGuard` | constant | 162 | `const availabilityGuard = guard<AvailabilityReport>('the availability report', availability)` | GET /api/reports/availability, either basis. |
| `servicesGuard` | constant | 165 | `const servicesGuard = guard<ServicesResponse>('the service tree', services)` | GET /api/services. |
| `derivedServicesGuard` | constant | 168 | `const derivedServicesGuard = guard<DerivedServicesResponse>('the service tree', derivedServices)` | GET /api/services/derived. |
| `sliGuard` | constant | 171 | `const sliGuard = guard<SliReport>('the SLA report', sli)` | GET /api/sli. |
| `slaSourceGuard` | constant | 174 | `const slaSourceGuard = guard<SlaSource>('the SLA source', slaSource)` | GET /api/sla/source. |
| `slaListGuard` | constant | 177 | `const slaListGuard = guard<Sla[]>('the SLA list', listOf(sla))` | GET /api/sla. |
| `slaSliGuard` | constant | 180 | `const slaSliGuard = guard<SlaSli[]>('the SLA figures', listOf(slaSli))` | GET /api/sla/sli. |
| `emailInfoGuard` | constant | 183 | `const emailInfoGuard = guard<EmailInfo>('the email settings', shape<EmailInfo>({ enabled: flag, from: text...` | GET /api/sli/email. |
| `savedRecipientsGuard` | constant | 189 | `const savedRecipientsGuard = guard<SavedRecipients>('the saved list', shape<SavedRecipients>({ recipients:...` | PUT /api/sli/recipients. |
| `deletedRecipientsGuard` | constant | 192 | `const deletedRecipientsGuard = guard<DeletedRecipients>('the saved list', shape<DeletedRecipients>({ recipients:...` | DELETE /api/sli/recipients. |
| `emailSentGuard` | constant | 195 | `const emailSentGuard = guard<EmailSent>('the email answer', shape<EmailSent>({ sent: num, refused: num, month: text...` | POST /api/sli/email: the mail has gone by the time this is read, so a page must not crash on it. |
| `scheduleInfoGuard` | constant | 234 | `const scheduleInfoGuard = guard<ScheduleInfo>('the schedule', shape<ScheduleInfo>({ available: flag, why: text...` | GET and PUT /api/sli/schedule. |

Imports: `guards/hosts.ts`, `guards/shape.ts`, `types/index.ts`

Imported by: `guards/index.ts`

Tests that import it: none
<!-- /gen -->

## `web/src/shared/components`

### `web/src/shared/components/BrandMark.tsx`

The HCML logo. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/shared/components/BrandMark.tsx -->
55 lines, 1 export. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 21 | `function BrandMark({ variant = 'lockup', alt = '', }: { /** 'lockup' is the full three-line logo on its plate...` | The HCML logo. |

Imports: none

Packages: `react`

Imported by: `features/auth/Login.tsx`, `features/dashboard/Overview.tsx`, `features/shell/Sidebar.tsx`

Tests that import it: `shared/components/BrandMark.test.tsx`
<!-- /gen -->

### `web/src/shared/components/CollectorNotice.tsx`

Says when Zabbix still answers but almost no device does, which means its way into the network is cut. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/shared/components/CollectorNotice.tsx -->
33 lines, 2 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `reachLost` | function | 5 | `const reachLost = (f: Freshness \| null \| undefined) =>` | Zabbix still answers but almost no device answers its ping: its way into the network is cut, not every device. |
| `CollectorNotice` | component | 11 | `function CollectorNotice({ freshness, now = Date.now() }: { freshness: Freshness \| null \| undefined; now?: number })` | Says when the page does not show the network as it is now: Zabbix has collected nothing for a while, or it is cut off from the network and the... |

Imports: `shared/lib/freshness.ts`, `types/index.ts`

Imported by: `features/dashboard/Overview.tsx`, `features/problems/Problems.tsx`

Tests that import it: none
<!-- /gen -->

### `web/src/shared/components/Field.tsx`

One cell of a controls row: a label above its control. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/shared/components/Field.tsx -->
31 lines, 3 exports. Imported by 16 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Field` | component | 4 | `function Field({ label, htmlFor, children }: { label: ReactNode; htmlFor?: string; children: ReactNode })` | One cell of a controls row: a label above its control. |
| `FieldGroup` | component | 14 | `function FieldGroup({ label, children }: { label: ReactNode; children: ReactNode })` | A cell whose control is not one input (a group of buttons, a checkbox): the heading is plain text, not a label. |
| `FieldSpacer` | component | 24 | `function FieldSpacer({ children }: { children: ReactNode })` | A cell with nothing to label (a count, a button): a hidden heading keeps it level with the labelled cells beside it. |

Imports: none

Packages: `react`

Imported by: `features/graphs/HostDetail.tsx`, `features/hosts/Devices.tsx`, `features/hosts/Hosts.tsx`, `features/hosts/LatestData.tsx`, `features/network/Links.tsx`, `features/network/Maps.tsx`, `features/network/Network.tsx`, `features/network/Sites.tsx`, `features/problems/Problems.tsx`, `features/reports/AlertNoise.tsx`, `features/reports/Capacity.tsx`, `features/reports/TopTriggers.tsx`, `features/sla/Availability.tsx`, `features/sla/Services.tsx`, and 2 more

Tests that import it: `__tests__/sharedPieces.test.tsx`
<!-- /gen -->

### `web/src/shared/components/KpiCard.tsx`

A figure card, with a stripe only when a state sets one. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/shared/components/KpiCard.tsx -->
21 lines, 1 export. Imported by 6 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `default` | component | 3 | `function KpiCard({ label, value, sub, accent, }: { label: string; value: string \| number; sub?: string; accent?:...` |  |

Imports: `shared/components/NoData.tsx`

Imported by: `features/dashboard/HostsView.tsx`, `features/dashboard/Overview.tsx`, `features/network/Links.tsx`, `features/reports/AlertNoise.tsx`, `features/sla/Availability.tsx`, `features/sla/Sla.tsx`

Tests that import it: none
<!-- /gen -->

### `web/src/shared/components/NoData.tsx`

The placeholder for no value, spoken as words by a screen reader. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/shared/components/NoData.tsx -->
18 lines, 2 exports. Imported by 17 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `NoData` | component | 8 | `function NoData({ label = 'No data' }: { label?: string })` | The "no value" placeholder: the dash for the eye, words for a screen reader, which otherwise reads "em dash" or nothing at all (DESIGN.md section 9). |
| `orNoData` | function | 18 | `const orNoData = (text: string \| number): ReactNode =>` | A formatter's output as page text: its bare " - " becomes the readable placeholder. |

Imports: none

Packages: `react`

Imported by: `features/assistant/ExplainPanel.tsx`, `features/graphs/TimeSeriesChart.tsx`, `features/hosts/HostTable.tsx`, `features/hosts/LatestData.tsx`, `features/network/Links.tsx`, `features/network/Network.tsx`, `features/problems/Problems.tsx`, `features/problems/ProblemsTable.tsx`, `features/reports/AlertNoise.tsx`, `features/reports/Capacity.tsx`, `features/reports/Inventory.tsx`, `features/reports/TopTriggers.tsx`, `features/sla/Availability.tsx`, `features/sla/Sla.tsx`, and 3 more

Tests that import it: `shared/components/NoData.test.tsx`
<!-- /gen -->

### `web/src/shared/components/Pager.tsx`

Previous and Next around a line saying where the list stands. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/shared/components/Pager.tsx -->
26 lines, 1 export. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Pager` | component | 4 | `function Pager({ page, pages, onPage, children, }: { page: number; pages: number; onPage: (page: number) => void...` | Previous and Next around a line saying where the list stands; the caller words that line. |

Imports: none

Packages: `react`

Imported by: `features/hosts/LatestData.tsx`, `features/network/Network.tsx`

Tests that import it: `__tests__/sharedPieces.test.tsx`
<!-- /gen -->

### `web/src/shared/components/StatusBadge.tsx`

The severity, up/down, availability and host-state pills. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/shared/components/StatusBadge.tsx -->
93 lines, 5 exports. Imported by 12 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SeverityBadge` | component | 5 | `function SeverityBadge({ level }: { level: string \| number })` |  |
| `UpDown` | component | 14 | `function UpDown({ up }: { up: boolean \| undefined })` |  |
| `AvailabilityPill` | component | 50 | `function AvailabilityPill({ kind, label, title }: { kind: HostStatusKind; label: string; title?: string })` |  |
| `HostStatePill` | component | 59 | `function HostStatePill({ host }: { host: Parameters<typeof hostStatus>[0] })` | A host's state pill: the BFF's ping-first `state` (reason as the tooltip), else interface availability. |
| `SeverityCounts` | component | 70 | `function SeverityCounts({ bySeverity }: { bySeverity: Record<string, number> })` | Zabbix-style severity count strip: one colored chip per non-zero severity. |

Imports: `shared/components/NoData.tsx`, `shared/lib/severity.ts`, `theme.ts`

Imported by: `features/assistant/ExplainPanel.tsx`, `features/dashboard/Overview.tsx`, `features/hosts/HostTable.tsx`, `features/network/Network.tsx`, `features/network/Sites.tsx`, `features/problems/AckDialog.tsx`, `features/problems/Problems.tsx`, `features/problems/ProblemsTable.tsx`, `features/reports/AlertNoise.tsx`, `features/reports/TopTriggers.tsx`, `features/sla/Availability.tsx`, `features/sla/Services.tsx`

Tests that import it: none
<!-- /gen -->

### `web/src/shared/components/TableWrap.tsx`

The box that lets a wide table scroll, with a tab stop and a name. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/shared/components/TableWrap.tsx -->
51 lines, 1 export. Imported by 13 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `TableWrap` | component | 20 | `function TableWrap({ label, className, children }: { label: string; className?: string; children: ReactNode })` | The box that lets a wide table scroll. |

Imports: none

Packages: `react`

Imported by: `features/dashboard/Overview.tsx`, `features/hosts/HostTable.tsx`, `features/hosts/LatestData.tsx`, `features/network/Links.tsx`, `features/network/Network.tsx`, `features/problems/Problems.tsx`, `features/problems/ProblemsTable.tsx`, `features/reports/AlertNoise.tsx`, `features/reports/Capacity.tsx`, `features/reports/Inventory.tsx`, `features/reports/TopTriggers.tsx`, `features/sla/Availability.tsx`, `features/sla/Sla.tsx`

Tests that import it: `shared/components/TableWrap.test.tsx`
<!-- /gen -->

### `web/src/shared/components/icons.tsx`

The menu and page icons, drawn inline. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/shared/components/icons.tsx -->
145 lines, 16 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `IconOverview` | component | 17 | `const IconOverview = ({ size }: P) =>` |  |
| `IconAlert` | component | 26 | `const IconAlert = ({ size }: P) =>` |  |
| `IconHost` | component | 34 | `const IconHost = ({ size }: P) =>` |  |
| `IconDevice` | component | 44 | `const IconDevice = ({ size }: P) =>` | A device: a screen on a stand, for the Devices page (the Hosts page keeps the rack). |
| `IconNetwork` | component | 53 | `const IconNetwork = ({ size }: P) =>` |  |
| `IconLatest` | component | 62 | `const IconLatest = ({ size }: P) =>` |  |
| `IconGraph` | component | 73 | `const IconGraph = ({ size }: P) =>` |  |
| `IconMap` | component | 80 | `const IconMap = ({ size }: P) =>` |  |
| `IconReport` | component | 88 | `const IconReport = ({ size }: P) =>` |  |
| `IconLink` | component | 97 | `const IconLink = ({ size }: P) =>` |  |
| `IconShield` | component | 104 | `const IconShield = ({ size }: P) =>` |  |
| `IconService` | component | 111 | `const IconService = ({ size }: P) =>` |  |
| `IconSite` | component | 120 | `const IconSite = ({ size }: P) =>` |  |
| `IconSla` | component | 127 | `const IconSla = ({ size }: P) =>` |  |
| `IconChat` | component | 134 | `const IconChat = ({ size }: P) =>` |  |
| `IconChevron` | component | 141 | `const IconChevron = ({ size = 14 }: P) =>` |  |

Imports: none

Imported by: `features/shell/Sidebar.tsx`, `features/sla/Services.tsx`

Tests that import it: `__tests__/markup.test.tsx`
<!-- /gen -->

### `web/src/shared/components/states.tsx`

Loading, error, empty and stale-copy states, and the Async wrapper that shows them. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/shared/components/states.tsx -->
169 lines, 7 exports. Imported by 25 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Loading` | component | 7 | `function Loading({ label = 'Loading…' }: { label?: string })` |  |
| `ErrorState` | component | 48 | `function ErrorState({ message }: { message: string })` |  |
| `Empty` | component | 71 | `function Empty({ children }: { children: ReactNode })` |  |
| `RefreshFailed` | component | 76 | `function RefreshFailed({ error, updatedAt }: { error: string; updatedAt?: number \| null })` | A refresh failed; the last good data stays on screen, and says how old it is. |
| `StaleCopy` | component | 92 | `function StaleCopy({ asOf, what = 'this', refreshing = false }: { asOf: number \| null; what?: string; refreshing?:...` | The BFF could not reach Zabbix and answered with the last copy it kept (X-Data-Stale, see shared/lib/freshness.ts). |
| `Loaded` | component | 114 | `function Loaded({ stale = false, error, updatedAt, children, }: { stale?: boolean; error?: string \| null...` | Loaded content. |
| `Async` | component | 140 | `function Async<T>({ loading, error, data, stale = false, updatedAt, children, loadingLabel, }: { loading: boolean...` | Renders loading / error / empty around loaded data. |

Imports: `shared/hooks/useAuth.ts`, `shared/hooks/useReportTimeZone.ts`, `shared/lib/freshness.ts`, `shared/lib/time.ts`

Packages: `react`

Imported by: `App.tsx`, `features/assistant/Assistant.tsx`, `features/assistant/ExplainPanel.tsx`, `features/dashboard/HostsView.tsx`, `features/dashboard/Overview.tsx`, `features/graphs/HostDetail.tsx`, `features/graphs/ItemPicker.tsx`, `features/graphs/TimeSeriesChart.tsx`, `features/hosts/Devices.tsx`, `features/hosts/Hosts.tsx`, `features/hosts/LatestData.tsx`, `features/meters/InternetMeters.tsx`, `features/network/Links.tsx`, `features/network/Maps.tsx`, and 11 more

Tests that import it: `__tests__/OperatorWording.test.tsx`, `__tests__/hostListFailure.test.tsx`, `__tests__/tooltipFacts.test.tsx`, `__tests__/zoneClocks.test.tsx`, `shared/lib/freshness.test.tsx`
<!-- /gen -->

## `web/src/shared/hooks`

### `web/src/shared/hooks/useAsync.ts`

Fetch with loading and error state, an abort on leave, and optional polling. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/shared/hooks/useAsync.ts -->
162 lines, 1 export. Imported by 22 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `useAsync` | hook | 42 | `function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[] = [], intervalMs?: number)` | Fetch helper with loading/error state and optional polling. |

Imports: `api/index.ts`

Packages: `react`

Imported by: `features/assistant/ExplainPanel.tsx`, `features/dashboard/Overview.tsx`, `features/dashboard/useHostsView.ts`, `features/graphs/HostDetail.tsx`, `features/graphs/ItemPicker.tsx`, `features/graphs/TimeSeriesChart.tsx`, `features/hosts/Devices.tsx`, `features/hosts/Hosts.tsx`, `features/hosts/LatestData.tsx`, `features/meters/useMeters.ts`, `features/network/Links.tsx`, `features/network/Maps.tsx`, `features/network/Network.tsx`, `features/network/Sites.tsx`, and 8 more

Tests that import it: `shared/hooks/useAsync.test.ts`
<!-- /gen -->

### `web/src/shared/hooks/useAuth.ts`

Who is signed in and what they may see, from one shared probe. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/shared/hooks/useAuth.ts -->
79 lines, 3 exports. Imported by 10 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `roleAllows` | function | 15 | `const roleAllows = (has: Role \| null, needs: Role) =>` |  |
| `resetAuthProbe` | function | 21 | `function resetAuthProbe(): void` | Re-probe after login/logout, when the role has changed. |
| `useAuth` | hook | 28 | `function useAuth(): { me: Me \| null; role: Role \| null; /** The role each menu page needs, as the server states it...` |  |

Imports: `api/index.ts`, `types/index.ts`

Packages: `react`

Imported by: `features/assistant/Assistant.tsx`, `features/auth/Login.tsx`, `features/dashboard/Overview.tsx`, `features/hosts/Devices.tsx`, `features/network/Network.tsx`, `features/problems/Problems.tsx`, `features/shell/Layout.tsx`, `features/shell/Sidebar.tsx`, `features/sla/EmailReport.tsx`, `shared/components/states.tsx`

Tests that import it: `__tests__/OperatorWording.test.tsx`, `__tests__/countPills.test.tsx`, `__tests__/guardedReads.test.tsx`, `__tests__/hostListFailure.test.tsx`, `__tests__/pagePastEnd.test.tsx`, `__tests__/sharedPages.test.tsx`, `__tests__/tooltipFacts.test.tsx`, `features/assistant/Assistant.test.tsx`, and 14 more
<!-- /gen -->

### `web/src/shared/hooks/useDebounced.ts`

A value once it has stopped changing. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/shared/hooks/useDebounced.ts -->
11 lines, 1 export. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `useDebounced` | hook | 4 | `function useDebounced<T>(value: T, ms: number): T` | `value` once it has stopped changing for `ms`. |

Imports: none

Packages: `react`

Imported by: `features/hosts/LatestData.tsx`, `features/network/Network.tsx`

Tests that import it: none
<!-- /gen -->

### `web/src/shared/hooks/useDialogFocus.ts`

Moves focus into a dialog and back when it closes. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/shared/hooks/useDialogFocus.ts -->
93 lines, 2 exports. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `focusMain` | function | 8 | `function focusMain(): void` | Focus the main content. |
| `useDialogFocus` | hook | 33 | `function useDialogFocus(dialog: RefObject<HTMLElement>, initial?: RefObject<HTMLElement>): void` | What a modal dialog owes a keyboard user (WCAG 2.4.3): focus moves in on open, Tab and Shift+Tab stay inside, and focus returns to whatever opened... |

Imports: none

Packages: `react`

Imported by: `features/assistant/ExplainPanel.tsx`, `features/problems/AckDialog.tsx`, `features/shell/Layout.tsx`, `features/sla/ReportDialog.tsx`

Tests that import it: `shared/hooks/useDialogFocus.test.tsx`
<!-- /gen -->

### `web/src/shared/hooks/useNow.ts`

The current time, re-read on an interval. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/shared/hooks/useNow.ts -->
11 lines, 1 export. Imported by 4 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `useNow` | hook | 4 | `function useNow(everyMs: number): number` | The current time, re-read every `everyMs`, for ages and staleness that must move on their own. |

Imports: none

Packages: `react`

Imported by: `features/assistant/Assistant.tsx`, `features/dashboard/Overview.tsx`, `features/meters/InternetMeters.tsx`, `features/shell/TodayDate.tsx`

Tests that import it: none
<!-- /gen -->

### `web/src/shared/hooks/useReportTimeZone.ts`

The reporting time zone, re-rendering when the server's answer changes it. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/shared/hooks/useReportTimeZone.ts -->
7 lines, 1 export. Imported by 11 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `useReportTimeZone` | hook | 5 | `function useReportTimeZone(): string` | The report zone (shared/lib/time.ts), re-rendering when the server's answer changes it; apart from useAi to keep the API client out. |

Imports: `shared/lib/time.ts`

Packages: `react`

Imported by: `features/dashboard/HostsView.tsx`, `features/dashboard/Overview.tsx`, `features/graphs/RangePicker.tsx`, `features/graphs/TimeSeriesChart.tsx`, `features/meters/InternetMeters.tsx`, `features/shell/TodayDate.tsx`, `features/sla/Availability.tsx`, `features/sla/Services.tsx`, `features/sla/Sla.tsx`, `features/sla/Sli.tsx`, `shared/components/states.tsx`

Tests that import it: none
<!-- /gen -->

### `web/src/shared/hooks/useSSE.ts`

The live stream: connects, reads frames, and treats three missed pings as a dead line. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/shared/hooks/useSSE.ts -->
187 lines, 2 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `STREAM_SILENT_MS` | constant | 6 | `const STREAM_SILENT_MS = 45_000` | The BFF writes at least every 15 s, a `ping` when nothing else (stream.ts); three missed means the line is dead. |
| `useSSE` | hook | 46 | `function useSSE<T>(url: string, event: string, silentMs?: number, guard?: Guard<T>)` | Subscribe to one named SSE event; returns the latest payload, when it arrived, connection state, and the last error the stream reported. |

Imports: `api/index.ts`, `guards/index.ts`

Packages: `react`

Imported by: `features/dashboard/Overview.tsx`, `features/problems/Problems.tsx`

Tests that import it: `__tests__/OperatorWording.test.tsx`, `features/dashboard/dashboardViews.test.tsx`, `shared/hooks/useSSE.test.ts`, `shared/lib/freshness.test.tsx`
<!-- /gen -->

### `web/src/shared/hooks/useUrlState.ts`

Reads and changes query-string parameters in place. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/shared/hooks/useUrlState.ts -->
98 lines, 2 exports. Imported by 19 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `useSearchPatch` | hook | 12 | `function useSearchPatch(): (patch: Record<string, string \| null>) => void` | Change query-string parameters in place: `null` or `''` removes one. |
| `useUrlState` | hook | 62 | `function useUrlState<T extends UrlValue>(key: string, fallback: T, { options, debounceMs }: { options?: readonly...` | One piece of page state, a filter, a sort, a selection, kept in the query string, so Back to the page (and a shared link) restores it. |

Imports: none

Packages: `react`, `react-router-dom`

Imported by: `features/dashboard/Overview.tsx`, `features/graphs/HostDetail.tsx`, `features/graphs/RangePicker.tsx`, `features/hosts/Devices.tsx`, `features/hosts/Hosts.tsx`, `features/hosts/LatestData.tsx`, `features/network/Links.tsx`, `features/network/Maps.tsx`, `features/network/Network.tsx`, `features/network/Sites.tsx`, `features/problems/Problems.tsx`, `features/reports/AlertNoise.tsx`, `features/reports/Capacity.tsx`, `features/reports/Inventory.tsx`, and 5 more

Tests that import it: `shared/hooks/useUrlState.test.tsx`
<!-- /gen -->

## `web/src/shared/lib`

### `web/src/shared/lib/chatStore.ts`

Where this tab keeps the Assistant conversation. Walked through in [Web app: the pages](web-features.md), [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/shared/lib/chatStore.ts -->
52 lines, 5 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `CHAT_STORAGE_KEY` | constant | 4 | `const CHAT_STORAGE_KEY` | Where this tab keeps the Assistant conversation; api/session.ts clears it when a session ends or begins. |
| `loadConversation` | function | 7 | `function loadConversation(): ChatMessage[]` | The saved conversation, or none when storage is blocked or holds something else. |
| `saveConversation` | function | 24 | `function saveConversation(messages: ChatMessage[]): void` |  |
| `clearConversation` | function | 43 | `function clearConversation(): void` | A session ended (sign-out, a refused session, another tab signing out): forget the conversation and keep it forgotten. |
| `startConversation` | function | 49 | `function startConversation(): void` | A sign-in begins a conversation of its own: whatever was left is dropped, and saving is allowed again. |

Imports: `types/index.ts`

Imported by: `api/session.ts`, `features/assistant/Assistant.tsx`

Tests that import it: `__tests__/signOutClearsChat.test.ts`, `__tests__/signOutFailure.test.ts`, `shared/lib/chatStore.test.ts`
<!-- /gen -->

### `web/src/shared/lib/csv.ts`

The one CSV writer, with its guard against spreadsheet formulas. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/shared/lib/csv.ts -->
26 lines, 3 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `csvCell` | function | 9 | `function csvCell(value: unknown): string` |  |
| `toCsv` | function | 16 | `function toCsv(rows: unknown[][]): string` |  |
| `downloadCsv` | function | 24 | `function downloadCsv(fileName: string, rows: unknown[][]): void` | Save `rows` as a CSV file. |

Imports: `shared/lib/saveFile.ts`

Imported by: `features/graphs/TimeSeriesChart.tsx`, `features/reports/AlertNoise.tsx`, `features/reports/Inventory.tsx`

Tests that import it: `features/graphs/chartCsv.test.ts`, `shared/lib/csv.test.ts`
<!-- /gen -->

### `web/src/shared/lib/freshness.ts`

How old the numbers on a page are, when the server says so. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/shared/lib/freshness.ts -->
67 lines, 6 exports. Imported by 7 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `REFRESHING_NOTICE_AFTER_S` | constant | 17 | `const REFRESHING_NOTICE_AFTER_S = 120` | How old a refreshing copy must be before a page says so: younger, it is no older than Zabbix's own data. |
| `noteStaleCopy` | function | 23 | `function noteStaleCopy(body: unknown, headers: Headers, receivedAt = Date.now()): void` | Called by the API layer for every JSON reply. |
| `staleCopyOf` | function | 40 | `function staleCopyOf(body: unknown): { asOf: number \| null; refreshing?: true } \| null` | Whether `body` is an old copy: `{ asOf }` with the time the copy was made (ms since epoch, null when the BFF did not say), plus `refreshing: true`... |
| `ageWords` | function | 48 | `function ageWords(seconds: number): string` | A span of time in a few words: "12 min", "3 h 5 min", "20 days". |
| `momentWords` | function | 59 | `function momentWords(ms: number, now = Date.now()): string` | A moment as the clock time on its own for today, with the date in front of it for another day: the report zone's, ending in its name. |
| `staleWhen` | function | 65 | `function staleWhen(asOf: number \| null, now = Date.now()): string` | When an old copy was made, as the notice words it: "from 08:48 (1 h 12 min ago)", or '' when that is not known. |

Imports: `shared/lib/time.ts`

Imported by: `api/client.ts`, `features/dashboard/Overview.tsx`, `features/meters/gaugeDial.ts`, `features/problems/AckDialog.tsx`, `features/sla/Sla.tsx`, `shared/components/CollectorNotice.tsx`, `shared/components/states.tsx`

Tests that import it: `__tests__/guardedReads.test.tsx`, `__tests__/zoneClocks.test.tsx`, `shared/lib/freshness.test.tsx`
<!-- /gen -->

### `web/src/shared/lib/plural.ts`

A count with its noun. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/shared/lib/plural.ts -->
2 lines, 1 export. Imported by 11 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `count` | function | 2 | `const count = (n: number, noun: string, plural = '${noun}s'): string =>` | A count with its noun, "1 host" and "2 hosts". |

Imports: none

Imported by: `features/assistant/Assistant.tsx`, `features/hosts/Devices.tsx`, `features/hosts/Hosts.tsx`, `features/meters/gaugeDial.ts`, `features/network/Maps.tsx`, `features/network/Sites.tsx`, `features/reports/AlertNoise.tsx`, `features/reports/Inventory.tsx`, `features/sla/Availability.tsx`, `features/sla/Services.tsx`, `features/sla/Sla.tsx`

Tests that import it: `shared/lib/plural.test.ts`
<!-- /gen -->

### `web/src/shared/lib/saveFile.ts`

Saves a file the page built, through a throwaway link, and keeps its address long enough for the browser to finish. Walked through in [Web: the API client and guards](web-api-types-guards.md).

<!-- gen:card web/src/shared/lib/saveFile.ts -->
15 lines, 2 exports. Imported by 2 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `REVOKE_AFTER_MS` | constant | 2 | `const REVOKE_AFTER_MS = 40_000` | Firefox and Safari can cancel a save whose URL is revoked at once; download helpers settle on 40 s. |
| `saveFile` | function | 5 | `function saveFile(blob: Blob, fileName: string): void` | A blob has no name of its own, so it is saved through a throwaway link that carries one. |

Imports: none

Imported by: `features/sla/ReportDownload.tsx`, `shared/lib/csv.ts`

Tests that import it: `shared/lib/csv.test.ts`
<!-- /gen -->

### `web/src/shared/lib/severity.ts`

Severity names, times, ages, durations and availability text. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/shared/lib/severity.ts -->
125 lines, 10 exports. Imported by 10 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `severity` | function | 6 | `function severity(level: string \| number)` |  |
| `fmtTime` | function | 11 | `function fmtTime(clock: string \| number \| undefined): string` |  |
| `ago` | function | 18 | `function ago(clock: string \| number): string` |  |
| `duration` | function | 24 | `function duration(clock: string \| number, rClock?: string \| number): string` | Problem duration: from onset to recovery (or now if still open). |
| `fmtValue` | function | 39 | `function fmtValue(v: number \| string \| undefined \| null, units?: string): string` | Human-friendly number with an optional unit. |
| `availability` | function | 47 | `function availability(code: string \| undefined)` | Interface availability (Zabbix): 0 unknown, 1 available, 2 unavailable. |
| `hostAvailability` | function | 59 | `function hostAvailability(interfaces?: { available?: string }[])` | Roll up per-interface availability to a host-level state (worst wins). |
| `HostStatusKind` | type | 66 | `type HostStatusKind = HostState \| 'unknown'` |  |
| `hostStatus` | function | 89 | `function hostStatus(h: { state?: HostState; reason?: StateReason; availability?: 'available' \| 'unavailable' \|...` | Label, pill kind and tooltip for a host. |
| `ifaceType` | function | 125 | `const ifaceType = (t?: string) =>` |  |

Imports: `shared/lib/time.ts`, `shared/lib/units.ts`, `theme.ts`, `types/index.ts`

Imported by: `features/assistant/ExplainPanel.tsx`, `features/graphs/StaleNote.tsx`, `features/graphs/TimeSeriesChart.tsx`, `features/hosts/HostTable.tsx`, `features/hosts/LatestData.tsx`, `features/network/Links.tsx`, `features/network/Maps.tsx`, `features/problems/Problems.tsx`, `features/problems/ProblemsTable.tsx`, `shared/components/StatusBadge.tsx`

Tests that import it: `shared/lib/reportZone.test.ts`
<!-- /gen -->

### `web/src/shared/lib/sites.ts`

The browser's copy of the site-naming rules. Walked through in [Server: domain and hosts](server-domain-and-hosts.md), [Server: routes](server-routes.md), [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/shared/lib/sites.ts -->
84 lines, 5 exports. Imported by 6 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `SiteRef` | interface | 6 | `interface SiteRef` |  |
| `SITES` | constant | 11 | `const SITES: (SiteRef & { aliases: string[] })[]` |  |
| `naturalCompare` | constant | 31 | `const naturalCompare = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare` | Numeric-aware ordering: `1.2.2` before `1.2.10`, `Gi1/0/2` before `Gi1/0/10`. |
| `siteFromHostName` | function | 36 | `function siteFromHostName(name: string): SiteRef \| null` |  |
| `groupBySite` | function | 56 | `function groupBySite<T>(list: T[], nameOf: (t: T) => string, siteOf?: (t: T) => SiteRef \| null \| undefined): { key:...` | Group anything with a host name by site: sites in code order, then "Unassigned". |

Imports: none

Imported by: `web/scripts/units.check.ts`, `features/graphs/HostDetail.tsx`, `features/graphs/ItemPicker.tsx`, `features/hosts/LatestData.tsx`, `features/network/Network.tsx`, `features/sla/Sla.tsx`

Tests that import it: `__tests__/copiedHelpers.test.ts`
<!-- /gen -->

### `web/src/shared/lib/time.ts`

Dates and months in HCML's reporting time zone. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/shared/lib/time.ts -->
269 lines, 24 exports. Imported by 23 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `DEFAULT_REPORT_TZ` | constant | 6 | `const DEFAULT_REPORT_TZ` |  |
| `reportTimeZone` | function | 22 | `const reportTimeZone = (): string =>` | The zone the reports are cut in. |
| `setReportTimeZone` | function | 25 | `function setReportTimeZone(tz: unknown): void` | Take the zone the server named; anything else (missing, not a zone) means the default. |
| `subscribeReportTimeZone` | function | 33 | `function subscribeReportTimeZone(fn: () => void): () => void` | For useSyncExternalStore: told when the zone changes. |
| `zoneLabel` | function | 41 | `function zoneLabel(atMs: number, tz = reportTz): string` | "WIB" for Asia/Jakarta (the Indonesian locale names its three zones); elsewhere Intl's short name, such as "GMT+1". |
| `formatDateTime` | function | 53 | `function formatDateTime(atMs: number, tz = reportTz): string` | A moment as the browser's locale writes it, but in the report zone and ending in its label, so nobody reads it as their own clock. |
| `formatIsoDateTime` | function | 77 | `function formatIsoDateTime(atMs: number, tz = reportTz): string` | A moment as `2026-10-19 14:05:00` in the report zone: the same digits in every browser and locale, in an order that sorts, and what a spreadsheet... |
| `formatClock` | function | 99 | `function formatClock(atMs: number, withSeconds = false, tz = reportTz): string` | "15:04", or "15:04:05" with the seconds: the 24-hour clock of `tz`. |
| `formatClockLabeled` | function | 110 | `const formatClockLabeled = (atMs: number, withSeconds = false, tz = reportTz): string =>` | The clock ending in the zone's name, "15:04 WIB", so it is never read as the viewer's own clock. |
| `dayInZone` | function | 114 | `const dayInZone = (atMs: number, tz = reportTz): string =>` | The calendar day of a moment in `tz` as 2026-10-07, for file names: not yesterday's date after midnight in Jakarta. |
| `formatDate` | function | 119 | `function formatDate(atMs: number, tz = reportTz): string` | The day in `tz` as the browser's locale writes a date. |
| `formatWeekdayDate` | function | 131 | `function formatWeekdayDate(atMs: number, tz = reportTz): string` | "Wed, 7 Oct 2026": the day in `tz`, for the wall clock. |
| `formatAxisTime` | function | 158 | `function formatAxisTime(atMs: number, spanSeconds: number, tz = reportTz, withDay = false): string` | A tick on the time axis of a chart, in the report zone: the day at midnight, otherwise the hour and minute, with the day too once the range runs... |
| `axisNeedsDays` | function | 169 | `function axisNeedsDays(from: number, to: number, tz = reportTz): boolean` | Whether each tick of an axis from `from` to `to` (seconds) must name its day. |
| `formatDay` | function | 175 | `const formatDay = (atMs: number, tz = reportTz): string =>` | "7 Oct": the day of a moment on the wall clock of `tz`. |
| `formatDayTime` | function | 178 | `function formatDayTime(atMs: number, tz = reportTz): string` | "7 Oct 15:00": a moment in the report zone, short enough for the handle of a slider. |
| `toZonedInput` | function | 204 | `function toZonedInput(epochSeconds: number, tz = reportTz): string` | A moment as a datetime-local field writes it, `2026-10-07T15:00`, on the wall clock of `tz`. |
| `fromZonedInput` | function | 211 | `function fromZonedInput(text: string, tz = reportTz): number` | The Unix time of a datetime-local value read as the wall clock of `tz`, whatever the browser's zone; NaN when it is not a date and time. |
| `zonedMonthStart` | function | 223 | `function zonedMonthStart(year: number, month: number, tz = reportTz): number` |  |
| `isMonth` | function | 231 | `const isMonth = (s: string \| null \| undefined): s is string =>` |  |
| `monthBounds` | function | 233 | `function monthBounds(month: string, tz = reportTz): { from: number; to: number }` |  |
| `monthOf` | function | 242 | `function monthOf(atSeconds: number, tz = reportTz): string` |  |
| `recentMonths` | function | 252 | `function recentMonths(count = 12, tz = reportTz): string[]` | The current month and the 11 before it, newest first. |
| `monthLabel` | function | 266 | `function monthLabel(month: string): string` |  |

Imports: none

Imported by: `web/scripts/units.check.ts`, `features/assistant/useAi.ts`, `features/dashboard/HostsView.tsx`, `features/dashboard/Overview.tsx`, `features/graphs/RangePicker.tsx`, `features/graphs/TimeSeriesChart.tsx`, `features/graphs/chartCsv.ts`, `features/meters/InternetMeters.tsx`, `features/meters/gaugeDial.ts`, `features/reports/AlertNoise.tsx`, `features/reports/Inventory.tsx`, `features/shell/TodayDate.tsx`, `features/shell/build.ts`, `features/sla/Availability.tsx`, and 9 more

Tests that import it: `__tests__/copiedHelpers.test.ts`, `__tests__/mainZone.test.tsx`, `__tests__/reportZoneUi.test.tsx`, `__tests__/urlFilters.test.tsx`, `__tests__/zoneClocks.test.tsx`, `features/assistant/useAi.test.tsx`, `features/graphs/chartZone.test.tsx`, `features/graphs/graphZone.test.tsx`, and 6 more
<!-- /gen -->

### `web/src/shared/lib/units.ts`

Zabbix units turned into human text. Walked through in [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/shared/lib/units.ts -->
156 lines, 8 exports. Imported by 11 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `PERCENT_DP` | constant | 23 | `const PERCENT_DP` | One rule for a percentage on every page: the sign sits against the number, and each measure has one number of decimals, so the same figure reads... |
| `PercentMeasure` | type | 32 | `type PercentMeasure = keyof typeof PERCENT_DP` |  |
| `fixedBelow100` | function | 35 | `function fixedBelow100(value: number, digits: number): string` | `value.toFixed(digits)`, except that a figure below 100 is cut and never rounded up to read as 100. |
| `formatPercent` | function | 42 | `function formatPercent(v: number \| null \| undefined, measure: PercentMeasure): string` |  |
| `formatDuration` | function | 76 | `function formatDuration(totalSeconds: number): string` |  |
| `dur` | function | 92 | `function dur(totalSeconds: number): string` | Seconds → the coarsest unit that still reads naturally: 45s, 12m, 3.5h, 2.1d. |
| `formatValue` | function | 119 | `function formatValue(v: number \| null \| undefined, units?: string): string` |  |
| `formatAxis` | function | 151 | `function formatAxis(v: number, units?: string): string` | Short axis label: same families, fewer decimals. |

Imports: `shared/lib/time.ts`

Imported by: `web/scripts/units.check.ts`, `features/graphs/TimeSeriesChart.tsx`, `features/meters/gaugeDial.ts`, `features/network/Links.tsx`, `features/network/Network.tsx`, `features/reports/AlertNoise.tsx`, `features/sla/Availability.tsx`, `features/sla/Sla.tsx`, `features/sla/Sli.tsx`, `features/sla/percent.ts`, `shared/lib/severity.ts`

Tests that import it: `features/graphs/chartZone.test.tsx`, `shared/lib/units.test.ts`
<!-- /gen -->

### `web/src/shared/lib/wall.ts`

What the wall shows, in turn. Walked through in [Web app: the pages](web-features.md), [Web app: the shell and the shared code](web-shell-and-shared.md).

<!-- gen:card web/src/shared/lib/wall.ts -->
83 lines, 12 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `WALL_METERS` | constant | 9 | `const WALL_METERS = 35` | The most meters one slide holds at 1080p; more go on further slides. |
| `DashboardView` | type | 11 | `type DashboardView = 'overview' \| 'hosts' \| 'internet'` |  |
| `Slide` | type | 13 | `type Slide = { view: 'overview' } \| { view: 'hosts' } \| { view: 'internet'; page: number }` |  |
| `wallPages` | function | 16 | `const wallPages = (count: number, per = WALL_METERS): number =>` | How many slides the meters take: at least one, so a wall always has a place to say "no links". |
| `wallSlice` | function | 19 | `function wallSlice<T>(items: T[], page: number, pages: number): T[]` | One page of an even split: 40 meters on two pages are 20 and 20, not 35 and 5. |
| `slidesOf` | function | 25 | `function slidesOf({ views, pages }: { views: readonly DashboardView[]; pages: number }): Slide[]` | The slides of the views given, in that order, the meters as many pages as they need. |
| `slideKey` | function | 35 | `const slideKey = (s: Slide): string =>` | A slide as text, to tell a new set of slides from the same one. |
| `ROTATE_DEFAULT` | constant | 38 | `const ROTATE_DEFAULT = 30` | Seconds a slide stays when the address does not say. |
| `rotateSeconds` | function | 43 | `function rotateSeconds(raw: string \| null): number` | Seconds per slide from `rotate=`: 30 when absent or not a whole number, 0 stops the rotation, otherwise 10 to 600. |
| `needsAttention` | function | 50 | `function needsAttention(m: Meter): boolean` | Whether a link needs a look: its interface is down, or it is High or Critical in the gauge's direction or the other. |
| `InternetCard` | interface | 56 | `interface InternetCard` |  |
| `internetCard` | function | 65 | `function internetCard(d: MetersResponse \| null \| undefined): InternetCard` | The Overview's card for the internet links: how many need attention, and which way. |

Imports: `types/index.ts`

Imported by: `features/dashboard/Overview.tsx`, `features/dashboard/useWallRotation.ts`, `features/meters/InternetMeters.tsx`

Tests that import it: `shared/lib/wall.test.ts`
<!-- /gen -->

## `web/src/styles`

### `web/src/styles/00-fonts.css`

The two typefaces, served from this site so nothing is fetched from outside. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/00-fonts.css -->
80 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/01-tokens.css`

The design tokens: colours, spacing, type, radii and motion, for light and dark. Walked through in [Server: export](server-export.md), [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/01-tokens.css -->
337 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/02-base.css`

The reset and the one visible focus ring. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/02-base.css -->
51 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/03-shell.css`

The page grid: sidebar, top bar and content. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/03-shell.css -->
100 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/04-login.css`

The sign-in card. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/04-login.css -->
85 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/05-layout-chips-tags.css`

The two-column layout, severity chips, problem tags and the skip link. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/05-layout-chips-tags.css -->
125 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/06-cards-tables-badges.css`

Panels, figure cards, tables and pills. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/06-cards-tables-badges.css -->
146 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/07-controls-states.css`

Buttons, fields, filters and the loading, error and empty states. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/07-controls-states.css -->
236 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/08-explain-modal-notices.css`

The login wrapper, the Explain slide-over, modal dialogs, notices and the role chip. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/08-explain-modal-notices.css -->
354 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/09-reports-sites.css`

The scorecard, alert-noise flags, links, ageing, the service tree and the site cards. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/09-reports-sites.css -->
446 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/10-assistant.css`

The Assistant's chat. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/10-assistant.css -->
145 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/11-graphs-network.css`

The Graphs, Latest data and Network pages. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/11-graphs-network.css -->
345 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/12-sla-services-links.css`

The SLA, services, availability, capacity, sites and links pages. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/12-sla-services-links.css -->
212 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/13-second-pass.css`

Fixes found on the second pass: freshness, errors, links in tables, focus and a few page details. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/13-second-pass.css -->
123 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/14-sidebar-wall.css`

The collapsible sidebar, the theme picker and the wall mode. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/14-sidebar-wall.css -->
243 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/15-report-download.css`

The SLA download buttons. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/15-report-download.css -->
42 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/16-meters.css`

The Dashboard's tabs and the internet traffic meters. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/16-meters.css -->
222 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/17-hosts-devices.css`

The Dashboard's Hosts view. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/17-hosts-devices.css -->
176 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/18-soft-depth.css`

The soft look of 26 October: raised and pressed surfaces, the 3:1 edges and the motion. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/18-soft-depth.css -->
207 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/19-touch.css`

Makes every control at least 44 pixels where the pointer is a finger. Walked through in [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/19-touch.css -->
78 lines, stylesheet part. Imported by 0 files.

Imports: none

Imported by: none

Tests that import it: none
<!-- /gen -->

### `web/src/styles/index.css`

Imports the parts in cascade order. Walked through in [Tests and checkers](tests-and-checkers.md), [Web app: the stylesheet](web-styles.md).

<!-- gen:card web/src/styles/index.css -->
28 lines, stylesheet part. Imported by 1 file.

Imports: none

Imported by: `main.tsx`

Tests that import it: none
<!-- /gen -->

## `web/src/types`

### `web/src/types/assistant.ts`

The shapes behind Explain and the Assistant. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/types/assistant.ts -->
46 lines, 5 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `ProblemExplanation` | interface | 3 | `interface ProblemExplanation` |  |
| `SlaExplanation` | interface | 10 | `interface SlaExplanation` |  |
| `ChatMessage` | interface | 20 | `interface ChatMessage` | Assistant (chat) |
| `ChatContext` | interface | 26 | `interface ChatContext` | What the model was shown for an answer: the BFF's `context` frame. |
| `ChatDone` | interface | 39 | `interface ChatDone` | The BFF's `done` frame for an answer. |

Imports: none

Imported by: `types/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/types/auth.ts`

The roles, who is signed in, and what the server says about itself. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/types/auth.ts -->
27 lines, 3 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Role` | type | 3 | `type Role = 'viewer' \| 'wall' \| 'operator' \| 'admin'` |  |
| `Me` | interface | 5 | `interface Me` |  |
| `Health` | interface | 15 | `interface Health` | GET /api/health: what the page needs to know about the server before anything else. |

Imports: none

Imported by: `types/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/types/dashboard.ts`

The shapes of what the Dashboard shows besides the problem list. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/types/dashboard.ts -->
85 lines, 8 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `TopHostRow` | interface | 4 | `interface TopHostRow` | The busiest hosts (GET /api/reports/top-hosts): the highest CPU and memory use now. |
| `TopHostsMetric` | interface | 14 | `interface TopHostsMetric` |  |
| `TopHostsResponse` | interface | 24 | `interface TopHostsResponse` |  |
| `WebFailure` | interface | 30 | `interface WebFailure` | Web monitoring (GET /api/reports/web-monitoring): every enabled web scenario as OK, failed or unknown. |
| `WebMonitoringResponse` | interface | 42 | `interface WebMonitoringResponse` |  |
| `Stats` | interface | 54 | `interface Stats` |  |
| `Freshness` | interface | 67 | `interface Freshness` | GET /api/freshness: when Zabbix last collected a value. |
| `GroupProblems` | interface | 80 | `interface GroupProblems` |  |

Imports: none

Imported by: `types/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/types/graphs.ts`

The shapes of the graph pipeline. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/types/graphs.ts -->
32 lines, 4 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `GraphPoint` | type | 4 | `type GraphPoint = [number, number \| null, number \| null, number \| null]` | [ms, avg, min, max], null avg marks a collection gap; min/max null for raw history. |
| `GraphSeries` | interface | 6 | `interface GraphSeries` |  |
| `GraphResponse` | interface | 19 | `interface GraphResponse` |  |
| `GraphRange` | type | 29 | `type GraphRange = \| { kind: 'hours'; hours: number } \| { kind: 'month'; month: string } \| { kind: 'custom'; from:...` | A graph window: a preset ending now, a calendar month, or a fixed from/to (epoch s). |

Imports: none

Imported by: `types/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/types/hosts.ts`

The shapes of hosts, devices and items. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/types/hosts.ts -->
97 lines, 13 exports. Imported by 3 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `HostInterface` | interface | 3 | `interface HostInterface` |  |
| `Host` | interface | 9 | `interface Host` |  |
| `SiteRef` | interface | 19 | `interface SiteRef` |  |
| `HostState` | type | 25 | `type HostState = 'up' \| 'down' \| 'degraded' \| 'nodata' \| 'disabled'` | One reachability state per host, ping first (server reachability.ts). |
| `StateReason` | type | 28 | `type StateReason = \| 'ping' \| 'interface' \| 'snmp-silent' \| 'agent-silent' \| 'stale' \| 'no-interface' \|...` | Where a host's state came from. |
| `HostOverview` | interface | 38 | `interface HostOverview extends Host` |  |
| `HostGroup` | interface | 44 | `interface HostGroup` |  |
| `DeviceKind` | type | 50 | `type DeviceKind = 'switch' \| 'firewall' \| 'access-point' \| 'repeater' \| 'server' \| 'wan-link' \| 'web' \| 'other'` | The kinds of device the portal tells apart (server naming.ts), in the order the Devices page lists them. |
| `Device` | interface | 53 | `interface Device extends HostOverview` | A host as the Devices page lists it: what the Hosts page shows, and the kind of device it is. |
| `DevicesResponse` | interface | 60 | `interface DevicesResponse` |  |
| `Item` | interface | 66 | `interface Item` |  |
| `LatestItem` | interface | 81 | `interface LatestItem extends Item` | An item with its newest value, which only /api/latest returns: Zabbix looks each one up on its own (tracker BK-25). |
| `LatestResponse` | interface | 89 | `interface LatestResponse` |  |

Imports: none

Imported by: `types/index.ts`, `types/network.ts`, `types/sla.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/types/index.ts`

Re-exports every shape so a page writes one import. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/types/index.ts -->
110 lines, 0 exports, 102 re-exports. Imported by 71 files.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Device` | re-export | 7 | `from './hosts'` |  |
| `DeviceKind` | re-export | 8 | `from './hosts'` |  |
| `DevicesResponse` | re-export | 9 | `from './hosts'` |  |
| `Host` | re-export | 10 | `from './hosts'` |  |
| `HostGroup` | re-export | 11 | `from './hosts'` |  |
| `HostInterface` | re-export | 12 | `from './hosts'` |  |
| `HostOverview` | re-export | 13 | `from './hosts'` |  |
| `HostState` | re-export | 14 | `from './hosts'` |  |
| `Item` | re-export | 15 | `from './hosts'` |  |
| `LatestItem` | re-export | 16 | `from './hosts'` |  |
| `LatestResponse` | re-export | 17 | `from './hosts'` |  |
| `SiteRef` | re-export | 18 | `from './hosts'` |  |
| `StateReason` | re-export | 19 | `from './hosts'` |  |
| `AcknowledgeResult` | re-export | 22 | `from './problems'` |  |
| `Problem` | re-export | 22 | `from './problems'` |  |
| `GraphPoint` | re-export | 24 | `from './graphs'` |  |
| `GraphRange` | re-export | 24 | `from './graphs'` |  |
| `GraphResponse` | re-export | 24 | `from './graphs'` |  |
| `GraphSeries` | re-export | 24 | `from './graphs'` |  |
| `IcmpState` | re-export | 27 | `from './network'` |  |
| `Link` | re-export | 28 | `from './network'` |  |
| `LinksResponse` | re-export | 29 | `from './network'` |  |
| `LinkState` | re-export | 30 | `from './network'` |  |
| `MapDetail` | re-export | 31 | `from './network'` |  |
| `MapLink` | re-export | 32 | `from './network'` |  |
| `MapSelement` | re-export | 33 | `from './network'` |  |
| `NetDevice` | re-export | 34 | `from './network'` |  |
| `NetInterface` | re-export | 35 | `from './network'` |  |
| `NetInterfacesResponse` | re-export | 36 | `from './network'` |  |
| `OperStatus` | re-export | 37 | `from './network'` |  |
| `Site` | re-export | 38 | `from './network'` |  |
| `SiteHost` | re-export | 39 | `from './network'` |  |
| `SiteSource` | re-export | 40 | `from './network'` |  |
| `SitesResponse` | re-export | 41 | `from './network'` |  |
| `ZMap` | re-export | 42 | `from './network'` |  |
| `Meter` | re-export | 45 | `from './meters'` |  |
| `MeterLevel` | re-export | 45 | `from './meters'` |  |
| `MeterLink` | re-export | 45 | `from './meters'` |  |
| `MeterOther` | re-export | 45 | `from './meters'` |  |
| `MetersResponse` | re-export | 45 | `from './meters'` |  |
| `MeterState` | re-export | 45 | `from './meters'` |  |
| `MeterZone` | re-export | 45 | `from './meters'` |  |
| `Freshness` | re-export | 48 | `from './dashboard'` |  |
| `GroupProblems` | re-export | 49 | `from './dashboard'` |  |
| `Stats` | re-export | 50 | `from './dashboard'` |  |
| `TopHostRow` | re-export | 51 | `from './dashboard'` |  |
| `TopHostsMetric` | re-export | 52 | `from './dashboard'` |  |
| `TopHostsResponse` | re-export | 53 | `from './dashboard'` |  |
| `WebFailure` | re-export | 54 | `from './dashboard'` |  |
| `WebMonitoringResponse` | re-export | 55 | `from './dashboard'` |  |
| `AgingReport` | re-export | 59 | `from './reports'` |  |
| `CapacityMetricKey` | re-export | 60 | `from './reports'` |  |
| `CapacityReport` | re-export | 61 | `from './reports'` |  |
| `CapacityRow` | re-export | 62 | `from './reports'` |  |
| `Dimension` | re-export | 63 | `from './reports'` |  |
| `DimensionKey` | re-export | 64 | `from './reports'` |  |
| `HostGap` | re-export | 65 | `from './reports'` |  |
| `NoiseFlag` | re-export | 66 | `from './reports'` |  |
| `NoiseReport` | re-export | 67 | `from './reports'` |  |
| `NoisyTrigger` | re-export | 68 | `from './reports'` |  |
| `ScorecardResponse` | re-export | 69 | `from './reports'` |  |
| `TopTrigger` | re-export | 70 | `from './reports'` |  |
| `TopTriggersReport` | re-export | 71 | `from './reports'` |  |
| `AvailabilityBasis` | re-export | 75 | `from './sla'` |  |
| `AvailabilityReport` | re-export | 76 | `from './sla'` |  |
| `DataStatus` | re-export | 77 | `from './sla'` |  |
| `DerivedKind` | re-export | 78 | `from './sla'` |  |
| `DerivedServiceNode` | re-export | 79 | `from './sla'` |  |
| `DerivedServicesResponse` | re-export | 80 | `from './sla'` |  |
| `DeletedRecipients` | re-export | 81 | `from './sla'` |  |
| `EmailInfo` | re-export | 82 | `from './sla'` |  |
| `EmailRequest` | re-export | 83 | `from './sla'` |  |
| `EmailSent` | re-export | 84 | `from './sla'` |  |
| `ReportFileFormat` | re-export | 85 | `from './sla'` |  |
| `ReportStyle` | re-export | 86 | `from './sla'` |  |
| `SavedRecipients` | re-export | 87 | `from './sla'` |  |
| `ScheduleInfo` | re-export | 88 | `from './sla'` |  |
| `ScheduleRequest` | re-export | 89 | `from './sla'` |  |
| `ScheduleSettings` | re-export | 90 | `from './sla'` |  |
| `SendRecord` | re-export | 91 | `from './sla'` |  |
| `HostAvailability` | re-export | 92 | `from './sla'` |  |
| `ServiceNode` | re-export | 93 | `from './sla'` |  |
| `ServiceSla` | re-export | 94 | `from './sla'` |  |
| `ServicesResponse` | re-export | 95 | `from './sla'` |  |
| `Sla` | re-export | 96 | `from './sla'` |  |
| `SlaSli` | re-export | 97 | `from './sla'` |  |
| `SlaSource` | re-export | 98 | `from './sla'` |  |
| `SliGap` | re-export | 99 | `from './sla'` |  |
| `SliGroup` | re-export | 100 | `from './sla'` |  |
| `SliHost` | re-export | 101 | `from './sla'` |  |
| `SliPath` | re-export | 102 | `from './sla'` |  |
| `SliProfile` | re-export | 103 | `from './sla'` |  |
| `SliReport` | re-export | 104 | `from './sla'` |  |
| `SliWeb` | re-export | 105 | `from './sla'` |  |
| `ChatContext` | re-export | 108 | `from './assistant'` |  |
| `ChatDone` | re-export | 108 | `from './assistant'` |  |
| `ChatMessage` | re-export | 108 | `from './assistant'` |  |
| `ProblemExplanation` | re-export | 108 | `from './assistant'` |  |
| `SlaExplanation` | re-export | 108 | `from './assistant'` |  |
| `Health` | re-export | 110 | `from './auth'` |  |
| `Me` | re-export | 110 | `from './auth'` |  |
| `Role` | re-export | 110 | `from './auth'` |  |

Imports: `types/assistant.ts`, `types/auth.ts`, `types/dashboard.ts`, `types/graphs.ts`, `types/hosts.ts`, `types/meters.ts`, `types/network.ts`, `types/problems.ts`, `types/reports.ts`, `types/sla.ts`

Imported by: `api/assistant.ts`, `api/dashboard.ts`, `api/graphs.ts`, `api/hosts.ts`, `api/meters.ts`, `api/network.ts`, `api/problems.ts`, `api/reports.ts`, `api/shell.ts`, `api/sla.ts`, `features/assistant/Assistant.tsx`, `features/assistant/ExplainPanel.tsx`, `features/dashboard/HostsView.tsx`, `features/dashboard/Overview.tsx`, and 57 more

Tests that import it: `__tests__/OperatorWording.test.tsx`, `__tests__/countPills.test.tsx`, `__tests__/guardedReads.test.tsx`, `__tests__/openapiTypes.test.ts`, `__tests__/pagePastEnd.test.tsx`, `__tests__/reportZoneUi.test.tsx`, `__tests__/sharedPages.test.tsx`, `__tests__/sharedPieces.test.tsx`, and 35 more
<!-- /gen -->

### `web/src/types/meters.ts`

The shapes of the internet traffic meters. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/types/meters.ts -->
70 lines, 7 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `MeterLevel` | type | 4 | `type MeterLevel = 'none' \| 'low' \| 'ok' \| 'warn' \| 'critical'` | What a zone's colour in Zabbix means; `none` is a grey or no colour. |
| `MeterState` | type | 6 | `type MeterState = 'ok' \| 'stale' \| 'nodata' \| 'unsupported' \| 'missing' \| 'invalid'` |  |
| `MeterZone` | interface | 8 | `interface MeterZone` |  |
| `MeterLink` | type | 15 | `type MeterLink = 'up' \| 'down' \| 'unknown'` | What the interface says about itself. |
| `MeterOther` | interface | 18 | `interface MeterOther` | The same interface the other way, on the gauge's own scale. |
| `Meter` | interface | 27 | `interface Meter` |  |
| `MetersResponse` | interface | 53 | `interface MetersResponse` |  |

Imports: none

Imported by: `types/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/types/network.ts`

The shapes of the network pages. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/types/network.ts -->
148 lines, 16 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `IcmpState` | type | 5 | `type IcmpState = 'up' \| 'down' \| 'unknown'` |  |
| `NetDevice` | interface | 7 | `interface NetDevice extends Host` |  |
| `OperStatus` | type | 12 | `type OperStatus = \| 'up' \| 'down' \| 'testing' \| 'unknown' \| 'dormant' \| 'notPresent' \| 'lowerLayerDown'` |  |
| `NetInterface` | interface | 21 | `interface NetInterface` |  |
| `NetInterfacesResponse` | interface | 38 | `interface NetInterfacesResponse` |  |
| `LinkState` | type | 47 | `type LinkState = 'up' \| 'degraded' \| 'down' \| 'unknown'` | Link & WAN health (Goal 3) |
| `Link` | interface | 49 | `interface Link` |  |
| `LinksResponse` | interface | 65 | `interface LinksResponse` |  |
| `ZMap` | interface | 72 | `interface ZMap` |  |
| `MapSelement` | interface | 79 | `interface MapSelement` |  |
| `MapLink` | interface | 94 | `interface MapLink` |  |
| `MapDetail` | interface | 101 | `interface MapDetail extends ZMap` |  |
| `SiteSource` | type | 107 | `type SiteSource = 'tag' \| 'name' \| 'inventory' \| 'group'` | Where a host's site name came from, weakest last. |
| `SiteHost` | interface | 109 | `interface SiteHost` |  |
| `Site` | interface | 123 | `interface Site` |  |
| `SitesResponse` | interface | 145 | `interface SitesResponse` |  |

Imports: `types/hosts.ts`

Imported by: `types/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/types/problems.ts`

The shapes of the problem list and the acknowledge answer. Walked through in [Web app: the API client, the types and the guards](web-api-types-guards.md).

<!-- gen:card web/src/types/problems.ts -->
28 lines, 2 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `Problem` | interface | 3 | `interface Problem` |  |
| `AcknowledgeResult` | interface | 23 | `interface AcknowledgeResult` | POST /api/problems/acknowledge: the answer of the portal's one write. |

Imports: none

Imported by: `types/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/types/reports.ts`

The shapes of the reports. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/types/reports.ts -->
116 lines, 13 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `TopTrigger` | interface | 3 | `interface TopTrigger` |  |
| `TopTriggersReport` | interface | 11 | `interface TopTriggersReport` |  |
| `DimensionKey` | type | 19 | `type DimensionKey = 'naming' \| 'site' \| 'owner' \| 'criticality'` | Inventory scorecard (Goal 1) |
| `Dimension` | interface | 21 | `interface Dimension` |  |
| `HostGap` | interface | 31 | `interface HostGap` |  |
| `ScorecardResponse` | interface | 39 | `interface ScorecardResponse` |  |
| `AgingReport` | interface | 46 | `interface AgingReport` |  |
| `CapacityRow` | interface | 60 | `interface CapacityRow` |  |
| `CapacityMetricKey` | type | 74 | `type CapacityMetricKey = 'cpu' \| 'memory' \| 'disk' \| 'ifutil'` | `ifutil` rows are one interface each: `name` is the port, avg/max in %. |
| `CapacityReport` | interface | 76 | `interface CapacityReport` |  |
| `NoiseFlag` | type | 82 | `type NoiseFlag = 'flapping' \| 'unactioned' \| 'chronic'` | Alert noise / flapping (Goal 4) |
| `NoisyTrigger` | interface | 84 | `interface NoisyTrigger` |  |
| `NoiseReport` | interface | 102 | `interface NoiseReport` |  |

Imports: none

Imported by: `types/index.ts`

Tests that import it: none
<!-- /gen -->

### `web/src/types/sla.ts`

The shapes of availability, SLA and the service trees. No chapter walks through it, so this card and the comment at the top of the file are its account.

<!-- gen:card web/src/types/sla.ts -->
338 lines, 31 exports. Imported by 1 file.

| Name | Kind | Line | Signature | What its comment says |
|---|---|---|---|---|
| `HostAvailability` | interface | 5 | `interface HostAvailability` |  |
| `AvailabilityBasis` | type | 19 | `type AvailabilityBasis = 'availability' \| 'all-problems'` |  |
| `AvailabilityReport` | interface | 21 | `interface AvailabilityReport` |  |
| `SliProfile` | type | 43 | `type SliProfile = 'availability' \| 'hcml-report'` | `availability` = strict (unreachable counts, gaps excluded); `hcml-report` = HCML's published method. |
| `DataStatus` | type | 45 | `type DataStatus = 'ok' \| 'partial' \| 'nodata'` |  |
| `SliGap` | interface | 47 | `interface SliGap` |  |
| `SliHost` | interface | 52 | `interface SliHost` |  |
| `SliGroup` | interface | 76 | `interface SliGroup` |  |
| `SliPath` | interface | 87 | `interface SliPath` |  |
| `SliWeb` | interface | 98 | `interface SliWeb` |  |
| `SliReport` | interface | 107 | `interface SliReport` |  |
| `ServiceSla` | interface | 139 | `interface ServiceSla` | Services tree (Zabbix Services, read-only) |
| `ServiceNode` | interface | 149 | `interface ServiceNode` |  |
| `ServicesResponse` | interface | 165 | `interface ServicesResponse` |  |
| `DerivedKind` | type | 173 | `type DerivedKind = 'root' \| 'business' \| 'site' \| 'class' \| 'wan-path' \| 'host' \| 'web'` | Services derived from the estate (server sli/tree.ts) when Zabbix has none. |
| `DerivedServiceNode` | interface | 175 | `interface DerivedServiceNode extends ServiceNode` |  |
| `DerivedServicesResponse` | interface | 183 | `interface DerivedServicesResponse extends ServicesResponse` |  |
| `SlaSource` | interface | 196 | `interface SlaSource` | Whether Zabbix's own SLAs have anything to show (/api/sla/source). |
| `ReportStyle` | interface | 203 | `interface ReportStyle` | How a report writes its numbers and dates, and what a CSV file puts between its fields. |
| `ReportFileFormat` | type | 210 | `type ReportFileFormat = 'pdf' \| 'xlsx' \| 'csv'` | The kinds of file the report comes in. |
| `EmailInfo` | interface | 213 | `interface EmailInfo` | GET /api/sli/email: whether the report can be emailed, from where, to whom unless told otherwise, and how far a list may go (administrators only). |
| `SavedRecipients` | interface | 227 | `interface SavedRecipients` | PUT /api/sli/recipients: the list the portal saved, and the list that applies now. |
| `DeletedRecipients` | interface | 233 | `interface DeletedRecipients` | DELETE /api/sli/recipients: the list that applies now (the one in MAIL_TO, or nobody), and how many addresses were removed. |
| `EmailRequest` | interface | 239 | `interface EmailRequest` | What POST /api/sli/email takes besides the month. |
| `EmailSent` | interface | 247 | `interface EmailSent` | POST /api/sli/email: how many recipients the mail server took the message for, how many it refused, and what went. |
| `ScheduleSettings` | interface | 257 | `interface ScheduleSettings` | The monthly send as it is set. |
| `SendRecord` | interface | 273 | `interface SendRecord` | One send the portal made, with counts and never an address. |
| `ScheduleInfo` | interface | 290 | `interface ScheduleInfo` | GET and PUT /api/sli/schedule (administrators only). |
| `ScheduleRequest` | interface | 308 | `interface ScheduleRequest` | What PUT /api/sli/schedule takes. |
| `Sla` | interface | 319 | `interface Sla` | Services → SLA (Zabbix-native, read-only) |
| `SlaSli` | interface | 329 | `interface SlaSli` |  |

Imports: `types/hosts.ts`

Imported by: `types/index.ts`

Tests that import it: none
<!-- /gen -->
