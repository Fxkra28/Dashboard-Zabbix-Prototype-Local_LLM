/** Internet traffic meters (GET /api/net/meters, wall, operator and admin): the gauge widgets of one Zabbix dashboard. */

/** What a zone's colour in Zabbix means; `none` is a grey or no colour. */
export type MeterLevel = 'none' | 'low' | 'ok' | 'warn' | 'critical';

export type MeterState = 'ok' | 'stale' | 'nodata' | 'unsupported' | 'missing' | 'invalid';

export interface MeterZone {
  /** Where the zone starts, in the meter's units. */
  from: number;
  level: MeterLevel;
}

/** What the interface says about itself. `unknown` is no current status, or one that is neither working nor dead. */
export type MeterLink = 'up' | 'down' | 'unknown';

/** The same interface the other way, on the gauge's own scale. `value` is null when it has no current reading. */
export interface MeterOther {
  direction: 'in' | 'out';
  itemid: string;
  value: number | null;
  clock: number | null;
  fraction: number | null;
  zone: MeterLevel | null;
}

export interface Meter {
  id: string;
  title: string;
  page: string;
  host: string | null;
  /** The host's id in Zabbix, for the link to its graphs. */
  hostid: string | null;
  item: string | null;
  itemid: string | null;
  direction: 'in' | 'out' | null;
  link: MeterLink;
  other: MeterOther | null;
  /** The item's units; every number here is in them. */
  units: string;
  value: number | null;
  /** When the value was collected, epoch seconds. */
  clock: number | null;
  min: number;
  /** The top of the scale: the link's capacity. */
  max: number | null;
  zones: MeterZone[];
  fraction: number | null;
  zone: MeterLevel | null;
  state: MeterState;
}

export interface MetersResponse {
  dashboard: string;
  found: boolean;
  generatedAt: number;
  meters: Meter[];
  summary: {
    total: number;
    current: number;
    critical: number;
    warn: number;
    stale: number;
    unavailable: number;
    /** Links whose interface is down, whatever their reading says. */
    down: number;
    /** Links whose other direction is High or Critical now. */
    otherHigh: number;
  };
}
