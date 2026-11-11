import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * Checks that decide whether the BFF starts, and how it reads its proxy.
 * config.ts reads the environment once at import, so each case re-imports it.
 */
async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const { assertConfig, config, trustProxyOption } = await import('../core/config.js');
  const { assertUsers } = await import('../security/auth.js');
  return { assertConfig: () => assertConfig(() => undefined), assertUsers, config, trustProxyOption };
}

afterEach(() => vi.unstubAllEnvs());

const STRONG = 'x'.repeat(64);
const AUTH_ON = { AUTH_ENABLED: 'true', JWT_SECRET: STRONG, PORTAL_USER: 'admin', PORTAL_PASS: 'a-long-real-password', PORTAL_USERS: '' };

describe('with auth on, the BFF refuses to start', () => {
  it('on either JWT secret published in this repo', async () => {
    for (const secret of ['dev-insecure-secret-change-me', 'change-me-to-a-long-random-string']) {
      const { assertConfig } = await load({ ...AUTH_ON, JWT_SECRET: secret });
      expect(assertConfig, secret).toThrow(/published in this repo/);
    }
  });

  it('on a JWT secret shorter than 32 bytes', async () => {
    const { assertConfig } = await load({ ...AUTH_ON, JWT_SECRET: 'short-but-not-a-known-one' });
    expect(assertConfig).toThrow(/shorter than 32 bytes/);
  });

  it('on an empty password or the default "admin", naming the user and never the password', async () => {
    for (const pass of ['', 'admin']) {
      const { assertUsers } = await load({ ...AUTH_ON, PORTAL_PASS: pass });
      expect(assertUsers, JSON.stringify(pass)).toThrow(/"admin" has an empty password or the default "admin"/);
    }
    const { assertUsers } = await load({ ...AUTH_ON, PORTAL_USERS: 'ana:admin:viewer,budi:s3cret-budi-pass:admin' });
    expect(assertUsers).toThrow(/"ana" has/);
    expect(assertUsers).not.toThrow(/budi|s3cret/);
  });
});

describe('a malformed PORTAL_USERS', () => {
  it('is refused as such, by position, without echoing any entry', async () => {
    const { assertUsers } = await load({ ...AUTH_ON, PORTAL_PASS: '', PORTAL_USERS: 'ana=Str0ngPass=viewer,budi;An0ther;admin' });
    expect(assertUsers).toThrow(/no PORTAL_USERS entry is a valid name:password:role triple/);
    expect(assertUsers).toThrow(/entry 1 of 2.*entry 2 of 2/);
    expect(assertUsers).not.toThrow(/Str0ngPass|An0ther|ana=|budi/);
  });
});

describe('SLA_NO_DATA_WINDOWS', () => {
  const at = (iso: string) => Date.parse(iso) / 1000;

  it('is read as spans of Unix seconds, in any zone, sorted', async () => {
    const { assertConfig, config } = await load({
      ...AUTH_ON,
      SLA_NO_DATA_WINDOWS: '2026-10-27T01:00Z/2026-10-27T02:00Z, 2026-10-26T16:10+07:00/2026-10-26T21:03+07:00',
    });
    expect(assertConfig).not.toThrow();
    expect(config.sla.noDataWindows).toEqual([
      [at('2026-10-26T09:10:00Z'), at('2026-10-26T14:03:00Z')],
      [at('2026-10-27T01:00:00Z'), at('2026-10-27T02:00:00Z')],
    ]);
  });

  it('stops the BFF when a span cannot be read, rather than count the downtime it was meant to leave out', async () => {
    for (const bad of ['2026-10-26T16:10/2026-10-26T21:03', '2026-10-26T21:03Z/2026-10-26T16:10Z', '2026-10-26T16:10Z', 'yesterday']) {
      const { assertConfig } = await load({ ...AUTH_ON, SLA_NO_DATA_WINDOWS: bad });
      expect(assertConfig, bad).toThrow(/SLA_NO_DATA_WINDOWS/);
    }
  });

  it('declares nothing when unset', async () => {
    const { config } = await load(AUTH_ON);
    expect(config.sla.noDataWindows).toEqual([]);
  });
});

describe('the BFF starts', () => {
  it('with a strong secret and real passwords', async () => {
    const { assertConfig, assertUsers } = await load(AUTH_ON);
    expect(assertConfig).not.toThrow();
    expect(assertUsers).not.toThrow();
  });

  it('with auth off, whatever the secret and passwords (local dev)', async () => {
    const { assertConfig, assertUsers } = await load({
      AUTH_ENABLED: 'false',
      JWT_SECRET: 'dev-insecure-secret-change-me',
      PORTAL_PASS: '',
      PORTAL_USERS: '',
    });
    expect(assertConfig).not.toThrow();
    expect(assertUsers).not.toThrow();
  });
});

describe('passwords stored as scrypt hashes (SC-22)', () => {
  const CHEAP = { N: 1024, r: 8, p: 1 };

  it('are refused when the hash is of the empty password or "admin", as the plain text would be, without printing the hash', async () => {
    const { hashPassword } = await import('../security/passwords.js');
    for (const guess of ['', 'admin']) {
      const hash = await hashPassword(guess, CHEAP);
      const { assertUsers } = await load({ ...AUTH_ON, PORTAL_USERS: `ana:${hash}:admin,budi:s3cret-budi-pass:viewer` });
      expect(assertUsers, JSON.stringify(guess)).toThrow(/"ana" has an empty password or the default "admin"/);
      expect(assertUsers).not.toThrow(/scrypt\.|budi/);
    }
  });

  it('start when the hash is of a real password, for a PORTAL_USERS entry and for PORTAL_PASS', async () => {
    const { hashPassword } = await import('../security/passwords.js');
    const hash = await hashPassword('a-long-real-password', CHEAP);
    expect((await load({ ...AUTH_ON, PORTAL_USERS: `ana:${hash}:admin` })).assertUsers).not.toThrow();
    expect((await load({ ...AUTH_ON, PORTAL_PASS: hash })).assertUsers).not.toThrow();
  });

  it('are refused in PORTAL_PASS when it starts like a hash and is not one', async () => {
    const { assertUsers } = await load({ ...AUTH_ON, PORTAL_PASS: 'scrypt.32768.8.1.garbage.garbage' });
    expect(assertUsers).toThrow(/PORTAL_PASS starts with "scrypt." and is not a usable hash/);
    expect(assertUsers).not.toThrow(/garbage\.garbage/);
  });
});

describe('AUTH_ENABLED (tracker BK-03)', () => {
  const REST = { JWT_SECRET: STRONG, PORTAL_USER: 'admin', PORTAL_PASS: 'a-long-real-password', PORTAL_USERS: '' };

  it('is on when unset or empty, and for true, 1 and yes in any case', async () => {
    vi.stubEnv('AUTH_ENABLED', undefined);
    const unset = await load(REST);
    expect(unset.config.auth.enabled).toBe(true);
    expect(unset.assertConfig).not.toThrow();
    for (const value of ['', '  ', 'true', 'TRUE', 'True', '1', 'yes', 'YES', ' yes ']) {
      const { config, assertConfig } = await load({ ...REST, AUTH_ENABLED: value });
      expect(config.auth.enabled, JSON.stringify(value)).toBe(true);
      expect(assertConfig, JSON.stringify(value)).not.toThrow();
    }
  });

  it('is off for false, 0 and no in any case, and then needs no strong secret (local dev)', async () => {
    for (const value of ['false', 'FALSE', 'False', '0', 'no', 'No', ' no ']) {
      const { config, assertConfig } = await load({ ...REST, AUTH_ENABLED: value, JWT_SECRET: 'dev-insecure-secret-change-me' });
      expect(config.auth.enabled, JSON.stringify(value)).toBe(false);
      expect(assertConfig, JSON.stringify(value)).not.toThrow();
    }
  });

  it('refuses to start on any other value, naming the ones it accepts, and reads as on meanwhile so a typo never opens the portal', async () => {
    for (const value of ['off', 'on', 'y', 'n', '2', 'enabled', 'disabled', 'tru', 'false;', 'fals']) {
      const { config, assertConfig } = await load({ ...REST, AUTH_ENABLED: value });
      expect(config.auth.enabled, value).toBe(true);
      expect(assertConfig, value).toThrow(`AUTH_ENABLED="${value}" is not a value the portal knows`);
      expect(assertConfig, value).toThrow(/true, 1 or yes .* false, 0 or no .* unset or empty/);
    }
  });

  it('is judged before the other checks, so a typo is named even beside a weak secret', async () => {
    const { assertConfig } = await load({ ...REST, AUTH_ENABLED: 'off', JWT_SECRET: 'short' });
    expect(assertConfig).toThrow(/AUTH_ENABLED="off"/);
  });
});

describe('SESSION_COOKIE', () => {
  it('defaults to hcml_session', async () => {
    const { config } = await load(AUTH_ON);
    expect(config.auth.sessionCookie).toBe('hcml_session');
  });

  it('refuses a name no browser would store, rather than failing every sign-in', async () => {
    for (const name of ['hcml session', 'hcml;session', 'hcml=session']) {
      const { assertConfig } = await load({ ...AUTH_ON, SESSION_COOKIE: name });
      expect(assertConfig, name).toThrow(/not a valid cookie name/);
    }
    const { assertConfig } = await load({ ...AUTH_ON, SESSION_COOKIE: 'hcml_session_ollama' });
    expect(assertConfig).not.toThrow();
  });
});

describe('TRUST_PROXY', () => {
  it('reads true as one hop, a number as that many, and anything else as none', async () => {
    const cases: [string, number | false][] = [['true', 1], ['TRUE', 1], ['2', 2], ['false', false], ['', false], ['yes', false], ['0', false]];
    for (const [raw, hops] of cases) {
      const { config } = await load({ TRUST_PROXY: raw });
      expect(config.trustProxy, JSON.stringify(raw)).toBe(hops);
    }
  });

  it('with one hop, takes the address nginx appended, not the one the client wrote (tracker SC-05)', async () => {
    const { config, trustProxyOption } = await load({ TRUST_PROXY: 'true' });
    const app = Fastify({ trustProxy: trustProxyOption(config.trustProxy) });
    app.get('/ip', async (req) => ({ ip: req.ip }));
    // The client forged 6.6.6.6; nginx appended the real address it saw.
    const res = await app.inject({ url: '/ip', headers: { 'x-forwarded-for': '6.6.6.6, 10.0.0.7' } });
    expect(res.json().ip).toBe('10.0.0.7');
    await app.close();
  });

  // Fastify 5.12 reads a bare hop count as "trust nobody"; TRUST_PROXY=2 (a TLS proxy before nginx) must still work.
  it('with two hops, takes the address the outer proxy appended', async () => {
    const { config, trustProxyOption } = await load({ TRUST_PROXY: '2' });
    const app = Fastify({ trustProxy: trustProxyOption(config.trustProxy) });
    app.get('/ip', async (req) => ({ ip: req.ip }));
    const res = await app.inject({ url: '/ip', headers: { 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 10.0.0.7' } });
    expect(res.json().ip).toBe('1.2.3.4');
    await app.close();
  });
});

describe('SESSION_HOURS and SESSION_EPOCH (SC-14)', () => {
  it('default to twelve hours and epoch 1, and start', async () => {
    const { config, assertConfig } = await load(AUTH_ON);
    expect(config.auth.sessionHours).toBe(12);
    expect(config.auth.sessionEpoch).toBe('1');
    expect(assertConfig).not.toThrow();
  });

  it('take a length from 2 to 24 hours, spaces and decimals included', async () => {
    for (const [raw, hours] of [['2', 2], ['12', 12], ['24', 24], ['2.5', 2.5], [' 8 ', 8]] as const) {
      const { config, assertConfig } = await load({ ...AUTH_ON, SESSION_HOURS: raw });
      expect(config.auth.sessionHours, raw).toBe(hours);
      expect(assertConfig, raw).not.toThrow();
    }
  });

  it('refuse a length they cannot use, instead of quietly keeping twelve hours', async () => {
    for (const raw of ['1', '1.9', '25', '0', '-3', 'abc', '12h', '1e1', '3 4', '0x10']) {
      const { assertConfig } = await load({ ...AUTH_ON, SESSION_HOURS: raw });
      expect(assertConfig, raw).toThrow(/SESSION_HOURS=.* is not a length of session the portal can use/);
    }
  });

  it('take a short label as the epoch, and refuse one that cannot sit in a token', async () => {
    for (const raw of ['1', '2', '2026-10-12', 'rotate_2', 'a.b-c']) {
      const { config, assertConfig } = await load({ ...AUTH_ON, SESSION_EPOCH: raw });
      expect(config.auth.sessionEpoch, raw).toBe(raw);
      expect(assertConfig, raw).not.toThrow();
    }
    for (const raw of ['a b', 'x;y', 'tab\there', 'é', 'a'.repeat(33)]) {
      const { assertConfig } = await load({ ...AUTH_ON, SESSION_EPOCH: raw });
      expect(assertConfig, raw).toThrow(/SESSION_EPOCH .* is not a label the portal can put in a token/);
    }
  });
});

describe('SLA_TIMEZONE (BK-34)', () => {
  it('is Asia/Jakarta when unset, empty or only spaces, and takes any zone the runtime knows, spaces trimmed', async () => {
    for (const raw of ['', '   ']) {
      const { config, assertConfig } = await load({ ...AUTH_ON, SLA_TIMEZONE: raw });
      expect(config.sla.timezone, JSON.stringify(raw)).toBe('Asia/Jakarta');
      expect(assertConfig, JSON.stringify(raw)).not.toThrow();
    }
    for (const [raw, zone] of [['UTC', 'UTC'], ['Asia/Makassar', 'Asia/Makassar'], [' Asia/Jayapura ', 'Asia/Jayapura'], ['Europe/London', 'Europe/London']] as const) {
      const { config, assertConfig } = await load({ ...AUTH_ON, SLA_TIMEZONE: raw });
      expect(config.sla.timezone, raw).toBe(zone);
      expect(assertConfig, raw).not.toThrow();
    }
  });

  it('stops the start on a name the runtime does not know, naming the setting and the value', async () => {
    for (const raw of ['Asia/Jakata', 'Jakarta', 'WIB', 'Asia Jakarta', 'GMT+7 (WIB)']) {
      const { assertConfig } = await load({ ...AUTH_ON, SLA_TIMEZONE: raw });
      expect(assertConfig, raw).toThrow(`SLA_TIMEZONE="${raw}" is not a time zone the portal knows`);
    }
  });

  it('accepts only zones that the month cutting can use, so no accepted zone turns an SLA page into a 500', async () => {
    const { monthBounds } = await import('../sli/time.js');
    for (const raw of ['UTC', 'Asia/Makassar', 'Europe/London', 'America/New_York']) {
      const { assertConfig } = await load({ ...AUTH_ON, SLA_TIMEZONE: raw });
      expect(assertConfig, raw).not.toThrow();
      expect(() => monthBounds('2026-10', raw), raw).not.toThrow();
    }
  });
});

describe.each(['ZABBIX_TIMEOUT_MS', 'AI_TIMEOUT_MS'])('%s (BK-34)', (name) => {
  it('starts unset or empty, and on a whole number of milliseconds from a second up to what a timer can hold', async () => {
    for (const raw of ['', '   ', '1000', '30000', ' 300000 ', '2147483647']) {
      const { assertConfig } = await load({ ...AUTH_ON, [name]: raw });
      expect(assertConfig, JSON.stringify(raw)).not.toThrow();
    }
  });

  it('is refused at zero, below a second, negative, fractional, in words or units, or above what a timer can hold, naming itself', async () => {
    for (const raw of ['0', '999', '-5', '2.5', '1e4', 'abc', '30s', '10 000', '0x10', '2147483648']) {
      const { assertConfig } = await load({ ...AUTH_ON, [name]: raw });
      expect(assertConfig, raw).toThrow(`${name}="${raw}" is not a timeout the portal can use`);
    }
  });
});

describe.each([
  { name: 'SLO_TARGET', standard: 99, fits: ['99', '99.9', '100', '0', ' 95 ', '99.', '.5'], wrong: ['100.1', '999', '-1', '99%', 'abc', '1e2', '0x10', '99,5', '9 9'], range: 'from 0 to 100', what: 'a target' },
  { name: 'SLI_MIN_COVERAGE', standard: 0.5, fits: ['0', '0.5', '1', ' 0.25 ', '.5'], wrong: ['1.1', '50', '-0.1', '50%', 'half', '1e-1', '0x1', '0,5'], range: 'from 0 to 1', what: 'a share' },
])('$name (BK-48)', ({ name, standard, fits, wrong, range, what }) => {
  it('starts unset, empty or only spaces, with the standard value', async () => {
    for (const raw of ['', '   ']) {
      const { config, assertConfig } = await load({ ...AUTH_ON, [name]: raw });
      expect(assertConfig, JSON.stringify(raw)).not.toThrow();
      expect(name === 'SLO_TARGET' ? config.sla.target : config.sla.minCoverage).toBe(standard);
    }
  });

  it('starts on a plain number inside the range, the ends included', async () => {
    for (const raw of fits) {
      const { assertConfig } = await load({ ...AUTH_ON, [name]: raw });
      expect(assertConfig, raw).not.toThrow();
    }
  });

  it('is refused outside the range or when it is not a plain number, naming itself, the value and the range', async () => {
    for (const raw of wrong) {
      const { assertConfig } = await load({ ...AUTH_ON, [name]: raw });
      expect(assertConfig, raw).toThrow(`${name}="${raw}" is not ${what} the portal can use`);
      expect(assertConfig, raw).toThrow(range);
    }
  });
});


describe('email with sign-in off, said at start-up (SC-43)', () => {
  const MAIL = { MAIL_PROVIDER: 'gmail', MAIL_USER: 'portal.reports@example.com', MAIL_PASS: 'not-a-real-password', MAIL_TO: 'ana@example.org' };
  async function said(env: Record<string, string>): Promise<string[]> {
    vi.resetModules();
    for (const [key, value] of Object.entries({ ALLOW_EMAIL_WITHOUT_AUTH: '', ...env })) vi.stubEnv(key, value);
    const { assertConfig } = await import('../core/config.js');
    const lines: string[] = [];
    assertConfig((m) => lines.push(m));
    return lines;
  }
  const email = (lines: string[]) => lines.filter((l) => /email/i.test(l) && /ALLOW_EMAIL_WITHOUT_AUTH/.test(l));

  it('says that email is off, and what to set, when sign-in is off and the opt-in is not given', async () => {
    const lines = email(await said({ ...MAIL, AUTH_ENABLED: 'false' }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/Email is off while sign-in is off/);
    expect(lines[0]).toContain('ALLOW_EMAIL_WITHOUT_AUTH=true');
  });

  it('says that anyone who reaches the server can send and set the schedule when the opt-in is given', async () => {
    const lines = email(await said({ ...MAIL, AUTH_ENABLED: 'false', ALLOW_EMAIL_WITHOUT_AUTH: 'true' }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ALLOW_EMAIL_WITHOUT_AUTH=true: with sign-in off, anyone who reaches this server can email the report/);
    expect(lines[0]).toContain('monthly schedule');
  });

  it('reads the opt-in as true in any case and with spaces, and as nothing else', async () => {
    for (const raw of [' TRUE ', 'True']) expect(email(await said({ ...MAIL, AUTH_ENABLED: 'false', ALLOW_EMAIL_WITHOUT_AUTH: raw }))[0], raw).toMatch(/^ALLOW_EMAIL_WITHOUT_AUTH=true:/);
    for (const raw of ['1', 'yes', 'on', 'enabled']) expect(email(await said({ ...MAIL, AUTH_ENABLED: 'false', ALLOW_EMAIL_WITHOUT_AUTH: raw }))[0], raw).toMatch(/Email is off while sign-in is off/);
  });

  it('says nothing about it with sign-in on, or when email is not set up', async () => {
    expect(email(await said({ ...MAIL, ...AUTH_ON }))).toEqual([]);
    expect(email(await said({ AUTH_ENABLED: 'false', MAIL_PROVIDER: '', MAIL_USER: '', MAIL_PASS: '', MAIL_TO: '' }))).toEqual([]);
  });
});

describe('a password on every short list (SC-46)', () => {
  const warned = async (env: Record<string, string>): Promise<{ lines: string[]; threw: boolean }> => {
    const { assertUsers } = await load(env);
    const lines: string[] = [];
    let threw = false;
    try {
      assertUsers((m: string) => lines.push(m));
    } catch {
      threw = true;
    }
    return { lines, threw };
  };

  it('warns, and does not refuse, for the passwords the documents once used as examples, naming the users and never the passwords', async () => {
    const { lines, threw } = await warned({ ...AUTH_ON, PORTAL_PASS: '', PORTAL_USERS: 'ana:secret:viewer,budi:Zabbix:operator,citra:a-long-real-password:admin' });
    expect(threw).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/"ana", "budi" have a password/);
    expect(lines[0]).not.toContain('citra');
    expect(lines[0]).not.toMatch(/secret|zabbix/i);
  });

  it('says it of one user in the singular, for the PORTAL_PASS pair', async () => {
    const { lines, threw } = await warned({ ...AUTH_ON, PORTAL_PASS: 'zabbix', PORTAL_USERS: '' });
    expect(threw).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/"admin" has a password/);
  });

  it('warns of a placeholder that was pasted as it stood', async () => {
    const { lines } = await warned({ ...AUTH_ON, PORTAL_PASS: '', PORTAL_USERS: 'ana:<a long password>:admin' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/placeholder/);
  });

  it('says nothing for a long password, with sign-in off, or when none is given to say it to', async () => {
    expect((await warned({ ...AUTH_ON })).lines).toEqual([]);
    expect((await warned({ AUTH_ENABLED: 'false', PORTAL_PASS: 'secret', PORTAL_USERS: '' })).lines).toEqual([]);
    const { assertUsers } = await load({ ...AUTH_ON, PORTAL_PASS: 'secret', PORTAL_USERS: '' });
    expect(() => assertUsers()).not.toThrow();
  });

  it('still refuses an empty password and "admin" as it did, and says nothing else then', async () => {
    const { lines, threw } = await warned({ ...AUTH_ON, PORTAL_PASS: 'admin', PORTAL_USERS: '' });
    expect(threw).toBe(true);
    expect(lines).toEqual([]);
  });
});

