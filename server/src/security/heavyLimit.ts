import type { FastifyReply, FastifyRequest } from 'fastify';
import { callerOf } from '../clients/limits.js';

/** Heavy reports (availability, noise, capacity, top triggers) one person may have waiting or running: a page asks for two at most, so four is two pages open (BK-75). */
export const HEAVY_REPORTS_PER_PERSON = 4;

/** Places one person may hold in the line of the derived SLA reads: the month page asks for two (both methods) and a report file takes two, so four is two pages, or a page and a file (BK-76). */
export const SLI_READS_PER_PERSON = 4;

/**
 * One line of slow reads. `take` gives a person `places` in it and the function that frees them, or null when that would pass `limit`: the Assistant takes its places by name, for the
 * reads of one question. A guard takes them for a request and frees them when its connection closes, and refuses with 429 what would not fit.
 */
function personLine(limit: number, message: string) {
  const holding = new Map<string, number>();
  const take = (caller: string, places = 1): (() => void) | null => {
    const held = holding.get(caller) ?? 0;
    if (held + places > limit) return null;
    holding.set(caller, held + places);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (holding.get(caller) ?? places) - places;
      if (left > 0) holding.set(caller, left);
      else holding.delete(caller);
    };
  };
  /** A preHandler, after the auth guard and the query's schema, for a request that takes `places` in the line. */
  const guardFor = (places = 1) =>
    async function guard(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
      const release = take(callerOf(req), places);
      if (!release) return reply.code(429).header('retry-after', '10').send({ error: 'rate_limited', message });
      // 'close' follows 'finish' for an answer that was sent and comes alone for a reader who left.
      reply.raw.once('close', release);
      if (reply.raw.destroyed || reply.raw.writableEnded) release();
    };
  return Object.assign(guardFor, { take });
}

const heavyLine = personLine(HEAVY_REPORTS_PER_PERSON, `You already have ${HEAVY_REPORTS_PER_PERSON} reports being prepared. Wait for one to finish, then ask again.`);
const sliLine = personLine(SLI_READS_PER_PERSON, `Too many of your monthly SLA reads are being prepared at once (${SLI_READS_PER_PERSON} at most). Wait for one to finish, then ask again.`);

/** A place of a person in the line of the heavy reports, or null when they hold four (BK-88). The Assistant takes one for each heavy topic of a question, as a report page does. */
export const takeHeavyPlace = (caller: string): (() => void) | null => heavyLine.take(caller, 1);

/** A place of a person in the line of the derived SLA reads, or null when they hold four (BK-88). */
export const takeSliPlace = (caller: string): (() => void) | null => sliLine.take(caller, 1);

/** A fifth heavy report of one person is refused, so a script cannot fill the line of the gate. */
export const heavyReportGuard = heavyLine();

/** One month in one method (/api/sli, the service tree): one place in the line of the derived SLA reads. */
export const sliReadGuard = sliLine();

/** The month's report file reads both methods, so it takes two places. */
export const sliExportGuard = sliLine(2);
