import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The scorecard's Site check counts a host that states its site by tag, by the code in its name, or by
 * inventory, and only those. The hint beside the check has to name all three, or a reader cannot tell why
 * a host with no tag and no inventory counts as present (BK-32).
 */
const { hostsMock } = vi.hoisted(() => ({ hostsMock: vi.fn() }));
vi.mock('../domain/queries.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domain/queries.js')>()),
  getHostsWithMeta: hostsMock,
}));

const { getScorecard } = await import('../services/inventory.js');
const { invalidate } = await import('../core/cache.js');

const host = (hostid: string, name: string, over: Record<string, unknown> = {}) => ({
  hostid,
  name,
  tags: [],
  hostgroups: [{ groupid: '9', name: 'ARUBA' }],
  inventory: [],
  ...over,
});

beforeEach(() => {
  invalidate('');
  hostsMock.mockReset().mockResolvedValue([
    host('1', '1.2.1 IDX02CORESWITCH'),
    host('2', 'WEB : PORTAL'),
    host('3', 'plain-name', { tags: [{ tag: 'site', value: 'Jakarta' }] }),
    host('4', 'other-name', { inventory: { site_city: 'Surabaya' } }),
  ]);
});

describe('the Site check of the inventory scorecard (BK-32)', () => {
  it('counts a host by tag, by the site code in its name and by inventory, and not one that has only a host group', async () => {
    const site = (await getScorecard()).dimensions.find((d) => d.key === 'site')!;
    expect(site).toMatchObject({ present: 3, total: 4, scored: true });
  });

  it('names all three ways in its hint', async () => {
    const { hint } = (await getScorecard()).dimensions.find((d) => d.key === 'site')!;
    expect(hint).toMatch(/tag "site"/);
    expect(hint).toMatch(/host name/);
    expect(hint).toMatch(/inventory site_city \/ location/);
  });
});
