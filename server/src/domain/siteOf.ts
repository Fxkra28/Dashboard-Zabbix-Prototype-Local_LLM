import { siteFromHostName, SITES, type SiteRef } from './naming.js';
import { config } from '../core/config.js';
import type { ZHostMeta } from './queries.js';

/**
 * The site of a host from what Zabbix says about it, by four signals (BK-94, BK-103). It lives here, below the services, so that the SLA reading and the Assistant use the same rule as
 * the Hosts, Devices and Sites pages.
 */

/** Where a host's site name came from, weakest last. */
export type SiteSource = 'tag' | 'name' | 'inventory' | 'group';

/**
 * Resolve one host to a site, most explicit signal first:
 *   1. a `site` host tag:       deliberate, unambiguous
 *   2. the site code in the name, HCML's own convention (`4.3.3 FPSO ARUBA 3`
 *      is site 4); no HCML host carries a site tag, so this is what places
 *      most of the estate, where host groups ("ARUBA", "FIREWALL DEVICES HCML")
 *      describe the kind of device rather than where it is
 *   3. inventory site_city/location, Zabbix's own field for this
 *   4. a host group:            always present, so this always resolves
 */
export function resolveSite(host: ZHostMeta): { site: string; source: SiteSource } {
  const tag = host.tags?.find((t) => t.tag === config.site.tag)?.value?.trim();
  if (tag) return { site: tag, source: 'tag' };

  const named = siteFromHostName(host.name);
  if (named) return { site: named.name, source: 'name' };

  // Zabbix returns [] (not an object) for a host with inventory disabled.
  const inv = Array.isArray(host.inventory) ? undefined : host.inventory;
  const fromInventory = inv?.site_city?.trim() || inv?.location?.trim();
  if (fromInventory) return { site: fromInventory, source: 'inventory' };

  const groups = host.hostgroups ?? [];
  const prefix = config.site.groupPrefix;
  if (prefix) {
    const match = groups.find((g) => g.name.startsWith(prefix));
    if (match) return { site: match.name.slice(prefix.length).trim(), source: 'group' };
  } else if (groups[0]) {
    return { site: groups[0].name, source: 'group' };
  }

  return { site: 'Unassigned', source: 'group' };
}

/**
 * The site of a host as the code and name of the sites HCML keeps (naming.ts), by the same four signals as `resolveSite`: Hosts, Devices and the Network page take it from here, and so agree with Sites
 * and the scorecard. A tag, an inventory field or a group names the site in words; the list gives its code. A name that is not one of HCML's sites has no code, and is null (BK-94).
 */
export function siteRefOf(host: ZHostMeta): SiteRef | null {
  const { site, source } = resolveSite(host);
  if (source === 'name') return siteFromHostName(host.name);
  return siteOfName(site);
}

/** What a host list asks Zabbix for besides the host, so that its site can be read by the four signals (`siteRefOf`). */
export const SITE_SIGNALS = {
  selectHostGroups: ['groupid', 'name'],
  selectTags: ['tag', 'value'],
  selectInventory: ['site_city', 'location'],
} as const;

/** The site of HCML's list that a name or an alias in words stands for, null when it is none of them: the name of a Sites group, a tag value, a field of the inventory, a host group. */
export function siteOfName(text: string): SiteRef | null {
  const wanted = text.trim().toLowerCase();
  const found = SITES.find((s) => s.name.toLowerCase() === wanted || s.aliases.some((a) => a.toLowerCase() === wanted));
  return found ? { code: found.code, name: found.name } : null;
}

/** The site of a host as the Sites view put it (by the four signals), looked up by the host's name, for the places that hold a name and not the host, such as the gauges of the Internet links (BK-103). */
export function siteByHostName(sites: { name: string; hosts: { name: string }[] }[]): (hostName: string) => SiteRef | null {
  const index = new Map<string, SiteRef | null>();
  for (const s of sites) {
    const site = siteOfName(s.name);
    for (const h of s.hosts) index.set(h.name, site);
  }
  return (hostName) => (index.has(hostName) ? index.get(hostName)! : siteFromHostName(hostName));
}
