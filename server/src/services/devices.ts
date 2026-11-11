import { zbx } from '../clients/zabbix.js';
import { cached, SLOW_VIEW } from '../core/cache.js';
import { DEVICE_CLASS_LABELS, deviceClass, siteFromHostName, type DeviceClass } from '../domain/naming.js';
import { categoryFor } from '../sli/engine.js';
import { hostsOverviewView } from './hosts.js';

/**
 * Devices: every host as a device of one kind, for the Devices page; the kind is naming.ts `deviceClass` (template, then name), as in the SLA report.
 * Read-only, from the Hosts page's own calls plus each host's templates, which change rarely and are kept five minutes.
 */

/** The order the page lists the kinds in. Every kind of naming.ts is here, so a new one cannot go missing from the page. */
export const CLASS_ORDER: readonly DeviceClass[] = [
  'switch',
  'firewall',
  'access-point',
  'repeater',
  'server',
  'wan-link',
  'web',
  'other',
];

export async function getDevices() {
  const [overview, templates] = await Promise.all([
    hostsOverviewView(),
    cached('hosts:templates', 300_000, () =>
      zbx<{ hostid: string; parentTemplates?: { name: string }[] }[]>('host.get', {
        output: ['hostid'],
        selectParentTemplates: ['name'],
      }),
    ),
  ]);
  const categoryByHost = new Map(templates.map((t) => [t.hostid, categoryFor((t.parentTemplates ?? []).map((p) => p.name))]));
  return {
    classes: CLASS_ORDER.map((key) => ({ key, label: DEVICE_CLASS_LABELS[key] })),
    devices: overview.map((h) => {
      // A host the template read has not met yet (added a moment ago) has no category, which the class rules allow.
      const category = categoryByHost.get(h.hostid) ?? 'Other';
      return { ...h, site: siteFromHostName(h.name), category, class: deviceClass(h.name, category) };
    }),
  };
}

/** The Devices page as its route and the warm-up read it. */
export const devicesView = () => cached('devices', 30_000, getDevices, SLOW_VIEW);
