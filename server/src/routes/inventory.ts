import type { FastifyInstance } from 'fastify';
import { cached } from '../core/cache.js';
import { getScorecard } from '../services/inventory.js';

export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/reports/inventory', () => cached('inventory:scorecard', 60_000, getScorecard));
}
