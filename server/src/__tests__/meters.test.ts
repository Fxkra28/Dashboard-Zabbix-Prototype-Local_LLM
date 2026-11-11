import { describe, expect, it } from 'vitest';
import {
  buildMeter,
  buildZones,
  definitionsFrom,
  directionOf,
  levelOfColor,
  linkOf,
  otherOf,
  parseScale,
  summarise,
  zoneOf,
  type MeterDefinition,
  type MeterItem,
  type ZDashboard,
} from '../services/meters.js';

/** The pure parts of the meters: reading a gauge widget, its scale and colours, and what a reading means. Fixtures have the shape of HCML's "Global view". */

const COLORS = ['0080FF', '00FF00', 'FFFF00', 'FF465C'];

/** A gauge widget as `dashboard.get` returns it: item, scale and four thresholds. */
function gauge(title: string, at: { x: number; y: number }, opts: { itemid?: string; max?: string; thresholds?: string[]; colors?: string[] } = {}) {
  const max = opts.max ?? '50000000';
  const thresholds = opts.thresholds ?? ['0', '13000000', '25000000', '38000000'];
  const colors = opts.colors ?? COLORS;
  const fields = [
    ...(opts.itemid ? [{ type: '4', name: 'itemid.0', value: opts.itemid }] : []),
    { type: '1', name: 'min', value: '0' },
    { type: '1', name: 'max', value: max },
    { type: '0', name: 'show.0', value: '2' },
    ...thresholds.flatMap((t, i) => [
      { type: '1', name: `thresholds.${i}.color`, value: colors[i] ?? 'FFFFFF' },
      { type: '1', name: `thresholds.${i}.threshold`, value: t },
    ]),
  ];
  return { type: 'gauge', name: title, x: String(at.x), y: String(at.y), width: '17', height: '3', fields };
}

const item = (over: Partial<MeterItem> = {}): MeterItem => ({
  itemid: '1',
  name: 'Interface wan1(): Bits received',
  key_: 'net.if.in[ifHCInOctets.5]',
  units: 'bps',
  status: '0',
  state: '0',
  hostid: '10',
  hosts: [{ name: '1.1 SITE1-FW' }],
  ...over,
});

const def = (over: Partial<MeterDefinition> = {}): MeterDefinition => ({
  title: 'SITE ONE INTERNET',
  page: 'Page 1',
  itemid: '1',
  min: '0',
  max: '500000000',
  thresholds: [
    { threshold: '0', color: '0080FF' },
    { threshold: '125000000', color: '00FF00' },
    { threshold: '250000000', color: 'FFFF00' },
    { threshold: '375000000', color: 'FF465C' },
  ],
  ...over,
});

describe('parseScale', () => {
  it('reads a plain number, a decimal and a negative one', () => {
    expect(parseScale('500000000', 'bps')).toBe(500_000_000);
    expect(parseScale('2.5', 'bps')).toBe(2.5);
    expect(parseScale('-10', 'bps')).toBe(-10);
  });

  it('reads a suffix in thousands for a rate and in 1,024s for bytes', () => {
    expect(parseScale('50M', 'bps')).toBe(50_000_000);
    expect(parseScale('1.5G', 'bps')).toBe(1_500_000_000);
    expect(parseScale('10k', 'bps')).toBe(10_000);
    expect(parseScale('2K', 'B')).toBe(2048);
    expect(parseScale('1M', 'Bps')).toBe(1_048_576);
  });

  it('gives null for anything it cannot read, so a typo is an invalid meter and not a wrong scale', () => {
    for (const bad of [undefined, '', 'abc', '5 Mbps', '1e6', '5MM', '--3', '{$MAX}']) {
      expect(parseScale(bad, 'bps'), String(bad)).toBeNull();
    }
  });
});

describe('levelOfColor', () => {
  it('maps every colour HCML\'s gauges use to what it means', () => {
    expect(['0080FF', '0040FF', '4000FF'].map(levelOfColor)).toEqual(['low', 'low', 'low']);
    expect(levelOfColor('00FF00')).toBe('ok');
    expect(levelOfColor('FFFF00')).toBe('warn');
    expect(['FF465C', 'FF4000', 'FF0000'].map(levelOfColor)).toEqual(['critical', 'critical', 'critical']);
  });

  it('puts orange with the warnings, and a "#" or lower case changes nothing', () => {
    expect(levelOfColor('FFA500')).toBe('warn');
    expect(levelOfColor('#ff465c')).toBe('critical');
    expect(levelOfColor('  00ff00 ')).toBe('ok');
  });

  it('says none for a grey, and for text that is not a colour', () => {
    expect(levelOfColor('808080')).toBe('none');
    expect(levelOfColor('FFFFFF')).toBe('none');
    expect(levelOfColor('000000')).toBe('none');
    expect(levelOfColor('red')).toBe('none');
    expect(levelOfColor('')).toBe('none');
  });
});

describe('buildZones and zoneOf', () => {
  const thresholds = [
    { value: 125, color: '00FF00' },
    { value: 0, color: '0080FF' },
    { value: 375, color: 'FF465C' },
    { value: 250, color: 'FFFF00' },
  ];

  it('orders the zones from the bottom of the scale whatever order the widget listed them in', () => {
    expect(buildZones(thresholds, 0)).toEqual([
      { from: 0, level: 'low' },
      { from: 125, level: 'ok' },
      { from: 250, level: 'warn' },
      { from: 375, level: 'critical' },
    ]);
  });

  it('leaves the part below the first threshold uncoloured, and a widget with no thresholds one grey zone', () => {
    expect(buildZones([{ value: 10, color: '00FF00' }], 0)).toEqual([
      { from: 0, level: 'none' },
      { from: 10, level: 'ok' },
    ]);
    expect(buildZones([], 5)).toEqual([{ from: 5, level: 'none' }]);
  });

  it('puts a value in the last zone that starts at or below it', () => {
    const zones = buildZones(thresholds, 0);
    expect(zoneOf(0, zones)).toBe('low');
    expect(zoneOf(124.9, zones)).toBe('low');
    expect(zoneOf(125, zones)).toBe('ok');
    expect(zoneOf(250, zones)).toBe('warn');
    expect(zoneOf(374, zones)).toBe('warn');
    expect(zoneOf(375, zones)).toBe('critical');
    expect(zoneOf(10_000, zones)).toBe('critical');
    expect(zoneOf(-5, zones)).toBe('low');
  });
});

describe('directionOf', () => {
  it('reads the direction off the interface item key', () => {
    expect(directionOf('net.if.in[ifHCInOctets.5]')).toBe('in');
    expect(directionOf('net.if.out[ifHCOutOctets.13]')).toBe('out');
    expect(directionOf('net.if.speed[ifHighSpeed.5]')).toBeNull();
    expect(directionOf('icmppingsec')).toBeNull();
    expect(directionOf(undefined)).toBeNull();
  });
});

describe('definitionsFrom', () => {
  const dashboard: ZDashboard = {
    name: 'Global view',
    pages: [
      {
        name: '',
        widgets: [
          gauge('SITE THREE INTERNET 1', { x: 0, y: 3 }, { itemid: '1002' }),
          { type: 'clock', name: '', x: '0', y: '0', fields: [] },
          gauge('SITE TWO INTERNET 2', { x: 34, y: 0 }, { itemid: '1003' }),
          gauge('SITE ONE INTERNET', { x: 0, y: 0 }, { itemid: '1001', max: '500000000', thresholds: ['0', '125000000', '250000000', '375000000'] }),
          gauge('SITE FOUR INTERNET 2', { x: 17, y: 6 }, {}),
        ],
      },
      {
        name: 'HCML Network',
        widgets: [
          gauge('Site Four Internet#2', { x: 12, y: 24 }, {}),
          gauge('Site One Internet (again)', { x: 0, y: 20 }, { itemid: '1001' }),
          gauge('SITE SIX Internet#1', { x: 48, y: 24 }, { itemid: '1004' }),
        ],
      },
    ],
  };

  it('lists the gauges page by page, each from the top row down and from left to right', () => {
    expect(definitionsFrom(dashboard).map((d) => d.title)).toEqual([
      'SITE ONE INTERNET',
      'SITE TWO INTERNET 2',
      'SITE THREE INTERNET 1',
      'SITE FOUR INTERNET 2',
      'SITE SIX Internet#1',
    ]);
  });

  it('leaves out every widget that is not a gauge', () => {
    expect(definitionsFrom(dashboard).some((d) => d.title === '')).toBe(false);
    expect(definitionsFrom({ pages: [{ widgets: [{ type: 'clock', fields: [] }, { type: 'map', fields: [] }] }] })).toEqual([]);
  });

  it('keeps one meter per item: a later page that repeats it adds nothing', () => {
    const jakarta = definitionsFrom(dashboard).filter((d) => d.itemid === '1001');
    expect(jakarta.map((d) => d.title)).toEqual(['SITE ONE INTERNET']);
  });

  it('knows a widget with no item again by its title, however it is spelt', () => {
    const missing = definitionsFrom(dashboard).filter((d) => d.itemid === null);
    expect(missing.map((d) => d.title)).toEqual(['SITE FOUR INTERNET 2']);
  });

  it('carries the page name, "Page N" for one with none, the scale as written, and the thresholds in pairs', () => {
    const all = definitionsFrom(dashboard);
    expect(all[0].page).toBe('Page 1');
    expect(all.at(-1)?.page).toBe('HCML Network');
    expect(all[0]).toMatchObject({ itemid: '1001', min: '0', max: '500000000' });
    expect(all[0].thresholds).toEqual([
      { threshold: '0', color: '0080FF' },
      { threshold: '125000000', color: '00FF00' },
      { threshold: '250000000', color: 'FFFF00' },
      { threshold: '375000000', color: 'FF465C' },
    ]);
  });

  it('reads a dashboard with no pages as having no meters', () => {
    expect(definitionsFrom({})).toEqual([]);
    expect(definitionsFrom({ pages: [{}] })).toEqual([]);
  });
});

describe('linkOf', () => {
  it('calls 1 up, and 2 (down) and 7 (lowerLayerDown) a dead link, as the Network page does', () => {
    expect(linkOf(1)).toBe('up');
    expect(linkOf(2)).toBe('down');
    expect(linkOf(7)).toBe('down');
  });

  it('claims nothing for testing, unknown, dormant, not present, or no current status', () => {
    for (const status of [3, 4, 5, 6, 0, 8, null, undefined]) expect(linkOf(status), String(status)).toBe('unknown');
  });
});

describe('otherOf', () => {
  const scale = { min: 0, max: 50_000_000, zones: buildZones([{ value: 0, color: '0080FF' }, { value: 12_500_000, color: '00FF00' }, { value: 25_000_000, color: 'FFFF00' }, { value: 37_500_000, color: 'FF465C' }], 0) };
  const found = (value: number | null) => ({ itemid: '77', reading: value === null ? null : { value, clock: 1_800_000_000 } });

  it('is the opposite direction, on the gauge\'s own scale and zones', () => {
    expect(otherOf('in', found(40_000_000), scale)).toEqual({ direction: 'out', itemid: '77', value: 40_000_000, clock: 1_800_000_000, fraction: 0.8, zone: 'critical' });
    expect(otherOf('out', found(30_000_000), scale)).toMatchObject({ direction: 'in', zone: 'warn', fraction: 0.6 });
    expect(otherOf('in', found(5_000_000), scale)).toMatchObject({ zone: 'low' });
  });

  it('keeps the item and says nothing of a value when the item has no current one', () => {
    expect(otherOf('in', found(null), scale)).toEqual({ direction: 'out', itemid: '77', value: null, clock: null, fraction: null, zone: null });
  });

  it('keeps a value past the top of the scale on the scale', () => {
    expect(otherOf('in', found(90_000_000), scale)).toMatchObject({ fraction: 1, zone: 'critical' });
  });

  it('gives no zone where the scale cannot be used', () => {
    expect(otherOf('in', found(40_000_000), { ...scale, max: null })).toMatchObject({ value: 40_000_000, fraction: null, zone: null });
  });

  it('is null for a gauge with no direction, or one with no opposite item', () => {
    expect(otherOf(null, found(1), scale)).toBeNull();
    expect(otherOf('in', undefined, scale)).toBeNull();
  });
});

describe('buildMeter', () => {
  const NOW = 1_800_000_000;
  const MBPS = 1_000_000;

  it('puts a current value on the scale and in its zone', () => {
    const m = buildMeter(def(), item(), { value: 212.06 * MBPS, clock: NOW - 20 }, true);
    expect(m).toMatchObject({ state: 'ok', zone: 'ok', direction: 'in', units: 'bps', host: '1.1 SITE1-FW', page: 'Page 1' });
    expect(m.fraction).toBeCloseTo(0.4241, 3);
    expect(m.max).toBe(500 * MBPS);
    expect(m.zones.map((z) => z.level)).toEqual(['low', 'ok', 'warn', 'critical']);
    expect(m.id).toBe('item-1');
  });

  it('puts a link near its capacity in the red zone', () => {
    const m = buildMeter(def({ max: '50000000', thresholds: [{ threshold: '0', color: '0080FF' }, { threshold: '38000000', color: 'FF465C' }] }), item(), { value: 45.32 * MBPS, clock: NOW }, true);
    expect(m.zone).toBe('critical');
    expect(m.fraction).toBeCloseTo(0.9064, 3);
  });

  it('keeps a value past the top of the scale on the scale, and a negative one at the bottom', () => {
    expect(buildMeter(def(), item(), { value: 900 * MBPS, clock: NOW }, true).fraction).toBe(1);
    expect(buildMeter(def(), item(), { value: -4, clock: NOW }, true).fraction).toBe(0);
  });

  it('calls an old reading stale and still gives its value and time', () => {
    const m = buildMeter(def(), item(), { value: 73.88 * MBPS, clock: NOW - 2_592_000 }, false);
    expect(m.state).toBe('stale');
    expect(m.value).toBe(73.88 * MBPS);
    expect(m.clock).toBe(NOW - 2_592_000);
    expect(m.zone).toBe('low');
  });

  it('says there is no data for an item that has never held a value', () => {
    const m = buildMeter(def(), item(), null, false);
    expect(m).toMatchObject({ state: 'nodata', value: null, clock: null, fraction: null, zone: null });
    expect(m.max).toBe(500 * MBPS);
  });

  it('says missing for a widget with no item, or one whose item is gone from Zabbix, and names it by its title', () => {
    const noItem = buildMeter(def({ itemid: null, title: 'SITE FIVE INTERNET 3' }), undefined, null, false);
    expect(noItem).toMatchObject({ state: 'missing', value: null, max: null, host: null, id: 'title-sitefiveinternet3' });
    const gone = buildMeter(def({ itemid: '77' }), undefined, null, false);
    expect(gone).toMatchObject({ state: 'missing', itemid: '77', id: 'item-77' });
  });

  it('shows no value for a disabled or unsupported item, whatever it last held', () => {
    for (const over of [{ status: '1' }, { state: '1' }]) {
      const m = buildMeter(def(), item(over), { value: 5 * MBPS, clock: NOW }, true);
      expect(m).toMatchObject({ state: 'unsupported', value: null, zone: null });
    }
  });

  it('calls a scale that cannot be used invalid, and still gives the value', () => {
    for (const bad of [{ max: undefined }, { max: 'lots' }, { max: '0' }, { max: '-5' }]) {
      const m = buildMeter(def(bad), item(), { value: 5 * MBPS, clock: NOW }, true);
      expect(m.state, JSON.stringify(bad)).toBe('invalid');
      expect(m.value).toBe(5 * MBPS);
      expect(m.fraction).toBeNull();
      expect(m.zone).toBeNull();
    }
  });

  it('names an untitled widget after its item', () => {
    expect(buildMeter(def({ title: '' }), item(), null, false).title).toBe('Interface wan1(): Bits received');
    expect(buildMeter(def({ title: '', itemid: null }), undefined, null, false).title).toBe('Untitled gauge');
  });

  it('reads the direction of an outbound item', () => {
    expect(buildMeter(def(), item({ key_: 'net.if.out[ifHCOutOctets.13]' }), null, false).direction).toBe('out');
  });

  it('carries the id of the host, which the Graphs page needs', () => {
    expect(buildMeter(def(), item(), null, false).hostid).toBe('10');
    expect(buildMeter(def(), item({ hostid: undefined }), null, false).hostid).toBeNull();
    expect(buildMeter(def({ itemid: '77' }), undefined, null, false).hostid).toBeNull();
  });

  it('has an unknown link and no other direction when it is given no neighbours', () => {
    const m = buildMeter(def(), item(), { value: 5 * MBPS, clock: NOW }, true);
    expect(m.link).toBe('unknown');
    expect(m.other).toBeNull();
  });

  it('says the link is down when its interface is, and keeps the reading and the zone as they are', () => {
    const m = buildMeter(def(), item(), { value: 0, clock: NOW }, true, { status: 2 });
    expect(m).toMatchObject({ link: 'down', state: 'ok', value: 0, zone: 'low' });
    expect(buildMeter(def(), item(), { value: 0, clock: NOW }, true, { status: 7 }).link).toBe('down');
    expect(buildMeter(def(), item(), { value: 3 * MBPS, clock: NOW }, true, { status: 1 }).link).toBe('up');
  });

  it('knows a down link behind an old reading, a gap, or a disabled item, as it is not the reading that says so', () => {
    expect(buildMeter(def(), item(), { value: 0, clock: NOW - 99_999 }, false, { status: 2 })).toMatchObject({ state: 'stale', link: 'down' });
    expect(buildMeter(def(), item(), null, false, { status: 2 })).toMatchObject({ state: 'nodata', link: 'down' });
    expect(buildMeter(def(), item({ status: '1' }), null, false, { status: 2 })).toMatchObject({ state: 'unsupported', link: 'down' });
  });

  it('puts the opposite direction on the same scale, and keeps it for a gauge whose own reading is old', () => {
    const m = buildMeter(def(), item(), { value: 5 * MBPS, clock: NOW }, true, { other: { itemid: '9', reading: { value: 400 * MBPS, clock: NOW } } });
    expect(m.other).toMatchObject({ direction: 'out', itemid: '9', value: 400 * MBPS, zone: 'critical' });
    const old = buildMeter(def(), item(), { value: 5 * MBPS, clock: NOW - 99_999 }, false, { other: { itemid: '9', reading: { value: 400 * MBPS, clock: NOW } } });
    expect(old).toMatchObject({ state: 'stale', other: { zone: 'critical' } });
  });

  it('has no neighbours for a widget whose item is gone, whatever it is given', () => {
    const m = buildMeter(def({ itemid: '77' }), undefined, null, false, { status: 2, other: { itemid: '9', reading: null } });
    expect(m).toMatchObject({ state: 'missing', link: 'unknown', other: null });
  });
});

describe('summarise', () => {
  it('counts what is current and in which zone, and keeps old readings and gaps apart from them', () => {
    const NOW = 1_800_000_000;
    const reading = (v: number) => ({ value: v * 1_000_000, clock: NOW });
    const mk = (r: ReturnType<typeof reading> | null, fresh: boolean, over: Partial<MeterItem> = {}, d: Partial<MeterDefinition> = {}) =>
      buildMeter(def({ max: '100000000', thresholds: [{ threshold: '0', color: '00FF00' }, { threshold: '50000000', color: 'FFFF00' }, { threshold: '75000000', color: 'FF0000' }], ...d }), item(over), r, fresh);
    const meters = [
      mk(reading(10), true),
      mk(reading(60), true),
      mk(reading(80), true),
      mk(reading(90), true),
      mk(reading(90), false), // stale: not counted as red
      mk(null, false),
      mk(reading(5), true, { status: '1' }),
      buildMeter(def({ itemid: null }), undefined, null, false),
      mk(reading(5), true, {}, { max: 'x' }),
    ];
    expect(summarise(meters)).toEqual({ total: 9, current: 4, critical: 2, warn: 1, stale: 1, unavailable: 4, down: 0, otherHigh: 0 });
  });

  it('counts the links that are down whatever their reading says, and those whose other direction is high', () => {
    const NOW = 1_800_000_000;
    const reading = (v: number) => ({ value: v * 1_000_000, clock: NOW });
    const d = def({ max: '100000000', thresholds: [{ threshold: '0', color: '00FF00' }, { threshold: '50000000', color: 'FFFF00' }, { threshold: '75000000', color: 'FF0000' }] });
    const other = (v: number | null) => ({ other: { itemid: '9', reading: v === null ? null : reading(v) } });
    const meters = [
      buildMeter(d, item(), reading(0), true, { status: 2 }), // current, down
      buildMeter(d, item(), reading(0), false, { status: 7 }), // old, down
      buildMeter(d, item(), null, false, { status: 2 }), // no data, down
      buildMeter(d, item(), reading(10), true, { status: 1, ...other(80) }), // up, other critical
      buildMeter(d, item(), reading(10), true, other(60)), // other high
      buildMeter(d, item(), reading(10), true, other(20)), // other fine: not counted
      buildMeter(d, item(), reading(10), true, other(null)), // other has no current value: not counted
      buildMeter(d, item(), reading(10), true, { status: 3 }), // testing: not claimed
    ];
    expect(summarise(meters)).toMatchObject({ total: 8, down: 3, otherHigh: 2 });
  });

  it('is all zeros for no meters', () => {
    expect(summarise([])).toEqual({ total: 0, current: 0, critical: 0, warn: 0, stale: 0, unavailable: 0, down: 0, otherHigh: 0 });
  });
});
