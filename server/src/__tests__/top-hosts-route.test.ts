import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp } from './helpers/app.js';
import { invalidate } from '../core/cache.js';

/** GET /api/reports/top-hosts: the busiest hosts now by CPU and by memory; the Zabbix reads are mocked by method. */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

const { topHostRoutes } = await import('../routes/topHosts.js');
const { ZabbixApiError } = await import('../clients/zabbix.js');

const NOW = Math.floor(Date.now() / 1000);

const item = (itemid: string, hostid: string, name: string, key_: string, value: number | null, over: Record<string, unknown> = {}) => ({
  itemid,
  key_,
  lastvalue: value === null ? '' : String(value),
  lastclock: value === null ? '0' : String(NOW - 30),
  delay: '1m',
  state: '0',
  hosts: [{ hostid, name }],
  ...over,
});

/** Zabbix as one table of items, searched by key prefix as the route searches. */
function zabbix(items: ReturnType<typeof item>[]) {
  zbxMock.mockImplementation(async (method: string, params: { search?: { key_: string } }) => {
    if (method !== 'item.get') throw new Error(`unexpected Zabbix call ${method}`);
    const prefix = params.search?.key_ ?? '';
    return items.filter((i) => i.key_.startsWith(prefix));
  });
}
const get = async (query = '') => (await (await buildTestApp(topHostRoutes)).inject({ url: `/api/reports/top-hosts${query}` })).json();

beforeEach(() => {
  zbxMock.mockReset();
  invalidate('');
});
afterEach(() => vi.useRealTimers());

describe('GET /api/reports/top-hosts', () => {
  it('lists the hosts busiest first, for CPU and for memory, each with its host, item, value and time', async () => {
    zabbix([
      item('1', '10', 'SITE1-CORESWITCH', 'system.cpu.util[cpmCPUTotal5minRev.19]', 35),
      item('2', '11', 'SITE3-FW-01', 'system.cpu.util[fgSysCpuUsage.0]', 91.5),
      item('3', '12', 'SERVER : DATABASE', 'system.cpu.util', 62),
      item('4', '11', 'SITE3-FW-01', 'vm.memory.util[memoryUsedPercentage.0]', 48),
      item('5', '12', 'SERVER : DATABASE', 'vm.memory.utilization', 77),
    ]);
    const body = await get();
    const [cpu, memory] = body.metrics;
    expect(cpu).toMatchObject({ key: 'cpu', label: 'CPU utilisation', considered: 3, current: 3 });
    expect(cpu.rows.map((r: { host: string; value: number }) => [r.host, r.value])).toEqual([
      ['SITE3-FW-01', 91.5],
      ['SERVER : DATABASE', 62],
      ['SITE1-CORESWITCH', 35],
    ]);
    expect(cpu.rows[0]).toMatchObject({ hostid: '11', itemid: '2' });
    expect(cpu.rows[0].clock).toBeGreaterThan(NOW - 120);
    expect(memory.rows.map((r: { host: string }) => r.host)).toEqual(['SERVER : DATABASE', 'SITE3-FW-01']);
    expect(body.generatedAt).toBeGreaterThanOrEqual(NOW);
  });

  it('takes the hottest of a host\'s items once: a switch with a CPU item for each module is one row', async () => {
    zabbix([
      item('1', '10', 'SITE1-CORESWITCH', 'system.cpu.util[cpmCPUTotal5minRev.19]', 20),
      item('2', '10', 'SITE1-CORESWITCH', 'system.cpu.util[cpmCPUTotal5minRev.20]', 83),
      item('3', '11', 'OTHER', 'system.cpu.util', 50),
    ]);
    const [cpu] = (await get()).metrics;
    expect(cpu.rows.map((r: { host: string; value: number; itemid: string }) => [r.host, r.value, r.itemid])).toEqual([
      ['SITE1-CORESWITCH', 83, '2'],
      ['OTHER', 50, '3'],
    ]);
    expect(cpu.considered).toBe(2);
  });

  it('leaves out an item that is not a utilisation: the idle share, and keys that only start the same', async () => {
    zabbix([
      item('1', '10', 'A', 'system.cpu.util[,idle]', 99),
      item('2', '10', 'A', 'system.cpu.util[,user]', 99),
      item('3', '11', 'B', 'vm.memory.util.something.else', 99),
      item('4', '12', 'C', 'system.cpu.util', 10),
    ]);
    const [cpu, memory] = (await get()).metrics;
    expect(cpu.rows.map((r: { host: string }) => r.host)).toEqual(['C']);
    expect(cpu.considered).toBe(1);
    expect(memory.rows).toEqual([]);
  });

  it('never lists an old value: a host whose figure is from days ago is counted as having the item, and not as current', async () => {
    zabbix([
      item('1', '10', 'FRESH', 'system.cpu.util', 40),
      item('2', '11', 'OLD', 'system.cpu.util', 99, { lastclock: String(NOW - 5 * 86_400) }),
      item('3', '12', 'NONE', 'system.cpu.util', null),
      item('4', '13', 'UNSUPPORTED', 'system.cpu.util', 99, { state: '1' }),
    ]);
    const [cpu] = (await get()).metrics;
    expect(cpu).toMatchObject({ considered: 4, current: 1 });
    expect(cpu.rows.map((r: { host: string }) => r.host)).toEqual(['FRESH']);
  });

  it('does not read an empty or a non-numeric last value as zero', async () => {
    zabbix([
      item('1', '10', 'EMPTY', 'system.cpu.util', 50, { lastvalue: '' }),
      item('2', '11', 'TEXT', 'system.cpu.util', 50, { lastvalue: 'n/a' }),
      item('3', '12', 'OK', 'system.cpu.util', 20),
    ]);
    const [cpu] = (await get()).metrics;
    expect(cpu).toMatchObject({ considered: 3, current: 1 });
    expect(cpu.rows.map((r: { host: string }) => r.host)).toEqual(['OK']);
  });

  it('answers each limit with its own number of rows, also within the cache time', async () => {
    zabbix(Array.from({ length: 25 }, (_, i) => item(String(i + 1), String(100 + i), `HOST ${String(i).padStart(2, '0')}`, 'system.cpu.util', 50)));
    // One app for both: buildTestApp empties the cache, and the point is what a second request finds in it.
    const app = await buildTestApp(topHostRoutes);
    const rows = async (query: string) => (await app.inject({ url: `/api/reports/top-hosts${query}` })).json().metrics[0].rows;
    expect(await rows('?limit=2')).toHaveLength(2);
    expect(await rows('?limit=3')).toHaveLength(3);
    expect(await rows('?limit=2')).toHaveLength(2);
  });

  it('says so, with no rows, when every figure is old, as on a copy of Zabbix that has stopped', async () => {
    zabbix([item('1', '10', 'A', 'system.cpu.util', 50, { lastclock: String(NOW - 30 * 86_400) }), item('2', '10', 'A', 'vm.memory.util', 40, { lastclock: String(NOW - 30 * 86_400) })]);
    for (const m of (await get()).metrics) expect(m).toMatchObject({ considered: 1, current: 0, rows: [] });
  });

  it('breaks a tie by host name, and keeps to the limit, 10 unless asked, between 1 and 20', async () => {
    const many = Array.from({ length: 25 }, (_, i) => item(String(i + 1), String(100 + i), `HOST ${String(i).padStart(2, '0')}`, 'system.cpu.util', 50));
    // Zabbix gives them in any order; the equal figures must still come out by name.
    zabbix([...many].reverse());
    const body = await get();
    expect(body.metrics[0].rows.map((r: { host: string }) => r.host)).toEqual(Array.from({ length: 10 }, (_, i) => `HOST ${String(i).padStart(2, '0')}`));
    invalidate('');
    expect((await get('?limit=2')).metrics[0].rows).toHaveLength(2);
    invalidate('');
    expect((await get('?limit=500')).metrics[0].rows).toHaveLength(20);
    invalidate('');
    expect((await get('?limit=0')).metrics[0].rows).toHaveLength(1);
    invalidate('');
    expect((await get('?limit=soon')).metrics[0].rows).toHaveLength(10);
    expect(body.metrics[0].considered).toBe(25);
  });

  it('asks Zabbix once for each metric, by key prefix and for enabled hosts only, and keeps the answer half a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW * 1000));
    zabbix([item('1', '10', 'A', 'system.cpu.util', 10)]);
    const app = await buildTestApp(topHostRoutes);
    await app.inject({ url: '/api/reports/top-hosts' });
    await app.inject({ url: '/api/reports/top-hosts' });
    expect(zbxMock).toHaveBeenCalledTimes(2);
    expect(zbxMock.mock.calls.map((c) => (c[1] as { search: { key_: string } }).search.key_).sort()).toEqual(['system.cpu.util', 'vm.memory.util']);
    expect(zbxMock.mock.calls[0][1]).toMatchObject({ startSearch: true, monitored: true, selectHosts: ['hostid', 'name'] });
    vi.setSystemTime(new Date((NOW + 31) * 1000));
    await app.inject({ url: '/api/reports/top-hosts' });
    expect(zbxMock).toHaveBeenCalledTimes(4);
  });

  it('answers a Zabbix failure with the one sentence, and no method name', async () => {
    zbxMock.mockRejectedValue(new ZabbixApiError('item.get: {"code":-32500}'));
    const res = await (await buildTestApp(topHostRoutes)).inject({ url: '/api/reports/top-hosts' });
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toMatch(/^The data source is not answering\./);
    expect(res.body).not.toContain('item.get');
  });
});
