import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useReportTimeZone } from '../../shared/hooks/useReportTimeZone';
import type { AvailabilityReport, HostAvailability, SliProfile } from '../../types';
import { Async, Empty } from '../../shared/components/states';
import KpiCard from '../../shared/components/KpiCard';
import { NoData } from '../../shared/components/NoData';
import { TableWrap } from '../../shared/components/TableWrap';
import {
  CoverageText,
  DERIVED_SLA_BANNER,
  GapsNote,
  METHOD_LABEL,
  METHOD_NOTE,
  MethodToggle,
  MonthSelect,
  NoDataPill,
  SliPill,
  fmtPct,
} from './Sli';
import { PERCENT_DP, dur } from '../../shared/lib/units';
import { formatClockLabeled } from '../../shared/lib/time';
import { count } from '../../shared/lib/plural';
import { sitesBelowCard } from './sitesBelow';

/**
 * The last 7 or 30 days of the SLA page: each device's availability over a window that ends now, by the same engine as a month.
 * A window is for watching, so it has no report files, email, schedule or Explain, and the web checks and WAN paths stay monthly.
 */

/** Hosts with no figure go last; otherwise keep the server's worst-first order. */
function orderHosts(hosts: HostAvailability[]): HostAvailability[] {
  return hosts
    .map((h, i) => ({ h, i }))
    .sort((a, b) => (a.h.availability === null ? 1 : 0) - (b.h.availability === null ? 1 : 0) || a.i - b.i)
    .map((x) => x.h);
}

function Window({ data, method }: { data: AvailabilityReport; method: SliProfile }) {
  const target = data.target ?? 99;
  const profile = data.profile ?? method;
  const hosts = orderHosts(data.hosts);
  const sitesCard = sitesBelowCard(data.sites ?? [], target);
  const hasSite = data.hosts.some((h) => h.site !== undefined);
  const hasCategory = data.hosts.some((h) => h.category !== undefined);
  const hasCoverage = data.hosts.some((h) => h.coverage !== undefined);

  return (
    <>
      {data.overall && (
        <div className="grid kpis sli-kpis">
          <KpiCard
            label={`Overall · ${METHOD_LABEL[profile]}`}
            value={fmtPct(data.overall.sli, PERCENT_DP.availability, target)}
            sub={
              data.overall.sli === null
                ? 'no data'
                : `target ${target}% · ${data.overall.withData} of ${data.overall.hosts} devices measured`
            }
            accent={data.overall.sli === null ? 'var(--muted)' : data.overall.meeting ? 'var(--good)' : 'var(--danger)'}
          />
          {(data.categories ?? []).map((c) => (
            <KpiCard
              key={c.key}
              label={c.name}
              value={c.sli === null ? 'No data' : fmtPct(c.sli, PERCENT_DP.availability, target)}
              sub={
                c.sli === null
                  ? `${count(c.hosts, 'device')}, none with data`
                  : `${c.withData} of ${c.hosts} measured · ${c.belowTarget} below ${target}%`
              }
              accent={c.sli === null ? 'var(--muted)' : c.meeting ? 'var(--good)' : 'var(--danger)'}
            />
          ))}
          <KpiCard
            label={`Sites below target · ${METHOD_LABEL[profile]}`}
            value={sitesCard.value}
            sub={sitesCard.sub}
            accent={sitesCard.value ? 'var(--danger)' : 'var(--good)'}
          />
        </div>
      )}

      <p className="sli-method-note">
        <strong>{METHOD_LABEL[profile]}.</strong> {METHOD_NOTE}
      </p>
      <GapsNote gaps={data.gaps} windows={data.noDataWindows} profile={profile} />

      <div className="grid sli-grid">
        <div className="panel">
          <h2>Availability by host</h2>
          <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            {profile === 'hcml-report' ? (
              <>
                By HCML’s method, the share of the time each device was up. Only high ping loss counts as downtime, and a device with no
                collected data counts as up.
              </>
            ) : (
              <>
                Share of the measured time each device was reachable without high ping loss. Devices with too little collected data show{' '}
                <NoDataPill /> and are left out of every average.
              </>
            )}
          </div>
          {hosts.length ? (
            <TableWrap label="Availability of each host" className="sli-scroll">
              <table className="data compact">
                <thead>
                  <tr>
                    <th>Host</th>
                    {hasSite && <th>Site</th>}
                    {hasCategory && <th>Category</th>}
                    <th>Availability</th>
                    <th>Downtime</th>
                    <th>Incidents</th>
                    <th>Longest</th>
                    {hasCoverage && <th>Coverage</th>}
                  </tr>
                </thead>
                <tbody>
                  {hosts.map((h) => (
                    <tr key={h.hostid}>
                      <td style={{ fontWeight: 500 }}>
                        <Link to={`/graphs?hostid=${h.hostid}`}>{h.host}</Link>
                      </td>
                      {hasSite && <td className="muted">{h.site ? `${h.site.code} · ${h.site.name}` : <NoData />}</td>}
                      {hasCategory && <td className="muted">{h.category ?? <NoData />}</td>}
                      <td>
                        <SliPill sli={h.availability} target={target} dataStatus={h.dataStatus} />
                      </td>
                      <td className="muted nowrap">{h.availability === null ? <NoData /> : dur(h.downtime)}</td>
                      <td className="muted">{h.availability === null ? <NoData /> : h.incidents}</td>
                      <td className="muted nowrap">{h.availability === null ? <NoData /> : dur(h.longest)}</td>
                      {hasCoverage && (
                        <td>
                          <CoverageText coverage={h.coverage} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <Empty>No device was measured in this window.</Empty>
          )}
        </div>
      </div>
    </>
  );
}

export default function RollingSla({
  days,
  period,
  setPeriod,
  method,
  setMethod,
}: {
  days: number;
  period: string;
  setPeriod: (p: string) => void;
  method: SliProfile;
  setMethod: (m: SliProfile) => void;
}) {
  useReportTimeZone(); // the clock in the banner follows the server's zone once it is known
  // One method at a time: the window replays the event history, which is the heavy part.
  const key = `${days}:${method}`;
  const q = useAsync<{ key: string; report: AvailabilityReport }>(
    async () => ({ key, report: await api.availability({ basis: 'availability', profile: method, days }) }),
    [days, method],
  );
  // The answer for the window or the method that was on screen before must not sit under the heading of the new one.
  const report = q.data?.key === key ? q.data.report : null;

  return (
    <>
      <div className="notice sli-banner">
        <strong>{DERIVED_SLA_BANNER}.</strong> Computed in the portal from each device’s ICMP triggers, over the last {days} days
        {report ? `, up to ${formatClockLabeled(report.to * 1000)}` : ''}; nothing is written to Zabbix.
      </div>

      <div className="controls">
        <MonthSelect rolling value={period} onChange={setPeriod} label="Period" />
        <MethodToggle value={method} onChange={setMethod} label="Tables use" />
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        A rolling window is for watching. The report files, email, schedule and Explain need a calendar month, and so do the web
        checks and the WAN paths.
      </p>

      <Async
        loading={q.loading || !report}
        error={q.error}
        data={report}
        updatedAt={q.updatedAt}
        loadingLabel="Replaying event history…"
        onRetry={q.reload}
      >
        {(data) => <Window data={data} method={method} />}
      </Async>
    </>
  );
}
