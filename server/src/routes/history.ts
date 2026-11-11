import type { FastifyInstance } from 'fastify';
import { intParam } from '../core/validate.js';
import { networkItemsDenied } from '../security/viewerPolicy.js';
import { getGraph, parseItemIds, parseRange } from '../services/history.js';
import { singleValues } from '../core/schemas.js';

const GRAPH_QUERY = singleValues('itemids', 'hours', 'from', 'to', 'month', 'points');

export async function historyRoutes(app: FastifyInstance): Promise<void> {
  // ?itemids=a,b&hours=24 | &from=&to= | &month=YYYY-MM   [&points=1500]  (getGraph says how it is read)
  app.get('/api/graph', { schema: { querystring: GRAPH_QUERY } }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const ids = parseItemIds(q.itemids);
    const denied = await networkItemsDenied(req, ids);
    if (denied) return reply.code(403).send({ error: 'forbidden', message: denied });
    const now = Math.floor(Date.now() / 1000);
    const { from, to } = parseRange(q, now);
    const points = intParam(q.points, 1500, 200, 3000);
    return getGraph({ ids, from, to, points, now });
  });
}
