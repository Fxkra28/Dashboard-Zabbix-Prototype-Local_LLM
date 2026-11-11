import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { config, writeBackEnabled } from '../core/config.js';
import { isSignedIn } from '../security/auth.js';
import { zbx, ZabbixAuthError, ZabbixTimeoutError } from '../clients/zabbix.js';
import { connectedClients } from '../services/stream.js';

/**
 * GET /api/health, public: no host, address or token in it. Anyone gets the liveness
 * fields and `ready`, a plain true or false for whether Zabbix answers (one cached call, 2 s limit);
 * a signed-in caller also gets the version, build, start time, screens and `ready` as the whole
 * check. The status stays 200 either way.
 */

/** A check this old is fresh. */
export const READY_TTL_MS = 15_000;
/** Between TTL and this, the old answer goes out at once while a new check runs; past it, the caller waits. */
export const READY_STALE_MS = 60_000;
/** Each check gives up after this, so health never hangs on a stuck Zabbix. */
export const READY_TIMEOUT_MS = 2_000;

export type ZabbixState = 'ok' | 'token_rejected' | 'timeout' | 'error';
/** `off` is no model configured; `not_checked` is hosted Anthropic, which a probe would bill. */
export type ModelState = 'ok' | 'down' | 'off' | 'not_checked';

export interface Readiness {
  /** The portal can read Zabbix. The model never gates it: the AI layer is optional. */
  ok: boolean;
  zabbix: ZabbixState;
  /** How long the Zabbix call took; null when it did not answer. */
  zabbixMs: number | null;
  model: ModelState;
  /** When these answers were read, epoch ms. */
  checkedAt: number;
}

export interface Probes {
  /** Resolves when Zabbix answered the read-only token's call; rejects with what went wrong. */
  zabbix(): Promise<unknown>;
  model(): Promise<ModelState>;
}

/** The cheapest authenticated read there is. `apiinfo.version` is not it: Zabbix refuses it with a token. */
const zabbixProbe = () => zbx('host.get', { output: ['hostid'], limit: 1 });

async function modelProbe(): Promise<ModelState> {
  if (!config.ai.enabled) return 'off';
  if (config.ai.provider !== 'openai-compatible') return 'not_checked';
  try {
    const res = await fetch(`${config.ai.baseUrl.replace(/\/+$/, '')}/models`, {
      // The key chat sends (ai.ts postModel): a gateway that wants one refuses the list without it.
      headers: config.ai.apiKey ? { Authorization: `Bearer ${config.ai.apiKey}` } : {},
      signal: AbortSignal.timeout(READY_TIMEOUT_MS),
    });
    void res.body?.cancel();
    return res.ok ? 'ok' : 'down';
  } catch {
    return 'down';
  }
}

const TIMED_OUT = Symbol('timed out');

function stateOf(err: unknown): ZabbixState {
  if (err === TIMED_OUT || err instanceof ZabbixTimeoutError) return 'timeout';
  return err instanceof ZabbixAuthError ? 'token_rejected' : 'error';
}

export interface ReadinessOptions {
  probes?: Probes;
  now?: () => number;
  ttlMs?: number;
  staleMs?: number;
  timeoutMs?: number;
}

/** The cached check. One in flight at a time, so polling health cannot pile calls onto Zabbix. */
export function createReadiness(opts: ReadinessOptions = {}) {
  const probes = opts.probes ?? { zabbix: zabbixProbe, model: modelProbe };
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? READY_TTL_MS;
  const staleMs = opts.staleMs ?? READY_STALE_MS;
  const timeoutMs = opts.timeoutMs ?? READY_TIMEOUT_MS;
  let last: Readiness | null = null;
  let flight: Promise<Readiness> | null = null;

  async function check(): Promise<Readiness> {
    const started = now();
    let timer: NodeJS.Timeout | undefined;
    const call = Promise.resolve().then(probes.zabbix);
    call.catch(() => undefined); // abandoned on a timeout: its late failure is not news
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(TIMED_OUT), timeoutMs);
      timer.unref?.();
    });
    const [z, model] = await Promise.all([
      Promise.race([call, limit]).then(
        (): { state: ZabbixState; ms: number | null } => ({ state: 'ok', ms: now() - started }),
        (err: unknown) => ({ state: stateOf(err), ms: null }),
      ),
      probes.model().catch((): ModelState => 'down'),
    ]);
    clearTimeout(timer);
    return { ok: z.state === 'ok', zabbix: z.state, zabbixMs: z.ms, model, checkedAt: now() };
  }

  function refresh(): Promise<Readiness> {
    flight ??= check()
      .then((r) => (last = r))
      .finally(() => {
        flight = null;
      });
    return flight;
  }

  return {
    /** The answer to give now: fresh, recent and refreshing behind it, or a new check if there is none worth giving. */
    async get(): Promise<Readiness> {
      if (last) {
        const age = now() - last.checkedAt;
        if (age < ttlMs) return last;
        if (age < staleMs) {
          void refresh();
          return last;
        }
      }
      return refresh();
    },
    /** Start the first check without waiting, so the first health call finds an answer. */
    warm(): void {
      void refresh();
    },
  };
}

const startedAt = new Date().toISOString();

/** The package version: dist/http/ and src/http/ both sit two levels under package.json. */
function readVersion(): string {
  try {
    const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof version === 'string' ? version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** What the image's BUILD_COMMIT and BUILD_TIME arguments set; "unknown" when unset or empty. */
const fromEnv = (name: string): string => (process.env[name] ?? '').trim().slice(0, 64) || 'unknown';

export function registerHealth(app: FastifyInstance, readiness = createReadiness()) {
  const version = readVersion();
  /** The build and process facts a signed-in caller gets from /api/health and /api/ready. */
  const stack = () => ({
    version,
    startedAt,
    build: { commit: fromEnv('BUILD_COMMIT'), time: fromEnv('BUILD_TIME') },
    streams: connectedClients(),
  });

  // For a monitor that holds a session or Bearer token: unlike /api/health, whose status is always
  // 200, this answers 503 while the portal cannot read Zabbix, so a status check is enough. Guarded
  // like any route: it reads the same cached check and shows what a signed-in /api/health shows.
  app.get('/api/ready', async (_req, reply) => {
    const ready = await readiness.get();
    return reply.code(ready.ok ? 200 : 503).send({ ...ready, ...stack() });
  });

  // The container's check asks every ten seconds, so its request lines were nearly all of the log: this route logs at warning level and above (IN-64).
  app.get('/api/health', { logLevel: 'warn' }, async (req) => ({
    ok: true,
    ts: Date.now(),
    // `ai` and `writeBack` let the UI hide actions that aren't configured, instead
    // of offering a button that can only fail.
    ai: config.ai.enabled,
    // Lets the UI say, next to every AI answer, when the question left this machine.
    // Only the hosted API does; a local model shows nothing.
    aiProvider: config.ai.provider,
    aiExternal: config.ai.enabled && config.ai.external,
    // Off too when sign-in is off and the dev opt-in is not set: the route would refuse.
    writeBack: writeBackEnabled(),
    // Server-owned defaults the UI should agree with rather than restate. The
    // availability floor in particular is site-specific, HCML alarms at 2,
    // and a hardcoded client default would silently disagree with the server.
    defaults: {
      availabilityMinSeverity: config.reports.availabilityMinSeverity,
      // The SLA zone (SLA_TIMEZONE): the web labels times and cuts its month lists in it, as the reports do.
      timezone: config.sla.timezone,
    },
    // The build, the restart and why Zabbix fails are for a signed-in caller only: this route is public. Anyone may know
    // that it is ready or not, so a watcher needs no account (IN-47); a revoked token reads as any other failure.
    ...(isSignedIn(req) ? { ...stack(), ready: await readiness.get() } : { ready: (await readiness.get()).ok }),
  }));
  return readiness;
}
