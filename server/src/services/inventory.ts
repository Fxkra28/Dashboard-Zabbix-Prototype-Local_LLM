import { cached } from '../core/cache.js';
import { config } from '../core/config.js';
import { getHostsWithMeta, type ZHostMeta } from '../domain/queries.js';
import { resolveSite } from './sites.js';

/**
 * Inventory & ownership scorecard (HCML Goal 1).
 *
 * HCML's gap: *"host naming, site mapping, owner, criticality and dependency are not standardised →
 * alarms are hard to route to the right PIC."*
 *
 * The portal is read-only, so it cannot enforce a standard. What it can do is measure one, turning
 * an invisible governance problem into a number that goes up as hosts get tagged. That measurement
 * is this file.
 *
 * Four dimensions are scored here. The fifth HCML names, *dependency*, is answered by the Services
 * tree (§15) rather than a per-host field: a host is in a dependency map when the service hierarchy
 * covers it.
 */

export type DimensionKey = 'naming' | 'site' | 'owner' | 'criticality';

export interface Dimension {
  key: DimensionKey;
  label: string;
  /** Where a compliant host carries this, so the gap list is actionable. */
  hint: string;
  present: number;
  total: number;
  pct: number;
  /** False when the deployment hasn't configured this check (naming only). */
  scored: boolean;
}

export interface HostGap {
  hostid: string;
  name: string;
  site: string;
  groups: string[];
  missing: DimensionKey[];
}

export interface GroupScore {
  name: string;
  hosts: number;
  complete: number;
  pct: number;
}

export interface ScorecardResponse {
  dimensions: Dimension[];
  overall: { hosts: number; complete: number; pct: number };
  groups: GroupScore[];
  gaps: HostGap[];
}

const inv = (h: ZHostMeta) => (Array.isArray(h.inventory) ? undefined : h.inventory);
const tagValue = (h: ZHostMeta, tag: string) =>
  h.tags?.find((t) => t.tag === tag)?.value?.trim() ?? '';

/** Does this host carry a deliberate owner? Inventory PoC, or an `owner` tag. */
function hasOwner(h: ZHostMeta): boolean {
  const i = inv(h);
  return Boolean(i?.poc_1_name?.trim() || i?.poc_1_email?.trim() || tagValue(h, config.inventory.ownerTag));
}

/**
 * A site only counts when it was stated deliberately. Falling back to a host
 * group is the very ambiguity Goal 1 is about, so it scores as a gap.
 */
function hasExplicitSite(h: ZHostMeta): boolean {
  return resolveSite(h).source !== 'group';
}

export async function getScorecard(): Promise<ScorecardResponse> {
  const hosts = await cached('hosts:meta', 30_000, getHostsWithMeta);

  // An invalid HOST_NAME_PATTERN shouldn't take the endpoint down. Treat a
  // broken regex as "naming not scored" and carry on.
  let namingRe: RegExp | null = null;
  if (config.inventory.namePattern) {
    try {
      namingRe = new RegExp(config.inventory.namePattern);
    } catch {
      namingRe = null;
    }
  }

  const checks: { key: DimensionKey; label: string; hint: string; scored: boolean; ok: (h: ZHostMeta) => boolean }[] =
    [
      {
        key: 'naming',
        label: 'Naming convention',
        hint: `host name matches ${config.inventory.namePattern || '(HOST_NAME_PATTERN not set)'}`,
        scored: Boolean(namingRe),
        ok: (h) => (namingRe ? namingRe.test(h.name) : true),
      },
      {
        key: 'site',
        label: 'Site mapping',
        hint: `tag "${config.site.tag}", the site code in the host name, or inventory site_city / location`,
        scored: true,
        ok: hasExplicitSite,
      },
      {
        key: 'owner',
        label: 'Owner / PIC',
        hint: `inventory poc_1_name / poc_1_email, or tag "${config.inventory.ownerTag}"`,
        scored: true,
        ok: hasOwner,
      },
      {
        key: 'criticality',
        label: 'Criticality',
        hint: `tag "${config.inventory.criticalityTag}"`,
        scored: true,
        ok: (h) => Boolean(tagValue(h, config.inventory.criticalityTag)),
      },
    ];

  const scored = checks.filter((c) => c.scored);

  const dimensions: Dimension[] = checks.map((c) => {
    const present = c.scored ? hosts.filter(c.ok).length : 0;
    return {
      key: c.key,
      label: c.label,
      hint: c.hint,
      present,
      total: hosts.length,
      pct: c.scored && hosts.length ? Math.round((present / hosts.length) * 100) : 0,
      scored: c.scored,
    };
  });

  const gaps: HostGap[] = [];
  const groups = new Map<string, { hosts: number; complete: number }>();

  for (const h of hosts) {
    const missing = scored.filter((c) => !c.ok(h)).map((c) => c.key);
    const complete = missing.length === 0;

    if (!complete) {
      gaps.push({
        hostid: h.hostid,
        name: h.name,
        site: resolveSite(h).site,
        groups: (h.hostgroups ?? []).map((g) => g.name),
        missing,
      });
    }

    for (const g of h.hostgroups ?? []) {
      const row = groups.get(g.name) ?? { hosts: 0, complete: 0 };
      row.hosts++;
      if (complete) row.complete++;
      groups.set(g.name, row);
    }
  }

  const completeHosts = hosts.length - gaps.length;

  return {
    dimensions,
    overall: {
      hosts: hosts.length,
      complete: completeHosts,
      pct: hosts.length ? Math.round((completeHosts / hosts.length) * 100) : 0,
    },
    // Worst-scoring group first: that's where the standardisation work is.
    groups: [...groups.entries()]
      .map(([name, r]) => ({
        name,
        hosts: r.hosts,
        complete: r.complete,
        pct: r.hosts ? Math.round((r.complete / r.hosts) * 100) : 0,
      }))
      .sort((a, b) => a.pct - b.pct || b.hosts - a.hosts || a.name.localeCompare(b.name)),
    // Most-incomplete hosts first.
    gaps: gaps.sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name)),
  };
}
