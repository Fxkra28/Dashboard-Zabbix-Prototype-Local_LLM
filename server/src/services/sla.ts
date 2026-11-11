import { zbx } from '../clients/zabbix.js';
import { cached, SLOW_VIEW } from '../core/cache.js';

/**
 * Zabbix Services → SLA, read-only. These return [] until Services
 * and SLAs are configured in Zabbix, same as the network-device views.
 */

export interface ZbxSla {
  slaid: string;
  name: string;
  slo: string; // promised availability target, e.g. '99.9'
  period: string; // '0' daily, '1' weekly, '2' monthly, '3' quarterly, '4' annually
  status: string; // '0' disabled, '1' enabled
  timezone?: string;
  description?: string;
}

/** One service's achieved availability for one reporting period. */
export interface SlaSli {
  serviceid: string;
  name: string;
  sli: number; // achieved availability %
  uptime: number; // seconds
  downtime: number; // seconds
  error_budget: number; // seconds left before the SLO is missed (negative = missed)
  period_from: number;
  period_to: number;
}

export async function getSlas(): Promise<ZbxSla[]> {
  return zbx<ZbxSla[]>('sla.get', {
    output: ['slaid', 'name', 'slo', 'period', 'status', 'timezone', 'description'],
    sortfield: 'name',
  });
}

/**
 * sla.getsli returns a period × service matrix plus bare service ids; flatten
 * it into rows and attach service names so the UI doesn't have to.
 */
export async function getSli(slaid: string, serviceid?: string): Promise<SlaSli[]> {
  // sla.getsli returns serviceids as numbers while every other Zabbix method
  // returns ids as strings, normalise so callers see one consistent shape.
  const raw = await zbx<{
    periods: { period_from: number; period_to: number }[];
    serviceids: (string | number)[];
    sli: { uptime: number; downtime: number; sli: number; error_budget: number }[][];
  }>('sla.getsli', {
    slaid,
    ...(serviceid ? { serviceids: [serviceid] } : {}),
    periods: 1, // current period only
  });

  if (!raw?.serviceids?.length) return [];

  const services = await zbx<{ serviceid: string; name: string }[]>('service.get', {
    serviceids: raw.serviceids,
    output: ['serviceid', 'name'],
  });
  const nameById = Object.fromEntries(services.map((s) => [s.serviceid, s.name]));

  const period = raw.periods[0];
  const row = raw.sli[0] ?? [];
  return raw.serviceids.map((raw_sid, i) => {
    const sid = String(raw_sid);
    return {
      serviceid: sid,
      name: nameById[sid] ?? sid,
      sli: row[i]?.sli ?? 0,
      uptime: row[i]?.uptime ?? 0,
      downtime: row[i]?.downtime ?? 0,
      error_budget: row[i]?.error_budget ?? 0,
      period_from: period?.period_from ?? 0,
      period_to: period?.period_to ?? 0,
    };
  });
}

/**
 * Whether Zabbix's own SLAs have anything to show. HCML's Zabbix has one SLA
 * and no services, so its SLA page would be empty; the UI (and the assistant)
 * switch to the derived monthly SLA when this says `real: false`. Decided here
 * once so every consumer applies the same rule.
 */
export interface SlaSource {
  real: boolean;
  slas: number;
  services: number;
}

export async function getSlaSource(): Promise<SlaSource> {
  const [slas, count] = await Promise.all([
    slasView(),
    zbx<string>('service.get', { countOutput: true }),
  ]);
  const services = Number(count) || 0;
  const enabled = slas.filter((s) => s.status !== '0');
  let real = false;
  if (services > 0) {
    const slis = await Promise.all(
      enabled.map((s) => sliView(s.slaid).catch(() => [])),
    );
    real = slis.some((rows) => rows.length > 0);
  }
  return { real, slas: slas.length, services };
}

/** The SLA list and one SLA's figures as their routes, Explain, the Assistant and the warm-up read them. */
export const slasView = () => cached('sla', 60_000, getSlas, SLOW_VIEW);
export const sliView = (slaid: string, serviceid?: string) =>
  cached(`sli:${slaid}:${serviceid ?? 'all'}`, 60_000, () => getSli(slaid, serviceid), SLOW_VIEW);
