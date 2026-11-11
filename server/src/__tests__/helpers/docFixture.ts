import type { Cell, ReportDoc, Table, Tone } from '../../export/types.js';

/**
 * A realistic ReportDoc for the writers' tests and for looking at their output:
 * 14 sites, 4 categories, 138 devices, a WAN table, web checks and the notes,
 * shaped like the real SLA report. Every name is made up. The awkward values
 * are deliberate: a name that starts with "=", one with markup and brackets,
 * one that is far too long for its column, accents, and figures that are
 * missing.
 *
 * Deterministic: the same call always returns the same document.
 */

const CATEGORIES = ['Cisco IOS by SNMP', 'FortiGate by SNMP', 'Generic by SNMP', 'ICMP Ping'];

const fmtPct = (v: number | null) => (v === null ? 'No data' : `${v.toFixed(2)}%`);
const toneOf = (v: number | null, target: number): Tone => (v === null ? 'muted' : v >= target ? 'good' : 'bad');
const verdict = (v: number | null, target: number): Cell =>
  v === null
    ? { text: 'No data', tone: 'muted' }
    : { text: v >= target ? 'Met' : 'Missed', tone: v >= target ? 'good' : 'bad' };
const pct = (v: number | null, target: number): Cell => ({ text: fmtPct(v), n: v, tone: toneOf(v, target) });
const count = (n: number): Cell => ({ text: String(n), n });
const duration = (s: number): Cell => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const text = d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : m ? `${m} min` : `${Math.round(s)} s`;
  return { text, n: s };
};
const text = (t: string): Cell => ({ text: t });

/** A small deterministic generator, so the figures look real without being random. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export interface SampleOptions {
  /** How many devices the device table holds. Default 138. */
  devices?: number;
  target?: number;
}

export function sampleDoc(opts: SampleOptions = {}): ReportDoc {
  const target = opts.target ?? 99;
  const deviceCount = opts.devices ?? 138;
  const rand = rng(7);

  const siteNames = Array.from({ length: 14 }, (_, i) => `Site ${i + 1}`);
  const siteSli = siteNames.map((_, i) => (i === 3 ? 97.4132 : i === 9 ? null : 98.6 + rand() * 1.39));

  const awkward = [
    '=HYPERLINK("http://example.invalid","click")',
    '<Core & edge> (backup) \\ rack 4',
    'A very long device name that will not fit in the column it is given, so it has to be cut short somewhere',
    'Café routeur Zürich',
  ];

  const devices = Array.from({ length: deviceCount }, (_, i) => {
    const sli = i % 29 === 5 ? null : i % 11 === 3 ? 90 + rand() * 8.9 : 99.2 + rand() * 0.8;
    const name = i < awkward.length ? awkward[i]! : `${(i % 14) + 1}.SW.${String(i).padStart(3, '0')} Sample device`;
    return {
      name,
      site: siteNames[i % 14]!,
      category: CATEGORIES[i % 4]!,
      sli,
      hcml: sli === null ? 100 : Math.min(100, sli + rand() * 0.6),
      downtime: sli === null ? 0 : Math.round(((100 - sli) / 100) * 2_678_400),
      incidents: sli === null ? 0 : Math.floor(rand() * 9),
      coverage: sli === null ? 0 : 0.9 + rand() * 0.1,
    };
  });
  devices.sort((a, b) => (a.sli ?? Infinity) - (b.sli ?? Infinity));

  const groupTable = (title: string, sheet: string, first: string, names: string[], slis: (number | null)[]): Table => ({
    title,
    sheet,
    caption: 'Strict method first, then the same group by HCML’s report method.',
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
    rows: names.map((n, i) => [
      text(n),
      count(10 + (i % 5)),
      count(slis[i] === null ? 0 : 10 + (i % 5)),
      pct(slis[i] ?? null, target),
      pct(slis[i] === null ? null : Math.min(100, (slis[i] ?? 0) + 0.3), target),
      count(i % 3),
      duration(i * 5400),
      verdict(slis[i] ?? null, target),
    ]),
  });

  return {
    title: 'SLA availability report',
    subtitle: 'August 2026',
    period: '1 Aug 2026 00:00 to 31 Aug 2026 23:59 (Asia/Jakarta). Month closed.',
    generated: 'Generated 1 Oct 2026 14:20 (Asia/Jakarta)',
    footer: 'HCML Monitoring Portal | SLA availability report, August 2026',
    fileBase: 'HCML_SLA_Report_2026-08',
    kpis: [
      { label: 'Overall SLA, strict', value: '98.74%', detail: `Target ${target}% | Missed`, tone: 'bad' },
      { label: 'Overall SLA, HCML method', value: '99.38%', detail: `Target ${target}% | Met`, tone: 'good' },
      { label: 'Devices measured', value: `${deviceCount - 5} of ${deviceCount}`, detail: '5 never measured', tone: 'warn' },
      { label: 'Sites below target', value: '8 of 14', detail: 'Strict method', tone: 'bad' },
    ],
    chart: {
      title: 'SLA by site, strict method',
      caption: `Bars start at 95%. The line marks the ${target}% target.`,
      target,
      axisMin: 95,
      bars: siteNames.map((label, i) => ({
        label,
        value: siteSli[i] ?? null,
        tone: toneOf(siteSli[i] ?? null, target),
        text: fmtPct(siteSli[i] ?? null),
      })),
    },
    tables: [
      groupTable('By category', 'By category', 'Category', CATEGORIES, [99.41, 98.2, 97.9, null]),
      groupTable('By site', 'By site', 'Site', siteNames, siteSli),
      {
        title: 'By device',
        sheet: 'By device',
        caption: 'Worst first; devices with no data last.',
        columns: [
          { header: 'Device', kind: 'text', weight: 6 },
          { header: 'Site', kind: 'text', weight: 2 },
          { header: 'Category', kind: 'text', weight: 3 },
          { header: 'SLA (strict)', kind: 'percent', weight: 2 },
          { header: 'SLA (HCML method)', kind: 'percent', weight: 2.4 },
          { header: 'Status', kind: 'status', weight: 1.8 },
          { header: 'Downtime', kind: 'duration', weight: 2 },
          { header: 'Incidents', kind: 'count', weight: 1.5 },
          { header: 'Coverage', kind: 'percent', weight: 1.7 },
        ],
        rows: devices.map((d) => [
          text(d.name),
          text(d.site),
          text(d.category),
          pct(d.sli, target),
          pct(d.hcml, target),
          verdict(d.sli, target),
          duration(d.downtime),
          count(d.incidents),
          { text: `${Math.round(d.coverage * 100)}%`, n: d.coverage * 100 },
        ]),
      },
      {
        title: 'WAN paths',
        sheet: 'WAN paths',
        caption: 'A path is down only while every leg is down.',
        columns: [
          { header: 'Path', kind: 'text', weight: 4 },
          { header: 'Legs', kind: 'text', weight: 6 },
          { header: 'SLA', kind: 'percent', weight: 2 },
          { header: 'Downtime', kind: 'duration', weight: 2 },
          { header: 'Status', kind: 'status', weight: 1.8 },
        ],
        rows: Array.from({ length: 6 }, (_, i) => [
          text(`Site ${i + 1} to head office`),
          text('Primary 99.91%, Backup 99.80%'),
          pct(99.5 + i * 0.07, target),
          duration(i * 1800),
          verdict(99.5 + i * 0.07, target),
        ]),
      },
      {
        title: 'Web checks',
        sheet: 'Web checks',
        columns: [
          { header: 'Check', kind: 'text', weight: 5 },
          { header: 'SLA', kind: 'percent', weight: 2 },
          { header: 'Downtime', kind: 'duration', weight: 2 },
          { header: 'Status', kind: 'status', weight: 1.8 },
        ],
        rows: [],
        empty: 'No web checks are configured in Zabbix.',
      },
      {
        title: 'Devices never measured',
        sheet: 'Never measured',
        columns: [
          { header: 'Device', kind: 'text', weight: 5 },
          { header: 'Site', kind: 'text', weight: 2 },
          { header: 'Reason', kind: 'text', weight: 6 },
        ],
        rows: [text('Spare unit 1'), text('Spare unit 2')].map((n) => [n, text('Site 5'), text('ICMP has never been collected for this device.')]),
        footer: [text('2 devices'), text(''), text('Counted as 100% by HCML’s method.')],
      },
    ],
    notes: [
      {
        heading: 'How to read this report',
        lines: [
          'Strict counts a device that is fully down as down. HCML method leaves such devices out, as HCML’s own monthly report does.',
          'Met means the figure reached the target. Missed means it fell short. No data means too little was collected to say.',
        ],
      },
      {
        heading: 'How it was computed',
        lines: [
          'Derived from each device’s ICMP availability triggers, month by month, in Asia/Jakarta time. Nothing is written to Zabbix.',
          'Hours with no collected data and planned maintenance are left out of the figure.',
        ],
      },
    ],
  };
}
