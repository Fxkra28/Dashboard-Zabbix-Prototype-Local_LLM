import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

/**
 * Keys made from what a caller chose: a search, a page, a set of ids, a graph range, a map id. A
 * signed-in person can ask for as many as they like, and each used to take a place in the cache
 * that the problem list and the hosts need (BK-36).
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
});

const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/zabbix.js')>()),
  zbx: zbxMock,
}));

const { MAX_ENTRIES, invalidate } = await import('../core/cache.js');
const { findItems, getHosts, getLatestItems, getLatestPage } = await import('../services/hosts.js');
const { getGraph } = await import('../services/history.js');
const { getMapDetail } = await import('../services/maps.js');
const { getInterfacePage } = await import('../services/net.js');
const { networkItemsDenied } = await import('../security/viewerPolicy.js');

const FLOOD = MAX_ENTRIES + 100;
const viewer = { user: { sub: 'ana', role: 'viewer' } } as unknown as FastifyRequest;

type Params = Record<string, unknown>;
const callsOf = (method: string) => zbxMock.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Params);

beforeEach(() => {
  invalidate('');
  zbxMock.mockReset().mockImplementation(async (method: string, params: Params) => {
    if (method === 'item.get' && Array.isArray(params.itemids)) {
      return (params.itemids as string[]).map((itemid) => ({
        itemid,
        name: 'ICMP ping',
        key_: 'icmpping',
        units: '',
        value_type: '3',
        delay: '1m',
        hostid: '1',
        hosts: [{ hostid: '1', name: 'sw-lt3' }],
      }));
    }
    return [];
  });
});

/** The hosts list is read by every page; after a flood it must still be the cached copy. */
async function hostsStillCached(): Promise<boolean> {
  const before = zbxMock.mock.calls.length;
  await getHosts();
  return zbxMock.mock.calls.length === before;
}

describe('a flood of distinct requests leaves the shared entries in the cache (BK-36)', () => {
  beforeEach(async () => {
    await getHosts();
    expect(await hostsStillCached()).toBe(true);
  });

  it('for item searches', async () => {
    for (let i = 0; i < FLOOD; i++) await findItems({ hostid: '1', search: `s${i}`, graphable: false });
    expect(await hostsStillCached()).toBe(true);
  });

  it('for Latest data searches, and for pages that no one asked for before', async () => {
    for (let i = 0; i < FLOOD; i++) await getLatestPage({ filter: { hostids: ['1'] }, hostid: '1', needle: `n${i}`, page: 1, pageSize: 25, hide: false });
    expect(await hostsStillCached()).toBe(true);
    for (let i = 0; i < FLOOD; i++) await getLatestPage({ filter: { hostids: ['1'] }, hostid: '1', needle: '', page: i + 1, pageSize: 25, hide: false });
    expect(await hostsStillCached()).toBe(true);
  });

  it('for the first-500 read of Latest data', async () => {
    for (let i = 0; i < FLOOD; i++) await getLatestItems({ hostids: ['1'] }, '1', undefined, `s${i}`, false);
    expect(await hostsStillCached()).toBe(true);
  });

  it('for the lookup of network items behind a graph', async () => {
    for (let i = 0; i < FLOOD; i++) await networkItemsDenied(viewer, [String(i + 1), String(i + 2)]);
    expect(await hostsStillCached()).toBe(true);
  });

  it('for graph ranges', async () => {
    const now = 1_800_000_000;
    for (let i = 0; i < FLOOD; i++) await getGraph({ ids: ['1'], from: 1_700_000_000 + i * 60, to: 1_700_003_600 + i * 60, points: 1500, now });
    expect(await hostsStillCached()).toBe(true);
  });

  it('for map ids Zabbix does not know', async () => {
    for (let i = 0; i < FLOOD; i++) await getMapDetail(String(i + 1));
    expect(await hostsStillCached()).toBe(true);
  });

  it('for the interfaces of hosts Zabbix does not know (a wall or operator account can ask)', async () => {
    for (let i = 0; i < FLOOD; i++) await getInterfacePage({ hostid: String(i + 1), page: 1, pageSize: 25 });
    expect(await hostsStillCached()).toBe(true);
  });
});

describe('a search is read as written, spaces at either end apart', () => {
  it('shares one entry and one Zabbix read between "cpu" and " cpu " for the item picker', async () => {
    await findItems({ hostid: '1', search: 'cpu', graphable: false });
    await findItems({ hostid: '1', search: '  cpu ', graphable: false });
    const reads = callsOf('item.get');
    expect(reads).toHaveLength(1);
    expect(reads[0].search).toEqual({ key_: 'cpu' });
  });

  it('does the same for Latest data, paged and not', async () => {
    await getLatestPage({ filter: { hostids: ['1'] }, hostid: '1', needle: 'cpu', page: 1, pageSize: 25, hide: false });
    await getLatestPage({ filter: { hostids: ['1'] }, hostid: '1', needle: ' cpu ', page: 1, pageSize: 25, hide: false });
    expect(callsOf('item.get').filter((p) => p.search)).toHaveLength(1);
    zbxMock.mockClear();
    await getLatestItems({ hostids: ['1'] }, '1', undefined, 'cpu', false);
    await getLatestItems({ hostids: ['1'] }, '1', undefined, ' cpu ', false);
    const reads = callsOf('item.get');
    expect(reads).toHaveLength(1);
    expect(reads[0].search).toEqual({ name: 'cpu' });
  });

  it('keeps the case it was given, since Zabbix compares without case and a changed letter would change nothing it finds', async () => {
    await findItems({ hostid: '1', search: 'CPU Load', graphable: false });
    expect(callsOf('item.get')[0].search).toEqual({ key_: 'CPU Load' });
  });

  it('treats a search of only spaces as no search', async () => {
    await findItems({ hostid: '1', search: '   ', graphable: false });
    expect(callsOf('item.get')[0]).not.toHaveProperty('search');
  });
});
