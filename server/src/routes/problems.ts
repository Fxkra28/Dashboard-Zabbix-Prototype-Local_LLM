import type { FastifyInstance } from 'fastify';
import { cachedProblems } from '../domain/queries.js';

export async function problemRoutes(app: FastifyInstance): Promise<void> {
  // Current problems, host-enriched. Cached 15 s, the entry the live stream shares.
  app.get('/api/problems', () => cachedProblems());
}
