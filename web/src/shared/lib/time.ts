/**
 * Calendar months in HCML's reporting zone, as Unix seconds. Web copy of server/src/sli/time.ts, Intl, not a fixed +7.
 * The zone is the server's SLA_TIMEZONE from /api/health (features/assistant/useAi.ts), Asia/Jakarta until it is known.
 */

export const DEFAULT_REPORT_TZ = 'Asia/Jakarta';

let reportTz = DEFAULT_REPORT_TZ;
const listeners = new Set<() => void>();

const knownZone = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** The zone the reports are cut in. */
export const reportTimeZone = (): string => reportTz;

/** Take the zone the server named; anything else (missing, not a zone) means the default. */
export function setReportTimeZone(tz: unknown): void {
  const next = knownZone(tz) ? tz : DEFAULT_REPORT_TZ;
  if (next === reportTz) return;
  reportTz = next;
  for (const fn of listeners) fn();
}

/** For useSyncExternalStore: told when the zone changes. */
export function subscribeReportTimeZone(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

const labelFormats = new Map<string, Intl.DateTimeFormat>();

/** "WIB" for Asia/Jakarta (the Indonesian locale names its three zones); elsewhere Intl's short name, such as "GMT+1". */
export function zoneLabel(atMs: number, tz = reportTz): string {
  let fmt = labelFormats.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-ID', { timeZone: tz, timeZoneName: 'short' });
    labelFormats.set(tz, fmt);
  }
  return fmt.formatToParts(new Date(atMs)).find((p) => p.type === 'timeZoneName')?.value ?? tz;
}

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

/** A moment as the browser's locale writes it, but in the report zone and ending in its label, so nobody reads it as their own clock. */
export function formatDateTime(atMs: number, tz = reportTz): string {
  let fmt = dateTimeFormats.get(tz);
  if (!fmt) {
    // The fields Date.toLocaleString() shows by default, so the text reads as it always did.
    fmt = new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    dateTimeFormats.set(tz, fmt);
  }
  return `${fmt.format(new Date(atMs))} ${zoneLabel(atMs, tz)}`;
}

const isoFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * A moment as `2026-10-19 14:05:00` in the report zone: the same digits in every browser and locale, in an order that sorts, and
 * what a spreadsheet reads as a date. The zone is not in the text, so a file that holds it names the zone once, in its heading.
 */
export function formatIsoDateTime(atMs: number, tz = reportTz): string {
  let fmt = isoFormats.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    isoFormats.set(tz, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(new Date(atMs)).map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

const clockOnlyFormats = new Map<string, Intl.DateTimeFormat>();

/** "15:04", or "15:04:05" with the seconds: the 24-hour clock of `tz`. */
export function formatClock(atMs: number, withSeconds = false, tz = reportTz): string {
  const key = `${tz}|${withSeconds}`;
  let fmt = clockOnlyFormats.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}) });
    clockOnlyFormats.set(key, fmt);
  }
  return fmt.format(new Date(atMs));
}

/** The clock ending in the zone's name, "15:04 WIB", so it is never read as the viewer's own clock. */
export const formatClockLabeled = (atMs: number, withSeconds = false, tz = reportTz): string =>
  `${formatClock(atMs, withSeconds, tz)} ${zoneLabel(atMs, tz)}`;

/** The calendar day of a moment in `tz` as 2026-10-07, for file names: not yesterday's date after midnight in Jakarta. */
export const dayInZone = (atMs: number, tz = reportTz): string => formatIsoDateTime(atMs, tz).slice(0, 10);

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** The day in `tz` as the browser's locale writes a date. */
export function formatDate(atMs: number, tz = reportTz): string {
  let fmt = dayFormats.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(undefined, { timeZone: tz });
    dayFormats.set(tz, fmt);
  }
  return fmt.format(new Date(atMs));
}

const weekdayFormats = new Map<string, Intl.DateTimeFormat>();

/** "Wed, 7 Oct 2026": the day in `tz`, for the wall clock. */
export function formatWeekdayDate(atMs: number, tz = reportTz): string {
  let fmt = weekdayFormats.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    weekdayFormats.set(tz, fmt);
  }
  return fmt.format(new Date(atMs));
}

const clockFormats = new Map<string, Intl.DateTimeFormat>();

/** The day ("7 Oct") and the hour and minute ("15:00") of a moment on the wall clock of `tz`. */
function wallClock(atMs: number, tz: string): { day: string; time: string } {
  let fmt = clockFormats.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    clockFormats.set(tz, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(new Date(atMs)).map((part) => [part.type, part.value]));
  return { day: `${p.day} ${p.month}`, time: `${p.hour}:${p.minute}` };
}

/**
 * A tick on the time axis of a chart, in the report zone: the day at midnight, otherwise the hour and minute,
 * with the day too once the range runs over two days, or when `withDay` says that the ticks need it,
 * where a bare "07:00" could be any of them.
 */
export function formatAxisTime(atMs: number, spanSeconds: number, tz = reportTz, withDay = false): string {
  const { day, time } = wallClock(atMs, tz);
  if (time === '00:00') return day;
  return withDay || spanSeconds >= 2 * 86_400 ? `${day} ${time}` : time;
}

/**
 * Whether each tick of an axis from `from` to `to` (seconds) must name its day. The chart puts its ticks on the hours of the
 * browser's own zone. In the report zone's own hours the tick at midnight names the day that follows; in any other zone midnight
 * of the report zone may fall between ticks, and a range that runs over it would show "15:00" twice with nothing to tell them apart.
 */
export function axisNeedsDays(from: number, to: number, tz = reportTz): boolean {
  if (dayInZone(from * 1000, tz) === dayInZone(to * 1000, tz)) return false;
  return offsetSeconds(to, tz) !== -new Date(to * 1000).getTimezoneOffset() * 60;
}

/** "7 Oct": the day of a moment on the wall clock of `tz`. */
export const formatDay = (atMs: number, tz = reportTz): string => wallClock(atMs, tz).day;

/** "7 Oct 15:00": a moment in the report zone, short enough for the handle of a slider. */
export function formatDayTime(atMs: number, tz = reportTz): string {
  const { day, time } = wallClock(atMs, tz);
  return `${day} ${time}`;
}

function offsetSeconds(utcSeconds: number, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(utcSeconds * 1000))
      .map((p) => [p.type, p.value]),
  );
  const asUtc =
    Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) / 1000;
  return asUtc - utcSeconds;
}

/** A moment as a datetime-local field writes it, `2026-10-07T15:00`, on the wall clock of `tz`. */
export function toZonedInput(epochSeconds: number, tz = reportTz): string {
  return formatIsoDateTime(epochSeconds * 1000, tz).slice(0, 16).replace(' ', 'T');
}

const INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** The Unix time of a datetime-local value read as the wall clock of `tz`, whatever the browser's zone; NaN when it is not a date and time. */
export function fromZonedInput(text: string, tz = reportTz): number {
  const m = INPUT_RE.exec(text);
  if (!m) return NaN;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute) / 1000;
  const read = new Date(guess * 1000);
  // A date that rolled over (the 30th of February, 25:00) is not the one typed.
  if (read.getUTCFullYear() !== year || read.getUTCMonth() !== month - 1 || read.getUTCDate() !== day || hour > 23 || minute > 59) return NaN;
  const first = guess - offsetSeconds(guess, tz);
  return guess - offsetSeconds(first, tz);
}

export function zonedMonthStart(year: number, month: number, tz = reportTz): number {
  const guess = Date.UTC(year, month - 1, 1) / 1000;
  const first = guess - offsetSeconds(guess, tz);
  return guess - offsetSeconds(first, tz);
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isMonth = (s: string | null | undefined): s is string => !!s && MONTH_RE.test(s);

export function monthBounds(month: string, tz = reportTz): { from: number; to: number } {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`Bad month: ${month}`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const next = mon === 12 ? { year: year + 1, mon: 1 } : { year, mon: mon + 1 };
  return { from: zonedMonthStart(year, mon, tz), to: zonedMonthStart(next.year, next.mon, tz) };
}

export function monthOf(atSeconds: number, tz = reportTz): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit' })
      .formatToParts(new Date(atSeconds * 1000))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}`;
}

/** The current month and the 11 before it, newest first. */
export function recentMonths(count = 12, tz = reportTz): string[] {
  const out: string[] = [];
  let [y, m] = monthOf(Math.floor(Date.now() / 1000), tz).split('-').map(Number);
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
