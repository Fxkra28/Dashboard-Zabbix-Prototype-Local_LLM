import { zbx } from '../clients/zabbix.js';
import { cached, cacheLogger, type CacheOptions } from '../core/cache.js';

/** Shared Zabbix queries reused by REST routes and the SSE stream. */

export interface ZbxProblem {
  eventid: string;
  objectid: string;
  object: string; // '0' = trigger
  name: string;
  severity: string; // '0'..'5'
  clock: string;
  r_eventid?: string; // '0' when still open
  r_clock?: string;
  acknowledged: string; // '0' | '1'
  suppressed?: string; // '0' | '1'
  opdata?: string;
  tags?: { tag: string; value: string }[];
  host?: string; // enriched below
  hostid?: string; // enriched below
  /** Whether the trigger permits manual close, gates the Close button (§20). */
  manualClose?: boolean;
}

/**
 * The problems that count: open, and not inside a planned maintenance window. `recent: true` below
 * also returns problems resolved inside Zabbix's "Display OK triggers for" window, and Zabbix marks
 * a problem raised during maintenance as suppressed. The Problems list shows both, marked; every
 * count, colour and summary uses this instead, as Zabbix's own dashboard does.
 */
export const openProblems = (problems: ZbxProblem[]): ZbxProblem[] =>
  problems.filter((p) => (!p.r_eventid || p.r_eventid === '0') && p.suppressed !== '1');

/**
 * Every problem field the screens use. `opdata` is left out: Zabbix fills it from history one problem at a
 * time, 35 to 46 s for HCML's 650 problems against 0.9 s without. Explain and the Assistant use withOpdata().
 */
export const PROBLEM_FIELDS = [
  'eventid',
  'source',
  'object',
  'objectid',
  'clock',
  'ns',
  'r_eventid',
  'r_clock',
  'r_ns',
  'correlationid',
  'userid',
  'name',
  'acknowledged',
  'severity',
  'cause_eventid',
  'suppressed',
];

/** How long the problem list is reused. The live stream reads it at the same pace (stream.ts TICK_MS). */
export const PROBLEMS_TTL_MS = 15_000;

/** The problem list as every route, the stream and the reports share it: one read per PROBLEMS_TTL_MS, or sooner for a caller that passes `maxAgeMs` (the stream passes 0). */
export const cachedProblems = (opts?: Pick<CacheOptions, 'maxAgeMs'>) => cached('problems', PROBLEMS_TTL_MS, getProblems, opts);

/** A trigger's host rarely changes, and HCML's Zabbix took 9.7 s to name the hosts of 648 triggers. */
export const TRIGGER_HOST_TTL_MS = 60 * 60_000;

interface TriggerHost {
  hostid: string;
  name: string;
  manualClose: boolean;
  at: number;
}

// Held in the cache, so invalidate('') starts it over like everything else; not a prefix a write clears.
const triggerHostMap = () =>
  cached('trigger-hosts', 24 * 60 * 60_000, async () => new Map<string, TriggerHost>(), { pin: true });

let refreshingHosts: Promise<void> | null = null;

async function lookUpHosts(map: Map<string, TriggerHost>, ids: string[]): Promise<void> {
  // `manual_close` rides along on the call we already make, no extra request.
  const triggers = await zbx<
    {
      triggerid: string;
      manual_close?: string;
      hosts?: { hostid: string; name: string }[];
    }[]
  >('trigger.get', {
    triggerids: ids,
    output: ['triggerid', 'manual_close'],
    selectHosts: ['hostid', 'name'],
  });
  const at = Date.now();
  for (const t of triggers) {
    const h = t.hosts?.[0];
    if (h) map.set(t.triggerid, { hostid: h.hostid, name: h.name, manualClose: t.manual_close === '1', at });
  }
}

/** The host of each trigger: a trigger not seen before is looked up now, one older than an hour in the background. */
async function hostsOf(ids: string[]): Promise<Map<string, TriggerHost>> {
  const map = await triggerHostMap();
  const missing = ids.filter((id) => !map.has(id));
  if (missing.length) await lookUpHosts(map, missing);
  const now = Date.now();
  const old = ids.filter((id) => now - (map.get(id)?.at ?? now) > TRIGGER_HOST_TTL_MS);
  if (old.length && !refreshingHosts) {
    refreshingHosts = lookUpHosts(map, old)
      .catch((err: unknown) => {
        cacheLogger()?.warn(
          { key: 'trigger-hosts', reason: err instanceof Error ? err.message : String(err) },
          'problems: naming the hosts of older triggers failed; keeping the names held',
        );
      })
      .finally(() => {
        refreshingHosts = null;
      });
  }
  // Only the triggers of current problems are kept, so the map cannot grow without bound.
  if (map.size > 2 * ids.length + 500) {
    const current = new Set(ids);
    for (const id of map.keys()) if (!current.has(id)) map.delete(id);
  }
  return map;
}

/**
 * problem.get doesn't carry host names, so we enrich: collect the trigger ids,
 * name their hosts (hostsOf) and attach host id + name to each problem.
 */
export async function getProblems(): Promise<ZbxProblem[]> {
  const problems = await zbx<ZbxProblem[]>('problem.get', {
    output: PROBLEM_FIELDS,
    recent: true,
    sortfield: ['eventid'],
    sortorder: 'DESC',
    selectTags: 'extend',
  });

  const triggerIds = [...new Set(problems.filter((p) => p.object === '0').map((p) => p.objectid))];
  const byTrigger = triggerIds.length ? await hostsOf(triggerIds) : new Map<string, TriggerHost>();

  return problems.map((p) => {
    const t = byTrigger.get(p.objectid);
    return {
      ...p,
      host: t?.name ?? '',
      hostid: t?.hostid ?? '',
      manualClose: t?.manualClose ?? false,
    };
  });
}

/** The same problems with their operational data, read for these few only. On failure they come back without it. */
export async function withOpdata(problems: ZbxProblem[]): Promise<ZbxProblem[]> {
  if (!problems.length) return problems;
  try {
    const rows = await zbx<{ eventid: string; opdata?: string }[]>('problem.get', {
      eventids: problems.map((p) => p.eventid),
      output: ['eventid', 'opdata'],
      recent: true,
    });
    const byId = new Map(rows.map((r) => [r.eventid, r.opdata ?? '']));
    return problems.map((p) => ({ ...p, opdata: byId.get(p.eventid) ?? '' }));
  } catch (err) {
    cacheLogger()?.warn(
      { key: 'opdata', reason: err instanceof Error ? err.message : String(err) },
      'problems: operational data could not be read; answering without it',
    );
    return problems;
  }
}

/**
 * A host with everything the governance-facing views need: groups, tags and
 * the inventory fields that carry site and owner.
 *
 * Zabbix has no `site_name` inventory field, `site_city` and `location` are
 * the real ones, and asking for a field that doesn't exist is silently ignored.
 */
export interface ZHostMeta {
  hostid: string;
  name: string;
  status: string;
  maintenance_status?: string;
  description?: string;
  interfaces?: { ip: string; type?: string; available?: string }[];
  hostgroups?: { groupid: string; name: string }[];
  tags?: { tag: string; value: string }[];
  inventory?:
    | {
        site_city?: string;
        location?: string;
        poc_1_name?: string;
        poc_1_email?: string;
        notes?: string;
      }
    | [];
}

/**
 * Shared by the Sites board and the inventory scorecard, both need the same
 * enriched host list, so they share one cache entry rather than each paying
 * for their own `host.get`.
 */
export async function getHostsWithMeta(): Promise<ZHostMeta[]> {
  return zbx<ZHostMeta[]>('host.get', {
    output: ['hostid', 'name', 'status', 'maintenance_status', 'description'],
    selectInterfaces: ['ip', 'type', 'available'],
    selectHostGroups: ['groupid', 'name'],
    selectTags: 'extend',
    selectInventory: ['site_city', 'location', 'poc_1_name', 'poc_1_email', 'notes'],
    sortfield: 'name',
  });
}

/** Zabbix trigger severities, as the UI and the plain-language layer name them. */
export const SEVERITY_NAMES: Record<string, string> = {
  '0': 'Not classified',
  '1': 'Information',
  '2': 'Warning',
  '3': 'Average',
  '4': 'High',
  '5': 'Disaster',
};
