import type { Meter, MeterLevel, MeterZone, MetersResponse } from '../../types';
import { formatAxis, formatValue } from '../../shared/lib/units';
import { count } from '../../shared/lib/plural';
import { staleWhen } from '../../shared/lib/freshness';
import { monthOf } from '../../shared/lib/time';

/**
 * The dial of one internet traffic meter, as numbers and words: Gauge.tsx draws them.
 * One drawing unit is about one pixel at the width a tile usually has.
 */
export const DIAL = {
  width: 244,
  height: 122,
  cx: 122,
  cy: 100,
  /** The middle of the coloured band. */
  radius: 68,
  /** The coloured band is this thick, with a frame of a couple of units either side that keeps its edge readable. */
  band: 11,
  frame: 15,
} as const;

const round = (n: number) => Math.round(n * 100) / 100;

/** A point on the dial: fraction 0 is the left end of the half circle, 1 the right end, 0.5 the top. */
export function dialPoint(fraction: number, radius: number): { x: number; y: number } {
  const angle = Math.PI * (1 - fraction);
  return { x: round(DIAL.cx + radius * Math.cos(angle)), y: round(DIAL.cy - radius * Math.sin(angle)) };
}

/** The path of the arc between two fractions of the dial, travelling left to right over the top. */
export function arcPath(from: number, to: number, radius: number = DIAL.radius): string {
  const a = dialPoint(from, radius);
  const b = dialPoint(to, radius);
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 0 1 ${b.x} ${b.y}`;
}

export interface Segment {
  from: number;
  to: number;
  level: MeterLevel;
}

/** The zones as stretches of the dial, 0 to 1. A zone outside the scale, or with no width, is left out. */
export function segments(zones: MeterZone[], min: number, max: number): Segment[] {
  const span = max - min;
  if (!(span > 0)) return [];
  const at = (v: number) => Math.min(1, Math.max(0, (v - min) / span));
  return zones
    .map((z, i) => ({ from: at(z.from), to: i + 1 < zones.length ? at(zones[i + 1].from) : 1, level: z.level }))
    .filter((s) => s.to > s.from);
}

export interface Tick {
  fraction: number;
  text: string;
}

/** Closer than this to a label already placed (a tenth of the dial and a bit), a label would run into it. */
const TICK_GAP = 0.14;

/** Where the scale is written: both ends, and wherever a zone starts unless that is too near another label. */
export function ticks(zones: MeterZone[], min: number, max: number, units: string): Tick[] {
  const span = max - min;
  if (!(span > 0)) return [];
  const inner = zones
    .map((z) => z.from)
    .filter((v) => v > min && v < max)
    .sort((a, b) => a - b);
  const out: Tick[] = [{ fraction: 0, text: formatAxis(min, units) }];
  for (const v of inner) {
    const f = (v - min) / span;
    if (f - out[out.length - 1].fraction >= TICK_GAP && 1 - f >= TICK_GAP) out.push({ fraction: f, text: formatAxis(v, units) });
  }
  out.push({ fraction: 1, text: formatAxis(max, units) });
  return out;
}

/** The word for a zone, as the chip under a gauge says it. `none` has none. */
export const LEVEL_WORD: Record<MeterLevel, string | null> = {
  none: null,
  low: 'Low',
  ok: 'Normal',
  warn: 'High',
  critical: 'Critical',
};

/** How far along the scale the value is, in percent, not held to 100: a link over its capacity says so. Null with no value or no scale. */
export function percentOf(m: Meter): number | null {
  if (m.value === null || m.max === null || !(m.max > m.min)) return null;
  return Math.round(((m.value - m.min) / (m.max - m.min)) * 100);
}

export const valueWords = (m: Meter): string => formatValue(m.value, m.units);

export const capacityWords = (m: Meter): string => (m.max === null ? '' : formatValue(m.max, m.units));

/** What the line under a gauge says: the zone and the share of the capacity, or why there is no gauge. */
export function footWords(m: Meter, now: number): string {
  // A dead link reads 0 like an idle one, so this comes before the reading's own words.
  if (m.link === 'down') return 'Interface down, not an idle link.';
  switch (m.state) {
    case 'ok': {
      const word = m.zone ? LEVEL_WORD[m.zone] : null;
      const pct = percentOf(m);
      const share = pct === null ? '' : `${pct}% of ${capacityWords(m)}`;
      return [word, share].filter(Boolean).join(' · ');
    }
    case 'stale':
      return m.clock === null ? 'An old reading.' : `Old reading, ${staleWhen(m.clock * 1000, now)}`;
    case 'nodata':
      return 'No value has been collected.';
    case 'unsupported':
      return 'The item is disabled or not supported in Zabbix.';
    case 'missing':
      return 'The widget points at an item that no longer exists. Fix the widget in Zabbix.';
    case 'invalid':
      return 'The Zabbix widget has no usable scale: its maximum is missing or not above its minimum.';
  }
}

/**
 * The Graphs page for a link: its own item first, then the other direction. An old reading opens the month it is from, as the last day would show nothing.
 * Null for a meter with no item or host to graph.
 */
export function historyLink(m: Meter): string | null {
  if (!m.itemid || !m.hostid) return null;
  const items = [m.itemid, m.other?.itemid].filter(Boolean).join(',');
  const month = m.state === 'stale' && m.clock !== null ? `&month=${monthOf(m.clock)}` : '';
  return `/graphs?hostid=${m.hostid}&itemid=${items}${month}`;
}

/** The big text of a gauge: the value, or what stands in for one. */
export function headline(m: Meter): string {
  if (m.link === 'down') return 'Down';
  switch (m.state) {
    case 'ok':
    case 'stale':
    case 'invalid':
      return valueWords(m);
    case 'nodata':
      return 'No data';
    case 'unsupported':
      return 'Not collected';
    case 'missing':
      return 'Not found';
  }
}

/** Whether a gauge is drawn: it needs a scale, and an item that can be read. */
export const hasDial = (m: Meter): boolean => m.max !== null && (m.state === 'ok' || m.state === 'stale' || m.state === 'nodata');

/**
 * The other direction, written only when it is High or Critical now, as a gauge that counts one direction cannot show it.
 * "Out 38.2 Mbps · 77% of 50 Mbps · Critical"; null otherwise.
 */
export function otherWords(m: Meter): string | null {
  const o = m.other;
  if (!o || o.value === null || (o.zone !== 'warn' && o.zone !== 'critical')) return null;
  const pct = m.max !== null && m.max > m.min ? Math.round(((o.value - m.min) / (m.max - m.min)) * 100) : null;
  const share = pct === null ? '' : `${pct}% of ${capacityWords(m)}`;
  return [`${o.direction === 'in' ? 'In' : 'Out'} ${formatValue(o.value, m.units)}`, share, LEVEL_WORD[o.zone]].filter(Boolean).join(' · ');
}

/** One sentence over the grid: how many links, how many are down, high or critical (in either direction), old, or without a gauge. */
export function summaryWords(s: MetersResponse['summary']): string {
  if (s.total === 0) return 'No links.';
  const parts = [count(s.total, 'link')];
  if (s.down > 0) parts.push(`${s.down} down`);
  const levels = [s.critical > 0 ? `${s.critical} critical` : '', s.warn > 0 ? `${s.warn} high` : ''].filter(Boolean);
  if (levels.length) parts.push(levels.join(', '));
  else if (s.current > 0) parts.push('None high or critical');
  if (s.otherHigh > 0) parts.push(`${s.otherHigh} with the other direction high or critical`);
  if (s.stale > 0) parts.push(`${s.stale} with an old reading`);
  if (s.unavailable > 0) parts.push(`${s.unavailable} without a gauge`);
  return `${parts.join('. ')}.`;
}
