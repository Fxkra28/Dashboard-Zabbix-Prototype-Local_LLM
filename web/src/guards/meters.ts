/** The check for the internet traffic meters. */

import type { Meter, MeterOther, MeterZone, MetersResponse } from '../types';
import { flag, guard, listOf, num, orNull, shape, text } from './shape';

const meterZone = shape<MeterZone>({ from: num, level: text });

const meterOther = shape<MeterOther>({
  direction: text,
  itemid: text,
  value: orNull(num),
  clock: orNull(num),
  fraction: orNull(num),
  zone: orNull(text),
});

const meter = shape<Meter>({
  id: text,
  title: text,
  page: text,
  host: orNull(text),
  hostid: orNull(text),
  item: orNull(text),
  itemid: orNull(text),
  direction: orNull(text),
  link: text,
  other: orNull(meterOther),
  units: text,
  value: orNull(num),
  clock: orNull(num),
  min: num,
  max: orNull(num),
  zones: listOf(meterZone),
  fraction: orNull(num),
  zone: orNull(text),
  state: text,
});

const meters = shape<MetersResponse>({
  dashboard: text,
  found: flag,
  generatedAt: num,
  meters: listOf(meter),
  summary: shape<MetersResponse['summary']>({
    total: num,
    current: num,
    critical: num,
    warn: num,
    stale: num,
    unavailable: num,
    down: num,
    otherHigh: num,
  }),
});

/** GET /api/net/meters. */
export const metersGuard = guard<MetersResponse>('the internet traffic meters', meters);
