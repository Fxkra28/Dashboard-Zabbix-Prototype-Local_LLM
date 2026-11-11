/** The calls behind the Hosts, Devices and Latest data pages. */

import type { Host, HostOverview, HostGroup, Item, LatestResponse, DevicesResponse } from '../types';
import { hostGroupListGuard, hostListGuard, hostOverviewGuard, itemListGuard, latestGuard, devicesGuard } from '../guards';
import { qs, request } from './client';

export const hostsApi = {
  hosts: () => request<Host[]>('/api/hosts', { guard: hostListGuard }),
  hostsOverview: () => request<HostOverview[]>('/api/hosts/overview', { guard: hostOverviewGuard }),
  /** Every host as a device of one kind, for the Devices page. */
  devices: () => request<DevicesResponse>('/api/devices', { guard: devicesGuard }),
  hostgroups: () => request<HostGroup[]>('/api/hostgroups', { guard: hostGroupListGuard }),
  items: (hostid: string, search?: string, opts: { graphable?: boolean } = {}) =>
    request<Item[]>(`/api/items${qs({ hostid, search, graphable: opts.graphable ? 1 : undefined })}`, { guard: itemListGuard }),
  /** Resolve specific items (any host), deep links like /graphs?itemid=a,b. */
  itemsById: (itemids: string[]) => request<Item[]>(`/api/items${qs({ itemids: itemids.join(',') })}`, { guard: itemListGuard }),
  latest: (opts: {
    hostid?: string;
    groupid?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) => request<LatestResponse>(`/api/latest${qs(opts)}`, { guard: latestGuard }),
};
