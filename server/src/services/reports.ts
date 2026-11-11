import { zbx } from '../clients/zabbix.js';
import { cached, cacheLogger } from '../core/cache.js';
import { cachedProblems, openProblems } from '../domain/queries.js';
import { collectingStatus, getCollecting } from '../domain/reachability.js';

/** One page of event history. Bounds the read and flags when it was hit. */
const EVENT_LIMIT = 10_000;

/**
 * Reports → Top 100 triggers: count problem events per trigger over a window.
 * The window is clamped by the caller and the fetch bounded, against real event history a
 * 20k unbounded read is slow and grows without limit.
 */
export function getTopTriggers(days: number) {
  const from = Math.floor(Date.now() / 1000) - days * 86400;
  return cached(`toptrig:${days}`, 60_000, async () => {
    const events = await zbx<
      {
        objectid: string;
        name: string;
        severity: string;
        hosts?: { hostid: string; name: string }[];
      }[]
    >('event.get', {
      source: 0, // triggers
      object: 0,
      value: 1, // PROBLEM events only
      time_from: from,
      output: ['objectid', 'name', 'severity'],
      selectHosts: ['hostid', 'name'],
      sortfield: ['clock'],
      sortorder: 'DESC',
      limit: EVENT_LIMIT,
    });

    const map: Record<
      string,
      { objectid: string; name: string; severity: string; host: string; count: number }
    > = {};
    for (const e of events) {
      const m = (map[e.objectid] ??= {
        objectid: e.objectid,
        name: e.name,
        severity: e.severity,
        host: e.hosts?.[0]?.name ?? '',
        count: 0,
      });
      m.count++;
    }
    const top = Object.values(map)
      .sort((a, b) => b.count - a.count)
      .slice(0, 100);

    // Say so when the window was busier than one page, otherwise the counts
    // silently understate and look authoritative.
    return { triggers: top, truncated: events.length >= EVENT_LIMIT, days };
  });
}

/**
 * Counting every monitored item took HCML's Zabbix about 40 s and every monitored trigger 74 s, so each count
 * is kept an hour and refreshed in the background. Not under `stats`, which a write clears (actions.ts).
 */
const COUNT_TTL_MS = 60 * 60_000;
/** After that hour the old count is still shown, for up to a day, while a new one is read. */
const COUNT_STALE_MS = 24 * 60 * 60_000;
export const COUNT_TIMEOUT_MS = 120_000;
/** How long /api/stats waits for a count it does not hold yet; past this the count is null and carries on. */
export const COUNT_WAIT_MS = 2_000;
/** After a count fails with none cached, Zabbix is not asked again for this long. */
export const COUNT_RETRY_MS = 10 * 60_000;

type Counted = 'items' | 'triggers';
const COUNT_METHOD: Record<Counted, string> = { items: 'item.get', triggers: 'trigger.get' };
const failedAt = new Map<Counted, number>();

function count(what: Counted): Promise<number> {
  return cached(
    `counts:${what}`,
    COUNT_TTL_MS,
    async () => Number(await zbx<string>(COUNT_METHOD[what], { countOutput: true, monitored: true }, { timeoutMs: COUNT_TIMEOUT_MS })),
    { staleMs: COUNT_STALE_MS, staleIfError: true, pin: true },
  );
}

/** The count if it is ready within COUNT_WAIT_MS, else null; a count still running is kept for the next call. */
async function countIfReady(what: Counted): Promise<number | null> {
  if (Date.now() - (failedAt.get(what) ?? 0) < COUNT_RETRY_MS) return null;
  const counted = count(what).then(
    (n) => {
      failedAt.delete(what);
      return n;
    },
    (err: unknown) => {
      failedAt.set(what, Date.now());
      cacheLogger()?.warn(
        { key: `counts:${what}`, reason: err instanceof Error ? err.message : String(err) },
        `stats: the ${what === 'items' ? 'item' : 'trigger'} count failed; it is tried again in 10 minutes`,
      );
      return null;
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), COUNT_WAIT_MS);
  });
  try {
    return await Promise.race([counted, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Reports → System information: high-level counts for the dashboard. */
export function getStats() {
  return cached('stats', 30_000, async () => {
    const [hosts, items, triggers, groups, problems] = await Promise.all([
      // Monitored only, on all three cards: disabled hosts are left out, and so are templates' triggers, which watch no host.
      zbx<string>('host.get', { countOutput: true, monitored_hosts: true }),
      countIfReady('items'),
      countIfReady('triggers'),
      // `with_hosts`: its older name was deprecated in Zabbix 6.2.
      zbx<string>('hostgroup.get', { countOutput: true, with_hosts: true }),
      // The entry /api/problems and the stream already share, not another read.
      cachedProblems().then(openProblems),
    ]);

    const bySeverity: Record<string, number> = {};
    for (const p of problems) bySeverity[p.severity] = (bySeverity[p.severity] ?? 0) + 1;

    return {
      hosts: Number(hosts),
      items,
      triggers,
      groups: Number(groups),
      problems: problems.length,
      unacknowledged: problems.filter((p) => p.acknowledged !== '1').length,
      bySeverity,
    };
  });
}

/** When Zabbix last collected a value, so the Dashboard can say it has stopped (reachability.ts). */
export async function getFreshness() {
  const { lastCollectedAt, readings } = await getCollecting();
  return collectingStatus(lastCollectedAt, Math.floor(Date.now() / 1000), readings);
}

/** Dashboard widget: problem severity breakdown per host group. */
export function getProblemsByGroup() {
  return cached('probsByGroup', 15_000, async () => {
    const [groups, problems] = await Promise.all([
      zbx<{ groupid: string; name: string; hosts?: { hostid: string }[] }[]>('hostgroup.get', {
        output: ['groupid', 'name'],
        selectHosts: ['hostid'],
        with_hosts: true,
        sortfield: 'name',
      }),
      cachedProblems().then(openProblems),
    ]);

    const sevByHost: Record<string, string[]> = {};
    for (const p of problems) {
      if (!p.hostid) continue;
      (sevByHost[p.hostid] ??= []).push(p.severity);
    }

    return groups
      .map((g) => {
        const bySeverity: Record<string, number> = {};
        let total = 0;
        for (const h of g.hosts ?? []) {
          for (const sev of sevByHost[h.hostid] ?? []) {
            bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
            total++;
          }
        }
        return { groupid: g.groupid, name: g.name, total, bySeverity };
      })
      .filter((g) => g.total > 0)
      .sort((a, b) => b.total - a.total);
  });
}
