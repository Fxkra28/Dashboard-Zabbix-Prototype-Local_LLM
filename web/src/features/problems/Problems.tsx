import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, streamUrl } from '../../api';
import { problemListGuard } from '../../guards';
import { useAsync } from '../../shared/hooks/useAsync';
import { STREAM_SILENT_MS, useSSE } from '../../shared/hooks/useSSE';
import { useCapabilities } from '../assistant/useAi';
import { useAuth, roleAllows } from '../../shared/hooks/useAuth';
import { useUrlState } from '../../shared/hooks/useUrlState';
import type { Freshness, Problem } from '../../types';
import { SEVERITIES } from '../../theme';
import { SeverityBadge } from '../../shared/components/StatusBadge';
import { Async } from '../../shared/components/states';
import { CollectorNotice } from '../../shared/components/CollectorNotice';
import { AckPill } from './AckPill';
import { changeKey } from './liveChange';
import { Field, FieldSpacer } from '../../shared/components/Field';
import { ProblemExplainPanel } from '../assistant/ExplainPanel';
import AckDialog from './AckDialog';
import { fmtTime, duration } from '../../shared/lib/severity';
import { NoData, orNoData } from '../../shared/components/NoData';
import { TableWrap } from '../../shared/components/TableWrap';

/** Rows rendered at first, and added per "Show more": the list can run to thousands. */
const ROWS = 100;

const ACK_FILTERS = ['all', 'unack', 'ack'] as const;
const ACTIONS = ['', 'explain', 'ack'] as const;

/**
 * Zabbix applies an acknowledge or a close a moment after it answers, and the portal's own cache
 * holds the old state for up to 15 s (actions.ts WRITE_HOLD_MS). A change that has not shown by
 * then is no longer "waiting": the row goes back to offering Ack rather than saying so for ever.
 */
const WAIT_FOR_ZABBIX_MS = 60_000;
/** While a change is awaited the list is read this often, instead of every 30 s. */
const POLL_WAITING_MS = 3_000;

/** What was asked of Zabbix for one problem, so the row can say so until the list shows it. */
type Sent = {
  acknowledge: boolean;
  close: boolean;
  /** The minute is over and a close is still not on the list: say so, rather than let it look done. */
  late?: boolean;
};

const isResolved = (p: Problem) => Boolean(p.r_eventid && p.r_eventid !== '0');

/** The tags after the fourth, as the table prints the first four: "tag5: v5, tag6". */
const moreTags = (tags: { tag: string; value: string }[]) =>
  tags
    .slice(4)
    .map((t) => `${t.tag}${t.value ? `: ${t.value}` : ''}`)
    .join(', ');
/** The refreshed list shows everything that was asked. */
const applied = (p: Problem, sent: Sent) =>
  (!sent.acknowledge || p.acknowledged === '1') && (!sent.close || isResolved(p));

export default function Problems() {
  // What was sent to Zabbix and is not yet on screen, by event id.
  const [sent, setSent] = useState<Record<string, Sent>>({});
  // Every 30 s, and at once when the live stream says the list changed (below). Quicker while a change is awaited,
  // so the row stops saying "waiting" soon after Zabbix applies it.
  const q = useAsync<Problem[]>(() => api.problems(), [], Object.values(sent).some((s) => !s.late) ? POLL_WAITING_MS : 30_000);
  // The stream's frames leave out what this page also shows (tags, the live value), so they only say that something changed: a problem
  // opened, resolved, acknowledged or re-graded. The full list is then read at once, and the poll above stays as the fallback.
  const live = useSSE<Problem[]>(streamUrl(), 'problems', STREAM_SILENT_MS, problemListGuard);
  // A collector cut off from the network raises a problem for every device it can no longer ping.
  const freshQ = useAsync<Freshness>(() => api.freshness(), [], 60_000);
  const seen = useRef<string | null>(null);
  const { reload } = q;
  useEffect(() => {
    if (!live.data) return;
    const key = changeKey(live.data);
    const before = seen.current;
    seen.current = key;
    if (before !== null && before !== key) reload();
  }, [live.data, reload]);
  const [minSev, setMinSev] = useUrlState<number>('severity', 0, { options: [0, 1, 2, 3, 4, 5] });
  const [search, setSearch] = useUrlState<string>('q', '', { debounceMs: 400 });
  const [ackFilter, setAckFilter] = useUrlState<(typeof ACK_FILTERS)[number]>('ack', 'all', {
    options: ACK_FILTERS,
  });
  // How many rows to render, for the filters it was raised under; new filters start over.
  const filterKey = `${minSev}|${search}|${ackFilter}`;
  const [shown, setShown] = useState({ filterKey, rows: ROWS });
  const rows = shown.filterKey === filterKey ? shown.rows : ROWS;
  // A link to one problem (the Dashboard's rows, a shared URL): ?eventid=…, and with &action=explain or
  // &action=ack the panel for it opens too.
  const [eventid] = useUrlState<string>('eventid', '');
  const [action, setAction] = useUrlState<(typeof ACTIONS)[number]>('action', '', { options: ACTIONS });
  const caps = useCapabilities();
  const { role } = useAuth();
  const [explaining, setExplaining] = useState<Problem | null>(null);
  const [acking, setAcking] = useState<Problem | null>(null);

  // Both must hold: a write token on the BFF, and operator role or above.
  // The BFF enforces this too: the UI just doesn't offer what would 403.
  const canAck = caps.writeBack && roleAllows(role, 'operator');
  // An operator who has acknowledged from here before should be told, not left to find the button gone.
  // Not before the server has said (a briefly false writeBack is "unknown", not "off").
  const ackIsOff = caps.known && !caps.writeBack && roleAllows(role, 'operator');

  const filtered = useMemo(() => {
    const list = q.data ?? [];
    const needle = search.trim().toLowerCase();
    return list.filter((p) => {
      if (Number(p.severity) < minSev) return false;
      if (ackFilter === 'ack' && p.acknowledged !== '1') return false;
      if (ackFilter === 'unack' && p.acknowledged === '1') return false;
      if (needle && !`${p.name} ${p.host ?? ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [q.data, minSev, search, ackFilter]);
  // Zabbix keeps a resolved problem in the list for five minutes, so the count says how many are still open.
  const justResolved = filtered.filter(isResolved).length;

  const resolved = isResolved;
  const waiting = (p: Problem) => {
    const asked = sent[p.eventid];
    return asked !== undefined && !asked.late && !applied(p, asked);
  };
  // A close the list still shows open after the minute. Zabbix may never apply it (no server process
  // running, a trigger that refuses), so it stays on the row until the problem shows resolved.
  const closeNotApplied = (p: Problem) => {
    const asked = sent[p.eventid];
    return asked?.late === true && asked.close && !isResolved(p);
  };

  // Forget what the list now shows, so polling slows down again and Ack comes back where it is due.
  useEffect(() => {
    setSent((prev) => {
      const ids = Object.keys(prev);
      const left = ids.filter((id) => {
        const p = q.data?.find((x) => x.eventid === id);
        return p !== undefined && !applied(p, prev[id]);
      });
      return left.length === ids.length ? prev : Object.fromEntries(left.map((id) => [id, prev[id]]));
    });
  }, [q.data]);

  // The timer that gives up waiting, one per problem; cleared with the page.
  const giveUp = useRef(new Map<string, number>());
  useEffect(() => {
    const timers = giveUp.current;
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);
  const onSent = (p: Problem, what: Sent) => {
    // Only a change the list can show is awaited: a message on its own leaves nothing to wait for.
    const asked = { acknowledge: what.acknowledge && p.acknowledged !== '1', close: what.close };
    if (asked.acknowledge || asked.close) {
      setSent((prev) => ({ ...prev, [p.eventid]: asked }));
      // A new send starts a new minute: the earlier send's timer must not end this wait early.
      window.clearTimeout(giveUp.current.get(p.eventid));
      giveUp.current.set(
        p.eventid,
        window.setTimeout(() => {
          giveUp.current.delete(p.eventid);
          setSent((prev) => {
            const entry = prev[p.eventid];
            // A close not applied stays, marked late; an acknowledgement is dropped, as before.
            if (entry?.close) return { ...prev, [p.eventid]: { ...entry, late: true } };
            return Object.fromEntries(Object.entries(prev).filter(([id]) => id !== p.eventid));
          });
        }, WAIT_FOR_ZABBIX_MS),
      );
    }
    q.reload();
  };

  // The problem a link points at, and the row to mark and bring into view.
  const target = eventid ? (q.data ?? []).find((p) => p.eventid === eventid) : undefined;
  const targetIndex = eventid ? filtered.findIndex((p) => p.eventid === eventid) : -1;
  const targetRow = useRef<HTMLTableRowElement>(null);
  const scrolledTo = useRef('');
  useEffect(() => {
    if (!eventid || targetIndex < 0 || scrolledTo.current === eventid) return;
    scrolledTo.current = eventid;
    targetRow.current?.scrollIntoView?.({ block: 'center' });
  }, [eventid, targetIndex]);

  // &action=: open the panel once the list, the role and the server's answer are in. Whether it may
  // open is judged then, so an early look at "no write-back yet" cannot throw the request away.
  const opened = useRef('');
  useEffect(() => {
    if (!action) opened.current = '';
    if (!action || !target || !caps.known || role === null) return;
    if (opened.current === `${eventid}|${action}`) return;
    opened.current = `${eventid}|${action}`;
    if (action === 'explain' && caps.ai) setExplaining(target);
    if (action === 'ack' && canAck && !isResolved(target)) setAcking(target);
    setAction('');
  }, [action, target, eventid, caps.known, caps.ai, canAck, role, setAction]);

  const shownRows = Math.max(rows, targetIndex + 1);

  return (
    <>
      <div className="controls">
        <Field label="Search" htmlFor="problems-search">
          <input
            id="problems-search"
            type="text"
            placeholder="problem or host…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <Field label="Min severity" htmlFor="problems-severity">
          <select id="problems-severity" value={minSev} onChange={(e) => setMinSev(Number(e.target.value))}>
            {SEVERITIES.map((s) => (
              <option key={s.level} value={s.level}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Acknowledged" htmlFor="problems-ack">
          <select
            id="problems-ack"
            value={ackFilter}
            onChange={(e) => setAckFilter(e.target.value as (typeof ACK_FILTERS)[number])}
          >
            <option value="all">All</option>
            <option value="unack">Unacknowledged</option>
            <option value="ack">Acknowledged</option>
          </select>
        </Field>
        <FieldSpacer>
          {/* Before the list is in, "0 matching" would say there are no problems. */}
          {q.data && (
            <span className="pill">
              {filtered.length} matching
              {justResolved > 0 && `: ${filtered.length - justResolved} open, ${justResolved} just resolved`}
            </span>
          )}
        </FieldSpacer>
        {ackIsOff && (
          <FieldSpacer>
            <span className="muted">Acknowledge is off on this portal. Ask the portal admin to turn it on.</span>
          </FieldSpacer>
        )}
      </div>

      {/* Said once for a screen reader; the rows say it to the eye. */}
      <div className="sr-only" role="status">
        {Object.values(sent).some((s) => !s.late)
          ? 'Sent to Zabbix. Waiting for it to apply the change.'
          : Object.keys(sent).length
            ? 'Close requested, not yet applied by Zabbix.'
            : ''}
      </div>

      <CollectorNotice freshness={freshQ.data} />
      {eventid && q.data && !target && (
        <div className="notice" role="status">
          That problem is no longer in the list. It may have cleared.
        </div>
      )}
      {eventid && target && targetIndex < 0 && (
        <div className="notice" role="status">
          That problem is hidden by the filters above.
        </div>
      )}

      <div className="panel">
        <Async loading={q.loading} error={q.error} data={q.data} updatedAt={q.updatedAt}>
          {() =>
            filtered.length ? (
              <>
                <TableWrap label="Open problems">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Severity</th>
                        <th>Status</th>
                        <th>Host</th>
                        <th>Problem</th>
                        <th>Duration</th>
                        <th>Ack</th>
                        <th>Tags</th>
                        {(caps.ai || canAck) && <th className="sticky-end"><span className="sr-only">Actions</span></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, shownRows).map((p) => (
                        <tr
                          key={p.eventid}
                          ref={p.eventid === eventid ? targetRow : undefined}
                          className={p.eventid === eventid ? 'sel' : undefined}
                          aria-current={p.eventid === eventid ? 'true' : undefined}
                        >
                          <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                            {orNoData(fmtTime(p.clock))}
                          </td>
                          <td>
                            <SeverityBadge level={p.severity} />
                          </td>
                          <td>
                            {resolved(p) ? (
                              <span className="pill up">Resolved</span>
                            ) : p.suppressed === '1' ? (
                              <span className="pill maintenance" title="Raised during a planned maintenance window; left out of every count">
                                In maintenance
                              </span>
                            ) : (
                              <span className="pill down">Problem</span>
                            )}
                          </td>
                          <td className="muted">
                            {p.hostid ? (
                              <Link to={`/graphs?hostid=${p.hostid}`}>{p.host || 'Unknown host'}</Link>
                            ) : (
                              p.host || <NoData />
                            )}
                          </td>
                          <td>
                            {p.eventid === eventid && <span className="sr-only">Linked problem: </span>}
                            {p.name}
                          </td>
                          <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                            {duration(p.clock, p.r_clock)}
                          </td>
                          <td>
                            <AckPill acknowledged={p.acknowledged} />
                          </td>
                          <td>
                            <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
                              {(p.tags ?? []).slice(0, 4).map((t, i) => (
                                <span key={i} className="tag">
                                  {t.tag}
                                  {t.value ? `: ${t.value}` : ''}
                                </span>
                              ))}
                              {(p.tags ?? []).length > 4 && (
                                <span className="tag tag-more" title={moreTags(p.tags ?? [])}>
                                  +{(p.tags ?? []).length - 4} more
                                  <span className="sr-only">: {moreTags(p.tags ?? [])}</span>
                                </span>
                              )}
                            </span>
                          </td>
                          {(caps.ai || canAck) && (
                            <td className="sticky-end">
                              <span style={{ display: 'inline-flex', gap: 6 }}>
                                {caps.ai && (
                                  <button
                                    className="btn ghost sm"
                                    onClick={() => setExplaining(p)}
                                    title="Translate this alert and its tags into plain language"
                                  >
                                    Explain
                                  </button>
                                )}
                                {canAck && !resolved(p) && !waiting(p) && (
                                  <button
                                    className="btn ghost sm"
                                    onClick={() => setAcking(p)}
                                    title="Acknowledge or close this problem in Zabbix"
                                  >
                                    Ack
                                  </button>
                                )}
                                {waiting(p) && <span className="muted">Sent, waiting for Zabbix</span>}
                                {closeNotApplied(p) && (
                                  <span className="muted">Close requested, not yet applied by Zabbix</span>
                                )}
                              </span>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
                {filtered.length > shownRows && (
                  <div className="show-more">
                    <span className="muted">
                      Showing {shownRows} of {filtered.length}
                    </span>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setShown({ filterKey, rows: shownRows + ROWS })}
                    >
                      Show {Math.min(ROWS, filtered.length - shownRows)} more
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="state">No problems match the filter.</div>
            )
          }
        </Async>
      </div>

      {explaining && (
        <ProblemExplainPanel problem={explaining} onClose={() => setExplaining(null)} />
      )}

      {acking && (
        <AckDialog
          problem={acking}
          onClose={() => setAcking(null)}
          onDone={(what) => onSent(acking, what)}
        />
      )}
    </>
  );
}
