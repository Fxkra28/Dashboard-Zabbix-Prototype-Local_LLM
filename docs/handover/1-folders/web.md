# The web app

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators and developers | about 9 min | [The server](server.md) | [Tools, deploy and docs](tools-deploy-docs.md) |

The web app is what the browser runs: a React application written in TypeScript and built with Vite. It has 19 pages. In production it is a folder of static files that nginx serves; in development Vite serves it and passes every address that starts with `/bff` to a local server. It holds no secret and talks only to the server, never to Zabbix.

This page goes through `web/` folder by folder, in the same way as [the server](server.md).

## Beside the source

<!-- folder web -->
`web/` is a self-contained npm project with its own `package.json`, lockfile and `Dockerfile`. The code is in `src/`. The files beside it say how to build it, how to serve it and how to check it.

<!-- gen:files web -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`eslint.config.js`](../../../web/eslint.config.js) | 33 | 1 | The lint rules for the web app, including accessibility and hook rules. |
| [`vite.config.ts`](../../../web/vite.config.ts) | 33 | 1 | The build and dev-server settings, and the proxy to the server in development. |
| [`vitest.config.ts`](../../../web/vitest.config.ts) | 20 | 1 | The test settings: jsdom, the set-up file, and the stylesheet kept readable for the tests. |
<!-- /gen -->

| File | What it does |
|---|---|
| `package.json`, `package-lock.json` | The dependencies and the scripts: `dev` starts Vite, `build` typechecks and builds into `dist/`, `typecheck`, `lint` and `test` as in the server, and `gen:api` makes the types from the API description. |
| `index.html` | The one page. It loads `theme.js` first, so the chosen theme is on the page before anything is painted, then the app's entry. |
| `tsconfig.json` | Typechecks `src/` as a browser app with strict checking. The tests are left out of the build. |
| `tsconfig.node.json` | Typechecks `vite.config.ts` and writes its output under `node_modules/.tmp`, so it never sits beside the source. |
| `tsconfig.test.json` | Typechecks the tests. |
| `Dockerfile` | Two stages. The first installs from the lockfile and runs the build. The second is an unprivileged nginx that copies the build, `nginx.conf` and `bff-proxy.inc`, and listens on port 8080. |
| `.dockerignore` | Keeps the host's installed packages out of the image. They are built for the developer's machine and would replace the ones npm installs inside the image. |
| `nginx.conf` | Serves the build, passes `/bff` to the server, sets the security headers and the content-security policy, and sets how long each kind of request may take. |
| `bff-proxy.inc` | The proxy settings every `/bff` location shares: the rewrite, the headers the server trusts, and the request id. |

<!-- folder web/public -->
`public/` is served as it is from the site's root. It holds the logos, the two typefaces in `fonts/` with their licences, and `theme.js`. Fonts are served from here so that a visit fetches nothing from outside, which keeps the promise of the local-model copy that nothing leaves the machine.

<!-- gen:files web/public -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`theme.js`](../../../web/public/theme.js) | 8 | 0 | Sets the theme before the first paint, so there is no flash. |
<!-- /gen -->

<!-- folder web/brand -->
`brand/` keeps the original logo file the HCML marks were cut from. It is kept for where the marks came from. It is not served and not built.

<!-- folder web/scripts -->
`scripts/` holds the checks that belong to the web app: the stylesheet, the design tokens, the Assistant's markdown parser and the unit formatters, plus the two tools that write the generated files. `npm run check` at the root runs them.

<!-- gen:files web/scripts -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`css.check.mjs`](../../../web/scripts/css.check.mjs) | 110 | 1 | Checks the stylesheet is structurally sound. |
| [`markdown.check.ts`](../../../web/scripts/markdown.check.ts) | 93 | 0 | Assertions for the Assistant's markdown parser. |
| [`openapi-json.mjs`](../../../web/scripts/openapi-json.mjs) | 20 | 0 | Writes the API description as JSON beside the generated types, for the server's contract test. |
| [`tokens.check.mjs`](../../../web/scripts/tokens.check.mjs) | 705 | 16 | Re-derives the contrast of every token pair and fails on an illegible one. |
| [`tokens.export.mjs`](../../../web/scripts/tokens.export.mjs) | 248 | 1 | Writes the token files for design tools from the stylesheet. |
| [`units.check.ts`](../../../web/scripts/units.check.ts) | 107 | 1 | Assertions for the unit formatters, and a scan for percentages formatted by hand in a page. |
<!-- /gen -->

## The source

<!-- folder web/src -->
`src/` holds the application shell and eight folders. The root of `src/` keeps only what is not part of any one feature: the entry and the route table, and the colours the charts need. The rest is split by what it is for: the features, what they share, and the contract with the server. The dependencies run one way ([the repository map](repository-map.md) lists the rules).

<!-- gen:tree web/src depth=1 -->
```text
web/src/
├── __tests__/
├── api/        13 files
├── features/
├── generated/  2 files
├── guards/     13 files
├── shared/
├── styles/     21 files
└── types/      11 files
```
<!-- /gen -->

<!-- gen:files web/src -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`App.tsx`](../../../web/src/App.tsx) | 82 | 2 | The route table: every page is loaded on demand, and the sign-in page sits outside the shell. |
| [`main.tsx`](../../../web/src/main.tsx) | 17 | 0 | The entry: reloads on a stale chunk, asks the server for its time zone, then renders the app. |
| [`theme.ts`](../../../web/src/theme.ts) | 32 | 2 | The severity names and colours the canvas charts fall back to, because a canvas cannot read a stylesheet variable. |
| [`vite-env.d.ts`](../../../web/src/vite-env.d.ts) | 1 | 0 | Tells TypeScript about the types Vite adds. |
<!-- /gen -->

`api.test.ts` and `guards.test.ts` sit at the top of `src/` because they test the whole of the folder of the same name.

### The contract with the server

These three folders are at the root, not inside the features, because every feature may use them and the root may import no feature. Each is one file for each part of the portal behind an `index.ts`, so a page writes `import { api } from '../../api'` and a test that replaces that one module replaces everything the page calls.

<!-- folder web/src/api -->
`api/` is every call to the server. `client.ts` is the one place a request leaves the page: it sets the deadline, passes the abort signal that a page leaving cancels, notices a 401 and words a failure. `session.ts` handles sign-in, sign-out and renewal, and the header every POST carries. The other files are the calls, one file for each part of the portal.

<!-- gen:files web/src/api -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`assistant.ts`](../../../web/src/api/assistant.ts) | 99 | 4 | The calls behind Explain and the Assistant: two explanations, the streamed chat and its warm-up. |
| [`client.ts`](../../../web/src/api/client.ts) | 183 | 11 | The one place a request leaves the page: deadlines, the abort signal, the 401 handling and the failure message. |
| [`dashboard.ts`](../../../web/src/api/dashboard.ts) | 16 | 1 | The calls behind what the Dashboard shows besides the problem list. |
| [`graphs.ts`](../../../web/src/api/graphs.ts) | 22 | 1 | The call behind the Graphs page. |
| [`hosts.ts`](../../../web/src/api/hosts.ts) | 24 | 1 | The calls behind the Hosts, Devices and Latest data pages. |
| [`index.ts`](../../../web/src/api/index.ts) | 61 | 20 | Joins the per-feature calls into the one api object the pages import. |
| [`meters.ts`](../../../web/src/api/meters.ts) | 10 | 1 | The call behind the internet traffic meters. |
| [`network.ts`](../../../web/src/api/network.ts) | 22 | 1 | The calls behind the network pages: devices and interfaces, maps, sites and links. |
| [`problems.ts`](../../../web/src/api/problems.ts) | 21 | 2 | The problem list, the live stream's address and the portal's one write. |
| [`reports.ts`](../../../web/src/api/reports.ts) | 17 | 1 | The calls behind the reports. |
| [`session.ts`](../../../web/src/api/session.ts) | 226 | 13 | Sign-in, sign-out, session renewal, the cross-site header on every POST, and what happens when a session ends. |
| [`shell.ts`](../../../web/src/api/shell.ts) | 17 | 1 | The two calls the shell makes first: what the server says about itself and who is signed in. |
| [`sla.ts`](../../../web/src/api/sla.ts) | 123 | 5 | The calls behind availability and SLA, and the SLA report downloads. |
<!-- /gen -->

<!-- folder web/src/types -->
`types/` is the shape of every answer the server gives. A test holds these types to the API description, so a type cannot drift from the description of the route it comes from.

<!-- gen:files web/src/types -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`assistant.ts`](../../../web/src/types/assistant.ts) | 46 | 5 | The shapes behind Explain and the Assistant. |
| [`auth.ts`](../../../web/src/types/auth.ts) | 27 | 3 | The roles, who is signed in, and what the server says about itself. |
| [`dashboard.ts`](../../../web/src/types/dashboard.ts) | 85 | 8 | The shapes of what the Dashboard shows besides the problem list. |
| [`graphs.ts`](../../../web/src/types/graphs.ts) | 32 | 4 | The shapes of the graph pipeline. |
| [`hosts.ts`](../../../web/src/types/hosts.ts) | 97 | 13 | The shapes of hosts, devices and items. |
| [`index.ts`](../../../web/src/types/index.ts) | 110 | 102 | Re-exports every shape so a page writes one import. |
| [`meters.ts`](../../../web/src/types/meters.ts) | 70 | 7 | The shapes of the internet traffic meters. |
| [`network.ts`](../../../web/src/types/network.ts) | 148 | 16 | The shapes of the network pages. |
| [`problems.ts`](../../../web/src/types/problems.ts) | 28 | 2 | The shapes of the problem list and the acknowledge answer. |
| [`reports.ts`](../../../web/src/types/reports.ts) | 116 | 13 | The shapes of the reports. |
| [`sla.ts`](../../../web/src/types/sla.ts) | 338 | 31 | The shapes of availability, SLA and the service trees. |
<!-- /gen -->

<!-- folder web/src/guards -->
`guards/` checks an answer at run time before a page relies on it. A type says what the server promised; a guard looks at what arrived, and a page that gets something else shows one plain message instead of failing in the middle of a table. `shape.ts` holds the building blocks and `misfit.ts` the message.

<!-- gen:files web/src/guards -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`assistant.ts`](../../../web/src/guards/assistant.ts) | 19 | 2 | The checks for the Explain answers. |
| [`auth.ts`](../../../web/src/guards/auth.ts) | 14 | 1 | The check for who is signed in. |
| [`dashboard.ts`](../../../web/src/guards/dashboard.ts) | 59 | 5 | The checks for what the Dashboard shows besides the problem list. |
| [`graphs.ts`](../../../web/src/guards/graphs.ts) | 42 | 1 | The check for a graph. |
| [`hosts.ts`](../../../web/src/guards/hosts.ts) | 88 | 9 | The checks for hosts, devices and items. |
| [`index.ts`](../../../web/src/guards/index.ts) | 41 | 45 | Joins the per-feature checks behind one import. |
| [`meters.ts`](../../../web/src/guards/meters.ts) | 57 | 1 | The check for the internet traffic meters. |
| [`misfit.ts`](../../../web/src/guards/misfit.ts) | 41 | 4 | What happens when an answer fails its check: the message a page shows and the console line. |
| [`network.ts`](../../../web/src/guards/network.ts) | 134 | 6 | The checks for the network pages. |
| [`problems.ts`](../../../web/src/guards/problems.ts) | 25 | 1 | The check for the problem list, which the live frames pass through too. |
| [`reports.ts`](../../../web/src/guards/reports.ts) | 90 | 5 | The checks for the reports. |
| [`shape.ts`](../../../web/src/guards/shape.ts) | 109 | 17 | The building blocks of a check: text, number, flag, list and object shapes. |
| [`sla.ts`](../../../web/src/guards/sla.ts) | 248 | 12 | The checks for availability and SLA. |
<!-- /gen -->

<!-- folder web/src/generated -->
`generated/` holds the types that `npm run gen:api` makes from `docs/api/openapi.yaml`, and the description as JSON for the server's contract test. Nothing in it is edited by hand, and the linter skips it.

<!-- gen:files web/src/generated -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`openapi.ts`](../../../web/src/generated/openapi.ts) | 4566 | 5 | Types made from the API description by a tool; never edited by hand. |
<!-- /gen -->

### The features

<!-- folder web/src/features -->
`features/` has one folder for each part of the portal, with its pages, components, hooks, logic and tests together. A feature may import another only where `layering.test.ts` allows it. The pages are loaded on demand, so opening the Dashboard does not download the charting library.

<!-- gen:tree web/src/features depth=1 -->
```text
web/src/features/
├── assistant/  8 files
├── auth/       1 file
├── dashboard/  9 files
├── graphs/     9 files
├── hosts/      5 files
├── meters/     4 files
├── network/    5 files
├── problems/   6 files
├── reports/    4 files
├── shell/      11 files
└── sla/        15 files
```
<!-- /gen -->

| Feature | Pages | May use |
|---|---|---|
| assistant | The Assistant, and the Explain panel that opens from a problem or an SLA figure | none |
| auth | The sign-in page | none |
| dashboard | The Dashboard | hosts, meters, problems, shell |
| graphs | Graphs | none |
| hosts | Hosts, Devices, Latest data | none |
| meters | The internet traffic meters, shown on the Dashboard | none |
| network | Sites, Maps, Network, Links | graphs, hosts |
| problems | Problems, and the acknowledge dialog | assistant |
| reports | Capacity, Alert noise, Top triggers, Inventory | none |
| shell | The frame around every page, and the page for an address that is not a page | assistant |
| sla | Services, SLA, Availability | assistant |

#### assistant

<!-- folder web/src/features/assistant -->
Everything that talks to the model. The Assistant page takes a free question and shows the answer as it is written. The Explain panel is a slide-over that translates one problem or one SLA figure. `parseMarkdown.ts` reads the answer into a small set of blocks and refuses anything that could carry a link or a script. `useAi.ts` asks the server once what it can do, which includes the reporting time zone, and shares the answer.

<!-- gen:files web/src/features/assistant -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`AiDataNotice.tsx`](../../../web/src/features/assistant/AiDataNotice.tsx) | 18 | 1 | Says next to an AI answer whether the question left this machine. |
| [`Assistant.tsx`](../../../web/src/features/assistant/Assistant.tsx) | 316 | 2 | The Assistant page: free-form questions about the estate, answered as they are written. |
| [`ExplainPanel.tsx`](../../../web/src/features/assistant/ExplainPanel.tsx) | 258 | 3 | The slide-over that explains one problem or one SLA figure in plain words. |
| [`Markdown.tsx`](../../../web/src/features/assistant/Markdown.tsx) | 81 | 1 | Draws the small slice of markdown the Assistant may write. |
| [`ModelOfflineNotice.tsx`](../../../web/src/features/assistant/ModelOfflineNotice.tsx) | 15 | 1 | Says so when the AI model is not answering, before a click that would only fail. |
| [`parseMarkdown.ts`](../../../web/src/features/assistant/parseMarkdown.ts) | 155 | 4 | Reads the assistant's markdown into blocks and inline pieces, allowing nothing that could carry a link or a script. |
| [`useAi.ts`](../../../web/src/features/assistant/useAi.ts) | 98 | 3 | Asks the server once what it can do (AI on or off, its time zone) and shares the answer. |
| [`useModel.ts`](../../../web/src/features/assistant/useModel.ts) | 27 | 1 | Whether the AI model is known not to answer. |
<!-- /gen -->

#### auth

<!-- folder web/src/features/auth -->
The sign-in page, the only page outside the shell. After signing in it returns to the page the session ended on, but only to a path on this site.

<!-- gen:files web/src/features/auth -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`Login.tsx`](../../../web/src/features/auth/Login.tsx) | 106 | 2 | The sign-in page, and the safe path to return to afterwards. |
<!-- /gen -->

#### dashboard

<!-- folder web/src/features/dashboard -->
The first page. It shows the counts and the live problem list, with tabs for the internet traffic meters and the Hosts view. The same page is the wall screen: in wall mode it drops the sidebar, enlarges the type, turns through its slides and fits itself to the window, because a wall cannot be scrolled.

<!-- gen:files web/src/features/dashboard -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`HostsView.tsx`](../../../web/src/features/dashboard/HostsView.tsx) | 150 | 1 | The Dashboard's Hosts view: availability, device kinds, web monitoring and the busiest hosts. |
| [`Overview.tsx`](../../../web/src/features/dashboard/Overview.tsx) | 441 | 1 | The Dashboard: the counts and live problem list, with tabs for the internet meters and the Hosts view, in normal or wall mode. |
| [`Tabs.tsx`](../../../web/src/features/dashboard/Tabs.tsx) | 65 | 3 | The accessible tabs pattern used by the Dashboard and the SLA page. |
| [`fit.ts`](../../../web/src/features/dashboard/fit.ts) | 42 | 4 | The scale that makes a wall screen's content fit its window. |
| [`hostsFigures.ts`](../../../web/src/features/dashboard/hostsFigures.ts) | 56 | 12 | Host availability and usage words, as the Zabbix widgets count and name them. |
| [`liveList.ts`](../../../web/src/features/dashboard/liveList.ts) | 32 | 4 | Which problems the Dashboard's live list shows, worst first. |
| [`useFitHeight.ts`](../../../web/src/features/dashboard/useFitHeight.ts) | 66 | 1 | Draws the wall's content at the scale that fits and sizes its box to match. |
| [`useHostsView.ts`](../../../web/src/features/dashboard/useHostsView.ts) | 16 | 2 | Loads what the Hosts view needs in one place. |
| [`useWallRotation.ts`](../../../web/src/features/dashboard/useWallRotation.ts) | 22 | 1 | Turns through the wall's slides, a few seconds on each. |
<!-- /gen -->

#### graphs

<!-- folder web/src/features/graphs -->
One host, up to four of its items, any range. The chart is drawn with ECharts on a canvas, so it reads its colours from the stylesheet and redraws when the theme changes. Show data lists the same points as a table, and the same rows can be downloaded as a CSV file.

<!-- gen:files web/src/features/graphs -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`HostDetail.tsx`](../../../web/src/features/graphs/HostDetail.tsx) | 177 | 1 | The Graphs page: one host, up to four items, any range. |
| [`ItemPicker.tsx`](../../../web/src/features/graphs/ItemPicker.tsx) | 266 | 1 | A searchable, grouped picker for the items of one host. |
| [`RangePicker.tsx`](../../../web/src/features/graphs/RangePicker.tsx) | 165 | 5 | The time range: presets, a custom range and a live range, kept in the address. |
| [`StaleNote.tsx`](../../../web/src/features/graphs/StaleNote.tsx) | 58 | 1 | Says so when a graph is thinner or older than it looks. |
| [`TimeSeriesChart.tsx`](../../../web/src/features/graphs/TimeSeriesChart.tsx) | 516 | 3 | The chart: draws the series with ECharts, with its tooltip and the Show data table. |
| [`chartCsv.ts`](../../../web/src/features/graphs/chartCsv.ts) | 37 | 2 | The Show data table as rows for a CSV file. |
| [`chartTable.ts`](../../../web/src/features/graphs/chartTable.ts) | 47 | 4 | The Show data table: the series joined on time. |
| [`unitScales.ts`](../../../web/src/features/graphs/unitScales.ts) | 5 | 2 | The most kinds of unit one graph holds, two, and how a list of units is counted. |
| [`useThemeChange.ts`](../../../web/src/features/graphs/useThemeChange.ts) | 18 | 1 | Redraws when the theme changes, because a canvas cannot follow a CSS variable. |
<!-- /gen -->

#### hosts

<!-- folder web/src/features/hosts -->
The pages that list machines: Hosts, Devices (a tile for each kind of device) and Latest data (pick a host, see every item's newest value).

<!-- gen:files web/src/features/hosts -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`Devices.tsx`](../../../web/src/features/hosts/Devices.tsx) | 126 | 1 | The Devices page: a tile for each kind of device, and the hosts of the chosen kind. |
| [`HostTable.tsx`](../../../web/src/features/hosts/HostTable.tsx) | 116 | 2 | A host as the Hosts page and a site list it. |
| [`Hosts.tsx`](../../../web/src/features/hosts/Hosts.tsx) | 63 | 1 | The Hosts page. |
| [`LatestData.tsx`](../../../web/src/features/hosts/LatestData.tsx) | 262 | 1 | The Latest data page: pick a host and see every item's latest value. |
| [`deviceTally.ts`](../../../web/src/features/hosts/deviceTally.ts) | 21 | 3 | What a kind of device adds up to: how many, how many in trouble, how many silent. |
<!-- /gen -->

#### meters

<!-- folder web/src/features/meters -->
The internet traffic meters: one dial for each gauge widget of the Zabbix dashboard HCML already keeps. The dial is drawn from numbers and words in `gaugeDial.ts`. The Dashboard holds the request so that its card, its tab and the wall show the same reading.

<!-- gen:files web/src/features/meters -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`Gauge.tsx`](../../../web/src/features/meters/Gauge.tsx) | 115 | 1 | One internet traffic meter, drawn as a dial. |
| [`InternetMeters.tsx`](../../../web/src/features/meters/InternetMeters.tsx) | 55 | 1 | The meters: one gauge for each gauge widget of the Zabbix dashboard. |
| [`gaugeDial.ts`](../../../web/src/features/meters/gaugeDial.ts) | 177 | 17 | The dial as numbers and words: arcs, ticks and the reading. |
| [`useMeters.ts`](../../../web/src/features/meters/useMeters.ts) | 17 | 2 | Asks for the meters once a minute. |
<!-- /gen -->

#### network

<!-- folder web/src/features/network -->
The pages about places and links: Sites (a card for each site), Maps (Zabbix maps drawn in the page), Network (devices grouped by site, with their interfaces) and Links (WAN paths and their health).

<!-- gen:files web/src/features/network -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`Links.tsx`](../../../web/src/features/network/Links.tsx) | 268 | 1 | The Links and WAN health page. |
| [`Maps.tsx`](../../../web/src/features/network/Maps.tsx) | 285 | 1 | The Maps page: the list of Zabbix maps and the topology of the chosen one. |
| [`Network.tsx`](../../../web/src/features/network/Network.tsx) | 370 | 1 | The Network page: devices grouped by site, with their interfaces. |
| [`Sites.tsx`](../../../web/src/features/network/Sites.tsx) | 220 | 1 | The Sites page: a card for each site with its worst problem. |
| [`mapLabels.ts`](../../../web/src/features/network/mapLabels.ts) | 138 | 10 | Where each element's name goes on a map, kept inside the map. |
<!-- /gen -->

#### problems

<!-- folder web/src/features/problems -->
The Problems page: filters, the table, live updates from the stream, Explain, and the dialog that acknowledges or closes a problem, which is the portal's only write. A row that appears or clears is marked for a few seconds, which is what the wall screen's highlight uses.

<!-- gen:files web/src/features/problems -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`AckDialog.tsx`](../../../web/src/features/problems/AckDialog.tsx) | 210 | 1 | The acknowledge and close dialog: the portal's only write. |
| [`AckPill.tsx`](../../../web/src/features/problems/AckPill.tsx) | 4 | 1 | Whether a problem has been acknowledged. |
| [`Problems.tsx`](../../../web/src/features/problems/Problems.tsx) | 412 | 1 | The Problems page: filters, the table, live updates and Explain. |
| [`ProblemsTable.tsx`](../../../web/src/features/problems/ProblemsTable.tsx) | 62 | 1 | The problem table, with rows marked when they appear or clear. |
| [`liveChange.ts`](../../../web/src/features/problems/liveChange.ts) | 13 | 1 | What a live frame says about the list, as one comparable string. |
| [`useChangeHighlight.ts`](../../../web/src/features/problems/useChangeHighlight.ts) | 109 | 4 | How long a new problem stays marked and a cleared one stays on screen. |
<!-- /gen -->

#### reports

<!-- folder web/src/features/reports -->
The four report pages under `/reports` that need no month: Capacity trends, Alert noise, Top triggers and the Inventory scorecard, which only admins see. The availability report is in `sla/`.

<!-- gen:files web/src/features/reports -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`AlertNoise.tsx`](../../../web/src/features/reports/AlertNoise.tsx) | 276 | 1 | The alert-noise report page. |
| [`Capacity.tsx`](../../../web/src/features/reports/Capacity.tsx) | 190 | 1 | The capacity trends page. |
| [`Inventory.tsx`](../../../web/src/features/reports/Inventory.tsx) | 235 | 1 | The inventory and ownership scorecard page, for admins. |
| [`TopTriggers.tsx`](../../../web/src/features/reports/TopTriggers.tsx) | 95 | 1 | The top 100 triggers page. |
<!-- /gen -->

#### shell

<!-- folder web/src/features/shell -->
The frame around every page: the sidebar, the top bar, the page title, the error boundary, the wall mode, the saved preferences and the session renewal that keeps an open page signed in. The sidebar shows only the pages the signed-in role can reach, though the server refuses the rest anyway.

<!-- gen:files web/src/features/shell -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`ErrorBoundary.tsx`](../../../web/src/features/shell/ErrorBoundary.tsx) | 75 | 2 | Catches a page that throws and reloads once when an old page asks for a chunk that is gone. |
| [`Layout.tsx`](../../../web/src/features/shell/Layout.tsx) | 140 | 3 | The shell around every page: sidebar, top bar, the page title and the Outlet. |
| [`NotFound.tsx`](../../../web/src/features/shell/NotFound.tsx) | 15 | 1 | The page for an address that is not a page. |
| [`Sidebar.tsx`](../../../web/src/features/shell/Sidebar.tsx) | 197 | 2 | The grouped menu, filtered by the role, with the build in its footer. |
| [`TodayDate.tsx`](../../../web/src/features/shell/TodayDate.tsx) | 10 | 1 | Today's date, re-read every minute. |
| [`build.ts`](../../../web/src/features/shell/build.ts) | 24 | 2 | Turns the build the server reports into the footer label. |
| [`useBuild.ts`](../../../web/src/features/shell/useBuild.ts) | 28 | 1 | Asks the server which build it runs. |
| [`usePageTitle.ts`](../../../web/src/features/shell/usePageTitle.ts) | 18 | 2 | Names the browser tab after the page. |
| [`useSessionRenewal.ts`](../../../web/src/features/shell/useSessionRenewal.ts) | 95 | 1 | Keeps an open page signed in for as long as it stays open. |
| [`useUiPrefs.ts`](../../../web/src/features/shell/useUiPrefs.ts) | 116 | 6 | The theme, the narrow-screen rule and the collapsed sidebar, kept in the browser. |
| [`useWallMode.ts`](../../../web/src/features/shell/useWallMode.ts) | 54 | 1 | The wall mode: no sidebar, larger type, a clock and the age of the data. |
<!-- /gen -->

#### sla

<!-- folder web/src/features/sla -->
The service and availability pages: the service tree, the SLA page with Zabbix's own SLA objects and the derived monthly figure, and the availability and response report. `Sli.tsx` holds the pieces they share, and `ReportDownload.tsx` the buttons that download the month as PDF or Excel.

<!-- gen:files web/src/features/sla -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`Availability.tsx`](../../../web/src/features/sla/Availability.tsx) | 432 | 1 | The availability and response report page. |
| [`EmailReport.tsx`](../../../web/src/features/sla/EmailReport.tsx) | 307 | 2 | The button and dialog that email a month's report to the people in the settings. |
| [`FileChoices.tsx`](../../../web/src/features/sla/FileChoices.tsx) | 41 | 3 | The tick boxes for the kinds of file a report comes in. |
| [`ReportDialog.tsx`](../../../web/src/features/sla/ReportDialog.tsx) | 87 | 3 | The frame the report dialogs share. |
| [`ReportDownload.tsx`](../../../web/src/features/sla/ReportDownload.tsx) | 162 | 5 | The buttons that download a month's SLA report as PDF, Excel or CSV. |
| [`ReportSchedule.tsx`](../../../web/src/features/sla/ReportSchedule.tsx) | 327 | 2 | The Schedule button and its dialog for the monthly send. |
| [`ReportStyleButton.tsx`](../../../web/src/features/sla/ReportStyleButton.tsx) | 51 | 1 | The button and dialog that choose how a report writes numbers and dates. |
| [`SavedList.tsx`](../../../web/src/features/sla/SavedList.tsx) | 221 | 1 | The saved list of people, in the Email and Schedule dialogs: remove one, add one, delete the list. |
| [`Services.tsx`](../../../web/src/features/sla/Services.tsx) | 449 | 1 | The service tree page. |
| [`Sla.tsx`](../../../web/src/features/sla/Sla.tsx) | 846 | 1 | The SLA page: Zabbix's SLA objects and the derived monthly figure, in tabs. |
| [`Sli.tsx`](../../../web/src/features/sla/Sli.tsx) | 203 | 14 | Small shared pieces of the derived SLA views: the month picker, pills and notes. |
| [`StyleFields.tsx`](../../../web/src/features/sla/StyleFields.tsx) | 56 | 1 | The three style choices as selects with an example of each. |
| [`addresses.ts`](../../../web/src/features/sla/addresses.ts) | 20 | 5 | Small helpers for a box of addresses and a list in a sentence. |
| [`percent.ts`](../../../web/src/features/sla/percent.ts) | 16 | 1 | Prints a percentage without rounding a miss up to the target. |
| [`reportStyle.ts`](../../../web/src/features/sla/reportStyle.ts) | 62 | 8 | The report style choices and the person's own, kept in this browser. |
<!-- /gen -->

### What the features share

<!-- folder web/src/shared -->
`shared/` holds what two or more features use. It imports no feature. It has three folders.

<!-- folder web/src/shared/components -->
`components/` are pieces of screen: the logo, a figure card, status pills, a table that scrolls with a tab stop, the loading, error, empty and stale-copy states, and the icons.

<!-- gen:files web/src/shared/components -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`BrandMark.tsx`](../../../web/src/shared/components/BrandMark.tsx) | 55 | 1 | The HCML logo. |
| [`CollectorNotice.tsx`](../../../web/src/shared/components/CollectorNotice.tsx) | 33 | 2 | Says when Zabbix still answers but almost no device does, which means its way into the network is cut. |
| [`Field.tsx`](../../../web/src/shared/components/Field.tsx) | 31 | 3 | One cell of a controls row: a label above its control. |
| [`KpiCard.tsx`](../../../web/src/shared/components/KpiCard.tsx) | 21 | 1 | A figure card, with a stripe only when a state sets one. |
| [`NoData.tsx`](../../../web/src/shared/components/NoData.tsx) | 18 | 2 | The placeholder for no value, spoken as words by a screen reader. |
| [`Pager.tsx`](../../../web/src/shared/components/Pager.tsx) | 26 | 1 | Previous and Next around a line saying where the list stands. |
| [`StatusBadge.tsx`](../../../web/src/shared/components/StatusBadge.tsx) | 93 | 5 | The severity, up/down, availability and host-state pills. |
| [`TableWrap.tsx`](../../../web/src/shared/components/TableWrap.tsx) | 51 | 1 | The box that lets a wide table scroll, with a tab stop and a name. |
| [`icons.tsx`](../../../web/src/shared/components/icons.tsx) | 145 | 16 | The menu and page icons, drawn inline. |
| [`states.tsx`](../../../web/src/shared/components/states.tsx) | 169 | 7 | Loading, error, empty and stale-copy states, and the Async wrapper that shows them. |
<!-- /gen -->

<!-- folder web/src/shared/hooks -->
`hooks/` are pieces of behaviour: fetching with loading and error state, who is signed in, the live stream, the address as state, focus in a dialog, and a clock that moves on its own.

<!-- gen:files web/src/shared/hooks -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`scrollLock.ts`](../../../web/src/shared/hooks/scrollLock.ts) | 28 | 1 | Keeps the page behind a dialog from scrolling, counted for dialogs open together. |
| [`useAsync.ts`](../../../web/src/shared/hooks/useAsync.ts) | 162 | 1 | Fetch with loading and error state, an abort on leave, and optional polling. |
| [`useAuth.ts`](../../../web/src/shared/hooks/useAuth.ts) | 79 | 3 | Who is signed in and what they may see, from one shared probe. |
| [`useDebounced.ts`](../../../web/src/shared/hooks/useDebounced.ts) | 11 | 1 | A value once it has stopped changing. |
| [`useDialogFocus.ts`](../../../web/src/shared/hooks/useDialogFocus.ts) | 96 | 2 | Moves focus into a dialog and back when it closes. |
| [`useNow.ts`](../../../web/src/shared/hooks/useNow.ts) | 11 | 1 | The current time, re-read on an interval. |
| [`useReportTimeZone.ts`](../../../web/src/shared/hooks/useReportTimeZone.ts) | 7 | 1 | The reporting time zone, re-rendering when the server's answer changes it. |
| [`useSSE.ts`](../../../web/src/shared/hooks/useSSE.ts) | 187 | 2 | The live stream: connects, reads frames, and treats three missed pings as a dead line. |
| [`useUrlState.ts`](../../../web/src/shared/hooks/useUrlState.ts) | 98 | 2 | Reads and changes query-string parameters in place. |
<!-- /gen -->

<!-- folder web/src/shared/lib -->
`lib/` is plain logic with no screen: severity and time words, units, the CSV writer, how old the data is, the site-naming rules the browser needs a copy of, what the wall shows, and where the Assistant conversation is kept.

<!-- gen:files web/src/shared/lib -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`chatStore.ts`](../../../web/src/shared/lib/chatStore.ts) | 52 | 5 | Where this tab keeps the Assistant conversation. |
| [`csv.ts`](../../../web/src/shared/lib/csv.ts) | 26 | 3 | The one CSV writer, with its guard against spreadsheet formulas. |
| [`freshness.ts`](../../../web/src/shared/lib/freshness.ts) | 67 | 6 | How old the numbers on a page are, when the server says so. |
| [`plural.ts`](../../../web/src/shared/lib/plural.ts) | 2 | 1 | A count with its noun. |
| [`saveFile.ts`](../../../web/src/shared/lib/saveFile.ts) | 15 | 2 | Saves a file the page built, through a throwaway link, and keeps its address long enough for the browser to finish. |
| [`severity.ts`](../../../web/src/shared/lib/severity.ts) | 125 | 10 | Severity names, times, ages, durations and availability text. |
| [`sites.ts`](../../../web/src/shared/lib/sites.ts) | 84 | 5 | The browser's copy of the site-naming rules. |
| [`time.ts`](../../../web/src/shared/lib/time.ts) | 269 | 24 | Dates and months in HCML's reporting time zone. |
| [`units.ts`](../../../web/src/shared/lib/units.ts) | 161 | 8 | Zabbix units turned into human text. |
| [`wall.ts`](../../../web/src/shared/lib/wall.ts) | 83 | 12 | What the wall shows, in turn. |
<!-- /gen -->

### The stylesheet

<!-- folder web/src/styles -->
`styles/` is one stylesheet cut into numbered parts. Their order is the cascade: `index.css` lists them, a rule that must beat an earlier one stays after it, and a new rule goes into the part it belongs to. Part 01 holds the design tokens, for the light and the dark theme, and a script re-derives the contrast of every pair of them on each run.

<!-- gen:files web/src/styles -->
| File | Lines | Exports | What it is |
|---|---|---|---|
| [`00-fonts.css`](../../../web/src/styles/00-fonts.css) | 80 |  | The two typefaces, served from this site so nothing is fetched from outside. |
| [`01-tokens.css`](../../../web/src/styles/01-tokens.css) | 337 |  | The design tokens: colours, spacing, type, radii and motion, for light and dark. |
| [`02-base.css`](../../../web/src/styles/02-base.css) | 51 |  | The reset and the one visible focus ring. |
| [`03-shell.css`](../../../web/src/styles/03-shell.css) | 100 |  | The page grid: sidebar, top bar and content. |
| [`04-login.css`](../../../web/src/styles/04-login.css) | 85 |  | The sign-in card. |
| [`05-layout-chips-tags.css`](../../../web/src/styles/05-layout-chips-tags.css) | 125 |  | The two-column layout, severity chips, problem tags and the skip link. |
| [`06-cards-tables-badges.css`](../../../web/src/styles/06-cards-tables-badges.css) | 146 |  | Panels, figure cards, tables and pills. |
| [`07-controls-states.css`](../../../web/src/styles/07-controls-states.css) | 236 |  | Buttons, fields, filters and the loading, error and empty states. |
| [`08-explain-modal-notices.css`](../../../web/src/styles/08-explain-modal-notices.css) | 363 |  | The login wrapper, the Explain slide-over, modal dialogs, notices and the role chip. |
| [`09-reports-sites.css`](../../../web/src/styles/09-reports-sites.css) | 446 |  | The scorecard, alert-noise flags, links, ageing, the service tree and the site cards. |
| [`10-assistant.css`](../../../web/src/styles/10-assistant.css) | 145 |  | The Assistant's chat. |
| [`11-graphs-network.css`](../../../web/src/styles/11-graphs-network.css) | 345 |  | The Graphs, Latest data and Network pages. |
| [`12-sla-services-links.css`](../../../web/src/styles/12-sla-services-links.css) | 212 |  | The SLA, services, availability, capacity, sites and links pages. |
| [`13-second-pass.css`](../../../web/src/styles/13-second-pass.css) | 123 |  | Fixes found on the second pass: freshness, errors, links in tables, focus and a few page details. |
| [`14-sidebar-wall.css`](../../../web/src/styles/14-sidebar-wall.css) | 243 |  | The collapsible sidebar, the theme picker and the wall mode. |
| [`15-report-download.css`](../../../web/src/styles/15-report-download.css) | 42 |  | The SLA download buttons. |
| [`16-meters.css`](../../../web/src/styles/16-meters.css) | 222 |  | The Dashboard's tabs and the internet traffic meters. |
| [`17-hosts-devices.css`](../../../web/src/styles/17-hosts-devices.css) | 176 |  | The Dashboard's Hosts view. |
| [`18-soft-depth.css`](../../../web/src/styles/18-soft-depth.css) | 208 |  | The soft look of 26 October: raised and pressed surfaces, the 3:1 edges and the motion. |
| [`19-touch.css`](../../../web/src/styles/19-touch.css) | 90 |  | Makes every control at least 44 pixels where the pointer is a finger. |
| [`index.css`](../../../web/src/styles/index.css) | 28 |  | Imports the parts in cascade order. |
<!-- /gen -->

### The tests

<!-- folder web/src/__tests__ -->
A test sits beside the file it tests, named for it, such as `Sidebar.tsx` and `Sidebar.test.tsx`. This folder holds the ones that cut across features: the routes, back and forward, the narrow screen, the markup, the wording, the layering rules, the stylesheet, and the check that the types follow the API description. It also holds the fixtures (`hosts.ts`, `meters.ts`, `problems.ts`) and the set-up file.
