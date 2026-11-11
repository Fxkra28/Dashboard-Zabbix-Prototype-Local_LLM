import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp } from './helpers/app.js';
import { invalidate } from '../core/cache.js';

/** GET /api/reports/web-monitoring: every enabled web scenario as OK, failed or unknown; the Zabbix read is mocked. */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

const { webMonitoringRoutes } = await import('../routes/webMonitoring.js');

const { scenarioName } = await import('../services/webMonitoring.js');
const { ZabbixApiError } = await import('../clients/zabbix.js');

const NOW = Math.floor(Date.now() / 1000);

/** The result item of a scenario; `value` null is an item that has collected nothing. */
const result = (itemid: string, hostid: string, host: string, scenario: string, value: number | null, over: Record<string, unknown> = {}) => ({
  itemid,
  key_: `web.test.fail[${scenario}]`,
  lastvalue: value === null ? '' : String(value),
  lastclock: value === null ? '0' : String(NOW - 30),
  delay: '1m',
  state: '0',
  hosts: [{ hostid, name: host }],
  ...over,
});

function zabbix(items: ReturnType<typeof result>[]) {
  zbxMock.mockImplementation(async (method: string) => {
    if (method !== 'item.get') throw new Error(`unexpected Zabbix call ${method}`);
    return items;
  });
}
const get = async (query = '') => (await (await buildTestApp(webMonitoringRoutes)).inject({ url: `/api/reports/web-monitoring${query}` })).json();

beforeEach(() => {
  zbxMock.mockReset();
  invalidate('');
});
afterEach(() => vi.useRealTimers());

describe('GET /api/reports/web-monitoring', () => {
  it('counts the scenarios that pass, those that fail and those with no current result', async () => {
    zabbix([
      result('1', '10', 'SITE-WEB', 'Home page', 0),
      result('2', '10', 'SITE-WEB', 'Login', 0),
      result('3', '11', 'PORTAL', 'Checkout', 2),
      result('4', '12', 'OLD', 'Report', 0, { lastclock: String(NOW - 3 * 86_400) }),
      result('5', '13', 'NEW', 'Status', null),
    ]);
    const body = await get();
    expect(body).toMatchObject({ total: 5, ok: 2, failed: 1, unknown: 2 });
    expect(body.generatedAt).toBeGreaterThanOrEqual(NOW);
  });

  it('adds up: every scenario is in exactly one of the three', async () => {
    zabbix([
      result('1', '10', 'A', 'a', 0),
      result('2', '10', 'A', 'b', 3),
      result('3', '11', 'B', 'c', null),
      result('4', '11', 'B', 'd', 1),
      result('5', '12', 'C', 'e', 0, { state: '1' }),
    ]);
    const b = await get();
    expect(b.ok + b.failed + b.unknown).toBe(b.total);
    expect(b.total).toBe(5);
  });

  it('never reads an old result as OK, or as a failure: a scenario nobody has run lately is unknown', async () => {
    const old = String(NOW - 30 * 86_400);
    zabbix([result('1', '10', 'A', 'passed long ago', 0, { lastclock: old }), result('2', '10', 'A', 'failed long ago', 4, { lastclock: old })]);
    expect(await get()).toMatchObject({ total: 2, ok: 0, failed: 0, unknown: 2, failures: [] });
  });

  it('counts an item Zabbix cannot collect as unknown, whatever value it kept', async () => {
    zabbix([result('1', '10', 'A', 'broken', 0, { state: '1' })]);
    expect(await get()).toMatchObject({ ok: 0, unknown: 1 });
  });

  it('reads any value but zero as a failure, a negative one too', async () => {
    zabbix([result('1', '10', 'A', 'a', -1), result('2', '10', 'A', 'b', 1), result('3', '10', 'A', 'c', 0)]);
    expect(await get()).toMatchObject({ total: 3, ok: 1, failed: 2 });
  });

  it('does not read an empty or a non-numeric value as a pass', async () => {
    zabbix([result('1', '10', 'A', 'a', 0, { lastvalue: '' }), result('2', '10', 'A', 'b', 0, { lastvalue: 'n/a' }), result('3', '10', 'A', 'c', 0)]);
    expect(await get()).toMatchObject({ total: 3, ok: 1, unknown: 2 });
  });

  it('lists the failed ones by host and then by scenario, with the step that failed and when', async () => {
    zabbix([
      result('1', '12', 'ZED', 'Login', 1),
      result('2', '11', 'ALPHA', 'Search', 3),
      result('3', '11', 'ALPHA', 'Home', 2),
      result('4', '13', 'MID', 'Ok one', 0),
    ]);
    const { failures } = await get();
    expect(failures.map((f: { host: string; name: string; step: number }) => [f.host, f.name, f.step])).toEqual([
      ['ALPHA', 'Home', 2],
      ['ALPHA', 'Search', 3],
      ['ZED', 'Login', 1],
    ]);
    expect(failures[0]).toMatchObject({ hostid: '11', itemid: '3' });
    expect(failures[0].clock).toBeGreaterThan(NOW - 120);
  });

  it('lists as many failures as asked, 10 unless said, between 1 and 50, and counts them all', async () => {
    zabbix(Array.from({ length: 60 }, (_, i) => result(String(i + 1), String(100 + i), `HOST ${String(i).padStart(2, '0')}`, 'Home', 1)));
    const first = await get();
    expect(first.failed).toBe(60);
    expect(first.failures).toHaveLength(10);
    invalidate('');
    expect((await get('?limit=3')).failures).toHaveLength(3);
    invalidate('');
    expect((await get('?limit=500')).failures).toHaveLength(50);
    invalidate('');
    expect((await get('?limit=0')).failures).toHaveLength(1);
    invalidate('');
    expect((await get('?limit=soon')).failures).toHaveLength(10);
  });

  it('answers each limit with its own number of rows, also within the cache time', async () => {
    zabbix(Array.from({ length: 12 }, (_, i) => result(String(i + 1), String(100 + i), `HOST ${String(i).padStart(2, '0')}`, 'Home', 1)));
    const app = await buildTestApp(webMonitoringRoutes);
    const rows = async (query: string) => (await app.inject({ url: `/api/reports/web-monitoring${query}` })).json().failures;
    expect(await rows('?limit=2')).toHaveLength(2);
    expect(await rows('?limit=3')).toHaveLength(3);
    expect(await rows('?limit=2')).toHaveLength(2);
  });

  it('asks Zabbix for the web items of enabled scenarios on monitored hosts, by key prefix', async () => {
    zabbix([]);
    await get();
    expect(zbxMock).toHaveBeenCalledTimes(1);
    const [method, params] = zbxMock.mock.calls[0];
    expect(method).toBe('item.get');
    expect(params).toMatchObject({ search: { key_: 'web.test.fail[' }, startSearch: true, webitems: true, monitored: true, selectHosts: ['hostid', 'name'] });
  });

  it('leaves out an item with no host, or that is not a scenario result', async () => {
    zabbix([result('1', '10', 'A', 'a', 0), { ...result('2', '10', 'A', 'b', 0), hosts: [] }, { ...result('3', '10', 'A', 'c', 0), key_: 'web.test.error[c]' }]);
    expect(await get()).toMatchObject({ total: 1, ok: 1 });
  });

  it('says nothing is monitored when there is no scenario', async () => {
    zabbix([]);
    expect(await get()).toMatchObject({ total: 0, ok: 0, failed: 0, unknown: 0, failures: [] });
  });

  it('refuses with the portal\'s one sentence when Zabbix cannot be read, and never names it', async () => {
    zbxMock.mockRejectedValue(new ZabbixApiError('Zabbix answered with an error', 'method not found'));
    const res = await (await buildTestApp(webMonitoringRoutes)).inject({ url: '/api/reports/web-monitoring' });
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toContain('The data source is not answering.');
    expect(JSON.stringify(res.json())).not.toContain('method not found');
  });
});

describe('scenarioName', () => {
  it('is the name inside the key', () => {
    expect(scenarioName('web.test.fail[Home page]')).toBe('Home page');
  });

  it('unquotes a name that Zabbix quoted because it holds a comma or a quote', () => {
    expect(scenarioName('web.test.fail["Login, then search"]')).toBe('Login, then search');
    expect(scenarioName('web.test.fail["The \\"big\\" one"]')).toBe('The "big" one');
  });

  it('keeps a key it does not know as it is', () => {
    expect(scenarioName('something.else')).toBe('something.else');
  });
});
