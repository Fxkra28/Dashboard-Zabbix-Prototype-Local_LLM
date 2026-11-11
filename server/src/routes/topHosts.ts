import type { FastifyInstance } from 'fastify';
import { intParam } from '../core/validate.js';
import { TOP_HOSTS_ROWS, topHostsView } from '../services/topHosts.js';
import { singleValues } from '../core/schemas.js';

export async function topHostRoutes(app: FastifyInstance): Promise<void> {
  // ?limit= rows for each metric, 1 to 20.
  app.get('/api/reports/top-hosts', { schema: { querystring: singleValues('limit') } }, (req) => {
    const limit = intParam((req.query as { limit?: string }).limit, TOP_HOSTS_ROWS, 1, 20);
    return topHostsView(limit);
  });
}
