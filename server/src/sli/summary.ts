import { config } from '../core/config.js';
import { getMonthlySli } from '../services/sli.js';
import { currentMonth, previousMonth } from './time.js';
import { getDerivedServices } from './tree.js';
import { percentText } from '../export/slaReport.js';
import type { SliGroup } from './engine.js';

/**
 * Plain-text lines about the derived SLA and service tree, for the assistant's
 * snapshot (services/assistant.ts). Kept here so the chat code never needs to know how the
 * SLA engine works. Every figure comes from the same cached reports the SLA
 * and Services pages show.
 */

/** The report's own text, so a missed 98.996 against 99 never reads as "99.00%". */
const pct = (v: number | null, target: number) => (v === null ? 'no data' : percentText(v, target));

const below = (groups: SliGroup[], target: number, limit = 6) =>
  groups
    .filter((g) => g.sli !== null && g.sli < target)
    .sort((a, b) => (a.sli ?? 0) - (b.sli ?? 0))
    .slice(0, limit)
    .map((g) => `${g.name} ${pct(g.sli, target)}`);

export async function derivedSlaLines(): Promise<string[]> {
  const tz = config.sla.timezone;
  const month = currentMonth(tz);
  const last = previousMonth(month);
  const [lastStrict, lastReport, thisMonth] = await Promise.all([
    getMonthlySli(last, 'availability'),
    getMonthlySli(last, 'hcml-report'),
    getMonthlySli(month, 'availability'),
  ]);
  const target = lastStrict.target;
  const o = lastStrict.overall;

  const lines = [
    `Derived SLA (target ${target}%, from ICMP triggers; Zabbix has no services):`,
    `- ${last}: ${pct(o.sli, target)} strict, ${o.meeting ? 'met' : 'missed'} (${o.withData}/${o.hosts} devices with data)`,
    `- ${last} by HCML's report method: ${pct(lastReport.overall.sli, lastReport.target)} (ignores devices fully down)`,
  ];
  // Right after the figure it inflates: asked why HCML's number is so high, the
  // model should not have to guess that some devices were never measured.
  const never = lastReport.hosts.filter((h) => !h.measured).length;
  if (never) {
    lines.push(`- ${never} devices never measured (no ICMP data ever collected); HCML's method counts them as 100%`);
  }
  lines.push(`- ${month} so far: ${pct(thisMonth.overall.sli, thisMonth.target)} strict`);
  // All of them (at most 14) with the count, so a partial list is never read as the whole.
  const sites = below(lastStrict.sites, target, lastStrict.sites.length);
  if (sites.length) lines.push(`- All ${sites.length} sites below target ${last}: ${sites.join(', ')}`);
  const worst = lastStrict.hosts
    .filter((h) => h.sli !== null && h.sli < target)
    .slice(0, 3)
    .map((h) => `${h.name} ${pct(h.sli, target)}`);
  if (worst.length) lines.push(`- Worst devices ${last}: ${worst.join(', ')}`);
  return lines;
}

export async function derivedServiceLines(): Promise<string[]> {
  const tree = await getDerivedServices(currentMonth(config.sla.timezone), 'availability');
  const root = tree.tree[0];
  if (!root) return [];
  const lines: string[] = [];
  // Lowest availability first: the snapshot budget keeps only the first few lines.
  const ordered = [...root.children].sort(
    (a, b) => (a.sla?.sli ?? Infinity) - (b.sla?.sli ?? Infinity),
  );
  for (const node of ordered) {
    if (node.worst < 0) continue;
    const causes = node.problems.slice(0, 1).map((p) => p.name).join('; ');
    lines.push(`- ${node.name}: ${pct(node.sla?.sli ?? null, tree.target)} this month${causes ? `; now: ${causes}` : ''}`);
  }
  return lines;
}
