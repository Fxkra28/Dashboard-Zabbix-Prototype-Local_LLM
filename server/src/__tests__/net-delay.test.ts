import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../core/cache.js';
import { groupInterfaces, type ZIfItem } from '../services/net.js';

/**
 * The Network page reads interface items with their update interval, and judges a value fresh by it (BK-95). Read without `delay`, every item was taken for one of 60 s, so an item polled less often than
 * every 3 min 20 s lost its value for most of each interval and its utilisation went blank.
 */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../clients/zabbix.js')>()), zbx: zbxMock }));

const { getInterfacePage } = await import('../services/net.js');

const NOW = 1_790_000_000;
const item = (over: Partial<ZIfItem>): ZIfItem => ({ itemid: '1', name: 'Interface Gi1/0/1(): Bits received', key_: 'net.if.in[ifHCInOctets.1]', lastvalue: '8000000', lastclock: String(NOW - 20 * 60), units: 'bps', value_type: '3', state: '0', status: '0', ...over });

beforeEach(() => {
  invalidate('');
  zbxMock.mockReset();
});

describe('groupInterfaces', () => {
  it('keeps the value of an item polled every ten minutes for as long as three intervals, and drops one polled every minute', () => {
    expect(groupInterfaces([item({ delay: '10m' })], NOW)[0].inBps).toBe(8_000_000);
    expect(groupInterfaces([item({ delay: '60' })], NOW)[0].inBps).toBeNull();
    expect(groupInterfaces([item({ delay: '10m;30s/1-7,00:00-24:00' })], NOW)[0].inBps).toBe(8_000_000);
  });
});

describe('the interface read', () => {
  it('asks Zabbix for the update interval of each item', async () => {
    zbxMock.mockResolvedValue([]);
    await getInterfacePage({ hostid: '10', page: 1, pageSize: 20 });
    const [, params] = zbxMock.mock.calls[0] as [string, { output: string[] }];
    expect(params.output).toContain('delay');
  });
});
