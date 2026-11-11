import https from 'node:https';
import tls from 'node:tls';
import type { Duplex } from 'node:stream';
import type { TlsPin } from '../core/config.js';

/** Why a connection was refused. Like ZabbixApiError's, the message never names the host. */
export class PinnedTlsError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** What a handshake showed. Node skips `tls.checkServerIdentity` when the chain fails, so the caller runs it. */
export interface Peer {
  authorized: boolean;
  authorizationError?: string;
  fingerprint256?: string;
  identityError?: Error;
}

/**
 * A certificate that passes the normal check goes on. Otherwise only the pinned one does, when Node calls it expired and
 * the last day has not passed; Node names only the last fault it found, so the fingerprint is what identifies the server. Pure.
 */
export function judgePeer(peer: Peer, pin: TlsPin, nowMs: number): PinnedTlsError | undefined {
  if (peer.authorized) return undefined;
  const fault = peer.authorizationError ?? 'UNVERIFIED';
  if (fault !== 'CERT_HAS_EXPIRED') {
    return new PinnedTlsError(fault, 'The certificate fails the normal check for a reason other than its age.');
  }
  if (peer.identityError) {
    return new PinnedTlsError('ERR_TLS_CERT_ALTNAME_INVALID', 'The certificate does not name the host in ZBX_URL.');
  }
  if (peer.fingerprint256 !== pin.fingerprint256) {
    return new PinnedTlsError('ZBX_TLS_PIN_MISMATCH', 'The server sent a different certificate from the one in ZBX_TLS_PIN_SHA256.');
  }
  if (nowMs > pin.untilMs) {
    return new PinnedTlsError(
      'ZBX_TLS_PIN_ENDED',
      `The exception for the expired certificate ended on ${pin.until}. Renew the certificate.`,
    );
  }
  return undefined;
}

/** For tests: a CA trusted in place of the system's, and a clock. */
export interface PinOptions {
  ca?: string;
  now?: () => number;
}

/** Judges each connection before the request is written to it, so a refused server never receives the token. */
class PinnedAgent extends https.Agent {
  constructor(
    private readonly pin: TlsPin,
    private readonly opts: PinOptions,
  ) {
    super({ keepAlive: true });
  }

  createConnection(options: https.RequestOptions, callback?: (err: Error | null, stream: Duplex) => void): undefined {
    const host = options.servername || options.host || '';
    const socket = tls.connect({ ...(options as tls.ConnectionOptions), ca: this.opts.ca ?? options.ca, rejectUnauthorized: false });
    const onError = (err: Error) => callback?.(err, socket);
    socket.once('error', onError);
    socket.once('secureConnect', () => {
      socket.removeListener('error', onError);
      const cert = socket.getPeerCertificate();
      const refused = judgePeer(
        {
          authorized: socket.authorized,
          authorizationError: socket.authorizationError ? String(socket.authorizationError) : undefined,
          fingerprint256: cert.fingerprint256,
          identityError: socket.authorized ? undefined : tls.checkServerIdentity(host, cert),
        },
        this.pin,
        (this.opts.now ?? Date.now)(),
      );
      if (refused) socket.destroy();
      callback?.(refused ?? null, socket);
    });
    return undefined;
  }
}

let shared: { agent: https.Agent; key: string } | undefined;

/** The agent for `pin`, made again once its last day has passed, so no connection opened before carries a request after. */
export function pinnedAgentFor(pin: TlsPin, nowMs = Date.now()): https.Agent {
  const key = `${pin.fingerprint256} ${pin.until} ${nowMs > pin.untilMs}`;
  if (shared?.key !== key) {
    shared?.agent.destroy();
    shared = { agent: new PinnedAgent(pin, {}), key };
  }
  return shared.agent;
}

/** A pinned agent with test options; the client itself uses `pinnedAgentFor`. */
export function createPinnedAgent(pin: TlsPin, opts: PinOptions = {}): https.Agent {
  return new PinnedAgent(pin, opts);
}

/** What `fetch` would have given back, as far as the JSON-RPC client reads it. */
export interface Reply {
  ok: boolean;
  status: number;
  statusText: string;
  body: string;
}

/** One POST through `agent`, under one deadline for connecting, sending and reading, as `AbortSignal.timeout` gives `fetch`. */
export function postPinned(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
  agent: https.Agent,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'POST', agent, headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', fail);
        res.on('end', () => {
          clearTimeout(timer);
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage ?? '',
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    const timer = setTimeout(() => {
      // Named as `fetch` names its own timeout, which the client already maps.
      const err = Object.assign(new Error(`No answer within ${timeoutMs} ms.`), { name: 'TimeoutError' });
      req.destroy(err);
      reject(err);
    }, timeoutMs);
    function fail(err: Error): void {
      clearTimeout(timer);
      reject(err);
    }
    req.on('error', fail);
    req.end(body);
  });
}
