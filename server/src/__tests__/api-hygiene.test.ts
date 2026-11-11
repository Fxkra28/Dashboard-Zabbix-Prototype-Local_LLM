import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pingZabbix } from './helpers/pingZabbix.js';
import { buildTestApp } from './helpers/app.js';
import { sampleSliReports } from './helpers/sliReportFixture.js';

/**
 * Small API hygiene: lists grouped in linear time (links, service tree), and ids and body types
 * checked before they reach Zabbix (/api/sla/sli, POST /api/problems/acknowledge). Zabbix is mocked
 * as in routes.test.ts; the real error handler is kept so the status codes are the ones production
 * answers.
 */
const { zbxMock, zbxWriteMock } = vi.hoisted(() => ({ zbxMock: vi.fn(), zbxWriteMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock, zbxWrite: zbxWriteMock };
});

afterEach(() => {
  zbxMock.mockReset();
  zbxWriteMock.mockReset();
  vi.useRealTimers();
});

describe('grouping stays linear', () => {
  // Links keeps its list of ping items an hour (links.ts), so each test starts from an empty cache.
  beforeEach(async () => {
    (await import('../core/cache.js')).invalidate('');
  });

  // Copying the list on every add took 4.6 s for 50,000 links and 6.2 s for 40,000 tree hosts,
  // and blocked every other request meanwhile; with push it is a fraction of a second. The
  // sizes and ceilings leave room for a machine busy with other tests: with push, twelve
  // copies of this file at once stayed under half of them.
  it('puts 80,000 links of one path in a list without slowing down', async () => {
    const now = Math.floor(Date.now() / 1000);
    zbxMock.mockImplementation(async (method: string) =>
      method === 'item.get'
        ? Array.from({ length: 80_000 }, (_, i) => ({
            itemid: String(i),
            name: 'ICMP ping',
            key_: 'icmpping',
            lastvalue: '1',
            lastclock: String(now - 5),
            state: '0',
            delay: '1m',
            hosts: [{ hostid: String(i), name: `HOST ${i}` }],
            tags: [{ tag: 'link_group', value: 'ONE PATH' }],
          }))
        : [],
    );
    const { getLinks } = await import('../services/links.js');
    const started = performance.now();
    const res = await getLinks();
    const took = performance.now() - started;
    expect(res.paths).toHaveLength(1);
    expect(res.paths[0].links).toHaveLength(80_000);
    expect(took).toBeLessThan(4_000);
  }, 30_000);

  it('keeps the links of a path worst first, then by name', async () => {
    const now = Math.floor(Date.now() / 1000);
    // Arrives in an order that is neither the sorted one nor its reverse.
    const hosts: [string, '0' | '1'][] = [['ALPHA', '1'], ['ZULU', '0'], ['MIKE', '1'], ['BRAVO', '0']];
    zbxMock.mockImplementation(
      pingZabbix(
        hosts.map(([name, up], i) => ({
          itemid: String(i),
          name: `ICMP ${name}`,
          key_: 'icmpping',
          lastvalue: up,
          lastclock: String(now - 5),
          state: '0',
          delay: '1m',
          value_type: '3',
          hosts: [{ hostid: String(i), name }],
          tags: [{ tag: 'link_group', value: 'ONE PATH' }],
        })),
      ),
    );
    const { getLinks } = await import('../services/links.js');
    const res = await getLinks();
    const worstFirst = ['BRAVO', 'ZULU', 'ALPHA', 'MIKE'];
    expect(res.paths).toHaveLength(1);
    expect(res.paths[0].links.map((l) => l.host)).toEqual(worstFirst);
    expect(res.links.map((l) => l.host)).toEqual(worstFirst);
  });

  it('builds a service tree with 60,000 hosts at one site and class without slowing down', async () => {
    const { strict } = sampleSliReports();
    const template = strict.hosts.find((h) => h.site && h.deviceClass === 'switch')!;
    for (let i = 0; i < 60_000; i++) strict.hosts.push({ ...template, hostid: `x${i}`, name: `BULK ${i}` });
    const { buildDerivedTree } = await import('../sli/tree.js');

    const started = performance.now();
    const res = buildDerivedTree(strict, [], '2026-08');
    const took = performance.now() - started;
    const site = res.tree[0].children.find((n) => n.serviceid === `derived:site:${template.site!.code}`)!;
    const switches = site.children.find((n) => n.kind === 'class' && n.name === 'Switches')!;
    expect(switches.children.length).toBeGreaterThanOrEqual(60_000);
    expect(took).toBeLessThan(4_000);
  }, 30_000);

  it('keeps the tree shape: sites in code order, hosts in natural name order within a class', async () => {
    const { strict } = sampleSliReports();
    const { buildDerivedTree } = await import('../sli/tree.js');
    const res = buildDerivedTree(strict, [], '2026-08');
    const sites = res.tree[0].children.filter((n) => n.kind === 'site' && n.serviceid !== 'derived:unassigned');
    const codes = sites.map((n) => Number(n.serviceid.split(':')[2]));
    expect(codes).toEqual([...codes].sort((a, b) => a - b));
    const site1 = sites[0].children.find((n) => n.name === 'Switches')!;
    expect(site1.children.map((n) => n.name)).toEqual([
      '1.2.1 SAMPLE SWITCH 01',
      '1.2.2 SAMPLE SWITCH 02',
      '1.2.3 SAMPLE SWITCH 03',
      '1.2.4 SAMPLE SWITCH 04',
    ]);
  });
});

describe('GET /api/sla/sli ids', () => {
  it.each([
    ['a word', '/api/sla/sli?slaid=abc'],
    ['a negative number', '/api/sla/sli?slaid=-1'],
    ['an id with a suffix', '/api/sla/sli?slaid=1x'],
    ['a bad service id', '/api/sla/sli?slaid=1&serviceid=abc'],
    ['a bad service id with no slaid', '/api/sla/sli?serviceid=abc'],
  ])('answers 400, never 502, for %s, and never reaches Zabbix', async (_what, url) => {
    const { slaRoutes } = await import('../routes/sla.js');
    const app = await buildTestApp(slaRoutes);
    const res = await app.inject({ url });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad_request', message: expect.stringMatching(/numeric Zabbix id/) });
    expect(zbxMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('answers 400 for an id sent twice, saying so, and never reaches Zabbix (BK-14)', async () => {
    const { slaRoutes } = await import('../routes/sla.js');
    const app = await buildTestApp(slaRoutes);
    const res = await app.inject({ url: '/api/sla/sli?slaid=1&slaid=2' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad_request', message: 'slaid must be given once.' });
    expect(zbxMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('still answers [] when no SLA is named, and passes numeric ids through', async () => {
    zbxMock.mockImplementation(async (method: string) =>
      method === 'sla.getsli'
        ? { periods: [{ period_from: 1, period_to: 2 }], serviceids: [5], sli: [[{ uptime: 9, downtime: 1, sli: 90, error_budget: 3 }]] }
        : [{ serviceid: '5', name: 'Portal' }],
    );
    const { slaRoutes } = await import('../routes/sla.js');
    const app = await buildTestApp(slaRoutes);

    expect((await app.inject({ url: '/api/sla/sli' })).json()).toEqual([]);
    expect((await app.inject({ url: '/api/sla/sli?slaid=' })).json()).toEqual([]);
    expect(zbxMock).not.toHaveBeenCalled();

    const ok = await app.inject({ url: '/api/sla/sli?slaid=12&serviceid=5' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual([expect.objectContaining({ serviceid: '5', name: 'Portal', sli: 90 })]);
    const call = zbxMock.mock.calls.find(([m]) => m === 'sla.getsli');
    expect(call?.[1]).toMatchObject({ slaid: '12', serviceids: ['5'] });
    await app.close();
  });
});

describe('POST /api/problems/acknowledge body types', () => {
  // Sign-in on whatever the environment says, as in routes.test.ts.
  let savedToken: string;
  let savedAuth: boolean;
  beforeEach(async () => {
    const { config } = await import('../core/config.js');
    savedToken = config.zbxWriteToken;
    savedAuth = config.auth.enabled;
    config.zbxWriteToken = 'test-only-not-a-real-token';
    config.auth.enabled = true;
    zbxWriteMock.mockResolvedValue({ eventids: ['109'] });
  });
  afterEach(async () => {
    const { config } = await import('../core/config.js');
    config.zbxWriteToken = savedToken;
    config.auth.enabled = savedAuth;
  });

  const post = async (payload: unknown) => {
    const { actionRoutes } = await import('../routes/actions.js');
    const app = await buildTestApp(actionRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/problems/acknowledge',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    });
    await app.close();
    return res;
  };

  it.each([
    ['a number', { message: 5 }, 'message must be text.'],
    ['an object', { message: { text: 'x' } }, 'message must be text.'],
    ['a list', { message: ['x'] }, 'message must be text.'],
    ['a boolean', { message: true }, 'message must be text.'],
  ])('answers 400, not 500, when message is %s', async (_what, extra, message) => {
    const res = await post({ eventids: ['109'], ...extra });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad_request', message });
    expect(zbxWriteMock).not.toHaveBeenCalled();
  });

  it.each([
    ['the text "false"', { acknowledge: 'false' }, 'acknowledge must be true or false.'],
    ['the number 0', { acknowledge: 0 }, 'acknowledge must be true or false.'],
    ['an object', { acknowledge: {} }, 'acknowledge must be true or false.'],
    ['the text "true"', { close: 'true' }, 'close must be true or false.'],
    ['the number 1', { close: 1 }, 'close must be true or false.'],
  ])('answers 400, and writes nothing, when the flag is %s', async (_what, extra, message) => {
    const res = await post({ eventids: ['109'], ...extra });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad_request', message });
    expect(zbxWriteMock).not.toHaveBeenCalled();
  });

  it.each([['a list', [1, 2]], ['a string', 'ack all'], ['a number', 5], ['a boolean', true]])(
    'answers 400 when the body is %s rather than an object',
    async (_what, payload) => {
      const res = await post(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'bad_request', message: 'The request body must be a JSON object.' });
      expect(zbxWriteMock).not.toHaveBeenCalled();
    },
  );

  it('keeps asking for event ids first', async () => {
    const res = await post({ message: 5 });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/eventids is required/);
  });

  it('still accepts real booleans and text, and reads null as not given', async () => {
    const closeOnly = await post({ eventids: ['109'], acknowledge: false, close: true, message: null });
    expect(closeOnly.statusCode).toBe(200);
    expect(closeOnly.json()).toMatchObject({ ok: true, action: 1 });

    const all = await post({ eventids: ['109'], acknowledge: true, close: true, message: ' on it ' });
    expect(all.json()).toMatchObject({ action: 7 });
    expect(zbxWriteMock.mock.calls.at(-1)?.[1]).toMatchObject({ message: '[portal:anonymous] on it', action: 7 }); // the portal tags every message

    const nulls = await post({ eventids: ['109'], acknowledge: null, close: null });
    expect(nulls.json()).toMatchObject({ action: 2 });
  });
});
