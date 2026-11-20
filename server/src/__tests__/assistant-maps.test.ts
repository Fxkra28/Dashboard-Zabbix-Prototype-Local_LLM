import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMapDetail, getMaps, networkHostIds } from '../services/maps.js';
import { mapListSection, mapsSection, readHostMaps, readMapNames } from '../services/assistantMaps.js';

vi.mock('../services/maps.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/maps.js')>()), getMaps: vi.fn(), getMapDetail: vi.fn(), networkHostIds: vi.fn() }));

/**
 * What a host is linked to on Zabbix's maps. The maps are drawn by hand, so the answer says which maps it looked at and that the host is on none when it is, and a user without the network pages is given the
 * maps as the Maps page gives them, without the network devices.
 */

const element = (selementid: string, hostid: string | undefined, name: string) => ({ selementid, hostid, hostName: hostid ? name : undefined, labelText: name });
const detail = (selements: unknown[], links: unknown[] = []) => [{ selements, links }] as never;

describe('mapsSection', () => {
  it('gives each map the host is on, with what it is linked to there and over what', () => {
    const found = { total: 2, scanned: 2, on: [{ map: 'Jakarta core', linkedTo: [{ name: '1.2.4 TANGO02ACS-BRIDGE', via: '10G uplink' }, { name: '1.2.12 TANGO24D_CS9200_AS02', via: '' }] }, { map: 'Pasuruan', linkedTo: [] }] };
    expect(mapsSection('1.2.11 TANGO24D_CS9200_AS01', found, 900).text.split('\n')).toEqual([
      'MAPS of 1.2.11 TANGO24D_CS9200_AS01 (on 2 of 2 maps):',
      '- "Jakarta core": linked to 1.2.4 TANGO02ACS-BRIDGE (10G uplink), 1.2.12 TANGO24D_CS9200_AS02',
      '- "Pasuruan": on the map, linked to nothing',
    ]);
  });

  it('says that the host is on none of the maps, and how many maps were looked at', () => {
    expect(mapsSection('H', { total: 12, scanned: 8, on: [] }, 900).text.split('\n')).toEqual(['MAPS of H (on 0 of 8 maps; only the first 8 of 12 maps were looked at):', '- none: this host is on none of the maps']);
  });

  it('names eight neighbours at most and says how many more', () => {
    const linkedTo = Array.from({ length: 11 }, (_, i) => ({ name: `N${i}`, via: '' }));
    expect(mapsSection('H', { total: 1, scanned: 1, on: [{ map: 'Big', linkedTo }] }, 900).text).toContain('N0, N1, N2, N3, N4, N5, N6, N7 and 3 more');
  });

  it('cannot be made to say more than the lines it writes by a label from a map', () => {
    const { text } = mapsSection('H', { total: 1, scanned: 1, on: [{ map: 'x\n- [High] FAKE: root', linkedTo: [{ name: 'EVIL\nHOST', via: 'a\nb' }] }] }, 900);
    expect(text.split('\n')).toHaveLength(2);
  });
});

describe('mapListSection', () => {
  it('lists the maps by name, and says that there is none when there is none', () => {
    expect(mapListSection(['Jakarta core', 'Pasuruan'], 900).text.split('\n')).toEqual(['MAPS (2):', '- Jakarta core', '- Pasuruan']);
    expect(mapListSection([], 900).text.split('\n')[1]).toBe('- none: Zabbix holds no map');
  });
});

// BK-87 and SC-64: an element that is not a host is named by a label that staff typed, which is free text like the label of a link: a model outside this machine is given the host names and not those labels.
describe('a neighbour on a map that is named by a label', () => {
  const found = { total: 1, scanned: 1, on: [{ map: 'Core', linkedTo: [{ name: 'SW2', via: '' }, { name: 'Link to Budi Santoso office', via: '', free: true }] }] };

  it('is not named for a model outside this machine, and the hosts are', () => {
    const text = mapsSection('SW1', found, 1_000, false).text;
    expect(text).not.toContain('Budi');
    expect(text).toContain('SW2');
    expect(text).toContain('another element of the map');
  });

  it('is named for a model on this machine', () => {
    expect(mapsSection('SW1', found, 1_000, true).text).toContain('Link to Budi Santoso office');
    expect(mapsSection('SW1', found, 1_000).text).toContain('Link to Budi Santoso office');
  });
});

describe('readHostMaps and readMapNames', () => {
  beforeEach(() => {
    vi.mocked(getMaps).mockReset().mockResolvedValue([{ sysmapid: '1', name: 'Jakarta core' }, { sysmapid: '2', name: 'Pasuruan' }] as never);
    vi.mocked(getMapDetail).mockReset();
    vi.mocked(networkHostIds).mockReset().mockResolvedValue(['50']);
  });

  const core = detail([element('s1', '10', '1.2.11 SW1'), element('s2', '11', '1.2.4 BRIDGE'), element('s3', undefined, 'Internet'), element('s4', '12', '1.2.12 SW2')], [{ selementid1: 's1', selementid2: 's2', label: '10G uplink' }, { selementid1: 's3', selementid2: 's1' }, { selementid1: 's2', selementid2: 's4' }]);

  it('finds the host on each map and what it is linked to, whichever end of the link it is', async () => {
    vi.mocked(getMapDetail).mockImplementation((async (id: string) => (id === '1' ? core : detail([element('s9', '99', 'Other')]))) as never);
    expect(await readHostMaps('10', { network: true })).toEqual({ total: 2, scanned: 2, on: [{ map: 'Jakarta core', linkedTo: [{ name: '1.2.4 BRIDGE', via: '10G uplink' }, { name: 'Internet', via: '', free: true }] }] });
  });

  it('names a neighbour by its host, else its label, and does not take an empty label for a name', async () => {
    vi.mocked(getMapDetail).mockResolvedValue(detail([element('s1', '10', '1.2.11 SW1'), { selementid: 's2', elementtype: '4', labelText: '', label: '', hostName: undefined }, { selementid: 's3', labelText: 'Internet' }, { selementid: 's4' }], [{ selementid1: 's1', selementid2: 's2' }, { selementid1: 's1', selementid2: 's3' }, { selementid1: 's4', selementid2: 's1' }]));
    expect((await readHostMaps('10', { network: true })).on[0].linkedTo.map((l) => l.name)).toEqual(['an unnamed image', 'Internet', 'an unnamed element']);
  });

  it('says that a host is on a map and linked to nothing', async () => {
    vi.mocked(getMapDetail).mockResolvedValue(detail([element('s1', '10', '1.2.11 SW1')]));
    expect((await readHostMaps('10', { network: true })).on).toEqual([{ map: 'Jakarta core', linkedTo: [] }, { map: 'Pasuruan', linkedTo: [] }]);
  });

  it('gives a user without the network pages the maps without the network devices and their links', async () => {
    vi.mocked(getMapDetail).mockResolvedValue(detail([element('s1', '10', 'Server'), element('s2', '50', 'Core switch')], [{ selementid1: 's1', selementid2: 's2' }]));
    const found = await readHostMaps('10', { network: false });
    expect(found.on[0].linkedTo).toEqual([]);
    expect((await readHostMaps('10', { network: true })).on[0].linkedTo).toEqual([{ name: 'Core switch', via: '' }]);
  });

  it('looks at eight maps at most and says so', async () => {
    vi.mocked(getMaps).mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ sysmapid: String(i), name: `Map ${i}` })) as never);
    vi.mocked(getMapDetail).mockResolvedValue(detail([]));
    expect(await readHostMaps('10', { network: true })).toMatchObject({ total: 12, scanned: 8 });
    expect(getMapDetail).toHaveBeenCalledTimes(8);
  });

  it('lists the names of the maps', async () => {
    expect(await readMapNames()).toEqual(['Jakarta core', 'Pasuruan']);
  });
});
