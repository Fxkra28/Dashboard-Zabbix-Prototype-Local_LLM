import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';

/**
 * Network interface data for a viewer. The Network and Links pages are operator-only, but
 * /api/items, /api/latest and /api/maps/detail are viewer routes that return the same interface
 * data. The policy: a viewer does not get items whose key starts with net.if, nor the network hosts
 * on a map; an operator and an admin see everything.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer,olu:operator-pass:operator,adi:admin-pass:admin';
});

const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/zabbix.js')>()),
  zbx: zbxMock,
}));
vi.mock('../domain/queries.js', () => ({
  getProblems: vi.fn().mockResolvedValue([]),
  cachedProblems: vi.fn().mockResolvedValue([]),
  PROBLEMS_TTL_MS: 15_000,
  openProblems: (p: unknown[]) => p,
}));

const { config } = await import('../core/config.js');
const { setupAuth, tokenClaims } = await import('../security/auth.js');
const { registerErrorHandler } = await import('../http/errors.js');
const { invalidate } = await import('../core/cache.js');
const { hostRoutes } = await import('../routes/hosts.js');
const { mapRoutes } = await import('../routes/maps.js');
const { withoutNetworkElements } = await import('../services/maps.js');
const { isNetworkKey, withoutNetworkItems } = await import('../security/viewerPolicy.js');

type Params = Record<string, unknown>;
const callsOf = (method: string) => zbxMock.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Params);

let app: FastifyInstance;
const savedGroups = config.netGroupIds;

beforeEach(async () => {
  invalidate('');
  zbxMock.mockReset().mockResolvedValue([]);
  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await setupAuth(app);
  await app.register(hostRoutes);
  await app.register(mapRoutes);
  await app.ready();
});
afterEach(async () => {
  config.netGroupIds = savedGroups;
  config.auth.enabled = true;
  await app.close();
});

const as = (sub: string, role: string) => ({
  authorization: `Bearer ${app.jwt.sign({ sub, role, ...tokenClaims(config.auth.sessionCookie) }, { expiresIn: '1h' })}`,
});
const viewer = () => as('ana', 'viewer');
const operator = () => as('olu', 'operator');
const admin = () => as('adi', 'admin');
const get = (url: string, headers: Record<string, string>) => app.inject({ url, headers });

describe('isNetworkKey', () => {
  it('is true for an interface key and false for everything else', () => {
    for (const key of ['net.if.in[ifHCInOctets.70]', 'net.if.out[ifHCOutOctets.70]', 'net.if.status[ifOperStatus.70]', 'net.if.discovery', 'net.if.in[eth0]']) {
      expect(isNetworkKey(key), key).toBe(true);
    }
    for (const key of ['icmpping', 'system.cpu.load', 'vfs.fs.size[/,used]', 'agent.ping', 'snmp.net.if', 'NET.IF.IN', '', undefined, null, 5]) {
      expect(isNetworkKey(key), String(key)).toBe(false);
    }
  });

  it('withoutNetworkItems returns a new list and leaves the one it was given alone', () => {
    const list = [{ itemid: '1', key_: 'net.if.in[a]' }, { itemid: '2', key_: 'icmpping' }, { itemid: '3' }];
    const kept = withoutNetworkItems(list);
    expect(kept.map((i) => i.itemid)).toEqual(['2', '3']);
    expect(list).toHaveLength(3);
  });
});

describe('GET /api/items', () => {
  const items = [
    { itemid: '1', name: 'Interface Gi1: Bits received', key_: 'net.if.in[ifHCInOctets.1]', value_type: '3', status: '0', state: '0' },
    { itemid: '2', name: 'CPU load', key_: 'system.cpu.load', value_type: '0', status: '0', state: '0' },
    { itemid: '3', name: 'Interface Gi1: Operational status', key_: 'net.if.status[ifOperStatus.1]', value_type: '3', status: '0', state: '0' },
    { itemid: '4', name: 'ICMP ping', key_: 'icmpping', value_type: '3', status: '0', state: '0' },
  ];
  const ids = (res: { json: () => { itemid: string }[] }) => res.json().map((i) => i.itemid);

  beforeEach(() => zbxMock.mockImplementation(async (method: string) => (method === 'item.get' ? items : [])));

  it('leaves the interface items out for a viewer, and nothing else', async () => {
    expect(ids(await get('/api/items?hostid=10668', viewer()))).toEqual(['2', '4']);
  });

  it('gives an operator and an admin every item, as before', async () => {
    expect(ids(await get('/api/items?hostid=10668', operator()))).toEqual(['1', '2', '3', '4']);
    expect(ids(await get('/api/items?hostid=10668', admin()))).toEqual(['1', '2', '3', '4']);
  });

  it('applies to a search for the interface keys and to a graphable-only list', async () => {
    expect(ids(await get('/api/items?hostid=10668&search=net.if.', viewer()))).toEqual(['2', '4']);
    expect(ids(await get('/api/items?hostid=10668&graphable=1', viewer()))).toEqual(['2', '4']);
  });

  it('applies to a deep link by item id', async () => {
    expect(ids(await get('/api/items?itemids=1,2,3,4', viewer()))).toEqual(['2', '4']);
    expect(ids(await get('/api/items?itemids=1,2,3,4', operator()))).toEqual(['1', '2', '3', '4']);
  });

  it('does not let one role\'s answer reach the other through the shared cache, whoever asks first', async () => {
    expect(ids(await get('/api/items?hostid=10668', operator()))).toEqual(['1', '2', '3', '4']);
    expect(ids(await get('/api/items?hostid=10668', viewer()))).toEqual(['2', '4']);
    expect(ids(await get('/api/items?hostid=10668', operator()))).toEqual(['1', '2', '3', '4']);
    // One read of Zabbix served all three: the cut is made after the cache.
    expect(callsOf('item.get')).toHaveLength(1);

    invalidate('');
    expect(ids(await get('/api/items?hostid=10668', viewer()))).toEqual(['2', '4']);
    expect(ids(await get('/api/items?hostid=10668', operator()))).toEqual(['1', '2', '3', '4']);
  });

  it('treats a request with no signed-in user as a viewer: the fail-closed side of the role mechanism', async () => {
    const bare = await buildTestApp(hostRoutes);
    const res = await bare.inject({ url: '/api/items?hostid=10668' });
    expect(res.json().map((i: { itemid: string }) => i.itemid)).toEqual(['2', '4']);
    await bare.close();
  });

  it('shows everything with sign-in off, where every caller is admin', async () => {
    config.auth.enabled = false;
    const bare = await buildTestApp(hostRoutes);
    const res = await bare.inject({ url: '/api/items?hostid=10668' });
    expect(res.json()).toHaveLength(4);
    await bare.close();
  });
});

describe('GET /api/latest', () => {
  const names = (res: { json: () => { items: { itemid: string }[] } }) => res.json().items.map((i) => i.itemid);

  it('leaves the interface items out of the first-500 list for a viewer', async () => {
    zbxMock.mockImplementation(async (method: string) =>
      method === 'item.get'
        ? [
            { itemid: '1', name: 'Interface Gi1: Bits received', key_: 'net.if.in[ifHCInOctets.1]' },
            { itemid: '2', name: 'CPU load', key_: 'system.cpu.load' },
          ]
        : [],
    );
    expect(names(await get('/api/latest?hostid=10668', viewer()))).toEqual(['2']);
    expect(names(await get('/api/latest?hostid=10668', operator()))).toEqual(['1', '2']);
  });

  describe('paged', () => {
    // Interface rows sort first by name, so a page cut after paging would be short and the count wrong.
    const light = [
      ...Array.from({ length: 30 }, (_, i) => ({ itemid: String(100 + i), name: `A interface ${i}`, key_: `net.if.in[ifHCInOctets.${i}]` })),
      ...Array.from({ length: 30 }, (_, i) => ({ itemid: String(200 + i), name: `B item ${i}`, key_: `system.item[${i}]` })),
    ];
    beforeEach(() =>
      zbxMock.mockImplementation(async (method: string, params: Params) =>
        method !== 'item.get'
          ? []
          : params.itemids
            ? (params.itemids as string[]).map((itemid) => ({ itemid, name: `n${itemid}`, hosts: [{ hostid: '1' }] }))
            : light,
      ),
    );

    it('counts and pages a viewer\'s list without the interface items', async () => {
      const body = (await get('/api/latest?hostid=10668&page=1&pageSize=25', viewer())).json();
      expect(body).toMatchObject({ total: 30, page: 1, pageSize: 25, truncated: false });
      expect(body.items).toHaveLength(25);
      expect(body.items.every((i: { itemid: string }) => i.itemid.startsWith('2'))).toBe(true);

      const second = (await get('/api/latest?hostid=10668&page=2&pageSize=25', viewer())).json();
      expect(second.items).toHaveLength(5);
    });

    it('never asks Zabbix for the details of an interface item on a viewer\'s behalf', async () => {
      await get('/api/latest?hostid=10668&page=1&pageSize=50', viewer());
      const asked = callsOf('item.get').flatMap((p) => (p.itemids as string[] | undefined) ?? []);
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.filter((id) => id.startsWith('1'))).toEqual([]);
    });

    it('gives an operator the whole list, and keeps the two apart in the cache', async () => {
      const first = (await get('/api/latest?hostid=10668&page=1&pageSize=25', operator())).json();
      expect(first.total).toBe(60);
      expect(first.items[0].itemid).toBe('100');
      const viewerPage = (await get('/api/latest?hostid=10668&page=1&pageSize=25', viewer())).json();
      expect(viewerPage.total).toBe(30);
      expect(viewerPage.items[0].itemid).toBe('200');
      expect((await get('/api/latest?hostid=10668&page=1&pageSize=25', operator())).json().total).toBe(60);
      // The first, light read of Zabbix is shared: the cut is made after it.
      expect(callsOf('item.get').filter((p) => !p.itemids)).toHaveLength(1);
    });

    it('finds nothing for a viewer who searches for the interface keys', async () => {
      zbxMock.mockImplementation(async (method: string, params: Params) =>
        method !== 'item.get' ? [] : params.itemids ? [] : light.filter((i) => i.key_.startsWith('net.if')),
      );
      const body = (await get('/api/latest?hostid=10668&search=net.if&page=1&pageSize=25', viewer())).json();
      expect(body).toMatchObject({ total: 0, items: [] });
    });

    it('still flags a read that hit the id limit, counted before the cut', async () => {
      zbxMock.mockImplementation(async (method: string, params: Params) =>
        method !== 'item.get' ? [] : params.itemids ? [] : Array.from({ length: 20_000 }, (_, i) => ({ itemid: String(i), name: `x${i}`, key_: i % 2 ? 'net.if.in[a]' : 'agent.ping' })),
      );
      const body = (await get('/api/latest?groupid=5&page=1&pageSize=25', viewer())).json();
      expect(body).toMatchObject({ total: 10_000, truncated: true });
    });
  });
});

describe('GET /api/maps/detail', () => {
  // 10 is a network host, 11 a server; element 5 is a network host group; links 1 and 2 touch a network element.
  const map = {
    sysmapid: '2',
    name: 'Core',
    selements: [
      { selementid: '1', elementtype: '0', label: '{HOSTNAME}', elements: [{ hostid: '10' }] },
      { selementid: '2', elementtype: '0', label: '{HOSTNAME}', elements: [{ hostid: '11' }] },
      { selementid: '3', elementtype: '4', label: 'Cloud', elements: [] },
      { selementid: '5', elementtype: '3', label: 'Switches', elements: [{ groupid: '7' }] },
      { selementid: '6', elementtype: '3', label: 'Servers', elements: [{ groupid: '8' }] },
    ],
    links: [
      { linkid: '1', selementid1: '1', selementid2: '2' },
      { linkid: '2', selementid1: '3', selementid2: '5' },
      { linkid: '3', selementid1: '2', selementid2: '3' },
    ],
  };
  const ids = (res: { json: () => { selements: { selementid: string }[] }[] }) => res.json()[0].selements.map((s) => s.selementid);
  const linkIds = (res: { json: () => { links: { linkid: string }[] }[] }) => res.json()[0].links.map((l) => l.linkid);

  beforeEach(() =>
    zbxMock.mockImplementation(async (method: string, params: Params) => {
      if (method === 'map.get') return [structuredClone(map)];
      if (method === 'host.get') {
        return params.groupids
          ? [{ hostid: '10' }]
          : [{ hostid: '10', host: 'sw1', name: 'SW1' }, { hostid: '11', host: 'srv1', name: 'SRV1' }];
      }
      return [];
    }),
  );

  it('leaves the network hosts, the network groups and the links that end at them out for a viewer', async () => {
    config.netGroupIds = ['7'];
    const res = await get('/api/maps/detail?mapid=2', viewer());
    expect(res.statusCode).toBe(200);
    expect(ids(res)).toEqual(['2', '3', '6']);
    expect(linkIds(res)).toEqual(['3']);
    expect(res.json()[0]).toMatchObject({ sysmapid: '2', name: 'Core' });
    expect(res.body).not.toContain('SW1');
    expect(res.body).not.toContain('Switches');
  });

  it('gives an operator and an admin the whole map, as before', async () => {
    config.netGroupIds = ['7'];
    for (const who of [operator(), admin()]) {
      const res = await get('/api/maps/detail?mapid=2', who);
      expect(ids(res)).toEqual(['1', '2', '3', '5', '6']);
      expect(linkIds(res)).toEqual(['1', '2', '3']);
    }
  });

  it('does not let one role\'s answer reach the other through the shared cache, whoever asks first', async () => {
    config.netGroupIds = ['7'];
    expect(ids(await get('/api/maps/detail?mapid=2', operator()))).toEqual(['1', '2', '3', '5', '6']);
    expect(ids(await get('/api/maps/detail?mapid=2', viewer()))).toEqual(['2', '3', '6']);
    expect(ids(await get('/api/maps/detail?mapid=2', operator()))).toEqual(['1', '2', '3', '5', '6']);
    expect(callsOf('map.get')).toHaveLength(1);
  });

  it('asks Zabbix for the network hosts by the groups NET_GROUP_IDS names, once for a while', async () => {
    config.netGroupIds = ['7', '9'];
    await get('/api/maps/detail?mapid=2', viewer());
    await get('/api/maps/detail?mapid=2', viewer());
    const asked = callsOf('host.get').filter((p) => p.groupids);
    expect(asked).toEqual([{ output: ['hostid'], groupids: ['7', '9'] }]);
  });

  it('cuts nothing when NET_GROUP_IDS names no group, since then nothing says which hosts are network devices', async () => {
    config.netGroupIds = [];
    const res = await get('/api/maps/detail?mapid=2', viewer());
    expect(ids(res)).toEqual(['1', '2', '3', '5', '6']);
    expect(callsOf('host.get').filter((p) => p.groupids)).toEqual([]);
  });
});

describe('withoutNetworkElements', () => {
  const m = {
    selements: [
      { selementid: '1', elementtype: '0', hostid: '10', elements: [{ hostid: '10' }] },
      { selementid: '2', elementtype: '0', hostid: '11', elements: [{ hostid: '11' }] },
    ],
    links: [{ selementid1: '1', selementid2: '2' }],
  };

  it('returns the same map when nothing on it is a network host, and a copy when something is cut', () => {
    const maps = [m];
    expect(withoutNetworkElements(maps, ['99'], [])[0]).toBe(m);
    expect(withoutNetworkElements(maps, [], [])).toBe(maps);
    const cut = withoutNetworkElements(maps, ['10'], []);
    expect(cut[0]).not.toBe(m);
    expect(cut[0].selements.map((s) => s.selementid)).toEqual(['2']);
    expect(cut[0].links).toEqual([]);
    // The map it was given is as it was.
    expect(m.selements).toHaveLength(2);
    expect(m.links).toHaveLength(1);
  });

  it('copes with a map that has no elements or no links', () => {
    expect(withoutNetworkElements([{}], ['10'], ['7'])).toEqual([{}]);
    const noLinks = { selements: [{ selementid: '1', elementtype: '0', elements: [{ hostid: '10' }] }] };
    expect(withoutNetworkElements([noLinks], ['10'], [])).toEqual([{ selements: [] }]);
  });
});
