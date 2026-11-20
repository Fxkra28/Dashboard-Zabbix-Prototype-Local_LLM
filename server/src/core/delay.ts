/**
 * A Zabbix update interval in seconds, read once for the whole portal (BK-95). Two functions of the name had grown apart: the graph cut a flexible interval at its first `;` and the freshness test
 * and the SLA did not, so `10m;30s/1-7,00:00-24:00` was 600 s on the graph and 60 s everywhere else.
 */

/** What an interval with no number in it is taken for: a macro (`{$SNMP.INTERVAL}`), or anything else the portal cannot read. */
export const DEFAULT_DELAY_SECONDS = 60;

const DAY = 86_400;

/**
 * `60`, `1m`, `5m`, `1h`, `30s`, `2d`, `1w`; a flexible interval (`10m;30s/1-7,00:00-24:00`) is the part before its first `;`; a macro or anything else is 60; `0` is 0, which is what a dependent item reports
 * (every SNMP-walk interface metric): it has no interval of its own, and a caller that needs one asks `pollSeconds`.
 */
export function parseDelay(raw: string | undefined): number {
  const first = String(raw ?? '').split(';')[0].trim();
  const m = /^(\d+)([smhdw]?)$/.exec(first);
  if (!m) return DEFAULT_DELAY_SECONDS;
  const mult = { '': 1, s: 1, m: 60, h: 3600, d: DAY, w: 7 * DAY }[m[2] as '' | 's' | 'm' | 'h' | 'd' | 'w'];
  return Number(m[1]) * mult;
}

/** The interval to believe a value for: the item's own, or 60 s for an item that has none (a dependent item), and never under a second. */
export const pollSeconds = (raw: string | undefined): number => Math.max(1, parseDelay(raw) || DEFAULT_DELAY_SECONDS);
