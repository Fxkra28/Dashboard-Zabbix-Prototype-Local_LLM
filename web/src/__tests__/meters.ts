import type { Meter, MetersResponse } from '../types';

/** A meter as GET /api/net/meters returns it: HCML's usual gauge, a 500 Mbps link with four zones. */
export const meter = (over: Partial<Meter> = {}): Meter => ({
  id: 'item-1001',
  title: 'SITE ONE INTERNET',
  page: 'Page 1',
  host: '1.1 SITE1-FW',
  hostid: '10',
  item: 'Interface wan1(): Bits received',
  itemid: '1001',
  direction: 'in',
  link: 'unknown',
  other: null,
  units: 'bps',
  value: 212_060_000,
  clock: 1_800_000_000,
  min: 0,
  max: 500_000_000,
  zones: [
    { from: 0, level: 'low' },
    { from: 125_000_000, level: 'ok' },
    { from: 250_000_000, level: 'warn' },
    { from: 375_000_000, level: 'critical' },
  ],
  fraction: 0.42412,
  zone: 'ok',
  state: 'ok',
  ...over,
});

/** The same widget with no reading to show, for each way that happens. */
export const without = (state: Meter['state'], over: Partial<Meter> = {}): Meter =>
  meter({ state, value: null, clock: null, fraction: null, zone: null, ...over });

/** The opposite direction of the same interface, as the route gives it: 40 Mbps of a 500 Mbps scale unless said. */
export const other = (over: Partial<NonNullable<Meter['other']>> = {}): NonNullable<Meter['other']> => ({
  direction: 'out',
  itemid: '1101',
  value: 40_000_000,
  clock: 1_800_000_000,
  fraction: 0.08,
  zone: 'low',
  ...over,
});

export const response = (meters: Meter[], over: Partial<MetersResponse> = {}): MetersResponse => ({
  dashboard: 'Global view',
  found: true,
  generatedAt: 1_800_000_000,
  meters,
  summary: {
    total: meters.length,
    current: meters.filter((m) => m.state === 'ok').length,
    critical: meters.filter((m) => m.state === 'ok' && m.zone === 'critical').length,
    warn: meters.filter((m) => m.state === 'ok' && m.zone === 'warn').length,
    stale: meters.filter((m) => m.state === 'stale').length,
    unavailable: meters.filter((m) => !['ok', 'stale'].includes(m.state)).length,
    down: meters.filter((m) => m.link === 'down').length,
    otherHigh: meters.filter((m) => m.other?.zone === 'warn' || m.other?.zone === 'critical').length,
  },
  ...over,
});
