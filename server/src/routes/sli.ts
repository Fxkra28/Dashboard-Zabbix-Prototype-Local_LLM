import type { FastifyInstance } from 'fastify';
import { config } from '../core/config.js';
import { currentMonth, parseMonth } from '../sli/time.js';
import { parseProfile, getMonthlySli } from '../services/sli.js';
import { singleValues } from '../core/schemas.js';

export async function sliRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sli', { schema: { querystring: singleValues('month', 'profile') } }, (req) => {
    const q = req.query as { month?: string; profile?: string };
    const month = q.month ? parseMonth(q.month) : currentMonth(config.sla.timezone);
    return getMonthlySli(month, parseProfile(q.profile));
  });
}
