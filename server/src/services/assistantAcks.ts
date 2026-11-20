/**
 * Who acknowledged a problem and what they wrote, for a question like "siapa yang acknowledge problem di Pasuruan, kenapa?". The names and the free-text reasons may name a person, so they go only to a model on this
 * machine; a model outside it is told that the problem was acknowledged, how many times and when last.
 */

import { zbx } from '../clients/zabbix.js';
import type { ZbxProblem } from '../domain/queries.js';
import { age, HOST_NAME_MAX, promptText, PROBLEM_NAME_MAX, section, sevName, stamp, worstFirst } from './assistantLines.js';
import { windowWords, type PastWindow } from './assistantWhen.js';

/** One update of a problem: an acknowledgement, a comment, a change of severity, a close. */
export interface AckUpdate {
  at: number;
  /** Who made it, as Zabbix names the user; empty when Zabbix did not say. */
  who: string;
  /** Zabbix's bits of the action (event.acknowledge). */
  action: number;
  message: string;
}

export interface AckedProblem {
  eventid: string;
  host: string;
  name: string;
  severity: number;
  start: number;
  open: boolean;
  /** Newest first. */
  updates: AckUpdate[];
}

const ACTION_WORDS: [number, string][] = [
  [1, 'closed it'],
  [2, 'acknowledged'],
  [4, 'commented'],
  [8, 'changed the severity'],
  [16, 'removed the acknowledgement'],
  [32, 'suppressed it'],
  [64, 'ended the suppression'],
  [128, 'made it a cause'],
  [256, 'made it a symptom'],
];

/** The bits of an action in words: 2 is "acknowledged", 6 "acknowledged and commented". */
export function actionWords(bits: number): string {
  const words = ACTION_WORDS.filter(([bit]) => (bits & bit) !== 0).map(([, w]) => w);
  return words.length ? words.join(' and ') : 'updated it';
}

/** The most acknowledged problems one question reads. */
export const ACK_PROBLEMS_MAX = 12;

/** The ids of the acknowledged problems among the open ones, in scope, worst and newest first. */
export function ackedOpenIds(open: ZbxProblem[], hostids: ReadonlySet<string> | null, limit = ACK_PROBLEMS_MAX): { ids: string[]; total: number } {
  const acked = open.filter((p) => p.acknowledged === '1' && (!hostids || (p.hostid !== undefined && hostids.has(p.hostid))));
  return { ids: [...acked].sort(worstFirst).slice(0, limit).map((p) => p.eventid), total: acked.length };
}

const UPDATE_MAX = 3;
const MESSAGE_MAX = 160;

/** A moment in the zone; with the year when it is more than half a year old, since "13 Feb" alone would be taken for this February. */
function when(at: number, now: number, tz: string): string {
  const text = stamp(at, tz);
  return now - at > 183 * 86_400 ? `${text.slice(0, -6)} ${new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric' }).format(at * 1000)} ${text.slice(-5)}` : text;
}

const updateText = (u: AckUpdate, now: number, tz: string): string =>
  `${promptText(u.who || 'someone', 60)} ${actionWords(u.action)} ${when(u.at, now, tz)}${u.message.trim() ? `: "${promptText(u.message, MESSAGE_MAX)}"` : ''}`;

export interface AcksSectionOptions {
  /** The site or host the question named, or null for the whole estate. */
  scope: string | null;
  /** The window the question named; null reads the problems that are open now. */
  window: PastWindow | null;
  tz: string;
  now: number;
  /** Names and reasons may be given: the model is on this machine and the user is an operator or an administrator, who can acknowledge and so see who did (SC-65). */
  people: boolean;
  /** The names are held back by the user's role, and not because the model is outside this machine: the line says which. */
  byRole?: boolean;
  /** How many acknowledged problems there were before the cut, or null when more were left unread. */
  total: number | null;
  budget: number;
}

export function acksSection(problems: AckedProblem[], { scope, window, tz, now, people, byRole = false, total, budget }: AcksSectionOptions): { text: string; truncated: boolean } {
  const where = scope ? `at ${promptText(scope, HOST_NAME_MAX)}` : 'across the estate';
  const what = window ? `that opened ${windowWords(window, tz)}` : 'still open';
  const cut = total === null ? ', the newest only: there were more' : total > problems.length ? `, the ${problems.length} worst of ${total}` : '';
  const title = `ACKNOWLEDGED PROBLEMS ${what}, ${where} (${problems.length} with updates${cut}; newest update first):`;
  const ordered = [...problems].sort((a, b) => (b.updates[0]?.at ?? 0) - (a.updates[0]?.at ?? 0));
  const lines = ordered.map((p) => {
    const head = `- [${sevName(p.severity)}] ${promptText(p.host, HOST_NAME_MAX)}: ${promptText(p.name, PROBLEM_NAME_MAX)} (${p.open ? `open ${age(p.start, now)}` : 'closed'}): `;
    if (!people) return `${head}acknowledged (${p.updates.length} update${p.updates.length === 1 ? '' : 's'}, the last ${when(p.updates[0].at, now, tz)}); who and why are ${byRole ? 'shown to operators and administrators only' : 'not given to a model outside this machine'}`;
    const shown = p.updates.slice(0, UPDATE_MAX).map((u) => updateText(u, now, tz));
    const more = p.updates.length - shown.length;
    return `${head}${shown.join('; ')}${more > 0 ? `; and ${more} earlier` : ''}`;
  });
  return section(title, lines.length ? lines : ['- none: no problem in scope has been acknowledged'], budget, (left) => `- …and ${left} more acknowledged problem${left === 1 ? '' : 's'}, not listed`);
}

const READ_MS = 8_000;

/** Most events one window read takes. */
const WINDOW_EVENT_LIMIT = 100;

interface EventRow {
  eventid: string;
  clock: string;
  severity: string;
  name: string;
  r_eventid?: string;
  hosts?: { hostid: string; name: string }[];
  acknowledges?: { userid: string; clock: string; message: string; action: string }[];
}

interface UserRow {
  userid: string;
  username: string;
  name?: string;
  surname?: string;
}

const EVENT_OUTPUT = ['eventid', 'clock', 'severity', 'name', 'r_eventid'];
const ACK_FIELDS = ['userid', 'clock', 'message', 'action'];

/** The names of the users behind some updates; an empty map when Zabbix will not say, and the updates then name nobody. */
async function namesOf(rows: EventRow[]): Promise<Map<string, string>> {
  const userids = [...new Set(rows.flatMap((r) => (r.acknowledges ?? []).map((a) => a.userid)))];
  if (!userids.length) return new Map();
  try {
    const users = await zbx<UserRow[]>('user.get', { userids, output: ['userid', 'username', 'name', 'surname'] }, { timeoutMs: READ_MS });
    return new Map(users.map((u) => [u.userid, `${u.name ?? ''} ${u.surname ?? ''}`.trim() || u.username]));
  } catch {
    return new Map();
  }
}

async function shape(rows: EventRow[]): Promise<AckedProblem[]> {
  const names = await namesOf(rows);
  return rows
    .filter((r) => (r.acknowledges ?? []).length > 0)
    .map((r) => ({
      eventid: r.eventid,
      host: r.hosts?.[0]?.name ?? '',
      name: r.name,
      severity: Number(r.severity),
      start: Number(r.clock),
      open: !r.r_eventid || r.r_eventid === '0',
      updates: (r.acknowledges ?? []).map((a) => ({ at: Number(a.clock), who: names.get(a.userid) ?? '', action: Number(a.action), message: a.message ?? '' })).sort((a, b) => b.at - a.at),
    }));
}

/** The updates of problems that are open now, by their event ids. */
export async function readAcks(eventids: string[]): Promise<AckedProblem[]> {
  if (!eventids.length) return [];
  const rows = await zbx<EventRow[]>('event.get', { eventids, output: EVENT_OUTPUT, selectHosts: ['hostid', 'name'], selectAcknowledges: ACK_FIELDS }, { timeoutMs: READ_MS });
  return shape(rows);
}

/** The acknowledged problems that opened in a window, closed or not; `hostids` narrows it to a site or a host. */
export async function readAcksIn(window: PastWindow, hostids: string[] | null): Promise<{ problems: AckedProblem[]; truncated: boolean }> {
  const rows = await zbx<EventRow[]>(
    'event.get',
    {
      source: 0,
      object: 0,
      value: 1,
      acknowledged: true,
      time_from: window.from,
      time_till: window.to,
      ...(hostids ? { hostids } : {}),
      output: EVENT_OUTPUT,
      selectHosts: ['hostid', 'name'],
      selectAcknowledges: ACK_FIELDS,
      sortfield: ['clock', 'eventid'],
      sortorder: 'DESC',
      limit: WINDOW_EVENT_LIMIT,
    },
    { timeoutMs: READ_MS },
  );
  return { problems: await shape(rows), truncated: rows.length >= WINDOW_EVENT_LIMIT };
}
