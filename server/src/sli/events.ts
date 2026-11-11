import { zbx, ZabbixApiError } from '../clients/zabbix.js';

/**
 * Event history without silent truncation.
 *
 * A single request for the newest 10,000 events overflows at HCML's volume (a 30-day window): the
 * oldest events are the ones dropped, and the availability report then produces impossible results
 * (59.6% at severity ≥ 3 but 2.8% at severity ≥ 4). So a full page is never accepted here: the
 * window is halved until every slice fits, and a slice that cannot be made to fit is an error, not
 * a partial answer.
 */

const PAGE_LIMIT = 5_000;
const MIN_SLICE_SECONDS = 60;

export interface SliceOptions {
  pageLimit?: number;
  minSliceSeconds?: number;
}

/**
 * `event.get` over `[from, to]` (both inclusive, as Zabbix treats them), in
 * ascending clock order, every event exactly once.
 */
export async function fetchEventsSliced<T extends { eventid: string }>(
  base: Record<string, unknown>,
  from: number,
  to: number,
  opts: SliceOptions = {},
): Promise<T[]> {
  const pageLimit = opts.pageLimit ?? PAGE_LIMIT;
  const minSlice = opts.minSliceSeconds ?? MIN_SLICE_SECONDS;
  if (to < from) return [];

  const rows = await zbx<T[]>('event.get', {
    ...base,
    time_from: from,
    time_till: to,
    sortfield: ['clock', 'eventid'],
    sortorder: 'ASC',
    limit: pageLimit,
  });
  if (rows.length < pageLimit) return rows;

  if (to - from < minSlice) {
    throw new ZabbixApiError(
      `event.get: more than ${pageLimit} events within ${to - from + 1} s, too dense to report on exactly.`,
    );
  }
  // Halves that do not overlap: an event exactly on `mid` belongs to the first.
  const mid = Math.floor((from + to) / 2);
  const first = await fetchEventsSliced<T>(base, from, mid, opts);
  const second = await fetchEventsSliced<T>(base, mid + 1, to, opts);
  return [...first, ...second];
}

/**
 * Most rows one `trend.get` may return, counted as items × hour marks: 35 items
 * over a 31-day month (745 marks, both ends inclusive). That request is known
 * to work against HCML's Zabbix; a year of the same items in one request ran
 * its PHP out of memory, which the API reports as a bare "HTTP 500".
 */
export const TREND_MAX_ROWS = 35 * 745;
/** Items per request never drop below this just because the window is long; the window is cut instead. */
const TREND_MIN_ITEMS = 35;

export interface TrendSliceOptions<T> {
  /** Most rows per request, as items × hour marks. Default TREND_MAX_ROWS. */
  maxRows?: number;
  /** Requests running at once. */
  parallel?: number;
  /** Called once per request, for callers that count their Zabbix calls. */
  onRequest?: () => void;
  /**
   * Receives each request's rows as they arrive, in no particular order, and
   * nothing is kept: the call then resolves to []. A year of hourly rows for a
   * few hundred items is millions of objects a caller that only folds them
   * should never hold at once.
   */
  onRows?: (rows: T[]) => void;
}

/** Hour marks (multiples of 3600) in `[from, to]`: at most one trend row per item for each. */
export const hourMarks = (from: number, to: number): number =>
  Math.max(0, Math.floor(to / 3600) - Math.ceil(from / 3600) + 1);

/**
 * The requests `fetchTrendsSliced` makes: item chunks × time windows. Windows
 * meet at hour marks and do not overlap: each ends one second before the next
 * begins, so every trend row (clocked on the hour) lands in exactly one.
 * Exported for tests.
 */
export function trendSlices(
  itemids: string[],
  from: number,
  to: number,
  maxRows = TREND_MAX_ROWS,
): { itemids: string[]; from: number; to: number }[] {
  if (!itemids.length || to < from) return [];
  const marks = Math.max(1, hourMarks(from, to));
  const perRequest = Math.min(itemids.length, Math.max(TREND_MIN_ITEMS, Math.floor(maxRows / marks)));
  const windowHours = Math.max(1, Math.floor(maxRows / perRequest));

  const windows: { from: number; to: number }[] = [];
  if (marks <= windowHours) {
    windows.push({ from, to });
  } else {
    let start = from;
    // The first window ends just before the hour mark `windowHours` marks in.
    let mark = Math.ceil(from / 3600) * 3600 + windowHours * 3600;
    while (start <= to) {
      const end = Math.min(to, mark - 1);
      windows.push({ from: start, to: end });
      start = mark;
      mark += windowHours * 3600;
    }
  }
  return windows.flatMap((w) => chunk(itemids, perRequest).map((ids) => ({ itemids: ids, ...w })));
}

/**
 * `trend.get` over `[from, to]` (both inclusive, as Zabbix treats them) for any
 * number of items, split across item chunks and hour-aligned windows so that
 * no request can return more than `maxRows` rows. A request that fits is sent
 * exactly as it would have been unsplit.
 *
 * Rows come back window by window in time order, unless `onRows` takes them.
 */
export async function fetchTrendsSliced<T extends { itemid: string }>(
  itemids: string[],
  from: number,
  to: number,
  output: string[],
  opts: TrendSliceOptions<T> = {},
): Promise<T[]> {
  const slices = trendSlices(itemids, from, to, opts.maxRows);
  const parts = await mapLimit(slices, opts.parallel ?? 4, async (s) => {
    opts.onRequest?.();
    const rows = await zbx<T[]>('trend.get', {
      itemids: s.itemids,
      time_from: s.from,
      time_till: s.to,
      output,
    });
    if (!opts.onRows) return rows;
    opts.onRows(rows);
    return [];
  });
  return parts.flat();
}

/** `fn` over `items` with at most `limit` running at once, results in input order. */
export async function mapLimit<I, O>(items: I[], limit: number, fn: (item: I, index: number) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** `items` in consecutive chunks of `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
