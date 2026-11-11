import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import { setupAuth, tokenClaims } from '../security/auth.js';
import { registerErrorHandler } from '../http/errors.js';
import { invalidate } from '../core/cache.js';

vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer,olu:operator-pass:operator,adi:admin-pass:admin';
});

/** GET /api/net/meters: the dashboard's gauge widgets turned into meters, through the same Zabbix reads every other route makes (mocked by method). */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

const { meterRoutes } = await import('../routes/meters.js');

const { pairSiblings } = await import('../services/meters.js');
const { ZabbixApiError } = await import('../clients/zabbix.js');

const NOW = Math.floor(Date.now() / 1000);
const MBPS = 1_000_000;

/** A gauge widget with HCML's usual four zones, starting at 0, 25, 50 and 75 percent of its maximum. */
const widget = (title: string, y: number, itemid: string | null, max = '50000000') => ({
  type: 'gauge',
  name: title,
  x: '0',
  y: String(y),
  fields: [
    ...(itemid ? [{ type: '4', name: 'itemid.0', value: itemid }] : []),
    { type: '1', name: 'min', value: '0' },
    { type: '1', name: 'max', value: max },
    ...[
      ['0080FF', 0],
      ['00FF00', 0.25],
      ['FFFF00', 0.5],
      ['FF465C', 0.75],
    ].flatMap(([color, share], i) => [
      { type: '1', name: `thresholds.${i}.color`, value: String(color) },
      { type: '1', name: `thresholds.${i}.threshold`, value: String(Number(max) * Number(share)) },
    ]),
  ],
});

const zItem = (itemid: string, over: Record<string, unknown> = {}) => ({
  itemid,
  hostid: '10',
  name: `Interface port${itemid}(): Bits received`,
  key_: `net.if.in[ifHCInOctets.${itemid}]`,
  units: 'bps',
  value_type: '3',
  delay: '0',
  status: '0',
  state: '0',
  lastvalue: String(10 * MBPS),
  lastclock: String(NOW - 20),
  hosts: [{ name: '1.1 SITE1-FW' }],
  ...over,
});

/**
 * The neighbours of the widget item whose id is `index` (the key's ifIndex is the same number): the opposite direction ('10' + index)
 * and the interface's status ('20' + index), on the same host unless said otherwise.
 */
const zOut = (index: string, mbps: number | null, over: Record<string, unknown> = {}) => ({
  itemid: `10${index}`,
  hostid: '10',
  name: `Interface port${index}(): Bits sent`,
  key_: `net.if.out[ifHCOutOctets.${index}]`,
  units: 'bps',
  value_type: '3',
  delay: '0',
  status: '0',
  state: '0',
  lastvalue: mbps === null ? '' : String(mbps * MBPS),
  lastclock: mbps === null ? '0' : String(NOW - 20),
  ...over,
});
const zStatus = (index: string, status: number | null, over: Record<string, unknown> = {}) => ({
  itemid: `20${index}`,
  hostid: '10',
  name: `Interface port${index}(): Operational status`,
  key_: `net.if.status[ifOperStatus.${index}]`,
  units: '',
  value_type: '3',
  delay: '0',
  status: '0',
  state: '0',
  lastvalue: status === null ? '' : String(status),
  lastclock: status === null ? '0' : String(NOW - 20),
  ...over,
});

const DASHBOARD = {
  dashboardid: '1',
  name: 'Global view',
  pages: [
    {
      name: '',
      widgets: [
        widget('SITE ONE INTERNET', 0, '1', '500000000'),
        widget('SITE THREE INTERNET 1', 3, '2'),
        widget('SITE FOUR INTERNET 2', 6, null),
      ],
    },
  ],
};

interface Setup {
  dashboards?: unknown[];
  items?: unknown[];
  history?: (params: { itemids: string[] }) => unknown[];
}
interface TableItem {
  itemid: string;
  hostid: string;
  key_: string;
}
/** Zabbix as one table of items, asked as the route asks: by id for values, and by host and key prefix for the neighbour search. */
function zabbix({ dashboards = [DASHBOARD], items = [], history = () => [] }: Setup = {}) {
  const table = items as TableItem[];
  zbxMock.mockImplementation(async (method: string, params: { itemids: string[]; hostids?: string[]; search?: { key_: string | string[] } }) => {
    if (method === 'dashboard.get') return dashboards;
    if (method === 'item.get') {
      if (params.search) {
        const prefixes = [params.search.key_].flat();
        return table
          .filter((i) => params.hostids?.includes(i.hostid) && prefixes.some((p) => i.key_.startsWith(p)))
          .map(({ itemid, hostid, key_ }) => ({ itemid, hostid, key_ }));
      }
      const wanted = new Set(params.itemids);
      return table.filter((i) => wanted.has(i.itemid));
    }
    if (method === 'history.get') return history(params);
    throw new Error(`unexpected Zabbix call ${method}`);
  });
}
const called = (method: string) => zbxMock.mock.calls.filter((c) => c[0] === method);
const valueCalls = () => called('item.get').filter((c) => (c[1] as { itemids?: string[] }).itemids);
const searchCalls = () => called('item.get').filter((c) => (c[1] as { search?: unknown }).search);

beforeEach(() => {
  zbxMock.mockReset();
  invalidate('');
});
afterEach(() => vi.useRealTimers());

describe('GET /api/net/meters', () => {
  it('looks for the dashboard by the configured name and reads that one only', async () => {
    zabbix({ items: [zItem('1'), zItem('2')] });
    const app = await buildTestApp(meterRoutes);
    const res = await app.inject({ url: '/api/net/meters' });
    expect(res.statusCode).toBe(200);
    expect(called('dashboard.get')).toHaveLength(1);
    expect(called('dashboard.get')[0][1]).toMatchObject({ filter: { name: ['Global view'] }, selectPages: 'extend' });
    expect(res.json()).toMatchObject({ dashboard: 'Global view', found: true });
  });

  it('answers found: false, with no meters and no item read, when Zabbix has no such dashboard', async () => {
    zabbix({ dashboards: [] });
    const app = await buildTestApp(meterRoutes);
    const body = (await app.inject({ url: '/api/net/meters' })).json();
    expect(body).toMatchObject({ dashboard: 'Global view', found: false, meters: [] });
    expect(body.summary).toEqual({ total: 0, current: 0, critical: 0, warn: 0, stale: 0, unavailable: 0, down: 0, otherHigh: 0 });
    expect(called('item.get')).toHaveLength(0);
  });

  it('makes one meter per gauge, in the dashboard\'s order, with the value Zabbix holds', async () => {
    zabbix({
      items: [
        zItem('1', { lastvalue: String(212.06 * MBPS) }),
        zItem('2', { key_: 'net.if.out[ifHCOutOctets.2]', lastvalue: String(45 * MBPS), hosts: [{ name: '3.1 SITE3-FW-01' }] }),
      ],
    });
    const app = await buildTestApp(meterRoutes);
    const body = (await app.inject({ url: '/api/net/meters' })).json();

    expect(body.meters.map((m: { title: string }) => m.title)).toEqual(['SITE ONE INTERNET', 'SITE THREE INTERNET 1', 'SITE FOUR INTERNET 2']);
    const [jakarta, sampang, sapudi] = body.meters;
    expect(jakarta).toMatchObject({ state: 'ok', value: 212.06 * MBPS, max: 500 * MBPS, zone: 'ok', direction: 'in', host: '1.1 SITE1-FW' });
    expect(sampang).toMatchObject({ state: 'ok', zone: 'critical', direction: 'out', host: '3.1 SITE3-FW-01' });
    expect(sampang.clock).toBeGreaterThan(NOW - 60);
    expect(sapudi).toMatchObject({ state: 'missing', itemid: null, value: null });
    expect(body.summary).toEqual({ total: 3, current: 2, critical: 1, warn: 0, stale: 0, unavailable: 1, down: 0, otherHigh: 0 });
  });

  it('asks Zabbix for the values of the widgets\' items once, whatever their number', async () => {
    zabbix({ items: [zItem('1'), zItem('2')] });
    const app = await buildTestApp(meterRoutes);
    await app.inject({ url: '/api/net/meters' });
    expect(valueCalls()).toHaveLength(1);
    expect(valueCalls()[0][1]).toMatchObject({ itemids: ['1', '2'], selectHosts: ['name'] });
    expect(valueCalls()[0][1]).toMatchObject({ output: expect.arrayContaining(['itemid', 'hostid', 'key_', 'lastvalue', 'lastclock']) });
  });

  it('says missing for a widget whose item is gone from Zabbix', async () => {
    zabbix({ items: [zItem('1')] }); // item 2 is not returned
    const app = await buildTestApp(meterRoutes);
    const gone = (await app.inject({ url: '/api/net/meters' })).json().meters[1];
    expect(gone).toMatchObject({ state: 'missing', itemid: '2', value: null });
  });

  it('reads the newest row of history for an item with no last value, and calls it stale with its time', async () => {
    const old = NOW - 30 * 86_400;
    zabbix({
      items: [zItem('1', { lastvalue: '', lastclock: '0' }), zItem('2')],
      history: ({ itemids }) => (itemids[0] === '1' ? [{ clock: String(old), value: String(73.88 * MBPS) }] : []),
    });
    const app = await buildTestApp(meterRoutes);
    const [jakarta] = (await app.inject({ url: '/api/net/meters' })).json().meters;
    expect(jakarta).toMatchObject({ state: 'stale', value: 73.88 * MBPS, clock: old, zone: 'low' });
    expect(called('history.get')).toHaveLength(1);
    expect(called('history.get')[0][1]).toEqual({
      history: 3,
      itemids: ['1'],
      sortfield: 'clock',
      sortorder: 'DESC',
      limit: 1,
      output: ['clock', 'value'],
    });
  });

  it('says no data when history holds nothing for the item either', async () => {
    zabbix({ items: [zItem('1', { lastvalue: '', lastclock: '0' }), zItem('2')], history: () => [] });
    const app = await buildTestApp(meterRoutes);
    const [jakarta] = (await app.inject({ url: '/api/net/meters' })).json().meters;
    expect(jakarta).toMatchObject({ state: 'nodata', value: null, clock: null });
  });

  it('reads history as float for a float item, and not at all for an item with text in it', async () => {
    zabbix({
      items: [zItem('1', { value_type: '0', lastvalue: '', lastclock: '0' }), zItem('2', { value_type: '4', lastvalue: '', lastclock: '0' })],
      history: () => [{ clock: String(NOW - 5000), value: '1000' }],
    });
    const app = await buildTestApp(meterRoutes);
    const meters = (await app.inject({ url: '/api/net/meters' })).json().meters;
    expect(called('history.get').map((c) => (c[1] as { history: number }).history)).toEqual([0]);
    expect(meters[1]).toMatchObject({ state: 'nodata' });
  });

  it('reads no history for an item that has a value, or one that is disabled or unsupported', async () => {
    zabbix({ items: [zItem('1'), zItem('2', { state: '1', lastvalue: '', lastclock: '0' })] });
    const app = await buildTestApp(meterRoutes);
    const meters = (await app.inject({ url: '/api/net/meters' })).json().meters;
    expect(called('history.get')).toHaveLength(0);
    expect(meters[1]).toMatchObject({ state: 'unsupported', value: null });
  });

  it('keeps a value of a few minutes as current, and one of an hour as stale', async () => {
    zabbix({ items: [zItem('1', { lastclock: String(NOW - 240) }), zItem('2', { lastclock: String(NOW - 3600) })] });
    const app = await buildTestApp(meterRoutes);
    const meters = (await app.inject({ url: '/api/net/meters' })).json().meters;
    expect(meters.map((m: { state: string }) => m.state)).toEqual(['ok', 'stale', 'missing']);
  });

  it('answers from its cache for half a minute, and keeps the dashboard for two', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW * 1000));
    zabbix({ items: [zItem('1'), zItem('2')] });
    const app = await buildTestApp(meterRoutes);
    await app.inject({ url: '/api/net/meters' });
    await app.inject({ url: '/api/net/meters' });
    expect(valueCalls()).toHaveLength(1);

    vi.setSystemTime(new Date((NOW + 31) * 1000));
    await app.inject({ url: '/api/net/meters' });
    expect(valueCalls()).toHaveLength(2);
    expect(called('dashboard.get')).toHaveLength(1);
    expect(searchCalls()).toHaveLength(1);

    vi.setSystemTime(new Date((NOW + 125) * 1000));
    await app.inject({ url: '/api/net/meters' });
    expect(called('dashboard.get')).toHaveLength(2);
    expect(searchCalls()).toHaveLength(2);
  });

  it('answers a Zabbix failure with the one sentence, and no method name', async () => {
    zbxMock.mockRejectedValue(new ZabbixApiError('dashboard.get: {"code":-32602}'));
    const app = await buildTestApp(meterRoutes);
    const res = await app.inject({ url: '/api/net/meters' });
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toMatch(/^The data source is not answering\./);
    expect(res.body).not.toContain('dashboard.get');
  });
});

describe('GET /api/net/meters: the neighbours of each widget item', () => {
  const metersOf = async () => (await (await buildTestApp(meterRoutes)).inject({ url: '/api/net/meters' })).json();

  it('says a link is down when the status item of the same interface says so, and up when it says 1', async () => {
    zabbix({ items: [zItem('1'), zStatus('1', 2), zItem('2'), zStatus('2', 1)] });
    const body = await metersOf();
    expect(body.meters.map((m: { link: string }) => m.link)).toEqual(['down', 'up', 'unknown']);
    expect(body.summary.down).toBe(1);
  });

  it('counts lowerLayerDown as down, and the reading of a dead link stays what it is', async () => {
    zabbix({ items: [zItem('1', { lastvalue: '0' }), zStatus('1', 7)] });
    const [first] = (await metersOf()).meters;
    expect(first).toMatchObject({ link: 'down', state: 'ok', value: 0, zone: 'low' });
  });

  it('claims nothing for an old status, one that is neither working nor dead, or an interface with no status item', async () => {
    zabbix({ items: [zItem('1'), zStatus('1', 2, { lastclock: String(NOW - 3600) }), zItem('2'), zStatus('2', 3)] });
    expect((await metersOf()).meters.map((m: { link: string }) => m.link)).toEqual(['unknown', 'unknown', 'unknown']);
    zbxMock.mockReset();
    invalidate('');
    zabbix({ items: [zItem('1'), zItem('2')] });
    expect((await metersOf()).meters.map((m: { link: string }) => m.link)).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('never reads history for a neighbour: an old status or an old figure says nothing about the link today', async () => {
    zabbix({
      items: [zItem('1'), zStatus('1', null), zOut('1', null)],
      history: () => [{ clock: String(NOW - 5000), value: '2' }],
    });
    const [first] = (await metersOf()).meters;
    expect(called('history.get')).toHaveLength(0);
    expect(first).toMatchObject({ link: 'unknown', other: { itemid: '101', value: null, clock: null, zone: null } });
  });

  it('pairs an item with the neighbours that have its own ifIndex, and no other', async () => {
    zabbix({ items: [zItem('1'), zStatus('1', 2), zOut('3', 40)] });
    const [first] = (await metersOf()).meters;
    expect(first).toMatchObject({ link: 'down', other: null });
    expect(valueCalls().at(-1)?.[1]).toMatchObject({ itemids: ['201'] });
  });

  it('gives the opposite direction on the gauge\'s own scale, and counts it when it is high', async () => {
    zabbix({ items: [zItem('1'), zOut('1', 10), zItem('2'), zOut('2', 40)] });
    const body = await metersOf();
    const [wide, narrow, gone] = body.meters;
    expect(wide.other).toMatchObject({ direction: 'out', itemid: '101', value: 10 * MBPS, zone: 'low' });
    expect(narrow.other).toMatchObject({ direction: 'out', itemid: '102', value: 40 * MBPS, zone: 'critical' });
    expect(narrow.other.fraction).toBeCloseTo(0.8, 5);
    expect(gone.other).toBeNull();
    expect(body.summary).toMatchObject({ otherHigh: 1, critical: 0 });
  });

  it('reads the inbound item as the opposite of an outbound widget', async () => {
    const inbound = { ...zOut('2', 30), itemid: '102', key_: 'net.if.in[ifHCInOctets.2]' };
    zabbix({ items: [zItem('1'), zItem('2', { key_: 'net.if.out[ifHCOutOctets.2]' }), inbound] });
    const [, second] = (await metersOf()).meters;
    expect(second).toMatchObject({ direction: 'out', other: { direction: 'in', itemid: '102', zone: 'warn' } });
  });

  it('keeps the opposite item, with no value, when it has no current reading', async () => {
    zabbix({ items: [zItem('2'), zOut('2', 40, { lastclock: String(NOW - 3600) })] });
    const [, second] = (await metersOf()).meters;
    expect(second.other).toEqual({ direction: 'out', itemid: '102', value: null, clock: null, fraction: null, zone: null });
  });

  it('carries the host id of each widget item', async () => {
    zabbix({ items: [zItem('1'), zItem('2', { hostid: '11' })] });
    expect((await metersOf()).meters.map((m: { hostid: string | null }) => m.hostid)).toEqual(['10', '11', null]);
  });

  it('searches the widgets\' hosts once for the keys it pairs, and reads the neighbours\' values once, by id', async () => {
    zabbix({ items: [zItem('1'), zStatus('1', 1), zOut('1', 5), zItem('2'), zStatus('2', 2), zOut('2', 6)] });
    await metersOf();
    expect(searchCalls()).toHaveLength(1);
    expect(searchCalls()[0][1]).toEqual({
      hostids: ['10'],
      search: { key_: ['net.if.in[', 'net.if.out[', 'net.if.status['] },
      searchByAny: true,
      startSearch: true,
      output: ['itemid', 'hostid', 'key_'],
    });
    expect(valueCalls()).toHaveLength(2);
    expect(valueCalls()[1][1]).toEqual({
      itemids: ['201', '101', '202', '102'],
      output: ['itemid', 'key_', 'delay', 'status', 'state', 'lastvalue', 'lastclock'],
    });
  });

  it('makes no second read of values when no widget item has a neighbour', async () => {
    zabbix({ items: [zItem('1'), zItem('2')] });
    await metersOf();
    expect(valueCalls()).toHaveLength(1);
  });

  it('answers a failed read of the neighbours as it answers any Zabbix failure', async () => {
    zbxMock.mockImplementation(async (method: string, params: { itemids?: string[]; search?: unknown }) => {
      if (method === 'dashboard.get') return [DASHBOARD];
      if (params.search) return [zItem('1'), zStatus('1', 2)].map(({ itemid, hostid, key_ }) => ({ itemid, hostid, key_ }));
      if (params.itemids?.includes('201')) throw new ZabbixApiError('item.get: {"code":-32500}');
      return [zItem('1')];
    });
    const res = await (await buildTestApp(meterRoutes)).inject({ url: '/api/net/meters' });
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toMatch(/^The data source is not answering\./);
    expect(res.body).not.toContain('item.get');
  });
});

describe('pairSiblings', () => {
  const k = (itemid: string, hostid: string, key_: string) => ({ itemid, hostid, key_ });

  it('pairs each counter with the status and the opposite direction of the same interface: the same host and the same ifIndex', () => {
    const mains = [k('1', '10', 'net.if.in[ifHCInOctets.5]'), k('2', '10', 'net.if.out[ifHCOutOctets.7]')];
    const found = [
      ...mains,
      k('3', '10', 'net.if.out[ifHCOutOctets.5]'),
      k('4', '10', 'net.if.status[ifOperStatus.5]'),
      k('5', '10', 'net.if.in[ifHCInOctets.7]'),
      k('6', '10', 'net.if.status[ifOperStatus.7]'),
      k('7', '11', 'net.if.status[ifOperStatus.5]'), // another host, the same index
      k('8', '10', 'net.if.status[ifOperStatus.6]'), // the same host, another index
    ];
    expect(pairSiblings(mains, found)).toEqual({ '1': { statusId: '4', otherId: '3' }, '2': { statusId: '6', otherId: '5' } });
  });

  it('gives null for a neighbour the interface does not have', () => {
    const mains = [k('1', '10', 'net.if.in[ifHCInOctets.5]')];
    expect(pairSiblings(mains, mains)).toEqual({ '1': { statusId: null, otherId: null } });
    expect(pairSiblings(mains, [...mains, k('9', '11', 'net.if.out[ifHCOutOctets.5]')])).toEqual({ '1': { statusId: null, otherId: null } });
  });

  it('prefers the operational status to another status, a counter of the same width, and then the lowest id', () => {
    const mains = [k('1', '10', 'net.if.in[ifHCInOctets.5]')];
    const found = [
      k('9', '10', 'net.if.status[ifAdminStatus.5]'),
      k('11', '10', 'net.if.status[ifOperStatus.5]'),
      k('20', '10', 'net.if.out[ifOutOctets.5]'),
      k('31', '10', 'net.if.out[ifHCOutOctets.5]'),
      k('30', '10', 'net.if.out[ifHCOutOctets.5]'),
    ];
    expect(pairSiblings(mains, found)).toEqual({ '1': { statusId: '11', otherId: '30' } });
  });

  it('uses the other width when it is all there is', () => {
    const mains = [k('1', '10', 'net.if.in[ifHCInOctets.5]')];
    expect(pairSiblings(mains, [k('20', '10', 'net.if.out[ifOutOctets.5]')])).toEqual({ '1': { statusId: null, otherId: '20' } });
  });

  it('ignores error counters, walk items and keys it cannot read', () => {
    const mains = [k('1', '10', 'net.if.in[ifHCInOctets.5]')];
    const found = [
      k('2', '10', 'net.if.out.errors[ifOutErrors.5]'),
      k('3', '10', 'net.if.walk[ifHCOutOctets.5]'),
      k('4', '10', 'net.if.out[ifHCOutOctets.abc]'),
      k('5', '10', 'agent.ping'),
    ];
    expect(pairSiblings(mains, found)).toEqual({ '1': { statusId: null, otherId: null } });
  });

  it('has no entry for a widget item that is not an in or an out counter', () => {
    expect(pairSiblings([k('1', '10', 'net.if.status[ifOperStatus.5]'), k('2', '10', 'system.cpu.load')], [])).toEqual({});
  });
});

describe('GET /api/net/meters behind the guard', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    await setupAuth(app);
    await app.register(meterRoutes);
    await app.ready();
  });
  afterAll(() => app.close());

  const tokenFor = (sub: string, role: string) => app.jwt.sign({ sub, role, ...tokenClaims('hcml_session') }, { expiresIn: '1h' });
  const as = (sub: string, role: string) => ({ authorization: `Bearer ${tokenFor(sub, role)}` });

  it('refuses a viewer, and does not read Zabbix for it', async () => {
    zabbix({ items: [zItem('1')] });
    const res = await app.inject({ url: '/api/net/meters', headers: as('ana', 'viewer') });
    expect(res.statusCode).toBe(403);
    expect(zbxMock).not.toHaveBeenCalled();
  });

  it('refuses a request with no token', async () => {
    expect((await app.inject({ url: '/api/net/meters' })).statusCode).toBe(401);
  });

  it('serves an operator and an admin', async () => {
    zabbix({ items: [zItem('1'), zItem('2')] });
    for (const [user, role] of [['olu', 'operator'], ['adi', 'admin']]) {
      invalidate('');
      expect((await app.inject({ url: '/api/net/meters', headers: as(user, role) })).statusCode, role).toBe(200);
    }
  });
});
