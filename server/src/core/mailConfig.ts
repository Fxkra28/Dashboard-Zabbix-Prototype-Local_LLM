/**
 * The MAIL_* settings as one object (config.mail), off until every setting is usable. One that is set but unusable
 * leaves email off and says why in `problems`, so a typo in .env cannot stop monitoring and cannot pass unnoticed.
 */

export const MAIL_PROVIDERS = ['gmail', 'yahoo', 'zoho', 'icloud', 'smtp'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];
export type MailSecurity = 'tls' | 'starttls' | 'none';
const SECURITIES: readonly string[] = ['tls', 'starttls', 'none'];

export const MAX_RECIPIENTS = 10;
/** The sender's name when MAIL_FROM_NAME is not set. */
export const DEFAULT_SENDER_NAME = 'HCML Monitoring Portal';
const MAX_SENDER_NAME = 64;
export const MAX_ALLOWED_DOMAINS = 20;

export interface MailEnv {
  provider?: string;
  host?: string;
  port?: string;
  security?: string;
  user?: string;
  pass?: string;
  from?: string;
  /** The name shown beside the sender's address. Blank: the portal's own name. */
  fromName?: string;
  /** The list the portal starts with; the recipients are chosen in the portal after that. */
  to?: string;
  /** Domains a report may go to. Blank: any. */
  allowedDomains?: string;
  /** `off` stops the monthly schedule on this machine. */
  schedule?: string;
}

export interface MailSettings {
  /** Every setting is present and usable. */
  enabled: boolean;
  provider: MailProvider | '';
  host: string;
  port: number;
  security: MailSecurity;
  user: string;
  /** Kept only while email is on. */
  pass: string;
  from: string;
  /** The name shown beside the sender's address. */
  fromName: string;
  /** The list the portal starts with, possibly empty. */
  to: string[];
  /** Lower case. Empty: a report may go to any address. */
  allowedDomains: string[];
  /** False when MAIL_SCHEDULE says off: the monthly send does not run on this machine. */
  schedule: boolean;
  /** Why email is off although something was set; empty when it is on, or when nothing was set. */
  problems: string[];
}

/** Each provider's mail-sending server. Gmail and iCloud are from their own help pages, Yahoo and Zoho from third-party guides. */
const PRESETS: Record<Exclude<MailProvider, 'smtp'>, { host: string; port: number; security: MailSecurity }> = {
  gmail: { host: 'smtp.gmail.com', port: 465, security: 'tls' },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 465, security: 'tls' },
  zoho: { host: 'smtp.zoho.com', port: 465, security: 'tls' },
  icloud: { host: 'smtp.mail.me.com', port: 587, security: 'starttls' },
};

/** Names people give Microsoft's mail. Most of those accounts refuse a login by password, and OAuth2 is not built. */
const MICROSOFT = new Set(['outlook', 'office365', 'microsoft365', 'microsoft', 'hotmail', 'live', 'exchange']);

const CONTROL = /\p{Cc}/u;
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
// No % ! | / before the @: an old mail server reads them as a route to another domain or as a command.
const ADDRESS = new RegExp(`^[^\\s@<>(),;:"\\\\\\[\\]%!|/]{1,64}@${LABEL}(?:\\.${LABEL})+$`);
const DOMAIN = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);
// Control and invisible characters (a zero width space, a right-to-left override) look like nothing in a list pasted from a page.
const UNSEEN = /[\p{Cc}\p{Cf}]/u;
export const validAddress = (a: string): boolean => a.length <= 254 && !UNSEEN.test(a) && ADDRESS.test(a);
export const addressDomain = (a: string): string => a.slice(a.lastIndexOf('@') + 1).toLowerCase();
/** One plain address, with no control character in it: a line break is how a header gets forged. */
export const plainAddress = (a: unknown): a is string => typeof a === 'string' && validAddress(a);
const validDomain = (d: string): boolean => d.length <= 253 && DOMAIN.test(d);
const ON = new Set(['', 'on', 'true', 'yes', '1']);
const OFF = new Set(['off', 'false', 'no', '0']);

const portFor = (security: MailSecurity): number => (security === 'tls' ? 465 : security === 'none' ? 25 : 587);
const clip = (text: string, max = 40): string => (text.length > max ? `${text.slice(0, max)}...` : text);

function off(problems: string[]): MailSettings {
  return { enabled: false, provider: '', host: '', port: 0, security: 'tls', user: '', pass: '', from: '', fromName: '', to: [], allowedDomains: [], schedule: true, problems };
}

export function resolveMail(env: MailEnv): MailSettings {
  const raw = {
    provider: (env.provider ?? '').trim(),
    host: (env.host ?? '').trim(),
    port: (env.port ?? '').trim(),
    security: (env.security ?? '').trim(),
    user: (env.user ?? '').trim(),
    pass: (env.pass ?? '').trim(),
    from: (env.from ?? '').trim(),
    fromName: (env.fromName ?? '').trim(),
    to: (env.to ?? '').trim(),
    allowedDomains: (env.allowedDomains ?? '').trim(),
    schedule: (env.schedule ?? '').trim(),
  };
  if (Object.values(raw).every((v) => v === '')) return off([]);

  const problems: string[] = [];
  const bad = (field: string, why: string) => problems.push(`MAIL_${field} ${why}.`);
  const SETTING_NAME: Record<string, string> = { allowedDomains: 'ALLOWED_DOMAINS', fromName: 'FROM_NAME' };

  // A line break in an address or a name is how a header gets forged, so it is refused before anything else is read.
  const dirty = new Set<string>();
  for (const [field, value] of Object.entries(raw)) {
    if (CONTROL.test(value)) {
      dirty.add(field);
      bad(SETTING_NAME[field] ?? field.toUpperCase(), 'has a line break or another control character');
    }
  }
  const usable = (field: keyof typeof raw): string => (dirty.has(field) ? '' : raw[field]);

  const known = MAIL_PROVIDERS.join(', ').replace(/, ([a-z]+)$/, ' or $1');
  const name = usable('provider').toLowerCase();
  let provider: MailProvider | '' = '';
  if (name === '') {
    if (!dirty.has('provider')) {
      if (usable('host')) provider = 'smtp';
      else bad('PROVIDER', `is not set. Use ${known}`);
    }
  } else if (MICROSOFT.has(name)) {
    bad('PROVIDER', `"${name}" cannot be used: Microsoft accounts need OAuth2 for most logins, which this version does not offer. Use another provider, or smtp with a server that takes a login by password`);
  } else if ((MAIL_PROVIDERS as readonly string[]).includes(name)) {
    provider = name as MailProvider;
  } else {
    bad('PROVIDER', `"${clip(name, 32)}" is not a provider the portal knows. Use ${known}`);
  }
  const preset = provider && provider !== 'smtp' ? PRESETS[provider] : undefined;

  const hostText = usable('host');
  if (hostText && (hostText.length > 253 || !HOST.test(hostText))) {
    bad('HOST', 'must be a host name such as smtp.example.com, with no scheme, port or path');
  } else if (!hostText && provider === 'smtp' && !dirty.has('host')) {
    bad('HOST', 'is not set. It is the server that sends your mail, as the provider or your IT team states it');
  }

  const securityText = usable('security').toLowerCase();
  const security = SECURITIES.includes(securityText) ? (securityText as MailSecurity) : undefined;
  if (securityText && !security) bad('SECURITY', `"${clip(securityText, 16)}" is not tls, starttls or none`);

  const portText = usable('port');
  const portNumber = /^\d+$/.test(portText) ? Number(portText) : NaN;
  const port = portNumber >= 1 && portNumber <= 65535 ? portNumber : undefined;
  if (portText && port === undefined) bad('PORT', 'must be a whole number from 1 to 65535');

  const effectiveSecurity: MailSecurity =
    security ?? (port !== undefined ? (port === 465 ? 'tls' : 'starttls') : (preset?.security ?? 'starttls'));
  const effectivePort = port ?? (security ? portFor(security) : (preset?.port ?? portFor(effectiveSecurity)));

  const user = usable('user');
  const pass = provider === 'gmail' ? usable('pass').replace(/\s+/g, '') : usable('pass');
  if (preset) {
    if (!user && !dirty.has('user')) bad('USER', 'is not set. It is the address you sign in with');
    if (!pass && !dirty.has('pass')) bad('PASS', 'is not set. Use an app password, not your usual one');
  } else if (provider === 'smtp') {
    if (user && !pass && !dirty.has('pass')) bad('PASS', 'is not set, but MAIL_USER is');
    if (pass && !user && !dirty.has('user')) bad('USER', 'is not set, but MAIL_PASS is');
  }
  if (effectiveSecurity === 'none' && pass) {
    problems.push('MAIL_SECURITY=none would send the password unencrypted. Use tls or starttls, or take the login out.');
  }

  const fromText = usable('from') || (user.includes('@') ? user : '');
  if (!fromText) {
    if (!dirty.has('from')) bad('FROM', 'is not set, and MAIL_USER is not an address to send from');
  } else if (!validAddress(fromText)) {
    bad('FROM', 'must be one plain address such as portal@example.com');
  }

  // A name that carries an address or a bracket could be read as another sender in the mail program's list.
  const fromNameText = usable('fromName');
  if (fromNameText && (fromNameText.length > MAX_SENDER_NAME || /[<>"\\@]/.test(fromNameText))) {
    bad('FROM_NAME', `must be a name of up to ${MAX_SENDER_NAME} characters with no < > " \\ or @ in it`);
  }

  const domainList = usable('allowedDomains').split(/[\s,;]+/).filter(Boolean).map((d) => d.toLowerCase());
  const seenDomains = new Set<string>();
  const allowedDomains = domainList.filter((d) => !seenDomains.has(d) && seenDomains.add(d));
  const badDomains = allowedDomains.filter((d) => !validDomain(d));
  if (badDomains.length) {
    bad('ALLOWED_DOMAINS', `has ${badDomains.length === 1 ? 'an entry' : 'entries'} that ${badDomains.length === 1 ? 'is' : 'are'} not a domain such as example.org: ${badDomains.slice(0, 3).map((d) => clip(d)).join(', ')}`);
  } else if (allowedDomains.length > MAX_ALLOWED_DOMAINS) {
    bad('ALLOWED_DOMAINS', `lists ${allowedDomains.length} domains; the most is ${MAX_ALLOWED_DOMAINS}`);
  }

  const scheduleText = usable('schedule').toLowerCase();
  if (!ON.has(scheduleText) && !OFF.has(scheduleText)) bad('SCHEDULE', `"${clip(scheduleText, 16)}" is not on or off`);

  // The recipients are chosen in the portal; this is only the list it starts with, so it may be empty.
  const listed = usable('to').split(/[\s,;]+/).filter(Boolean);
  const seen = new Set<string>();
  const to = listed.filter((a) => !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()));
  const invalid = to.filter((a) => !validAddress(a));
  const outside = badDomains.length ? [] : to.filter((a) => validAddress(a) && allowedDomains.length > 0 && !allowedDomains.includes(addressDomain(a)));
  // Where to look, never what is there: the start-up log holds no address.
  const places = (found: string[]) => {
    const at = found.slice(0, 5).map((a) => listed.findIndex((x) => x.toLowerCase() === a.toLowerCase()) + 1);
    return `${found.length === 1 ? 'entry' : 'entries'} ${at.join(', ')}${found.length > 5 ? ', ...' : ''} of the list`;
  };
  if (invalid.length) {
    bad('TO', `has ${invalid.length === 1 ? 'an entry' : 'entries'} that ${invalid.length === 1 ? 'is' : 'are'} not a plain address (${places(invalid)})`);
  } else if (to.length > MAX_RECIPIENTS) {
    bad('TO', `lists ${to.length} addresses; the most is ${MAX_RECIPIENTS}`);
  } else if (outside.length) {
    bad('TO', `has ${outside.length === 1 ? 'an address' : 'addresses'} outside MAIL_ALLOWED_DOMAINS (${places(outside)})`);
  }

  if (problems.length || !provider) return off(problems);
  return {
    enabled: true,
    provider,
    host: hostText || (preset?.host ?? ''),
    port: effectivePort,
    security: effectiveSecurity,
    user,
    pass,
    from: fromText,
    fromName: fromNameText || DEFAULT_SENDER_NAME,
    to,
    allowedDomains,
    schedule: !OFF.has(scheduleText),
    problems: [],
  };
}
