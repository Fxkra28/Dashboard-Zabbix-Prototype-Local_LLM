/**
 * What a report is asked for, which is all the base layer needs to know of it: the kinds of file it comes in, and how it is
 * written (the mark inside a decimal, the shape of a date, and what a CSV file puts between its fields). A style never changes
 * a figure, a verdict or the order of anything.
 */

/** The file kinds the report comes in, in the order they are listed and attached. */
export const FORMAT_NAMES = ['pdf', 'xlsx', 'csv'] as const;
export type Format = (typeof FORMAT_NAMES)[number];

export const DECIMALS = ['dot', 'comma'] as const;
export const DATES = ['long', 'numeric', 'iso'] as const;
export const SEPARATORS = ['comma', 'semicolon'] as const;

export interface ReportStyle {
  decimal: (typeof DECIMALS)[number];
  date: (typeof DATES)[number];
  separator: (typeof SEPARATORS)[number];
}

/** What every report was written in before styles existed. */
export const DEFAULT_STYLE: ReportStyle = { decimal: 'dot', date: 'long', separator: 'comma' };

export const styleKey = (s: ReportStyle): string => `${s.decimal}/${s.date}/${s.separator}`;
