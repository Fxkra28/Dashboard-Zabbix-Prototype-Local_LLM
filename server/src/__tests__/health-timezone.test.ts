import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * The SLA time zone is a server setting, so /api/health hands
 * it to the web app, which labels times and cuts its month lists in it rather
 * than restating Asia/Jakarta.
 */

vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: vi.fn().mockResolvedValue([]) };
});

/** `health.ts` fresh, so the `config` it captures sees `SLA_TIMEZONE` as set here (an empty value is unset). */
async function healthDefaults(zone: string) {
  vi.resetModules();
  vi.stubEnv('SLA_TIMEZONE', zone);
  const { registerHealth, createReadiness } = await import('../http/health.js');
  const app = Fastify({ logger: false });
  registerHealth(app, createReadiness({ probes: { zabbix: async () => [], model: async () => 'off' } }));
  const res = await app.inject({ url: '/api/health' });
  await app.close();
  return res.json().defaults as { availabilityMinSeverity: number; timezone: string };
}

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/health: defaults.timezone', () => {
  it('is Asia/Jakarta when SLA_TIMEZONE is not set', async () => {
    expect((await healthDefaults('')).timezone).toBe('Asia/Jakarta');
  });

  it('is the zone the reports are cut in when SLA_TIMEZONE is set', async () => {
    const defaults = await healthDefaults('Asia/Makassar');
    expect(defaults.timezone).toBe('Asia/Makassar');
    // The other server-owned default is still there.
    expect(defaults.availabilityMinSeverity).toEqual(expect.any(Number));
  });
});
