import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { cached, invalidate, REFRESH_RETRY_MS } from '../core/cache.js';
import { registerCompression } from '../http/compress.js';
import { registerErrorHandler } from '../http/errors.js';
import { AGE_HEADER, STALE_HEADER, noteStale, registerStaleHeaders } from '../core/staleness.js';

/**
 * An answer that is an old copy kept because Zabbix failed
 * says so in two headers, and only then. The body is never touched.
 */

const { computeMock } = vi.hoisted(() => ({ computeMock: vi.fn() }));
vi.mock('../sli/engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sli/engine.js')>();
  return { ...actual, computeSli: computeMock };
});

const { sliRoutes } = await import('../routes/sli.js');

const NOW = new Date('2026-10-02T03:00:00Z');
const DAY = 86_400_000;
const later = (ms: number) => vi.setSystemTime(new Date(NOW.getTime() + ms));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  invalidate('');
  computeMock.mockReset();
});
afterEach(() => vi.useRealTimers());

type Plugin = (app: FastifyInstance) => void | Promise<void>;

/** A bare app wired as index.ts wires it: the error handler and the stale hook before the routes. */
async function appWith(...plugins: Plugin[]) {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  registerStaleHeaders(app);
  for (const plugin of plugins) {
    await app.register(async (child) => {
      await plugin(child);
    });
  }
  await app.ready();
  return app;
}

describe('stale headers on a real report route', () => {
  it('adds X-Data-Stale and the age when Zabbix fails and the old report is served', async () => {
    const app = await appWith(sliRoutes);
    computeMock.mockResolvedValueOnce({ marker: 'august' });

    const live = await app.inject({ url: '/api/sli?month=2026-08' });
    expect(live.statusCode).toBe(200);
    expect(live.headers[STALE_HEADER.toLowerCase()]).toBeUndefined();
    expect(live.headers[AGE_HEADER.toLowerCase()]).toBeUndefined();

    // Three days on, far past the day it keeps a closed month and the day it may serve it unrefreshed.
    later(3 * DAY);
    computeMock.mockRejectedValueOnce(new Error('zabbix down'));
    const stale = await app.inject({ url: '/api/sli?month=2026-08' });
    expect(stale.statusCode).toBe(200);
    expect(stale.headers[STALE_HEADER.toLowerCase()]).toBe('true');
    expect(stale.headers[AGE_HEADER.toLowerCase()]).toBe(String((3 * DAY) / 1000));
    // The body is the old report as it was.
    expect(stale.json()).toEqual({ marker: 'august' });
    expect(stale.json()).toEqual(live.json());

    // The minute after the failure: the old copy again, marked, without asking Zabbix (BK-31).
    computeMock.mockResolvedValueOnce({ marker: 'august again' });
    const inside = await app.inject({ url: '/api/sli?month=2026-08' });
    expect(inside.json()).toEqual({ marker: 'august' });
    expect(inside.headers[STALE_HEADER.toLowerCase()]).toBe('true');
    expect(computeMock).toHaveBeenCalledTimes(2);

    // Zabbix back, once that minute is over: a live answer carries no header again.
    later(3 * DAY + REFRESH_RETRY_MS);
    const back = await app.inject({ url: '/api/sli?month=2026-08' });
    expect(back.json()).toEqual({ marker: 'august again' });
    expect(back.headers[STALE_HEADER.toLowerCase()]).toBeUndefined();
    await app.close();
  });

  it('does not add them to an error: a report that was never cached just fails', async () => {
    const app = await appWith(sliRoutes);
    computeMock.mockRejectedValueOnce(new Error('zabbix down'));
    const res = await app.inject({ url: '/api/sli?month=2026-08' });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.headers[STALE_HEADER.toLowerCase()]).toBeUndefined();
    await app.close();
  });
});

describe('stale headers per request', () => {
  const down = () => Promise.reject(new Error('zabbix down'));

  it('names the oldest copy when one request was answered with several', async () => {
    const app = await appWith((a) => {
      a.get('/both', async () => {
        const [x, y] = [
          await cached('x', 1_000, down, { staleIfError: true }),
          await cached('y', 1_000, down, { staleIfError: true }),
        ];
        return { x, y };
      });
    });
    await cached('x', 1_000, async () => 'x1', { staleIfError: true });
    later(60_000);
    await cached('y', 1_000, async () => 'y1', { staleIfError: true });
    later(180_000);

    const res = await app.inject({ url: '/both' });
    expect(res.json()).toEqual({ x: 'x1', y: 'y1' });
    // x is 180 s old, y 120 s: the page is as old as its oldest figure.
    expect(res.headers[AGE_HEADER.toLowerCase()]).toBe('180');
    await app.close();
  });

  it('does not leak between requests that overlap', async () => {
    const app = await appWith((a) => {
      a.get('/old', async () => ({ v: await cached('old', 1_000, down, { staleIfError: true }) }));
      a.get('/live', async () => {
        await new Promise((r) => setTimeout(r, 20));
        return { v: await cached('live', 1_000, async () => 'fresh') };
      });
    });
    await cached('old', 1_000, async () => 'kept', { staleIfError: true });
    later(60_000);

    const [old, live] = await Promise.all([app.inject({ url: '/old' }), app.inject({ url: '/live' })]);
    expect(old.headers[STALE_HEADER.toLowerCase()]).toBe('true');
    expect(live.json()).toEqual({ v: 'fresh' });
    expect(live.headers[STALE_HEADER.toLowerCase()]).toBeUndefined();
    await app.close();
  });

  it('survives compression, which rewrites the body after the route has answered', async () => {
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerCompression(app);
    registerStaleHeaders(app);
    app.get('/big', async () => ({ rows: await cached('big', 1_000, down, { staleIfError: true }) }));
    await app.ready();
    await cached('big', 1_000, async () => 'x'.repeat(5_000), { staleIfError: true });
    later(60_000);

    const res = await app.inject({ url: '/big', headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers[STALE_HEADER.toLowerCase()]).toBe('true');
    expect(res.headers[AGE_HEADER.toLowerCase()]).toBe('60');
    await app.close();
  });

  it('ignores a stale answer given outside any request, such as a refresh the cache runs itself', () => {
    expect(() => noteStale(5_000)).not.toThrow();
  });

  it('is not added by an answer that is merely served from cache', async () => {
    const app = await appWith((a) => {
      a.get('/hit', async () => ({ v: await cached('hit', 60_000, async () => 'cached', { staleIfError: true }) }));
    });
    await app.inject({ url: '/hit' });
    later(30_000);
    const res = await app.inject({ url: '/hit' });
    expect(res.headers[STALE_HEADER.toLowerCase()]).toBeUndefined();
    await app.close();
  });
});

describe('index.ts', () => {
  /** The code alone: a call inside a comment is not a call. */
  const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const HOOK_CALL = /^[ \t]*registerStaleHeaders\(app\);/m;

  it('registers the hook before the first route, since a hook reaches only the routes added after it', async () => {
    const { readFile } = await import('node:fs/promises');
    const index = withoutComments(await readFile(new URL('../index.ts', import.meta.url), 'utf8'));
    const hook = index.search(HOOK_CALL);
    expect(hook).toBeGreaterThan(-1);
    expect(hook).toBeLessThan(index.indexOf('await app.register(hostRoutes)'));
    expect(index).toMatch(/import \{[^}]*\bregisterStaleHeaders\b[^}]*\} from '\.\/core\/staleness\.js';/);
  });

  it('does not count a call that is commented out', () => {
    expect(withoutComments('  registerStaleHeaders(app);\n').search(HOOK_CALL)).toBe(0);
    expect(withoutComments('// registerStaleHeaders(app);\n').search(HOOK_CALL)).toBe(-1);
    expect(withoutComments('/*\n registerStaleHeaders(app);\n*/\n').search(HOOK_CALL)).toBe(-1);
  });
});
