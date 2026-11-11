import { describe, expect, it } from 'vitest';
import * as g from '../guards';

/**
 * The guards for every data answer the pages read, each against a made-up answer that holds every
 * field its type names. Three things are proved for each. A complete answer passes. Every field is
 * checked at all, which a guard that left a field to `any` would not be. And what the type makes
 * required is required while what it makes optional is optional, which the compiler cannot say
 * (both are just a Check). guards.test.ts holds the first guards and the stream; this holds the
 * rest. The guards also fitted every real answer of both portals when run over them once; that run
 * is not repeatable here, since its input is HCML's estate.
 */
/** Every file of api/ as text: the calls are in one file for each part of the portal. */
const callFiles = import.meta.glob('../api/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

type AnyGuard = g.Guard<unknown>;
interface Case {
  name: string;
  guard: AnyGuard;
  sample: unknown;
  /** Paths the type makes optional. An absent one is fine; an absent anything else is not. */
  optional?: string[];
  /** Paths under a record (severity counts, item ids), whose keys are the data's own and may be any. */
  free?: string[];
}

const tag = { tag: 'class', value: 'network' };
const hostIf = { ip: '192.0.2.1', type: '2', available: '1' };
const siteRef = { code: 1, name: 'Jakarta' };
const hostBase = { hostid: '1', name: '1.1 SAMPLE SWITCH', status: '0', maintenance_status: '0', interfaces: [hostIf], site: siteRef };
const HOST_OPT = ['maintenance_status', 'interfaces', 'site', 'interfaces[0].type', 'interfaces[0].available'];
const item = { itemid: '10', name: 'CPU', key_: 'system.cpu.util', value_type: '0', units: '%', state: '0', status: '0', delay: '1m', flags: '0', tags: [tag], hosts: [{ hostid: '1', name: 'x' }] };
const ITEM_OPT = ['units', 'state', 'status', 'delay', 'flags', 'tags', 'hosts'];
const sev = { '3': 1 };
const sliGroup = { key: 'k', name: 'Group', hosts: 3, withData: 2, sli: 99.5, downtime: 60, meeting: true, belowTarget: 0 };
const gap = { from: 1, to: 2 };
const link = { id: '1', hostid: '1', host: 'h', target: '192.0.2.8', label: 'l', up: true, loss: 0, latency: 1, jitter: 0, state: 'up', group: 'g', role: 'primary', lastclock: '1' };
const LINK_OPT = ['up', 'loss', 'latency', 'jitter', 'group', 'role', 'lastclock'];
const leaf = { serviceid: '2', name: 'leaf', status: -1, algorithm: '1', description: 'd', tags: [tag], problems: [{ eventid: '1', name: 'n', severity: '3' }], sla: { slaid: '1', name: 's', slo: 99, sli: 99.5, errorBudget: 10, meeting: true }, children: [], worst: -1, descendants: 0 };
const dLeaf = { ...leaf, kind: 'host', hostid: '1', dataStatus: 'ok', coverage: 1, children: [] };

const cases: Case[] = [
  { name: 'host list', guard: g.hostListGuard, sample: [hostBase], optional: HOST_OPT.map((p) => `[0].${p}`) },
  { name: 'host group list', guard: g.hostGroupListGuard, sample: [{ groupid: '5', name: 'Switches' }] },
  {
    name: 'internet traffic meters',
    guard: g.metersGuard,
    sample: {
      dashboard: 'Global view',
      found: true,
      generatedAt: 1_800_000_000,
      meters: [
        {
          id: 'item-1', title: 'SITE ONE INTERNET', page: 'Page 1', host: '1.1 FW', hostid: '10', item: 'Interface wan1(): Bits received', itemid: '1',
          direction: 'in', link: 'up', other: { direction: 'out', itemid: '2', value: 40_000_000, clock: 1_800_000_000, fraction: 0.08, zone: 'low' },
          units: 'bps', value: 212_000_000, clock: 1_800_000_000, min: 0, max: 500_000_000,
          zones: [{ from: 0, level: 'low' }], fraction: 0.42, zone: 'ok', state: 'ok',
        },
      ],
      summary: { total: 1, current: 1, critical: 0, warn: 0, stale: 0, unavailable: 0, down: 0, otherHigh: 0 },
    },
  },
  {
    name: 'busiest hosts',
    guard: g.topHostsGuard,
    sample: {
      generatedAt: 1_800_000_000,
      metrics: [{ key: 'cpu', label: 'CPU utilisation', considered: 8, current: 1, rows: [{ hostid: '3', host: '3.1 FW', itemid: '301', value: 93.4, clock: 1_800_000_000 }] }],
    },
  },
  {
    name: 'web monitoring',
    guard: g.webMonitoringGuard,
    sample: {
      generatedAt: 1_800_000_000,
      total: 2,
      ok: 1,
      failed: 1,
      unknown: 0,
      failures: [{ hostid: '4', host: 'SITE-WEB', name: 'Checkout', itemid: '401', step: 2, clock: 1_800_000_000 }],
    },
  },
  { name: 'item list', guard: g.itemListGuard, sample: [item], optional: ITEM_OPT.map((p) => `[0].${p}`) },
  {
    name: 'latest data',
    guard: g.latestGuard,
    sample: { items: [{ ...item, lastvalue: '1', lastclock: '1', prevvalue: '0' }], truncated: false, total: 1, page: 1, pageSize: 100 },
    optional: ['total', 'page', 'pageSize', 'items[0].lastvalue', 'items[0].lastclock', 'items[0].prevvalue', ...ITEM_OPT.map((p) => `items[0].${p}`)],
  },
  {
    name: 'graph',
    guard: g.graphGuard,
    sample: {
      from: 1, to: 2, source: 'trend', latestClock: 2, downsampled: false,
      series: [{ itemid: '10', name: 'CPU', host: '1.1 SAMPLE', units: '%', value_type: '0', delaySeconds: 60, step: false, points: [[1000, 1, 0, 2], [2000, null, null, null]], stats: { min: 0, avg: 1, max: 2, last: 1, lastClock: 2 }, coverage: { coveredSeconds: 60, firstClock: 1, lastClock: 2 } }],
    },
  },
  {
    name: 'network devices',
    guard: g.netDevicesGuard,
    sample: [{ ...hostBase, icmp: { up: true, loss: 0, latency: 1.2, state: 'up' } }],
    optional: [...HOST_OPT, 'icmp.up', 'icmp.loss', 'icmp.latency', 'icmp.state'].map((p) => `[0].${p}`),
  },
  {
    name: 'interface list',
    guard: g.netInterfacesGuard,
    sample: {
      rows: [{ index: 1, name: 'Gi1/0/1', alias: 'uplink', operStatus: 'up', speed: 1e9, inBps: 1, outBps: 2, utilisation: 0.1, inErrors: 0, outErrors: 0, inDiscards: 0, outDiscards: 0, lastclock: 1, itemids: { in: '1', out: '2' } }],
      total: 1, summary: { up: 1, down: 0, other: 0 }, page: 1, pageSize: 200,
    },
    free: ['rows[0].itemids.in', 'rows[0].itemids.out'],
  },
  { name: 'top triggers', guard: g.topTriggersGuard, sample: { triggers: [{ objectid: '1', name: 't', severity: '3', host: 'h', count: 5 }], truncated: false, days: 7 } },
  { name: 'map list', guard: g.mapListGuard, sample: [{ sysmapid: '1', name: 'Local network', width: '800', height: '600' }] },
  {
    name: 'map',
    guard: g.mapDetailGuard,
    sample: [{ sysmapid: '1', name: 'Local network', width: '800', height: '600', selements: [{ selementid: '1', label: 'x', x: '1', y: '2', elementtype: '0', labelText: 'x', hostid: '1', hostName: 'h', problems: 1, maxSeverity: 3 }], links: [{ linkid: '1', selementid1: '1', selementid2: '2', color: '00FF00' }] }],
    optional: ['labelText', 'hostid', 'hostName', 'problems', 'maxSeverity'].map((p) => `[0].selements[0].${p}`).concat('[0].links[0].color'),
  },
  {
    name: 'site list',
    guard: g.sitesGuard,
    sample: {
      sites: [{ name: 'Jakarta', total: 1, available: 1, unavailable: 0, unknown: 0, up: 1, down: 0, degraded: 0, nodata: 0, maintenance: 0, disabled: 0, problems: 1, unacknowledged: 1, bySeverity: sev, worst: 3,
        hosts: [{ hostid: '1', name: 'x', status: '0', maintenance_status: '0', interfaces: [hostIf], availability: 'available', state: 'up', reason: 'ping', siteSource: 'name', problems: { total: 1, bySeverity: sev } }] }],
      coverage: { hosts: 1, tag: 0, name: 1, inventory: 0, group: 0 },
    },
    optional: ['coverage.name', 'sites[0].up', 'sites[0].down', 'sites[0].degraded', 'sites[0].nodata', ...['maintenance_status', 'interfaces', 'state', 'reason', 'interfaces[0].type', 'interfaces[0].available'].map((p) => `sites[0].hosts[0].${p}`)],
    free: ['sites[0].bySeverity.3', 'sites[0].hosts[0].problems.bySeverity.3'],
  },
  {
    name: 'inventory scorecard',
    guard: g.scorecardGuard,
    sample: {
      dimensions: [{ key: 'naming', label: 'Naming', hint: 'h', present: 1, total: 2, pct: 50, scored: true }],
      overall: { hosts: 2, complete: 1, pct: 50 }, groups: [{ name: 'g', hosts: 2, complete: 1, pct: 50 }],
      gaps: [{ hostid: '1', name: 'x', site: 'Jakarta', groups: ['g'], missing: ['owner'] }],
    },
  },
  {
    name: 'link health',
    guard: g.linksGuard,
    sample: { links: [link], paths: [{ name: 'FPSO', links: [link], state: 'up' }], summary: { total: 1, up: 1, degraded: 0, down: 0, unknown: 0 }, thresholds: { lossWarn: 2, lossCrit: 10 } },
    optional: [...LINK_OPT.map((p) => `links[0].${p}`), ...LINK_OPT.map((p) => `paths[0].links[0].${p}`)],
  },
  {
    name: 'availability report',
    guard: g.availabilityGuard,
    sample: {
      from: 1, to: 2, windowSeconds: 1, minSeverity: 2, truncated: false, basis: 'availability', profile: 'availability', month: '2026-09', target: 99,
      hosts: [{ hostid: '1', host: 'h', availability: 99.9, downtime: 1, incidents: 1, longest: 1, coverage: 1, dataStatus: 'ok', category: 'c', site: siteRef }],
      overall: sliGroup, categories: [sliGroup], sites: [sliGroup], gaps: [gap], noDataWindows: [gap],
    },
    optional: ['basis', 'profile', 'month', 'target', 'overall', 'categories', 'sites', 'gaps', 'noDataWindows', 'hosts[0].coverage', 'hosts[0].dataStatus', 'hosts[0].category', 'hosts[0].site'],
  },
  {
    name: 'problem ageing',
    guard: g.agingGuard,
    sample: { buckets: [{ label: '<1h', count: 1 }], unacknowledged: 1, total: 1, oldest: [{ eventid: '1', name: 'n', host: 'h', severity: '3', clock: '1', ageSeconds: 5 }] },
  },
  {
    name: 'capacity report',
    guard: g.capacityGuard,
    sample: { days: 7, metrics: [{ key: 'cpu', label: 'CPU', rows: [{ metric: 'cpu', label: 'CPU', itemid: '1', hostid: '1', host: 'h', name: 'n', units: '%', avg: 1, max: 2, source: 'trend' }] }] },
  },
  {
    name: 'alert noise report',
    guard: g.noiseGuard,
    sample: {
      from: 1, to: 2, windowSeconds: 1, minSeverity: 0, truncated: false, totalEvents: 1, distinctTriggers: 1, total: 1,
      concentration: { topN: 1, percentOfEvents: 100 }, counts: { flapping: 0, unactioned: 1, chronic: 0 }, thresholds: { shortSeconds: 300, minCount: 5 },
      triggers: [{ objectid: '1', name: 'n', host: 'h', hostid: '1', severity: '3', count: 1, medianDuration: 1, shortLived: 0, ackRate: 0, totalDuration: 1, longest: 1, stillOpen: false, flags: ['chronic'] }],
    },
    optional: ['total'],
    free: ['counts.flapping', 'counts.unactioned', 'counts.chronic'],
  },
  {
    name: 'service tree',
    guard: g.servicesGuard,
    sample: { tree: [{ ...leaf, serviceid: '1', name: 'root', children: [leaf], descendants: 1 }], total: 2, degraded: 0, worst: -1 },
    optional: ['description', 'sla', 'children[0].description', 'children[0].sla'].map((p) => `tree[0].${p}`),
  },
  {
    name: 'derived service tree',
    guard: g.derivedServicesGuard,
    sample: {
      tree: [{ ...dLeaf, serviceid: '1', name: 'root', kind: 'root', children: [dLeaf], descendants: 1 }], total: 2, degraded: 0, worst: -1,
      source: 'derived', label: 'l', month: '2026-09', profile: 'availability', target: 99, closed: true, gaps: [gap], noDataWindows: [gap],
    },
    optional: ['description', 'sla', 'hostid', 'children[0].description', 'children[0].sla', 'children[0].hostid'].map((p) => `tree[0].${p}`),
  },
  {
    name: 'SLA report',
    guard: g.sliGuard,
    sample: {
      source: 'derived', label: 'l', profile: 'availability', month: '2026-09', from: 1, to: 2, end: 2, closed: true, timezone: 'Asia/Jakarta', target: 99, generatedAt: 3,
      basis: { triggers: ['High ICMP ping loss'], gapPolicy: 'excluded', noDataPolicy: 'excluded', maintenancePolicy: 'excluded' },
      overall: sliGroup, categories: [sliGroup], sites: [sliGroup], classes: [sliGroup], gaps: [gap], noDataWindows: [gap],
      hosts: [{ hostid: '1', name: 'x', hostStatus: '0', site: siteRef, category: 'c', deviceClass: 'switch', triggerids: ['1'], sli: 99, downtime: 1, window: 2, covered: 2, maintenance: 0, coverage: 1, incidents: 1, longest: 1, dataStatus: 'ok', measured: true, meeting: true, errorBudget: 5 }],
      wanPaths: [{ key: 'k', name: 'p', site: siteRef, legs: [{ hostid: '1', name: 'x', leg: 'WAN 1', sli: 99, dataStatus: 'ok' }], sli: 99, downtime: 1, coverage: 1, dataStatus: 'ok' }],
      web: [{ itemid: '1', name: 'w', sli: 99, downtime: 1, coverage: 1, dataStatus: 'ok' }],
      stats: { zabbixCalls: 1, triggers: 1, events: 1, trendRows: 1, ms: 1 },
    },
    optional: ['hosts[0].measured'],
  },
  { name: 'SLA source', guard: g.slaSourceGuard, sample: { real: false, slas: 0, services: 0 } },
  { name: 'SLA list', guard: g.slaListGuard, sample: [{ slaid: '1', name: 'n', slo: '99.9', period: '1', status: '1', timezone: 'UTC', description: 'd' }], optional: ['[0].timezone', '[0].description'] },
  {
    name: 'problem explanation',
    guard: g.problemExplanationGuard,
    sample: { summary: 's', tagsExplained: [{ tag: 'class', value: 'network', meaning: 'm' }], businessImpact: 'b', recommendation: 'r' },
  },
  {
    name: 'SLA explanation',
    guard: g.slaExplanationGuard,
    sample: { status: 's', plain: 'p', meetingTarget: true, recommendation: 'r', noData: true },
    optional: ['noData'],
  },
  { name: 'SLA figures', guard: g.slaSliGuard, sample: [{ serviceid: '1', name: 'n', sli: 99, uptime: 1, downtime: 1, error_budget: 1, period_from: 1, period_to: 2 }] },
];

/** Every key of every object in `value`, as a path: `rows[0].itemids.in`. Only the first item of a list is walked. */
function paths(value: unknown, at = ''): string[] {
  if (Array.isArray(value)) return value.length ? paths(value[0], `${at}[0]`) : [];
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => {
      const here = at ? `${at}.${key}` : key;
      return [here, ...paths(inner, here)];
    });
  }
  return [];
}
const steps = (path: string) => path.split(/\.|(?=\[)/).filter(Boolean).map((s) => (s.startsWith('[') ? Number(s.slice(1, -1)) : s));
/** A copy of `sample` with the value at `path` replaced, or removed when `to` is the REMOVE marker. */
const REMOVE = Symbol('remove');
function changed(sample: unknown, path: string, to: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(sample)) as Record<string | number, unknown>;
  const parts = steps(path);
  let at = copy;
  for (const part of parts.slice(0, -1)) at = at[part] as typeof copy;
  const last = parts[parts.length - 1];
  if (to === REMOVE) delete at[last];
  else at[last] = to;
  return copy;
}
/** Kinds of value that nothing in an answer is all of: at least one of them is refused wherever a check exists. */
const WRONG = [42, 'text', true, null, [], { not: 'right' }];

describe.each(cases)('the $name guard', ({ guard, sample, optional = [], free = [] }) => {
  it('takes a complete answer', () => {
    expect(guard.misfit(sample)).toBeNull();
  });

  it('checks every field: a value of the wrong kind is refused at each one', () => {
    for (const path of paths(sample)) {
      const refused = WRONG.some((wrong) => guard.misfit(changed(sample, path, wrong)) !== null);
      expect(refused, `${path} is not checked at all`).toBe(true);
    }
  });

  it('needs what the type requires and lets go of what it makes optional', () => {
    for (const path of paths(sample)) {
      const without = guard.misfit(changed(sample, path, REMOVE));
      if (optional.includes(path) || free.includes(path)) expect(without, `${path} is optional`).toBeNull();
      else expect(without, `${path} is required`).not.toBeNull();
    }
  });

  it('names the field and what is wrong with it, for the log', () => {
    const [first] = paths(sample);
    const message = guard.misfit(changed(sample, first, REMOVE));
    // The first key may be optional; the point is the wording, so take the first one that is refused.
    const refusedPath = paths(sample).find((p) => guard.misfit(changed(sample, p, REMOVE)) !== null)!;
    const said = guard.misfit(changed(sample, refusedPath, REMOVE));
    expect(said ?? message).toMatch(/is missing|is not/);
    expect(said).toContain(refusedPath.split('.').pop()!.replace(/\[\d+\]/g, ''));
  });
});

describe('answers that are not the kind at all', () => {
  it.each(cases)('$name: refuses nothing, a number, text and the wrong container', ({ guard, sample }) => {
    for (const wrong of [undefined, null, 7, 'text', Array.isArray(sample) ? {} : []]) {
      expect(guard.misfit(wrong), JSON.stringify(wrong)).not.toBeNull();
    }
  });
});

describe('every data answer the web app reads has a guard (FR-16)', () => {
  /** The members of each `export const xApi = { ... }` of api/: from a name at two spaces' indent to the next one. */
  const members = Object.values(callFiles).flatMap((source) => {
    const at = source.search(/export const \w+Api = \{/);
    return at < 0 ? [] : source.slice(at).split(/\n {2}(?=[a-zA-Z]\w*: )/).slice(1);
  });
  /** Answers that are not read as data: the public health probe. */
  const UNGUARDED = ['health'];

  it('finds the members it checks', () => {
    expect(members.length).toBeGreaterThan(25);
    expect(members.filter((m) => m.includes('request<')).length).toBeGreaterThan(25);
  });

  it('passes a guard on every request, except the ones listed', () => {
    const missing = members
      .filter((m) => m.includes('request<'))
      .map((m) => ({ name: /^(\w+):/.exec(m)![1], guarded: /guard:\s*\w+Guard/.test(m) }))
      .filter((m) => !m.guarded && !UNGUARDED.includes(m.name))
      .map((m) => m.name);
    expect(missing, 'read from the BFF with no check that it is what the page expects').toEqual([]);
  });

  it('lists only members that exist and are still unguarded, so the list cannot hide a guard that was added', () => {
    for (const name of UNGUARDED) {
      const member = members.find((m) => m.startsWith(`${name}:`));
      expect(member, name).toBeDefined();
      expect(/guard:\s*\w+Guard/.test(member!), `${name} has a guard now: take it off the list`).toBe(false);
    }
  });
});
