/** The capacity report: CPU, memory, disk and interface utilisation per host over a number of days, read from trends. */

import { zbx } from '../clients/zabbix.js';
import { cached } from '../core/cache.js';
import { config } from '../core/config.js';
import { fetchTrendsSliced } from '../sli/events.js';
import { CAPACITY_STALE_MS, CAPACITY_TTL, heavy, staleReport } from './reportPolicy.js';

/**
 * Cap on the raw-history fallback in the capacity report. Small on purpose: this path only runs on
 * an instance too young to have trends, where there is little history to read in the first place.
 */
const HISTORY_FALLBACK_LIMIT = 10_000;

/** How long the ports' link speeds are kept, and then shown while new ones are read. */
const SPEEDS_TTL_MS = 24 * 60 * 60_000;

/**
 * Key matchers. The Linux-agent forms (`system.cpu.util`, `vm.memory.util`) are the plain ones;
 * HCML's estate is almost entirely SNMP devices, whose templates put an OID in the key:
 *
 *   Cisco IOS by SNMP   system.cpu.util[cpmCPUTotal5minRev.19]   vm.memory.util[vm.memory.util.1]
 *   FortiGate by SNMP   system.cpu.util[fgSysCpuUsage.0]         vm.memory.util[memoryUsedPercentage.0]
 *
 * `system.cpu.util[,idle]` must not match: it is the idle share, the opposite of what a capacity
 * report wants, and an OID parameter never starts with a comma, so the SNMP pattern cannot catch
 * it.
 */
const SNMP_PARAM = /^\[[A-Za-z][\w.]*\.\d+\]$/;

const METRICS: {
  key: string;
  label: string;
  search: string;
  match: (k: string) => boolean;
  /** Turn a stored value into the percentage the report shows. */
  transform?: (v: number) => number;
}[] = [
  {
    key: 'cpu',
    label: 'CPU utilisation',
    search: 'system.cpu.util',
    match: (k) =>
      k === 'system.cpu.util' || k === 'system.cpu.util[]' || SNMP_PARAM.test(k.slice('system.cpu.util'.length)),
  },
  {
    key: 'memory',
    label: 'Memory utilisation',
    search: 'vm.memory.util',
    match: (k) =>
      k === 'vm.memory.util' ||
      k === 'vm.memory.utilization' ||
      SNMP_PARAM.test(k.slice('vm.memory.util'.length)),
  },
  {
    key: 'disk',
    label: 'Filesystem used',
    search: 'vfs.fs',
    match: (k) => /,\s*pused\]$/.test(k),
  },
  {
    // FortiGate reports free space only; used = 100 − free.
    key: 'disk',
    label: 'Filesystem used',
    search: 'vfs.fs.pfree',
    match: (k) => k === 'vfs.fs.pfree',
    transform: (v) => 100 - v,
  },
];

/** Exported for tests: which keys each capacity metric picks up. */
export function capacityMetricFor(key: string): string | undefined {
  return METRICS.find((m) => key.startsWith(m.search) && m.match(key))?.key;
}

export interface CapacityRow {
  metric: string;
  label: string;
  itemid: string;
  hostid: string;
  host: string;
  name: string;
  units: string;
  avg: number;
  max: number;
  /** 'trend' = hourly aggregates, 'history' = raw points (young instances). */
  source: 'trend' | 'history' | 'none';
}

export interface CapacityReport {
  days: number;
  metrics: { key: string; label: string; rows: CapacityRow[] }[];
}

/** Running avg/max per item, folded row by row so a year of trends is never held at once. */
type Aggregates = Map<string, { sum: number; n: number; max: number }>;

function addSample(agg: Aggregates, itemid: string, avg: number, max: number): void {
  const a = agg.get(itemid) ?? { sum: 0, n: 0, max: -Infinity };
  a.sum += avg;
  a.n++;
  a.max = Math.max(a.max, max);
  agg.set(itemid, a);
}

export async function getCapacity(days: number, top: number): Promise<CapacityReport> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 86400;

  const matched = await Promise.all(
    METRICS.map(async (m) =>
      (
        await zbx<
          {
            itemid: string;
            name: string;
            key_: string;
            units?: string;
            value_type: string;
            hosts?: { hostid: string; name: string }[];
          }[]
        >('item.get', {
          output: ['itemid', 'name', 'key_', 'units', 'value_type'],
          search: { key_: m.search },
          // Every METRICS key is a prefix; a substring search scans all items.
          startSearch: true,
          monitored: true, // exclude template items
          selectHosts: ['hostid', 'name'],
        })
      ).filter((i) => m.match(i.key_)),
    ),
  );

  // Every metric's trends in one sliced read, so a long window stays within
  // what Zabbix's PHP can answer (a year in one request was an HTTP 500) and
  // at most `maxParallel` requests run at once, whatever the metric count.
  const trendAgg: Aggregates = new Map();
  await fetchTrendsSliced<{ itemid: string; value_avg: string; value_max: string }>(
    [...new Set(matched.flat().map((i) => i.itemid))],
    from,
    to,
    ['itemid', 'value_avg', 'value_max'],
    {
      parallel: config.sla.maxParallel,
      onRows: (rows) => {
        for (const r of rows) addSample(trendAgg, r.itemid, Number(r.value_avg), Number(r.value_max));
      },
    },
  );

  const perMatcher = await Promise.all(
    METRICS.map(async (m, k) => {
      const items = matched[k];
      if (!items.length) return { key: m.key, label: m.label, rows: [] };

      // Trends are hourly and only exist once an hour has passed; a young
      // instance has history but no trends, so fall back rather than show
      // an empty report.
      let agg = trendAgg;
      let source: CapacityRow['source'] = items.some((i) => trendAgg.has(i.itemid)) ? 'trend' : 'history';

      if (source === 'history') {
        // Only the most recent day, not the whole requested window. No trends
        // means the instance is young, so that is where its history actually
        // is, and pulling 50k raw rows into the BFF to compute an average
        // Zabbix could have aggregated is exactly what setup.md §18 warns
        // against. Raw history is the degraded path; keep it cheap.
        const histFrom = Math.max(from, to - 86_400);
        const hist = await zbx<{ itemid: string; value: string }[]>('history.get', {
          itemids: items.map((i) => i.itemid),
          history: Number(items[0].value_type) === 3 ? 3 : 0,
          time_from: histFrom,
          time_till: to,
          output: 'extend',
          limit: HISTORY_FALLBACK_LIMIT,
        });
        if (!hist.length) source = 'none';
        agg = new Map();
        for (const h of hist) addSample(agg, h.itemid, Number(h.value), Number(h.value));
      }

      const t = m.transform ?? ((v: number) => v);
      const rows: CapacityRow[] = items
        .filter((i) => agg.has(i.itemid))
        .map((i) => {
          const a = agg.get(i.itemid)!;
          const host = i.hosts?.[0];
          const avg = a.n ? t(a.sum / a.n) : 0;
          const max = Number.isFinite(a.max) ? t(a.max) : 0;
          return {
            metric: m.key,
            label: m.label,
            itemid: i.itemid,
            hostid: host?.hostid ?? '',
            host: host?.name ?? '',
            name: i.name,
            units: i.units || '%',
            // For free→used the aggregate max of free is the minimum of used.
            avg,
            max: m.transform ? Math.max(avg, max) : max,
            source,
          };
        });

      return { key: m.key, label: m.label, rows };
    }),
  );

  // One row per host per metric: a switch with two CPU modules or a
  // "reserve Processor" memory pool is one device, shown by its busiest item.
  const byMetric = new Map<string, { label: string; rows: CapacityRow[] }>();
  for (const { key, label, rows } of perMatcher) {
    const entry = byMetric.get(key) ?? { label, rows: [] };
    entry.rows.push(...rows);
    byMetric.set(key, entry);
  }
  const metrics = [...byMetric.entries()].map(([key, { label, rows }]) => {
    const best = new Map<string, CapacityRow>();
    for (const r of rows) {
      const prev = best.get(r.hostid || r.itemid);
      if (!prev || r.avg > prev.avg) best.set(r.hostid || r.itemid, r);
    }
    return {
      key,
      label,
      rows: [...best.values()].sort((a, b) => b.avg - a.avg).slice(0, top),
    };
  });

  metrics.push(await interfaceUtilisation(from, to, top));
  return { days, metrics };
}

/**
 * Busiest network interfaces, as a share of their link speed. The estate has
 * thousands of interfaces, so they are preselected on their latest rate and
 * only the top candidates' trends are read.
 */
async function interfaceUtilisation(
  from: number,
  to: number,
  top: number,
): Promise<{ key: string; label: string; rows: CapacityRow[] }> {
  const label = 'Interface utilisation (busiest direction)';
  type ZIf = { itemid: string; key_: string; name: string; lastvalue: string; units?: string; hosts?: { hostid: string; name: string }[] };
  const read = (prefix: string) =>
    zbx<ZIf[]>('item.get', {
      output: ['itemid', 'key_', 'name', 'lastvalue', 'units'],
      search: { key_: prefix },
      startSearch: true,
      monitored: true,
      selectHosts: ['hostid', 'name'],
    });
  // A port's speed changes only when the port does, and its 3,048 values cost minutes a run on HCML's Zabbix.
  const speedsHeld = cached('capacity:speeds', SPEEDS_TTL_MS, () => read('net.if.speed['), { staleMs: SPEEDS_TTL_MS, staleIfError: true, pin: true });
  const [ins, outs, speeds] = await Promise.all([read('net.if.in['), read('net.if.out['), speedsHeld]);

  const index = (k: string) => /\.(\d+)\]$/.exec(k)?.[1];
  const hostOf = (i: ZIf) => i.hosts?.[0]?.hostid ?? '';
  const speedOf = new Map(speeds.map((s) => [`${hostOf(s)}:${index(s.key_)}`, Number(s.lastvalue)]));
  const outOf = new Map(outs.map((o) => [`${hostOf(o)}:${index(o.key_)}`, o]));

  // Errors and discards share the prefix; only octet counters are traffic.
  const traffic = ins.filter((i) => /octets/i.test(i.key_) && index(i.key_));
  const candidates = traffic
    .map((i) => {
      const id = `${hostOf(i)}:${index(i.key_)}`;
      const speed = speedOf.get(id) ?? 0;
      const out = outOf.get(id);
      const latest = Math.max(Number(i.lastvalue) || 0, Number(out?.lastvalue) || 0);
      return { in: i, out, speed, latest: speed > 0 ? latest / speed : 0 };
    })
    .filter((c) => c.speed > 0 && c.latest > 0)
    .sort((a, b) => b.latest - a.latest)
    .slice(0, Math.max(top * 4, 40));
  if (!candidates.length) return { key: 'ifutil', label, rows: [] };

  const itemids = candidates.flatMap((c) => [c.in.itemid, ...(c.out ? [c.out.itemid] : [])]);
  // Up to 400 items: sliced, and folded as the rows arrive.
  const agg: Aggregates = new Map();
  let trendRows = 0;
  await fetchTrendsSliced<{ itemid: string; value_avg: string; value_max: string }>(
    itemids,
    from,
    to,
    ['itemid', 'value_avg', 'value_max'],
    {
      parallel: config.sla.maxParallel,
      onRows: (rows) => {
        trendRows += rows.length;
        for (const r of rows) {
          const a = agg.get(r.itemid) ?? { sum: 0, n: 0, max: 0 };
          a.sum += Number(r.value_avg);
          a.n++;
          a.max = Math.max(a.max, Number(r.value_max));
          agg.set(r.itemid, a);
        }
      },
    },
  );
  const pct = (itemid: string | undefined, speed: number, pick: 'avg' | 'max') => {
    const a = itemid ? agg.get(itemid) : undefined;
    if (!a || !a.n) return 0;
    return ((pick === 'avg' ? a.sum / a.n : a.max) / speed) * 100;
  };

  const rows: CapacityRow[] = candidates
    .map((c) => {
      const host = c.in.hosts?.[0];
      const port = /^Interface\s+([^(:]+)/.exec(c.in.name)?.[1]?.trim() ?? c.in.name;
      return {
        metric: 'ifutil',
        label,
        itemid: c.in.itemid,
        hostid: host?.hostid ?? '',
        host: host?.name ?? '',
        name: port,
        units: '%',
        avg: Math.max(pct(c.in.itemid, c.speed, 'avg'), pct(c.out?.itemid, c.speed, 'avg')),
        max: Math.min(100, Math.max(pct(c.in.itemid, c.speed, 'max'), pct(c.out?.itemid, c.speed, 'max'))),
        source: trendRows ? ('trend' as const) : ('none' as const),
      };
    })
    .filter((r) => r.source === 'trend')
    .sort((a, b) => b.avg - a.avg)
    .slice(0, top);
  return { key: 'ifutil', label, rows };
}

/** What the report covers when the page does not say: the days, and the hosts listed for each metric. */
export const CAPACITY_DAYS = 7;
export const CAPACITY_TOP = 10;

/** The busiest hosts by CPU, memory and so on over `days`. */
export function getCapacityReport(days: number, top: number) {
  return cached(`capacity:${days}:${top}`, CAPACITY_TTL, () => heavy.run(() => getCapacity(days, top)), {
    ...staleReport(CAPACITY_TTL),
    staleMs: CAPACITY_STALE_MS,
    pin: true,
  });
}
