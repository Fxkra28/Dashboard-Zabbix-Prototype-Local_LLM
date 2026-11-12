import type { FastifyRequest } from 'fastify';
import { ZabbixRefusedError, ZabbixTimeoutError, ZabbixApiError } from '../clients/zabbix.js';
import { actor } from '../security/audit.js';

/**
 * Acknowledge / close write-back: the portal's only write path.
 *
 * Everything else in this BFF is read-only by design (`setup.md` §20). These two routes
 * deliberately break that, so they are fenced four ways:
 *
 *   1. a separate `ZABBIX_WRITE_TOKEN`: the read token never gains write power
 *   2. `operator` role or above, enforced in auth.ts ROUTE_RULES
 *   3. blank write token ⇒ 503, and the UI hides the buttons entirely
 *   4. sign-in off ⇒ 503 too, unless ALLOW_WRITE_WITHOUT_AUTH=true
 *
 * Zabbix files every write under the write token's owner, so the portal user goes into the message
 * as `[portal:<user>]`; every attempt and failure is logged with user and address, and one request
 * acts on at most 50 events.
 *
 * Zabbix exposes both actions through one method, `event.acknowledge`, with a bitmask. The bits
 * used here:
 *
 *   1  close problem      2  acknowledge      4  add message
 *
 * Closing only works when the trigger sets `manual_close`; `getProblems()` carries that flag so the
 * UI does not offer a button Zabbix will reject.
 */

export const ACTION_CLOSE = 1;
export const ACTION_ACKNOWLEDGE = 2;
export const ACTION_MESSAGE = 4;

/** Zabbix caps acknowledge messages at 2048 characters. */
export const MAX_MESSAGE = 2048;

/** Most event ids one request may act on: a slip or a script cannot close a whole estate. */
export const MAX_EVENTIDS = 50;

/** The event ids a body names, for the log only: at most MAX_EVENTIDS, each cut short, whatever the body holds. */
function idsForLog(body: unknown): string[] {
  const raw = body && typeof body === 'object' ? (body as AckBody).eventids : undefined;
  return (Array.isArray(raw) ? raw : [raw])
    .filter((id): id is string => typeof id === 'string')
    .slice(0, MAX_EVENTIDS)
    .map((id) => id.slice(0, 32));
}

/** Who, from where, which events and what for, read loosely: even a malformed body leaves a line that says what it was after. */
export function trailOf(req: FastifyRequest) {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as AckBody;
  return {
    user: actor(req),
    ip: req.ip,
    eventids: idsForLog(req.body),
    acknowledge: typeof body.acknowledge === 'boolean' ? body.acknowledge : true,
    close: body.close === true,
  };
}

/** Every attempt is on record with who and from where, before any check can turn it away. */
export async function logAttempt(req: FastifyRequest): Promise<void> {
  req.log.info(trailOf(req), 'zabbix write-back attempt');
}

export const WRITE_REFUSED = 'Zabbix refused the change. It may already be closed, or this account may not be allowed to change it.';
export const WRITE_UNCLEAR = 'The portal could not tell whether Zabbix took the change, so it may or may not have been made. Look at the problem again before you try it again.';
export const WRITE_MAY_HAVE_GONE = 'Zabbix did not answer in time, so the change may or may not have been made. Look at the problem again before you try it again.';

/**
 * The answer for a write that failed in a way the general "not answering" would misstate: Zabbix refused it, or timed out or answered
 * unreadably with the change possibly made. Zabbix's own words go to the log. Undefined for any other failure, which the error handler words as before.
 */
export function writeFailure(err: unknown, requestId: string): { status: number; error: string; message: string } | undefined {
  const reference = `Tell an administrator and quote reference ${requestId}.`;
  if (err instanceof ZabbixRefusedError) return { status: 502, error: 'zabbix_error', message: `${WRITE_REFUSED} ${reference}` };
  if (err instanceof ZabbixTimeoutError) return { status: 503, error: 'zabbix_timeout', message: `${WRITE_MAY_HAVE_GONE} ${reference}` };
  // An error page, or a connection that broke after the request went out: the outcome is unknown, as after a timeout.
  if (err instanceof ZabbixApiError && err.maybeApplied) return { status: 502, error: 'zabbix_error', message: `${WRITE_UNCLEAR} ${reference}` };
  return undefined;
}

/** Requests the handler has already logged as refused or failed, so the response hook does not log them twice. */
export const answered = new WeakSet<FastifyRequest>();

export interface AckBody {
  eventids?: string[] | string;
  message?: string;
  /** Also close the problem. Requires the trigger to allow manual close. */
  close?: boolean;
  /** Acknowledge as well as close. Defaults to true. */
  acknowledge?: boolean;
}

/**
 * Caches that show problem/acknowledgement state and go stale after a write.
 * Prefixes: `map:` is every map's detail, `services` both service trees.
 * `chat:snapshot` exists only in the portal with the assistant; elsewhere it
 * matches nothing.
 */
export const STALE_AFTER_WRITE = [
  'problems',
  'stats',
  'probsByGroup',
  'sites',
  'aging',
  'services',
  'hosts:overview',
  'devices',
  'map:',
  'chat:snapshot',
];

/**
 * How long those keys stay on a short TTL after a write. Zabbix applies a
 * close a few seconds after `event.acknowledge` returns, so the first refetch
 * can still read the problem as open.
 */
export const WRITE_HOLD_MS = 15_000;
