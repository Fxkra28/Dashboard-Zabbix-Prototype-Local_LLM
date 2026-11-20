import { fromZonedInput, monthBounds, monthLabel, monthOf, zonedMonthStart } from '../../shared/lib/time';
import type { DailyHours } from '../../types';

/**
 * The choices of the SLA page's range view (ADR-0018): a day, a month, a year or any two hours, and the hours of the day and days of the week that count, turned into the
 * `from`, `to`, `dayHours` and `days` the server takes. Times are on the wall clock of the report's zone, whatever the browser's.
 */

export const RANGE_MODES = ['day', 'month', 'year', 'custom'] as const;
export type RangeMode = (typeof RANGE_MODES)[number];

export const RANGE_MODE_LABEL: Record<RangeMode, string> = { day: 'Day', month: 'Month', year: 'Year', custom: 'Custom' };

/** The server refuses a longer window. */
export const MAX_RANGE_SECONDS = 366 * 86400;

/** Under this many measured hours the error budget is not shown: one five-minute outage would be 91.7 % of an hour. */
export const MIN_BUDGET_SECONDS = 24 * 3600;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `text` is a calendar date, `YYYY-MM-DD`, that exists. */
export function isDate(text: string): boolean {
  const m = DATE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const read = new Date(Date.UTC(y, mo - 1, d));
  return read.getUTCFullYear() === y && read.getUTCMonth() === mo - 1 && read.getUTCDate() === d;
}

/** The date `days` after (or before, when negative) `date`. */
export function addDays(date: string, days: number): string {
  const m = DATE.exec(date);
  if (!m) throw new Error(`Bad date: ${date}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)).toISOString().slice(0, 10);
}

const hh = (hour: number) => String(hour).padStart(2, '0');

/** A date and a whole hour of the day (0 to 23) on the wall clock of `tz`, as Unix seconds; NaN when it is not one. */
export function atHour(date: string, hour: number, tz?: string): number {
  if (!isDate(date) || !Number.isInteger(hour) || hour < 0 || hour > 23) return NaN;
  return fromZonedInput(`${date}T${hh(hour)}:00`, tz);
}

export function dayBounds(date: string, tz?: string): { from: number; to: number } {
  return { from: atHour(date, 0, tz), to: isDate(date) ? atHour(addDays(date, 1), 0, tz) : NaN };
}

export function yearBounds(year: number, tz?: string): { from: number; to: number } {
  return { from: zonedMonthStart(year, 1, tz), to: zonedMonthStart(year + 1, 1, tz) };
}

export interface RangeChoice {
  mode: RangeMode;
  day: string;
  month: string;
  year: number;
  /** Custom: a date and an hour for each end. */
  fromDate: string;
  fromHour: number;
  toDate: string;
  toHour: number;
}

/** The window a choice names, or NaN for an end that is not a time. */
export function boundsOf(c: RangeChoice, tz?: string): { from: number; to: number } {
  if (c.mode === 'day') return dayBounds(c.day, tz);
  if (c.mode === 'month') return /^\d{4}-(0[1-9]|1[0-2])$/.test(c.month) ? monthBounds(c.month, tz) : { from: NaN, to: NaN };
  if (c.mode === 'year') return Number.isInteger(c.year) && c.year >= 1970 && c.year <= 9999 ? yearBounds(c.year, tz) : { from: NaN, to: NaN };
  return { from: atHour(c.fromDate, c.fromHour, tz), to: atHour(c.toDate, c.toHour, tz) };
}

/** The server refuses a window that starts more than this long ago: Zabbix keeps its events for about a year (server/src/sli/time.ts `checkPeriodStart`). */
export const MAX_START_AGE_SECONDS = 400 * 86400;

const TOO_OLD = 'Zabbix keeps events for about a year; pick a later period.';

/** The first month a range may begin in: the earliest whose first second is within the 400 days (a range is read in whole months, and the server refuses one that began before them). */
function firstReadMonth(now: number, tz?: string): string {
  const line = now - MAX_START_AGE_SECONDS;
  const month = monthOf(line, tz);
  if (monthBounds(month, tz).from >= line) return month;
  const [year, mon] = month.split('-').map(Number);
  return mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`;
}

/**
 * Why a window cannot be asked for, in words, or null when it can. With `now` the start is judged as the server judges it: it must have begun, and neither it nor the month it begins in
 * may be more than 400 days back, so that a choice the server will refuse is said here and is not sent (FR-67). `tz` is the report's zone, which cuts the months.
 */
export function windowProblem(from: number, to: number, now?: number, tz?: string): string | null {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 'Choose a date and an hour for each end.';
  if (from >= to) return 'The start must be before the end.';
  if (to - from > MAX_RANGE_SECONDS) return 'A range can cover at most 366 days.';
  if (now !== undefined && from >= now) return 'That period has not started yet.';
  if (now !== undefined && from < now - MAX_START_AGE_SECONDS) return TOO_OLD;
  if (now !== undefined && monthBounds(monthOf(from, tz), tz).from < now - MAX_START_AGE_SECONDS) {
    return `${TOO_OLD} A range is read from the start of the month it begins in, so start in ${monthLabel(firstReadMonth(now, tz))} or later.`;
  }
  return null;
}

/** The years a Year choice may offer: the current one, and an earlier one only while its first day is within what the server answers for. Last year is offered until early February (FR-67). */
export function offeredYears(now: number, tz?: string): number[] {
  const current = Number(monthOf(now, tz).slice(0, 4));
  const years = [current];
  for (let y = current - 1; y >= 1970; y--) {
    if (yearBounds(y, tz).from < now - MAX_START_AGE_SECONDS) break;
    years.push(y);
  }
  return years;
}

export interface HoursChoice {
  /** 0 to 23. */
  start: number;
  /** 1 to 24; not after `start` means through midnight into the next morning. */
  end: number;
  /** Monday 1 to Sunday 7. Empty is every day. */
  days: number[];
}

export const ALL_DAY: HoursChoice = { start: 0, end: 24, days: [] };

/** Whether the choice keeps every hour of every day, so that nothing is sent. */
export const keepsEverything = (h: HoursChoice): boolean => h.start === 0 && h.end === 24 && (h.days.length === 0 || h.days.length === 7);

/** The two parameters the server takes for a choice: either, or both, or neither. */
export function hoursQuery(h: HoursChoice): { dayHours?: string; days?: string } {
  if (keepsEverything(h)) return {};
  const q: { dayHours?: string; days?: string } = {};
  if (!(h.start === 0 && h.end === 24)) q.dayHours = `${h.start}-${h.end}`;
  if (h.days.length > 0 && h.days.length < 7) q.days = [...new Set(h.days)].sort((a, b) => a - b).join(',');
  return q;
}

/** `start` and `end` the same hour keeps nothing, or everything, and the server refuses it. */
export const hoursProblem = (h: HoursChoice): string | null =>
  h.start === h.end % 24 && !(h.start === 0 && h.end === 24) ? 'The hours must start and end at different times.' : null;

/** Parses the days of the address, `1,2,3,4,5`, into the days it names. Anything else is none. */
export function parseDays(text: string): number[] {
  if (!/^[1-7](,[1-7])*$/.test(text)) return [];
  return [...new Set(text.split(',').map(Number))].sort((a, b) => a - b);
}

export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** "Monday to Friday", "Monday, Wednesday and Friday", or "every day". */
export function daysText(days: number[] | null): string {
  const set = [...new Set(days ?? [])].sort((a, b) => a - b);
  if (set.length === 0 || set.length === 7) return 'every day';
  const names = set.map((d) => WEEKDAY_NAMES[d - 1]);
  const run = set.length >= 3 && set.every((d, i) => i === 0 || d === set[i - 1] + 1);
  if (run) return `${names[0]} to ${names[names.length - 1]}`;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "08:00 to 17:00, Monday to Friday", the hours as the report says them. */
export function hoursText(h: DailyHours): string {
  const clock = `${hh(h.start)}:00 to ${hh(h.end)}:00`;
  const when = h.end <= h.start ? `${clock} the next morning` : clock;
  const all = h.start === 0 && h.end === 24;
  return `${all ? 'all day' : when}, ${daysText(h.weekdays)}`;
}

/** Whole hours of measured time, for a sentence: "189 hours". */
export const measuredHoursText = (seconds: number): string => {
  const hours = seconds / 3600;
  const n = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `${n} ${n === '1' ? 'hour' : 'hours'}`;
};

const STAMP = new Map<string, Intl.DateTimeFormat>();

/** "3 Nov 2026, 00:00" on the wall clock of `tz`. */
function stamp(seconds: number, tz: string): string {
  let fmt = STAMP.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    STAMP.set(tz, fmt);
  }
  return fmt.format(new Date(seconds * 1000));
}

/**
 * A range as a person reads it, for the name of a button, the title of a dialog and the line after a send: the two times, the end being the first moment after the range,
 * and the hours that count when they are not the whole day.
 */
export function rangeWords(from: number, to: number, hours: HoursChoice, tz: string): string {
  const times = `${stamp(from, tz)} to ${stamp(to, tz)}`;
  if (keepsEverything(hours)) return times;
  return `${times}, ${hoursText({ start: hours.start, end: hours.end, weekdays: hours.days.length > 0 && hours.days.length < 7 ? hours.days : null })}`;
}
