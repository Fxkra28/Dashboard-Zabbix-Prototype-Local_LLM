import { zbx } from '../clients/zabbix.js';
import { cached, SLOW_VIEW } from '../core/cache.js';
import { config } from '../core/config.js';
import { cachedProblems, openProblems } from '../domain/queries.js';

interface ZSelement {
  selementid: string;
  elementtype: string; // '0' host, '1' map, '2' trigger, '3' host group, '4' image
  label?: string;
  elements?: { hostid?: string; groupid?: string }[];
  [key: string]: unknown;
}

export interface ZMapDetail {
  selements?: ZSelement[];
  [key: string]: unknown;
}

export interface ZMapHost {
  hostid: string;
  host: string;
  name: string;
  interfaces?: { ip: string; dns: string; useip: string; main: string }[];
}

/**
 * Expand the host macros Zabbix map labels are written in.
 *
 * HCML labels every host element `{HOSTNAME} ({HOST.IP})`. Zabbix fills those in when it draws the
 * map; the API returns them raw, and stripping them would leave every box labelled "()". Unknown
 * macros are still dropped, and a pair of brackets left empty by a missing value goes with them.
 */
export function resolveLabel(label: string, host?: ZMapHost): string {
  const iface = host?.interfaces?.find((i) => i.main === '1') ?? host?.interfaces?.[0];
  const values: Record<string, string | undefined> = {
    '{HOST.NAME}': host?.name,
    '{HOSTNAME}': host?.name,
    '{HOST.HOST}': host?.host,
    '{HOST.IP}': iface?.ip,
    '{IPADDRESS}': iface?.ip,
    '{HOST.DNS}': iface?.dns,
    '{HOST.CONN}': iface ? (iface.useip === '1' ? iface.ip : iface.dns) : undefined,
  };
  return label
    .replace(/\{[^{}]*\}/g, (macro) => values[macro] ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\(\s*\)/g, '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * A viewer's copy of a map: without the elements that are network hosts or network host groups,
 * and without the links that end at one. A new object when something is cut, the
 * same one otherwise, so the cached map is never changed.
 */
export function withoutNetworkElements<M extends { selements?: ZSelement[]; links?: unknown }>(
  maps: M[],
  hostIds: readonly string[],
  groupIds: readonly string[],
): M[] {
  if (!hostIds.length && !groupIds.length) return maps;
  const hosts = new Set(hostIds);
  const groups = new Set(groupIds);
  const isNetwork = (s: ZSelement) => {
    const hostid = typeof s.hostid === 'string' ? s.hostid : s.elements?.[0]?.hostid;
    return (hostid !== undefined && hosts.has(hostid)) || (s.elements ?? []).some((e) => e.groupid !== undefined && groups.has(e.groupid));
  };
  return maps.map((m) => {
    const cut = new Set((m.selements ?? []).filter(isNetwork).map((s) => s.selementid));
    if (!cut.size) return m;
    const links = Array.isArray(m.links) ? (m.links as { selementid1?: string; selementid2?: string }[]) : undefined;
    return {
      ...m,
      selements: (m.selements ?? []).filter((s) => !cut.has(s.selementid)),
      ...(links ? { links: links.filter((l) => !cut.has(String(l.selementid1)) && !cut.has(String(l.selementid2))) } : {}),
    };
  });
}

/** The ids of the hosts in the network host groups (NET_GROUP_IDS); none when no group is named. */
export function networkHostIds(): Promise<string[]> {
  if (!config.netGroupIds.length) return Promise.resolve([]);
  return cached('net:hostids', 60_000, async () =>
    (await zbx<{ hostid: string }[]>('host.get', { output: ['hostid'], groupids: config.netGroupIds })).map((h) => h.hostid),
  );
}

/**
 * One map with its elements + links (topology).
 * Host elements come back with their label resolved and the host's current
 * problem count and worst severity, so the page can colour them.
 */
export function getMapDetail(mapid: string) {
  return cached(`map:${mapid}`, 30_000, async () => {
    const maps = await zbx<ZMapDetail[]>('map.get', {
      sysmapids: [mapid],
      selectSelements: 'extend',
      selectLinks: 'extend',
      output: 'extend',
    });

    const hostids = [
      ...new Set(
        maps.flatMap((m) =>
          (m.selements ?? [])
            .filter((s) => s.elementtype === '0')
            .flatMap((s) => (s.elements ?? []).map((e) => e.hostid))
            .filter((id): id is string => Boolean(id)),
        ),
      ),
    ];

    // `problem.get` has no selectHosts, so problems are matched to hosts
    // through the same cached, host-enriched list the Problems page uses.
    const [hosts, problems] = hostids.length
      ? await Promise.all([
          zbx<ZMapHost[]>('host.get', {
            hostids,
            output: ['hostid', 'host', 'name'],
            selectInterfaces: ['ip', 'dns', 'useip', 'main'],
          }),
          cachedProblems().then(openProblems),
        ])
      : [[], []];

    const hostById = new Map(hosts.map((h) => [h.hostid, h]));
    const status = new Map<string, { problems: number; maxSeverity: number }>();
    for (const p of problems) {
      if (!p.hostid) continue;
      const s = status.get(p.hostid) ?? { problems: 0, maxSeverity: -1 };
      s.problems += 1;
      s.maxSeverity = Math.max(s.maxSeverity, Number(p.severity));
      status.set(p.hostid, s);
    }

    return maps.map((m) => ({
      ...m,
      selements: (m.selements ?? []).map((s) => {
        const hostid = s.elementtype === '0' ? s.elements?.[0]?.hostid : undefined;
        const host = hostid ? hostById.get(hostid) : undefined;
        return {
          ...s,
          labelText: resolveLabel(s.label ?? '', host),
          ...(hostid
            ? { hostid, hostName: host?.name, ...(status.get(hostid) ?? { problems: 0, maxSeverity: -1 }) }
            : {}),
        };
      }),
    }));
  }, { ...SLOW_VIEW, typed: true });
}

/** Monitoring → Maps: list available network maps. */
export function getMaps() {
  return cached('maps', 60_000, () =>
    zbx('map.get', { output: ['sysmapid', 'name', 'width', 'height'] }),
  );
}
