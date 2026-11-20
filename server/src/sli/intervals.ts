/**
 * Interval arithmetic for availability. Every figure the SLA pages show is a
 * sum of seconds produced here, and a mistake does not throw: it produces a
 * plausible percentage that is simply false. Intervals are `[start, end)` in
 * Unix seconds.
 */

export type Interval = [number, number];

/** Overlapping or touching intervals merged, sorted, empty ones dropped. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Merge overlapping intervals so two simultaneous problems aren't counted twice. */
export function mergedSeconds(intervals: Interval[]): { total: number; longest: number } {
  let total = 0;
  let longest = 0;
  for (const [s, e] of mergeIntervals(intervals)) {
    total += e - s;
    longest = Math.max(longest, e - s);
  }
  return { total, longest };
}

export const totalSeconds = (intervals: Interval[]): number =>
  mergeIntervals(intervals).reduce((n, [s, e]) => n + (e - s), 0);

/** The parts of `a` that also lie inside `b`. Both are merged first. */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const x = mergeIntervals(a);
  const y = mergeIntervals(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    const s = Math.max(x[i][0], y[j][0]);
    const e = Math.min(x[i][1], y[j][1]);
    if (e > s) out.push([s, e]);
    if (x[i][1] < y[j][1]) i++;
    else j++;
  }
  return out;
}

/**
 * Whether `[s, e)` shares time with `spans`, which must be merged and sorted: a binary search for the first span that ends after `s`. Counting the outages of a year inside the daily hours
 * with `intersectIntervals([iv], spans)` for each one merged and sorted every span again each time, and stalled the whole BFF for seconds (BK-79).
 */
export function touchesAny(spans: readonly Interval[], s: number, e: number): boolean {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid][1] <= s) lo = mid + 1;
    else hi = mid;
  }
  return lo < spans.length && spans[lo][0] < e;
}

/** Every interval clipped to `[from, to)`. */
export function clipIntervals(intervals: Interval[], from: number, to: number): Interval[] {
  return intervals
    .map(([s, e]): Interval => [Math.max(s, from), Math.min(e, to)])
    .filter(([s, e]) => e > s);
}

/** `[from, to)` minus `holes`. */
export function complementIntervals(holes: Interval[], from: number, to: number): Interval[] {
  const out: Interval[] = [];
  let cursor = from;
  for (const [s, e] of mergeIntervals(clipIntervals(holes, from, to))) {
    if (s > cursor) out.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < to) out.push([cursor, to]);
  return out;
}
