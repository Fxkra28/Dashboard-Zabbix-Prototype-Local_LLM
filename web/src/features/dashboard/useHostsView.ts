import { api } from '../../api';
import type { DevicesResponse, TopHostsResponse, WebMonitoringResponse } from '../../types';
import { useAsync } from '../../shared/hooks/useAsync';

/**
 * What the Dashboard's Hosts view shows: every host as a device (the Devices page's own request), the busiest hosts by CPU and memory, and the web scenarios.
 * Held by the Dashboard for all of its views, so a wall that turns to it finds all three already there.
 */
export function useHostsView() {
  const devices = useAsync<DevicesResponse>(() => api.devices(), [], 60_000);
  const top = useAsync<TopHostsResponse>(() => api.topHosts(), [], 60_000);
  const web = useAsync<WebMonitoringResponse>(() => api.webMonitoring(), [], 60_000);
  return { devices, top, web };
}

export type HostsViewQuery = ReturnType<typeof useHostsView>;
