import type { FastifyInstance } from 'fastify';
import { metersView } from '../services/meters.js';

export async function meterRoutes(app: FastifyInstance): Promise<void> {
  // /api/net: wall and up (auth.ts).
  app.get('/api/net/meters', () => metersView());
}
