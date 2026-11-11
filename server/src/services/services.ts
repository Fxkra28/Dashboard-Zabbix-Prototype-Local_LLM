import { zbx } from '../clients/zabbix.js';
import { cached, SLOW_VIEW } from '../core/cache.js';

/**
 * Services tree (HCML Goal 2). This is the portal's answer to HCML's stated core problem:
 * *"monitoring is still device-centric and reactive; the target is service-centric and proactive."*
 *
 * Zabbix already computes service status and attributes the problems that caused it. What it
 * doesn't do is present that as a hierarchy a non-engineer can read, with the SLA the service is
 * measured against sitting next to it. That's what this assembles.
 *
 * Read-only, as always.
 */

interface ZService {
  serviceid: string;
  name: string;
  status: string; // '-1' OK, else '0'..'5' severity
  algorithm: string;
  sortorder: string;
  description?: string;
  parents?: { serviceid: string; name: string }[];
  children?: { serviceid: string; name: string }[];
  tags?: { tag: string; value: string }[];
  /** Zabbix returns this key snake_case. The problems that put the service in its state. */
  problem_events?: { eventid: string; name: string; severity: string }[];
}

export interface ServiceSla {
  slaid: string;
  name: string;
  slo: number;
  sli: number;
  /** Seconds of downtime the period can still absorb; negative = SLO already missed. */
  errorBudget: number;
  meeting: boolean;
}

export interface ServiceNode {
  serviceid: string;
  name: string;
  /** -1 = OK, otherwise the Zabbix severity that propagated up. */
  status: number;
  algorithm: string;
  description?: string;
  tags: { tag: string; value: string }[];
  problems: { eventid: string; name: string; severity: string }[];
  sla?: ServiceSla;
  children: ServiceNode[];
  /** Worst status anywhere in this subtree, including itself. */
  worst: number;
  /** How many services sit below this one. */
  descendants: number;
}

export interface ServicesResponse {
  tree: ServiceNode[];
  total: number;
  /** Services currently carrying a problem (status >= 0). */
  degraded: number;
  /** Worst status across the whole tree; -1 when everything is fine. */
  worst: number;
}

/** A service can have several parents, so guard against runaway recursion. */
const MAX_DEPTH = 12;

/** serviceid → the SLA it's measured against (first wins if several apply). */
async function slaByService(): Promise<Record<string, ServiceSla>> {
  const slas = await zbx<{ slaid: string; name: string; slo: string }[]>('sla.get', {
    output: ['slaid', 'name', 'slo'],
  });

  // One sla.getsli per SLA, fetched together instead of one after another (awaiting
  // each in turn would cost N round-trips in series for N SLAs).
  // Results are still walked in sla.get order, so "first SLA wins" holds.
  const slis = await Promise.all(
    slas.map((sla) =>
      zbx<{
        serviceids: (string | number)[];
        sli: { sli: number; error_budget: number }[][];
      }>('sla.getsli', { slaid: sla.slaid, periods: 1 }),
    ),
  );

  const out: Record<string, ServiceSla> = {};
  for (const [idx, sla] of slas.entries()) {
    const sli = slis[idx];
    const row = sli?.sli?.[0] ?? [];
    (sli?.serviceids ?? []).forEach((rawId, i) => {
      const serviceid = String(rawId);
      if (out[serviceid]) return; // first SLA wins
      const slo = Number(sla.slo);
      const achieved = row[i]?.sli ?? 0;
      out[serviceid] = {
        slaid: sla.slaid,
        name: sla.name,
        slo,
        sli: achieved,
        errorBudget: row[i]?.error_budget ?? 0,
        meeting: achieved >= slo,
      };
    });
  }
  return out;
}

export async function getServiceTree(): Promise<ServicesResponse> {
  const [services, slas] = await Promise.all([
    zbx<ZService[]>('service.get', {
      output: ['serviceid', 'name', 'status', 'algorithm', 'sortorder', 'description'],
      selectParents: ['serviceid', 'name'],
      selectChildren: ['serviceid', 'name'],
      selectProblemEvents: ['eventid', 'name', 'severity'],
      selectTags: 'extend',
      sortfield: 'sortorder',
    }),
    slaByService(),
  ]);

  const byId = new Map(services.map((s) => [s.serviceid, s]));

  /**
   * Returns the node plus the set of distinct service ids beneath it. Services
   * form a DAG (a shared dependency legitimately appears under two parents)
   * so counting tree positions would report it twice.
   */
  const build = (
    svc: ZService,
    path: Set<string>,
    depth: number,
  ): { node: ServiceNode; ids: Set<string> } => {
    const node: ServiceNode = {
      serviceid: svc.serviceid,
      name: svc.name,
      status: Number(svc.status),
      algorithm: svc.algorithm,
      description: svc.description || undefined,
      tags: svc.tags ?? [],
      problems: svc.problem_events ?? [],
      sla: slas[svc.serviceid],
      children: [],
      worst: Number(svc.status),
      descendants: 0,
    };

    // A service may legitimately sit under two parents; a cycle may not exist,
    // but don't let a malformed tree hang the request.
    if (depth >= MAX_DEPTH) return { node, ids: new Set() };

    const nextPath = new Set(path).add(svc.serviceid);
    const kids = (svc.children ?? [])
      .map((c) => byId.get(c.serviceid))
      .filter((c): c is ZService => Boolean(c) && !nextPath.has(c!.serviceid))
      .sort((a, b) => Number(a.sortorder) - Number(b.sortorder) || a.name.localeCompare(b.name));

    const below = new Set<string>();
    for (const kid of kids) {
      const { node: child, ids } = build(kid, nextPath, depth + 1);
      node.children.push(child);
      node.worst = Math.max(node.worst, child.worst);
      below.add(child.serviceid);
      for (const id of ids) below.add(id);
    }
    node.descendants = below.size;

    return { node, ids: below };
  };

  // Roots are the services nothing else contains: the top-level business view.
  const roots = services
    .filter((s) => !(s.parents ?? []).length)
    .sort((a, b) => Number(a.sortorder) - Number(b.sortorder) || a.name.localeCompare(b.name));

  const tree = roots.map((r) => build(r, new Set(), 0).node);

  return {
    tree,
    total: services.length,
    degraded: services.filter((s) => Number(s.status) >= 0).length,
    worst: services.reduce((w, s) => Math.max(w, Number(s.status)), -1),
  };
}

/** The service tree as its route, the Assistant and the warm-up read it. */
export const serviceTreeView = () => cached('services:tree', 30_000, getServiceTree, SLOW_VIEW);
