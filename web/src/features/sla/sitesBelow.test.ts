import { describe, expect, it } from 'vitest';
import { sitesBelowCard } from './sitesBelow';

/**
 * FR-50: the "Sites below target" card says how many sites fall short and how many have no figure to judge, so that "all sites at or above the target"
 * is never said over sites nobody measured. It is worded like the PDF and the Excel file, which count the strict method and add "N without data".
 */
const site = (name: string, sli: number | null, meeting: boolean | null) => ({ name, sli, meeting });

describe('sitesBelowCard', () => {
  it('counts the sites that missed the target and names the first three', () => {
    const sites = [site('A', 97, false), site('B', 98, false), site('C', 95, false), site('D', 90, false), site('E', 99.9, true)];
    expect(sitesBelowCard(sites, 99)).toEqual({ value: 4, sub: 'A, B, C +1' });
  });

  it('adds how many sites have no data, after the names', () => {
    expect(sitesBelowCard([site('A', 97, false), site('B', null, null), site('C', null, null)], 99)).toEqual({
      value: 1,
      sub: 'A · 2 without data',
    });
  });

  it('does not say "all sites at or above" while a site has no data', () => {
    const card = sitesBelowCard([site('A', 99.9, true), site('B', null, null)], 99);
    expect(card).toEqual({ value: 0, sub: 'none below 99%, 1 without data' });
    expect(card.sub).not.toMatch(/all sites/);
  });

  it('says every site is at or above the target only when each one has a figure', () => {
    expect(sitesBelowCard([site('A', 99.9, true), site('B', 99.1, true)], 99)).toEqual({ value: 0, sub: 'all sites at or above 99%' });
  });

  it('says so when the report has no sites at all, and not that all of them pass', () => {
    expect(sitesBelowCard([], 99)).toEqual({ value: 0, sub: 'no sites in this report' });
  });
});
