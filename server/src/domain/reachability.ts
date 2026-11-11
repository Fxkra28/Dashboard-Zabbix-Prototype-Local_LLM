import { zbx } from '../clients/zabbix.js';
import { cached, cacheLogger } from '../core/cache.js';
import { recentValues, type RecentValue } from './recentValues.js';
import { parseDelay } from '../sli/engine.js';

/**
 * One reachability state per host, ping first.
 *
 * Zabbix's interface flags answer a different question: whether SNMP or the agent responds. On
 * 2026-09-17, 16 of HCML's 23 "unavailable" hosts answered ping, and 43 hosts had no interface at
 * all. ICMP is what "down" means; the interface flags explain what else is wrong and stand in only
 * when there is no recent ping.
 *
 * Read-only. The Network page reads the same ICMP items (net.ts), so both views agree on what "up"
 * is.
 */

export type HostState = 'up' | 'down' | 'degraded' | 'nodata' | 'disabled';

/** Where a host's state came from. */
export type StateReason =
  | 'ping'
  | 'interface'
  | 'snmp-silent'
  | 'agent-silent'
  | 'stale'
  | 'no-interface'
  | 'unsupported'
  | 'disabled';

export type Availability = 'available' | 'unavailable' | 'unknown';

/**
 * Zabbix 7.0 tracks availability per interface. Roll up to a host state the
 * same way the UI does elsewhere: worst wins.
 */
export function rollUpAvailability(interfaces?: { available?: string }[]): Availability {
  if (!interfaces?.length) return 'unknown';
  if (interfaces.some((i) => i.available === '2')) return 'unavailable';
  if (interfaces.some((i) => i.available === '1')) return 'available';
  return 'unknown';
}

/** Below this, a value is never called stale: one slow poller cycle must not flip a host to "no data". */
const MIN_FRESH_SECONDS = 600;

/** How old a value of an item with this update interval may be and still be believed: three intervals, never under ten minutes. */
export function freshWithinS(delay: string | undefined): number {
  return Math.max(3 * parseDelay(delay), MIN_FRESH_SECONDS);
}

/**
 * A value Zabbix actually collected, from a supported item, recently enough to
 * believe: at most three update intervals old, and never less than ten minutes.
 *
 * `lastclock '0'` means nothing was collected within Zabbix's history display
 * period; an unsupported item keeps its last value, whatever it says. Without
 * the age check, a pinger that stopped hours ago still read as "up". Delays in
 * a macro count as one minute, as elsewhere in the portal.
 */
export function isFresh(
  it: { lastclock?: string; state?: string; delay?: string },
  now: number,
): boolean {
  if (it.state === '1' || !it.lastclock || it.lastclock === '0') return false;
  const age = now - Number(it.lastclock);
  return Number.isFinite(age) && age <= freshWithinS(it.delay);
}

export interface IcmpItem {
  itemid: string;
  hostid: string;
  key_: string;
  lastvalue: string;
  lastclock: string;
  state: string;
  delay: string;
}

/** One host's ICMP items folded together. */
export interface IcmpReading {
  /** From a fresh `icmpping` value; absent without one. */
  up?: boolean;
  /** `icmppingloss`, percent, when fresh. Operator views only. */
  loss?: number;
  /** `icmppingsec`, seconds, when fresh. Operator views only. */
  latency?: number;
  /** `up`/`down` only from a fresh `icmpping` value. */
  state: 'up' | 'down' | 'unknown';
  /** ICMP items the host has (icmpping, icmppingloss, icmppingsec, …). */
  items: number;
  /** How many of those Zabbix marks unsupported. */
  unsupported: number;
}

/** `icmpping` or `icmpping[,…]` pings the host itself; `icmpping[10.0.0.1]` pings some other target. */
const pingsHost = (key: string) => !key.includes('[') || /^[a-z]+\[\s*(,|\])/.test(key);

/**
 * Fold ICMP items into one reading per host. When a host has more than one
 * item of a kind, the one pinging the host itself wins. Pure; exported for tests.
 */
export function foldIcmp(items: IcmpItem[], now: number): Map<string, IcmpReading> {
  const out = new Map<string, IcmpReading>();
  const ordered = [...items].sort((a, b) => Number(pingsHost(b.key_)) - Number(pingsHost(a.key_)));
  for (const it of ordered) {
    let r = out.get(it.hostid);
    if (!r) {
      r = { state: 'unknown', items: 0, unsupported: 0 };
      out.set(it.hostid, r);
    }
    r.items++;
    if (it.state === '1') r.unsupported++;
    if (!isFresh(it, now)) continue;
    if (it.key_.startsWith('icmppingloss')) r.loss ??= Number(it.lastvalue);
    else if (it.key_.startsWith('icmppingsec')) r.latency ??= Number(it.lastvalue);
    else if (it.key_.startsWith('icmpping') && r.up === undefined) {
      r.up = it.lastvalue === '1';
      r.state = r.up ? 'up' : 'down';
    }
  }
  return out;
}

/** Finding the ping items reads Zabbix's whole item table (19 to 39 s on HCML's), and they change only with the hosts. */
export const ICMP_CATALOG_TTL_MS = 60 * 60_000;
/** Past that hour the held list is used for up to a day while a new one is read. */
export const ICMP_CATALOG_STALE_MS = 24 * 60 * 60_000;
/** How far back values are read: past the freshness rule of an item polled at least every five minutes. A slower one gets three of its own intervals. */
export const ICMP_WINDOW_S = 900;

interface IcmpCatalogItem {
  itemid: string;
  hostid: string;
  key_: string;
  state: string;
  delay: string;
  value_type: string;
}

/** Every monitored ICMP item, without values. */
function getIcmpCatalog(): Promise<IcmpCatalogItem[]> {
  return cached(
    'icmp:catalog',
    ICMP_CATALOG_TTL_MS,
    () =>
      zbx<IcmpCatalogItem[]>('item.get', {
        output: ['itemid', 'hostid', 'key_', 'state', 'delay', 'value_type'],
        search: { key_: 'icmpping' },
        startSearch: true,
        monitored: true,
      }),
    { staleMs: ICMP_CATALOG_STALE_MS, staleIfError: true, pin: true },
  );
}

/**
 * The newest value of every supported ping item, in one history read per value type (2.8 s on HCML's server
 * against 54.5 s for Zabbix's `lastvalue`). Shared by the host states, the data clock and Links. The pinger runs
 * once a minute. Items polled so rarely that isFresh() believes a value older than the window are read in a
 * second call over the longest of their spans, so the rest do not carry their extra rows. If that call fails,
 * those items have no value this round and the host states of the others stand.
 */
export function getIcmpValues(): Promise<Map<string, RecentValue>> {
  return cached('icmp:values', 30_000, async () => {
    const usual: IcmpCatalogItem[] = [];
    const rare: IcmpCatalogItem[] = [];
    let rareWindowS = ICMP_WINDOW_S;
    for (const item of await getIcmpCatalog()) {
      if (item.state === '1') continue;
      const span = freshWithinS(item.delay);
      if (span > ICMP_WINDOW_S) {
        rare.push(item);
        rareWindowS = Math.max(rareWindowS, span);
      } else usual.push(item);
    }
    const [recent, slower] = await Promise.all([
      recentValues(usual, ICMP_WINDOW_S),
      rare.length
        ? recentValues(rare, rareWindowS).catch((err: unknown) => {
            cacheLogger()?.warn({ items: rare.length, reason: err instanceof Error ? err.message : String(err) }, 'icmp: the read of the slowly polled ping items failed; they have no value this round');
            return new Map<string, RecentValue>();
          })
        : new Map<string, RecentValue>(),
    ]);
    return new Map([...recent, ...slower]);
  });
}

/** Every monitored ICMP item with its newest value in the window; none is `lastclock` '0'. */
async function getIcmpItems(): Promise<IcmpItem[]> {
  const [catalog, values] = await Promise.all([getIcmpCatalog(), getIcmpValues()]);
  return catalog.map((i) => {
    const v = values.get(i.itemid);
    return { itemid: i.itemid, hostid: i.hostid, key_: i.key_, state: i.state, delay: i.delay, lastvalue: v?.value ?? '', lastclock: v?.clock ?? '0' };
  });
}

/** ICMP readings for every monitored host. Hosts without an ICMP item are absent. */
export function getIcmpByHost(): Promise<Map<string, IcmpReading>> {
  return cached('icmp:hosts', 30_000, async () => foldIcmp(await getIcmpItems(), Math.floor(Date.now() / 1000)));
}

/**
 * Whether Zabbix is still collecting. A stopped `zabbix-server` leaves every API call working and
 * every value in place, so a frozen estate would read `ok` and "Live". The newest value any
 * supported ICMP item holds says when anything was last collected; the pinger runs once a minute,
 * so that is never long ago on a healthy estate.
 */

/** The same ten minutes isFresh() allows before it stops believing a ping. */
export const COLLECTING_STALE_SECONDS = MIN_FRESH_SECONDS;

/** The newest `lastclock` of a supported item, Unix seconds; null when no item has collected. Pure. */
export function newestClock(items: { lastclock?: string; state?: string }[]): number | null {
  let newest = 0;
  for (const it of items) {
    if (it.state === '1') continue;
    const clock = Number(it.lastclock);
    if (Number.isFinite(clock) && clock > newest) newest = clock;
  }
  return newest > 0 ? newest : null;
}

export interface CollectingStatus {
  /** When Zabbix last collected a value, Unix seconds; null when there is no ICMP item to tell. */
  lastCollectedAt: number | null;
  ageSeconds: number | null;
  /** Nothing collected for longer than `staleAfterSeconds`. Never true while the age is unknown. */
  stale: boolean;
  staleAfterSeconds: number;
  /** Hosts whose latest ping is fresh, and how many of them answered it. */
  pinged: number;
  answering: number;
  /** Almost nothing answers at once: Zabbix has more likely lost its way into the network than every device its power. */
  reachLost: boolean;
}

/** Below this share of the fresh pings answered, with at least REACH_MIN_PINGED of them, the collector is taken as cut off. */
export const REACH_LOST_SHARE = 0.2;
export const REACH_MIN_PINGED = 10;

/** Work out the age at the moment of asking, and how many fresh pings were answered. Pure. */
export function collectingStatus(
  lastCollectedAt: number | null,
  now: number,
  readings: Map<string, IcmpReading> = new Map(),
): CollectingStatus {
  const ageSeconds = lastCollectedAt === null ? null : Math.max(0, now - lastCollectedAt);
  const fresh = [...readings.values()].filter((r) => r.state !== 'unknown');
  const answering = fresh.filter((r) => r.state === 'up').length;
  return {
    lastCollectedAt,
    ageSeconds,
    stale: ageSeconds !== null && ageSeconds > COLLECTING_STALE_SECONDS,
    staleAfterSeconds: COLLECTING_STALE_SECONDS,
    pinged: fresh.length,
    answering,
    reachLost: fresh.length >= REACH_MIN_PINGED && answering <= REACH_LOST_SHARE * fresh.length,
  };
}

/** When Zabbix last collected a value, and every host's ping as read then. Cached; the age is worked out per request. */
export function getCollecting(): Promise<{ lastCollectedAt: number | null; readings: Map<string, IcmpReading> }> {
  return cached('collecting:last', 30_000, async () => {
    const items = await getIcmpItems();
    const lastCollectedAt = newestClock(items) ?? (await lastClockBeyondWindow(items));
    return { lastCollectedAt, readings: foldIcmp(items, Math.floor(Date.now() / 1000)) };
  });
}

/** Nothing in the window: Zabbix's own last value of a few items (it looks back a day) says how long ago it stopped. */
async function lastClockBeyondWindow(items: IcmpItem[]): Promise<number | null> {
  const sample = items.filter((i) => i.state !== '1').slice(0, 20);
  if (!sample.length) return null;
  const read = await zbx<{ lastclock?: string; state?: string }[]>('item.get', {
    itemids: sample.map((i) => i.itemid),
    output: ['itemid', 'lastclock', 'state'],
  });
  return newestClock(read);
}

/**
 * A host's state, ping first. Pure.
 *
 *   disabled   host status '1'                                   (disabled)
 *   degraded   fresh ping up, but an interface is unavailable:
 *              SNMP (snmp-silent), agent (agent-silent), IPMI/JMX (interface)
 *   up         fresh ping up                                     (ping)
 *   down       fresh ping down                                   (ping)
 *
 * With no fresh ping, the interface flags decide:
 *
 *   up         an interface available, none unavailable          (interface)
 *   down       an interface unavailable                          (interface)
 *   nodata     nothing to go on, and the reason says why:
 *                stale         ICMP items exist and are supported, but none
 *                              has a recent value
 *                no-interface  the host has no interface (at HCML this is also
 *                              why its ICMP items are unsupported)
 *                unsupported   every ICMP item is unsupported
 *                interface     interfaces exist, their availability unknown
 */
export function hostState(
  host: { status: string; interfaces?: { type?: string; available?: string }[] },
  icmp: IcmpReading | undefined,
): { state: HostState; reason: StateReason } {
  if (host.status === '1') return { state: 'disabled', reason: 'disabled' };

  const failed = (host.interfaces ?? []).filter((i) => i.available === '2');
  if (icmp?.state === 'up') {
    if (!failed.length) return { state: 'up', reason: 'ping' };
    if (failed.some((i) => i.type === '2')) return { state: 'degraded', reason: 'snmp-silent' };
    if (failed.some((i) => i.type === '1')) return { state: 'degraded', reason: 'agent-silent' };
    return { state: 'degraded', reason: 'interface' };
  }
  if (icmp?.state === 'down') return { state: 'down', reason: 'ping' };

  const availability = rollUpAvailability(host.interfaces);
  if (availability === 'available') return { state: 'up', reason: 'interface' };
  if (availability === 'unavailable') return { state: 'down', reason: 'interface' };

  if (icmp && icmp.unsupported < icmp.items) return { state: 'nodata', reason: 'stale' };
  if (!host.interfaces?.length) return { state: 'nodata', reason: 'no-interface' };
  if (icmp && icmp.items > 0) return { state: 'nodata', reason: 'unsupported' };
  return { state: 'nodata', reason: 'interface' };
}
