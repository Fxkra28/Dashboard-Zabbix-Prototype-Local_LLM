import { describe, expect, it } from 'vitest';
import { seriesSection } from '../services/assistantSeries.js';

/**
 * The course of a value over a time, as four figures: the lowest, the average, the highest and the last, the figures the Graphs page computes for the same item and window. Never the points.
 */

const TZ = 'Asia/Jakarta';
const at = (iso: string) => Date.parse(`${iso}+07:00`) / 1000;
const WINDOW = { from: at('2026-11-17T00:00:00'), to: at('2026-11-18T00:00:00'), label: 'yesterday' };

const item = (metric: string, itemid: string, over: Record<string, unknown> = {}) => ({ itemid, hostid: '10', host: '1.2.11 TANGO24D_CS9200_AS01', metric, name: 'Processor: CPU utilization', key: 'k', value: '7', units: '%', clock: 0, fresh: true, ...over }) as never;
const series = (itemid: string, over: Record<string, unknown> = {}) => ({
  itemid,
  name: 'Processor: CPU utilization',
  host: '1.2.11 TANGO24D_CS9200_AS01',
  units: '%',
  stats: { min: 2, avg: 6.4, max: 38, last: 7, lastClock: at('2026-11-17T23:55:00') },
  coverage: { coveredSeconds: 86_400, firstClock: 0, lastClock: 0 },
  points: [],
  ...over,
});
const graph = (list: unknown[], source = 'history') => ({ from: WINDOW.from, to: WINDOW.to, source, series: list, latestClock: null, downsampled: false }) as never;
const opts = { host: '1.2.11 TANGO24D_CS9200_AS01', window: WINDOW, tz: TZ, budget: 900 };

describe('seriesSection', () => {
  it('gives the lowest, the average, the highest and the last of each item, with what the window was and where the figures came from', () => {
    const text = seriesSection(graph([series('5'), series('6', { name: 'Processor: Memory utilization', units: '%', stats: { min: 15, avg: 16, max: 17.5, last: 16, lastClock: 1 } })]), [item('cpu', '5'), item('memory', '6')], opts).text;
    expect(text.split('\n')).toEqual([
      'SERIES of 1.2.11 TANGO24D_CS9200_AS01 over yesterday, from Tue 17 Nov 00:00 to Wed 18 Nov 00:00 (Asia/Jakarta), from the readings:',
      '- CPU: Processor: CPU utilization: lowest 2 %, average 6.4 %, highest 38 %, last 7 % (readings for all of it)',
      '- Memory: Processor: Memory utilization: lowest 15 %, average 16 %, highest 17.5 %, last 16 % (readings for all of it)',
    ]);
  });

  it('says that the figures are from hourly trends for a longer window, and how much of the window has readings', () => {
    const text = seriesSection(graph([series('5', { coverage: { coveredSeconds: 43_200, firstClock: 0, lastClock: 0 } })], 'trend+history'), [item('cpu', '5')], opts).text;
    expect(text.split('\n')[0]).toContain('from the hourly trends:');
    expect(text).toContain('(readings for 50 percent of it)');
  });

  it('says that there is no reading when the item holds none for the window', () => {
    expect(seriesSection(graph([series('5', { stats: null })]), [item('cpu', '5')], opts).text.split('\n')[1]).toBe('- CPU: Processor: CPU utilization: no reading in this window');
  });

  it('says that none is held when Zabbix gave back nothing for the items', () => {
    expect(seriesSection(graph([]), [item('cpu', '5')], opts).text.split('\n')[1]).toBe('- none: no reading of that item is held for this window');
  });

  it('writes a temperature and a rate in the units that Zabbix gives', () => {
    const t = seriesSection(graph([series('7', { name: 'Switch 1 - HotSpot Temp Sensor: Temperature', units: '°C', stats: { min: 38, avg: 41.2, max: 50, last: 44, lastClock: 1 } })]), [item('temperature', '7', { name: 'Switch 1 - HotSpot Temp Sensor: Temperature' })], opts).text;
    expect(t).toContain('lowest 38 °C, average 41.2 °C, highest 50 °C, last 44 °C');
  });
});
