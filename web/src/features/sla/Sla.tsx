import { useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useAiEnabled } from '../assistant/useAi';
import { useUrlState } from '../../shared/hooks/useUrlState';
import type { Sla, SlaSli, SlaSource, SliGroup, SliHost, SliPath, SliProfile, SliReport } from '../../types';
import { Async, Empty, StaleCopy } from '../../shared/components/states';
import { FieldSpacer } from '../../shared/components/Field';
import { SlaExplainPanel, type DerivedSlaScope } from '../assistant/ExplainPanel';
import KpiCard from '../../shared/components/KpiCard';
import { NoData } from '../../shared/components/NoData';
import EmailReport from './EmailReport';
import ReportDownload from './ReportDownload';
import {
  CoverageText,
  DERIVED_BANNER,
  GapsNote,
  METHOD_LABEL,
  METHOD_NOTE,
  MethodToggle,
  MonthSelect,
  NoDataPill,
  SliPill,
  fmtDur,
  fmtPct,
  lastClosedMonth,
} from './Sli';
import { staleCopyOf, staleWhen } from '../../shared/lib/freshness';
import { naturalCompare } from '../../shared/lib/sites';
import { recentMonths } from '../../shared/lib/time';
import { useReportTimeZone } from '../../shared/hooks/useReportTimeZone';
import { PERCENT_DP, dur } from '../../shared/lib/units';
import { count } from '../../shared/lib/plural';
import { TableWrap } from '../../shared/components/TableWrap';

/**
 * Services → SLA, read-only.
 *
 * Two sources. When Zabbix has services attached to an SLA, its own SLA
 * engine is shown ("Zabbix SLAs"). HCML's Zabbix has none, so the default is
 * the monthly SLA the portal derives from the ICMP availability triggers every
 * device already carries: nothing is written to Zabbix.
 */

const PERIODS: Record<string, string> = {
  '0': 'Daily',
  '1': 'Weekly',
  '2': 'Monthly',
  '3': 'Quarterly',
  '4': 'Annually',
};

// Zabbix SLAs (Zabbix's own SLA engine)

function SliTable({ sla, rows }: { sla: Sla; rows: SlaSli[] }) {
  const target = Number(sla.slo);
  return (
    <TableWrap label={`Service levels of ${sla.name}`}>
      <table className="data">
        <thead>
          <tr>
            <th>Service</th>
            <th>Achieved</th>
            <th>Target</th>
            <th>Uptime</th>
            <th>Downtime</th>
            <th>Error budget left</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.serviceid}>
              <td>{r.name}</td>
              <td>
                <SliPill sli={r.sli} target={target} />
              </td>
              <td className="muted">{target}%</td>
              <td className="muted">{dur(r.uptime)}</td>
              <td className="muted">{dur(r.downtime)}</td>
              <td className={r.error_budget < 0 ? 'sla-over' : 'muted'}>{dur(r.error_budget)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function SlaDetail({ sla, aiEnabled }: { sla: Sla; aiEnabled: boolean }) {
  const q = useAsync<SlaSli[]>(() => api.slaSli(sla.slaid), [sla.slaid], 60_000);
  const [explaining, setExplaining] = useState(false);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{sla.name}</h2>
        {aiEnabled && (
          <button
            className="btn ghost sm"
            onClick={() => setExplaining(true)}
            title="Explain this SLA without the acronyms"
          >
            Plain language
          </button>
        )}
      </div>

      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        {PERIODS[sla.period] ?? 'Period'} · target {sla.slo}%
        {sla.timezone ? ` · ${sla.timezone}` : ''}
        {sla.status === '0' ? ' · disabled' : ''}
      </div>

      <Async
        loading={q.loading}
        error={q.error}
        data={q.data}
        stale={q.stale}
        updatedAt={q.updatedAt}
        loadingLabel="Reading SLA…"
      >
        {(rows) =>
          rows.length ? (
            <SliTable sla={sla} rows={rows} />
          ) : (
            <Empty>No services are attached to this SLA yet.</Empty>
          )
        }
      </Async>

      {explaining && <SlaExplainPanel sla={sla} onClose={() => setExplaining(false)} />}
    </div>
  );
}

function ZabbixSlas() {
  const q = useAsync<Sla[]>(() => api.sla(), [], 60_000);
  const [selected, setSelected] = useState<string | null>(null);
  const aiEnabled = useAiEnabled();

  return (
    <Async
      loading={q.loading}
      error={q.error}
      data={q.data}
      updatedAt={q.updatedAt}
      loadingLabel="Loading SLAs…"
    >
      {(slas) => {
        if (!slas.length) {
          return (
            <div className="panel">
              <Empty>
                No SLAs are defined in Zabbix yet.
                <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                  Create them under <strong>Services → SLA</strong> in Zabbix; this page reads them.
                </div>
              </Empty>
            </div>
          );
        }

        const current = slas.find((s) => s.slaid === selected) ?? slas[0];

        return (
          <div className="grid two-col sli-grid">
            <div>
              <SlaDetail sla={current} aiEnabled={aiEnabled} />
            </div>

            <div className="panel">
              <h2>SLAs</h2>
              <div className="sla-list">
                {slas.map((s) => (
                  <button
                    key={s.slaid}
                    className={`sla-item${s.slaid === current.slaid ? ' sel' : ''}`}
                    aria-pressed={s.slaid === current.slaid}
                    onClick={() => setSelected(s.slaid)}
                  >
                    <span className="name">{s.name}</span>
                    <span className="muted">
                      {PERIODS[s.period] ?? <NoData />} · {s.slo}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      }}
    </Async>
  );
}

// Derived monthly SLA (portal-computed)

type ExplainFn = (scope: string, name: string) => void;

function GroupTable({
  title,
  groups,
  target,
  first,
  aiEnabled,
  onExplain,
}: {
  title: string;
  groups: SliGroup[];
  target: number;
  first: string;
  aiEnabled: boolean;
  onExplain: ExplainFn;
}) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      <TableWrap label={title}>
        <table className="data compact">
          <thead>
            <tr>
              <th>{first}</th>
              <th>Availability</th>
              <th>Devices</th>
              <th>Below target</th>
              <th title="Every device's downtime in the group, added up. Devices down at the same time count separately">
                Downtime (sum)
              </th>
              {aiEnabled && <th className="sticky-end"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key}>
                <td style={{ fontWeight: 500 }}>{g.name}</td>
                <td>
                  <SliPill sli={g.sli} target={target} />
                </td>
                <td className="muted nowrap" title="Devices with data / devices">
                  <span aria-hidden="true">{g.withData} / {g.hosts}</span>
                  <span className="sr-only">{g.withData} of {g.hosts} devices have data</span>
                </td>
                <td className={g.belowTarget ? 'sla-over' : 'muted'}>{g.belowTarget}</td>
                <td className="muted nowrap">
                  {g.sli === null ? (
                    <NoData />
                  ) : (
                    <>
                      {fmtDur(g.downtime)}
                      {g.withData > 1 && g.downtime > 0 && (
                        <span className="sli-sub">avg {fmtDur(g.downtime / g.withData)} per device</span>
                      )}
                    </>
                  )}
                </td>
                {aiEnabled && (
                  <td className="sticky-end">
                    <button
                      className="btn ghost sm"
                      onClick={() =>
                        onExplain(g.key.startsWith('site:') ? g.key : `category:${g.key}`, g.name)
                      }
                    >
                      Explain
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}

type SortKey = 'name' | 'site' | 'category' | 'sli' | 'downtime' | 'coverage';

const SORT_KEYS: SortKey[] = ['name', 'site', 'category', 'sli', 'downtime', 'coverage'];
/** URL form of the device sort: `sli` ascending, `-sli` descending. */
const SORTS = SORT_KEYS.flatMap((k) => [k, `-${k}`]);

function DeviceTable({ report }: { report: SliReport }) {
  const [sortParam, setSortParam] = useUrlState<string>('sort', 'sli', { options: SORTS });
  const sort = { key: sortParam.replace(/^-/, '') as SortKey, dir: sortParam.startsWith('-') ? -1 : 1 };
  const [search, setSearch] = useUrlState<string>('device', '', { debounceMs: 400 });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = report.hosts.filter(
      (h) =>
        !needle ||
        `${h.name} ${h.site?.name ?? ''} ${h.category}`.toLowerCase().includes(needle),
    );
    const val = (h: SliHost): string | number => {
      switch (sort.key) {
        case 'name':
          return h.name;
        case 'site':
          return h.site ? h.site.code : 99;
        case 'category':
          return h.category;
        case 'sli':
          return h.sli ?? 0;
        case 'downtime':
          return h.downtime;
        case 'coverage':
          return h.coverage;
      }
    };
    return list.sort((a, b) => {
      // No-data rows never mix in with measured ones, always at the bottom.
      const na = a.sli === null ? 1 : 0;
      const nb = b.sli === null ? 1 : 0;
      if (na !== nb) return na - nb;
      const va = val(a);
      const vb = val(b);
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : naturalCompare(String(va), String(vb));
      return c * sort.dir || naturalCompare(a.name, b.name);
    });
  }, [report, sort.key, sort.dir, search]);

  const head = (key: SortKey, label: string) => {
    const on = sort.key === key;
    return (
      <th aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
        <button
          type="button"
          className={`th-sort${on ? ' on' : ''}`}
          onClick={() => setSortParam(on && sort.dir === 1 ? `-${key}` : key)}
        >
          {label}
          {on ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
        </button>
      </th>
    );
  };

  const noData = report.hosts.filter((h) => h.sli === null).length;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>By device</h2>
        <input
          name="device-filter"
          type="text"
          className="sli-search"
          placeholder="Filter devices…"
          aria-label="Filter devices"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        {count(report.hosts.length, 'device')}{noData ? ` · ${noData} without data are listed last` : ''}. * = measured
        on partial data.
      </div>
      <TableWrap label="Availability of each device" className="sli-scroll">
        <table className="data compact">
          <thead>
            <tr>
              {head('name', 'Device')}
              {head('site', 'Site')}
              {head('category', 'Category')}
              {head('sli', 'Availability')}
              {head('downtime', 'Downtime')}
              {head('coverage', 'Coverage')}
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.hostid}>
                <td style={{ fontWeight: 500 }}>
                  <Link to={`/graphs?hostid=${h.hostid}`}>{h.name}</Link>
                  {h.hostStatus === '1' && <span className="muted"> · disabled</span>}
                </td>
                <td className="muted">{h.site ? `${h.site.code} · ${h.site.name}` : <NoData />}</td>
                <td className="muted">{h.category}</td>
                <td>
                  <SliPill sli={h.sli} target={report.target} dataStatus={h.dataStatus} />
                </td>
                <td className="muted nowrap">{h.sli === null ? <NoData /> : fmtDur(h.downtime)}</td>
                <td>
                  <CoverageText coverage={h.coverage} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}

/** A path with no data on any leg says nothing about the path; they share one line below the table. */
const noDataPath = (p: SliPath) =>
  p.legs.length > 0 && p.legs.every((l) => l.sli === null || l.dataStatus === 'nodata');

const legLabel = (name: string) => name.replace(/^INET\s*:\s*/i, '');

function PathsTable({ report }: { report: SliReport }) {
  if (!report.wanPaths.length) return null;
  const measured = report.wanPaths.filter((p) => !noDataPath(p));
  const silent = report.wanPaths.filter(noDataPath);
  return (
    <div className="panel">
      <h2>WAN paths</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        A redundant path is down only while every leg is down.
      </div>
      {measured.length > 0 && (
        <TableWrap label="WAN paths">
          <table className="data compact">
            <thead>
              <tr>
                <th>Path</th>
                <th>Legs</th>
                <th>Availability</th>
                <th>Downtime</th>
              </tr>
            </thead>
            <tbody>
              {measured.map((p) => (
                <tr key={p.key}>
                  <td>
                    <strong>{p.name}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {p.site ? `${p.site.code} · ${p.site.name}` : 'Unassigned'}
                    </div>
                  </td>
                  <td>
                    <div className="sli-legs">
                      {p.legs.map((l) => (
                        <span key={l.hostid} className="sli-leg" title={l.name}>
                          <span className="sli-leg-name">{legLabel(l.name)}</span>
                          <SliPill sli={l.sli} target={report.target} dataStatus={l.dataStatus} />
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <SliPill sli={p.sli} target={report.target} dataStatus={p.dataStatus} />
                  </td>
                  <td className="muted nowrap">{p.sli === null ? <NoData /> : fmtDur(p.downtime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {silent.length > 0 && (
        <div className="nodata-paths">
          <NoDataPill /> on every leg, {silent.length} path{silent.length === 1 ? '' : 's'}:{' '}
          {silent.map((p, i) => (
            <span key={p.key} title={p.legs.map((l) => legLabel(l.name)).join(' · ')}>
              {p.name}
              {i < silent.length - 1 ? ', ' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function WebTable({ report }: { report: SliReport }) {
  return (
    <div className="panel">
      <h2>Web checks</h2>
      {report.web.length ? (
        <TableWrap label="Web checks">
          <table className="data compact">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Availability</th>
                <th>Downtime</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {report.web.map((w) => (
                <tr key={w.itemid}>
                  <td style={{ fontWeight: 500 }}>{w.name}</td>
                  <td>
                    <SliPill sli={w.sli} target={report.target} dataStatus={w.dataStatus} />
                  </td>
                  <td className="muted nowrap">{w.sli === null ? <NoData /> : fmtDur(w.downtime)}</td>
                  <td>
                    <CoverageText coverage={w.coverage} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : (
        <Empty>
          {report.profile === 'hcml-report'
            ? 'Web checks are not part of the HCML report method. Switch to Strict.'
            : 'No web scenarios measured in this period.'}
        </Empty>
      )}
    </div>
  );
}

/** Why a device has never collected a ping value (`measured: false`). */
const unmeasuredReason = (h: SliHost) =>
  h.hostStatus === '1' ? 'host disabled in Zabbix' : 'no interface in Zabbix, so the ping check can’t run';

/**
 * Devices whose ping check has never collected a value. The HCML report method
 * counts them as 100 % available, which flatters its figure; name them.
 */
function NeverMeasured({ hosts }: { hosts: SliHost[] }) {
  const list = hosts
    .filter((h) => h.measured === false)
    .sort((a, b) => (a.site?.code ?? 99) - (b.site?.code ?? 99) || naturalCompare(a.name, b.name));
  if (!list.length) return null;
  return (
    <details className="notice warn sli-unmeasured">
      <summary>
        <strong>
          {list.length} device{list.length === 1 ? '' : 's'} never measured
        </strong>, counted as 100 % by HCML’s report method
      </summary>
      <p>
        These devices have never collected a single ping value, so there is nothing to measure. The
        strict figure leaves them out.
      </p>
      <TableWrap label="Devices never measured">
        <table className="data compact">
          <thead>
            <tr>
              <th>Device</th>
              <th>Site</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {list.map((h) => (
              <tr key={h.hostid}>
                <td>
                  <Link to={`/graphs?hostid=${h.hostid}`}>{h.name}</Link>
                </td>
                <td className="muted">{h.site ? `${h.site.code} · ${h.site.name}` : <NoData />}</td>
                <td className="muted">{unmeasuredReason(h)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </details>
  );
}

/** "10.5×" once the budget is overspent: "1054%" reads like a typo. */
const budgetUsed = (pct: number) => {
  if (pct <= 100) return `${Math.round(pct)}%`;
  const times = pct / 100;
  return `${times < 10 ? times.toFixed(2).replace(/0$/, '') : times.toFixed(1)}×`;
};

function DerivedKpis({
  strict,
  hcml,
  shown,
}: {
  strict: SliReport;
  hcml: SliReport | null;
  shown: SliReport;
}) {
  const target = strict.target;
  const o = strict.overall;
  const below = shown.sites.filter((s) => s.meeting === false);
  const allowance = 100 - target;
  const used = o.sli === null || allowance <= 0 ? null : ((100 - o.sli) / allowance) * 100;
  const hcmlSli = hcml?.overall.sli ?? null;
  const allowanceText = `${allowance.toFixed(allowance % 1 ? 2 : 0)}% downtime allowance`;

  return (
    <div className="grid kpis sli-kpis">
      <KpiCard
        label="Overall availability (strict)"
        value={fmtPct(o.sli, PERCENT_DP.availability, target)}
        sub={o.sli === null ? 'no data' : `target ${target}% · ${o.meeting ? 'met' : 'missed'}`}
        accent={o.sli === null ? 'var(--muted)' : o.meeting ? 'var(--good)' : 'var(--danger)'}
      />
      <KpiCard
        label="HCML report method"
        value={hcml ? fmtPct(hcmlSli, PERCENT_DP.availability, target) : '…'}
        sub={
          hcml
            ? `ping loss only · ${hcml.overall.meeting ? 'met' : 'missed'} ${target}%`
            : 'calculating…'
        }
        accent="var(--primary-light)"
      />
      <KpiCard
        label="Devices measured"
        value={`${o.withData} / ${o.hosts}`}
        sub={`${o.hosts - o.withData} without data (not counted)`}
      />
      <KpiCard
        label="Sites below target"
        value={below.length}
        sub={
          below.length
            ? below
                .slice(0, 3)
                .map((s) => s.name)
                .join(', ') + (below.length > 3 ? ` +${below.length - 3}` : '')
            : `all sites at or above ${target}%`
        }
        accent={below.length ? 'var(--danger)' : 'var(--good)'}
      />
      <KpiCard
        label="Error budget used"
        value={used === null ? '—' : budgetUsed(used)}
        sub={
          used !== null && used > 100
            ? `the budget, the ${allowanceText} (strict)`
            : `of the ${allowanceText} (strict)`
        }
        accent={used === null ? 'var(--muted)' : used > 100 ? 'var(--danger)' : 'var(--good)'}
      />
    </div>
  );
}

/**
 * The HCML figure comes from its own report, cached on its own, so it can be the
 * old copy while the strict one is live. The notice above the cards speaks
 * for the strict report; this adds one only when HCML's would say something else.
 */
function HcmlStaleNote({ strict, hcml }: { strict: SliReport; hcml: SliReport | null }) {
  const copy = staleCopyOf(hcml);
  if (!copy) return null;
  const above = staleCopyOf(strict);
  if (above && staleWhen(above.asOf) === staleWhen(copy.asOf)) return null;
  return <StaleCopy asOf={copy.asOf} refreshing={copy.refreshing} what="the HCML report method figure" />;
}

const PROFILES: SliProfile[] = ['availability', 'hcml-report'];

function DerivedSla() {
  const zone = useReportTimeZone();
  const months = useMemo(() => recentMonths(12, zone), [zone]);
  // Month and method live in the URL, so Back from a device graph returns to the same report.
  const [month, setMonth] = useUrlState<string>('month', lastClosedMonth(), { options: months });
  const [method, setMethod] = useUrlState<SliProfile>('method', 'availability', { options: PROFILES });
  const [explaining, setExplaining] = useState<DerivedSlaScope | null>(null);
  const aiEnabled = useAiEnabled();

  const strictQ = useAsync<SliReport>(() => api.sli(month, 'availability'), [month]);
  const hcmlQ = useAsync<SliReport>(() => api.sli(month, 'hcml-report'), [month]);
  const shownQ = method === 'availability' ? strictQ : hcmlQ;

  // A stale month's report must not sit under the new month's heading.
  const fresh = (r: SliReport | null) => (r && r.month === month ? r : null);
  const strict = fresh(strictQ.data);
  const hcml = fresh(hcmlQ.data);
  const shown = fresh(shownQ.data);

  const explain = (scope: string, name: string) =>
    setExplaining({
      scope,
      name,
      month,
      profile: method,
      target: shown?.target ?? strict?.target ?? 99,
      methodLabel: METHOD_LABEL[method],
    });

  return (
    <>
      <div className="notice sli-banner">
        <strong>{DERIVED_BANNER}.</strong> Computed in the portal from each device’s ICMP triggers,
        monthly in {zone} time; nothing is written to Zabbix.
      </div>

      <div className="controls">
        <MonthSelect value={month} onChange={setMonth} />
        <MethodToggle value={method} onChange={setMethod} label="Tables use" />
        {aiEnabled && (
          <FieldSpacer>
            <button
              className="btn ghost sm"
              onClick={() => explain('overall', 'HCML estate')}
              disabled={!shown}
            >
              Explain overall
            </button>
          </FieldSpacer>
        )}
        <ReportDownload month={month} disabled={!shown} />
        <EmailReport month={month} disabled={!shown} />
      </div>

      <Async
        loading={strictQ.loading || !strict}
        error={strictQ.error}
        data={strict}
        updatedAt={strictQ.updatedAt}
        loadingLabel="Measuring the month…"
      >
        {(s) => (
          <>
            <HcmlStaleNote strict={s} hcml={hcml} />
            <DerivedKpis strict={s} hcml={hcml} shown={shown ?? s} />
            <p className="sli-method-note">
              <strong>Why two figures?</strong> {METHOD_NOTE}
              {!s.closed && <em> This month is still running: figures so far.</em>}
            </p>
            <GapsNote gaps={s.gaps} windows={s.noDataWindows} profile={method} />
            <NeverMeasured hosts={s.hosts} />
          </>
        )}
      </Async>

      {strict && (
        <Async
          loading={shownQ.loading || !shown}
          error={shownQ.error}
          data={shown}
          updatedAt={shownQ.updatedAt}
          loadingLabel={`Calculating with the ${METHOD_LABEL[method]}…`}
        >
          {(r) => (
            <div className="grid sli-grid">
              <div className="grid two-col sli-grid sli-grid-wide">
                <GroupTable
                  title={`By category · ${METHOD_LABEL[method]}`}
                  first="Category"
                  groups={r.categories}
                  target={r.target}
                  aiEnabled={aiEnabled}
                  onExplain={explain}
                />
                <WebTable report={r} />
              </div>
              <GroupTable
                title={`By site · ${METHOD_LABEL[method]}`}
                first="Site"
                groups={r.sites}
                target={r.target}
                aiEnabled={aiEnabled}
                onExplain={explain}
              />
              <DeviceTable report={r} />
              <PathsTable report={r} />
            </div>
          )}
        </Async>
      )}

      {explaining && <SlaExplainPanel derived={explaining} onClose={() => setExplaining(null)} />}
    </>
  );
}


const TABS = ['', 'derived', 'zabbix'] as const;
/** The two tabs, left to right: the order the arrow keys walk. */
const SOURCES = ['derived', 'zabbix'] as const;

export default function SlaPage() {
  // Whether Zabbix's own SLAs have data doesn't change while the page is open: ask once.
  const source = useAsync<SlaSource>(() => api.slaSource(), []);
  // '' = the default for this Zabbix: its own SLAs when they have data, else derived.
  const [tab, setTab] = useUrlState<(typeof TABS)[number]>('tab', '', { options: TABS });
  const real = source.data?.real ?? false;
  const current = tab || (real ? 'zabbix' : 'derived');

  // The ARIA tabs pattern: one tab stop for the list, arrow keys between tabs, a panel they control.
  const tabsId = useId();
  const tabButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabId = (source: string) => `${tabsId}-tab-${source}`;
  const panelId = `${tabsId}-panel`;
  const onTabKeys = (e: React.KeyboardEvent) => {
    const at = SOURCES.indexOf(current === 'zabbix' ? 'zabbix' : 'derived');
    const to =
      e.key === 'ArrowRight' ? (at + 1) % SOURCES.length
      : e.key === 'ArrowLeft' ? (at - 1 + SOURCES.length) % SOURCES.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? SOURCES.length - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    setTab(SOURCES[to]);
    tabButtons.current[SOURCES[to]]?.focus();
  };
  const content = current === 'zabbix' && real ? <ZabbixSlas /> : <DerivedSla />;

  return (
    <>
      {real ? (
        // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- the tabs inside hold the focus; the list only hears the arrow keys
        <div className="seg sli-tabs" role="tablist" aria-label="SLA source" onKeyDown={onTabKeys}>
          {SOURCES.map((source) => (
            <button
              key={source}
              ref={(el) => {
                tabButtons.current[source] = el;
              }}
              id={tabId(source)}
              role="tab"
              type="button"
              aria-selected={current === source}
              aria-controls={panelId}
              tabIndex={current === source ? 0 : -1}
              className={current === source ? 'on' : ''}
              onClick={() => setTab(source)}
            >
              {source === 'derived' ? 'Derived monthly SLA' : 'Zabbix SLAs'}
            </button>
          ))}
        </div>
      ) : (
        source.data && (
          <div className="muted sli-source-note">
            Zabbix has {source.data.slas} SLA{source.data.slas === 1 ? '' : 's'} with{' '}
            {source.data.services ? `${count(source.data.services, 'service')} but no measurements` : 'no services attached'}
            , so this page shows the SLA derived in the portal.
          </div>
        )
      )}

      {/* One wrapper either way: swapping it in when the source answers would remount the panel and fetch its report twice. */}
      <div
        {...(real
          ? { role: 'tabpanel', id: panelId, 'aria-labelledby': tabId(current === 'zabbix' ? 'zabbix' : 'derived') }
          : {})}
      >
        {content}
      </div>

      {current === 'derived' && !source.data && source.error && (
        <div className="muted sli-source-note">Couldn’t check Zabbix’s own SLAs: {source.error}</div>
      )}
    </>
  );
}
