import { useSyncExternalStore } from 'react';
import { reportTimeZone, subscribeReportTimeZone } from '../lib/time';

/** The report zone (shared/lib/time.ts), re-rendering when the server's answer changes it; apart from useAi to keep the API client out. */
export function useReportTimeZone(): string {
  return useSyncExternalStore(subscribeReportTimeZone, reportTimeZone);
}
