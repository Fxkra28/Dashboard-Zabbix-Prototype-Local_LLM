import type { FastifyInstance } from 'fastify';
import { parseProfile } from '../services/sli.js';
import { parseAsk, readReport } from '../services/sliAsk.js';
import { singleValues } from '../core/schemas.js';
import { readerGone } from '../core/readerGone.js';
import { sliReadGuard } from '../security/heavyLimit.js';

export async function sliRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sli', { schema: { querystring: singleValues('month', 'profile', 'from', 'to', 'dayHours', 'days') }, preHandler: sliReadGuard }, (req, reply) => {
    const q = req.query as { month?: string; profile?: string; from?: string; to?: string; dayHours?: string; days?: string };
    const profile = parseProfile(q.profile);
    return readReport(parseAsk(q), profile, readerGone(reply));
  });
}
