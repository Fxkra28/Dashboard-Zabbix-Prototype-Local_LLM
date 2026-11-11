import { afterEach, describe, expect, it, vi } from 'vitest';
import { pingZabbix } from './helpers/pingZabbix.js';
import { buildTestApp, zHost } from './helpers/app.js';

/**
 * The graph pipeline (/api/items, /api/latest paging, /api/graph) and the
 * network views built on it (/api/net/devices tri-state, /api/net/interfaces).
 * Same zbx mocking pattern as routes.test.ts.
 */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));

vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

type Params = Record<string, unknown>;
type Handler = (params: Params) => unknown;

function zabbix(map: Record<string, unknown | Handler>): void {
  zbxMock.mockImplementation(async (method: string, params: Params) => {
    const v = map[method];
    return typeof v === 'function' ? (v as Handler)(params) : (v ?? []);
  });
}

const callsOf = (method: string) =>
  zbxMock.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Params);

/** The sign-in setting before graphApp() switched it off, so the next test file's setting is not left changed. */
let savedAuth: boolean | undefined;

afterEach(async () => {
  zbxMock.mockReset();
  vi.useRealTimers();
  if (savedAuth !== undefined) {
    (await import('../core/config.js')).config.auth.enabled = savedAuth;
    savedAuth = undefined;
  }
});

// /api/items

describe('/api/items', () => {
  it('graphable=1 filters to enabled, supported numeric items and asks for the new fields, but not the two Zabbix looks up item by item', async () => {
    zabbix({
      'item.get': [
        { itemid: '1', name: 'a', key_: 'a', value_type: '0', status: '0', state: '0' },
        { itemid: '2', name: 'b', key_: 'b', value_type: '3', status: '0', state: '1' },
        { itemid: '3', name: 'c', key_: 'c', value_type: '4', status: '0', state: '0' },
        { itemid: '4', name: 'd', key_: 'd', value_type: '3', status: '1', state: '0' },
        { itemid: '5', name: 'e', key_: 'e', value_type: '3', status: '0', state: '0' },
      ],
    });
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);

    const res = await app.inject({ url: '/api/items?hostid=10668&graphable=1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((i: { itemid: string }) => i.itemid)).toEqual(['1', '5']);
    const [params] = callsOf('item.get');
    expect(params.output).toEqual(expect.arrayContaining(['state', 'status', 'delay', 'flags']));
    // One lookup an item, 30 ms to 0.5 s each on HCML's Zabbix: 20 to 32 s for a host of 609 graphable items (BK-25). The picker never shows them.
    expect(params.output).not.toContain('lastvalue');
    expect(params.output).not.toContain('lastclock');
    expect(params).toMatchObject({ webitems: true, selectTags: ['tag', 'value'], hostids: ['10668'] });
    expect(params.filter).toMatchObject({ status: '0', state: '0' });
    await app.close();
  });

  it('without graphable returns everything (backward compatible)', async () => {
    zabbix({ 'item.get': [{ itemid: '3', value_type: '4', status: '0', state: '0' }] });
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);
    const res = await app.inject({ url: '/api/items?hostid=10668' });
    expect(res.json()).toHaveLength(1);
    expect(callsOf('item.get')[0].filter).toBeUndefined();
    await app.close();
  });

  it('itemids= resolves a deep link without a hostid and validates every id', async () => {
    zabbix({ 'item.get': [{ itemid: '7', value_type: '3', hosts: [{ hostid: '1', name: 'h' }] }] });
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);

    const ok = await app.inject({ url: '/api/items?itemids=7,8' });
    expect(ok.statusCode).toBe(200);
    expect(callsOf('item.get')[0]).toMatchObject({ itemids: ['7', '8'], selectHosts: ['hostid', 'name'] });
    expect(callsOf('item.get')[0].hostids).toBeUndefined();

    expect((await app.inject({ url: '/api/items?itemids=7,abc' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/items' })).statusCode).toBe(400);
    await app.close();
  });
});

// /api/latest paging

describe('/api/latest paging', () => {
  const ids = Array.from({ length: 250 }, (_, i) => ({ itemid: String(1000 + i), name: `Interface Gi1/0/${i + 1}` }));

  it('searches name or key, sorts naturally, and fetches details for one page only', async () => {
    zabbix({
      'item.get': (p: Params) =>
        p.itemids
          ? (p.itemids as string[]).map((id) => ({ itemid: id, name: `n${id}`, hosts: [{ hostid: '1' }] }))
          : [...ids].reverse(),
    });
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);

    const res = await app.inject({ url: '/api/latest?hostid=10668&search=Gi1/0/1&page=2&pageSize=100' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ total: 250, page: 2, pageSize: 100, truncated: false });
    expect(body.items).toHaveLength(100);
    // natural order: Gi1/0/1..Gi1/0/250 → page 2 starts at Gi1/0/101 (itemid 1100)
    expect(body.items[0].itemid).toBe('1100');

    const [light, details] = callsOf('item.get');
    expect(light).toMatchObject({
      output: ['itemid', 'name', 'key_'], // the key tells a viewer's pass which items to leave out
      search: { name: 'Gi1/0/1', key_: 'Gi1/0/1' },
      searchByAny: true,
      monitored: true,
      webitems: true,
      limit: 20000,
    });
    expect(details.itemids).toHaveLength(100);
    expect(details.selectHosts).toBeDefined();
    await app.close();
  });

  it('answers the last page when a later one is asked (FR-23)', async () => {
    zabbix({
      'item.get': (p: Params) =>
        p.itemids ? (p.itemids as string[]).map((id) => ({ itemid: id, name: `n${id}`, hosts: [{ hostid: '1' }] })) : [...ids],
    });
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);

    const body = (await app.inject({ url: '/api/latest?hostid=10668&page=9&pageSize=100' })).json();
    expect(body).toMatchObject({ total: 250, page: 3, pageSize: 100 });
    expect(body.items).toHaveLength(50);
    expect(body.items[0].itemid).toBe('1200');

    const none = (await app.inject({ url: '/api/latest?hostid=10668&search=zzz&page=4&pageSize=100' })).json();
    expect(none.page).toBe(3);
    await app.close();
  });

  it('answers page 1 with no items when nothing matches', async () => {
    zabbix({ 'item.get': [] });
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);
    const body = (await app.inject({ url: '/api/latest?hostid=10668&search=nothing&page=4&pageSize=100' })).json();
    expect(body).toMatchObject({ items: [], total: 0, page: 1 });
    await app.close();
  });

  it('clamps pageSize and flags truncation at the id limit', async () => {
    zabbix({
      'item.get': (p: Params) =>
        p.itemids ? [] : Array.from({ length: 20000 }, (_, i) => ({ itemid: String(i), name: `x${i}` })),
    });
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);
    const body = (await app.inject({ url: '/api/latest?groupid=5&page=1&pageSize=5000' })).json();
    expect(body).toMatchObject({ pageSize: 500, total: 20000, truncated: true });
    await app.close();
  });

  it('without page keeps the legacy first-500 read', async () => {
    zabbix({ 'item.get': Array.from({ length: 500 }, (_, i) => ({ itemid: String(i) })) });
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);
    const body = (await app.inject({ url: '/api/latest?hostid=10668&search=cpu' })).json();
    expect(body.truncated).toBe(true);
    expect(body.total).toBeUndefined();
    expect(callsOf('item.get')).toHaveLength(1);
    expect(callsOf('item.get')[0]).toMatchObject({ limit: 500, search: { name: 'cpu' } });
    expect(callsOf('item.get')[0].searchByAny).toBeUndefined();
    await app.close();
  });
});

// /api/graph

const NOW = 1_789_617_000; // 2026-09-17 03:50 UTC, a whole minute
const numericItem = (over: Params = {}) => ({
  itemid: '69356',
  name: 'Interface Po11(): Bits received',
  key_: 'net.if.in[ifHCInOctets.70]',
  units: 'bps',
  value_type: '3',
  delay: '1m',
  hostid: '10668',
  hosts: [{ hostid: '10668', name: '1.2.1 IDX02CORESWITCH' }],
  ...over,
});

async function graphApp() {
  // These tests run the graph pipeline with no sign-in in front of it. A caller with no user counts as
  // a viewer, and a viewer may not graph interface items, so sign-in is off here: every caller
  // is admin. viewer-network-ids.test.ts covers the viewer.
  const { config } = await import('../core/config.js');
  savedAuth ??= config.auth.enabled;
  config.auth.enabled = false;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW * 1000);
  const { historyRoutes } = await import('../routes/history.js');
  return buildTestApp(historyRoutes);
}

describe('/api/graph', () => {
  it('≤ 24 h reads history with a restricted output and echoes the pinned window', async () => {
    const from = NOW - 86_400;
    zabbix({
      'item.get': [numericItem()],
      'history.get': (p: Params) =>
        Array.from({ length: 1440 }, (_, i) => ({ itemid: '69356', clock: String(from + i * 60), value: String(i) }))
          .filter((r) => Number(r.clock) >= (p.time_from as number) && Number(r.clock) <= (p.time_till as number)),
    });
    const app = await graphApp();
    const res = await app.inject({ url: '/api/graph?itemids=69356&hours=24' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ from, to: NOW, source: 'history' });
    const [h] = callsOf('history.get');
    expect(h).toMatchObject({ output: ['itemid', 'clock', 'value'], history: 3, sortfield: 'clock', time_from: from });
    expect(callsOf('trend.get')).toHaveLength(0);
    const s = body.series[0];
    expect(s).toMatchObject({ itemid: '69356', host: '1.2.1 IDX02CORESWITCH', units: 'bps', delaySeconds: 60, step: false });
    expect(s.points.length).toBeLessThanOrEqual(1500);
    expect(s.stats).toMatchObject({ min: 0, max: 1439, last: 1439, lastClock: from + 1439 * 60 });
    expect(body.latestClock).toBe(from + 1439 * 60);
    await app.close();
  });

  it('downsamples to at most `points`, with stats taken from the raw rows', async () => {
    const from = NOW - 86_400;
    // 10 s data, one spike the buckets would average away
    const rows = Array.from({ length: 8640 }, (_, i) => ({
      itemid: '69356',
      clock: String(from + i * 10),
      value: i === 4321 ? '1000000' : '5',
    }));
    zabbix({ 'item.get': [numericItem({ delay: '10s' })], 'history.get': rows });
    const app = await graphApp();
    const body = (await app.inject({ url: '/api/graph?itemids=69356&hours=24&points=200' })).json();
    const s = body.series[0];
    expect(body.downsampled).toBe(true);
    expect(s.points.length).toBeLessThanOrEqual(200);
    expect(s.stats.max).toBe(1_000_000);
    expect(s.stats.min).toBe(5);
    // bucket max keeps the spike, bucket avg dilutes it
    const spike = s.points.find((p: number[]) => p[3] === 1_000_000);
    expect(spike[1]).toBeLessThan(1_000_000);
    await app.close();
  });

  it('inserts a null where the data has a gap', async () => {
    const from = NOW - 3600;
    const clocks = [0, 60, 120, 180, 1800, 1860, 1920].map((o) => from + o);
    zabbix({
      'item.get': [numericItem()],
      'history.get': clocks.map((c) => ({ itemid: '69356', clock: String(c), value: '1' })),
    });
    const app = await graphApp();
    const s = (await app.inject({ url: '/api/graph?itemids=69356&hours=1' })).json().series[0];
    expect(s.points).toHaveLength(8);
    expect(s.points[4]).toEqual([expect.any(Number), null, null, null]);
    // 3 × 60 s intervals + gap capped at 180 s + 2 × 60 s + tail 60 s
    expect(s.coverage).toMatchObject({ coveredSeconds: 180 + 180 + 120 + 60, firstClock: clocks[0], lastClock: clocks[6] });
    await app.close();
  });

  it('48 h reads trends with min/max bands', async () => {
    const from = NOW - 48 * 3600;
    zabbix({
      'item.get': [numericItem()],
      'trend.get': Array.from({ length: 48 }, (_, i) => ({
        itemid: '69356',
        clock: String(from + 600 + i * 3600),
        num: '60',
        value_min: '1',
        value_avg: '2',
        value_max: '9',
      })),
    });
    const app = await graphApp();
    const body = (await app.inject({ url: '/api/graph?itemids=69356&hours=48' })).json();
    expect(body.source).toBe('trend');
    expect(callsOf('trend.get')[0]).toMatchObject({
      output: ['itemid', 'clock', 'num', 'value_min', 'value_avg', 'value_max'],
      time_from: from,
    });
    const s = body.series[0];
    expect(s.points[0]).toEqual([(from + 600) * 1000, 2, 1, 9]);
    expect(s.points.every((p: (number | null)[]) => p[1] !== null)).toBe(true);
    await app.close();
  });

  it('fills from history after trends stop early → trend+history', async () => {
    const from = NOW - 30 * 86_400;
    const lastTrend = NOW - 2 * 86_400; // trends stall two days ago
    const trendRows = [];
    for (let c = from; c <= lastTrend; c += 3600) {
      trendRows.push({ itemid: '69356', clock: String(c), num: '60', value_min: '1', value_avg: '1', value_max: '1' });
    }
    zabbix({
      'item.get': [numericItem()],
      'trend.get': trendRows,
      'history.get': (p: Params) => {
        const out = [];
        for (let c = p.time_from as number; c <= (p.time_till as number); c += 60) {
          out.push({ itemid: '69356', clock: String(c), value: '7' });
        }
        return out;
      },
    });
    const app = await graphApp();
    const body = (await app.inject({ url: '/api/graph?itemids=69356&hours=720' })).json();
    expect(body.source).toBe('trend+history');
    const [h] = callsOf('history.get');
    expect(h.time_from).toBe(lastTrend + 3600);
    const s = body.series[0];
    expect(s.points.length).toBeLessThanOrEqual(1500);
    expect(s.stats.last).toBe(7);
    expect(s.stats.max).toBe(7);
    // no line break at the trend→history seam
    expect(s.points.filter((p: (number | null)[]) => p[1] === null)).toHaveLength(0);
    await app.close();
  });

  it('splits a long trend read into back-to-back windows and counts every hour once', async () => {
    // Four items over 400 days in one request was past what Zabbix's PHP answers.
    const from = NOW - 400 * 86_400;
    const hourly = (p: Params) => {
      const out = [];
      for (const itemid of p.itemids as string[]) {
        for (let h = Math.ceil((p.time_from as number) / 3600) * 3600; h <= (p.time_till as number); h += 3600) {
          out.push({ itemid, clock: String(h), num: '60', value_min: '0', value_avg: String(h % 7), value_max: '9' });
        }
      }
      return out;
    };
    const ids = ['1', '2', '3', '4'];
    zabbix({ 'item.get': ids.map((itemid) => numericItem({ itemid })), 'trend.get': hourly });
    const app = await graphApp();
    const body = (await app.inject({ url: `/api/graph?itemids=1,2,3,4&from=${from}&to=${NOW}` })).json();
    expect(body.source).toBe('trend');

    const { TREND_MAX_ROWS, hourMarks } = await import('../sli/events.js');
    const calls = callsOf('trend.get') as { itemids: string[]; time_from: number; time_till: number }[];
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[0].time_from).toBe(from);
    expect(calls[calls.length - 1].time_till).toBe(NOW - 1);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].time_from).toBe(calls[i - 1].time_till + 1);
      expect(calls[i].time_from % 3600).toBe(0);
    }
    for (const c of calls) expect(c.itemids.length * hourMarks(c.time_from, c.time_till)).toBeLessThanOrEqual(TREND_MAX_ROWS);

    // A boundary hour read twice would shift the average.
    const marks = [];
    for (let h = Math.ceil(from / 3600) * 3600; h <= NOW - 1; h += 3600) marks.push(h % 7);
    const avg = marks.reduce((a, b) => a + b, 0) / marks.length;
    for (const s of body.series) expect(s.stats.avg).toBeCloseTo(avg, 10);
    await app.close();
  });

  it('marks 0/1 and ping keys as step series', async () => {
    zabbix({
      'item.get': [numericItem({ itemid: '1', key_: 'icmpping', units: '' }), numericItem({ itemid: '2', key_: 'custom', units: '' })],
      'history.get': (p: Params) => [{ itemid: (p.itemids as string[])[0], clock: String(NOW - 60), value: '1' }],
    });
    const app = await graphApp();
    const body = (await app.inject({ url: '/api/graph?itemids=1,2&hours=1' })).json();
    expect(body.series.map((s: { step: boolean }) => s.step)).toEqual([true, true]);
    await app.close();
  });

  it('accepts from/to and month, and rejects bad requests with 400', async () => {
    zabbix({ 'item.get': [numericItem()], 'trend.get': [] });
    const app = await graphApp();
    const okRange = await app.inject({ url: `/api/graph?itemids=69356&from=${NOW - 7200}&to=${NOW - 3600}` });
    expect(okRange.json()).toMatchObject({ from: NOW - 7200, to: NOW - 3600, source: 'history' });
    const month = await app.inject({ url: '/api/graph?itemids=69356&month=2026-08' });
    expect(month.json()).toMatchObject({ from: 1785517200, to: 1788195600, source: 'trend' });

    for (const url of [
      '/api/graph',
      '/api/graph?itemids=1,2,3,4,5',
      '/api/graph?itemids=1,x',
      `/api/graph?itemids=69356&from=${NOW}&to=${NOW}`,
      `/api/graph?itemids=69356&from=${NOW - 401 * 86_400}&to=${NOW}`,
      '/api/graph?itemids=69356&month=2026-13',
    ]) {
      expect((await app.inject({ url })).statusCode, url).toBe(400);
    }
    await app.close();
  });

  it('widens an explicit range to whole minutes, so requests seconds apart share one read (BK-13)', async () => {
    zabbix({ 'item.get': [numericItem({ itemid: '70001' })], 'history.get': [] });
    const app = await graphApp();
    const from = NOW - 9000;
    const to = NOW - 5400;
    const first = await app.inject({ url: `/api/graph?itemids=70001&from=${from + 17}&to=${to + 41}` });
    expect(first.json()).toMatchObject({ from, to: to + 60 });
    const second = await app.inject({ url: `/api/graph?itemids=70001&from=${from + 3}&to=${to + 59}` });
    expect(second.json()).toMatchObject({ from, to: to + 60 });
    expect(callsOf('item.get')).toHaveLength(1);
    // Already on the minute: left as asked, and a different minute is a different read.
    const exact = await app.inject({ url: `/api/graph?itemids=70001&from=${from}&to=${to}` });
    expect(exact.json()).toMatchObject({ from, to });
    expect(callsOf('item.get')).toHaveLength(2);
    await app.close();
  });

  it('checks an explicit range as it was asked and widens it after, so a request that was valid stays valid', async () => {
    zabbix({ 'item.get': [numericItem({ itemid: '70002' })], 'trend.get': [], 'history.get': [] });
    const app = await graphApp();
    // Exactly 400 days to the second, off the minute: widening makes it a minute longer, and it is still accepted.
    const res = await app.inject({ url: `/api/graph?itemids=70002&from=${NOW - 400 * 86_400 + 30}&to=${NOW + 30}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ from: NOW - 400 * 86_400, to: NOW + 60 });
    await app.close();
  });

  it('rejects text items and unknown ids with 400', async () => {
    zabbix({ 'item.get': [numericItem({ itemid: '9', value_type: '4' }), numericItem()] });
    const app = await graphApp();
    expect((await app.inject({ url: '/api/graph?itemids=69356,9&hours=1' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/graph?itemids=69356,12345&hours=1' })).statusCode).toBe(400);
    await app.close();
  });
});

describe('parseDelay', () => {
  it('reads Zabbix intervals', async () => {
    const { parseDelay } = await import('../services/history.js');
    expect(parseDelay('60')).toBe(60);
    expect(parseDelay('1m')).toBe(60);
    expect(parseDelay('5m')).toBe(300);
    expect(parseDelay('1h')).toBe(3600);
    expect(parseDelay('30s')).toBe(30);
    expect(parseDelay('{$SNMP.INTERVAL}')).toBe(60);
    expect(parseDelay('0')).toBe(0);
  });
});


describe('/api/net/devices', () => {
  it('is tri-state: never-polled ICMP is unknown, not down; sorted naturally with a site', async () => {
    // Relative to now: a value is believed only while fresh (reachability.ts).
    const recent = String(Math.floor(Date.now() / 1000) - 50);
    const hoursAgo = String(Math.floor(Date.now() / 1000) - 3 * 3600);
    const pings = [
      { itemid: '11', hostid: '1', key_: 'icmpping', lastvalue: '0', lastclock: '0', state: '0', delay: '1m', value_type: '3' },
      { itemid: '12', hostid: '1', key_: 'icmppingloss', lastvalue: '0', lastclock: '0', state: '0', delay: '1m', value_type: '0' },
      { itemid: '21', hostid: '2', key_: 'icmpping', lastvalue: '0', lastclock: recent, state: '0', delay: '1m', value_type: '3' },
      { itemid: '22', hostid: '2', key_: 'icmppingloss', lastvalue: '100', lastclock: recent, state: '0', delay: '1m', value_type: '0' },
      { itemid: '31', hostid: '3', key_: 'icmpping', lastvalue: '1', lastclock: recent, state: '1', delay: '1m', value_type: '3' },
      // Collected and supported, but three hours ago: no longer "up".
      { itemid: '41', hostid: '4', key_: 'icmpping', lastvalue: '1', lastclock: hoursAgo, state: '0', delay: '1m', value_type: '3' },
    ];
    zabbix({
      'host.get': [
        zHost({ hostid: '1', name: '1.2.10 IDX24C' }),
        zHost({ hostid: '2', name: '1.2.2. IDXSVFSW01' }),
        zHost({ hostid: '3', name: 'INTERNET' }),
        zHost({ hostid: '4', name: '1.2.3 IDXSTALE' }),
        zHost({ hostid: '5', name: '1.2.4 IDXNOPING' }),
      ],
      'item.get': pings,
      'history.get': (params: Params) => pingZabbix(pings)('history.get', params),
    });
    const { netRoutes } = await import('../routes/net.js');
    const app = await buildTestApp(netRoutes);
    const body = (await app.inject({ url: '/api/net/devices' })).json();
    expect(body.map((d: { name: string }) => d.name)).toEqual([
      '1.2.2. IDXSVFSW01',
      '1.2.3 IDXSTALE',
      '1.2.4 IDXNOPING',
      '1.2.10 IDX24C',
      'INTERNET',
    ]);
    const [sw2, stale, noPing, sw10, inet] = body;
    expect(sw2.icmp).toEqual({ state: 'down', up: false, loss: 100 });
    expect(sw10.icmp).toEqual({ state: 'unknown' });
    expect(inet.icmp.state).toBe('unknown');
    expect(stale.icmp).toEqual({ state: 'unknown' });
    expect(noPing.icmp).toBeNull();
    expect(sw2.site).toEqual({ code: 1, name: 'Jakarta' });
    expect(inet.site).toBeNull();
    // One read of every monitored host's ping items, shared with Sites and Hosts, then their values in bulk.
    const [params] = callsOf('item.get');
    expect(params.output).toEqual(expect.arrayContaining(['state', 'delay', 'value_type']));
    expect(params.output).not.toContain('lastvalue');
    expect(params).toMatchObject({ search: { key_: 'icmpping' }, startSearch: true, monitored: true });
    expect(params.hostids).toBeUndefined();
    expect(callsOf('history.get').map((p) => p.history).sort()).toEqual([0, 3]);
    await app.close();
  });
});

describe('/api/net/interfaces', () => {
  const clock = String(Math.floor(Date.now() / 1000) - 37);
  const port = (index: number, name: string, alias: string, over: Record<string, string> = {}) => {
    const it = (kind: string, key: string, label: string, lastvalue: string) => ({
      itemid: `${index}${kind.length}${key.length}`,
      name: `Interface ${name}(${alias}): ${label}`,
      key_: key,
      lastvalue: over[kind] ?? lastvalue,
      lastclock: clock,
      units: '',
      value_type: '3',
      state: '0',
      status: '0',
    });
    return [
      it('in', `net.if.in[ifHCInOctets.${index}]`, 'Bits received', '250000000'),
      it('out', `net.if.out[ifHCOutOctets.${index}]`, 'Bits sent', '500000000'),
      it('status', `net.if.status[ifOperStatus.${index}]`, 'Operational status', '1'),
      it('speed', `net.if.speed[ifHighSpeed.${index}]`, 'Speed', '1000000000'),
      it('in.errors', `net.if.in.errors[ifInErrors.${index}]`, 'Inbound packets with errors', '3'),
      it('out.errors', `net.if.out.errors[ifOutErrors.${index}]`, 'Outbound packets with errors', '0'),
      it('in.discards', `net.if.in.discards[ifInDiscards.${index}]`, 'Inbound packets discarded', '1'),
      it('out.discards', `net.if.out.discards[ifOutDiscards.${index}]`, 'Outbound packets discarded', '2'),
      it('type', `net.if.type[ifType.${index}]`, 'Interface type', '6'),
    ];
  };

  it('folds items per ifIndex, skips walks, sorts naturally, filters and pages', async () => {
    zabbix({
      'item.get': [
        { itemid: '1', name: 'Cisco IOS: SNMP walk network interfaces', key_: 'net.if.walk', lastvalue: '', lastclock: '0', state: '0', status: '0', units: '', value_type: '4' },
        ...port(10, 'Gi1/0/10', 'Uplink (core)', { status: '2' }),
        ...port(33, 'Gi1/0/2', ''),
        ...port(7, 'Gi1/0/1', 'never polled').map((i) => ({ ...i, lastclock: '0' })),
        // Last written a day ago: its "up" is not believed.
        ...port(8, 'Gi1/0/3', 'stale').map((i) => ({ ...i, lastclock: String(Number(clock) - 86_400) })),
      ],
    });
    const { netRoutes } = await import('../routes/net.js');
    const app = await buildTestApp(netRoutes);

    const body = (await app.inject({ url: '/api/net/interfaces?hostid=10668' })).json();
    expect(body.total).toBe(4);
    expect(body.rows.map((r: { name: string }) => r.name)).toEqual(['Gi1/0/1', 'Gi1/0/2', 'Gi1/0/3', 'Gi1/0/10']);
    expect(body.rows[2]).toMatchObject({ operStatus: 'unknown', inBps: null, lastclock: null });
    const gi2 = body.rows[1];
    expect(gi2).toMatchObject({
      index: 33,
      alias: '',
      operStatus: 'up',
      speed: 1_000_000_000,
      inBps: 250_000_000,
      outBps: 500_000_000,
      utilisation: 50,
      inErrors: 3,
      outErrors: 0,
      inDiscards: 1,
      outDiscards: 2,
      lastclock: Number(clock),
    });
    expect(Object.keys(gi2.itemids).sort()).toEqual(['in', 'inErrors', 'out', 'outErrors', 'speed', 'status']);
    expect(body.rows[3]).toMatchObject({ alias: 'Uplink (core)', operStatus: 'down' });
    expect(body.rows[0]).toMatchObject({ operStatus: 'unknown', inBps: null, utilisation: null });
    expect(body.summary).toEqual({ up: 1, down: 1, other: 2 });

    const down = (await app.inject({ url: '/api/net/interfaces?hostid=10668&status=down' })).json();
    expect(down.rows.map((r: { name: string }) => r.name)).toEqual(['Gi1/0/10']);
    const search = (await app.inject({ url: '/api/net/interfaces?hostid=10668&search=UPLINK' })).json();
    expect(search.total).toBe(1);
    // A page past the end is the last page, and says so in `page` (FR-23).
    const paged = (await app.inject({ url: '/api/net/interfaces?hostid=10668&page=2&pageSize=10' })).json();
    expect(paged).toMatchObject({ total: 4, page: 1, pageSize: 10 });
    expect(paged.rows.map((r: { name: string }) => r.name)).toEqual(['Gi1/0/1', 'Gi1/0/2', 'Gi1/0/3', 'Gi1/0/10']);

    expect((await app.inject({ url: '/api/net/interfaces' })).statusCode).toBe(400);
    await app.close();
  });

  it('answers the last page when a later one is asked, and the right rows for every page before it (FR-23)', async () => {
    zabbix({ 'item.get': Array.from({ length: 25 }, (_, i) => port(i + 1, `Gi1/0/${i + 1}`, '')).flat() });
    const { netRoutes } = await import('../routes/net.js');
    const app = await buildTestApp(netRoutes);
    const names = async (page: number) => {
      const body = (await app.inject({ url: `/api/net/interfaces?hostid=10668&page=${page}&pageSize=10` })).json();
      return { page: body.page, total: body.total, names: body.rows.map((r: { name: string }) => r.name) };
    };

    expect(await names(1)).toMatchObject({ page: 1, total: 25, names: Array.from({ length: 10 }, (_, i) => `Gi1/0/${i + 1}`) });
    expect(await names(2)).toMatchObject({ page: 2, names: Array.from({ length: 10 }, (_, i) => `Gi1/0/${i + 11}`) });
    expect(await names(3)).toMatchObject({ page: 3, names: Array.from({ length: 5 }, (_, i) => `Gi1/0/${i + 21}`) });
    expect(await names(9)).toMatchObject({ page: 3, total: 25, names: Array.from({ length: 5 }, (_, i) => `Gi1/0/${i + 21}`) });
    await app.close();
  });

  it('answers page 1 with no rows for a device with no interfaces at all', async () => {
    zabbix({ 'item.get': [] });
    const { netRoutes } = await import('../routes/net.js');
    const app = await buildTestApp(netRoutes);
    const body = (await app.inject({ url: '/api/net/interfaces?hostid=10668&page=4' })).json();
    expect(body).toMatchObject({ rows: [], total: 0, page: 1 });
    await app.close();
  });
});
