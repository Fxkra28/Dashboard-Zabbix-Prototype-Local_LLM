import type { Problem } from '../../types';

/** Rows in the live list; the rest are one click away on the Problems page (DESIGN.md section 9). */
export const LIVE_ROWS = 12;

/** Worst first: severity, then newest. */
export const worstFirst = (a: Problem, b: Problem) =>
  Number(b.severity) - Number(a.severity) ||
  Number(b.clock) - Number(a.clock) ||
  Number(b.eventid) - Number(a.eventid);

/** The rows the live list shows for an open list, before any cleared ones are added back. */
export const topRows = (open: Problem[]) => [...open].sort(worstFirst).slice(0, LIVE_ROWS);

/**
 * The live list: the worst LIVE_ROWS open problems, plus any that just cleared
 * (the wall's highlight), each in the place its severity and age give it.
 */
export function liveRows(open: Problem[], cleared: Problem[]): Problem[] {
  const openIds = new Set(open.map((p) => p.eventid));
  const gone = cleared.filter((p) => !openIds.has(p.eventid));
  const rows: Problem[] = [];
  let shown = 0;
  for (const p of [...open, ...gone].sort(worstFirst)) {
    if (openIds.has(p.eventid)) {
      if (shown === LIVE_ROWS) break;
      shown++;
    }
    rows.push(p);
  }
  return rows;
}
