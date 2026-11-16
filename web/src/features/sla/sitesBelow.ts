import type { SliGroup } from '../../types';

/** The "Sites below target" card, from the sites of one report: how many fall short, which, and how many have no figure to judge (FR-50). */
export function sitesBelowCard(
  sites: readonly Pick<SliGroup, 'name' | 'sli' | 'meeting'>[],
  target: number,
): { value: number; sub: string } {
  const below = sites.filter((s) => s.meeting === false);
  const unmeasured = sites.filter((s) => s.sli === null).length;
  const without = unmeasured ? `${unmeasured} without data` : '';
  if (below.length) {
    const names = below.slice(0, 3).map((s) => s.name).join(', ') + (below.length > 3 ? ` +${below.length - 3}` : '');
    return { value: below.length, sub: without ? `${names} · ${without}` : names };
  }
  if (!sites.length) return { value: 0, sub: 'no sites in this report' };
  return { value: 0, sub: without ? `none below ${target}%, ${without}` : `all sites at or above ${target}%` };
}
