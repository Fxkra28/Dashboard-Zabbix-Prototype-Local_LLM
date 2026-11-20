/**
 * The internet links as prompt lines: the gauges of the Zabbix dashboard that the Internet view of the Dashboard draws (meters.ts), worded as that page words them, so that an answer
 * about a link's traffic matches what the page shows. A link with no reading is said to have none and never read as idle.
 */

import { siteFromHostName, type SiteRef } from '../domain/naming.js';
import { age, HOST_NAME_MAX, promptText, section } from './assistantLines.js';
import { metersView, type Meter } from './meters.js';

const PREFIXES = ['', 'K', 'M', 'G', 'T', 'P'];

const trim = (n: number, decimals: number): string => {
  const fixed = n.toFixed(decimals);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
};

/** As the page rounds: whole when whole, one decimal from 100 up, two below. */
const decimalsOf = (v: number, level: number): number => (Math.abs(v) >= 100 || level === 0 ? (Number.isInteger(v) ? 0 : 1) : 2);

/** A bit rate with its prefix. Rounded first, so that 999.999 Kbps prints as 1 Mbps. */
function scaled(n: number): string {
  let level = 0;
  let v = n;
  while (level < PREFIXES.length - 1 && Math.abs(Number(trim(v, decimalsOf(v, level)))) >= 1000) {
    v /= 1000;
    level++;
  }
  return `${trim(v, decimalsOf(v, level))} ${PREFIXES[level]}bps`;
}

/** A value with its unit; a bit rate scaled the way the Internet page scales it, any other unit as given. */
export function rateText(value: number, units: string): string {
  const unit = promptText(units, 20);
  if (unit === 'bps' || unit === 'b/s') return scaled(value);
  return `${value} ${unit}`.trim();
}

const LEVEL_WORD = { warn: 'High', critical: 'Critical' } as const;

type Direction = 'in' | 'out' | 'traffic';

interface Reading {
  direction: Direction;
  value: number;
  zone: Meter['zone'];
}

/** The value of each direction the gauge has, in before out. */
function readingsOf(m: Meter): Reading[] {
  const own = m.value === null ? [] : [{ direction: (m.direction ?? 'traffic') as Direction, value: m.value, zone: m.zone }];
  const other = m.other && m.other.value !== null ? [{ direction: m.other.direction as Direction, value: m.other.value, zone: m.other.zone }] : [];
  return [...own, ...other].sort((a, b) => Number(b.direction === 'in') - Number(a.direction === 'in'));
}

const capacityOf = (m: Meter): string | null => (m.max !== null && m.max > m.min ? rateText(m.max, m.units) : null);

/** How far along the scale a value is, in percent, not held to 100: a link over its capacity says so. */
const shareOf = (value: number, m: Meter): number | null => (m.max !== null && m.max > m.min ? Math.round(((value - m.min) / (m.max - m.min)) * 100) : null);

/** The readings as the line gives them: "in 25.6 Mbps (85% of 30 Mbps, Critical), out 2.9 Mbps (10%)"; the capacity is said once, with the first. */
function readingWords(m: Meter): string {
  return readingsOf(m)
    .map((r, i) => {
      const share = shareOf(r.value, m);
      const capacity = i === 0 ? capacityOf(m) : null;
      const level = r.zone === 'warn' || r.zone === 'critical' ? LEVEL_WORD[r.zone] : null;
      const inside = [share === null ? null : `${share}%${capacity ? ` of ${capacity}` : ''} used`, level].filter(Boolean).join(', ');
      return `${r.direction} ${rateText(r.value, m.units)}${inside ? ` (${inside})` : ''}`;
    })
    .join(', ');
}

/** What a gauge says when it has no reading: the same reasons, in the same words, as the page. */
function noReading(m: Meter, why: string): string {
  const capacity = capacityOf(m);
  return `no reading, ${why}${capacity ? ` (capacity ${capacity})` : ''}`;
}

/** One link as one prompt line. `site` is the name of the site it belongs to, when it is not said by the block the line is in. */
export function internetLine(m: Meter, now: number, site?: string | null): string {
  const name = `${promptText(m.title, HOST_NAME_MAX)}${site ? ` (${promptText(site, HOST_NAME_MAX)})` : ''}`;
  return `- ${name}: ${bodyOf(m, now)}`;
}

function bodyOf(m: Meter, now: number): string {
  // A dead link reads 0 like an idle one, so this comes before the reading's own words.
  if (m.link === 'down') {
    const capacity = capacityOf(m);
    return `interface down, not an idle link${capacity ? ` (capacity ${capacity})` : ''}`;
  }
  const words = readingWords(m);
  switch (m.state) {
    case 'ok':
      return words || noReading(m, 'no value has been collected yet');
    case 'stale':
      return `${m.clock === null ? 'old reading' : `old reading from ${age(m.clock, now)} ago`}${words ? `, ${words}` : ''}`;
    case 'invalid':
      return `${words ? `${words}, ` : 'no reading, '}the gauge has no usable capacity`;
    case 'nodata':
      return noReading(m, 'no value has been collected yet');
    case 'unsupported':
      return noReading(m, 'the item is disabled or not supported in Zabbix');
    case 'missing':
      return noReading(m, 'the dashboard gauge points at an item that no longer exists');
  }
}

/** The site the gauge's host belongs to, by `siteOf` (the host's name alone when none is given); none for a gauge whose item is gone. */
export const siteOfMeter = (m: Meter, siteOf: (hostName: string) => SiteRef | null = siteFromHostName): string | null => (m.host ? (siteOf(m.host)?.name ?? null) : null);

const hasReading = (m: Meter): boolean => m.link !== 'down' && (m.state === 'ok' || m.state === 'stale') && m.value !== null;

const levelOf = (m: Meter): number => {
  const zones = [m.zone, m.other?.zone];
  return zones.includes('critical') ? 2 : zones.includes('warn') ? 1 : 0;
};

const busyness = (m: Meter): number => Math.max(m.fraction ?? 0, m.other?.fraction ?? 0);

/** Names and how many of each, in the order met, cut at about `chars` with how many more. */
function countedNames(names: string[], chars: number): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const all = [...counts.entries()].map(([n, c]) => (c > 1 ? `${n} (${c})` : n));
  let out = '';
  let shown = 0;
  for (const item of all) {
    const next = shown ? `${out}, ${item}` : item;
    if (shown && next.length > chars) break;
    out = next;
    shown++;
  }
  return shown < all.length ? `${out} +${all.length - shown} more` : out;
}

export interface InternetSectionOptions {
  now: number;
  /** The time the gauges were read, as the snapshot writes a time. */
  readAt: string;
  siteOf: (m: Meter) => string | null;
  budget: number;
}

/**
 * The part of the snapshot about the links: how many there are and how many have a reading, then a link that is down, those High or Critical in either direction, what has no reading, and
 * the busiest of the rest, in whole lines until the budget is spent. The links of one site are in its FOCUS block (assistantFocus.ts), so a long list is not needed here.
 */
export function internetSection(meters: Meter[], { now, readAt, siteOf, budget }: InternetSectionOptions): { text: string; truncated: boolean } | null {
  if (!meters.length) return null;
  const down = meters.filter((m) => m.link === 'down');
  const read = meters.filter(hasReading);
  const unread = meters.filter((m) => m.link !== 'down' && !hasReading(m));
  const high = read.filter((m) => levelOf(m) > 0).sort((a, b) => levelOf(b) - levelOf(a) || busyness(b) - busyness(a));
  const rest = read.filter((m) => levelOf(m) === 0).sort((a, b) => busyness(b) - busyness(a));
  const line = (m: Meter) => internetLine(m, now, siteOf(m));
  const level = read.length ? `, ${high.length ? `${high.length} High or Critical` : 'none High or Critical'}` : '';
  const title =
    `INTERNET LINKS (${meters.length} gauge${meters.length === 1 ? '' : 's'} on the Zabbix dashboard, read ${readAt}: ${read.length} with a reading${level}, ${meters.length - read.length} without one` +
    `${down.length ? `, ${down.length} down` : ''}; in is received, out is sent, both now):`;
  const lines = [
    ...down.map(line),
    ...high.map(line),
    ...(unread.length ? [`- No reading now (${unread.length} link${unread.length === 1 ? '' : 's'}): ${countedNames(unread.map((m) => siteOf(m) ?? promptText(m.title, HOST_NAME_MAX)), 160)}`] : []),
    ...rest.map(line),
  ];
  // A tail with no number: the lines are not links one for one, and a wrong count is worse than none.
  return section(title, lines, budget, () => '- …and more links, not listed here (a question naming their site lists them)');
}

/** The FOCUS lines for one site's links: every one of them, whatever its state. `read` is whether the gauges were read at all, so that "none" is only said when it is known. */
export function internetFocusLines(meters: Meter[], now: number, read: boolean): string[] {
  if (!meters.length) return read ? ['Internet links: none, no gauge of the Zabbix dashboard is for this site'] : [];
  const down = meters.filter((m) => m.link === 'down').length;
  const readings = meters.filter(hasReading);
  const high = readings.filter((m) => levelOf(m) > 0).length;
  const unread = meters.length - readings.length - down;
  const said = [down ? `${down} down` : '', readings.length ? (high ? `${high} High or Critical` : 'none High or Critical') : '', unread ? `${unread} with no reading` : ''].filter(Boolean);
  return [`Internet links (${meters.length}${said.length ? `; ${said.join(', ')}` : ''}):`, ...meters.map((m) => internetLine(m, now))];
}

/** How long a question waits for the gauges; a cold read of HCML's dashboard takes about 15 s, and later reads come from the cache. */
const INTERNET_WAIT_MS = 1_500;

export type InternetRead =
  | { status: 'ok'; meters: Meter[]; /** Epoch seconds. */ generatedAt: number }
  /** Still reading: the answer is not held for it. */
  | { status: 'pending' }
  /** No dashboard, no gauge, or Zabbix refused it: nothing to say, and nothing to wait for. */
  | { status: 'none' };

export async function readInternet(waitMs = INTERNET_WAIT_MS): Promise<InternetRead> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'pending'>((resolve) => {
    timer = setTimeout(() => resolve('pending'), waitMs);
  });
  try {
    const got = await Promise.race([metersView().catch(() => null), timeout]);
    if (got === 'pending') return { status: 'pending' };
    if (!got || !got.meters.length) return { status: 'none' };
    return { status: 'ok', meters: got.meters, generatedAt: got.generatedAt };
  } finally {
    clearTimeout(timer);
  }
}
