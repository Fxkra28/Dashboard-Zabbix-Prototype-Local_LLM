import type { FastifyInstance } from 'fastify';
import { cached } from '../core/cache.js';
import { optionalId } from '../core/validate.js';
import { getSlaSource, slasView, sliView } from '../services/sla.js';
import { singleValues } from '../core/schemas.js';

export async function slaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sla/source', () => cached('sla:source', 60_000, getSlaSource));

  app.get('/api/sla', () => slasView());

  app.get('/api/sla/sli', { schema: { querystring: singleValues('slaid', 'serviceid') } }, (req) => {
    const q = req.query as { slaid?: string; serviceid?: string };
    // Checked before the cache key is built: a junk id would reach Zabbix as a
    // 502 and fill the cache with entries nobody can ask for again.
    const slaid = optionalId(q.slaid, 'slaid');
    const serviceid = optionalId(q.serviceid, 'serviceid');
    if (!slaid) return [];
    return sliView(slaid, serviceid);
  });

  // The service tree that these SLAs measure lives in services/services.ts.
}
