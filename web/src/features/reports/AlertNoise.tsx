import { useId, useMemo } from 'react';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useUrlState } from '../../shared/hooks/useUrlState';
import type { NoiseFlag, NoiseReport, NoisyTrigger } from '../../types';
import { SEVERITIES } from '../../theme';
import { SeverityBadge } from '../../shared/components/StatusBadge';
import { Async, Empty } from '../../shared/components/states';
import { Field } from '../../shared/components/Field';
import KpiCard from '../../shared/components/KpiCard';
import { dur } from '../../shared/lib/units';
import { downloadCsv } from '../../shared/lib/csv';
import { dayInZone } from '../../shared/lib/time';
import { NoData } from '../../shared/components/NoData';
import { count } from '../../shared/lib/plural';
import { TableWrap } from '../../shared/components/TableWrap';

/**
 * Alert noise (HCML Goal 4): *"the main issue is not the number of
 * alarms, but the quality of information needed to act."*
 *
 * Top 100 triggers answers *how often*. This answers *was it worth knowing*:
 * a trigger firing six times and self-clearing in four seconds is noise; one
 * firing twice and staying open for two days is a real fault. Count alone
 * ranks the noisy one higher, which is exactly the trap.
 */

const FLAG_LABEL: Record<NoiseFlag, string> = {
  flapping: 'Flapping',
  unactioned: 'Never acknowledged',
  chronic: 'Chronic',
};

const FLAG_WHY: Record<NoiseFlag, string> = {
  flapping: 'Fires often and clears itself before anyone could act: a threshold worth retuning.',
  unactioned: 'Fires often and has never been acknowledged: the team has learned to ignore it.',
  chronic: 'Still open after more than a day: not noise, but nobody has cleared it.',
};

/** Rows the BFF returns, most alerts first; `total` says how many there were in all. */
const TOPS = [100, 250, 500];
const PERIODS = [1, 7, 30, 90];
const SEVERITY_LEVELS = SEVERITIES.map((s) => s.level);

type Show = NoiseFlag | 'all' | 'flagged';
const SHOWS: Show[] = ['all', 'flagged', 'flapping', 'unactioned', 'chronic'];

function csvRows(rows: NoisyTrigger[]): unknown[][] {
  return [
    ['trigger', 'host', 'severity', 'fired', 'median_seconds', 'short_lived', 'ack_rate', 'flags'],
    ...rows.map((t) => [
      t.name,
      t.host,
      SEVERITIES[Number(t.severity)]?.name ?? t.severity,
      t.count,
      t.medianDuration,
      t.shortLived,
      `${Math.round(t.ackRate * 100)}%`,
      t.flags.join(' | '),
    ]),
  ];
}

export default function AlertNoise() {
  const fieldId = useId();
  // All four filters live in the URL, so Back and a shared link keep them. A value not in its list reads as the default.
  const [days, setDays] = useUrlState<number>('days', 7, { options: PERIODS });
  const [severity, setSeverity] = useUrlState<number>('severity', 0, { options: SEVERITY_LEVELS });
  const [flag, setFlag] = useUrlState<Show>('show', 'all', { options: SHOWS });
  const [top, setTop] = useUrlState<number>('top', TOPS[0], { options: TOPS });
  const q = useAsync<NoiseReport>(() => api.noise(days, severity, top), [days, severity, top]);

  const rows = useMemo(() => {
    const list = q.data?.triggers ?? [];
    if (flag === 'all') return list;
    if (flag === 'flagged') return list.filter((t) => t.flags.length > 0);
    return list.filter((t) => t.flags.includes(flag));
  }, [q.data, flag]);

  // The rows on screen, so a filtered file says so in its name and is not mistaken for the full list.
  const download = () => {
    const shown = flag === 'all' ? '' : `-${flag}`;
    const day = dayInZone(Date.now());
    downloadCsv(`hcml-alert-noise-${days}d${shown}-${day}.csv`, csvRows(rows));
  };

  return (
    <>
      <div className="controls">
        <Field label="Period" htmlFor={`${fieldId}-period`}>
          <select id={`${fieldId}-period`} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </Field>
        <Field label="Counts problems of at least" htmlFor={`${fieldId}-severity`}>
          <select id={`${fieldId}-severity`} value={severity} onChange={(e) => setSeverity(Number(e.target.value))}>
            {SEVERITIES.map((s) => (
              <option key={s.level} value={s.level}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Show" htmlFor={`${fieldId}-show`}>
          <select
            id={`${fieldId}-show`}
            value={flag}
            onChange={(e) => setFlag(e.target.value as Show)}
          >
            <option value="all">All triggers</option>
            <option value="flagged">Flagged only</option>
            <option value="flapping">Flapping</option>
            <option value="unactioned">Never acknowledged</option>
            <option value="chronic">Chronic</option>
          </select>
        </Field>
        <Field label="Rows" htmlFor="noise-top">
          <select id="noise-top" value={top} onChange={(e) => setTop(Number(e.target.value))}>
            {TOPS.map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </select>
        </Field>
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
          if (!data.totalEvents) {
            return (
              <div className="panel">
                <Empty>No problem events in this period.</Empty>
              </div>
            );
          }

          return (
            <>
              <div className="grid kpis">
                <KpiCard
                  label="Alerts raised"
                  value={data.totalEvents}
                  sub={`over ${dur(data.windowSeconds)}`}
                />
                <KpiCard
                  label="Distinct triggers"
                  value={data.distinctTriggers}
                  sub="produced them"
                />
                <KpiCard
                  label="Flapping"
                  value={data.counts.flapping}
                  sub={`clear within ${dur(data.thresholds.shortSeconds)}`}
                  accent={data.counts.flapping ? 'var(--danger)' : undefined}
                />
                <KpiCard
                  label="Never acknowledged"
                  value={data.counts.unactioned}
                  sub={`${data.thresholds.minCount}+ firings, no response`}
                  accent={data.counts.unactioned ? 'var(--warn)' : undefined}
                />
              </div>

              {/* The Pareto line: HCML's own sentence, quantified. */}
              <div className="notice">
                <strong>
                  {data.concentration.topN} trigger
                  {data.concentration.topN === 1 ? '' : 's'} produced{' '}
                  {data.concentration.percentOfEvents}% of all alerts
                </strong>{' '}
                in this period. Retuning the few at the top of this table is worth more than
                triaging the rest.
              </div>

              {data.truncated && (
                <div className="notice warn">
                  This window filled a full page of events, so these counts are a{' '}
                  <strong>floor</strong>. Choose a shorter period for exact figures.
                </div>
              )}

              <div className="panel">
                <div className="panel-head">
                  <h2>
                    {count(rows.length, 'trigger')}
                    {data.total !== undefined && data.total > data.triggers.length && (
                      <span className="muted noise-top">
                        {' '}
                        · top {data.triggers.length} of {data.total} by alerts raised
                      </span>
                    )}
                  </h2>
                  <button className="btn ghost sm" onClick={download} disabled={!rows.length}>
                    Download CSV
                  </button>
                </div>

                {rows.length ? (
                  <TableWrap label="Triggers by alerts raised">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Severity</th>
                          <th>Trigger</th>
                          <th>Host</th>
                          <th>Fired</th>
                          <th>Median</th>
                          <th>Short-lived</th>
                          <th>Acknowledged</th>
                          <th>Assessment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((t) => (
                          <tr key={t.objectid}>
                            <td>
                              <SeverityBadge level={t.severity} />
                            </td>
                            <td>{t.name}</td>
                            <td className="muted">{t.host || <NoData />}</td>
                            <td style={{ fontWeight: 600 }}>{t.count}</td>
                            <td className="muted">{dur(t.medianDuration)}</td>
                            <td className="muted">
                              {t.shortLived}/{t.count}
                            </td>
                            <td className={t.ackRate === 0 ? 'link-bad' : 'muted'}>
                              {Math.round(t.ackRate * 100)}%
                            </td>
                            <td>
                              {t.flags.length ? (
                                <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                                  {t.flags.map((f) => (
                                    <span key={f} className={`tag flag-${f}`} title={FLAG_WHY[f]}>
                                      {FLAG_LABEL[f]}
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                <span className="muted"><NoData /></span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                ) : (
                  <Empty>No triggers match this filter.</Empty>
                )}

                <div className="muted noise-legend">
                  {(Object.keys(FLAG_LABEL) as NoiseFlag[]).map((f) => (
                    <div key={f}>
                      <span className={`tag flag-${f}`}>{FLAG_LABEL[f]}</span> {FLAG_WHY[f]}
                    </div>
                  ))}
                </div>
              </div>
            </>
          );
        }}
      </Async>
    </>
  );
}
