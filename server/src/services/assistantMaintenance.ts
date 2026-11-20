/**
 * The maintenance windows that are on or coming up, for "ada maintenance terjadwal minggu ini?". A host in one is also said so in its own details; this is the list across the estate, from Zabbix's own definitions.
 */

import { zbx } from '../clients/zabbix.js';
import { config } from '../core/config.js';
import { maintenanceWindows, type ZTimeperiod } from '../sli/maintenance.js';
import { HOST_NAME_MAX, promptText, section, stamp } from './assistantLines.js';

export interface MaintenanceWindow {
  name: string;
  /** The range in which the maintenance can apply (Zabbix's `active_since` and `active_till`). It is not when the stop is: a weekly slot valid all year is valid until the end of the year. */
  from: number;
  to: number;
  /** Data is still collected during the window. */
  collects: boolean;
  hosts: string[];
  groups: string[];
  /** The period in effect now, from its true start to its end, or null when none is. Left out when the periods were not read. */
  current?: { from: number; to: number } | null;
  /** The next period that starts after now, or null when none is left in the next 60 days. Left out when the periods were not read. */
  next?: { from: number; to: number } | null;
}

/** The most windows one question lists. */
export const MAINTENANCE_MAX = 8;

const NAMES_SHOWN = 4;

const names = (list: string[], noun: string): string => {
  const shown = list.slice(0, NAMES_SHOWN).map((n) => promptText(n, HOST_NAME_MAX)).join(', ');
  return `${shown}${list.length > NAMES_SHOWN ? ` and ${list.length - NAMES_SHOWN} more ${noun}` : ''}`;
};

/** When a window is next in effect, soonest first: the one that is in effect now, then the one whose next period is nearest, then the one valid soonest. */
const soonest = (w: MaintenanceWindow, now: number): number => (w.current ? now - 1 : (w.next?.from ?? w.from));

/**
 * The window as its definition says: when it is valid, which is a range and not the stop itself, and, where the periods were read, the period in effect now and the next one (BK-89). The name
 * of a window is free text that staff write, so a model outside this machine, or a person without the Inventory page, is given the times and the hosts and not the name (SC-64, SC-65).
 */
export function maintenanceSection(
  windows: MaintenanceWindow[],
  { now, tz, budget, local = true, inventoryPage = true }: { now: number; tz: string; budget: number; local?: boolean; inventoryPage?: boolean },
): { text: string; truncated: boolean } {
  const ordered = [...windows].sort((a, b) => soonest(a, now) - soonest(b, now)).slice(0, MAINTENANCE_MAX);
  const title = `MAINTENANCE WINDOWS (${windows.length} valid now or later, soonest first):`;
  const lines = ordered.map((w) => {
    const valid = `valid ${stamp(w.from, tz)} to ${stamp(w.to, tz)}`;
    const nextText = w.next ? `next ${stamp(w.next.from, tz)} to ${stamp(w.next.to, tz)}` : w.next === null ? 'no period in the next 60 days' : '';
    const state = w.current ? [`in effect now, until ${stamp(w.current.to, tz)}`, nextText] : w.current === null ? ['not in effect now', nextText] : [];
    const who = [w.hosts.length ? `hosts: ${names(w.hosts, 'hosts')}` : '', w.groups.length ? `groups: ${names(w.groups, 'groups')}` : ''].filter(Boolean).join('; ');
    return `- ${local && inventoryPage ? `"${promptText(w.name, 60)}"` : 'a window'}: ${[valid, ...state].filter(Boolean).join('; ')} (${w.collects ? 'data is still collected' : 'no data is collected'})${who ? `; ${who}` : ''}`;
  });
  return section(title, lines.length ? lines : ['- none: no maintenance window is valid now or later'], budget, (left) => `- …and ${left} more windows, not listed`);
}

interface ZMaintenance {
  maintenanceid?: string;
  name: string;
  active_since: string;
  active_till: string;
  maintenance_type: string;
  timeperiods?: ZTimeperiod[];
  hosts?: { name: string }[];
  hostgroups?: { name: string }[];
}

const DAY = 86_400;
/** How far ahead the next period is looked for, and how far back, so that a period that began before now still shows its true start. */
const AHEAD = 60 * DAY;
const BACK = 31 * DAY;

/** The period of a maintenance that is in effect at `now`, and the next one, from its definition in the SLA's zone: the same expansion the derived SLA uses to leave planned downtime out. */
export function periodsAt(m: ZMaintenance, now: number, tz: string): { current: { from: number; to: number } | null; next: { from: number; to: number } | null } | null {
  if (!m.timeperiods?.length) return null;
  const windows = maintenanceWindows({ maintenanceid: m.maintenanceid ?? '', active_since: m.active_since, active_till: m.active_till, timeperiods: m.timeperiods }, now - BACK, now + AHEAD, tz);
  const found = (w: readonly [number, number] | undefined) => (w ? { from: w[0], to: w[1] } : null);
  return { current: found(windows.find(([a, b]) => a <= now && b > now)), next: found(windows.find(([a]) => a > now)) };
}

export async function readMaintenance(now: number): Promise<MaintenanceWindow[]> {
  const all = await zbx<ZMaintenance[]>(
    'maintenance.get',
    { output: ['name', 'active_since', 'active_till', 'maintenance_type'], selectTimeperiods: 'extend', selectHosts: ['name'], selectHostGroups: ['name'], sortfield: ['name'] },
    { timeoutMs: 8_000 },
  );
  return all
    .filter((m) => Number(m.active_till) > now)
    .map((m) => {
      const periods = periodsAt(m, now, config.sla.timezone);
      return {
        name: m.name,
        from: Number(m.active_since),
        to: Number(m.active_till),
        collects: m.maintenance_type === '0',
        hosts: (m.hosts ?? []).map((h) => h.name),
        groups: (m.hostgroups ?? []).map((g) => g.name),
        ...(periods ?? {}),
      };
    });
}
