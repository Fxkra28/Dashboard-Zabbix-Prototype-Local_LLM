import { Link } from 'react-router-dom';
import type { HostOverview, SiteHost, SiteSource } from '../../types';
import { HostStatePill, SeverityCounts } from '../../shared/components/StatusBadge';
import { NoData } from '../../shared/components/NoData';
import { ifaceType } from '../../shared/lib/severity';
import { TableWrap } from '../../shared/components/TableWrap';

/** A host as the Hosts page lists it, or as a site lists its own (which also says where the site came from). */
export type HostTableRow = HostOverview & Partial<Pick<SiteHost, 'availability' | 'siteSource'>> & { category?: string };

/** Where a host's site came from, strongest first. */
const SOURCE_LABEL: Record<SiteSource, string> = {
  tag: 'site tag',
  name: 'from host name',
  inventory: 'inventory',
  group: 'host group (guess)',
};

/**
 * The host table of the Hosts page and of an open site; `siteFrom` adds the "Site from" column. The Devices page adds the site and the template
 * (`showSite`, `showCategory`) and a link to a device's ports for those who may read them (`portsLink`).
 */
export function HostTable({
  hosts,
  siteFrom = false,
  showSite = false,
  showCategory = false,
  portsLink = false,
}: {
  hosts: HostTableRow[];
  siteFrom?: boolean;
  showSite?: boolean;
  showCategory?: boolean;
  portsLink?: boolean;
}) {
  return (
    <TableWrap label="Hosts">
      <table className="data">
        <thead>
          <tr>
            <th>Host</th>
            {showSite && <th>Site</th>}
            <th>Interface</th>
            <th>Availability</th>
            <th>Status</th>
            <th>Problems</th>
            {showCategory && <th>Template</th>}
            {siteFrom && <th>Site from</th>}
            <th className="sticky-end"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {hosts.map((h) => {
            const iface = h.interfaces?.[0];
            return (
              <tr key={h.hostid}>
                <td style={{ fontWeight: 500 }}>{h.name}</td>
                {showSite && <td>{h.site?.name ?? <NoData label="No site" />}</td>}
                <td className="muted mono">
                  {iface ? `${iface.ip} · ${ifaceType(iface.type)}` : <NoData />}
                </td>
                <td>
                  <HostStatePill host={h} />
                </td>
                <td>
                  {h.maintenance_status === '1' ? (
                    <span className="pill">Maintenance</span>
                  ) : h.status === '0' ? (
                    <span className="pill up">Monitored</span>
                  ) : (
                    <span className="pill">Disabled</span>
                  )}
                </td>
                <td>
                  {h.problems.total > 0 ? (
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                      <SeverityCounts bySeverity={h.problems.bySeverity} />
                      <span className="muted">({h.problems.total})</span>
                    </span>
                  ) : (
                    <span className="muted">None</span>
                  )}
                </td>
                {showCategory && <td className="muted">{h.category ?? <NoData />}</td>}
                {siteFrom && (
                  <td>
                    <span className={`site-src ${h.siteSource}`}>
                      {h.siteSource ? (SOURCE_LABEL[h.siteSource] ?? h.siteSource) : null}
                    </span>
                  </td>
                )}
                <td className="sticky-end">
                  {/* The one link a host has on the Hosts page and in a site stays as it was; the pair is the Devices page's. */}
                  {portsLink ? (
                    <span className="row-actions">
                      <Link className="btn ghost sm" to={`/graphs?hostid=${h.hostid}`}>
                        Graphs
                      </Link>
                      <Link className="btn ghost sm" to={`/network?hostid=${h.hostid}`}>
                        Ports
                      </Link>
                    </span>
                  ) : (
                    <Link className="btn ghost sm" to={`/graphs?hostid=${h.hostid}`}>
                      Graphs
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}
