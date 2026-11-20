import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../core/cache.js';

/**
 * Hosts, Devices and the Network page place a host by the same four signals as Sites and the scorecard: a tag, the name, the inventory, a group (BK-94). Before, they read the name alone, so the first
 * host that got a site tag was on one site in Sites and on another, or none, in the other three. Every host here is made up.
 */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../clients/zabbix.js')>()), zbx: zbxMock }));

const { getHosts, getHostOverview } = await import('../services/hosts.js');
const { getNetDevices } = await import('../services/net.js');
const { getDevices } = await import('../services/devices.js');
const { siteRefOf } = await import('../services/sites.js');

const HOSTS = [
  // The name says site 2; no tag.
  { hostid: '1', name: '2.1 BRAVO-FW01', status: '0', tags: [], hostgroups: [{ groupid: '9', name: 'FIREWALL DEVICES HCML' }], inventory: [] },
  // The name says nothing; a tag does.
  { hostid: '2', name: 'LAB-SWITCH-7', status: '0', tags: [{ tag: 'site', value: 'Surabaya' }], hostgroups: [], inventory: [] },
  // A tag outranks the name.
  { hostid: '3', name: '2.2.1 BRAVO-SW01', status: '0', tags: [{ tag: 'site', value: 'Jakarta' }], hostgroups: [], inventory: [] },
  // The name says nothing; the inventory does.
  { hostid: '4', name: 'LAB-AP-3', status: '0', tags: [], hostgroups: [], inventory: { site_city: 'Sumenep', location: '' } },
  // The name says nothing; only a group of the kind of device, which names no site.
  { hostid: '5', name: 'LAB-ARUBA-9', status: '0', tags: [], hostgroups: [{ groupid: '8', name: 'ARUBA' }], inventory: [] },
  // A tag that names a site HCML does not keep: no code to give.
  { hostid: '6', name: 'LAB-X', status: '0', tags: [{ tag: 'site', value: 'Bali' }], hostgroups: [], inventory: [] },
];

beforeEach(() => {
  invalidate('');
  zbxMock.mockReset();
  zbxMock.mockImplementation(async (method: string, params: { selectParentTemplates?: unknown }) => {
    if (method === 'host.get') return params.selectParentTemplates ? HOSTS.map((h) => ({ hostid: h.hostid, parentTemplates: [] })) : HOSTS.map((h) => structuredClone(h));
    return [];
  });
});

const siteOf = (rows: { hostid: string; site: unknown }[]) => Object.fromEntries(rows.map((r) => [r.hostid, r.site]));
const EXPECTED = {
  '1': { code: 2, name: 'Surabaya' },
  '2': { code: 2, name: 'Surabaya' },
  '3': { code: 1, name: 'Jakarta' },
  '4': { code: 6, name: 'Sumenep' },
  '5': null,
  '6': null,
};

describe('the site of a host (BK-94)', () => {
  it('is the same in Hosts, in Devices and on the Network page, and is the one the Sites page gives', async () => {
    expect(siteOf(await getHosts())).toEqual(EXPECTED);
    expect(siteOf(await getDevices().then((d) => d.devices))).toEqual(EXPECTED);
    expect(siteOf(await getNetDevices())).toEqual(EXPECTED);
    expect(siteOf(await getHostOverview())).toEqual(EXPECTED);
  });

  it('asks for the tags, the groups and the inventory in the host read, and does not pass them on', async () => {
    const hosts = await getHosts();
    const [, params] = zbxMock.mock.calls.find(([method, p]) => method === 'host.get' && !p.selectParentTemplates)!;
    expect(params).toMatchObject({ selectTags: ['tag', 'value'], selectHostGroups: ['groupid', 'name'], selectInventory: ['site_city', 'location'] });
    for (const host of hosts) {
      expect(host).not.toHaveProperty('tags');
      expect(host).not.toHaveProperty('hostgroups');
      expect(host).not.toHaveProperty('inventory');
    }
  });

  it('is read by siteRefOf from a tag by its name or one of its aliases, whatever the case', () => {
    const host = (value: string) => ({ hostid: '1', name: 'LAB', status: '0', tags: [{ tag: 'site', value }] });
    expect(siteRefOf(host('SBY'))).toEqual({ code: 2, name: 'Surabaya' });
    expect(siteRefOf(host('surabaya'))).toEqual({ code: 2, name: 'Surabaya' });
    expect(siteRefOf(host('FPSO'))).toEqual({ code: 4, name: 'FPSO KAS3 & BD-WHP' });
    expect(siteRefOf(host('Atlantis'))).toBeNull();
  });
});
