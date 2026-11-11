import { describe, expect, it } from 'vitest';
import {
  DIAL,
  arcPath,
  dialPoint,
  footWords,
  hasDial,
  headline,
  historyLink,
  otherWords,
  percentOf,
  segments,
  summaryWords,
  ticks,
  valueWords,
} from './gaugeDial';
import { meter, other, without } from '../../__tests__/meters';

/** The numbers and words behind a gauge: where things go on the dial, and what is written under it. */

const NOW = 1_800_000_000_000;

describe('dialPoint and arcPath', () => {
  it('puts 0 at the left end of the half circle, 1 at the right end and 0.5 at the top', () => {
    const r = DIAL.radius;
    expect(dialPoint(0, r)).toEqual({ x: DIAL.cx - r, y: DIAL.cy });
    expect(dialPoint(1, r)).toEqual({ x: DIAL.cx + r, y: DIAL.cy });
    expect(dialPoint(0.5, r)).toEqual({ x: DIAL.cx, y: DIAL.cy - r });
  });

  it('puts a quarter of the way up and to the left, as a clock would', () => {
    const p = dialPoint(0.25, 100);
    expect(p.x).toBeCloseTo(DIAL.cx - 70.71, 1);
    expect(p.y).toBeCloseTo(DIAL.cy - 70.71, 1);
  });

  it('draws an arc from one fraction to another, clockwise over the top, never the long way round', () => {
    expect(arcPath(0, 1)).toBe(`M ${DIAL.cx - DIAL.radius} ${DIAL.cy} A ${DIAL.radius} ${DIAL.radius} 0 0 1 ${DIAL.cx + DIAL.radius} ${DIAL.cy}`);
    expect(arcPath(0.25, 0.5, 50)).toMatch(/^M [\d.]+ [\d.]+ A 50 50 0 0 1 [\d.]+ [\d.]+$/);
  });
});

describe('segments', () => {
  const zones = [
    { from: 0, level: 'low' as const },
    { from: 125, level: 'ok' as const },
    { from: 250, level: 'warn' as const },
    { from: 375, level: 'critical' as const },
  ];

  it('turns the zones into stretches of the dial that meet and fill it', () => {
    expect(segments(zones, 0, 500)).toEqual([
      { from: 0, to: 0.25, level: 'low' },
      { from: 0.25, to: 0.5, level: 'ok' },
      { from: 0.5, to: 0.75, level: 'warn' },
      { from: 0.75, to: 1, level: 'critical' },
    ]);
  });

  it('leaves out a zone that starts at or past the top, and one with no width', () => {
    expect(segments([{ from: 0, level: 'low' }, { from: 600, level: 'critical' }], 0, 500)).toEqual([{ from: 0, to: 1, level: 'low' }]);
    expect(segments([{ from: 0, level: 'low' }, { from: 0, level: 'ok' }], 0, 500)).toEqual([{ from: 0, to: 1, level: 'ok' }]);
  });

  it('gives nothing for a scale with no width', () => {
    expect(segments(zones, 5, 5)).toEqual([]);
    expect(segments(zones, 10, 5)).toEqual([]);
  });
});

describe('ticks', () => {
  const zones = meter().zones;

  it('writes the scale at both ends and where each zone starts, in the units of the link', () => {
    expect(ticks(zones, 0, 500_000_000, 'bps')).toEqual([
      { fraction: 0, text: '0 bps' },
      { fraction: 0.25, text: '125 Mbps' },
      { fraction: 0.5, text: '250 Mbps' },
      { fraction: 0.75, text: '375 Mbps' },
      { fraction: 1, text: '500 Mbps' },
    ]);
  });

  it('drops a label that would run into its neighbour, and always keeps both ends', () => {
    const crowded = [
      { from: 0, level: 'low' as const },
      { from: 5, level: 'ok' as const },
      { from: 12, level: 'warn' as const },
      { from: 50, level: 'critical' as const },
      { from: 97, level: 'critical' as const },
    ];
    const texts = ticks(crowded, 0, 100, '').map((t) => t.fraction);
    expect(texts[0]).toBe(0);
    expect(texts[texts.length - 1]).toBe(1);
    expect(texts).toEqual([0, 0.5, 1]);
  });

  it('gives nothing for a scale with no width', () => {
    expect(ticks(zones, 5, 5, 'bps')).toEqual([]);
  });
});

describe('the words under a gauge', () => {
  it('reads the value in the units of the link, as every other page of the portal writes a rate', () => {
    expect(valueWords(meter())).toBe('212.1 Mbps');
    expect(valueWords(meter({ value: 45_320_000 }))).toBe('45.32 Mbps');
    expect(valueWords(meter({ value: 724_230 }))).toBe('724.2 Kbps');
    expect(valueWords(meter({ value: 0 }))).toBe('0 bps');
  });

  it('says the zone and the share of the capacity for a current reading', () => {
    expect(footWords(meter(), NOW)).toBe('Normal · 42% of 500 Mbps');
    expect(footWords(meter({ zone: 'critical', value: 450_000_000 }), NOW)).toBe('Critical · 90% of 500 Mbps');
    expect(footWords(meter({ zone: 'warn', value: 300_000_000 }), NOW)).toBe('High · 60% of 500 Mbps');
    expect(footWords(meter({ zone: 'low', value: 1_000_000 }), NOW)).toBe('Low · 0% of 500 Mbps');
  });

  it('gives the share alone when the zone has no meaning, and does not hold it to 100', () => {
    expect(footWords(meter({ zone: 'none' }), NOW)).toBe('42% of 500 Mbps');
    expect(footWords(meter({ value: 600_000_000, zone: 'critical' }), NOW)).toBe('Critical · 120% of 500 Mbps');
    expect(percentOf(meter({ value: 600_000_000 }))).toBe(120);
  });

  it('says how old an old reading is, and does not give its zone as if it were current', () => {
    const stale = meter({ state: 'stale', clock: NOW / 1000 - 30 * 86_400 });
    const words = footWords(stale, NOW);
    expect(words).toMatch(/^Old reading, from .+ \(30 days ago\)$/);
    expect(words).not.toMatch(/Normal|%/);
  });

  it('says why there is no value, for each way that happens', () => {
    expect(footWords(without('nodata'), NOW)).toBe('No value has been collected.');
    expect(footWords(without('unsupported'), NOW)).toMatch(/disabled or not supported/);
    expect(footWords(without('missing', { max: null }), NOW)).toMatch(/no longer exists/);
    expect(footWords(meter({ state: 'invalid', fraction: null, zone: null }), NOW)).toMatch(/no usable scale/);
  });

  it('names what the big text says: the value, or what stands in for one', () => {
    expect(headline(meter())).toBe('212.1 Mbps');
    expect(headline(meter({ state: 'stale' }))).toBe('212.1 Mbps');
    expect(headline(meter({ state: 'invalid' }))).toBe('212.1 Mbps');
    expect(headline(without('nodata'))).toBe('No data');
    expect(headline(without('unsupported'))).toBe('Not collected');
    expect(headline(without('missing'))).toBe('Not found');
  });

  it('says a dead link is dead, first, and not that its low reading is a quiet one', () => {
    const down = meter({ link: 'down', value: 0, fraction: 0, zone: 'low' });
    expect(headline(down)).toBe('Down');
    expect(footWords(down, NOW)).toBe('Interface down, not an idle link.');
    // whatever the reading was: an old one, none, or one that cannot be placed
    for (const m of [meter({ link: 'down', state: 'stale' }), without('nodata', { link: 'down' }), without('unsupported', { link: 'down' })]) {
      expect(headline(m)).toBe('Down');
      expect(footWords(m, NOW)).toMatch(/^Interface down/);
    }
  });

  it('says nothing of the link when it is up, or when its status is not known', () => {
    for (const link of ['up', 'unknown'] as const) {
      expect(headline(meter({ link }))).toBe('212.1 Mbps');
      expect(footWords(meter({ link }), NOW)).toBe('Normal · 42% of 500 Mbps');
    }
  });

  it('draws a dial for a reading, an old reading and a link with no data yet, and for nothing else', () => {
    expect(hasDial(meter())).toBe(true);
    expect(hasDial(meter({ state: 'stale' }))).toBe(true);
    expect(hasDial(without('nodata'))).toBe(true);
    expect(hasDial(without('missing', { max: null }))).toBe(false);
    expect(hasDial(without('unsupported'))).toBe(false);
    expect(hasDial(meter({ state: 'invalid', max: null }))).toBe(false);
  });
});

describe('summaryWords', () => {
  const s = (over: Partial<Parameters<typeof summaryWords>[0]> = {}) => ({ total: 26, current: 10, critical: 0, warn: 0, stale: 0, unavailable: 0, down: 0, otherHigh: 0, ...over });

  it('counts the links and names the high and critical ones', () => {
    expect(summaryWords(s({ critical: 1, warn: 3 }))).toBe('26 links. 1 critical, 3 high.');
    expect(summaryWords(s({ warn: 2 }))).toBe('26 links. 2 high.');
  });

  it('says none are high or critical when something is current and nothing is', () => {
    expect(summaryWords(s())).toBe('26 links. None high or critical.');
  });

  it('adds the old readings and the links without a gauge', () => {
    expect(summaryWords(s({ critical: 1, stale: 9, unavailable: 4 }))).toBe('26 links. 1 critical. 9 with an old reading. 4 without a gauge.');
  });

  it('says nothing about zones when nothing is current, and "1 link" for one', () => {
    expect(summaryWords(s({ current: 0, stale: 26 }))).toBe('26 links. 26 with an old reading.');
    expect(summaryWords(s({ total: 1, current: 1 }))).toBe('1 link. None high or critical.');
    expect(summaryWords(s({ total: 0, current: 0 }))).toBe('No links.');
  });

  it('puts the links that are down first, as they are the worst news, and counts them with nothing else current', () => {
    expect(summaryWords(s({ down: 2, critical: 1, warn: 3 }))).toBe('26 links. 2 down. 1 critical, 3 high.');
    expect(summaryWords(s({ down: 2 }))).toBe('26 links. 2 down. None high or critical.');
    expect(summaryWords(s({ current: 0, stale: 24, unavailable: 2, down: 1 }))).toBe('26 links. 1 down. 24 with an old reading. 2 without a gauge.');
  });

  it('says how many have the other direction high or critical, after the ones the gauges count', () => {
    expect(summaryWords(s({ warn: 1, otherHigh: 1 }))).toBe('26 links. 1 high. 1 with the other direction high or critical.');
    expect(summaryWords(s({ otherHigh: 2, stale: 3 }))).toBe('26 links. None high or critical. 2 with the other direction high or critical. 3 with an old reading.');
  });
});

describe('otherWords', () => {
  it('writes the other direction when it is critical or high: the value, its share of the same capacity, and the zone', () => {
    expect(otherWords(meter({ direction: 'in', other: other({ value: 400_000_000, zone: 'critical', fraction: 0.8 }) }))).toBe('Out 400 Mbps · 80% of 500 Mbps · Critical');
    expect(otherWords(meter({ direction: 'out', other: other({ direction: 'in', value: 300_000_000, zone: 'warn', fraction: 0.6 }) }))).toBe('In 300 Mbps · 60% of 500 Mbps · High');
  });

  it('does not hold the share to 100, as the line under a gauge does not', () => {
    expect(otherWords(meter({ other: other({ value: 650_000_000, zone: 'critical', fraction: 1 }) }))).toBe('Out 650 Mbps · 130% of 500 Mbps · Critical');
  });

  it('writes nothing when the other direction is quiet, has no current value, or is not there', () => {
    expect(otherWords(meter({ other: other({ zone: 'low' }) }))).toBeNull();
    expect(otherWords(meter({ other: other({ zone: 'ok' }) }))).toBeNull();
    expect(otherWords(meter({ other: other({ zone: 'none' }) }))).toBeNull();
    expect(otherWords(meter({ other: other({ value: null, clock: null, fraction: null, zone: null }) }))).toBeNull();
    expect(otherWords(meter({ other: null }))).toBeNull();
  });

  it('gives the value alone when the scale cannot be used', () => {
    expect(otherWords(meter({ max: null, other: other({ value: 400_000_000, zone: 'critical', fraction: null }) }))).toBe('Out 400 Mbps · Critical');
  });
});

describe('historyLink', () => {
  it('opens the Graphs page on the link\'s own item, and the other direction beside it when there is one', () => {
    expect(historyLink(meter())).toBe('/graphs?hostid=10&itemid=1001');
    expect(historyLink(meter({ other: other({ itemid: '1101' }) }))).toBe('/graphs?hostid=10&itemid=1001,1101');
    expect(historyLink(meter({ direction: 'out', itemid: '1002', other: other({ direction: 'in', itemid: '1003' }) }))).toBe('/graphs?hostid=10&itemid=1002,1003');
  });

  it('opens the month an old reading is from, in the report\'s time zone, and nothing of the sort for a current one', () => {
    expect(historyLink(meter({ state: 'stale', clock: Date.UTC(2026, 8, 14, 7, 2) / 1000 }))).toBe('/graphs?hostid=10&itemid=1001&month=2026-09');
    expect(historyLink(meter({ clock: Date.UTC(2026, 8, 14, 7, 2) / 1000 }))).toBe('/graphs?hostid=10&itemid=1001');
    expect(historyLink(without('nodata'))).toBe('/graphs?hostid=10&itemid=1001');
  });

  it('is null when there is no item or no host to graph', () => {
    expect(historyLink(meter({ itemid: null }))).toBeNull();
    expect(historyLink(meter({ hostid: null }))).toBeNull();
  });
});
