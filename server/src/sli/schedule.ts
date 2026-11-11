import type { Schedule, SendRecord } from '../core/state.js';
import { monthOf, previousMonth, zonedTime } from './time.js';

/**
 * When the monthly report is due and what to do about it now. Pure: the clock is an argument, so every case is a plain call.
 *
 * The report of a month is sent on day D of the month after it, at a time of day in the report's zone. Zabbix gets ten
 * minutes after that to hold the last values, and a send that does not go is tried again for a week.
 */

/** Zabbix collects every minute or so; this lets the last values of the month land before the figures are read. */
export const SETTLE_SECONDS = 600;
/** After this a slot is not sent any more: a report a week late is a different report to the person who reads it. */
export const CATCH_UP_SECONDS = 7 * 86400;
/** The wait after the first failure, the second, and every one after: a login may be fixed, a network may come back. */
export const RETRY_AFTER_SECONDS = [900, 3600, 14400] as const;

export const retryDelay = (attempts: number): number => RETRY_AFTER_SECONDS[Math.min(Math.max(attempts, 1), RETRY_AFTER_SECONDS.length) - 1]!;

const nextMonth = (month: string): string => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/** The instant the report of `month` is due: `day` of the month after it, at `time` (HH:MM) in `tz`. */
export function slotFor(month: string, day: number, time: string, tz: string): number {
  const [y, m] = nextMonth(month).split('-').map(Number) as [number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return zonedTime(y, m, day, hh, mm, tz);
}

/** The newest slot that has come by `now`, with the month it is for. */
export function latestSlot(now: number, day: number, time: string, tz: string): { month: string; slot: number } {
  const last = previousMonth(monthOf(now, tz));
  const slot = slotFor(last, day, time, tz);
  if (slot <= now) return { month: last, slot };
  const before = previousMonth(last);
  return { month: before, slot: slotFor(before, day, time, tz) };
}

/** More months than the 24 records can mark as gone, so only a broken month step ever reaches the end. */
const MAX_LOOK_AHEAD = 120;

/** The first slot still to come after `now`, passing over a month that is `done`: it went, and moving the day does not send it again. */
export function nextSlot(now: number, day: number, time: string, tz: string, done: ReadonlySet<string> = new Set()): { month: string; slot: number } {
  let month = previousMonth(monthOf(now, tz));
  for (let i = 0; i < MAX_LOOK_AHEAD; i++, month = nextMonth(month)) {
    const slot = slotFor(month, day, time, tz);
    if (slot > now && !done.has(month)) return { month, slot };
  }
  throw new Error('No monthly slot found ahead of now.');
}

export type Plan =
  | { kind: 'off' }
  /** Nothing to do yet: the next send is for `month`, at `at`. */
  | { kind: 'wait'; month: string; slot: number; at: number }
  /** A send failed and is tried again at `at`. */
  | { kind: 'backoff'; month: string; slot: number; at: number }
  /** Due now. */
  | { kind: 'send'; month: string; slot: number; attempt: number }
  /** The week is over. `attempted`: something was tried and failed, and the other case is that the portal was not there. */
  | { kind: 'expired'; month: string; slot: number; attempted: boolean };

const FINAL = new Set(['sent', 'failed', 'missed']);

export function planNext(now: number, schedule: Schedule | null, sends: readonly SendRecord[], tz: string): Plan {
  if (!schedule || !schedule.enabled) return { kind: 'off' };
  const { month, slot } = latestSlot(now, schedule.day, schedule.time, tz);
  const own = sends.find((r) => r.trigger === 'schedule' && r.month === month);

  if (slot < schedule.enabledAt || (own && FINAL.has(own.outcome))) {
    const done = new Set(sends.filter((r) => r.trigger === 'schedule' && FINAL.has(r.outcome)).map((r) => r.month));
    const next = nextSlot(now, schedule.day, schedule.time, tz, done);
    return { kind: 'wait', month: next.month, slot: next.slot, at: next.slot + SETTLE_SECONDS };
  }
  if (now > slot + CATCH_UP_SECONDS) return { kind: 'expired', month, slot, attempted: Boolean(own) };
  if (now < slot + SETTLE_SECONDS) return { kind: 'wait', month, slot, at: slot + SETTLE_SECONDS };
  if (own?.nextAt !== undefined && own.nextAt > now) return { kind: 'backoff', month, slot, at: own.nextAt };
  return { kind: 'send', month, slot, attempt: (own?.attempts ?? 0) + 1 };
}

/** The state keeps 24 records and Zabbix about a year of events, so no older slot is looked at. */
export const MAX_SKIPPED_SLOTS = 12;

export interface SkippedSlot {
  month: string;
  slot: number;
  /** A try was made and never ended, as against none at all. */
  attempted: boolean;
}

/**
 * Slots older than the newest that no look judged, because the portal was not running through them. They are never sent
 * late, only recorded, so that the page and the people to tell know that no report went. Oldest first.
 */
export function skippedSlots(now: number, schedule: Schedule | null, sends: readonly SendRecord[], tz: string): SkippedSlot[] {
  if (!schedule || !schedule.enabled) return [];
  const found: SkippedSlot[] = [];
  let month = previousMonth(latestSlot(now, schedule.day, schedule.time, tz).month);
  for (let i = 0; i < MAX_SKIPPED_SLOTS; i++, month = previousMonth(month)) {
    const slot = slotFor(month, schedule.day, schedule.time, tz);
    if (slot < schedule.enabledAt) break;
    const own = sends.find((r) => r.trigger === 'schedule' && r.month === month);
    if (!own || !FINAL.has(own.outcome)) found.push({ month, slot, attempted: Boolean(own) });
  }
  return found.reverse();
}
