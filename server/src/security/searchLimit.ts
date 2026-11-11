import type { FastifyReply, FastifyRequest } from 'fastify';
import { MinuteLimit, callerOf } from '../clients/limits.js';

/**
 * Text searches a minute for each person, in the item picker and in Latest data: a search with new text is a cold read of
 * Zabbix, so it has a smaller allowance than the per-address limit. A request with no text is not counted.
 */
export const SEARCHES_PER_MINUTE = 120;

const searches = new MinuteLimit(SEARCHES_PER_MINUTE, () => Date.now());

/** A preHandler, so it runs after the auth guard has set `req.user`: 429 past the allowance, before any Zabbix read. */
export async function searchGuard(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  const text = (req.query as { search?: unknown } | undefined)?.search;
  if (typeof text !== 'string' || text.trim() === '') return;
  const wait = searches.take(callerOf(req));
  if (wait === null) return;
  return reply
    .code(429)
    .header('retry-after', String(wait))
    .send({
      error: 'rate_limited',
      message: `You are searching too quickly: the limit is ${SEARCHES_PER_MINUTE} searches a minute for each person. Try again in ${wait} second${wait === 1 ? '' : 's'}.`,
    });
}
