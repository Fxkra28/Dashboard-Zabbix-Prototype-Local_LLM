import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useAuth, roleAllows } from '../../shared/hooks/useAuth';
import { useDebounced } from '../../shared/hooks/useDebounced';
import { useUrlState } from '../../shared/hooks/useUrlState';
import type { IcmpState, NetDevice, NetInterface, NetInterfacesResponse } from '../../types';
import RangePicker, { useUrlRange } from '../graphs/RangePicker';
import { UpDown } from '../../shared/components/StatusBadge';
import { Async, Loading } from '../../shared/components/states';
import { Pager } from '../../shared/components/Pager';
import { Field, FieldGroup } from '../../shared/components/Field';
import { formatPercent, formatValue } from '../../shared/lib/units';
import { groupBySite } from '../../shared/lib/sites';
import { NoData, orNoData } from '../../shared/components/NoData';
import { TableWrap } from '../../shared/components/TableWrap';

// The chart module carries ECharts (~550 kB). Load it when a port is opened,
// not with the device grid most visits never get past.
const GraphView = lazy(() => import('../graphs/TimeSeriesChart').then((m) => ({ default: m.GraphView })));

const PORT_PAGE = 50;

const STATUSES = ['', 'up', 'down', 'other'] as const;
type PortStatus = (typeof STATUSES)[number];

/** A disabled host runs no checks (the BFF sends `icmp: null`): say so rather than "no data". */
const deviceState = (d: NetDevice): IcmpState | 'disabled' =>
  d.status === '1'
    ? 'disabled'
    : d.icmp?.state ?? (d.icmp?.up === undefined ? 'unknown' : d.icmp.up ? 'up' : 'down');

const OPER_LABEL: Record<NetInterface['operStatus'], string> = {
  up: 'Up',
  down: 'Down',
  lowerLayerDown: 'Lower layer down',
  notPresent: 'Not present',
  dormant: 'Dormant',
  testing: 'Testing',
  unknown: 'Unknown',
};

function OperPill({ status }: { status: NetInterface['operStatus'] }) {
  const kind = status === 'up' ? 'up' : status === 'down' || status === 'lowerLayerDown' ? 'down' : '';
  const dot = kind === 'up' ? 'var(--good)' : kind === 'down' ? 'var(--danger)' : 'var(--muted)';
  return (
    <span className={`pill ${kind}`}>
      <span className="dot" style={{ background: dot }} /> {OPER_LABEL[status]}
    </span>
  );
}

/** Enter or Space on a focused row/card acts like a click; Space must not also scroll the page. */
const activates = (e: React.KeyboardEvent) => e.key === 'Enter' || e.key === ' ';

export default function Network() {
  const devicesQ = useAsync<NetDevice[]>(() => api.netDevices(), [], 30_000);
  const isAdmin = roleAllows(useAuth().role, 'admin');
  // Device, filters and page live in the URL, so Back from a graph lands on the same view.
  const [hostid, setHostid] = useUrlState<string>('hostid', '');
  const [search, setSearch] = useUrlState<string>('q', '', { debounceMs: 300 });
  const [status, setStatus] = useUrlState<PortStatus>('status', '', { options: STATUSES });
  const [pageParam, setPage] = useUrlState<number>('page', 1);
  const page = Math.max(1, Math.trunc(pageParam));
  const [port, setPort] = useState<NetInterface | null>(null);
  const [range, setRange] = useUrlRange(24);
  const needle = useDebounced(search.trim(), 300);
  const portsPanel = useRef<HTMLDivElement>(null);
  /**
   * Pick a device and bring its interfaces into view: the grid is ~140 cards
   * tall. A different device starts without a port, filters or page, set in
   * the click itself: an effect would also clear the filters a link arrived with.
   */
  const pick = (id: string) => {
    if (id !== hostid) {
      setHostid(id);
      setPort(null);
      setSearch('');
      setStatus('');
      setPage(1);
    }
    requestAnimationFrame(() => portsPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const devices = useMemo(() => devicesQ.data ?? [], [devicesQ.data]);
  const siteGroups = useMemo(() => groupBySite(devices, (d) => d.name, (d) => d.site), [devices]);
  const counts = useMemo(() => {
    const c = { up: 0, down: 0, unknown: 0, disabled: 0 };
    for (const d of devices) c[deviceState(d)]++;
    return c;
  }, [devices]);

  useEffect(() => {
    if (!hostid && siteGroups.length) setHostid(siteGroups[0].items[0].hostid);
  }, [siteGroups, hostid, setHostid]);

  // A new search starts at page 1. Not on load, which would drop the URL's page.
  const lastNeedle = useRef(needle);
  useEffect(() => {
    if (lastNeedle.current === needle) return;
    lastNeedle.current = needle;
    setPage(1);
  }, [needle, setPage]);

  const portsQ = useAsync<NetInterfacesResponse | null>(
    () =>
      hostid
        ? api.netInterfaces({ hostid, search: needle, status, page, pageSize: PORT_PAGE })
        : Promise.resolve(null),
    [hostid, needle, status, page],
    30_000,
  );

  const selectedDevice = devices.find((d) => d.hostid === hostid);
  const portIds = port ? [port.itemids.in, port.itemids.out].filter((x): x is string => !!x) : [];
  const pages = portsQ.data ? Math.max(1, Math.ceil(portsQ.data.total / portsQ.data.pageSize)) : 1;
  // A page past the end (an old address, or a list that shrank at the poll) asks for the last page there is.
  useEffect(() => {
    if (portsQ.data && !portsQ.loading && !portsQ.stale && portsQ.data.total > 0 && page > pages) setPage(pages);
  }, [portsQ.data, portsQ.loading, portsQ.stale, page, pages, setPage]);
  // Rows still on screen from the previous device or filter can't be opened:
  // they would graph the wrong device's port under this one's name.
  const openPort = (r: NetInterface) => {
    if (!portsQ.stale && (r.itemids.in || r.itemids.out)) setPort(r);
  };

  return (
    <>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h2>Network devices</h2>
          {devices.length > 0 && (
            <span className="muted" style={{ fontSize: 12 }}>
              {counts.up} up · {counts.down} down · {counts.unknown} no data
              {counts.disabled > 0 && ` · ${counts.disabled} disabled`}
            </span>
          )}
        </div>
        <Async
          loading={devicesQ.loading}
          error={devicesQ.error}
          data={devicesQ.data}
          updatedAt={devicesQ.updatedAt}
          loadingLabel="Loading devices…"
        >
          {() =>
            devices.length ? (
              siteGroups.map((g) => (
                <div key={g.key} className="device-site">
                  <div className="device-site-label">{g.label}</div>
                  <div className="device-grid">
                    {g.items.map((d) => {
                      const state = deviceState(d);
                      const cls = state === 'disabled' ? 'unknown' : state;
                      return (
                        <div
                          key={d.hostid}
                          role="button"
                          tabIndex={0}
                          aria-pressed={d.hostid === hostid}
                          className={`device ${cls}${d.hostid === hostid ? ' sel' : ''}`}
                          onClick={() => pick(d.hostid)}
                          onKeyDown={(e) => {
                            if (!activates(e)) return;
                            e.preventDefault();
                            pick(d.hostid);
                          }}
                        >
                          <div className="name" title={d.name}>
                            {d.name}
                          </div>
                          {state === 'unknown' || state === 'disabled' ? (
                            <span className="pill">
                              <span className="dot" style={{ background: 'var(--muted)' }} />{' '}
                              {state === 'disabled' ? 'Disabled' : 'No data'}
                            </span>
                          ) : (
                            <UpDown up={state === 'up'} />
                          )}
                          <div className="meta">
                            {d.icmp?.loss !== undefined && <span>loss {orNoData(formatPercent(d.icmp.loss, 'loss'))}</span>}
                            {state === 'up' && d.icmp?.latency !== undefined && (
                              <span>rtt {orNoData(formatValue(d.icmp.latency, 's'))}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="state">
                No network devices found.
                <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                  {/* The setting's name is for the portal admin (UX-20). */}
                  {isAdmin ? (
                    <>
                      Set <span className="mono">NET_GROUP_IDS</span> on the BFF, and onboard devices in
                      Zabbix (setup.md §10). Views populate automatically once they report.
                    </>
                  ) : (
                    <>Ask the portal admin which device groups this page covers. Devices appear here once they report.</>
                  )}
                </div>
              </div>
            )
          }
        </Async>
      </div>

      {selectedDevice && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <div className="panel" ref={portsPanel}>
            <h2>{selectedDevice.name}: interfaces</h2>
            <div className="controls" style={{ marginBottom: 12 }}>
              <Field label="Search" htmlFor="port-search">
                <input
                  id="port-search"
                  type="text"
                  placeholder="name or description…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </Field>
              <FieldGroup label="Status">
                <div className="seg" role="group" aria-label="Status filter">
                  {(
                    [
                      ['', 'All'],
                      ['up', 'Up'],
                      ['down', 'Down'],
                      ['other', 'Other'],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      className={status === v ? 'on' : ''}
                      aria-pressed={status === v}
                      onClick={() => {
                        setStatus(v);
                        setPage(1);
                      }}
                    >
                      {label}
                      {/* Not while stale: those would be the previous device's counts. */}
                      {portsQ.data && !portsQ.stale && v && (
                        <span className="seg-count">{portsQ.data.summary[v]}</span>
                      )}
                    </button>
                  ))}
                </div>
              </FieldGroup>
            </div>
            <Async
              loading={portsQ.loading}
              error={portsQ.error}
              data={portsQ.data}
              stale={portsQ.stale}
              updatedAt={portsQ.updatedAt}
              loadingLabel="Loading interfaces…"
            >
              {(res) =>
                res.rows.length ? (
                  <>
                    <TableWrap label="Interfaces">
                      <table className="data ports">
                        <thead>
                          <tr>
                            <th>Interface</th>
                            <th>Status</th>
                            <th>Speed</th>
                            <th>In</th>
                            <th>Out</th>
                            <th>Util.</th>
                            <th>Errors in/out</th>
                            <th>Discards in/out</th>
                          </tr>
                        </thead>
                        <tbody>
                          {res.rows.map((r) => {
                            const sel = port?.index === r.index;
                            const canGraph = !!(r.itemids.in || r.itemids.out);
                            return (
                              // The interface name is the keyboard path, a real button; the row click only widens the target for a mouse.
                              <tr
                                key={r.index}
                                className={`${canGraph ? 'clickable' : ''}${sel ? ' sel' : ''}`}
                                onClick={() => openPort(r)}
                              >
                                <td>
                                  {canGraph ? (
                                    <button
                                      type="button"
                                      className="port-open"
                                      aria-pressed={sel}
                                      title="Graph this port’s traffic"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openPort(r);
                                      }}
                                    >
                                      {r.name}
                                    </button>
                                  ) : (
                                    <div style={{ fontWeight: 500 }}>{r.name}</div>
                                  )}
                                  {r.alias && <div className="muted port-alias">{r.alias}</div>}
                                </td>
                                <td>
                                  <OperPill status={r.operStatus} />
                                </td>
                                <td className="nowrap">{orNoData(formatValue(r.speed, 'bps'))}</td>
                                <td className="nowrap">{orNoData(formatValue(r.inBps, 'bps'))}</td>
                                <td className="nowrap">{orNoData(formatValue(r.outBps, 'bps'))}</td>
                                <td className="nowrap">
                                  {r.utilisation === null ? <NoData /> : formatPercent(r.utilisation, 'utilisation')}
                                </td>
                                <td className={`nowrap${(r.inErrors ?? 0) + (r.outErrors ?? 0) > 0 ? ' port-bad' : ''}`}>
                                  {orNoData(formatValue(r.inErrors))} / {orNoData(formatValue(r.outErrors))}
                                </td>
                                <td className="nowrap">
                                  {orNoData(formatValue(r.inDiscards))} / {orNoData(formatValue(r.outDiscards))}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </TableWrap>
                    <Pager page={page} pages={pages} onPage={setPage}>
                      {(page - 1) * res.pageSize + 1}–{Math.min(res.total, page * res.pageSize)} of {res.total}
                    </Pager>
                  </>
                ) : res.total > 0 ? (
                  <>
                    <div className="state">There are no interfaces on page {page}.</div>
                    <Pager page={page} pages={pages} onPage={setPage}>
                      {res.total} interfaces
                    </Pager>
                  </>
                ) : (
                  <div className="state">
                    {needle || status ? 'No interfaces match this filter.' : 'No interface (net.if.*) items on this device.'}
                  </div>
                )
              }
            </Async>
          </div>

          {port && (
            <div className="panel">
              <div className="panel-head">
                <h2>
                  Traffic: {port.name}
                  {port.alias && <span className="muted"> ({port.alias})</span>}
                </h2>
                <RangePicker value={range} onChange={setRange} />
              </div>
              <Suspense fallback={<Loading label="Loading graph…" />}>
                <GraphView itemids={portIds} range={range} empty="No traffic data for this port in this range." />
              </Suspense>
            </div>
          )}
        </div>
      )}
    </>
  );
}
