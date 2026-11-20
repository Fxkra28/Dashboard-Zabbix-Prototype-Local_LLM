import { describe, expect, it } from 'vitest';
import { MODULE_IDS, accessOf, judge } from '../security/modules.js';

/**
 * Who may open Explain (SC-62). It follows the route table: the problem's detail is for the people who hold the page it is opened from, and the derived SLA for the people
 * who hold the SLA or Services page. The Assistant page asks neither, so a person with that page alone could read any problem by calling the API.
 */
const OWNERS: Record<string, string[]> = {
  '/api/explain/problem': ['problems', 'dashboard'],
  '/api/explain/sla': ['sla', 'services'],
};

describe.each(Object.entries(OWNERS))('%s', (route, owners) => {
  it.each(MODULE_IDS.filter((id) => id !== 'users'))('is %s-only account allowed or refused by the pages it holds', (id) => {
    const verdict = judge(accessOf('guest', [id]), route);
    expect(verdict.ok, `${id} on ${route}`).toBe(owners.includes(id));
  });

  it('is refused to an account that holds the Assistant page alone, with the pages that open it named', () => {
    const verdict = judge(accessOf('guest', ['assistant']), route);
    expect(verdict).toMatchObject({ ok: false, why: 'module' });
    expect(verdict.ok === false && verdict.why === 'module' ? verdict.modules : []).toEqual(owners);
  });

  it('is open to an administrator', () => {
    expect(judge(accessOf('admin', []), route).ok).toBe(true);
  });
});
