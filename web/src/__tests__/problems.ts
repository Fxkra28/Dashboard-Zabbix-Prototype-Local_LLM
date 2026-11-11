import type { Problem } from '../types';

/** An open problem; `clock` is seconds ago from a fixed base, so bigger means older. */
export function problem(id: number, severity: number, ageSeconds = 0, extra: Partial<Problem> = {}): Problem {
  return {
    eventid: String(id),
    objectid: String(id),
    object: '0',
    name: `Problem ${id}`,
    severity: String(severity),
    clock: String(1_800_000_000 - ageSeconds),
    r_eventid: '0',
    acknowledged: '0',
    host: `host-${id}`,
    hostid: String(10_000 + id),
    ...extra,
  };
}

export const ids = (list: Problem[]) => list.map((p) => p.eventid);
