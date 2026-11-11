import { useMemo } from 'react';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useUrlState } from '../../shared/hooks/useUrlState';
import type { Link, LinkState, LinksResponse } from '../../types';
import { Async, Empty } from '../../shared/components/states';
import { Field, FieldGroup, FieldSpacer } from '../../shared/components/Field';
import KpiCard from '../../shared/components/KpiCard';
import { NoData, orNoData } from '../../shared/components/NoData';
import { fmtTime } from '../../shared/lib/severity';
import { formatPercent } from '../../shared/lib/units';
import { TableWrap } from '../../shared/components/TableWrap';

/**
 * Link & WAN health (HCML Goal 3).
 *
 * HCML runs 12 main + 10 redundant SD-WAN links, 10 P2P radio links, 18
 * internet accesses and Starlink offshore. Their own topology slide flags
 * *"SD-WAN (to_mda_via_sapudi)(internal4): High packet loss"*: this is the
 * view where that lives, instead of being a row buried in Latest data.
 */

const STATE_LABEL: Record<LinkState, string> = {
  up: 'Up',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'No data',
};

const STATE_COLOR: Record<LinkState, string> = {
  up: 'var(--good)',
  degraded: 'var(--warn)',
  down: 'var(--danger)',
  unknown: 'var(--muted)',
};
/** The same states as text: the fills above are for the dot, and fall below 4.5:1 as words. */
const STATE_TEXT: Record<LinkState, string> = {
  up: 'var(--good-text)',
  degraded: 'var(--warn-text)',
  down: 'var(--danger-text)',
  unknown: 'var(--muted)',
};

/** Table and path order: trouble first, healthy next, "no data" last (neutral, not an alarm). */
const ORDER: Record<LinkState, number> = { down: 0, degraded: 1, up: 2, unknown: 3 };

/** WAN legs are whole `INET :` hosts: their role ("WAN 1 (EXAMPLENET)") names them better than the item. */
const legName = (l: Link) => (/^\s*INET\s*:/i.test(l.host) ? l.role ?? l.host.replace(/^\s*INET\s*:\s*/i, '') : l.label);

function StatePill({ state }: { state: LinkState }) {
  return (
    <span
      className="link-state"
      style={{ ['--s' as string]: STATE_COLOR[state], ['--s-text' as string]: STATE_TEXT[state] }}
    >
      <span className="dot" /> {STATE_LABEL[state]}
    </span>
  );
}

const n = (v: number | undefined, digits: number, suffix: string) =>
  v === undefined ? '—' : `${v.toFixed(digits)}${suffix}`;

function LinkRow({ link, thresholds }: { link: Link; thresholds: LinksResponse['thresholds'] }) {
  const lossBad = link.loss !== undefined && link.loss >= thresholds.lossWarn;
  return (
    <tr>
      <td>
        <StatePill state={link.state} />
      </td>
      <td style={{ fontWeight: 500 }}>{link.label}</td>
      <td className="muted">{link.host}</td>
      <td className="muted mono">{link.target || <NoData />}</td>
      <td className={lossBad ? 'link-bad' : 'muted'}>{orNoData(formatPercent(link.loss, 'loss'))}</td>
      <td className="muted">{orNoData(n(link.latency, 2, ' ms'))}</td>
      <td className="muted">{orNoData(n(link.jitter, 2, ' ms'))}</td>
      <td>
        {link.role ? (
          <span className={`tag ${link.role === 'main' ? 'main' : ''}`}>{link.role}</span>
        ) : (
          <span className="muted"><NoData /></span>
        )}
      </td>
      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
        {orNoData(fmtTime(link.lastclock))}
      </td>
    </tr>
  );
}

type Path = LinksResponse['paths'][number];

/** A path with no data on any leg says nothing about the path: one line for all of them, not a card each. */
const noDataPath = (p: Path) => p.links.length > 0 && p.links.every((l) => l.state === 'unknown');

export default function Links() {
  const q = useAsync<LinksResponse>(() => api.links(), [], 30_000);
  const [problemsOnly, setProblemsOnly] = useUrlState<boolean>('unhealthy', false);
  const [search, setSearch] = useUrlState<string>('q', '', { debounceMs: 400 });

  const filtered = useMemo(() => {
    const list = q.data?.links ?? [];
    const needle = search.trim().toLowerCase();
    return list
      .filter((l) => {
        // "Not healthy" means down or degraded; no data is not a fault of the link.
        if (problemsOnly && (l.state === 'up' || l.state === 'unknown')) return false;
        if (needle && !`${l.label} ${l.host} ${l.target}`.toLowerCase().includes(needle)) return false;
        return true;
      })
      // Stable sort keeps the server's loss/label order inside each state.
      .sort((a, b) => ORDER[a.state] - ORDER[b.state]);
  }, [q.data, search, problemsOnly]);

  return (
    <Async
      loading={q.loading}
      error={q.error}
      data={q.data}
      updatedAt={q.updatedAt}
      loadingLabel="Reading link health…"
    >
      {(data) => {
        if (!data.links.length) {
          return (
            <div className="panel">
              <Empty>
                No ICMP-monitored links found.
                <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                  This page reads <code>icmpping</code> / <code>icmppingloss</code> /{' '}
                  <code>icmppingsec</code> items from monitored hosts. Add ICMP checks in Zabbix and
                  they appear here automatically.
                </div>
              </Empty>
            </div>
          );
        }

        const paths = [...data.paths].sort((a, b) => ORDER[a.state] - ORDER[b.state]);
        const measuredPaths = paths.filter((p) => !noDataPath(p));
        const silentPaths = paths.filter(noDataPath);

        return (
          <>
            <div className="grid kpis sli-kpis">
              {(['down', 'degraded', 'up', 'unknown'] as LinkState[]).map((s) => (
                <KpiCard
                  key={s}
                  label={STATE_LABEL[s]}
                  value={data.summary[s]}
                  sub={`of ${data.summary.total} links`}
                  accent={STATE_COLOR[s]}
                />
              ))}
            </div>

            {data.paths.length > 0 && (
              <div className="panel" style={{ marginBottom: 16 }}>
                <h2>Redundant paths</h2>
                <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                  A paired path is only truly down when <strong>every</strong> leg is. That
                  distinction is the whole point of paying for redundancy. Pairing comes from the
                  item tag <code>link_group</code>, or from the WAN host names
                  (<code>INET : SITE WAN 1</code>, <code>WAN 2</code>…). Grey means no data is being
                  collected, not down.
                </div>
                {measuredPaths.length > 0 && (
                  <div className="path-grid">
                    {measuredPaths.map((p) => (
                      <div key={p.name} className="path-card" style={{ ['--s' as string]: STATE_COLOR[p.state] }}>
                        <div className="path-head">
                          <strong>{p.name}</strong>
                          <StatePill state={p.state} />
                        </div>
                        {p.links.map((l) => (
                          <div key={l.id} className="path-leg">
                            {/* The state in words as well as colour (UX-05). */}
                            <StatePill state={l.state} />
                            {legName(l) === l.label && <span className="muted">{l.role ?? 'leg'}</span>}
                            <span className="path-leg-name" title={l.host}>
                              {legName(l)}
                            </span>
                            {l.state !== 'unknown' && (
                              <span className="muted nowrap">{orNoData(l.loss === undefined ? '—' : `${formatPercent(l.loss, 'loss')} loss`)}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                {silentPaths.length > 0 && (
                  <div className="nodata-paths">
                    <StatePill state="unknown" /> on every leg, {silentPaths.length} path
                    {silentPaths.length === 1 ? '' : 's'}:{' '}
                    {silentPaths.map((p, i) => (
                      <span key={p.name} title={p.links.map(legName).join(' · ')}>
                        {p.name}
                        {i < silentPaths.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="controls">
              <Field label="Search link" htmlFor="links-search">
                <input
                  id="links-search"
                  type="text"
                  placeholder="link, host or target…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </Field>
              <FieldGroup label="Filter">
                <label className="filter-check">
                  <input
                    name="problems-only"
                    type="checkbox"
                    checked={problemsOnly}
                    onChange={(e) => setProblemsOnly(e.target.checked)}
                  />
                  Not healthy only
                </label>
              </FieldGroup>
              <FieldSpacer>
                <span className="pill">
                  loss warn ≥ {data.thresholds.lossWarn}% · down ≥ {data.thresholds.lossCrit}%
                </span>
              </FieldSpacer>
            </div>

            <div className="panel">
              {filtered.length ? (
                <TableWrap label="Links and WAN health">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>State</th>
                        <th>Link</th>
                        <th>Host</th>
                        <th>Target</th>
                        <th>Loss</th>
                        <th>Latency</th>
                        <th>Jitter</th>
                        <th>Role</th>
                        <th>Last check</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((l) => (
                        <LinkRow key={l.id} link={l} thresholds={data.thresholds} />
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : (
                <Empty>No links match the filter.</Empty>
              )}
            </div>
          </>
        );
      }}
    </Async>
  );
}
