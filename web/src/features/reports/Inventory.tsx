import { useMemo } from 'react';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useUrlState } from '../../shared/hooks/useUrlState';
import type { DimensionKey, ScorecardResponse } from '../../types';
import { Async, Empty } from '../../shared/components/states';
import { downloadCsv } from '../../shared/lib/csv';
import { dayInZone } from '../../shared/lib/time';
import { NoData } from '../../shared/components/NoData';
import { count } from '../../shared/lib/plural';
import { TableWrap } from '../../shared/components/TableWrap';

/**
 * Inventory & ownership scorecard (HCML Goal 1).
 *
 * HCML's gap: *"host naming, site mapping, owner, criticality and dependency
 * are not standardised → alarms are hard to route to the right PIC."*
 *
 * The portal is read-only and cannot enforce a standard. What it can do is
 * measure one, so the gap stops being invisible and starts being a number the
 * team can move.
 */

const LABELS: Record<DimensionKey, string> = {
  naming: 'Naming',
  site: 'Site',
  owner: 'Owner',
  criticality: 'Criticality',
};

/** `basic` is the hosts missing a name that follows the convention or a site: what can be closed with the tags HCML already has. */
type GapFilter = DimensionKey | 'all' | 'basic';
/** `auto` is the address with no type: the page picks what to open on. */
const GAP_FILTERS: (GapFilter | 'auto')[] = ['auto', 'all', 'basic', 'naming', 'site', 'owner', 'criticality'];

const TAG_DIMENSIONS: DimensionKey[] = ['owner', 'criticality'];

/** Red below a third, amber below three quarters, green above. */
function barColor(pct: number): string {
  if (pct >= 75) return 'var(--good)';
  if (pct >= 33) return 'var(--warn)';
  return 'var(--danger)';
}

/** The same bands as text: the amber fill is 2.16:1 on white, too faint even for the 44 px score. */
function barText(pct: number): string {
  if (pct >= 75) return 'var(--good-text)';
  if (pct >= 33) return 'var(--warn-text)';
  return 'var(--danger-text)';
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="score-bar">
      <span style={{ width: `${pct}%`, background: barColor(pct) }} />
    </div>
  );
}

/** The gap list as CSV rows, so the work can be handed to whoever owns it. */
function gapRows(gaps: ScorecardResponse['gaps']): unknown[][] {
  return [
    ['host', 'site', 'host groups', 'missing'],
    ...gaps.map((g) => [g.name, g.site, g.groups.join(' | '), g.missing.join(' | ')]),
  ];
}

export default function Inventory() {
  const q = useAsync<ScorecardResponse>(() => api.inventory(), [], 120_000);
  // The gap type lives in the URL, so Back and a shared link keep it. One that is not scored reads as the list the page opens on.
  const [asked, setAsked] = useUrlState<GapFilter | 'auto'>('gap', 'auto', { options: GAP_FILTERS });
  const dimensions = q.data?.dimensions ?? [];
  // Owner and criticality come from tags HCML's Zabbix may not carry yet. While nothing is recorded for any host, their gaps are every host
  // and say nothing, so the list opens on the gaps that can be closed now, unless there are none, when it opens on all of them.
  const tags = dimensions.filter((d) => TAG_DIMENSIONS.includes(d.key) && d.scored);
  const emptyTags = tags.filter((d) => d.total > 0 && d.present === 0);
  const canBasic = dimensions.some((d) => d.scored && (d.key === 'naming' || d.key === 'site'));
  const basicGaps = (q.data?.gaps ?? []).filter((g) => g.missing.includes('naming') || g.missing.includes('site')).length;
  const opening: GapFilter = canBasic && basicGaps > 0 && tags.length > 0 && emptyTags.length === tags.length ? 'basic' : 'all';
  const chosen: GapFilter = asked === 'auto' ? opening : asked;
  // A type that is not scored (or not offered) reads as the opening list.
  const filter: GapFilter =
    q.data && chosen !== 'all' && !(chosen === 'basic' ? canBasic : dimensions.some((d) => d.scored && d.key === chosen)) ? opening : chosen;
  // Choosing what the page would open on takes the type out of the address again.
  const setFilter = (value: GapFilter) => setAsked(value === opening ? 'auto' : value);

  const gaps = useMemo(() => {
    const list = q.data?.gaps ?? [];
    if (filter === 'all') return list;
    if (filter === 'basic') return list.filter((g) => g.missing.includes('naming') || g.missing.includes('site'));
    return list.filter((g) => g.missing.includes(filter));
  }, [q.data, filter]);

  // The rows on screen, so a filtered file says so in its name and is not mistaken for the full list.
  const download = () => {
    const shown = filter === 'all' ? '' : `-${filter === 'basic' ? 'naming-site' : filter}`;
    const day = dayInZone(Date.now());
    downloadCsv(`hcml-inventory-gaps${shown}-${day}.csv`, gapRows(gaps));
  };

  return (
    <Async
      loading={q.loading}
      error={q.error}
      data={q.data}
      updatedAt={q.updatedAt}
      loadingLabel="Scoring the estate…"
    >
      {(data) => (
        <>
          <div className="score-hero">
            <div className="score-hero-num" style={{ color: barText(data.overall.pct) }}>
              {data.overall.pct}%
            </div>
            <div>
              <strong>
                {data.overall.complete} of {data.overall.hosts} hosts
              </strong>{' '}
              carry every attribute needed to route an alarm to the right person.
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                The portal is read-only, so it can’t enforce a standard. It measures one. As hosts
                get tagged in Zabbix, this number goes up.
              </div>
            </div>
          </div>

          {emptyTags.length > 0 && (
            <div className="notice" style={{ marginBottom: 12 }}>
              Nothing is recorded yet for {emptyTags.map((d, i) => (i ? d.label.toLowerCase() : d.label)).join(' and ')}: HCML’s Zabbix carries
              no such tags or inventory fields on any host, so the percentage above cannot rise until someone adds them.
            </div>
          )}

          <div className="grid two-col">
            <div className="panel">
              <h2>By attribute</h2>
              {data.dimensions.map((d) => (
                <div key={d.key} className="score-dim">
                  <div className="score-dim-head">
                    <span>{d.label}</span>
                    {d.scored ? (
                      <span className="muted">
                        {d.present}/{d.total} · <strong>{d.pct}%</strong>
                      </span>
                    ) : (
                      <span className="pill">Not scored</span>
                    )}
                  </div>
                  {d.scored && <Bar pct={d.pct} />}
                  <div className="muted score-hint">{d.hint}</div>
                </div>
              ))}
            </div>

            <div className="panel">
              <h2>By host group</h2>
              {data.groups.length ? (
                <TableWrap label="Inventory by host group">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Group</th>
                        <th>Complete</th>
                        <th style={{ width: 120 }}>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.groups.map((g) => (
                        <tr key={g.name}>
                          <td>{g.name}</td>
                          <td className="muted">
                            {g.complete}/{g.hosts}
                          </td>
                          <td>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Bar pct={g.pct} />
                              <span className="muted" style={{ fontSize: 12 }}>
                                {g.pct}%
                              </span>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : (
                <Empty>No host groups.</Empty>
              )}
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head">
              <h2>Gap list: {count(gaps.length, 'host')}</h2>
              <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', minWidth: 0, maxWidth: '100%' }}>
                <select
                  name="gap-type"
                  aria-label="Show gaps of type"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as GapFilter)}
                  style={{ minWidth: 150, maxWidth: '100%' }}
                >
                  <option value="all">All gaps</option>
                  {canBasic && <option value="basic">Missing naming or site</option>}
                  {data.dimensions
                    .filter((d) => d.scored)
                    .map((d) => (
                      <option key={d.key} value={d.key}>
                        Missing {d.label.toLowerCase()}
                      </option>
                    ))}
                </select>
                <button
                  className="btn ghost sm"
                  onClick={download}
                  disabled={!gaps.length}
                >
                  Download CSV
                </button>
              </span>
            </div>

            {asked === 'auto' && filter === 'basic' && (
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Opened on naming and site gaps, because nothing is recorded yet for owner and criticality. Choose All gaps to list every host.
              </div>
            )}

            {gaps.length ? (
              <TableWrap label="Gap list">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Host</th>
                      <th>Site</th>
                      <th>Host groups</th>
                      <th>Missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gaps.map((g) => (
                      <tr key={g.hostid}>
                        <td style={{ fontWeight: 500 }}>{g.name}</td>
                        <td className="muted">{g.site}</td>
                        <td className="muted">{g.groups.join(', ') || <NoData />}</td>
                        <td>
                          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                            {g.missing.map((m) => (
                              <span key={m} className="tag miss">
                                {LABELS[m]}
                              </span>
                            ))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <Empty>Nothing missing.</Empty>
            )}
          </div>
        </>
      )}
    </Async>
  );
}
