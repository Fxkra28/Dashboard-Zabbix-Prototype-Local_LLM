import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, zHost, zProblem } from './helpers/app.js';

/**
 * Coverage for every data endpoint the BFF serves.
 *
 * All Zabbix traffic funnels through `zbx()`/`zbxWrite()` in zabbix.ts, so one
 * mock of that module covers all fifteen route modules. The real error classes
 * are kept: errors.ts branches on `instanceof`, and a stubbed class would make
 * every failure-mode assertion pass for the wrong reason.
 */
const { zbxMock, zbxWriteMock } = vi.hoisted(() => ({
  zbxMock: vi.fn(),
  zbxWriteMock: vi.fn(),
}));

vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock, zbxWrite: zbxWriteMock };
});

const { ZabbixAuthError, ZabbixTimeoutError } = await import(
  '../clients/zabbix.js'
);

/** Answer per Zabbix method; anything unlisted returns an empty list. */
function zabbixReturns(map: Record<string, unknown>): void {
  zbxMock.mockImplementation(async (method: string) => map[method] ?? []);
}

afterEach(() => {
  zbxMock.mockReset();
  zbxWriteMock.mockReset();
  vi.useRealTimers();
});

/** 2026-08 in Asia/Jakarta, the zone every monthly figure is cut in. */
const AUG = { from: 1785517200, to: 1788195600 };

/**
 * A small estate for the reachability states. Alpha has more hosts whose
 * interface flags say "unavailable"; Zulu has the one host that does not
 * answer ping, so it must come first.
 */
function reachabilityEstate() {
  const now = Math.floor(Date.now() / 1000);
  const ping = (hostid: string, lastvalue: string, over: Record<string, string> = {}) =>
    ['icmpping', 'icmppingloss', 'icmppingsec'].map((key_) => ({
      itemid: `${hostid}-${key_}`,
      hostid,
      key_,
      lastvalue: key_ === 'icmpping' ? lastvalue : '0',
      lastclock: String(now - 45),
      state: '0',
      delay: '1m',
      ...over,
    }));
  const at = (site: string) => [{ tag: 'site', value: site }];
  const pings = [...ping('1', '1'), ...ping('2', '1'), ...ping('4', '0', { state: '1', lastclock: '0' }), ...ping('5', '0'), ...ping('6', '1')];
  zabbixReturns({
    'host.get': [
      zHost({ hostid: '1', name: 'A1', tags: at('Alpha'), interfaces: [{ ip: '10.0.0.1', type: '2', available: '2' }] }),
      zHost({ hostid: '2', name: 'A2', tags: at('Alpha'), interfaces: [{ ip: '10.0.0.2', type: '1', available: '2' }] }),
      zHost({ hostid: '3', name: 'A3', tags: at('Alpha'), status: '1', interfaces: [{ ip: '10.0.0.3', type: '2', available: '2' }] }),
      zHost({ hostid: '4', name: 'A4', tags: at('Alpha'), interfaces: [] }),
      zHost({ hostid: '5', name: 'Z1', tags: at('Zulu') }),
      zHost({ hostid: '6', name: 'Z2', tags: at('Zulu') }),
      zHost({ hostid: '7', name: 'Z3', tags: at('Zulu') }),
    ],
    'item.get': pings,
    // The bulk value read (reachability.ts): each item's value, as Zabbix's history holds it.
    'history.get': pings.filter((i) => i.lastclock !== '0').map((i) => ({ itemid: i.itemid, clock: i.lastclock, value: i.lastvalue })),
    'problem.get': [],
  });
}


describe('hosts routes', () => {
  it('GET /api/hosts returns hosts', async () => {
    zabbixReturns({ 'host.get': [zHost()] });
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/hosts' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    await app.close();
  });

  it('GET /api/hosts/overview and /api/hostgroups and /api/items answer 200', async () => {
    zabbixReturns({ 'host.get': [zHost()], 'hostgroup.get': [], 'item.get': [] });
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);

    for (const url of ['/api/hosts/overview', '/api/hostgroups', '/api/items?hostid=10689']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(200);
    }
    await app.close();
  });

  it('GET /api/hosts/overview gives each host a state and reason, ping first, and no loss or latency', async () => {
    reachabilityEstate();
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);

    const res = await app.inject({ url: '/api/hosts/overview' });
    expect(res.statusCode).toBe(200);
    const byName = Object.fromEntries(
      res.json().map((h: { name: string; state: string; reason: string }) => [h.name, `${h.state}/${h.reason}`]),
    );
    expect(byName).toEqual({
      A1: 'degraded/snmp-silent',
      A2: 'degraded/agent-silent',
      A3: 'disabled/disabled',
      A4: 'nodata/no-interface',
      Z1: 'down/ping',
      Z2: 'up/ping',
      Z3: 'up/interface',
    });
    expect(res.json()[0].problems).toEqual({ total: 0, bySeverity: {} });
    // Loss and latency belong to the operator-only /api/net routes.
    expect(res.body).not.toMatch(/"(loss|latency)"/);
    await app.close();
  });

  it('GET /api/hostgroups asks for groups with hosts, not the deprecated real_hosts', async () => {
    zabbixReturns({ 'hostgroup.get': [] });
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);

    await app.inject({ url: '/api/hostgroups' });
    const [, params] = zbxMock.mock.calls.find(([m]) => m === 'hostgroup.get')!;
    expect(params).toMatchObject({ with_hosts: true });
    expect(params).not.toHaveProperty('real_hosts');
    await app.close();
  });

  it('GET /api/latest returns an empty, untruncated page with no filter', async () => {
    // Zabbix requires a host or group filter here; the route short-circuits
    // rather than asking for every item in the estate.
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/latest' });
    expect(res.json()).toEqual({ items: [], truncated: false });
    expect(zbxMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET /api/latest flags a full page as truncated', async () => {
    // A group at HCML's scale can exceed one page. Reporting a short list as
    // complete would understate the estate while looking authoritative.
    zabbixReturns({ 'item.get': Array.from({ length: 500 }, (_, i) => ({ itemid: String(i) })) });
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/latest?groupid=22' });
    expect(res.json().truncated).toBe(true);
    await app.close();
  });
});


describe('problems / history / maps routes', () => {
  it('GET /api/problems returns enriched problems', async () => {
    zabbixReturns({
      'problem.get': [zProblem()],
      'trigger.get': [{ triggerid: '25238', manual_close: '1' }],
      'host.get': [zHost({ hostid: '10697', name: '4.3.3 FPSO ARUBA 3' })],
    });
    const { problemRoutes } = await import('../routes/problems.js');
    const app = await buildTestApp(problemRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/problems' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('GET /api/maps and /api/maps/detail answer 200', async () => {
    zabbixReturns({ 'map.get': [] });
    const { mapRoutes } = await import('../routes/maps.js');
    const app = await buildTestApp(mapRoutes);

    expect((await app.inject({ url: '/api/maps' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/maps/detail?mapid=1' })).statusCode).toBe(200);
    await app.close();
  });

  it('GET /api/maps/detail resolves host macros and attaches problem status', async () => {
    zabbixReturns({
      'map.get': [
        {
          sysmapid: '2',
          links: [],
          selements: [
            {
              selementid: '5',
              elementtype: '0',
              label: '{HOSTNAME} ({HOST.IP})\r\n',
              elements: [{ hostid: '10697' }],
            },
            { selementid: '6', elementtype: '4', label: 'Inet Provider 1', elements: [] },
          ],
        },
      ],
      'host.get': [
        {
          hostid: '10697',
          host: 'fpso-aruba-3',
          name: '4.3.3 FPSO ARUBA 3',
          interfaces: [{ ip: '10.4.3.3', dns: '', useip: '1', main: '1' }],
        },
      ],
      'problem.get': [zProblem({ object: '0', severity: '4' })],
      'trigger.get': [{ triggerid: '25238', hosts: [{ hostid: '10697', name: '4.3.3 FPSO ARUBA 3' }] }],
    });
    const { mapRoutes } = await import('../routes/maps.js');
    const app = await buildTestApp(mapRoutes);

    const res = await app.inject({ url: '/api/maps/detail?mapid=2' });
    expect(res.statusCode).toBe(200);
    const [map] = res.json();
    expect(map.selements[0]).toMatchObject({
      labelText: '4.3.3 FPSO ARUBA 3 (10.4.3.3)',
      hostid: '10697',
      problems: 1,
      maxSeverity: 4,
    });
    expect(map.selements[1].labelText).toBe('Inet Provider 1');
    expect(map.selements[1]).not.toHaveProperty('problems');
    await app.close();
  });

  it('resolveLabel drops unknown macros and brackets a missing value leaves empty', async () => {
    const { resolveLabel } = await import('../services/maps.js');
    // The bug this replaces: every HCML host label rendered as "()".
    expect(resolveLabel('{HOSTNAME} ({HOST.IP})', { hostid: '1', host: 'h', name: 'CORE' })).toBe('CORE');
    expect(resolveLabel('{NO.SUCH.MACRO}\r\nInet Provider 1')).toBe('Inet Provider 1');
  });
});


describe('input validation and error shape', () => {
  it('rejects a missing or non-numeric id with 400 { error, message } before calling Zabbix', async () => {
    const { hostRoutes } = await import('../routes/hosts.js');
    const { historyRoutes } = await import('../routes/history.js');
    const { mapRoutes } = await import('../routes/maps.js');
    const { netRoutes } = await import('../routes/net.js');
    const app = await buildTestApp(hostRoutes, historyRoutes, mapRoutes, netRoutes);

    // Each of these would reach Zabbix as `[undefined]` and come back as a 500.
    for (const url of [
      '/api/items',
      '/api/items?hostid=abc',
      '/api/graph',
      '/api/maps/detail',
      '/api/net/interfaces',
    ]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(400);
      expect(res.json(), url).toMatchObject({ error: 'bad_request', message: expect.any(String) });
    }
    expect(zbxMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('never lets a non-numeric window reach Zabbix as NaN', async () => {
    // NaN survives Math.min/Math.max, and Zabbix reads a NaN time_from as "no
    // bound", ?hours=abc once returned an item's entire history.
    zabbixReturns({});
    const { analyticsRoutes } = await import('../routes/analytics.js');
    const app = await buildTestApp(analyticsRoutes);

    const avail = (await app.inject({ url: '/api/reports/availability?days=abc&severity=abc' })).json();
    expect(avail.windowSeconds).toBe(7 * 86_400);
    // The any-problem basis reads events straight from Zabbix, so its bounds are what could turn into NaN.
    const legacy = (await app.inject({ url: '/api/reports/availability?basis=all-problems&days=abc&severity=abc' })).json();
    expect(legacy.windowSeconds).toBe(7 * 86_400);

    const windows = zbxMock.mock.calls
      .map(([, params]) => params as { time_from?: unknown })
      .filter((p) => p && 'time_from' in p);
    expect(windows.length).toBeGreaterThan(0);
    for (const p of windows) expect(Number.isFinite(p.time_from)).toBe(true);
    await app.close();
  });

  it('maps a Zabbix API error to 502 and an unknown route to 404, in the same shape', async () => {
    const { ZabbixApiError } = await import('../clients/zabbix.js');
    zbxMock.mockRejectedValue(new ZabbixApiError('host.get: {"code":-32602}'));
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);

    const res = await app.inject({ url: '/api/hosts' });
    expect(res.statusCode).toBe(502);
    // The method and Zabbix's own words stay in the log (source-down.test.ts); a reader gets one sentence.
    expect(res.json()).toMatchObject({
      error: 'zabbix_error',
      message: expect.stringMatching(/^The data source is not answering\. Tell an administrator and quote reference \S+\.$/),
    });
    expect(res.body).not.toContain('host.get');

    const missing = await app.inject({ url: '/api/does-not-exist' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: 'not_found', message: expect.any(String) });
    await app.close();
  });

  it('does not leak an unexpected error message to the client', async () => {
    zbxMock.mockRejectedValue(new Error('internal detail that must stay in the log'));
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);

    const res = await app.inject({ url: '/api/hosts' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('internal');
    expect(res.json().message).not.toContain('internal detail');
    await app.close();
  });
});


describe('net routes', () => {
  it('answers 200 on both network endpoints (the other three were removed, tracker BK-11)', async () => {
    zabbixReturns({ 'host.get': [zHost()], 'item.get': [] });
    const { netRoutes } = await import('../routes/net.js');
    const app = await buildTestApp(netRoutes);

    for (const url of ['/api/net/devices', '/api/net/interfaces?hostid=10689']) {
      expect((await app.inject({ url })).statusCode, url).toBe(200);
    }
    await app.close();
  });
});


describe('report routes', () => {
  it('GET /api/reports/top-triggers counts firings per trigger', async () => {
    zabbixReturns({
      'event.get': [
        { objectid: '1', name: 'High ICMP ping loss', severity: '2', hosts: [{ hostid: '1', name: 'a' }] },
        { objectid: '1', name: 'High ICMP ping loss', severity: '2', hosts: [{ hostid: '1', name: 'a' }] },
        { objectid: '2', name: 'Other', severity: '3', hosts: [{ hostid: '2', name: 'b' }] },
      ],
    });
    const { reportRoutes } = await import('../routes/reports.js');
    const app = await buildTestApp(reportRoutes);

    const body = (await app.inject({ url: '/api/reports/top-triggers?days=7' })).json();
    expect(body.triggers[0]).toMatchObject({ objectid: '1', count: 2 });
    expect(body.truncated).toBe(false);
    await app.close();
  });

  it('GET /api/stats and /api/reports/problems-by-group answer 200', async () => {
    zabbixReturns({
      'host.get': [zHost()],
      'hostgroup.get': [],
      'problem.get': [],
      'trigger.get': [],
      'item.get': [],
    });
    const { reportRoutes } = await import('../routes/reports.js');
    const app = await buildTestApp(reportRoutes);

    expect((await app.inject({ url: '/api/stats' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/reports/problems-by-group' })).statusCode).toBe(200);
    await app.close();
  });

  it('counts monitored hosts, items and triggers alike on the Dashboard, so the triggers of templates are left out', async () => {
    const { invalidate } = await import('../core/cache.js');
    invalidate(''); // a clean cache: earlier tests in this file share it
    const counts: Record<string, string> = { 'host.get': '3', 'item.get': '40', 'trigger.get': '12', 'hostgroup.get': '2' };
    zbxMock.mockImplementation(async (method: string, params?: { countOutput?: boolean }) => (params?.countOutput ? counts[method] : []));
    const { reportRoutes } = await import('../routes/reports.js');
    const app = await buildTestApp(reportRoutes);

    expect((await app.inject({ url: '/api/stats' })).json()).toMatchObject({ hosts: 3, items: 40, triggers: 12, groups: 2 });
    expect(zbxMock).toHaveBeenCalledWith('host.get', { countOutput: true, monitored_hosts: true });
    expect(zbxMock).toHaveBeenCalledWith('item.get', { countOutput: true, monitored: true }, { timeoutMs: 120_000 });
    expect(zbxMock).toHaveBeenCalledWith('trigger.get', { countOutput: true, monitored: true }, { timeoutMs: 120_000 });
    await app.close();
  });
});


describe('analytics routes', () => {
  it('GET /api/reports/availability defaults to the configured severity floor', async () => {
    // The regression this pins: a floor of 3 showed HCML an empty report,
    // because their entire estate alarms at severity 2.
    zabbixReturns({ 'event.get': [], 'host.get': [zHost()] });
    const { analyticsRoutes } = await import('../routes/analytics.js');
    const { config } = await import('../core/config.js');
    const app = await buildTestApp(analyticsRoutes);

    const body = (await app.inject({ url: '/api/reports/availability' })).json();
    expect(body.minSeverity).toBe(config.reports.availabilityMinSeverity);
    expect(body.minSeverity).toBeLessThanOrEqual(2);
    await app.close();
  });

  it('pushes the severity floor down to Zabbix rather than filtering after the fetch', async () => {
    // Filtering in JS meant a flood of low-severity events could fill the page
    // limit and push the high-severity ones out entirely.
    zabbixReturns({ 'event.get': [], 'host.get': [zHost()] });
    const { analyticsRoutes } = await import('../routes/analytics.js');
    const app = await buildTestApp(analyticsRoutes);

    // The severity floor belongs to the any-problem basis; the default basis
    // measures ICMP availability and has no floor to push down.
    await app.inject({ url: '/api/reports/availability?basis=all-problems&severity=3' });
    const call = zbxMock.mock.calls.find(([m]) => m === 'event.get');
    expect(call?.[1]).toMatchObject({ severities: [3, 4, 5] });
    await app.close();
  });

  it('clamps out-of-range query parameters', async () => {
    zabbixReturns({ 'event.get': [], 'host.get': [zHost()] });
    const { analyticsRoutes } = await import('../routes/analytics.js');
    const app = await buildTestApp(analyticsRoutes);

    const body = (await app.inject({ url: '/api/reports/availability?days=9999&severity=99' })).json();
    expect(body.windowSeconds).toBe(365 * 86400);
    expect(body.minSeverity).toBe(5);
    await app.close();
  });

  it('basis=all-problems honours month: Jakarta bounds, clipped to now, echoed, one cache entry per month', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-17T03:00:00Z'));
    const now = Math.floor(Date.now() / 1000);
    zabbixReturns({ 'event.get': [] });
    const { analyticsRoutes } = await import('../routes/analytics.js');
    const { OPEN_AT_START_LOOKBACK } = await import('../services/incidents.js');
    const app = await buildTestApp(analyticsRoutes);
    // Each report reads its window, just before it the look-back for problems already open, and the
    // window's recovery events again, in that order.
    const lookback = (from: number) => [from - OPEN_AT_START_LOOKBACK, from - 1];

    // It must not ignore `month` and answer for the last 7 days.
    const aug = (await app.inject({ url: '/api/reports/availability?basis=all-problems&month=2026-08' })).json();
    expect(aug).toMatchObject({ basis: 'all-problems', month: '2026-08', from: AUG.from, to: AUG.to, windowSeconds: AUG.to - AUG.from });
    const windows = () =>
      zbxMock.mock.calls.filter(([m]) => m === 'event.get').map(([, p]) => [p.time_from, p.time_till]);
    expect(windows()).toEqual([[AUG.from, AUG.to], lookback(AUG.from), [AUG.from, AUG.to]]);

    const sep = (await app.inject({ url: '/api/reports/availability?basis=all-problems&month=2026-09' })).json();
    expect(sep).toMatchObject({ month: '2026-09', from: AUG.to, to: now });
    await app.inject({ url: '/api/reports/availability?basis=all-problems&month=2026-08' });
    expect(windows()).toEqual([
      [AUG.from, AUG.to],
      lookback(AUG.from),
      [AUG.from, AUG.to],
      [AUG.to, now],
      lookback(AUG.to),
      [AUG.to, now],
    ]);

    const rolling = (await app.inject({ url: '/api/reports/availability?basis=all-problems&days=7' })).json();
    expect(rolling).toMatchObject({ month: null, windowSeconds: 7 * 86_400 });

    for (const url of [
      '/api/reports/availability?basis=all-problems&month=2026-13',
      '/api/reports/availability?basis=all-problems&month=Aug',
      '/api/reports/availability?basis=all-problems&month=2026-10',
      '/api/reports/availability?basis=all-problems&month=2024-01',
      '/api/reports/availability?month=2026-8',
    ]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(400);
      expect(res.json(), url).toMatchObject({ error: 'bad_request' });
    }
    await app.close();
  });

  it('GET /api/reports/noise sends the loudest `top` triggers, in order, and says how many there were', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fire = (eventid: string, objectid: string, secondsAgo: number) => ({
      eventid,
      objectid,
      clock: String(now - secondsAgo),
      severity: '2',
      r_eventid: '0',
      acknowledged: '0',
      name: `Trigger ${objectid}`,
      hosts: [{ hostid: '1', name: 'a' }],
    });
    zabbixReturns({
      'event.get': [
        fire('1', 'A', 3600),
        fire('2', 'A', 7200),
        fire('3', 'A', 9000),
        fire('4', 'B', 3600),
        fire('5', 'B', 5400),
        fire('6', 'C', 600),
      ],
    });
    const { analyticsRoutes } = await import('../routes/analytics.js');
    const app = await buildTestApp(analyticsRoutes);

    const top2 = (await app.inject({ url: '/api/reports/noise?top=2' })).json();
    expect(top2.triggers.map((t: { objectid: string }) => t.objectid)).toEqual(['A', 'B']);
    expect(top2).toMatchObject({ total: 3, distinctTriggers: 3, totalEvents: 6, truncated: false });
    for (const key of ['from', 'to', 'windowSeconds', 'minSeverity', 'concentration', 'counts', 'thresholds']) {
      expect(top2).toHaveProperty(key);
    }
    expect((await app.inject({ url: '/api/reports/noise' })).json()).toMatchObject({ total: 3, triggers: expect.any(Array) });
    expect((await app.inject({ url: '/api/reports/noise' })).json().triggers).toHaveLength(3);
    expect((await app.inject({ url: '/api/reports/noise?top=0' })).json().triggers).toHaveLength(1);
    expect((await app.inject({ url: '/api/reports/noise?top=abc' })).json().triggers).toHaveLength(3);
    // `top` only cuts what is sent: one report behind all of these, which reads the window, the
    // look-back before it and the window's recoveries. (This fake answers every event.get with the
    // same rows, so the recoveries here are never taken for a problem's end and cause no lookups worth
    // counting; those are tested in incidents-before-window.test.ts.)
    expect(zbxMock.mock.calls.filter(([m, p]) => m === 'event.get' && p.time_from !== undefined)).toHaveLength(3);
    await app.close();
  });

  it('GET /api/reports/noise defaults to 100 triggers and never sends more than 1000', async () => {
    const now = Math.floor(Date.now() / 1000);
    zabbixReturns({
      'event.get': Array.from({ length: 1001 }, (_, i) => ({
        eventid: String(i),
        objectid: String(10_000 + i),
        clock: String(now - 600 - i),
        severity: '2',
        r_eventid: '0',
        acknowledged: '0',
        name: 'x',
        hosts: [{ hostid: '1', name: 'a' }],
      })),
    });
    const { analyticsRoutes } = await import('../routes/analytics.js');
    const app = await buildTestApp(analyticsRoutes);

    expect((await app.inject({ url: '/api/reports/noise' })).json()).toMatchObject({ total: 1001 });
    expect((await app.inject({ url: '/api/reports/noise' })).json().triggers).toHaveLength(100);
    expect((await app.inject({ url: '/api/reports/noise?top=5000' })).json().triggers).toHaveLength(1000);
    await app.close();
  });

  it('answers the slow reports from their last good run while Zabbix fails, but never invents one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-17T03:00:00Z'));
    const start = Date.now();
    const { invalidate } = await import('../core/cache.js');
    invalidate(''); // a clean cache: earlier tests in this file share it
    zabbixReturns({ 'event.get': [], 'item.get': [] });
    const { ZabbixApiError } = await import('../clients/zabbix.js');
    const { analyticsRoutes } = await import('../routes/analytics.js');
    const app = await buildTestApp(analyticsRoutes);
    const reports = [
      '/api/reports/noise?days=30',
      '/api/reports/availability?basis=all-problems&month=2026-08',
      '/api/reports/capacity?days=30',
    ];
    const status = async (url: string) => (await app.inject({ url })).statusCode;
    for (const url of reports) expect(await status(url), url).toBe(200);

    zbxMock.mockRejectedValue(new ZabbixApiError('trend.get: HTTP 500'));
    // Within the stale window, and long past it: the last good run is still
    // the answer while Zabbix is failing: a report page beats a 502.
    for (const later of [200_000, 700_000]) {
      vi.setSystemTime(start + later);
      for (const url of reports) expect(await status(url), `${url} +${later / 1000}s`).toBe(200);
    }
    // A report that never succeeded has nothing to fall back on…
    expect(await status('/api/reports/noise?days=14')).toBe(502);
    // …and neither does one dropped by invalidate(), as after a write.
    invalidate('noise:');
    expect(await status('/api/reports/noise?days=30')).toBe(502);
    await app.close();
  });

  it('GET /api/reports/noise, /aging and /capacity answer 200', async () => {
    zabbixReturns({
      'event.get': [],
      'host.get': [zHost()],
      'problem.get': [],
      'trigger.get': [],
      'item.get': [],
      'trend.get': [],
      'history.get': [],
    });
    const { analyticsRoutes } = await import('../routes/analytics.js');
    const app = await buildTestApp(analyticsRoutes);

    for (const url of ['/api/reports/noise', '/api/reports/aging', '/api/reports/capacity']) {
      expect((await app.inject({ url })).statusCode, url).toBe(200);
    }
    await app.close();
  });
});


describe('service-centric routes', () => {
  it('GET /api/sla and /api/sla/sli answer 200', async () => {
    zabbixReturns({ 'sla.get': [], 'sla.getsli': { sli: [], serviceids: [], periods: [] } });
    const { slaRoutes } = await import('../routes/sla.js');
    const app = await buildTestApp(slaRoutes);

    expect((await app.inject({ url: '/api/sla' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/sla/sli?slaid=1' })).statusCode).toBe(200);
    await app.close();
  });

  it('GET /api/services answers 200', async () => {
    zabbixReturns({ 'service.get': [] });
    const { serviceRoutes } = await import('../routes/services.js');
    const app = await buildTestApp(serviceRoutes);

    expect((await app.inject({ url: '/api/services' })).statusCode).toBe(200);
    await app.close();
  });

  it('GET /api/sites groups hosts by their site tag', async () => {
    zabbixReturns({
      'host.get': [zHost(), zHost({ hostid: '10692', name: '11.1 FG-60F-MAC-MOPU-1', tags: [{ tag: 'site', value: 'MOPU' }] })],
      'problem.get': [],
      'trigger.get': [],
    });
    const { siteRoutes } = await import('../routes/sites.js');
    const app = await buildTestApp(siteRoutes);

    const body = (await app.inject({ url: '/api/sites' })).json();
    expect(body.sites.map((s: { name: string }) => s.name).sort()).toEqual(['Jakarta', 'MOPU']);
    // The tag is the most explicit signal and must win over group fallback.
    expect(body.coverage.tag).toBe(2);
    await app.close();
  });

  it('GET /api/sites counts hosts by state, keeps the interface counts, and leads with hosts down', async () => {
    reachabilityEstate();
    const { siteRoutes } = await import('../routes/sites.js');
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(siteRoutes, hostRoutes);

    const res = await app.inject({ url: '/api/sites' });
    const [zulu, alpha] = res.json().sites;
    // Alpha has more "unavailable" interfaces, but none of its hosts is down.
    expect([zulu.name, alpha.name]).toEqual(['Zulu', 'Alpha']);
    expect(alpha).toMatchObject({
      total: 4,
      up: 0,
      down: 0,
      degraded: 2,
      nodata: 1,
      disabled: 1,
      available: 0,
      unavailable: 3,
      unknown: 1,
    });
    expect(zulu).toMatchObject({ total: 3, up: 2, down: 1, degraded: 0, nodata: 0, available: 3, unavailable: 0 });
    expect(alpha.hosts[0]).toMatchObject({ name: 'A1', availability: 'unavailable', state: 'degraded', reason: 'snmp-silent' });
    expect(zulu.hosts[0]).toMatchObject({ name: 'Z1', availability: 'available', state: 'down', reason: 'ping' });
    expect(res.body).not.toMatch(/"(loss|latency)"/);

    // Problems and ICMP readings are shared caches, not a read per route.
    await app.inject({ url: '/api/hosts/overview' });
    expect(zbxMock.mock.calls.filter(([m]) => m === 'problem.get')).toHaveLength(1);
    expect(zbxMock.mock.calls.filter(([m]) => m === 'item.get')).toHaveLength(1);
    await app.close();
  });

  it('GET /api/links answers 200', async () => {
    zabbixReturns({ 'item.get': [] });
    const { linkRoutes } = await import('../routes/links.js');
    const app = await buildTestApp(linkRoutes);

    expect((await app.inject({ url: '/api/links' })).statusCode).toBe(200);
    await app.close();
  });

  it('GET /api/reports/inventory scores naming against the configured pattern', async () => {
    zabbixReturns({
      'host.get': [zHost(), zHost({ hostid: '2', name: 'INTERNET', tags: [] })],
      'hostgroup.get': [],
    });
    const { inventoryRoutes } = await import('../routes/inventory.js');
    const app = await buildTestApp(inventoryRoutes);

    const res = await app.inject({ url: '/api/reports/inventory' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});


describe('acknowledge write-back', () => {
  // The route refuses before anything else when no write token is configured; these tests set one,
  // except the test that checks that refusal. Sign-in is on here whatever the environment says:
  // with it off, write-back is refused unless a dev opt-in is set, and a developer's server/.env
  // has sign-in off. write-gate.test.ts covers that.
  let savedToken: string;
  let savedAuth: boolean;
  beforeEach(async () => {
    const { config } = await import('../core/config.js');
    savedToken = config.zbxWriteToken;
    savedAuth = config.auth.enabled;
    config.zbxWriteToken = 'test-only-not-a-real-token';
    config.auth.enabled = true;
  });
  afterEach(async () => {
    const { config } = await import('../core/config.js');
    config.zbxWriteToken = savedToken;
    config.auth.enabled = savedAuth;
  });

  it('rejects a request with no eventids', async () => {
    const { actionRoutes } = await import('../routes/actions.js');
    const app = await buildTestApp(actionRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/problems/acknowledge',
      payload: { eventids: [], message: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(zbxWriteMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a no-op action bitmask', async () => {
    // Everything explicitly off and no message: nothing to do must be a 400,
    // not a silent success that writes an empty acknowledgement to Zabbix.
    const { actionRoutes } = await import('../routes/actions.js');
    const app = await buildTestApp(actionRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/problems/acknowledge',
      payload: { eventids: ['1'], acknowledge: false, close: false, message: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(zbxWriteMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('defaults to acknowledging when only eventids are given', async () => {
    zbxWriteMock.mockResolvedValue({ eventids: ['109'] });
    const { actionRoutes } = await import('../routes/actions.js');
    const app = await buildTestApp(actionRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/problems/acknowledge',
      payload: { eventids: ['109'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, eventids: ['109'] });
    await app.close();
  });

  it('truncates an over-long message rather than sending it to Zabbix', async () => {
    zbxWriteMock.mockResolvedValue({ eventids: ['109'] });
    const { actionRoutes } = await import('../routes/actions.js');
    const app = await buildTestApp(actionRoutes);

    await app.inject({
      method: 'POST',
      url: '/api/problems/acknowledge',
      payload: { eventids: ['109'], message: 'x'.repeat(5000) },
    });
    const sent = zbxWriteMock.mock.calls[0]?.[1] as { message?: string };
    expect(sent.message!.length).toBeLessThanOrEqual(2048);
    await app.close();
  });

  it('maps a write attempted with no write token to 503, not 500', async () => {
    // Blank ZABBIX_WRITE_TOKEN means the portal is read-only by design. The UI
    // reads this code to hide the button rather than offering a failing one.
    const { config } = await import('../core/config.js');
    config.zbxWriteToken = '';
    const { actionRoutes } = await import('../routes/actions.js');
    const app = await buildTestApp(actionRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/problems/acknowledge',
      payload: { eventids: ['109'], message: 'checking', acknowledge: true },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('zabbix_write_disabled');
    expect(zbxWriteMock).not.toHaveBeenCalled();
    await app.close();
  });
});


describe('upstream failure modes', () => {
  it('maps a rejected Zabbix token to 503 zabbix_auth', async () => {
    zbxMock.mockRejectedValue(new ZabbixAuthError('token revoked'));
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);

    const res = await app.inject({ url: '/api/hosts' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('zabbix_auth');
    await app.close();
  });

  it('maps an unresponsive Zabbix to 503 zabbix_timeout', async () => {
    zbxMock.mockRejectedValue(new ZabbixTimeoutError('no answer in 10000 ms'));
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);

    const res = await app.inject({ url: '/api/hosts' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('zabbix_timeout');
    await app.close();
  });

  it('still returns 500 for a genuine bug', async () => {
    // The typed 503s must not swallow real faults into a reassuring message.
    zbxMock.mockRejectedValue(new TypeError('cannot read property of undefined'));
    const { hostRoutes } = await import('../routes/hosts.js');
    const app = await buildTestApp(hostRoutes);

    expect((await app.inject({ url: '/api/hosts' })).statusCode).toBe(500);
    await app.close();
  });
});

describe('problem counts', () => {
  /**
   * `problem.get` with `recent: true` also returns problems Zabbix resolved a
   * moment ago. The list keeps them (marked Resolved); every count must not.
   */
  it('count only open problems outside maintenance, while /api/problems still lists the others', async () => {
    const onHost = [{ hostid: '10689', name: '1.2.1 IDX02CORESWITCH' }];
    zabbixReturns({
      'host.get': [zHost()],
      'hostgroup.get': [{ groupid: '1', name: 'Core', hosts: [{ hostid: '10689' }] }],
      'problem.get': [
        zProblem({ eventid: '201', objectid: '1', object: '0', severity: '4', r_eventid: '0' }),
        zProblem({ eventid: '202', objectid: '2', object: '0', severity: '5', r_eventid: '203' }),
        // Open, but inside a planned maintenance window.
        zProblem({ eventid: '204', objectid: '1', object: '0', severity: '3', r_eventid: '0', suppressed: '1' }),
      ],
      'trigger.get': [
        { triggerid: '1', hosts: onHost },
        { triggerid: '2', hosts: onHost },
      ],
      'map.get': [
        {
          sysmapid: '2',
          links: [],
          selements: [{ selementid: '5', elementtype: '0', label: 'core', elements: [{ hostid: '10689' }] }],
        },
      ],
    });
    const { problemRoutes } = await import('../routes/problems.js');
    const { reportRoutes } = await import('../routes/reports.js');
    const { hostRoutes } = await import('../routes/hosts.js');
    const { siteRoutes } = await import('../routes/sites.js');
    const { mapRoutes } = await import('../routes/maps.js');
    const { analyticsRoutes } = await import('../routes/analytics.js');
    const app = await buildTestApp(problemRoutes, reportRoutes, hostRoutes, siteRoutes, mapRoutes, analyticsRoutes);
    const get = async (url: string) => (await app.inject({ url })).json();

    expect(await get('/api/problems')).toHaveLength(3);
    expect(await get('/api/stats')).toMatchObject({ problems: 1, unacknowledged: 1, bySeverity: { '4': 1 } });
    expect((await get('/api/stats')).bySeverity).not.toHaveProperty('5');
    expect((await get('/api/stats')).bySeverity).not.toHaveProperty('3');
    expect(await get('/api/reports/problems-by-group')).toEqual([
      { groupid: '1', name: 'Core', total: 1, bySeverity: { '4': 1 } },
    ]);
    expect((await get('/api/hosts/overview'))[0].problems).toEqual({ total: 1, bySeverity: { '4': 1 } });
    expect((await get('/api/sites')).sites[0]).toMatchObject({ problems: 1, unacknowledged: 1, worst: 4 });
    expect((await get('/api/maps/detail?mapid=2'))[0].selements[0]).toMatchObject({ problems: 1, maxSeverity: 4 });
    expect(await get('/api/reports/aging')).toMatchObject({ total: 1, unacknowledged: 1 });
    await app.close();
  });
});
