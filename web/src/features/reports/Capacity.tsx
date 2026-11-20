import { PageLink } from '../../shared/components/PageLink';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useUrlState } from '../../shared/hooks/useUrlState';
import { useAuth } from '../../shared/hooks/useAuth';
import type { CapacityReport, CapacityRow } from '../../types';
import { Async, Empty } from '../../shared/components/states';
import { Field } from '../../shared/components/Field';
import { TableWrap } from '../../shared/components/TableWrap';
import { NoData } from '../../shared/components/NoData';
import { momentWords } from '../../shared/lib/freshness';

/**
 * Capacity trends (HCML Goal 6). HCML's deck already shows a
 * "Top Host by CPU / Memory" panel: this is that, over a period rather than a
 * moment, so a creeping trend is visible before it becomes an incident.
 *
 * Reads Zabbix `trend.get` (hourly aggregates), falling back to raw history on
 * an instance too young to have trends yet. Covers agent hosts and SNMP devices
 * (Cisco, FortiGate), plus a "busiest interfaces" panel (`ifutil`).
 */

const util = (pct: number) =>
  pct >= 90 ? 'var(--danger)' : pct >= 75 ? 'var(--warn)' : 'var(--good)';

/** Panel titles; `ifutil` rows are one interface each (host + port). */
const PANEL_TITLE: Record<string, string> = {
  ifutil: 'Busiest interfaces',
};

function MetricPanel({
  metric,
  label,
  rows,
  days,
  builtAt,
}: {
  metric: string;
  label: string;
  rows: CapacityRow[];
  days: number;
  /** When the report was built, in unix seconds, or null when the portal does not say. */
  builtAt: number | null;
}) {
  const iface = metric === 'ifutil';
  // The server keeps interface items from an account without the Network page (SC-45), so one that pressed Graph there would be refused: the button is left off (FR-55).
  const { can } = useAuth();
  const canGraph = !iface || can('network');
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{PANEL_TITLE[metric] ?? label}</h2>
        {rows.some((r) => r.source === 'history') && (
          <span className="pill" title="No hourly trends yet for some of these: averaged from raw history">
            from history
          </span>
        )}
      </div>
      {iface && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Traffic in the busier direction (in or out) as a share of the port’s speed. The list is chosen when the report is built{builtAt !== null ? `, which was ${momentWords(builtAt * 1000)}` : ''}, from the
          ports that are busiest at that moment, and only those are then ranked by their average over the last {days === 1 ? '24 hours' : `${days} days`}. A port that was quiet then can be missing here,
          however busy it was on other days.
        </div>
      )}

      {rows.length ? (
        <TableWrap label={PANEL_TITLE[metric] ?? label}>
          <table className="data">
            <thead>
              <tr>
                <th>Host</th>
                <th>{iface ? 'Port' : 'Item'}</th>
                <th style={{ width: 150 }}>Average ({days}d)</th>
                <th>Peak</th>
                {canGraph && <th className="sticky-end"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemid}>
                  <td style={{ fontWeight: 500 }}>{r.host}</td>
                  <td className={iface ? 'mono' : 'muted'}>{r.name}</td>
                  <td>
                    {r.source === 'none' ? (
                      <NoData />
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="score-bar">
                          <span
                            style={{
                              width: `${Math.min(100, Math.max(0, r.avg))}%`,
                              background: util(r.avg),
                            }}
                          />
                        </span>
                        <strong style={{ fontSize: 12 }}>
                          {r.avg.toFixed(1)}
                          {r.units}
                        </strong>
                      </span>
                    )}
                  </td>
                  <td className="muted">
                    {r.source === 'none' ? (
                      <NoData />
                    ) : (
                      <>
                        {r.max.toFixed(1)}
                        {r.units}
                      </>
                    )}
                  </td>
                  {canGraph && (
                    <td className="sticky-end">
                      <PageLink className="btn ghost sm" to={`/graphs?hostid=${r.hostid}&itemid=${r.itemid}`} fallback={null}>
                        Graph
                      </PageLink>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : (
        <Empty>
          No matching items.
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Needs monitored items with these keys in Zabbix.
          </div>
        </Empty>
      )}
    </div>
  );
}

export default function Capacity() {
  // In the URL, so Back from a graph keeps the period.
  const [days, setDays] = useUrlState<number>('days', 7, { options: [1, 7, 30, 90] });
  const q = useAsync<CapacityReport>(() => api.capacity(days), [days]);

  return (
    <>
      <div className="controls">
        <Field label="Period" htmlFor="capacity-days">
          <select id="capacity-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </Field>
      </div>

      <Async
        loading={q.loading}
        error={q.error}
        data={q.data}
        stale={q.stale}
        updatedAt={q.updatedAt}
        loadingLabel="Reading trends…"
        onRetry={q.reload}
      >
        {(data) => {
          const empty = data.metrics.every((m) => !m.rows.length);
          if (empty) {
            return (
              <div className="panel">
                <Empty>
                  No capacity items found.
                  <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                    This report reads <code>system.cpu.util</code>, <code>vm.memory.util</code>,{' '}
                    <code>vfs.fs.*[…,pused]</code> and <code>net.if.*</code> interface traffic from
                    monitored hosts, including SNMP switches and firewalls.
                  </div>
                </Empty>
              </div>
            );
          }

          const noData = data.metrics.some((m) => m.rows.some((r) => r.source === 'none'));

          return (
            <>
              {noData && (
                <div className="notice">
                  Rows marked “no data” have no stored values for this period: the host may not have been
                  reporting.
                </div>
              )}
              <div className="grid sli-grid">
                {data.metrics.map((m) => (
                  <MetricPanel key={m.key} metric={m.key} label={m.label} rows={m.rows} days={data.days} builtAt={data.generatedAt ?? null} />
                ))}
              </div>
            </>
          );
        }}
      </Async>
    </>
  );
}
