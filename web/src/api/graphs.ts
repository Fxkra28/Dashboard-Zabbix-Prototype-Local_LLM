/** The call behind the Graphs page. */

import type { GraphResponse, GraphRange } from '../types';
import { graphGuard } from '../guards';
import { qs, request } from './client';

export const graphsApi = {
  /** Chart-ready series for 1 to 4 numeric items over a pinned window. */
  graph: (itemids: string[], range: GraphRange, points?: number) =>
    request<GraphResponse>(
      `/api/graph${qs({
        itemids: itemids.join(','),
        points,
        ...(range.kind === 'hours'
          ? { hours: range.hours }
          : range.kind === 'month'
            ? { month: range.month }
            : { from: range.from, to: range.to }),
      })}`,
      { guard: graphGuard },
    ),
};
