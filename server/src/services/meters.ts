import { zbx } from '../clients/zabbix.js';
import { cached, SLOW_VIEW } from '../core/cache.js';
import { config } from '../core/config.js';
import { createGate } from '../core/gate.js';
import { isFresh } from '../domain/reachability.js';
import { parseIfKey } from './net.js';

/**
 * Internet traffic meters: reads the gauge widgets of the Zabbix dashboard HCML already keeps (dashboard.get), so nobody keeps a second list of links and capacities.
 * Read-only; the dashboard and the widgets' neighbour items are kept two minutes. Wall, operator and admin only (auth.ts's `/api/net` rule).
 */

// The pure parts come first: reading the widgets and deciding what a reading means. The calls to Zabbix follow (getMeters).

/** What a zone's colour means. `none` is grey or no colour. */
export type ZoneLevel = 'none' | 'low' | 'ok' | 'warn' | 'critical';

export interface MeterZone {
  /** Where the zone starts, in the item's units; it ends where the next one starts. */
  from: number;
  level: ZoneLevel;
}

export type MeterState =
  | 'ok'
  /** An old reading: the value and its time are still given. */
  | 'stale'
  /** The item exists and has never produced a value this portal can read. */
  | 'nodata'
  /** Disabled, or Zabbix cannot collect it: what it last held says nothing about now. */
  | 'unsupported'
  /** The widget's item is gone from Zabbix (its own widget says "No permissions to referred object"). */
  | 'missing'
  /** The widget has no usable scale: no maximum, or one that is not above the minimum. */
  | 'invalid';

export type MeterDirection = 'in' | 'out' | null;

/**
 * From the interface's own status item (IF-MIB ifOperStatus). `down` carries nothing, so a reading of 0 there is not an idle link;
 * `unknown` is no current status, or one that is neither working nor dead (testing, dormant, not present).
 */
export type LinkStatus = 'up' | 'down' | 'unknown';

/**
 * The same interface the other way, on the gauge's own scale, so a link that is full in the other direction does not read Low.
 * Assumes a link the same size both ways, as the widget has one maximum.
 */
export interface OtherDirection {
  /** The opposite of the gauge's own direction. */
  direction: 'in' | 'out';
  itemid: string;
  /** Null without a current value; never read from history. */
  value: number | null;
  clock: number | null;
  fraction: number | null;
  zone: ZoneLevel | null;
}

export interface Meter {
  /** Stable for one item; a widget without one is named after its title. */
  id: string;
  title: string;
  page: string;
  host: string | null;
  /** For the link to Graphs. */
  hostid: string | null;
  /** The item's name, such as "Interface wan1(): Bits received". */
  item: string | null;
  itemid: string | null;
  direction: MeterDirection;
  link: LinkStatus;
  other: OtherDirection | null;
  units: string;
  value: number | null;
  /** When the value was collected, epoch seconds. */
  clock: number | null;
  min: number;
  /** The top of the scale: the capacity the widget was given. */
  max: number | null;
  zones: MeterZone[];
  /** Where the value sits on the scale, 0 to 1, or null with no value or no scale. */
  fraction: number | null;
  /** Null with no value or no scale. */
  zone: ZoneLevel | null;
  state: MeterState;
}

/** One gauge widget as the dashboard holds it, before the item it points at is known. Numbers are still text. */
export interface MeterDefinition {
  title: string;
  page: string;
  itemid: string | null;
  min: string | undefined;
  max: string | undefined;
  thresholds: { threshold: string; color: string }[];
}

interface ZWidget {
  type: string;
  name?: string;
  x?: string | number;
  y?: string | number;
  fields?: { type: string; name: string; value: string }[];
}
interface ZPage {
  name?: string;
  widgets?: ZWidget[];
}
export interface ZDashboard {
  name?: string;
  pages?: ZPage[];
}

/** Zabbix field type of an item reference. */
const FIELD_ITEM = '4';

/** Letters and digits only, so "Site Two Internet#2" and "SITE TWO INTERNET 2" compare equal. */
const titleKey = (title: string) => title.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The gauge widgets in the order a person reads the pages (page by page, top row down, left to right), one meter per item:
 * a later page that repeats an item adds nothing, and a widget with no item is repeated only by its title.
 */
export function definitionsFrom(dashboard: ZDashboard): MeterDefinition[] {
  const out: MeterDefinition[] = [];
  const seen = new Set<string>();
  (dashboard.pages ?? []).forEach((page, pageIndex) => {
    const widgets = (page.widgets ?? [])
      .filter((w) => w.type === 'gauge')
      .sort((a, b) => Number(a.y ?? 0) - Number(b.y ?? 0) || Number(a.x ?? 0) - Number(b.x ?? 0));
    for (const w of widgets) {
      const fields = w.fields ?? [];
      const get = (name: string) => fields.find((f) => f.name === name)?.value;
      const itemid = fields.find((f) => f.type === FIELD_ITEM)?.value ?? null;
      const title = (w.name ?? '').trim();
      const key = itemid ? `item:${itemid}` : `title:${titleKey(title)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const byIndex = new Map<string, { threshold?: string; color?: string }>();
      for (const f of fields) {
        const m = /^thresholds\.(\d+)\.(threshold|color)$/.exec(f.name);
        if (!m) continue;
        const entry = byIndex.get(m[1]) ?? {};
        entry[m[2] as 'threshold' | 'color'] = f.value;
        byIndex.set(m[1], entry);
      }
      const thresholds = [...byIndex.values()].flatMap((t) =>
        t.threshold !== undefined && t.color !== undefined ? [{ threshold: t.threshold, color: t.color }] : [],
      );

      out.push({
        title,
        page: page.name?.trim() || `Page ${pageIndex + 1}`,
        itemid,
        min: get('min'),
        max: get('max'),
        thresholds,
      });
    }
  });
  return out;
}

/**
 * A scale number as a widget writes it, plain or with a K, M, G or T suffix (1,000s for rates, 1,024s for bytes).
 * Null for anything else, so a typo makes the meter invalid and not a wrong scale.
 */
export function parseScale(text: string | undefined, units: string): number | null {
  if (text === undefined) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*([KMGT]?)\s*$/i.exec(text);
  if (!m) return null;
  const base = units === 'B' || units === 'Bps' ? 1024 : 1000;
  const power = m[2] ? 'KMGT'.indexOf(m[2].toUpperCase()) + 1 : 0;
  const n = Number(m[1]) * base ** power;
  return Number.isFinite(n) ? n : null;
}

/**
 * What a zone's colour means; only the meaning is kept, as the page draws its own palette. Red is critical, orange and yellow
 * a warning, green fine, blue the low end; grey and a colour of no clear family are `none`.
 */
export function levelOfColor(hex: string): ZoneLevel {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 'none';
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const lightness = (max + min) / 2;
  const saturation = d === 0 ? 0 : d / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.25) return 'none';
  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 20 || hue >= 340) return 'critical';
  if (hue < 70) return 'warn';
  if (hue < 170) return 'ok';
  if (hue < 290) return 'low';
  return 'none';
}

/** The zones of a scale from its thresholds, lowest first; below the first threshold, if it is above the minimum, is `none`. */
export function buildZones(thresholds: { value: number; color: string }[], min: number): MeterZone[] {
  const zones = thresholds
    .map((t) => ({ from: t.value, level: levelOfColor(t.color) }))
    .sort((a, b) => a.from - b.from);
  if (!zones.length) return [{ from: min, level: 'none' }];
  if (zones[0].from > min) zones.unshift({ from: min, level: 'none' });
  return zones;
}

/** The zone a value falls in: the last one that starts at or below it. */
export function zoneOf(value: number, zones: MeterZone[]): ZoneLevel {
  let level = zones[0]?.level ?? 'none';
  for (const z of zones) if (value >= z.from) level = z.level;
  return level;
}

export function directionOf(key: string | undefined): MeterDirection {
  if (!key) return null;
  if (/^net\.if\.in\[/.test(key)) return 'in';
  if (/^net\.if\.out\[/.test(key)) return 'out';
  return null;
}

export interface MeterItem {
  itemid: string;
  hostid?: string;
  name: string;
  key_: string;
  units: string;
  status?: string;
  state?: string;
  hosts?: { name: string }[];
}

export interface Reading {
  value: number;
  clock: number;
}

/** 1 is up, 2 (down) and 7 (lowerLayerDown) are dead, as the Network page counts them; anything else claims nothing. */
export function linkOf(status: number | null | undefined): LinkStatus {
  if (status === 1) return 'up';
  if (status === 2 || status === 7) return 'down';
  return 'unknown';
}

/** What the interface's other items say; a reading is given only while it is current. */
export interface Siblings {
  status?: number | null;
  other?: { itemid: string; reading: Reading | null };
}

/** Null for a gauge with no direction or no opposite item. */
export function otherOf(
  direction: MeterDirection,
  found: Siblings['other'],
  scale: { min: number; max: number | null; zones: MeterZone[] },
): OtherDirection | null {
  if (!direction || !found) return null;
  const { min, max, zones } = scale;
  const scaled = max !== null && max > min;
  const reading = found.reading;
  return {
    direction: direction === 'in' ? 'out' : 'in',
    itemid: found.itemid,
    value: reading ? reading.value : null,
    clock: reading ? reading.clock : null,
    fraction: reading && scaled ? Math.min(1, Math.max(0, (reading.value - min) / (max - min))) : null,
    zone: reading && scaled ? zoneOf(reading.value, zones) : null,
  };
}

/**
 * One meter from its widget, its item and the item's newest reading; `fresh` (reachability.ts) says whether that is current.
 * Without a usable scale the value is still given and the state says so; `siblings` are the interface's status and other direction.
 */
export function buildMeter(
  def: MeterDefinition,
  item: MeterItem | undefined,
  reading: Reading | null,
  fresh: boolean,
  siblings: Siblings = {},
): Meter {
  const units = item?.units ?? '';
  const direction = directionOf(item?.key_);
  const base = {
    id: def.itemid ? `item-${def.itemid}` : `title-${titleKey(def.title) || 'untitled'}`,
    title: def.title || item?.name || 'Untitled gauge',
    page: def.page,
    host: item?.hosts?.[0]?.name ?? null,
    hostid: item?.hostid ?? null,
    item: item?.name ?? null,
    itemid: def.itemid,
    direction,
    units,
  };
  const none = { value: null, clock: null, fraction: null, zone: null } as const;

  if (!item) {
    return { ...base, ...none, link: 'unknown', other: null, min: 0, max: null, zones: [], state: 'missing' };
  }

  const min = parseScale(def.min, units) ?? 0;
  const max = parseScale(def.max, units);
  const thresholds = def.thresholds.flatMap((t) => {
    const value = parseScale(t.threshold, units);
    return value === null ? [] : [{ value, color: t.color }];
  });
  const zones = buildZones(thresholds, min);
  const link = linkOf(siblings.status);
  const other = otherOf(direction, siblings.other, { min, max, zones });

  if (item.status === '1' || item.state === '1') {
    return { ...base, ...none, link, other, min, max, zones, state: 'unsupported' };
  }
  if (!reading) {
    return { ...base, ...none, link, other, min, max, zones, state: 'nodata' };
  }
  const scaled = max !== null && max > min;
  const fraction = scaled ? Math.min(1, Math.max(0, (reading.value - min) / (max - min))) : null;
  return {
    ...base,
    value: reading.value,
    clock: reading.clock,
    link,
    other,
    min,
    max,
    zones,
    fraction,
    zone: scaled ? zoneOf(reading.value, zones) : null,
    state: !scaled ? 'invalid' : fresh ? 'ok' : 'stale',
  };
}

export interface MetersSummary {
  total: number;
  /** With a current reading. */
  current: number;
  /** Of those, how many are in a red zone and in a yellow one. */
  critical: number;
  warn: number;
  stale: number;
  /** No gauge to draw: no value, an unsupported item, an item gone from Zabbix, or a scale that cannot be read. */
  unavailable: number;
  /** Links whose interface is down, whatever their reading says. */
  down: number;
  /** Links whose other direction is in a yellow or a red zone now. */
  otherHigh: number;
}

export function summarise(meters: Meter[]): MetersSummary {
  const s: MetersSummary = { total: meters.length, current: 0, critical: 0, warn: 0, stale: 0, unavailable: 0, down: 0, otherHigh: 0 };
  for (const m of meters) {
    if (m.state === 'ok') {
      s.current++;
      if (m.zone === 'critical') s.critical++;
      else if (m.zone === 'warn') s.warn++;
    } else if (m.state === 'stale') s.stale++;
    else s.unavailable++;
    if (m.link === 'down') s.down++;
    if (m.other?.zone === 'critical' || m.other?.zone === 'warn') s.otherHigh++;
  }
  return s;
}


export interface MetersResponse {
  /** The dashboard that was looked for (INTERNET_METERS_DASHBOARD). */
  dashboard: string;
  /** False when Zabbix has no dashboard of that name, or the token cannot see it. */
  found: boolean;
  /** Epoch seconds. */
  generatedAt: number;
  meters: Meter[];
  summary: MetersSummary;
}

interface ZMeterItem extends MeterItem {
  value_type: string;
  delay?: string;
  lastvalue?: string;
  lastclock?: string;
}

interface ZSiblingItem {
  itemid: string;
  key_: string;
  delay?: string;
  status?: string;
  state?: string;
  lastvalue?: string;
  lastclock?: string;
}

/** An item known only by its host and key. */
interface Keyed {
  itemid: string;
  hostid: string;
  key_: string;
}

/** The items beside one widget's item: the same interface's status, and the item of the opposite direction. */
export interface SiblingIds {
  statusId: string | null;
  otherId: string | null;
}

const HISTORY_AT_ONCE = 8;

/** The 64-bit (ifHC) and 32-bit counters count the same interface; a neighbour of the same width is the better partner. */
const hc = (key: string) => /\bifHC/.test(key);

/**
 * For each widget item, the status item and the opposite direction of the same interface (same host, same ifIndex) among `found`.
 * With several candidates: operational status over administrative, the same counter width, then the lowest id.
 */
export function pairSiblings(mains: Keyed[], found: Keyed[]): Record<string, SiblingIds> {
  const byHost = new Map<string, { item: Keyed; kind: string; index: number }[]>();
  for (const item of found) {
    const k = parseIfKey(item.key_);
    if (!k) continue;
    const list = byHost.get(item.hostid) ?? [];
    list.push({ item, kind: k.kind, index: k.index });
    byHost.set(item.hostid, list);
  }
  const out: Record<string, SiblingIds> = {};
  for (const main of mains) {
    const k = parseIfKey(main.key_);
    if (!k || (k.kind !== 'in' && k.kind !== 'out')) continue;
    const here = (byHost.get(main.hostid) ?? []).filter((f) => f.index === k.index && f.item.itemid !== main.itemid);
    const best = (kind: string, prefer: (key: string) => number) =>
      here
        .filter((f) => f.kind === kind)
        .sort((a, b) => prefer(b.item.key_) - prefer(a.item.key_) || Number(a.item.itemid) - Number(b.item.itemid))[0]?.item.itemid ?? null;
    out[main.itemid] = {
      statusId: best('status', (key) => (/ifOperStatus/.test(key) ? 1 : 0)),
      otherId: best(k.kind === 'in' ? 'out' : 'in', (key) => (hc(key) === hc(main.key_) ? 1 : 0)),
    };
  }
  return out;
}

/** One read of every neighbour candidate on the widgets' hosts. */
async function findSiblings(items: ZMeterItem[]): Promise<Record<string, SiblingIds>> {
  const mains = items.flatMap((i) => (i.hostid ? [{ itemid: i.itemid, hostid: i.hostid, key_: i.key_ }] : []));
  if (!mains.length) return {};
  const found = await zbx<Keyed[]>('item.get', {
    hostids: [...new Set(mains.map((m) => m.hostid))],
    search: { key_: ['net.if.in[', 'net.if.out[', 'net.if.status['] },
    searchByAny: true,
    startSearch: true,
    output: ['itemid', 'hostid', 'key_'],
  });
  return pairSiblings(mains, found);
}

/** A value that can be drawn: the item is on, it has a number, and the number is recent. */
function currentReading(it: ZSiblingItem | undefined, now: number): Reading | null {
  if (!it || it.status === '1' || it.state === '1' || !it.lastvalue) return null;
  const value = Number(it.lastvalue);
  if (!Number.isFinite(value) || !isFresh(it, now)) return null;
  return { value, clock: Number(it.lastclock) };
}

async function loadDefinitions(name: string): Promise<MeterDefinition[] | null> {
  const found = await zbx<ZDashboard[]>('dashboard.get', {
    filter: { name: [name] },
    output: ['dashboardid', 'name'],
    selectPages: 'extend',
  });
  return found.length ? definitionsFrom(found[0]) : null;
}

/**
 * The newest value of each item. Zabbix keeps a last value only for a day (the history display period), so a silent item or a
 * stopped copy of Zabbix has none: those are read from history, one newest row each, so a silent link shows when it last spoke.
 */
async function readings(items: ZMeterItem[]): Promise<Map<string, Reading | null>> {
  const out = new Map<string, Reading | null>();
  const fromHistory: ZMeterItem[] = [];
  for (const it of items) {
    const clock = Number(it.lastclock);
    const value = Number(it.lastvalue);
    if (it.status === '1' || it.state === '1') out.set(it.itemid, null);
    else if (clock > 0 && it.lastvalue !== undefined && it.lastvalue !== '' && Number.isFinite(value)) {
      out.set(it.itemid, { value, clock });
    } else fromHistory.push(it);
  }
  const gate = createGate(HISTORY_AT_ONCE);
  await Promise.all(
    fromHistory.map((it) =>
      gate.run(async () => {
        const type = Number(it.value_type);
        if (type !== 0 && type !== 3) return void out.set(it.itemid, null); // text and log items have no number to draw
        const [row] = await zbx<{ clock: string; value: string }[]>('history.get', {
          history: type,
          itemids: [it.itemid],
          sortfield: 'clock',
          sortorder: 'DESC',
          limit: 1,
          output: ['clock', 'value'],
        });
        const value = Number(row?.value);
        out.set(it.itemid, row && Number.isFinite(value) ? { value, clock: Number(row.clock) } : null);
      }),
    ),
  );
  return out;
}

export async function getMeters(): Promise<MetersResponse> {
  const name = config.meters.dashboard;
  const now = Math.floor(Date.now() / 1000);
  const defs = await cached(`meters:definitions:${name}`, 120_000, () => loadDefinitions(name));
  if (!defs) return { dashboard: name, found: false, generatedAt: now, meters: [], summary: summarise([]) };

  const itemids = [...new Set(defs.flatMap((d) => (d.itemid ? [d.itemid] : [])))];
  const items = itemids.length
    ? await zbx<ZMeterItem[]>('item.get', {
        itemids,
        output: ['itemid', 'hostid', 'name', 'key_', 'units', 'value_type', 'delay', 'status', 'state', 'lastvalue', 'lastclock'],
        selectHosts: ['name'],
      })
    : [];
  const byId = new Map(items.map((i) => [i.itemid, i]));
  const found = await readings(items);

  // Neighbours are read from the item only: a status or a figure from days ago says nothing about the link today.
  const pairs = items.length ? await cached(`meters:siblings:${name}:${itemids.join(',')}`, 120_000, () => findSiblings(items)) : {};
  const neighbourIds = [...new Set(Object.values(pairs).flatMap((p) => [p.statusId, p.otherId].filter((id): id is string => id !== null)))];
  const neighbours = neighbourIds.length
    ? await zbx<ZSiblingItem[]>('item.get', {
        itemids: neighbourIds,
        output: ['itemid', 'key_', 'delay', 'status', 'state', 'lastvalue', 'lastclock'],
      })
    : [];
  const neighbourById = new Map(neighbours.map((i) => [i.itemid, i]));

  const meters = defs.map((d) => {
    const item = d.itemid ? byId.get(d.itemid) : undefined;
    const reading = item ? (found.get(item.itemid) ?? null) : null;
    const fresh =
      item !== undefined &&
      reading !== null &&
      isFresh({ lastclock: String(reading.clock), state: item.state, delay: item.delay }, now);
    const ids = item ? pairs[item.itemid] : undefined;
    const otherItem = ids?.otherId ? neighbourById.get(ids.otherId) : undefined;
    const siblings: Siblings = {
      status: currentReading(ids?.statusId ? neighbourById.get(ids.statusId) : undefined, now)?.value ?? null,
      ...(otherItem ? { other: { itemid: otherItem.itemid, reading: currentReading(otherItem, now) } } : {}),
    };
    return buildMeter(d, item, reading, fresh, siblings);
  });
  return { dashboard: name, found: true, generatedAt: now, meters, summary: summarise(meters) };
}

/** The Internet traffic meters as their route and the warm-up read them. */
export const metersView = () => cached('net:meters', 30_000, getMeters, SLOW_VIEW);
