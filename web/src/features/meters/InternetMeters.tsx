import { useId } from 'react';
import { useNow } from '../../shared/hooks/useNow';
import type { MetersQuery } from './useMeters';
import { summaryWords } from './gaugeDial';
import { wallSlice } from '../../shared/lib/wall';
import { Async } from '../../shared/components/states';
import Gauge from './Gauge';
import { formatClockLabeled } from '../../shared/lib/time';
import { useReportTimeZone } from '../../shared/hooks/useReportTimeZone';

/**
 * The internet traffic meters: one gauge per gauge widget of the Zabbix dashboard HCML keeps (INTERNET_METERS_DASHBOARD). Wall screens, operators and admins only.
 * `q` is the Dashboard's one request (useMeters.ts); on a wall `page` says which slice this slide holds, and the sentence over the grid counts them all.
 */
export default function InternetMeters({ q, page }: { q: MetersQuery; page?: { index: number; pages: number } }) {
  const headingId = useId();
  // Only for the words that say how old an old reading is.
  const now = useNow(30_000);
  useReportTimeZone();

  return (
    <section className="panel meters" aria-labelledby={headingId}>
      <div className="meters-head">
        <h2 id={headingId}>Internet traffic</h2>
        {q.data?.found && q.data.meters.length > 0 && <p className="muted meters-summary">{summaryWords(q.data.summary)}</p>}
        {page && page.pages > 1 && (
          <span className="muted meters-page">
            Page {page.index + 1} of {page.pages}
          </span>
        )}
        {q.updatedAt !== null && <span className="muted meters-updated">Updated {formatClockLabeled(q.updatedAt, true)}</span>}
      </div>
      <Async loading={q.loading} error={q.error} data={q.data} updatedAt={q.updatedAt} loadingLabel="Loading the meters…">
        {(d) =>
          !d.found ? (
            <div className="state">
              Zabbix has no dashboard named “{d.dashboard}” that the portal can read. Set INTERNET_METERS_DASHBOARD to the
              name of the one that holds the gauges.
            </div>
          ) : d.meters.length === 0 ? (
            <div className="state">The dashboard “{d.dashboard}” has no gauge widgets.</div>
          ) : (
            <ul className="meters-grid">
              {(page ? wallSlice(d.meters, page.index, page.pages) : d.meters).map((m) => (
                <li key={m.id}>
                  <Gauge meter={m} now={now} />
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </section>
  );
}
