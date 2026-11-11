import { describe, expect, it } from 'vitest';
import { BUSY, HOT, availability, emptyTopWords, percentUp, usageWords } from './hostsFigures';
import { tally, trouble } from '../hosts/deviceTally';
import { ESTATE, device } from '../../__tests__/hosts';

/** The counts of the Dashboard's Hosts view: host availability as Zabbix's widget counts it, and the words under the busiest hosts. */

describe('availability', () => {
  it('counts the monitored hosts by their state, and leaves out a disabled one', () => {
    expect(availability(ESTATE)).toEqual({ total: 8, up: 4, degraded: 1, down: 2, nodata: 1, maintenance: 1 });
  });

  it('adds up: every monitored host is in exactly one state', () => {
    const a = availability(ESTATE);
    expect(a.up + a.degraded + a.down + a.nodata).toBe(a.total);
  });

  it('counts a host with no state as having no data, and leaves out one that is disabled by its status or by its state', () => {
    const a = availability([
      device('1', 'A', 'switch', { state: undefined }),
      device('2', 'B', 'switch', { status: '1', state: 'up' }),
      device('3', 'C', 'switch', { state: 'disabled' }),
    ]);
    expect(a).toMatchObject({ total: 1, nodata: 1, up: 0 });
  });

  it('counts maintenance among the monitored hosts, whatever their state, and not as a state of its own', () => {
    const a = availability([device('1', 'A', 'switch', { maintenance_status: '1' }), device('2', 'B', 'switch', { maintenance_status: '1', state: 'down' })]);
    expect(a).toMatchObject({ total: 2, maintenance: 2, up: 1, down: 1 });
  });

  it('is all zeros for no hosts', () => {
    expect(availability([])).toEqual({ total: 0, up: 0, degraded: 0, down: 0, nodata: 0, maintenance: 0 });
  });
});

describe('percentUp', () => {
  it('is the share that are up, to one decimal', () => {
    expect(percentUp({ total: 8, up: 4, degraded: 1, down: 2, nodata: 1, maintenance: 0 })).toBe(50);
    expect(percentUp({ total: 139, up: 131, degraded: 0, down: 8, nodata: 0, maintenance: 0 })).toBe(94.2);
  });

  it('is null with no hosts, so a page does not write 0 percent of nothing', () => {
    expect(percentUp({ total: 0, up: 0, degraded: 0, down: 0, nodata: 0, maintenance: 0 })).toBeNull();
  });
});

describe('the words of the busiest hosts', () => {
  it('writes a use figure as a whole percent', () => {
    expect(usageWords(93.4)).toBe('93%');
    expect(usageWords(93.6)).toBe('94%');
    expect(usageWords(0.4)).toBe('0%');
    expect(usageWords(100)).toBe('100%');
  });

  it('puts the warning colour at 75 percent and the critical one at 90', () => {
    expect([BUSY, HOT]).toEqual([75, 90]);
  });

  it('says why a list is empty: no host has the item, or none has collected it lately', () => {
    expect(emptyTopWords({ key: 'cpu', label: 'x', considered: 0, current: 0, rows: [] })).toBe('No host has an item for this.');
    expect(emptyTopWords({ key: 'cpu', label: 'x', considered: 1, current: 0, rows: [] })).toBe('No current value: 1 host has the item, none collected it lately.');
    expect(emptyTopWords({ key: 'cpu', label: 'x', considered: 97, current: 0, rows: [] })).toBe('No current value: 97 hosts have the item, none collected it lately.');
  });
});

describe('the tally of a kind of device', () => {
  it('counts the devices, those with a problem and those that are down, and says so in a few words', () => {
    const t = tally(ESTATE.filter((d) => d.class === 'access-point'));
    expect(t).toEqual({ total: 1, withProblems: 1, down: 1 });
    expect(trouble(t)).toBe('1 with problems · 1 down');
    expect(trouble(tally([]))).toBe('no problems');
  });
});
