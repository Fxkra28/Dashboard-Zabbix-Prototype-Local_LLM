import Fastify, { type FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../../http/errors.js';
import { AJV_OPTIONS } from '../../core/schemas.js';
import { invalidate } from '../../core/cache.js';

type RoutePlugin = (app: FastifyInstance) => Promise<void>;

/**
 * A bare Fastify instance carrying one route module and the real error
 * handler, driven with `app.inject()`, no listening socket, no live Zabbix.
 *
 * Every route module has the same plugin signature, so each can be mounted in
 * isolation. The real `registerErrorHandler` is used rather than a stand-in so
 * the tests assert the status codes production actually returns.
 */
export async function buildTestApp(...plugins: RoutePlugin[]): Promise<FastifyInstance> {
  // Route handlers cache by key; without this a value cached by one test would
  // be served to the next and the second test would never call its mock.
  invalidate('');

  const app = Fastify({ logger: false, ajv: AJV_OPTIONS });
  registerErrorHandler(app);
  for (const plugin of plugins) await app.register(plugin);
  await app.ready();
  return app;
}

/** Zabbix returns everything as strings: fixtures must too, or they hide bugs. */
export const zHost = (over: Partial<Record<string, unknown>> = {}) => ({
  hostid: '10689',
  name: '1.2.1 IDX02CORESWITCH',
  status: '0',
  maintenance_status: '0',
  interfaces: [{ ip: '10.0.0.1', type: '2', available: '1' }],
  tags: [{ tag: 'site', value: 'Jakarta' }],
  ...over,
});

export const zProblem = (over: Partial<Record<string, unknown>> = {}) => ({
  eventid: '109',
  objectid: '25238',
  clock: '1788838236',
  r_eventid: '0',
  severity: '2',
  acknowledged: '0',
  name: 'High ICMP ping loss',
  hosts: [{ hostid: '10697', name: '4.3.3 FPSO ARUBA 3' }],
  ...over,
});
