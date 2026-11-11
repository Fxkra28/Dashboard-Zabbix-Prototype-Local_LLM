/**
 * How old the numbers on a page are, when the BFF says so.
 * Three separate things:
 *
 *   - An answer that is an old copy kept because Zabbix failed arrives with
 *     `X-Data-Stale: true` and `X-Data-Age-Seconds` (server/src/core/staleness.ts).
 *     The body is unchanged, so what the page learns is remembered against the
 *     parsed body object itself: whoever renders that object can ask.
 *   - A slow view's last copy, answered while a newer one is read, arrives with
 *     `X-Data-Refreshing: true` and the same age header. Not a failure.
 *   - `GET /api/freshness` says when Zabbix last collected a value.
 */

import { dayInZone, formatClockLabeled, formatDay } from './time';

/** How old a refreshing copy must be before a page says so: younger, it is no older than Zabbix's own data. */
export const REFRESHING_NOTICE_AFTER_S = 120;

/** Parsed body -> when the copy it came from was made (ms since epoch, null when not known), and of which kind. */
const copies = new WeakMap<object, { asOf: number | null; refreshing: boolean }>();

/** Called by the API layer for every JSON reply. Does nothing unless the reply says it is an old copy. */
export function noteStaleCopy(body: unknown, headers: Headers, receivedAt = Date.now()): void {
  if (typeof body !== 'object' || body === null) return;
  const failed = headers.get('X-Data-Stale') === 'true';
  const refreshing = !failed && headers.get('X-Data-Refreshing') === 'true';
  if (!failed && !refreshing) return;
  const raw = headers.get('X-Data-Age-Seconds');
  const age = raw === null || raw.trim() === '' ? NaN : Number(raw);
  const known = Number.isFinite(age) && age >= 0;
  if (refreshing && (!known || age < REFRESHING_NOTICE_AFTER_S)) return;
  copies.set(body, { asOf: known ? receivedAt - age * 1000 : null, refreshing });
}

/**
 * Whether `body` is an old copy: `{ asOf }` with the time the copy was made
 * (ms since epoch, null when the BFF did not say), plus `refreshing: true` for
 * one shown while a newer copy is read, or null for a live answer.
 */
export function staleCopyOf(body: unknown): { asOf: number | null; refreshing?: true } | null {
  if (typeof body !== 'object' || body === null) return null;
  const copy = copies.get(body);
  if (!copy) return null;
  return copy.refreshing ? { asOf: copy.asOf, refreshing: true } : { asOf: copy.asOf };
}

/** A span of time in a few words: "12 min", "3 h 5 min", "20 days". */
export function ageWords(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return 'under a minute';
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

/** A moment as the clock time on its own for today, with the date in front of it for another day: the report zone's, ending in its name. */
export function momentWords(ms: number, now = Date.now()): string {
  const time = formatClockLabeled(ms);
  return dayInZone(ms) === dayInZone(now) ? time : `${formatDay(ms)} ${time}`;
}

/** When an old copy was made, as the notice words it: "from 08:48 (1 h 12 min ago)", or '' when that is not known. */
export function staleWhen(asOf: number | null, now = Date.now()): string {
  return asOf === null ? '' : `from ${momentWords(asOf, now)} (${ageWords((now - asOf) / 1000)} ago)`;
}
