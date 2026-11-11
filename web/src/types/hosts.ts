/** Hosts, their devices and items, as the BFF answers for the Hosts, Devices and Latest data pages. */

export interface HostInterface {
  ip: string;
  type?: string; // '1' agent, '2' SNMP, '3' IPMI, '4' JMX
  available?: string; // '0' unknown, '1' available, '2' unavailable
}

export interface Host {
  hostid: string;
  name: string;
  status: string; // '0' = monitored, '1' = not monitored
  maintenance_status?: string; // '1' = in maintenance
  interfaces?: HostInterface[];
  /** Site read from the host name (server naming.ts); null when the name doesn't say. */
  site?: SiteRef | null;
}

export interface SiteRef {
  code: number;
  name: string;
}

/** One reachability state per host, ping first (server reachability.ts). */
export type HostState = 'up' | 'down' | 'degraded' | 'nodata' | 'disabled';

/** Where a host's state came from. `snmp-silent`/`agent-silent`: answers ping, but that interface does not. */
export type StateReason =
  | 'ping'
  | 'interface'
  | 'snmp-silent'
  | 'agent-silent'
  | 'stale'
  | 'no-interface'
  | 'unsupported'
  | 'disabled';

export interface HostOverview extends Host {
  problems: { total: number; bySeverity: Record<string, number> };
  state?: HostState;
  reason?: StateReason;
}

export interface HostGroup {
  groupid: string;
  name: string;
}

/** The kinds of device the portal tells apart (server naming.ts), in the order the Devices page lists them. */
export type DeviceKind = 'switch' | 'firewall' | 'access-point' | 'repeater' | 'server' | 'wan-link' | 'web' | 'other';

/** A host as the Devices page lists it: what the Hosts page shows, and the kind of device it is. */
export interface Device extends HostOverview {
  site: SiteRef | null;
  class: DeviceKind;
  /** The monitoring template the kind was judged by: "Cisco IOS by SNMP", "ICMP Ping", or "Other". */
  category: string;
}

export interface DevicesResponse {
  /** Every kind, in display order, with its plural name. */
  classes: { key: DeviceKind; label: string }[];
  devices: Device[];
}

export interface Item {
  itemid: string;
  name: string;
  key_: string;
  value_type: string; // '0' float, '1' char, '2' log, '3' uint, '4' text
  units?: string;
  state?: string; // '0' normal, '1' not supported
  status?: string; // '0' enabled, '1' disabled
  delay?: string;
  flags?: string;
  tags?: { tag: string; value: string }[];
  hosts?: { hostid: string; name: string }[];
}

/** An item with its newest value, which only /api/latest returns: Zabbix looks each one up on its own (tracker BK-25). */
export interface LatestItem extends Item {
  lastvalue?: string;
  lastclock?: string;
  prevvalue?: string;
  state?: string; // '0' normal, '1' not supported
  hosts?: { hostid: string; name: string }[];
}

export interface LatestResponse {
  items: LatestItem[];
  /** True when Zabbix returned a full page: the list is a floor, not the total. */
  truncated: boolean;
  /** Present when requested with `page`: total matches across all pages. */
  total?: number;
  page?: number;
  pageSize?: number;
}
