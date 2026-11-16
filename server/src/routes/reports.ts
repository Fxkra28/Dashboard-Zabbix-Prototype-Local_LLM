import type { FastifyInstance } from 'fastify';
import { intParam } from '../core/validate.js';
import { getFreshness, getProblemsByGroup, getStats, getTopTriggers } from '../services/reports.js';
import { singleValues } from '../core/schemas.js';
import { readerGone } from '../core/readerGone.js';
import { heavyReportGuard } from '../security/heavyLimit.js';

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/reports/top-triggers', { schema: { querystring: singleValues('days') }, preHandler: heavyReportGuard }, (req, reply) =>
    getTopTriggers(intParam((req.query as { days?: string }).days, 7, 1, 365), readerGone(reply)),
  );
  app.get('/api/stats', () => getStats());
  app.get('/api/freshness', () => getFreshness());
  app.get('/api/reports/problems-by-group', () => getProblemsByGroup());
}
