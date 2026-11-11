import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * The reads made lighter for HCML's Zabbix (29 October 2026), where one item's last value costs 57 to 88 ms
 * and the problem list with operational data 35 to 46 s: what each read asks for, and how often.
 */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

beforeEach(async () => {
  (await import('../core/cache.js')).invalidate('');
  zbxMock.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

const calls = (method: string) => zbxMock.mock.calls.filter(([m]) => m === method).map(([, params]) => params as Record<string, unknown>);

describe('the problem list', () => {
  const problem = (eventid: string, objectid: string) => ({ eventid, objectid, object: '0', name: `p${eventid}`, severity: '3', clock: '1', acknowledged: '0' });
  const trigger = (triggerid: string, hostid: string) => ({ triggerid, manual_close: '0', hosts: [{ hostid, name: `host ${hostid}` }] });

  it('asks for every field the screens use and never for opdata, which Zabbix fills one problem at a time', async () => {
    zbxMock.mockImplementation(async (method: string) => (method === 'problem.get' ? [problem('1', '10')] : [trigger('10', '7')]));
    const { getProblems, PROBLEM_FIELDS } = await import('../domain/queries.js');
    const [p] = await getProblems();
    expect(p).toMatchObject({ eventid: '1', host: 'host 7', hostid: '7' });
    const [params] = calls('problem.get');
    expect(params.output).toEqual(PROBLEM_FIELDS);
    expect(PROBLEM_FIELDS).not.toContain('opdata');
    expect(PROBLEM_FIELDS).toEqual(expect.arrayContaining(['eventid', 'objectid', 'object', 'name', 'severity', 'clock', 'acknowledged', 'suppressed', 'r_eventid']));
  });

  it('names the host of a trigger once, and asks again only for triggers it has not seen', async () => {
    let problems = [problem('1', '10'), problem('2', '20')];
    zbxMock.mockImplementation(async (method: string, params: { triggerids?: string[] }) =>
      method === 'problem.get' ? problems : (params.triggerids ?? []).map((id) => trigger(id, id.slice(0, 1))),
    );
    const { getProblems } = await import('../domain/queries.js');
    await getProblems();
    await getProblems();
    expect(calls('trigger.get')).toHaveLength(1);

    problems = [...problems, problem('3', '30')];
    const list = await getProblems();
    expect(calls('trigger.get').map((p) => p.triggerids)).toEqual([['10', '20'], ['30']]);
    expect(list.find((p) => p.eventid === '3')).toMatchObject({ host: 'host 3', hostid: '3' });
  });

  it('names the hosts again in the background after an hour, answering at once with the names it holds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    zbxMock.mockImplementation(async (method: string, params: { triggerids?: string[] }) =>
      method === 'problem.get' ? [problem('1', '10')] : (params.triggerids ?? []).map((id) => trigger(id, '7')),
    );
    const { getProblems, TRIGGER_HOST_TTL_MS } = await import('../domain/queries.js');
    await getProblems();
    vi.setSystemTime(Date.now() + TRIGGER_HOST_TTL_MS + 1);
    const [p] = await getProblems();
    expect(p.host).toBe('host 7');
    await vi.waitFor(() => expect(calls('trigger.get')).toHaveLength(2));
  });

  it('reads opdata only for the problems asked about, and answers without it when that read fails', async () => {
    const { withOpdata } = await import('../domain/queries.js');
    zbxMock.mockResolvedValue([{ eventid: '2', opdata: 'Loss: 40 %' }]);
    const list = [problem('1', '10'), problem('2', '20')];
    expect((await withOpdata(list)).map((p) => p.opdata)).toEqual(['', 'Loss: 40 %']);
    expect(calls('problem.get')).toEqual([{ eventids: ['1', '2'], output: ['eventid', 'opdata'], recent: true }]);

    zbxMock.mockRejectedValue(new Error('Zabbix did not respond'));
    expect(await withOpdata(list)).toEqual(list);
    expect(await withOpdata([])).toEqual([]);
  });

  it('is read by the live stream at the pace it is cached', async () => {
    const { PROBLEMS_TTL_MS } = await import('../domain/queries.js');
    const { TICK_MS } = await import('../services/stream.js');
    expect(TICK_MS).toBe(PROBLEMS_TTL_MS);
    expect(PROBLEMS_TTL_MS).toBe(15_000);
  });
});

describe('recentValues', () => {
  it('reads each value type once over the window and keeps each item’s newest value', async () => {
    zbxMock.mockImplementation(async (_method: string, params: { history: number }) =>
      params.history === 3
        ? [
            { itemid: 'a', clock: '100', value: '0' },
            { itemid: 'a', clock: '160', value: '1' },
          ]
        : [{ itemid: 'b', clock: '150', value: '0.25' }],
    );
    const { recentValues } = await import('../domain/recentValues.js');
    const values = await recentValues(
      [
        { itemid: 'a', value_type: '3' },
        { itemid: 'b', value_type: '0' },
        { itemid: 'c', value_type: '3' },
      ],
      900,
      1_000,
    );
    expect(values.get('a')).toEqual({ value: '1', clock: '160' });
    expect(values.get('b')).toEqual({ value: '0.25', clock: '150' });
    expect(values.has('c')).toBe(false);
    expect(calls('history.get')).toEqual([
      { history: 3, itemids: ['a', 'c'], time_from: 100, output: ['itemid', 'clock', 'value'] },
      { history: 0, itemids: ['b'], time_from: 100, output: ['itemid', 'clock', 'value'] },
    ]);
  });

  it('asks Zabbix nothing for no items', async () => {
    const { recentValues } = await import('../domain/recentValues.js');
    expect((await recentValues([], 900)).size).toBe(0);
    expect(zbxMock).not.toHaveBeenCalled();
  });
});

describe('a slow view answered from its last copy', () => {
  async function serve(read: () => Promise<unknown>) {
    const { registerStaleHeaders } = await import('../core/staleness.js');
    const app = Fastify({ logger: false });
    registerStaleHeaders(app);
    app.get('/view', read);
    return app;
  }

  it('says how old the copy is, with X-Data-Refreshing and no X-Data-Stale, while one refresh runs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { cached, SLOW_VIEW } = await import('../core/cache.js');
    let version = 0;
    const app = await serve(() => cached('view', 30_000, async () => ({ version: ++version }), SLOW_VIEW));

    const live = await app.inject({ url: '/view' });
    expect(live.headers['x-data-refreshing']).toBeUndefined();

    vi.setSystemTime(Date.now() + 90_000);
    const old = await app.inject({ url: '/view' });
    expect(old.json()).toEqual({ version: 1 });
    expect(old.headers['x-data-refreshing']).toBe('true');
    expect(old.headers['x-data-age-seconds']).toBe('90');
    expect(old.headers['x-data-stale']).toBeUndefined();

    await vi.waitFor(async () => expect((await app.inject({ url: '/view' })).json()).toEqual({ version: 2 }));
    await app.close();
  });

  it('marks nothing for an entry that does not ask for it, like the counts kept a day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { cached } = await import('../core/cache.js');
    const app = await serve(() => cached('quiet', 30_000, async () => ({ n: 1 }), { staleMs: 60_000 }));
    await app.inject({ url: '/view' });
    vi.setSystemTime(Date.now() + 45_000);
    const old = await app.inject({ url: '/view' });
    expect(old.headers['x-data-refreshing']).toBeUndefined();
    expect(old.headers['x-data-age-seconds']).toBeUndefined();
    await app.close();
  });

  it('reports a failed fetch over a refreshing copy, when one request saw both', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { cached, SLOW_VIEW } = await import('../core/cache.js');
    let fail = false;
    const app = await serve(async () => ({
      a: await cached('a', 30_000, async () => 'a', SLOW_VIEW),
      b: await cached('b', 30_000, async () => {
        if (fail) throw new Error('Zabbix did not respond');
        return 'b';
      }, { staleIfError: true }),
    }));
    await app.inject({ url: '/view' });
    fail = true;
    vi.setSystemTime(Date.now() + 40_000);
    const both = await app.inject({ url: '/view' });
    expect(both.headers['x-data-stale']).toBe('true');
    expect(both.headers['x-data-refreshing']).toBeUndefined();
    await app.close();
  });
});

describe('the warm-up after a start', () => {
  it('reads each view once, in order, and goes on past one that fails', async () => {
    const { warmUp } = await import('../services/warmUp.js');
    const order: string[] = [];
    const log = { info: vi.fn(), warn: vi.fn() };
    await warmUp(log, [
      ['first', async () => order.push('first')],
      ['broken', async () => Promise.reject(new Error('Zabbix did not respond'))],
      ['last', async () => order.push('last')],
    ]);
    expect(order).toEqual(['first', 'last']);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ view: 'broken', reason: 'Zabbix did not respond' }), expect.any(String));
    expect(log.info).toHaveBeenLastCalledWith(expect.objectContaining({ ms: expect.any(Number) }), 'warm-up: done');
  });

  it('covers the slow views, problems first and the Capacity report last', async () => {
    const { WARM_UP } = await import('../services/warmUp.js');
    const names = WARM_UP.map(([name]) => name);
    expect(names[0]).toBe('problems');
    expect(names.at(-1)).toBe('capacity');
    expect(names).toEqual(expect.arrayContaining(['dashboard counts', 'freshness', 'sites', 'links', 'devices', 'meters']));
  });
});

describe('the Capacity report', () => {
  it('keeps a run an hour, then shows it for up to a day while the next is built', async () => {
    const { CAPACITY_STALE_MS, CAPACITY_TTL } = await import('../services/reportPolicy.js');
    expect(CAPACITY_TTL).toBe(60 * 60_000);
    expect(CAPACITY_TTL + CAPACITY_STALE_MS).toBe(24 * 60 * 60_000);
  });

  it('reads the ports’ link speeds once a day, not on every run', async () => {
    zbxMock.mockImplementation(async (method: string) => (method === 'trend.get' || method === 'history.get' ? [] : []));
    const { getCapacityReport } = await import('../services/capacity.js');
    const { invalidate } = await import('../core/cache.js');
    await getCapacityReport(7, 10);
    invalidate('capacity:7:');
    await getCapacityReport(7, 10);
    const speedReads = calls('item.get').filter((p) => (p.search as { key_?: string } | undefined)?.key_ === 'net.if.speed[');
    const trafficReads = calls('item.get').filter((p) => (p.search as { key_?: string } | undefined)?.key_ === 'net.if.in[');
    expect(trafficReads).toHaveLength(2);
    expect(speedReads).toHaveLength(1);
  });
});
