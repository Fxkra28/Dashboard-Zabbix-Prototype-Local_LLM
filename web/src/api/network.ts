/** The calls behind the network pages: devices and interfaces, maps, sites and links. */

import type { NetDevice, NetInterfacesResponse, ZMap, MapDetail, SitesResponse, LinksResponse } from '../types';
import { linksGuard, mapDetailGuard, mapListGuard, netDevicesGuard, netInterfacesGuard, sitesGuard } from '../guards';
import { qs, request } from './client';

export const networkApi = {
  netInterfaces: (opts: {
    hostid: string;
    search?: string;
    status?: 'up' | 'down' | 'other' | '';
    page?: number;
    pageSize?: number;
  }) => request<NetInterfacesResponse>(`/api/net/interfaces${qs(opts)}`, { guard: netInterfacesGuard }),
  netDevices: () => request<NetDevice[]>('/api/net/devices', { guard: netDevicesGuard }),
  maps: () => request<ZMap[]>('/api/maps', { guard: mapListGuard }),
  mapDetail: (mapid: string) => request<MapDetail[]>(`/api/maps/detail${qs({ mapid })}`, { guard: mapDetailGuard }),
  // Site view: every host rolled up to the site it lives at.
  sites: () => request<SitesResponse>('/api/sites', { guard: sitesGuard }),
  // WAN / SD-WAN / radio link health (operator)
  links: () => request<LinksResponse>('/api/links', { guard: linksGuard }),
};
