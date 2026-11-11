import { useId } from 'react';
import { Link } from 'react-router-dom';
import type { HostsViewQuery } from './useHostsView';
import type { DevicesResponse, TopHostsMetric, WebMonitoringResponse } from '../../types';
import { BUSY, HOT, NO_WEB_WORDS, WALL_FAILURES, WALL_TOP_ROWS, WEB_SUB, availability, emptyTopWords, failureWords, percentUp, usageWords } from './hostsFigures';
import { tally, trouble } from '../hosts/deviceTally';
import KpiCard from '../../shared/components/KpiCard';
import { Async } from '../../shared/components/states';
import { formatClockLabeled } from '../../shared/lib/time';
import { useReportTimeZone } from '../../shared/hooks/useReportTimeZone';

const TOP_TITLE = { cpu: 'Top hosts by CPU', memory: 'Top hosts by memory' } as const;

/** Whether the hosts answer, how many of each kind of device there are, and which are busiest: what HCML's own Zabbix home shows besides the meters. */
function Counts({ data, wall }: { data: DevicesResponse; wall: boolean }) {
  const kindsId = useId();
  const a = availability(data.devices);
  const pct = percentUp(a);
  return (
    <>
      <div className="grid kpis">
        <KpiCard label="Monitored hosts" value={a.total} sub={a.maintenance > 0 ? `${a.maintenance} in maintenance` : 'enabled in Zabbix'} />
        <KpiCard label="Up" value={a.up} sub={pct === null ? undefined : `${pct}% of the monitored hosts`} accent="var(--good)" />
        <KpiCard label="Degraded" value={a.degraded} sub="answer ping, not SNMP or the agent" accent="var(--warn)" />
        <KpiCard label="Down" value={a.down} sub="no ping answer, or marked unavailable" accent="var(--danger)" />
        <KpiCard label="No data" value={a.nodata} sub="no recent ping or interface data" accent="var(--muted)" />
      </div>
      <section className="panel kinds-panel" aria-labelledby={kindsId}>
        <h2 id={kindsId}>Devices by kind</h2>
        <ul className="kind-tiles">
          {data.classes.map((c) => {
            const t = tally(data.devices.filter((d) => d.class === c.key));
            const body = (
              <>
                <span className="kind-name">{c.label}</span> <span className="kind-count">{t.total}</span>{' '}
                <span className="kind-sub">{t.total === 0 ? 'none' : trouble(t)}</span>
              </>
            );
            // A wall has no one to click it, and a kind with no device has nowhere to go.
            return (
              <li key={c.key}>
                {wall || t.total === 0 ? (
                  <div className={`kind-tile${t.total === 0 ? ' empty' : ''}`}>{body}</div>
                ) : (
                  <Link className="kind-tile" to={`/devices?type=${c.key}`}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

/** The web scenarios that pass, fail or have no current result, and which ones fail: Zabbix's "Web monitoring" widget. */
function WebPanel({ w, wall }: { w: WebMonitoringResponse; wall: boolean }) {
  const id = useId();
  const listed = wall ? w.failures.slice(0, WALL_FAILURES) : w.failures;
  const tile = (key: 'ok' | 'failed' | 'unknown', name: string) => (
    <li key={key}>
      <div className={`kind-tile${key === 'failed' && w.failed > 0 ? ' alert' : ''}`}>
        <span className="kind-name">{name}</span> <span className="kind-count">{w[key]}</span> <span className="kind-sub">{WEB_SUB[key]}</span>
      </div>
    </li>
  );
  return (
    <section className="panel web-panel" aria-labelledby={id}>
      <h2 id={id}>Web monitoring</h2>
      {w.total === 0 ? (
        <p className="muted">{NO_WEB_WORDS}</p>
      ) : (
        <>
          <ul className="kind-tiles">
            {tile('ok', 'OK')}
            {tile('failed', 'Failed')}
            {tile('unknown', 'Unknown')}
          </ul>
          {listed.length > 0 && (
            <ul className="web-failures">
              {listed.map((f) => (
                <li key={f.itemid} className="web-failure">
                  <span>
                    {wall ? f.host : <Link to={`/graphs?hostid=${f.hostid}&itemid=${f.itemid}`}>{f.host}</Link>} · {f.name}
                  </span>
                  <span className="muted">
                    {failureWords(f)}, {formatClockLabeled(f.clock * 1000, true)}
                  </span>
                </li>
              ))}
              {w.failed > listed.length && <li className="muted">and {w.failed - listed.length} more</li>}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function TopList({ m, wall }: { m: TopHostsMetric; wall: boolean }) {
  const id = useId();
  const rows = wall ? m.rows.slice(0, WALL_TOP_ROWS) : m.rows;
  return (
    <section className="panel" aria-labelledby={id}>
      <h2 id={id}>{TOP_TITLE[m.key]}</h2>
      {m.rows.length === 0 ? (
        <p className="muted">{emptyTopWords(m)}</p>
      ) : (
        <ol className="top-list">
          {rows.map((r) => (
            <li key={r.hostid} className="top-row">
              <span className="top-host">{wall ? r.host : <Link to={`/graphs?hostid=${r.hostid}&itemid=${r.itemid}`}>{r.host}</Link>}</span>
              <span className="top-value">{usageWords(r.value)}</span>
              <span className="top-bar" aria-hidden="true">
                <span className={`top-fill${r.value >= HOT ? ' hot' : r.value >= BUSY ? ' busy' : ''}`} style={{ width: `${Math.min(100, Math.max(0, r.value))}%` }} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The Dashboard's Hosts view. `q` is the Dashboard's three requests (useHostsView.ts); a wall shows no links. */
export default function HostsView({ q, wall }: { q: HostsViewQuery; wall: boolean }) {
  useReportTimeZone();
  return (
    <>
      {q.devices.updatedAt !== null && <p className="muted view-updated">Updated {formatClockLabeled(q.devices.updatedAt, true)}</p>}
      <Async loading={q.devices.loading} error={q.devices.error} data={q.devices.data} updatedAt={q.devices.updatedAt} loadingLabel="Loading the hosts…">
        {(d) => <Counts data={d} wall={wall} />}
      </Async>
      <Async loading={q.web.loading} error={q.web.error} data={q.web.data} updatedAt={q.web.updatedAt} loadingLabel="Loading web monitoring…">
        {(w) => <WebPanel w={w} wall={wall} />}
      </Async>
      <Async loading={q.top.loading} error={q.top.error} data={q.top.data} updatedAt={q.top.updatedAt} loadingLabel="Loading the busiest hosts…">
        {(t) => (
          <div className="grid two-col">
            {t.metrics.map((m) => (
              <TopList key={m.key} m={m} wall={wall} />
            ))}
          </div>
        )}
      </Async>
    </>
  );
}
