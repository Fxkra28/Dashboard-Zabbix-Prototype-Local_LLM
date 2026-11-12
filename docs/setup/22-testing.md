# 22. Testing

[setup.md](../../setup.md) · previous: [§21](21-alert-noise-flapping.md) · next: [§23](23-hardening-timeouts-rate-limiting-headers.md)

`cd server && npm test`, 3097 tests in 122 files, no live Zabbix required. `cd web && npm test`, 1844 tests in 119 files, in jsdom.

The mock point. Every Zabbix call in the server funnels through one `fetch` in
[`zabbix.ts`](../../server/src/clients/zabbix.ts), exposed as `zbx()` and `zbxWrite()`. Mocking that single module
covers all 24 route modules and the services behind them, so route tests drive the real handlers, the real cache and the
real error mapping, only the network is fake.

```ts
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock, zbxWrite: zbxWriteMock };
});
```

The spread of `actual` matters: `errors.ts` branches on `instanceof ZabbixAuthError`, so a stubbed
error class would make every failure-mode assertion pass for the wrong reason.

Route modules all have the plugin signature `(app: FastifyInstance) => Promise<void>`, so each
mounts on a bare Fastify instance and is driven with `app.inject()`: no listening socket.

What is tested, and why those things. The suite is weighted toward code that fails *silently*
with a plausible wrong answer, not code that throws:

| Area | The failure it guards against |
|---|---|
| `mergedSeconds()` | Two triggers on one host counted as two outages, availability could compute as negative |
| `requiredRole()` table | A regex typo silently downgrading an admin route to `viewer`. No error, no log line |
| `cache.ts` | Losing in-flight coalescing: ten NOC screens become ten times the Zabbix load |
| `HOST_NAME_PATTERN` | The invented pattern that matched zero real HCML hosts and would have scored their estate at 0% |
| `severitiesAtLeast()` | An empty `severities` array, which makes Zabbix return nothing: a bad parameter becoming an empty report |
| API surface snapshot | A route added or renamed without a matching RBAC rule |
| The report files (`export-*.test.ts`) | A PDF or workbook a reader refuses, a device named `=HYPERLINK(...)` that Excel would evaluate, and a copied colour, logo or sentence drifting from the web app's |
| Failure modes | A typed 503 swallowing a genuine 500, or vice versa |
| The web's types against the API contract (`openapiTypes.test.ts`) | A field the page needs that `docs/api/openapi.yaml` does not promise, or a kind the page cannot hold. The first run found 20 of the 36 answers the app reads disagreeing with the file: a site code typed as text, the SLA groups and hosts described as the availability rows, an interface row nobody sends, a map described as a list of its elements. The comparison is made by the compiler (`npm run typecheck`, one way, from what the file says to what the app accepts); the test file also fails when a file of `api/` reads a path it does not list, and when `src/generated/openapi.ts` is not what the generator makes from the file now |
| The live stream's compression (`stream.test.ts`) | A frame that waits in the compressor's buffer so that a quiet estate looks dead, a stream that decodes to other text than the plain one, and an end at shutdown that the screen sees as a break (IN-11) |
| The graph range (`graphs.test.ts`) | Two requests seconds apart missing each other's cache entry because the key held the second they came in at (BK-13) |
| The words of the server's sentences (`plain-wording.test.ts`) | A sentence that sends the reader to the BFF log or names a setting: everyone reads these, an operator included (UX-20) |
| Scrolling boxes (`TableWrap.test.tsx`) | A table box that scrolls and that a keyboard cannot reach (CK-01): it has a tab stop and a name only while it overflows |
| The pages the audit scripts visit (`live-tools.test.ts`) | A page of the app that `page-audit.mjs` and `layout-sweep.mjs` never open (CK-04) |
| The CSV of Show data (`chartCsv.test.ts`, `csv.test.ts`) | A cell a spreadsheet would run as a formula, a column that does not line up with the table, and a time in the wrong zone (MT-02) |
| The layers (`layering.test.ts`, on both sides) | A route that imports another route, a service that imports a route, a feature on the web that reaches into another, a shipped file that imports a test: the folder rules of [ADR-0013](../architecture/adr/0013-layers-features-and-tools.md) as failures, not as advice |

Layout. On the server, tests live in `server/src/__tests__/` so they resolve modules exactly as the app does.
`tsconfig.json` excludes that directory (tests must not ship in `dist/`); `tsconfig.test.json` puts
it back for typechecking, and `npm run typecheck` runs both: vitest transpiles without
typechecking, so without the second pass the tests would drift out of sync unnoticed.

On the web, a test sits beside the file it tests (`Sidebar.tsx`, `Sidebar.test.tsx`) in its feature folder. What cuts
across features stays in `web/src/__tests__/`: the routes, back and forward, the narrow screen, the markup rules, the
layering, the stylesheet and the API types. `tsconfig.json` leaves the tests out of the build in both places (`src/__tests__` and
`*.test.ts(x)`), and `npm run typecheck` checks them with their own config.
