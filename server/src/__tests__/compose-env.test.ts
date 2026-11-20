import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLocalBaseUrl } from '../core/localHost.js';

/**
 * docker-compose.yml against what the BFF reads.
 *
 * Compose hands the container only the variables it lists, and there is no env_file, so a setting
 * the BFF reads but compose leaves out is ignored in Docker without a word. This runs against
 * whichever copy it sits in, so it allows for the one thing the two compose files do differ on in
 * this respect (the Anthropic key).
 */
const root = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const SRC = fileURLToPath(new URL('..', import.meta.url));

/** Variables the BFF reads and compose deliberately does not pass, with the reason. */
const NOT_PASSED: Record<string, string> = {
  HOST: 'the container must listen on 0.0.0.0, so the HOST=127.0.0.1 of local dev must never reach it',
  ZBX_TOKEN: 'a deprecated alias; passing it beside ZABBIX_API_TOKEN would trip the startup warning',
  ANTHROPIC_API_KEY: 'hcml-portal-ollama passes no Anthropic key on purpose (tracker IN-03)',
  ALLOW_WRITE_WITHOUT_AUTH: 'a local-dev opt-in; the container always signs in, so it must never reach it (tracker SC-07)',
  ALLOW_EMAIL_WITHOUT_AUTH: 'a local-dev opt-in; the container always signs in, so it must never reach it (tracker SC-43)',
};

/** The report email's settings: both copies pass them (FR-56). */
const MAIL_VARS = ['MAIL_PROVIDER', 'MAIL_HOST', 'MAIL_PORT', 'MAIL_SECURITY', 'MAIL_USER', 'MAIL_PASS', 'MAIL_FROM', 'MAIL_FROM_NAME', 'MAIL_TO', 'MAIL_ALLOWED_DOMAINS', 'MAIL_SCHEDULE'];

/** What makes hcml-portal-ollama refuse a model outside this machine's network. hcml-portal may use the hosted API, so it has no promise to keep. */
const LOCAL_ONLY_VARS = ['AI_LOCAL_ONLY', 'AI_ALLOW_REMOTE'];
for (const v of LOCAL_ONLY_VARS) NOT_PASSED[v] = 'only hcml-portal-ollama, which promises that no question leaves the machine, passes it (tracker SC-53)';

/** Every variable named in the non-test sources under src/: process.env.X, process.env['X'] and envNum('X'). */
function variablesRead(dir = SRC): Set<string> {
  const found = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') for (const v of variablesRead(path)) found.add(v);
    } else if (entry.name.endsWith('.ts')) {
      const text = readFileSync(path, 'utf8');
      for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|process\.env\[['"]([A-Z][A-Z0-9_]+)['"]\]|envNum\('([A-Z][A-Z0-9_]+)'/g)) {
        found.add((m[1] ?? m[2] ?? m[3]) as string);
      }
    }
  }
  return found;
}

interface Passed {
  /** The text after `${NAME:-`, or null when the value is fixed or has no default. */
  fallback: string | null;
}

/** The portal-bff service's `environment:` block, name by name. Plain line reading: no YAML parser here. */
function passed(): Map<string, Passed> {
  const lines = readFileSync(root('docker-compose.yml'), 'utf8').split('\n');
  const start = lines.findIndex((l) => /^ {2}portal-bff:\s*$/.test(l));
  const env = lines.findIndex((l, i) => i > start && /^ {4}environment:\s*$/.test(l));
  expect(start, 'a portal-bff service').toBeGreaterThanOrEqual(0);
  expect(env, 'its environment block').toBeGreaterThan(start);
  const out = new Map<string, Passed>();
  for (const line of lines.slice(env + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (!/^ {6}\S/.test(line)) break; // the next key of the service
    const m = /^ {6}([A-Z][A-Z0-9_]*):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const interpolated = /^\$\{[A-Z0-9_]+:-([^}]*)\}$/.exec(m[2]);
    out.set(m[1], { fallback: interpolated ? interpolated[1] : null });
  }
  return out;
}

/** Defaults compose gives that config.ts must give too: how to read each one off `config`. */
type Config = typeof import('../core/config.js').config;
const SAME_AS_CONFIG: Record<string, (c: Config) => unknown> = {
  RATE_LIMIT_PER_MINUTE: (c) => c.rateLimitPerMinute,
  STREAM_MAX_CLIENTS: (c) => c.stream.maxClients,
  STREAM_MAX_PER_USER: (c) => c.stream.maxPerUser,
  ACTION_EVENTS_PER_MINUTE: (c) => c.actions.eventsPerMinute,
  SITE_TAG: (c) => c.site.tag,
  OWNER_TAG: (c) => c.inventory.ownerTag,
  CRITICALITY_TAG: (c) => c.inventory.criticalityTag,
  LINK_LOSS_WARN: (c) => c.links.lossWarn,
  LINK_LOSS_CRIT: (c) => c.links.lossCrit,
  INTERNET_METERS_DASHBOARD: (c) => c.meters.dashboard,
  NOISE_SHORT_SECONDS: (c) => c.noise.shortSeconds,
  NOISE_MIN_COUNT: (c) => c.noise.minCount,
  AVAILABILITY_MIN_SEVERITY: (c) => c.reports.availabilityMinSeverity,
  SLO_TARGET: (c) => c.sla.target,
  SLA_TIMEZONE: (c) => c.sla.timezone,
  SLI_PROFILE: (c) => c.sla.defaultProfile,
  SLI_REPORT_TRIGGERS: (c) => c.sla.reportTriggers.join(','),
  SLI_AVAILABILITY_TRIGGERS: (c) => c.sla.availabilityTriggers.join(','),
  SLI_MIN_COVERAGE: (c) => c.sla.minCoverage,
  SLI_ZBX_PARALLEL: (c) => c.sla.maxParallel,
  AI_MAX_RETRIES: (c) => c.ai.maxRetries,
  AI_KEEP_ALIVE: (c) => c.ai.keepAlive,
  AI_OLLAMA_NATIVE: (c) => c.ai.ollamaNative,
  AI_NUM_CTX: (c) => c.ai.numCtx,
  AI_TEMPERATURE: (c) => c.ai.temperature,
  AI_TOP_P: (c) => c.ai.topP,
  ACCOUNT_REQUESTS_MAX_PENDING: (c) => c.auth.accountRequests.maxPending,
  ACCOUNT_REQUESTS_PER_ADDRESS: (c) => c.auth.accountRequests.perAddressPerDay,
  AI_CHAT_PER_MINUTE: (c) => c.ai.limits.chatPerMinute,
  AI_EXPLAIN_PER_MINUTE: (c) => c.ai.limits.explainPerMinute,
  AI_MAX_CONCURRENT: (c) => c.ai.limits.maxConcurrent,
  AI_DAILY_TOKENS_PER_USER: (c) => c.ai.limits.dailyTokensPerUser,
  AI_DAILY_TOKENS_TOTAL: (c) => c.ai.limits.dailyTokensTotal,
  AUTH_ENABLED: (c) => c.auth.enabled,
  SESSION_HOURS: (c) => c.auth.sessionHours,
  SESSION_EPOCH: (c) => c.auth.sessionEpoch,
  PORTAL_USER: (c) => c.auth.user,
  LOG_FILE_MAX_MB: (c) => c.log.fileMaxMb,
  LOG_FILE_KEEP: (c) => c.log.fileKeep,
};

/** Defaults that are meant to differ from config.ts's (a container is not a dev machine), or between the copies. */
const DIFFERS_BY_DESIGN = new Set([
  'ZBX_URL', // HCML's Zabbix; config.ts keeps a local address for dev runs
  'ZABBIX_TIMEOUT_MS', // HCML's Zabbix is slow (256 s for one page); config.ts keeps 10 s for dev runs
  'WEB_ORIGIN', // the nginx port, which is 8081 or 8082 by copy
  'TRUST_PROXY', // nginx is always in front in Docker
  'SESSION_COOKIE', // each copy has its own, as cookies ignore ports
  'AI_PROVIDER',
  'AI_BASE_URL', // the local copy points at the host's Ollama
]);

afterEach(() => vi.unstubAllEnvs());

describe('docker-compose.yml and the BFF (tracker IN-04)', () => {
  it('passes every variable the BFF reads, apart from the ones it holds back on purpose', () => {
    const read = variablesRead();
    // A guard on the reader itself: finding nothing would make this test pass for the wrong reason.
    expect(read.size).toBeGreaterThan(40);
    expect(read.has('SLO_TARGET') && read.has('AI_NUM_CTX') && read.has('JWT_SECRET')).toBe(true);
    const have = passed();
    const missing = [...read].filter((v) => !have.has(v) && !(v in NOT_PASSED)).sort();
    expect(missing, 'read by the BFF, but compose never passes them: ignored in Docker').toEqual([]);
  });

  it('passes the mail settings in both copies, so that an administrator of either can email the report (FR-56)', () => {
    const local = /^name: hcml-portal-ollama\s*$/m.test(readFileSync(root('docker-compose.yml'), 'utf8'));
    const have = passed();
    for (const v of MAIL_VARS) expect(have.has(v), `${v} in ${local ? 'hcml-portal-ollama' : 'hcml-portal'}`).toBe(true);
  });

  // IN-79: what hcml-portal-ollama exists to guarantee was pinned by nothing, so a lost line would have shipped.
  it('fixes hcml-portal-ollama to a local model, with the words that make the server refuse any other, and leaves hcml-portal free to use the hosted API', () => {
    const text = readFileSync(root('docker-compose.yml'), 'utf8');
    const local = /^name: hcml-portal-ollama\s*$/m.test(text);
    const have = passed();
    for (const v of LOCAL_ONLY_VARS) expect(have.has(v), `${v} in ${local ? 'hcml-portal-ollama' : 'hcml-portal'}`).toBe(local);
    if (!local) {
      expect(/^ {6}AI_PROVIDER: \$\{AI_PROVIDER:-anthropic\}\s*$/m.test(text), 'hcml-portal defaults to the hosted provider').toBe(true);
      expect(have.has('ANTHROPIC_API_KEY'), 'hcml-portal passes the Anthropic key').toBe(true);
      return;
    }
    expect(/^ {6}AI_PROVIDER: openai-compatible\s*$/m.test(text), 'the provider is the literal word, not an interpolation a mistyped .env could change').toBe(true);
    expect(have.has('ANTHROPIC_API_KEY'), 'no Anthropic key is passed').toBe(false);
    expect(text, 'no Anthropic key is named anywhere in the file').not.toMatch(/ANTHROPIC/);
    expect(/^ {6}AI_LOCAL_ONLY: ['"]?true['"]?\s*$/m.test(text), 'AI_LOCAL_ONLY is fixed to true').toBe(true);
    expect(have.get('AI_ALLOW_REMOTE')?.fallback, 'AI_ALLOW_REMOTE is off unless .env says so').toBe('');
    const base = have.get('AI_BASE_URL')?.fallback ?? '';
    expect(isLocalBaseUrl(base), `the default AI_BASE_URL "${base}" is on this machine or its network`).toBe(true);
  });

  it('gives both copies a folder for their state, the one the portal-state volume is mounted at, and declares the volume (IN-59, BK-60)', () => {
    // Both copies keep the saved list, the schedule and the web check figures of closed months there (ADR 0015, ADR 0016).
    const text = readFileSync(root('docker-compose.yml'), 'utf8');
    expect(passed().has('PORTAL_STATE_DIR')).toBe(true);
    const line = /^ {6}PORTAL_STATE_DIR: (.*)$/m.exec(text)?.[1];
    expect(line).toBe('/data');
    expect(/^ {6}- portal-state:(\/\S+)$/m.exec(text)?.[1], 'the volume the state folder is').toBe(line);
    expect(text).toMatch(/^ {2}portal-state:\s*$/m);
  });

  it('gives both copies a folder for the BFF’s own log, the one the portal-logs volume is mounted at, and declares the volume (SC-42)', () => {
    const text = readFileSync(root('docker-compose.yml'), 'utf8');
    expect(passed().has('LOG_DIR')).toBe(true);
    const folder = /^ {6}LOG_DIR: (.*)$/m.exec(text)?.[1];
    expect(folder).toBe('/var/log/portal');
    expect(/^ {6}- portal-logs:(\/\S+)$/m.exec(text)?.[1]).toBe(folder);
    expect(text).toMatch(/^ {2}portal-logs:\s*$/m);
  });

  it('has the image make that folder for the user the portal runs as, before it gives up root (SC-42)', () => {
    const docker = readFileSync(root('server/Dockerfile'), 'utf8');
    const made = /^RUN mkdir -p .*\/var\/log\/portal.* && chown node:node .*\/var\/log\/portal.*$/m.exec(docker);
    expect(made, 'a RUN that makes and hands over /var/log/portal').not.toBeNull();
    expect(made!.index).toBeLessThan(docker.indexOf('USER node'));
  });

  it('holds back only variables the BFF still reads', () => {
    const read = variablesRead();
    expect(Object.keys(NOT_PASSED).filter((v) => !read.has(v))).toEqual([]);
  });

  it('gives each default the value config.ts gives when nothing is set, so Docker and a bare checkout agree', async () => {
    vi.resetModules();
    for (const v of variablesRead()) vi.stubEnv(v, undefined);
    const { config } = await import('../core/config.js');
    const compared: string[] = [];
    for (const [name, { fallback }] of passed()) {
      if (fallback === null || fallback === '') continue;
      const read = SAME_AS_CONFIG[name];
      if (!read) {
        expect(DIFFERS_BY_DESIGN.has(name), `${name} has a default in compose: add it to SAME_AS_CONFIG, or say why it differs`).toBe(true);
        continue;
      }
      expect(fallback, `${name} in docker-compose.yml`).toBe(String(read(config)));
      compared.push(name);
    }
    // The twelve that were missing are among those compared.
    for (const v of ['SLO_TARGET', 'SLA_TIMEZONE', 'SLI_PROFILE', 'SLI_MIN_COVERAGE', 'AI_KEEP_ALIVE', 'AI_NUM_CTX']) {
      expect(compared, v).toContain(v);
    }
  });

  it('leaves the sampling empty in compose, so that the model\'s own card decides and a setting in .env overrules it (clients/ai.ts modelProfile)', () => {
    const sampling = Object.fromEntries(passed()).AI_TOP_P;
    expect(sampling, 'AI_TOP_P is passed on').toBeDefined();
    expect(sampling.fallback === '' || sampling.fallback === null, 'AI_TOP_P has no default in compose').toBe(true);
    expect(Object.fromEntries(passed()).AI_TEMPERATURE.fallback === '' || Object.fromEntries(passed()).AI_TEMPERATURE.fallback === null).toBe(true);
  });
});
