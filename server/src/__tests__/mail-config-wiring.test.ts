import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * config.mail and the start-up warnings about it. config.ts reads the environment once at import, so each case
 * re-imports it. Every address and password here is made up.
 */
const MAIL = ['MAIL_PROVIDER', 'MAIL_HOST', 'MAIL_PORT', 'MAIL_SECURITY', 'MAIL_USER', 'MAIL_PASS', 'MAIL_FROM', 'MAIL_FROM_NAME', 'MAIL_TO', 'MAIL_ALLOWED_DOMAINS', 'MAIL_SCHEDULE'];

async function load(env: Record<string, string>) {
  vi.resetModules();
  // Nothing from the machine running the tests may leak into the case.
  for (const name of MAIL) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const { assertConfig, config } = await import('../core/config.js');
  const warnings: string[] = [];
  assertConfig((m) => warnings.push(m));
  return { config, warnings };
}

// Auth off keeps assertConfig from refusing to start on the test's lack of a JWT secret.
const base = { AUTH_ENABLED: 'false', ZABBIX_API_TOKEN: 't', ZABBIX_WRITE_TOKEN: 't' };
const whole = {
  MAIL_PROVIDER: 'gmail',
  MAIL_USER: 'portal.reports@example.com',
  MAIL_PASS: 'not-a-real-password',
  MAIL_TO: 'ana@example.org',
};
const emailWarnings = (warnings: string[]) => warnings.filter((w) => /^Email is off/.test(w));

afterEach(() => vi.unstubAllEnvs());

describe('config.mail', () => {
  it('is off, and silent, when nothing is set', async () => {
    const { config, warnings } = await load(base);
    expect(config.mail).toMatchObject({ enabled: false, problems: [] });
    expect(emailWarnings(warnings)).toEqual([]);
  });

  it('reads every MAIL_ variable', async () => {
    const { config } = await load({
      ...base,
      MAIL_PROVIDER: 'smtp',
      MAIL_HOST: 'mail.example.com',
      MAIL_PORT: '2525',
      MAIL_SECURITY: 'starttls',
      MAIL_USER: 'login',
      MAIL_PASS: 'not-a-real-password',
      MAIL_FROM: 'portal@example.com',
      MAIL_FROM_NAME: 'HCML Reports',
      MAIL_TO: 'ana@example.org, budi@example.org',
      MAIL_ALLOWED_DOMAINS: 'example.org',
      MAIL_SCHEDULE: 'off',
    });
    expect(config.mail).toEqual({
      enabled: true,
      provider: 'smtp',
      host: 'mail.example.com',
      port: 2525,
      security: 'starttls',
      user: 'login',
      pass: 'not-a-real-password',
      from: 'portal@example.com',
      fromName: 'HCML Reports',
      to: ['ana@example.org', 'budi@example.org'],
      allowedDomains: ['example.org'],
      schedule: false,
      problems: [],
    });
  });

  it('draws no warning when it is on and limited to the domains it names', async () => {
    // With sign-in on: with it off email is refused, and that is said (startup-guards.test.ts).
    const { config, warnings } = await load({ ...base, ...whole, AUTH_ENABLED: 'true', JWT_SECRET: 'x'.repeat(64), MAIL_ALLOWED_DOMAINS: 'example.org' });
    expect(config.mail.enabled).toBe(true);
    expect(emailWarnings(warnings)).toEqual([]);
    expect(warnings.filter((w) => /MAIL_ALLOWED_DOMAINS/.test(w))).toEqual([]);
  });

  it('warns, once, that a report may go to any address when no domain is named, and says how to limit it', async () => {
    const { config, warnings } = await load({ ...base, ...whole });
    expect(config.mail.enabled).toBe(true);
    const said = warnings.filter((w) => /MAIL_ALLOWED_DOMAINS/.test(w));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/any address/);
  });

  it('does not warn about the domains while email is off', async () => {
    const { warnings } = await load(base);
    expect(warnings.filter((w) => /MAIL_ALLOWED_DOMAINS/.test(w))).toEqual([]);
  });
});

describe('config.stateDir', () => {
  it('is empty when PORTAL_STATE_DIR is not set, so nothing is kept across a restart', async () => {
    vi.stubEnv('PORTAL_STATE_DIR', undefined);
    const { config } = await load(base);
    expect(config.stateDir).toBe('');
  });

  it('is the folder PORTAL_STATE_DIR names, without the spaces round it', async () => {
    vi.stubEnv('PORTAL_STATE_DIR', '  /data ');
    const { config } = await load(base);
    expect(config.stateDir).toBe('/data');
  });
});

describe('a setting that cannot be used', () => {
  it('leaves email off, says which setting at start-up, and does not stop the portal', async () => {
    const { config, warnings } = await load({ ...base, ...whole, MAIL_TO: 'ana@' });
    expect(config.mail.enabled).toBe(false);
    const said = emailWarnings(warnings);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('MAIL_TO');
  });

  it('gets one warning for each problem', async () => {
    const { warnings } = await load({ ...base, MAIL_PROVIDER: 'gmail', MAIL_PORT: 'x' });
    expect(emailWarnings(warnings).length).toBeGreaterThanOrEqual(4);
  });

  it('never carries the password into a warning', async () => {
    const { config, warnings } = await load({ ...base, ...whole, MAIL_PASS: 'Zq9-never-print-this', MAIL_PORT: 'x' });
    expect(config.mail.enabled).toBe(false);
    expect(warnings.join('\n')).not.toContain('Zq9-never-print-this');
    expect(JSON.stringify(config.mail)).not.toContain('Zq9-never-print-this');
  });

  it('names a Microsoft account as one this version cannot use', async () => {
    const { warnings } = await load({ ...base, ...whole, MAIL_PROVIDER: 'outlook' });
    expect(emailWarnings(warnings).join(' ')).toMatch(/Microsoft/);
  });
});
