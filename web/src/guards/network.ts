/** The checks for the network pages: devices and interfaces, maps, sites and links. */

import type { Link, LinksResponse, MapDetail, MapLink, MapSelement, NetDevice, NetInterface, NetInterfacesResponse, Site, SiteHost, SitesResponse, ZMap } from '../types';
import { hostFields, hostInterface } from './hosts';
import { counts, flag, guard, listOf, num, opt, orNull, recordOf, shape, type Shape, text } from './shape';

const netDevice = shape<NetDevice>({
  ...hostFields,
  icmp: orNull(shape<NonNullable<NetDevice['icmp']>>({ up: opt(flag), loss: opt(num), latency: opt(num), state: opt(text) })),
});

const netInterface = shape<NetInterface>({
  index: num,
  name: text,
  alias: text,
  operStatus: text,
  speed: orNull(num),
  inBps: orNull(num),
  outBps: orNull(num),
  utilisation: orNull(num),
  inErrors: orNull(num),
  outErrors: orNull(num),
  inDiscards: orNull(num),
  outDiscards: orNull(num),
  lastclock: orNull(num),
  itemids: recordOf(text),
});

const netInterfaces = shape<NetInterfacesResponse>({
  rows: listOf(netInterface),
  total: num,
  summary: shape<NetInterfacesResponse['summary']>({ up: num, down: num, other: num }),
  page: num,
  pageSize: num,
});

const zmapFields: Shape<ZMap> = { sysmapid: text, name: text, width: text, height: text };

const zmap = shape<ZMap>(zmapFields);

const mapSelement = shape<MapSelement>({
  selementid: text,
  label: text,
  x: text,
  y: text,
  elementtype: text,
  labelText: opt(text),
  hostid: opt(text),
  hostName: opt(text),
  problems: opt(num),
  maxSeverity: opt(num),
});

const mapLink = shape<MapLink>({ linkid: text, selementid1: text, selementid2: text, color: opt(text) });

const mapDetail = shape<MapDetail>({ ...zmapFields, selements: listOf(mapSelement), links: listOf(mapLink) });

const siteHost = shape<SiteHost>({
  hostid: text,
  name: text,
  status: text,
  maintenance_status: opt(text),
  interfaces: opt(listOf(hostInterface)),
  availability: text,
  state: opt(text),
  reason: opt(text),
  siteSource: text,
  problems: shape<SiteHost['problems']>({ total: num, bySeverity: counts }),
});

const site = shape<Site>({
  name: text,
  total: num,
  available: num,
  unavailable: num,
  unknown: num,
  up: opt(num),
  down: opt(num),
  degraded: opt(num),
  nodata: opt(num),
  maintenance: num,
  disabled: num,
  problems: num,
  unacknowledged: num,
  bySeverity: counts,
  worst: num,
  hosts: listOf(siteHost),
});

const sites = shape<SitesResponse>({
  sites: listOf(site),
  coverage: shape<SitesResponse['coverage']>({ hosts: num, tag: num, name: opt(num), inventory: num, group: num }),
});

const link = shape<Link>({
  id: text,
  hostid: text,
  host: text,
  target: text,
  label: text,
  up: opt(flag),
  loss: opt(num),
  latency: opt(num),
  jitter: opt(num),
  state: text,
  group: opt(text),
  role: opt(text),
  lastclock: opt(text),
});

const links = shape<LinksResponse>({
  links: listOf(link),
  paths: listOf(shape<LinksResponse['paths'][number]>({ name: text, links: listOf(link), state: text })),
  summary: shape<LinksResponse['summary']>({ total: num, up: num, degraded: num, down: num, unknown: num }),
  thresholds: shape<LinksResponse['thresholds']>({ lossWarn: num, lossCrit: num }),
});

/** GET /api/net/devices. */
export const netDevicesGuard = guard<NetDevice[]>('the network devices', listOf(netDevice));

/** GET /api/net/interfaces. */
export const netInterfacesGuard = guard<NetInterfacesResponse>('the interface list', netInterfaces);

/** GET /api/maps. */
export const mapListGuard = guard<ZMap[]>('the map list', listOf(zmap));

/** GET /api/maps/detail. */
export const mapDetailGuard = guard<MapDetail[]>('the map', listOf(mapDetail));

/** GET /api/sites. */
export const sitesGuard = guard<SitesResponse>('the site list', sites);

/** GET /api/links. */
export const linksGuard = guard<LinksResponse>('the link health', links);
