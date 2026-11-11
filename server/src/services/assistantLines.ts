/**
 * Zabbix facts as plain prompt lines: text on one line that cannot forge the data fence, ages in a few characters, problem lines, and a block
 * of lines that stops at its character budget and says how much it left out.
 */

import { SEVERITY_NAMES, type ZbxProblem } from '../domain/queries.js';

/** Longest host or site name, and longest problem or service name, that goes into a prompt. */
export const HOST_NAME_MAX = 80;

export const PROBLEM_NAME_MAX = 200;

/**
 * Zabbix text as one plain line: control characters and line breaks become spaces, invisible format
 * characters go, "~~~" (the data fence) cannot occur; cut to `max` characters, with "…" when cut.
 */
export function promptText(value: unknown, max = Infinity): string {
  const flat = String(value ?? '')
    .replace(/[\p{Cc}\u2028\u2029]/gu, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/~{3,}/g, '~')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...flat];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : flat;
}

/**
 * A compact age for the snapshot: "45 min", "3h", "2d", "7d 23h". Whole hours are rounded before
 * splitting into days, so 7d 23h 45m reads "8d", never "7d 24h". Minutes are "min", not "m": a
 * model read a host down for "6m" as down for about 6 months.
 */
export function age(clock: string | number, nowSeconds: number): string {
  const s = Math.max(0, nowSeconds - Number(clock));
  if (s < 3600 - 30) return `${Math.round(s / 60)} min`;
  const hours = Math.max(1, Math.round(s / 3600));
  if (hours < 24) return `${hours}h`;
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${d}d ${h}h` : `${d}d`;
}

/** Whole days past 48 h: "80d" says as much as "80d 20h" in fewer characters. */
export function downFor(clock: number, now: number): string {
  return now - clock >= 172_800 ? `${Math.round((now - clock) / 86_400)}d` : age(clock, now);
}

export const sevName = (sev: string | number) => SEVERITY_NAMES[String(sev)] ?? `severity ${sev}`;

/**
 * One titled block of whole lines, never longer than `budget` characters.
 * Lines are added in order until the next one (plus the "…and N more" tail it
 * would need) no longer fits; the tail then says how much was left out, so the
 * model never mistakes a partial list for the whole.
 */
export function section(
  title: string,
  lines: string[],
  budget: number,
  more: (left: number, shown: number) => string = (left) => `- …and ${left} more`,
  total = lines.length,
): { text: string; truncated: boolean } {
  let text = title;
  let shown = 0;
  for (const line of lines) {
    const left = total - shown - 1;
    const tail = left > 0 ? `\n${more(left, shown + 1)}` : '';
    if (text.length + 1 + line.length + tail.length > budget) break;
    text += `\n${line}`;
    shown++;
  }
  const left = total - shown;
  if (left > 0) {
    const tail = more(left, shown);
    // A tail that cannot fit even alone is dropped rather than overflowing.
    if (text.length + 1 + tail.length <= budget) text += `\n${tail}`;
  }
  return { text, truncated: left > 0 };
}

export function severityCounts(problems: ZbxProblem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of problems) counts[p.severity] = (counts[p.severity] ?? 0) + 1;
  return counts;
}

/** "Disaster 0, High 10, Average 31, Warning 600", worst first. */
export function severityList(counts: Record<string, number>, skipZero = false): string {
  return ['5', '4', '3', '2', '1', '0']
    .filter((s) => !skipZero || counts[s])
    .map((s) => `${sevName(s)} ${counts[s] ?? 0}`)
    .join(', ');
}

export function problemLine(p: ZbxProblem, now: number): string {
  const live = p.opdata && p.opdata.length <= 30 ? promptText(p.opdata, 30) : '';
  const opdata = live ? ` (${live})` : '';
  const ack = p.acknowledged === '1' ? 'acked' : 'not acked';
  const host = promptText(p.host, HOST_NAME_MAX) || 'unknown host';
  return `- [${sevName(p.severity)}] ${host}: ${promptText(p.name, PROBLEM_NAME_MAX)}${opdata}; open ${age(p.clock, now)}, ${ack}`;
}

/** Worst first, then newest. */
export const worstFirst = (a: ZbxProblem, b: ZbxProblem) =>
  Number(b.severity) - Number(a.severity) || Number(b.clock) - Number(a.clock);
