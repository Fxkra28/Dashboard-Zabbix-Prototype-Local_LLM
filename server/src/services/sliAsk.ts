import { config, type SliProfile } from '../core/config.js';
import { BadRequestError } from '../core/validate.js';
import type { DailyHours, SliReport } from '../sli/engine.js';
import { totalSeconds } from '../sli/intervals.js';
import { checkPeriodStart, currentMonth, monthBounds, parseMonth } from '../sli/time.js';
import { checkWindow, dailySpans, monthsTouched, parseDailyHours } from '../sli/window.js';
import { forgetMonthlySli, getMonthlySli, getWindowSli } from './sli.js';

/**
 * What a caller asks the derived SLA for, in the words of a query (/api/sli, /api/sli/export) or of a body (/api/sli/email): a calendar month, or any two whole
 * hours, and the hours of the day that count (ADR-0018). One reader of those words, so that a file is for the same window as the page it came from.
 */

export type SliAsk =
  | { kind: 'month'; month: string; hours: DailyHours | null }
  | { kind: 'window'; from: number; to: number; hours: DailyHours | null };

/** The words, as they arrive: text from a query, numbers from a body. */
export interface AskWords {
  month?: unknown;
  from?: unknown;
  to?: unknown;
  dayHours?: unknown;
  days?: unknown;
}

const SECONDS = /^\d{1,12}$/;

function secondsOf(raw: unknown, name: string): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && SECONDS.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n < 0) throw new BadRequestError(`${name} must be a time in Unix seconds.`);
  return n;
}

export function parseAsk(words: AskWords): SliAsk {
  const hours = parseDailyHours(words.dayHours, words.days);
  const window = words.from !== undefined || words.to !== undefined;
  if (window && words.month) throw new BadRequestError('Give a month, or from and to, and not both.');
  if (window) return { kind: 'window', from: secondsOf(words.from, 'from'), to: secondsOf(words.to, 'to'), hours };
  return { kind: 'month', month: words.month ? parseMonth(String(words.month)) : currentMonth(config.sla.timezone), hours };
}

/** The first second of the ask and the first second after it. */
export function boundsOfAsk(ask: SliAsk): { from: number; to: number } {
  return ask.kind === 'window' ? { from: ask.from, to: ask.to } : monthBounds(ask.month, config.sla.timezone);
}

/** The refusals a read would end in, said before it starts, so a bad request costs no Zabbix call and no allowance. */
export function checkAsk(ask: SliAsk, now: number): void {
  const tz = config.sla.timezone;
  const { from, to } = boundsOfAsk(ask);
  if (ask.kind === 'window') checkWindow(from, to, now, tz);
  else checkPeriodStart(from, now);
  if (ask.hours && totalSeconds(dailySpans(ask.hours, from, Math.min(to, now), tz)) === 0) {
    throw new BadRequestError('No hour of this range falls inside the daily hours you chose.');
  }
}

/** The report for an ask: a month with nothing else asked of it is the monthly report, with its web checks; anything else is a window of the months it touches. */
export function readReport(ask: SliAsk, profile: SliProfile, signal?: AbortSignal): Promise<SliReport> {
  if (ask.kind === 'window') return getWindowSli({ from: ask.from, to: ask.to, profile, hours: ask.hours, signal });
  if (!ask.hours) return getMonthlySli(ask.month, profile, signal);
  const { from, to } = boundsOfAsk(ask);
  return getWindowSli({ from, to, profile, hours: ask.hours, month: ask.month, signal });
}

/** What a log line says of an ask: the month or the two times, and the hours when they are not the whole day. Only what was validated, never the request's own words. */
export function askForLog(ask: SliAsk): { month?: string; from?: number; to?: number; dayHours?: string; days?: string } {
  const where = ask.kind === 'window' ? { from: ask.from, to: ask.to } : { month: ask.month };
  const h = ask.hours;
  if (!h) return where;
  return { ...where, ...(h.start === 0 && h.end === 24 ? {} : { dayHours: `${h.start}-${h.end}` }), ...(h.weekdays ? { days: h.weekdays.join(',') } : {}) };
}

/** Drops what is kept of the months an ask reads, for a report that came back empty (BK-51). */
export function forgetAsk(ask: SliAsk, now: number): void {
  const { from, to } = boundsOfAsk(ask);
  const months = ask.kind === 'month' ? [ask.month] : monthsTouched(from, Math.min(to, now), config.sla.timezone);
  for (const month of months) forgetMonthlySli(month);
}
