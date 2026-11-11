import type { Problem } from '../../types';

/**
 * What the live stream's frames say about a list, as one comparable string: which problems there are and how each stands (open or
 * resolved, acknowledged, in maintenance, graded). Names, hosts and live values are left out, as on the server (services/stream.ts,
 * `fingerprint`), and so is the order.
 */
export function changeKey(problems: readonly Problem[]): string {
  return problems
    .map((p) => `${p.eventid}:${p.severity}:${p.acknowledged}:${p.suppressed ?? ''}:${p.r_eventid ?? ''}`)
    .sort()
    .join('|');
}
