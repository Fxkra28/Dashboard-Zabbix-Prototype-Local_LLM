# The tests map

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 1 min | [The A to Z index of names](symbols.md) | none |

Every test file of the server and of the web app, with how many tests it holds, what its first `describe` says it checks, and which code files it imports. Use it the other way round from a card: a card says which tests import a file, and this page says what a test file is about. When you change a function and want to know which tests to read first, start from the card of its file and come here for the names. [Tests and checkers](tests-and-checkers.md) explains how the tests are organised and how to run them.

The page is written by `npm run handover:build` from the test files, so it cannot drift. The count is of `it` and `test` calls found in the file, including their `each`, `skip` and `only` forms. A test that is generated in a loop counts once. A file with no `describe` has an empty second column.

## The tests

<!-- gen:testsmap -->
### server

| Test file | Tests | What it checks | Code it imports |
|---|---|---|---|
| `server/src/__tests__/ai-errors.test.ts` | 17 | a model that cannot be reached | `clients/ai.ts`, `http/errors.ts`, `services/assistant.ts` |
| `server/src/__tests__/ai-hosted-limits.test.ts` | 16 | acquireHostedSlot | `clients/ai.ts`, `services/assistant.ts` |
| `server/src/__tests__/ai-limits.test.ts` | 17 | calls a minute for each user | `clients/ai.ts`, `clients/limits.ts`, `core/cache.ts`, `domain/queries.ts`, `http/errors.ts`, and 5 more |
| `server/src/__tests__/ai-notice.test.ts` | 11 | GET /api/health says whether a question leaves this machine | `core/config.ts`, `domain/queries.ts`, `http/health.ts` |
| `server/src/__tests__/ai.test.ts` | 30 | humanize: openai-compatible backend | `clients/ai.ts`, `core/config.ts`, `services/assistant.ts` |
| `server/src/__tests__/api-hygiene.test.ts` | 12 | grouping stays linear | `clients/zabbix.ts`, `core/cache.ts`, `core/config.ts`, `routes/actions.ts`, `routes/sla.ts`, and 2 more |
| `server/src/__tests__/auth-rules.test.ts` | 18 | requiredRole | `http/errors.ts`, `routes/sliExport.ts`, `security/auth.ts`, `services/sli.ts` |
| `server/src/__tests__/auth-sessions.test.ts` | 13 | tokens are bound to this portal | none |
| `server/src/__tests__/auth-users.test.ts` | 21 | PORTAL_USERS entries (SC-22) | `security/passwords.ts` |
| `server/src/__tests__/auth.test.ts` | 61 | auth guard | `http/errors.ts`, `http/rateLimit.ts`, `security/auth.ts` |
| `server/src/__tests__/availability.test.ts` | 10 | mergedSeconds | `services/availability.ts`, `services/incidents.ts`, `sli/intervals.ts` |
| `server/src/__tests__/cache.test.ts` | 49 | cached | `core/cache.ts` |
| `server/src/__tests__/chat-route.test.ts` | 14 | POST /api/chat | `clients/ai.ts`, `clients/zabbix.ts`, `core/schemas.ts`, `http/errors.ts`, `http/requestId.ts`, and 2 more |
| `server/src/__tests__/chat.test.ts` | 64 | buildSnapshot | `core/cache.ts`, `core/config.ts`, `domain/queries.ts`, `routes/chat.ts`, `services/assistant.ts`, and 5 more |
| `server/src/__tests__/ci-workflow.test.ts` | 27 | .github/workflows/ci.yml | none |
| `server/src/__tests__/compose-auth.test.ts` | 4 | docker-compose.yml, sign-in settings | `security/auth.ts` |
| `server/src/__tests__/compose-env.test.ts` | 5 | docker-compose.yml and the BFF (tracker IN-04) | `core/config.ts` |
| `server/src/__tests__/compose-runtime.test.ts` | 4 | portal-bff in docker-compose.yml | none |
| `server/src/__tests__/compress.test.ts` | 13 | pickEncoding | `core/acceptEncoding.ts`, `http/compress.ts` |
| `server/src/__tests__/config-placeholder-key.test.ts` | 9 | the placeholder API key from .env.example | `core/config.ts` |
| `server/src/__tests__/config-tls-pin.test.ts` | 5 | the exception for an expired Zabbix certificate, at startup | `core/config.ts` |
| `server/src/__tests__/container-hardening.test.ts` | 25 | the images (SC-21) | none |
| `server/src/__tests__/deploy-docs.test.ts` | 29 | the browser-to-nginx hop is drawn as plain HTTP (tracker IN-26) | `core/config.ts` |
| `server/src/__tests__/devices-route.test.ts` | 9 | GET /api/devices | `clients/zabbix.ts`, `core/cache.ts`, `domain/naming.ts`, `routes/devices.ts`, `routes/hosts.ts`, and 2 more |
| `server/src/__tests__/diagrams-check.test.ts` | 12 | diagrams.check.mjs: the stamp | none |
| `server/src/__tests__/download-log.test.ts` | 2 | one line for each report downloaded | `http/errors.ts`, `routes/sliExport.ts`, `security/auth.ts`, `services/sli.ts`, `services/sliExport.ts` |
| `server/src/__tests__/email-without-auth.test.ts` | 20 | the settings as they apply now | `clients/mail.ts`, `core/config.ts`, `core/mailConfig.ts`, `core/schemas.ts`, `core/state.ts`, and 7 more |
| `server/src/__tests__/empty-report-retry.test.ts` | 3 | the try after an empty report (BK-51) | `clients/mail.ts`, `core/cache.ts`, `core/validate.ts`, `services/sliMail.ts`, `sli/engine.ts` |
| `server/src/__tests__/env-templates.test.ts` | 9 | the root .env.example and docker-compose.yml (IN-04) | none |
| `server/src/__tests__/explain-figure.test.ts` | 1 | the figure in Explain | `services/explain.ts` |
| `server/src/__tests__/explain-problem.test.ts` | 3 | the start time Explain gives the model (BK-37) | `clients/ai.ts`, `core/cache.ts`, `core/config.ts`, `domain/queries.ts`, `services/explain.ts` |
| `server/src/__tests__/export-csv.test.ts` | 50 | the files in the package | `core/reportChoices.ts`, `export/csv.ts`, `export/types.ts` |
| `server/src/__tests__/export-pdf.test.ts` | 109 | structure | `domain/naming.ts`, `export/logo.ts`, `export/pdf.ts`, `export/pdfFonts.ts`, `export/slaReport.ts`, and 2 more |
| `server/src/__tests__/export-route.test.ts` | 46 | GET /api/sli/export | `clients/zabbix.ts`, `core/cache.ts`, `core/validate.ts`, `http/compress.ts`, `http/errors.ts`, and 3 more |
| `server/src/__tests__/export-sla-report-style.test.ts` | 30 | the default style | `core/reportChoices.ts`, `export/slaReport.ts`, `export/types.ts`, `sli/engine.ts` |
| `server/src/__tests__/export-sla-report.test.ts` | 94 | the document as a whole | `domain/naming.ts`, `export/slaReport.ts`, `export/types.ts`, `sli/engine.ts` |
| `server/src/__tests__/export-style.test.ts` | 9 | the default style | `core/reportChoices.ts`, `core/validate.ts`, `services/sliExport.ts` |
| `server/src/__tests__/export-theme.test.ts` | 4 | report palette | `export/theme.ts` |
| `server/src/__tests__/export-writers-agree.test.ts` | 5 | the two writers treat the same awkward document the same way | `export/pdf.ts`, `export/types.ts`, `export/xlsx.ts` |
| `server/src/__tests__/export-xlsx.test.ts` | 82 | workbook package | `export/slaReport.ts`, `export/theme.ts`, `export/types.ts`, `export/xlsx.ts` |
| `server/src/__tests__/export-zip.test.ts` | 10 | zip | `export/zip.ts` |
| `server/src/__tests__/freshness.test.ts` | 16 | newestClock | `clients/zabbix.ts`, `domain/reachability.ts`, `routes/reports.ts` |
| `server/src/__tests__/gate.test.ts` | 5 | createGate | `core/gate.ts` |
| `server/src/__tests__/gitignore.test.ts` | 1 | .gitignore | none |
| `server/src/__tests__/graphs.test.ts` | 33 | /api/items | `clients/zabbix.ts`, `core/config.ts`, `routes/history.ts`, `routes/hosts.ts`, `routes/net.ts`, and 2 more |
| `server/src/__tests__/handover-check.test.ts` | 30 | handover tools: reading the code | none |
| `server/src/__tests__/health-log.test.ts` | 2 | what the log holds for the health check | `http/health.ts`, `security/auth.ts` |
| `server/src/__tests__/health-timezone.test.ts` | 2 | GET /api/health: defaults.timezone | `clients/zabbix.ts`, `http/health.ts` |
| `server/src/__tests__/health.test.ts` | 38 | createReadiness | `clients/zabbix.ts`, `core/config.ts`, `domain/queries.ts`, `http/health.ts`, `security/auth.ts`, and 1 more |
| `server/src/__tests__/heavy-reports.test.ts` | 3 | heavy reports | `clients/zabbix.ts`, `routes/analytics.ts`, `services/reportPolicy.ts` |
| `server/src/__tests__/incidents-before-window.test.ts` | 33 | any-problem availability and a span declared not measured (SLA_NO_DATA_WINDOWS) | `clients/zabbix.ts`, `core/config.ts`, `services/availability.ts`, `services/incidents.ts`, `services/noise.ts` |
| `server/src/__tests__/inventory-site-hint.test.ts` | 2 | the Site check of the inventory scorecard (BK-32) | `core/cache.ts`, `domain/queries.ts`, `services/inventory.ts` |
| `server/src/__tests__/layering.test.ts` | 11 | the layers of server/src | none |
| `server/src/__tests__/light-reads.test.ts` | 14 | the problem list | `clients/zabbix.ts`, `core/cache.ts`, `core/staleness.ts`, `domain/queries.ts`, `domain/recentValues.ts`, and 4 more |
| `server/src/__tests__/live-tools.test.ts` | 2 |  | none |
| `server/src/__tests__/logging.test.ts` | 3 | redactUrl | `http/logging.ts` |
| `server/src/__tests__/mail-client.test.ts` | 32 | what a timeout is told (FR-35) | `clients/mail.ts`, `core/mailConfig.ts` |
| `server/src/__tests__/mail-config-wiring.test.ts` | 11 | config.mail | `core/config.ts` |
| `server/src/__tests__/mail-config.test.ts` | 50 | nothing set | `core/mailConfig.ts` |
| `server/src/__tests__/mail-limit.test.ts` | 7 | HourLimit | `clients/limits.ts`, `security/mailLimit.ts` |
| `server/src/__tests__/mail-options.test.ts` | 6 | the mail client's options | `clients/mail.ts`, `core/mailConfig.ts` |
| `server/src/__tests__/mail-recipients.test.ts` | 23 | a good list | `core/mailConfig.ts`, `core/recipients.ts`, `core/validate.ts` |
| `server/src/__tests__/mail-route.test.ts` | 78 | who may ask | `clients/mail.ts`, `core/config.ts`, `core/mailConfig.ts`, `core/schemas.ts`, `core/state.ts`, and 7 more |
| `server/src/__tests__/mail-service.test.ts` | 6 | email that is off | `clients/mail.ts`, `core/config.ts`, `core/mailConfig.ts`, `services/sli.ts`, `services/sliMail.ts` |
| `server/src/__tests__/meters-route.test.ts` | 33 | GET /api/net/meters | `clients/zabbix.ts`, `core/cache.ts`, `http/errors.ts`, `routes/meters.ts`, `security/auth.ts`, and 1 more |
| `server/src/__tests__/meters.test.ts` | 42 | parseScale | `routes/meters.ts`, `services/meters.ts` |
| `server/src/__tests__/naming.test.ts` | 4 | HOST_NAME_PATTERN | `domain/naming.ts` |
| `server/src/__tests__/nginx-conf.test.ts` | 36 | web/nginx.conf | none |
| `server/src/__tests__/no-store.test.ts` | 11 | Cache-Control on /api replies | `http/noStore.ts` |
| `server/src/__tests__/noise-large.test.ts` | 2 | the alert noise report on a trigger with a very long list of incidents (BK-35) | `services/incidents.ts`, `services/noise.ts` |
| `server/src/__tests__/openapi-contract.test.ts` | 4 | every answer fits docs/api/openapi.yaml (BK-14) | `clients/ai.ts`, `clients/zabbix.ts`, `core/schemas.ts`, `http/errors.ts`, `http/health.ts`, and 25 more |
| `server/src/__tests__/page-access.test.ts` | 6 | GET /api/auth/me: pages | `http/errors.ts`, `security/auth.ts`, `security/pageAccess.ts` |
| `server/src/__tests__/parity-script.test.ts` | 13 | parity.check.mjs: what it reports | none |
| `server/src/__tests__/passwords.test.ts` | 19 | hashPassword | `security/passwords.ts` |
| `server/src/__tests__/period-window.test.ts` | 4 | monthWindow | `core/validate.ts`, `services/incidents.ts`, `sli/time.ts` |
| `server/src/__tests__/pinned-tls.test.ts` | 12 | a pinned connection | `clients/pinnedTls.ts`, `core/config.ts` |
| `server/src/__tests__/plain-wording.test.ts` | 5 | the sentences a screen can be sent | `clients/ai.ts`, `clients/zabbix.ts`, `http/errors.ts`, `http/requestId.ts`, `services/chat.ts` |
| `server/src/__tests__/portal-state.test.ts` | 37 | a portal with no place to keep it | `core/mailConfig.ts`, `core/state.ts` |
| `server/src/__tests__/reachability.test.ts` | 12 | isFresh | `clients/zabbix.ts`, `core/cache.ts`, `domain/reachability.ts` |
| `server/src/__tests__/rebuild-script.test.ts` | 52 | deploy/rebuild.sh, as a dry run | none |
| `server/src/__tests__/report-schedule.test.ts` | 102 | a state folder that stops taking writes | `clients/mail.ts`, `clients/zabbix.ts`, `core/state.ts`, `core/validate.ts`, `services/reportSchedule.ts`, and 2 more |
| `server/src/__tests__/request-id.test.ts` | 12 | genReqId | `clients/zabbix.ts`, `core/config.ts`, `core/validate.ts`, `http/errors.ts`, `http/requestId.ts`, and 1 more |
| `server/src/__tests__/request-schemas.test.ts` | 22 | POST /api/auth/login body | `clients/zabbix.ts`, `core/config.ts`, `core/schemas.ts`, `http/errors.ts`, `routes/actions.ts`, and 2 more |
| `server/src/__tests__/routes.test.ts` | 41 | hosts routes | `clients/zabbix.ts`, `core/cache.ts`, `core/config.ts`, `routes/actions.ts`, `routes/analytics.ts`, and 13 more |
| `server/src/__tests__/schedule-route.test.ts` | 35 | who may ask | `core/config.ts`, `core/schemas.ts`, `core/state.ts`, `http/errors.ts`, `routes/sliSchedule.ts`, and 2 more |
| `server/src/__tests__/search-limit.test.ts` | 7 | ${SEARCHES_PER_MINUTE} text searches a minute for each person (BK-36) | `clients/zabbix.ts`, `core/cache.ts`, `core/config.ts`, `http/errors.ts`, `routes/hosts.ts`, and 2 more |
| `server/src/__tests__/self-hosted-fonts.test.ts` | 10 | the @font-face rules | none |
| `server/src/__tests__/shutdown.test.ts` | 15 | installShutdown | `core/cache.ts`, `domain/queries.ts`, `http/shutdown.ts`, `routes/stream.ts`, `services/stream.ts` |
| `server/src/__tests__/signedin-check-script.test.ts` | 10 |  | none |
| `server/src/__tests__/site-naming.test.ts` | 9 | siteFromHostName | `domain/naming.ts` |
| `server/src/__tests__/sla-summary.test.ts` | 3 | derivedSlaLines | `services/sli.ts`, `sli/summary.ts`, `sli/tree.ts` |
| `server/src/__tests__/sli-cache.test.ts` | 10 | getMonthlySli keeps what it computes | `core/cache.ts`, `services/sli.ts`, `sli/engine.ts` |
| `server/src/__tests__/sli-engine.test.ts` | 39 | intervalsFor | `clients/zabbix.ts`, `core/config.ts`, `sli/engine.ts`, `sli/events.ts`, `sli/intervals.ts` |
| `server/src/__tests__/sli-gate.test.ts` | 4 | getMonthlySli under a burst (BK-50) | `core/cache.ts`, `services/reportPolicy.ts`, `services/sli.ts`, `sli/engine.ts` |
| `server/src/__tests__/sli-maintenance-groups.test.ts` | 8 | maintenanceByHost with nested host groups (BK-46) | `clients/zabbix.ts`, `sli/maintenance.ts` |
| `server/src/__tests__/sli-maintenance.test.ts` | 7 | maintenanceWindows | `sli/maintenance.ts` |
| `server/src/__tests__/sli-routes.test.ts` | 21 | GET /api/sli | `clients/ai.ts`, `clients/zabbix.ts`, `core/cache.ts`, `core/config.ts`, `routes/analytics.ts`, and 7 more |
| `server/src/__tests__/sli-schedule.test.ts` | 52 | zonedTime | `core/state.ts`, `sli/schedule.ts`, `sli/time.ts` |
| `server/src/__tests__/sli-time.test.ts` | 10 | monthBounds | `core/validate.ts`, `sli/time.ts` |
| `server/src/__tests__/source-down.test.ts` | 3 | a Zabbix failure as a reader sees it | `clients/zabbix.ts`, `http/errors.ts`, `http/requestId.ts` |
| `server/src/__tests__/sse-hold.test.ts` | 6 |  | none |
| `server/src/__tests__/stale-headers.test.ts` | 9 | stale headers on a real report route | `core/cache.ts`, `core/staleness.ts`, `http/compress.ts`, `http/errors.ts`, `routes/sli.ts`, and 1 more |
| `server/src/__tests__/startup-guards.test.ts` | 42 | with auth on, the BFF refuses to start | `core/config.ts`, `security/auth.ts`, `security/passwords.ts`, `sli/time.ts` |
| `server/src/__tests__/statsItemCount.test.ts` | 5 | the item count on /api/stats | `clients/zabbix.ts`, `core/cache.ts`, `services/actions.ts`, `services/reports.ts` |
| `server/src/__tests__/stream-limits-env.test.ts` | 3 | config.stream | `core/config.ts` |
| `server/src/__tests__/stream-signout.test.ts` | 2 | GET /api/stream and sign-out | `core/cache.ts`, `domain/queries.ts`, `routes/stream.ts`, `security/auth.ts`, `services/stream.ts` |
| `server/src/__tests__/stream.test.ts` | 40 | fingerprint | `clients/zabbix.ts`, `core/cache.ts`, `core/config.ts`, `domain/queries.ts`, `http/requestId.ts`, and 3 more |
| `server/src/__tests__/surface.test.ts` | 5 | API surface | `clients/zabbix.ts`, `routes/actions.ts`, `routes/analytics.ts`, `routes/chat.ts`, `routes/devices.ts`, and 20 more |
| `server/src/__tests__/top-hosts-route.test.ts` | 10 | GET /api/reports/top-hosts | `clients/zabbix.ts`, `core/cache.ts`, `routes/topHosts.ts` |
| `server/src/__tests__/typed-keys.test.ts` | 11 | a flood of distinct requests leaves the shared entries in the cache (BK-36) | `clients/zabbix.ts`, `core/cache.ts`, `security/viewerPolicy.ts`, `services/history.ts`, `services/hosts.ts`, and 2 more |
| `server/src/__tests__/usage-log-sla.test.ts` | 1 | the SLA explanations in the log | `http/errors.ts`, `routes/explain.ts`, `security/auth.ts`, `services/explain.ts` |
| `server/src/__tests__/usage-log.test.ts` | 9 | one line for each use of the AI | `clients/ai.ts`, `core/cache.ts`, `domain/queries.ts`, `http/errors.ts`, `routes/chat.ts`, and 4 more |
| `server/src/__tests__/validate-ids.test.ts` | 6 | isZabbixId | `core/validate.ts` |
| `server/src/__tests__/validate-sli-script.test.ts` | 6 | scripts/validate-sli.ts, a month with no spreadsheet (IN-49) | `export/zip.ts` |
| `server/src/__tests__/viewer-network-ids.test.ts` | 9 | the lookup behind it | `clients/zabbix.ts`, `core/cache.ts`, `core/config.ts`, `http/errors.ts`, `routes/history.ts`, and 1 more |
| `server/src/__tests__/viewer-network.test.ts` | 22 | isNetworkKey | `clients/zabbix.ts`, `core/cache.ts`, `core/config.ts`, `domain/queries.ts`, `http/errors.ts`, and 5 more |
| `server/src/__tests__/watch-script.test.ts` | 62 | deploy/watch.sh | none |
| `server/src/__tests__/web-monitoring-route.test.ts` | 16 | GET /api/reports/web-monitoring | `clients/zabbix.ts`, `core/cache.ts`, `routes/webMonitoring.ts`, `services/webMonitoring.ts` |
| `server/src/__tests__/write-audit.test.ts` | 35 | the message Zabbix records | `clients/zabbix.ts`, `core/cache.ts`, `core/config.ts`, `core/schemas.ts`, `http/errors.ts`, and 3 more |
| `server/src/__tests__/write-gate.test.ts` | 19 | writeBackEnabled | `clients/zabbix.ts`, `core/config.ts`, `http/hostCheck.ts`, `routes/actions.ts` |
| `server/src/__tests__/zabbix-pinned.test.ts` | 5 | zbx() with ZBX_TLS_PIN_SHA256 set | `clients/pinnedTls.ts`, `clients/zabbix.ts`, `core/config.ts` |
| `server/src/__tests__/zabbix.test.ts` | 19 | zbx() | `clients/zabbix.ts`, `core/config.ts`, `http/errors.ts` |

### web

| Test file | Tests | What it checks | Code it imports |
|---|---|---|---|
| `web/src/__tests__/OperatorWording.test.tsx` | 7 | error hints | `api/index.ts`, `features/assistant/Assistant.tsx`, `features/assistant/useAi.ts`, `features/dashboard/Overview.tsx`, `features/network/Network.tsx`, and 4 more |
| `web/src/__tests__/aiLimitMessage.test.ts` | 3 | a refused AI call | `api/index.ts` |
| `web/src/__tests__/backForward.test.ts` | 1 | a page Back restores from the browser cache | `api/index.ts` |
| `web/src/__tests__/backForwardUser.test.ts` | 2 | a page Back restores after another user signed in | `api/index.ts` |
| `web/src/__tests__/chatStreamEnd.test.ts` | 6 | the end of the Assistant's stream | `api/index.ts` |
| `web/src/__tests__/chatStreamRefusal.test.ts` | 6 | a refusal before the Assistant answers (FR-38) | `api/index.ts` |
| `web/src/__tests__/copiedHelpers.test.ts` | 11 | shared/lib/sites.ts and server/src/domain/naming.ts | `domain/naming.ts`, `sli/time.ts`, `shared/lib/sites.ts`, `shared/lib/time.ts` |
| `web/src/__tests__/countPills.test.tsx` | 6 | Hosts with a filter that leaves nothing | `api/index.ts`, `features/hosts/Devices.tsx`, `features/hosts/Hosts.tsx`, `features/network/Sites.tsx`, `shared/hooks/useAuth.ts`, and 1 more |
| `web/src/__tests__/dialogOverlays.test.tsx` | 9 | the page behind a dialog (UX-43) | `api/index.ts`, `features/assistant/ExplainPanel.tsx`, `features/problems/AckDialog.tsx`, `features/sla/ReportDialog.tsx` |
| `web/src/__tests__/errorOverflow.test.ts` | 2 | the error line of a dialog | none |
| `web/src/__tests__/forcedColours.test.ts` | 3 | the surfaces in forced-colours mode (UX-42) | none |
| `web/src/__tests__/guardedReads.test.tsx` | 14 | api/ reads | `api/index.ts`, `features/dashboard/Overview.tsx`, `features/hosts/Hosts.tsx`, `features/problems/Problems.tsx`, `guards/index.ts`, and 3 more |
| `web/src/__tests__/guardsData.test.ts` | 8 | answers that are not the kind at all | `guards/index.ts` |
| `web/src/__tests__/hostListFailure.test.tsx` | 11 | Graphs | `api/index.ts`, `features/graphs/HostDetail.tsx`, `features/hosts/LatestData.tsx`, `shared/components/states.tsx`, `shared/hooks/useAuth.ts` |
| `web/src/__tests__/layering.test.ts` | 7 | the layers of web/src | none |
| `web/src/__tests__/mainZone.test.tsx` | 1 |  | `App.tsx`, `api/index.ts`, `features/shell/ErrorBoundary.tsx`, `main.tsx`, `shared/lib/time.ts` |
| `web/src/__tests__/markup.test.tsx` | 18 | icons | `features/sla/Sli.tsx`, `shared/components/icons.tsx` |
| `web/src/__tests__/narrowScreen.test.tsx` | 20 | useNarrowScreen (UX-14) | `features/shell/Layout.tsx`, `features/shell/useUiPrefs.ts` |
| `web/src/__tests__/openapiTypes.test.ts` | 3 | the OpenAPI file and the web types (FR-16) | `generated/openapi.ts`, `types/index.ts` |
| `web/src/__tests__/pagePastEnd.test.tsx` | 7 | Latest data past the end | `api/index.ts`, `features/hosts/LatestData.tsx`, `features/network/Network.tsx`, `shared/hooks/useAuth.ts`, `types/index.ts` |
| `web/src/__tests__/recipientsApi.test.ts` | 7 | replacing the saved list | `api/index.ts` |
| `web/src/__tests__/reportApi.test.ts` | 37 | api.sliExport | `api/index.ts` |
| `web/src/__tests__/reportZoneUi.test.tsx` | 7 | MonthSelect | `api/index.ts`, `features/graphs/RangePicker.tsx`, `features/sla/Availability.tsx`, `features/sla/Sla.tsx`, `features/sla/Sli.tsx`, and 2 more |
| `web/src/__tests__/requestTimeout.test.ts` | 11 | a read that never answers (tracker FR-11) | `api/index.ts` |
| `web/src/__tests__/routes.test.tsx` | 10 | an address that is not a page (FR-06) | `App.tsx`, `features/shell/Layout.tsx`, `features/shell/usePageTitle.ts` |
| `web/src/__tests__/sharedPages.test.tsx` | 7 | the pager on Latest data | `api/index.ts`, `features/hosts/Hosts.tsx`, `features/hosts/LatestData.tsx`, `features/network/Network.tsx`, `features/network/Sites.tsx`, and 3 more |
| `web/src/__tests__/sharedPieces.test.tsx` | 12 | Field, FieldGroup and FieldSpacer | `features/hosts/HostTable.tsx`, `features/problems/AckPill.tsx`, `shared/components/Field.tsx`, `shared/components/Pager.tsx`, `types/index.ts` |
| `web/src/__tests__/signOutClearsChat.test.ts` | 12 | the Assistant conversation and the end of a session | `api/index.ts`, `shared/lib/chatStore.ts` |
| `web/src/__tests__/signOutFailure.test.ts` | 8 | logout() when the request does not get through | `api/index.ts`, `api/session.ts`, `shared/lib/chatStore.ts` |
| `web/src/__tests__/stylesheet.test.ts` | 3 | the stylesheet in parts | none |
| `web/src/__tests__/themeBeforePaint.test.ts` | 5 | public/theme.js | `features/shell/useUiPrefs.ts` |
| `web/src/__tests__/tokenPairs.test.ts` | 4 | the pairs the checker computes | `web/scripts/tokens.check.mjs` |
| `web/src/__tests__/tooltipFacts.test.tsx` | 4 | a refresh that failed | `api/index.ts`, `features/network/Sites.tsx`, `features/sla/Sli.tsx`, `shared/components/states.tsx`, `shared/hooks/useAuth.ts`, and 1 more |
| `web/src/__tests__/urlFilters.test.tsx` | 23 | Hosts | `api/index.ts`, `features/hosts/Hosts.tsx`, `features/network/Sites.tsx`, `features/reports/AlertNoise.tsx`, `features/reports/Inventory.tsx`, and 5 more |
| `web/src/__tests__/writeFailure.test.ts` | 9 | a failed write | `api/index.ts` |
| `web/src/__tests__/zoneClocks.test.tsx` | 10 | the clock helpers | `features/shell/TodayDate.tsx`, `shared/components/states.tsx`, `shared/lib/freshness.ts`, `shared/lib/time.ts` |
| `web/src/api.test.ts` | 12 | api/ requests | `api/index.ts` |
| `web/src/features/assistant/Assistant.test.tsx` | 6 | the Assistant page before it knows whether a model is configured | `api/index.ts`, `features/assistant/Assistant.tsx`, `shared/hooks/useAuth.ts` |
| `web/src/features/assistant/ContextStrip.test.tsx` | 3 | the age of the snapshot in the Assistant | `features/assistant/Assistant.tsx`, `types/index.ts` |
| `web/src/features/assistant/aiNotice.test.tsx` | 8 | the Assistant page | `api/index.ts`, `features/assistant/Assistant.tsx`, `features/assistant/ExplainPanel.tsx`, `features/assistant/useAi.ts`, `shared/hooks/useAuth.ts` |
| `web/src/features/assistant/assistantSignOutRace.test.tsx` | 1 | an answer that lands while signing out | `api/index.ts`, `features/assistant/Assistant.tsx`, `shared/hooks/useAuth.ts` |
| `web/src/features/assistant/modelNotice.test.tsx` | 9 | useModelDown | `api/index.ts`, `features/assistant/Assistant.tsx`, `features/assistant/ExplainPanel.tsx`, `features/assistant/useModel.ts`, `shared/hooks/useAuth.ts` |
| `web/src/features/assistant/parseMarkdown.test.ts` | 4 | headings | `features/assistant/parseMarkdown.ts` |
| `web/src/features/assistant/useAi.test.tsx` | 9 | useCapabilities | `api/index.ts`, `features/assistant/useAi.ts`, `shared/lib/time.ts` |
| `web/src/features/auth/Login.test.tsx` | 2 | the sign-in form | `api/index.ts`, `features/auth/Login.tsx` |
| `web/src/features/auth/returnPath.test.ts` | 6 | returnPath: where sign-in goes next | `features/auth/Login.tsx` |
| `web/src/features/dashboard/HostsView.test.tsx` | 23 | HostsView availability | `api/index.ts`, `features/dashboard/HostsView.tsx`, `features/dashboard/useHostsView.ts` |
| `web/src/features/dashboard/Tabs.test.tsx` | 6 | Tabs | `features/dashboard/Tabs.tsx` |
| `web/src/features/dashboard/dashboardViews.test.tsx` | 38 | the Dashboard views | `api/index.ts`, `features/dashboard/Overview.tsx`, `shared/hooks/useAuth.ts`, `shared/hooks/useSSE.ts`, `types/index.ts` |
| `web/src/features/dashboard/fit.test.ts` | 13 | fitBounds | `features/dashboard/fit.ts` |
| `web/src/features/dashboard/hostsFigures.test.ts` | 11 | availability | `features/dashboard/hostsFigures.ts`, `features/hosts/deviceTally.ts` |
| `web/src/features/dashboard/liveList.test.ts` | 6 | worstFirst | `features/dashboard/liveList.ts` |
| `web/src/features/dashboard/useFitHeight.test.tsx` | 7 | useFitHeight | `features/dashboard/fit.ts`, `features/dashboard/useFitHeight.ts` |
| `web/src/features/dashboard/useHostsView.test.tsx` | 2 | useHostsView | `api/index.ts`, `features/dashboard/useHostsView.ts` |
| `web/src/features/graphs/GraphView.test.tsx` | 4 | GraphView and the Show data table | `api/index.ts`, `features/graphs/TimeSeriesChart.tsx`, `types/index.ts` |
| `web/src/features/graphs/HostDetail.test.tsx` | 9 | the Graphs page opened by an address that names items | `api/index.ts`, `features/graphs/HostDetail.tsx`, `types/index.ts` |
| `web/src/features/graphs/ItemPickerPressed.test.tsx` | 4 | the Traffic in + out button | `api/index.ts`, `features/graphs/ItemPicker.tsx`, `types/index.ts` |
| `web/src/features/graphs/ItemPickerSession.test.tsx` | 4 | the list of a host that the picker keeps | `api/index.ts`, `features/graphs/ItemPicker.tsx`, `types/index.ts` |
| `web/src/features/graphs/TimeSeriesChart.test.tsx` | 20 | TimeSeriesChart accessibility (UX-17) | `features/graphs/TimeSeriesChart.tsx`, `types/index.ts` |
| `web/src/features/graphs/TimeSeriesChartSeries.test.tsx` | 6 | the line of each series | `features/graphs/TimeSeriesChart.tsx`, `types/index.ts` |
| `web/src/features/graphs/TimeSeriesChartTooltip.test.tsx` | 3 | the tooltip of a chart (UX-41) | `features/graphs/TimeSeriesChart.tsx`, `types/index.ts` |
| `web/src/features/graphs/chartCsv.test.ts` | 12 | chartCsvRows (MT-02) | `features/graphs/chartCsv.ts`, `shared/lib/csv.ts`, `types/index.ts` |
| `web/src/features/graphs/chartTable.test.ts` | 8 | chartTable | `features/graphs/chartTable.ts`, `types/index.ts` |
| `web/src/features/graphs/chartZone.test.tsx` | 2 |  | `features/graphs/TimeSeriesChart.tsx`, `shared/lib/time.ts`, `shared/lib/units.ts`, `types/index.ts` |
| `web/src/features/graphs/graphZone.test.tsx` | 13 | the time axis of a chart | `features/graphs/RangePicker.tsx`, `features/graphs/TimeSeriesChart.tsx`, `shared/lib/time.ts`, `types/index.ts` |
| `web/src/features/graphs/unitScales.test.tsx` | 7 | unitFamilies | `api/index.ts`, `features/graphs/ItemPicker.tsx`, `features/graphs/TimeSeriesChart.tsx`, `features/graphs/unitScales.ts`, `types/index.ts` |
| `web/src/features/graphs/useThemeChange.test.tsx` | 6 | useThemeChange | `features/graphs/TimeSeriesChart.tsx`, `features/graphs/useThemeChange.ts` |
| `web/src/features/hosts/Devices.test.tsx` | 18 | the kind tiles | `api/index.ts`, `features/hosts/Devices.tsx`, `shared/hooks/useAuth.ts`, `types/index.ts` |
| `web/src/features/hosts/LatestDataAny.test.tsx` | 3 | the Host menu of Latest data | `api/index.ts`, `features/hosts/LatestData.tsx`, `shared/hooks/useAuth.ts` |
| `web/src/features/meters/Gauge.test.tsx` | 35 | Gauge with a current reading | `features/meters/Gauge.tsx`, `features/meters/gaugeDial.ts` |
| `web/src/features/meters/InternetMeters.test.tsx` | 9 | InternetMeters | `api/index.ts`, `features/meters/InternetMeters.tsx`, `features/meters/useMeters.ts` |
| `web/src/features/meters/gaugeDial.test.ts` | 31 | dialPoint and arcPath | `features/meters/gaugeDial.ts` |
| `web/src/features/network/Links.test.tsx` | 8 | the page when the read works | `api/index.ts`, `features/network/Links.tsx`, `types/index.ts` |
| `web/src/features/network/MapsPage.test.tsx` | 16 | the chosen map is in the URL (FR-18) | `api/index.ts`, `features/network/Maps.tsx`, `types/index.ts` |
| `web/src/features/network/mapLabels.test.ts` | 15 | placeLabels (FR-18) | `features/network/mapLabels.ts` |
| `web/src/features/network/networkPorts.test.tsx` | 9 | the port rows on Network | `api/index.ts`, `features/graphs/TimeSeriesChart.tsx`, `features/network/Network.tsx`, `shared/hooks/useAuth.ts`, `types/index.ts` |
| `web/src/features/problems/AckDialog.test.tsx` | 35 | AckDialog and a Zabbix that has stopped collecting | `api/index.ts`, `features/problems/AckDialog.tsx`, `types/index.ts` |
| `web/src/features/problems/ProblemsPage.test.tsx` | 51 | the live stream tells the page when to read the list again (IN-11) | `api/index.ts`, `features/assistant/useAi.ts`, `features/problems/Problems.tsx`, `features/problems/ProblemsTable.tsx`, `shared/hooks/useAuth.ts`, and 1 more |
| `web/src/features/problems/liveChange.test.ts` | 4 | changeKey (the Problems page re-reads its list when the live stream says it changed, IN-11) | `features/problems/liveChange.ts` |
| `web/src/features/problems/useChangeHighlight.test.ts` | 9 | useChangeHighlight | `features/dashboard/liveList.ts`, `features/problems/useChangeHighlight.ts`, `types/index.ts` |
| `web/src/features/reports/Capacity.test.tsx` | 5 | the Capacity page | `api/index.ts`, `features/reports/Capacity.tsx`, `shared/hooks/useAuth.ts`, `types/index.ts` |
| `web/src/features/reports/csvPages.test.tsx` | 10 | the Alert noise CSV (FR-05) | `api/index.ts`, `features/reports/AlertNoise.tsx`, `features/reports/Inventory.tsx`, `types/index.ts` |
| `web/src/features/shell/ErrorBoundary.test.tsx` | 9 | the card for a page that crashed | `features/shell/ErrorBoundary.tsx` |
| `web/src/features/shell/LayoutSignOut.test.tsx` | 6 | the Sign out button | `api/index.ts`, `features/assistant/useAi.ts`, `features/shell/Layout.tsx`, `shared/hooks/useAuth.ts`, `types/index.ts` |
| `web/src/features/shell/Sidebar.test.tsx` | 12 | the sidebar menu | `api/index.ts`, `features/assistant/useAi.ts`, `features/shell/Sidebar.tsx`, `shared/hooks/useAuth.ts`, `types/index.ts` |
| `web/src/features/shell/TodayDate.test.tsx` | 1 | TodayDate | `features/shell/TodayDate.tsx`, `shared/lib/time.ts` |
| `web/src/features/shell/buildLabel.test.ts` | 4 | buildLabel | `features/shell/build.ts`, `shared/lib/time.ts` |
| `web/src/features/sla/EmailReport.test.tsx` | 75 | who is offered the button | `api/index.ts`, `features/sla/EmailReport.tsx`, `features/sla/reportStyle.ts`, `guards/index.ts`, `shared/hooks/useAuth.ts` |
| `web/src/features/sla/FileChoices.test.tsx` | 7 | the choices | `features/sla/FileChoices.tsx`, `types/index.ts` |
| `web/src/features/sla/ReportDialog.test.tsx` | 13 | the frame | `features/sla/ReportDialog.tsx` |
| `web/src/features/sla/ReportDownload.test.tsx` | 40 | ReportDownload | `api/index.ts`, `features/sla/Availability.tsx`, `features/sla/ReportDownload.tsx`, `features/sla/Sla.tsx`, `features/sla/reportStyle.ts`, and 3 more |
| `web/src/features/sla/ReportSchedule.test.tsx` | 56 | the button | `api/index.ts`, `features/sla/ReportSchedule.tsx`, `features/sla/reportStyle.ts`, `guards/index.ts`, `shared/lib/time.ts`, and 1 more |
| `web/src/features/sla/ReportStyleButton.test.tsx` | 14 | the button | `features/sla/ReportStyleButton.tsx`, `features/sla/reportStyle.ts` |
| `web/src/features/sla/SavedList.test.tsx` | 27 | the view before it is opened | `api/index.ts`, `features/sla/SavedList.tsx` |
| `web/src/features/sla/Services.test.tsx` | 7 | the Services tree from Zabbix (FR-12) | `api/index.ts`, `features/sla/Services.tsx`, `types/index.ts` |
| `web/src/features/sla/SlaTabs.test.tsx` | 7 | the SLA source tabs (UX-18) | `api/index.ts`, `features/sla/Sla.tsx`, `types/index.ts` |
| `web/src/features/sla/SliPill.test.tsx` | 5 | SliPill | `features/sla/Sli.tsx` |
| `web/src/features/sla/addresses.test.ts` | 8 | splitAddresses | `features/sla/addresses.ts` |
| `web/src/features/sla/percent.test.ts` | 13 | percentText | `features/sla/Sli.tsx`, `features/sla/percent.ts` |
| `web/src/features/sla/reportStyle.test.ts` | 12 | the default style | `features/sla/reportStyle.ts` |
| `web/src/features/sla/slaKpiCards.test.tsx` | 2 | the SLA page headline cards | `api/index.ts`, `features/sla/Availability.tsx`, `features/sla/Sla.tsx`, `types/index.ts` |
| `web/src/guards.test.ts` | 33 | the problem list (the Dashboard, the Problems page and the live stream) | `guards/index.ts`, `types/index.ts` |
| `web/src/shared/components/BrandMark.test.tsx` | 3 | BrandMark | `shared/components/BrandMark.tsx` |
| `web/src/shared/components/NoData.test.tsx` | 3 | NoData | `shared/components/NoData.tsx` |
| `web/src/shared/components/TableWrap.test.tsx` | 9 | the box around a wide table | `shared/components/TableWrap.tsx` |
| `web/src/shared/hooks/scrollLock.test.ts` | 8 | lockScroll | `shared/hooks/scrollLock.ts` |
| `web/src/shared/hooks/useAsync.test.ts` | 10 | useAsync | `api/index.ts`, `shared/hooks/useAsync.ts` |
| `web/src/shared/hooks/useAuth.test.tsx` | 7 | useAuth | `api/index.ts`, `shared/hooks/useAuth.ts`, `types/index.ts` |
| `web/src/shared/hooks/useDialogFocus.test.tsx` | 16 | useDialogFocus | `shared/hooks/useDialogFocus.ts` |
| `web/src/shared/hooks/useSSE.test.ts` | 21 | useSSE | `api/index.ts`, `guards/index.ts`, `shared/hooks/useSSE.ts` |
| `web/src/shared/hooks/useUrlState.test.tsx` | 6 | useUrlState | `shared/hooks/useUrlState.ts` |
| `web/src/shared/lib/chatStore.test.ts` | 6 | the saved Assistant conversation | `shared/lib/chatStore.ts` |
| `web/src/shared/lib/csv.test.ts` | 11 | csvCell | `shared/lib/csv.ts`, `shared/lib/saveFile.ts` |
| `web/src/shared/lib/freshness.test.tsx` | 42 | the problem tiles before the list has loaded (UX-02) | `api/index.ts`, `features/dashboard/Overview.tsx`, `features/reports/Capacity.tsx`, `features/sla/Availability.tsx`, `features/sla/Sla.tsx`, and 4 more |
| `web/src/shared/lib/plural.test.ts` | 2 | count | `shared/lib/plural.ts` |
| `web/src/shared/lib/reportZone.test.ts` | 7 | the report zone | `shared/lib/severity.ts`, `shared/lib/time.ts` |
| `web/src/shared/lib/time.test.ts` | 10 | lib/time: reporting months in Asia/Jakarta | `shared/lib/time.ts` |
| `web/src/shared/lib/units.test.ts` | 12 | formatPercent | `shared/lib/units.ts` |
| `web/src/shared/lib/wall.test.ts` | 20 | wallPages and wallSlice | `shared/lib/wall.ts` |
<!-- /gen -->
