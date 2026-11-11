import { SEVERITIES } from '../../theme';
import type { HostState, StateReason } from '../../types';
import { formatValue } from './units';
import { formatDateTime } from './time';

export function severity(level: string | number) {
  const n = Number(level);
  return SEVERITIES[n] ?? SEVERITIES[0];
}

export function fmtTime(clock: string | number | undefined): string {
  const n = Number(clock);
  if (!n) return '—';
  // The report zone with its label, as the reports and the Assistant show it, not whatever clock this browser has.
  return formatDateTime(n * 1000);
}

export function ago(clock: string | number): string {
  const s = Math.floor(Date.now() / 1000 - Number(clock));
  return humanizeSeconds(s) + ' ago';
}

/** Problem duration: from onset to recovery (or now if still open). Zabbix "Duration". */
export function duration(clock: string | number, rClock?: string | number): string {
  const start = Number(clock);
  const end = rClock && Number(rClock) > 0 ? Number(rClock) : Math.floor(Date.now() / 1000);
  return humanizeSeconds(end - start);
}

function humanizeSeconds(s: number): string {
  if (s < 0) s = 0;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

/** Human-friendly number with an optional unit. See units.ts for the unit families. */
export function fmtValue(v: number | string | undefined | null, units?: string): string {
  if (v === undefined || v === '' || v === null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return formatValue(n, units);
}

/** Interface availability (Zabbix): 0 unknown, 1 available, 2 unavailable. */
export function availability(code: string | undefined) {
  switch (code) {
    case '1':
      return { label: 'Available', kind: 'up' as const };
    case '2':
      return { label: 'Unavailable', kind: 'down' as const };
    default:
      return { label: 'Unknown', kind: 'unknown' as const };
  }
}

/** Roll up per-interface availability to a host-level state (worst wins). */
export function hostAvailability(interfaces?: { available?: string }[]) {
  if (!interfaces?.length) return availability(undefined);
  if (interfaces.some((i) => i.available === '2')) return availability('2');
  if (interfaces.some((i) => i.available === '1')) return availability('1');
  return availability(undefined);
}

export type HostStatusKind = HostState | 'unknown';

/** Tooltip for a host's state (server reachability.ts): the ping check first, interface flags as the fallback. */
const REASON_TEXT: Record<StateReason, (state: HostState) => string> = {
  ping: (state) => (state === 'down' ? 'No reply to ping' : 'Answers ping'),
  interface: (state) =>
    state === 'degraded'
      ? 'Answers ping, but a Zabbix interface is unavailable'
      : state === 'nodata'
        ? 'No fresh ping value, and Zabbix doesn’t know whether the interface is available'
        : `No fresh ping value. Zabbix marks the interface ${state === 'down' ? 'unavailable' : 'available'}`,
  'snmp-silent': () => 'Answers ping, but SNMP polling gets no reply',
  'agent-silent': () => 'Answers ping, but the Zabbix agent is not reporting',
  stale: () => 'No recent ping value: the last one is too old to trust',
  'no-interface': () => 'No interface in Zabbix, so the ping check can’t run',
  unsupported: () => 'The ping check is not supported on this host',
  disabled: () => 'Monitoring is disabled for this host in Zabbix',
};

/**
 * Label, pill kind and tooltip for a host. Uses the BFF's `state` when it sends
 * one; an older BFF leaves only the interface flags, rolled up as before.
 */
export function hostStatus(h: {
  state?: HostState;
  reason?: StateReason;
  availability?: 'available' | 'unavailable' | 'unknown';
  interfaces?: { available?: string }[];
}): { kind: HostStatusKind; label: string; title?: string } {
  if (h.state) {
    const title = h.reason ? REASON_TEXT[h.reason]?.(h.state) : undefined;
    switch (h.state) {
      case 'up':
        return { kind: 'up', label: 'Up', title };
      case 'down':
        return { kind: 'down', label: 'Down', title };
      case 'degraded':
        return {
          kind: 'degraded',
          label: h.reason === 'snmp-silent' ? 'SNMP silent' : h.reason === 'agent-silent' ? 'Agent silent' : 'Degraded',
          title,
        };
      case 'nodata':
        return { kind: 'nodata', label: 'No data', title };
      case 'disabled':
        return { kind: 'disabled', label: 'Disabled', title };
    }
  }
  if (h.availability) {
    return h.availability === 'available'
      ? { kind: 'up', label: 'Available' }
      : h.availability === 'unavailable'
        ? { kind: 'down', label: 'Unavailable' }
        : { kind: 'unknown', label: 'Unknown' };
  }
  return hostAvailability(h.interfaces);
}

const IFACE_TYPES: Record<string, string> = { '1': 'Agent', '2': 'SNMP', '3': 'IPMI', '4': 'JMX' };
export const ifaceType = (t?: string) => IFACE_TYPES[t ?? ''] ?? 'Iface';
