import type { FastifyInstance } from 'fastify';
import { devicesView } from '../services/devices.js';

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/devices', () => devicesView());
}
