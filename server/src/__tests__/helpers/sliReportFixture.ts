import { CATEGORY_ORDER, DEVICE_CLASS_LABELS, naturalCompare, wanPairKey, type DeviceClass, type SiteRef } from '../../domain/naming.js';
import type { SliProfile } from '../../core/config.js';
import { DERIVED_LABEL, aggregate, type SliGroup, type SliHost, type SliPath, type SliReport, type SliWeb } from '../../sli/engine.js';

/**
 * The two derived SLA reports for August 2026, shaped like production: the
 * strict one and HCML's method, each a real SliReport with groups built by the
 * engine's own `aggregate`. 14 sites, the 4 categories, 138 devices, 6 WAN
 * paths of two legs, 3 web checks and two estate-wide gaps. Every name is made
 * up, and the sites carry the awkward characters real ones do ("&", "/").
 *
 * The spread is deliberate: a few devices fully down (strict sees it, HCML's
 * method does not), some never measured, some with too little data, some on
 * partial data, some in planned maintenance, and a path with no data.
 *
 * Deterministic: the same call always returns the same two reports, and each
 * call returns fresh objects a test can edit.
 */

const FROM = 1785517200; // 2026-08-01 00:00 Asia/Jakarta
const TO = 1788195600; // 2026-09-01 00:00
const MONTH = TO - FROM;
const TARGET = 99;
const at = (iso: string) => Date.parse(iso) / 1000;

const GAPS = [
  { from: at('2026-08-08T03:00:00+07:00'), to: at('2026-08-08T06:00:00+07:00') },
  { from: at('2026-08-19T22:00:00+07:00'), to: at('2026-08-20T02:00:00+07:00') },
];
const GAP_SECONDS = GAPS.reduce((n, g) => n + g.to - g.from, 0);

const SITES: SiteRef[] = [
  'Alder Yard',
  'Birch Point',
  'Cedar / Quay',
  'Dune Camp & Pier',
  'Elm Terminal',
  'Fern Depot',
  'Grove Station',
  'Heath Plant',
  'Ivy Rig',
  'Juniper Base',
  'Kelp / Mooring',
  'Linden Park',
  'Maple Wharf',
  'Nettle Row',
].map((name, i) => ({ code: i + 1, name }));

const WAN_PATHS = ['ALDER', 'BIRCH', 'CEDAR', 'DUNE', 'ELM', 'FERN'];

interface Spec {
  name: string;
  site: SiteRef;
  category: string;
  cls: DeviceClass;
}

const pad = (n: number) => String(n).padStart(2, '0');

function specs(): Spec[] {
  const out: Spec[] = [];
  for (const site of SITES) {
    for (let i = 1; i <= 4; i++) {
      out.push({ site, category: 'Cisco IOS by SNMP', cls: 'switch', name: `${site.code}.2.${i} SAMPLE SWITCH ${pad(i)}` });
    }
    out.push({ site, category: 'FortiGate by SNMP', cls: 'firewall', name: `${site.code}.1 SAMPLE FW 01` });
  }
  for (const site of SITES.slice(0, 12)) {
    for (let i = 1; i <= 3; i++) {
      out.push({ site, category: 'Generic by SNMP', cls: 'access-point', name: `${site.code}.3.${i} SAMPLE AP ${pad(i)}` });
    }
  }
  SITES.slice(0, 7).forEach((site, k) => {
    for (let i = 1; i <= (k < 6 ? 3 : 2); i++) {
      out.push({ site, category: 'ICMP Ping', cls: 'other', name: `${site.code}.4.${i} SAMPLE SENSOR ${pad(i)}` });
    }
  });
  WAN_PATHS.forEach((path, k) => {
    for (const leg of [1, 2]) {
      const provider = path === 'DUNE' ? ` (Provider ${leg === 1 ? 'A' : 'B'})` : '';
      out.push({ site: SITES[k]!, category: 'ICMP Ping', cls: 'wan-link', name: `INET : ${path} WAN ${leg}${provider}` });
    }
  });
  return out;
}

const FULLY_DOWN = new Set(['2.2.3 SAMPLE SWITCH 03', '7.3.1 SAMPLE AP 01', '1.4.2 SAMPLE SENSOR 02']);
const DISABLED = new Set(['9.3.3 SAMPLE AP 03', '12.2.4 SAMPLE SWITCH 04']);
const NO_INTERFACE = new Set(['3.4.3 SAMPLE SENSOR 03', '6.4.2 SAMPLE SENSOR 02']);
const THIN_DATA = new Set(['4.2.2 SAMPLE SWITCH 02', '11.3.2 SAMPLE AP 02', 'INET : ELM WAN 2']);
const PARTIAL = new Set(['5.2.1 SAMPLE SWITCH 01', '8.1 SAMPLE FW 01', '10.3.3 SAMPLE AP 03', '13.2.2 SAMPLE SWITCH 02', '2.4.1 SAMPLE SENSOR 01', 'INET : FERN WAN 1']);
const MAINTENANCE = new Map([
  ['1.2.1 SAMPLE SWITCH 01', 7200],
  ['1.1 SAMPLE FW 01', 3600],
  ['14.2.1 SAMPLE SWITCH 01', 14400],
  ['6.3.2 SAMPLE AP 02', 5400],
  ['INET : CEDAR WAN 1', 1800],
]);
/** Both legs of one path down for days at once, so the path itself misses its target. */
const LEG_OUTAGE = new Map([
  ['INET : BIRCH WAN 1', 190_000],
  ['INET : BIRCH WAN 2', 140_000],
]);

/** A small deterministic generator, so the figures look real without being random. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** What really happened to one device, from which both methods' figures are derived. */
interface Truth {
  downtime: number;
  hcmlDowntime: number;
  hcmlIncidents: number;
  coverage: number;
  maintenance: number;
  incidents: number;
  longest: number;
  measured: boolean;
  disabled: boolean;
}

function truthOf(spec: Spec, rand: () => number): Truth {
  // The same three draws for every device, so editing one special case never reshuffles the rest.
  const [r, r2, r3] = [rand(), rand(), rand()] as [number, number, number];
  const base: Truth = {
    downtime: 0,
    hcmlDowntime: 0,
    hcmlIncidents: 0,
    coverage: 1,
    maintenance: MAINTENANCE.get(spec.name) ?? 0,
    incidents: 0,
    longest: 0,
    measured: true,
    disabled: false,
  };
  const { name } = spec;
  if (FULLY_DOWN.has(name)) {
    const downtime = 86_400 * (1.2 + 3 * r2);
    return { ...base, downtime: Math.round(downtime), hcmlDowntime: Math.round(downtime * 0.004), incidents: 2, longest: Math.round(downtime * 0.8) };
  }
  if (DISABLED.has(name) || NO_INTERFACE.has(name)) {
    return { ...base, coverage: 0, measured: false, disabled: DISABLED.has(name), incidents: NO_INTERFACE.has(name) ? 1 : 0 };
  }
  if (THIN_DATA.has(name)) return { ...base, coverage: 0.31 + 0.1 * r2, downtime: 600, hcmlDowntime: 600, incidents: 1, hcmlIncidents: 1, longest: 600 };
  const out = PARTIAL.has(name) ? { ...base, coverage: 0.8 + 0.13 * r2 } : base;
  const legOutage = LEG_OUTAGE.get(name);
  if (legOutage) return { ...out, downtime: legOutage, hcmlDowntime: legOutage, incidents: 3, hcmlIncidents: 3, longest: Math.round(legOutage * 0.6) };
  if (r < 0.16) {
    const downtime = Math.round((0.005 + 0.045 * r2) * MONTH);
    const incidents = 1 + Math.floor(r3 * 8);
    return { ...out, downtime, hcmlDowntime: Math.round(downtime * 0.96), incidents, hcmlIncidents: incidents, longest: Math.min(downtime, Math.round((downtime / incidents) * 1.6)) };
  }
  if (r < 0.5) {
    const downtime = Math.round(r2 * 0.0085 * MONTH);
    const incidents = downtime ? 1 + Math.floor(r3 * 3) : 0;
    return { ...out, downtime, hcmlDowntime: downtime, incidents, hcmlIncidents: incidents, longest: incidents ? Math.round(downtime / incidents) : 0 };
  }
  return out;
}

function host(spec: Spec, hostid: string, t: Truth, strict: boolean): SliHost {
  const measurable = MONTH - t.maintenance;
  const covered = strict ? (t.measured ? Math.round(t.coverage * measurable) : 0) : measurable;
  const nodata = strict && (covered === 0 || t.coverage < 0.5);
  const downtime = !t.measured || nodata ? 0 : Math.min(strict ? t.downtime : t.hcmlDowntime, covered);
  const denominator = strict ? covered : measurable;
  const sli = nodata || denominator <= 0 ? null : Math.max(0, 100 * (1 - downtime / denominator));
  return {
    hostid,
    name: spec.name,
    hostStatus: t.disabled ? '1' : '0',
    site: spec.site,
    category: spec.category,
    deviceClass: spec.cls,
    triggerids: strict ? [`${hostid}1`, `${hostid}2`] : [`${hostid}2`],
    sli,
    downtime,
    window: MONTH,
    covered,
    maintenance: t.maintenance,
    coverage: covered / measurable,
    incidents: strict ? t.incidents : t.hcmlIncidents,
    longest: Math.min(t.longest, downtime),
    dataStatus: nodata ? 'nodata' : strict && covered < 0.95 * Math.max(0, MONTH - GAP_SECONDS - t.maintenance) ? 'partial' : 'ok',
    measured: t.measured,
    meeting: sli === null ? null : sli >= TARGET,
    errorBudget: sli === null ? null : (1 - TARGET / 100) * denominator - downtime,
  };
}

/** The order the engine returns hosts in: worst first, no data last, then by name. */
const byWorst = (a: SliHost, b: SliHost) =>
  (a.sli === null ? 1 : 0) - (b.sli === null ? 1 : 0) || (a.sli ?? 0) - (b.sli ?? 0) || naturalCompare(a.name, b.name);

function groupBy(hosts: SliHost[], keyOf: (h: SliHost) => string, nameOf: (key: string, h: SliHost) => string): SliGroup[] {
  const buckets = new Map<string, { name: string; hosts: SliHost[] }>();
  for (const h of hosts) {
    const key = keyOf(h);
    const bucket = buckets.get(key) ?? { name: nameOf(key, h), hosts: [] };
    bucket.hosts.push(h);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].map(([key, b]) => aggregate(key, b.name, b.hosts, TARGET));
}

const rank = (key: string) => {
  const i = CATEGORY_ORDER.indexOf(key);
  return i < 0 ? CATEGORY_ORDER.length : i;
};

function wanPaths(hosts: SliHost[], strict: boolean): SliPath[] {
  const byPath = new Map<string, { legs: SliHost[]; ids: string[] }>();
  for (const h of hosts) {
    const key = wanPairKey(h.name);
    if (!key) continue;
    const row = byPath.get(key.path) ?? { legs: [], ids: [] };
    row.legs.push(h);
    row.ids.push(key.leg);
    byPath.set(key.path, row);
  }
  return [...byPath.entries()]
    .map(([path, { legs, ids }]): SliPath => {
      const nodata = legs.some((l) => l.dataStatus === 'nodata');
      const coverage = Math.min(...legs.map((l) => l.coverage));
      // Both legs are rarely down together: a third of the shorter outage is a fair stand-in.
      const downtime = Math.round(Math.min(...legs.map((l) => l.downtime)) / 3);
      const covered = strict ? Math.round(coverage * MONTH) : MONTH;
      return {
        key: `wan:${path}`,
        name: path,
        site: legs[0]!.site,
        legs: legs
          .map((l, i) => ({ hostid: l.hostid, name: l.name, leg: ids[i]!, sli: l.sli, dataStatus: l.dataStatus }))
          .sort((a, b) => naturalCompare(a.leg, b.leg)),
        sli: nodata || covered <= 0 ? null : Math.max(0, 100 * (1 - downtime / covered)),
        downtime,
        coverage,
        dataStatus: nodata ? 'nodata' : strict && covered < 0.95 * (MONTH - GAP_SECONDS) ? 'partial' : 'ok',
      };
    })
    .sort((a, b) => naturalCompare(a.name, b.name));
}

function web(): SliWeb[] {
  const check = (itemid: string, name: string, coverage: number, downtime: number, nodata = false): SliWeb => ({
    itemid,
    name,
    sli: nodata ? null : 100 * (1 - downtime / (coverage * MONTH)),
    downtime: nodata ? 0 : downtime,
    coverage,
    dataStatus: nodata ? 'nodata' : coverage < 0.95 * ((MONTH - GAP_SECONDS) / MONTH) ? 'partial' : 'ok',
  });
  return [
    check('41001', 'Sample portal login', 0.998, 346),
    check('41002', 'Sample public site', 0.97, 33_760),
    check('41003', 'Sample status page', 0.18, 0, true),
  ];
}

function report(profile: SliProfile, hosts: SliHost[]): SliReport {
  const strict = profile === 'availability';
  const sorted = [...hosts].sort(byWorst);
  return {
    source: 'derived',
    label: DERIVED_LABEL,
    profile,
    month: '2026-08',
    from: FROM,
    to: TO,
    end: TO,
    closed: true,
    timezone: 'Asia/Jakarta',
    target: TARGET,
    basis: {
      triggers: strict ? ['Unavailable by ICMP ping', 'High ICMP ping loss'] : ['High ICMP ping loss'],
      gapPolicy: strict ? 'excluded' : 'counted-as-up',
      noDataPolicy: strict ? 'excluded' : 'counted-as-100',
      maintenancePolicy: 'excluded',
    },
    overall: aggregate('overall', 'HCML estate', sorted, TARGET),
    categories: groupBy(sorted, (h) => h.category, (k) => k).sort((a, b) => rank(a.key) - rank(b.key)),
    sites: groupBy(
      sorted,
      (h) => `site:${h.site!.code}`,
      (_k, h) => `${h.site!.code} · ${h.site!.name}`,
    ).sort((a, b) => Number(a.key.replace('site:', '')) - Number(b.key.replace('site:', ''))),
    classes: groupBy(
      sorted,
      (h) => h.deviceClass,
      (k) => DEVICE_CLASS_LABELS[k as DeviceClass],
    ).sort((a, b) => naturalCompare(a.name, b.name)),
    hosts: sorted,
    wanPaths: wanPaths(sorted, strict),
    web: strict ? web() : [],
    gaps: strict ? GAPS.map((g) => ({ ...g })) : [],
    noDataWindows: [],
    stats: strict
      ? { zabbixCalls: 24, triggers: 276, events: 3412, trendRows: 98_765, ms: 4210 }
      : { zabbixCalls: 7, triggers: 138, events: 1210, trendRows: 0, ms: 880 },
    generatedAt: at('2026-09-01T02:10:00Z'),
  };
}

export function sampleSliReports(): { strict: SliReport; hcml: SliReport } {
  const rand = rng(11);
  const all = specs().map((spec, i) => ({ spec, hostid: String(10_000 + i), truth: truthOf(spec, rand) }));
  const hosts = (strict: boolean) => all.map(({ spec, hostid, truth }) => host(spec, hostid, truth, strict));
  return { strict: report('availability', hosts(true)), hcml: report('hcml-report', hosts(false)) };
}
