import { BadRequestError } from '../core/validate.js';
import { buildCsv } from '../export/csv.js';
import { buildPdf } from '../export/pdf.js';
import { buildSlaReportDoc, reportFileBase } from '../export/slaReport.js';
import { DATES, DECIMALS, DEFAULT_STYLE, FORMAT_NAMES, SEPARATORS, styleKey, type Format, type ReportStyle } from '../core/reportChoices.js';
import { CSV_TYPE, PDF_TYPE, XLSX_TYPE, type ReportDoc } from '../export/types.js';
import { buildXlsx } from '../export/xlsx.js';
import type { SliReport } from '../sli/engine.js';

/**
 * The monthly SLA as a file, the figures /api/sli shows, on demand.
 *
 *   GET /api/sli/export?month=YYYY-MM&format=pdf|xlsx|csv[&decimal=dot|comma][&date=long|numeric|iso][&separator=comma|semicolon]
 *
 * It reads both methods through getMonthlySli, so a report the page has
 * already loaded is not computed again. Nothing is kept for long: a file is
 * reused for a few seconds and then built again from the cached figures.
 */

type Builder = (doc: ReportDoc, now: Date, style: ReportStyle) => Buffer;

/** `suffix` ends the file name: the CSV files travel as one zip, and its name says so. */
export const FORMATS: Record<Format, { type: string; suffix: string; build: Builder }> = {
  pdf: { type: PDF_TYPE, suffix: '.pdf', build: (doc, now) => buildPdf(doc, now) },
  xlsx: { type: XLSX_TYPE, suffix: '.xlsx', build: (doc, now) => buildXlsx(doc, now) },
  csv: { type: CSV_TYPE, suffix: '_csv.zip', build: buildCsv },
};

export type { Format };

/** Named from the validated month alone, so no request text reaches a header. */
export const fileNameFor = (month: string, format: Format): string => `${reportFileBase(month)}${FORMATS[format].suffix}`;

/**
 * A build costs about 10 ms of CPU, and a burst of requests would run them back to back with
 * the whole BFF waiting, so repeats inside this window share one file. It is keyed on the two
 * cached reports themselves: a refreshed report starts a new file, and nothing outlives them.
 */
const REUSE_MS = 10_000;
const built = new WeakMap<SliReport, WeakMap<SliReport, Map<string, { at: number; body: Buffer }>>>();

/** Only a CSV has a separator, so a PDF or a workbook asked for with the other one is the same file. */
const keyOf = (format: Format, style: ReportStyle) => (format === 'csv' ? `csv/${styleKey(style)}` : `${format}/${style.decimal}/${style.date}`);

export function fileFor(format: Format, strict: SliReport, hcml: SliReport, now: Date, style: ReportStyle = DEFAULT_STYLE): Buffer {
  let byHcml = built.get(strict);
  if (!byHcml) built.set(strict, (byHcml = new WeakMap()));
  let byKey = byHcml.get(hcml);
  if (!byKey) byHcml.set(hcml, (byKey = new Map()));
  const key = keyOf(format, style);
  const kept = byKey.get(key);
  if (kept && now.getTime() - kept.at < REUSE_MS) return kept.body;
  const body = FORMATS[format].build(buildSlaReportDoc(strict, hcml, now, style), now, style);
  byKey.set(key, { at: now.getTime(), body });
  return body;
}

export function parseFormat(raw: unknown): Format {
  if (raw === 'pdf' || raw === 'xlsx' || raw === 'csv') return raw;
  throw new BadRequestError('format must be "pdf", "xlsx" or "csv".');
}

/** The formats asked for: one to three of them, each once, in the order they are listed everywhere else. */
export function parseFormats(raw: unknown): Format[] {
  const words = 'formats must be a list of "pdf", "xlsx" or "csv".';
  if (!Array.isArray(raw)) throw new BadRequestError(words);
  const asked = raw.map(parseFormat);
  if (asked.length === 0) throw new BadRequestError('Choose at least one format.');
  return FORMAT_NAMES.filter((f) => asked.includes(f));
}

function pick<T extends string>(raw: unknown, allowed: readonly T[], fallback: T, words: string): T {
  if (raw === undefined) return fallback;
  if (typeof raw === 'string' && (allowed as readonly string[]).includes(raw)) return raw as T;
  throw new BadRequestError(words);
}

export function parseStyle(q: { decimal?: unknown; date?: unknown; separator?: unknown }): ReportStyle {
  return {
    decimal: pick(q.decimal, DECIMALS, DEFAULT_STYLE.decimal, 'decimal must be "dot" or "comma".'),
    date: pick(q.date, DATES, DEFAULT_STYLE.date, 'date must be "long", "numeric" or "iso".'),
    separator: pick(q.separator, SEPARATORS, DEFAULT_STYLE.separator, 'separator must be "comma" or "semicolon".'),
  };
}
