import { describe, expect, it } from 'vitest';
import { groupInterfaces, parseIfKey, parseIfName, statusBucket, type ZIfItem } from '../services/net.js';

/**
 * One host's net.if.* items folded into a row for each interface (BK-102: `groupInterfaces` had no test of its own). The values count only while fresh, an interface is named from the item
 * names, and the rows come in the natural order of their names.
 */

const NOW = 1_800_000_000;
const item = (key: string, name: string, lastvalue: string, over: Partial<ZIfItem> = {}): ZIfItem => ({
  itemid: `${key}#${name}`.replace(/\W/g, ''),
  name,
  key_: key,
  lastvalue,
  lastclock: String(NOW - 30),
  units: '',
  value_type: '3',
  state: '0',
  status: '0',
  ...over,
});
const port = (n: number, name = `Gi1/0/${n}`, alias = 'Uplink') => [
  item(`net.if.in[ifHCInOctets.${n}]`, `Interface ${name}(${alias}): Bits received`, '4000000'),
  item(`net.if.out[ifHCOutOctets.${n}]`, `Interface ${name}(${alias}): Bits sent`, '1000000'),
  item(`net.if.status[ifOperStatus.${n}]`, `Interface ${name}(${alias}): Operational status`, '1'),
  item(`net.if.speed[ifHighSpeed.${n}]`, `Interface ${name}(${alias}): Speed`, '100000000'),
];

describe('the keys and the names of interface items', () => {
  it('reads the kind and the ifIndex of a key, and nothing of a walk item or a key with no index', () => {
    expect(parseIfKey('net.if.in[ifHCInOctets.33]')).toEqual({ kind: 'in', index: 33 });
    expect(parseIfKey('net.if.in.errors[ifInErrors.7]')).toEqual({ kind: 'in.errors', index: 7 });
    expect(parseIfKey('net.if.status[ifOperStatus.2]')).toEqual({ kind: 'status', index: 2 });
    expect(parseIfKey('net.if.walk[ifHCInOctets]')).toBeNull();
    expect(parseIfKey('net.if.in[ifHCInOctets]')).toBeNull();
    expect(parseIfKey('system.cpu.util')).toBeNull();
  });

  it('reads the name and the alias of an item, the alias with its own brackets, and an interface with no alias', () => {
    expect(parseIfName('Interface Gi1/0/1(Uplink (core)): Bits received')).toEqual({ name: 'Gi1/0/1', alias: 'Uplink (core)' });
    expect(parseIfName('Interface wan1: Speed')).toEqual({ name: 'wan1', alias: '' });
    expect(parseIfName('Something else')).toBeNull();
  });
});

describe('groupInterfaces', () => {
  it('folds the items of one ifIndex into one row, with the name, the alias, the status, the speed and the rates', () => {
    const [row] = groupInterfaces(port(1), NOW);
    expect(row).toMatchObject({ index: 1, name: 'Gi1/0/1', alias: 'Uplink', operStatus: 'up', speed: 100_000_000, inBps: 4_000_000, outBps: 1_000_000, lastclock: NOW - 30 });
    expect(row.itemids).toMatchObject({ in: expect.stringContaining('ifHCInOctets1'), out: expect.stringContaining('ifHCOutOctets1'), status: expect.any(String), speed: expect.any(String) });
  });

  it('takes the busier direction as a share of the speed, to two decimals', () => {
    expect(groupInterfaces(port(1), NOW)[0].utilisation).toBe(4);
    const items = port(1);
    items[0] = item('net.if.in[ifHCInOctets.1]', 'Interface Gi1/0/1(Uplink): Bits received', '33333333');
    expect(groupInterfaces(items, NOW)[0].utilisation).toBe(33.33);
  });

  it('has no share without a speed, and none for a speed of zero, and says so as null and not as 0', () => {
    expect(groupInterfaces(port(1).filter((i) => !i.key_.includes('speed')), NOW)[0].utilisation).toBeNull();
    const zero = port(1).map((i) => (i.key_.includes('speed') ? { ...i, lastvalue: '0' } : i));
    const [row] = groupInterfaces(zero, NOW);
    expect(row.speed).toBeNull();
    expect(row.utilisation).toBeNull();
  });

  it('counts a value only while it is fresh: an old reading is no rate, and an old status is unknown', () => {
    const stale = port(1).map((i) => ({ ...i, lastclock: String(NOW - 7_200) }));
    const [row] = groupInterfaces(stale, NOW);
    expect(row).toMatchObject({ inBps: null, outBps: null, operStatus: 'unknown', speed: null, utilisation: null, lastclock: null });
    // The ids stay, so that a graph can still be opened for it.
    expect(row.itemids.in).toBeDefined();
  });

  it('counts an item that is not supported as not fresh, whatever value it kept', () => {
    const broken = port(1).map((i) => (i.key_.includes('ifHCInOctets') ? { ...i, state: '1' } : i));
    expect(groupInterfaces(broken, NOW)[0].inBps).toBeNull();
    expect(groupInterfaces(broken, NOW)[0].outBps).toBe(1_000_000);
  });

  it('judges freshness by the item\'s own delay, three intervals and never under ten minutes, so that a slow item is not stale at a quarter of an hour (BK-95)', () => {
    // 1,000 seconds old: more than ten minutes, less than three intervals of ten.
    const slow = port(1).map((i) => ({ ...i, delay: '10m', lastclock: String(NOW - 1_000) }));
    expect(groupInterfaces(slow, NOW)[0].inBps).toBe(4_000_000);
    const quick = port(1).map((i) => ({ ...i, delay: '30s', lastclock: String(NOW - 1_000) }));
    expect(groupInterfaces(quick, NOW)[0].inBps).toBeNull();
    // Under ten minutes is fresh whatever the delay says.
    const young = port(1).map((i) => ({ ...i, delay: '30s', lastclock: String(NOW - 500) }));
    expect(groupInterfaces(young, NOW)[0].inBps).toBe(4_000_000);
  });

  it('reads the errors and the discards, and an empty value as none', () => {
    const items = [
      ...port(1),
      item('net.if.in.errors[ifInErrors.1]', 'Interface Gi1/0/1(Uplink): Inbound packets with errors', '3'),
      item('net.if.out.errors[ifOutErrors.1]', 'Interface Gi1/0/1(Uplink): Outbound packets with errors', ''),
      item('net.if.in.discards[ifInDiscards.1]', 'Interface Gi1/0/1(Uplink): Inbound packets discarded', '5'),
      item('net.if.out.discards[ifOutDiscards.1]', 'Interface Gi1/0/1(Uplink): Outbound packets discarded', '0'),
    ];
    expect(groupInterfaces(items, NOW)[0]).toMatchObject({ inErrors: 3, outErrors: null, inDiscards: 5, outDiscards: 0 });
  });

  it('names an interface by its index when no item says its name, and leaves the walk items out', () => {
    const rows = groupInterfaces([item('net.if.in[ifHCInOctets.9]', 'Incoming', '10'), item('net.if.walk[ifHCInOctets]', 'Walk', '0')], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('ifIndex 9');
  });

  it('keeps the first name it meets, and reads an unknown status code as unknown', () => {
    const items = [
      item('net.if.status[ifOperStatus.4]', 'Interface eth0(first): Operational status', '99'),
      item('net.if.in[ifHCInOctets.4]', 'Interface other(second): Bits received', '1'),
    ];
    const [row] = groupInterfaces(items, NOW);
    expect(row.name).toBe('eth0');
    expect(row.operStatus).toBe('unknown');
  });

  it('puts the rows in the natural order of their names, then by index: Gi1/0/2 before Gi1/0/10', () => {
    const rows = groupInterfaces([...port(10), ...port(2), ...port(1)], NOW);
    expect(rows.map((r) => r.name)).toEqual(['Gi1/0/1', 'Gi1/0/2', 'Gi1/0/10']);
  });

  it('is nothing for a host with no interface items', () => {
    expect(groupInterfaces([], NOW)).toEqual([]);
  });
});

describe('statusBucket', () => {
  it('sorts the statuses into up, down and the rest, the layer below being down counts as down', () => {
    expect(statusBucket('up')).toBe('up');
    expect(statusBucket('down')).toBe('down');
    expect(statusBucket('lowerLayerDown')).toBe('down');
    for (const other of ['testing', 'unknown', 'dormant', 'notPresent'] as const) expect(statusBucket(other)).toBe('other');
  });
});
