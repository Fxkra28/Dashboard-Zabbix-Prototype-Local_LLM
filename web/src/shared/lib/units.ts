/**
 * Zabbix units → human text. Mirrors what the Zabbix frontend does for the
 * units HCML's SNMP templates use:
 *
 *   bps, b/s          ×1000   Kbps Mbps Gbps
 *   B, Bps, B/s       ×1024   KB MB GB (KB/s …)
 *   %                 2 dp, no space before the sign (see PERCENT_DP)
 *   s                 ms below 1 s, then s / min / h
 *   uptime            3d 4h
 *   unixtime          date-time in the report zone, with its label (time.ts)
 */

import { formatDateTime } from './time';

const DECIMAL = ['', 'K', 'M', 'G', 'T', 'P'];

/**
 * One rule for a percentage on every page: the sign sits against the number, and each
 * measure has one number of decimals, so the same figure reads the same wherever it appears.
 * `availability` is two to match the downloaded SLA report; the guarded Met/Missed text in
 * features/sla/percent.ts starts from it and adds digits only to stay on the right side of the target.
 */
export const PERCENT_DP = {
  /** A Zabbix item whose unit is %, as formatValue prints it. */
  item: 2,
  loss: 2,
  availability: 2,
  /** A port's share of its speed. */
  utilisation: 1,
} as const;

export type PercentMeasure = keyof typeof PERCENT_DP;

/** `value.toFixed(digits)`, except that a figure below 100 is cut and never rounded up to read as 100. */
export function fixedBelow100(value: number, digits: number): string {
  const text = value.toFixed(digits);
  if (value >= 100 || Number(text) < 100) return text;
  const scale = 10 ** digits;
  return (Math.trunc(value * scale) / scale).toFixed(digits);
}

export function formatPercent(v: number | null | undefined, measure: PercentMeasure): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${measure === 'availability' ? fixedBelow100(v, PERCENT_DP[measure]) : v.toFixed(PERCENT_DP[measure])}%`;
}

function trim(n: number, dp: number): string {
  const fixed = n.toFixed(dp);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** A plain number with a sensible number of decimals. */
function plain(n: number): string {
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs >= 1000) return Math.round(n).toLocaleString('en-US');
  if (abs >= 100) return trim(n, 1);
  if (abs >= 1) return trim(n, 2);
  if (abs >= 0.01) return trim(n, 3);
  return n.toPrecision(2);
}

const decimalsOf = (v: number, level: number): number => (Math.abs(v) >= 100 || level === 0 ? (Number.isInteger(v) ? 0 : 1) : 2);

function scaled(n: number, base: 1000 | 1024, unit: string): string {
  let i = 0;
  let v = n;
  // Rounded first: 999.999 Kbps prints as 1000, so it is 1 Mbps.
  while (i < DECIMAL.length - 1 && Math.abs(Number(trim(v, decimalsOf(v, i)))) >= base) {
    v /= base;
    i++;
  }
  return `${trim(v, decimalsOf(v, i))} ${DECIMAL[i]}${unit}`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.round(Math.abs(totalSeconds));
  const sign = totalSeconds < 0 ? '-' : '';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${sign}${d}d${h ? ` ${h}h` : ''}`;
  if (h) return `${sign}${h}h${m ? ` ${m}m` : ''}`;
  if (m) return `${sign}${m}m${s % 60 ? ` ${s % 60}s` : ''}`;
  return `${sign}${s}s`;
}

/**
 * Seconds → the coarsest unit that still reads naturally: 45s, 12m, 3.5h, 2.1d.
 * A negative value keeps its sign (an overspent error budget).
 */
export function dur(totalSeconds: number): string {
  const s = Math.abs(Math.round(totalSeconds));
  const sign = Math.round(totalSeconds) < 0 ? '−' : '';
  if (s < 60) return `${sign}${s}s`;
  // Each unit is chosen on the rounded figure: 3,599 s is 60m as minutes, so it is 1.0h.
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${sign}${minutes}m`;
  const hours = (s / 3600).toFixed(1);
  if (Number(hours) < 24) return `${sign}${hours}h`;
  return `${sign}${(s / 86400).toFixed(1)}d`;
}

/** Milliseconds, and seconds, minutes and hours after them: each is used while its rounded figure stays below the next unit. */
function seconds(n: number): string {
  const abs = Math.abs(n);
  if (abs === 0) return '0 s';
  if (abs < 1) {
    const ms = trim(n * 1000, abs * 1000 >= 100 ? 0 : abs * 1000 >= 10 ? 1 : 2);
    if (Math.abs(Number(ms)) < 1000) return `${ms} ms`;
  }
  const s = trim(n, 2);
  if (abs < 60 && Math.abs(Number(s)) < 60) return `${s} s`;
  const min = trim(n / 60, 1);
  if (abs < 3600 && Math.abs(Number(min)) < 60) return `${min} min`;
  return `${trim(n / 3600, 1)} h`;
}

/** The last moment a Date can hold, in milliseconds. */
const LAST_MOMENT_MS = 8.64e15;

export function formatValue(v: number | null | undefined, units?: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const u = (units ?? '').trim();
  switch (u) {
    case 'bps':
    case 'b/s':
      return scaled(v, 1000, 'bps');
    case 'B':
      return scaled(v, 1024, 'B');
    case 'Bps':
    case 'B/s':
      return scaled(v, 1024, 'B/s');
    case '%':
      return formatPercent(v, 'item');
    case 's':
      return seconds(v);
    case 'ms': {
      const ms = trim(v, v >= 100 ? 0 : 2);
      return v < 1000 && Math.abs(Number(ms)) < 1000 ? `${ms} ms` : seconds(v / 1000);
    }
    case 'uptime':
      return formatDuration(v);
    case 'unixtime':
      if (!(v > 0)) return '—';
      // Past the last moment a Date can hold, formatting throws and the page drops to its error card (FR-39): the number is shown instead.
      return v * 1000 > LAST_MOMENT_MS ? plain(v) : formatDateTime(v * 1000);
    case '':
      return plain(v);
    default:
      return `${plain(v)} ${u}`;
  }
}

/** Short axis label: same families, fewer decimals. */
export function formatAxis(v: number, units?: string): string {
  const u = (units ?? '').trim();
  if (u === '%') return `${trim(v, 1)}%`;
  if (u === 'unixtime') return formatValue(v, '');
  return formatValue(v, u);
}
