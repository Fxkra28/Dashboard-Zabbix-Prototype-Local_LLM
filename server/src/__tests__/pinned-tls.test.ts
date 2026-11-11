import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { parseTlsPin, type TlsPin } from '../core/config.js';
import { createPinnedAgent, judgePeer, PinnedTlsError, postPinned } from '../clients/pinnedTls.js';
import { EXPIRED_LEAF, LEAF_KEY, TEST_CA, VALID_LEAF } from './helpers/tlsTestCerts.js';

/**
 * The exception for one expired Zabbix certificate, against local HTTPS servers with throwaway certificates. Each
 * server keeps the Authorization header of every request it receives, so a refusal can be shown to send nothing.
 */
function pinOf(pem: string, until = '2026-11-30'): TlsPin {
  const pin = parseTlsPin(new X509Certificate(pem).fingerprint256, until);
  if (!pin) throw new Error('the test pin did not parse');
  return pin;
}

const wib = (local: string) => Date.parse(`${local}+07:00`);
const BEFORE_END = wib('2026-11-30T12:00:00');

interface Fake {
  server: https.Server;
  port: number;
  received: string[];
  stall: boolean;
}

async function fakeZabbix(cert: string): Promise<Fake> {
  const fake = { received: [] as string[], stall: false } as Fake;
  fake.server = https.createServer({ key: LEAF_KEY, cert }, (req, res) => {
    fake.received.push(String(req.headers.authorization));
    if (fake.stall) return;
    req.resume();
    req.on('end', () => res.end('{"jsonrpc":"2.0","result":"ok","id":1}'));
  });
  await new Promise<void>((resolve) => fake.server.listen(0, resolve));
  fake.port = (fake.server.address() as AddressInfo).port;
  return fake;
}

let expired: Fake;
let valid: Fake;
const agents: https.Agent[] = [];

/** An agent that trusts the test CA, with the clock stopped at `now`. */
function agent(pin: TlsPin, now = BEFORE_END): https.Agent {
  const made = createPinnedAgent(pin, { ca: TEST_CA, now: () => now });
  agents.push(made);
  return made;
}

function post(fake: Fake, through: https.Agent, host = 'localhost', timeoutMs = 2_000) {
  const body = '{"jsonrpc":"2.0","method":"apiinfo.version","params":{},"id":1}';
  return postPinned(`https://${host}:${fake.port}/api_jsonrpc.php`, { Authorization: 'Bearer test-token' }, body, timeoutMs, through);
}

async function refusal(pending: Promise<unknown>): Promise<PinnedTlsError> {
  const err = await pending.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof PinnedTlsError)) throw new Error(`expected a PinnedTlsError, got ${String(err)}`);
  return err;
}

beforeAll(async () => {
  expired = await fakeZabbix(EXPIRED_LEAF);
  valid = await fakeZabbix(VALID_LEAF);
});

beforeEach(() => {
  for (const fake of [expired, valid]) {
    fake.received = [];
    fake.stall = false;
  }
});

afterAll(async () => {
  for (const made of agents) made.destroy();
  for (const fake of [expired, valid]) {
    fake.server.closeAllConnections();
    await new Promise((resolve) => fake.server.close(resolve));
  }
});

describe('a pinned connection', () => {
  it("goes on when the pinned certificate's only fault is its age, and the token arrives", async () => {
    const reply = await post(expired, agent(pinOf(EXPIRED_LEAF)));
    expect(reply).toMatchObject({ ok: true, status: 200 });
    expect(JSON.parse(reply.body)).toMatchObject({ result: 'ok' });
    expect(expired.received).toEqual(['Bearer test-token']);
  });

  it('goes on at 23:59 WIB on the last day and stops at midnight', async () => {
    await post(expired, agent(pinOf(EXPIRED_LEAF), wib('2026-11-30T23:59:00')));
    const err = await refusal(post(expired, agent(pinOf(EXPIRED_LEAF), wib('2026-12-01T00:00:00'))));
    expect(err.code).toBe('ZBX_TLS_PIN_ENDED');
    expect(err.message).toContain('2026-11-30');
    expect(expired.received).toHaveLength(1);
  });

  it('refuses a different certificate before anything is sent', async () => {
    const err = await refusal(post(expired, agent(pinOf(VALID_LEAF))));
    expect(err.code).toBe('ZBX_TLS_PIN_MISMATCH');
    expect(expired.received).toEqual([]);
  });

  it('refuses the pinned certificate on a host it does not name', async () => {
    const err = await refusal(post(expired, agent(pinOf(EXPIRED_LEAF)), '127.0.0.1'));
    expect(err.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    expect(err.message).not.toContain('127.0.0.1');
    expect(expired.received).toEqual([]);
  });

  it('refuses a certificate the system does not trust when it is not the pinned one', async () => {
    const untrusted = createPinnedAgent(pinOf(EXPIRED_LEAF), { now: () => BEFORE_END });
    agents.push(untrusted);
    const err = await refusal(post(valid, untrusted));
    expect(err.code).toMatch(/^UNABLE_TO_|SELF_SIGNED/);
    expect(valid.received).toEqual([]);
  });

  it('lets a certificate that passes the normal check through, even after the last day', async () => {
    const reply = await post(valid, agent(pinOf(EXPIRED_LEAF), wib('2027-01-01T00:00:00')));
    expect(reply.ok).toBe(true);
    expect(valid.received).toHaveLength(1);
  });

  it('gives up at the deadline under the name fetch uses for its own', async () => {
    expired.stall = true;
    const err = await post(expired, agent(pinOf(EXPIRED_LEAF)), 'localhost', 200).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(err?.name).toBe('TimeoutError');
  });
});

describe('judgePeer', () => {
  const pin = pinOf(EXPIRED_LEAF);
  const expiredPeer = { authorized: false, authorizationError: 'CERT_HAS_EXPIRED' };

  it('reports a different certificate ahead of an ended pin', () => {
    const other = { ...expiredPeer, fingerprint256: pinOf(VALID_LEAF).fingerprint256 };
    expect(judgePeer(other, pin, wib('2027-01-01T00:00:00'))?.code).toBe('ZBX_TLS_PIN_MISMATCH');
  });

  it('names the fault when it is something other than age', () => {
    expect(judgePeer({ authorized: false, authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT' }, pin, BEFORE_END)?.code).toBe(
      'DEPTH_ZERO_SELF_SIGNED_CERT',
    );
  });
});

describe('parseTlsPin', () => {
  const hex = new X509Certificate(EXPIRED_LEAF).fingerprint256;

  it('reads the fingerprint with or without colons, in either case', () => {
    expect(parseTlsPin(hex.replace(/:/g, '').toLowerCase(), '2026-11-30')).toEqual(parseTlsPin(hex, '2026-11-30'));
  });

  it('ends the last day at 23:59:59.999 WIB', () => {
    expect(parseTlsPin(hex, '2026-11-30')?.untilMs).toBe(Date.parse('2026-11-30T16:59:59.999Z'));
  });

  it('is off when either half is missing or cannot be read', () => {
    for (const [fingerprint, until] of [
      [hex, ''],
      ['', '2026-11-30'],
      [hex.slice(0, -1), '2026-11-30'],
      [`${hex.slice(0, -2)}ZZ`, '2026-11-30'],
      [hex, '30-11-2026'],
      [hex, '2026-11-31'],
    ]) {
      expect(parseTlsPin(fingerprint, until)).toBeUndefined();
    }
  });
});
