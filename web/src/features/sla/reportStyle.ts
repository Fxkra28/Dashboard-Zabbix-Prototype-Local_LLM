import type { ReportStyle } from '../../types';

/**
 * The style a person picked for the report files, kept in this browser alone: a preference, like the theme, and not
 * portal data. Every access is guarded, since a private window throws on write, and every value read back is checked,
 * since anything can be in storage.
 */

export const DEFAULT_REPORT_STYLE: ReportStyle = { decimal: 'dot', date: 'long', separator: 'comma' };

export const REPORT_STYLE_KEY = 'hcml.report-style';

export const DECIMAL_CHOICES: { value: ReportStyle['decimal']; label: string }[] = [
  { value: 'dot', label: 'Dot, as in 99.38%' },
  { value: 'comma', label: 'Comma, as in 99,38%' },
];

export const DATE_CHOICES: { value: ReportStyle['date']; label: string }[] = [
  { value: 'long', label: '4 Nov 2026' },
  { value: 'numeric', label: '04/11/2026 (day, month, year)' },
  { value: 'iso', label: '2026-11-04 (year, month, day)' },
];

export const SEPARATOR_CHOICES: { value: ReportStyle['separator']; label: string }[] = [
  { value: 'comma', label: 'Comma' },
  { value: 'semicolon', label: 'Semicolon' },
];

function choose<T extends string>(raw: unknown, choices: { value: T }[], fallback: T): T {
  return choices.find((c) => c.value === raw)?.value ?? fallback;
}

export function readReportStyle(): ReportStyle {
  let kept: unknown;
  try {
    const text = localStorage.getItem(REPORT_STYLE_KEY);
    kept = text === null ? null : JSON.parse(text);
  } catch {
    kept = null;
  }
  const saved = kept !== null && typeof kept === 'object' && !Array.isArray(kept) ? (kept as Record<string, unknown>) : {};
  return {
    decimal: choose(saved.decimal, DECIMAL_CHOICES, DEFAULT_REPORT_STYLE.decimal),
    date: choose(saved.date, DATE_CHOICES, DEFAULT_REPORT_STYLE.date),
    separator: choose(saved.separator, SEPARATOR_CHOICES, DEFAULT_REPORT_STYLE.separator),
  };
}

export function writeReportStyle(style: ReportStyle): void {
  try {
    localStorage.setItem(REPORT_STYLE_KEY, JSON.stringify({ decimal: style.decimal, date: style.date, separator: style.separator }));
  } catch {
    // Storage is unavailable or full; the style lasts this page only.
  }
}

/** One line for a dialog that writes in the person's style: "Style: decimal dot, dates like 4 Nov 2026, CSV separated by commas." */
export function styleSentence(style: ReportStyle, withCsv: boolean): string {
  const example = DATE_CHOICES.find((c) => c.value === style.date)?.label.replace(/ \(.*\)$/, '') ?? '';
  const csv = withCsv ? `, CSV separated by ${style.separator === 'comma' ? 'commas' : 'semicolons'}` : '';
  return `Style: decimal ${style.decimal === 'dot' ? 'dot' : 'comma'}, dates like ${example}${csv}.`;
}
