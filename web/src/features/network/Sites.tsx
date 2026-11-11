import { useMemo } from 'react';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useUrlState } from '../../shared/hooks/useUrlState';
import type { Site, SitesResponse } from '../../types';
import { SEVERITIES } from '../../theme';
import { SeverityCounts } from '../../shared/components/StatusBadge';
import { Async, Empty } from '../../shared/components/states';
import { Field, FieldGroup, FieldSpacer } from '../../shared/components/Field';
import { HostTable } from '../hosts/HostTable';
import { count } from '../../shared/lib/plural';

/**
 * Site view (HCML Goal 5). HCML's estate is organised by
 * site, but the dashboard only ever showed one flat host list. This is the
 * board management actually reads: worst site first.
 */

/** Hosts down: by ping-first state when the BFF sends it, else by interface flags. */
const downCount = (site: Site) => site.down ?? site.unavailable;

/** A site is only "healthy" when nothing is firing and nothing is unreachable. */
function siteColor(site: Site): string {
  if (site.worst >= 0) return SEVERITIES[site.worst]?.color ?? 'var(--danger)';
  if (downCount(site) > 0) return 'var(--danger)';
  return 'var(--good)';
}

function SiteCard({
  site,
  selected,
  onSelect,
}: {
  site: Site;
  selected: boolean;
  onSelect: () => void;
}) {
  const color = siteColor(site);
  const down = downCount(site);
  const clear = site.worst < 0 && down === 0;
  const hasStates = site.down !== undefined;
  const noData = hasStates ? (site.nodata ?? 0) : site.unknown;

  return (
    <button
      className={`site-card${selected ? ' sel' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
      style={{ ['--site-color' as string]: color }}
    >
      <div className="site-card-head">
        <span className="site-name">{site.name}</span>
        <span className="site-hosts">{count(site.total, 'host')}</span>
      </div>

      <div className="site-stat">
        {clear ? (
          <span className="site-ok">All clear</span>
        ) : (
          <>
            <span className="site-big">{site.problems}</span>
            <span className="site-big-label">
              {site.problems === 1 ? 'problem' : 'problems'}
              {site.unacknowledged > 0 && (
                <em> · {site.unacknowledged} unack</em>
              )}
            </span>
          </>
        )}
      </div>

      <div className="site-foot">
        {site.problems > 0 ? (
          <SeverityCounts bySeverity={site.bySeverity} />
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            No active problems
          </span>
        )}
        <span className="site-avail">
          {down > 0 && <span className="down">{down} down</span>}
          {(site.degraded ?? 0) > 0 && (
            <span className="degraded" title="Answer ping, but SNMP polling or the Zabbix agent is silent">
              {site.degraded} degraded
              <span className="sr-only">: they answer ping, but SNMP polling or the Zabbix agent is silent</span>
            </span>
          )}
          {noData > 0 && (
            <span className="muted">
              {noData} {hasStates ? 'no data' : 'unknown'}
            </span>
          )}
          {site.maintenance > 0 && <span className="muted">{site.maintenance} maint.</span>}
        </span>
      </div>
    </button>
  );
}

function SiteHosts({ site }: { site: Site }) {
  return (
    <div className="panel">
      <h2>{site.name}: hosts</h2>
      <HostTable hosts={site.hosts} siteFrom />
    </div>
  );
}

/**
 * How many hosts carry a deliberate site marker. HCML's Goal 1 names site
 * mapping as unstandardised: this turns that into a number they can move.
 */
function Coverage({ coverage }: { coverage: SitesResponse['coverage'] }) {
  const byName = coverage.name ?? 0;
  const explicit = coverage.tag + byName + coverage.inventory;
  if (!coverage.hosts) return null;
  const pct = Math.round((explicit / coverage.hosts) * 100);

  return (
    <div className="site-coverage">
      <strong>{pct}%</strong> of hosts ({explicit} of {coverage.hosts}) have a known site: a{' '}
      <code>site</code> tag ({coverage.tag}), the site code in the host name ({byName}) or an
      inventory location ({coverage.inventory}). The remaining {coverage.group} are grouped by host
      group, which is a guess.
    </div>
  );
}

export default function Sites() {
  const q = useAsync<SitesResponse>(() => api.sites(), [], 30_000);
  // Search, filter and the open site live in the URL, so Back from a graph reopens the same site.
  const [search, setSearch] = useUrlState<string>('q', '', { debounceMs: 400 });
  const [problemsOnly, setProblemsOnly] = useUrlState<boolean>('attention', false);
  const [selected, setSelected] = useUrlState<string>('site', '');

  const filtered = useMemo(() => {
    const list = q.data?.sites ?? [];
    const needle = search.trim().toLowerCase();
    return list.filter((s) => {
      if (problemsOnly && s.problems === 0 && downCount(s) === 0) return false;
      if (needle && !s.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [q.data, search, problemsOnly]);

  return (
    <>
      <div className="controls">
        <Field label="Search site" htmlFor="sites-search">
          <input
            id="sites-search"
            type="text"
            placeholder="site name…"
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
            Needing attention only
          </label>
        </FieldGroup>
        <FieldSpacer>
          {q.data && <span className="pill">{count(filtered.length, 'site')}</span>}
        </FieldSpacer>
      </div>

      <Async
        loading={q.loading}
        error={q.error}
        data={q.data}
        updatedAt={q.updatedAt}
        loadingLabel="Rolling hosts up to sites…"
      >
        {(data) => {
          if (!filtered.length) {
            return (
              <div className="panel">
                <Empty>No sites match the filter.</Empty>
              </div>
            );
          }

          const current = filtered.find((s) => s.name === selected) ?? null;

          return (
            <>
              <Coverage coverage={data.coverage} />

              <div className="site-grid">
                {filtered.map((s) => (
                  <SiteCard
                    key={s.name}
                    site={s}
                    selected={s.name === current?.name}
                    onSelect={() => setSelected(s.name === current?.name ? '' : s.name)}
                  />
                ))}
              </div>

              {current ? (
                <SiteHosts site={current} />
              ) : (
                <div className="muted" style={{ textAlign: 'center', fontSize: 13, padding: 8 }}>
                  Select a site to see its hosts.
                </div>
              )}
            </>
          );
        }}
      </Async>
    </>
  );
}
