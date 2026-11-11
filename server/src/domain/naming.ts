/**
 * What a host's name says about it, following HCML's own convention (read off their 2026-06/07/08
 * Availability Reports, see setup.md §16):
 *
 *   devices    <site>.<class>[.<seq>] NAME     1.2.1 IDX02CORESWITCH
 *   services   <TYPE> : NAME                   INET : SAMPANG WAN 1
 *
 * No HCML host carries a `site` tag, so the name is the most reliable site signal the estate has.
 * HCML applies the convention inconsistently (site 9 numbers its switch 9.1.1, site 12 has both
 * 12.1 and 12.1.1), so the class is taken from the monitoring template first and the name only as a
 * fallback.
 */

export interface SiteRef {
  code: number;
  name: string;
}

/** Sites 1 to 14, with the words that name them in `INET :` / `SERVER :` hosts. */
export const SITES: (SiteRef & { aliases: string[] })[] = [
  { code: 1, name: 'Jakarta', aliases: ['JAKARTA', 'JKT', 'IDX'] },
  { code: 2, name: 'Surabaya', aliases: ['SURABAYA', 'SBY'] },
  { code: 3, name: 'SSB / Sampang', aliases: ['SAMPANG', 'SSB', 'SAM'] },
  { code: 4, name: 'FPSO KAS3 & BD-WHP', aliases: ['FPSO', 'KAS3', 'BDW'] },
  { code: 5, name: 'Pasuruan / GMS', aliases: ['PASURUAN', 'GMS', 'PAS'] },
  { code: 6, name: 'Sumenep', aliases: ['SUMENEP', 'SUP', 'STP'] },
  { code: 7, name: 'Sapudi', aliases: ['SAPUDI'] },
  { code: 8, name: 'MDA', aliases: ['MDA'] },
  { code: 9, name: 'MBH', aliases: ['MBH'] },
  { code: 10, name: 'FPU', aliases: ['FPU'] },
  { code: 11, name: 'MOPU / MAC', aliases: ['MOPU', 'MAC'] },
  { code: 12, name: 'Porong', aliases: ['PORONG', 'POR'] },
  { code: 13, name: 'Tanjung Wangi', aliases: ['TJWB', 'TANJUNG WANGI'] },
  { code: 14, name: 'TWSB', aliases: ['TWSB'] },
];

const BY_CODE = new Map(SITES.map((s) => [s.code, s]));

/** Numeric-aware ordering: `1.2.2` before `1.2.10`, `Gi1/0/2` before `Gi1/0/10`. */
export const naturalCompare = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;

/** A host named by its address (10.20.30.40) has no site code: HCML's codes are two or three numbers, never four. */
const ADDRESS_NAME = /^\s*\d{1,3}(?:\.\d{1,3}){3}(?!\d)/;

/**
 * The site a host belongs to, from its name alone, or null when the name
 * does not say (`WEB :` services, `INTERNET`, `Zabbix server`).
 */
export function siteFromHostName(name: string): SiteRef | null {
  if (ADDRESS_NAME.test(name)) return null;
  const coded = /^\s*(\d{1,2})\./.exec(name);
  if (coded) {
    const site = BY_CODE.get(Number(coded[1]));
    return site ? { code: site.code, name: site.name } : null;
  }
  const service = /^\s*(INET|SERVER)\s*:\s*(.+)$/i.exec(name);
  if (service) {
    const words = service[2].toUpperCase();
    for (const site of SITES) {
      if (site.aliases.some((a) => new RegExp(`\\b${a}\\b`).test(words))) {
        return { code: site.code, name: site.name };
      }
    }
  }
  return null;
}

export type DeviceClass =
  | 'firewall'
  | 'switch'
  | 'access-point'
  | 'repeater'
  | 'wan-link'
  | 'web'
  | 'server'
  | 'other';

export const DEVICE_CLASS_LABELS: Record<DeviceClass, string> = {
  firewall: 'Firewalls',
  switch: 'Switches',
  'access-point': 'Access points',
  repeater: 'Radio repeaters',
  'wan-link': 'WAN links',
  web: 'Web services',
  server: 'Servers',
  other: 'Other',
};

/**
 * What kind of device a host is. The service prefixes are unambiguous and win;
 * then the monitoring template; then words in the name.
 */
export function deviceClass(name: string, templateName?: string): DeviceClass {
  const n = name.toUpperCase();
  if (/^\s*INET\s*:/.test(n)) return 'wan-link';
  if (/^\s*WEB\s*:/.test(n)) return 'web';
  if (/^\s*SERVER\s*:/.test(n)) return 'server';
  if (/REPEATER/.test(n)) return 'repeater';

  const t = (templateName ?? '').toUpperCase();
  if (t.includes('FORTIGATE')) return 'firewall';
  if (t.includes('CISCO IOS')) return 'switch';

  if (/ARUBA|WICTR|\bWAC\b/.test(n)) return 'access-point';
  if (/FW\d|\bFW\b|\bFG|FGT|FGR|FORTI/.test(n)) return 'firewall';
  if (/SWITCH|\bSW\b|_CS\d|_IE\d|-IE\d|ACS|CS2960|MOXA|BRIDGE/.test(n)) return 'switch';
  if (t.includes('GENERIC BY SNMP')) return 'access-point';
  return 'other';
}

/**
 * Report category labels, in the order HCML's reports list them. The category
 * is the monitoring template the availability trigger comes from.
 */
export const CATEGORY_ORDER = ['Cisco IOS by SNMP', 'ICMP Ping', 'Generic by SNMP', 'FortiGate by SNMP'];

export function categoryLabel(templateName: string | undefined): string {
  if (!templateName) return 'Other';
  const t = templateName.trim();
  const known = CATEGORY_ORDER.find((c) => c.toLowerCase() === t.toLowerCase());
  return known ?? t;
}

/**
 * `INET : SAMPANG WAN 1` and `INET : SAMPANG WAN 2` are two legs of one path.
 * Returns the path name and the leg, or null for anything that is not a WAN leg.
 */
export function wanPairKey(name: string): { path: string; leg: string; provider?: string } | null {
  const m = /^\s*INET\s*:\s*(.+?)\s+(?:WAN|INTERNET)\s*(\d+)\b\s*(?:\((.+)\))?\s*$/i.exec(name);
  if (!m) return null;
  return { path: m[1].trim().toUpperCase(), leg: m[2], ...(m[3] ? { provider: m[3].trim() } : {}) };
}
