import { describe, expect, it } from 'vitest';
import { parseDelay, pollSeconds } from '../core/delay.js';
import { freshWithinS } from '../domain/reachability.js';
import { parseDelay as historyParseDelay } from '../services/history.js';

/**
 * One reader of a Zabbix update interval for the graph, the freshness test and the SLA (BK-95). The graph cut a flexible interval at its first `;` and the other two did not, so the same item was 600 s on
 * the graph and 60 s in the SLA, whose expected samples an hour were then 60 where 6 are.
 */
describe('parseDelay', () => {
  it.each([
    ['60', 60],
    ['30', 30],
    ['1m', 60],
    ['5m', 300],
    ['30s', 30],
    ['1h', 3600],
    ['2d', 172_800],
    ['1w', 604_800],
    [' 30s ', 30],
    ['10m;30s/1-7,00:00-24:00', 600],
    ['1m;50s/1-5,09:00-18:00;5m/6-7,00:00-24:00', 60],
    ['{$SNMP.INTERVAL}', 60],
    ['{$ICMP_DELAY}', 60],
    ['', 60],
    [undefined, 60],
    ['soon', 60],
    ['0', 0],
  ])('reads %j as %s seconds', (raw, seconds) => {
    expect(parseDelay(raw)).toBe(seconds);
  });

  it('is the one the graph uses', () => {
    expect(historyParseDelay).toBe(parseDelay);
  });
});

describe('pollSeconds', () => {
  it('is the interval to believe a value for: the same, and 60 for an item with none of its own, which is a dependent item', () => {
    expect(pollSeconds('10m;30s/1-7,00:00-24:00')).toBe(600);
    expect(pollSeconds('5m')).toBe(300);
    expect(pollSeconds('0')).toBe(60);
    expect(pollSeconds(undefined)).toBe(60);
  });
});

describe('how old a value may be and still be believed', () => {
  it('is three intervals, and never under ten minutes, whatever the way the interval is written', () => {
    expect(freshWithinS('60')).toBe(600);
    expect(freshWithinS('5m')).toBe(900);
    expect(freshWithinS('10m;30s/1-7,00:00-24:00')).toBe(1_800);
    expect(freshWithinS('0')).toBe(600);
    expect(freshWithinS(undefined)).toBe(600);
  });
});
