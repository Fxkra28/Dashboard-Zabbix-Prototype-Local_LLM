import { BadRequestError } from '../core/validate.js';
import { clipIntervals, mergeIntervals, type Interval } from './intervals.js';
import type { DailyHours } from './model.js';
import { checkPeriodStart, isWholeHour, monthBounds, monthOf, zonedDate, zonedTime } from './time.js';

/**
 * The windows the SLA can be asked for beyond a calendar month (ADR-0018): a start and an end on the hour, at most a leap year long, and, inside it, the hours of the day
 * and the days of the week that count. The choices are checked here, before anything is read from Zabbix, so that a window nobody can answer costs nothing.
 */

/** The longest window: a leap year, so that a calendar year fits. */
export const MAX_WINDOW_DAYS = 366;

/** Refuses a window that is not whole hours, runs backwards, is longer than a year or began, or began in a month that started, too long ago for Zabbix's events. */
export function checkWindow(from: number, to: number, now: number, tz: string): void {
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new BadRequestError('from and to must be times, in Unix seconds.');
  if (!isWholeHour(from, tz) || !isWholeHour(to, tz)) throw new BadRequestError('from and to must be whole hours.');
  if (from >= to) throw new BadRequestError('from must be before to.');
  if (to - from > MAX_WINDOW_DAYS * 86400) throw new BadRequestError(`A range can cover at most ${MAX_WINDOW_DAYS} days.`);
  checkPeriodStart(from, now);
  // A range is read in whole months, and a month that began more than 400 days ago is refused: so is a range that begins in one, though its own start is later.
  checkPeriodStart(monthBounds(monthOf(from, tz), tz).from, now);
}

const HOURS = /^(\d{1,2})-(\d{1,2})$/;
const DAYS = /^[1-7](,[1-7])*$/;

/**
 * The daily hours of a request: `hours` as `8-17` or `22-6` (the span runs from the first hour to the second, through midnight when the second is not after the first), and `days` as
 * `1,2,3,4,5` (Monday 1 to Sunday 7). Null when neither is given, or when they keep every hour of every day.
 */
export function parseDailyHours(hours: unknown, days: unknown): DailyHours | null {
  const asked = (v: unknown) => v !== undefined && v !== '';
  if (!asked(hours) && !asked(days)) return null;
  let start = 0;
  let end = 24;
  if (asked(hours)) {
    const m = typeof hours === 'string' ? HOURS.exec(hours) : null;
    if (!m) throw new BadRequestError('dayHours must be two whole hours such as 8-17, or 22-6 to run through midnight.');
    start = Number(m[1]);
    end = Number(m[2]);
    if (start > 23 || end > 24) throw new BadRequestError('dayHours must be hours from 0 to 24: the start from 0 to 23.');
    if (start === end) throw new BadRequestError('dayHours must start and end at different hours.');
  }
  let weekdays: number[] | null = null;
  if (asked(days)) {
    if (typeof days !== 'string' || !DAYS.test(days)) throw new BadRequestError('days must be weekdays from 1 (Monday) to 7 (Sunday), separated by commas, such as 1,2,3,4,5.');
    weekdays = [...new Set(days.split(',').map(Number))].sort((a, b) => a - b);
    if (weekdays.length === 7) weekdays = null;
  }
  if (start === 0 && end === 24 && weekdays === null) return null;
  return { start, end, weekdays };
}

/** The spans of `[from, end)` that the daily hours keep: each begins on a day the choice names and belongs to that day, even when it runs past midnight. */
export function dailySpans(hours: DailyHours, from: number, end: number, tz: string): Interval[] {
  if (end <= from) return [];
  const first = zonedDate(from, tz);
  const out: Interval[] = [];
  // From the day before, so that a span begun then and still running at `from` is kept; 400 days is more than any window.
  for (let i = -1; i < 400; i++) {
    const day = new Date(Date.UTC(first.year, first.month - 1, first.day + i));
    const [year, month, date] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    if (zonedTime(year, month, date, 0, 0, tz) >= end) break;
    const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    if (hours.weekdays && !hours.weekdays.includes(weekday)) continue;
    const start = zonedTime(year, month, date, hours.start, 0, tz);
    const stop = hours.end > hours.start ? zonedTime(year, month, date, hours.end, 0, tz) : zonedTime(year, month, date + 1, hours.end, 0, tz);
    out.push([start, stop]);
  }
  return mergeIntervals(clipIntervals(out, from, end));
}

/** The calendar months, `YYYY-MM` in `tz`, that the window `[from, end)` touches, oldest first. */
export function monthsTouched(from: number, end: number, tz: string): string[] {
  const months: string[] = [];
  if (end <= from) return months;
  const last = monthOf(end - 1, tz);
  let [year, month] = monthOf(from, tz).split('-').map(Number);
  for (let guard = 0; guard < 40; guard++) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key === last) break;
    [year, month] = month === 12 ? [year + 1, 1] : [year, month + 1];
  }
  return months;
}
