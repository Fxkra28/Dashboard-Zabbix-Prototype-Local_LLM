/**
 * The report document model. The SLA report is built once as a ReportDoc
 * (slaReport.ts) and both writers turn that same value into a file: pdf.ts
 * and xlsx.ts. Neither writer knows anything about SLAs, targets or Zabbix;
 * every figure arrives already formatted, with the colour it should take.
 * That keeps the two files saying the same thing, and keeps the writers
 * reusable for the next report.
 */

/** Which of the portal's status colours a figure takes (theme.ts). `none` is plain text. */
export type Tone = 'good' | 'warn' | 'bad' | 'muted' | 'none';

export type ColumnKind =
  /** Words: a name, a site, a reason. Left aligned. */
  | 'text'
  /** An availability figure, 0 to 100. Right aligned. */
  | 'percent'
  /** A span in seconds. Right aligned. */
  | 'duration'
  /** A whole number. Right aligned. */
  | 'count'
  /** A verdict in words, such as Met, Missed or No data. Centred. */
  | 'status';

export interface Column {
  header: string;
  kind: ColumnKind;
  /**
   * Relative width. The PDF scales the weights to the printable width, the
   * workbook to character widths, so only the ratios matter.
   */
  weight: number;
}

export interface Cell {
  /**
   * What a person reads. Always set, so a missing figure still reads "No data"
   * rather than showing an empty box.
   */
  text: string;
  /**
   * The raw figure for the workbook, which stores numbers as numbers so they
   * sort and total: a percent as 0 to 100, a duration in seconds, a count as
   * is. Omitted for text and status cells, and null when there is no figure.
   */
  n?: number | null;
  tone?: Tone;
}

export interface Table {
  title: string;
  /** One line under the title: what the table holds and how it is ordered. */
  caption?: string;
  /**
   * The sheet's tab name in the workbook. Unique within the document, at most
   * 31 characters, none of [ ] : * ? / \
   */
  sheet: string;
  columns: Column[];
  /** Each row has exactly one cell per column. */
  rows: Cell[][];
  /** An optional closing row, drawn as a summary. */
  footer?: Cell[];
  /** Shown in place of the table when there are no rows. */
  empty?: string;
}

export interface Kpi {
  label: string;
  /** The big figure, for example "99.38%". */
  value: string;
  /** A short line under it, for example "Target 99% · Met". */
  detail?: string;
  tone: Tone;
}

export interface Bar {
  label: string;
  /** 0 to 100; null, or a number that is not finite, draws no bar and the word "No data". */
  value: number | null;
  tone: Tone;
  /** The figure as printed beside the bar. */
  text: string;
}

/** Horizontal bars against a target line. Drawn by the PDF; the workbook carries the same figures in its tables. */
export interface BarChart {
  title: string;
  caption?: string;
  /** Where the target line sits, 0 to 100. A number that is not finite draws no line. */
  target: number;
  /** The axis starts here, since availability figures crowd the top of a 0 to 100 scale. Not finite means 0. */
  axisMin: number;
  /** The target as printed above its line, such as "Target 99%". Absent: the writer prints the number. */
  targetLabel?: string;
  /** The start of the axis as printed under it, such as "95%". Absent: the writer prints the number. */
  axisLabel?: string;
  bars: Bar[];
}

export interface Note {
  heading: string;
  lines: string[];
}

export interface ReportDoc {
  /** For example "SLA availability report". */
  title: string;
  /** For example "August 2026". */
  subtitle: string;
  /** The window the figures cover, with its time zone. */
  period: string;
  /** For example "Generated 1 Oct 2026 14:20, Asia/Jakarta". */
  generated: string;
  /** The line the page footer carries before the page number. */
  footer: string;
  /** File name without its extension, for example "HCML_SLA_Report_2026-08". */
  fileBase: string;
  kpis: Kpi[];
  chart?: BarChart;
  /** The tables, in reading order. */
  tables: Table[];
  /** How to read the report and how it was computed. */
  notes: Note[];
}

export const PDF_TYPE = 'application/pdf';
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** The CSV files travel in one zip. */
export const CSV_TYPE = 'application/zip';


/** What a table with no rows says when it names nothing of its own. */
export const NOTHING_TO_LIST = 'Nothing to list.';
