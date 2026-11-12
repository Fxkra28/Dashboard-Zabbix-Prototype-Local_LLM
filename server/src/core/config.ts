import 'dotenv/config';
import { resolveMail, type MailSettings } from './mailConfig.js';

/**
 * The placeholder JWT secret. Named so `assertConfig` can refuse to start on it
 * rather than comparing against a string literal in two places.
 */
export const DEFAULT_JWT_SECRET = 'dev-insecure-secret-change-me';

/** Secrets published in this repo: the built-in default and the old .env.example value. */
const KNOWN_JWT_SECRETS = [DEFAULT_JWT_SECRET, 'change-me-to-a-long-random-string'];
/** HS256 wants a key at least as long as its 32-byte hash. */
const MIN_JWT_SECRET_BYTES = 32;

/** A sign-in lasts this many hours unless SESSION_HOURS says otherwise. */
export const SESSION_HOURS_DEFAULT = 12;
/** Renewal comes an hour before the end, so a shorter session could never be renewed in time. */
export const SESSION_HOURS_MIN = 2;
export const SESSION_HOURS_MAX = 24;
export const SESSION_EPOCH_DEFAULT = '1';
/** What SESSION_EPOCH may hold: a short label, so it can sit in a token and in a log line. */
export const SESSION_EPOCH_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;

/** SESSION_HOURS as a number when it is a whole or decimal number from 2 to 24, else undefined (unset counts as valid by the caller). */
function validSessionHours(raw: string | undefined): number | undefined {
  const text = (raw ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return undefined;
  const hours = Number(text);
  return hours >= SESSION_HOURS_MIN && hours <= SESSION_HOURS_MAX ? hours : undefined;
}
/** A cookie name is an RFC 6265 token: no spaces, separators or control characters. */
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * A numeric environment variable. Unset, empty and non-numeric all fall back.
 *
 * `Number(process.env.X ?? fallback)` looks equivalent and is not: `??` lets an empty string
 * through (docker-compose interpolates an unset `${X}` to ""), and `Number('')` is 0, so `PORT=`
 * meant "listen on any free port" and `ZABBIX_TIMEOUT_MS=` made every Zabbix call time out at once.
 */
function envNum(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Which LLM backend the plain-language layer talks to. Resolved above `config`
 * because three of the fields below branch on it for their defaults, and an
 * object literal cannot reference its own fields.
 *
 * An unrecognised value falls back to `anthropic` rather than throwing: a typo
 * in AI_PROVIDER should not stop the portal from serving monitoring data.
 * `assertConfig` warns about it.
 */
const AI_PROVIDERS = ['anthropic', 'openai-compatible'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
function toAiProvider(raw: string): AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(raw) ? (raw as AiProvider) : 'anthropic';
}

/**
 * `||` not `??` here and below, for the reason spelled out on `zbxUrl`:
 * docker-compose interpolates an unset `${AI_PROVIDER}` to the empty string,
 * which is not nullish, so `??` would let it win over the default.
 */
const aiProvider = toAiProvider(process.env.AI_PROVIDER || 'anthropic');
/**
 * `AI_API_KEY` is the provider-neutral name. `ANTHROPIC_API_KEY` still works, but only for the
 * Anthropic backend: falling back to it for every provider would send an Anthropic key as a Bearer
 * token to whatever host AI_BASE_URL names, a local Ollama or someone else's gateway. A local model
 * wants no key, so without AI_API_KEY the header is omitted.
 */
const aiKeys: Array<[name: string, value: string | undefined]> = [['AI_API_KEY', process.env.AI_API_KEY]];
if (aiProvider === 'anthropic') aiKeys.push(['ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY]);
/**
 * .env.example ships `ANTHROPIC_API_KEY=your_anthropic_api_key_here`. Taken as a
 * key, an unedited copy turned Explain and the Assistant on, and every click sent
 * estate data to Anthropic only to fail authentication. A value
 * starting `your_` is that placeholder, and reads as unset.
 */
const isPlaceholderKey = (v: string | undefined) => /^your_/i.test((v ?? '').trim());
const aiKeyPlaceholders = aiKeys.filter(([, value]) => isPlaceholderKey(value)).map(([name]) => name);
const aiApiKey = aiKeys.map(([, value]) => value || '').find((v) => v && !isPlaceholderKey(v)) ?? '';
const aiBaseUrl = process.env.AI_BASE_URL || '';

/**
 * `auto` asks the server whether it is Ollama (see ai.ts `usesOllamaNative`);
 * `true` and `false` skip the question. Anything else is `auto`.
 */
export type OllamaNative = 'auto' | 'true' | 'false';
function toOllamaNative(raw: string | undefined): OllamaNative {
  const value = raw?.trim().toLowerCase();
  return value === 'true' || value === 'false' ? value : 'auto';
}

/** A comma-separated environment list, trimmed, empties dropped. */
function csv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * How the derived SLA measures a host (see sli/engine.ts).
 *   availability, strict: total outages and high loss count, hours with no
 *                  collected data are excluded rather than counted as up.
 *   hcml-report: reproduces HCML's published Availability Reports: only
 *                  "High ICMP ping loss", gaps and silent hosts count as up.
 */
/**
 * SLA_NO_DATA_WINDOWS: spans known not to have been measured truly, such as a collector that ran outside HCML's network,
 * as `start/end` ISO times with their zone, comma-separated. Undefined when any span cannot be read. Pure.
 */
export function parseNoDataWindows(raw: string | undefined): [number, number][] | undefined {
  const text = (raw ?? '').trim();
  if (!text) return [];
  const zoned = /(Z|[+-]\d{2}:\d{2})$/;
  const out: [number, number][] = [];
  for (const part of text.split(',')) {
    const ends = part.trim().split('/').map((s) => s.trim());
    if (ends.length !== 2 || !ends.every((s) => zoned.test(s))) return undefined;
    const [from, to] = ends.map((s) => Date.parse(s) / 1000);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return undefined;
    out.push([Math.floor(from), Math.ceil(to)]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** ZBX_TLS_PIN_SHA256 and ZBX_TLS_PIN_UNTIL read together (clients/pinnedTls.ts). */
export interface TlsPin {
  /** Upper-case hex pairs joined by colons, the form of Node's `fingerprint256`. */
  fingerprint256: string;
  /** The last day, YYYY-MM-DD as written. */
  until: string;
  /** The end of that day in WIB. */
  untilMs: number;
}

/** Undefined when either is blank or cannot be read: the exception is then off and an expired certificate is refused. Pure. */
export function parseTlsPin(rawFingerprint: string | undefined, rawUntil: string | undefined): TlsPin | undefined {
  const hex = (rawFingerprint ?? '').replace(/[\s:]/g, '').toUpperCase();
  const until = (rawUntil ?? '').trim();
  if (!/^[0-9A-F]{64}$/.test(hex) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) return undefined;
  // A day the calendar lacks, such as 2026-11-31, would otherwise roll over into the next month.
  const day = Date.parse(`${until}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== until) return undefined;
  return { fingerprint256: (hex.match(/../g) ?? []).join(':'), until, untilMs: Date.parse(`${until}T23:59:59.999+07:00`) };
}

const SLI_PROFILES = ['availability', 'hcml-report'] as const;
export type SliProfile = (typeof SLI_PROFILES)[number];
export function toSliProfile(raw: string | undefined): SliProfile | undefined {
  return (SLI_PROFILES as readonly string[]).includes(raw ?? '') ? (raw as SliProfile) : undefined;
}

/**
 * TRUST_PROXY as Fastify's hop count: `true` is the one nginx in front, a
 * number is that many proxies, anything else trusts none.
 */
function trustProxyHops(raw: string | undefined): number | false {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'true') return 1;
  return /^[1-9]\d*$/.test(v) ? Number(v) : false;
}

/**
 * The hop count as the `trustProxy` option Fastify 5 takes. Fastify 5.12
 * reads a bare number as "trust nobody", which would put every user behind
 * nginx in one rate-limit bucket, so this is Fastify 4's own hop rule.
 */
export function trustProxyOption(hops: number | false): false | ((addr: string, hop: number) => boolean) {
  return hops === false ? false : (_addr, hop) => hop < hops;
}

/**
 * AUTH_ENABLED: unset or empty is on; `true`, `1` and `yes` are on; `false`, `0` and `no` are off,
 * in any case. Anything else is undefined: `config` reads that as on, so a typo never opens the
 * portal, and `assertConfig` refuses to start on it.
 */
const AUTH_ON_VALUES = ['true', '1', 'yes'];
const AUTH_OFF_VALUES = ['false', '0', 'no'];
export function parseAuthEnabled(raw: string | undefined): boolean | undefined {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || AUTH_ON_VALUES.includes(v)) return true;
  return AUTH_OFF_VALUES.includes(v) ? false : undefined;
}

/** Central, typed view of the environment. */
export const config = {
  /**
   * `||` not `??`. docker-compose interpolates an unset `${ZBX_URL}` to the
   * empty string, which is not nullish, with `??` that empty string would win
   * and every Zabbix call would fail with an opaque invalid-URL error instead
   * of falling back to a working default.
   */
  zbxUrl: process.env.ZBX_URL || 'http://localhost:8080/api_jsonrpc.php',
  /**
   * Hard ceiling on a single Zabbix JSON-RPC call. Without this a hung Zabbix
   * hangs the BFF with it: `fetch` has no default timeout, so the request,
   * and every page waiting on it waits forever.
   */
  zbxTimeoutMs: envNum('ZABBIX_TIMEOUT_MS', 10_000),
  /**
   * Read-only Zabbix API token. `ZABBIX_API_TOKEN` is canonical; `ZBX_TOKEN` is
   * kept as a deprecated alias so existing .env files keep working.
   * `||` not `??`: an empty ZABBIX_API_TOKEN must fall through, not win.
   */
  zbxToken: process.env.ZABBIX_API_TOKEN || process.env.ZBX_TOKEN || '',
  /**
   * Separate write-capable token for acknowledge/close (§20). Deliberately not
   * the read token: if writing shared the read credential, every read path in
   * the BFF would silently gain the power to modify Zabbix. Blank = the portal
   * stays strictly read-only and POST /api/problems/acknowledge (close is a flag on it) returns 503.
   */
  zbxWriteToken: process.env.ZABBIX_WRITE_TOKEN || '',
  /** The one expired Zabbix certificate still accepted, and until when. Undefined: the normal check alone. */
  zbxTlsPin: parseTlsPin(process.env.ZBX_TLS_PIN_SHA256, process.env.ZBX_TLS_PIN_UNTIL),
  port: envNum('PORT', 4000),
  /**
   * Interface to listen on. `0.0.0.0` (the default) is what a container needs,
   * so the Docker path is unchanged. For local dev set `HOST=127.0.0.1`: the
   * dev BFF runs with AUTH_ENABLED=false, and on 0.0.0.0 anyone on the same
   * network could read every host, problem and SLA it serves, and reach the
   * acknowledge endpoint, with no login.
   */
  host: process.env.HOST || '0.0.0.0',
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:5173',
  /**
   * Trust `X-Forwarded-For` when the BFF sits behind nginx (the Docker path). Off by default:
   * trusting the header with nothing in front lets any client forge its own IP and rotate past the
   * rate limiter. Behind nginx the opposite holds: without it every request looks like the proxy
   * and all users share one rate-limit bucket.
   *
   * `true` means one hop, the nginx in front, not "trust every hop": plain `true` took the
   * left-most X-Forwarded-For entry, which the client writes, so anyone could pick their own
   * rate-limit key. A number trusts that many proxies.
   */
  trustProxy: trustProxyHops(process.env.TRUST_PROXY),
  /** Requests per minute per IP, before the rate limiter starts returning 429. */
  rateLimitPerMinute: envNum('RATE_LIMIT_PER_MINUTE', 300),
  /**
   * Live screens (GET /api/stream) allowed at once, overall and for one
   * signed-in user. That route is exempt from the rate limit, so this is its
   * only cap. At least 1: a 0 would refuse every screen.
   */
  stream: {
    maxClients: Math.max(1, Math.floor(envNum('STREAM_MAX_CLIENTS', 100))),
    maxPerUser: Math.max(1, Math.floor(envNum('STREAM_MAX_PER_USER', 5))),
  },
  /** Zabbix host group ids that hold network devices (§13). Empty = all hosts. */
  netGroupIds: (process.env.NET_GROUP_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /**
   * How a host is mapped to a physical site (§14). HCML's own review says site
   * mapping isn't standardised yet, so the resolver tries the explicit markers
   * first and falls back to host groups rather than assuming a convention.
   */
  site: {
    /** Host tag carrying the site name. The most explicit signal. */
    tag: process.env.SITE_TAG || 'site',
    /** Only host groups with this prefix name sites (e.g. 'Site/'). Empty = use the host's first group. */
    groupPrefix: process.env.SITE_GROUP_PREFIX ?? '',
  },
  /**
   * Inventory scorecard (§16, HCML Goal 1). Which host tags carry ownership and criticality, and
   * the naming convention to score names against.
   *
   * HCML's real convention, read off the 2026-06/07/08 Availability Reports, is
   * `<site>.<class>[.<seq>] NAME` for devices and `<TYPE> : NAME` for services.
   */
  inventory: {
    ownerTag: process.env.OWNER_TAG || 'owner',
    criticalityTag: process.env.CRITICALITY_TAG || 'criticality',
    /** Regex a compliant host name must match. Empty = don't score naming. */
    namePattern: process.env.HOST_NAME_PATTERN ?? '',
  },
  /**
   * Internet traffic meters (services/meters.ts): the gauge widgets of this Zabbix dashboard say which interfaces to show, each link's
   * capacity and where its colour zones start. HCML's own is the built-in "Global view".
   */
  meters: {
    dashboard: process.env.INTERNET_METERS_DASHBOARD?.trim() || 'Global view',
  },
  /** Link & WAN health (§17, HCML Goal 3): packet-loss thresholds, in percent. */
  links: {
    lossWarn: envNum('LINK_LOSS_WARN', 2),
    lossCrit: envNum('LINK_LOSS_CRIT', 10),
  },
  /**
   * Alert-noise report (§21, HCML Goal 4). An incident shorter than
   * `shortSeconds` cleared before anyone could act; a trigger needs at least
   * `minCount` firings before "flapping" means anything.
   */
  noise: {
    shortSeconds: envNum('NOISE_SHORT_SECONDS', 300),
    minCount: envNum('NOISE_MIN_COUNT', 5),
  },
  reports: {
    /**
     * Default severity floor for the availability report (§18).
     *
     * 2 (Warning), not 3 (Average): HCML's estate fires "High ICMP ping loss"
     * at severity 2 on essentially every trigger: every row of the 2026-06,
     * -07 and -08 Availability Reports. A floor of 3 makes the page open empty
     * for them. Estates that alarm higher can raise this without a code change.
     */
    availabilityMinSeverity: envNum('AVAILABILITY_MIN_SEVERITY', 2),
  },
  /**
   * The derived monthly SLA (sli/engine.ts). HCML's Zabbix has no services, so
   * the portal computes availability itself from the ICMP triggers every
   * device already carries. Read-only, nothing is created in Zabbix.
   */
  sla: {
    /** Promised availability, percent. Every row of HCML's reports uses 99. */
    target: envNum('SLO_TARGET', 99),
    /** Calendar months are cut in this zone, HCML's reports are Asia/Jakarta. */
    timezone: (process.env.SLA_TIMEZONE ?? '').trim() || 'Asia/Jakarta',
    defaultProfile: toSliProfile(process.env.SLI_PROFILE) ?? ('availability' as SliProfile),
    /** Trigger names behind HCML's published figures. */
    reportTriggers: csv(process.env.SLI_REPORT_TRIGGERS || 'High ICMP ping loss'),
    /** Trigger names that mean "unavailable" for the strict profile. */
    availabilityTriggers: csv(
      process.env.SLI_AVAILABILITY_TRIGGERS || 'Unavailable by ICMP ping,High ICMP ping loss',
    ),
    /** Below this share of collected time a host is "no data" rather than a number. */
    minCoverage: envNum('SLI_MIN_COVERAGE', 0.5),
    /** Concurrent Zabbix calls while computing one report. */
    maxParallel: envNum('SLI_ZBX_PARALLEL', 4),
    /** Spans treated as hours with no data, Unix seconds; assertConfig refuses a value it cannot read. */
    noDataWindows: parseNoDataWindows(process.env.SLA_NO_DATA_WINDOWS) ?? [],
  },
  auth: {
    // Secure by default: every HCML source slide is stamped Private and
    // Confidential, so an unguarded portal must be an explicit opt-out.
    enabled: parseAuthEnabled(process.env.AUTH_ENABLED) ?? true,
    jwtSecret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
    user: process.env.PORTAL_USER ?? 'admin',
    pass: process.env.PORTAL_PASS ?? 'admin',
    /**
     * The session cookie's name. Cookies ignore ports, so two portals on one
     * host (127.0.0.1:8081 and :8082) need different names, or signing in to
     * one signs the other out.
     */
    sessionCookie: process.env.SESSION_COOKIE || 'hcml_session',
    /**
     * How long one sign-in lasts, in hours: twelve unless SESSION_HOURS says otherwise. An open
     * portal renews its own an hour before the end, so this bounds how long a forgotten session
     * works, not how long a wall screen stays signed in. Signing out ends the whole chain of renewals;
     * a copy renewed after the owner only closed the tab does not end. A value outside 2 to 24 stops the
     * BFF from starting (`assertConfig`), so the default here is only read for an unset or valid
     * value.
     */
    sessionHours: validSessionHours(process.env.SESSION_HOURS) ?? SESSION_HOURS_DEFAULT,
    /**
     * Raising this ends every session at the next start, without a new JWT_SECRET: a token carries
     * the epoch it was issued under and is refused under any other. A token with none counts as
     * epoch 1, so the default changes nothing for tokens issued before this setting existed.
     */
    sessionEpoch: (process.env.SESSION_EPOCH ?? '').trim() || SESSION_EPOCH_DEFAULT,
    /**
     * Acknowledge and close with sign-in off. With auth off every caller is
     * admin, so a write token in a dev .env let any page that reached the dev server write to
     * Zabbix. Off unless this is "true"; it never reaches the container (compose-env.test.ts).
     */
    allowWriteWithoutAuth: (process.env.ALLOW_WRITE_WITHOUT_AUTH ?? '').trim().toLowerCase() === 'true',
    /**
     * Report email and the monthly schedule with sign-in off, for the same reason: every caller is admin and could send the
     * report to any address. Off unless this is "true"; it never reaches the container (compose-env.test.ts).
     */
    allowEmailWithoutAuth: (process.env.ALLOW_EMAIL_WITHOUT_AUTH ?? '').trim().toLowerCase() === 'true',
  },
  /**
   * Plain-language layer. Optional: unconfigured, the portal still serves every data endpoint and
   * only the "Explain" actions go away.
   *
   * Two backends behind one switch: `anthropic` is the hosted default; `openai-compatible` points
   * at a locally served model (Ollama, vLLM, llama.cpp), which keeps every host name and alert on
   * this machine.
   */
  ai: {
    provider: aiProvider,
    /**
     * What "configured" means differs by backend: a hosted API needs a key, a local one needs a URL
     * and usually has no key at all. This is the line that fails silently if wrong: /api/explain/*
     * would 503 and the UI would hide the buttons while the model sits there answering perfectly.
     */
    enabled: aiProvider === 'anthropic' ? Boolean(aiApiKey) : Boolean(aiBaseUrl),
    /**
     * Questions and estate data leave this machine: only the hosted Anthropic
     * backend does that. The UI says so next to every AI answer,
     * and a local model, on whatever address, shows nothing.
     */
    external: aiProvider === 'anthropic',
    apiKey: aiApiKey,
    /** Base URL of an OpenAI-compatible server, e.g. http://localhost:11434/v1 */
    baseUrl: aiBaseUrl,
    model: process.env.AI_MODEL || (aiProvider === 'anthropic' ? 'claude-sonnet-4-6' : 'qwen3:8b'),
    /**
     * The SDK defaults to a 10-minute timeout and 2 retries, sane for a batch
     * job, far too long for a request a human is waiting on behind a button.
     * A local model generates more slowly and pays a model-load cost on the
     * first call after an idle period, so it gets a much larger ceiling.
     */
    timeoutMs: envNum('AI_TIMEOUT_MS', aiProvider === 'anthropic' ? 30_000 : 120_000),
    /**
     * Anthropic only: the SDK implements the retry. The fetch backend does
     * not retry: a local model that failed once is usually down, not flaky,
     * and a human is waiting behind the button.
     */
    maxRetries: envNum('AI_MAX_RETRIES', 1),
    /**
     * How long a local model stays loaded after its last use (Ollama
     * `keep_alive`). Loading qwen3:8b costs ~10 s on the first question after
     * an idle period; keeping it loaded costs ~5 GB of memory.
     */
    keepAlive: process.env.AI_KEEP_ALIVE || '30m',
    /**
     * Talk to Ollama through its own `/api/chat` rather than the
     * OpenAI-compatible `/v1`. Only the native API takes `num_ctx` and honours
     * `keep_alive`: every `/v1` call puts the model's expiry back to Ollama's
     * 5-minute default. `auto` asks `{root}/api/version`; any other server
     * keeps `/v1`.
     */
    ollamaNative: toOllamaNative(process.env.AI_OLLAMA_NATIVE),
    /**
     * Context window, in tokens, sent with every native request. In Ollama it
     * is a flag of the model's runner process, not a sampling setting: one
     * request with another value (or none) restarts the runner and throws its
     * prompt cache away. Chat, explain, warm-up and prefill therefore all send
     * this one. 8192 tokens of cache take ~0.6 GB; Ollama's default, 4096, half that.
     */
    numCtx: envNum('AI_NUM_CTX', 8192),
    /**
     * Sampling, native API only. Stated rather than left to the server: the
     * `/v1` calls sampled at 1.0 / 1.0. The defaults are Qwen3's recommendation
     * for answers without thinking.
     */
    temperature: envNum('AI_TEMPERATURE', 0.7),
    topP: envNum('AI_TOP_P', 0.8),
    /**
     * What Explain and the Assistant may spend (limits.ts, ai.ts). The per-minute and concurrency
     * numbers are at least 1, since 0 would refuse every call. A daily token budget of 0, or less,
     * switches that budget off. The budgets count the hosted API only: a local model has no bill.
     */
    limits: {
      /** Assistant questions per minute, for each signed-in user. */
      chatPerMinute: Math.max(1, Math.floor(envNum('AI_CHAT_PER_MINUTE', 10))),
      /** Explain calls (problem and SLA together) per minute, for each signed-in user. */
      explainPerMinute: Math.max(1, Math.floor(envNum('AI_EXPLAIN_PER_MINUTE', 10))),
      /** Hosted calls in flight at once; the local model already takes one at a time. */
      maxConcurrent: Math.max(1, Math.floor(envNum('AI_MAX_CONCURRENT', 4))),
      /** Tokens one user may use a day, input and output together. */
      dailyTokensPerUser: Math.max(0, Math.floor(envNum('AI_DAILY_TOKENS_PER_USER', 500_000))),
      /** Tokens the whole portal may use a day. */
      dailyTokensTotal: Math.max(0, Math.floor(envNum('AI_DAILY_TOKENS_TOTAL', 2_000_000))),
    },
  },
  /** A folder that outlives the container, for the portal's small file of its own (core/state.ts). Empty: nothing is kept across a restart. */
  stateDir: (process.env.PORTAL_STATE_DIR ?? '').trim(),

  /** Emailing the SLA report (mailConfig.ts), off until every MAIL_ setting is usable. Each is read here by name so the compose test sees it. */
  mail: resolveMail({
    provider: process.env.MAIL_PROVIDER,
    host: process.env.MAIL_HOST,
    port: process.env.MAIL_PORT,
    security: process.env.MAIL_SECURITY,
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
    from: process.env.MAIL_FROM,
    fromName: process.env.MAIL_FROM_NAME,
    to: process.env.MAIL_TO,
    allowedDomains: process.env.MAIL_ALLOWED_DOMAINS,
    schedule: process.env.MAIL_SCHEDULE,
  }),
};

/**
 * Whether acknowledge and close may run: a write token is set, and either sign-in is on or the
 * dev opt-in is. Read live, so the health reply and the route always agree.
 */
export function writeBackEnabled(): boolean {
  return Boolean(config.zbxWriteToken) && (config.auth.enabled || config.auth.allowWriteWithoutAuth);
}

/**
 * Why the saved list of recipients and the schedule (and what the page shows of them) are refused: sign-in is off and the opt-in is not given. Empty otherwise,
 * whether or not mail is set up, so that a list cannot be planted before it is (SC-49). Read live, like `writeBackEnabled`.
 */
export function signInRefusal(): string {
  if (config.auth.enabled || config.auth.allowEmailWithoutAuth) return '';
  return (
    'Email is off while sign-in is off, because anyone who reaches the portal would count as an administrator. ' +
    'For local development only, set ALLOW_EMAIL_WITHOUT_AUTH=true in server/.env and restart the portal.'
  );
}

/** Why email is refused although it is set up: sign-in is off and the opt-in is not given. Empty otherwise. */
export function emailRefusal(): string {
  return config.mail.enabled ? signInRefusal() : '';
}

/** The mail settings as they apply now: `enabled` is false while email is refused, and `off` says why. */
export function mailNow(): MailSettings & { off: string } {
  const off = emailRefusal();
  return { ...config.mail, enabled: config.mail.enabled && off === '', off };
}

const TIMEOUT_MS_MIN = 1_000;
/** A Node timer longer than this becomes 1 ms, which times every call out at once. */
const TIMEOUT_MS_MAX = 2_147_483_647;

/** True when the runtime knows the zone: the same call `sli/time.ts` makes to cut every month. */
function knownZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** The text of a setting that is set and is not a plain decimal number from `min` to `max`, the ends included. */
function unusableNumber(name: string, min: number, max: number): string | undefined {
  const raw = (process.env[name] ?? '').trim();
  if (raw === '') return undefined;
  const n = /^(\d+(\.\d*)?|\.\d+)$/.test(raw) ? Number(raw) : NaN;
  return n >= min && n <= max ? undefined : raw;
}

const SLA_NUMBERS = [
  { name: 'SLO_TARGET', min: 0, max: 100, what: 'a target', use: 'a percentage from 0 to 100', standard: '99' },
  { name: 'SLI_MIN_COVERAGE', min: 0, max: 1, what: 'a share', use: 'a number from 0 to 1, where 0.5 is half of the time that was collected', standard: '0.5' },
] as const;

/** The text of a timeout setting that is set and is not a whole number of milliseconds a call can wait. */
function unusableTimeout(name: string): string | undefined {
  const raw = (process.env[name] ?? '').trim();
  if (raw === '') return undefined;
  const ms = /^\d+$/.test(raw) ? Number(raw) : NaN;
  return ms >= TIMEOUT_MS_MIN && ms <= TIMEOUT_MS_MAX ? undefined : raw;
}

/**
 * Warn on suspicious config so the scaffold still boots, except for a weak
 * signing secret when auth is on, an AUTH_ENABLED it cannot read, or a session
 * cookie name no browser takes.
 *
 * An authenticated portal signing tokens with a secret published in this repo,
 * or one short enough to guess offline, is not a degraded state, it is a
 * security hole that looks healthy: every page loads, every login succeeds,
 * and anyone can mint an admin token. Both cases throw. Weak passwords are
 * refused the same way, by `assertUsers` in auth.ts.
 */
export function assertConfig(warn: (msg: string) => void): void {
  if (parseAuthEnabled(process.env.AUTH_ENABLED) === undefined) {
    throw new Error(
      `AUTH_ENABLED="${process.env.AUTH_ENABLED}" is not a value the portal knows. ` +
        'Use true, 1 or yes to turn sign-in on, false, 0 or no to turn it off, or leave it unset or empty to keep it on.',
    );
  }
  if (config.auth.enabled && KNOWN_JWT_SECRETS.includes(config.auth.jwtSecret)) {
    throw new Error(
      'AUTH_ENABLED=true but JWT_SECRET is a value published in this repo. ' +
        'Anyone with the repo could forge an admin token. Set one from `openssl rand -hex 32`.',
    );
  }
  if (config.auth.enabled && Buffer.byteLength(config.auth.jwtSecret) < MIN_JWT_SECRET_BYTES) {
    throw new Error(
      `AUTH_ENABLED=true but JWT_SECRET is shorter than ${MIN_JWT_SECRET_BYTES} bytes, ` +
        'short enough to guess offline from one token. Set one from `openssl rand -hex 32`.',
    );
  }
  // A name the cookie format cannot carry makes every sign-in fail with a 500.
  if (!COOKIE_NAME.test(config.auth.sessionCookie)) {
    throw new Error(
      `SESSION_COOKIE "${config.auth.sessionCookie}" is not a valid cookie name. ` +
        'Use letters, digits, "_" or "-", for example hcml_session.',
    );
  }
  // A session length or epoch that cannot be read must not fall back quietly: someone who wrote
  // SESSION_HOURS=1 to shorten sessions would otherwise get twelve hours and no word of it.
  const hours = (process.env.SESSION_HOURS ?? '').trim();
  if (hours !== '' && validSessionHours(hours) === undefined) {
    throw new Error(
      `SESSION_HOURS="${hours}" is not a length of session the portal can use. ` +
        `Use a number of hours from ${SESSION_HOURS_MIN} to ${SESSION_HOURS_MAX} (an open portal renews an hour before the end), ` +
        `or leave it unset for ${SESSION_HOURS_DEFAULT}.`,
    );
  }
  if (!SESSION_EPOCH_PATTERN.test(config.auth.sessionEpoch)) {
    throw new Error(
      `SESSION_EPOCH "${config.auth.sessionEpoch}" is not a label the portal can put in a token. ` +
        'Use up to 32 letters, digits, "." "_" or "-", for example 2.',
    );
  }
  // A span that cannot be read would otherwise count real downtime that was meant to be left out, with no word of it.
  if (parseNoDataWindows(process.env.SLA_NO_DATA_WINDOWS) === undefined) {
    throw new Error(
      `SLA_NO_DATA_WINDOWS="${process.env.SLA_NO_DATA_WINDOWS}" cannot be read. Write each span as start/end in ISO time ` +
        'with its zone, comma-separated, for example 2026-10-26T16:10+07:00/2026-10-26T21:03+07:00.',
    );
  }
  // A zone Intl rejects makes every SLA page answer 500 while /api/health stays green.
  if (!knownZone(config.sla.timezone)) {
    throw new Error(
      `SLA_TIMEZONE="${config.sla.timezone}" is not a time zone the portal knows. ` +
        'Use a name from the IANA list, for example Asia/Jakarta, or leave it unset for Asia/Jakarta.',
    );
  }
  // A timeout of 0 fails every call at once, and a word or a unit would otherwise fall back to the default unnoticed.
  for (const name of ['ZABBIX_TIMEOUT_MS', 'AI_TIMEOUT_MS']) {
    const bad = unusableTimeout(name);
    if (bad !== undefined) {
      throw new Error(
        `${name}="${bad}" is not a timeout the portal can use. ` +
          `Use a whole number of milliseconds from ${TIMEOUT_MS_MIN} to ${TIMEOUT_MS_MAX}, or leave it unset to keep the default.`,
      );
    }
  }
  // A value out of range would run, and one that is not a number would fall back to the standard, each with no word of it.
  for (const { name, min, max, what, use, standard } of SLA_NUMBERS) {
    const bad = unusableNumber(name, min, max);
    if (bad !== undefined) throw new Error(`${name}="${bad}" is not ${what} the portal can use. Use ${use}, or leave it unset for ${standard}.`);
  }
  try {
    new URL(config.zbxUrl);
  } catch {
    warn(`ZBX_URL is not a valid URL ("${config.zbxUrl}"): every Zabbix call will fail.`);
  }
  const pin = config.zbxTlsPin;
  const renewed = 'Once the certificate is renewed, delete ZBX_TLS_PIN_SHA256 and ZBX_TLS_PIN_UNTIL.';
  if (!pin && [process.env.ZBX_TLS_PIN_SHA256, process.env.ZBX_TLS_PIN_UNTIL].some((v) => v?.trim())) {
    warn(
      'ZBX_TLS_PIN_SHA256 and ZBX_TLS_PIN_UNTIL go together: a SHA-256 fingerprint of 64 hex digits and a date as YYYY-MM-DD. ' +
        'One is missing or cannot be read, so an expired Zabbix certificate is refused.',
    );
  } else if (pin && !/^https:/i.test(config.zbxUrl)) {
    warn('ZBX_TLS_PIN_SHA256 is set but ZBX_URL is not https, so the pin is not used.');
  } else if (pin) {
    warn(
      Date.now() > pin.untilMs
        ? `The exception for an expired Zabbix certificate ended on ${pin.until}, so that certificate is refused. ${renewed}`
        : `ZBX_TLS_PIN_SHA256 is set: while Zabbix's certificate stays expired, that one certificate is accepted ` +
            `until the end of ${pin.until} WIB. ${renewed}`,
    );
  }
  if (!config.zbxToken) {
    warn('ZABBIX_API_TOKEN is not set: Zabbix calls will fail until you set it in server/.env');
  }
  if (!process.env.ZABBIX_API_TOKEN && process.env.ZBX_TOKEN) {
    warn('ZBX_TOKEN is deprecated. Rename it to ZABBIX_API_TOKEN in server/.env.');
  }
  // The case that matters most: running wide open.
  if (!config.auth.enabled) {
    warn('AUTH_ENABLED=false: the portal is UNAUTHENTICATED. Never do this outside local dev.');
    if (config.host === '0.0.0.0') {
      warn(
        'AUTH_ENABLED=false and HOST=0.0.0.0: every data endpoint is reachable from the network ' +
          'with no login. Set HOST=127.0.0.1 in server/.env for local dev.',
      );
    }
  }
  if (!config.zbxWriteToken) {
    warn('ZABBIX_WRITE_TOKEN is not set: acknowledge/close is disabled (portal stays read-only).');
  } else if (!config.auth.enabled) {
    warn(
      config.auth.allowWriteWithoutAuth
        ? 'ALLOW_WRITE_WITHOUT_AUTH=true: with sign-in off, anyone who reaches this server can acknowledge and close problems.'
        : 'ZABBIX_WRITE_TOKEN is set but AUTH_ENABLED=false: acknowledge/close is refused. ' +
            'For local dev only, set ALLOW_WRITE_WITHOUT_AUTH=true to allow it.',
    );
  }
  const rawProvider = process.env.AI_PROVIDER;
  if (rawProvider && !(AI_PROVIDERS as readonly string[]).includes(rawProvider)) {
    warn(
      `AI_PROVIDER="${rawProvider}" is not a known backend: expected ` +
        `${AI_PROVIDERS.join(' or ')}. Falling back to "anthropic".`,
    );
  }
  if (aiKeyPlaceholders.length) {
    warn(
      `Ignoring ${aiKeyPlaceholders.join(' and ')}: the value is still the placeholder from .env.example. ` +
        'Set a real key, or leave it empty.',
    );
  }
  if (!config.ai.enabled) {
    warn(
      config.ai.provider === 'anthropic'
        ? 'ANTHROPIC_API_KEY is not set: /api/explain/* will return 503 and the UI hides "Explain".'
        : 'AI_BASE_URL is not set: /api/explain/* will return 503 and the UI hides "Explain". ' +
            'Point it at your local model, e.g. http://localhost:11434/v1',
    );
  }
  for (const problem of config.mail.problems) warn(`Email is off. ${problem}`);
  if (emailRefusal()) warn(emailRefusal());
  else if (config.mail.enabled && !config.auth.enabled) {
    warn('ALLOW_EMAIL_WITHOUT_AUTH=true: with sign-in off, anyone who reaches this server can email the report to any address and set the monthly schedule.');
  }
  if (config.mail.enabled && config.mail.allowedDomains.length === 0) {
    warn('Email can send a report to any address. Set MAIL_ALLOWED_DOMAINS (for example hcml.co.id) to limit it to your own domains.');
  }
}
