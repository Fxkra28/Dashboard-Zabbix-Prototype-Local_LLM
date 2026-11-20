import type { Problem } from '../../types';

/** A problem Zabbix has resolved and still lists for a few minutes. */
export const isResolved = (p: Problem): boolean => Boolean(p.r_eventid && p.r_eventid !== '0');

/** A problem raised during a planned maintenance window: every count of the portal leaves it out. */
export const isInMaintenance = (p: Problem): boolean => !isResolved(p) && p.suppressed === '1';

/** What the problems of a list are: still open and counted, left out for a maintenance window, or resolved a moment ago. A resolved problem is resolved whatever window it was raised in. */
export function partsOf(list: Problem[]): { open: number; maintenance: number; resolved: number } {
  const resolved = list.filter(isResolved).length;
  const maintenance = list.filter(isInMaintenance).length;
  return { open: list.length - resolved - maintenance, maintenance, resolved };
}

/** The line beside the filters: how many match and, when some are not simply open, how they divide. The open ones are the Dashboard's count (FR-75). */
export function matchingWords(list: Problem[]): string {
  const { open, maintenance, resolved } = partsOf(list);
  if (!maintenance && !resolved) return `${list.length} matching`;
  const parts = [`${open} open`, ...(maintenance ? [`${maintenance} in maintenance`] : []), ...(resolved ? [`${resolved} just resolved`] : [])];
  return `${list.length} matching: ${parts.join(', ')}`;
}
