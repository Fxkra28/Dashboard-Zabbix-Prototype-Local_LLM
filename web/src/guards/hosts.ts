/** The checks for hosts, devices and items. */

import type { Device, DevicesResponse, Host, HostGroup, HostInterface, HostOverview, Item, LatestItem, LatestResponse, SiteRef } from '../types';
import { counts, flag, guard, listOf, num, opt, orNull, shape, type Shape, tag, text } from './shape';

export const hostInterface = shape<HostInterface>({ ip: text, type: opt(text), available: opt(text) });

export const siteRef = shape<SiteRef>({ code: num, name: text });

/** The fields of `Host`, which HostOverview and NetDevice extend. */
export const hostFields: Shape<Host> = {
  hostid: text,
  name: text,
  status: text,
  maintenance_status: opt(text),
  interfaces: opt(listOf(hostInterface)),
  site: opt(orNull(siteRef)),
};

const host = shape<Host>(hostFields);

const hostOverview = shape<HostOverview>({
  ...hostFields,
  problems: shape<HostOverview['problems']>({ total: num, bySeverity: counts }),
  state: opt(text),
  reason: opt(text),
});

const device = shape<Device>({
  ...hostFields,
  problems: shape<HostOverview['problems']>({ total: num, bySeverity: counts }),
  state: opt(text),
  reason: opt(text),
  site: orNull(siteRef),
  class: text,
  category: text,
});

const devices = shape<DevicesResponse>({
  classes: listOf(shape<DevicesResponse['classes'][number]>({ key: text, label: text })),
  devices: listOf(device),
});

const hostGroup = shape<HostGroup>({ groupid: text, name: text });

const itemFields: Shape<Item> = {
  itemid: text,
  name: text,
  key_: text,
  value_type: text,
  units: opt(text),
  state: opt(text),
  status: opt(text),
  delay: opt(text),
  flags: opt(text),
  tags: opt(listOf(tag)),
  hosts: opt(listOf(shape<{ hostid: string; name: string }>({ hostid: text, name: text }))),
};

const item = shape<Item>(itemFields);

const latestItem = shape<LatestItem>({ ...itemFields, lastvalue: opt(text), lastclock: opt(text), prevvalue: opt(text) });

const latest = shape<LatestResponse>({
  items: listOf(latestItem),
  truncated: flag,
  total: opt(num),
  page: opt(num),
  pageSize: opt(num),
});

/** GET /api/hosts/overview. */
export const hostOverviewGuard = guard<HostOverview[]>('the host list', listOf(hostOverview));

/** GET /api/devices. */
export const devicesGuard = guard<DevicesResponse>('the device list', devices);

/** GET /api/hosts. */
export const hostListGuard = guard<Host[]>('the host list', listOf(host));

/** GET /api/hostgroups. */
export const hostGroupListGuard = guard<HostGroup[]>('the host groups', listOf(hostGroup));

/** GET /api/items, by host or by id. */
export const itemListGuard = guard<Item[]>('the item list', listOf(item));

/** GET /api/latest. */
export const latestGuard = guard<LatestResponse>('the latest data', latest);
