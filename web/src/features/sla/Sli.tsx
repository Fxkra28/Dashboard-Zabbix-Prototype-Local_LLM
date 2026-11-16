import { useId } from 'react';
import type { DataStatus, SliGap, SliProfile, SliReport } from '../../types';
import { formatLongDate, reportTimeZone, monthLabel, recentMonths } from '../../shared/lib/time';
import { useReportTimeZone } from '../../shared/hooks/useReportTimeZone';
import { PERCENT_DP, fixedBelow100, formatDuration } from '../../shared/lib/units';
import { percentText } from './percent';
import { NoData } from '../../shared/components/NoData';
import { count } from '../../shared/lib/plural';
import { Field, FieldGroup } from '../../shared/components/Field';

/**
 * Small shared pieces for the derived SLA views (SLA, Services): the period picker, the method toggle, the neutral "no data"
 * pill and the note on hours with no collected data.
 */

/** The Services page's banner. That page shows its derived tree only when Zabbix has no services, so the reason is true there. */
export const DERIVED_BANNER =
  'Derived from ICMP availability triggers: Zabbix has no services configured';

/** The banner of the SLA page and the report files. It names what the figures are, true whatever Zabbix has configured. */
export const DERIVED_SLA_BANNER = 'Derived from ICMP availability triggers, not from Zabbix’s own SLAs';

/** Over the Web checks of a month that has closed, and in the report files: the readings behind these figures age out (BK-60). */
export const WEB_AGING_NOTE =
  'The web check figures of a month that has closed can change later, as the readings behind them age out, and some can turn to No data.';

/** Around the date the figures of a closed month were taken, when they are kept (ADR 0016); the report files carry a copy that a test keeps equal. */
export const WEB_KEPT_NOTE_BEFORE = 'The web check figures of this month are those taken on';
export const WEB_KEPT_NOTE_AFTER = 'and kept as they were. Readings that had aged out by then are not counted.';

/** What to say over the Web checks of a month: when the figures were taken and that they are kept, else that a closed month's can still change. Null for a month still running, and under HCML's method. */
export function webNote(report: Pick<SliReport, 'closed' | 'profile' | 'webTakenAt' | 'timezone'>): string | null {
  if (report.profile === 'hcml-report') return null;
  if (report.webTakenAt !== undefined) return `${WEB_KEPT_NOTE_BEFORE} ${formatLongDate(report.webTakenAt * 1000, report.timezone)}, ${WEB_KEPT_NOTE_AFTER}`;
  return report.closed ? WEB_AGING_NOTE : null;
}

export const METHOD_LABEL: Record<SliProfile, string> = {
  availability: 'Strict',
  'hcml-report': 'HCML report method',
};

/** One short sentence on why the two figures differ. */
export const METHOD_NOTE =
  'HCML’s report counts only high ping loss, so a device that is completely down still counts as up; ' +
  'the strict figure counts unreachable devices and leaves out hours with no collected data.';

/** Pass `target` whenever the figure is shown beside Met or Missed, so rounding cannot print it as the target. */
export const fmtPct = (v: number | null | undefined, digits: number = PERCENT_DP.availability, target?: number) => {
  if (v === null || v === undefined) return '—';
  return target === undefined ? `${fixedBelow100(v, digits)}%` : percentText(v, target, digits);
};

export const fmtDur = (seconds: number | null | undefined) =>
  seconds === null || seconds === undefined ? '—' : formatDuration(seconds);

export function NoDataPill({ title }: { title?: string }) {
  return (
    <span className="pill nodata" title={title ?? 'Too little collected data to measure'}>
      No data
    </span>
  );
}

/** A percentage against the target: green met, red missed, grey "No data", never 0%. */
export function SliPill({
  sli,
  target,
  dataStatus,
  digits = PERCENT_DP.availability,
}: {
  sli: number | null;
  target: number;
  dataStatus?: DataStatus;
  digits?: number;
}) {
  if (sli === null || dataStatus === 'nodata') return <NoDataPill />;
  const met = sli >= target;
  // Met or Missed in words too, not by colour alone; nowrap keeps it one lozenge in a narrow cell.
  return (
    <span
      className={`pill nowrap ${met ? 'up' : 'down'}`}
      title={dataStatus === 'partial' ? 'Measured on partial data' : undefined}
    >
      {percentText(sli, target, digits)}
      {dataStatus === 'partial' && (
        <>
          <span className="sli-partial" aria-hidden="true">*</span>
          <span className="sr-only"> (measured on partial data)</span>
        </>
      )}{' '}
      {met ? 'Met' : 'Missed'}
    </span>
  );
}

export function CoverageText({ coverage }: { coverage: number | null | undefined }) {
  if (coverage === null || coverage === undefined) return <span className="muted"><NoData /></span>;
  const pct = Math.round(coverage * 100);
  return <span className={pct < 50 ? 'sli-cov low' : 'sli-cov'}>{pct}%</span>;
}

/** The windows the SLA page offers beside the months. A window is for watching and has no report files. */
export const ROLLING_WINDOWS = [
  { key: 'd7', days: 7, label: 'Last 7 days' },
  { key: 'd30', days: 30, label: 'Last 30 days' },
] as const;

/** The days of a window key such as `d7`; null for anything else, a month included. */
export const rollingDays = (period: string): number | null => ROLLING_WINDOWS.find((w) => w.key === period)?.days ?? null;

/** The current month (marked "so far") and the 11 before it, in the report zone, with the windows first when `rolling`. */
export function MonthSelect({
  value,
  onChange,
  label = 'Month',
  rolling = false,
}: {
  value: string;
  onChange: (m: string) => void;
  label?: string;
  /** Offer the last 7 and 30 days before the months. */
  rolling?: boolean;
}) {
  const zone = useReportTimeZone(); // the list follows the server's zone once it is known
  const id = useId();
  const months = recentMonths(12).map((m, i) => (
    <option key={m} value={m}>
      {monthLabel(m)}
      {i === 0 ? ' (so far)' : ''}
    </option>
  ));
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} name="month" data-period={rolling ? '' : undefined} value={value} onChange={(e) => onChange(e.target.value)}>
        {rolling ? (
          <>
            <optgroup label="Rolling window, not a month">
              {ROLLING_WINDOWS.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.label}
                </option>
              ))}
            </optgroup>
            <optgroup label={`Calendar month (${zone})`}>{months}</optgroup>
          </>
        ) : (
          months
        )}
      </select>
    </Field>
  );
}

/** The last closed month: a full month is the natural default for an SLA. */
export const lastClosedMonth = () => recentMonths(2)[1];

export function MethodToggle({
  value,
  onChange,
  label = 'Method',
}: {
  value: SliProfile;
  onChange: (p: SliProfile) => void;
  label?: string;
}) {
  return (
    <FieldGroup label={label}>
      {/* Named by the heading on screen, so that voice control can say it (WCAG 2.5.3). */}
      <div className="seg" role="group" aria-label={label}>
        {(['availability', 'hcml-report'] as SliProfile[]).map((p) => (
          <button
            key={p}
            type="button"
            className={value === p ? 'on' : ''}
            aria-pressed={value === p}
            onClick={() => onChange(p)}
          >
            {METHOD_LABEL[p]}
          </button>
        ))}
      </div>
    </FieldGroup>
  );
}

// Built per call: the zone is the server's SLA_TIMEZONE, known only once /api/health has answered.
const dayFmt = () => new Intl.DateTimeFormat('en-GB', { timeZone: reportTimeZone(), day: 'numeric', month: 'short' });
const hourFmt = () =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: reportTimeZone(),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

function spanText(g: SliGap): string {
  const a = new Date(g.from * 1000);
  const b = new Date((g.to - 1) * 1000);
  const day = dayFmt();
  const hour = hourFmt();
  const da = day.format(a);
  const db = day.format(b);
  if (g.to - g.from < 86400) {
    return da === db
      ? `${da} ${hour.format(a)}–${hour.format(new Date(g.to * 1000))}`
      : `${da} ${hour.format(a)} – ${db} ${hour.format(new Date(g.to * 1000))}`;
  }
  if (da === db) return da;
  const [dA, mA] = da.split(' ');
  const [dB, mB] = db.split(' ');
  return mA === mB ? `${dA}–${dB} ${mA}` : `${da} – ${db}`;
}

function spansSummary(spans: SliGap[], what: string): string | null {
  if (!spans.length) return null;
  const seconds = spans.reduce((s, g) => s + (g.to - g.from), 0);
  const amount =
    seconds >= 172800
      ? `${(seconds / 86400).toFixed(1)} days`
      : seconds < 3600
        ? count(Math.max(1, Math.round(seconds / 60)), 'minute')
        : count(Math.round(seconds / 3600), 'hour');
  return `${amount} ${what}: ${spans.map(spanText).join(', ')}`;
}

/** "Excluded 6.9 days with no collected data: 1–2 Aug, 8–11 Aug …" */
export const gapsSummary = (gaps: SliGap[]) => spansSummary(gaps, 'with no collected data');

/** The spans the setting SLA_NO_DATA_WINDOWS declares not measured, such as a collector that ran off HCML's network. */
export const declaredSummary = (windows: SliGap[]) => spansSummary(windows, 'the portal is set to treat as not measured');

const LEAD: Record<SliProfile, string> = {
  availability: 'Excluded ',
  'hcml-report': 'Counted as up by the HCML method: ',
};

export function GapsNote({
  gaps,
  windows,
  profile,
}: {
  gaps: SliGap[] | undefined;
  windows: SliGap[] | undefined;
  profile: SliProfile;
}) {
  const lines = [gapsSummary(gaps ?? []), declaredSummary(windows ?? [])].filter((t): t is string => t !== null);
  if (!lines.length) return null;
  return <div className="notice sli-gaps">{lines.map((t) => `${LEAD[profile]}${t}.`).join(' ')}</div>;
}
