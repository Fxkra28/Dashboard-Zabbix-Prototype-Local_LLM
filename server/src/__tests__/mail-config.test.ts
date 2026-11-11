import { describe, expect, it } from 'vitest';
import { MAIL_PROVIDERS, MAX_RECIPIENTS, plainAddress, resolveMail, validAddress } from '../core/mailConfig.js';

/**
 * The MAIL_* settings read into one object. Anything set and unusable leaves email off with a reason in
 * `problems`: a typo must not stop the portal serving monitoring data, and must not pass unnoticed.
 * Every address and password here is made up.
 */

const gmail = {
  provider: 'gmail',
  user: 'portal.reports@example.com',
  pass: 'abcd efgh ijkl mnop',
  to: 'ana@example.org, budi@example.org',
};
const own = { provider: 'smtp', host: 'mail.example.com', user: 'portal@example.com', pass: 'not-a-real-password', to: 'ana@example.org' };

/** Whether a problem is about this setting: it starts with the setting's name, so a mention inside another problem does not count. */
const about = (r: { problems: string[] }, name: string): boolean => r.problems.some((p) => p.startsWith(`${name} `));

describe('nothing set', () => {
  it('leaves email off with nothing to say', () => {
    const blanks = { provider: '', host: '', port: '', security: '', user: '', pass: '', from: '', to: '' };
    for (const env of [{}, blanks, { provider: '  ', to: ' ' }]) {
      expect(resolveMail(env)).toMatchObject({ enabled: false, provider: '', problems: [] });
    }
  });
});

describe('the presets', () => {
  it('fills Gmail in: host, port and TLS come from the provider, the sender from the login', () => {
    expect(resolveMail(gmail)).toEqual({
      enabled: true,
      provider: 'gmail',
      host: 'smtp.gmail.com',
      port: 465,
      security: 'tls',
      user: 'portal.reports@example.com',
      pass: 'abcdefghijklmnop',
      from: 'portal.reports@example.com',
      fromName: 'HCML Monitoring Portal',
      to: ['ana@example.org', 'budi@example.org'],
      allowedDomains: [],
      schedule: true,
      problems: [],
    });
  });

  it('names the sender HCML Monitoring Portal unless MAIL_FROM_NAME says otherwise (IN-62)', () => {
    expect(resolveMail(own).fromName).toBe('HCML Monitoring Portal');
    expect(resolveMail({ ...own, fromName: '' }).fromName).toBe('HCML Monitoring Portal');
    expect(resolveMail({ ...own, fromName: '   ' }).fromName).toBe('HCML Monitoring Portal');
    expect(resolveMail({ ...own, fromName: '  HCML Reports  ' })).toMatchObject({ enabled: true, fromName: 'HCML Reports' });
    expect(resolveMail({ ...own, fromName: 'Laporan SLA HCML' }).fromName).toBe('Laporan SLA HCML');
  });

  it.each([
    ['a line break', 'HCML\r\nBcc: x@example.net'],
    ['a less-than sign', 'HCML <reports>'],
    ['a greater-than sign', 'HCML>'],
    ['a quote', 'HCML "Reports"'],
    ['a backslash', 'HCML\\Reports'],
    ['an at sign, which would read as an address', 'ceo@example.org'],
    ['more than 64 characters', 'H'.repeat(65)],
  ])('turns email off, naming MAIL_FROM_NAME, for a sender name with %s (IN-62)', (_why, fromName) => {
    const r = resolveMail({ ...own, fromName });
    expect(r.enabled).toBe(false);
    expect(about(r, 'MAIL_FROM_NAME')).toBe(true);
  });

  it('takes a name of exactly 64 characters', () => {
    expect(resolveMail({ ...own, fromName: 'H'.repeat(64) })).toMatchObject({ enabled: true, fromName: 'H'.repeat(64) });
  });

  it('takes the spaces out of a Gmail app password, which Google shows in four groups, and only there', () => {
    expect(resolveMail(gmail).pass).toBe('abcdefghijklmnop');
    expect(resolveMail({ ...gmail, provider: 'yahoo', pass: 'abc def' }).pass).toBe('abc def');
  });

  it.each([
    ['yahoo', 'smtp.mail.yahoo.com', 465, 'tls'],
    ['zoho', 'smtp.zoho.com', 465, 'tls'],
    ['icloud', 'smtp.mail.me.com', 587, 'starttls'],
  ])('knows %s', (provider, host, port, security) => {
    expect(resolveMail({ ...gmail, provider })).toMatchObject({ enabled: true, provider, host, port, security });
  });

  it('reads the provider name in any case and ignores the spaces round it', () => {
    expect(resolveMail({ ...gmail, provider: '  Gmail ' })).toMatchObject({ enabled: true, provider: 'gmail' });
  });

  it('lets a setting beat the preset: a regional Zoho host, or another port with the security that goes with it', () => {
    expect(resolveMail({ ...gmail, provider: 'zoho', host: 'smtp.zoho.eu' })).toMatchObject({ enabled: true, host: 'smtp.zoho.eu', port: 465 });
    expect(resolveMail({ ...gmail, port: '587' })).toMatchObject({ enabled: true, port: 587, security: 'starttls' });
    expect(resolveMail({ ...gmail, security: 'starttls' })).toMatchObject({ enabled: true, port: 587, security: 'starttls' });
  });

  it('wants a login for every preset', () => {
    const none = resolveMail({ provider: 'gmail', to: 'ana@example.org' });
    expect(none.enabled).toBe(false);
    expect(about(none, 'MAIL_USER')).toBe(true);
    expect(about(none, 'MAIL_PASS')).toBe(true);
  });

  it('lists the names it knows', () => {
    expect([...MAIL_PROVIDERS]).toEqual(['gmail', 'yahoo', 'zoho', 'icloud', 'smtp']);
  });
});

describe('a server of your own (smtp)', () => {
  it('needs a host', () => {
    const r = resolveMail({ ...own, host: '' });
    expect(r.enabled).toBe(false);
    expect(r.problems.join(' ')).toMatch(/MAIL_HOST/);
  });

  it('is what a host alone means, without a provider', () => {
    expect(resolveMail({ ...own, provider: '' })).toMatchObject({ enabled: true, provider: 'smtp', host: 'mail.example.com' });
  });

  it('asks for TLS by default: port 587 and STARTTLS, or implicit TLS on 465', () => {
    expect(resolveMail(own)).toMatchObject({ port: 587, security: 'starttls' });
    expect(resolveMail({ ...own, port: '465' })).toMatchObject({ port: 465, security: 'tls' });
    expect(resolveMail({ ...own, port: '2525' })).toMatchObject({ port: 2525, security: 'starttls' });
    expect(resolveMail({ ...own, security: 'tls' })).toMatchObject({ port: 465, security: 'tls' });
  });

  it('allows a relay that wants no login, when it is told so', () => {
    const relay = resolveMail({ provider: 'smtp', host: 'relay.example.com', security: 'none', from: 'portal@example.com', to: 'ana@example.org' });
    expect(relay).toMatchObject({ enabled: true, security: 'none', port: 25, user: '', pass: '', from: 'portal@example.com' });
  });

  it('wants the user and the password together', () => {
    expect(about(resolveMail({ ...own, pass: '' }), 'MAIL_PASS')).toBe(true);
    expect(about(resolveMail({ ...own, user: '' }), 'MAIL_USER')).toBe(true);
  });

  it('refuses to send a password in the clear', () => {
    const r = resolveMail({ ...own, security: 'none' });
    expect(r.enabled).toBe(false);
    expect(r.problems.join(' ')).toMatch(/MAIL_SECURITY=none/);
  });

  it('refuses a security mode it does not know', () => {
    const r = resolveMail({ ...own, security: 'ssl' });
    expect(r.enabled).toBe(false);
    expect(r.problems.join(' ')).toMatch(/MAIL_SECURITY/);
    expect(r.problems.join(' ')).toMatch(/tls, starttls or none/);
  });

  it('refuses a host written as an address (a scheme, a path, a space)', () => {
    for (const host of ['smtp://mail.example.com', 'mail.example.com/x', 'mail example.com', 'mail.example.com:587']) {
      const r = resolveMail({ ...own, host });
      expect(r.enabled, host).toBe(false);
      expect(r.problems.join(' '), host).toMatch(/MAIL_HOST/);
    }
  });
});

describe('the sender', () => {
  it('is the login when that is an address', () => {
    expect(resolveMail(own).from).toBe('portal@example.com');
  });

  it('must be given when the login is not an address, as with a mail service that logs in as "apikey"', () => {
    const r = resolveMail({ ...own, user: 'apikey' });
    expect(r.enabled).toBe(false);
    expect(about(r, 'MAIL_FROM')).toBe(true);
    expect(resolveMail({ ...own, user: 'apikey', from: 'portal@example.com' })).toMatchObject({ enabled: true, from: 'portal@example.com' });
  });

  it('must be an address', () => {
    const r = resolveMail({ ...own, from: 'The Portal <portal@example.com>' });
    expect(r.enabled).toBe(false);
    expect(r.problems.join(' ')).toMatch(/MAIL_FROM/);
  });
});

describe('the ports', () => {
  it.each(['abc', '0', '70000', '-1', '587.5', '5 87'])('refuses %s', (port) => {
    const r = resolveMail({ ...own, port });
    expect(r.enabled, port).toBe(false);
    expect(r.problems.join(' '), port).toMatch(/MAIL_PORT/);
  });
});

describe('the recipients', () => {
  it('may be separated by commas, semicolons or spaces, and are listed once, in the order given', () => {
    const r = resolveMail({ ...own, to: 'ana@example.org; budi@example.org Cici@Example.org,  ana@EXAMPLE.org' });
    expect(r.to).toEqual(['ana@example.org', 'budi@example.org', 'Cici@Example.org']);
  });

  it('may be left out: they are chosen in the portal, and MAIL_TO is only the list it starts with', () => {
    for (const to of [undefined, '', '   ']) {
      const r = resolveMail({ ...own, to });
      expect(r).toMatchObject({ enabled: true, to: [], problems: [] });
    }
  });

  it.each(['ana@', '@example.org', 'ana@example', 'ana example.org', 'Ana <ana@example.org>', '"ana"@example.org', 'ana@@example.org'])(
    'refuse %s',
    (to) => {
      const r = resolveMail({ ...own, to: `budi@example.org, ${to}` });
      expect(r.enabled, to).toBe(false);
      expect(r.problems.join(' '), to).toMatch(/MAIL_TO/);
    },
  );

  it('are never named in the problem it reports: no address goes into the log (FR-28)', () => {
    const outside = resolveMail({ ...own, to: 'budi@example.org, zed.quux@gmail.com', allowedDomains: 'example.org' });
    const malformed = resolveMail({ ...own, to: 'budi@example.org, ruth.vell@@gmail.com, ana@' });
    for (const r of [outside, malformed]) {
      expect(r.enabled).toBe(false);
      const text = r.problems.join(' ');
      expect(text).toMatch(/MAIL_TO/);
      expect(text).not.toMatch(/@|quux|vell|budi/);
    }
    // It says where to look instead: the place of each entry in the list.
    expect(outside.problems.join(' ')).toMatch(/entry 2 of the list/);
    expect(malformed.problems.join(' ')).toMatch(/entries 2, 3 of the list/);
  });

  it(`are at most ${MAX_RECIPIENTS}`, () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `p${i}@example.org`).join(',');
    expect(resolveMail({ ...own, to: many(MAX_RECIPIENTS) }).enabled).toBe(true);
    const r = resolveMail({ ...own, to: many(MAX_RECIPIENTS + 1) });
    expect(r.enabled).toBe(false);
    expect(r.problems.join(' ')).toMatch(new RegExp(`MAIL_TO.*${MAX_RECIPIENTS}`));
  });
});

describe('the domains a report may go to', () => {
  it('are any, until MAIL_ALLOWED_DOMAINS names some', () => {
    expect(resolveMail(own).allowedDomains).toEqual([]);
    expect(resolveMail({ ...own, allowedDomains: ' ' }).allowedDomains).toEqual([]);
  });

  it('are listed in lower case, once, in the order given, separated by commas, semicolons or spaces', () => {
    const r = resolveMail({ ...own, allowedDomains: 'HCML.co.id; example.org  hcml.CO.id,mail.example.net' });
    expect(r).toMatchObject({ enabled: true, allowedDomains: ['hcml.co.id', 'example.org', 'mail.example.net'], problems: [] });
  });

  it.each(['example', 'exa mple.org@', '@example.org', 'ana@example.org', '-bad.example.org', 'bad-.example.org', 'a..b.org', 'http://example.org', 'example.org/path', 'exam_ple.org'])(
    'refuse %s, and leave email off so a mistake cannot widen where a report goes',
    (entry) => {
      const r = resolveMail({ ...own, allowedDomains: `example.org, ${entry}` });
      expect(r.enabled, entry).toBe(false);
      expect(about(r, 'MAIL_ALLOWED_DOMAINS'), entry).toBe(true);
    },
  );

  it('are at most 20, a list long enough for any one organisation', () => {
    // The starting list is at example.org, so that one is among them.
    const many = (n: number) => [...Array.from({ length: n - 1 }, (_, i) => `d${i}.example.net`), 'example.org'].join(',');
    expect(resolveMail({ ...own, allowedDomains: many(20) }).enabled).toBe(true);
    const r = resolveMail({ ...own, allowedDomains: many(21) });
    expect(r.enabled).toBe(false);
    expect(r.problems.join(' ')).toMatch(/MAIL_ALLOWED_DOMAINS.*20/);
  });

  it('are checked against the starting list: an address outside them there is a mistake, said in the setting that holds it', () => {
    const r = resolveMail({ ...own, to: 'ana@example.org, spy@elsewhere.net', allowedDomains: 'example.org' });
    expect(r.enabled).toBe(false);
    expect(about(r, 'MAIL_TO')).toBe(true);
    // The place, and not the address: the start-up log holds none.
    expect(r.problems.join(' ')).toMatch(/entry 2 of the list/);
    expect(r.problems.join(' ')).not.toMatch(/elsewhere|spy/);
  });

  it('take the whole domain: an address in a domain that merely ends the same way is outside', () => {
    expect(resolveMail({ ...own, to: 'ana@notexample.org', allowedDomains: 'example.org' }).enabled).toBe(false);
    expect(resolveMail({ ...own, to: 'ana@mail.example.org', allowedDomains: 'example.org' }).enabled).toBe(false);
    expect(resolveMail({ ...own, to: 'ana@example.org.evil.net', allowedDomains: 'example.org' }).enabled).toBe(false);
  });

  it('let a starting list inside them through', () => {
    expect(resolveMail({ ...own, to: 'ana@example.org, budi@Example.ORG', allowedDomains: 'example.org' }).enabled).toBe(true);
  });

  it('do not by themselves turn email on: a lone MAIL_ALLOWED_DOMAINS is a start made, with the rest missing', () => {
    const r = resolveMail({ allowedDomains: 'example.org' });
    expect(r.enabled).toBe(false);
    expect(about(r, 'MAIL_PROVIDER')).toBe(true);
  });
});

describe('the monthly schedule switch', () => {
  it.each([undefined, '', '  ', 'on', 'ON', 'true', 'yes', '1'])('is on for %j, with email on and nothing to say', (schedule) => {
    expect(resolveMail({ ...own, schedule })).toMatchObject({ enabled: true, schedule: true, problems: [] });
  });

  it.each(['off', 'OFF', ' off ', 'false', 'no', '0'])('is off for %j, with email itself still on', (schedule) => {
    expect(resolveMail({ ...own, schedule })).toMatchObject({ enabled: true, schedule: false, problems: [] });
  });

  it.each(['maybe', 'disabled', 'of'])('refuses %j and says what the setting takes', (schedule) => {
    const r = resolveMail({ ...own, schedule });
    expect(r.enabled).toBe(false);
    expect(about(r, 'MAIL_SCHEDULE')).toBe(true);
    expect(r.problems.join(' ')).toMatch(/on or off/);
  });

  it('is on when email is off, since there is then nothing to switch', () => {
    expect(resolveMail({}).schedule).toBe(true);
  });
});

describe('an invisible character in an address (reviewer, 11 November)', () => {
  const at = (code: number, where: 'local' | 'domain' = 'local') => {
    const c = String.fromCodePoint(code);
    return where === 'local' ? `ana${c}@example.org` : `ana@exam${c}ple.org`;
  };
  // Zero width space, left-to-right mark, right-to-left override, byte order mark, soft hyphen, word joiner.
  const INVISIBLE = [0x200b, 0x200e, 0x202e, 0xfeff, 0x00ad, 0x2060];

  it.each(INVISIBLE.map((code) => [code.toString(16).toUpperCase().padStart(4, '0'), code] as const))('refuses an address with U+%s inside it, in the name or in the domain', (_name, code) => {
    for (const address of [at(code), at(code, 'domain')]) {
      expect(validAddress(address), address).toBe(false);
      expect(plainAddress(address), address).toBe(false);
    }
  });

  it('still takes a plain address, and one with an accent', () => {
    expect(validAddress('ana.budi+report@example.org')).toBe(true);
    expect(plainAddress('andr\u00e9@example.org')).toBe(true);
  });

  it('is refused in MAIL_TO like any other bad entry', () => {
    const r = resolveMail({ ...own, to: `budi@example.org, ${at(0x200b)}` });
    expect(r.enabled).toBe(false);
    expect(r.problems.join(' ')).toMatch(/MAIL_TO.*entry 2/);
  });
});

describe('a line break or another control character in a setting', () => {
  const whole: Record<string, string> = {
    provider: 'smtp',
    host: 'mail.example.com',
    port: '587',
    security: 'starttls',
    user: 'portal@example.com',
    pass: 'not-a-real-password',
    from: 'portal@example.com',
    to: 'ana@example.org',
  };

  it('is not there to begin with', () => {
    expect(resolveMail(whole)).toMatchObject({ enabled: true, problems: [] });
  });

  it.each(Object.keys(whole))('in %s turns email off, and the problem names the setting', (field) => {
    const r = resolveMail({ ...whole, [field]: `${whole[field]}\r\nBcc: spy@example.net` });
    expect(r.enabled).toBe(false);
    expect(r.problems).toContain(`MAIL_${field.toUpperCase()} has a line break or another control character.`);
  });
});

describe('Microsoft accounts', () => {
  it.each(['outlook', 'office365', 'microsoft365', 'hotmail', 'live', 'exchange'])('are named, not just unknown: %s', (provider) => {
    const r = resolveMail({ ...gmail, provider });
    expect(r.enabled).toBe(false);
    expect(r.problems.join(' ')).toMatch(/Microsoft/);
    expect(r.problems.join(' ')).toMatch(/OAuth2/);
  });

  it('may still use a Microsoft host as their own server, if the tenant allows a login by password', () => {
    expect(resolveMail({ ...own, host: 'smtp.office365.com' })).toMatchObject({ enabled: true, host: 'smtp.office365.com' });
  });
});

describe('a name it does not know', () => {
  it('lists the ones it does', () => {
    const r = resolveMail({ ...gmail, provider: 'mailgun' });
    expect(r.enabled).toBe(false);
    expect(r.problems.join(' ')).toMatch(/gmail, yahoo, zoho, icloud or smtp/);
  });
});

describe('what it says and keeps', () => {
  it('lists every problem, not only the first', () => {
    const r = resolveMail({ provider: 'gmail', port: 'x' });
    expect(r.problems.length).toBeGreaterThanOrEqual(4);
  });

  it('never prints a password in a problem, and keeps none when email is off', () => {
    const pass = 'Zq9-never-print-this';
    const r = resolveMail({ ...own, pass, port: 'abc', to: 'nope' });
    expect(r.enabled).toBe(false);
    expect(JSON.stringify(r)).not.toContain(pass);
    const control = resolveMail({ ...own, pass: `${pass.slice(0, 4)}\n${pass.slice(4)}` });
    expect(control.enabled).toBe(false);
    expect(JSON.stringify(control)).not.toContain(pass.slice(4));
  });
});
