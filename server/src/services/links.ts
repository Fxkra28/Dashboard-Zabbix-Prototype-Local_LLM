import { zbx } from '../clients/zabbix.js';
import { cached } from '../core/cache.js';
import { config } from '../core/config.js';
import { wanPairKey } from '../domain/naming.js';
import { getIcmpValues, ICMP_CATALOG_STALE_MS, ICMP_CATALOG_TTL_MS, isFresh } from '../domain/reachability.js';

/**
 * Link & WAN health (HCML Goal 3).
 *
 * HCML runs 12 main + 10 redundant SD-WAN links, 10 P2P radio links, 18 internet accesses and
 * Starlink at the offshore sites. Their own topology slide flags *"SD-WAN
 * (to_mda_via_sapudi)(internal4): High packet loss"*; that class of fault deserves a first-class
 * view, not a row buried in Latest data.
 *
 * A "link" here is one ICMP-monitored path: the `icmpping` / `icmppingloss` / `icmppingsec` triplet
 * Zabbix collects per target. The portal never speaks ICMP itself: Zabbix polls and this reads the
 * items.
 */

export type LinkState = 'up' | 'degraded' | 'down' | 'unknown';

export interface Link {
  id: string;
  hostid: string;
  host: string;
  /** The far end, when the item names one; otherwise the host's own interface. */
  target: string;
  label: string;
  up?: boolean;
  /** Packet loss, percent. */
  loss?: number;
  /** Round-trip time, milliseconds (Zabbix stores seconds). */
  latency?: number;
  /** max − min RTT, milliseconds. Only when min/max mode items exist. */
  jitter?: number;
  state: LinkState;
  /** From the item tag `link_group`, pairs a main link with its standby. */
  group?: string;
  /** From the item tag `link_role`, e.g. main / redundant. */
  role?: string;
  lastclock?: string;
}

export interface LinkPath {
  name: string;
  links: Link[];
  /** A redundant path survives one leg failing, up if any member is up. */
  state: LinkState;
}

export interface LinksResponse {
  links: Link[];
  paths: LinkPath[];
  summary: { total: number; up: number; degraded: number; down: number; unknown: number };
  thresholds: { lossWarn: number; lossCrit: number };
}

interface ZItem {
  itemid: string;
  name: string;
  key_: string;
  lastvalue?: string;
  lastclock?: string;
  /** '1' = not supported: the value is stale, whatever it says. */
  state?: string;
  /** Update interval ("1m", "30s"); how old a value may be and still count. */
  delay?: string;
  units?: string;
  value_type?: string;
  hosts?: { hostid: string; name: string }[];
  tags?: { tag: string; value: string }[];
}

/** `icmppingsec[10.0.0.1,3,,,,max]` → { name: 'icmppingsec', params: [...] } */
function parseKey(key: string): { name: string; params: string[] } {
  const open = key.indexOf('[');
  if (open < 0) return { name: key, params: [] };
  const inner = key.slice(open + 1, key.lastIndexOf(']'));
  return {
    name: key.slice(0, open),
    params: inner.split(',').map((s) => s.trim().replace(/^"(.*)"$/, '$1')),
  };
}

const num = (v?: string) => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Seconds → milliseconds, rounded to 2 dp so float tails never reach the API. */
export const toMs = (seconds?: number) =>
  seconds === undefined ? undefined : Math.round(seconds * 1000 * 100) / 100;

function classify(up: boolean | undefined, loss: number | undefined): LinkState {
  if (up === false) return 'down';
  if (loss !== undefined) {
    if (loss >= config.links.lossCrit) return 'down';
    if (loss >= config.links.lossWarn) return 'degraded';
  }
  if (up === undefined && loss === undefined) return 'unknown';
  return 'up';
}

const RANK: Record<LinkState, number> = { down: 3, degraded: 2, unknown: 1, up: 0 };

/** The ping items with their hosts and tags, without values: read as rarely as reachability.ts reads its own list. */
function linkItems(): Promise<ZItem[]> {
  return cached(
    'links:catalog',
    ICMP_CATALOG_TTL_MS,
    () =>
      zbx<ZItem[]>('item.get', {
        output: ['itemid', 'name', 'key_', 'units', 'state', 'delay', 'value_type'],
        search: { key_: 'icmpping' },
        // A key prefix, not a substring: parseKey() below still checks.
        startSearch: true,
        // Without it Zabbix also returns template items: hundreds of identical unassigned prototypes.
        monitored: true,
        selectHosts: ['hostid', 'name'],
        selectTags: 'extend',
        ...(config.netGroupIds.length ? { groupids: config.netGroupIds } : {}),
      }),
    { staleMs: ICMP_CATALOG_STALE_MS, staleIfError: true, pin: true },
  );
}

export async function getLinks(): Promise<LinksResponse> {
  // The values come from the ping readings the host states share, not from Zabbix's slow `lastvalue`.
  const [catalog, values] = await Promise.all([linkItems(), getIcmpValues()]);
  const items: ZItem[] = catalog.map((i) => {
    const v = values.get(i.itemid);
    return { ...i, lastvalue: v?.value ?? '', lastclock: v?.clock ?? '0' };
  });

  // One link = one (host, ping target) pair; its three metrics arrive as
  // separate items that have to be stitched back together.
  const groups = new Map<string, { host: { hostid: string; name: string }; target: string; items: ZItem[] }>();

  for (const item of items) {
    const host = item.hosts?.[0];
    if (!host) continue;
    const { name, params } = parseKey(item.key_);
    if (!name.startsWith('icmpping')) continue;
    const target = params[0] ?? '';
    const id = `${host.hostid}:${target}`;
    const g = groups.get(id) ?? { host, target, items: [] };
    g.items.push(item);
    groups.set(id, g);
  }

  const now = Math.floor(Date.now() / 1000);
  const links: Link[] = [];
  for (const [id, g] of groups) {
    let up: boolean | undefined;
    let loss: number | undefined;
    let latency: number | undefined;
    let rttMin: number | undefined;
    let rttMax: number | undefined;
    let label = '';
    let lastclock: string | undefined;
    const tags: Record<string, string> = {};

    for (const item of g.items) {
      const { name, params } = parseKey(item.key_);
      // No collected value is not a value of 0. Zabbix reports lastvalue "0" with lastclock "0" for
      // an item that has never collected, and keeps the last value of an unsupported item; both
      // would classify as down and put links that were simply never polled at the top of the list
      // as outages (42 of them on HCML's data). Without fresh data the metric is unknown. "Fresh"
      // is also recent: a value hours old (the poller stopped, or the host was unreachable to
      // Zabbix) is judged by the same rule the Sites page applies.
      const fresh = isFresh(item, now);
      const v = fresh ? num(item.lastvalue) : undefined;
      for (const t of item.tags ?? []) tags[t.tag] = t.value;
      if (fresh && (!lastclock || Number(item.lastclock) > Number(lastclock))) lastclock = item.lastclock;

      if (name === 'icmpping') {
        up = v === undefined ? undefined : v === 1;
        label ||= item.name;
      } else if (name === 'icmppingloss') {
        loss = v;
        // The loss item usually carries the most descriptive name, HCML's own
        // example is "SD-WAN (to_mda_via_sapudi)(internal4)".
        if (item.name) label = item.name;
      } else if (name === 'icmppingsec') {
        const mode = params[5] || 'avg';
        if (mode === 'min') rttMin = v;
        else if (mode === 'max') rttMax = v;
        else latency = v;
      }
    }

    // HCML tags no item with link_group, so fall back to the host name:
    // `INET : SAMPANG WAN 1` and `INET : SAMPANG WAN 2` are one redundant path.
    const wan = wanPairKey(g.host.name);
    const link: Link = {
      id,
      hostid: g.host.hostid,
      host: g.host.name,
      target: g.target,
      label: label || (g.target ? `${g.host.name} → ${g.target}` : g.host.name),
      up,
      loss,
      // Zabbix stores ICMP response time in seconds; humans read milliseconds.
      // Rounded here rather than in the view: seconds-scale floats scaled by
      // 1000 produce tails like 27.999999999999996, and the API is consumed by
      // more than the Links table.
      latency: toMs(latency),
      jitter:
        rttMin !== undefined && rttMax !== undefined ? toMs(rttMax - rttMin) : undefined,
      state: classify(up, loss),
      group: tags['link_group'] || wan?.path || undefined,
      role: tags['link_role'] || (wan ? `WAN ${wan.leg}${wan.provider ? ` (${wan.provider})` : ''}` : undefined),
      lastclock,
    };
    links.push(link);
  }

  // Worst first, then noisiest by loss: a NOC reads the top of this list.
  links.sort(
    (a, b) => RANK[b.state] - RANK[a.state] || (b.loss ?? 0) - (a.loss ?? 0) || a.label.localeCompare(b.label),
  );

  // Paired paths: a main + redundant pair is only really down when both legs
  // are. That distinction is the whole point of paying for redundancy.
  const byGroup = new Map<string, Link[]>();
  for (const l of links) {
    if (!l.group) continue;
    const members = byGroup.get(l.group);
    if (members) members.push(l);
    else byGroup.set(l.group, [l]);
  }
  const paths: LinkPath[] = [...byGroup.entries()]
    .map(([name, members]) => ({
      name,
      links: members,
      state: members.some((m) => m.state === 'up')
        ? members.every((m) => m.state === 'up')
          ? ('up' as LinkState)
          : ('degraded' as LinkState)
        : members.some((m) => m.state === 'degraded')
          ? ('degraded' as LinkState)
          : members.every((m) => m.state === 'unknown')
            ? ('unknown' as LinkState)
            : ('down' as LinkState),
    }))
    .sort((a, b) => RANK[b.state] - RANK[a.state] || a.name.localeCompare(b.name));

  const summary = { total: links.length, up: 0, degraded: 0, down: 0, unknown: 0 };
  for (const l of links) summary[l.state]++;

  return { links, paths, summary, thresholds: config.links };
}

/** Links as the route and the warm-up read them. */
export const linksView = () => cached('links', 20_000, getLinks);
