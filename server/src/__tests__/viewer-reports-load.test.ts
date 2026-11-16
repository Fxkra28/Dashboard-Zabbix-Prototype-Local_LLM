import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp } from './helpers/app.js';
import { cached, invalidate, MAX_TYPED_ENTRIES } from '../core/cache.js';

/**
 * Three viewer reports once read Zabbix again for every value of a number the caller picks (BK-61): the rows cut off by `limit` and the days
 * of the top triggers. A viewer could start hundreds of cold reads and push the problem list out of the cache.
 */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../clients/zabbix.js')>()), zbx: zbxMock }));

const { topHostRoutes } = await import('../routes/topHosts.js');
const { webMonitoringRoutes } = await import('../routes/webMonitoring.js');
const { reportRoutes } = await import('../routes/reports.js');
const { heavy } = await import('../services/reportPolicy.js');

const NOW = Math.floor(Date.now() / 1000);
const tick = () => new Promise<void>((r) => setTimeout(r, 20));

/** 25 hosts for each of the two metrics, and 60 web scenarios that have failed. */
function estate() {
  zbxMock.mockImplementation(async (method: string, params: { search?: { key_?: string } }) => {
    if (method !== 'item.get') return [];
    const key = params.search?.key_ ?? '';
    if (key === 'web.test.fail[') {
      return Array.from({ length: 60 }, (_, i) => ({
        itemid: `w${i}`,
        key_: `web.test.fail[Site ${String(i).padStart(2, '0')}]`,
        lastvalue: '2',
        lastclock: String(NOW),
        delay: '1m',
        state: '0',
        hosts: [{ hostid: `h${i}`, name: `HOST ${String(i).padStart(2, '0')}` }],
      }));
    }
    return Array.from({ length: 25 }, (_, i) => ({
      itemid: `${key}-${i}`,
      key_: key === 'system.cpu.util' ? 'system.cpu.util' : 'vm.memory.util',
      lastvalue: String(90 - i),
      lastclock: String(NOW),
      delay: '1m',
      state: '0',
      hosts: [{ hostid: `h${i}`, name: `HOST ${String(i).padStart(2, '0')}` }],
    }));
  });
}

afterEach(() => {
  zbxMock.mockReset();
  invalidate('');
});

describe('the top hosts report', () => {
  it('reads Zabbix once for every limit asked, and cuts the rows afterwards', async () => {
    estate();
    const app = await buildTestApp(topHostRoutes);
    const rows = async (limit: number) => {
      const body = (await app.inject({ url: `/api/reports/top-hosts?limit=${limit}` })).json() as { metrics: { rows: unknown[] }[] };
      return body.metrics.map((m) => m.rows.length);
    };
    expect(await rows(1)).toEqual([1, 1]);
    const callsAfterFirst = zbxMock.mock.calls.length;
    expect(callsAfterFirst).toBe(2); // the CPU read and the memory read
    for (let limit = 2; limit <= 20; limit++) expect(await rows(limit)).toEqual([limit, limit]);
    expect(zbxMock.mock.calls.length).toBe(callsAfterFirst);
    await app.close();
  });

  it('does not let one caller change what the next is given: the cut is a copy', async () => {
    estate();
    const app = await buildTestApp(topHostRoutes);
    await app.inject({ url: '/api/reports/top-hosts?limit=2' });
    const ten = (await app.inject({ url: '/api/reports/top-hosts' })).json() as { metrics: { rows: unknown[] }[] };
    expect(ten.metrics.map((m) => m.rows.length)).toEqual([10, 10]);
    await app.close();
  });
});

describe('the web monitoring report', () => {
  it('reads Zabbix once for every limit asked, and cuts the failures afterwards', async () => {
    estate();
    const app = await buildTestApp(webMonitoringRoutes);
    const body = async (limit: number) => (await app.inject({ url: `/api/reports/web-monitoring?limit=${limit}` })).json() as { failed: number; failures: unknown[] };
    expect((await body(1)).failures).toHaveLength(1);
    const callsAfterFirst = zbxMock.mock.calls.length;
    expect(callsAfterFirst).toBe(1);
    for (let limit = 2; limit <= 50; limit++) {
      const answer = await body(limit);
      expect(answer.failures).toHaveLength(limit);
      expect(answer.failed).toBe(60); // the count is of every failure, not of the rows sent
    }
    expect(zbxMock.mock.calls.length).toBe(callsAfterFirst);
    await app.close();
  });
});

describe('the top triggers report', () => {
  const held: Array<() => void> = [];
  afterEach(async () => {
    for (const open of held.splice(0)) open();
    await vi.waitFor(() => expect(heavy.running + heavy.waiting).toBe(0), { timeout: 5000, interval: 10 }).catch(() => undefined);
  });

  it('reads at most as many days at once as the other heavy reports, and holds the rest', async () => {
    let open!: () => void;
    const opened = new Promise<void>((r) => (open = r));
    held.push(() => open());
    zbxMock.mockImplementation(async () => {
      await opened;
      return [];
    });
    const app = await buildTestApp(reportRoutes);
    // five people: the gate is what is tested here, not what one person may hold (BK-75)
    const answers = [11, 12, 13, 14, 15].map((days) => app.inject({ url: `/api/reports/top-triggers?days=${days}`, remoteAddress: `10.0.0.${days}` }));
    await tick();
    expect(heavy.running).toBe(2);
    expect(heavy.waiting).toBe(3);
    open();
    expect((await Promise.all(answers)).map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    await app.close();
  });

  it('shares one read between callers who ask the same days', async () => {
    zbxMock.mockImplementation(async () => []);
    const app = await buildTestApp(reportRoutes);
    await Promise.all([1, 2, 3].map(() => app.inject({ url: '/api/reports/top-triggers?days=30' })));
    await app.inject({ url: '/api/reports/top-triggers?days=30' });
    expect(zbxMock.mock.calls.filter(([m]) => m === 'event.get')).toHaveLength(1);
    await app.close();
  });

  it('keeps its keys among the typed entries, so a run of different days cannot push out an entry that is not typed', async () => {
    zbxMock.mockImplementation(async () => []);
    const app = await buildTestApp(reportRoutes); // clears the cache, so the stand-in is made after it
    await cached('hosts-or-problems:stand-in', 600_000, async () => 'kept');
    for (let days = 1; days <= MAX_TYPED_ENTRIES + 30 && days <= 365; days++) {
      expect((await app.inject({ url: `/api/reports/top-triggers?days=${days}` })).statusCode).toBe(200);
    }
    expect(await cached('hosts-or-problems:stand-in', 600_000, async () => 'refetched')).toBe('kept');
    // The oldest typed day has gone: asking for it again reads Zabbix again.
    const before = zbxMock.mock.calls.length;
    await app.inject({ url: '/api/reports/top-triggers?days=1' });
    expect(zbxMock.mock.calls.length).toBeGreaterThan(before);
    await app.close();
  });
});
