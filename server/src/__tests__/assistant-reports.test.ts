import { describe, expect, it } from 'vitest';
import { capacityPeriod, capacitySection, daysOf, noiseSection, scorecardSection, topTriggersSection } from '../services/assistantReports.js';

/**
 * The report pages in a few lines each. They are asked for at the periods the pages offer, so that a question and the page share one read, and a report that has not been read before is not waited for.
 */

const TZ = 'Asia/Jakarta';
const at = (iso: string) => Date.parse(`${iso}+07:00`) / 1000;
const WEEK = { from: at('2026-11-09T00:00:00'), to: at('2026-11-16T00:00:00'), label: 'last week' };

describe('daysOf and capacityPeriod', () => {
  it('counts the whole days a window covers, from one to the most, and gives the default when there is none', () => {
    expect(daysOf(WEEK)).toBe(7);
    expect(daysOf({ from: 0, to: 3_600, label: 'x' })).toBe(1);
    expect(daysOf({ from: 0, to: 40 * 86_400, label: 'x' })).toBe(31);
    expect(daysOf({ from: 0, to: 400 * 86_400, label: 'x' }, 90)).toBe(90);
    expect(daysOf(null)).toBe(7);
  });

  it('takes the smallest period that the Capacity page offers which covers the days, or the largest', () => {
    const offered = [1, 7, 30, 90];
    expect([1, 2, 7, 8, 30, 31, 90].map((d) => capacityPeriod(d, offered))).toEqual([1, 7, 7, 30, 30, 90, 90]);
    expect(capacityPeriod(200, offered)).toBe(90);
  });
});

describe('capacitySection', () => {
  const row = (metric: string, host: string, avg: number, max: number, units = '%') => ({ metric, label: metric, itemid: '1', hostid: '1', host, name: 'n', units, avg, max, source: 'trend' as const });
  const report = (rows: ReturnType<typeof row>[]) => ({ days: 7, metrics: [{ key: 'cpu', label: 'CPU utilisation', rows }, { key: 'memory', label: 'Memory utilisation', rows: [] }] }) as never;

  it('gives the three busiest hosts of each metric by their peak, with their average', () => {
    const text = capacitySection(report([row('cpu', 'A', 10, 40), row('cpu', 'B', 30, 95), row('cpu', 'C', 5, 20), row('cpu', 'D', 50, 70)]), { window: null, tz: TZ, budget: 900 }).text;
    expect(text.split('\n')).toEqual(['CAPACITY over the last 7 days, the busiest hosts by peak:', '- CPU utilisation: B average 30 %, peak 95 %; D average 50 %, peak 70 %; A average 10 %, peak 40 %']);
  });

  it('says that no reading is held when there is none', () => {
    expect(capacitySection(report([]), { window: null, tz: TZ, budget: 900 }).text.split('\n')[1]).toBe('- none: no reading is held for this period');
  });

  // BK-92: the interfaces are the ports busiest when the report was built, so the model is told, and does not call the list complete.
  it('says of the interfaces that only the ports busiest when the report was built are listed, and of no other metric', () => {
    const ifaces = { days: 7, metrics: [{ key: 'ifutil', label: 'Interface utilisation (busiest direction)', rows: [row('ifutil', 'SW1', 20, 60)] }, { key: 'cpu', label: 'CPU utilisation', rows: [row('cpu', 'A', 10, 40)] }] } as never;
    const lines = capacitySection(ifaces, { window: null, tz: TZ, budget: 900 }).text.split('\n');
    expect(lines[1]).toContain('only the ports that were busiest when this report was built are listed; a port that was quiet then may be missing');
    expect(lines[2]).not.toContain('busiest when this report was built');
  });

  it('says the window when the question named the span that the report reads, back from now', () => {
    const NOW = at('2026-11-18T12:30:00');
    const span = { from: NOW - 7 * 86_400, to: NOW, label: 'the last 7 days' };
    expect(capacitySection(report([row('cpu', 'A', 1, 2)]), { window: span, tz: TZ, budget: 900, now: NOW }).text.split('\n')[0]).toBe('CAPACITY over the last 7 days, from Wed 11 Nov 12:30 to Wed 18 Nov 12:30 (Asia/Jakarta), the busiest hosts by peak:');
  });

  it('says that the report read the last N days counted back from now, and not the window the question named, when they differ (BK-86)', () => {
    const NOW = at('2026-11-18T12:30:00');
    expect(capacitySection(report([row('cpu', 'A', 1, 2)]), { window: WEEK, tz: TZ, budget: 900, now: NOW }).text.split('\n')[0]).toBe(
      'CAPACITY over the last 7 days counted back from now, not last week, from Wed 11 Nov 12:30 to Wed 18 Nov 12:30 (Asia/Jakarta), the busiest hosts by peak:',
    );
  });
});

// The capacity report is kept for up to a day, so the range it read ends when it was built; a title that says "now" for it puts its figures a day later than they are (BK-86).
describe('capacitySection for a report that was built hours ago', () => {
  const NOW = at('2026-11-18T12:30:00');
  const built = NOW - 20 * 3600;
  const old = { days: 1, generatedAt: built, metrics: [{ key: 'cpu', label: 'CPU utilisation', rows: [{ metric: 'cpu', label: 'cpu', itemid: '1', hostid: '1', host: 'A', name: 'n', units: '%', avg: 1, max: 2, source: 'trend' }] }] } as never;
  const day = { from: NOW - 86_400, to: NOW, label: 'the last day' };

  it('says that the range ends when the report was built and not now, when the question named the last day', () => {
    expect(capacitySection(old, { window: day, tz: TZ, budget: 900, now: NOW }).text.split('\n')[0]).toBe(
      'CAPACITY over the last 1 day counted back from when the report was built, not the last day, from Mon 16 Nov 16:30 to Tue 17 Nov 16:30 (Asia/Jakarta), the busiest hosts by peak:',
    );
  });

  it('keeps saying "now" for a report that was built a moment ago, and for one that carries no time', () => {
    const fresh = { ...(old as object), generatedAt: NOW - 30 } as never;
    expect(capacitySection(fresh, { window: day, tz: TZ, budget: 900, now: NOW }).text.split('\n')[0]).toContain('the last day');
    expect(capacitySection(fresh, { window: day, tz: TZ, budget: 900, now: NOW }).text.split('\n')[0]).not.toContain('counted back');
  });
});

describe('noiseSection', () => {
  const trigger = (over: Record<string, unknown> = {}) => ({ objectid: '1', name: 'Link down', host: 'A-SW1', hostid: '1', severity: '3', count: 120, medianDuration: 180, shortLived: 100, ackRate: 0, totalDuration: 1, longest: 1, stillOpen: false, flags: ['flapping', 'unactioned'], ...over });
  const report = (triggers: unknown[]) => ({ from: 0, to: 1, windowSeconds: 7 * 86_400, minSeverity: 0, truncated: false, totalEvents: 1240, distinctTriggers: 85, concentration: { topN: 5, percentOfEvents: 61.6 }, counts: { flapping: 12, unactioned: 30, chronic: 4 }, thresholds: { shortSeconds: 300, minCount: 5 }, total: triggers.length, triggers }) as never;

  it('says how concentrated the alerts are and names the loudest triggers with how often, how long and whether anyone acknowledged them', () => {
    expect(noiseSection(report([trigger(), trigger({ name: 'High packets loss', host: 'B-FW1', severity: '2', count: 40, medianDuration: 60, ackRate: 0.25, flags: [] })]), { window: null, tz: TZ, budget: 900 }).text.split('\n')).toEqual([
      'ALERT NOISE over the last 7 days: 1240 alerts from 85 triggers; the loudest 5 made 62 percent of them; 12 flapping, 30 never acknowledged, 4 chronic:',
      '- [Average] A-SW1: Link down x120, median 3 min, acknowledged 0 percent; flapping',
      '- [Warning] B-FW1: High packets loss x40, median 1 min, acknowledged 25 percent',
    ]);
  });

  it('gives five at most', () => {
    expect(noiseSection(report(Array.from({ length: 9 }, (_, i) => trigger({ objectid: String(i) }))), { window: null, tz: TZ, budget: 2_000 }).text.split('\n')).toHaveLength(6);
  });
});

describe('topTriggersSection', () => {
  const report = (triggers: unknown[], truncated = false) => ({ triggers, truncated, days: 7 }) as never;
  const t = (name: string, count: number) => ({ objectid: '1', name, severity: '4', host: 'A-FW1', count });

  it('names the triggers with the most problem events, and says when the counts are a floor', () => {
    expect(topTriggersSection(report([t('Unavailable by ICMP ping', 200), t('High ICMP ping loss', 90)], true), { window: null, tz: TZ, budget: 900 }).text.split('\n')).toEqual([
      'TOP TRIGGERS over the last 7 days, by problem events (only the newest events were read, so the counts are a floor):',
      '- [High] A-FW1: Unavailable by ICMP ping x200',
      '- [High] A-FW1: High ICMP ping loss x90',
    ]);
  });

  it('says that there is none', () => {
    expect(topTriggersSection(report([]), { window: null, tz: TZ, budget: 900 }).text.split('\n')[1]).toBe('- none: no problem event in this period');
  });
});

describe('scorecardSection', () => {
  const card = {
    dimensions: [
      { key: 'naming', label: 'Naming', hint: '', present: 140, total: 140, pct: 100, scored: true },
      { key: 'site', label: 'Site', hint: '', present: 133, total: 140, pct: 95, scored: true },
      { key: 'owner', label: 'Owner', hint: '', present: 4, total: 140, pct: 2.9, scored: true },
      { key: 'criticality', label: 'Criticality', hint: '', present: 0, total: 140, pct: 0, scored: false },
    ],
    overall: { hosts: 140, complete: 0, pct: 0 },
    groups: [{ name: 'FIREWALL DEVICES HCML', hosts: 10, complete: 0, pct: 0 }, { name: 'HCML Network', hosts: 100, complete: 5, pct: 5 }],
    gaps: [{ hostid: '1', name: 'A-SW1', site: 'x', groups: [], missing: ['owner', 'criticality'] }, { hostid: '2', name: 'B-SW2', site: 'y', groups: [], missing: ['owner'] }],
  } as never;

  it('gives the share of hosts that carry each of the things the scorecard scores, the lowest groups and the first hosts with a gap', () => {
    expect(scorecardSection(card, 900).text.split('\n')).toEqual([
      'INVENTORY AND OWNERSHIP SCORECARD: 0 percent of 140 hosts are complete (name, site, owner and criticality all present):',
      '- naming 100 percent, site 95 percent, owner 3 percent of hosts carry each',
      '- lowest groups: FIREWALL DEVICES HCML 0 percent (10 hosts), HCML Network 5 percent (100 hosts)',
      '- 2 hosts have a gap; the first: A-SW1 (missing owner, criticality); B-SW2 (missing owner)',
    ]);
  });
});
