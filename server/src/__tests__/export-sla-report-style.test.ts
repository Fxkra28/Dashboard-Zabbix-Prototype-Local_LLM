import { describe, expect, it } from 'vitest';
import type { SliHost, SliReport } from '../sli/engine.js';
import { buildSlaReportDoc, percentText } from '../export/slaReport.js';
import { DEFAULT_STYLE, type ReportStyle } from '../core/reportChoices.js';
import type { Cell, ReportDoc, Table } from '../export/types.js';
import { sampleSliReports } from './helpers/sliReportFixture.js';

/**
 * What a style changes in the report document and, as much to the point, what it leaves alone. The tables, the
 * summary and the chart say the same thing in every style; only the mark in a decimal and the shape of a date move.
 */

type Pair = { strict: SliReport; hcml: SliReport };

/** 14:20 in Asia/Jakarta, the day after the fixture's month closed. */
const NOW = new Date('2026-09-01T07:20:00Z');
const at = (iso: string) => Date.parse(iso) / 1000;
const style = (over: Partial<ReportStyle> = {}): ReportStyle => ({ ...DEFAULT_STYLE, ...over });

function build(over: Partial<ReportStyle> = {}, edit?: (p: Pair) => void): ReportDoc {
  const p = sampleSliReports();
  edit?.(p);
  return buildSlaReportDoc(p.strict, p.hcml, NOW, style(over));
}

function retime(p: Pair, over: Partial<SliReport>): void {
  Object.assign(p.strict, over);
  Object.assign(p.hcml, over);
}

const hostLike = (base: SliHost, over: Partial<SliHost>): SliHost => ({ ...base, ...over });
const tableOf = (doc: ReportDoc, title: string): Table => doc.tables.find((t) => t.title === title)!;

/** Every cell of a table, row by row with the closing row last, beside the kind of the column it sits in. */
function cellsOf(t: Table): { kind: string; header: string; cell: Cell }[] {
  const rows = t.footer ? [...t.rows, t.footer] : t.rows;
  return rows.flatMap((r) => r.map((cell, i) => ({ kind: t.columns[i]!.kind, header: t.columns[i]!.header, cell })));
}

/** "98.996%" as a comma writes it. Only a dot between two digits is a decimal mark. */
const commaOf = (text: string) => text.replace(/(?<=\d)\.(?=\d)/g, ',');

describe('the default style', () => {
  it('gives the document a report with no style gives', () => {
    const p = sampleSliReports();
    expect(buildSlaReportDoc(p.strict, p.hcml, NOW, DEFAULT_STYLE)).toEqual(buildSlaReportDoc(p.strict, p.hcml, NOW));
  });

  it('writes a decimal with a dot and a date as day, month name and year', () => {
    const doc = build();
    expect(doc.generated).toBe('Generated 1 Sep 2026 14:20 (Asia/Jakarta)');
    expect(doc.period).toBe('1 Aug 2026 00:00 to 31 Aug 2026 23:59 (Asia/Jakarta). Month closed.');
    expect(doc.kpis[0]!.value).toMatch(/^\d+\.\d\d+%$/);
  });
});

describe('percentText with a decimal comma', () => {
  it.each([
    [99.38, 99, '99,38%'],
    [100, 99, '100,00%'],
    [99.9951, 99, '99,99%'],
    [98.996, 99, '98,996%'],
    [98.99998, 99, '98,99998%'],
    [0, 99, '0,00%'],
  ])('writes %s against %s as %s', (value, target, want) => {
    expect(percentText(value, target, 'comma')).toBe(want);
  });

  it('writes a missing figure as No data, which holds no decimal', () => {
    expect(percentText(null, 99, 'comma')).toBe('No data');
    expect(percentText(Number.NaN, 99, 'comma')).toBe('No data');
  });

  it('keeps the digits that keep a figure on its side of the target, and cuts where eight decimals cannot show it', () => {
    expect(percentText(98.999999999, 99, 'comma')).toBe('98,99999999%');
    expect(percentText(98.999999999, 99, 'dot')).toBe('98.99999999%');
  });

  it('is the dot text with the one mark changed, over a sweep around the target', () => {
    for (let v = 98.9; v <= 99.1; v += 0.00037) {
      expect(percentText(v, 99, 'comma')).toBe(percentText(v, 99, 'dot').replace('.', ','));
    }
  });
});

describe('a decimal comma in the document', () => {
  const dot = build();
  const comma = build({ decimal: 'comma' });

  it('changes the text of every percent and nothing else in a table: figure, tone, verdict and structure stay', () => {
    expect(comma.tables.map((t) => t.title)).toEqual(dot.tables.map((t) => t.title));
    for (const [i, t] of comma.tables.entries()) {
      const before = dot.tables[i]!;
      expect(t.columns).toEqual(before.columns);
      expect(t.rows).toHaveLength(before.rows.length);
      const a = cellsOf(t);
      const b = cellsOf(before);
      expect(a).toHaveLength(b.length);
      for (const [j, { cell, kind, header }] of a.entries()) {
        const old = b[j]!.cell;
        const where = `${t.title} / ${header} / row ${j}`;
        expect(cell.n, where).toEqual(old.n);
        expect(cell.tone, where).toEqual(old.tone);
        if (kind === 'percent' || header === 'Legs') expect(cell.text, where).toBe(commaOf(old.text));
        else expect(cell.text, where).toBe(old.text);
      }
    }
  });

  it('writes a comma in every percent that has a decimal, so no percent keeps a dot', () => {
    for (const t of comma.tables) {
      for (const { kind, cell } of cellsOf(t)) if (kind === 'percent') expect(cell.text).not.toMatch(/\./);
    }
    expect(tableOf(comma, 'By device').rows.some((r) => /^\d+,\d+%$/.test(r[3]!.text))).toBe(true);
  });

  it('writes the first page, the chart bars and the legs of a path with a comma too', () => {
    expect(comma.kpis[0]!.value).toBe(commaOf(dot.kpis[0]!.value));
    expect(comma.kpis[1]!.value).toBe(commaOf(dot.kpis[1]!.value));
    expect(comma.kpis.map((k) => k.label)).toEqual(dot.kpis.map((k) => k.label));
    expect(comma.kpis.map((k) => k.tone)).toEqual(dot.kpis.map((k) => k.tone));
    expect(comma.chart!.bars.map((b) => b.text)).toEqual(dot.chart!.bars.map((b) => commaOf(b.text)));
    expect(comma.chart!.bars.map((b) => b.value)).toEqual(dot.chart!.bars.map((b) => b.value));
    expect(cellsOf(tableOf(comma, 'WAN paths')).find((c) => c.header === 'Legs')!.cell.text).toMatch(/^WAN 1 \d+,\d+% · WAN 2 \d+,\d+%$/);
  });

  it('never rewrites a name, however many dots it holds', () => {
    const doc = build({ decimal: 'comma' }, (p) => {
      p.strict.hosts[10] = hostLike(p.strict.hosts[10]!, { name: 'core-1.dc 10.2 v3.14' });
    });
    expect(cellsOf(tableOf(doc, 'By device')).some((c) => c.cell.text === 'core-1.dc 10.2 v3.14')).toBe(true);
  });

  it('keeps the extra digits of a figure that fell short, so it never reads as the target', () => {
    const doc = build({ decimal: 'comma' }, (p) => {
      p.strict.hosts[10] = hostLike(p.strict.hosts[10]!, { name: 'NEAR-MISS', sli: 98.996, dataStatus: 'ok' });
    });
    const row = tableOf(doc, 'By device').rows.find((r) => r[0]!.text === 'NEAR-MISS')!;
    expect(row[3]).toEqual({ text: '98,996%', n: 98.996, tone: 'bad' });
    expect(row[5]).toEqual({ text: 'Missed', tone: 'bad' });
  });

  it('does not change the notes, the title, the footer or the file name of a target that has no decimal', () => {
    expect(comma.notes).toEqual(dot.notes);
    expect(comma.title).toBe(dot.title);
    expect(comma.footer).toBe(dot.footer);
    expect(comma.fileBase).toBe(dot.fileBase);
    expect(comma.subtitle).toBe(dot.subtitle);
  });

  describe('against a target that has a decimal', () => {
    const half = (over: Partial<ReportStyle>) =>
      build(over, (p) => {
        p.strict.target = 99.5;
        p.hcml.target = 99.5;
      });

    it('writes it with the comma in the summary, the reading note and the chart', () => {
      const doc = half({ decimal: 'comma' });
      expect(doc.kpis[0]!.detail).toMatch(/^Target 99,5% · (Met|Missed)$/);
      expect(doc.notes[0]!.lines[1]).toContain('reached the 99,5% target');
      expect(doc.chart!.caption).toMatch(/The line marks the 99,5% target\.$/);
    });

    it('keeps the dot for the dot style', () => {
      const doc = half({ decimal: 'dot' });
      expect(doc.kpis[0]!.detail).toMatch(/^Target 99\.5% · (Met|Missed)$/);
      expect(doc.notes[0]!.lines[1]).toContain('reached the 99.5% target');
    });

    it('hands the chart its target and axis labels already written, so a writer needs no style', () => {
      expect(half({ decimal: 'comma' }).chart).toMatchObject({ targetLabel: 'Target 99,5%', axisLabel: '95%' });
      expect(half({ decimal: 'dot' }).chart).toMatchObject({ targetLabel: 'Target 99.5%', axisLabel: '95%' });
      expect(build().chart).toMatchObject({ targetLabel: 'Target 99%', axisLabel: '95%' });
    });

    it('labels the start of the axis as the chart draws it', () => {
      const doc = build({ decimal: 'comma' }, (p) => (p.strict.sites[0]!.sli = 88.2));
      expect(doc.chart!.axisMin).toBe(85);
      expect(doc.chart!.axisLabel).toBe('85%');
    });
  });
});

describe('the date styles', () => {
  it('numeric writes day, month and year with slashes and keeps the month in words for the report’s name', () => {
    const doc = build({ date: 'numeric' });
    expect(doc.generated).toBe('Generated 01/09/2026 14:20 (Asia/Jakarta)');
    expect(doc.period).toBe('01/08/2026 00:00 to 31/08/2026 23:59 (Asia/Jakarta). Month closed.');
    expect(doc.subtitle).toBe('August 2026');
    expect(doc.footer).toBe('HCML Monitoring Portal · SLA availability report, August 2026');
    expect(doc.fileBase).toBe('HCML_SLA_Report_2026-08');
  });

  it('iso writes year, month and day with hyphens', () => {
    const doc = build({ date: 'iso' });
    expect(doc.generated).toBe('Generated 2026-09-01 14:20 (Asia/Jakarta)');
    expect(doc.period).toBe('2026-08-01 00:00 to 2026-08-31 23:59 (Asia/Jakarta). Month closed.');
    expect(doc.subtitle).toBe('August 2026');
    expect(doc.fileBase).toBe('HCML_SLA_Report_2026-08');
  });

  it.each([
    ['numeric', 'Generated 01/01/2027 03:30 (Asia/Jakarta)'],
    ['iso', 'Generated 2027-01-01 03:30 (Asia/Jakarta)'],
    ['long', 'Generated 1 Jan 2027 03:30 (Asia/Jakarta)'],
  ] as const)('rolls the year over in the %s style', (date, want) => {
    const p = sampleSliReports();
    expect(buildSlaReportDoc(p.strict, p.hcml, new Date('2026-12-31T20:30:00Z'), style({ date })).generated).toBe(want);
  });

  describe('for a month still running', () => {
    const open = {
      month: '2026-09',
      from: at('2026-09-01T00:00:00+07:00'),
      to: at('2026-10-01T00:00:00+07:00'),
      end: at('2026-09-17T10:05:00+07:00'),
      closed: false,
    };
    const periodWith = (date: ReportStyle['date'], hcmlEnd = open.end) =>
      build({ date }, (p) => {
        retime(p, open);
        p.hcml.end = hcmlEnd;
      }).period;

    it('writes where the figures end in the style', () => {
      expect(periodWith('numeric')).toBe('Month so far, to 17/09/2026 10:05 (Asia/Jakarta). Figures are not final.');
      expect(periodWith('iso')).toBe('Month so far, to 2026-09-17 10:05 (Asia/Jakarta). Figures are not final.');
    });

    it('writes both horizons in the style when the two methods end minutes apart', () => {
      expect(periodWith('numeric', at('2026-09-17T10:09:00+07:00'))).toBe(
        'Month so far, strict figures to 17/09/2026 10:05, HCML method to 17/09/2026 10:09 (Asia/Jakarta). Figures are not final.',
      );
      expect(periodWith('iso', at('2026-09-17T10:09:00+07:00'))).toBe(
        'Month so far, strict figures to 2026-09-17 10:05, HCML method to 2026-09-17 10:09 (Asia/Jakarta). Figures are not final.',
      );
    });
  });

  it('writes the days of a report with no month in the style', () => {
    const edit = (p: Pair) => retime(p, { month: null });
    expect(build({ date: 'numeric' }, edit).subtitle).toBe('01/08/2026 to 31/08/2026');
    expect(build({ date: 'iso' }, edit).subtitle).toBe('2026-08-01 to 2026-08-31');
    expect(build({ date: 'iso' }, edit).period).toBe('2026-08-01 00:00 to 2026-08-31 23:59 (Asia/Jakarta). Period closed.');
    expect(build({ date: 'iso' }, edit).footer).toBe('HCML Monitoring Portal · SLA availability report, 2026-08-01 to 2026-08-31');
    // The file is named by ISO days whatever the style, since a name should sort.
    expect(build({ date: 'numeric' }, edit).fileBase).toBe('HCML_SLA_Report_2026-08-01_to_2026-08-31');
  });

  describe('the spans with no data in the computed note', () => {
    const last = (doc: ReportDoc) => doc.notes[1]!.lines.at(-1);
    const gaps = (p: Pair) => {
      p.strict.gaps = [
        { from: at('2026-08-02T00:00:00+07:00'), to: at('2026-08-03T00:00:00+07:00') },
        { from: at('2026-08-08T00:00:00+07:00'), to: at('2026-08-11T00:00:00+07:00') },
        { from: at('2026-08-31T00:00:00+07:00'), to: at('2026-09-02T00:00:00+07:00') },
        { from: at('2026-08-12T10:00:00+07:00'), to: at('2026-08-12T12:30:00+07:00') },
      ];
    };

    it('long keeps the short forms the page uses', () => {
      expect(last(build({ date: 'long' }, gaps))).toBe(
        'Estate-wide spans with no collected data, 6 d 2 h in all: 2 Aug, 8 to 10 Aug, 31 Aug to 1 Sep, 12 Aug 10:00 to 12:30.',
      );
    });

    it('numeric always carries the year, so a span reads one way only', () => {
      expect(last(build({ date: 'numeric' }, gaps))).toBe(
        'Estate-wide spans with no collected data, 6 d 2 h in all: 02/08/2026, 08/08/2026 to 10/08/2026, 31/08/2026 to 01/09/2026, 12/08/2026 10:00 to 12:30.',
      );
    });

    it('iso always carries the year too', () => {
      expect(last(build({ date: 'iso' }, gaps))).toBe(
        'Estate-wide spans with no collected data, 6 d 2 h in all: 2026-08-02, 2026-08-08 to 2026-08-10, 2026-08-31 to 2026-09-01, 2026-08-12 10:00 to 12:30.',
      );
    });

    it('the fixture’s two spans, in each style', () => {
      expect(last(build({ date: 'numeric' }))).toBe(
        'Estate-wide spans with no collected data, 7 h in all: 08/08/2026 03:00 to 06:00, 19/08/2026 22:00 to 20/08/2026 02:00.',
      );
      expect(last(build({ date: 'iso' }))).toBe(
        'Estate-wide spans with no collected data, 7 h in all: 2026-08-08 03:00 to 06:00, 2026-08-19 22:00 to 2026-08-20 02:00.',
      );
    });

    it('the spans declared not measured follow the style as well', () => {
      const declared = (p: Pair) => {
        p.strict.gaps = [];
        p.strict.noDataWindows = [{ from: at('2026-08-26T16:10:00+07:00'), to: at('2026-08-26T21:03:00+07:00') }];
      };
      expect(last(build({ date: 'numeric' }, declared))).toContain('treated as hours with no data by both methods: 26/08/2026 16:10 to 21:03.');
      expect(last(build({ date: 'iso' }, declared))).toContain('treated as hours with no data by both methods: 2026-08-26 16:10 to 21:03.');
    });
  });

  it('changes no figure, verdict, row or colour: the tables, the first page and the chart are the same in every date style', () => {
    const long = build({ date: 'long' });
    for (const date of ['numeric', 'iso'] as const) {
      const doc = build({ date });
      expect(doc.tables).toEqual(long.tables);
      expect(doc.kpis).toEqual(long.kpis);
      expect(doc.chart).toEqual(long.chart);
      expect(doc.notes[0]).toEqual(long.notes[0]);
    }
  });

  it('is independent of the decimal mark: the two choices compose', () => {
    const both = build({ decimal: 'comma', date: 'iso' });
    expect(both.generated).toBe('Generated 2026-09-01 14:20 (Asia/Jakarta)');
    expect(both.kpis[0]!.value).toBe(commaOf(build().kpis[0]!.value));
  });
});

describe('the separator', () => {
  it('belongs to the CSV file alone: it changes nothing in the document', () => {
    expect(build({ separator: 'semicolon' })).toEqual(build());
  });
});
