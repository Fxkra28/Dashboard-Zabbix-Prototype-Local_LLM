/**
 * Web copy of server/src/domain/naming.ts (the browser cannot import server code).
 * Keep the two in step: site codes 1 to 14 read from HCML's host names.
 */

export interface SiteRef {
  code: number;
  name: string;
}

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

/** Group anything with a host name by site: sites in code order, then "Unassigned". */
export function groupBySite<T>(
  list: T[],
  nameOf: (t: T) => string,
  siteOf?: (t: T) => SiteRef | null | undefined,
): { key: string; label: string; items: T[] }[] {
  const groups = new Map<string, { key: string; label: string; code: number; items: T[] }>();
  for (const t of list) {
    const site = siteOf?.(t) ?? siteFromHostName(nameOf(t));
    const key = site ? String(site.code) : 'none';
    const g =
      groups.get(key) ??
      groups
        .set(key, {
          key,
          label: site ? `${site.code}. ${site.name}` : 'Unassigned',
          code: site ? site.code : Number.MAX_SAFE_INTEGER,
          items: [],
        })
        .get(key)!;
    g.items.push(t);
  }
  return [...groups.values()]
    .sort((a, b) => a.code - b.code)
    .map(({ key, label, items }) => ({
      key,
      label,
      items: items.sort((a, b) => naturalCompare(nameOf(a), nameOf(b))),
    }));
}
