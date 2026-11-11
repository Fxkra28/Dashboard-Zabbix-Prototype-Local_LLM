import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, SECRET } from './helpers/authApp.js';
import { zabbixAnswer } from './helpers/fakeZabbix.js';

/**
 * Every operation in docs/api/openapi.yaml asked for once on a made-up estate: its status and body must be what the file
 * documents, read from its JSON copy (web/src/generated/openapi.json), as the server has no YAML parser.
 */

const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});
// A model that answers at once, so Explain is held to the file too. No request leaves the test.
vi.mock('../clients/ai.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/ai.js')>();
  return {
    ...actual,
    humanize: vi.fn(async (kind: string) =>
      kind === 'problem'
        ? { summary: 'A link is down.', tagsExplained: [], businessImpact: 'None yet.', recommendation: 'Check the cable.' }
        : { status: 'On target', plain: 'Up all month.', meetingTarget: true, recommendation: 'Nothing to do.' },
    ),
    warmModel: vi.fn(async () => undefined),
    prefillModel: vi.fn(async () => true),
  };
});

type Schema = Record<string, unknown>;
interface Operation {
  responses: Record<string, { $ref?: string; content?: Record<string, { schema?: Schema }> }>;
  parameters?: { name: string; in: string; $ref?: string }[];
}
type PathItem = Record<string, Operation> & { parameters?: Operation['parameters'] };
interface Spec {
  paths: Record<string, PathItem>;
  components: { responses: Record<string, { content?: Record<string, { schema?: Schema }> }>; parameters?: Record<string, { name: string; in: string }> };
}

const spec = JSON.parse(readFileSync(fileURLToPath(new URL('../../../web/src/generated/openapi.json', import.meta.url)), 'utf8')) as Spec;

// The validator Fastify itself uses, reached through Fastify's compiler, so nothing is added to package.json.
const fromFastify = createRequire(createRequire(import.meta.url).resolve('@fastify/ajv-compiler'));
const { default: Ajv2020 } = fromFastify('ajv/dist/2020') as { default: new (opts: object) => AjvLike };
interface AjvLike {
  addSchema(schema: object, key: string): void;
  compile(schema: object): ((data: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] | null };
}
// `example` and `format` are OpenAPI's, not JSON Schema's: read past them.
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
ajv.addSchema(spec, 'openapi.json');

const pointer = (...parts: string[]) => parts.map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');

/** The answers the file lists for one status, with a `$ref` to components/responses followed. */
function documented(op: Operation, status: number) {
  const entry = op.responses[String(status)] ?? op.responses.default;
  if (!entry) return null;
  if (entry.$ref) {
    const name = entry.$ref.replace('#/components/responses/', '');
    return { content: spec.components.responses[name]?.content, at: ['components', 'responses', name, 'content'] };
  }
  return { content: entry.content, at: null };
}

/** Query names an operation declares, with shared parameters followed. */
function queryNames(item: PathItem, op: Operation): string[] {
  const all = [...(item.parameters ?? []), ...(op.parameters ?? [])];
  return all
    .map((p) => (p.$ref ? spec.components.parameters?.[p.$ref.replace('#/components/parameters/', '')] : p))
    .filter((p): p is { name: string; in: string } => p?.in === 'query')
    .map((p) => p.name);
}

/** Values that make each operation answer from the fixtures, not with its 400. */
const SAMPLE: Record<string, string> = {
  '/api/items': '?hostid=10689',
  '/api/latest': '?hostid=10689&page=1',
  '/api/graph': '?itemids=4001&hours=24',
  '/api/net/interfaces': '?hostid=10689',
  '/api/maps/detail': '?mapid=1',
  '/api/explain/problem': '?eventid=109',
  '/api/explain/sla': '?source=derived&month=2026-09',
  '/api/sla/sli': '?slaid=1',
  '/api/sli': '?month=2026-09',
  '/api/services/derived': '?month=2026-09',
  '/api/sli/export': '?month=2026-09&format=xlsx',
  '/api/reports/availability': '?days=7',
};

const BODY: Record<string, object> = {
  '/api/auth/login': { username: 'adi', password: 'admin-pass' },
  '/api/auth/refresh': {},
  '/api/auth/logout': {},
  '/api/problems/acknowledge': { eventids: ['109'], acknowledge: true },
  '/api/sli/email': { month: '2026-09', formats: ['pdf'] },
  '/api/sli/schedule': { enabled: true, day: 1, time: '00:00', formats: ['pdf'], recipients: ['ana@example.org'], notify: [] },
};

/** Sign-out and renewal end the session they are sent with, so each gets one of its own. */
const OWN_SESSION = new Set(['/api/auth/refresh', '/api/auth/logout']);

/** Answers that never end, which inject() cannot wait for; tests of their own cover them (stream.test.ts, chat-route.test.ts). */
const STREAMS = new Set(['get /api/stream', 'post /api/chat']);

let app: FastifyInstance;
let token = '';

beforeAll(async () => {
  // The month asked for is 2026-09, which the engine refuses once it is more than about 400 days back.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-17T03:00:00Z'));
  vi.resetModules();
  for (const [key, value] of Object.entries({
    AUTH_ENABLED: 'true',
    JWT_SECRET: SECRET,
    PORTAL_USERS: 'ana:viewer-pass:viewer,olu:operator-pass:operator,adi:admin-pass:admin',
    PORTAL_USER: 'admin',
    PORTAL_PASS: 'a-long-real-password',
    ZABBIX_WRITE_TOKEN: '',
    AI_PROVIDER: 'openai-compatible',
    AI_BASE_URL: 'http://127.0.0.1:9/v1',
    ANTHROPIC_API_KEY: '',
    AI_API_KEY: '',
  })) {
    vi.stubEnv(key, value);
  }
  zbxMock.mockImplementation(zabbixAnswer);

  const { AJV_OPTIONS } = await import('../core/schemas.js');
  const { registerErrorHandler } = await import('../http/errors.js');
  const { registerHealth } = await import('../http/health.js');
  const { setupAuth } = await import('../security/auth.js');
  const routes = await Promise.all([
    import('../routes/hosts.js').then((m) => m.hostRoutes),
    import('../routes/devices.js').then((m) => m.deviceRoutes),
    import('../routes/problems.js').then((m) => m.problemRoutes),
    import('../routes/history.js').then((m) => m.historyRoutes),
    import('../routes/net.js').then((m) => m.netRoutes),
    import('../routes/meters.js').then((m) => m.meterRoutes),
    import('../routes/topHosts.js').then((m) => m.topHostRoutes),
    import('../routes/webMonitoring.js').then((m) => m.webMonitoringRoutes),
    import('../routes/stream.js').then((m) => m.streamRoutes),
    import('../routes/reports.js').then((m) => m.reportRoutes),
    import('../routes/maps.js').then((m) => m.mapRoutes),
    import('../routes/sla.js').then((m) => m.slaRoutes),
    import('../routes/explain.js').then((m) => m.explainRoutes),
    import('../routes/sites.js').then((m) => m.siteRoutes),
    import('../routes/services.js').then((m) => m.serviceRoutes),
    import('../routes/inventory.js').then((m) => m.inventoryRoutes),
    import('../routes/links.js').then((m) => m.linkRoutes),
    import('../routes/analytics.js').then((m) => m.analyticsRoutes),
    import('../routes/actions.js').then((m) => m.actionRoutes),
    import('../routes/chat.js').then((m) => m.chatRoutes),
    import('../routes/sli.js').then((m) => m.sliRoutes),
    import('../routes/sliExport.js').then((m) => m.sliExportRoutes),
    import('../routes/sliMail.js').then((m) => m.sliMailRoutes),
    // The schedule is the scheduler's to run; here it only has to answer the questions the routes ask of it.
    import('../routes/sliSchedule.js').then((m) => async (instance: FastifyInstance) => {
      await instance.register(m.sliScheduleRoutes, { schedule: { availability: () => ({ available: true, why: '' }), next: () => null, problem: () => '' } });
    }),
  ]);

  app = Fastify({ logger: false, ajv: AJV_OPTIONS });
  registerHealth(app);
  registerErrorHandler(app);
  await setupAuth(app);
  for (const plugin of routes) await app.register(plugin);
  await app.ready();

  token = await signIn();
  expect(token, 'signed in as an admin').not.toBe('');
}, 60_000);

async function signIn(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: page(), payload: { username: 'adi', password: 'admin-pass' } });
  return res.cookies.find((c) => c.name === 'hcml_session')?.value ?? '';
}

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
    .map(([method, op]) => ({ method, path, op: op as Operation, item })),
);

describe('every answer fits docs/api/openapi.yaml (BK-14)', () => {
  it('lists the operations the test asks for', () => {
    expect(operations.length).toBeGreaterThanOrEqual(45);
  });

  it.each(operations.filter((o) => !STREAMS.has(`${o.method} ${o.path}`)).map((o) => [`${o.method.toUpperCase()} ${o.path}`, o] as const))(
    '%s',
    async (_label, { method, path, op }) => {
      const session = OWN_SESSION.has(path) ? await signIn() : token;
      const res = await app.inject({
        method: method.toUpperCase() as 'GET',
        url: path + (SAMPLE[path] ?? ''),
        headers: page(session),
        ...(method === 'get' ? {} : { payload: BODY[path] ?? {} }),
      });
      const answer = documented(op, res.statusCode);
      expect(answer, `${res.statusCode} is not documented for it: ${res.body.slice(0, 200)}`).not.toBeNull();
      const type = String(res.headers['content-type'] ?? '').split(';')[0];
      if (!answer?.content) return;
      expect(Object.keys(answer.content), `answered ${type}`).toContain(type);
      if (type !== 'application/json') return;
      const at = pointer(...(answer.at ?? ['paths', path, method, 'responses', String(res.statusCode), 'content']), type, 'schema');
      const validate = ajv.compile({ $ref: `openapi.json#/${at}` });
      const fits = validate(res.json());
      expect(fits ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || '(the answer)'} ${e.message}`), `the ${res.statusCode} body`).toEqual([]);
    },
  );

  const declaring = operations.filter((o) => o.method === 'get' && queryNames(o.item, o.op).length);

  it('finds the operations that declare query names', () => {
    expect(declaring.length).toBeGreaterThanOrEqual(17);
  });

  it.each(declaring.map((o) => [`GET ${o.path}`, o] as const))('%s: a name sent twice is the documented 400', async (_label, { path, op, item }) => {
    zbxMock.mockClear();
    const name = queryNames(item, op)[0];
    const res = await app.inject({ url: `${path}?${name}=1&${name}=2`, headers: page(token) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad_request', message: `${name} must be given once.` });
    expect(op.responses['400'], 'the file documents the 400').toBeDefined();
    expect(zbxMock).not.toHaveBeenCalled();
  });
});
