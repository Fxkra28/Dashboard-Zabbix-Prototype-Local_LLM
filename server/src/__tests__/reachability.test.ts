import { afterEach, describe, expect, it, vi } from 'vitest';
import { pingZabbix } from './helpers/pingZabbix.js';
import {
  foldIcmp,
  freshWithinS,
  hostState,
  isFresh,
  rollUpAvailability,
  type IcmpItem,
  type IcmpReading,
} from '../domain/reachability.js';

/**
 * One host state, ping first. Every branch of `hostState` is pinned here: a
 * wrong state does not throw, it just paints a device green or red on the NOC
 * wall, and the assistant repeats it.
 */

const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

afterEach(() => {
  zbxMock.mockReset();
});

const NOW = 1_789_617_000;
const ago = (seconds: number) => String(NOW - seconds);

const item = (over: Partial<IcmpItem> = {}): IcmpItem => ({
  itemid: '1',
  hostid: '10',
  key_: 'icmpping',
  lastvalue: '1',
  lastclock: ago(30),
  state: '0',
  delay: '1m',
  ...over,
});

const reading = (over: Partial<IcmpReading> = {}): IcmpReading => ({ state: 'unknown', items: 3, unsupported: 0, ...over });
const up = reading({ state: 'up', up: true });
const down = reading({ state: 'down', up: false });

const snmp = (available: string) => ({ type: '2', available });
const agent = (available: string) => ({ type: '1', available });

describe('isFresh', () => {
  it('believes a supported value collected within three update intervals', () => {
    expect(isFresh(item({ lastclock: ago(30) }), NOW)).toBe(true);
    expect(isFresh(item({ delay: '5m', lastclock: ago(899) }), NOW)).toBe(true);
    expect(isFresh(item({ delay: '5m', lastclock: ago(901) }), NOW)).toBe(false);
    expect(isFresh(item({ delay: '1h', lastclock: ago(3 * 3600) }), NOW)).toBe(true);
    expect(isFresh(item({ delay: '1h', lastclock: ago(3 * 3600 + 1) }), NOW)).toBe(false);
    expect(isFresh(item({ delay: '900', lastclock: ago(2700) }), NOW)).toBe(true);
  });

  it('never calls a value stale inside ten minutes, however short the interval', () => {
    expect(isFresh(item({ delay: '30s', lastclock: ago(600) }), NOW)).toBe(true);
    expect(isFresh(item({ delay: '30s', lastclock: ago(601) }), NOW)).toBe(false);
    expect(isFresh(item({ delay: '1m', lastclock: ago(3 * 3600) }), NOW)).toBe(false);
    // A dependent item (delay 0) or a macro gets the same floor.
    expect(isFresh(item({ delay: '0', lastclock: ago(599) }), NOW)).toBe(true);
    expect(isFresh(item({ delay: '{$ICMP.INTERVAL}', lastclock: ago(601) }), NOW)).toBe(false);
  });

  it('does not believe an unsupported item or one that never collected', () => {
    expect(isFresh(item({ state: '1', lastclock: ago(5) }), NOW)).toBe(false);
    expect(isFresh(item({ lastclock: '0' }), NOW)).toBe(false);
    expect(isFresh({ lastclock: undefined, state: '0' }, NOW)).toBe(false);
  });
});

describe('rollUpAvailability', () => {
  it('is worst-wins across interfaces, unknown without any', () => {
    expect(rollUpAvailability(undefined)).toBe('unknown');
    expect(rollUpAvailability([])).toBe('unknown');
    expect(rollUpAvailability([snmp('1'), agent('2')])).toBe('unavailable');
    expect(rollUpAvailability([snmp('1'), agent('0')])).toBe('available');
    expect(rollUpAvailability([snmp('0')])).toBe('unknown');
  });
});

describe('hostState', () => {
  const host = (interfaces: { type: string; available: string }[], status = '0') => ({ status, interfaces });

  it.each([
    // [case, host, icmp, state, reason]
    ['disabled wins over everything', host([snmp('2')], '1'), up, 'disabled', 'disabled'],
    ['ping up, interfaces fine', host([snmp('1')]), up, 'up', 'ping'],
    ['ping up, no interface at all', host([]), up, 'up', 'ping'],
    ['ping up, SNMP silent', host([snmp('2')]), up, 'degraded', 'snmp-silent'],
    ['ping up, agent silent', host([agent('2')]), up, 'degraded', 'agent-silent'],
    ['ping up, SNMP and agent silent: SNMP named', host([agent('2'), snmp('2')]), up, 'degraded', 'snmp-silent'],
    ['ping up, IPMI silent', host([{ type: '3', available: '2' }]), up, 'degraded', 'interface'],
    ['ping down, interface available', host([snmp('1')]), down, 'down', 'ping'],
    ['ping down, SNMP silent too', host([snmp('2')]), down, 'down', 'ping'],
    ['no fresh ping, interface available', host([snmp('1')]), reading(), 'up', 'interface'],
    ['no ICMP items, interface unavailable', host([agent('2')]), undefined, 'down', 'interface'],
    ['stale ping, interface unknown', host([snmp('0')]), reading({ items: 3, unsupported: 0 }), 'nodata', 'stale'],
    ['stale ping, no interface', host([]), reading({ items: 3, unsupported: 1 }), 'nodata', 'stale'],
    ['unsupported ping, no interface', host([]), reading({ items: 3, unsupported: 3 }), 'nodata', 'no-interface'],
    ['no ICMP items, no interface', host([]), undefined, 'nodata', 'no-interface'],
    ['unsupported ping, interface unknown', host([snmp('0')]), reading({ items: 3, unsupported: 3 }), 'nodata', 'unsupported'],
    ['no ICMP items, interface unknown', host([agent('0')]), undefined, 'nodata', 'interface'],
  ] as const)('%s', (_case, h, icmp, state, reason) => {
    expect(hostState(h as { status: string; interfaces: { type: string; available: string }[] }, icmp)).toEqual({
      state,
      reason,
    });
  });

  it('treats a missing interfaces list like an empty one', () => {
    expect(hostState({ status: '0' }, undefined)).toEqual({ state: 'nodata', reason: 'no-interface' });
  });
});

describe('foldIcmp', () => {
  it('folds a host’s ping, loss and latency, believing fresh values only', () => {
    const map = foldIcmp(
      [
        item({ hostid: '1', key_: 'icmpping', lastvalue: '1' }),
        item({ hostid: '1', key_: 'icmppingloss', lastvalue: '20' }),
        item({ hostid: '1', key_: 'icmppingsec', lastvalue: '0.012' }),
        item({ hostid: '2', key_: 'icmpping', lastvalue: '0' }),
        item({ hostid: '3', key_: 'icmpping', lastvalue: '1', lastclock: ago(3600) }),
        item({ hostid: '3', key_: 'icmppingloss', lastvalue: '0', state: '1', lastclock: '0' }),
        item({ hostid: '4', key_: 'icmpping', state: '1', lastclock: '0' }),
        item({ hostid: '4', key_: 'icmppingloss', state: '1', lastclock: '0' }),
      ],
      NOW,
    );
    expect(map.get('1')).toEqual({ state: 'up', up: true, loss: 20, latency: 0.012, items: 3, unsupported: 0 });
    expect(map.get('2')).toEqual({ state: 'down', up: false, items: 1, unsupported: 0 });
    expect(map.get('3')).toEqual({ state: 'unknown', items: 2, unsupported: 1 });
    expect(map.get('4')).toEqual({ state: 'unknown', items: 2, unsupported: 2 });
    expect(map.has('5')).toBe(false);
  });

  it('prefers the item pinging the host itself over a ping to some other target', () => {
    const map = foldIcmp(
      [
        item({ key_: 'icmpping[10.9.9.9]', lastvalue: '0' }),
        item({ key_: 'icmpping[,3]', lastvalue: '1' }),
        item({ key_: 'icmppingloss[10.9.9.9]', lastvalue: '100' }),
        item({ key_: 'icmppingloss', lastvalue: '0' }),
      ],
      NOW,
    );
    expect(map.get('10')).toMatchObject({ state: 'up', loss: 0, items: 4 });
  });
});

describe('freshWithinS', () => {
  it('is three update intervals, and never under ten minutes', () => {
    expect(freshWithinS('1m')).toBe(600);
    expect(freshWithinS('5m')).toBe(900);
    expect(freshWithinS('30m')).toBe(5400);
    expect(freshWithinS(undefined)).toBe(600);
  });
});

describe('getIcmpByHost', () => {
  it('reads an item polled less often than every five minutes over three of its own intervals, the others over the usual window', async () => {
    const now = Math.floor(Date.now() / 1000);
    zbxMock.mockImplementation(
      pingZabbix([
        { ...item({ itemid: '1', hostid: '7', delay: '1m', lastclock: String(now - 40) }), value_type: '3' },
        // Collected 20 minutes ago by a pinger that runs every 30: believed for 90 minutes, and outside a 15-minute window.
        { ...item({ itemid: '2', hostid: '8', delay: '30m', lastclock: String(now - 1200) }), value_type: '3' },
      ]),
    );
    const { invalidate } = await import('../core/cache.js');
    invalidate('');
    const { getIcmpByHost, ICMP_WINDOW_S } = await import('../domain/reachability.js');

    const hosts = await getIcmpByHost();
    expect(hosts.get('7')).toMatchObject({ state: 'up' });
    expect(hosts.get('8')).toMatchObject({ state: 'up' });

    const reads = zbxMock.mock.calls.filter(([method]) => method === 'history.get') as [string, { itemids: string[]; time_from: number }][];
    expect(reads.map(([, p]) => p.itemids.join()).sort()).toEqual(['1', '2']);
    const spanOf = (id: string) => now - (reads.find(([, p]) => p.itemids.includes(id)) as [string, { time_from: number }])[1].time_from;
    expect(Math.abs(spanOf('1') - ICMP_WINDOW_S)).toBeLessThanOrEqual(2);
    expect(Math.abs(spanOf('2') - 5400)).toBeLessThanOrEqual(2);
  });

  it('keeps the states of the usual items when the read of the slowly polled ones fails', async () => {
    const now = Math.floor(Date.now() / 1000);
    const base = pingZabbix([
      { ...item({ itemid: '1', hostid: '7', delay: '1m', lastclock: String(now - 40) }), value_type: '3' },
      { ...item({ itemid: '2', hostid: '8', delay: '30m', lastclock: String(now - 1200) }), value_type: '3' },
    ]);
    zbxMock.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method === 'history.get' && (params.itemids as string[]).includes('2')) throw new Error('history.get timed out');
      return base(method, params);
    });
    const { invalidate, setCacheLogger } = await import('../core/cache.js');
    invalidate('');
    const warn = vi.fn();
    setCacheLogger({ warn });
    try {
      const { getIcmpByHost } = await import('../domain/reachability.js');
      const hosts = await getIcmpByHost();
      expect(hosts.get('7')).toMatchObject({ state: 'up' });
      expect(hosts.get('8')).toMatchObject({ state: 'unknown' });
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ items: 1, reason: 'history.get timed out' }), expect.stringContaining('slowly polled'));
    } finally {
      setCacheLogger(undefined);
    }
  });

  it('finds the ping items without values, reads their values in bulk, and caches both', async () => {
    const now = Math.floor(Date.now() / 1000);
    zbxMock.mockImplementation(pingZabbix([{ ...item({ hostid: '7', lastclock: String(now - 40) }), value_type: '3' }]));
    const { invalidate } = await import('../core/cache.js');
    invalidate('');
    const { getIcmpByHost, ICMP_WINDOW_S } = await import('../domain/reachability.js');

    const first = await getIcmpByHost();
    expect(first.get('7')).toMatchObject({ state: 'up', up: true });
    await getIcmpByHost();
    expect(zbxMock).toHaveBeenCalledTimes(2);
    expect(zbxMock).toHaveBeenCalledWith('item.get', {
      output: ['itemid', 'hostid', 'key_', 'state', 'delay', 'value_type'],
      search: { key_: 'icmpping' },
      startSearch: true,
      monitored: true,
    });
    // Not Zabbix's `lastvalue`, which costs one query per item.
    expect(zbxMock).toHaveBeenCalledWith('history.get', expect.objectContaining({ history: 3, time_from: expect.any(Number) }));
    const [, history] = zbxMock.mock.calls.find(([method]) => method === 'history.get') as [string, { time_from: number }];
    expect(now - history.time_from).toBeGreaterThanOrEqual(ICMP_WINDOW_S);
  });
});
