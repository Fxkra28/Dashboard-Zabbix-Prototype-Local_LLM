import { api } from '../../api';
import type { MetersResponse } from '../../types';
import { useAsync } from '../../shared/hooks/useAsync';

/**
 * The internet traffic meters, asked once a minute and held by the Dashboard for both views, so the card, the tab and a turning wall share one request.
 * `enabled` is false for a viewer: interface data is not theirs and the BFF would refuse.
 */
export function useMeters(enabled: boolean) {
  return useAsync<MetersResponse | null>(
    () => (enabled ? api.netMeters() : Promise.resolve(null)),
    [enabled],
    enabled ? 60_000 : undefined,
  );
}

export type MetersQuery = ReturnType<typeof useMeters>;
