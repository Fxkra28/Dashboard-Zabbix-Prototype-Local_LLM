import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

/** The report email's settings: hcml-portal passes them, hcml-portal-ollama holds them back so that nothing leaves the machine. */
const MAIL_VARS = ['MAIL_PROVIDER', 'MAIL_HOST', 'MAIL_PORT', 'MAIL_SECURITY', 'MAIL_USER', 'MAIL_PASS', 'MAIL_FROM', 'MAIL_FROM_NAME', 'MAIL_TO', 'MAIL_ALLOWED_DOMAINS', 'MAIL_SCHEDULE'];
for (const v of MAIL_VARS) NOT_PASSED[v] = 'hcml-portal-ollama passes no mail settings on purpose: nothing leaves the machine there (tracker FR-26)';
NOT_PASSED.PORTAL_STATE_DIR = 'hcml-portal-ollama has no state volume: it sends no email, so it has nothing to keep (tracker IN-59)';

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
  AI_CHAT_PER_MINUTE: (c) => c.ai.limits.chatPerMinute,
  AI_EXPLAIN_PER_MINUTE: (c) => c.ai.limits.explainPerMinute,
  AI_MAX_CONCURRENT: (c) => c.ai.limits.maxConcurrent,
  AI_DAILY_TOKENS_PER_USER: (c) => c.ai.limits.dailyTokensPerUser,
  AI_DAILY_TOKENS_TOTAL: (c) => c.ai.limits.dailyTokensTotal,
  AUTH_ENABLED: (c) => c.auth.enabled,
  SESSION_HOURS: (c) => c.auth.sessionHours,
  SESSION_EPOCH: (c) => c.auth.sessionEpoch,
  PORTAL_USER: (c) => c.auth.user,
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

  it('passes the mail settings in hcml-portal and holds them back in hcml-portal-ollama, which exists so that nothing leaves the machine', () => {
    const local = /^name: hcml-portal-ollama\s*$/m.test(readFileSync(root('docker-compose.yml'), 'utf8'));
    const have = passed();
    for (const v of MAIL_VARS) expect(have.has(v), `${v} in ${local ? 'hcml-portal-ollama' : 'hcml-portal'}`).toBe(!local);
  });

  it('gives hcml-portal a folder for its state, the one its volume is mounted at, and gives hcml-portal-ollama none', () => {
    const text = readFileSync(root('docker-compose.yml'), 'utf8');
    const local = /^name: hcml-portal-ollama\s*$/m.test(text);
    const line = /^ {6}PORTAL_STATE_DIR: (.*)$/m.exec(text)?.[1];
    expect(passed().has('PORTAL_STATE_DIR'), local ? 'hcml-portal-ollama' : 'hcml-portal').toBe(!local);
    if (!local) expect(line).toBe('/data');
    const mounted = /^ {6}- portal-state:(\/\S+)$/m.exec(text)?.[1];
    expect(mounted, 'the volume the state folder is').toBe(local ? undefined : line);
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
    for (const v of ['SLO_TARGET', 'SLA_TIMEZONE', 'SLI_PROFILE', 'SLI_MIN_COVERAGE', 'AI_KEEP_ALIVE', 'AI_NUM_CTX', 'AI_TOP_P']) {
      expect(compared, v).toContain(v);
    }
  });
});
