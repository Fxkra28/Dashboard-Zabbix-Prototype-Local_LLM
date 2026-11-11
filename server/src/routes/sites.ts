import type { FastifyInstance } from 'fastify';
import { sitesView } from '../services/sites.js';

export async function siteRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sites', () => sitesView());
}
