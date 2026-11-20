/**
 * The SLA of a window other than the month the snapshot holds: a named month, a year, a week, a run of days, and the hours of the day that count ("jam kerja"). The figures are the portal's own derived SLA by its
 * strict method, worked out from months that are read once and kept (ADR-0018), so a month not read before takes minutes on HCML's Zabbix and is said to be on its way.
 */

import { percentText } from '../export/slaReport.js';
import type { DailyHours, SliReport } from '../sli/model.js';
import { currentMonth, hourFloor, monthBounds, previousMonth } from '../sli/time.js';
import { parseDailyHours } from '../sli/window.js';
import { getWindowSli } from './sli.js';
import { HOST_NAME_MAX, promptText, section } from './assistantLines.js';
import { windowOf, windowWords, type PastWindow } from './assistantWhen.js';

export interface SlaWindow extends PastWindow {
  /** The hours of the day that count, or null for all of them. */
  hours: DailyHours | null;
  /** The hours in words, or null. */
  hoursText: string | null;
}

/**
 * The month names. A full name says the month wherever it stands. An abbreviation, and `may`, which is also a word, say it after bulan, in, for, during, of or pada, or beside a year, and
 * not bare: "which sites may miss their SLA" does not ask for May (BK-87).
 */
const MONTHS: { full: string; bare: string; context: string; n: number; name: string }[] = [
  { full: 'januari|january', bare: '', context: 'jan', n: 1, name: 'January' },
  { full: 'februari|february', bare: '', context: 'feb', n: 2, name: 'February' },
  { full: 'maret|march', bare: '', context: 'mar', n: 3, name: 'March' },
  { full: 'april', bare: '', context: 'apr', n: 4, name: 'April' },
  { full: 'mei', bare: '', context: 'may', n: 5, name: 'May' },
  { full: 'juni|june', bare: '', context: 'jun', n: 6, name: 'June' },
  { full: 'juli|july', bare: '', context: 'jul', n: 7, name: 'July' },
  { full: 'agustus|august', bare: '', context: 'agu|aug', n: 8, name: 'August' },
  { full: 'september', bare: '', context: 'sept|sep', n: 9, name: 'September' },
  { full: 'oktober|october', bare: '', context: 'okt|oct', n: 10, name: 'October' },
  { full: 'november|nopember', bare: '', context: 'nov', n: 11, name: 'November' },
  { full: 'desember|december', bare: '', context: 'des|dec', n: 12, name: 'December' },
];
const CONTEXT = '(?:bulan|in|for|during|of|pada|selama|di)\\s+(?:the\\s+month\\s+of\\s+)?';
const monthRegex = (m: (typeof MONTHS)[number]): RegExp => new RegExp(`\\b(?:${m.full})\\b|\\b${CONTEXT}(?:${m.context})\\b|\\b(?:${m.context})\\s+20\\d{2}\\b`);
const MONTH_WORDS: [RegExp, number, string][] = MONTHS.map((m) => [monthRegex(m), m.n, m.name]);

const pad = (n: number) => String(n).padStart(2, '0');

/** A month name right after two numbers: they are the days of a range of dates ("from 1 to 7 November"), not a range of hours. */
const MONTH_AFTER = new RegExp(`^\\s*(?:of\\s+)?(?:${MONTHS.map((m) => `${m.full}|${m.context}`).join('|')})\\b`);

/**
 * The hours of the day a question counts: "jam kerja" is 08:00 to 17:00 on weekdays, and "dari jam 8 sampai 17" or "08:00-17:00" is what it says. Null when it names none.
 */
export function hoursOf(question: string): { hours: DailyHours; text: string } | null {
  const q = question.toLowerCase();
  const named = /\b(jam kerja|jam kantor|jam operasional|office hours|working hours|business hours)\b/.test(q);
  const RANGE = '\\s*(\\d{1,2})(?:[.:]00)?\\s*(?:-|–|sampai|hingga|s\\/d|to|until|and|dan)\\s*(?:jam\\s*)?(\\d{1,2})(?:[.:]00)?\\b';
  // With "jam" or "pukul" in front the numbers are hours. With "from", "dari", "between" or "antara" alone they may be days: "from 1 to 7 November" is not 01:00 to 07:00.
  const bare = new RegExp(`\\b(?:from|dari|between|antara)${RANGE}`).exec(q);
  const span =
    new RegExp(`\\b(?:jam|pukul)${RANGE}`).exec(q) ??
    (bare && !MONTH_AFTER.test(q.slice(bare.index + bare[0].length)) ? bare : null) ??
    /\b(\d{1,2})[.:]00\s*(?:-|–|sampai|hingga|s\/d|to|until)\s*(\d{1,2})[.:]00\b/.exec(q);
  if (!named && !span) return null;
  const start = span ? Number(span[1]) : 8;
  const end = span ? Number(span[2]) : 17;
  if (start > 23 || end > 24 || (span && start === end)) return null;
  const everyDay = /\b(setiap hari|tiap hari|every day|7 hari|seven days)\b/.test(q);
  const weekdays = !everyDay && (named || /\b(hari kerja|weekdays?|senin (?:sampai|hingga|-) jumat|monday (?:to|-) friday)\b/.test(q)) ? '1,2,3,4,5' : undefined;
  const hours = parseDailyHours(`${start}-${end}`, weekdays);
  if (!hours) return null;
  return { hours, text: `${pad(start)}:00 to ${pad(end)}:00${weekdays ? ' on weekdays' : ''}` };
}

/** Whole hours, as the SLA engine asks for; null when nothing is left. */
function wholeHours(w: PastWindow): PastWindow | null {
  const from = hourFloor(w.from);
  const to = hourFloor(w.to);
  return to > from ? { ...w, from, to } : null;
}

/**
 * The window a question about the SLA names: a month by name (the latest one that has begun, or the year it says), this year or last, or any window that `windowOf` reads, up to a year; with the hours
 * of the day. Null when it names no time, and the snapshot's own figures answer it.
 */
export function slaWindowOf(question: string, now: number, tz: string): SlaWindow | null {
  const q = question.toLowerCase();
  const thisMonth = currentMonth(tz);
  const [thisYear, thisMon] = thisMonth.split('-').map(Number);
  let window: PastWindow | null = null;

  // This month said in the same breath is the answer: a name beside it is a word of the sentence.
  const named = /\b(bulan ini|this month)\b/.test(q) ? undefined : MONTH_WORDS.find(([re]) => re.test(q));
  const yearSaid = /\b(20\d{2})\b/.exec(q)?.[1];
  if (named) {
    const year = yearSaid ? Number(yearSaid) : named[1] > thisMon ? thisYear - 1 : thisYear;
    if (year < thisYear || (year === thisYear && named[1] <= thisMon)) {
      const { from, to } = monthBounds(`${year}-${pad(named[1])}`, tz);
      window = { from, to: Math.min(to, now), label: `${named[2]} ${year}` };
    }
  } else if (/\b(tahun ini|this year)\b/.test(q)) {
    window = { from: monthBounds(`${thisYear}-01`, tz).from, to: now, label: 'this year' };
  } else if (/\b(tahun lalu|last year)\b/.test(q)) {
    window = { from: monthBounds(`${thisYear - 1}-01`, tz).from, to: monthBounds(`${thisYear}-01`, tz).from, label: `last year (${thisYear - 1})` };
  } else {
    window = windowOf(question, now, tz, 366);
  }
  const whole = window ? wholeHours(window) : null;
  if (!whole) return null;
  const hours = hoursOf(question);
  return { ...whole, hours: hours?.hours ?? null, hoursText: hours?.text ?? null };
}

/** Whether the snapshot already holds this window: last month or this month so far, over all the hours. */
export function snapshotHolds(w: SlaWindow, now: number, tz: string): boolean {
  if (w.hours) return false;
  const month = currentMonth(tz);
  const last = monthBounds(previousMonth(month), tz);
  return (w.from === last.from && w.to === last.to) || (w.from === monthBounds(month, tz).from && w.to === hourFloor(now));
}

export function slaSection(report: SliReport, w: SlaWindow, tz: string, budget: number): { text: string; truncated: boolean } {
  const target = report.target;
  const pct = (v: number | null) => (v === null ? 'no data' : percentText(v, target));
  const o = report.overall;
  const counted = w.hoursText ? `, counting only ${w.hoursText}` : '';
  const title = `SLA of ${windowWords(w, tz)}${counted}, by the strict method (target ${target}%): ${pct(o.sli)}, ${o.meeting ? 'met' : 'missed'} (${o.withData} of ${o.hosts} devices with data):`;
  const lines: string[] = [];
  const sites = report.sites.filter((g) => g.sli !== null && g.sli < target).sort((a, b) => (a.sli ?? 0) - (b.sli ?? 0));
  if (sites.length) lines.push(`- ${sites.length} site${sites.length === 1 ? '' : 's'} below target: ${sites.slice(0, 6).map((g) => `${promptText(g.name, HOST_NAME_MAX)} ${pct(g.sli)}`).join(', ')}${sites.length > 6 ? ', and more' : ''}`);
  const worst = report.hosts.filter((h) => h.sli !== null && h.sli < target).sort((a, b) => (a.sli ?? 0) - (b.sli ?? 0)).slice(0, 3);
  if (worst.length) lines.push(`- worst devices: ${worst.map((h) => `${promptText(h.name, HOST_NAME_MAX)} ${pct(h.sli)}`).join(', ')}`);
  lines.push('- planned maintenance is left out, and so are the hours in which nothing was collected');
  return section(title, lines, budget);
}

/** The report of a window, from the months it touches; refused plainly when Zabbix cannot answer it. */
export const readSlaWindow = (w: SlaWindow, signal?: AbortSignal): Promise<SliReport> => getWindowSli({ from: w.from, to: w.to, profile: 'availability', hours: w.hours, signal });
