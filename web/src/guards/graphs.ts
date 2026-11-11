/** The check for a graph. */

import type { GraphResponse, GraphSeries } from '../types';
import { bad, type Check, flag, guard, listOf, num, orNull, shape, text, under } from './shape';

/**
 * A graph series holds up to 3,000 points, so only the first and the last are looked at: that
 * tells a list of [time, avg, min, max] from anything else without walking every one.
 */
const points: Check = (v) => {
  if (!Array.isArray(v)) return bad(v, 'a list');
  for (const i of v.length === 0 ? [] : [0, v.length - 1]) {
    const p = v[i];
    if (!Array.isArray(p) || p.length !== 4 || typeof p[0] !== 'number') return under(`[${i}]`, { path: '', why: 'is not a [time, average, min, max] point' });
  }
  return null;
};

const graphSeries = shape<GraphSeries>({
  itemid: text,
  name: text,
  host: text,
  units: text,
  value_type: text,
  delaySeconds: num,
  step: flag,
  points,
  stats: orNull(shape<NonNullable<GraphSeries['stats']>>({ min: num, avg: num, max: num, last: num, lastClock: num })),
  coverage: shape<GraphSeries['coverage']>({ coveredSeconds: num, firstClock: orNull(num), lastClock: orNull(num) }),
});

const graph = shape<GraphResponse>({
  from: num,
  to: num,
  source: text,
  series: listOf(graphSeries),
  latestClock: orNull(num),
  downsampled: flag,
});

/** GET /api/graph. */
export const graphGuard = guard<GraphResponse>('the graph', graph);
