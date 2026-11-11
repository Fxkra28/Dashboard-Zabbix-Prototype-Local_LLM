import { Link } from 'react-router-dom';
import type { Problem } from '../../types';
import { SeverityBadge } from '../../shared/components/StatusBadge';
import { AckPill } from './AckPill';
import { ago } from '../../shared/lib/severity';
import { NoData } from '../../shared/components/NoData';
import type { ChangeMark } from './useChangeHighlight';
import { TableWrap } from '../../shared/components/TableWrap';

/** `marks` flags rows that just appeared or cleared (the wall screen's highlight, useChangeHighlight). */
export default function ProblemsTable({
  problems,
  marks,
}: {
  problems: Problem[];
  marks?: ReadonlyMap<string, ChangeMark>;
}) {
  if (!problems.length) return <div className="state">No open problems.</div>;

  return (
    <TableWrap label="Open problems">
      <table className="data">
        <thead>
          <tr>
            <th>Severity</th>
            <th>Problem</th>
            <th>Host</th>
            <th>Age</th>
            <th>Ack</th>
          </tr>
        </thead>
        <tbody>
          {problems.map((p) => {
            const mark = marks?.get(p.eventid);
            return (
              <tr key={p.eventid} className={mark ? `row-${mark}` : undefined}>
                <td>
                  <SeverityBadge level={p.severity} />
                </td>
                <td>
                  {/* Said in words, not only by the tint, which a screen reader and a colour-blind eye both miss. */}
                  {mark === 'new' && <span className="pill fresh">New</span>}
                  {mark === 'cleared' && <span className="pill up">Cleared</span>}
                  {mark && ' '}
                  {/* The Problems page marks this row, and can open Explain or Acknowledge on it. */}
                  <Link to={`/problems?eventid=${encodeURIComponent(p.eventid)}`}>{p.name}</Link>
                </td>
                <td className="muted">
                  {p.hostid ? <Link to={`/graphs?hostid=${p.hostid}`}>{p.host || 'Unknown host'}</Link> : p.host || <NoData />}
                </td>
                <td className="muted">{ago(p.clock)}</td>
                <td>
                  <AckPill acknowledged={p.acknowledged} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}
