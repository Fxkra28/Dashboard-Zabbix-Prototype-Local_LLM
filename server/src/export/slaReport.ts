import { naturalCompare, type SiteRef } from '../domain/naming.js';
import type { DataStatus, SliGroup, SliHost, SliReport } from '../sli/engine.js';
import { DEFAULT_STYLE, type ReportStyle } from '../core/reportChoices.js';
import type { BarChart, Cell, Kpi, Note, ReportDoc, Table, Tone } from './types.js';

/**
 * The monthly SLA report as a ReportDoc (types.ts), built from the two derived
 * reports of one month: the strict one and HCML's method. Pure: no Zabbix, no
 * config and no clock but the one it is handed, so the same two reports always
 * give the same document. The wording is the SLA page's (features/sla/Sli.tsx
 * and features/sla/Sla.tsx), so a report and the screen it came from say the same
 * thing; export-sla-report.test.ts fails if a copied sentence drifts.
 */

const NO_DATA = 'No data';

/** Copied from web/src/features/sla/Sli.tsx: the browser bundle cannot be imported here. */
export const DERIVED_BANNER = 'Derived from ICMP availability triggers: Zabbix has no services configured';
export const METHOD_NOTE =
  'HCML’s report counts only high ping loss, so a device that is completely down still counts as up; ' +
  'the strict figure counts unreachable devices and leaves out hours with no collected data.';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
/** Not Intl's: en-GB spells September "Sept". */
const SHORT = MONTHS.map((m) => m.slice(0, 3));
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

// Numbers and words

/** A number written with the style's decimal mark. */
const withMark = (text: string, decimal: ReportStyle['decimal']) => (decimal === 'comma' ? text.replace('.', ',') : text);

/** `value.toFixed(digits)`, except that a figure below 100 is cut and never rounded up to read as 100. */
function fixedBelow100(value: number, digits: number): string {
  const text = value.toFixed(digits);
  if (value >= 100 || Number(text) < 100) return text;
  const scale = 10 ** digits;
  return (Math.trunc(value * scale) / scale).toFixed(digits);
}

/**
 * 98.996 rounds to 99.00 beside the word Missed, so more digits are
 * printed until the text is on the real side of the target. The page does the same.
 */
export function percentText(value: number | null, target: number, decimal: ReportStyle['decimal'] = 'dot'): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA;
  const met = value >= target;
  const digits = [2, 4, 6, 8].find((d) => (Number(fixedBelow100(value, d)) >= target) === met);
  // Closer to the target than eight decimals can show: cut instead of rounding.
  // 98.996 reads as such, not as 98.9960: the extra digits are only there to stay on the right side.
  const plain =
    digits === undefined ? (Math.trunc(value * 1e8) / 1e8).toFixed(8) : fixedBelow100(value, digits).replace(/(\.\d{2}\d*?)0+$/, '$1');
  return `${withMark(plain, decimal)}%`;
}

/** The page's formatDuration rule (two largest units) with the units spelled apart: "2 d 3 h", "1 h 12 min", "45 min", "30 s". */
export function durationText(seconds: number): string {
  if (!Number.isFinite(seconds)) return NO_DATA;
  const s = Math.round(Math.max(0, seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return h ? `${d} d ${h} h` : `${d} d`;
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  if (m) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return `${s} s`;
}

/**
 * The one place a download name is made. Anything outside letters, digits,
 * underscore and hyphen is replaced, so no request text can reach a header.
 */
export const reportFileBase = (part: string) => `HCML_SLA_Report_${part.replace(/[^\w-]/g, '_')}`;

/** A missing figure is null, whatever the engine says about it. */
const figure = (v: number | null | undefined, status?: DataStatus): number | null =>
  v === null || v === undefined || !Number.isFinite(v) || status === 'nodata' ? null : v;

const toneOf = (v: number | null, target: number): Tone => (v === null ? 'muted' : v >= target ? 'good' : 'bad');

// Cells

const text = (t: string): Cell => ({ text: t.trim() === '' ? NO_DATA : t });
const count = (n: number, tone?: Tone): Cell => (tone ? { text: String(n), n, tone } : { text: String(n), n });
const noData = (): Cell => ({ text: NO_DATA, n: null, tone: 'muted' });
const percent = (v: number | null, target: number, style: ReportStyle): Cell =>
  v === null ? noData() : { text: percentText(v, target, style.decimal), n: v, tone: toneOf(v, target) };
const duration = (seconds: number | null): Cell =>
  seconds === null ? noData() : { text: durationText(seconds), n: seconds };
const coverage = (c: number): Cell => ({ text: `${Math.round(c * 100)}%`, n: c * 100 });

/** Met, Missed or No data in words, so the verdict never rests on colour. */
const verdict = (v: number | null, target: number): Cell =>
  v === null
    ? { text: NO_DATA, tone: 'muted' }
    : v >= target
      ? { text: 'Met', tone: 'good' }
      : { text: 'Missed', tone: 'bad' };

const siteText = (site: SiteRef | null) => (site ? `${site.code} · ${site.name}` : 'Unassigned');

// Time in the report's zone

interface Zoned {
  year: number;
  month: number;
  day: number;
  hour: string;
  minute: string;
}
type Clock = (seconds: number) => Zoned;

function clockIn(timeZone: string): Clock {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return (seconds) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(seconds * 1000)).map((x) => [x.type, x.value]));
    return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: p.hour!, minute: p.minute! };
  };
}

type DateStyle = ReportStyle['date'];

const isoDay = (z: Zoned) => `${z.year}-${String(z.month).padStart(2, '0')}-${String(z.day).padStart(2, '0')}`;
const dateText = (z: Zoned, d: DateStyle) =>
  d === 'iso' ? isoDay(z) : d === 'numeric' ? `${String(z.day).padStart(2, '0')}/${String(z.month).padStart(2, '0')}/${z.year}` : `${z.day} ${SHORT[z.month - 1]} ${z.year}`;
/** Without its year only in the long style: the other two always carry it, so a span reads one way. */
const dayText = (z: Zoned, d: DateStyle) => (d === 'long' ? `${z.day} ${SHORT[z.month - 1]}` : dateText(z, d));
const hourText = (z: Zoned) => `${z.hour}:${z.minute}`;
const stampText = (z: Zoned, d: DateStyle) => `${dateText(z, d)} ${hourText(z)}`;

/** The last second the figures cover: the month's own end once it has closed. */
const lastSecond = (r: SliReport) => (r.closed ? r.to - 1 : r.end);

function subtitleOf(r: SliReport, at: Clock, d: DateStyle): string {
  const month = r.month ? MONTH_RE.exec(r.month) : null;
  if (month) return `${MONTHS[Number(month[2]) - 1]} ${month[1]}`;
  const first = dateText(at(r.from), d);
  const last = dateText(at(lastSecond(r)), d);
  return first === last ? first : `${first} to ${last}`;
}

function periodOf(r: SliReport, other: SliReport, at: Clock, d: DateStyle): string {
  const noun = r.month ? 'Month' : 'Period';
  if (r.closed) return `${stampText(at(r.from), d)} to ${stampText(at(r.to - 1), d)} (${r.timezone}). ${noun} closed.`;
  // The two methods are cached on their own clocks, so for a month still running their horizons can
  // differ by minutes. Say so, rather than print one of them for both.
  const horizon =
    Math.abs(r.end - other.end) >= 60
      ? `strict figures to ${stampText(at(r.end), d)}, HCML method to ${stampText(at(other.end), d)}`
      : `to ${stampText(at(r.end), d)}`;
  return `${noun} so far, ${horizon} (${r.timezone}). Figures are not final.`;
}

function fileBaseOf(r: SliReport, at: Clock): string {
  if (r.month) return reportFileBase(r.month);
  return reportFileBase(`${isoDay(at(r.from))}_to_${isoDay(at(lastSecond(r)))}`);
}

// Tables

/** Lowest figure first, nothing measured last, ties by name. */
function worstFirst<T extends { name: string }>(figureOf: (t: T) => number | null) {
  return (a: T, b: T) => {
    const [x, y] = [figureOf(a), figureOf(b)];
    return Number(x === null) - Number(y === null) || (x ?? 0) - (y ?? 0) || naturalCompare(a.name, b.name);
  };
}

function groupTable(
  title: string,
  first: string,
  strict: SliReport,
  hcml: SliReport,
  pick: (r: SliReport) => SliGroup[],
  style: ReportStyle,
): Table {
  const target = strict.target;
  const other = new Map(pick(hcml).map((g) => [g.key, g]));
  const row = (g: SliGroup, h: SliGroup | undefined): Cell[] => [
    text(g.name),
    count(g.hosts),
    count(g.withData),
    percent(figure(g.sli), target, style),
    percent(figure(h?.sli), target, style),
    count(g.belowTarget, g.belowTarget > 0 ? 'bad' : undefined),
    g.sli === null ? noData() : duration(g.downtime),
    verdict(figure(g.sli), target),
  ];
  const rows = pick(strict).map((g) => row(g, other.get(g.key)));
  return {
    title,
    sheet: title,
    caption: 'Strict figures first, then HCML’s report method. Downtime is the sum over the group’s devices.',
    columns: [
      { header: first, kind: 'text', weight: 4 },
      { header: 'Devices', kind: 'count', weight: 1.4 },
      { header: 'With data', kind: 'count', weight: 1.4 },
      { header: 'SLA (strict)', kind: 'percent', weight: 2 },
      { header: 'SLA (HCML method)', kind: 'percent', weight: 2.4 },
      { header: 'Below target', kind: 'count', weight: 1.6 },
      { header: 'Downtime', kind: 'duration', weight: 2 },
      { header: 'Status', kind: 'status', weight: 1.8 },
    ],
    rows,
    ...(rows.length ? { footer: row(strict.overall, hcml.overall) } : {}),
    empty: 'No devices were reported for this period.',
  };
}

function deviceTable(strict: SliReport, hcml: SliReport, style: ReportStyle): Table {
  const target = strict.target;
  const hcmlById = new Map(hcml.hosts.map((h) => [h.hostid, h]));
  const rows = [...strict.hosts].sort(worstFirst((h) => figure(h.sli, h.dataStatus))).map((h): Cell[] => {
    const sli = figure(h.sli, h.dataStatus);
    // Incidents and outage lengths say nothing about a device that was not measured.
    return [
      text(h.hostStatus === '1' ? `${h.name} · disabled` : h.name),
      text(siteText(h.site)),
      text(h.category),
      percent(sli, target, style),
      percent(figure(hcmlById.get(h.hostid)?.sli), target, style),
      verdict(sli, target),
      sli === null ? noData() : duration(h.downtime),
      sli === null ? noData() : count(h.incidents),
      sli === null ? noData() : duration(h.longest),
      coverage(h.coverage),
    ];
  });
  return {
    title: 'By device',
    sheet: 'By device',
    caption: 'Worst strict figure first, devices with no data last. Downtime, incidents and coverage are the strict method’s.',
    columns: [
      { header: 'Device', kind: 'text', weight: 6 },
      { header: 'Site', kind: 'text', weight: 3 },
      { header: 'Category', kind: 'text', weight: 3 },
      { header: 'SLA (strict)', kind: 'percent', weight: 2 },
      { header: 'SLA (HCML method)', kind: 'percent', weight: 2.4 },
      { header: 'Status', kind: 'status', weight: 1.8 },
      { header: 'Downtime', kind: 'duration', weight: 2 },
      { header: 'Incidents', kind: 'count', weight: 1.5 },
      { header: 'Longest outage', kind: 'duration', weight: 2 },
      { header: 'Coverage', kind: 'percent', weight: 1.7 },
    ],
    rows,
    empty: 'No devices were reported for this period.',
  };
}

/** The leg's host name without "INET :" and, as the path has its own column, without the path's name. */
function legLabel(name: string, path: string): string {
  const bare = name.replace(/^\s*INET\s*:\s*/i, '').trim();
  const rest = bare.toUpperCase().startsWith(path.toUpperCase()) ? bare.slice(path.length).trim() : '';
  return rest || bare;
}

function pathsTable(strict: SliReport, style: ReportStyle): Table {
  const target = strict.target;
  const rows = [...strict.wanPaths]
    .sort((a, b) => naturalCompare(a.name, b.name))
    .map((p): Cell[] => {
      const sli = figure(p.sli, p.dataStatus);
      const legs = p.legs.map((l) => `${legLabel(l.name, p.name)} ${percentText(figure(l.sli, l.dataStatus), target, style.decimal)}`);
      return [
        text(p.name),
        text(siteText(p.site)),
        text(legs.join(' · ')),
        percent(sli, target, style),
        sli === null ? noData() : duration(p.downtime),
        coverage(p.coverage),
        verdict(sli, target),
      ];
    });
  return {
    title: 'WAN paths',
    sheet: 'WAN paths',
    caption: 'A redundant path is down only while every leg is down. Strict method.',
    columns: [
      { header: 'Path', kind: 'text', weight: 3 },
      { header: 'Site', kind: 'text', weight: 3 },
      { header: 'Legs', kind: 'text', weight: 6 },
      { header: 'SLA (strict)', kind: 'percent', weight: 2 },
      { header: 'Downtime', kind: 'duration', weight: 2 },
      { header: 'Coverage', kind: 'percent', weight: 1.7 },
      { header: 'Status', kind: 'status', weight: 1.8 },
    ],
    rows,
    empty: 'No WAN paths were found among the monitored devices.',
  };
}

function webTable(strict: SliReport, style: ReportStyle): Table {
  const target = strict.target;
  return {
    title: 'Web checks',
    sheet: 'Web checks',
    caption: 'Strict method only: HCML’s report method does not measure web checks.',
    columns: [
      { header: 'Scenario', kind: 'text', weight: 6 },
      { header: 'SLA (strict)', kind: 'percent', weight: 2 },
      { header: 'Downtime', kind: 'duration', weight: 2 },
      { header: 'Coverage', kind: 'percent', weight: 1.7 },
      { header: 'Status', kind: 'status', weight: 1.8 },
    ],
    rows: strict.web.map((w): Cell[] => {
      const sli = figure(w.sli, w.dataStatus);
      return [
        text(w.name),
        percent(sli, target, style),
        sli === null ? noData() : duration(w.downtime),
        coverage(w.coverage),
        verdict(sli, target),
      ];
    }),
    empty: 'No web scenarios measured in this period.',
  };
}

/** Why a device has never collected a ping value, in the page's words. */
const unmeasuredReason = (h: SliHost) =>
  h.hostStatus === '1' ? 'host disabled in Zabbix' : 'no interface in Zabbix, so the ping check can’t run';

function neverMeasuredTable(strict: SliReport): Table {
  const list = strict.hosts
    .filter((h) => !h.measured)
    .sort((a, b) => (a.site?.code ?? 99) - (b.site?.code ?? 99) || naturalCompare(a.name, b.name));
  return {
    title: 'Devices never measured',
    sheet: 'Never measured',
    caption: 'Never collected a ping value: left out of the strict figure, counted as 100% by HCML’s method.',
    columns: [
      { header: 'Device', kind: 'text', weight: 5 },
      { header: 'Site', kind: 'text', weight: 3 },
      { header: 'Category', kind: 'text', weight: 3 },
      { header: 'Reason', kind: 'text', weight: 6 },
    ],
    rows: list.map((h): Cell[] => [text(h.name), text(siteText(h.site)), text(h.category), text(unmeasuredReason(h))]),
    empty: 'Every device has collected at least one ping value.',
  };
}

// Summary, chart and notes

function kpisOf(strict: SliReport, hcml: SliReport, style: ReportStyle): Kpi[] {
  const target = strict.target;
  const o = strict.overall;
  const overall = (label: string, g: SliGroup): Kpi => ({
    label,
    value: percentText(figure(g.sli), target, style.decimal),
    detail: `Target ${withMark(String(target), style.decimal)}% · ${verdict(figure(g.sli), target).text}`,
    tone: toneOf(figure(g.sli), target),
  });

  const parts: string[] = [];
  const withoutData = o.hosts - o.withData;
  const never = strict.hosts.filter((h) => !h.measured).length;
  // A device that never collected a value has no strict figure: it is one of those without data, not an extra.
  const within = never > 0 && never <= withoutData;
  if (withoutData) parts.push(within ? `${withoutData} without data, ${never} of them never measured` : `${withoutData} without data`);
  if (never > 0 && !within) parts.push(`${never} never measured`);

  const sites = strict.sites;
  const below = sites.filter((s) => s.sli !== null && s.sli < target).length;
  const unmeasured = sites.filter((s) => s.sli === null).length;

  return [
    overall('Overall SLA (strict)', o),
    overall('Overall SLA (HCML method)', hcml.overall),
    {
      label: 'Devices measured',
      value: `${o.withData} of ${o.hosts}`,
      detail: o.hosts === 0 ? 'No devices reported' : parts.length ? parts.join(', ') : 'All devices measured',
      tone: o.hosts === 0 ? 'muted' : parts.length ? 'warn' : 'good',
    },
    {
      label: 'Sites below target',
      value: `${below} of ${sites.length}`,
      detail: `Strict method${unmeasured ? `, ${unmeasured} without data` : ''}`,
      tone: below ? 'bad' : unmeasured === sites.length ? 'muted' : 'good',
    },
  ];
}

/** Availability crowds the top of a 0 to 100 scale, so the axis starts at a whole 5 under the lowest figure, never above 95. */
function axisMinFor(values: number[], target: number): number {
  const lowest = Math.min(target, ...values);
  return Math.min(95, Math.max(0, Math.floor(lowest / 5) * 5));
}

function chartOf(strict: SliReport, style: ReportStyle): BarChart | undefined {
  const target = strict.target;
  const sites = [...strict.sites].sort(worstFirst((s) => figure(s.sli)));
  const values = sites.flatMap((s) => figure(s.sli) ?? []);
  if (!values.length) return undefined;
  const axisMin = axisMinFor(values, target);
  const targetText = withMark(String(target), style.decimal);
  return {
    title: 'SLA by site, strict method',
    caption: `Worst site first, sites with no data last. Bars start at ${axisMin}%. The line marks the ${targetText}% target.`,
    target,
    axisMin,
    targetLabel: `Target ${targetText}%`,
    axisLabel: `${axisMin}%`,
    bars: sites.map((s) => ({
      label: s.name,
      value: figure(s.sli),
      tone: toneOf(figure(s.sli), target),
      text: percentText(figure(s.sli), target, style.decimal),
    })),
  };
}

function readNote(strict: SliReport, style: ReportStyle): Note {
  const lines = [
    `Why two figures? ${METHOD_NOTE}`,
    `Met means a figure reached the ${withMark(String(strict.target), style.decimal)}% target, Missed means it fell short, and No data means too little was collected to measure it. The Status columns judge the strict figure. A device with no data is shown as No data, never as 0%.`,
    'Figures show two decimals. One that would round up to the target while falling short shows more, so it never reads as met.',
    'Group and overall figures are the plain average of their devices’ figures, as in HCML’s own reports.',
    'Downtime in a group row adds up the downtime of all its devices, so devices down at the same time count separately.',
    'Coverage is the share of the month in which the ping check collected data, not counting planned maintenance.',
  ];
  if (!strict.closed) lines.push(`This ${strict.month ? 'month' : 'period'} is still running: figures so far.`);
  return { heading: 'How to read this report', lines };
}

type Basis = SliReport['basis'];
const GAP_POLICY: Record<Basis['gapPolicy'], string> = { excluded: 'left out', 'counted-as-up': 'counted as up' };
const NO_DATA_POLICY: Record<Basis['noDataPolicy'], string> = { excluded: 'left out', 'counted-as-100': 'counted as 100%' };
const MAINTENANCE_POLICY: Record<Basis['maintenancePolicy'], string> = { excluded: 'left out' };

const byMethods = (strict: string, hcml: string) =>
  strict === hcml ? `${strict} by both methods` : `${strict} by the strict method and ${hcml} by HCML’s method`;

/** One estate-wide gap, as the page's GapsNote words it but with "to" for ranges. */
function spanText(g: { from: number; to: number }, at: Clock, d: DateStyle): string {
  const a = at(g.from);
  const b = at(g.to - 1);
  if (g.to - g.from < 86400) {
    const end = hourText(at(g.to));
    return dayText(a, d) === dayText(b, d)
      ? `${dayText(a, d)} ${hourText(a)} to ${end}`
      : `${dayText(a, d)} ${hourText(a)} to ${dayText(b, d)} ${end}`;
  }
  if (dayText(a, d) === dayText(b, d)) return dayText(a, d);
  return d === 'long' && a.month === b.month ? `${a.day} to ${b.day} ${SHORT[a.month - 1]}` : `${dayText(a, d)} to ${dayText(b, d)}`;
}

function computedNote(strict: SliReport, hcml: SliReport, at: Clock, d: DateStyle): Note {
  const s = strict.basis;
  const h = hcml.basis;
  const lines = [
    `${DERIVED_BANNER}. Computed in the portal from each device’s ICMP triggers, monthly in ${strict.timezone} time; nothing is written to Zabbix.`,
    `Strict method: a device is down while any of these triggers is in problem: ${s.triggers.join(', ')}. HCML’s method counts only ${h.triggers.join(', ')}.`,
    `Hours in which nothing was collected are ${byMethods(GAP_POLICY[s.gapPolicy], GAP_POLICY[h.gapPolicy])}.`,
    `A device with too little collected data is ${byMethods(NO_DATA_POLICY[s.noDataPolicy], NO_DATA_POLICY[h.noDataPolicy])}.`,
    `Time inside a planned Zabbix maintenance window is ${byMethods(MAINTENANCE_POLICY[s.maintenancePolicy], MAINTENANCE_POLICY[h.maintenancePolicy])}, downtime and total alike.`,
  ];
  if (strict.gaps.length) {
    const seconds = strict.gaps.reduce((n, g) => n + (g.to - g.from), 0);
    lines.push(
      `Estate-wide spans with no collected data, ${durationText(seconds)} in all: ${strict.gaps.map((g) => spanText(g, at, d)).join(', ')}.`,
    );
  }
  if (strict.noDataWindows.length) {
    lines.push(
      `Declared not measured by the portal's setting SLA_NO_DATA_WINDOWS, and treated as hours with no data by both methods: ${strict.noDataWindows.map((g) => spanText(g, at, d)).join(', ')}.`,
    );
  }
  return { heading: 'How it was computed', lines };
}

export function buildSlaReportDoc(
  strict: SliReport,
  hcml: SliReport,
  now: Date = new Date(),
  style: ReportStyle = DEFAULT_STYLE,
): ReportDoc {
  // Mislabelled or mismatched reports would print one method's figures under the other's name.
  if (strict.profile !== 'availability' || hcml.profile !== 'hcml-report') {
    throw new Error('The strict report comes first and HCML’s method second.');
  }
  if (strict.from !== hcml.from || strict.to !== hcml.to) {
    throw new Error('The strict and HCML reports cover different periods.');
  }

  const at = clockIn(strict.timezone);
  const d = style.date;
  const subtitle = subtitleOf(strict, at, d);
  const chart = chartOf(strict, style);
  return {
    title: 'SLA availability report',
    subtitle,
    period: periodOf(strict, hcml, at, d),
    generated: `Generated ${stampText(at(now.getTime() / 1000), d)} (${strict.timezone})`,
    footer: `HCML Monitoring Portal · SLA availability report, ${subtitle}`,
    fileBase: fileBaseOf(strict, at),
    kpis: kpisOf(strict, hcml, style),
    ...(chart ? { chart } : {}),
    tables: [
      groupTable('By category', 'Category', strict, hcml, (r) => r.categories, style),
      groupTable('By site', 'Site', strict, hcml, (r) => r.sites, style),
      deviceTable(strict, hcml, style),
      pathsTable(strict, style),
      webTable(strict, style),
      neverMeasuredTable(strict),
    ],
    notes: [readNote(strict, style), computedNote(strict, hcml, at, d)],
  };
}
