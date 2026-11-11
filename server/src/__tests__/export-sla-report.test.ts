import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { naturalCompare } from '../domain/naming.js';
import { aggregate, type SliHost, type SliReport } from '../sli/engine.js';
import { DERIVED_BANNER, METHOD_NOTE, buildSlaReportDoc, durationText, percentText, reportFileBase } from '../export/slaReport.js';
import type { Cell, ReportDoc, Table, Tone } from '../export/types.js';
import { sampleSliReports } from './helpers/sliReportFixture.js';

/**
 * The monthly SLA report as a document: what it prints, in what order, and
 * that every figure is the one the two SliReports carry. Both writers turn this
 * same value into a file, so a wrong cell here is wrong in the PDF and the
 * workbook alike. Pure: no Zabbix, no clock but the one handed in.
 */

type Pair = { strict: SliReport; hcml: SliReport };

const TARGET = 99;
/** 14:20 in Asia/Jakarta, the day after the fixture's month closed. */
const NOW = new Date('2026-09-01T07:20:00Z');
const at = (iso: string) => Date.parse(iso) / 1000;

function build(edit?: (p: Pair) => void, now = NOW): ReportDoc {
  const p = sampleSliReports();
  edit?.(p);
  return buildSlaReportDoc(p.strict, p.hcml, now);
}

function tableOf(doc: ReportDoc, title: string): Table {
  const t = doc.tables.find((x) => x.title === title);
  if (!t) throw new Error(`no table titled ${title}`);
  return t;
}
function col(t: Table, header: string): number {
  const i = t.columns.findIndex((c) => c.header === header);
  if (i < 0) throw new Error(`no column ${header} in ${t.title}`);
  return i;
}
const cellsOf = (t: Table, header: string): Cell[] => t.rows.map((r) => r[col(t, header)]!);
const wordsOf = (t: Table, header: string): string[] => cellsOf(t, header).map((c) => c.text);
const rowNamed = (t: Table, first: string): Cell[] => {
  const row = t.rows.find((r) => r[0]!.text === first);
  if (!row) throw new Error(`no row ${first} in ${t.title}`);
  return row;
};
const cellAt = (t: Table, first: string, header: string): Cell => rowNamed(t, first)[col(t, header)]!;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** A copy of `base` with fields changed, for the edge cases the fixture does not hold. */
const hostLike = (base: SliHost, over: Partial<SliHost>): SliHost => ({ ...base, ...over });
const noDataHost = (base: SliHost, over: Partial<SliHost> = {}): SliHost =>
  hostLike(base, { sli: null, dataStatus: 'nodata', meeting: null, downtime: 0, coverage: 0, ...over });

function retime(p: Pair, over: Partial<SliReport>): void {
  Object.assign(p.strict, over);
  Object.assign(p.hcml, over);
}

const DASH = /[\u2013\u2014]/;
const BAD_SHEET_CHARS = /[[\]:*?/\\]/;

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

/** What both writers rely on, whatever the report holds. */
function expectWellFormed(doc: ReportDoc, label = 'doc'): void {
  const sheets = new Set<string>();
  for (const t of doc.tables) {
    const where = `${label} / ${t.title}`;
    expect(t.columns.length, where).toBeGreaterThan(0);
    for (const c of t.columns) {
      expect(c.header.trim(), where).not.toBe('');
      expect(c.weight, where).toBeGreaterThan(0);
    }

    expect(t.sheet.length, `${where} sheet`).toBeGreaterThan(0);
    expect(t.sheet.length, `${where} sheet`).toBeLessThanOrEqual(31);
    expect(t.sheet, `${where} sheet`).not.toMatch(BAD_SHEET_CHARS);
    expect(t.sheet, `${where} sheet`).not.toMatch(/^'|'$/);
    expect(sheets.has(t.sheet.toLowerCase()), `${where} sheet is unique`).toBe(false);
    sheets.add(t.sheet.toLowerCase());

    expect(t.empty?.trim() ?? '', `${where} says something when it is empty`).not.toBe('');

    for (const row of [...t.rows, ...(t.footer ? [t.footer] : [])]) {
      expect(row.length, `${where} row`).toBe(t.columns.length);
      row.forEach((cell, i) => {
        const here = `${where} / ${t.columns[i]!.header}`;
        expect(cell.text.trim(), here).not.toBe('');
        // The workbook stores numbers as numbers: figure columns always say whether they have one.
        if (['percent', 'duration', 'count'].includes(t.columns[i]!.kind)) {
          expect(cell.n === null || typeof cell.n === 'number', `${here} carries n`).toBe(true);
        } else {
          expect('n' in cell, `${here} has no n`).toBe(false);
        }
      });
    }
  }
  for (const k of doc.kpis) {
    expect(k.label.trim()).not.toBe('');
    expect(k.value.trim()).not.toBe('');
  }
  for (const s of strings(doc)) expect(s, 'no em or en dash').not.toMatch(DASH);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

describe('the document as a whole', () => {
  const doc = build();

  it('names the report and the month it covers', () => {
    expect(doc.title).toBe('SLA availability report');
    expect(doc.subtitle).toBe('August 2026');
    expect(doc.fileBase).toBe('HCML_SLA_Report_2026-08');
    expect(doc.footer).toBe('HCML Monitoring Portal · SLA availability report, August 2026');
    expect(doc.generated).toBe('Generated 1 Sep 2026 14:20 (Asia/Jakarta)');
  });

  it('puts the tables in reading order, each under its own title', () => {
    expect(doc.tables.map((t) => t.title)).toEqual([
      'By category',
      'By site',
      'By device',
      'WAN paths',
      'Web checks',
      'Devices never measured',
    ]);
  });

  it('is well formed, for the fixture and for every shape of report below', () => {
    expectWellFormed(doc);
  });

  it('gives each table a sheet name Excel accepts', () => {
    expect(doc.tables.map((t) => t.sheet)).toEqual(['By category', 'By site', 'By device', 'WAN paths', 'Web checks', 'Never measured']);
  });

  it('never prints an empty cell, and hands awkward names through untouched for the writers to escape', () => {
    const awkward = build((p) => {
      p.strict.hosts[10] = hostLike(p.strict.hosts[10]!, { name: '   ' });
      p.strict.hosts[11] = hostLike(p.strict.hosts[11]!, { name: '=HYPERLINK("x")' });
      p.strict.hosts[12] = hostLike(p.strict.hosts[12]!, { name: '<b>& "quoted"</b>' });
    });
    expectWellFormed(awkward, 'awkward');
    const names = wordsOf(tableOf(awkward, 'By device'), 'Device');
    expect(names).toContain('No data');
    expect(names).toContain('=HYPERLINK("x")');
    expect(names).toContain('<b>& "quoted"</b>');
  });

  it('gives the same document for the same reports and does not touch them', () => {
    const p = sampleSliReports();
    const before = JSON.stringify(p);
    // Frozen, so an in-place sort or edit throws instead of passing unseen.
    deepFreeze(p);
    const first = buildSlaReportDoc(p.strict, p.hcml, NOW);
    expect(buildSlaReportDoc(p.strict, p.hcml, NOW)).toEqual(first);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('refuses reports that are swapped or cover different periods', () => {
    const { strict, hcml } = sampleSliReports();
    expect(() => buildSlaReportDoc(hcml, strict, NOW)).toThrow(/strict report comes first/);
    expect(() => buildSlaReportDoc(strict, strict, NOW)).toThrow(/strict report comes first/);
    expect(() => buildSlaReportDoc(strict, { ...hcml, to: hcml.to - 3600 }, NOW)).toThrow(/different periods/);
    expect(() => buildSlaReportDoc(strict, { ...hcml, from: hcml.from + 3600 }, NOW)).toThrow(/different periods/);
  });
});

describe('columns and row counts', () => {
  const { strict } = sampleSliReports();
  const doc = build();

  const GROUP_COLUMNS = ['Devices', 'With data', 'SLA (strict)', 'SLA (HCML method)', 'Below target', 'Downtime', 'Status'];
  const GROUP_KINDS = ['count', 'count', 'percent', 'percent', 'count', 'duration', 'status'];

  it('By category: one row per category in the engine order, plus the estate as a closing row', () => {
    const t = tableOf(doc, 'By category');
    expect(t.columns.map((c) => c.header)).toEqual(['Category', ...GROUP_COLUMNS]);
    expect(t.columns.map((c) => c.kind)).toEqual(['text', ...GROUP_KINDS]);
    expect(t.rows).toHaveLength(4);
    expect(t.rows.map((r) => r[0]!.text)).toEqual(strict.categories.map((g) => g.name));
    expect(t.footer![0]!.text).toBe('HCML estate');
    expect(t.sheet).toBe('By category');
  });

  it('By site: one row per site in site-code order, plus the estate as a closing row', () => {
    const t = tableOf(doc, 'By site');
    expect(t.columns.map((c) => c.header)).toEqual(['Site', ...GROUP_COLUMNS]);
    expect(t.columns.map((c) => c.kind)).toEqual(['text', ...GROUP_KINDS]);
    expect(t.rows).toHaveLength(14);
    expect(t.rows.map((r) => r[0]!.text)).toEqual(strict.sites.map((g) => g.name));
    expect(t.rows[0]![0]!.text).toBe('1 · Alder Yard');
    expect(t.footer![0]!.text).toBe('HCML estate');
    expect(t.sheet).toBe('By site');
  });

  it('By device: one row per device, no closing row', () => {
    const t = tableOf(doc, 'By device');
    expect(t.columns.map((c) => c.header)).toEqual([
      'Device',
      'Site',
      'Category',
      'SLA (strict)',
      'SLA (HCML method)',
      'Status',
      'Downtime',
      'Incidents',
      'Longest outage',
      'Coverage',
    ]);
    expect(t.columns.map((c) => c.kind)).toEqual([
      'text',
      'text',
      'text',
      'percent',
      'percent',
      'status',
      'duration',
      'count',
      'duration',
      'percent',
    ]);
    expect(t.rows).toHaveLength(138);
    expect(t.footer).toBeUndefined();
  });

  it('WAN paths: one row per path', () => {
    const t = tableOf(doc, 'WAN paths');
    expect(t.columns.map((c) => c.header)).toEqual(['Path', 'Site', 'Legs', 'SLA (strict)', 'Downtime', 'Coverage', 'Status']);
    expect(t.columns.map((c) => c.kind)).toEqual(['text', 'text', 'text', 'percent', 'duration', 'percent', 'status']);
    expect(t.rows).toHaveLength(6);
    expect(t.footer).toBeUndefined();
  });

  it('Web checks: one row per scenario', () => {
    const t = tableOf(doc, 'Web checks');
    expect(t.columns.map((c) => c.header)).toEqual(['Scenario', 'SLA (strict)', 'Downtime', 'Coverage', 'Status']);
    expect(t.columns.map((c) => c.kind)).toEqual(['text', 'percent', 'duration', 'percent', 'status']);
    expect(t.rows).toHaveLength(3);
  });

  it('Devices never measured: one row per device that never collected a ping value', () => {
    const t = tableOf(doc, 'Devices never measured');
    expect(t.columns.map((c) => c.header)).toEqual(['Device', 'Site', 'Category', 'Reason']);
    expect(t.columns.every((c) => c.kind === 'text')).toBe(true);
    expect(t.rows).toHaveLength(strict.hosts.filter((h) => !h.measured).length);
    expect(t.rows).toHaveLength(4);
    expect(t.sheet).toBe('Never measured');
  });

  it('every row, closing row and cell lines up with its columns', () => {
    for (const t of doc.tables) {
      for (const r of t.rows) expect(r, t.title).toHaveLength(t.columns.length);
      if (t.footer) expect(t.footer, t.title).toHaveLength(t.columns.length);
    }
  });
});

describe('ordering', () => {
  /** Reversed, so a table that merely kept the input order fails. */
  const backwards = (p: Pair) => {
    p.strict.hosts.reverse();
    p.hcml.hosts.reverse();
    p.strict.wanPaths.reverse();
  };

  it('lists devices worst first, then devices with no data, ties by name', () => {
    const t = tableOf(build(backwards), 'By device');
    const n = cellsOf(t, 'SLA (strict)').map((c) => c.n);
    const names = t.rows.map((r) => r[0]!.text.replace(/ · disabled$/, ''));
    const firstNoData = n.indexOf(null);
    expect(firstNoData).toBeGreaterThan(0);
    expect(n.slice(firstNoData).every((v) => v === null)).toBe(true);
    for (let i = 1; i < n.length; i++) {
      const [a, b] = [n[i - 1], n[i]];
      if (typeof a === 'number' && typeof b === 'number') expect(a, `row ${i}`).toBeLessThanOrEqual(b);
      if (a === b) expect(naturalCompare(names[i - 1]!, names[i]!), `${names[i - 1]} then ${names[i]}`).toBeLessThanOrEqual(0);
    }
  });

  it('breaks a tie by natural name order, and puts a no-data device last however early its name sorts', () => {
    const t = tableOf(
      build((p) => {
        const [a, b, c, d] = p.strict.hosts.filter((h) => h.sli !== null && h.sli > 99.5);
        const edited = [
          hostLike(a!, { name: 'Zeta 10', sli: 97.5, meeting: false }),
          hostLike(b!, { name: 'Zeta 9', sli: 97.5, meeting: false }),
          hostLike(c!, { name: 'Zeta 2', sli: 97.5, meeting: false }),
          noDataHost(d!, { name: 'AAA first by name' }),
        ];
        const ids = new Set(edited.map((h) => h.hostid));
        p.strict.hosts = [...edited, ...p.strict.hosts.filter((h) => !ids.has(h.hostid))];
      }),
      'By device',
    );
    const names = t.rows.map((r) => r[0]!.text);
    const [i2, i9, i10] = ['Zeta 2', 'Zeta 9', 'Zeta 10'].map((n) => names.indexOf(n));
    expect(i2).toBeLessThan(i9!);
    expect(i9).toBeLessThan(i10!);
    expect(i10! - i2!).toBe(2);
    expect(names.indexOf('AAA first by name')).toBeGreaterThan(Math.max(...cellsOf(t, 'SLA (strict)').flatMap((c, i) => (c.n === null ? [] : [i]))));
  });

  it('treats a device the engine marked no data as no data even if it still carries a figure', () => {
    const t = tableOf(
      build((p) => {
        const target = p.strict.hosts.find((h) => h.sli !== null && h.sli < 90)!;
        p.strict.hosts = p.strict.hosts.map((h) => (h === target ? hostLike(h, { name: 'Marked nodata', sli: 50, dataStatus: 'nodata' }) : h));
      }),
      'By device',
    );
    const row = rowNamed(t, 'Marked nodata');
    expect(row[col(t, 'SLA (strict)')]).toEqual({ text: 'No data', n: null, tone: 'muted' });
    expect(row[col(t, 'Status')]).toEqual({ text: 'No data', tone: 'muted' });
    const names = t.rows.map((r) => r[0]!.text);
    const lastMeasured = Math.max(...cellsOf(t, 'SLA (strict)').flatMap((c, i) => (c.n === null ? [] : [i])));
    expect(names.indexOf('Marked nodata')).toBeGreaterThan(lastMeasured);
  });

  it('keeps the categories and sites in the order the engine gave them', () => {
    const { strict } = sampleSliReports();
    const doc = build((p) => {
      p.strict.categories.reverse();
      p.strict.sites.reverse();
    });
    expect(wordsOf(tableOf(doc, 'By category'), 'Category')).toEqual([...strict.categories].reverse().map((g) => g.name));
    expect(wordsOf(tableOf(doc, 'By site'), 'Site')).toEqual([...strict.sites].reverse().map((g) => g.name));
  });

  it('lists WAN paths by natural name order', () => {
    const t = tableOf(
      build((p) => {
        const names = ['P10', 'P9', 'P2', 'P1'];
        p.strict.wanPaths = p.strict.wanPaths.slice(0, 4).map((w, i) => ({ ...w, name: names[i]!, key: `wan:${names[i]}` }));
      }),
      'WAN paths',
    );
    expect(wordsOf(t, 'Path')).toEqual(['P1', 'P2', 'P9', 'P10']);
  });

  it('lists the devices never measured by site code, then name, with an unassigned one last', () => {
    const t = tableOf(
      build((p) => {
        const base = p.strict.hosts[0]!;
        const extra = [
          hostLike(base, { hostid: 'x1', name: 'Nowhere B', site: null, measured: false }),
          hostLike(base, { hostid: 'x2', name: 'Nowhere A', site: null, measured: false }),
          hostLike(base, { hostid: 'x3', name: 'Site one late', site: { code: 1, name: 'Alder Yard' }, measured: false }),
          hostLike(base, { hostid: 'x4', name: 'Site one early', site: { code: 1, name: 'Alder Yard' }, measured: false }),
        ];
        p.strict.hosts = [...extra, ...p.strict.hosts];
      }),
      'Devices never measured',
    );
    expect(wordsOf(t, 'Device')).toEqual([
      'Site one early',
      'Site one late',
      '3.4.3 SAMPLE SENSOR 03',
      '6.4.2 SAMPLE SENSOR 02',
      '9.3.3 SAMPLE AP 03',
      '12.2.4 SAMPLE SWITCH 04',
      'Nowhere A',
      'Nowhere B',
    ]);
    expect(wordsOf(t, 'Site').slice(-2)).toEqual(['Unassigned', 'Unassigned']);
  });

  it('draws the chart worst site first with unmeasured sites last, whatever order the sites come in', () => {
    const doc = build((p) => {
      p.strict.sites.reverse();
      p.strict.sites[3]!.sli = null;
      p.strict.sites[3]!.withData = 0;
    });
    const bars = doc.chart!.bars;
    const values = bars.map((b) => b.value);
    const firstNull = values.indexOf(null);
    expect(firstNull).toBe(values.length - 1);
    for (let i = 1; i < firstNull; i++) expect(values[i - 1]!).toBeLessThanOrEqual(values[i]!);
    expect(bars[firstNull]).toMatchObject({ text: 'No data', tone: 'muted' });
  });
});

describe('Met, Missed and No data', () => {
  const edge = (sli: number | null, name: string, base: SliHost): SliHost =>
    sli === null ? noDataHost(base, { name }) : hostLike(base, { name, sli, meeting: sli >= TARGET, dataStatus: 'ok' });

  const doc = build((p) => {
    const ok = p.strict.hosts.filter((h) => h.sli !== null);
    const edited = [
      edge(100, 'Edge full', ok[0]!),
      edge(99, 'Edge exact', ok[1]!),
      edge(98.999999, 'Edge just below', ok[2]!),
      edge(98.996, 'Edge rounds up', ok[3]!),
      edge(0, 'Edge zero', ok[4]!),
      edge(null, 'Edge nothing', ok[5]!),
    ];
    const ids = new Set(edited.map((h) => h.hostid));
    p.strict.hosts = [...edited, ...p.strict.hosts.filter((h) => !ids.has(h.hostid))];
  });
  const devices = tableOf(doc, 'By device');
  const strictOf = (name: string) => cellAt(devices, name, 'SLA (strict)');
  const statusOf = (name: string) => cellAt(devices, name, 'Status');

  it.each([
    ['Edge full', '100.00%', 'Met', 'good'],
    ['Edge exact', '99.00%', 'Met', 'good'],
    ['Edge just below', '98.999999%', 'Missed', 'bad'],
    ['Edge rounds up', '98.996%', 'Missed', 'bad'],
    ['Edge zero', '0.00%', 'Missed', 'bad'],
  ] as [string, string, string, Tone][])('%s reads %s, %s', (name, figure, word, tone) => {
    expect(strictOf(name).text).toBe(figure);
    expect(strictOf(name).tone).toBe(tone);
    expect(statusOf(name)).toEqual({ text: word, tone });
  });

  it('a device with nothing measured reads No data in both columns, never 0%', () => {
    expect(strictOf('Edge nothing')).toEqual({ text: 'No data', n: null, tone: 'muted' });
    expect(statusOf('Edge nothing')).toEqual({ text: 'No data', tone: 'muted' });
    expect(cellAt(devices, 'Edge nothing', 'Downtime')).toEqual({ text: 'No data', n: null, tone: 'muted' });
    expect(cellAt(devices, 'Edge nothing', 'Incidents')).toEqual({ text: 'No data', n: null, tone: 'muted' });
    expect(cellAt(devices, 'Edge nothing', 'Longest outage')).toEqual({ text: 'No data', n: null, tone: 'muted' });
  });

  it('the raw figure travels with the text, unrounded, for the workbook', () => {
    expect(strictOf('Edge rounds up').n).toBe(98.996);
    expect(strictOf('Edge just below').n).toBe(98.999999);
  });

  it('uses only the three words, each with its own tone, in every Status column', () => {
    const tones: Record<string, Tone> = { Met: 'good', Missed: 'bad', 'No data': 'muted' };
    let seen = 0;
    for (const t of doc.tables) {
      t.columns.forEach((c, i) => {
        if (c.kind !== 'status') return;
        for (const r of [...t.rows, ...(t.footer ? [t.footer] : [])]) {
          expect(Object.keys(tones), `${t.title}: ${r[i]!.text}`).toContain(r[i]!.text);
          expect(r[i]!.tone, `${t.title}: ${r[0]!.text}`).toBe(tones[r[i]!.text]);
          seen++;
        }
      });
    }
    expect(seen).toBeGreaterThan(150);
  });

  it('judges a group, a path and a web check by the same rule', () => {
    const p = sampleSliReports();
    const word = (v: number | null) => (v === null ? 'No data' : v >= TARGET ? 'Met' : 'Missed');
    const d = buildSlaReportDoc(p.strict, p.hcml, NOW);
    p.strict.sites.forEach((s, i) => expect(tableOf(d, 'By site').rows[i]![col(tableOf(d, 'By site'), 'Status')]!.text, s.name).toBe(word(s.sli)));
    p.strict.wanPaths.forEach((w) => expect(cellAt(tableOf(d, 'WAN paths'), w.name, 'Status').text, w.name).toBe(word(w.sli)));
    p.strict.web.forEach((w) => expect(cellAt(tableOf(d, 'Web checks'), w.name, 'Status').text, w.name).toBe(word(w.sli)));
  });

  it('colours the closing figures of the summary the same way', () => {
    const d = build();
    expect(d.kpis.map((k) => [k.label, k.tone])).toEqual([
      ['Overall SLA (strict)', 'bad'],
      ['Overall SLA (HCML method)', 'good'],
      ['Devices measured', 'warn'],
      ['Sites below target', 'bad'],
    ]);
    expect(d.kpis[0]!.detail).toBe('Target 99% · Missed');
    expect(d.kpis[1]!.detail).toBe('Target 99% · Met');
  });
});

describe('percentText', () => {
  it('prints two decimals', () => {
    expect(percentText(99.384, TARGET)).toBe('99.38%');
    expect(percentText(99.386, TARGET)).toBe('99.39%');
    expect(percentText(100, TARGET)).toBe('100.00%');
    expect(percentText(0, TARGET)).toBe('0.00%');
    expect(percentText(99, TARGET)).toBe('99.00%');
    expect(percentText(99.004, TARGET)).toBe('99.00%');
  });

  it('never lets a figure that fell short read as the target (98.996 against 99)', () => {
    expect(percentText(98.996, 99)).not.toBe('99.00%');
    expect(percentText(98.996, 99)).toBe('98.996%');
    expect(percentText(98.9996, 99)).toBe('98.9996%');
    expect(percentText(98.999999, 99)).toBe('98.999999%');
    expect(percentText(98.994, 99)).toBe('98.99%');
  });

  it('keeps every figure on its own side of the target, over a sweep around it', () => {
    for (const target of [99, 99.5, 95]) {
      for (let v = target - 0.02; v <= target + 0.02; v += 0.00007) {
        const printed = Number(percentText(v, target).replace('%', ''));
        expect(printed >= target, `${v} against ${target} printed as ${printed}`).toBe(v >= target);
        // The extra digits are a last resort: nothing is printed longer than it must be.
        expect(percentText(v, target)).toMatch(/^\d+\.\d{2,8}%$/);
      }
    }
  });

  it('never prints 100.00 for a figure below 100: it cuts to the digits it shows (BK-46)', () => {
    expect(percentText(99.9951, 99)).toBe('99.99%');
    expect(percentText(99.995, 99)).toBe('99.99%');
    expect(percentText(99.99999, 99)).toBe('99.99%');
    expect(percentText(99.994, 99)).toBe('99.99%');
    expect(percentText(100, 99)).toBe('100.00%');
    expect(percentText(99.996, 100)).toBe('99.99%');
    expect(percentText(100, 100)).toBe('100.00%');
  });

  it('does that for every figure from 99.99 up to 100, and for none of the figures below', () => {
    for (let v = 99.99; v < 100; v += 0.0000037) expect(percentText(v, 99), String(v)).toBe('99.99%');
    expect(percentText(99.989, 99)).toBe('99.99%');
    expect(percentText(99.985, 99)).toBe('99.98%');
  });

  it('cuts instead of rounding when even eight decimals reach the target, as the SLA page does', () => {
    expect(percentText(98.999999999, 99)).toBe('98.99999999%');
    expect(percentText(98.99999999999999, 99)).toBe('98.99999999%');
    expect(percentText(98.99999999999999, 99)).not.toBe('99.00%');
  });

  it('shows more digits only when needed, with no trailing zeros', () => {
    expect(percentText(98.996, 99)).toBe('98.996%');
    expect(percentText(98.99961, 99)).toBe('98.9996%');
    expect(percentText(98.999996, 99)).toBe('98.999996%');
    expect(percentText(99.123, 99)).toBe('99.12%');
  });

  it('reads No data for a missing or unusable figure', () => {
    expect(percentText(null, TARGET)).toBe('No data');
    expect(percentText(Number.NaN, TARGET)).toBe('No data');
    expect(percentText(Number.POSITIVE_INFINITY, TARGET)).toBe('No data');
  });

  it('is what the device table prints for a figure that rounds up to the target', () => {
    const t = tableOf(
      build((p) => {
        const h = p.strict.hosts.find((x) => x.sli !== null)!;
        p.strict.hosts = p.strict.hosts.map((x) => (x === h ? hostLike(x, { name: 'Near miss', sli: 98.996, meeting: false }) : x));
      }),
      'By device',
    );
    expect(cellAt(t, 'Near miss', 'SLA (strict)').text).toBe('98.996%');
    expect(cellAt(t, 'Near miss', 'Status').text).toBe('Missed');
  });
});

describe('durationText', () => {
  it.each([
    [0, '0 s'],
    [1, '1 s'],
    [30, '30 s'],
    [59.4, '59 s'],
    [59.6, '1 min'],
    [60, '1 min'],
    [90, '1 min 30 s'],
    [45 * 60, '45 min'],
    [3599.6, '1 h'],
    [3600, '1 h'],
    [3600 + 12 * 60 + 40, '1 h 12 min'],
    [23 * 3600 + 20 * 60, '23 h 20 min'],
    [86400, '1 d'],
    [86400 + 59 * 60, '1 d'],
    [2 * 86400 + 3 * 3600 + 59 * 60, '2 d 3 h'],
    [41 * 86400 + 5 * 3600, '41 d 5 h'],
  ])('%s s is %s', (seconds, text) => {
    expect(durationText(seconds)).toBe(text);
  });

  it('never goes negative and reads No data for a figure that is not a number', () => {
    expect(durationText(-30)).toBe('0 s');
    expect(durationText(Number.NaN)).toBe('No data');
    expect(durationText(Number.POSITIVE_INFINITY)).toBe('No data');
  });

  it('is what the tables print, with the seconds kept in the cell for the workbook', () => {
    const { strict } = sampleSliReports();
    const t = tableOf(build(), 'WAN paths');
    const birch = strict.wanPaths.find((w) => w.name === 'BIRCH')!;
    expect(cellAt(t, 'BIRCH', 'Downtime')).toEqual({ text: durationText(birch.downtime), n: birch.downtime });
  });
});

describe('month and period lines', () => {
  it('a closed month: its name, its first and last minute, and that it is closed', () => {
    const d = build();
    expect(d.subtitle).toBe('August 2026');
    expect(d.period).toBe('1 Aug 2026 00:00 to 31 Aug 2026 23:59 (Asia/Jakarta). Month closed.');
    expect(d.notes[0]!.lines.join(' ')).not.toMatch(/still running/);
  });

  it('an open month: so far, to the last moment measured, and not final', () => {
    const d = build((p) =>
      retime(p, {
        month: '2026-09',
        from: at('2026-09-01T00:00:00+07:00'),
        to: at('2026-10-01T00:00:00+07:00'),
        end: at('2026-09-17T10:05:00+07:00'),
        closed: false,
      }),
    );
    expect(d.subtitle).toBe('September 2026');
    expect(d.period).toBe('Month so far, to 17 Sep 2026 10:05 (Asia/Jakarta). Figures are not final.');
    expect(d.fileBase).toBe('HCML_SLA_Report_2026-09');
    expect(d.footer).toContain('September 2026');
    expect(d.notes[0]!.lines.at(-1)).toBe('This month is still running: figures so far.');
    expectWellFormed(d, 'open month');
  });

  describe('a month still running, whose two methods are cached on their own clocks', () => {
    const open = {
      month: '2026-09',
      from: at('2026-09-01T00:00:00+07:00'),
      to: at('2026-10-01T00:00:00+07:00'),
      end: at('2026-09-17T10:05:00+07:00'),
      closed: false,
    };
    const periodWith = (hcmlEnd: number) =>
      build((p) => {
        retime(p, open);
        p.hcml.end = hcmlEnd;
      }).period;

    it('says where each method ends when they are a minute or more apart', () => {
      expect(periodWith(at('2026-09-17T10:09:00+07:00'))).toBe(
        'Month so far, strict figures to 17 Sep 2026 10:05, HCML method to 17 Sep 2026 10:09 (Asia/Jakarta). Figures are not final.',
      );
      // Either method may be the older one.
      const hcmlOlder = build((p) => {
        retime(p, open);
        p.hcml.end = at('2026-09-17T09:58:00+07:00');
      }).period;
      expect(hcmlOlder).toContain('strict figures to 17 Sep 2026 10:05, HCML method to 17 Sep 2026 09:58');
    });

    it('draws the line at a minute: 59 seconds apart is one moment, 60 seconds apart is two', () => {
      const one = 'Month so far, to 17 Sep 2026 10:05 (Asia/Jakarta). Figures are not final.';
      expect(periodWith(open.end)).toBe(one);
      expect(periodWith(open.end + 59)).toBe(one);
      expect(periodWith(open.end + 60)).toContain('HCML method to 17 Sep 2026 10:06');
    });

    it('leaves a closed month alone, however far apart the two ends are', () => {
      const closed = build((p) => {
        p.hcml.end = p.strict.end + 3600;
      });
      expect(closed.period).toBe(build().period);
      expect(closed.period).toMatch(/Month closed\.$/);
    });
  });

  it('names the month from the report’s own month', () => {
    const d = build((p) => retime(p, { month: '2026-12' }));
    expect(d.subtitle).toBe('December 2026');
    expect(d.fileBase).toBe('HCML_SLA_Report_2026-12');
  });

  it('a report with no month: the days it covers, as a period', () => {
    const d = build((p) => retime(p, { month: null }));
    expect(d.subtitle).toBe('1 Aug 2026 to 31 Aug 2026');
    expect(d.period).toBe('1 Aug 2026 00:00 to 31 Aug 2026 23:59 (Asia/Jakarta). Period closed.');
    expect(d.fileBase).toBe('HCML_SLA_Report_2026-08-01_to_2026-08-31');
    expect(d.footer).toBe('HCML Monitoring Portal · SLA availability report, 1 Aug 2026 to 31 Aug 2026');
    expectWellFormed(d, 'no month');
  });

  it('a report with no month that is still running', () => {
    const d = build((p) => retime(p, { month: null, closed: false, end: at('2026-08-17T10:00:00+07:00') }));
    expect(d.subtitle).toBe('1 Aug 2026 to 17 Aug 2026');
    expect(d.period).toBe('Period so far, to 17 Aug 2026 10:00 (Asia/Jakarta). Figures are not final.');
    expect(d.fileBase).toBe('HCML_SLA_Report_2026-08-01_to_2026-08-17');
    expect(d.notes[0]!.lines.at(-1)).toBe('This period is still running: figures so far.');
  });

  it('a one-day period is named by its day', () => {
    const d = build((p) => retime(p, { month: null, from: at('2026-08-05T00:00:00+07:00'), to: at('2026-08-06T00:00:00+07:00'), end: at('2026-08-06T00:00:00+07:00') }));
    expect(d.subtitle).toBe('5 Aug 2026');
    expect(d.fileBase).toBe('HCML_SLA_Report_2026-08-05_to_2026-08-05');
  });

  it('writes the times in the zone the report was cut in, not the server’s', () => {
    const d = build((p) => retime(p, { timezone: 'UTC' }));
    expect(d.period).toBe('31 Jul 2026 17:00 to 31 Aug 2026 16:59 (UTC). Month closed.');
    expect(d.generated).toBe('Generated 1 Sep 2026 07:20 (UTC)');
  });

  it('writes midnight as 00:00 and rolls the year over in the generated line', () => {
    expect(build(undefined, new Date('2026-08-31T17:00:00Z')).generated).toBe('Generated 1 Sep 2026 00:00 (Asia/Jakarta)');
    expect(build(undefined, new Date('2026-12-31T20:30:00Z')).generated).toBe('Generated 1 Jan 2027 03:30 (Asia/Jakarta)');
  });
});

describe('the HCML-method figure', () => {
  it('is taken from the matching device by hostid, whatever order the HCML report lists its devices in', () => {
    const base = build();
    const shuffled = build((p) => {
      p.hcml.hosts.reverse();
      p.hcml.categories.reverse();
      p.hcml.sites.reverse();
    });
    expect(shuffled.tables).toEqual(base.tables);
  });

  it('matches the device by hostid, not by name', () => {
    const { hcml } = sampleSliReports();
    const worst = tableOf(build(), 'By device').rows[0]![0]!.text;
    const twin = hcml.hosts.find((h) => h.name === worst)!;
    const change = (over: Partial<SliHost>) =>
      tableOf(build((p) => (p.hcml.hosts = p.hcml.hosts.map((h) => (h.hostid === twin.hostid ? hostLike(h, over) : h)))), 'By device');

    // Another name for the same hostid still finds its figure; the same name under another hostid does not.
    expect(cellAt(change({ name: 'Renamed in HCML' }), worst, 'SLA (HCML method)').text).toBe(percentText(twin.sli, TARGET));
    expect(cellAt(change({ hostid: 'other-id' }), worst, 'SLA (HCML method)')).toEqual({ text: 'No data', n: null, tone: 'muted' });
  });

  it('reads No data when the device, the site or the category is missing from the HCML report', () => {
    const { strict } = sampleSliReports();
    const worst = strict.hosts[0]!;
    const doc = build((p) => {
      p.hcml.hosts = p.hcml.hosts.filter((h) => h.hostid !== worst.hostid);
      p.hcml.sites = p.hcml.sites.filter((s) => s.key !== 'site:2');
      p.hcml.categories = p.hcml.categories.filter((c) => c.key !== 'ICMP Ping');
    });
    const gone = { text: 'No data', n: null, tone: 'muted' };
    expect(cellAt(tableOf(doc, 'By device'), worst.name, 'SLA (HCML method)')).toEqual(gone);
    expect(cellAt(tableOf(doc, 'By site'), '2 · Birch Point', 'SLA (HCML method)')).toEqual(gone);
    expect(cellAt(tableOf(doc, 'By category'), 'ICMP Ping', 'SLA (HCML method)')).toEqual(gone);
    // Its neighbours keep theirs, and the strict figures are untouched.
    expect(cellAt(tableOf(doc, 'By site'), '1 · Alder Yard', 'SLA (HCML method)').text).not.toBe('No data');
    expect(cellAt(tableOf(doc, 'By site'), '2 · Birch Point', 'SLA (strict)').text).not.toBe('No data');
  });

  it('reads No data when the HCML report has the device but no figure for it', () => {
    const { strict } = sampleSliReports();
    const target = strict.hosts[3]!;
    const doc = build((p) => (p.hcml.hosts = p.hcml.hosts.map((h) => (h.hostid === target.hostid ? hostLike(h, { sli: null }) : h))));
    expect(cellAt(tableOf(doc, 'By device'), target.name, 'SLA (HCML method)').text).toBe('No data');
  });

  it('shows a device that is completely down as down by the strict method and up by HCML’s', () => {
    const t = tableOf(build(), 'By device');
    const row = t.rows[0]!;
    expect(row[col(t, 'Status')]!.text).toBe('Missed');
    expect(Number(row[col(t, 'SLA (strict)')]!.text.replace('%', ''))).toBeLessThan(95);
    expect(Number(row[col(t, 'SLA (HCML method)')]!.text.replace('%', ''))).toBeGreaterThan(99.9);
  });
});

describe('empty tables', () => {
  const emptyDoc = build((p) => {
    for (const r of [p.strict, p.hcml]) {
      r.hosts = [];
      r.categories = [];
      r.sites = [];
      r.classes = [];
      r.wanPaths = [];
      r.web = [];
      r.gaps = [];
      r.overall = aggregate('overall', 'HCML estate', [], TARGET);
    }
  });

  it('carry a message that says why, and no rows', () => {
    expect(emptyDoc.tables.map((t) => [t.title, t.rows.length, t.empty])).toEqual([
      ['By category', 0, 'No devices were reported for this period.'],
      ['By site', 0, 'No devices were reported for this period.'],
      ['By device', 0, 'No devices were reported for this period.'],
      ['WAN paths', 0, 'No WAN paths were found among the monitored devices.'],
      ['Web checks', 0, 'No web scenarios measured in this period.'],
      ['Devices never measured', 0, 'Every device has collected at least one ping value.'],
    ]);
  });

  it('have no closing row and no chart', () => {
    expect(tableOf(emptyDoc, 'By category').footer).toBeUndefined();
    expect(tableOf(emptyDoc, 'By site').footer).toBeUndefined();
    expect(emptyDoc.chart).toBeUndefined();
  });

  it('say so in the summary instead of printing 0% or NaN', () => {
    expect(emptyDoc.kpis).toEqual([
      { label: 'Overall SLA (strict)', value: 'No data', detail: 'Target 99% · No data', tone: 'muted' },
      { label: 'Overall SLA (HCML method)', value: 'No data', detail: 'Target 99% · No data', tone: 'muted' },
      { label: 'Devices measured', value: '0 of 0', detail: 'No devices reported', tone: 'muted' },
      { label: 'Sites below target', value: '0 of 0', detail: 'Strict method', tone: 'muted' },
    ]);
  });

  it('are still a well formed document', () => {
    expectWellFormed(emptyDoc, 'empty');
  });

  it('every table of the full report also holds a message for when it is empty', () => {
    for (const t of build().tables) expect(t.empty, t.title).toBeTruthy();
  });

  it('a report where nothing was measured prints No data throughout and no 0%', () => {
    const doc = build((p) => {
      p.strict.hosts = p.strict.hosts.map((h) => noDataHost(h));
      p.strict.categories.forEach((g) => Object.assign(g, aggregate(g.key, g.name, p.strict.hosts.filter((h) => h.category === g.key), TARGET)));
      p.strict.sites.forEach((g) => Object.assign(g, aggregate(g.key, g.name, p.strict.hosts.filter((h) => `site:${h.site!.code}` === g.key), TARGET)));
      p.strict.overall = aggregate('overall', 'HCML estate', p.strict.hosts, TARGET);
      p.strict.wanPaths = p.strict.wanPaths.map((w) => ({ ...w, sli: null, dataStatus: 'nodata' as const }));
      p.strict.web = p.strict.web.map((w) => ({ ...w, sli: null, dataStatus: 'nodata' as const }));
    });
    expect(doc.chart).toBeUndefined();
    expect(doc.kpis[0]).toMatchObject({ value: 'No data', tone: 'muted' });
    expect(doc.kpis[3]).toMatchObject({ value: '0 of 14', detail: 'Strict method, 14 without data', tone: 'muted' });
    for (const title of ['By category', 'By site']) {
      const t = tableOf(doc, title);
      expect(wordsOf(t, 'SLA (strict)').every((w) => w === 'No data'), title).toBe(true);
      expect(wordsOf(t, 'Downtime').every((w) => w === 'No data'), title).toBe(true);
      expect(wordsOf(t, 'Status').every((w) => w === 'No data'), title).toBe(true);
    }
    expect(wordsOf(tableOf(doc, 'By device'), 'SLA (strict)').every((w) => w === 'No data')).toBe(true);
    expect(wordsOf(tableOf(doc, 'WAN paths'), 'SLA (strict)').every((w) => w === 'No data')).toBe(true);
    expect(wordsOf(tableOf(doc, 'Web checks'), 'SLA (strict)').every((w) => w === 'No data')).toBe(true);
    expectWellFormed(doc, 'nothing measured');
  });
});

describe('the summary', () => {
  it('names the devices without data, and says the never-measured ones are among them', () => {
    const d = build();
    expect(d.kpis[2]).toEqual({ label: 'Devices measured', value: '131 of 138', detail: '7 without data, 4 of them never measured', tone: 'warn' });
  });

  it('counts devices without data on their own when none was never measured', () => {
    const d = build((p) => (p.strict.hosts = p.strict.hosts.map((h) => (h.measured ? h : hostLike(h, { measured: true })))));
    expect(d.kpis[2]!.detail).toBe('7 without data');
  });

  it('keeps the never-measured count apart if it exceeds the devices without data, rather than nesting a bigger number in a smaller', () => {
    const d = build((p) => {
      const some = p.strict.hosts.filter((h) => h.sli !== null && h.measured).slice(0, 5).map((h) => h.hostid);
      p.strict.hosts = p.strict.hosts.map((h) => (some.includes(h.hostid) ? hostLike(h, { measured: false }) : h));
    });
    expect(d.kpis[2]!.detail).toBe('7 without data, 9 never measured');
  });

  it('says all devices were measured, in good tone, when every one has a figure', () => {
    const d = build((p) => {
      p.strict.overall = { ...p.strict.overall, withData: p.strict.overall.hosts, sli: 99.5, meeting: true };
      p.hcml.overall = { ...p.hcml.overall, sli: 99.6, meeting: true };
      p.strict.hosts = p.strict.hosts.map((h) => hostLike(h, { measured: true }));
      p.strict.sites.forEach((s) => Object.assign(s, { sli: 99.5, meeting: true }));
    });
    expect(d.kpis.map((k) => [k.value, k.detail, k.tone])).toEqual([
      ['99.50%', 'Target 99% · Met', 'good'],
      ['99.60%', 'Target 99% · Met', 'good'],
      ['138 of 138', 'All devices measured', 'good'],
      ['0 of 14', 'Strict method', 'good'],
    ]);
  });

  it('counts the sites below target from their figures, and the ones without data on their own', () => {
    const { strict } = sampleSliReports();
    const d = build((p) => {
      p.strict.sites[5]!.sli = null;
      p.strict.sites[6]!.sli = 80;
      // Exactly at the target is met, so it is not below.
      p.strict.sites[7]!.sli = TARGET;
    });
    const below = strict.sites.filter((s, i) => i !== 5 && i !== 7 && (i === 6 || (s.sli !== null && s.sli < TARGET))).length;
    expect(d.kpis[3]).toMatchObject({ value: `${below} of 14`, detail: 'Strict method, 1 without data', tone: 'bad' });
  });

  it('the overall figures are the estate row of the tables', () => {
    const d = build();
    const footer = tableOf(d, 'By site').footer!;
    expect(footer[col(tableOf(d, 'By site'), 'SLA (strict)')]!.text).toBe(d.kpis[0]!.value);
    expect(footer[col(tableOf(d, 'By site'), 'SLA (HCML method)')]!.text).toBe(d.kpis[1]!.value);
    expect(tableOf(d, 'By category').footer).toEqual(footer);
  });
});

describe('the chart', () => {
  it('plots every site against the target, strict figures, in the report tone', () => {
    const { strict } = sampleSliReports();
    const chart = build().chart!;
    expect(chart.title).toBe('SLA by site, strict method');
    expect(chart.target).toBe(TARGET);
    expect(chart.bars).toHaveLength(14);
    for (const s of strict.sites) {
      const bar = chart.bars.find((b) => b.label === s.name)!;
      expect(bar.value).toBe(s.sli);
      expect(bar.text).toBe(percentText(s.sli, TARGET));
      expect(bar.tone).toBe(s.sli! >= TARGET ? 'good' : 'bad');
    }
  });

  it.each([
    ['at 95 when the worst site sits just under the target', 97.6, 95],
    ['a whole 5 below the worst site', 88.2, 85],
    ['at 0 for a site that is almost never up', 3, 0],
  ])('starts the axis %s', (_why, worst, axisMin) => {
    const chart = build((p) => (p.strict.sites[0]!.sli = worst)).chart!;
    expect(chart.axisMin).toBe(axisMin);
    expect(chart.caption).toBe(`Worst site first, sites with no data last. Bars start at ${axisMin}%. The line marks the 99% target.`);
  });

  it('never starts the axis above 95, even against a target of 100', () => {
    const chart = build((p) => {
      p.strict.target = 100;
      p.strict.sites.forEach((s) => (s.sli = 100));
    }).chart!;
    expect(chart.axisMin).toBe(95);
    expect(chart.caption).toBe('Worst site first, sites with no data last. Bars start at 95%. The line marks the 100% target.');
  });

  it('draws a site with no figure as No data, not as a short bar', () => {
    const chart = build((p) => (p.strict.sites[2]!.sli = null)).chart!;
    const bar = chart.bars.find((b) => b.label === '3 · Cedar / Quay')!;
    expect(bar).toEqual({ label: '3 · Cedar / Quay', value: null, tone: 'muted', text: 'No data' });
  });
});

describe('figures from the fixture reproduce', () => {
  const { strict, hcml } = sampleSliReports();
  const doc = buildSlaReportDoc(strict, hcml, NOW);
  const measured = (hosts: SliHost[]) => hosts.filter((h) => h.sli !== null).map((h) => h.sli as number);

  const spot: [string, () => string, () => string][] = [
    ['overall strict', () => doc.kpis[0]!.value, () => percentText(mean(measured(strict.hosts)), TARGET)],
    ['overall HCML method', () => doc.kpis[1]!.value, () => percentText(mean(measured(hcml.hosts)), TARGET)],
    ['devices measured', () => doc.kpis[2]!.value, () => `${measured(strict.hosts).length} of ${strict.hosts.length}`],
    ['sites below target', () => doc.kpis[3]!.value, () => `${strict.sites.filter((s) => s.sli !== null && s.sli < TARGET).length} of ${strict.sites.length}`],
    [
      'Cisco category, strict',
      () => cellAt(tableOf(doc, 'By category'), 'Cisco IOS by SNMP', 'SLA (strict)').text,
      () => percentText(mean(measured(strict.hosts.filter((h) => h.category === 'Cisco IOS by SNMP'))), TARGET),
    ],
    [
      'Cisco category, HCML method',
      () => cellAt(tableOf(doc, 'By category'), 'Cisco IOS by SNMP', 'SLA (HCML method)').text,
      () => percentText(mean(measured(hcml.hosts.filter((h) => h.category === 'Cisco IOS by SNMP'))), TARGET),
    ],
    [
      'Cisco category, downtime',
      () => cellAt(tableOf(doc, 'By category'), 'Cisco IOS by SNMP', 'Downtime').text,
      () => durationText(sum(strict.hosts.filter((h) => h.category === 'Cisco IOS by SNMP').map((h) => h.downtime))),
    ],
    [
      'Birch Point, devices below target',
      () => cellAt(tableOf(doc, 'By site'), '2 · Birch Point', 'Below target').text,
      () => String(strict.hosts.filter((h) => h.site?.code === 2 && h.sli !== null && h.sli < TARGET).length),
    ],
    [
      'worst device',
      () => tableOf(doc, 'By device').rows[0]![0]!.text,
      () => [...strict.hosts].filter((h) => h.sli !== null).sort((a, b) => a.sli! - b.sli!)[0]!.name,
    ],
    [
      'worst device, HCML method by hostid',
      () => tableOf(doc, 'By device').rows[0]![col(tableOf(doc, 'By device'), 'SLA (HCML method)')]!.text,
      () => {
        const worst = [...strict.hosts].filter((h) => h.sli !== null).sort((a, b) => a.sli! - b.sli!)[0]!;
        return percentText(hcml.hosts.find((h) => h.hostid === worst.hostid)!.sli, TARGET);
      },
    ],
    [
      'Birch WAN path, figure and downtime',
      () => `${cellAt(tableOf(doc, 'WAN paths'), 'BIRCH', 'SLA (strict)').text} ${cellAt(tableOf(doc, 'WAN paths'), 'BIRCH', 'Downtime').text}`,
      () => {
        const p = strict.wanPaths.find((w) => w.name === 'BIRCH')!;
        return `${percentText(p.sli, TARGET)} ${durationText(p.downtime)}`;
      },
    ],
    [
      'public site web check, figure, downtime and coverage',
      () => ['SLA (strict)', 'Downtime', 'Coverage'].map((h) => cellAt(tableOf(doc, 'Web checks'), 'Sample public site', h).text).join(' '),
      () => {
        const w = strict.web.find((x) => x.name === 'Sample public site')!;
        return `${percentText(w.sli, TARGET)} ${durationText(w.downtime)} ${Math.round(w.coverage * 100)}%`;
      },
    ],
  ];

  it.each(spot)('%s', (_what, printed, derived) => {
    expect(printed()).toBe(derived());
  });

  it('every group row is re-derived from its devices, not read from the engine’s group', () => {
    const groups = [
      ['By category', strict.categories, (h: SliHost, key: string) => h.category === key],
      ['By site', strict.sites, (h: SliHost, key: string) => `site:${h.site?.code}` === key],
    ] as const;
    for (const [title, list, owns] of groups) {
      const t = tableOf(doc, title);
      list.forEach((g, i) => {
        const mine = strict.hosts.filter((h) => owns(h, g.key));
        const theirs = hcml.hosts.filter((h) => owns(h, g.key));
        const row = t.rows[i]!;
        const text = (header: string) => row[col(t, header)]!.text;
        expect(text('Devices'), g.name).toBe(String(mine.length));
        expect(text('With data'), g.name).toBe(String(measured(mine).length));
        expect(text('SLA (strict)'), g.name).toBe(percentText(mean(measured(mine)), TARGET));
        expect(text('SLA (HCML method)'), g.name).toBe(percentText(mean(measured(theirs)), TARGET));
        expect(text('Below target'), g.name).toBe(String(measured(mine).filter((v) => v < TARGET).length));
        expect(text('Downtime'), g.name).toBe(durationText(sum(mine.map((h) => h.downtime))));
      });
    }
  });

  it('every device row is its device: figure, status, downtime, incidents, longest outage, coverage', () => {
    const t = tableOf(doc, 'By device');
    expect(t.rows).toHaveLength(strict.hosts.length);
    for (const h of strict.hosts) {
      const row = rowNamed(t, h.hostStatus === '1' ? `${h.name} · disabled` : h.name);
      const text = (header: string) => row[col(t, header)]!.text;
      const twin = hcml.hosts.find((x) => x.hostid === h.hostid)!;
      expect(text('Site'), h.name).toBe(h.site ? `${h.site.code} · ${h.site.name}` : 'Unassigned');
      expect(text('Category'), h.name).toBe(h.category);
      expect(text('SLA (strict)'), h.name).toBe(percentText(h.sli, TARGET));
      expect(text('SLA (HCML method)'), h.name).toBe(percentText(twin.sli, TARGET));
      expect(text('Status'), h.name).toBe(h.sli === null ? 'No data' : h.sli >= TARGET ? 'Met' : 'Missed');
      expect(text('Downtime'), h.name).toBe(h.sli === null ? 'No data' : durationText(h.downtime));
      expect(text('Incidents'), h.name).toBe(h.sli === null ? 'No data' : String(h.incidents));
      expect(text('Longest outage'), h.name).toBe(h.sli === null ? 'No data' : durationText(h.longest));
      expect(text('Coverage'), h.name).toBe(`${Math.round(h.coverage * 100)}%`);
    }
  });

  it('carries coverage as percent points, 0 to 100, in every table, since the workbook formats the number as a percent', () => {
    const device = tableOf(doc, 'By device');
    for (const h of strict.hosts) {
      const n = rowNamed(device, h.hostStatus === '1' ? `${h.name} · disabled` : h.name)[col(device, 'Coverage')]!.n;
      expect(n, h.name).toBeCloseTo(h.coverage * 100, 9);
      expect(n!, h.name).toBeGreaterThanOrEqual(0);
      expect(n!, h.name).toBeLessThanOrEqual(100);
    }
    const wan = tableOf(doc, 'WAN paths');
    for (const w of strict.wanPaths) expect(cellAt(wan, w.name, 'Coverage').n, w.name).toBeCloseTo(w.coverage * 100, 9);
    const web = cellsOf(tableOf(doc, 'Web checks'), 'Coverage').map((c) => c.n);
    expect(web.sort()).toEqual(strict.web.map((w) => w.coverage * 100).sort());
    expect(web.every((n) => typeof n === 'number' && n >= 0 && n <= 100)).toBe(true);
  });

  it('the estate row adds up the same devices as the groups do', () => {
    const t = tableOf(doc, 'By category');
    const footer = t.footer!;
    expect(footer[col(t, 'Devices')]!.text).toBe(String(strict.hosts.length));
    expect(footer[col(t, 'With data')]!.text).toBe(String(measured(strict.hosts).length));
    expect(footer[col(t, 'Below target')]!.text).toBe(String(measured(strict.hosts).filter((v) => v < TARGET).length));
    expect(footer[col(t, 'Downtime')]!.text).toBe(durationText(sum(strict.hosts.map((h) => h.downtime))));
    // The group rows and the estate row count the same devices.
    expect(sum(t.rows.map((r) => Number(r[col(t, 'Devices')]!.text)))).toBe(Number(footer[col(t, 'Devices')]!.text));
    expect(sum(t.rows.map((r) => Number(r[col(t, 'Below target')]!.text)))).toBe(Number(footer[col(t, 'Below target')]!.text));
  });

  it('a group with devices below target flags the count; one with none does not', () => {
    const t = tableOf(doc, 'By site');
    for (const [i, g] of strict.sites.entries()) {
      const cell = t.rows[i]![col(t, 'Below target')]!;
      expect(cell.tone, g.name).toBe(g.belowTarget > 0 ? 'bad' : undefined);
      expect(cell.n, g.name).toBe(g.belowTarget);
    }
  });
});

describe('WAN paths', () => {
  const doc = build();
  const t = tableOf(doc, 'WAN paths');

  it('lists the legs by their own name, with the figure of each', () => {
    expect(cellAt(t, 'ALDER', 'Legs').text).toMatch(/^WAN 1 \d+\.\d+% · WAN 2 \d+\.\d+%$/);
    // The path's name and "INET :" are in their own columns, so they are not repeated.
    expect(cellAt(t, 'ALDER', 'Legs').text).not.toMatch(/INET|ALDER/);
  });

  it('keeps a provider in brackets that the leg carries', () => {
    expect(cellAt(t, 'DUNE', 'Legs').text).toBe('WAN 1 (Provider A) 100.00% · WAN 2 (Provider B) 100.00%');
  });

  it('shows a leg with no data as No data, and the path with it', () => {
    expect(cellAt(t, 'ELM', 'Legs').text).toBe('WAN 1 100.00% · WAN 2 No data');
    expect(cellAt(t, 'ELM', 'SLA (strict)')).toEqual({ text: 'No data', n: null, tone: 'muted' });
    expect(cellAt(t, 'ELM', 'Downtime')).toEqual({ text: 'No data', n: null, tone: 'muted' });
    expect(cellAt(t, 'ELM', 'Status')).toEqual({ text: 'No data', tone: 'muted' });
  });

  it('shows a path down on both legs at once as missed', () => {
    expect(cellAt(t, 'BIRCH', 'Status')).toEqual({ text: 'Missed', tone: 'bad' });
  });

  it('keeps the whole name when it does not start with the path’s', () => {
    const d = build((p) => {
      p.strict.wanPaths[0]!.legs[0]!.name = 'INET : Backup circuit';
      p.strict.wanPaths[0]!.legs[1]!.name = 'something else';
    });
    expect(cellAt(tableOf(d, 'WAN paths'), 'ALDER', 'Legs').text).toMatch(/^Backup circuit [\d.]+% · something else [\d.]+%$/);
  });
});

describe('devices never measured', () => {
  const doc = build();
  const t = tableOf(doc, 'Devices never measured');

  it('says why, in the SLA page’s words', () => {
    expect(cellAt(t, '3.4.3 SAMPLE SENSOR 03', 'Reason').text).toBe('no interface in Zabbix, so the ping check can’t run');
    expect(cellAt(t, '9.3.3 SAMPLE AP 03', 'Reason').text).toBe('host disabled in Zabbix');
  });

  it('names the device as the page does, without a second "disabled" beside the reason', () => {
    expect(wordsOf(t, 'Device').some((n) => /disabled/.test(n))).toBe(false);
    expect(wordsOf(tableOf(doc, 'By device'), 'Device')).toContain('9.3.3 SAMPLE AP 03 · disabled');
  });

  it('lists exactly the devices the strict report says were never measured', () => {
    const { strict } = sampleSliReports();
    expect(new Set(wordsOf(t, 'Device'))).toEqual(new Set(strict.hosts.filter((h) => !h.measured).map((h) => h.name)));
  });
});

describe('the notes', () => {
  const doc = build();
  const [reading, computed] = doc.notes;

  it('has two notes, each under a heading', () => {
    expect(doc.notes.map((n) => n.heading)).toEqual(['How to read this report', 'How it was computed']);
  });

  it('explains why there are two figures, and what Met, Missed and No data mean', () => {
    expect(reading!.lines[0]).toBe(`Why two figures? ${METHOD_NOTE}`);
    const text = reading!.lines.join('\n');
    expect(text).toMatch(/Met means a figure reached the 99% target, Missed means it fell short, and No data means too little was collected/);
    expect(text).toMatch(/The Status columns judge the strict figure/);
    expect(text).toMatch(/never as 0%/);
  });

  it('names the triggers each method counts and what happens to hours and devices without data', () => {
    expect(computed!.lines).toEqual([
      `${DERIVED_BANNER}. Computed in the portal from each device’s ICMP triggers, monthly in Asia/Jakarta time; nothing is written to Zabbix.`,
      'Strict method: a device is down while any of these triggers is in problem: Unavailable by ICMP ping, High ICMP ping loss. HCML’s method counts only High ICMP ping loss.',
      'Hours in which nothing was collected are left out by the strict method and counted as up by HCML’s method.',
      'A device with too little collected data is left out by the strict method and counted as 100% by HCML’s method.',
      'Time inside a planned Zabbix maintenance window is left out by both methods, downtime and total alike.',
      'Estate-wide spans with no collected data, 7 h in all: 8 Aug 03:00 to 06:00, 19 Aug 22:00 to 20 Aug 02:00.',
    ]);
  });

  it('says "by both methods" when both treat a thing the same way', () => {
    const d = build((p) => {
      p.hcml.basis = { ...p.hcml.basis, gapPolicy: 'excluded', noDataPolicy: 'excluded' };
    });
    const lines = d.notes[1]!.lines;
    expect(lines[2]).toBe('Hours in which nothing was collected are left out by both methods.');
    expect(lines[3]).toBe('A device with too little collected data is left out by both methods.');
  });

  it('writes each kind of gap as the page does, with "to" in place of a dash', () => {
    const d = build((p) => {
      p.strict.gaps = [
        { from: at('2026-08-02T00:00:00+07:00'), to: at('2026-08-03T00:00:00+07:00') },
        { from: at('2026-08-08T00:00:00+07:00'), to: at('2026-08-11T00:00:00+07:00') },
        { from: at('2026-08-31T00:00:00+07:00'), to: at('2026-09-02T00:00:00+07:00') },
        { from: at('2026-08-12T10:00:00+07:00'), to: at('2026-08-12T12:30:00+07:00') },
      ];
    });
    expect(d.notes[1]!.lines.at(-1)).toBe(
      'Estate-wide spans with no collected data, 6 d 2 h in all: 2 Aug, 8 to 10 Aug, 31 Aug to 1 Sep, 12 Aug 10:00 to 12:30.',
    );
  });

  it('names the spans declared not measured, which both methods treat as hours with no data', () => {
    const d = build((p) => {
      p.strict.noDataWindows = [{ from: at('2026-08-26T16:10:00+07:00'), to: at('2026-08-26T21:03:00+07:00') }];
    });
    expect(d.notes[1]!.lines.at(-1)).toBe(
      "Declared not measured by the portal's setting SLA_NO_DATA_WINDOWS, and treated as hours with no data by both methods: 26 Aug 16:10 to 21:03.",
    );
  });

  it('leaves the spans line out when nothing was missing, and adds the running line while a month is open', () => {
    const d = build((p) => {
      p.strict.gaps = [];
      p.strict.closed = false;
      p.hcml.closed = false;
      p.strict.end = at('2026-08-20T00:00:00+07:00');
      p.hcml.end = p.strict.end;
    });
    expect(d.notes[1]!.lines.join(' ')).not.toMatch(/Estate-wide/);
    expect(d.notes[1]!.lines).toHaveLength(5);
    expect(d.notes[0]!.lines.at(-1)).toBe('This month is still running: figures so far.');
  });
});

describe('wording shared with the SLA page', () => {
  /** The browser bundle cannot be imported here, so the page's source is read for the sentences it was copied from. */
  const web = new URL('../../../web/src/', import.meta.url);
  const sliSource = new URL('features/sla/Sli.tsx', web);
  const slaSource = new URL('features/sla/Sla.tsx', web);
  // Only a build context without the web folder skips these. A web folder that lacks the files means they moved, and that fails.
  const present = existsSync(web);

  /** The text of `export const NAME = 'a' + 'b';` */
  const literal = (source: string, name: string): string => {
    const m = new RegExp(`export const ${name} =\\s*((?:'[^']*'\\s*\\+?\\s*)+);`).exec(source);
    if (!m) throw new Error(`${name} not found`);
    return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]).join('');
  };

  it.skipIf(!present)('uses the page’s method note and its banner, word for word', () => {
    const sli = readFileSync(sliSource, 'utf8');
    expect(METHOD_NOTE).toBe(literal(sli, 'METHOD_NOTE'));
    expect(DERIVED_BANNER).toBe(literal(sli, 'DERIVED_BANNER'));
  });

  it.skipIf(!present)('uses the page’s reasons, empty messages and running note', () => {
    const sla = readFileSync(slaSource, 'utf8');
    const doc = build();
    const reasons = new Set(wordsOf(tableOf(doc, 'Devices never measured'), 'Reason'));
    expect(reasons).toEqual(new Set(['no interface in Zabbix, so the ping check can’t run', 'host disabled in Zabbix']));
    for (const reason of reasons) expect(sla, reason).toContain(`'${reason}'`);
    expect(sla).toContain('No web scenarios measured in this period.');
    expect(sla).toContain('<strong>Why two figures?</strong>');
    expect(sla).toContain('This month is still running: figures so far.');
    expect(sla).toContain('A redundant path is down only while every leg is down.');
    expect(tableOf(doc, 'WAN paths').caption).toContain('A redundant path is down only while every leg is down.');
    expect(tableOf(doc, 'Web checks').empty).toBe('No web scenarios measured in this period.');
  });
});

describe('file names', () => {
  it('keeps only letters, digits, underscore and hyphen', () => {
    expect(reportFileBase('2026-08')).toBe('HCML_SLA_Report_2026-08');
    const hostile = reportFileBase('../../etc/passwd"\r\nX-Evil: 1; filename=a.exe');
    expect(hostile).toMatch(/^HCML_SLA_Report_[\w-]+$/);
    expect(hostile).not.toMatch(/[./\\"\r\n:; ]/);
  });
});

describe('writing', () => {
  it('uses no em dash or en dash anywhere, whatever shape the report takes', () => {
    const docs = [
      build(),
      build((p) => retime(p, { month: null })),
      build((p) => retime(p, { month: '2026-09', closed: false, end: at('2026-08-20T00:00:00+07:00') })),
    ];
    for (const d of docs) {
      expect(JSON.stringify(d)).not.toMatch(DASH);
    }
    expect(METHOD_NOTE).not.toMatch(DASH);
    expect(DERIVED_BANNER).not.toMatch(DASH);
  });
});
