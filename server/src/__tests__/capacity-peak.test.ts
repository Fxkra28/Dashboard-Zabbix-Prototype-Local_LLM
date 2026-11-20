import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The peak of a disk that reports its free space (FortiGate, `vfs.fs.pfree`) is 100 less the lowest free value it had, which is the minimum of the free item. It was taken from the maximum of the
 * free item, which is the lowest use, and then lifted to the average, so that the Peak of every such disk equalled its average (BK-93). The numbers are made up.
 */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../clients/zabbix.js')>()), zbx: zbxMock }));

const { getCapacity } = await import('../services/capacity.js');

const item = (over: Record<string, unknown>) => ({ itemid: '7', name: '/: Space: Used, in %', key_: 'vfs.fs.pfree', units: '%', value_type: '0', hosts: [{ hostid: '1', name: 'FW1' }], ...over });

beforeEach(() => {
  zbxMock.mockReset();
  zbxMock.mockImplementation(async (method: string, params: { search?: { key_?: string }; output?: string[] }) => {
    if (method === 'item.get') return params.search?.key_ === 'vfs.fs.pfree' ? [item({})] : [];
    if (method === 'trend.get') return [{ itemid: '7', value_avg: '40', value_max: '60', value_min: '20' }];
    return [];
  });
});

describe('the Capacity report of a disk that reports free space (BK-93)', () => {
  it('has a peak of 100 less the lowest free value, and an average of 100 less the average free value', async () => {
    const report = await getCapacity(7, 10);
    const disk = report.metrics.find((m) => m.key === 'disk')!;
    expect(disk.rows).toHaveLength(1);
    expect(disk.rows[0]).toMatchObject({ avg: 60, max: 80 });
  });

  it('asks Zabbix for the minimum of the trend as well as the average and the maximum', async () => {
    await getCapacity(7, 10);
    const trendCalls = zbxMock.mock.calls.filter(([method]) => method === 'trend.get');
    expect(trendCalls.length).toBeGreaterThan(0);
    for (const [, params] of trendCalls) expect(params.output).toEqual(expect.arrayContaining(['value_avg', 'value_max', 'value_min']));
  });

  it('leaves a disk that reports its use as it was: the peak is the maximum', async () => {
    zbxMock.mockImplementation(async (method: string, params: { search?: { key_?: string } }) => {
      if (method === 'item.get') return params.search?.key_ === 'vfs.fs' ? [item({ key_: 'vfs.fs.size[/,pused]', name: '/: Space: Used, in %' })] : [];
      if (method === 'trend.get') return [{ itemid: '7', value_avg: '40', value_max: '60', value_min: '20' }];
      return [];
    });
    const disk = (await getCapacity(7, 10)).metrics.find((m) => m.key === 'disk')!;
    expect(disk.rows[0]).toMatchObject({ avg: 40, max: 60 });
  });
});

describe('the Capacity report says when it was built (BK-92)', () => {
  it('carries the time of its build in seconds, the moment the busiest interfaces were chosen', async () => {
    const before = Math.floor(Date.now() / 1000);
    const report = await getCapacity(7, 10);
    expect(report.generatedAt).toBeGreaterThanOrEqual(before);
    expect(report.generatedAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });
});

