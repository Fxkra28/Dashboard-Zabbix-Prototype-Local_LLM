import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth, roleAllows } from '../../shared/hooks/useAuth';
import { useCapabilities } from '../assistant/useAi';
import { useBuild } from './useBuild';
import { buildLabel } from './build';
import BrandMark from '../../shared/components/BrandMark';
import type { Role } from '../../types';
import {
  IconOverview,
  IconAlert,
  IconHost,
  IconDevice,
  IconNetwork,
  IconLatest,
  IconGraph,
  IconMap,
  IconReport,
  IconService,
  IconSite,
  IconSla,
  IconLink,
  IconShield,
  IconChat,
  IconChevron,
} from '../../shared/components/icons';

type Item = {
  to: string;
  label: string;
  icon: (p: { size?: number }) => JSX.Element;
  end?: boolean;
};
type Section = { title: string; items: Item[] };

// Mirrors Zabbix's native left menu (Monitoring / Reports sections), read-only
// subset, plus the views Zabbix has no equivalent for (Sites, Links). Each label
// is also the title of the page it opens (DESIGN.md section 9). Which role
// may see a page is not written here: the server says so in /api/auth/me.
const SECTIONS: Section[] = [
  {
    title: 'Monitoring',
    items: [
      { to: '/', label: 'Dashboard', icon: IconOverview, end: true },
      { to: '/problems', label: 'Problems', icon: IconAlert },
      { to: '/sites', label: 'Sites', icon: IconSite },
      { to: '/hosts', label: 'Hosts', icon: IconHost },
      { to: '/devices', label: 'Devices', icon: IconDevice },
      { to: '/latest', label: 'Latest data', icon: IconLatest },
      { to: '/graphs', label: 'Graphs', icon: IconGraph },
      { to: '/maps', label: 'Maps', icon: IconMap },
      { to: '/network', label: 'Network', icon: IconNetwork },
      { to: '/links', label: 'Links & WAN health', icon: IconLink },
      { to: '/services', label: 'Services', icon: IconService },
      { to: '/sla', label: 'SLA', icon: IconSla },
    ],
  },
  {
    title: 'Reports',
    items: [
      { to: '/reports/availability', label: 'Availability & response', icon: IconReport },
      { to: '/reports/capacity', label: 'Capacity trends', icon: IconGraph },
      { to: '/reports/noise', label: 'Alert noise', icon: IconAlert },
      { to: '/reports/top-triggers', label: 'Top 100 triggers', icon: IconReport },
      { to: '/reports/inventory', label: 'Inventory & ownership scorecard', icon: IconShield },
    ],
  },
  {
    // The one section with no Zabbix equivalent. Viewer role on purpose: the
    // assistant is only ever shown what a viewer can already see.
    title: 'Assistant',
    items: [{ to: '/assistant', label: 'Assistant', icon: IconChat }],
  },
];

/** The top bar's page title for each route: the menu label that opens it. */
export const PAGE_TITLES: Record<string, string> = Object.fromEntries(
  SECTIONS.flatMap((s) => s.items.map((i) => [i.to, i.label])),
);

function MenuSection({
  section,
  allowed,
  collapsed,
}: {
  section: Section;
  allowed: (to: string) => boolean;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(true);

  // Hide what this role can't reach: the BFF enforces it regardless, but
  // offering a link that can only 403 is worse than not offering it.
  const items = section.items.filter((i) => allowed(i.to));
  if (!items.length) return null;

  // A rail has no room for a section heading, and collapsing a section you
  // cannot see the name of is not a control worth offering.
  const shown = collapsed || open;

  return (
    <div className="nav-section">
      {!collapsed && (
        <button
          className="nav-section-title"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span>{section.title}</span>
          <span className={`chev${open ? '' : ' collapsed'}`}>
            <IconChevron />
          </span>
        </button>
      )}
      {shown && (
        <nav className="nav-items" aria-label={section.title}>
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <Icon />
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

export default function Sidebar({
  collapsed,
  locked = false,
  onToggle,
}: {
  collapsed: boolean;
  /** The screen is too narrow to offer the full sidebar, so the rail stays and has no toggle. */
  locked?: boolean;
  onToggle: () => void;
}) {
  const { me, role, pages } = useAuth();
  const { writeBack } = useCapabilities();
  const build = buildLabel(useBuild(Boolean(me)));

  // The server's table decides. Until it has answered nothing is offered; a BFF that predates
  // the table offers everything, as it still refuses what the role may not open.
  const allowed = (to: string) => {
    if (!me) return false;
    if (!pages) return true;
    const needs: Role | undefined = pages[to];
    return needs !== undefined && roleAllows(role, needs);
  };
  // Acknowledge is the one write, and only for operators on a portal that has it on.
  const canAck = writeBack && roleAllows(role, 'operator');

  return (
    <aside className="sidebar">
      <div className="brand">
        {/* The white logo says HCML itself, so the image carries the name in both states. */}
        <BrandMark variant={collapsed ? 'icon' : 'lockup-white'} alt="HCML" />
        {!collapsed && <div className="subtitle">Monitoring Portal</div>}
      </div>

      <div className="nav-scroll">
        {SECTIONS.map((s) => (
          <MenuSection key={s.title} section={s} allowed={allowed} collapsed={collapsed} />
        ))}
      </div>

      <div className="spacer" />
      {!collapsed && (
        <div className="foot">
          {canAck ? 'Read-only except acknowledge' : 'Read-only'} · powered by Zabbix
          {build && <div className="foot-build">{build}</div>}
        </div>
      )}

      {/* A toggle that cannot change anything would only mislead, so a forced rail has none. */}
      {!locked && (
        <button
          type="button"
          className="rail-toggle"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
          title={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
        >
          <IconChevron />
        </button>
      )}
    </aside>
  );
}
