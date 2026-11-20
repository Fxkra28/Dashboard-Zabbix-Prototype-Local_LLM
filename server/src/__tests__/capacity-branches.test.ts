import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The branches of the Capacity report that no test held (BK-102): the average and the peak of an item over its hourly rows, one row for each host, the raw-history fallback of a young
 * instance and its cap, and the busiest interfaces with the way they are chosen (BK-92). Zabbix is a stand-in; the numbers are made up.
 */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../clients/zabbix.js')>()), zbx: zbxMock }));

const { getCapacity } = await import('../services/capacity.js');
const { invalidate } = await import('../core/cache.js');

type Item = { itemid: string; name: string; key_: string; units?: string; value_type?: string; lastvalue?: string; hosts: { hostid: string; name: string }[] };
const host = (id: string, name = `host-${id}`) => [{ hostid: id, name }];
const cpu = (itemid: string, hostid: string, key = 'system.cpu.util[cpmCPUTotal5minRev.19]'): Item => ({ itemid, name: `CPU ${itemid}`, key_: key, units: '%', value_type: '0', hosts: host(hostid) });

interface Estate {
  items?: Record<string, Item[]>;
  trends?: Record<string, { value_avg: number; value_max: number; value_min?: number }[]>;
  history?: { itemid: string; value: string }[];
}

/** Zabbix, answering for one made-up estate: the items by the key prefix asked for, the trend rows and the raw history. */
function estate(e: Estate): void {
  zbxMock.mockReset();
  zbxMock.mockImplementation(async (method: string, params: Record<string, unknown>) => {
    if (method === 'item.get') return e.items?.[(params.search as { key_: string }).key_] ?? [];
    if (method === 'trend.get') {
      const ids = params.itemids as string[];
      return ids.flatMap((id) => (e.trends?.[id] ?? []).map((r) => ({ itemid: id, value_avg: String(r.value_avg), value_max: String(r.value_max), value_min: String(r.value_min ?? r.value_avg) })));
    }
    if (method === 'history.get') return e.history ?? [];
    return [];
  });
}

beforeEach(() => invalidate(''));

describe('the average and the peak of an item', () => {
  it('are the mean of its hourly averages and the largest of its hourly maxima', async () => {
    estate({ items: { 'system.cpu.util': [cpu('1', '10')] }, trends: { '1': [{ value_avg: 10, value_max: 20 }, { value_avg: 30, value_max: 60 }, { value_avg: 50, value_max: 90 }] } });
    const row = (await getCapacity(7, 10)).metrics.find((m) => m.key === 'cpu')!.rows[0];
    expect(row).toMatchObject({ itemid: '1', hostid: '10', host: 'host-10', avg: 30, max: 90, source: 'trend', units: '%' });
  });

  it('are left to the items that have rows: an item with none is not listed, and not as zero', async () => {
    estate({ items: { 'system.cpu.util': [cpu('1', '10'), cpu('2', '11')] }, trends: { '1': [{ value_avg: 40, value_max: 50 }] } });
    const rows = (await getCapacity(7, 10)).metrics.find((m) => m.key === 'cpu')!.rows;
    expect(rows.map((r) => r.itemid)).toEqual(['1']);
  });

  it('leave out the idle share of the processor, which is the opposite of what the report wants', async () => {
    estate({ items: { 'system.cpu.util': [cpu('1', '10', 'system.cpu.util[,idle]'), cpu('2', '10', 'system.cpu.util')] }, trends: { '1': [{ value_avg: 99, value_max: 99 }], '2': [{ value_avg: 5, value_max: 7 }] } });
    const rows = (await getCapacity(7, 10)).metrics.find((m) => m.key === 'cpu')!.rows;
    expect(rows.map((r) => r.itemid)).toEqual(['2']);
  });
});

describe('one row for each host (a switch with two processor modules is one device)', () => {
  it('shows the busiest item of the host, and ranks the hosts by it', async () => {
    estate({
      items: { 'system.cpu.util': [cpu('1', '10'), cpu('2', '10', 'system.cpu.util[cpmCPUTotal5minRev.20]'), cpu('3', '11')] },
      trends: { '1': [{ value_avg: 30, value_max: 40 }], '2': [{ value_avg: 55, value_max: 70 }], '3': [{ value_avg: 40, value_max: 45 }] },
    });
    const rows = (await getCapacity(7, 10)).metrics.find((m) => m.key === 'cpu')!.rows;
    expect(rows.map((r) => [r.hostid, r.itemid, r.avg])).toEqual([['10', '2', 55], ['11', '3', 40]]);
  });

  it('lists at most the number of hosts asked for, the busiest first', async () => {
    const items = [1, 2, 3, 4].map((n) => cpu(String(n), String(100 + n)));
    estate({ items: { 'system.cpu.util': items }, trends: Object.fromEntries(items.map((i, n) => [i.itemid, [{ value_avg: 10 * (n + 1), value_max: 10 * (n + 1) }]])) });
    const rows = (await getCapacity(7, 2)).metrics.find((m) => m.key === 'cpu')!.rows;
    expect(rows.map((r) => r.itemid)).toEqual(['4', '3']);
  });
});

describe('a young instance with no trends yet', () => {
  it('reads the raw history of the last day only, with the cap, and says the rows come from history', async () => {
    const before = Math.floor(Date.now() / 1000);
    estate({ items: { 'system.cpu.util': [cpu('1', '10')] }, history: [{ itemid: '1', value: '20' }, { itemid: '1', value: '40' }, { itemid: '1', value: '90' }] });
    const row = (await getCapacity(30, 10)).metrics.find((m) => m.key === 'cpu')!.rows[0];
    expect(row).toMatchObject({ itemid: '1', avg: 50, max: 90, source: 'history' });
    const call = zbxMock.mock.calls.find(([method]) => method === 'history.get')![1] as { time_from: number; time_till: number; limit: number; history: number; itemids: string[] };
    // A day back, whatever the days asked for: the instance is young, so that is where its history is.
    expect(call.time_till - call.time_from).toBe(86_400);
    expect(call.time_till).toBeGreaterThanOrEqual(before);
    expect(call.limit).toBe(10_000);
    expect(call.history).toBe(0);
    expect(call.itemids).toEqual(['1']);
  });

  it('asks for integer history when the item holds integers', async () => {
    estate({ items: { 'system.cpu.util': [{ ...cpu('1', '10'), value_type: '3' }] }, history: [{ itemid: '1', value: '10' }] });
    await getCapacity(7, 10);
    expect((zbxMock.mock.calls.find(([method]) => method === 'history.get')![1] as { history: number }).history).toBe(3);
  });

  it('lists nothing for a metric whose items have neither trends nor history', async () => {
    estate({ items: { 'system.cpu.util': [cpu('1', '10')] } });
    expect((await getCapacity(7, 10)).metrics.find((m) => m.key === 'cpu')!.rows).toEqual([]);
  });

  it('does not use history for a metric that has trends, though another metric has none', async () => {
    estate({
      items: { 'system.cpu.util': [cpu('1', '10')], 'vm.memory.util': [{ itemid: '9', name: 'Memory', key_: 'vm.memory.util[memoryUsedPercentage.0]', units: '%', value_type: '0', hosts: host('10') }] },
      trends: { '1': [{ value_avg: 10, value_max: 20 }] },
      history: [{ itemid: '9', value: '70' }],
    });
    const metrics = (await getCapacity(7, 10)).metrics;
    expect(metrics.find((m) => m.key === 'cpu')!.rows[0].source).toBe('trend');
    expect(metrics.find((m) => m.key === 'memory')!.rows[0]).toMatchObject({ source: 'history', avg: 70 });
  });
});

describe('the busiest interfaces (BK-92)', () => {
  const port = (n: number, hostid = '10', name = `Interface Gi1/0/${n}(desc): `): Record<string, Item> => ({
    in: { itemid: `${n}1`, name: `${name}Bits received`, key_: `net.if.in[ifHCInOctets.${n}]`, units: 'bps', lastvalue: '0', hosts: host(hostid) },
    out: { itemid: `${n}2`, name: `${name}Bits sent`, key_: `net.if.out[ifHCOutOctets.${n}]`, units: 'bps', lastvalue: '0', hosts: host(hostid) },
    speed: { itemid: `${n}3`, name: `${name}Speed`, key_: `net.if.speed[ifHighSpeed.${n}]`, units: 'bps', lastvalue: '1000000000', hosts: host(hostid) },
  });
  const withNow = (p: Record<string, Item>, inNow: number, outNow: number, speed = '1000000000') => ({ in: { ...p.in, lastvalue: String(inNow) }, out: { ...p.out, lastvalue: String(outNow) }, speed: { ...p.speed, lastvalue: speed } });
  const lay = (ports: Record<string, Item>[]) => ({
    'net.if.in[': ports.map((p) => p.in),
    'net.if.out[': ports.map((p) => p.out),
    'net.if.speed[': ports.map((p) => p.speed),
  });
  const ifRows = async (top = 10) => (await getCapacity(7, top)).metrics.find((m) => m.key === 'ifutil')!.rows;

  it('are the ports busiest at the moment of the report, ranked by their average over the days: a port quiet then is not there however busy it was', async () => {
    const busy = withNow(port(1), 800_000_000, 100_000_000);
    const quiet = withNow(port(2), 0, 0);
    estate({
      items: lay([busy, quiet]),
      trends: { '11': [{ value_avg: 200_000_000, value_max: 500_000_000 }], '12': [{ value_avg: 50_000_000, value_max: 60_000_000 }], '21': [{ value_avg: 900_000_000, value_max: 990_000_000 }], '22': [{ value_avg: 10, value_max: 10 }] },
    });
    const rows = await ifRows();
    expect(rows.map((r) => r.itemid)).toEqual(['11']);
    expect(rows[0]).toMatchObject({ name: 'Gi1/0/1', host: 'host-10', units: '%', avg: 20, max: 50, source: 'trend' });
  });

  it('take the busier direction, as a share of the port\'s speed, and cap the peak at 100', async () => {
    const p = withNow(port(1), 100, 900_000_000);
    estate({ items: lay([p]), trends: { '11': [{ value_avg: 100_000_000, value_max: 200_000_000 }], '12': [{ value_avg: 600_000_000, value_max: 1_400_000_000 }] } });
    const [row] = await ifRows();
    expect(row.avg).toBe(60);
    expect(row.max).toBe(100);
  });

  it('leave out a port with no speed, or a speed of zero, which has no share to take', async () => {
    estate({ items: lay([withNow(port(1), 500, 500, '0'), withNow(port(2), 500_000_000, 0)]), trends: { '21': [{ value_avg: 5e8, value_max: 6e8 }], '11': [{ value_avg: 1, value_max: 1 }] } });
    expect((await ifRows()).map((r) => r.itemid)).toEqual(['21']);
  });

  it('take the octet counters for traffic, and not the errors and the discards that share their prefix', async () => {
    const p = withNow(port(1), 500_000_000, 0);
    const errors = { ...p.in, itemid: '14', key_: 'net.if.in.errors[ifInErrors.1]', lastvalue: '900000000' };
    estate({ items: { ...lay([p]), 'net.if.in[': [errors, p.in] }, trends: { '11': [{ value_avg: 5e8, value_max: 6e8 }], '14': [{ value_avg: 9e8, value_max: 9e8 }] } });
    expect((await ifRows()).map((r) => r.itemid)).toEqual(['11']);
  });

  it('list at most the number asked for, after reading the trends of a shortlist four times that long and at least forty', async () => {
    const ports = Array.from({ length: 60 }, (_, i) => withNow(port(i + 1), (i + 1) * 10_000_000, 0));
    const trends = Object.fromEntries(ports.map((p) => [p.in.itemid, [{ value_avg: Number(p.in.lastvalue), value_max: Number(p.in.lastvalue) }]]));
    estate({ items: lay(ports), trends });
    const rows = await ifRows(3);
    expect(rows).toHaveLength(3);
    expect(rows[0].itemid).toBe('601');
    const asked = zbxMock.mock.calls.filter(([method]) => method === 'trend.get').flatMap(([, params]) => (params as { itemids: string[] }).itemids);
    // Three asked for, so the shortlist is forty (the floor), the busiest by their rate now: the in items of those forty are read, and no more than that.
    const inItems = new Set(asked.filter((id) => ports.some((p) => p.in.itemid === id)));
    expect(inItems.size).toBe(40);
    expect(inItems.has('601')).toBe(true);
    expect(inItems.has('11')).toBe(false);
  });

  it('say there is nothing when no port has a speed and a rate, instead of reading trends for nothing', async () => {
    estate({ items: lay([withNow(port(1), 0, 0)]) });
    expect(await ifRows()).toEqual([]);
    expect(zbxMock.mock.calls.filter(([method]) => method === 'trend.get').every(([, params]) => !(params as { itemids: string[] }).itemids.includes('11'))).toBe(true);
  });

  it('keep the ports\' speeds for a day, since they change only when the port does', async () => {
    const p = withNow(port(1), 500_000_000, 0);
    estate({ items: lay([p]), trends: { '11': [{ value_avg: 5e8, value_max: 5e8 }] } });
    await getCapacity(7, 10);
    const reads = () => zbxMock.mock.calls.filter(([m, params]) => m === 'item.get' && (params as { search: { key_: string } }).search.key_ === 'net.if.speed[').length;
    expect(reads()).toBe(1);
    invalidate('capacity:report');
    await getCapacity(30, 10);
    expect(reads()).toBe(1);
  });
});
