/**
 * The time a question is about, read from English and Bahasa Indonesia words and cut as an exact window in the SLA time zone. The words are "tadi malam", "kemarin", "minggu lalu", "last 3 hours"
 * and the like, and the day, week and month are cut as everywhere else in the portal. A question that names no time gives none. The window that was understood is written into the prompt
 * (`windowWords`), so a wrong reading shows and is not trusted.
 */

import { currentMonth, monthBounds, previousMonth, zonedDate, zonedDayStart, zonedTime } from '../sli/time.js';

export interface PastWindow {
  /** Epoch seconds. */
  from: number;
  to: number;
  /** What the question said, in a few English words. */
  label: string;
}

/** The furthest back a window goes; the events behind it are read from Zabbix on the spot. */
export const MAX_WINDOW_DAYS = 31;

const UNIT_SECONDS: Record<string, number> = { minute: 60, hour: 3600, day: 86_400, week: 7 * 86_400, month: 30 * 86_400, year: 365 * 86_400 };

const unitOf = (word: string): keyof typeof UNIT_SECONDS =>
  /^(week|minggu|pekan)/.test(word) ? 'week' : /^(min|menit)/.test(word) ? 'minute' : /^(hour|hr|jam)/.test(word) ? 'hour' : /^(day|hari)/.test(word) ? 'day' : /^(month|bulan)/.test(word) ? 'month' : 'year';

/** Where in a day each part of it is, as hours. */
const DAY_PARTS = [
  { words: /\b(pagi|morning)\b/, label: 'morning', from: 5, to: 11 },
  { words: /\b(siang|midday|noon)\b/, label: 'midday', from: 11, to: 15 },
  { words: /\b(sore|afternoon)\b/, label: 'afternoon', from: 15, to: 18 },
  { words: /\b(malam|evening|night|tonight)\b/, label: 'evening', from: 18, to: 24 },
] as const;

/** The local calendar day `offset` days from the one `at` falls in, as Unix seconds of its midnight. */
function dayStart(at: number, tz: string, offset: number): number {
  const { year, month, day } = zonedDate(at, tz);
  const moved = new Date(Date.UTC(year, month - 1, day + offset));
  return zonedDayStart(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate(), tz);
}

/** The local time of day `hour` on the day `offset` days from now's, as Unix seconds. */
function dayHour(at: number, tz: string, offset: number, hour: number): number {
  const { year, month, day } = zonedDate(at, tz);
  const moved = new Date(Date.UTC(year, month - 1, day + offset, hour));
  return zonedTime(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate(), moved.getUTCHours(), 0, tz);
}

/** Midnight of the Monday of the week `weeksBack` weeks before now's. */
function mondayStart(at: number, tz: string, weeksBack: number): number {
  const { year, month, day } = zonedDate(at, tz);
  const sinceMonday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return dayStart(at, tz, -sinceMonday - 7 * weeksBack);
}

/** Numbers written as words, which "dua hari terakhir" and "the last two hours" use. */
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10 };
const NUMBER = `\\d+|${Object.keys(NUMBER_WORDS).join('|')}`;
const UNITS_EN = 'minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?';
const UNITS_ID = 'menit|jam|hari|minggu|pekan|bulan|tahun';
const countOf = (word: string): number => NUMBER_WORDS[word] ?? Number(word);

/** Two days, weeks or months named together read as one window: from the earlier start to now. */
const PAIRS: { first: RegExp; second: RegExp; label: string; start: (now: number, tz: string) => number }[] = [
  { first: /\b(kemarin|yesterday)\b/, second: /\b(hari ini|today)\b/, label: 'yesterday and today', start: (now, tz) => dayStart(now, tz, -1) },
  { first: /\b(minggu lalu|pekan lalu|last week|previous week)\b/, second: /\b(minggu ini|pekan ini|this week)\b/, label: 'last week and this week', start: (now, tz) => mondayStart(now, tz, 1) },
  { first: /\b(bulan lalu|last month|previous month)\b/, second: /\b(bulan ini|this month)\b/, label: 'last month and this month', start: (now, tz) => monthBounds(previousMonth(currentMonth(tz)), tz).from },
];

/** Words that make a window run from its start to now: "since yesterday", "sejak minggu lalu", "dari kemarin", "kemarin sampai sekarang". */
const SINCE = /\b(since|sejak)\b|\b(dari|from)\s+(?:kemarin|yesterday|tadi|hari ini|today|pagi|siang|sore|malam|minggu|pekan|bulan|(?:this|last|previous)\s+(?:week|month|morning|afternoon|evening|night|day|hour))\b|\b(sampai sekarang|hingga sekarang|sampai saat ini|until now|up to now|till now)\b/;

/** "Selamat pagi" and "good morning" greet the reader: they are not the morning a question is about. */
const GREETING = /\b(?:selamat|good)\s+(?:pagi|siang|sore|malam|morning|afternoon|evening|night)\b/g;

/** The window of the words of `q`, taken as they stand: a day, a week, a month, a span back from now. */
function namedWindow(q: string, now: number, tz: string, maxDays: number): PastWindow | null {
  // The night just gone: the evening before and the early morning after it.
  if (/\b(tadi malam|semalam|last night)\b/.test(q)) {
    return { from: dayHour(now, tz, -1, 18), to: Math.min(dayHour(now, tz, 0, 6), now), label: 'last night' };
  }

  // Two of them together: from the earlier start to now.
  for (const pair of PAIRS) if (pair.first.test(q) && pair.second.test(q)) return { from: pair.start(now, tz), to: now, label: pair.label };

  // "minggu kemarin" and "bulan kemarin" say last week and last month, not yesterday.
  if (/\b(minggu|pekan)\s+kemarin\b/.test(q)) return { from: mondayStart(now, tz, 1), to: mondayStart(now, tz, 0), label: 'last week' };
  if (/\bbulan\s+kemarin\b/.test(q)) {
    const { from, to } = monthBounds(previousMonth(currentMonth(tz)), tz);
    return { from, to: Math.min(to, now), label: 'last month' };
  }

  // A day, or a part of one: "kemarin", "hari ini", "kemarin sore", "tadi pagi", "this morning", "tonight", "malam ini".
  const yesterday = /\b(kemarin|yesterday)\b/.test(q);
  const today = /\b(hari ini|today|tadi|pagi ini|siang ini|sore ini|malam ini|tonight|this (morning|afternoon|evening))\b/.test(q);
  if (yesterday || today) {
    const offset = yesterday ? -1 : 0;
    const part = DAY_PARTS.find((p) => p.words.test(q.replace(/\bhari ini\b/, '')) || (/\bafternoon\b/.test(q) && p.label === 'afternoon'));
    const word = yesterday ? 'yesterday' : 'this';
    if (!part) {
      return yesterday
        ? { from: dayStart(now, tz, -1), to: dayStart(now, tz, 0), label: 'yesterday' }
        : { from: dayStart(now, tz, 0), to: now, label: 'today' };
    }
    const from = dayHour(now, tz, offset, part.from);
    const to = Math.min(dayHour(now, tz, offset, part.to), now);
    return from < to ? { from, to, label: `${word} ${part.label}` } : null;
  }

  // A span counted back from now: "last 3 hours", "tiga jam terakhir", "5 menit lalu", "2 weeks ago", "in the last hour". `ago` and `lalu` name a point; they are read as the span since it.
  const counted =
    new RegExp(`\\b(?:last|past|previous)\\s+(${NUMBER})\\s*(${UNITS_EN})\\b`).exec(q) ??
    new RegExp(`\\b(${NUMBER})\\s*(${UNITS_EN})\\s+ago\\b`).exec(q) ??
    new RegExp(`\\b(${NUMBER})\\s*(${UNITS_ID})\\s*(?:yang\\s+)?(?:terakhir|lalu|belakangan)\\b`).exec(q);
  // "seminggu terakhir", "sebulan belakangan": one of the unit, written as one word. "in the last hour", "the past day": one of the unit, with no number.
  const single =
    counted ? null : /\bse(menit|jam|hari|minggu|pekan|bulan|tahun)\s*(?:yang\s+)?(?:terakhir|belakangan)\b/.exec(q) ?? /\b(?:last|past)\s+(minute|hour|day)\b/.exec(q) ?? /\bpast\s+(week|month)\b/.exec(q);
  const span: string[] | null = counted ?? (single ? [single[0], '1', single[1]] : null);
  if (span) {
    const n = Math.max(1, countOf(span[1]));
    const unit = unitOf(span[2]);
    const wanted = n * UNIT_SECONDS[unit];
    const cap = maxDays * 86_400;
    const ago = counted !== null && /\b(ago|lalu)\b/.test(span[0]) && (unit === 'day' || unit === 'week' || unit === 'month' || unit === 'year');
    const base = n === 1 ? `the last ${unit}` : `the last ${n} ${unit}s`;
    const label = ago ? `${base} (read from "${n} ${unit}${n === 1 ? '' : 's'} ago" until now)` : base;
    return wanted > cap ? { from: now - cap, to: now, label: `${base} (cut to the last ${maxDays} days)` } : { from: now - wanted, to: now, label };
  }

  // The week and the month as the calendar has them. After the count, so that "2 minggu lalu" is two weeks back and not last week.
  if (/\b(minggu lalu|pekan lalu|last week|previous week)\b/.test(q)) return { from: mondayStart(now, tz, 1), to: mondayStart(now, tz, 0), label: 'last week' };
  if (/\b(minggu ini|pekan ini|this week)\b/.test(q)) return { from: mondayStart(now, tz, 0), to: now, label: 'this week' };
  if (/\b(bulan lalu|last month|previous month)\b/.test(q)) {
    const { from, to } = monthBounds(previousMonth(currentMonth(tz)), tz);
    return { from, to: Math.min(to, now), label: 'last month' };
  }
  if (/\b(bulan ini|this month)\b/.test(q)) return { from: monthBounds(currentMonth(tz), tz).from, to: now, label: 'this month' };

  if (/\b(barusan|baru saja|just now|a moment ago|recently|just happened)\b/.test(q)) return { from: now - 3600, to: now, label: 'the last hour' };

  return null;
}

/**
 * The time a question is about, as an exact window. Words that mean from a time until now ("since yesterday", "sejak minggu lalu") run to now, and not to the end of the day or week they name:
 * read as that day alone they left out the hours since midnight (BK-85).
 */
export function windowOf(question: string, now: number, tz: string, maxDays = MAX_WINDOW_DAYS): PastWindow | null {
  const q = question.toLowerCase().replace(GREETING, ' ');
  const base = namedWindow(q, now, tz, maxDays);
  if (!base || base.to >= now || !SINCE.test(q)) return base;
  return { from: base.from, to: now, label: `since ${base.label}` };
}

/** "Tue 17 Nov 18:00" in the zone. */
function stamp(at: number, tz: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at * 1000)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`;
}

/** The window as the prompt says it, with its exact ends: "last night, from Tue 17 Nov 18:00 to Wed 18 Nov 06:00 (Asia/Jakarta)". */
export const windowWords = (w: PastWindow, tz: string): string => `${w.label}, from ${stamp(w.from, tz)} to ${stamp(w.to, tz)} (${tz})`;
