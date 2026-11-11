import type { FastifyInstance } from 'fastify';
import { linksView } from '../services/links.js';

export async function linkRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/links', () => linksView());
}
