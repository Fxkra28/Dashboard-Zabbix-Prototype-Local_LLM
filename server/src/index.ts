import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config, assertConfig, mailNow, trustProxyOption } from './core/config.js';
import { registerErrorHandler } from './http/errors.js';
import { genReqId, registerRequestId } from './http/requestId.js';
import { AJV_OPTIONS } from './core/schemas.js';
import { registerCompression } from './http/compress.js';
import { setCacheLogger } from './core/cache.js';
import { registerStaleHeaders } from './core/staleness.js';
import { registerNoStore } from './http/noStore.js';
import { serializeRequest } from './http/logging.js';
import { assertUsers, setupAuth } from './security/auth.js';
import { registerRateLimit } from './http/rateLimit.js';
import { registerHealth } from './http/health.js';
import { registerHostCheck } from './http/hostCheck.js';
import { closeWith, installShutdown } from './http/shutdown.js';
import { hostRoutes } from './routes/hosts.js';
import { deviceRoutes } from './routes/devices.js';
import { problemRoutes } from './routes/problems.js';
import { historyRoutes } from './routes/history.js';
import { netRoutes } from './routes/net.js';
import { meterRoutes } from './routes/meters.js';
import { topHostRoutes } from './routes/topHosts.js';
import { webMonitoringRoutes } from './routes/webMonitoring.js';
import { streamRoutes } from './routes/stream.js';
import { reportRoutes } from './routes/reports.js';
import { mapRoutes } from './routes/maps.js';
import { slaRoutes } from './routes/sla.js';
import { explainRoutes } from './routes/explain.js';
import { siteRoutes } from './routes/sites.js';
import { serviceRoutes } from './routes/services.js';
import { inventoryRoutes } from './routes/inventory.js';
import { linkRoutes } from './routes/links.js';
import { analyticsRoutes } from './routes/analytics.js';
import { actionRoutes } from './routes/actions.js';
import { chatRoutes } from './routes/chat.js';
import { warmModel } from './clients/ai.js';
import { warmUp } from './services/warmUp.js';
import { sliRoutes } from './routes/sli.js';
import { sliExportRoutes } from './routes/sliExport.js';
import { sliMailRoutes } from './routes/sliMail.js';
import { sliScheduleRoutes } from './routes/sliSchedule.js';
import { initPortalState, portalState } from './services/portalState.js';
import { createReportSchedule } from './services/reportSchedule.js';
import { emailReport, sendNotice } from './services/sliMail.js';

const app = Fastify({
  // Fastify's own request log line, except that a `?token=` an old page may
  // still send to the live stream is redacted (logging.ts).
  logger: { level: 'info', serializers: { req: serializeRequest } },
  trustProxy: trustProxyOption(config.trustProxy),
  // Body schemas (schemas.ts) must not coerce types: the handlers refuse "false" and 5.
  ajv: AJV_OPTIONS,
  // The id nginx gave the request, or a new one (requestId.ts).
  genReqId,
});

// A slow report answered from an old copy because Zabbix failed is logged,
// not silent (cache.ts).
setCacheLogger(app.log);

// Fail fast on config that is unsafe rather than merely incomplete: better a
// clear refusal at boot than a portal that looks healthy and isn't.
try {
  assertConfig((m) => app.log.warn(m));
  assertUsers((m) => app.log.warn(m));
} catch (err) {
  app.log.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

// The recipients, the schedule and what was sent (core/state.ts). It never fails: with no folder it keeps them in memory and says so.
await initPortalState((m) => app.log.warn(m));
const reportSchedule = createReportSchedule({
  now: () => Math.floor(Date.now() / 1000),
  state: portalState,
  settings: mailNow,
  send: emailReport,
  notice: sendNotice,
  timezone: config.sla.timezone,
  log: app.log,
});
closeWith(app, reportSchedule);

// X-Request-Id on every reply and `requestId` in every error body. First, so the refusals below
// carry it too (requestId.ts).
registerRequestId(app);

// With sign-in off, only a Host that names this machine is answered: a rebinding page cannot reach
// the dev BFF. Before CORS and every route (hostCheck.ts).
registerHostCheck(app);

// Security headers. `contentSecurityPolicy` is off because this process serves
// JSON only: nginx serves the app, and a CSP here would describe a document
// that never exists while doing nothing for the API.
// `hsts` is off: the portal is served over plain HTTP, and the header would claim a TLS that is not
// there. Behind TLS the proxy sends it, on every reply (docs/operations/tls.md).
await app.register(helmet, { contentSecurityPolicy: false, hsts: false });

// One origin only. The session cookie's CSRF check (auth.ts) relies on this:
// the answer names only WEB_ORIGIN, so another site's preflight for X-HCML-CSRF fails.
await app.register(cors, { origin: config.webOrigin, credentials: true });

// Before setupAuth, so a flood is counted before any JWT is verified (rateLimit.ts).
await registerRateLimit(app);

// Brotli/gzip for JSON bodies (compress.ts). Before every route: a hook only
// reaches the routes registered after it.
registerCompression(app);

// Cache-Control: no-store on every /api reply but the public health check (noStore.ts).
registerNoStore(app);

// X-Data-Stale / X-Data-Age-Seconds on an answer that is an old copy kept
// because Zabbix failed (staleness.ts). Also before the routes.
registerStaleHeaders(app);

// Public: liveness, the build, and whether Zabbix answers (health.ts).
const readiness = registerHealth(app);

registerErrorHandler(app);

// Auth first so its onRequest guard covers the routes registered after it.
await setupAuth(app);

await app.register(hostRoutes);
await app.register(deviceRoutes);
await app.register(problemRoutes);
await app.register(historyRoutes);
await app.register(netRoutes);
await app.register(meterRoutes);
await app.register(topHostRoutes);
await app.register(webMonitoringRoutes);
await app.register(streamRoutes);
await app.register(reportRoutes);
await app.register(mapRoutes);
await app.register(slaRoutes);
await app.register(explainRoutes);
await app.register(siteRoutes);
await app.register(serviceRoutes);
await app.register(inventoryRoutes);
await app.register(linkRoutes);
await app.register(analyticsRoutes);
await app.register(actionRoutes);
await app.register(chatRoutes);
await app.register(sliRoutes);
await app.register(sliExportRoutes);
await app.register(sliMailRoutes);
await app.register(sliScheduleRoutes, { schedule: reportSchedule });

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`HCML BFF listening on ${config.host}:${config.port}`);
  void warmModel(app.log); // load the local model now, not on the first question
  readiness.warm(); // so the first /api/health already has an answer
  void warmUp(app.log); // the main slow views, so their first visitor does not wait (not the other reports or the SLA figures)
  reportSchedule.start();
  installShutdown(app);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
