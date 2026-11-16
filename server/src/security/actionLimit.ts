import type { FastifyRequest } from 'fastify';
import { MinuteLimit, callerOf } from '../clients/limits.js';
import { config } from '../core/config.js';

/**
 * Events one person may acknowledge or close in a minute, the two together (SC-51). The limit of 50 ids a request stopped a slip and
 * nothing else: a script could repeat the call, and HCML has about 700 open problems. Counted in memory, in a minute that the first call opens.
 */
let limit: MinuteLimit | undefined;
let limitFor = 0;

/** Count `events` for the person who asked: null when they may go ahead, else the seconds until their minute is over. */
export function takeEvents(req: FastifyRequest, events: number): number | null {
  const max = config.actions.eventsPerMinute;
  if (!limit || limitFor !== max) {
    limit = new MinuteLimit(max);
    limitFor = max;
  }
  return limit.take(callerOf(req), events);
}

export const limitMessage = (wait: number): string =>
  `The limit is ${config.actions.eventsPerMinute} events a minute for each person, acknowledge and close together. Try again in ${wait} second${wait === 1 ? '' : 's'}.`;
