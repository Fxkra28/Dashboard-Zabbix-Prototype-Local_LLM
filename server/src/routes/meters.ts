import type { FastifyInstance } from 'fastify';
import { metersView } from '../services/meters.js';

export async function meterRoutes(app: FastifyInstance): Promise<void> {
  // /api/net: operator and up (auth.ts).
  app.get('/api/net/meters', () => metersView());
}
