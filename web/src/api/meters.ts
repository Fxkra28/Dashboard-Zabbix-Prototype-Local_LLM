/** The call behind the internet traffic meters. */

import type { MetersResponse } from '../types';
import { metersGuard } from '../guards';
import { request } from './client';

export const metersApi = {
  /** The internet traffic meters: the gauge widgets of a Zabbix dashboard, with a value each. For an account that has the Network page. */
  netMeters: () => request<MetersResponse>('/api/net/meters', { guard: metersGuard }),
};
