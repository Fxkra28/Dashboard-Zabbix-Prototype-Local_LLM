import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailSettings } from '../core/mailConfig.js';

/**
 * What the mail client asks nodemailer for, read from the options it hands over: the things no server answer shows, such
 * as a message that cannot read a file of this machine, and the time it waits on a server that is silent.
 */

const created = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('nodemailer', () => ({
  createTransport: (options: Record<string, unknown>) => {
    created.push(options);
    return { verify: async () => true, sendMail: async () => ({ accepted: [], rejected: [] }) };
  },
}));
const { createMailer } = await import('../clients/mail.js');

const settings: MailSettings = {
  enabled: true,
  provider: 'smtp',
  host: 'mail.example.org',
  port: 465,
  security: 'tls',
  user: 'portal@example.org',
  pass: 'not-a-real-password',
  from: 'portal@example.org',
  fromName: 'HCML Monitoring Portal',
  to: [],
  allowedDomains: [],
  schedule: true,
  problems: [],
};

const last = () => created.at(-1)!;
beforeEach(() => void (created.length = 0));

describe('the mail client’s options', () => {
  it('never lets a message read a file of this machine or fetch an address', () => {
    createMailer(settings);
    expect(last()).toMatchObject({ disableFileAccess: true, disableUrlAccess: true });
  });

  it('asks for TLS 1.2 or later', () => {
    createMailer(settings);
    expect(last().tls).toMatchObject({ minVersion: 'TLSv1.2' });
  });

  it('keeps that minimum when a test hands in a certificate to trust', () => {
    createMailer(settings, { tls: { ca: 'a-test-authority' } });
    expect(last().tls).toEqual({ minVersion: 'TLSv1.2', ca: 'a-test-authority' });
  });

  it('gives a silent server 10 seconds to connect, 10 to greet and 10 to resolve, and 60 on the socket', () => {
    createMailer(settings);
    expect(last()).toMatchObject({ connectionTimeout: 10_000, greetingTimeout: 10_000, dnsTimeout: 10_000, socketTimeout: 60_000 });
  });

  it('takes the waits it is given', () => {
    createMailer(settings, { timeoutsMs: { connect: 200, greeting: 300, socket: 400 } });
    expect(last()).toMatchObject({ connectionTimeout: 200, dnsTimeout: 200, greetingTimeout: 300, socketTimeout: 400 });
  });

  it.each([
    ['tls', { secure: true, requireTLS: false, ignoreTLS: false }],
    ['starttls', { secure: false, requireTLS: true, ignoreTLS: false }],
    ['none', { secure: false, requireTLS: false, ignoreTLS: true }],
  ] as const)('maps the %s setting to the way the connection is secured', (security, expected) => {
    createMailer({ ...settings, security });
    expect(last()).toMatchObject(expected);
  });
});
