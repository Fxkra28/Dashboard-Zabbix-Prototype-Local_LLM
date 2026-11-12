import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../core/cache.js';

/**
 * One cold month of the derived SLA is about 19 trend reads of 35 items each, and a viewer can ask for every month in both
 * profiles in one burst. The reads queue behind a gate of two (BK-50). computeSli is replaced by a stand-in that counts how
 * many are running at the same moment.
 */

const { compute, seen } = vi.hoisted(() => ({ compute: vi.fn(), seen: { running: 0, peak: 0 } }));
vi.mock('../sli/engine.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sli/engine.js')>()),
  computeSli: compute,
}));

const { getMonthlySli } = await import('../services/sli.js');
const { SLI_AT_ONCE } = await import('../services/reportPolicy.js');

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
const PROFILES = ['availability', 'hcml-report'] as const;

beforeEach(() => {
  invalidate('');
  seen.running = 0;
  seen.peak = 0;
  compute.mockReset();
  compute.mockImplementation(async (req: { month: string; profile: string }) => {
    seen.running++;
    seen.peak = Math.max(seen.peak, seen.running);
    await new Promise((resolve) => setTimeout(resolve, 15));
    seen.running--;
    return { marker: `${req.month}/${req.profile}` };
  });
});

describe('getMonthlySli under a burst (BK-50)', () => {
  it('reads two cold months at a time, however many are asked for at once, and answers every one', async () => {
    const answers = await Promise.all(MONTHS.flatMap((m) => PROFILES.map((p) => getMonthlySli(m, p))));
    expect(answers).toHaveLength(16);
    expect(compute).toHaveBeenCalledTimes(16);
    expect(SLI_AT_ONCE).toBe(2);
    expect(seen.peak).toBe(SLI_AT_ONCE);
  });

  it('still shares one read between callers who ask for the same month', async () => {
    await Promise.all([getMonthlySli('2026-08', 'availability'), getMonthlySli('2026-08', 'availability'), getMonthlySli('2026-08', 'availability')]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('lets the next read start when one fails, so a failure does not hold the queue', async () => {
    compute.mockReset();
    let calls = 0;
    compute.mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error('Zabbix did not answer');
      return { marker: 'ok' };
    });
    const results = await Promise.allSettled(MONTHS.slice(0, 4).map((m) => getMonthlySli(m, 'availability')));
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
  });
});

describe('a month nobody can report (BK-50)', () => {
  // The two places are held by reads that end only when the test lets them, so that nothing stays pending after it.
  it.each([
    ['2099-01', /has not started/],
    ['2019-01', /about a year/],
  ])('refuses %s at once, and does not wait for a place behind cold months', async (month, why) => {
    const release: (() => void)[] = [];
    compute.mockReset();
    compute.mockImplementation(() => new Promise((resolve) => release.push(() => resolve({ marker: 'held' }))));
    const holders = [getMonthlySli('2026-01', 'availability'), getMonthlySli('2026-02', 'availability')];
    await expect((async () => getMonthlySli(month, 'availability'))()).rejects.toThrow(why);
    expect(compute).toHaveBeenCalledTimes(2);
    release.forEach((r) => r());
    await Promise.all(holders);
  });
});

