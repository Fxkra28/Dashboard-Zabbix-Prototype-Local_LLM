import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pingZabbix } from './helpers/pingZabbix.js';
import { buildTestApp } from './helpers/app.js';

/**
 * The endpoints behind the derived SLA, the derived service tree, and the
 * report fixes that came with them. Zabbix is mocked per method, as in
 * routes.test.ts; the AI layer is mocked so a test can prove it was not asked.
 */

const { zbxMock, humanizeMock } = vi.hoisted(() => ({ zbxMock: vi.fn(), humanizeMock: vi.fn() }));

vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});
vi.mock('../clients/ai.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/ai.js')>();
  return { ...actual, humanize: humanizeMock };
});

// The parameters of a Zabbix call, which the fixture reads by whatever names the call used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = Record<string, any>;
const AUG = { from: 1785517200, to: 1788195600 };
/** The fake clock set in beforeEach: 2026-09-17T03:00:00Z. */
const NOW = Date.parse('2026-09-17T03:00:00Z') / 1000;

const trig = (triggerid: string, hostid: string, name: string, description = 'High ICMP ping loss') => ({
  triggerid,
  description,
  value: '0',
  lastchange: String(AUG.from - 86400),
  status: '0',
  hosts: [{ hostid, name, status: '0' }],
});

/** A small estate: a Jakarta switch, a paired WAN path at Sampang, a web host. */
function estate(over: Record<string, (p: Params) => unknown> = {}) {
  const triggers = [
    trig('1', '101', '1.2.1 IDX02CORESWITCH'),
    trig('2', '102', 'INET : SAMPANG WAN 1'),
    trig('3', '103', 'INET : SAMPANG WAN 2'),
    trig('4', '104', 'WEB : PORTAL'),
  ];
  const parents: Record<string, string[]> = { '101': ['Cisco IOS by SNMP'], '102': ['ICMP Ping'], '103': ['ICMP Ping'], '104': ['ICMP Ping'] };
  zbxMock.mockImplementation(async (method: string, p: Params) => {
    if (over[method]) return over[method](p);
    switch (method) {
      case 'trigger.get':
        return p.filter?.description ? triggers.filter((t) => p.filter.description.includes(t.description)) : [];
      case 'host.get':
        return p.filter ? [] : (p.hostids ?? []).map((hostid: string) => ({ hostid, parentTemplates: parents[hostid].map((name) => ({ name })) }));
      case 'event.get':
        return p.objectids?.includes('1') && p.time_from <= AUG.from + 3600 && p.time_till >= AUG.from + 7200
          ? [
              { eventid: 'a', objectid: '1', clock: String(AUG.from + 3600), value: '1' },
              { eventid: 'b', objectid: '1', clock: String(AUG.from + 7200), value: '0' },
            ]
          : [];
      case 'service.get':
        return p.countOutput ? '0' : [];
      default:
        return [];
    }
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-17T03:00:00Z'));
  const { config } = await import('../core/config.js');
  config.ai.enabled = true;
});
afterEach(() => {
  vi.useRealTimers();
  zbxMock.mockReset();
  humanizeMock.mockReset();
});

describe('GET /api/sli', () => {
  it('rejects a malformed month, an unknown profile and a month that has not started', async () => {
    estate();
    const { sliRoutes } = await import('../routes/sli.js');
    const app = await buildTestApp(sliRoutes);
    for (const url of ['/api/sli?month=2026-13', '/api/sli?month=2026-08&profile=best', '/api/sli?month=2099-01']) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(400);
      expect(res.json(), url).toMatchObject({ error: 'bad_request' });
    }
    await app.close();
  });

  it('returns the derived report for a month', async () => {
    estate();
    const { sliRoutes } = await import('../routes/sli.js');
    const app = await buildTestApp(sliRoutes);
    const body = (await app.inject({ url: '/api/sli?month=2026-08&profile=hcml-report' })).json();
    expect(body).toMatchObject({ source: 'derived', profile: 'hcml-report', month: '2026-08', closed: true, target: 99 });
    expect(body.hosts).toHaveLength(4);
    expect(body.wanPaths).toEqual([expect.objectContaining({ name: 'SAMPANG', legs: expect.any(Array) })]);
    expect(body.wanPaths[0].legs).toHaveLength(2);
    expect(body.hosts.every((h: { measured: boolean }) => h.measured === true)).toBe(true);
    await app.close();
  });

  it('marks a host whose ICMP never collected as not measured, still 100 % by HCML’s method', async () => {
    estate({
      'item.get': () => [
        { itemid: '9', hostid: '102', key_: 'icmpping', delay: '1m', value_type: '3', state: '1', lastclock: '0' },
        { itemid: '10', hostid: '101', key_: 'icmpping', delay: '1m', value_type: '3', state: '0', lastclock: '1789000000' },
      ],
    });
    const { sliRoutes } = await import('../routes/sli.js');
    const app = await buildTestApp(sliRoutes);
    const body = (await app.inject({ url: '/api/sli?month=2026-08&profile=hcml-report' })).json();
    const byId = Object.fromEntries(body.hosts.map((h: { hostid: string }) => [h.hostid, h]));
    expect(byId['102']).toMatchObject({ measured: false, sli: 100 });
    expect(byId['101'].measured).toBe(true);
    expect(byId['103'].measured).toBe(true);
    await app.close();
  });
});

describe('GET /api/services/derived and /api/sla/source', () => {
  it('builds estate → business services and sites → device classes → hosts, with WAN legs paired', async () => {
    estate();
    const { serviceRoutes } = await import('../routes/services.js');
    const app = await buildTestApp(serviceRoutes);
    const body = (await app.inject({ url: '/api/services/derived?month=2026-08&profile=hcml-report' })).json();

    expect(body).toMatchObject({ source: 'derived', month: '2026-08' });
    const [root] = body.tree;
    expect(root.name).toBe('HCML estate');
    const names = root.children.map((c: { name: string }) => c.name);
    expect(names).toEqual(['Business services', '1 · Jakarta', '3 · SSB / Sampang']);

    const business = root.children[0];
    expect(business.children.map((c: { name: string }) => c.name)).toEqual(['WEB : PORTAL']);

    const sampang = root.children[2];
    const wan = sampang.children.find((c: { name: string }) => c.name === 'WAN links');
    expect(wan.children).toEqual([expect.objectContaining({ kind: 'wan-path', name: 'WAN path: SAMPANG' })]);
    expect(wan.children[0].children).toHaveLength(2);

    const jakarta = root.children[1];
    const sw = jakarta.children[0].children[0];
    expect(sw).toMatchObject({ kind: 'host', hostid: '101' });
    expect(sw.sla.sli).toBeLessThan(100);
    await app.close();
  });

  it('says Zabbix’s own SLAs are not real when no services exist', async () => {
    estate({ 'sla.get': () => [{ slaid: '2', name: 'SLA:1', slo: '99', period: '1', status: '1' }] });
    const { slaRoutes } = await import('../routes/sla.js');
    const app = await buildTestApp(slaRoutes);
    expect((await app.inject({ url: '/api/sla/source' })).json()).toEqual({ real: false, slas: 1, services: 0 });
    await app.close();
  });
});

describe('GET /api/explain/sla', () => {
  it('answers "no data" for an SLA with no services, without asking the model', async () => {
    // Asked about an empty list, the model would announce "met its availability target".
    estate({
      'sla.get': () => [{ slaid: '2', name: 'SLA:1', slo: '99', period: '1', status: '1' }],
      'sla.getsli': () => ({ periods: [], serviceids: [], sli: [] }),
    });
    const { explainRoutes } = await import('../routes/explain.js');
    const app = await buildTestApp(explainRoutes);
    const res = await app.inject({ url: '/api/explain/sla?slaid=2' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'No data', noData: true, meetingTarget: false });
    expect(humanizeMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('explains a derived scope without an slaid, and still refuses to explain one with no data', async () => {
    estate();
    humanizeMock.mockResolvedValue({ status: 'On target', plain: '…', meetingTarget: true, recommendation: '…' });
    const { explainRoutes } = await import('../routes/explain.js');
    const app = await buildTestApp(explainRoutes);

    const ok = await app.inject({ url: '/api/explain/sla?source=derived&month=2026-08&profile=hcml-report&scope=overall' });
    expect(ok.statusCode).toBe(200);
    expect(humanizeMock).toHaveBeenCalledTimes(1);
    expect(humanizeMock.mock.calls[0][1]).toMatchObject({ slo_target_percent: 99, devices_measured: 4 });

    // Strict profile: nothing collected at all → no figure → no model call.
    const none = await app.inject({ url: '/api/explain/sla?source=derived&month=2026-08&profile=availability&scope=overall' });
    expect(none.json()).toMatchObject({ noData: true });
    expect(humanizeMock).toHaveBeenCalledTimes(1);

    expect((await app.inject({ url: '/api/explain/sla?source=derived&month=2026-08&scope=site:77' })).statusCode).toBe(404);
    await app.close();
  });
});

describe('explain caching and facts', () => {
  it('explains a problem again once it is acknowledged, instead of repeating "not acknowledged" for an hour', async () => {
    const { invalidate } = await import('../core/cache.js');
    invalidate(''); // tests in this file share one cache
    let acknowledged = '0';
    estate({
      'problem.get': () => [
        { eventid: '900', object: '0', objectid: '1', name: 'Unavailable by ICMP ping', severity: '4', clock: String(AUG.from), acknowledged, r_eventid: '0', opdata: '', tags: [] },
      ],
    });
    humanizeMock.mockResolvedValue({ summary: '…' });
    const { explainRoutes } = await import('../routes/explain.js');
    const app = await buildTestApp(explainRoutes);

    expect((await app.inject({ url: '/api/explain/problem?eventid=900' })).statusCode).toBe(200);
    await app.inject({ url: '/api/explain/problem?eventid=900' }); // same state: answered from cache
    expect(humanizeMock).toHaveBeenCalledTimes(1);
    expect(humanizeMock.mock.calls[0][1]).toMatchObject({ acknowledged: false, resolved: false });

    acknowledged = '1';
    invalidate('problems'); // what the portal's acknowledge does
    await app.inject({ url: '/api/explain/problem?eventid=900' });
    expect(humanizeMock).toHaveBeenCalledTimes(2);
    expect(humanizeMock.mock.calls[1][1]).toMatchObject({ acknowledged: true });
    await app.close();
  });

  it('tells the model how many devices were never measured, next to the figure they inflate', async () => {
    const { invalidate } = await import('../core/cache.js');
    invalidate('');
    const icmp = (hostid: string, state: string, lastclock: string) =>
      ['icmpping', 'icmppingloss', 'icmppingsec'].map((key_) => ({ itemid: `${hostid}${key_}`, hostid, key_, delay: '1m', value_type: '3', state, lastclock }));
    estate({
      'item.get': (p) =>
        p.search?.key_ === 'icmpping'
          ? [...icmp('101', '0', String(AUG.to - 60)), ...icmp('102', '1', '0'), ...icmp('103', '0', String(AUG.to - 60)), ...icmp('104', '0', String(AUG.to - 60))]
          : [],
    });
    humanizeMock.mockResolvedValue({ status: 'On target', plain: '…', meetingTarget: true, recommendation: '…' });
    const { explainRoutes } = await import('../routes/explain.js');
    const app = await buildTestApp(explainRoutes);

    const res = await app.inject({ url: '/api/explain/sla?source=derived&month=2026-08&profile=hcml-report&scope=overall' });
    expect(res.statusCode).toBe(200);
    expect(humanizeMock.mock.calls[0][1]).toMatchObject({ devices_never_measured: 1 });
    await app.close();
  });
});

describe('GET /api/links', () => {
  it('reports a link that has never collected as unknown, not down, and pairs WAN legs by name', async () => {
    zbxMock.mockImplementation(
      pingZabbix([
        // Never polled: Zabbix says lastvalue "0", lastclock "0".
        { itemid: '1', name: 'ICMP ping', key_: 'icmpping', lastvalue: '0', lastclock: '0', state: '1', value_type: '3', hosts: [{ hostid: '102', name: 'INET : SAMPANG WAN 1' }] },
        { itemid: '2', name: 'ICMP ping', key_: 'icmpping', lastvalue: '1', lastclock: String(NOW - 30), state: '0', delay: '1m', value_type: '3', hosts: [{ hostid: '103', name: 'INET : SAMPANG WAN 2' }] },
      ]),
    );
    const { linkRoutes } = await import('../routes/links.js');
    const app = await buildTestApp(linkRoutes);
    const body = (await app.inject({ url: '/api/links' })).json();

    expect(body.summary).toMatchObject({ total: 2, up: 1, down: 0, unknown: 1 });
    expect(body.paths).toEqual([expect.objectContaining({ name: 'SAMPANG' })]);
    expect(body.paths[0].links.map((l: { role: string }) => l.role).sort()).toEqual(['WAN 1', 'WAN 2']);
    await app.close();
  });

  it('treats a value hours old as unknown, not as the link\'s current state', async () => {
    // A supported item whose poller stopped: lastvalue "0" from 3 h ago would read as down.
    zbxMock.mockImplementation(
      pingZabbix([
        { itemid: '3', name: 'ICMP ping', key_: 'icmpping', lastvalue: '0', lastclock: String(NOW - 3 * 3600), state: '0', delay: '1m', value_type: '3', hosts: [{ hostid: '104', name: 'INET : SAMPANG WAN 3' }] },
      ]),
    );
    const { linkRoutes } = await import('../routes/links.js');
    const app = await buildTestApp(linkRoutes);
    const body = (await app.inject({ url: '/api/links' })).json();
    expect(body.summary).toMatchObject({ total: 1, down: 0, unknown: 1 });
    await app.close();
  });
});

describe('analytics fixes', () => {
  it('serves availability through the engine by default, never truncated, keeping the legacy keys', async () => {
    estate();
    const { analyticsRoutes } = await import('../routes/analytics.js');
    const app = await buildTestApp(analyticsRoutes);
    const body = (await app.inject({ url: '/api/reports/availability?month=2026-08&profile=hcml-report' })).json();
    expect(body).toMatchObject({ basis: 'availability', truncated: false, month: '2026-08', target: 99 });
    for (const key of ['from', 'to', 'windowSeconds', 'minSeverity', 'hosts']) expect(body).toHaveProperty(key);
    expect(body.hosts[0]).toMatchObject({ hostid: expect.any(String), host: expect.any(String), availability: expect.any(Number) });

    // Strict profile with nothing collected: no figure, not 0%.
    const strict = (await app.inject({ url: '/api/reports/availability?month=2026-08&profile=availability' })).json();
    expect(strict.hosts.every((h: { availability: number | null }) => h.availability === null)).toBe(true);

    expect((await app.inject({ url: '/api/reports/availability?basis=nonsense' })).statusCode).toBe(400);
    await app.close();
  });

  it('fetches noise events in slices rather than one silently capped page', async () => {
    estate();
    const { analyticsRoutes } = await import('../routes/analytics.js');
    const app = await buildTestApp(analyticsRoutes);
    expect((await app.inject({ url: '/api/reports/noise?days=30' })).json().truncated).toBe(false);
    const eventCalls = zbxMock.mock.calls.filter(([m]) => m === 'event.get');
    expect(eventCalls.length).toBeGreaterThan(0);
    for (const [, p] of eventCalls) {
      expect(p.limit).not.toBe(10_000);
      expect(p.sortorder).toBe('ASC');
    }
    await app.close();
  });

  it('recognises the SNMP capacity keys HCML’s devices actually use', async () => {
    const { capacityMetricFor } = await import('../services/capacity.js');
    expect(capacityMetricFor('system.cpu.util[cpmCPUTotal5minRev.19]')).toBe('cpu');
    expect(capacityMetricFor('system.cpu.util[fgSysCpuUsage.0]')).toBe('cpu');
    expect(capacityMetricFor('system.cpu.util')).toBe('cpu');
    expect(capacityMetricFor('system.cpu.util[,idle]')).toBeUndefined();
    expect(capacityMetricFor('vm.memory.util[vm.memory.util.1]')).toBe('memory');
    expect(capacityMetricFor('vm.memory.util[memoryUsedPercentage.0]')).toBe('memory');
    expect(capacityMetricFor('vfs.fs.pfree')).toBe('disk');
  });
});

describe('the verdict of an SLA explanation is the server\'s own comparison, whatever the model says (BK-33)', () => {
  // The service functions are called as they are, not through the route: its per-minute allowance counts real time.
  const derived = async () => {
    const { explainDerivedSla } = await import('../services/explain.js');
    return explainDerivedSla({ month: '2026-08', profile: 'hcml-report', scope: 'site:1' }, () => undefined);
  };
  const zabbixSla = async () => {
    const { explainZabbixSla } = await import('../services/explain.js');
    return explainZabbixSla('2', undefined, () => undefined);
  };

  it('turns a model\'s "on target" into a miss, in its words as well as its colour, when the figure is under the target', async () => {
    const { invalidate } = await import('../core/cache.js');
    const { config } = await import('../core/config.js');
    invalidate('');
    estate();
    const target = config.sla.target;
    config.sla.target = 99.99; // the switch lost an hour of 744, so its figure is about 99.87
    humanizeMock.mockResolvedValue({ status: 'On target', plain: 'Met.', meetingTarget: true, recommendation: 'Nothing.' });
    try {
      const answer = await derived();
      // The verdict is the server's, and so are the words about it: the model's "Met." is about a result that is not this one.
      expect(answer).toMatchObject({ status: 'Below the target', meetingTarget: false });
      expect((answer as { plain: string }).plain).toMatch(/99\.8\d* %.*target of 99\.99 %/);
      expect(JSON.stringify(answer)).not.toContain('Met.');
      expect(JSON.stringify(answer)).not.toContain('Nothing.');
    } finally {
      config.sla.target = target;
      invalidate('');
    }
  });

  it('writes a figure that is a hair under the target as under it, not rounded up to the target (BK-56)', async () => {
    const { invalidate } = await import('../core/cache.js');
    const { config } = await import('../core/config.js');
    invalidate('');
    estate();
    const target = config.sla.target;
    // One hour lost of 744 is 99.8655914 %, which three decimals would round to 99.866, the target itself.
    config.sla.target = 99.866;
    humanizeMock.mockResolvedValue({ status: 'On target', plain: 'Met.', meetingTarget: true, recommendation: 'Nothing.' });
    try {
      const answer = await derived();
      expect(answer).toMatchObject({ status: 'Below the target', meetingTarget: false });
      expect((answer as { plain: string }).plain).toMatch(/99\.865 %.*target of 99\.866 %/);
      expect((answer as { plain: string }).plain).not.toMatch(/99\.866 %.*target of 99\.866 %/);
    } finally {
      config.sla.target = target;
      invalidate('');
    }
  });

  it('turns a model\'s "missed" into a pass when the figure is at the target or over it', async () => {
    const { invalidate } = await import('../core/cache.js');
    invalidate('');
    estate();
    humanizeMock.mockResolvedValue({ status: 'Missed', plain: 'Short.', meetingTarget: false, recommendation: 'Look.' });
    const answer = await derived();
    expect(answer).toMatchObject({ status: 'On target', meetingTarget: true });
    expect(JSON.stringify(answer)).not.toContain('Short.');
    expect(JSON.stringify(answer)).not.toContain('Missed');
    invalidate('');
  });

  it('keeps the model\'s explanation and advice when it agrees with the figure, but the pill\'s words are the server\'s', async () => {
    const { invalidate } = await import('../core/cache.js');
    invalidate('');
    estate();
    humanizeMock.mockResolvedValue({ status: 'Comfortably on target', plain: 'Up nearly all month.', meetingTarget: true, recommendation: 'Keep watching it.' });
    expect(await derived()).toEqual({ status: 'On target', plain: 'Up nearly all month.', meetingTarget: true, recommendation: 'Keep watching it.' });
    invalidate('');
  });

  it('does not show a word the model made up for the status, as a small local model did on HCML\'s data ("success" beside a missed target)', async () => {
    const { invalidate } = await import('../core/cache.js');
    const { config } = await import('../core/config.js');
    invalidate('');
    estate();
    const target = config.sla.target;
    config.sla.target = 99.99;
    humanizeMock.mockResolvedValue({ status: 'success', plain: 'The target was not met.', meetingTarget: false, recommendation: 'Look at the worst devices.' });
    try {
      expect(await derived()).toEqual({ status: 'Below the target', plain: 'The target was not met.', meetingTarget: false, recommendation: 'Look at the worst devices.' });
    } finally {
      config.sla.target = target;
      invalidate('');
    }
  });

  it('writes the lowest service of one of Zabbix\'s own SLAs as under its objective when a hair under it, not rounded up to it (BK-56)', async () => {
    const { invalidate } = await import('../core/cache.js');
    invalidate('');
    estate({
      'sla.get': () => [{ slaid: '2', name: 'SLA:1', slo: '98.9', period: '1', status: '1' }],
      'sla.getsli': () => ({
        periods: [{ period_from: 1, period_to: 2 }],
        serviceids: [10],
        sli: [[{ uptime: 100, downtime: 1, sli: 98.8996, error_budget: 0 }]],
      }),
      'service.get': () => [{ serviceid: '10', name: 'A' }],
    });
    humanizeMock.mockResolvedValue({ status: 'On target', plain: 'Met.', meetingTarget: true, recommendation: 'Nothing.' });
    const missed = await zabbixSla();
    expect(missed).toMatchObject({ status: 'Below the target', meetingTarget: false });
    // Three decimals would round 98.8996 to 98.9, the objective itself.
    expect((missed as { plain: string }).plain).toMatch(/lowest service is at 98\.899 % against a target of 98\.9 %/);
    invalidate('');
  });

  it('does the same for one of Zabbix\'s own SLAs: met only when every service is at or over its objective', async () => {
    const { invalidate } = await import('../core/cache.js');
    invalidate('');
    const sli = (rows: { sli: number }[]) => ({
      periods: [{ period_from: 1, period_to: 2 }],
      serviceids: rows.map((_, i) => 10 + i),
      sli: [rows.map((r) => ({ uptime: 100, downtime: 1, sli: r.sli, error_budget: 0 }))],
    });
    let rows = [{ sli: 98.5 }, { sli: 100 }];
    estate({
      'sla.get': () => [{ slaid: '2', name: 'SLA:1', slo: '99', period: '1', status: '1' }],
      'sla.getsli': () => sli(rows),
      'service.get': () => [{ serviceid: '10', name: 'A' }, { serviceid: '11', name: 'B' }],
    });
    humanizeMock.mockResolvedValue({ status: 'On target', plain: 'Met.', meetingTarget: true, recommendation: 'Nothing.' });
    const missed = await zabbixSla();
    expect(missed).toMatchObject({ status: 'Below the target', meetingTarget: false });
    expect((missed as { plain: string }).plain).toMatch(/lowest service is at 98\.5 % against a target of 99 %/);
    expect(JSON.stringify(missed)).not.toContain('Met.');

    invalidate('');
    rows = [{ sli: 99 }, { sli: 100 }];
    humanizeMock.mockResolvedValue({ status: 'Missed', plain: 'Short.', meetingTarget: false, recommendation: 'Look.' });
    const met = await zabbixSla();
    expect(met).toMatchObject({ status: 'On target', meetingTarget: true });
    expect(JSON.stringify(met)).not.toContain('Short.');
    invalidate('');
  });
});
