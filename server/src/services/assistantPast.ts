/**
 * The problems that opened in a past window, closed or not, read from Zabbix's event history and grouped by host and trigger. A link that flapped twenty times is one line, which is what a question
 * like "tadi malam ada masalah apa?" or "berapa kali X down minggu ini?" needs.
 */

import { zbx } from '../clients/zabbix.js';
import { age, HOST_NAME_MAX, promptText, section, sevName, stamp } from './assistantLines.js';
import { windowWords, type PastWindow } from './assistantWhen.js';

/** One problem occurrence: when it opened, and when it closed, or null while it is open. */
export interface PastEvent {
  eventid: string;
  host: string;
  hostid: string;
  name: string;
  severity: string;
  /** Epoch seconds. */
  start: number;
  end: number | null;
}

interface Group {
  host: string;
  name: string;
  severity: number;
  times: number;
  total: number;
  lastStart: number;
  firstStart: number;
  firstEnd: number | null;
  open: boolean;
}

const NAME_MAX = 120;

/** A span as the snapshot writes one: minutes up to two hours, then hours, then days. */
function span(seconds: number): string {
  const s = Math.max(0, seconds);
  return s < 7_200 ? `${Math.max(1, Math.round(s / 60))} min` : s < 172_800 ? `${Math.round(s / 3_600)}h` : `${Math.round(s / 86_400)}d`;
}

const clock = (at: number, tz: string) => stamp(at, tz).slice(-5);
const day = (at: number, tz: string) => stamp(at, tz).slice(0, -6);

export interface PastSectionOptions {
  window: PastWindow;
  tz: string;
  now: number;
  /** The site or host the question named, or null for the whole estate. */
  scope: string | null;
  /** The lowest severity read (Zabbix's 0 to 5). */
  minSeverity: number;
  /** The read stopped at its limit, so the counts are a floor. */
  truncated: boolean;
  budget: number;
}

const floorWords = (min: number): string => (min <= 0 ? 'all severities' : `${sevName(min)} and above`);

export function pastSection(events: PastEvent[], { window, tz, now, scope, minSeverity, truncated, budget }: PastSectionOptions): { text: string; truncated: boolean } {
  const groups = new Map<string, Group>();
  for (const e of events) {
    const key = `${e.hostid || e.host}\u0000${e.name}`;
    const g = groups.get(key) ?? { host: e.host, name: e.name, severity: 0, times: 0, total: 0, lastStart: 0, firstStart: e.start, firstEnd: e.end, open: false };
    g.times++;
    g.severity = Math.max(g.severity, Number(e.severity));
    g.total += (e.end ?? now) - e.start;
    if (e.start >= g.lastStart) g.lastStart = e.start;
    if (e.start <= g.firstStart) {
      g.firstStart = e.start;
      g.firstEnd = e.end;
    }
    if (e.end === null) g.open = true;
    groups.set(key, g);
  }
  const ordered = [...groups.values()].sort((a, b) => Number(b.open) - Number(a.open) || b.severity - a.severity || b.times - a.times || b.lastStart - a.lastStart);

  const lines = ordered.map((g) => {
    const label = `- [${sevName(g.severity)}] ${promptText(g.host, HOST_NAME_MAX)}: ${promptText(g.name, NAME_MAX)}`;
    if (g.times > 1) return `${label} x${g.times}, ${span(g.total)} in all, last opened ${stamp(g.lastStart, tz)}, ${g.open ? 'still open' : 'closed'}`;
    if (g.firstEnd === null) return `${label}, since ${stamp(g.firstStart, tz)} (still open, ${age(g.firstStart, now)})`;
    const to = day(g.firstEnd, tz) === day(g.firstStart, tz) ? clock(g.firstEnd, tz) : stamp(g.firstEnd, tz);
    return `${label}, ${stamp(g.firstStart, tz)} to ${to} (${span(g.firstEnd - g.firstStart)})`;
  });

  const closed = events.filter((e) => e.end !== null).length;
  const open = events.length - closed;
  const counts = events.length ? `${events.length} opened, ${closed} closed, ${open} still open` : '0 opened';
  const cut = truncated ? ` (only the newest ${events.length} were read, so the counts are a floor)` : '';
  const title = `PROBLEMS THAT OPENED ${windowWords(window, tz)}, ${floorWords(minSeverity)}, ${scope ? `at ${promptText(scope, HOST_NAME_MAX)}` : 'across the estate'}: ${counts}${cut}`;
  return section(title, lines.length ? lines : ['- none'], budget, (left) => `- …and ${left} more kinds of problem, not listed`);
}

/** The most events one read takes; more is said to be cut, and the newest are kept. */
export const PAST_EVENT_LIMIT = 500;

/** How long Zabbix gets for each read. HCML's is slow, and a question is not held for long. */
const PAST_READ_MS = 8_000;

interface EventRow {
  eventid: string;
  clock: string;
  severity: string;
  r_eventid?: string;
  name?: string;
  hosts?: { hostid: string; name: string }[];
}

const severitiesFrom = (min: number): number[] => [0, 1, 2, 3, 4, 5].filter((s) => s >= Math.max(0, Math.min(5, Math.trunc(min))));

/**
 * The problem events that opened in the window, newest first and bounded, with when each closed. `hostids` narrows it to a site or a host; none reads the whole estate. A problem that began
 * before the window and ended inside it is not here, and the title says "opened", which is what is counted.
 */
export async function readPast(window: PastWindow, hostids: string[] | null, minSeverity: number): Promise<{ events: PastEvent[]; truncated: boolean }> {
  const rows = await zbx<EventRow[]>(
    'event.get',
    {
      source: 0,
      object: 0,
      value: 1,
      severities: severitiesFrom(minSeverity),
      time_from: window.from,
      time_till: window.to,
      ...(hostids ? { hostids } : {}),
      output: ['eventid', 'clock', 'severity', 'r_eventid', 'name'],
      selectHosts: ['hostid', 'name'],
      sortfield: ['clock', 'eventid'],
      sortorder: 'DESC',
      limit: PAST_EVENT_LIMIT + 1,
    },
    { timeoutMs: PAST_READ_MS },
  );
  const truncated = rows.length > PAST_EVENT_LIMIT;
  const kept = rows.slice(0, PAST_EVENT_LIMIT);

  const closedAt = new Map<string, number>();
  const ids = kept.map((r) => r.r_eventid).filter((id): id is string => Boolean(id) && id !== '0');
  for (let i = 0; i < ids.length; i += 500) {
    const recoveries = await zbx<{ eventid: string; clock: string }[]>('event.get', { eventids: ids.slice(i, i + 500), output: ['eventid', 'clock'] }, { timeoutMs: PAST_READ_MS });
    for (const r of recoveries) closedAt.set(r.eventid, Number(r.clock));
  }

  const events: PastEvent[] = [];
  for (const r of kept) {
    const host = r.hosts?.[0];
    if (!host) continue;
    const recovery = r.r_eventid && r.r_eventid !== '0' ? closedAt.get(r.r_eventid) : undefined;
    events.push({ eventid: r.eventid, host: host.name, hostid: host.hostid, name: r.name ?? '', severity: r.severity, start: Number(r.clock), end: recovery ?? null });
  }
  return { events, truncated };
}
