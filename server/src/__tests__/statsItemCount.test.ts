import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Dashboard's item and trigger counts. Counting them took HCML's Zabbix about 40 s and 74 s, so /api/stats
 * must not wait for them, must not ask for them every 30 s, and must not ask again at once after one fails.
 */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/zabbix.js')>();
  return { ...actual, zbx: zbxMock };
});

const itemCounts = () => zbxMock.mock.calls.filter(([method]) => method === 'item.get').length;
const triggerCounts = () => zbxMock.mock.calls.filter(([method]) => method === 'trigger.get').length;
const otherCounts = async (_method: string, params?: { countOutput?: boolean }) => (params?.countOutput ? '1' : []);

beforeEach(() => {
  // A fresh cache and a fresh failure clock for every test.
  vi.resetModules();
  zbxMock.mockReset();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the item count on /api/stats', () => {
  it('answers with the other counts while a slow item count runs, then shows the count once it is in', async () => {
    let finish: (count: string) => void = () => {};
    zbxMock.mockImplementation(async (method: string, params?: { countOutput?: boolean }) =>
      method === 'item.get'
        ? new Promise<string>((resolve) => {
            finish = resolve;
          })
        : otherCounts(method, params),
    );
    const { getStats, COUNT_WAIT_MS } = await import('../services/reports.js');

    const first = getStats();
    await vi.advanceTimersByTimeAsync(COUNT_WAIT_MS);
    expect(await first).toMatchObject({ hosts: 1, items: null, triggers: 1 });

    finish('33227');
    await vi.advanceTimersByTimeAsync(30_001); // past the 30 s cache of the whole answer
    expect((await getStats()).items).toBe(33227);
    expect(itemCounts()).toBe(1);
  });

  it('asks Zabbix for the item count once an hour, not at every refresh', async () => {
    zbxMock.mockImplementation(otherCounts);
    const { getStats } = await import('../services/reports.js');

    expect((await getStats()).items).toBe(1);
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(30_001);
      await getStats();
    }
    expect(itemCounts()).toBe(1);
    expect(triggerCounts()).toBe(1);

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect((await getStats()).items).toBe(1); // the held count, while a new one is read behind it
    await vi.advanceTimersByTimeAsync(0);
    expect(itemCounts()).toBe(2);
    expect(triggerCounts()).toBe(2);
  });

  it('after a failed count, logs it and waits ten minutes before asking Zabbix again', async () => {
    zbxMock.mockImplementation(async (method: string, params?: { countOutput?: boolean }) => {
      if (method === 'item.get') throw new Error('Zabbix did not respond to item.get within 120000 ms.');
      return otherCounts(method, params);
    });
    const { setCacheLogger } = await import('../core/cache.js');
    const warn = vi.fn();
    setCacheLogger({ warn });
    const { getStats, COUNT_RETRY_MS } = await import('../services/reports.js');

    expect((await getStats()).items).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ key: 'counts:items' }), expect.stringContaining('10 minutes'));
    await vi.advanceTimersByTimeAsync(30_001);
    expect((await getStats()).items).toBeNull();
    expect(itemCounts()).toBe(1);

    await vi.advanceTimersByTimeAsync(COUNT_RETRY_MS);
    await getStats();
    expect(itemCounts()).toBe(2);
  });

  it('counts the monitored triggers the same way: the Dashboard does not wait for them either', async () => {
    let finish: (count: string) => void = () => {};
    zbxMock.mockImplementation(async (method: string, params?: { countOutput?: boolean }) =>
      method === 'trigger.get'
        ? new Promise<string>((resolve) => {
            finish = resolve;
          })
        : otherCounts(method, params),
    );
    const { getStats, COUNT_WAIT_MS } = await import('../services/reports.js');

    const first = getStats();
    await vi.advanceTimersByTimeAsync(COUNT_WAIT_MS);
    expect(await first).toMatchObject({ hosts: 1, items: 1, triggers: null });

    finish('15141');
    await vi.advanceTimersByTimeAsync(30_001);
    expect((await getStats()).triggers).toBe(15141);
    expect(triggerCounts()).toBe(1);
  });

  it('keeps both counts when a write clears the Dashboard: acknowledging changes neither', async () => {
    zbxMock.mockImplementation(otherCounts);
    const { getStats } = await import('../services/reports.js');
    const { invalidate } = await import('../core/cache.js');
    const { STALE_AFTER_WRITE } = await import('../services/actions.js');

    await getStats();
    for (const key of STALE_AFTER_WRITE) invalidate(key);
    await getStats();
    expect(itemCounts()).toBe(1);
    expect(triggerCounts()).toBe(1);
  });
});
