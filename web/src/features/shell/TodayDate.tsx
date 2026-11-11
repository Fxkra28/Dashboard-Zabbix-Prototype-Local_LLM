import { useNow } from '../../shared/hooks/useNow';
import { useReportTimeZone } from '../../shared/hooks/useReportTimeZone';
import { formatDate } from '../../shared/lib/time';

/** Today's date in the report zone, re-read every minute so an open tab turns over at midnight there; its own component, so only this span re-renders. */
export default function TodayDate() {
  const now = useNow(60_000);
  useReportTimeZone();
  return <span>{formatDate(now)}</span>;
}
