import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useOutletContext } from 'react-router-dom';
import { api, streamUrl } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useNow } from '../../shared/hooks/useNow';
import { STREAM_SILENT_MS, useSSE } from '../../shared/hooks/useSSE';
import { useSearchPatch, useUrlState } from '../../shared/hooks/useUrlState';
import { useMeters } from '../meters/useMeters';
import { useHostsView } from './useHostsView';
import { useFitHeight } from './useFitHeight';
import { useWallRotation } from './useWallRotation';
import { roleAllows, useAuth } from '../../shared/hooks/useAuth';
import { useChangeHighlight, useReducedMotion } from '../problems/useChangeHighlight';
import type { Problem, Stats, Freshness, GroupProblems } from '../../types';
import { SEVERITIES } from '../../theme';
import KpiCard from '../../shared/components/KpiCard';
import ProblemsTable from '../problems/ProblemsTable';
import BrandMark from '../../shared/components/BrandMark';
import { SeverityCounts } from '../../shared/components/StatusBadge';
import InternetMeters from '../meters/InternetMeters';
import HostsView from './HostsView';
import { Tabs, tabButtonId, tabsPanelId } from './Tabs';
import { Async, RefreshFailed } from '../../shared/components/states';
import { CollectorNotice, reachLost } from '../../shared/components/CollectorNotice';
import type { LayoutContext } from '../shell/Layout';
import { LIVE_ROWS, liveRows, topRows } from './liveList';
import { internetCard, rotateSeconds, slidesOf, wallPages, type Slide } from '../../shared/lib/wall';
import { ageWords, momentWords } from '../../shared/lib/freshness';
import { formatClock, formatClockLabeled, formatWeekdayDate, zoneLabel } from '../../shared/lib/time';
import { useReportTimeZone } from '../../shared/hooks/useReportTimeZone';
import { problemListGuard } from '../../guards';
import { TableWrap } from '../../shared/components/TableWrap';

/**
 * The problem list also holds problems Zabbix resolved a moment ago and ones
 * inside a planned maintenance window (the Problems page marks both). The
 * Dashboard counts and lists the rest, as every server-side count does.
 */
const isOpen = (p: Problem) => (!p.r_eventid || p.r_eventid === '0') && p.suppressed !== '1';

/** Past this the numbers on screen are old enough that a wall screen must say so. */
const DATA_LATE_MS = 90_000;

/** The clock with its zone's name smaller beside it, for the big digits of a wall. */
function WallDigits({ at }: { at: number }) {
  return (
    <>
      {formatClock(at, true)}
      <span className="wall-zone"> {zoneLabel(at)}</span>
    </>
  );
}

/** The wall's clock, in the report zone. Its own component, so only it re-renders every second. */
function WallClock() {
  const now = useNow(1_000);
  useReportTimeZone();
  return (
    <div className="wall-stamp">
      <span className="wall-label">{formatWeekdayDate(now)}</span>
      <time className="wall-time" dateTime={new Date(now).toISOString()}>
        <WallDigits at={now} />
      </time>
    </div>
  );
}

/** The wall screen's header: the page, the time now, and how old the data is (DESIGN.md section 9). */
function WallBar({
  shownAt,
  lateMinutes,
  idleFor,
  cutOff,
  onExit,
  rotation,
}: {
  shownAt: number | null;
  lateMinutes: number | null;
  /** How long Zabbix has collected nothing, in words, or null while it is collecting. */
  idleFor: string | null;
  /** Zabbix collects, but almost no device answers its ping. */
  cutOff: boolean;
  onExit: () => void;
  /** The control for the turning slides, or null where nothing turns. */
  rotation: { running: boolean; onToggle: () => void } | null;
}) {
  return (
    <header className="wall-bar">
      <div className="wall-title">
        <BrandMark variant="icon" alt="HCML" />
        <h1>Dashboard</h1>
      </div>
      <WallClock />
      <div className={`wall-stamp${lateMinutes !== null || idleFor !== null || cutOff ? ' late' : ''}`}>
        <span className="wall-label">Data as of</span>
        <span className="wall-time">{shownAt !== null ? <WallDigits at={shownAt} /> : '…'}</span>
        {lateMinutes !== null && <span className="wall-label">No new data for {lateMinutes} min</span>}
        {idleFor !== null && <span className="wall-label">Zabbix collected nothing for {idleFor}</span>}
        {cutOff && <span className="wall-label">Zabbix cannot reach the network</span>}
      </div>
      {rotation && (
        <button type="button" className="btn ghost sm" onClick={rotation.onToggle}>
          {rotation.running ? 'Pause rotation' : 'Resume rotation'}
        </button>
      )}
      <button type="button" className="btn ghost sm" onClick={onExit}>
        Exit wall mode
      </button>
    </header>
  );
}

/** The Dashboard's views, like the pages of a Zabbix dashboard: the problems, the hosts, and the internet traffic meters (wall screens, operators and admins). */
const VIEWS = ['overview', 'hosts', 'internet'] as const;
const VIEW_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'hosts', label: 'Hosts' },
  { key: 'internet', label: 'Internet traffic' },
] as const;

export default function Overview() {
  const { wall, exitWall } = useOutletContext<LayoutContext>();
  // The meters are interface data, which is for a wall screen, an operator and an admin; a viewer has the Overview and the Hosts.
  const { role } = useAuth();
  const canSeeMeters = role !== null && roleAllows(role, 'wall');
  const [view, setView] = useUrlState<(typeof VIEWS)[number]>('view', 'overview', { options: VIEWS });
  const viewsId = useId();

  // One request serves the card and the meters view, and a wall that turns to them finds them loaded.
  const metersQ = useMeters(canSeeMeters);
  const hostsQ = useHostsView();

  // A wall has no one to click it, so it turns by itself through the views, `rotate=` seconds each (30 by default).
  // An address that names a view holds it, and a click on a tab or on Pause stops the turning until Resume.
  const { search } = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const allowed = useMemo(() => VIEWS.filter((v) => v !== 'internet' || canSeeMeters), [canSeeMeters]);
  const named = allowed.find((v) => v === params.get('view')) ?? null;
  const seconds = rotateSeconds(params.get('rotate'));
  const pages = wallPages(metersQ.data?.meters.length ?? 0);
  const slides = useMemo(() => slidesOf({ views: named ? [named] : allowed, pages }), [named, allowed, pages]);
  const [paused, setPaused] = useState(false);
  // A wall entered again starts turning, whatever was paused the last time.
  useEffect(() => setPaused(false), [wall]);
  const rotation = useWallRotation(slides, wall ? seconds : 0, paused);
  const patchUrl = useSearchPatch();
  const shown: Slide = wall
    ? rotation.slide
    : view === 'hosts'
      ? { view: 'hosts' }
      : canSeeMeters && view === 'internet'
        ? { view: 'internet', page: 0 }
        : { view: 'overview' };
  const choose = (v: (typeof VIEWS)[number]) => {
    if (!wall) return setView(v);
    // Named even for the Overview, which the address would otherwise leave out as the default.
    patchUrl({ view: v });
    setPaused(true);
  };
  const turningControl =
    wall && seconds > 0 && (paused || named === null)
      ? {
          running: rotation.running,
          onToggle: () => {
            if (rotation.running) return setPaused(true);
            setPaused(false);
            patchUrl({ view: null });
          },
        }
      : null;
  const card = internetCard(metersQ.data);
  const reduceMotion = useReducedMotion();
  const now = useNow(5_000);
  const statsQ = useAsync<Stats>(() => api.stats(), [], 30_000);
  const groupsQ = useAsync<GroupProblems[]>(() => api.problemsByGroup(), [], 15_000);
  const freshQ = useAsync<Freshness>(() => api.freshness(), [], 60_000);

  // Live problems over SSE. The poll is a safety net for a dropped stream, not a second source of
  // truth: at 10 s it would duplicate every SSE tick, so it runs slowly and only while the stream
  // has given us nothing. A stream that stays open but goes silent counts as dropped (useSSE's
  // watchdog).
  const live = useSSE<Problem[]>(streamUrl(), 'problems', STREAM_SILENT_MS, problemListGuard);
  // Trust the stream only while it is connected. Keying on `live.data` alone
  // stopped the poll for good after the first frame, so a stream that later
  // failed left a frozen list on screen with nothing refreshing it.
  const streaming = Boolean(live.data) && live.connected;
  // Toggling the interval never fetches by itself (useAsync), so the stream
  // connecting no longer costs a second full problem list.
  const pollQ = useAsync<Problem[]>(() => api.problems(), [], streaming ? undefined : 60_000);
  // Falling off the stream fetches at once rather than a full interval later.
  const wasStreaming = useRef(streaming);
  const { reload } = pollQ;
  useEffect(() => {
    if (wasStreaming.current && !streaming) reload();
    wasStreaming.current = streaming;
  }, [streaming, reload]);
  // Off the stream, show whichever source is newer: the poll's list from page
  // load must not replace the stream's last frame.
  const fromStream = streaming || (live.updatedAt ?? 0) > (pollQ.updatedAt ?? 0);
  const current = fromStream ? live.data : pollQ.data;
  const open = useMemo(() => (current ? current.filter(isOpen) : null), [current]);
  // Inside a maintenance window: not counted, and not "cleared" when it goes in.
  const held = useMemo(
    () => new Set((current ?? []).filter((p) => p.suppressed === '1' && (!p.r_eventid || p.r_eventid === '0')).map((p) => p.eventid)),
    [current],
  );
  const problems = open ?? [];
  // How old the numbers on screen are, whichever source they came from.
  const shownAt = fromStream ? live.updatedAt : pollQ.updatedAt;
  const late = shownAt !== null && now - shownAt > DATA_LATE_MS;
  const lateMinutes = late && shownAt !== null ? Math.floor((now - shownAt) / 60_000) || 1 : null;
  // Zabbix itself stopped collecting: the stream stays up and keeps sending, all of it old.
  // The age counts on from the last poll's value, so the words stay right between polls.
  const collectedAt = freshQ.data?.stale ? freshQ.data.lastCollectedAt : null;
  const idleFor = collectedAt !== null ? ageWords(now / 1000 - collectedAt) : null;
  const cutOff = reachLost(freshQ.data);

  // The wall's highlight, off for anyone who has asked for less motion.
  const { marks, cleared } = useChangeHighlight(open, held, wall && !reduceMotion, topRows);
  const rows = useMemo(() => (open ? liveRows(open, cleared) : []), [open, cleared]);

  const stats = statsQ.data;
  const bySev = (lvl: number) => problems.filter((p) => Number(p.severity) === lvl).length;
  const high = problems.filter((p) => Number(p.severity) >= 4).length;
  /** A count once the list is in, a placeholder before, never a zero that only means "not loaded". */
  const count = (n: number) => (current ? n : '…');

  // A wall cannot be scrolled: draw all of it at the scale that fits the screen, measured again when the lists change.
  const { wrap: fitWrap, inner: fitInner } = useFitHeight<HTMLDivElement, HTMLDivElement>(wall, [
    wall,
    shown.view,
    shown.view === 'internet' ? shown.page : 0,
    metersQ.data,
    hostsQ.devices.data,
    hostsQ.top.data,
    hostsQ.web.data,
    statsQ.data,
    groupsQ.data,
    current,
    now,
  ]);

  return (
    <>
      <div ref={fitWrap}>
        <div ref={fitInner}>
          {wall && (
            <WallBar shownAt={shownAt} lateMinutes={lateMinutes} idleFor={idleFor} cutOff={cutOff} onExit={exitWall} rotation={turningControl} />
          )}
          <Tabs
            id={viewsId}
            label="Dashboard view"
            tabs={VIEW_TABS.filter((t) => allowed.includes(t.key))}
            value={shown.view}
            onChange={choose}
            className="dash-tabs"
          />
          <div role="tabpanel" id={tabsPanelId(viewsId)} aria-labelledby={tabButtonId(viewsId, shown.view)}>
            {shown.view === 'internet' ? (
              <InternetMeters q={metersQ} page={wall ? { index: shown.page, pages } : undefined} />
            ) : shown.view === 'hosts' ? (
              <HostsView q={hostsQ} wall={wall} />
            ) : (
              <>
                  {/* System information (Zabbix "System information" report) */}
                  {statsQ.error &&
                    (statsQ.data ? (
                      <RefreshFailed error={statsQ.error} updatedAt={statsQ.updatedAt} />
                    ) : (
                      <div className="refresh-failed" role="status" title={statsQ.error}>
                        Couldn’t load the counts: {statsQ.error}
                      </div>
                    ))}
                  <CollectorNotice freshness={freshQ.data} now={now} />
                  <div className="grid kpis">
                    <KpiCard label="Hosts" value={stats?.hosts ?? '…'} sub="monitored" />
                    <KpiCard label="Items" value={stats?.items ?? '…'} sub={stats && stats.items === null ? 'counting' : 'collecting'} />
                    <KpiCard label="Triggers" value={stats?.triggers ?? '…'} sub={stats && stats.triggers === null ? 'counting' : undefined} />
                    <KpiCard label="Host groups" value={stats?.groups ?? '…'} />
                  </div>

                  {/* Problem KPIs */}
                  <div className="grid kpis">
                    <KpiCard label="Open problems" value={count(problems.length)} />
                    <KpiCard
                      label="High / Disaster"
                      value={count(high)}
                      accent={SEVERITIES[5].color}
                      sub="severity ≥ High"
                    />
                    <KpiCard
                      label="Warnings"
                      value={count(bySev(2) + bySev(3))}
                      accent={SEVERITIES[3].color}
                      sub="Warning + Average"
                    />
                    <KpiCard
                      label="Unacknowledged"
                      value={count(problems.filter((p) => p.acknowledged !== '1').length)}
                      accent={SEVERITIES[4].color}
                    />
                    {/* Interface data is for a wall screen, an operator and an admin, so a viewer's row has no fifth card. */}
                    {canSeeMeters && (
                      <KpiCard
                        label="Internet links"
                        value={metersQ.data ? (card.value ?? '—') : metersQ.error ? '—' : '…'}
                        sub={metersQ.data ? card.sub : metersQ.error ? 'Could not be read' : undefined}
                        accent={card.tone === 'critical' ? SEVERITIES[5].color : card.tone === 'warn' ? SEVERITIES[3].color : undefined}
                      />
                    )}
                  </div>

                  <div className="grid two-col">
                    <div className="panel">
                      <div className="panel-head">
                        <h2>Live problems</h2>
                        <span className="live-status">
                          {shownAt !== null && <span className="live-age">Updated {formatClockLabeled(shownAt, true)}</span>}
                          {/* Announced on a change of state only; the visible label's minute count would be read out every minute. */}
                          <span className="sr-only" aria-live="polite">
                            {late && shownAt !== null
                              ? `No new data since ${formatClockLabeled(shownAt, true)}`
                              : collectedAt !== null
                                ? `Zabbix has collected nothing since ${momentWords(collectedAt * 1000, now)}`
                                : cutOff
                                  ? 'Zabbix cannot reach the network'
                                  : streaming
                                  ? 'Live'
                                  : live.error
                                    ? 'Polling: live stream error'
                                    : 'Polling'}
                          </span>
                          <span
                            className={`live${late || idleFor !== null || cutOff ? ' late' : streaming ? '' : ' off'}`}
                            title={live.error ?? pollQ.error ?? undefined}
                            aria-hidden="true"
                          >
                            <span className="dot" />
                            {lateMinutes !== null
                              ? `No new data for ${lateMinutes} min`
                              : idleFor !== null
                                ? `Zabbix has collected nothing for ${idleFor}`
                                : cutOff
                                  ? 'Zabbix cannot reach the network'
                                  : streaming
                                  ? 'Live'
                                  : live.error
                                    ? 'Polling: live stream error'
                                    : 'Polling'}
                          </span>
                        </span>
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <Async
                          loading={pollQ.loading && !live.data}
                          error={streaming ? null : pollQ.error}
                          data={current}
                          updatedAt={shownAt}
                        >
                          {() => (
                            <>
                              <ProblemsTable problems={rows} marks={marks} />
                              {problems.length > 0 && (
                                <p className="panel-foot">
                                  {Math.min(LIVE_ROWS, problems.length)} of {problems.length} open problems, worst first.
                                  {/* A wall has no one to click it. */}
                                  {!wall && (
                                    <>
                                      {' '}
                                      <Link to="/problems">View all problems</Link>
                                    </>
                                  )}
                                </p>
                              )}
                            </>
                          )}
                        </Async>
                      </div>
                    </div>

                    <div className="panel">
                      <h2>Problems by host group</h2>
                      <Async
                        loading={groupsQ.loading}
                        error={groupsQ.error}
                        data={groupsQ.data}
                        updatedAt={groupsQ.updatedAt}
                      >
                        {(groups) =>
                          groups.length ? (
                            <TableWrap label="Open problems by host group">
                              <table className="data">
                                <thead>
                                  <tr>
                                    <th>Host group</th>
                                    <th>Severities</th>
                                    <th style={{ textAlign: 'right' }}>Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {groups.map((g) => (
                                    <tr key={g.groupid}>
                                      <td>{g.name}</td>
                                      <td>
                                        <SeverityCounts bySeverity={g.bySeverity} />
                                      </td>
                                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{g.total}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </TableWrap>
                          ) : (
                            <div className="state">No problems across any host group.</div>
                          )
                        }
                      </Async>

                      <h2 style={{ marginTop: 20 }}>Problems by severity</h2>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {SEVERITIES.slice()
                          .reverse()
                          .map((s) => (
                            <div key={s.level} className="sev-tile">
                              <span className="dot" style={{ background: s.color }} />
                              <span style={{ fontSize: 'var(--t-base)' }}>{s.name}</span>
                              <strong>{count(bySev(s.level))}</strong>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>

              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
