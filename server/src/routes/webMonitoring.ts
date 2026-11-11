import type { FastifyInstance } from 'fastify';
import { intParam } from '../core/validate.js';
import { WEB_FAILURES_ROWS, webMonitoringView } from '../services/webMonitoring.js';
import { singleValues } from '../core/schemas.js';

export async function webMonitoringRoutes(app: FastifyInstance): Promise<void> {
  // ?limit= failed scenarios to list, 1 to 50.
  app.get('/api/reports/web-monitoring', { schema: { querystring: singleValues('limit') } }, (req) => {
    const limit = intParam((req.query as { limit?: string }).limit, WEB_FAILURES_ROWS, 1, 50);
    return webMonitoringView(limit);
  });
}
