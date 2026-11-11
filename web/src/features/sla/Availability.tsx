import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useCapabilities } from '../assistant/useAi';
import { useUrlState } from '../../shared/hooks/useUrlState';
import type {
  AgingReport,
  AvailabilityBasis,
  AvailabilityReport,
  HostAvailability,
  SliProfile,
} from '../../types';
import { SEVERITIES } from '../../theme';
import { SeverityBadge } from '../../shared/components/StatusBadge';
import { Async, Empty } from '../../shared/components/states';
import { Field } from '../../shared/components/Field';
import KpiCard from '../../shared/components/KpiCard';
import { NoData } from '../../shared/components/NoData';
import EmailReport from './EmailReport';
import ReportDownload from './ReportDownload';
import {
  CoverageText,
  GapsNote,
  METHOD_LABEL,
  METHOD_NOTE,
  MethodToggle,
  NoDataPill,
  SliPill,
  fmtPct,
} from './Sli';
import { monthLabel, recentMonths } from '../../shared/lib/time';
import { useReportTimeZone } from '../../shared/hooks/useReportTimeZone';
import { PERCENT_DP, dur, formatPercent } from '../../shared/lib/units';
import { count } from '../../shared/lib/plural';
import { TableWrap } from '../../shared/components/TableWrap';

/**
 * Availability & response report (HCML Goal 6):
 * *"hard to see SLA, capacity trends, and recurring issues."*
 *
 * Two questions on one page: how much of the window was each host in trouble,
 * and how long is trouble sitting unacknowledged.
 *
 * The default basis measures availability the way the SLA does (ICMP
 * unreachable or ping loss, hours with no collected data left out, via the
 * server's SLI engine). "All problems (legacy)" is the original report: any
 * open problem at or above a severity counts as downtime.
 */

/** Zabbix-style: 99.9%+ is fine, 99%+ is watch, below that is a problem. */
const availColor = (pct: number) =>
  pct >= 99.9 ? 'var(--good)' : pct >= 99 ? 'var(--warn)' : 'var(--danger)';
/** The same bands as text: the fills above are for the KPI stripe and fall below 4.5:1 as words. */
const availText = (pct: number) =>
  pct >= 99.9 ? 'var(--good-text)' : pct >= 99 ? 'var(--warn-text)' : 'var(--danger-text)';

function Aging() {
  const q = useAsync<AgingReport>(() => api.aging(), [], 30_000);

  return (
    <div className="panel">
      <h2>Unacknowledged, by age</h2>
      <Async loading={q.loading} error={q.error} data={q.data} updatedAt={q.updatedAt}>
        {(a) => (
          <>
            <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
              {a.unacknowledged} of {a.total} active problems have not been acknowledged.
            </div>

            <div className="aging-bars">
              {a.buckets.map((b, i) => {
                const max = Math.max(1, ...a.buckets.map((x) => x.count));
                return (
                  <div key={b.label} className="aging-row">
                    <span className="aging-label">{b.label}</span>
                    <span className="aging-track">
                      <span
                        style={{
                          width: `${(b.count / max) * 100}%`,
                          // Older = worse: the last bucket is the one that hurts.
                          background: i === a.buckets.length - 1 ? 'var(--danger)' : 'var(--primary-light)',
                        }}
                      />
                    </span>
                    <span className="aging-count">{b.count}</span>
                  </div>
                );
              })}
            </div>

            {a.oldest.length > 0 && (
              <>
                <h2 style={{ marginTop: 20 }}>Waiting longest</h2>
                <TableWrap label="Problems waiting longest">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Age</th>
                        <th>Severity</th>
                        <th>Host</th>
                        <th>Problem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.oldest.slice(0, 10).map((p) => (
                        <tr key={p.eventid}>
                          <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                            {dur(p.ageSeconds)}
                          </td>
                          <td>
                            <SeverityBadge level={p.severity} />
                          </td>
                          <td className="muted">{p.host || <NoData />}</td>
                          <td>{p.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </>
            )}
          </>
        )}
      </Async>
    </div>
  );
}

/** Period: rolling `d7`/`d30`, or `m:YYYY-MM` for a calendar month (in the report zone). */
type Period = string;

function periodQuery(period: Period): { days?: number; month?: string } {
  return period.startsWith('m:') ? { month: period.slice(2) } : { days: Number(period.slice(1)) };
}

/** Hosts with no figure go last; otherwise keep the server's worst-first order. */
function orderHosts(hosts: HostAvailability[]): HostAvailability[] {
  return hosts
    .map((h, i) => ({ h, i }))
    .sort((a, b) => (a.h.availability === null ? 1 : 0) - (b.h.availability === null ? 1 : 0) || a.i - b.i)
    .map((x) => x.h);
}

const BASES: AvailabilityBasis[] = ['availability', 'all-problems'];
const PROFILES: SliProfile[] = ['availability', 'hcml-report'];

export default function Availability() {
  const zone = useReportTimeZone();
  const months = useMemo(() => recentMonths(12, zone), [zone]);
  const periods = useMemo(() => ['d7', 'd30', ...months.map((m) => `m:${m}`)], [months]);
  // Period, basis, method and severity live in the URL, so Back from a host graph keeps the report.
  const [period, setPeriod] = useUrlState<Period>('period', 'd7', { options: periods });
  const [basis, setBasis] = useUrlState<AvailabilityBasis>('basis', 'availability', { options: BASES });
  const [profile, setProfile] = useUrlState<SliProfile>('method', 'availability', { options: PROFILES });
  // -1 = "follow the server". Until the operator picks a floor themselves,
  // the page uses the server's configured default rather than a hardcoded one,
  // so an estate that alarms at Warning doesn't open to an empty report.
  const { availabilityMinSeverity } = useCapabilities();
  const [picked, setPicked] = useUrlState<number>('severity', -1, { options: [-1, 0, 1, 2, 3, 4, 5] });
  const severity = picked >= 0 ? picked : availabilityMinSeverity;
  const legacy = basis === 'all-problems';
  // The SLA report is one calendar month on the ICMP basis: a rolling window or the legacy basis has none.
  const reportMonth = !legacy && period.startsWith('m:') ? period.slice(2) : null;

  const q = useAsync<AvailabilityReport>(
    () =>
      api.availability({
        basis,
        profile: legacy ? undefined : profile,
        severity: legacy ? severity : undefined,
        ...periodQuery(period),
      }),
    [period, basis, profile, legacy ? severity : -1],
  );

  return (
    <>
      <div className="controls">
        <Field label="Period" htmlFor="avail-period">
          <select id="avail-period" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <optgroup label="Rolling">
              <option value="d7">Last 7 days</option>
              <option value="d30">Last 30 days</option>
            </optgroup>
            <optgroup label={`Calendar month (${zone})`}>
              {months.map((m, i) => (
                <option key={m} value={`m:${m}`}>
                  {monthLabel(m)}
                  {i === 0 ? ' (so far)' : ''}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
        <Field label="Basis" htmlFor="avail-basis">
          <select
            id="avail-basis"
            value={basis}
            onChange={(e) => setBasis(e.target.value as AvailabilityBasis)}
          >
            <option value="availability">Availability (ICMP)</option>
            <option value="all-problems">All problems (legacy)</option>
          </select>
        </Field>
        {legacy ? (
          <Field label="Counts problems of at least" htmlFor="avail-severity">
            <select id="avail-severity" value={severity} onChange={(e) => setPicked(Number(e.target.value))}>
              {SEVERITIES.map((s) => (
                <option key={s.level} value={s.level}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <MethodToggle value={profile} onChange={setProfile} />
        )}
        {reportMonth && (
          <>
            <ReportDownload month={reportMonth} disabled={q.loading || q.stale || !q.data} />
            <EmailReport month={reportMonth} disabled={q.loading || q.stale || !q.data} />
          </>
        )}
      </div>

      <Async
        loading={q.loading}
        error={q.error}
        data={q.data}
        stale={q.stale}
        updatedAt={q.updatedAt}
        loadingLabel="Replaying event history…"
      >
        {(data) => {
          const engine = data.basis !== 'all-problems' && data.overall !== undefined;
          // A BFF from before months reached the legacy report answers with its default window instead.
          const monthIgnored = !q.stale && period.startsWith('m:') && !engine && data.month !== period.slice(2);
          const target = data.target ?? 99;
          const hosts = orderHosts(data.hosts);
          const measured = data.hosts.filter((h) => h.availability !== null);
          const worst = measured.reduce<HostAvailability | undefined>(
            (w, h) => (w === undefined || (h.availability ?? 100) < (w.availability ?? 100) ? h : w),
            undefined,
          );
          const avg = measured.length
            ? measured.reduce((s, h) => s + (h.availability ?? 0), 0) / measured.length
            : 100;
          const below = (data.sites ?? []).filter((s) => s.meeting === false);
          const hasSite = data.hosts.some((h) => h.site !== undefined);
          const hasCategory = data.hosts.some((h) => h.category !== undefined);
          const hasCoverage = data.hosts.some((h) => h.coverage !== undefined);

          return (
            <>
              {engine && data.overall ? (
                <div className="grid kpis sli-kpis">
                  <KpiCard
                    label={`Overall · ${METHOD_LABEL[data.profile ?? profile]}`}
                    value={fmtPct(data.overall.sli, PERCENT_DP.availability, target)}
                    sub={
                      data.overall.sli === null
                        ? 'no data'
                        : `target ${target}% · ${data.overall.withData} of ${data.overall.hosts} devices measured`
                    }
                    accent={
                      data.overall.sli === null
                        ? 'var(--muted)'
                        : data.overall.meeting
                          ? 'var(--good)'
                          : 'var(--danger)'
                    }
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
                    label="Sites below target"
                    value={below.length}
                    sub={
                      below.length
                        ? below
                            .slice(0, 3)
                            .map((s) => s.name)
                            .join(', ') + (below.length > 3 ? ` +${below.length - 3}` : '')
                        : `all sites at or above ${target}%`
                    }
                    accent={below.length ? 'var(--danger)' : 'var(--good)'}
                  />
                </div>
              ) : (
                <div className="grid kpis sli-kpis">
                  <KpiCard
                    label="Hosts with downtime"
                    value={data.hosts.length}
                    sub={`over ${dur(data.windowSeconds)}`}
                  />
                  <KpiCard
                    label="Mean availability"
                    value={formatPercent(avg, 'availability')}
                    sub="of affected hosts only"
                    accent={availColor(avg)}
                  />
                  <KpiCard
                    label="Worst host"
                    value={formatPercent(worst?.availability, 'availability')}
                    sub={worst?.host ?? 'nothing recorded'}
                    accent={worst?.availability != null ? availColor(worst.availability) : undefined}
                  />
                </div>
              )}

              {engine && (
                <p className="sli-method-note">
                  <strong>{METHOD_LABEL[data.profile ?? profile]}.</strong> {METHOD_NOTE}
                </p>
              )}
              <GapsNote
                gaps={engine ? data.gaps : undefined}
                windows={data.noDataWindows}
                profile={engine ? (data.profile ?? profile) : 'all-problems'}
              />

              {monthIgnored && (
                <div className="notice warn">
                  This portal doesn’t support calendar months for the legacy basis yet. These figures
                  cover the last {Math.round(data.windowSeconds / 86400)} days instead.
                </div>
              )}

              {data.truncated && (
                <div className="notice warn">
                  Zabbix returned a full page of events for this window, so these figures are a{' '}
                  <strong>floor</strong>: real downtime may be higher. Narrow the period for exact
                  numbers.
                </div>
              )}

              <div className="grid sli-grid">
                <div className="panel">
                  <h2>Availability by host</h2>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                    {engine ? (
                      <>
                        Share of the measured time each device was reachable without high ping loss.
                        Devices with too little collected data show <NoDataPill /> and are left out
                        of every average.
                      </>
                    ) : (
                      <>
                        Share of the period with no open problem at or above the chosen severity.
                        Overlapping problems are merged, so simultaneous alerts aren’t double-counted.
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
                              {hasSite && (
                                <td className="muted">{h.site ? `${h.site.code} · ${h.site.name}` : <NoData />}</td>
                              )}
                              {hasCategory && <td className="muted">{h.category ?? <NoData />}</td>}
                              <td>
                                {engine ? (
                                  <SliPill
                                    sli={h.availability}
                                    target={target}
                                    dataStatus={h.dataStatus}
                                  />
                                ) : h.availability === null ? (
                                  <NoDataPill />
                                ) : (
                                  <strong style={{ color: availText(h.availability) }}>
                                    {formatPercent(h.availability, 'availability')}
                                  </strong>
                                )}
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
                    <Empty>No problems at this severity in the period.</Empty>
                  )}
                </div>

                <Aging />
              </div>
            </>
          );
        }}
      </Async>
    </>
  );
}
