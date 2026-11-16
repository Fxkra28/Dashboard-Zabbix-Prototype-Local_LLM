import type { FastifyInstance } from 'fastify';
import { config } from '../core/config.js';
import { getDerivedServices } from '../sli/tree.js';
import { currentMonth, parseMonth } from '../sli/time.js';
import { parseProfile } from '../services/sli.js';
import { serviceTreeView } from '../services/services.js';
import { singleValues } from '../core/schemas.js';
import { readerGone } from '../core/readerGone.js';
import { sliReadGuard } from '../security/heavyLimit.js';

export async function serviceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/services', () => serviceTreeView());

  // The tree built from the estate itself, for a Zabbix with no services
  // configured (sli/tree.ts). ?month=YYYY-MM&profile=availability|hcml-report
  app.get('/api/services/derived', { schema: { querystring: singleValues('month', 'profile') }, preHandler: sliReadGuard }, (req, reply) => {
    const q = req.query as { month?: string; profile?: string };
    const month = q.month ? parseMonth(q.month) : currentMonth(config.sla.timezone);
    return getDerivedServices(month, parseProfile(q.profile), readerGone(reply));
  });
}
