import { Navigate, useSearchParams } from 'react-router-dom';
import { ROLLING_WINDOWS } from './Sli';

/**
 * The old Availability & response address, which bookmarks and the handbook still use: it opens the derived view of the SLA page
 * with the period and the method it asked for, and drops anything else. The old page left 7 days out of its address, so no period means 7 days.
 */
const WINDOWS = new Set<string>(ROLLING_WINDOWS.map((w) => w.key));
const MONTH = /^m:(\d{4}-(?:0[1-9]|1[0-2]))$/;
const METHODS = new Set(['availability', 'hcml-report']);

export default function AvailabilityRedirect() {
  const [params] = useSearchParams();
  const next = new URLSearchParams();
  const period = params.get('period') ?? '';
  const month = MONTH.exec(period);
  next.set('month', WINDOWS.has(period) ? period : month ? month[1] : 'd7');
  const method = params.get('method') ?? '';
  if (METHODS.has(method)) next.set('method', method);
  // A Zabbix with SLAs of its own opens on their tab unless the address names this one.
  next.set('tab', 'derived');
  return <Navigate replace to={`/sla?${next.toString()}`} />;
}
