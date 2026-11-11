import { zbx } from '../clients/zabbix.js';
import { cached, SLOW_VIEW } from '../core/cache.js';
import { cachedProblems, openProblems } from '../domain/queries.js';
import { getIcmpByHost, hostState } from '../domain/reachability.js';
import { naturalCompare, siteFromHostName } from '../domain/naming.js';
import { isNetworkKey, withoutNetworkItems } from '../security/viewerPolicy.js';

/** One page of Latest data (legacy, un-paged). Bounds the read and flags when it was hit. */
export const LATEST_LIMIT = 500;
/** Paged Latest data: most item ids read in the light first pass. */
export const LATEST_ID_LIMIT = 20_000;
/** Most items one /api/items?itemids= request may resolve. */
export const MAX_ITEMIDS = 50;

export const LATEST_OUTPUT = [
  'itemid',
  'name',
  'key_',
  'lastvalue',
  'lastclock',
  'prevvalue',
  'units',
  'value_type',
  'state',
];

export interface ZItem {
  itemid: string;
  key_?: string;
  value_type: string;
  status?: string;
  state?: string;
}

/** Numeric (float/uint), enabled, supported, what a line chart can draw. */
export const isGraphable = (i: ZItem) =>
  (i.value_type === '0' || i.value_type === '3') &&
  (i.status ?? '0') === '0' &&
  (i.state ?? '0') === '0';

export interface ZHost {
  hostid: string;
  name: string;
  status: string;
  maintenance_status?: string;
  interfaces?: { ip: string; type?: string; available?: string }[];
}

/** Each host with its live problem counts and its reachability state (ping first; reachability.ts). */
export async function getHostOverview() {
  const [hosts, problems, icmp] = await Promise.all([
    zbx<ZHost[]>('host.get', {
      output: ['hostid', 'name', 'status', 'maintenance_status'],
      selectInterfaces: ['ip', 'type', 'available'],
      sortfield: 'name',
    }),
    cachedProblems().then(openProblems),
    getIcmpByHost(),
  ]);

  const counts: Record<string, { total: number; bySeverity: Record<string, number> }> = {};
  for (const p of problems) {
    if (!p.hostid) continue;
    const c = (counts[p.hostid] ??= { total: 0, bySeverity: {} });
    c.total++;
    c.bySeverity[p.severity] = (c.bySeverity[p.severity] ?? 0) + 1;
  }

  return hosts.map((h) => ({
    ...h,
    ...hostState(h, icmp.get(h.hostid)),
    problems: counts[h.hostid] ?? { total: 0, bySeverity: {} },
  }));
}

/**
 * All hosts (+ interfaces w/ availability). Cached 30s.
 * Each host carries `site` read from its name (naming.ts), null when the name doesn't say.
 */
export function getHosts() {
  return cached('hosts', 30_000, async () => {
    const hosts = await zbx<ZHost[]>('host.get', {
      output: ['hostid', 'name', 'status', 'maintenance_status'],
      selectInterfaces: ['ip', 'type', 'available'],
      sortfield: 'name',
    });
    return hosts.map((h) => ({ ...h, site: siteFromHostName(h.name) }));
  });
}

/** Host groups (for filters). `with_hosts`: `real_hosts` is deprecated in Zabbix 7.0. */
export function getHostGroups() {
  return cached('hostgroups', 60_000, () =>
    zbx('hostgroup.get', { output: ['groupid', 'name'], sortfield: 'name', with_hosts: true }),
  );
}

export interface ItemQuery {
  hostid?: string;
  itemids?: string[];
  search?: string;
  graphable: boolean;
}

/**
 * Items for one host, powers the graph item picker (or specific items of any host, which resolves a deep link).
 * The list is the same for every role; the caller cuts interface items for a viewer after this cache.
 * It leaves out `lastvalue` and `lastclock`: Zabbix looks each one up on its own, 30 ms to 0.5 s an item on HCML's, so a host of 609
 * graphable items took 20 to 32 s (tracker BK-25). The picker needs only names and ids; last values come from /api/latest.
 */
export function findItems({ hostid, itemids, search, graphable }: ItemQuery) {
  const text = search?.trim() ?? '';
  const key = `items:${hostid ?? ''}:${text}:${graphable ? 1 : 0}:${itemids?.join(',') ?? ''}`;
  return cached(key, 30_000, async () => {
    const items = await zbx<ZItem[]>('item.get', {
      ...(hostid ? { hostids: [hostid] } : {}),
      ...(itemids ? { itemids, selectHosts: ['hostid', 'name'] } : {}),
      output: [
        'itemid',
        'name',
        'key_',
        'value_type',
        'units',
        'state',
        'status',
        'delay',
        'flags',
      ],
      selectTags: ['tag', 'value'],
      webitems: true,
      ...(text ? { search: { key_: text } } : {}),
      ...(graphable ? { filter: { value_type: ['0', '3'], status: '0', state: '0' } } : {}),
      sortfield: 'name',
    });
    return graphable ? items.filter(isGraphable) : items;
  }, { typed: true });
}

/** The ids a Latest data request narrows to; Zabbix needs one of them to bound the result set. */
export interface LatestFilter {
  hostids?: (string | undefined)[];
  groupids?: (string | undefined)[];
}

export interface LatestPageQuery {
  filter: LatestFilter;
  hostid?: string;
  groupid?: string;
  needle: string;
  page: number;
  pageSize: number;
  /** A viewer's pages are counted without the interface items, so they cache apart from an operator's. */
  hide: boolean;
}

/**
 * Latest data, paged server-side: one light read of every matching id+name (search covers name OR key),
 * sorted naturally, then full details for just that page.
 */
export function getLatestPage({ filter, hostid, groupid, needle: typedNeedle, page, pageSize, hide }: LatestPageQuery) {
  const needle = typedNeedle.trim();
  return cached(`latest:p:${hostid ?? ''}:${groupid ?? ''}:${needle}:${page}:${pageSize}:${hide ? 'v' : 'o'}`, 15_000, async () => {
    const all = await cached(`latest:ids:${hostid ?? ''}:${groupid ?? ''}:${needle}`, 15_000, async () => {
      const rows = await zbx<{ itemid: string; name: string; key_?: string }[]>('item.get', {
        output: ['itemid', 'name', 'key_'],
        ...filter,
        ...(needle ? { search: { name: needle, key_: needle }, searchByAny: true } : {}),
        monitored: true,
        webitems: true,
        limit: LATEST_ID_LIMIT,
      });
      return rows
        .sort((a, b) => naturalCompare(a.name, b.name) || naturalCompare(a.itemid, b.itemid))
        .map((r) => ({ id: r.itemid, net: isNetworkKey(r.key_) }));
    }, { typed: true });
    const ids = (hide ? all.filter((r) => !r.net) : all).map((r) => r.id);
    const total = ids.length;
    // A page past the end is the last one, so an old address or a list that shrank never reads as empty.
    const at = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const slice = ids.slice((at - 1) * pageSize, at * pageSize);
    let items: { itemid: string }[] = [];
    if (slice.length) {
      const details = await zbx<{ itemid: string }[]>('item.get', {
        itemids: slice,
        output: LATEST_OUTPUT,
        selectHosts: ['hostid', 'name'],
        webitems: true,
      });
      const byId = new Map(details.map((d) => [d.itemid, d]));
      items = slice.map((id) => byId.get(id)).filter((d): d is { itemid: string } => !!d);
    }
    return { items, truncated: all.length >= LATEST_ID_LIMIT, total, page: at, pageSize };
  }, { typed: true });
}

/** Latest data without `page`: the original first-500 read, kept for older callers. */
export function getLatestItems(filter: LatestFilter, hostid: string | undefined, groupid: string | undefined, search: string | undefined, hide: boolean) {
  const text = search?.trim() ?? '';
  const key = `latest:${hostid ?? ''}:${groupid ?? ''}:${text}`;
  return cached(key, 15_000, async () => {
    const items = await zbx<ZItem[]>('item.get', {
      output: LATEST_OUTPUT,
      selectHosts: ['hostid', 'name'],
      ...filter,
      ...(text ? { search: { name: text } } : {}),
      monitored: true,
      webitems: true,
      sortfield: 'name',
      limit: LATEST_LIMIT,
    });
    // A group at HCML's scale can hold more than one page of items. Say so
    // rather than showing a short list that looks complete: the same
    // contract the report endpoints use.
    return { items, truncated: items.length >= LATEST_LIMIT };
  }, { typed: true }).then((r) => (hide ? { ...r, items: withoutNetworkItems(r.items) } : r)); // after the shared cache
}

/** The Hosts overview as its route, the Devices page and the warm-up read it. */
export const hostsOverviewView = () => cached('hosts:overview', 15_000, getHostOverview, SLOW_VIEW);
