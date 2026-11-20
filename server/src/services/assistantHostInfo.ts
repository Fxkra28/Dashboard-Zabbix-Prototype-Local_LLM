/**
 * What a host is, for a question about it: its state, groups and templates and, on this machine only, its addresses, tags, inventory and contacts. A model outside this machine is given no address
 * and nothing that can name a person, since a tag or an inventory field may hold one. HCML's Zabbix holds no inventory and no tag for most hosts, so the usual answer to "who is in charge" is that
 * nothing is recorded, and it is said so and not guessed.
 */

import { zbx } from '../clients/zabbix.js';
import { config } from '../core/config.js';
import type { ZTimeperiod } from '../sli/maintenance.js';
import { HOST_NAME_MAX, promptText, section, stamp } from './assistantLines.js';
import { periodsAt } from './assistantMaintenance.js';

export interface HostInfo {
  hostid: string;
  name: string;
  enabled: boolean;
  /** The maintenance window the host is in now, if any. */
  maintenance: { name: string; /** Epoch seconds, or null when not known. */ until: number | null; collects: boolean } | null;
  interfaces: { ip: string; dns: string; type: string; port: string; main: boolean }[];
  groups: string[];
  templates: string[];
  tags: { tag: string; value: string }[];
  description: string;
  /** Only the inventory fields that hold something. */
  inventory: Record<string, string>;
}

const INTERFACE_TYPE: Record<string, string> = { '1': 'agent', '2': 'SNMP', '3': 'IPMI', '4': 'JMX' };

/** The inventory fields about the device and where it is, in the order they are written; the person behind it is in `POC` below. */
const INVENTORY_FIELDS: [string, string][] = [
  ['type', 'type'],
  ['vendor', 'vendor'],
  ['model', 'model'],
  ['serialno_a', 'serial'],
  ['os_short', 'os'],
  ['hardware', 'hardware'],
  ['location', 'location'],
  ['site_city', 'city'],
  ['site_rack', 'rack'],
  ['deployment_status', 'deployment'],
];

const FIELD_MAX = 80;

/** The contacts of one host, as one text; empty when the inventory holds none. */
function contactOf(inv: Record<string, string>): string {
  const person = (...keys: string[]) => keys.map((k) => promptText(inv[k] ?? '', FIELD_MAX)).filter(Boolean).join(', ');
  const first = person('poc_1_name', 'poc_1_email', 'poc_1_phone_a') || person('poc_1_cell');
  const second = person('poc_2_name', 'poc_2_email', 'poc_2_phone_a');
  const field = promptText(inv.contact ?? '', FIELD_MAX);
  return [first, second ? `second contact ${second}` : '', field ? `contact field: ${field}` : ''].filter(Boolean).join('; ');
}

export interface HostInfoOptions {
  /** The model is on this machine, so the addresses, the tags and the inventory may be given. A model outside it is given the state, the groups and the templates, which name no address and no person. */
  local: boolean;
  /** The user holds the Inventory page: the tags, the inventory fields and the contacts are shown on no other page, so a user without it is not given them even by a model on this machine (SC-65). */
  inventoryPage?: boolean;
  /** Contacts may be given: the model is on this machine and the user has the Inventory page. */
  people: boolean;
  /** The question asks for a person, so contacts are given if they may be. */
  peopleAsked: boolean;
  now: number;
  tz: string;
  budget: number;
}

const OUTSIDE = 'not given to a model outside this machine';
const NO_PAGE = 'not given: this account does not have the Inventory page';

export function hostInfoSection(h: HostInfo, { local, inventoryPage = true, people, peopleAsked, tz, budget }: HostInfoOptions): { text: string; truncated: boolean } {
  // The name of a maintenance window and the description of a host are free text that staff write: they follow the tags and the inventory, and a model outside this machine, or a person without the Inventory page, is not given them.
  const free = local && inventoryPage;
  const state = `${h.enabled ? 'enabled' : 'disabled'}, ${
    h.maintenance
      ? `in maintenance${free ? ` "${promptText(h.maintenance.name, 60)}"` : ''}${h.maintenance.until ? ` until ${stamp(h.maintenance.until, tz)}` : ''} (${h.maintenance.collects ? 'data is still collected' : 'no data is collected'})`
      : 'not in maintenance'
  }`;
  const addressList = h.interfaces.slice(0, 4).map((i) => `${promptText(i.ip || i.dns, 60)} (${INTERFACE_TYPE[i.type] ?? 'interface'}, port ${promptText(i.port, 8)})`);
  const tags = h.tags.slice(0, 8).map((t) => `${promptText(t.tag, 30)}${t.value ? `=${promptText(t.value, 40)}` : ''}`);
  const inventory = INVENTORY_FIELDS.map(([key, label]) => (h.inventory[key] ? `${label} ${promptText(h.inventory[key], FIELD_MAX)}` : '')).filter(Boolean);
  const outside = OUTSIDE;
  // The tags and the inventory: a model on this machine is given them for a user who holds the Inventory page, and the line says which of the two reasons keeps them back.
  const withheld = !local ? OUTSIDE : !inventoryPage ? NO_PAGE : null;
  const lines = [
    `- State: ${state}`,
    ...(!local ? [`- Address: ${outside}`] : addressList.length ? [`- Address: ${addressList.join(', ')}`] : []),
    ...(h.groups.length ? [`- Groups: ${h.groups.slice(0, 6).map((g) => promptText(g, 40)).join(', ')}`] : []),
    ...(h.templates.length ? [`- Templates: ${h.templates.slice(0, 6).map((t) => promptText(t, 40)).join(', ')}`] : []),
    `- Tags: ${withheld ?? (tags.length ? tags.join(', ') : 'none')}`,
    `- Inventory: ${withheld ?? (inventory.length ? inventory.join(', ') : 'nothing recorded in Zabbix')}`,
    // Free text that staff write, where a name and a number are what they put (SC-64), and that no page of the portal shows: it goes where the tags and the inventory go.
    ...(h.description ? [`- Description: ${withheld ?? promptText(h.description, 120)}`] : []),
  ];
  if (peopleAsked) {
    const hasOwnerTag = h.tags.some((t) => /owner/i.test(t.tag));
    const contact = contactOf(h.inventory);
    lines.push(
      `- Contacts on record: ${
        !people ? (local && !inventoryPage ? NO_PAGE : outside) : contact || (hasOwnerTag ? 'none in the inventory (see the owner tag)' : 'none (Zabbix holds no contact or owner for this host)')
      }`,
    );
  }
  return section(`DETAILS of ${promptText(h.name, HOST_NAME_MAX)}:`, lines, budget);
}

/** The contacts on record across the hosts of a site, each with how many hosts name it, for "siapa penanggung jawab di Surabaya?". */
export function siteContactsSection(site: string, hosts: HostInfo[], { people, local = true, inventoryPage = true, budget }: { people: boolean; local?: boolean; inventoryPage?: boolean; budget: number }): { text: string; truncated: boolean } {
  const title = `CONTACTS on record for the hosts of ${promptText(site, HOST_NAME_MAX)} (${hosts.length} host${hosts.length === 1 ? '' : 's'} read):`;
  if (!people) return section(title, [`- ${local && !inventoryPage ? NO_PAGE : OUTSIDE}`], budget);
  const counts = new Map<string, number>();
  let none = 0;
  for (const h of hosts) {
    const person = [h.inventory.poc_1_name, h.inventory.poc_1_email].map((v) => promptText(v ?? '', FIELD_MAX)).filter(Boolean).join(', ') || promptText(h.inventory.contact ?? '', FIELD_MAX);
    if (!person) none++;
    else counts.set(person, (counts.get(person) ?? 0) + 1);
  }
  const noun = (n: number) => `${n} host${n === 1 ? '' : 's'}`;
  if (!counts.size) return section(title, ['- none: Zabbix holds no contact or owner for any of them'], budget);
  const lines = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([person, n]) => `- ${person}: ${noun(n)}`);
  if (none) lines.push(`- no contact on record: ${noun(none)}`);
  return section(title, lines, budget, (left) => `- …and ${left} more contacts, not listed`);
}

const READ_MS = 8_000;

interface HostRow {
  hostid: string;
  name: string;
  status: string;
  maintenance_status?: string;
  maintenanceid?: string;
  description?: string;
  interfaces?: { ip: string; dns: string; type: string; main: string; port: string }[];
  hostgroups?: { name: string }[];
  parentTemplates?: { name: string }[];
  tags?: { tag: string; value: string }[];
  inventory?: Record<string, string> | never[];
}

export async function readHostInfo(hostids: string[], now: number = Math.floor(Date.now() / 1000)): Promise<HostInfo[]> {
  const rows = await zbx<HostRow[]>(
    'host.get',
    {
      hostids,
      output: ['hostid', 'name', 'status', 'maintenance_status', 'maintenance_type', 'maintenanceid', 'description'],
      selectInterfaces: ['ip', 'dns', 'type', 'main', 'port'],
      selectHostGroups: ['name'],
      selectTags: ['tag', 'value'],
      selectInventory: 'extend',
      selectParentTemplates: ['name'],
    },
    { timeoutMs: READ_MS },
  );
  const windowIds = [...new Set(rows.filter((r) => r.maintenance_status === '1' && r.maintenanceid && r.maintenanceid !== '0').map((r) => r.maintenanceid as string))];
  const windows = new Map<string, HostInfo['maintenance']>();
  if (windowIds.length) {
    const found = await zbx<{ maintenanceid: string; name: string; active_since: string; active_till: string; maintenance_type: string; timeperiods?: ZTimeperiod[] }[]>(
      'maintenance.get',
      { maintenanceids: windowIds, output: ['maintenanceid', 'name', 'active_since', 'active_till', 'maintenance_type'], selectTimeperiods: 'extend' },
      { timeoutMs: READ_MS },
    );
    // The end of the period in effect, and not of the range in which the maintenance is valid, which a weekly slot valid all year would make the end of the year (BK-89).
    for (const m of found) windows.set(m.maintenanceid, { name: m.name, until: periodsAt(m, now, config.sla.timezone)?.current?.to ?? null, collects: m.maintenance_type === '0' });
  }
  return rows.map((r) => {
    const inventory: Record<string, string> = {};
    if (r.inventory && !Array.isArray(r.inventory)) {
      for (const [k, v] of Object.entries(r.inventory)) if (k !== 'hostid' && typeof v === 'string' && v.trim() !== '') inventory[k] = v;
    }
    return {
      hostid: r.hostid,
      name: r.name,
      enabled: r.status === '0',
      maintenance: r.maintenance_status === '1' ? (windows.get(r.maintenanceid ?? '') ?? { name: 'a maintenance window', until: null, collects: false }) : null,
      interfaces: (r.interfaces ?? []).map((i) => ({ ip: i.ip, dns: i.dns, type: i.type, port: i.port, main: i.main === '1' })),
      groups: (r.hostgroups ?? []).map((g) => g.name),
      templates: (r.parentTemplates ?? []).map((t) => t.name),
      tags: r.tags ?? [],
      description: r.description ?? '',
      inventory,
    };
  });
}
