import type { FastifyReply, FastifyRequest } from 'fastify';
import { HourLimit, callerOf } from '../clients/limits.js';

/**
 * Report emails an hour for each person. A report goes out about once a month, so five is generous, and a stuck button
 * or a stolen session cannot fill inboxes or get the sending account blocked. Counted in memory, in a fixed hour that the first
 * send opens, so up to ten can go across the edge of two hours.
 */
export const SENDS_PER_HOUR = 5;

const sends = new HourLimit(SENDS_PER_HOUR);

/** The sentence for a person who has used the allowance; `wait` is in seconds and the minutes are rounded up. */
export function limitMessage(wait: number): string {
  const minutes = Math.max(1, Math.ceil(wait / 60));
  return `The limit is ${SENDS_PER_HOUR} report emails an hour for each person. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/**
 * True, with the 429 already sent, when this person has used the hour's allowance. It counts the call, so a handler
 * calls it only for a request that will go on to send.
 */
export function tooManySends(req: FastifyRequest, reply: FastifyReply): boolean {
  const wait = sends.take(callerOf(req));
  if (wait === null) return false;
  void reply.code(429).header('retry-after', String(wait)).send({ error: 'rate_limited', message: limitMessage(wait) });
  return true;
}
