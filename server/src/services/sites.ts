import { cached } from '../core/cache.js';
import { cachedProblems, openProblems, getHostsWithMeta, type ZHostMeta } from '../domain/queries.js';
import type { SiteRef } from '../domain/naming.js';
import { resolveSite, SITE_SIGNALS, siteOfName, siteRefOf, type SiteSource } from '../domain/siteOf.js';
import {
  getIcmpByHost,
  hostState,
  rollUpAvailability,
  type Availability,
  type HostState,
  type StateReason,
} from '../domain/reachability.js';

/**
 * Site view (HCML Goal 5). HCML's estate is organised by site (JKT HQ, SBY, SSB, FPSO KAS3, BD-WHP,
 * MOPU, MBH, MDA, Sumenep, ORF Porong, TWSB, GMS Pasuruan), but Zabbix lists hosts flat. This rolls
 * every host up to the site it lives at.
 *
 * Read-only: it derives sites from what Zabbix already knows, and never writes.
 */


export interface SiteHost {
  hostid: string;
  name: string;
  status: string;
  maintenance_status?: string;
  interfaces?: { ip: string; type?: string; available?: string }[];
  /** The interface flags alone. `state` is what to show. */
  availability: Availability;
  /** Reachability, ping first (reachability.ts). Never carries loss or latency. */
  state: HostState;
  reason: StateReason;
  siteSource: SiteSource;
  problems: { total: number; bySeverity: Record<string, number> };
}

export interface Site {
  name: string;
  total: number;
  /** Hosts by interface flags, as before `state` existed. */
  available: number;
  unavailable: number;
  unknown: number;
  /** Hosts by `state`; disabled hosts are counted in `disabled` only. */
  up: number;
  down: number;
  degraded: number;
  nodata: number;
  maintenance: number;
  disabled: number;
  problems: number;
  unacknowledged: number;
  bySeverity: Record<string, number>;
  /** Highest severity currently firing at this site; -1 when clear. */
  worst: number;
  hosts: SiteHost[];
}

export interface SitesResponse {
  sites: Site[];
  /**
   * How many hosts carry an explicit site marker vs. fall back to a host
   * group. This is HCML's Goal 1 ("site mapping is not standardised") turned
   * into a number that can go up over time.
   */
  coverage: { hosts: number; tag: number; name: number; inventory: number; group: number };
}


/** The host as the page is given it: its fields and its `site`, without the tags, the groups and the inventory that the site was read from (BK-94). */
export { resolveSite, SITE_SIGNALS, siteOfName, siteRefOf, type SiteSource };

export function withSite<H extends ZHostMeta>(host: H): Omit<H, 'hostgroups' | 'tags' | 'inventory'> & { site: SiteRef | null } {
  const { hostgroups: _groups, tags: _tags, inventory: _inventory, ...plain } = host;
  return { ...plain, site: siteRefOf(host) };
}

export async function getSites(): Promise<SitesResponse> {
  // Shares the `hosts:meta` cache entry with the inventory scorecard, and
  // `problems` with every other problem reader.
  const [hosts, problems, icmp] = await Promise.all([
    cached('hosts:meta', 30_000, getHostsWithMeta),
    cachedProblems().then(openProblems),
    getIcmpByHost(),
  ]);

  const byHost: Record<string, { total: number; bySeverity: Record<string, number>; unack: number }> =
    {};
  for (const p of problems) {
    if (!p.hostid) continue;
    const c = (byHost[p.hostid] ??= { total: 0, bySeverity: {}, unack: 0 });
    c.total++;
    c.bySeverity[p.severity] = (c.bySeverity[p.severity] ?? 0) + 1;
    if (p.acknowledged !== '1') c.unack++;
  }

  const sites = new Map<string, Site>();
  const coverage = { hosts: hosts.length, tag: 0, name: 0, inventory: 0, group: 0 };

  for (const h of hosts) {
    const { site: name, source } = resolveSite(h);
    coverage[source]++;

    let site = sites.get(name);
    if (!site) {
      site = {
        name,
        total: 0,
        available: 0,
        unavailable: 0,
        unknown: 0,
        up: 0,
        down: 0,
        degraded: 0,
        nodata: 0,
        maintenance: 0,
        disabled: 0,
        problems: 0,
        unacknowledged: 0,
        bySeverity: {},
        worst: -1,
        hosts: [],
      };
      sites.set(name, site);
    }

    const availability = rollUpAvailability(h.interfaces);
    const { state, reason } = hostState(h, icmp.get(h.hostid));
    const p = byHost[h.hostid] ?? { total: 0, bySeverity: {}, unack: 0 };

    site.total++;
    if (availability === 'available') site.available++;
    else if (availability === 'unavailable') site.unavailable++;
    else site.unknown++;
    if (state !== 'disabled') site[state]++;
    if (h.maintenance_status === '1') site.maintenance++;
    if (h.status === '1') site.disabled++;
    site.problems += p.total;
    site.unacknowledged += p.unack;
    for (const [sev, n] of Object.entries(p.bySeverity)) {
      site.bySeverity[sev] = (site.bySeverity[sev] ?? 0) + n;
      site.worst = Math.max(site.worst, Number(sev));
    }

    site.hosts.push({
      hostid: h.hostid,
      name: h.name,
      status: h.status,
      maintenance_status: h.maintenance_status,
      interfaces: h.interfaces,
      availability,
      state,
      reason,
      siteSource: source,
      problems: { total: p.total, bySeverity: p.bySeverity },
    });
  }

  // Worst first: a NOC wall should lead with the site that needs attention;
  // ties break on hosts down (by ping first, not SNMP silence), then name for a
  // stable order.
  const ordered = [...sites.values()].sort(
    (a, b) => b.worst - a.worst || b.down - a.down || a.name.localeCompare(b.name),
  );

  return { sites: ordered, coverage };
}

/** The Sites board as its route, the Assistant and the warm-up read it; quick since the ping values are read in bulk. */
export const sitesView = () => cached('sites', 15_000, getSites);
