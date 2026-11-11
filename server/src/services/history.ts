import { zbx } from '../clients/zabbix.js';
import { cached } from '../core/cache.js';
import { config } from '../core/config.js';
import { fetchTrendsSliced } from '../sli/events.js';
import { BadRequestError, intParam, requireId } from '../core/validate.js';
import { monthBounds, parseMonth } from '../sli/time.js';

// /api/graph, shaping

export const DAY = 86_400;
/** history.get page size. A full page means "maybe more": split and re-ask. */
export const HISTORY_PAGE = 100_000;
/** Longest window /api/graph serves. */
const MAX_RANGE = 400 * DAY;
/** How far back history may stand in for missing trend rows (the trend stall). */
export const HISTORY_FILL_WINDOW = 7 * DAY;
const MAX_GRAPH_ITEMS = 4;

/** [ms, avg, min, max], min/max are null for raw (un-aggregated) history. */
export type GraphPoint = [number, number | null, number | null, number | null];

export interface ZGraphItem {
  itemid: string;
  name: string;
  key_: string;
  units: string;
  value_type: string;
  delay: string;
  hostid: string;
  hosts?: { hostid: string; name: string }[];
}

/**
 * One raw sample in a common shape: a history value is an aggregate of one
 * (num 1, min = max = value); a trend row carries its own hour's aggregate.
 */
export interface Sample {
  clock: number;
  num: number;
  sum: number;
  min: number;
  max: number;
  /** A trend row stands for an hour; a history value for one update interval. */
  trend: boolean;
}

/** Zabbix update interval → seconds. '60', '1m', '5m', '1h', '30s'; macros/unknown → 60; '0' → 0. */
export function parseDelay(raw: string | undefined): number {
  const first = String(raw ?? '').split(';')[0].trim();
  const m = /^(\d+)([smhdw]?)$/.exec(first);
  if (!m) return 60;
  const mult = { '': 1, s: 1, m: 60, h: 3600, d: DAY, w: 7 * DAY }[m[2] as '' | 's' | 'm' | 'h' | 'd' | 'w'];
  return Number(m[1]) * mult;
}

export const STEP_KEY = /^(icmpping\b|icmpping\[|net\.if\.status|web\.test\.fail)/;

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** history.get for one item over [from, to], halving the window whenever a page comes back full. */
export async function fetchHistory(
  itemid: string,
  valueType: number,
  from: number,
  to: number,
): Promise<{ clock: string; value: string }[]> {
  const rows = await zbx<{ itemid: string; clock: string; value: string }[]>('history.get', {
    itemids: [itemid],
    history: valueType,
    time_from: from,
    time_till: to,
    output: ['itemid', 'clock', 'value'],
    sortfield: 'clock',
    sortorder: 'ASC',
    limit: HISTORY_PAGE,
  });
  if (rows.length < HISTORY_PAGE || to - from < 2) return rows;
  const mid = Math.floor((from + to) / 2);
  const [a, b] = await Promise.all([
    fetchHistory(itemid, valueType, from, mid),
    fetchHistory(itemid, valueType, mid + 1, to),
  ]);
  return a.concat(b);
}

export const historySample = (r: { clock: string; value: string }): Sample | null => {
  const v = Number(r.value);
  if (!Number.isFinite(v)) return null;
  return { clock: Number(r.clock), num: 1, sum: v, min: v, max: v, trend: false };
};

interface ShapedSeries {
  points: GraphPoint[];
  downsampled: boolean;
}

/**
 * Samples → chart points. Up to `points` samples go through as they are;
 * beyond that they are folded into `points` equal time buckets (avg weighted
 * by sample count, min of mins, max of maxes). Wherever two neighbouring points
 * are further apart than 3× the expected spacing a null is inserted, so the
 * chart breaks the line instead of drawing across a collection gap.
 */
export function shapeSeries(
  samples: Sample[],
  opts: { from: number; to: number; points: number; delay: number; withBand: boolean },
): ShapedSeries {
  const { from, to, points } = opts;
  const width = (to - from) / points;
  const anyTrend = samples.some((s) => s.trend);
  const rawSpacing = median(samples.slice(1).map((s, i) => s.clock - samples[i].clock));
  const baseExpected = Math.max(opts.delay || rawSpacing, anyTrend ? 3600 : 0);

  const withGaps = (pts: GraphPoint[], expected: number): GraphPoint[] => {
    const out: GraphPoint[] = [];
    for (const p of pts) {
      const prev = out[out.length - 1];
      if (prev && p[0] - prev[0] > 3 * expected * 1000) {
        out.push([Math.round((prev[0] + p[0]) / 2), null, null, null]);
      }
      out.push(p);
    }
    return out;
  };

  if (samples.length <= points) {
    const raw = samples.map<GraphPoint>((s) => [
      s.clock * 1000,
      s.sum / s.num,
      opts.withBand ? s.min : null,
      opts.withBand ? s.max : null,
    ]);
    const shaped = withGaps(raw, baseExpected);
    if (shaped.length <= points) return { points: shaped, downsampled: false };
  }

  const buckets = new Map<number, { num: number; sum: number; min: number; max: number }>();
  for (const s of samples) {
    const i = Math.min(points - 1, Math.max(0, Math.floor((s.clock - from) / width)));
    const b = buckets.get(i);
    if (!b) buckets.set(i, { num: s.num, sum: s.sum, min: s.min, max: s.max });
    else {
      b.num += s.num;
      b.sum += s.sum;
      b.min = Math.min(b.min, s.min);
      b.max = Math.max(b.max, s.max);
    }
  }
  const bucketed = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map<GraphPoint>(([i, b]) => [
      Math.round((from + (i + 0.5) * width) * 1000),
      b.sum / b.num,
      b.min,
      b.max,
    ]);
  return { points: withGaps(bucketed, Math.max(baseExpected, width)), downsampled: true };
}

export function seriesStats(samples: Sample[]) {
  if (!samples.length) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let num = 0;
  for (const s of samples) {
    min = Math.min(min, s.min);
    max = Math.max(max, s.max);
    sum += s.sum;
    num += s.num;
  }
  const last = samples[samples.length - 1];
  return { min, avg: sum / num, max, last: last.sum / last.num, lastClock: last.clock };
}

export function seriesCoverage(samples: Sample[], from: number, to: number, delay: number) {
  if (!samples.length) return { coveredSeconds: 0, firstClock: null, lastClock: null };
  const rawSpacing = median(samples.slice(1).map((s, i) => s.clock - samples[i].clock));
  let covered = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const expected = s.trend ? 3600 : delay || rawSpacing || 60;
    const next = samples[i + 1]?.clock ?? Math.min(to, s.clock + expected);
    covered += Math.max(0, Math.min(next - s.clock, 3 * expected));
  }
  return {
    coveredSeconds: Math.min(Math.round(covered), to - from),
    firstClock: samples[0].clock,
    lastClock: samples[samples.length - 1].clock,
  };
}

export function parseItemIds(raw: unknown): string[] {
  const ids = String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) throw new BadRequestError('itemids is required (comma-separated Zabbix item ids).');
  if (ids.length > MAX_GRAPH_ITEMS) {
    throw new BadRequestError(`At most ${MAX_GRAPH_ITEMS} items can be graphed together.`);
  }
  return [...new Set(ids.map((id) => requireId(id, 'itemids')))];
}

export function parseRange(q: Record<string, string | undefined>, now: number): { from: number; to: number } {
  if (q.month !== undefined && q.month !== '') {
    const b = monthBounds(parseMonth(q.month), config.sla.timezone);
    if (b.from >= now) throw new BadRequestError('month is in the future.');
    return { from: b.from, to: Math.min(b.to, Math.ceil(now / 60) * 60) };
  }
  if ((q.from ?? '') !== '' || (q.to ?? '') !== '') {
    const from = Number(q.from);
    const to = Number(q.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from <= 0 || to <= 0) {
      throw new BadRequestError('from and to must both be Unix timestamps in seconds.');
    }
    if (from >= to) throw new BadRequestError('from must be before to.');
    if (to - from > MAX_RANGE) throw new BadRequestError('The range may not exceed 400 days.');
    // Widened to whole minutes, so requests seconds apart share a cache entry and none loses a sample.
    return { from: Math.floor(from / 60) * 60, to: Math.ceil(to / 60) * 60 };
  }
  const hours = intParam(q.hours, 24, 1, 8760);
  // Pinned to the next whole minute: every request within that minute shares a cache entry.
  const to = Math.ceil(now / 60) * 60;
  return { from: to - hours * 3600, to };
}

/**
 * Chart-ready series for 1 to 4 numeric items over a pinned window.
 *   ?itemids=a,b&hours=24 | &from=&to= | &month=YYYY-MM   [&points=1500]
 *
 * Up to a day reads raw history; longer reads hourly trends, topped up from
 * history after the last trend row (this instance stopped writing trends on
 * 2026-09-15 while history carried on). Everything is bucketed down to at
 * most `points` per series so a 30-day graph is a few tens of KB, not 500.
 */
export function getGraph({ ids, from, to, points, now }: { ids: string[]; from: number; to: number; points: number; now: number }) {
  const live = to >= now - 60;
  return cached(`graph:${ids.join(',')}:${from}:${to}:${points}`, live ? 15_000 : 600_000, async () => {
    const items = await zbx<ZGraphItem[]>('item.get', {
      itemids: ids,
      output: ['itemid', 'name', 'key_', 'units', 'value_type', 'delay', 'hostid'],
      selectHosts: ['hostid', 'name'],
      webitems: true,
    });
    const byId = new Map(items.map((i) => [i.itemid, i]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) throw new BadRequestError(`Unknown itemids: ${missing.join(', ')}.`);
    const ordered = ids.map((id) => byId.get(id)!);
    const nonNumeric = ordered.filter((i) => i.value_type !== '0' && i.value_type !== '3');
    if (nonNumeric.length) {
      throw new BadRequestError(
        `Only numeric items can be graphed; not: ${nonNumeric.map((i) => i.name).join(', ')}.`,
      );
    }

    const useTrends = to - from > DAY;
    const fillFloor = now - HISTORY_FILL_WINDOW;
    let usedHistoryFill = false;

    let trendRows: {
      itemid: string;
      clock: string;
      num: string;
      value_min: string;
      value_avg: string;
      value_max: string;
    }[] = [];
    if (useTrends) {
      // Sliced like every trend read, so a long range cannot become one
      // request too big for Zabbix's PHP. Short ranges still go out as one.
      trendRows = await fetchTrendsSliced(ids, from, to - 1, [
        'itemid',
        'clock',
        'num',
        'value_min',
        'value_avg',
        'value_max',
      ]);
    }

    const series = await Promise.all(
      ordered.map(async (item) => {
        const delay = parseDelay(item.delay);
        const vt = Number(item.value_type);
        let samples: Sample[];

        if (!useTrends) {
          const rows = await fetchHistory(item.itemid, vt, from, to - 1);
          samples = rows.map(historySample).filter((s): s is Sample => s !== null);
        } else {
          samples = trendRows
            .filter((r) => r.itemid === item.itemid)
            .map((r) => {
              const num = Number(r.num) || 1;
              return {
                clock: Number(r.clock),
                num,
                sum: Number(r.value_avg) * num,
                min: Number(r.value_min),
                max: Number(r.value_max),
                trend: true,
              };
            })
            .filter((s) => Number.isFinite(s.sum) && Number.isFinite(s.min) && Number.isFinite(s.max))
            .sort((a, b) => a.clock - b.clock);

          // Trends stop early → history for whatever recent span they miss.
          const lastTrend = samples[samples.length - 1]?.clock;
          const fillFrom = Math.max(from, lastTrend !== undefined ? lastTrend + 3600 : from, fillFloor);
          if (fillFrom < to) {
            const rows = await fetchHistory(item.itemid, vt, fillFrom, to - 1);
            const fill = rows.map(historySample).filter((s): s is Sample => s !== null);
            if (fill.length) {
              usedHistoryFill = true;
              samples = samples.concat(fill);
            }
          }
        }

        // Dependent items (every SNMP-walk interface metric) report delay '0':
        // the spacing of their own history is the best estimate of the interval.
        const raw = samples.filter((s) => !s.trend);
        const effectiveDelay = delay || median(raw.slice(1).map((s, i) => s.clock - raw[i].clock));
        const shaped = shapeSeries(samples, { from, to, points, delay: effectiveDelay, withBand: useTrends });
        const values = samples.flatMap((s) => [s.min, s.max]);
        const step =
          STEP_KEY.test(item.key_) ||
          (item.value_type === '3' && samples.length > 0 && values.every((v) => v === 0 || v === 1));

        return {
          series: {
            itemid: item.itemid,
            name: item.name,
            host: item.hosts?.[0]?.name ?? '',
            units: item.units ?? '',
            value_type: item.value_type,
            delaySeconds: effectiveDelay || (useTrends ? 3600 : 60),
            step,
            points: shaped.points,
            stats: seriesStats(samples),
            coverage: seriesCoverage(samples, from, to, effectiveDelay),
          },
          downsampled: shaped.downsampled,
        };
      }),
    );

    const lastClocks = series.map((s) => s.series.stats?.lastClock).filter((c): c is number => c != null);
    return {
      from,
      to,
      source: !useTrends ? 'history' : usedHistoryFill ? 'trend+history' : 'trend',
      series: series.map((s) => s.series),
      latestClock: lastClocks.length ? Math.max(...lastClocks) : null,
      downsampled: series.some((s) => s.downsampled),
    };
  }, { typed: true });
}
