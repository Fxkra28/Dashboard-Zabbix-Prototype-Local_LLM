import { config } from '../core/config.js';
import { PinnedTlsError, pinnedAgentFor, postPinned, type Reply } from './pinnedTls.js';

/**
 * One typed JSON-RPC 2.0 helper. The Zabbix API token lives here and never
 * leaves the server. Every portal read goes through this.
 */
let id = 0;

/**
 * Raised when Zabbix rejects our credentials (expired/invalid/revoked token).
 * Distinguished from a generic failure so the log and the status code say "fix the token"
 * (the reply to a browser stays the same sentence for every Zabbix failure, errors.ts).
 */
export class ZabbixAuthError extends Error {
  readonly code = 'zabbix_auth';
}

const AUTH_HINTS = [
  'token expired',
  're-login',
  'not authorised',
  'not authorized',
  'invalid token',
  'session terminated',
];

function isAuthFailure(error: unknown): boolean {
  const text = JSON.stringify(error).toLowerCase();
  return AUTH_HINTS.some((hint) => text.includes(hint));
}

/**
 * Raised when Zabbix did not answer within `ZABBIX_TIMEOUT_MS`.
 *
 * Distinguished from a generic failure for the same reason `ZabbixAuthError`
 * is: "Zabbix is not responding" and "the portal is broken" need different
 * responses from whoever is reading the screen.
 */
export class ZabbixTimeoutError extends Error {
  readonly code = 'zabbix_timeout';
  /** For the BFF log only (it names ZBX_URL); never part of a response. */
  readonly detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.detail = detail;
  }
}

/**
 * Zabbix could not be reached, answered with a non-2xx status or something that is not JSON-RPC, or
 * returned a JSON-RPC error: bad parameters, or a rejected write such as closing a trigger that
 * does not allow manual close. An upstream failure rather than a portal bug, so it maps to 502
 * carrying Zabbix's own words, which usually name what to fix.
 *
 * The message reaches the browser, so it never carries the Zabbix address: that, and whatever
 * Zabbix sent back, go in `detail` for the log.
 */
export class ZabbixApiError extends Error {
  readonly code = 'zabbix_error';
  /** For the BFF log only (it names ZBX_URL); never part of a response. */
  readonly detail?: string;
  /** The request went out and what came back does not say whether Zabbix applied it: for a write, the change may have been made (BK-53). */
  readonly maybeApplied: boolean;
  constructor(message: string, detail?: string, maybeApplied = false) {
    super(message);
    this.detail = detail;
    this.maybeApplied = maybeApplied;
  }
}

/** Zabbix answered, and its answer was an error: bad parameters, or a write it would not take. A Zabbix that could not be reached is the plain error above. */
export class ZabbixRefusedError extends ZabbixApiError {}

/** Raised when a write is attempted with no ZABBIX_WRITE_TOKEN configured. `detail` names the setting, for the log only. */
export class ZabbixWriteDisabledError extends Error {
  readonly code = 'zabbix_write_disabled';
  readonly detail =
    'Set ZABBIX_WRITE_TOKEN in server/.env. It must be a separate, write-capable Zabbix token, never the read-only one.';
  constructor() {
    super('Acknowledge and Close are not switched on for this portal. Tell an administrator.');
  }
}

/** The start of an unexpected body, on one line, for the log. */
function snippet(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
}

/** One POST to ZBX_URL: through the pinned agent while an expired certificate is excepted, else plain `fetch`. */
async function send(payload: string, token: string, timeoutMs: number): Promise<Reply> {
  const headers = { 'Content-Type': 'application/json-rpc', Authorization: `Bearer ${token}` };
  const pin = config.zbxTlsPin;
  if (pin && /^https:/i.test(config.zbxUrl)) {
    return postPinned(config.zbxUrl, headers, payload, timeoutMs, pinnedAgentFor(pin));
  }
  const res = await fetch(config.zbxUrl, {
    method: 'POST',
    headers,
    body: payload,
    // `fetch` has no default timeout. Without this, one unresponsive Zabbix
    // holds the request, and every page waiting on it, open indefinitely.
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Read the body under the same timeout. `fetch` resolves once the headers
  // arrive, so a Zabbix that stalled while still sending a large answer used
  // to escape the timeout here and end up as a bare 500.
  return { ok: res.ok, status: res.status, statusText: res.statusText, body: await res.text() };
}

/** System codes of a connection that failed before it could carry a request: it never opened, or its certificate was refused first. */
const NEVER_SENT = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAI_FAIL',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'UND_ERR_CONNECT_TIMEOUT',
  'ERR_INVALID_URL',
]);
const CERTIFICATE_REFUSED = /^(?:ERR_TLS_|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT$|SELF_SIGNED_CERT_IN_CHAIN$|UNABLE_TO_)/;

/** Whether a failure with this system code came before the request left, so that a write cannot have been applied. */
export function requestNeverLeft(code: unknown): boolean {
  return typeof code === 'string' && (NEVER_SENT.has(code) || CERTIFICATE_REFUSED.test(code));
}

async function call<T>(method: string, params: unknown, token: string, timeoutMs: number): Promise<T> {
  let res: Reply;
  try {
    res = await send(JSON.stringify({ jsonrpc: '2.0', method, params, id: ++id }), token, timeoutMs);
  } catch (err) {
    if (err instanceof PinnedTlsError) {
      throw new ZabbixApiError(`Refused Zabbix's certificate for ${method} (${err.code}). ${err.message}`, `ZBX_URL=${config.zbxUrl}`);
    }
    const name = (err as { name?: unknown } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ZabbixTimeoutError(
        `Zabbix did not respond to ${method} within ${timeoutMs} ms. ` +
          'It may be overloaded or unreachable. Check ZBX_URL and the Zabbix server.',
        `ZBX_URL=${config.zbxUrl}`,
      );
    }
    // Connection refused, DNS failure, TLS error, a connection dropped part-way.
    // The system error names the host and port, so only its code is shown.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const code = (cause as { code?: unknown } | null)?.code;
    throw new ZabbixApiError(
      `Could not reach Zabbix for ${method}${typeof code === 'string' ? ` (${code})` : ''}. ` +
        'Check ZBX_URL and that the Zabbix frontend is running.',
      `ZBX_URL=${config.zbxUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
      // A refused or unresolved connection never carried the request; a reset or a drop part-way may have.
      !requestNeverLeft(code),
    );
  }

  if (!res.ok) {
    throw new ZabbixApiError(
      `${method}: HTTP ${res.status} ${res.statusText}`,
      `ZBX_URL=${config.zbxUrl} answered: ${snippet(res.body)}`,
      true,
    );
  }

  // A 200 that is not JSON-RPC: ZBX_URL pointing at the frontend's login page
  // rather than api_jsonrpc.php, or PHP failing part-way through (zabbix-web
  // running out of memory on a large trend.get prints an HTML error).
  let json: { result?: T; error?: unknown } | null;
  try {
    json = JSON.parse(res.body) as { result?: T; error?: unknown } | null;
  } catch {
    json = null;
  }
  if (!json || typeof json !== 'object') {
    throw new ZabbixApiError(
      `${method}: Zabbix returned a non-JSON response. Check that ZBX_URL points at api_jsonrpc.php ` +
        'and that the Zabbix frontend is not out of memory.',
      `ZBX_URL=${config.zbxUrl} answered: ${snippet(res.body)}`,
      true,
    );
  }

  if (json.error) {
    if (isAuthFailure(json.error)) {
      throw new ZabbixAuthError(
        'Zabbix rejected the API token (expired, invalid, or revoked). Update ZABBIX_API_TOKEN ' +
          '(or ZABBIX_WRITE_TOKEN, for acknowledge/close) in server/.env.',
      );
    }
    throw new ZabbixRefusedError(`${method}: ${JSON.stringify(json.error)}`);
  }
  return json.result as T;
}

/** A read with a limit of its own, such as the background count over every item, says so here. */
export interface ZbxOptions {
  timeoutMs?: number;
}

/** Every portal read goes through here, using the read-only token. */
export async function zbx<T = unknown>(method: string, params: unknown = {}, opts: ZbxOptions = {}): Promise<T> {
  return call<T>(method, params, config.zbxToken, opts.timeoutMs ?? config.zbxTimeoutMs);
}

/**
 * The only write path (§20). Uses the separate write token so the read
 * credential never gains the ability to modify Zabbix.
 */
export async function zbxWrite<T = unknown>(method: string, params: unknown = {}): Promise<T> {
  if (!config.zbxWriteToken) throw new ZabbixWriteDisabledError();
  return call<T>(method, params, config.zbxWriteToken, config.zbxTimeoutMs);
}
