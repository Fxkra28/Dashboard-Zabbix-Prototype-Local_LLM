import { cached, SLOW_VIEW } from '../core/cache.js';
import type { SliProfile } from '../core/config.js';
import { DEVICE_CLASS_LABELS, naturalCompare, type DeviceClass } from '../domain/naming.js';
import { cachedProblems, openProblems, type ZbxProblem } from '../domain/queries.js';
import type { ServiceNode, ServiceSla, ServicesResponse } from '../services/services.js';
import { getMonthlySli } from '../services/sli.js';
import { aggregate, type DataStatus, type SliGroup, type SliHost, type SliReport } from './engine.js';

/**
 * A service tree built from the estate itself, for a Zabbix that has no
 * services configured (HCML's has none):
 *
 *   HCML estate
 *   ├─ Business services   web checks, WEB : and SERVER : hosts
 *   ├─ 1 · Jakarta … 14 · TWSB
 *   │    ├─ WAN links       INET : legs paired into redundant paths
 *   │    ├─ Firewalls / Switches / Access points / Radio repeaters / Other
 *   │    │    └─ hosts
 *   └─ Unassigned
 *
 * Each node carries the derived monthly SLA for its subtree and its live
 * status from the problems open right now. Same shape as `/api/services`, so
 * the Services page renders either with one component.
 */

export type DerivedKind = 'root' | 'business' | 'site' | 'class' | 'wan-path' | 'host' | 'web';

export interface DerivedServiceNode extends ServiceNode {
  kind: DerivedKind;
  hostid?: string;
  dataStatus: DataStatus;
  coverage: number | null;
  children: DerivedServiceNode[];
}

export interface DerivedServicesResponse extends ServicesResponse {
  tree: DerivedServiceNode[];
  source: 'derived';
  label: string;
  month: string;
  profile: SliProfile;
  target: number;
  closed: boolean;
  gaps: SliReport['gaps'];
  noDataWindows: SliReport['noDataWindows'];
}

const SEVERITY_ORDER = (p: ZbxProblem) => Number(p.severity);

function slaFor(sli: number | null, errorBudget: number | null, target: number): ServiceSla | undefined {
  if (sli === null) return undefined;
  return {
    slaid: 'derived',
    name: `Monthly ${target}%`,
    slo: target,
    sli,
    errorBudget: errorBudget ?? 0,
    meeting: sli >= target,
  };
}

function groupStatus(hosts: SliHost[]): DataStatus {
  if (!hosts.length || hosts.every((h) => h.dataStatus === 'nodata')) return 'nodata';
  return hosts.some((h) => h.dataStatus !== 'ok') ? 'partial' : 'ok';
}

const budget = (hosts: SliHost[]) =>
  hosts.some((h) => h.errorBudget !== null)
    ? hosts.reduce((n, h) => n + (h.errorBudget ?? 0), 0)
    : null;

export function buildDerivedTree(
  report: SliReport,
  problems: ZbxProblem[],
  month: string,
): DerivedServicesResponse {
  const target = report.target;
  const problemsByHost = new Map<string, ZbxProblem[]>();
  for (const p of problems) {
    if (!p.hostid) continue;
    const list = problemsByHost.get(p.hostid) ?? [];
    list.push(p);
    problemsByHost.set(p.hostid, list);
  }

  const finish = (node: DerivedServiceNode): DerivedServiceNode => {
    node.worst = Math.max(node.status, ...node.children.map((c) => c.worst));
    const ids = new Set<string>();
    const walk = (n: DerivedServiceNode) => n.children.forEach((c) => (ids.add(c.serviceid), walk(c)));
    walk(node);
    node.descendants = ids.size;
    if (!node.problems.length) {
      node.problems = node.children
        .flatMap((c) => c.problems)
        .sort((a, b) => Number(b.severity) - Number(a.severity))
        .slice(0, 5);
    }
    return node;
  };

  const hostNode = (h: SliHost): DerivedServiceNode => {
    const open = (problemsByHost.get(h.hostid) ?? []).sort((a, b) => SEVERITY_ORDER(b) - SEVERITY_ORDER(a));
    return finish({
      serviceid: `derived:host:${h.hostid}`,
      name: h.name,
      kind: 'host',
      hostid: h.hostid,
      status: open.length ? Number(open[0].severity) : -1,
      algorithm: 'derived',
      tags: [],
      problems: open.slice(0, 5).map((p) => ({ eventid: p.eventid, name: p.name, severity: p.severity })),
      sla: slaFor(h.sli, h.errorBudget, target),
      children: [],
      worst: -1,
      descendants: 0,
      dataStatus: h.dataStatus,
      coverage: h.coverage,
    });
  };

  const groupNode = (
    id: string,
    name: string,
    kind: DerivedKind,
    hosts: SliHost[],
    children: DerivedServiceNode[],
    group?: SliGroup,
  ): DerivedServiceNode => {
    const g = group ?? aggregate(id, name, hosts, target);
    const measured = hosts.filter((h) => h.sli !== null);
    return finish({
      serviceid: id,
      name,
      kind,
      status: -1,
      algorithm: 'derived',
      tags: [],
      problems: [],
      sla: slaFor(g.sli, budget(measured), target),
      children,
      worst: -1,
      descendants: 0,
      dataStatus: groupStatus(hosts),
      coverage: measured.length ? measured.reduce((n, h) => n + h.coverage, 0) / measured.length : null,
    });
  };

  const isBusiness = (h: SliHost) => h.deviceClass === 'web' || h.deviceClass === 'server';
  const byName = (a: SliHost, b: SliHost) => naturalCompare(a.name, b.name);

  // Business services: web checks first, then WEB : / SERVER : hosts.
  const webNodes: DerivedServiceNode[] = report.web.map((w) =>
    finish({
      serviceid: `derived:web:${w.itemid}`,
      name: `Web check: ${w.name}`,
      kind: 'web',
      status: -1,
      algorithm: 'derived',
      tags: [],
      problems: [],
      sla: slaFor(w.sli, null, target),
      children: [],
      worst: -1,
      descendants: 0,
      dataStatus: w.dataStatus,
      coverage: w.coverage,
    }),
  );
  const businessHosts = report.hosts.filter(isBusiness).sort(byName);
  const business = groupNode(
    'derived:business',
    'Business services',
    'business',
    businessHosts,
    [...webNodes, ...businessHosts.map(hostNode)],
  );
  // Web checks are measured too, not just the hosts. Include them in the mean.
  const businessFigures = [...report.web.map((w) => w.sli), ...businessHosts.map((h) => h.sli)].filter(
    (v): v is number => v !== null,
  );
  if (businessFigures.length) {
    const sli = businessFigures.reduce((a, b) => a + b, 0) / businessFigures.length;
    business.sla = slaFor(sli, null, target);
    business.dataStatus = report.web.some((w) => w.dataStatus === 'ok') ? 'ok' : 'partial';
  }

  // Sites, each split by device class; WAN legs grouped into their paths.
  const siteNodes: DerivedServiceNode[] = [];
  const unassigned: SliHost[] = [];
  const bySite = new Map<number, SliHost[]>();
  for (const h of report.hosts) {
    if (isBusiness(h)) continue;
    if (!h.site) unassigned.push(h);
    else {
      const inSite = bySite.get(h.site.code);
      if (inSite) inSite.push(h);
      else bySite.set(h.site.code, [h]);
    }
  }
  for (const [code, hosts] of [...bySite.entries()].sort((a, b) => a[0] - b[0])) {
    const site = hosts[0].site!;
    const classes = new Map<DeviceClass, SliHost[]>();
    for (const h of hosts) {
      const cls = h.deviceClass as DeviceClass;
      const inClass = classes.get(cls);
      if (inClass) inClass.push(h);
      else classes.set(cls, [h]);
    }
    const classNodes = [...classes.entries()]
      .sort((a, b) => (a[0] === 'wan-link' ? -1 : b[0] === 'wan-link' ? 1 : naturalCompare(a[0], b[0])))
      .map(([cls, members]) => {
        const id = `derived:site:${code}:${cls}`;
        const label = DEVICE_CLASS_LABELS[cls] ?? cls;
        if (cls !== 'wan-link') {
          return groupNode(id, label, 'class', members, [...members].sort(byName).map(hostNode));
        }
        const pathNodes = report.wanPaths
          .filter((p) => p.site?.code === code)
          .map((p) => {
            const legs = members.filter((m) => p.legs.some((l) => l.hostid === m.hostid)).sort(byName);
            const node = groupNode(`derived:wan:${p.name}`, `WAN path: ${p.name}`, 'wan-path', legs, legs.map(hostNode));
            node.sla = slaFor(p.sli, null, target);
            node.dataStatus = p.dataStatus;
            node.coverage = p.coverage;
            return node;
          });
        const inPath = new Set(report.wanPaths.flatMap((p) => p.legs.map((l) => l.hostid)));
        const loose = members.filter((m) => !inPath.has(m.hostid)).sort(byName).map(hostNode);
        return groupNode(id, label, 'class', members, [...pathNodes, ...loose]);
      });
    const group = report.sites.find((s) => s.key === `site:${code}`);
    siteNodes.push(groupNode(`derived:site:${code}`, `${code} · ${site.name}`, 'site', hosts, classNodes, group));
  }
  if (unassigned.length) {
    siteNodes.push(
      groupNode('derived:unassigned', 'Unassigned', 'site', unassigned, [...unassigned].sort(byName).map(hostNode)),
    );
  }

  const children = businessHosts.length || webNodes.length ? [business, ...siteNodes] : siteNodes;
  const root = groupNode('derived:estate', 'HCML estate', 'root', report.hosts, children, report.overall);

  let total = 0;
  let degraded = 0;
  const count = (n: DerivedServiceNode) => {
    total++;
    if (n.status >= 0) degraded++;
    n.children.forEach(count);
  };
  count(root);

  return {
    tree: [root],
    total,
    degraded,
    worst: root.worst,
    source: 'derived',
    label: report.label,
    month,
    profile: report.profile,
    target,
    closed: report.closed,
    gaps: report.gaps,
    noDataWindows: report.noDataWindows,
  };
}

export async function getDerivedServices(month: string, profile: SliProfile): Promise<DerivedServicesResponse> {
  return cached(`services:derived:${profile}:${month}`, 30_000, async () => {
    const [report, problems] = await Promise.all([
      getMonthlySli(month, profile),
      cachedProblems().then(openProblems),
    ]);
    return buildDerivedTree(report, problems, month);
  }, SLOW_VIEW);
}

