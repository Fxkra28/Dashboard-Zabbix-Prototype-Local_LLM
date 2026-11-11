import type { Device } from '../../types';

/** What a kind of device adds up to: how many, how many have a problem, how many do not answer. */
export interface Tally {
  total: number;
  withProblems: number;
  down: number;
}

export const tally = (list: Device[]): Tally => ({
  total: list.length,
  withProblems: list.filter((d) => d.problems.total > 0).length,
  down: list.filter((d) => d.state === 'down').length,
});

/** The small print under a count: what is wrong with the devices of the kind, or that nothing is. */
export const trouble = (t: Tally): string => {
  const parts = [t.withProblems > 0 ? `${t.withProblems} with problems` : 'no problems'];
  if (t.down > 0) parts.push(`${t.down} down`);
  return parts.join(' · ');
};
