import { useId } from 'react';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useUrlState } from '../../shared/hooks/useUrlState';
import type { TopTriggersReport } from '../../types';
import { SeverityBadge } from '../../shared/components/StatusBadge';
import { Async } from '../../shared/components/states';
import { Field } from '../../shared/components/Field';
import { NoData } from '../../shared/components/NoData';
import { TableWrap } from '../../shared/components/TableWrap';

const RANGES = [
  { days: 1, label: 'Last day' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];
const DAYS = RANGES.map((r) => r.days);

// Reports → Top 100 triggers: which triggers fired most in the window.
export default function TopTriggers() {
  const rangeId = useId();
  // The time range lives in the URL, so a shared link opens the same window. A value not in the list reads as 7 days.
  const [days, setDays] = useUrlState<number>('days', 7, { options: DAYS });
  const q = useAsync<TopTriggersReport>(() => api.topTriggers(days), [days]);

  return (
    <>
      <div className="controls">
        <Field label="Time range" htmlFor={rangeId}>
          <select id={rangeId} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {RANGES.map((r) => (
              <option key={r.days} value={r.days}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="panel">
        <h2>Top 100 triggers by number of problems</h2>
        <Async
          loading={q.loading}
          error={q.error}
          data={q.data}
          stale={q.stale}
          updatedAt={q.updatedAt}
          loadingLabel="Aggregating events…"
        >
          {(data) =>
            data.triggers.length ? (
              <>
                {data.truncated && (
                  <div className="notice warn">
                    This window filled a full page of events, so these counts are a{' '}
                    <strong>floor</strong>. Choose a shorter period for exact figures.
                  </div>
                )}
                <TableWrap label="Top triggers">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th>Severity</th>
                      <th>Host</th>
                      <th>Trigger</th>
                      <th style={{ textAlign: 'right' }}>Problems</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.triggers.map((t, i) => (
                      <tr key={t.objectid}>
                        <td className="muted">{i + 1}</td>
                        <td>
                          <SeverityBadge level={t.severity} />
                        </td>
                        <td className="muted">{t.host || <NoData />}</td>
                        <td>{t.name}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{t.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </TableWrap>
              </>
            ) : (
              <div className="state">No problem events in this window.</div>
            )
          }
        </Async>
      </div>
    </>
  );
}
