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
const { Cancelled } = await import('../core/gate.js');
const { SLI_AT_ONCE } = await import('../services/reportPolicy.js');

/** The YYYY-MM of `n` months ago: a month that has started and is not past the year the SLA reports reach back (BK-50). */
const monthsBack = (n: number) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
};
const MONTHS = [8, 7, 6, 5, 4, 3, 2, 1].map(monthsBack);
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
    await Promise.all([getMonthlySli(monthsBack(1), 'availability'), getMonthlySli(monthsBack(1), 'availability'), getMonthlySli(monthsBack(1), 'availability')]);
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
    const holders = [getMonthlySli(monthsBack(8), 'availability'), getMonthlySli(monthsBack(7), 'availability')];
    await expect((async () => getMonthlySli(month, 'availability'))()).rejects.toThrow(why);
    expect(compute).toHaveBeenCalledTimes(2);
    release.forEach((r) => r());
    await Promise.all(holders);
  });
});

describe('a reader who leaves while a cold month waits (BK-59)', () => {
  it('does not read the month nobody waits for, and reads it as any cold month when it is asked for again', async () => {
    const release: (() => void)[] = [];
    compute.mockReset();
    compute.mockImplementation(() => new Promise((resolve) => release.push(() => resolve({ marker: 'held' }))));
    const holders = [getMonthlySli(monthsBack(8), 'availability'), getMonthlySli(monthsBack(7), 'availability')];
    const leaving = new AbortController();
    const dropped = getMonthlySli(monthsBack(6), 'availability', leaving.signal);
    dropped.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(compute).toHaveBeenCalledTimes(2);

    leaving.abort();
    await expect(dropped).rejects.toBeInstanceOf(Cancelled);
    release.forEach((r) => r());
    await Promise.all(holders);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(compute).toHaveBeenCalledTimes(2);

    compute.mockReset();
    compute.mockImplementation(async () => ({ marker: 'march' }));
    expect(await getMonthlySli(monthsBack(6), 'availability')).toEqual({ marker: 'march' });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('still reads a month for the reader who stays when another left', async () => {
    const release: (() => void)[] = [];
    compute.mockReset();
    compute.mockImplementation(() => new Promise((resolve) => release.push(() => resolve({ marker: 'ok' }))));
    const holders = [getMonthlySli(monthsBack(8), 'availability'), getMonthlySli(monthsBack(7), 'availability')];
    const leaving = new AbortController();
    const left = getMonthlySli(monthsBack(6), 'availability', leaving.signal);
    const stays = getMonthlySli(monthsBack(6), 'availability');
    left.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    leaving.abort();
    await expect(left).rejects.toBeInstanceOf(Cancelled);
    release.forEach((r) => r());
    await Promise.all(holders);
    await vi.waitFor(() => expect(release.length).toBe(3));
    release[2]!();
    expect(await stays).toEqual({ marker: 'ok' });
    expect(compute).toHaveBeenCalledTimes(3);
  });
});
