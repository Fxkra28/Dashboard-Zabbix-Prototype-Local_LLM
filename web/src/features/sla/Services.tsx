import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useAiEnabled } from '../assistant/useAi';
import { useReportTimeZone } from '../../shared/hooks/useReportTimeZone';
import { useUrlState } from '../../shared/hooks/useUrlState';
import type {
  DerivedKind,
  DerivedServiceNode,
  DerivedServicesResponse,
  ServiceNode,
  ServicesResponse,
  SliProfile,
} from '../../types';
import { SEVERITIES } from '../../theme';
import { SeverityBadge } from '../../shared/components/StatusBadge';
import { Async, Empty } from '../../shared/components/states';
import { FieldSpacer } from '../../shared/components/Field';
import { SlaExplainPanel, type DerivedSlaScope } from '../assistant/ExplainPanel';
import { IconChevron } from '../../shared/components/icons';
import { percentText } from './percent';
import { recentMonths } from '../../shared/lib/time';
import {
  DERIVED_BANNER,
  GapsNote,
  METHOD_LABEL,
  MethodToggle,
  MonthSelect,
  NoDataPill,
  lastClosedMonth,
} from './Sli';
import { count } from '../../shared/lib/plural';

/**
 * Services tree (HCML Goal 2): the portal's answer to
 * "monitoring is still device-centric and reactive".
 *
 * A failure reads as *"BD FPSO, Voice path is degraded, because the agent on
 * FGR-60F-DELTA-01 stopped reporting"*, not as a bare host alert. Zabbix
 * computes the roll-up; this makes it legible.
 *
 * When Zabbix has no services configured (HCML's has none), the page shows
 * the tree the portal derives from the estate instead, sites, device classes,
 * WAN paths and business services, with the derived monthly SLA per node.
 */

/** Zabbix service status: -1 is OK, anything else is a propagated severity. */
const statusColor = (status: number) =>
  status < 0 ? 'var(--good)' : (SEVERITIES[status]?.color ?? 'var(--danger)');

const isDerived = (n: ServiceNode): n is DerivedServiceNode => 'kind' in n;

const KIND_LABEL: Partial<Record<DerivedKind, string>> = {
  business: 'business',
  site: 'site',
  class: 'group',
  'wan-path': 'WAN path',
  web: 'web check',
};

function collectDegraded(nodes: ServiceNode[], into: Set<string>, maxDepth = Infinity, depth = 0): Set<string> {
  if (depth > maxDepth) return into;
  for (const n of nodes) {
    if (n.worst >= 0 && n.children.length) into.add(n.serviceid);
    collectDegraded(n.children, into, maxDepth, depth + 1);
  }
  return into;
}

function SlaChip({ sla }: { sla: NonNullable<ServiceNode['sla']> }) {
  return (
    <span className={`svc-sla ${sla.meeting ? 'ok' : 'miss'}`} title={`Target ${sla.slo}%`}>
      {percentText(sla.sli, sla.slo)} <em>/ {sla.slo}%</em>
    </span>
  );
}

/** Devices under a derived node, and how many of them missed the target this month. */
interface DeviceCount {
  devices: number;
  below: number;
}

/**
 * Count each derived node's devices once. `descendants` counts every node below
 * (sites, groups, paths and devices alike), so "228 below" read like a device
 * count (or a count of devices below target) and was neither.
 */
function countDevices(tree: ServiceNode[]): Map<string, DeviceCount> {
  const out = new Map<string, DeviceCount>();
  const walk = (node: ServiceNode): Map<string, boolean> => {
    // hostid → below target, for the devices under this node
    const hosts = new Map<string, boolean>();
    for (const child of node.children) {
      if (isDerived(child) && child.kind === 'host' && child.hostid) {
        hosts.set(child.hostid, child.sla?.meeting === false && child.dataStatus !== 'nodata');
      }
      for (const [id, below] of walk(child)) hosts.set(id, below);
    }
    let below = 0;
    for (const b of hosts.values()) if (b) below++;
    out.set(node.serviceid, { devices: hosts.size, below });
    return hosts;
  };
  for (const root of tree) walk(root);
  return out;
}

/** Derived nodes that the explain endpoint can scope: the estate and each site. */
function derivedScope(node: ServiceNode): string | null {
  if (!isDerived(node)) return null;
  if (node.serviceid === 'derived:estate') return 'overall';
  if (node.serviceid === 'derived:unassigned') return 'site:unassigned';
  const m = /^derived:site:([^:]+)$/.exec(node.serviceid);
  return m ? `site:${m[1]}` : null;
}

function Row({
  node,
  depth,
  expanded,
  toggle,
  counts,
  aiEnabled,
  onExplain,
}: {
  node: ServiceNode;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  counts: Map<string, DeviceCount>;
  aiEnabled: boolean;
  onExplain: (n: ServiceNode) => void;
}) {
  const open = expanded.has(node.serviceid);
  const hasKids = node.children.length > 0;
  const derived = isDerived(node) ? node : null;
  const noData = derived?.dataStatus === 'nodata';
  const canExplain = aiEnabled && (derived ? derivedScope(node) !== null : Boolean(node.sla));
  // Derived parents carry no status of their own; show the worst live problem beneath them.
  const status = derived ? node.worst : node.status;
  const count = derived ? counts.get(node.serviceid) : undefined;

  return (
    <>
      <div className="svc-row" style={{ paddingLeft: 12 + depth * 22 }}>
        <span className="svc-main">
          {hasKids ? (
            <button
              className={`svc-toggle${open ? '' : ' collapsed'}`}
              onClick={() => toggle(node.serviceid)}
              aria-expanded={open}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}
            >
              <IconChevron />
            </button>
          ) : (
            <span className="svc-toggle placeholder" />
          )}

          <span className="svc-dot" style={{ background: statusColor(status) }} />

          <span className="svc-name">{node.name}</span>

          {derived && KIND_LABEL[derived.kind] && <span className="svc-kind">{KIND_LABEL[derived.kind]}</span>}

          {status >= 0 ? (
            <SeverityBadge level={status} />
          ) : (
            <span className="pill up">OK</span>
          )}

          {hasKids &&
            (derived ? (
              count && count.devices > 0 ? (
                <span className="muted svc-count">
                  {count.devices} device{count.devices === 1 ? '' : 's'}
                  {count.below > 0 && <span className="svc-below"> · {count.below} below target</span>}
                </span>
              ) : null
            ) : (
              <span className="muted svc-count">
                {node.descendants} {node.descendants === 1 ? 'service' : 'services'}
              </span>
            ))}
        </span>

        <span className="svc-right">
          {noData ? (
            <NoDataPill title="Too little collected data this month to measure" />
          ) : (
            node.sla && <SlaChip sla={node.sla} />
          )}
          {canExplain && (
            <button
              className="btn ghost sm"
              onClick={() => onExplain(node)}
              title="Explain this SLA without the acronyms"
            >
              Plain language
            </button>
          )}
        </span>
      </div>

      {/* Only leaves show causes: parents would repeat their children's. */}
      {!hasKids &&
        node.problems.map((p) => (
          <div className="svc-cause" style={{ paddingLeft: 12 + depth * 22 + 46 }} key={p.eventid}>
            <span className="svc-cause-label">because</span> {p.name}
          </div>
        ))}

      {open &&
        node.children.map((c) => (
          <Row
            key={c.serviceid}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            counts={counts}
            aiEnabled={aiEnabled}
            onExplain={onExplain}
          />
        ))}
    </>
  );
}

/** The tree with its summary controls; shared by the Zabbix and derived views. */
function ServiceTree({
  data,
  seedDepth,
  openTop = false,
  extraControls,
  onExplain,
}: {
  data: ServicesResponse;
  /** How deep the degraded branches open on first load. */
  seedDepth: number;
  openTop?: boolean;
  extraControls?: React.ReactNode;
  onExplain: (n: ServiceNode) => void;
}) {
  const aiEnabled = useAiEnabled();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [seeded, setSeeded] = useState(false);

  // A NOC wants the broken branches already open and the healthy ones folded
  // away. Seed once so the user's own toggling isn't overwritten on re-poll.
  useEffect(() => {
    if (seeded) return;
    const ids = collectDegraded(data.tree, new Set(), seedDepth);
    // The derived tree has a single root: open it so the page never loads as one row.
    if (openTop) for (const n of data.tree) ids.add(n.serviceid);
    setExpanded(ids);
    setSeeded(true);
  }, [data, seeded, seedDepth, openTop]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allIds = useMemo(() => {
    const ids = new Set<string>();
    const walk = (nodes: ServiceNode[]) => {
      for (const n of nodes) {
        if (n.children.length) ids.add(n.serviceid);
        walk(n.children);
      }
    };
    walk(data.tree);
    return ids;
  }, [data]);
  const counts = useMemo(() => countDevices(data.tree), [data]);
  // Counting the open set is not enough: it can hold a branch that left the tree, or a root with no children.
  const allOpen = allIds.size > 0 && [...allIds].every((id) => expanded.has(id));

  return (
    <>
      <div className="controls">
        {extraControls}
        <FieldSpacer>
          <span className="pill">{count(data.total, 'service')}</span>
        </FieldSpacer>
        <FieldSpacer>
          <span className={`pill ${data.degraded ? 'down' : 'up'}`}>
            {data.degraded ? `${data.degraded} degraded` : 'All healthy'}
          </span>
        </FieldSpacer>
        <FieldSpacer>
          <button
            className="btn ghost sm"
            disabled={allIds.size === 0}
            onClick={() => setExpanded(allOpen ? new Set() : new Set(allIds))}
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </FieldSpacer>
      </div>

      <div className="panel">
        <div className="svc-tree">
          {data.tree.map((n) => (
            <Row
              key={n.serviceid}
              node={n}
              depth={0}
              expanded={expanded}
              toggle={toggle}
              counts={counts}
              aiEnabled={aiEnabled}
              onExplain={onExplain}
            />
          ))}
        </div>
      </div>
    </>
  );
}

const PROFILES: SliProfile[] = ['availability', 'hcml-report'];

function DerivedServices() {
  const zone = useReportTimeZone();
  const months = useMemo(() => recentMonths(12, zone), [zone]);
  // Month and method live in the URL, so Back from a device graph returns to the same tree. One not offered reads as the default.
  const [month, setMonth] = useUrlState<string>('month', lastClosedMonth(), { options: months });
  const [profile, setProfile] = useUrlState<SliProfile>('method', 'availability', { options: PROFILES });
  const [explaining, setExplaining] = useState<DerivedSlaScope | null>(null);
  const q = useAsync<DerivedServicesResponse>(
    () => api.servicesDerived(month, profile),
    [month, profile],
    60_000,
  );
  const data = q.data && q.data.month === month && q.data.profile === profile ? q.data : null;

  const onExplain = (n: ServiceNode) => {
    const scope = derivedScope(n);
    if (!scope) return;
    setExplaining({
      scope,
      name: n.name,
      month,
      profile,
      target: data?.target ?? n.sla?.slo ?? 99,
      methodLabel: METHOD_LABEL[profile],
    });
  };

  const controls = (
    <>
      <MonthSelect value={month} onChange={setMonth} />
      <MethodToggle value={profile} onChange={setProfile} />
    </>
  );

  return (
    <>
      <div className="notice sli-banner">
        <strong>{DERIVED_BANNER}.</strong> Sites come from host names; each node’s figure is the{' '}
        {METHOD_LABEL[profile].toLowerCase()} monthly availability, and its colour is the live
        problem state right now.
      </div>

      {/* Also on an error, so another month or method can still be picked. */}
      {!data && <div className="controls">{controls}</div>}

      <Async
        loading={q.loading || !data}
        error={q.error}
        data={data}
        updatedAt={q.updatedAt}
        loadingLabel="Deriving the service tree…"
      >
        {(d) => (
          <>
            <GapsNote gaps={d.gaps} windows={d.noDataWindows} profile={d.profile} />
            {/* Keyed by month+method so the expansion seed re-applies to a new tree. */}
            <ServiceTree
              key={`${d.month}:${d.profile}`}
              data={d}
              seedDepth={0}
              openTop
              extraControls={controls}
              onExplain={onExplain}
            />
          </>
        )}
      </Async>

      {explaining && <SlaExplainPanel derived={explaining} onClose={() => setExplaining(null)} />}
    </>
  );
}

export default function Services() {
  // The first answer decides between Zabbix's tree and the derived one, for good. The Zabbix tree
  // refreshes like the other pages; the derived one polls on its own, so this stops asking.
  const [derived, setDerived] = useState<boolean | null>(null);
  const q = useAsync<ServicesResponse>(() => api.services(), [], derived ? undefined : 60_000);
  const [explaining, setExplaining] = useState<ServiceNode | null>(null);
  if (derived === null && q.data) setDerived(q.data.total === 0);

  // Zabbix has no services: derive them from the estate instead of an empty page.
  if (derived ?? (q.data?.total === 0)) return <DerivedServices />;

  return (
    <>
      <Async
        loading={q.loading}
        error={q.error}
        data={q.data}
        updatedAt={q.updatedAt}
        loadingLabel="Building the service tree…"
      >
        {(data) => {
          if (!data.tree.length) {
            return (
              <div className="panel">
                <Empty>
                  No services are defined in Zabbix yet.
                  <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                    Build the tree under <strong>Services</strong> in Zabbix; this page reads it.
                  </div>
                </Empty>
              </div>
            );
          }

          return <ServiceTree data={data} seedDepth={Infinity} onExplain={setExplaining} />;
        }}
      </Async>

      {explaining?.sla && (
        <SlaExplainPanel
          sla={explaining.sla}
          serviceid={explaining.serviceid}
          onClose={() => setExplaining(null)}
        />
      )}
    </>
  );
}
