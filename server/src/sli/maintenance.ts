import { zbx } from '../clients/zabbix.js';
import { clipIntervals, mergeIntervals, type Interval } from './intervals.js';
import { zonedDate, zonedDayStart } from './time.js';

/**
 * Zabbix maintenance periods as concrete windows per host, so the derived SLA can leave planned
 * downtime out of both the downtime and the measured time.
 *
 * The schedule rules follow the Zabbix server's: a one-time period runs from its start date; daily,
 * weekly and monthly ones start `start_time` seconds after midnight in the server's zone (the SLA
 * zone here); every occurrence is clipped to the maintenance's own active_since..active_till.
 *
 * Two limits, both stated in the report's basis: the periods are read as they are defined now, so
 * an edited or deleted period changes past months too; and a maintenance's tag filter, which only
 * narrows which problems Zabbix suppresses, is ignored: a host in maintenance is out of the
 * measurement.
 */

export interface ZTimeperiod {
  /** 0 one-time, 2 daily, 3 weekly, 4 monthly. */
  timeperiod_type: string;
  /** Daily: every N days. Weekly: every N weeks. Monthly by weekday: week of the month, 1 to 4, 5 = last. */
  every?: string;
  /** Monthly: bitmask of months, January = 1 to December = 2048. */
  month?: string;
  /** Weekly and monthly: bitmask of weekdays, Monday = 1 to Sunday = 64. */
  dayofweek?: string;
  /** Monthly: day of the month, 0 when the period is set by weekday. */
  day?: string;
  /** Seconds after midnight. */
  start_time?: string;
  /** Length in seconds. */
  period: string;
  /** One-time: the start, Unix seconds. */
  start_date?: string;
}

export interface ZMaintenance {
  maintenanceid: string;
  active_since: string;
  active_till: string;
  timeperiods?: ZTimeperiod[];
  hosts?: { hostid: string }[];
  hostgroups?: { groupid: string }[];
}

/** Days since 1970-01-01 for a calendar date, and back again, independent of any zone. */
const dayNumber = (d: { year: number; month: number; day: number }) => Date.UTC(d.year, d.month - 1, d.day) / 86_400_000;
const dateOf = (n: number) => {
  const t = new Date(n * 86_400_000);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), weekday: t.getUTCDay() };
};
/** Monday = 0 to Sunday = 6, the bit position Zabbix uses in `dayofweek`. */
const mondayIndex = (weekday: number) => (weekday + 6) % 7;
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Whether one recurring period starts on the calendar day `n`. */
function startsOn(tp: ZTimeperiod, n: number, sinceDay: number): boolean {
  const d = dateOf(n);
  const every = Math.max(1, Number(tp.every) || 1);
  const dow = Number(tp.dayofweek) || 0;
  switch (tp.timeperiod_type) {
    case '2':
      return n >= sinceDay && (n - sinceDay) % every === 0;
    case '3': {
      if (!(dow & (1 << mondayIndex(d.weekday)))) return false;
      const sinceMonday = sinceDay - mondayIndex(dateOf(sinceDay).weekday);
      return n >= sinceMonday && Math.floor((n - sinceMonday) / 7) % every === 0;
    }
    case '4': {
      if (!((Number(tp.month) || 0) & (1 << (d.month - 1)))) return false;
      const day = Number(tp.day) || 0;
      if (day > 0) return d.day === day;
      if (!(dow & (1 << mondayIndex(d.weekday)))) return false;
      const week = Number(tp.every) || 0;
      return week === 5 ? d.day + 7 > daysInMonth(d.year, d.month) : Math.ceil(d.day / 7) === week;
    }
    default:
      return false;
  }
}

/** The windows of one maintenance that overlap `[from, to)`, in `tz`. */
export function maintenanceWindows(m: ZMaintenance, from: number, to: number, tz: string): Interval[] {
  const since = Number(m.active_since) || 0;
  const till = Number(m.active_till) || 0;
  const lo = Math.max(from, since);
  const hi = Math.min(to, till);
  if (hi <= lo) return [];

  const out: Interval[] = [];
  const sinceDay = dayNumber(zonedDate(since, tz));
  for (const tp of m.timeperiods ?? []) {
    const period = Number(tp.period) || 0;
    if (period <= 0) continue;
    if (tp.timeperiod_type === '0') {
      const start = Number(tp.start_date) || 0;
      out.push([start, start + period]);
      continue;
    }
    // A window that began on an earlier day can still reach into the range.
    const first = dayNumber(zonedDate(lo - period, tz));
    const last = dayNumber(zonedDate(hi, tz));
    for (let n = first; n <= last; n++) {
      if (!startsOn(tp, n, sinceDay)) continue;
      const d = dateOf(n);
      const start = zonedDayStart(d.year, d.month, d.day, tz) + (Number(tp.start_time) || 0);
      out.push([start, start + period]);
    }
  }
  return mergeIntervals(clipIntervals(out, lo, hi));
}

/**
 * Maintenance windows per host in `[from, to)`: hosts named in a maintenance
 * directly and hosts in its host groups. One `maintenance.get`, plus one
 * `hostgroup.get` only when a maintenance names groups.
 */
export async function maintenanceByHost(
  from: number,
  to: number,
  tz: string,
  onCall: () => void,
): Promise<Map<string, Interval[]>> {
  onCall();
  const all = await zbx<ZMaintenance[]>('maintenance.get', {
    output: ['maintenanceid', 'active_since', 'active_till'],
    selectTimeperiods: 'extend',
    selectHosts: ['hostid'],
    selectHostGroups: ['groupid'],
  });
  const relevant = all.filter((m) => Number(m.active_till) > from && Number(m.active_since) < to);
  const groupids = [...new Set(relevant.flatMap((m) => (m.hostgroups ?? []).map((g) => g.groupid)))];
  const hostsByGroup = new Map<string, string[]>();
  if (groupids.length) {
    onCall();
    const groups = await zbx<{ groupid: string; hosts?: { hostid: string }[] }[]>('hostgroup.get', {
      groupids,
      output: ['groupid'],
      selectHosts: ['hostid'],
    });
    for (const g of groups) hostsByGroup.set(g.groupid, (g.hosts ?? []).map((h) => h.hostid));
  }

  const byHost = new Map<string, Interval[]>();
  for (const m of relevant) {
    const windows = maintenanceWindows(m, from, to, tz);
    if (!windows.length) continue;
    const hostids = new Set([
      ...(m.hosts ?? []).map((h) => h.hostid),
      ...(m.hostgroups ?? []).flatMap((g) => hostsByGroup.get(g.groupid) ?? []),
    ]);
    for (const id of hostids) byHost.set(id, mergeIntervals([...(byHost.get(id) ?? []), ...windows]));
  }
  return byHost;
}
