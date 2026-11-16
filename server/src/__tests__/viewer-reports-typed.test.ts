import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp } from './helpers/app.js';
import { cached, invalidate, MAX_ENTRIES, MAX_TYPED_ENTRIES } from '../core/cache.js';

/**
 * Four more reports kept one cache entry for every number a viewer picks (BK-70), as the top triggers did before BK-61: the noise
 * report, both rolling availability reads and Capacity. A run of distinct values pushed out the shared entries, and the pinned ones after them.
 */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../clients/zabbix.js')>()), zbx: zbxMock }));

const { analyticsRoutes } = await import('../routes/analytics.js');
const { CAPACITY_DAYS, CAPACITY_PERIODS, CAPACITY_TOP } = await import('../services/capacity.js');

/** More distinct requests than the typed entries can hold. */
const RUN = MAX_TYPED_ENTRIES + 30;
const kept = 'hosts-or-problems:stand-in';

afterEach(() => {
  zbxMock.mockReset();
  invalidate('');
});

/** Asks for `url(n)` for n = 1 to RUN, then says whether the first ask was kept: it reads Zabbix again only if its entry has gone. */
async function firstAskWasForgotten(url: (n: number) => string): Promise<boolean> {
  zbxMock.mockImplementation(async () => []);
  const app = await buildTestApp(analyticsRoutes); // clears the cache, so the stand-in is made after it
  await cached(kept, 600_000, async () => 'kept');
  for (let n = 1; n <= RUN; n++) expect((await app.inject({ url: url(n) })).statusCode).toBe(200);
  expect(await cached(kept, 600_000, async () => 'refetched')).toBe('kept');
  const before = zbxMock.mock.calls.length;
  await app.inject({ url: url(1) });
  await app.close();
  return zbxMock.mock.calls.length > before;
}

describe('a run of different numbers in one report', () => {
  it.each([
    ['the noise report', (n: number) => `/api/reports/noise?days=${(n % 365) + 1}&severity=${n % 6}`],
    ['the rolling availability read', (n: number) => `/api/reports/availability?days=${n}`],
    ['the rolling any-problem read', (n: number) => `/api/reports/availability?basis=all-problems&days=${(n % 365) + 1}&severity=${n % 6}`],
    ['Capacity, away from the periods its page offers', (n: number) => `/api/reports/capacity?days=${n}&top=${(n % 49) + 1}`],
  ])('keeps the keys of %s among the typed entries, and leaves an entry that is not typed alone', async (_name, url) => {
    expect(await firstAskWasForgotten(url)).toBe(true);
  });
});

describe('Capacity', () => {
  it('pins what its page offers, the four periods with the usual number of rows, so neither a run nor a full cache pushes them out', async () => {
    zbxMock.mockImplementation(async () => []);
    const app = await buildTestApp(analyticsRoutes);
    for (const days of CAPACITY_PERIODS) expect((await app.inject({ url: `/api/reports/capacity?days=${days}` })).statusCode).toBe(200);
    for (let n = 1; n <= RUN; n++) await app.inject({ url: `/api/reports/capacity?days=${(n % 300) + 1}&top=${(n % 40) + 11}` });
    // More entries than the cache holds, none of them pinned: only a pin keeps the four reports.
    for (let i = 0; i < MAX_ENTRIES + 20; i++) await cached(`filler:${i}`, 600_000, async () => i);
    const before = zbxMock.mock.calls.length;
    for (const days of CAPACITY_PERIODS) expect((await app.inject({ url: `/api/reports/capacity?days=${days}` })).statusCode).toBe(200);
    expect(zbxMock.mock.calls.length).toBe(before);
    await app.close();
  });

  it('holds a pinned entry of another report against the run', async () => {
    zbxMock.mockImplementation(async () => []);
    const app = await buildTestApp(analyticsRoutes);
    await cached('derived-sli:stand-in', 600_000, async () => 'month', { pin: true });
    for (let n = 1; n <= RUN; n++) await app.inject({ url: `/api/reports/capacity?days=${(n % 300) + 1}&top=${(n % 40) + 11}` });
    expect(await cached('derived-sli:stand-in', 600_000, async () => 'refetched')).toBe('month');
    await app.close();
  });

  it('offers the periods that the Capacity page offers, and the usual report is one of them', () => {
    const page = readFileSync(new URL('../../../web/src/features/reports/Capacity.tsx', import.meta.url), 'utf8');
    const offered = /useUrlState<number>\('days', (\d+), \{ options: \[([\d, ]+)\] \}\)/.exec(page);
    expect(offered, 'the page no longer reads its period the way this test expects').not.toBeNull();
    expect(offered![2].split(',').map(Number)).toEqual([...CAPACITY_PERIODS]);
    expect(CAPACITY_PERIODS).toContain(CAPACITY_DAYS);
    expect(Number(offered![1])).toBe(CAPACITY_DAYS);
    expect(CAPACITY_TOP).toBe(10);
  });
});
