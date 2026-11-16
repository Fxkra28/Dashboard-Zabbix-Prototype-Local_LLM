import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import type { AgingReport } from '../../types';
import { SeverityBadge } from '../../shared/components/StatusBadge';
import { Async } from '../../shared/components/states';
import { NoData } from '../../shared/components/NoData';
import { TableWrap } from '../../shared/components/TableWrap';
import { dur } from '../../shared/lib/units';
import { count } from '../../shared/lib/plural';

/**
 * Response (HCML Goal 6): how long problems have waited without anyone acknowledging them.
 * It is about now, so it does not follow the period chosen on the other tab.
 */
export default function ResponseTab() {
  const q = useAsync<AgingReport>(() => api.aging(), [], 30_000);

  return (
    <div className="panel">
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        This is about now, not about a month: it does not follow the period chosen on the other tab.
      </p>
      <h2>Unacknowledged, by age</h2>
      <Async loading={q.loading} error={q.error} data={q.data} updatedAt={q.updatedAt}>
        {(a) => (
          <>
            <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Not acknowledged: {a.unacknowledged} of {count(a.total, 'active problem')}.
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
                          background: i === a.buckets.length - 1 ? 'var(--danger)' : 'var(--mid)',
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
                          <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{dur(p.ageSeconds)}</td>
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
