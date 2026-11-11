import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Network interface data for a viewer, read by item id. viewer-network.test.ts covers the lists,
 * which leave interface items out. A list is not a lock: /api/graph reads an item by id, and ids
 * can be guessed, so it asks what the item is and refuses a viewer an interface one.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer,olu:operator-pass:operator,adi:admin-pass:admin';
});

const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/zabbix.js')>()),
  zbx: zbxMock,
}));

const { config } = await import('../core/config.js');
const { setupAuth, tokenClaims } = await import('../security/auth.js');
const { registerErrorHandler } = await import('../http/errors.js');
const { invalidate } = await import('../core/cache.js');
const { historyRoutes } = await import('../routes/history.js');

/** Which key each made-up item id has. An id that is not here is one Zabbix does not know. */
const KEYS: Record<string, string> = {
  '101': 'net.if.in[eth0]',
  '102': 'net.if.status[eth0]',
  '201': 'icmpping',
  '202': 'system.cpu.util',
};

type Params = Record<string, unknown>;
const callsOf = (method: string) => zbxMock.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Params);

let app: FastifyInstance;

beforeEach(async () => {
  invalidate('');
  zbxMock.mockReset().mockImplementation(async (method: string, params: Params) => {
    if (method !== 'item.get') return [];
    const ids = (params.itemids ?? []) as string[];
    return ids
      .filter((id) => id in KEYS)
      .map((id) => ({
        itemid: id,
        key_: KEYS[id],
        name: `item ${id}`,
        units: '',
        value_type: '3',
        delay: '1m',
        hostid: '10',
        hosts: [{ hostid: '10', name: 'h' }],
      }));
  });
  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await setupAuth(app);
  await app.register(historyRoutes);
  await app.ready();
});
afterEach(async () => {
  config.auth.enabled = true;
  await app.close();
});

const as = (sub: string, role: string) => ({
  authorization: `Bearer ${app.jwt.sign({ sub, role, ...tokenClaims(config.auth.sessionCookie) }, { expiresIn: '1h' })}`,
});
const viewer = () => as('ana', 'viewer');
const operator = () => as('olu', 'operator');
const admin = () => as('adi', 'admin');
const get = (url: string, headers: Record<string, string>) => app.inject({ url, headers });

const READS = [
  ['graph', (id: string) => `/api/graph?itemids=${id}&hours=1`],
] as const;

describe.each(READS)('/api/%s by item id', (_name, url) => {
  it('refuses a viewer an interface item, in the usual 403 shape, and reads no history for it', async () => {
    for (const id of ['101', '102']) {
      const res = await get(url(id), viewer());
      expect(res.statusCode, id).toBe(403);
      expect(res.json()).toEqual({
        error: 'forbidden',
        message: 'Network interface data needs the "wall" role; you are signed in as "viewer".',
      });
    }
    const reads = zbxMock.mock.calls.filter(([m]) => m === 'history.get' || m === 'trend.get');
    expect(reads).toHaveLength(0);
  });

  it('lets a viewer read any other item', async () => {
    for (const id of ['201', '202']) expect((await get(url(id), viewer())).statusCode, id).not.toBe(403);
  });

  it('lets an operator and an admin read an interface item, with no lookup of the key at all', async () => {
    expect((await get(url('101'), operator())).statusCode).not.toBe(403);
    expect((await get(url('101'), admin())).statusCode).not.toBe(403);
    // Graph asks for the item itself, as it always did; the policy's own lookup asks only for the key.
    const policyLookups = callsOf('item.get').filter((p) => Array.isArray(p.output) && (p.output as string[]).join() === 'itemid,key_');
    expect(policyLookups).toHaveLength(0);
  });

  it('leaves an id Zabbix does not know to the route, which answers as it always did', async () => {
    const res = await get(url('999'), viewer());
    expect(res.statusCode).not.toBe(403);
  });
});

describe('the lookup behind it', () => {
  it('asks Zabbix for the keys once for a while, however often a viewer reads', async () => {
    for (let i = 0; i < 3; i++) await get('/api/graph?itemids=201&hours=1', viewer());
    const lookups = callsOf('item.get').filter((p) => Array.isArray(p.output) && (p.output as string[]).join() === 'itemid,key_');
    expect(lookups).toHaveLength(1);
    expect(lookups[0]?.itemids).toEqual(['201']);
  });

  it('refuses a graph of several items when only one of them is an interface item', async () => {
    const res = await get('/api/graph?itemids=201,101&hours=1', viewer());
    expect(res.statusCode).toBe(403);
  });

  it('does not let a viewer reach an interface item by listing it twice or in another order', async () => {
    expect((await get('/api/graph?itemids=101,101&hours=1', viewer())).statusCode).toBe(403);
    expect((await get('/api/graph?itemids=202,101&hours=1', viewer())).statusCode).toBe(403);
  });

  it('shows everything with sign-in off, where every caller is admin, and looks nothing up', async () => {
    config.auth.enabled = false;
    const res = await app.inject({ url: '/api/graph?itemids=101&hours=1' });
    expect(res.statusCode).not.toBe(403);
    expect(callsOf('item.get').filter((p) => (p.output as string[] | undefined)?.join() === 'itemid,key_')).toHaveLength(0);
  });

  it('counts a viewer whose token has no known role as a viewer: it fails closed', async () => {
    const res = await get('/api/graph?itemids=101&hours=1', as('ana', 'nonsense'));
    expect(res.statusCode).toBe(403);
  });
});
