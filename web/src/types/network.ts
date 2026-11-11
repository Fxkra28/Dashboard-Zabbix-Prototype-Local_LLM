/** The network pages: devices and their interfaces, sites, maps and the health of links. */

import type { Host, HostInterface, HostState, StateReason } from './hosts';

export type IcmpState = 'up' | 'down' | 'unknown';

export interface NetDevice extends Host {
  /** `up`/`loss`/`latency` only when a fresh value exists; null when the host has no ICMP items. */
  icmp: { up?: boolean; loss?: number; latency?: number; state?: IcmpState } | null;
}

export type OperStatus =
  | 'up'
  | 'down'
  | 'testing'
  | 'unknown'
  | 'dormant'
  | 'notPresent'
  | 'lowerLayerDown';

export interface NetInterface {
  index: number;
  name: string;
  alias: string;
  operStatus: OperStatus;
  speed: number | null;
  inBps: number | null;
  outBps: number | null;
  utilisation: number | null;
  inErrors: number | null;
  outErrors: number | null;
  inDiscards: number | null;
  outDiscards: number | null;
  lastclock: number | null;
  itemids: Partial<Record<'in' | 'out' | 'status' | 'speed' | 'inErrors' | 'outErrors', string>>;
}

export interface NetInterfacesResponse {
  rows: NetInterface[];
  total: number;
  summary: { up: number; down: number; other: number };
  page: number;
  pageSize: number;
}

// Link & WAN health (Goal 3)
export type LinkState = 'up' | 'degraded' | 'down' | 'unknown';

export interface Link {
  id: string;
  hostid: string;
  host: string;
  target: string;
  label: string;
  up?: boolean;
  loss?: number;
  latency?: number;
  jitter?: number;
  state: LinkState;
  group?: string;
  role?: string;
  lastclock?: string;
}

export interface LinksResponse {
  links: Link[];
  paths: { name: string; links: Link[]; state: LinkState }[];
  summary: { total: number; up: number; degraded: number; down: number; unknown: number };
  thresholds: { lossWarn: number; lossCrit: number };
}

export interface ZMap {
  sysmapid: string;
  name: string;
  width: string;
  height: string;
}

export interface MapSelement {
  selementid: string;
  label: string;
  x: string;
  y: string;
  elementtype: string; // '0' host, '1' map, '2' trigger, '3' host group, '4' image
  /** Label with host macros expanded by the BFF ({HOSTNAME}, {HOST.IP}, …). */
  labelText?: string;
  /** Host elements only. */
  hostid?: string;
  hostName?: string;
  problems?: number;
  maxSeverity?: number; // -1 when the host has no open problem
}

export interface MapLink {
  linkid: string;
  selementid1: string;
  selementid2: string;
  color?: string; // hex without the '#', as Zabbix stores it
}

export interface MapDetail extends ZMap {
  selements: MapSelement[];
  links: MapLink[];
}

/** Where a host's site name came from, weakest last. */
export type SiteSource = 'tag' | 'name' | 'inventory' | 'group';

export interface SiteHost {
  hostid: string;
  name: string;
  status: string;
  maintenance_status?: string;
  interfaces?: HostInterface[];
  /** Interface flags alone; prefer `state`. */
  availability: 'available' | 'unavailable' | 'unknown';
  state?: HostState;
  reason?: StateReason;
  siteSource: SiteSource;
  problems: { total: number; bySeverity: Record<string, number> };
}

export interface Site {
  name: string;
  total: number;
  /** Hosts by interface flags. */
  available: number;
  unavailable: number;
  unknown: number;
  /** Hosts by `state`; disabled hosts count in `disabled` only. */
  up?: number;
  down?: number;
  degraded?: number;
  nodata?: number;
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
  coverage: { hosts: number; tag: number; name?: number; inventory: number; group: number };
}
